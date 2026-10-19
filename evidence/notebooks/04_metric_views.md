# 04_metric_views: executed notebook with saved output

_Exported from the Databricks workspace (Jupyter format, with results) after running the notebook as a serverless job. Tables below are the real query results, converted from HTML to Markdown._

# 04 · Metric views

1. **Metric view:** GMV, bids, bidders and average bid defined once, so every tool gets the same number
2. Query it like a table, sliced any way
3. The definition is plain YAML you own

## 1 · The definition: plain YAML

### Code cell 1

```sql
%sql
SHOW CREATE TABLE demo_catalog.auc_gold.metrics_auction
```

**Output:**

| createtab_stmt |
|---|
| CREATE VIEW demo_catalog.auc_gold.metrics_auction (<br>  Category,<br>  Bidder State,<br>  Bid Date,<br>  GMV,<br>  Total Bids,<br>  Active Bidders,<br>  Avg Bid)<br>COMMENT 'Certified auction metrics for Genie and BI'<br>WITH METRICS<br>LANGUAGE YAML<br>AS<br>$$<br>version: 1.1<br><br>source: demo_catalog.auc_gold.fact_bids<br><br>comment: Certified auction metrics for Genie and BI<br><br>dimensions:<br>  - name: Category<br>    expr: category<br><br>  - name: Bidder State<br>    expr: bidder_state<br><br>  - name: Bid Date<br>    expr: CAST(bid_ts AS DATE)<br><br>measures:<br>  - name: GMV<br>    expr: SUM(bid_amount)<br><br>  - name: Total Bids<br>    expr: COUNT(1)<br><br>  - name: Active Bidders<br>    expr: COUNT(DISTINCT bidder_account_id)<br><br>  - name: Avg Bid<br>    expr: AVG(bid_amount)<br>$$ |

## 2 · Query it like a table
Pick the measures and the dimensions; the definition does the rest.

### Code cell 2

```sql
%sql
-- GMV and bidders by equipment category
SELECT `Category`,
       MEASURE(`GMV`)            AS gmv,
       MEASURE(`Total Bids`)     AS bids,
       MEASURE(`Active Bidders`) AS active_bidders,
       MEASURE(`Avg Bid`)        AS avg_bid
FROM demo_catalog.auc_gold.metrics_auction
GROUP BY ALL
ORDER BY gmv DESC
```

**Output:**

| Category | gmv | bids | active_bidders | avg_bid |
|---|---|---|---|---|
| Skid Steer | 265397965.28 | 5539 | 2997 | 47914.418718 |
| Excavator | 261565826.80 | 5453 | 2996 | 47967.325656 |
| Semi Truck | 257907454.80 | 5305 | 2966 | 48615.919849 |
| Loader | 257799362.54 | 5345 | 2930 | 48231.873254 |
| Trailer | 249300840.05 | 5217 | 2937 | 47786.244978 |
| Dump Truck | 245817244.89 | 5131 | 2897 | 47908.252756 |
| Combine | 245609907.97 | 5044 | 2873 | 48693.478979 |
| Tractor | 240960708.71 | 4966 | 2827 | 48522.091967 |

### Code cell 3

```sql
%sql
-- the same measures, sliced by where the bidders are
SELECT `Bidder State`, MEASURE(`GMV`) AS gmv, MEASURE(`Active Bidders`) AS active_bidders
FROM demo_catalog.auc_gold.metrics_auction
GROUP BY ALL
ORDER BY gmv DESC
```

**Output:**

| Bidder State | gmv | active_bidders |
|---|---|---|
| OK | 226043990.76 | 442 |
| MO | 217205535.67 | 423 |
| CO | 215478081.30 | 427 |
| KS | 204997805.96 | 398 |
| IA | 203698240.52 | 413 |
| AR | 202948297.03 | 408 |
| TX | 191011692.97 | 365 |
| NE | 188960111.55 | 378 |
| MN | 188871745.14 | 377 |
| IL | 185143810.14 | 369 |

### Code cell 4

```sql
%sql
-- and by day
SELECT `Bid Date`, MEASURE(`GMV`) AS gmv, MEASURE(`Total Bids`) AS bids
FROM demo_catalog.auc_gold.metrics_auction
GROUP BY ALL
ORDER BY `Bid Date`
```

**Output:**

| Bid Date | gmv | bids |
|---|---|---|
| 2026-08-24 | 55228840.15 | 1119 |
| 2026-08-25 | 121474756.83 | 2497 |
| 2026-08-26 | 116739574.80 | 2435 |
| 2026-08-27 | 116730526.63 | 2431 |
| 2026-08-28 | 117484399.16 | 2425 |
| 2026-08-29 | 118158623.74 | 2412 |
| 2026-08-30 | 110313908.64 | 2284 |
| 2026-08-31 | 111382135.90 | 2364 |
| 2026-09-01 | 120824905.38 | 2464 |
| 2026-09-02 | 118400745.59 | 2442 |
| 2026-09-03 | 123130266.77 | 2596 |
| 2026-09-04 | 116391967.88 | 2399 |
| 2026-09-05 | 117833490.53 | 2423 |
| 2026-09-06 | 112191219.09 | 2379 |
| 2026-09-07 | 113821608.12 | 2363 |
| 2026-09-08 | 116117961.64 | 2383 |
| 2026-09-09 | 116750799.85 | 2433 |
| 2026-09-10 | 101383580.34 | 2151 |

## 3 · One definition, one number
Hand-written SQL against the fact table gives exactly the same GMV. The difference is that with the metric view,
nobody has to write it, and nobody can write it differently.

### Code cell 5

```sql
%sql
SELECT m.`Category`, m.gmv AS metric_view_gmv, h.gmv AS hand_written_gmv, m.gmv = h.gmv AS same_number
FROM (SELECT `Category`, MEASURE(`GMV`) AS gmv FROM demo_catalog.auc_gold.metrics_auction GROUP BY ALL) m
JOIN (SELECT category AS `Category`, SUM(bid_amount) AS gmv FROM demo_catalog.auc_gold.fact_bids GROUP BY category) h
  USING (`Category`)
ORDER BY metric_view_gmv DESC
```

**Output:**

| Category | metric_view_gmv | hand_written_gmv | same_number |
|---|---|---|---|
| Skid Steer | 265397965.28 | 265397965.28 | true |
| Excavator | 261565826.80 | 261565826.80 | true |
| Semi Truck | 257907454.80 | 257907454.80 | true |
| Loader | 257799362.54 | 257799362.54 | true |
| Trailer | 249300840.05 | 249300840.05 | true |
| Dump Truck | 245817244.89 | 245817244.89 | true |
| Combine | 245609907.97 | 245609907.97 | true |
| Tractor | 240960708.71 | 240960708.71 | true |

**Where it's used:** the Genie space reads GMV from this metric view, and so can AI/BI dashboards, Tableau/Sigma via SQL,
and the Buyer 360 app. Because it's plain YAML, it versions in git and translates to other semantic layers.
