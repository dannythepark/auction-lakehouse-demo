# Databricks notebook source
# MAGIC %md
# MAGIC # 00 · Setup & synthetic auction data
# MAGIC
# MAGIC **AuctionCo end-to-end demo — foundation notebook.**
# MAGIC
# MAGIC Creates the demo catalog, medallion schemas, and a landing Volume, then generates
# MAGIC synthetic **heavy-equipment auction** data that mirrors AuctionCo's real tables
# MAGIC (`accounts`, `item_basics`, `bids`). Raw records are written to the Volume as JSON in
# MAGIC two arrival waves so the **streaming** notebook (02) has files landing incrementally.
# MAGIC
# MAGIC Run this once before anything else. Everything is synthetic — no real PII.
# MAGIC
# MAGIC | Object | Purpose |
# MAGIC |---|---|
# MAGIC | `auctionco_demo` catalog | demo sandbox |
# MAGIC | schemas `raw` / `bronze` / `silver` / `gold` | medallion layers |
# MAGIC | schema `gov` | governance objects (mask functions) |
# MAGIC | Volume `raw.landing` | where JSON files land for Auto Loader |

# COMMAND ----------

# MAGIC %md
# MAGIC ### Config — edit if you want a different catalog name

# COMMAND ----------

CATALOG = "demo_catalog"
LANDING = f"/Volumes/{CATALOG}/auc_raw/landing"
N_ACCOUNTS = 4000
N_ITEMS = 2500
N_BIDS = 60000

# Catalog `demo_catalog` already exists (managed). We only create our auc_* schemas.
for s in ["auc_raw", "auc_bronze", "auc_silver", "auc_gold", "auc_gov"]:
    spark.sql(f"CREATE SCHEMA IF NOT EXISTS {CATALOG}.{s}")
spark.sql(f"CREATE VOLUME IF NOT EXISTS {CATALOG}.auc_raw.landing")
spark.sql(f"USE CATALOG {CATALOG}")
print("catalog + schemas + volume ready:", CATALOG)

# COMMAND ----------

# MAGIC %md
# MAGIC ### Generate `accounts` — 20 columns, 5 of them PII
# MAGIC
# MAGIC The 5 sensitive columns are **`first_name`, `last_name`, `email`, `phone`, `tax_id`**.
# MAGIC This is the table the PII tagging and masking demo (notebook 03) runs on.

# COMMAND ----------

from pyspark.sql import functions as F

first_names = ["James","Mary","Robert","Patricia","John","Jennifer","Michael","Linda",
               "David","Elizabeth","William","Barbara","Richard","Susan","Joseph","Karen"]
last_names  = ["Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis",
               "Rodriguez","Martinez","Hernandez","Lopez","Gonzalez","Wilson","Anderson","Thomas"]
states = ["KS","MO","OK","NE","IA","TX","CO","AR","IL","MN"]

fn = F.array(*[F.lit(x) for x in first_names])
ln = F.array(*[F.lit(x) for x in last_names])
st = F.array(*[F.lit(x) for x in states])

accounts = (
    spark.range(1, N_ACCOUNTS + 1).withColumnRenamed("id", "account_id")
    .withColumn("account_type", F.element_at(F.array(F.lit("Buyer"), F.lit("Seller"), F.lit("Both")), (F.rand()*3+1).cast("int")))
    # --- 5 PII columns ---
    .withColumn("first_name", F.element_at(fn, (F.rand(1)*len(first_names)+1).cast("int")))
    .withColumn("last_name",  F.element_at(ln, (F.rand(2)*len(last_names)+1).cast("int")))
    .withColumn("email", F.concat(F.lower(F.col("first_name")), F.lit("."), F.lower(F.col("last_name")), F.col("account_id"), F.lit("@example.com")))
    .withColumn("phone", F.concat(F.lit("+1"), F.lpad((F.rand(3)*9_000_000_000 + 1_000_000_000).cast("long").cast("string"), 10, "0")))
    .withColumn("tax_id", F.lpad((F.rand(4)*999_999_999).cast("int").cast("string"), 9, "0"))
    # --- non-sensitive columns ---
    .withColumn("company_name", F.concat(F.col("last_name"), F.lit(" Equipment LLC")))
    .withColumn("city", F.lit("Lincoln"))
    .withColumn("state", F.element_at(st, (F.rand(5)*len(states)+1).cast("int")))
    .withColumn("zip", F.lpad((F.rand(6)*89999 + 10000).cast("int").cast("string"), 5, "0"))
    .withColumn("country", F.lit("US"))
    .withColumn("registration_date", F.date_sub(F.current_date(), (F.rand(7)*1400).cast("int")))
    .withColumn("status", F.when(F.rand(8) < 0.94, F.lit("active")).otherwise(F.lit("suspended")))
    .withColumn("buyer_rating", F.round(F.rand(9)*5, 1))
    .withColumn("seller_rating", F.round(F.rand(10)*5, 1))
    .withColumn("total_bids", (F.rand(11)*400).cast("int"))
    .withColumn("total_purchases", (F.rand(12)*80).cast("int"))
    .withColumn("updated_at", F.current_timestamp())
)
accounts.write.mode("overwrite").saveAsTable(f"{CATALOG}.auc_raw.accounts")
print("accounts:", spark.table(f"{CATALOG}.auc_raw.accounts").count(), "rows,",
      len(spark.table(f"{CATALOG}.auc_raw.accounts").columns), "columns")
display(spark.table(f"{CATALOG}.auc_raw.accounts").limit(5))

# COMMAND ----------

# MAGIC %md
# MAGIC ### Generate `item_basics` (equipment lots) and `bids`

# COMMAND ----------

categories = ["Tractor","Dump Truck","Excavator","Trailer","Skid Steer","Combine","Loader","Semi Truck"]
cat = F.array(*[F.lit(x) for x in categories])

items = (
    spark.range(1, N_ITEMS + 1).withColumnRenamed("id", "item_id")
    .withColumn("category", F.element_at(cat, (F.rand(20)*len(categories)+1).cast("int")))
    .withColumn("seller_account_id", (F.rand(21)*N_ACCOUNTS + 1).cast("long"))
    .withColumn("title", F.concat(F.lit("Lot "), F.col("item_id"), F.lit(" — "), F.col("category")))
    .withColumn("state", F.element_at(F.array(*[F.lit(x) for x in states]), (F.rand(22)*len(states)+1).cast("int")))
    .withColumn("reserve_price", F.round(F.rand(23)*90000 + 2000, 2))
    .withColumn("status", F.when(F.rand(24) < 0.8, F.lit("sold")).otherwise(F.lit("no_sale")))
    .withColumn("auction_date", F.date_sub(F.current_date(), (F.rand(25)*180).cast("int")))
    .withColumn("updated_at", F.current_timestamp())
)
items.write.mode("overwrite").saveAsTable(f"{CATALOG}.auc_raw.item_basics")

bids = (
    spark.range(1, N_BIDS + 1).withColumnRenamed("id", "bid_id")
    .withColumn("item_id", (F.rand(30)*N_ITEMS + 1).cast("long"))
    .withColumn("bidder_account_id", (F.rand(31)*N_ACCOUNTS + 1).cast("long"))
    .withColumn("bid_amount", F.round(F.rand(32)*95000 + 500, 2))
    .withColumn("bid_ts", F.from_unixtime(F.unix_timestamp(F.current_timestamp()) - (F.rand(33)*1_500_000).cast("int")))
    .withColumn("channel", F.element_at(F.array(F.lit("web"), F.lit("mobile"), F.lit("proxy")), (F.rand(34)*3+1).cast("int")))
)
bids.write.mode("overwrite").saveAsTable(f"{CATALOG}.auc_raw.bids")
print("items + bids written")

# COMMAND ----------

# MAGIC %md
# MAGIC ### Land raw JSON to the Volume in two waves
# MAGIC
# MAGIC Auto Loader (notebook 01/02) reads from `raw/landing/*`. We write **wave 1** now; the
# MAGIC streaming notebook writes **wave 2** later to show new files being picked up incrementally.

# COMMAND ----------

# wave 1: ~70% of bids + all accounts/items
(spark.table(f"{CATALOG}.auc_raw.accounts").write.mode("overwrite").json(f"{LANDING}/accounts"))
(spark.table(f"{CATALOG}.auc_raw.item_basics").write.mode("overwrite").json(f"{LANDING}/item_basics"))
(spark.table(f"{CATALOG}.auc_raw.bids").where("bid_id <= 42000")
    .repartition(4).write.mode("overwrite").json(f"{LANDING}/bids"))

# stash wave 2 for the streaming demo to drop in later
(spark.table(f"{CATALOG}.auc_raw.bids").where("bid_id > 42000")
    .repartition(2).write.mode("overwrite").json(f"{LANDING}/_bids_wave2"))

print("wave 1 landed. Volume path:", LANDING)
dbutils.fs.ls(f"{LANDING}/bids")

# COMMAND ----------

# MAGIC %md
# MAGIC **Next:** run `01_declarative_pipeline_batch_elt` (attach as a Lakeflow Declarative Pipeline),
# MAGIC then `02_declarative_pipeline_streaming_cdc`, then the governance notebooks `03`–`05`.
