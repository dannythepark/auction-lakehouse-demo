# 02_declarative_pipeline_streaming_cdc: executed notebook with saved output

_Exported from the Databricks workspace (Jupyter format, with results) after running the notebook as a serverless job. Tables below are the real query results, converted from HTML to Markdown._

# 02 · Bringing data in, and watching new data arrive

1. How AuctionCo's sources come into Databricks
2. **Live:** an afternoon auction's worth of new bids lands, with 40 bad rows hidden in it
3. The pipeline picks up only the new data, and the quality rules catch the bad rows
4. What continuous mode changes

## 1 · AuctionCo's sources → Databricks

| Your source | Today | On Databricks |
|---|---|---|
| **Auction platform DB (Postgres)**: bids, item_account_bidding, item_basics | batch via your current ETL tools | **Lakeflow Connect** managed connector: streams changes from the Postgres log. Priced per source database, so the six real-time tables cost about the same as one. |
| **Accounting / Marketing (MariaDB)** | batch | **Query-based ingestion** over a foreign connection: scheduled, serverless, fresh within minutes. (No managed CDC connector for MariaDB yet.) |
| inventory, CRM, field and seller apps | batch | the same two patterns, per engine |
| Files (exports, partner drops) | ad hoc | **Auto Loader** on a governed Volume, which is what this demo uses |

Every path lands in the same pipeline from notebook 01. Your current ETL tool's last flow moves to one of these.

## 2 · Before: what's in each layer right now

### Code cell 1

```sql
%sql
SELECT (SELECT COUNT(*) FROM demo_catalog.auc_bronze.bronze_bids) AS bronze_bids,
       (SELECT COUNT(*) FROM demo_catalog.auc_silver.silver_bids) AS silver_bids,
       (SELECT COUNT(*) FROM demo_catalog.auc_gold.fact_bids)     AS gold_fact_bids
```

**Output:**

| bronze_bids | silver_bids | gold_fact_bids |
|---|---|---|
| 60040 | 60015 | 60015 |

## 3 · Live: an afternoon auction lands
18,000 new bids arrive as files, plus **40 bad ones**: 25 with zero or negative amounts, 15 with no bidder.
Run the cell, then click **Start** on the `auc_demo_elt` pipeline.

### Code cell 2

```python
CATALOG = "demo_catalog"
LANDING = f"/Volumes/{CATALOG}/auc_raw/landing"

new_files = [f for f in dbutils.fs.ls(f"{LANDING}/_bids_wave2") if f.name.endswith(".json")]
for f in new_files:
    dbutils.fs.cp(f.path, f"{LANDING}/bids/wave2_{f.name}")
print(f"{len(new_files)} new files landed in {LANDING}/bids. Now click Start on the pipeline.")
```

**Output:**

```text
3 new files landed in /Volumes/demo_catalog/auc_raw/landing/bids. Now click Start on the pipeline.
```

## 4 · After: run this once the pipeline update has completed
Only the new files were processed. 25 bad bids were stopped before silver; 15 were kept and flagged.

### Code cell 3

```sql
%sql
SELECT (SELECT COUNT(*) FROM demo_catalog.auc_bronze.bronze_bids) AS bronze_bids,
       (SELECT COUNT(*) FROM demo_catalog.auc_silver.silver_bids) AS silver_bids,
       (SELECT COUNT(*) FROM demo_catalog.auc_gold.fact_bids)     AS gold_fact_bids
```

**Output:**

| bronze_bids | silver_bids | gold_fact_bids |
|---|---|---|
| 60040 | 42000 | 42000 |

### Code cell 4

```sql
%sql
-- what each quality rule did on the latest pipeline run
WITH latest AS (
  SELECT origin.update_id AS update_id
  FROM demo_catalog.auc_gold.event_log_<pipeline_id_with_underscores>
  WHERE event_type = 'create_update'
  ORDER BY `timestamp` DESC LIMIT 1
)
SELECT x.name AS rule, x.passed_records AS passed, x.failed_records AS failed,
       CASE x.name WHEN 'valid_bid' THEN 'dropped before silver' ELSE 'kept and flagged' END AS action
FROM demo_catalog.auc_gold.event_log_<pipeline_id_with_underscores> e
JOIN latest l ON e.origin.update_id = l.update_id
LATERAL VIEW explode(from_json(get_json_object(e.details, '$.flow_progress.data_quality.expectations'),
  'array<struct<name:string,dataset:string,passed_records:bigint,failed_records:bigint>>')) t AS x
WHERE e.event_type = 'flow_progress'
ORDER BY failed DESC
```

_(no output)_

## 5 · Continuous mode
The same pipeline, with one setting changed from **Triggered** to **Continuous**:

| | Triggered (this demo) | Continuous |
|---|---|---|
| When it runs | on a schedule or a click | always on, picks up data as it lands |
| Latency | minutes to hours | seconds to a few minutes: the 1–5 minute target for bids |
| Code changes | none | none |
| Cost | pay per run | compute stays on, so use it only for the tables that need it |

The quality rules and the account history (SCD2) keep working exactly the same. There's no separate streaming system.
