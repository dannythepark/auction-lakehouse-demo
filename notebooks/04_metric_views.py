# Databricks notebook source
# MAGIC %md
# MAGIC # 04 · Metric views
# MAGIC
# MAGIC 1. **Metric view:** GMV, bids, bidders and average bid defined once, so every tool gets the same number
# MAGIC 2. Query it like a table, sliced any way
# MAGIC 3. The definition is plain YAML you own

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1 · The definition: plain YAML

# COMMAND ----------

# DBTITLE 1,Cell 1 · The definition (YAML)
# MAGIC %sql
# MAGIC SHOW CREATE TABLE demo_catalog.auc_gold.metrics_auction


# COMMAND ----------

# MAGIC %md
# MAGIC ## 2 · Query it like a table
# MAGIC Pick the measures and the dimensions; the definition does the rest.

# COMMAND ----------

# DBTITLE 1,Cell 2 · GMV by category
# MAGIC %sql
# MAGIC -- GMV and bidders by equipment category
# MAGIC SELECT `Category`,
# MAGIC        MEASURE(`GMV`)            AS gmv,
# MAGIC        MEASURE(`Total Bids`)     AS bids,
# MAGIC        MEASURE(`Active Bidders`) AS active_bidders,
# MAGIC        MEASURE(`Avg Bid`)        AS avg_bid
# MAGIC FROM demo_catalog.auc_gold.metrics_auction
# MAGIC GROUP BY ALL
# MAGIC ORDER BY gmv DESC


# COMMAND ----------

# DBTITLE 1,Cell 3 · GMV by bidder state
# MAGIC %sql
# MAGIC -- the same measures, sliced by where the bidders are
# MAGIC SELECT `Bidder State`, MEASURE(`GMV`) AS gmv, MEASURE(`Active Bidders`) AS active_bidders
# MAGIC FROM demo_catalog.auc_gold.metrics_auction
# MAGIC GROUP BY ALL
# MAGIC ORDER BY gmv DESC


# COMMAND ----------

# DBTITLE 1,Cell 4 · GMV by day
# MAGIC %sql
# MAGIC -- and by day
# MAGIC SELECT `Bid Date`, MEASURE(`GMV`) AS gmv, MEASURE(`Total Bids`) AS bids
# MAGIC FROM demo_catalog.auc_gold.metrics_auction
# MAGIC GROUP BY ALL
# MAGIC ORDER BY `Bid Date`


# COMMAND ----------

# MAGIC %md
# MAGIC ## 3 · One definition, one number
# MAGIC Hand-written SQL against the fact table gives exactly the same GMV. The difference is that with the metric view,
# MAGIC nobody has to write it, and nobody can write it differently.

# COMMAND ----------

# DBTITLE 1,Cell 5 · Same number as hand-written SQL
# MAGIC %sql
# MAGIC SELECT m.`Category`, m.gmv AS metric_view_gmv, h.gmv AS hand_written_gmv, m.gmv = h.gmv AS same_number
# MAGIC FROM (SELECT `Category`, MEASURE(`GMV`) AS gmv FROM demo_catalog.auc_gold.metrics_auction GROUP BY ALL) m
# MAGIC JOIN (SELECT category AS `Category`, SUM(bid_amount) AS gmv FROM demo_catalog.auc_gold.fact_bids GROUP BY category) h
# MAGIC   USING (`Category`)
# MAGIC ORDER BY metric_view_gmv DESC


# COMMAND ----------

# MAGIC %md
# MAGIC **Where it's used:** the Genie space reads GMV from this metric view, and so can AI/BI dashboards, Tableau/Sigma via SQL,
# MAGIC and the Buyer 360 app. Because it's plain YAML, it versions in git and translates to other semantic layers.
