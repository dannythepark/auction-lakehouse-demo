# Databricks App (Buyer 360): deployment status and live API calls

`databricks apps get buyer-360`: app status **RUNNING** ("App has status: App is running"), compute **ACTIVE**. Captured 2026-10-19.

Calls below were made with a workspace OAuth token against the deployed app.

- `/api/whoami` returns the signed-in user, which is the identity used for on-behalf-of-user SQL.
- `/api/recs/:accountId` reads the **Lakebase Postgres** `buyer_recommendations` table. `ms` is the server-side query time: the first call opens the pool (~500 ms), and warm lookups take ~6 ms. Notebook 06 measures p50/p95 in-region.

```text
$ GET /api/whoami
{"email":"<your-email>","user":"<user-id>@<workspace-id>"}
$ GET /api/recs/1248
{"rows":[{"rec_rank":1,"item_id":"28","category":"Dump Truck","reserve_price":90721.35,"affinity_bids":3,"reason":"You bid 3x on Dump Truck — Lot 28 is open now"},{"rec_rank":2,"item_id":"76","category":"Dump Truck","reserve_price":89780.33,"affinity_bids":3,"reason":"You bid 3x on Dump Truck — Lot 76 is open now"},{"rec_rank":3,"item_id":"1915","category":"Dump Truck","reserve_price":87543.92,"affinity_bids":3,"reason":"You bid 3x on Dump Truck — Lot 1915 is open now"},{"rec_rank":4,"item_id":"1161","category":"Dump Truck","reserve_price":85770.41,"affinity_bids":3,"reason":"You bid 3x on Dump Truck — Lot 1161 is open now"},{"rec_rank":5,"item_id":"1530","category":"Dump Truck","reserve_price":84621.42,"affinity_bids":3,"reason":"You bid 3x on Dump Truck — Lot 1530 is open now"}],"ms":502.8}
$ GET /api/recs/42
{"rows":[{"rec_rank":1,"item_id":"168","category":"Trailer","reserve_price":90677.38,"affinity_bids":3,"reason":"You bid 3x on Trailer — Lot 168 is open now"},{"rec_rank":2,"item_id":"653","category":"Trailer","reserve_price":90121.22,"affinity_bids":3,"reason":"You bid 3x on Trailer — Lot 653 is open now"},{"rec_rank":3,"item_id":"183","category":"Trailer","reserve_price":89317.68,"affinity_bids":3,"reason":"You bid 3x on Trailer — Lot 183 is open now"},{"rec_rank":4,"item_id":"137","category":"Trailer","reserve_price":89314.12,"affinity_bids":3,"reason":"You bid 3x on Trailer — Lot 137 is open now"},{"rec_rank":5,"item_id":"1550","category":"Trailer","reserve_price":85162.58,"affinity_bids":3,"reason":"You bid 3x on Trailer — Lot 1550 is open now"}],"ms":6}
$ GET /api/recs/3001
{"rows":[{"rec_rank":1,"item_id":"547","category":"Semi Truck","reserve_price":90859.98,"affinity_bids":6,"reason":"You bid 6x on Semi Truck — Lot 547 is open now"},{"rec_rank":2,"item_id":"261","category":"Semi Truck","reserve_price":90386.44,"affinity_bids":6,"reason":"You bid 6x on Semi Truck — Lot 261 is open now"},{"rec_rank":3,"item_id":"554","category":"Semi Truck","reserve_price":88607.47,"affinity_bids":6,"reason":"You bid 6x on Semi Truck — Lot 554 is open now"},{"rec_rank":4,"item_id":"480","category":"Semi Truck","reserve_price":87789.76,"affinity_bids":6,"reason":"You bid 6x on Semi Truck — Lot 480 is open now"},{"rec_rank":5,"item_id":"1889","category":"Semi Truck","reserve_price":87490.22,"affinity_bids":6,"reason":"You bid 6x on Semi Truck — Lot 1889 is open now"}],"ms":6.4}
$ POST /api/genie/as-marketing
```

See `genie.md` for the app's Genie route running as the Marketing-rep identity, with the PII mask enforced.
