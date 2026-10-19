# Lakeflow Spark Declarative Pipeline: run history and output

Captured 2026-10-19 with the Databricks CLI (`pipelines get`, `pipelines list-updates`) and SQL over the pipeline event log (`event_log('<pipeline-id>')`).

- Pipeline: `auc_demo_elt` · serverless: `True` · current state: `IDLE`
- Source: `notebooks/01_declarative_pipeline_batch_elt.sql`

## Update history (most recent first)

| created | update_id | state | type |
|---|---|---|---|
| 2026-10-08 15:41 UTC | accd081e | COMPLETED | incremental |
| 2026-10-08 15:28 UTC | 865387cf | COMPLETED | incremental |
| 2026-10-08 03:21 UTC | 5f2e7d0d | COMPLETED | full refresh of bid tables (rehearsal reset) |
| 2026-10-08 03:19 UTC | a014fa5e | COMPLETED | incremental |
| 2026-10-08 03:12 UTC | ccc6da13 | COMPLETED | full refresh of bid tables (rehearsal reset) |
| 2026-10-08 03:11 UTC | 760ca222 | COMPLETED | incremental |
| 2026-10-08 03:10 UTC | 17e98e28 | COMPLETED | full refresh of bid tables (rehearsal reset) |
| 2026-10-08 03:09 UTC | 5a66a0fe | FAILED | full refresh of bid tables (rehearsal reset) |
| 2026-10-08 03:04 UTC | 9ea14596 | COMPLETED | incremental |
| 2026-10-07 19:00 UTC | ade5f7a5 | COMPLETED | full refresh of bid tables (rehearsal reset) |
| 2026-10-07 18:23 UTC | 2f9d232d | COMPLETED | incremental |
| 2026-10-07 18:19 UTC | cfa993d5 | COMPLETED | incremental |
| 2026-09-29 19:07 UTC | 45e08f0b | COMPLETED | incremental |
| 2026-09-10 21:32 UTC | 5e9de8db | COMPLETED | incremental |

The single `FAILED` update (5a66a0fe) is the MV → streaming-table change on `fact_bids`. Event-log error, verbatim:

```text
[CANNOT_CHANGE_DATASET_TYPE] Cannot change the dataset type of a pipeline table from MATERIALIZED_VIEW to STREAMING_TABLE for `demo_catalog`.`auc_gold`.`fact_bids`.
To change the dataset type, please drop the existing dataset first.
```

Fixed by dropping the MV and re-running (next update COMPLETED). See README, "Lessons learned".

## Rows written per flow (event log `flow_progress`, rows > 0)

`fact_bids` = 42,000 is the first file wave; **60,015** is after the live drop of wave 2 (18,040 new bids, 25 dropped by `valid_bid`). The 42,000 runs after that are rehearsal resets.

| ts | upd | flow | rows_written | dropped |
|---|---|---|---|---|
| 2026-10-08 15:42 | accd081e | daily_gmv | 158 | 0 |
| 2026-10-08 15:28 | 865387cf | daily_gmv | 144 | 0 |
| 2026-10-08 03:22 | 5f2e7d0d | daily_gmv | 144 | 0 |
| 2026-10-08 03:20 | a014fa5e | daily_gmv | 158 | 0 |
| 2026-10-08 03:12 | ccc6da13 | daily_gmv | 144 | 0 |
| 2026-10-08 03:11 | 760ca222 | daily_gmv | 158 | 0 |
| 2026-10-08 03:10 | 17e98e28 | daily_gmv | 144 | 0 |
| 2026-10-08 03:05 | 9ea14596 | daily_gmv | 144 | 0 |
| 2026-10-08 03:05 | 9ea14596 | fact_bids | 42000 | 0 |
| 2026-10-07 19:01 | ade5f7a5 | daily_gmv | 144 | 0 |
| 2026-10-07 19:01 | ade5f7a5 | fact_bids | 42000 | 0 |
| 2026-10-07 18:23 | 2f9d232d | daily_gmv | 158 | 0 |
| 2026-10-07 18:23 | 2f9d232d | fact_bids | 60015 | 0 |
| 2026-10-07 18:20 | cfa993d5 | daily_gmv | 144 | 0 |
| 2026-10-07 18:20 | cfa993d5 | fact_bids | 42000 | 0 |
| 2026-09-29 19:08 | 45e08f0b | daily_gmv | 144 | 0 |
| 2026-09-29 19:08 | 45e08f0b | fact_bids | 42000 | 0 |
| 2026-09-10 21:33 | 5e9de8db | daily_gmv | 144 | 0 |
| 2026-09-10 21:33 | 5e9de8db | fact_bids | 42000 | 0 |

## Data-quality expectations

From notebook 07 (`notebooks/07_cost_and_observability.md`, "data quality" cell), live-drop update: `valid_bid` passed 18,015 / **dropped 25**; `has_bidder` passed 18,025 / **flagged 15** (kept). Earlier full runs: 42,000 passed, 0 failed.

## Current row counts by layer (live query)

| t | n |
|---|---|
| dim_account (all SCD2 versions) | 4000 |
| bronze_bids | 60040 |
| silver_bids | 60015 |
| fact_bids | 60015 |
| daily_gmv | 158 |
| buyer_recommendations | 20000 |

bronze 60,040 → silver 60,015: the 25 rows removed are exactly the `valid_bid` drops.
