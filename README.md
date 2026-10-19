# Auction lakehouse demo on Databricks

An end-to-end Databricks demo on synthetic heavy-equipment auction data: raw files to governed gold without dbt, PII masked per person, metric views and Genie for business questions, AI in SQL, Lakebase serving, and a Databricks App that brings it all together for a sales rep.

Built for a customer conversation and published as a reusable template. "AuctionCo" is a fictional company; all data is synthetic.

### Placeholders to fill in
Search the repo for these and replace them with your own workspace's values:

| Placeholder | What it is |
|---|---|
| `demo_catalog` | Unity Catalog catalog (schemas `auc_raw / auc_bronze / auc_silver / auc_gold / auc_gov`) |
| `<workspace-host>` | your workspace URL host |
| `<profile>` | your Databricks CLI profile |
| `<warehouse-id>` | SQL warehouse ID |
| `<pipeline-id>` / `<pipeline_id_with_underscores>` | the SDP pipeline ID (the event-log table name uses the underscored form) |
| `<genie-space-id>` | Genie space ID |
| `<app-service-principal-id>` | the Buyer 360 app's service principal (the "Marketing rep" persona) |
| `<data-team-sp-id>` / `<business-sp-id>` | two service principals for the three-tier masking proof |
| `<lakebase-project-uid>` | Lakebase project UID (for cost attribution) |
| `<your-email>` | your user, for the data-team allowlist and cost filters |

## For reviewers: where each stage lives

| Stage | Code | Proof it ran (text) |
|---|---|---|
| **Lakeflow** ingest + transform | [`notebooks/01_declarative_pipeline_batch_elt.sql`](notebooks/01_declarative_pipeline_batch_elt.sql): Auto Loader (`STREAM read_files`), `EXPECT` rules, `AUTO CDC ... STORED AS SCD TYPE 2`, gold streaming table + materialized view. Declared as a pipeline in [`resources/auction_elt.pipeline.yml`](resources/auction_elt.pipeline.yml) | [`evidence/pipeline_runs.md`](evidence/pipeline_runs.md) · [`evidence/notebooks/02_declarative_pipeline_streaming_cdc.md`](evidence/notebooks/02_declarative_pipeline_streaming_cdc.md) |
| **Unity Catalog** governance | [`notebooks/03_pii_tagging_and_masking.sql`](notebooks/03_pii_tagging_and_masking.sql), [`sql/pii_plaintext_alert.sql`](sql/pii_plaintext_alert.sql), [`notebooks/04_metric_views.py`](notebooks/04_metric_views.py) | [`evidence/notebooks/03_pii_tagging_and_masking.md`](evidence/notebooks/03_pii_tagging_and_masking.md) · [`evidence/pii_plaintext_alert.md`](evidence/pii_plaintext_alert.md) · [`evidence/notebooks/04_metric_views.md`](evidence/notebooks/04_metric_views.md) |
| **Lakebase** serving | [`notebooks/06_lakebase_serving_recommendations.py`](notebooks/06_lakebase_serving_recommendations.py), [`app/server/routes/buyer-routes.ts`](app/server/routes/buyer-routes.ts) | [`evidence/notebooks/06_lakebase_serving_recommendations.md`](evidence/notebooks/06_lakebase_serving_recommendations.md) · [`evidence/app_smoke_test.md`](evidence/app_smoke_test.md) |
| **ML** (trained, registered) | [`notebooks/08_bid_affinity_model.py`](notebooks/08_bid_affinity_model.py): MLflow tracking, UC model registry, `champion` alias | [`evidence/notebooks/08_bid_affinity_model.md`](evidence/notebooks/08_bid_affinity_model.md) |
| **GenAI** | [`notebooks/05_ai_in_sql.sql`](notebooks/05_ai_in_sql.sql), [`app/server/routes/appraise-routes.ts`](app/server/routes/appraise-routes.ts) | [`evidence/notebooks/05_ai_in_sql.md`](evidence/notebooks/05_ai_in_sql.md) · [`evidence/vision_appraisal.md`](evidence/vision_appraisal.md) |
| **Genie Agent** | space definition in [`evidence/genie.md`](evidence/genie.md), [`app/server/routes/genie-persona-routes.ts`](app/server/routes/genie-persona-routes.ts) | [`evidence/genie.md`](evidence/genie.md) (live answers, incl. masked PII as the Marketing rep) |
| **Databricks App** | [`app/`](app/) (AppKit), [`app/databricks.yml`](app/databricks.yml) | [`evidence/app_smoke_test.md`](evidence/app_smoke_test.md) |
| Cost + observability | [`notebooks/07_cost_and_observability.sql`](notebooks/07_cost_and_observability.sql), [`sql/v_demo_cost.sql`](sql/v_demo_cost.sql) | [`evidence/notebooks/07_cost_and_observability.md`](evidence/notebooks/07_cost_and_observability.md) |

Deploy the data side with the bundle at the root (`databricks bundle deploy -p <profile>`): the pipeline plus jobs that run notebooks 00 and 02–08.

**Execution evidence:** see [`evidence/`](evidence/README.md) for every notebook's saved output, the pipeline run history, live Genie answers, model output and app API calls, committed as text.

## What's in the demo

| # | Asset | What it shows |
|---|---|---|
| 00 | `notebooks/00_setup_and_synthetic_data.py` | Synthetic accounts (20 cols, 5 PII), lots and bids; JSON landed to a UC Volume in two waves |
| 01 | `notebooks/01_declarative_pipeline_batch_elt.sql` | **Lakeflow Spark Declarative Pipeline**: bronze (Auto Loader) → silver (quality rules) → SCD2 account history (`AUTO CDC`) → gold fact (streaming table) + daily GMV (materialized view) |
| 02 | `notebooks/02_declarative_pipeline_streaming_cdc.py` | Source → Databricks patterns, then a **live drop**: new files land, one pipeline run takes gold from 42,000 to 60,015 rows, and quality rules drop 25 / flag 15 bad bids. Continuous mode explained. |
| 03 | `notebooks/03_pii_tagging_and_masking.sql` | Tag 5 PII columns → three tiers → two mask functions → attach to the table → **the same query run as three real identities** (full / last 4 / encrypted), with a side-by-side tag, mask and value table |
| 04 | `notebooks/04_metric_views.py` | Metric view YAML, `MEASURE()` slices, and proof it matches hand-written SQL |
| 05 | `notebooks/05_ai_in_sql.sql` | `ai_classify`, `ai_extract`, `ai_gen`, `AI_FORECAST` |
| 06 | `notebooks/06_lakebase_serving_recommendations.py` | Recommendations served from **Lakebase Postgres**: index-scan plan, p50/p95 over 500 lookups vs the SQL warehouse, refresh from gold, write-back, access |
| 07 | `notebooks/07_cost_and_observability.sql` | Cost by tag / resource ID, data-quality results, lineage, PII-access audit, LLM usage, all from system tables |
| 08 | `notebooks/08_bid_affinity_model.py` | **Trained bid-affinity model**: time-split features, gradient boosting tracked in MLflow, evaluated against the bid-count rule, registered in Unity Catalog (`champion` alias), scores written to gold |
| — | `sql/pii_plaintext_alert.sql` | Approved roster + violations view + Databricks SQL alert: fires when anyone outside the roster can see or has read buyer PII in plaintext |
| — | `databricks.yml`, `resources/` | Bundle: the Lakeflow pipeline and the jobs that run the notebooks |
| — | `sql/v_demo_cost.sql` | The cost-attribution view behind the app's Cost page |
| — | `app/` | **Buyer 360**, a Databricks App (AppKit, TypeScript/React) |

Every code cell is titled `Cell N · …` so a talk track can point at exact cells.

### The Buyer 360 app

- **Buyers:** governed buyer profile, bid behavior, Lakebase recommendations (with measured latency), AI-drafted outreach that only receives governed fields
- **View as → Marketing rep:** the app switches to its own service principal, a real second identity in a partial PII tier, so phone and tax ID come back as the last 4 digits. It shows governance with one human login.
- **Lot intake:** upload a photo and a vision model returns make, model, condition and a value range, next to the category's real auction comps and the buyers to notify (masked per persona)
- **Ask Genie:** the Genie space, as you or as the Marketing rep
- **Cost** and **Observability** pages over system tables

All warehouse queries are `.obo.sql` (run as the signed-in user); the Marketing-rep variants are plain `.sql` (run as the app's service principal).

## Architecture

```
 landing Volume (JSON) ─▶ bronze ─▶ silver (EXPECT rules) ─▶ dim_account (SCD2)
                                         │                        │
                                         ▼                        ▼
                                  gold.fact_bids (ST) ─▶ gold.daily_gmv (MV) ─▶ metrics_auction (metric view)
                                         │                                              │
           auc_gov masks (enc_pii, mask_last4) on dim_account ─▶ v_account_360 ─────────┤
                                         │                                              ▼
                       gold.buyer_recommendations ─▶ Lakebase Postgres            Genie space
                                         │                    │                         │
                                         └──────────▶  Buyer 360 Databricks App  ◀──────┘
```

## Setting it up in a new workspace

**Prerequisites:** a workspace with serverless compute, a SQL warehouse, a foundation-model serving endpoint with vision (the app uses `databricks-claude-sonnet-5`), a Lakebase Autoscaling project, and the Databricks CLI (v1.x).

1. **Pick names.** The code uses catalog `demo_catalog` and schemas `auc_raw / auc_bronze / auc_silver / auc_gold / auc_gov`. Find-and-replace these, plus the warehouse ID, pipeline ID, Genie space ID and service-principal IDs, for your workspace. See *Placeholders to fill in* above.
2. **Data:** import and run notebook **00**. Upload a few equipment photos to the `auc_raw.equipment_photos` volume, and copy them into `app/client/public/samples/` for the app.
3. **Pipeline:** create a serverless pipeline with notebook **01** as its source, default catalog/schema set, then run it.
4. **Governance:** create the key secret scope (`auc_pii_demo`, key `cmk`, 32 bytes) and the two tier tables, then run notebook **03**. Every identity that reads a masked column needs READ on that scope.
5. **Semantic layer:** create the metric view (YAML in notebook 04's first cell) and a Genie space over the gold view, fact table and metric view.
6. **Serving:** create the Lakebase project and load `buyer_recommendations` (notebook **06**).
7. **Cost view:** run `sql/v_demo_cost.sql`, after updating the resource IDs in it.
8. **App:**
   ```bash
   cd app
   cp .env.example .env    # fill in your values, local dev only
   npm install             # package-lock.json isn't committed; npm resolves from package.json
   npm run typegen         # needs a running warehouse
   databricks apps deploy --profile <profile>
   ```
   Then give the app's service principal SELECT on the tables it reads, SELECT on the Lakebase table, CAN_RUN on the Genie space, READ on the key scope, and add it to the partial-PII tier table.
9. **Saved results:** run each notebook as a job, export the run as HTML, and import it over the notebook, so every cell shows output during the demo.

## Reset after a rehearsal

The live drop copies files from `landing/_bids_wave2` into `landing/bids/`. To reset, delete the `wave2_*` files there and full-refresh only the bid tables (never the masked account table). For example:
```bash
databricks pipelines start-update <pipeline-id> -p <profile> --json '{"full_refresh_selection":["demo_catalog.auc_bronze.bronze_bids","demo_catalog.auc_silver.silver_bids","demo_catalog.auc_gold.fact_bids","demo_catalog.auc_gold.daily_gmv"]}'
```

## Lessons learned (save yourself the time)

- **Masks + `secret()`:** the key is looked up when the query is planned, so every identity reading a masked column needs READ on the scope, even tiers that never decrypt.
- **Demo workspaces rarely have account groups.** Use allowlist tables for tiers and say so; production uses `is_account_group_member()`.
- **SDP ordering:** a gold *materialized view* over a silver table with expectations could refresh before silver finished. A gold *streaming table* over `STREAM(silver)` is always ordered correctly.
- **Changing a dataset's type** (MV → streaming table) requires dropping it first.
- **AppKit:**
  - The warehouse returns numbers as strings, so convert them at the boundary.
  - Typegen at build time runs as the app's service principal; `app/scripts/typegen.mjs` skips it in the deployed build and uses the committed types.
  - Raise `server({ bodyLimit })` for image uploads.
  - The Genie plugin's routes run as the user; its programmatic `sendMessage()` runs as the app's service principal.
- **Serverless notebooks:**
  - The SDK can be old, so use `w.api_client.do(...)` for newer APIs.
  - `AI_FORECAST` runs on a SQL warehouse.
  - No `%pip` in SQL notebooks.
- **Shared metastores** may have tag policies on common keys like `pii`. Use a prefixed key.
- **Apps bill hourly while running.** Stop them between rehearsals.
