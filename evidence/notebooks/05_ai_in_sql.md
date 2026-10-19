# 05_ai_in_sql: executed notebook with saved output

_Exported from the Databricks workspace (Jupyter format, with results) after running the notebook as a serverless job. Tables below are the real query results, converted from HTML to Markdown._

# 05 · AI in SQL

AI as ordinary SQL functions: no model to train or host, and they run anywhere SQL runs, including inside the
pipeline. Each one calls a model behind a governed serving endpoint.

| Function | AuctionCo use |
|---|---|
| `ai_classify` | put every lot into a business segment from its title |
| `ai_extract` | turn a messy seller description into make, model, year, hours, issues |
| `ai_gen` | draft buyer-facing listing copy |
| `AI_FORECAST` | forecast GMV |

(Appraising a lot from a **photo** is shown live in the Buyer 360 app's *Lot intake* page.)

## 1 · `ai_classify`: segment every lot from its title

### Code cell 1

```sql
SELECT item_id, category, title,
       ai_classify(title, ARRAY('Agriculture', 'Construction', 'Transportation', 'Material Handling')) AS segment
FROM demo_catalog.auc_raw.item_basics
ORDER BY item_id
LIMIT 10;
```

**Output:**

| item_id | category | title | segment |
|---|---|---|---|
| 1 | Skid Steer | Lot 1 — Skid Steer | Construction |
| 2 | Semi Truck | Lot 2 — Semi Truck | Transportation |
| 3 | Excavator | Lot 3 — Excavator | Construction |
| 4 | Excavator | Lot 4 — Excavator | Construction |
| 5 | Skid Steer | Lot 5 — Skid Steer | Construction |
| 6 | Loader | Lot 6 — Loader | Construction |
| 7 | Tractor | Lot 7 — Tractor | Agriculture |
| 8 | Dump Truck | Lot 8 — Dump Truck | Construction |
| 9 | Trailer | Lot 9 — Trailer | Transportation |
| 10 | Dump Truck | Lot 10 — Dump Truck | Construction |

## 2 · `ai_extract`: structure a messy seller description

### Code cell 2

```sql
WITH seller_notes AS (
  SELECT 101 AS item_id, '2015 John Deere 8320R tractor, 4,200 hours, front duals, recent service, minor hydraulic leak' AS description
  UNION ALL
  SELECT 102, 'Komatsu PC210LC-11 excavator 2019, approx 6100 hrs, new undercarriage last spring, thumb included'
  UNION ALL
  SELECT 103, '07 Freightliner Cascadia day cab, Detroit DD15, 812k miles, needs AC work'
)
SELECT item_id, description,
       ai_extract(description, ARRAY('make', 'model', 'year', 'hours_or_miles', 'known_issues')) AS attributes
FROM seller_notes;
```

**Output:**

| item_id | description | attributes |
|---|---|---|
| 101 | 2015 John Deere 8320R tractor, 4,200 hours, front duals, recent service, minor hydraulic leak | List(John Deere, 8320R, 2015, 4,200 hours, minor hydraulic leak) |
| 102 | Komatsu PC210LC-11 excavator 2019, approx 6100 hrs, new undercarriage last spring, thumb included | List(Komatsu, PC210LC-11, 2019, approx 6100 hrs, null) |
| 103 | 07 Freightliner Cascadia day cab, Detroit DD15, 812k miles, needs AC work | List(Freightliner, Cascadia, 07, 812k miles, needs AC work) |

## 3 · `ai_gen`: draft listing copy

### Code cell 3

```sql
SELECT ai_gen(
  'Write a concise 2-sentence auction listing for this equipment, factual and without hype: ' ||
  '2015 John Deere 8320R tractor, 4200 hours, front duals, recently serviced, minor hydraulic leak.'
) AS listing_copy;
```

**Output:**

| listing_copy |
|---|
| For sale is a 2015 John Deere 8320R tractor with 4200 hours, equipped with front duals and recently serviced. The tractor is in operational condition, but does have a minor hydraulic leak that will need to be addressed by the buyer. |

## 4 · `AI_FORECAST`: GMV for the next two weeks
The synthetic bid history is short (a few weeks), so read this as the pattern, not a real forecast.

### Code cell 4

```sql
%python
# AI_FORECAST runs on a SQL warehouse, so send it there and display the result here.
# horizon is the forecast END date: two weeks past the last day of bid history.
import time
import pandas as pd
from databricks.sdk import WorkspaceClient
w = WorkspaceClient()
last_day = spark.sql("SELECT MAX(bid_date) FROM demo_catalog.auc_gold.daily_gmv").first()[0]
horizon = str(last_day + pd.Timedelta(days=14))
FORECAST_SQL = f"""
SELECT bid_date, ROUND(gmv_forecast, 0) AS gmv_forecast,
       ROUND(gmv_lower, 0) AS gmv_lower, ROUND(gmv_upper, 0) AS gmv_upper
FROM AI_FORECAST(
  TABLE(SELECT bid_date, SUM(gmv) AS gmv FROM demo_catalog.auc_gold.daily_gmv GROUP BY bid_date),
  horizon   => '{horizon}',
  time_col  => 'bid_date',
  value_col => 'gmv'
) ORDER BY bid_date
"""
r = w.statement_execution.execute_statement(statement=FORECAST_SQL, warehouse_id="<warehouse-id>", wait_timeout="50s")
while r.status.state.value in ("PENDING", "RUNNING"):
    time.sleep(5)
    r = w.statement_execution.get_statement(r.statement_id)
if r.status.state.value != "SUCCEEDED":
    raise RuntimeError(r.status.error.message if r.status.error else r.status.state.value)
print(f"Forecast from {last_day} through {horizon}")
display(pd.DataFrame(r.result.data_array, columns=[c.name for c in r.manifest.schema.columns]))
```

**Output:**

```text
Forecast from 2026-09-10 through 2026-09-24
```

| bid_date | gmv_forecast | gmv_lower | gmv_upper |
|---|---|---|---|
| 2026-09-11 | 1.22994205E8 | 7.7331176E7 | 1.39002053E8 |
| 2026-09-12 | 1.1824705E8 | 7.2584021E7 | 1.34254898E8 |
| 2026-09-13 | 1.13949915E8 | 6.8286886E7 | 1.29957762E8 |
| 2026-09-14 | 1.13801547E8 | 6.8138518E7 | 1.29809394E8 |
| 2026-09-15 | 1.18376587E8 | 7.2713558E7 | 1.34384434E8 |
| 2026-09-16 | 1.24692853E8 | 7.9029824E7 | 1.40700701E8 |
| 2026-09-17 | 1.28456985E8 | 8.2793956E7 | 1.44464833E8 |
| 2026-09-18 | 1.27297431E8 | 8.1634402E7 | 1.43305279E8 |
| 2026-09-19 | 1.22550276E8 | 7.6887247E7 | 1.38558123E8 |
| 2026-09-20 | 1.18253141E8 | 7.2590112E7 | 1.34260988E8 |
| 2026-09-21 | 1.18104773E8 | 7.2441744E7 | 1.3411262E8 |
| 2026-09-22 | 1.22679813E8 | 7.7016784E7 | 1.3868766E8 |
| 2026-09-23 | 1.28996079E8 | 8.333305E7 | 1.45003927E8 |

**In a pipeline,** each of these is just another column: every new lot gets a segment, structured attributes and draft
copy as it lands. Swap the model behind the endpoint and nothing else changes.
