# 08_bid_affinity_model: executed notebook with saved output

_Exported from the Databricks workspace (Jupyter format, with results) after running the notebook as a serverless job. Tables below are the real query results, converted from HTML to Markdown._

# 08 · Bid-affinity model: trained, tracked, registered

The Lakebase recommendations (notebook 06) rank lots by a simple rule: the categories a buyer has bid on most.
This notebook replaces that rule with a **trained model**, tracked in MLflow and registered in Unity Catalog,
so the recommendation signal is versioned, governed and measurable.

| Step | What happens |
|---|---|
| 1 | Time split: features from bids **before** a cutoff, label = did the buyer bid in that category **after** it |
| 2 | Features per buyer × category |
| 3 | Train a gradient-boosted classifier; log params, metrics and the model to MLflow |
| 4 | Compare with the rule it replaces (most-bid category) on the held-out period |
| 5 | Register the model in Unity Catalog and score every buyer × category into gold |

### Code cell 1

```python
%pip install -q mlflow>=2.16 scikit-learn
%restart_python
```

**Output:**

```text
ERROR: pip's dependency resolver does not currently take into account all the packages that are installed. This behaviour is the source of the following dependency conflicts.
jupyter-server 1.23.4 requires anyio<4,>=3.1.0, but you have anyio 4.15.1 which is incompatible.
googleapis-common-protos 1.62.0 requires protobuf!=3.20.0,!=3.20.1,!=4.21.1,!=4.21.2,!=4.21.3,!=4.21.4,!=4.21.5,<5.0.0.dev0,>=3.19.5, but you have protobuf 7.36.2 which is incompatible.
[43mNote: you may need to restart the kernel using %restart_python or dbutils.library.restartPython() to use updated packages.[0m
```

### Code cell 2

```python
CATALOG, GOLD = "demo_catalog", "auc_gold"
MODEL_NAME = f"{CATALOG}.{GOLD}.bid_affinity_model"

cutoff = spark.sql(f"""
  SELECT timestampadd(SECOND, CAST(percentile_approx(unix_timestamp(bid_ts), 0.7) - unix_timestamp(min(bid_ts)) AS INT), min(bid_ts)) AS cutoff,
         min(bid_ts) AS first_bid, max(bid_ts) AS last_bid, count(*) AS bids
  FROM {CATALOG}.{GOLD}.fact_bids
""").first()
print(f"bids: {cutoff.bids:,} | first: {cutoff.first_bid} | cutoff (70th pct): {cutoff.cutoff} | last: {cutoff.last_bid}")
CUTOFF = cutoff.cutoff
```

**Output:**

```text
bids: 60,015 | first: 2026-08-24 12:51:45 | cutoff (70th pct): 2026-09-05 15:12:33 | last: 2026-10-06 05:45:00
```

### Code cell 3

```python
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
```

**Output:**

```text
rows (buyer × category): 32,000 | buyers: 4,000 | positive rate: 0.429
```

| bidder_account_id | category | cat_bids | cat_lots | cat_bid_share | cat_avg_bid | cat_max_bid | days_since_cat_bid | buyer_bids | buyer_categories | buyer_avg_bid | cat_share | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1993 | Excavator | 1.0 | 1.0 | 0.125 | 46967.61 | 46967.61 | 4.0 | 8.0 | 4.0 | 51648.47 | 0.13003523473954862 | 1 |
| 1044 | Combine | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 999.0 | 11.0 | 5.0 | 44025.042727 | 0.11927435482335015 | 1 |
| 3358 | Skid Steer | 1.0 | 1.0 | 0.1 | 19516.38 | 19516.38 | 12.0 | 10.0 | 7.0 | 63153.259 | 0.13184458622988288 | 0 |
| 3278 | Trailer | 2.0 | 2.0 | 0.2 | 29309.57 | 53431.17 | 3.0 | 10.0 | 6.0 | 60558.801 | 0.12505951814112942 | 1 |
| 1935 | Semi Truck | 1.0 | 1.0 | 0.125 | 30725.74 | 30725.74 | 9.0 | 8.0 | 5.0 | 46719.055 | 0.12648795352823541 | 0 |
| 2887 | Tractor | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 999.0 | 7.0 | 5.0 | 31456.288571 | 0.11763165412817826 | 1 |
| 33 | Dump Truck | 1.0 | 1.0 | 0.08333333333333333 | 44410.06 | 44410.06 | 1.0 | 12.0 | 6.0 | 48845.493333 | 0.12267879249595276 | 0 |
| 3852 | Loader | 2.0 | 2.0 | 0.18181818181818182 | 44770.82 | 82743.59 | 1.0 | 11.0 | 5.0 | 40868.405455 | 0.1269879059137225 | 0 |

### Code cell 4

```python
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
```

**Output:**

```text
2026/10/19 20:37:17 INFO mlflow.tracking.fluent: Experiment with name '/Users/<your-email>/auction_bid_affinity' does not exist. Creating a new experiment.
[1;38;5;208mIf you are using MLflow Tracing, consider storing your traces in Unity Catalog for unlimited storage (no 100,000 trace limit), fine-grained access controls, and queryability from notebooks, SQL, and dashboards. [94mLearn more: https://docs.databricks.com/aws/en/mlflow3/genai/tracing/trace-unity-catalog[0m
2026/10/19 20:37:19 WARNING mlflow.models.model: `artifact_path` is deprecated. Please use `name` instead.
🔗 View Logged Model at: https://<workspace-host>/ml/experiments/1950588379353566/models/m-22b790a440284371863b2ce670f990e2?o=<workspace-id>
Successfully registered model 'demo_catalog.auc_gold.bid_affinity_model'.
🔗 Created version '1' of model 'demo_catalog.auc_gold.bid_affinity_model': https://<workspace-host>/explore/data/models/demo_catalog/auc_gold/bid_affinity_model/version/1?o=<workspace-id>
```

```text
run_id: 30479d53b7d64834886bc17704595976
auc_model: 0.5042
auc_rule: 0.5084
ap_model: 0.4326
ap_rule: 0.4363
```

### Code cell 5

```python
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
```

**Output:**

| ranker | auc | avg_precision | top_category_hit_rate |
|---|---|---|---|
| rule: most-bid category | 0.5084 | 0.4363 | 0.443 |
| trained model | 0.5042 | 0.4326 | 0.463 |

### Code cell 6

```python
from mlflow import MlflowClient
c = MlflowClient(registry_uri="databricks-uc")
v = max(c.search_model_versions(f"name='{MODEL_NAME}'"), key=lambda m: int(m.version))
c.set_registered_model_alias(MODEL_NAME, "champion", v.version)
display(spark.createDataFrame([{"model": MODEL_NAME, "version": int(v.version), "alias": "champion",
                                "status": v.status, "run_id": v.run_id}]))
```

**Output:**

| alias | model | run_id | status | version |
|---|---|---|---|---|
| champion | demo_catalog.auc_gold.bid_affinity_model | 30479d53b7d64834886bc17704595976 | READY | 1 |

### Code cell 7

```python
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
```

**Output:**

| account_id | category | affinity_score | model_version | category_rank |
|---|---|---|---|---|
| 1248 | Excavator | 0.489 | 1 | 1 |
| 1248 | Semi Truck | 0.485 | 1 | 2 |
| 1248 | Loader | 0.441 | 1 | 3 |
| 1248 | Trailer | 0.436 | 1 | 4 |
| 1248 | Dump Truck | 0.422 | 1 | 5 |
| 1248 | Tractor | 0.422 | 1 | 6 |
| 1248 | Combine | 0.422 | 1 | 6 |
| 1248 | Skid Steer | 0.418 | 1 | 8 |

**What this changes.** The recommendation signal is now a versioned model in Unity Catalog with the
`champion` alias, governed and auditable like any table. `buyer_category_affinity` is the drop-in replacement for the bid-count rule
as the ranking input to `buyer_recommendations` (notebook 06, synced to Lakebase), once it beats the rule. Promoting a version is
an alias move; rollback is the same.

**What the evaluation found.** The synthetic generator (notebook 00) assigns bids to categories without buyer
preferences, so on this data neither the rule nor the model beats chance (AUC ≈ 0.50; top-category hit rate 0.44
vs 0.46). The useful result is that the bid-count rule currently being served has no measured lift either. This
time-split evaluation against the incumbent rule is what would catch that on real bid history, before a
recommendation change reaches reps. Gate promotion of the `champion` alias on beating the rule.
