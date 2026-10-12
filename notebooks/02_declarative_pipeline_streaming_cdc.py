# Databricks notebook source
# MAGIC %md
# MAGIC # 02 · Bringing data in, and watching new data arrive
# MAGIC
# MAGIC 1. How AuctionCo's sources come into Databricks
# MAGIC 2. **Live:** an afternoon auction's worth of new bids lands, with 40 bad rows hidden in it
# MAGIC 3. The pipeline picks up only the new data, and the quality rules catch the bad rows
# MAGIC 4. What continuous mode changes

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1 · AuctionCo's sources → Databricks
# MAGIC
# MAGIC | Your source | Today | On Databricks |
# MAGIC |---|---|---|
# MAGIC | **Auction platform DB (Postgres)**: bids, item_account_bidding, item_basics | batch via your current ETL tools | **Lakeflow Connect** managed connector: streams changes from the Postgres log. Priced per source database, so the six real-time tables cost about the same as one. |
# MAGIC | **Accounting / Marketing (MariaDB)** | batch | **Query-based ingestion** over a foreign connection: scheduled, serverless, fresh within minutes. (No managed CDC connector for MariaDB yet.) |
# MAGIC | inventory, CRM, field and seller apps | batch | the same two patterns, per engine |
# MAGIC | Files (exports, partner drops) | ad hoc | **Auto Loader** on a governed Volume, which is what this demo uses |
# MAGIC
# MAGIC Every path lands in the same pipeline from notebook 01. your current ETL tool's last flow moves to one of these.

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2 · Before: what's in each layer right now

# COMMAND ----------

# DBTITLE 1,Cell 1 · Before: rows in each layer
# MAGIC %sql
# MAGIC SELECT (SELECT COUNT(*) FROM demo_catalog.auc_bronze.bronze_bids) AS bronze_bids,
# MAGIC        (SELECT COUNT(*) FROM demo_catalog.auc_silver.silver_bids) AS silver_bids,
# MAGIC        (SELECT COUNT(*) FROM demo_catalog.auc_gold.fact_bids)     AS gold_fact_bids


# COMMAND ----------

# MAGIC %md
# MAGIC ## 3 · Live: an afternoon auction lands
# MAGIC 18,000 new bids arrive as files, plus **40 bad ones**: 25 with zero or negative amounts, 15 with no bidder.
# MAGIC Run the cell, then click **Start** on the `auc_demo_elt` pipeline.

# COMMAND ----------

# DBTITLE 1,Cell 2 · Live: an afternoon auction lands
CATALOG = "demo_catalog"
LANDING = f"/Volumes/{CATALOG}/auc_raw/landing"

new_files = [f for f in dbutils.fs.ls(f"{LANDING}/_bids_wave2") if f.name.endswith(".json")]
for f in new_files:
    dbutils.fs.cp(f.path, f"{LANDING}/bids/wave2_{f.name}")
print(f"{len(new_files)} new files landed in {LANDING}/bids. Now click Start on the pipeline.")


# COMMAND ----------

# MAGIC %md
# MAGIC ## 4 · After: run this once the pipeline update has completed
# MAGIC Only the new files were processed. 25 bad bids were stopped before silver; 15 were kept and flagged.

# COMMAND ----------

# DBTITLE 1,Cell 3 · After: rows in each layer
# MAGIC %sql
# MAGIC SELECT (SELECT COUNT(*) FROM demo_catalog.auc_bronze.bronze_bids) AS bronze_bids,
# MAGIC        (SELECT COUNT(*) FROM demo_catalog.auc_silver.silver_bids) AS silver_bids,
# MAGIC        (SELECT COUNT(*) FROM demo_catalog.auc_gold.fact_bids)     AS gold_fact_bids


# COMMAND ----------

# DBTITLE 1,Cell 4 · What the quality rules did
# MAGIC %sql
# MAGIC -- what each quality rule did on the latest pipeline run
# MAGIC WITH latest AS (
# MAGIC   SELECT origin.update_id AS update_id
# MAGIC   FROM demo_catalog.auc_gold.event_log_<pipeline_id_with_underscores>
# MAGIC   WHERE event_type = 'create_update'
# MAGIC   ORDER BY `timestamp` DESC LIMIT 1
# MAGIC )
# MAGIC SELECT x.name AS rule, x.passed_records AS passed, x.failed_records AS failed,
# MAGIC        CASE x.name WHEN 'valid_bid' THEN 'dropped before silver' ELSE 'kept and flagged' END AS action
# MAGIC FROM demo_catalog.auc_gold.event_log_<pipeline_id_with_underscores> e
# MAGIC JOIN latest l ON e.origin.update_id = l.update_id
# MAGIC LATERAL VIEW explode(from_json(get_json_object(e.details, '$.flow_progress.data_quality.expectations'),
# MAGIC   'array<struct<name:string,dataset:string,passed_records:bigint,failed_records:bigint>>')) t AS x
# MAGIC WHERE e.event_type = 'flow_progress'
# MAGIC ORDER BY failed DESC


# COMMAND ----------

# MAGIC %md
# MAGIC ## 5 · Continuous mode
# MAGIC The same pipeline, with one setting changed from **Triggered** to **Continuous**:
# MAGIC
# MAGIC | | Triggered (this demo) | Continuous |
# MAGIC |---|---|---|
# MAGIC | When it runs | on a schedule or a click | always on, picks up data as it lands |
# MAGIC | Latency | minutes to hours | seconds to a few minutes: the 1–5 minute target for bids |
# MAGIC | Code changes | none | none |
# MAGIC | Cost | pay per run | compute stays on, so use it only for the tables that need it |
# MAGIC
# MAGIC The quality rules and the account history (SCD2) keep working exactly the same. There's no separate streaming system.
