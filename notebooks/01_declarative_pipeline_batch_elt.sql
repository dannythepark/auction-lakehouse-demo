-- Databricks notebook source
-- MAGIC %md
-- MAGIC # 01 · ELT with Lakeflow Declarative Pipelines — the "instead of dbt" showcase
-- MAGIC
-- MAGIC This notebook is **Lakeflow Declarative Pipeline source**. You attach it to a pipeline;
-- MAGIC you do **not** run it cell-by-cell. It builds the full medallion from the Volume that
-- MAGIC notebook `00` landed, entirely in declarative SQL — the direct analog to AuctionCo's
-- MAGIC dbt `raw` / `base` / `staging` / `prod_gold` layers.
-- MAGIC
-- MAGIC **Why this beats hand-run dbt on a warehouse, for the demo narrative:**
-- MAGIC | dbt today | Lakeflow Declarative Pipeline |
-- MAGIC |---|---|
-- MAGIC | `ref()` DAG you wire | dependency graph inferred automatically |
-- MAGIC | `dbt test` in a separate step | `EXPECT` runs inline, blocks/quarantine on write |
-- MAGIC | scheduled full/incremental `dbt run` | incremental by default (streaming tables + MVs) |
-- MAGIC | orchestration is external | orchestration, retries, lineage built in |
-- MAGIC | SCD2 via snapshot macros | `AUTO CDC ... STORED AS SCD TYPE 2` first-class |
-- MAGIC
-- MAGIC **Pipeline settings to use:** serverless, default catalog `auctionco_demo`.
-- MAGIC (See the README for the exact `databricks pipelines create` JSON.)

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ## Bronze — ingest raw JSON with Auto Loader (incremental, exactly-once)
-- MAGIC `STREAM read_files(...)` is Auto Loader: it tracks which files it has seen, so new files
-- MAGIC landing in the Volume are picked up on the next run without reprocessing old ones.

-- COMMAND ----------

-- DBTITLE 1,Cell 1 · Bronze: raw accounts
CREATE OR REFRESH STREAMING TABLE demo_catalog.auc_bronze.bronze_accounts
  COMMENT "Raw accounts as landed, ingested incrementally via Auto Loader"
AS SELECT *, _metadata.file_path AS _source_file, current_timestamp() AS _ingested_at
FROM STREAM read_files('/Volumes/demo_catalog/auc_raw/landing/accounts', format => 'json');


-- COMMAND ----------

-- DBTITLE 1,Cell 2 · Bronze: raw bids
CREATE OR REFRESH STREAMING TABLE demo_catalog.auc_bronze.bronze_bids
  COMMENT "Raw bids, incremental ingest"
AS SELECT *, current_timestamp() AS _ingested_at
FROM STREAM read_files('/Volumes/demo_catalog/auc_raw/landing/bids', format => 'json');


-- COMMAND ----------

-- DBTITLE 1,Cell 3 · Bronze: raw lots
CREATE OR REFRESH STREAMING TABLE demo_catalog.auc_bronze.bronze_items
  COMMENT "Raw equipment lots"
AS SELECT *, current_timestamp() AS _ingested_at
FROM STREAM read_files('/Volumes/demo_catalog/auc_raw/landing/item_basics', format => 'json');


-- COMMAND ----------

-- MAGIC %md
-- MAGIC ## Silver — clean, type, and enforce data quality with `EXPECT`
-- MAGIC These are the `dbt test` equivalents, but they run inline as the data is written.
-- MAGIC `EXPECT ... ON VIOLATION DROP ROW` quarantines bad rows instead of failing the run.

-- COMMAND ----------

-- DBTITLE 1,Cell 4 · Silver: clean bids + quality rules
CREATE OR REFRESH STREAMING TABLE demo_catalog.auc_silver.silver_bids (
  CONSTRAINT valid_bid   EXPECT (bid_amount > 0) ON VIOLATION DROP ROW,
  CONSTRAINT has_item    EXPECT (item_id IS NOT NULL),
  CONSTRAINT has_bidder  EXPECT (bidder_account_id IS NOT NULL)
)
  COMMENT "Cleaned, typed bids"
AS SELECT
     CAST(bid_id AS BIGINT)             AS bid_id,
     CAST(item_id AS BIGINT)            AS item_id,
     CAST(bidder_account_id AS BIGINT)  AS bidder_account_id,
     CAST(bid_amount AS DECIMAL(12,2))  AS bid_amount,
     CAST(bid_ts AS TIMESTAMP)          AS bid_ts,
     channel
FROM STREAM(demo_catalog.auc_bronze.bronze_bids);


-- COMMAND ----------

-- MAGIC %md
-- MAGIC ## Silver — `dim_account` as SCD Type 2 with `AUTO CDC`
-- MAGIC Accounts change over time (rating, status, contact info). `AUTO CDC ... STORED AS SCD TYPE 2`
-- MAGIC keeps full history with `__START_AT` / `__END_AT`. This is the piece dbt needs snapshot
-- MAGIC macros for; here it is one declarative statement.

-- COMMAND ----------

-- DBTITLE 1,Cell 5 · Silver: account history table
CREATE OR REFRESH STREAMING TABLE demo_catalog.auc_silver.dim_account
  COMMENT "Account dimension, full history (SCD2). PII columns preserved for downstream masking.";


-- COMMAND ----------

-- DBTITLE 1,Cell 6 · Account history (SCD2) in five lines
CREATE FLOW dim_account_cdc AS AUTO CDC INTO demo_catalog.auc_silver.dim_account
FROM STREAM(demo_catalog.auc_bronze.bronze_accounts)
KEYS (account_id)
SEQUENCE BY updated_at
STORED AS SCD TYPE 2;


-- COMMAND ----------

-- MAGIC %md
-- MAGIC ## Gold — STAR model: an incremental fact table + business aggregates as a Materialized View
-- MAGIC The fact table appends new bids as they arrive; the daily aggregate is a materialized view that refreshes incrementally on serverless. The gold aggregates
-- MAGIC keep the dimensions analysts slice by (category, state, date) so nothing is lost.

-- COMMAND ----------

-- DBTITLE 1,Cell 7 · Gold: bid fact table
-- A streaming table: it reads silver as a stream, so each run picks up exactly the new bids,
-- and the pipeline always runs it after silver has finished.
CREATE OR REFRESH STREAMING TABLE demo_catalog.auc_gold.fact_bids
  COMMENT "Bid fact grain = one bid, joined to current item + account context at arrival"
AS SELECT
     b.bid_id, b.bid_amount, b.bid_ts, b.channel,
     b.item_id, i.category, i.state AS item_state, i.reserve_price, i.status AS item_status,
     b.bidder_account_id, a.account_type, a.state AS bidder_state
FROM STREAM(demo_catalog.auc_silver.silver_bids) b
LEFT JOIN demo_catalog.auc_bronze.bronze_items i ON b.item_id = i.item_id
LEFT JOIN demo_catalog.auc_silver.dim_account a
       ON b.bidder_account_id = a.account_id AND a.__END_AT IS NULL;   -- current version only


-- COMMAND ----------

-- DBTITLE 1,Cell 8 · Gold: daily GMV (materialized view)
CREATE OR REFRESH MATERIALIZED VIEW demo_catalog.auc_gold.daily_gmv
  COMMENT "Daily gross merchandise value and bid activity by category"
AS SELECT
     CAST(bid_ts AS DATE)        AS bid_date,
     category,
     COUNT(*)                    AS bids,
     COUNT(DISTINCT bidder_account_id) AS active_bidders,
     ROUND(SUM(bid_amount), 2)   AS gmv,
     ROUND(AVG(bid_amount), 2)   AS avg_bid
FROM demo_catalog.auc_gold.fact_bids
GROUP BY CAST(bid_ts AS DATE), category;


-- COMMAND ----------

-- MAGIC %md
-- MAGIC **Result:** raw JSON → governed gold STAR model with SCD2 and data-quality gates, no dbt,
-- MAGIC no external orchestrator. Open the pipeline graph to show the auto-inferred lineage.
-- MAGIC Next: `02_declarative_pipeline_streaming_cdc` for the real-time path.
