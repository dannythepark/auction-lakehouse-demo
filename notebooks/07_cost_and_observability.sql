-- Databricks notebook source
-- MAGIC %md
-- MAGIC # 07 · Cost attribution & observability
-- MAGIC
-- MAGIC the data leader's two gates were **cost** and **"close the loop on what the LLMs do with our data."**
-- MAGIC Both are answered from the same place: **system tables** in Unity Catalog. There's no extra
-- MAGIC monitoring product to buy or run. The Buyer 360 app's *Cost* and *Observability* pages run
-- MAGIC exactly these queries, on-behalf-of the signed-in user.
-- MAGIC
-- MAGIC | Question | Source |
-- MAGIC |---|---|
-- MAGIC | What does each workload cost? | `system.billing.usage` × `system.billing.list_prices` |
-- MAGIC | Which team / project / pipeline? | `custom_tags` from a **serverless usage policy** |
-- MAGIC | Is the data right? | the pipeline **event log** (expectation pass/fail per run) |
-- MAGIC | Where did this number come from? | `system.access.table_lineage` |
-- MAGIC | Who saw PII, and did they see plaintext? | lineage reads ⋈ the PII allowlist |
-- MAGIC | What did the AI surfaces do? | `system.query.history` (Genie space ID, app) + `system.serving.endpoint_usage` |

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ## 1 · Tag the workloads so cost finds itself
-- MAGIC Serverless compute (pipelines, apps, notebooks, jobs, Lakebase) is tagged with a **serverless usage
-- MAGIC policy**: Settings → Compute → Serverless usage policies → Create, with tags such as
-- MAGIC `project=auctionco`, `workload=elt`, `cost_center=data-eng`. Attach it to the pipeline:
-- MAGIC ```
-- MAGIC databricks pipelines update <pipeline-id> --budget-policy-id <policy_id> -p <profile>
-- MAGIC ```
-- MAGIC and to the app (`budget_policy_id` under `resources.apps.app` in `databricks.yml`). From then on
-- MAGIC every DBU carries those tags in `system.billing.usage.custom_tags`. That's chargeback by team with
-- MAGIC no spreadsheet. Classic compute does the same with `custom_tags` on the cluster or job.

-- COMMAND ----------

-- the tag-based pattern: cost by cost center and workload, straight from billing
SELECT custom_tags['cost_center'] AS cost_center,
       custom_tags['workload']    AS workload,
       billing_origin_product,
       ROUND(SUM(usage_quantity), 2) AS dbus
FROM system.billing.usage
WHERE custom_tags['project'] = 'auctionco'
  AND usage_date >= current_date() - 30
GROUP BY ALL ORDER BY dbus DESC;

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ### The demo's attribution view
-- MAGIC `auc_gold.v_demo_cost` is **tag-first** and falls back to resource IDs (pipeline ID, app name,
-- MAGIC Lakebase project, Genie space, serving endpoint) for usage recorded before the policy existed.

-- COMMAND ----------

SELECT workload, attributed_by,
       ROUND(SUM(dbus), 2) AS dbus, ROUND(SUM(list_usd), 2) AS list_usd
FROM demo_catalog.auc_gold.v_demo_cost
WHERE usage_date >= current_date() - 30
GROUP BY ALL ORDER BY list_usd DESC;

-- COMMAND ----------

-- MAGIC %md
-- MAGIC **What to point at:** the whole raw → gold ELT pipeline costs well under a dollar per run on
-- MAGIC serverless, because it only bills while it runs and Auto Loader only processes new files. The
-- MAGIC biggest line is the always-on app, which is the real cost lever (stop it when idle, or right-size
-- MAGIC it). That's the kind of answer a cost model needs: what drives the bill, not just the total.

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ## 2 · Is the data right? Data-quality gates from the event log
-- MAGIC Every `EXPECT` in notebook 01 records passed/failed counts per update. After the wave-2 drop
-- MAGIC (notebook 02), the 40 deliberately bad bids show up here: `valid_bid` drops 25 rows,
-- MAGIC `has_bidder` flags 15 and keeps them.

-- COMMAND ----------

SELECT `timestamp`, origin.flow_name AS dataset, x.name AS expectation,
       x.passed_records, x.failed_records
FROM demo_catalog.auc_gold.event_log_<pipeline_id_with_underscores>
LATERAL VIEW explode(from_json(get_json_object(details, '$.flow_progress.data_quality.expectations'),
  'array<struct<name:string,dataset:string,passed_records:bigint,failed_records:bigint>>')) t AS x
WHERE event_type = 'flow_progress'
ORDER BY `timestamp` DESC, expectation
LIMIT 20;

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ## 3 · Where did this number come from? Lineage
-- MAGIC Captured automatically for pipelines, notebooks, SQL, Genie and apps. Nothing is declared by hand,
-- MAGIC so there's no `ref()` to forget. This is the impact-analysis gap their your data catalog doc calls out (dbt
-- MAGIC models with hard-coded table names are invisible to lineage).

-- COMMAND ----------

SELECT source_table_full_name AS upstream, target_table_full_name AS downstream,
       entity_type, MAX(event_time) AS last_seen
FROM system.access.table_lineage
WHERE (target_table_full_name LIKE 'demo_catalog.auc_%' OR source_table_full_name LIKE 'demo_catalog.auc_%')
  AND target_table_full_name IS NOT NULL
  AND event_date >= current_date() - 60
GROUP BY ALL ORDER BY downstream, upstream;

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ## 4 · Who saw the PII, and what did they see?

-- COMMAND ----------

SELECT l.created_by AS principal,
       CASE WHEN a.principal IS NOT NULL THEN 'plaintext' ELSE 'ciphertext' END AS pii_result,
       COUNT(*) AS reads, MAX(l.event_time) AS last_read
FROM system.access.table_lineage l
LEFT JOIN demo_catalog.auc_gov.pii_authorized a ON a.principal = l.created_by
WHERE l.source_table_full_name IN ('demo_catalog.auc_gold.v_account_360', 'demo_catalog.auc_silver.dim_account')
  AND l.event_date >= current_date() - 60
GROUP BY ALL ORDER BY reads DESC;

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ## 5 · What did the AI do? Genie, the app, and the LLM endpoint

-- COMMAND ----------

-- governed queries by surface (Genie statement text is redacted, but the space ID is recorded)
SELECT CASE
         WHEN query_source.genie_space_id = '<genie-space-id>' THEN 'Genie (Auction Analytics)'
         WHEN client_application = '@databricks' THEN 'Buyer 360 app'
         ELSE client_application
       END AS surface,
       executed_by, COUNT(*) AS queries, SUM(read_rows) AS rows_read,
       CAST(PERCENTILE(total_duration_ms, 0.5) AS BIGINT) AS p50_ms
FROM system.query.history
WHERE start_time >= current_timestamp() - INTERVAL 30 DAYS
  AND (query_source.genie_space_id = '<genie-space-id>'
       OR (client_application = '@databricks' AND compute.warehouse_id = '<warehouse-id>'))
GROUP BY ALL ORDER BY queries DESC;

-- COMMAND ----------

-- every LLM call, attributed to the person (the app calls on-behalf-of the user)
SELECT u.requester, COUNT(*) AS requests,
       SUM(u.input_token_count) AS input_tokens, SUM(u.output_token_count) AS output_tokens,
       SUM(CASE WHEN u.status_code <> 200 THEN 1 ELSE 0 END) AS errors
FROM system.serving.endpoint_usage u
JOIN system.serving.served_entities s ON s.served_entity_id = u.served_entity_id
WHERE s.endpoint_name = 'databricks-claude-sonnet-5'
  AND u.request_time >= current_timestamp() - INTERVAL 30 DAYS
GROUP BY u.requester ORDER BY requests DESC;

-- COMMAND ----------

-- MAGIC %md
-- MAGIC **Going further (production):** turn on **AI Gateway inference tables** on the endpoints you
-- MAGIC govern to log full prompts and responses to a Delta table; add **MLflow tracing** to agents for
-- MAGIC step-level traces and evaluation; put **data quality monitoring** on gold tables for drift and
-- MAGIC freshness alerts. All of it lands in Unity Catalog tables you can query, govern and alert on
-- MAGIC like any other data.
