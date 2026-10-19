# Execution evidence

Everything in this folder is **real output from the running build**, committed as text. Notebooks were run as serverless jobs, exported from the workspace with their results, and converted to Markdown. Pipeline, Genie, model and app output was captured live with the Databricks CLI and REST APIs. Workspace IDs, hosts and emails are replaced with the placeholders listed in the top-level README. All data is synthetic.

| Stage | What ran | Evidence |
|---|---|---|
| **Lakeflow** (ingest + transform) | Serverless Spark Declarative Pipeline: Auto Loader → bronze → silver (expectations) → SCD2 (`AUTO CDC`) → gold. Live drop takes `fact_bids` from 42,000 to 60,015 rows; `valid_bid` drops 25, `has_bidder` flags 15 | [`pipeline_runs.md`](pipeline_runs.md) (update history, event-log rows per flow, the failed update's error, live row counts) · [`notebooks/02_declarative_pipeline_streaming_cdc.md`](notebooks/02_declarative_pipeline_streaming_cdc.md) |
| **Unity Catalog** (govern) | PII tags on 5 columns, two mask functions, three tiers; the same query run as three identities returns plaintext / last 4 / AES ciphertext. Lineage, PII-access audit and cost from system tables | [`notebooks/03_pii_tagging_and_masking.md`](notebooks/03_pii_tagging_and_masking.md) · [`notebooks/07_cost_and_observability.md`](notebooks/07_cost_and_observability.md) |
| Semantic layer | Metric view `metrics_auction`; `MEASURE()` slices; check that it equals hand-written SQL (`same_number = true`) | [`notebooks/04_metric_views.md`](notebooks/04_metric_views.md) |
| **Lakebase** (operational serving) | 20K recommendations in Lakebase Postgres: index-scan plan 0.05 ms, p50/p95 over 500 lookups vs SQL warehouse, refresh from gold, write-back table | [`notebooks/06_lakebase_serving_recommendations.md`](notebooks/06_lakebase_serving_recommendations.md) · [`app_smoke_test.md`](app_smoke_test.md) |
| **ML / GenAI** | Bid-affinity recommendation model (notebook 06); `ai_classify`, `ai_extract`, `ai_gen`, `AI_FORECAST` (notebook 05); Claude vision appraisal of a lot photo | [`notebooks/05_ai_in_sql.md`](notebooks/05_ai_in_sql.md) · [`vision_appraisal.md`](vision_appraisal.md) |
| **Genie Agent** | Space definition; live answer that uses the metric view; Genie asked for PII as the Marketing rep, with masks enforced on the result | [`genie.md`](genie.md) |
| **Databricks App** | Buyer 360 running; live calls to `/api/whoami`, `/api/recs/:id` (Lakebase), `/api/genie/as-marketing` | [`app_smoke_test.md`](app_smoke_test.md) · [`genie.md`](genie.md) |

Notebook 00 (synthetic data generation; destructive re-run) and notebook 01 (the pipeline's source) aren't run as notebooks. Their output is the pipeline run history and row counts in `pipeline_runs.md`.
