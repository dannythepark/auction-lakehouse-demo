-- Databricks notebook source
-- MAGIC %md
-- MAGIC # 05 · AI in SQL
-- MAGIC
-- MAGIC AI as ordinary SQL functions: no model to train or host, and they run anywhere SQL runs, including inside the
-- MAGIC pipeline. Each one calls a model behind a governed serving endpoint.
-- MAGIC
-- MAGIC | Function | AuctionCo use |
-- MAGIC |---|---|
-- MAGIC | `ai_classify` | put every lot into a business segment from its title |
-- MAGIC | `ai_extract` | turn a messy seller description into make, model, year, hours, issues |
-- MAGIC | `ai_gen` | draft buyer-facing listing copy |
-- MAGIC | `AI_FORECAST` | forecast GMV |
-- MAGIC
-- MAGIC (Appraising a lot from a **photo** is shown live in the Buyer 360 app's *Lot intake* page.)

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ## 1 · `ai_classify`: segment every lot from its title

-- COMMAND ----------

-- DBTITLE 1,Cell 1 · ai_classify: segment every lot
SELECT item_id, category, title,
       ai_classify(title, ARRAY('Agriculture', 'Construction', 'Transportation', 'Material Handling')) AS segment
FROM demo_catalog.auc_raw.item_basics
ORDER BY item_id
LIMIT 10;


-- COMMAND ----------

-- MAGIC %md
-- MAGIC ## 2 · `ai_extract`: structure a messy seller description

-- COMMAND ----------

-- DBTITLE 1,Cell 2 · ai_extract: structure seller notes
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


-- COMMAND ----------

-- MAGIC %md
-- MAGIC ## 3 · `ai_gen`: draft listing copy

-- COMMAND ----------

-- DBTITLE 1,Cell 3 · ai_gen: draft listing copy
SELECT ai_gen(
  'Write a concise 2-sentence auction listing for this equipment, factual and without hype: ' ||
  '2015 John Deere 8320R tractor, 4200 hours, front duals, recently serviced, minor hydraulic leak.'
) AS listing_copy;


-- COMMAND ----------

-- MAGIC %md
-- MAGIC ## 4 · `AI_FORECAST`: GMV for the next two weeks
-- MAGIC The synthetic bid history is short (a few weeks), so read this as the pattern, not a real forecast.

-- COMMAND ----------

-- DBTITLE 1,Cell 4 · AI_FORECAST: GMV forecast
-- MAGIC %python
-- MAGIC # AI_FORECAST runs on a SQL warehouse, so send it there and display the result here.
-- MAGIC # horizon is the forecast END date: two weeks past the last day of bid history.
-- MAGIC import time
-- MAGIC import pandas as pd
-- MAGIC from databricks.sdk import WorkspaceClient
-- MAGIC w = WorkspaceClient()
-- MAGIC last_day = spark.sql("SELECT MAX(bid_date) FROM demo_catalog.auc_gold.daily_gmv").first()[0]
-- MAGIC horizon = str(last_day + pd.Timedelta(days=14))
-- MAGIC FORECAST_SQL = f"""
-- MAGIC SELECT bid_date, ROUND(gmv_forecast, 0) AS gmv_forecast,
-- MAGIC        ROUND(gmv_lower, 0) AS gmv_lower, ROUND(gmv_upper, 0) AS gmv_upper
-- MAGIC FROM AI_FORECAST(
-- MAGIC   TABLE(SELECT bid_date, SUM(gmv) AS gmv FROM demo_catalog.auc_gold.daily_gmv GROUP BY bid_date),
-- MAGIC   horizon   => '{horizon}',
-- MAGIC   time_col  => 'bid_date',
-- MAGIC   value_col => 'gmv'
-- MAGIC ) ORDER BY bid_date
-- MAGIC """
-- MAGIC r = w.statement_execution.execute_statement(statement=FORECAST_SQL, warehouse_id="<warehouse-id>", wait_timeout="50s")
-- MAGIC while r.status.state.value in ("PENDING", "RUNNING"):
-- MAGIC     time.sleep(5)
-- MAGIC     r = w.statement_execution.get_statement(r.statement_id)
-- MAGIC if r.status.state.value != "SUCCEEDED":
-- MAGIC     raise RuntimeError(r.status.error.message if r.status.error else r.status.state.value)
-- MAGIC print(f"Forecast from {last_day} through {horizon}")
-- MAGIC display(pd.DataFrame(r.result.data_array, columns=[c.name for c in r.manifest.schema.columns]))


-- COMMAND ----------

-- MAGIC %md
-- MAGIC **In a pipeline,** each of these is just another column: every new lot gets a segment, structured attributes and draft
-- MAGIC copy as it lands. Swap the model behind the endpoint and nothing else changes.
