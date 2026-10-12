# Databricks notebook source
# MAGIC %md
# MAGIC # 06 · Lakebase: serving recommendations to a customer-facing app
# MAGIC
# MAGIC AuctionCo's just-in-time marketing idea: put the right lot in front of the bidder who's likely to want it.
# MAGIC Recommendations are **computed in the lakehouse** and **served from Lakebase**, Databricks' managed Postgres.
# MAGIC
# MAGIC ```
# MAGIC  bids ─▶ gold.fact_bids ─▶ affinity model ─▶ gold.buyer_recommendations ─(sync)─▶ Lakebase Postgres ─▶ app / site / email
# MAGIC ```
# MAGIC
# MAGIC | Section | What it shows |
# MAGIC |---|---|
# MAGIC | 1 | The recommendations, in gold |
# MAGIC | 2 | The same rows in Lakebase: a real Postgres table with an index |
# MAGIC | 3 | How fast the app's lookup is, and why |
# MAGIC | 4 | Hundreds of lookups: p50 / p95 latency |
# MAGIC | 5 | The same lookup on the SQL warehouse, for contrast |
# MAGIC | 6 | Keeping Lakebase fresh from gold |
# MAGIC | 7 | Writes too: the app records what reps do |
# MAGIC | 8 | Who can connect |

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1 · The recommendations, in gold
# MAGIC Each buyer's top categories from their bid history, then the lots in those categories they haven't bid on, ranked.
# MAGIC A transparent model on purpose. Swap in Vector Search or a served ML model and the serving path is identical.

# COMMAND ----------

# DBTITLE 1,Cell 1 · Recommendations in gold (buyer #1248)
# MAGIC %sql
# MAGIC SELECT account_id, rec_rank, item_id, category, reserve_price, reason
# MAGIC FROM demo_catalog.auc_gold.buyer_recommendations
# MAGIC WHERE account_id = 1248
# MAGIC ORDER BY rec_rank

# COMMAND ----------

# DBTITLE 1,Cell 2 · Install the Postgres driver
# MAGIC %pip install -q psycopg2-binary "databricks-sdk>=0.70"

# COMMAND ----------

# DBTITLE 1,Cell 3 · Restart Python
dbutils.library.restartPython()

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2 · The same rows in Lakebase
# MAGIC Lakebase is Postgres: same protocol, same drivers, same SQL. Sign-in is a short-lived Databricks OAuth token, not a
# MAGIC static password.

# COMMAND ----------

# DBTITLE 1,Cell 4 · Connect and look at the table
import time, random, statistics
import pandas as pd
import psycopg2
from databricks.sdk import WorkspaceClient

w = WorkspaceClient()
BRANCH = "projects/auction-recs/branches/production"
host = next(iter(w.postgres.list_endpoints(BRANCH))).status.hosts.host
token = w.postgres.generate_database_credential(f"{BRANCH}/endpoints/primary").token  # OAuth, ~1h
conn = psycopg2.connect(host=host, port=5432, dbname="recs", user=w.current_user.me().user_name,
                        password=token, sslmode="require")
conn.autocommit = True
cur = conn.cursor()

def q(sql, args=None):
    cur.execute(sql, args)
    return pd.DataFrame(cur.fetchall(), columns=[d[0] for d in cur.description])

display(q("""
SELECT current_database() AS database,
       split_part(version(), ' ', 2) AS postgres_version,
       (SELECT COUNT(*) FROM public.buyer_recommendations) AS recommendations,
       (SELECT COUNT(DISTINCT account_id) FROM public.buyer_recommendations) AS buyers,
       (SELECT indexdef FROM pg_indexes WHERE tablename = 'buyer_recommendations' LIMIT 1) AS index
"""))

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3 · The app's lookup, and why it's fast
# MAGIC This is exactly what the Buyer 360 app runs for a buyer. The plan shows an **index scan**: Postgres jumps straight to
# MAGIC that buyer's five rows instead of reading the table.

# COMMAND ----------

# DBTITLE 1,Cell 5 · The app's lookup for buyer #1248
LOOKUP = """SELECT rec_rank, item_id, category, reserve_price, reason
            FROM public.buyer_recommendations WHERE account_id = %s ORDER BY rec_rank"""
t0 = time.perf_counter()
recs = q(LOOKUP, (1248,))
print(f"Round trip from this notebook: {(time.perf_counter() - t0) * 1000:.1f} ms")
display(recs)

# COMMAND ----------

# DBTITLE 1,Cell 6 · Query plan: index scan, sub-millisecond
plan = q("EXPLAIN (ANALYZE, BUFFERS) " + LOOKUP, (1248,))
display(plan)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4 · Hundreds of lookups
# MAGIC 500 lookups for random buyers, one after another, the way an app serves page views.

# COMMAND ----------

# DBTITLE 1,Cell 7 · 500 lookups: p50 / p95 / p99
buyers = [r[0] for r in q("SELECT DISTINCT account_id FROM public.buyer_recommendations").values]
timings = []
for acct in random.sample(buyers, 500):
    t0 = time.perf_counter()
    cur.execute(LOOKUP, (int(acct),))
    cur.fetchall()
    timings.append((time.perf_counter() - t0) * 1000)
timings.sort()
display(pd.DataFrame([{
    "lookups": len(timings),
    "p50_ms": round(statistics.median(timings), 2),
    "p95_ms": round(timings[int(len(timings) * 0.95)], 2),
    "p99_ms": round(timings[int(len(timings) * 0.99)], 2),
    "lookups_per_second_one_connection": round(1000 / statistics.mean(timings)),
}]))

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5 · The same lookup on the SQL warehouse
# MAGIC The warehouse is built for scanning and aggregating lots of data, not for one buyer at a time at page-view speed.
# MAGIC Same question, same data, for contrast.

# COMMAND ----------

# DBTITLE 1,Cell 8 · Same lookup on the SQL warehouse
wh_ms = []
for acct in random.sample(buyers, 5):
    t0 = time.perf_counter()
    w.statement_execution.execute_statement(
        statement=f"SELECT rec_rank, item_id, category, reserve_price FROM demo_catalog.auc_gold.buyer_recommendations "
                  f"WHERE account_id = {int(acct)} ORDER BY rec_rank",
        warehouse_id="<warehouse-id>", wait_timeout="30s")
    wh_ms.append((time.perf_counter() - t0) * 1000)
display(pd.DataFrame([
    {"served from": "Lakebase (Postgres)", "typical lookup_ms": round(statistics.median(timings), 1)},
    {"served from": "SQL warehouse", "typical lookup_ms": round(statistics.median(wh_ms), 1)},
]))

# COMMAND ----------

# MAGIC %md
# MAGIC ## 6 · Keeping Lakebase fresh from gold
# MAGIC Two ways to keep the serving copy in step with gold:
# MAGIC - **Synced table (production):** Unity Catalog keeps the Postgres table in step with the gold table automatically,
# MAGIC   on a schedule or continuously. When bids stream in, recommendations follow, with no job to maintain.
# MAGIC - **Load it yourself (this demo):** read gold and write Postgres in one transaction, as below. Readers never see a
# MAGIC   half-written table.

# COMMAND ----------

# DBTITLE 1,Cell 9 · Refresh Lakebase from gold in one transaction
from psycopg2.extras import execute_values

t0 = time.perf_counter()
rows = [tuple(r) for r in spark.sql("""
    SELECT account_id, rec_rank, item_id, category, reserve_price, affinity_bids, reason
    FROM demo_catalog.auc_gold.buyer_recommendations""").collect()]
read_s = time.perf_counter() - t0

conn.autocommit = False
t1 = time.perf_counter()
with conn.cursor() as c:
    c.execute("DELETE FROM public.buyer_recommendations")
    execute_values(c, """INSERT INTO public.buyer_recommendations
                         (account_id, rec_rank, item_id, category, reserve_price, affinity_bids, reason) VALUES %s""",
                   rows, page_size=5000)
conn.commit()
conn.autocommit = True
write_s = time.perf_counter() - t1
display(pd.DataFrame([{"rows refreshed": len(rows), "read from gold_s": round(read_s, 1), "write to Lakebase_s": round(write_s, 1)}]))

# COMMAND ----------

# MAGIC %md
# MAGIC ## 7 · Writes too: Lakebase is a real operational database
# MAGIC A warehouse is for reading. An app also needs to **write**: which rep contacted which buyer, about which lot, and
# MAGIC when. That goes straight into Postgres, with transactions, and can flow back to the lakehouse for analysis.

# COMMAND ----------

# DBTITLE 1,Cell 10 · Record a rep action, then read it back
cur.execute("""CREATE TABLE IF NOT EXISTS public.rep_actions (
                 action_id    BIGSERIAL PRIMARY KEY,
                 rep          TEXT NOT NULL,
                 account_id   BIGINT NOT NULL,
                 item_id      BIGINT,
                 action       TEXT NOT NULL,
                 created_at   TIMESTAMPTZ NOT NULL DEFAULT now())""")
cur.execute("INSERT INTO public.rep_actions (rep, account_id, item_id, action) VALUES (%s, %s, %s, %s)",
            (w.current_user.me().user_name, 1248, int(recs.iloc[0]["item_id"]), "outreach_sent"))
display(q("SELECT action_id, rep, account_id, item_id, action, created_at FROM public.rep_actions ORDER BY action_id DESC LIMIT 5"))

# COMMAND ----------

# MAGIC %md
# MAGIC ## 8 · Who can connect
# MAGIC Only Databricks identities. The app connects as its own service principal with **read-only** access to the
# MAGIC recommendations; nobody holds a database password.

# COMMAND ----------

# DBTITLE 1,Cell 11 · Who has access to the recommendations table
display(q("""
SELECT grantee,
       CASE WHEN grantee = '<app-service-principal-id>' THEN 'Buyer 360 app (service principal)'
            WHEN grantee LIKE '%@%' THEN 'Owner (Databricks user)'
            ELSE 'platform role' END AS who,
       string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_name = 'buyer_recommendations'
GROUP BY grantee
ORDER BY who
"""))
conn.close()
