# Databricks notebook source
# MAGIC %md
# MAGIC # 08 · Bid-affinity model: trained, tracked, registered
# MAGIC
# MAGIC The Lakebase recommendations (notebook 06) rank lots by a simple rule: the categories a buyer has bid on most.
# MAGIC This notebook replaces that rule with a **trained model**, tracked in MLflow and registered in Unity Catalog,
# MAGIC so the recommendation signal is versioned, governed and measurable.
# MAGIC
# MAGIC | Step | What happens |
# MAGIC |---|---|
# MAGIC | 1 | Time split: features from bids **before** a cutoff, label = did the buyer bid in that category **after** it |
# MAGIC | 2 | Features per buyer × category |
# MAGIC | 3 | Train a gradient-boosted classifier; log params, metrics and the model to MLflow |
# MAGIC | 4 | Compare with the rule it replaces (most-bid category) on the held-out period |
# MAGIC | 5 | Register the model in Unity Catalog and score every buyer × category into gold |

# COMMAND ----------

# MAGIC %pip install -q mlflow>=2.16 scikit-learn
# MAGIC %restart_python

# COMMAND ----------

# DBTITLE 1,Cell 1 · Time split
CATALOG, GOLD = "demo_catalog", "auc_gold"
MODEL_NAME = f"{CATALOG}.{GOLD}.bid_affinity_model"

cutoff = spark.sql(f"""
  SELECT timestampadd(SECOND, CAST(percentile_approx(unix_timestamp(bid_ts), 0.7) - unix_timestamp(min(bid_ts)) AS INT), min(bid_ts)) AS cutoff,
         min(bid_ts) AS first_bid, max(bid_ts) AS last_bid, count(*) AS bids
  FROM {CATALOG}.{GOLD}.fact_bids
""").first()
print(f"bids: {cutoff.bids:,} | first: {cutoff.first_bid} | cutoff (70th pct): {cutoff.cutoff} | last: {cutoff.last_bid}")
CUTOFF = cutoff.cutoff

# COMMAND ----------

# DBTITLE 1,Cell 2 · Features per buyer × category
features = spark.sql(f"""
WITH hist AS (SELECT * FROM {CATALOG}.{GOLD}.fact_bids WHERE bid_ts <  '{CUTOFF}'),
     fut  AS (SELECT DISTINCT bidder_account_id, category FROM {CATALOG}.{GOLD}.fact_bids WHERE bid_ts >= '{CUTOFF}'),
     buyers AS (SELECT DISTINCT bidder_account_id FROM hist),
     cats   AS (SELECT DISTINCT category FROM {CATALOG}.{GOLD}.fact_bids),
     per_buyer AS (SELECT bidder_account_id, count(*) AS buyer_bids, count(DISTINCT category) AS buyer_categories,
                          avg(bid_amount) AS buyer_avg_bid FROM hist GROUP BY 1),
     per_bc AS (SELECT bidder_account_id, category, count(*) AS cat_bids, count(DISTINCT item_id) AS cat_lots,
                       avg(bid_amount) AS cat_avg_bid, max(bid_amount) AS cat_max_bid,
                       datediff('{CUTOFF}', max(bid_ts)) AS days_since_cat_bid
                FROM hist GROUP BY 1, 2),
     cat_pop AS (SELECT category, count(*) / (SELECT count(*) FROM hist) AS cat_share FROM hist GROUP BY 1)
SELECT b.bidder_account_id, c.category,
       coalesce(bc.cat_bids, 0)                          AS cat_bids,
       coalesce(bc.cat_lots, 0)                          AS cat_lots,
       coalesce(bc.cat_bids, 0) / pb.buyer_bids          AS cat_bid_share,
       coalesce(bc.cat_avg_bid, 0)                       AS cat_avg_bid,
       coalesce(bc.cat_max_bid, 0)                       AS cat_max_bid,
       coalesce(bc.days_since_cat_bid, 999)              AS days_since_cat_bid,
       pb.buyer_bids, pb.buyer_categories, pb.buyer_avg_bid, cp.cat_share,
       CASE WHEN f.bidder_account_id IS NOT NULL THEN 1 ELSE 0 END AS label
FROM buyers b CROSS JOIN cats c
JOIN per_buyer pb USING (bidder_account_id)
LEFT JOIN per_bc bc ON bc.bidder_account_id = b.bidder_account_id AND bc.category = c.category
LEFT JOIN cat_pop cp ON cp.category = c.category
LEFT JOIN fut f ON f.bidder_account_id = b.bidder_account_id AND f.category = c.category
""").toPandas()
FEATURES = ["cat_bids", "cat_lots", "cat_bid_share", "cat_avg_bid", "cat_max_bid", "days_since_cat_bid",
            "buyer_bids", "buyer_categories", "buyer_avg_bid", "cat_share"]
features[FEATURES] = features[FEATURES].astype(float)
print(f"rows (buyer × category): {len(features):,} | buyers: {features.bidder_account_id.nunique():,} | positive rate: {features.label.mean():.3f}")
display(spark.createDataFrame(features.head(8)))

# COMMAND ----------

# DBTITLE 1,Cell 3 · Train and track in MLflow
import mlflow, numpy as np
from mlflow.models import infer_signature
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import roc_auc_score, average_precision_score
from sklearn.model_selection import GroupShuffleSplit

mlflow.set_registry_uri("databricks-uc")
mlflow.set_experiment(f"/Users/{spark.sql('SELECT current_user()').first()[0]}/auction_bid_affinity")

tr_idx, te_idx = next(GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=7)
                      .split(features, groups=features.bidder_account_id))
train, test = features.iloc[tr_idx], features.iloc[te_idx]
params = {"max_iter": 200, "learning_rate": 0.05, "max_leaf_nodes": 31, "random_state": 7}

with mlflow.start_run(run_name="hgb_bid_affinity") as run:
    model = HistGradientBoostingClassifier(**params).fit(train[FEATURES], train.label)
    p = model.predict_proba(test[FEATURES])[:, 1]
    baseline = test.cat_bid_share.values            # the rule notebook 06 uses: share of the buyer's bids in this category
    metrics = {"auc_model": roc_auc_score(test.label, p), "auc_rule": roc_auc_score(test.label, baseline),
               "ap_model": average_precision_score(test.label, p), "ap_rule": average_precision_score(test.label, baseline)}
    mlflow.log_params({**params, "cutoff": str(CUTOFF), "features": ",".join(FEATURES)})
    mlflow.log_metrics(metrics)
    info = mlflow.sklearn.log_model(model, artifact_path="model", registered_model_name=MODEL_NAME,
                                    signature=infer_signature(train[FEATURES], p[:5]),
                                    input_example=train[FEATURES].head(3))
print("run_id:", run.info.run_id)
for k, v in metrics.items(): print(f"{k}: {v:.4f}")

# COMMAND ----------

# DBTITLE 1,Cell 4 · Model vs the rule: hit rate on the held-out period
import pandas as pd
t = test.assign(score_model=p, score_rule=baseline)
def hit_at_1(col):
    top = t.sort_values(col, ascending=False).groupby("bidder_account_id").head(1)
    return top.label.mean()
cmp = pd.DataFrame([
    {"ranker": "rule: most-bid category", "auc": metrics["auc_rule"], "avg_precision": metrics["ap_rule"], "top_category_hit_rate": hit_at_1("score_rule")},
    {"ranker": "trained model", "auc": metrics["auc_model"], "avg_precision": metrics["ap_model"], "top_category_hit_rate": hit_at_1("score_model")},
]).round(4)
display(spark.createDataFrame(cmp))

# COMMAND ----------

# DBTITLE 1,Cell 5 · Registered in Unity Catalog
from mlflow import MlflowClient
c = MlflowClient(registry_uri="databricks-uc")
v = max(c.search_model_versions(f"name='{MODEL_NAME}'"), key=lambda m: int(m.version))
c.set_registered_model_alias(MODEL_NAME, "champion", v.version)
display(spark.createDataFrame([{"model": MODEL_NAME, "version": int(v.version), "alias": "champion",
                                "status": v.status, "run_id": v.run_id}]))

# COMMAND ----------

# DBTITLE 1,Cell 6 · Score every buyer × category into gold (loaded by alias)
champion = mlflow.sklearn.load_model(f"models:/{MODEL_NAME}@champion")
scored = features[["bidder_account_id", "category"]].assign(
    affinity_score=champion.predict_proba(features[FEATURES])[:, 1], model_version=int(v.version))
(spark.createDataFrame(scored).withColumnRenamed("bidder_account_id", "account_id")
     .write.mode("overwrite").option("overwriteSchema", "true")
     .saveAsTable(f"{CATALOG}.{GOLD}.buyer_category_affinity"))
display(spark.sql(f"""
  SELECT account_id, category, round(affinity_score, 3) AS affinity_score, model_version,
         rank() OVER (PARTITION BY account_id ORDER BY affinity_score DESC) AS category_rank
  FROM {CATALOG}.{GOLD}.buyer_category_affinity WHERE account_id = 1248 ORDER BY category_rank"""))

# COMMAND ----------

# MAGIC %md
# MAGIC **What this changes.** The recommendation signal is now a versioned model in Unity Catalog with the
# MAGIC `champion` alias, governed and auditable like any table. `buyer_category_affinity` is the drop-in replacement for the bid-count rule
# MAGIC as the ranking input to `buyer_recommendations` (notebook 06, synced to Lakebase), once it beats the rule. Promoting a version is
# MAGIC an alias move; rollback is the same.
# MAGIC
# MAGIC **What the evaluation found.** The synthetic generator (notebook 00) assigns bids to categories without buyer
# MAGIC preferences, so on this data neither the rule nor the model beats chance (AUC ≈ 0.50; top-category hit rate 0.44
# MAGIC vs 0.46). The useful result is that the bid-count rule currently being served has no measured lift either. This
# MAGIC time-split evaluation against the incumbent rule is what would catch that on real bid history, before a
# MAGIC recommendation change reaches reps. Gate promotion of the `champion` alias on beating the rule.
