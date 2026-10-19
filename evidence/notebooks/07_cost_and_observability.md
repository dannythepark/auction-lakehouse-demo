# 07_cost_and_observability: executed notebook with saved output

_Exported from the Databricks workspace (Jupyter format, with results) after running the notebook as a serverless job. Tables below are the real query results, converted from HTML to Markdown._

# 07 · Cost attribution & observability

The data leader's two gates were **cost** and **"close the loop on what the LLMs do with our data."**
Both are answered from the same place: **system tables** in Unity Catalog. There's no extra
monitoring product to buy or run. The Buyer 360 app's *Cost* and *Observability* pages run
exactly these queries, on-behalf-of the signed-in user.

| Question | Source |
|---|---|
| What does each workload cost? | `system.billing.usage` × `system.billing.list_prices` |
| Which team / project / pipeline? | `custom_tags` from a **serverless usage policy** |
| Is the data right? | the pipeline **event log** (expectation pass/fail per run) |
| Where did this number come from? | `system.access.table_lineage` |
| Who saw PII, and did they see plaintext? | lineage reads ⋈ the PII allowlist |
| What did the AI surfaces do? | `system.query.history` (Genie space ID, app) + `system.serving.endpoint_usage` |

## 1 · Tag the workloads so cost finds itself
Serverless compute (pipelines, apps, notebooks, jobs, Lakebase) is tagged with a **serverless usage
policy**: Settings → Compute → Serverless usage policies → Create, with tags such as
`project=auctionco`, `workload=elt`, `cost_center=data-eng`. Attach it to the pipeline:
```
databricks pipelines update <pipeline-id> --budget-policy-id <policy_id> -p <profile>
```
and to the app (`budget_policy_id` under `resources.apps.app` in `databricks.yml`). From then on
every DBU carries those tags in `system.billing.usage.custom_tags`. That's chargeback by team with
no spreadsheet. Classic compute does the same with `custom_tags` on the cluster or job.

### Code cell 1

```sql
-- the tag-based pattern: cost by cost center and workload, straight from billing
SELECT custom_tags['cost_center'] AS cost_center,
       custom_tags['workload']    AS workload,
       billing_origin_product,
       ROUND(SUM(usage_quantity), 2) AS dbus
FROM system.billing.usage
WHERE custom_tags['project'] = 'auctionco'
  AND usage_date >= current_date() - 30
GROUP BY ALL ORDER BY dbus DESC;
```

**Output:**

| cost_center | workload | billing_origin_product | dbus |
|---|---|---|---|

### The demo's attribution view
`auc_gold.v_demo_cost` is **tag-first** and falls back to resource IDs (pipeline ID, app name,
Lakebase project, Genie space, serving endpoint) for usage recorded before the policy existed.

### Code cell 2

```sql
SELECT workload, attributed_by,
       ROUND(SUM(dbus), 2) AS dbus, ROUND(SUM(list_usd), 2) AS list_usd
FROM demo_catalog.auc_gold.v_demo_cost
WHERE usage_date >= current_date() - 30
GROUP BY ALL ORDER BY list_usd DESC;
```

**Output:**

| workload | attributed_by | dbus | list_usd |
|---|---|---|---|
| Cost app (retired) | resource id | 226.51 | 215.18 |
| Buyer 360 app | resource id | 98.29 | 93.37 |
| Lakebase serving (auction-recs) | resource id | 15.31 | 7.72 |
| ELT pipeline (auc_demo_elt) | resource id | 2.92 | 1.31 |
| AI: Claude Sonnet 5 | resource id | 2.16 | 0.15 |
| Genie space (Auction Analytics) | resource id | 1.00 | 0.0 |

**What to point at:** the whole raw → gold ELT pipeline costs well under a dollar per run on
serverless, because it only bills while it runs and Auto Loader only processes new files. The
biggest line is the always-on app, which is the real cost lever (stop it when idle, or right-size
it). That's the kind of answer a cost model needs: what drives the bill, not just the total.

## 2 · Is the data right? Data-quality gates from the event log
Every `EXPECT` in notebook 01 records passed/failed counts per update. After the wave-2 drop
(notebook 02), the 40 deliberately bad bids show up here: `valid_bid` drops 25 rows,
`has_bidder` flags 15 and keeps them.

### Code cell 3

```sql
SELECT `timestamp`, origin.flow_name AS dataset, x.name AS expectation,
       x.passed_records, x.failed_records
FROM demo_catalog.auc_gold.event_log_<pipeline_id_with_underscores>
LATERAL VIEW explode(from_json(get_json_object(details, '$.flow_progress.data_quality.expectations'),
  'array<struct<name:string,dataset:string,passed_records:bigint,failed_records:bigint>>')) t AS x
WHERE event_type = 'flow_progress'
ORDER BY `timestamp` DESC, expectation
LIMIT 20;
```

**Output:**

| timestamp | dataset | expectation | passed_records | failed_records |
|---|---|---|---|---|
| 2026-10-08T03:21:58.906Z | demo_catalog.auc_silver.silver_bids | has_bidder | 42000 | 0 |
| 2026-10-08T03:21:58.906Z | demo_catalog.auc_silver.silver_bids | has_item | 42000 | 0 |
| 2026-10-08T03:21:58.906Z | demo_catalog.auc_silver.silver_bids | valid_bid | 42000 | 0 |
| 2026-10-08T03:20:41.881Z | demo_catalog.auc_silver.silver_bids | has_bidder | 18025 | 15 |
| 2026-10-08T03:20:41.881Z | demo_catalog.auc_silver.silver_bids | has_item | 18040 | 0 |
| 2026-10-08T03:20:41.881Z | demo_catalog.auc_silver.silver_bids | valid_bid | 18015 | 25 |
| 2026-10-08T03:12:38.629Z | demo_catalog.auc_silver.silver_bids | has_bidder | 42000 | 0 |
| 2026-10-08T03:12:38.629Z | demo_catalog.auc_silver.silver_bids | has_item | 42000 | 0 |
| 2026-10-08T03:12:38.629Z | demo_catalog.auc_silver.silver_bids | valid_bid | 42000 | 0 |
| 2026-10-08T03:11:31.308Z | demo_catalog.auc_silver.silver_bids | has_bidder | 18025 | 15 |
| 2026-10-08T03:11:31.308Z | demo_catalog.auc_silver.silver_bids | has_item | 18040 | 0 |
| 2026-10-08T03:11:31.308Z | demo_catalog.auc_silver.silver_bids | valid_bid | 18015 | 25 |
| 2026-10-08T03:10:27.170Z | demo_catalog.auc_silver.silver_bids | has_bidder | 42000 | 0 |
| 2026-10-08T03:10:27.170Z | demo_catalog.auc_silver.silver_bids | has_item | 42000 | 0 |
| 2026-10-08T03:10:27.170Z | demo_catalog.auc_silver.silver_bids | valid_bid | 42000 | 0 |
| 2026-10-08T03:05:38.688Z | demo_catalog.auc_silver.silver_bids | has_bidder | 18025 | 15 |
| 2026-10-08T03:05:38.688Z | demo_catalog.auc_silver.silver_bids | has_item | 18040 | 0 |
| 2026-10-08T03:05:38.688Z | demo_catalog.auc_silver.silver_bids | valid_bid | 18015 | 25 |
| 2026-10-07T19:01:05.532Z | demo_catalog.auc_silver.silver_bids | has_bidder | 42000 | 0 |
| 2026-10-07T19:01:05.532Z | demo_catalog.auc_silver.silver_bids | has_item | 42000 | 0 |

## 3 · Where did this number come from? Lineage
Captured automatically for pipelines, notebooks, SQL, Genie and apps. Nothing is declared by hand,
so there's no `ref()` to forget. This is the impact-analysis gap their DataHub doc calls out (dbt
models with hard-coded table names are invisible to lineage).

### Code cell 4

```sql
SELECT source_table_full_name AS upstream, target_table_full_name AS downstream,
       entity_type, MAX(event_time) AS last_seen
FROM system.access.table_lineage
WHERE (target_table_full_name LIKE 'demo_catalog.auc_%' OR source_table_full_name LIKE 'demo_catalog.auc_%')
  AND target_table_full_name IS NOT NULL
  AND event_date >= current_date() - 60
GROUP BY ALL ORDER BY downstream, upstream;
```

**Output:**

| upstream | downstream | entity_type | last_seen |
|---|---|---|---|
| null | demo_catalog.auc_bronze.bronze_accounts | PIPELINE | 2026-10-08T03:20:30.374Z |
| null | demo_catalog.auc_bronze.bronze_bids | PIPELINE | 2026-10-08T03:21:55.794Z |
| null | demo_catalog.auc_bronze.bronze_items | PIPELINE | 2026-10-08T03:20:30.378Z |
| demo_catalog.auc_gold.fact_bids | demo_catalog.auc_gold.buyer_recommendations | null | 2026-09-14T16:20:37.314Z |
| demo_catalog.auc_raw.item_basics | demo_catalog.auc_gold.buyer_recommendations | null | 2026-09-14T16:20:37.314Z |
| demo_catalog.auc_gold.fact_bids | demo_catalog.auc_gold.daily_gmv | PIPELINE | 2026-10-08T03:22:05.378Z |
| null | demo_catalog.auc_gold.event_log_<pipeline_id_with_underscores> | PIPELINE | 2026-10-08T03:22:07.089Z |
| demo_catalog.auc_bronze.bronze_items | demo_catalog.auc_gold.fact_bids | PIPELINE | 2026-10-08T03:22:02.344Z |
| demo_catalog.auc_silver.dim_account | demo_catalog.auc_gold.fact_bids | PIPELINE | 2026-10-08T03:22:02.344Z |
| demo_catalog.auc_silver.silver_bids | demo_catalog.auc_gold.fact_bids | PIPELINE | 2026-10-08T03:22:02.344Z |
| demo_catalog.auc_gold.fact_bids | demo_catalog.auc_gold.metrics_auction | null | 2026-10-08T03:12:56.708Z |
| demo_catalog.auc_silver.dim_account | demo_catalog.auc_gold.v_account_360 | null | 2026-10-08T03:24:29.659Z |
| system.billing.list_prices | demo_catalog.auc_gold.v_demo_cost | JOB | 2026-10-07T18:25:35.636Z |
| system.billing.list_prices | demo_catalog.auc_gold.v_demo_cost | null | 2026-10-07T19:27:49.500Z |
| system.billing.usage | demo_catalog.auc_gold.v_demo_cost | JOB | 2026-10-07T18:25:35.636Z |
| system.billing.usage | demo_catalog.auc_gold.v_demo_cost | null | 2026-10-07T19:27:49.500Z |
| system.billing.list_prices | demo_catalog.auc_gold.v_pipeline_cost | null | 2026-09-29T19:06:57.775Z |
| system.billing.usage | demo_catalog.auc_gold.v_pipeline_cost | null | 2026-09-29T19:06:57.775Z |
| null | demo_catalog.auc_gov.pii_authorized | null | 2026-09-10T21:43:56.767Z |
| null | demo_catalog.auc_gov.pii_partial | JOB | 2026-10-07T18:25:30.804Z |
| null | demo_catalog.auc_gov.pii_partial | null | 2026-10-07T17:27:00.926Z |
| null | demo_catalog.auc_raw.accounts | JOB | 2026-09-10T21:30:57.320Z |
| null | demo_catalog.auc_raw.bids | JOB | 2026-09-10T21:31:11.453Z |
| null | demo_catalog.auc_raw.item_basics | JOB | 2026-09-10T21:31:08.553Z |
| demo_catalog.auc_bronze.bronze_accounts | demo_catalog.auc_silver.dim_account | PIPELINE | 2026-10-08T03:20:34.833Z |
| demo_catalog.auc_silver.dim_account | demo_catalog.auc_silver.dim_account | PIPELINE | 2026-09-29T19:08:37.585Z |
| demo_catalog.auc_bronze.bronze_bids | demo_catalog.auc_silver.silver_bids | PIPELINE | 2026-10-08T03:21:58.932Z |

## 4 · Who saw the PII, and what did they see?

### Code cell 5

```sql
SELECT l.created_by AS principal,
       CASE WHEN a.principal IS NOT NULL THEN 'plaintext' ELSE 'ciphertext' END AS pii_result,
       COUNT(*) AS reads, MAX(l.event_time) AS last_read
FROM system.access.table_lineage l
LEFT JOIN demo_catalog.auc_gov.pii_authorized a ON a.principal = l.created_by
WHERE l.source_table_full_name IN ('demo_catalog.auc_gold.v_account_360', 'demo_catalog.auc_silver.dim_account')
  AND l.event_date >= current_date() - 60
GROUP BY ALL ORDER BY reads DESC;
```

**Output:**

| principal | pii_result | reads | last_read |
|---|---|---|---|
| <your-email> | plaintext | 47 | 2026-10-08T03:24:29.659Z |
| <app-service-principal-id> | ciphertext | 16 | 2026-10-08T03:24:09.794Z |
| null | ciphertext | 10 | 2026-10-08T03:22:02.344Z |
| <data-team-sp-id> | plaintext | 4 | 2026-10-07T18:36:08.457Z |
| <business-sp-id> | ciphertext | 4 | 2026-10-07T18:36:13.959Z |

## 5 · What did the AI do? Genie, the app, and the LLM endpoint

### Code cell 6

```sql
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
```

**Output:**

| surface | executed_by | queries | rows_read | p50_ms |
|---|---|---|---|---|
| Buyer 360 app | <your-email> | 61 | 52478 | 1894 |
| Buyer 360 app | <app-service-principal-id> | 12 | 10454 | 1905 |
| Genie (Auction Analytics) | <your-email> | 3 | 42000 | 802 |

### Code cell 7

```sql
-- every LLM call, attributed to the person (the app calls on-behalf-of the user)
SELECT u.requester, COUNT(*) AS requests,
       SUM(u.input_token_count) AS input_tokens, SUM(u.output_token_count) AS output_tokens,
       SUM(CASE WHEN u.status_code <> 200 THEN 1 ELSE 0 END) AS errors
FROM system.serving.endpoint_usage u
JOIN system.serving.served_entities s ON s.served_entity_id = u.served_entity_id
WHERE s.endpoint_name = 'databricks-claude-sonnet-5'
  AND u.request_time >= current_timestamp() - INTERVAL 30 DAYS
GROUP BY u.requester ORDER BY requests DESC;
```

**Output:**

| requester | requests | input_tokens | output_tokens | errors |
|---|---|---|---|---|
| axel.richier@databricks.com | 31914 | 9846449 | 777738 | 6 |
| praneeth.paikray@databricks.com | 14548 | 3726347 | 936871 | 13588 |
| a3821ad2-1f29-4b03-89ab-1febd43f3aa8 | 8495 | 38363544 | 2766786 | 1 |
| nina.williams@databricks.com | 7754 | 2995821 | 2014998 | 0 |
| kevin.ippen@databricks.com | 7222 | 2869314 | 782396 | 5143 |
| thibault.quinquis@databricks.com | 4320 | 343512 | 47415 | 4208 |
| e0aa799a-0921-4c9e-b6e9-a3aa99c76729 | 4253 | 87138132 | 783532 | 92 |
| abhishek.pan@databricks.com | 4030 | 8614845 | 1016467 | 0 |
| hongguen.park@databricks.com | 2891 | 10175105 | 252342 | 1810 |
| 94179a28-4cc4-4ddd-bc17-d3b52bdccaea | 2414 | 613751 | 26200 | 0 |
| felipe.penaranda@databricks.com | 1200 | 703860 | 431344 | 0 |
| 0bc9551a-5056-4348-9235-76457abab75e | 1179 | 3486637 | 3488953 | 5 |
| vladimir.dainovski@databricks.com | 1072 | 14176671 | 452477 | 252 |
| roy.bang@databricks.com | 1020 | 5191519 | 146431 | 60 |
| alex.witt@databricks.com | 946 | 5578618 | 698413 | 2 |
| daniel.chegwidden@databricks.com | 843 | 6273232 | 329016 | 5 |
| pedro.zanela@databricks.com | 838 | 6964816 | 285361 | 107 |
| 0329b705-c44c-4ee2-b23f-2813083f34c3 | 730 | 5028430 | 5872848 | 169 |
| shrish.chaturvedi@databricks.com | 702 | 431664 | 79158 | 66 |
| 579d6c24-ffe9-449c-bdf7-6d24197c4808 | 691 | 5732818 | 349240 | 0 |
| d8e32ccd-f6a6-495c-90ac-414f5f8f3a69 | 641 | 10316044 | 591843 | 1 |
| akbar.khan@databricks.com | 629 | 186967 | 103336 | 316 |
| ce0f1251-9e1e-43dd-a33c-74e3c22f7c3c | 605 | 8819071 | 106858 | 0 |
| nate.fleming@databricks.com | 556 | 3335974 | 90871 | 9 |
| 447782b9-050a-4b5b-b4cf-09ae3a350a10 | 505 | 0 | 0 | 505 |
| 5d781c7e-f053-4c85-bf69-bf1947f12adf | 499 | 0 | 0 | 499 |
| robert.whiffin@databricks.com | 491 | 1935870 | 93582 | 0 |
| austin.choi@databricks.com | 490 | 1152129 | 119646 | 22 |
| valentin.fazenda@databricks.com | 440 | 99524 | 196828 | 5 |
| daryus.medora@databricks.com | 414 | 5852601 | 154918 | 1 |
| subhannita.sarcar@databricks.com | 409 | 355437 | 224922 | 0 |
| vitor.jardim@databricks.com | 366 | 596949 | 138844 | 10 |
| f354916e-cf9e-4e62-8b9a-b5f4e8c8523a | 362 | 172623 | 36976 | 0 |
| b53cd26c-04f4-4f79-be70-7a93ad5bfd66 | 309 | 1535020 | 98562 | 0 |
| 96f68c60-1b65-4717-bc30-5efb3abff4b7 | 303 | 2113419 | 380905 | 1 |
| rodrigo.anastacio@databricks.com | 300 | 41528 | 48170 | 0 |
| 08bbaaa3-45bf-45eb-a555-994ea6ec89be | 286 | 53965 | 7731 | 143 |
| jeremy.herbert@databricks.com | 284 | 9345476 | 230976 | 3 |
| alexandre.ve@databricks.com | 281 | 3113486 | 152556 | 4 |
| 72f148b5-035a-42a7-b73e-278900ad5600 | 278 | 6605401 | 906672 | 1 |
| hen.ben-hemo@databricks.com | 262 | 91300 | 68940 | 131 |
| drew.triplett@databricks.com | 240 | 146542 | 38093 | 0 |
| matthew.turnbull@databricks.com | 240 | 34849 | 11219 | 0 |
| ashutosh.garg@databricks.com | 234 | 250575 | 41591 | 2 |
| jas.bali@databricks.com | 230 | 1924970 | 1506019 | 40 |
| hongchun.tian@databricks.com | 223 | 211092 | 73024 | 64 |
| 737e33a4-6186-4bb0-aa83-f9e71759ac23 | 200 | 385156 | 30870 | 0 |
| sindhu.murugavel@databricks.com | 199 | 94605 | 194351 | 26 |
| fad1016a-1e15-45d8-a7cc-147264030877 | 196 | 64628 | 43243 | 0 |
| 57c6ae8b-1f9d-45ee-b2e8-3cdc8b985f5c | 193 | 722490 | 60651 | 0 |
| a3c8a62d-d294-418b-9fc5-fc2bd305ac1d | 188 | 1114378 | 1127161 | 25 |
| mohamed.darwish@databricks.com | 185 | 897213 | 75893 | 2 |
| cc38cbe1-c613-48d1-a453-965f4f5ecee5 | 181 | 343680 | 35410 | 1 |
| kurt.weston@databricks.com | 181 | 1198168 | 56542 | 33 |
| 76b7e3cc-8695-45a9-a7a8-942174653521 | 179 | 616585 | 76869 | 0 |
| rodrigo.cosin@databricks.com | 175 | 171956 | 58129 | 1 |
| c0b4ac9e-c923-4cd6-b9ae-5030700fc85d | 172 | 0 | 0 | 172 |
| 3dc0517b-429a-4f04-8e8e-53b676563829 | 169 | 97016 | 52096 | 0 |
| 4508cc9e-61ae-4dbc-a330-9a6b68a92752 | 162 | 508259 | 329097 | 0 |
| konomi.omae@databricks.com | 160 | 3369087 | 451403 | 0 |

_… 493 more rows truncated_

**Going further (production):** turn on **AI Gateway inference tables** on the endpoints you
govern to log full prompts and responses to a Delta table; add **MLflow tracing** to agents for
step-level traces and evaluation; put **data quality monitoring** on gold tables for drift and
freshness alerts. All of it lands in Unity Catalog tables you can query, govern and alert on
like any other data.
