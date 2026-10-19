# 06_lakebase_serving_recommendations: executed notebook with saved output

_Exported from the Databricks workspace (Jupyter format, with results) after running the notebook as a serverless job. Tables below are the real query results, converted from HTML to Markdown._

# 06 · Lakebase: serving recommendations to a customer-facing app

AuctionCo's just-in-time marketing idea: put the right lot in front of the bidder who's likely to want it.
Recommendations are **computed in the lakehouse** and **served from Lakebase**, Databricks' managed Postgres.

```
 bids ─▶ gold.fact_bids ─▶ affinity model ─▶ gold.buyer_recommendations ─(sync)─▶ Lakebase Postgres ─▶ app / site / email
```

| Section | What it shows |
|---|---|
| 1 | The recommendations, in gold |
| 2 | The same rows in Lakebase: a real Postgres table with an index |
| 3 | How fast the app's lookup is, and why |
| 4 | Hundreds of lookups: p50 / p95 latency |
| 5 | The same lookup on the SQL warehouse, for contrast |
| 6 | Keeping Lakebase fresh from gold |
| 7 | Writes too: the app records what reps do |
| 8 | Who can connect |

## 1 · The recommendations, in gold
Each buyer's top categories from their bid history, then the lots in those categories they haven't bid on, ranked.
A transparent model on purpose. Swap in Vector Search or a served ML model and the serving path is identical.

### Code cell 1

```sql
%sql
SELECT account_id, rec_rank, item_id, category, reserve_price, reason
FROM demo_catalog.auc_gold.buyer_recommendations
WHERE account_id = 1248
ORDER BY rec_rank
```

**Output:**

| account_id | rec_rank | item_id | category | reserve_price | reason |
|---|---|---|---|---|---|
| 1248 | 1 | 28 | Dump Truck | 90721.35 | You bid 3x on Dump Truck — Lot 28 is open now |
| 1248 | 2 | 76 | Dump Truck | 89780.33 | You bid 3x on Dump Truck — Lot 76 is open now |
| 1248 | 3 | 1915 | Dump Truck | 87543.92 | You bid 3x on Dump Truck — Lot 1915 is open now |
| 1248 | 4 | 1161 | Dump Truck | 85770.41 | You bid 3x on Dump Truck — Lot 1161 is open now |
| 1248 | 5 | 1530 | Dump Truck | 84621.42 | You bid 3x on Dump Truck — Lot 1530 is open now |

### Code cell 2

```python
%pip install -q psycopg2-binary "databricks-sdk>=0.70"
```

**Output:**

```text
ERROR: pip's dependency resolver does not currently take into account all the packages that are installed. This behaviour is the source of the following dependency conflicts.
googleapis-common-protos 1.62.0 requires protobuf!=3.20.0,!=3.20.1,!=4.21.1,!=4.21.2,!=4.21.3,!=4.21.4,!=4.21.5,<5.0.0.dev0,>=3.19.5, but you have protobuf 6.33.6 which is incompatible.
[43mNote: you may need to restart the kernel using %restart_python or dbutils.library.restartPython() to use updated packages.[0m
```

### Code cell 3

```python
dbutils.library.restartPython()
```

_(no output)_

## 2 · The same rows in Lakebase
Lakebase is Postgres: same protocol, same drivers, same SQL. Sign-in is a short-lived Databricks OAuth token, not a
static password.

### Code cell 4

```python
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
```

**Output:**

| database | postgres_version | recommendations | buyers | index |
|---|---|---|---|---|
| recs | 17.11 | 20000 | 4000 | CREATE INDEX idx_recs_account ON public.buyer_recommendations USING btree (account_id) |

## 3 · The app's lookup, and why it's fast
This is exactly what the Buyer 360 app runs for a buyer. The plan shows an **index scan**: Postgres jumps straight to
that buyer's five rows instead of reading the table.

### Code cell 5

```python
LOOKUP = """SELECT rec_rank, item_id, category, reserve_price, reason
            FROM public.buyer_recommendations WHERE account_id = %s ORDER BY rec_rank"""
t0 = time.perf_counter()
recs = q(LOOKUP, (1248,))
print(f"Round trip from this notebook: {(time.perf_counter() - t0) * 1000:.1f} ms")
display(recs)
```

**Output:**

```text
Round trip from this notebook: 4.7 ms
```

| rec_rank | item_id | category | reserve_price | reason |
|---|---|---|---|---|
| 1 | 28 | Dump Truck | 90721.35 | You bid 3x on Dump Truck — Lot 28 is open now |
| 2 | 76 | Dump Truck | 89780.33 | You bid 3x on Dump Truck — Lot 76 is open now |
| 3 | 1915 | Dump Truck | 87543.92 | You bid 3x on Dump Truck — Lot 1915 is open now |
| 4 | 1161 | Dump Truck | 85770.41 | You bid 3x on Dump Truck — Lot 1161 is open now |
| 5 | 1530 | Dump Truck | 84621.42 | You bid 3x on Dump Truck — Lot 1530 is open now |

### Code cell 6

```python
plan = q("EXPLAIN (ANALYZE, BUFFERS) " + LOOKUP, (1248,))
display(plan)
```

**Output:**

| QUERY PLAN |
|---|
| Sort  (cost=8.43..8.45 rows=5 width=76) (actual time=0.026..0.027 rows=5 loops=1) |
| Sort Key: rec_rank |
| Sort Method: quicksort  Memory: 25kB |
| Buffers: shared hit=3 |
| ->  Index Scan using idx_recs_account on buyer_recommendations  (cost=0.29..8.38 rows=5 width=76) (actual time=0.018..0.020 rows=5 loops=1) |
| Index Cond: (account_id = 1248) |
| Buffers: shared hit=3 |
| Planning Time: 0.063 ms |
| Execution Time: 0.050 ms |

## 4 · Hundreds of lookups
500 lookups for random buyers, one after another, the way an app serves page views.

### Code cell 7

```python
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
```

**Output:**

| lookups | p50_ms | p95_ms | p99_ms | lookups_per_second_one_connection |
|---|---|---|---|---|
| 500 | 2.74 | 3.87 | 5.11 | 361 |

## 5 · The same lookup on the SQL warehouse
The warehouse is built for scanning and aggregating lots of data, not for one buyer at a time at page-view speed.
Same question, same data, for contrast.

### Code cell 8

```python
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
```

**Output:**

| served from | typical lookup_ms |
|---|---|
| Lakebase (Postgres) | 2.7 |
| SQL warehouse | 998.0 |

## 6 · Keeping Lakebase fresh from gold
Two ways to keep the serving copy in step with gold:
- **Synced table (production):** Unity Catalog keeps the Postgres table in step with the gold table automatically,
  on a schedule or continuously. When bids stream in, recommendations follow, with no job to maintain.
- **Load it yourself (this demo):** read gold and write Postgres in one transaction, as below. Readers never see a
  half-written table.

### Code cell 9

```python
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
```

**Output:**

| rows refreshed | read from gold_s | write to Lakebase_s |
|---|---|---|
| 20000 | 2.5 | 0.4 |

## 7 · Writes too: Lakebase is a real operational database
A warehouse is for reading. An app also needs to **write**: which rep contacted which buyer, about which lot, and
when. That goes straight into Postgres, with transactions, and can flow back to the lakehouse for analysis.

### Code cell 10

```python
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
```

**Output:**

| action_id | rep | account_id | item_id | action | created_at |
|---|---|---|---|---|---|
| 1 | <your-email> | 1248 | 28 | outreach_sent | 2026-10-08T04:16:20.902Z |

## 8 · Who can connect
Only Databricks identities. The app connects as its own service principal with **read-only** access to the
recommendations; nobody holds a database password.

### Code cell 11

```python
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
```

**Output:**

| grantee | who | privileges |
|---|---|---|
| <app-service-principal-id> | Buyer 360 app (service principal) | SELECT |
| <your-email> | Owner (Databricks user) | DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE |
| databricks_gateway | platform role | SELECT |
| databricks_reader_16555 | platform role | SELECT |
| databricks_superuser | platform role | DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE |
