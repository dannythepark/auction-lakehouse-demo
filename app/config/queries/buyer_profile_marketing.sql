-- Marketing-rep persona: identical to buyer_profile.obo.sql, but runs as the app's
-- service principal, so UC applies the partial tier (phone / tax ID masked to last 4).
-- @param accountId BIGINT
WITH b AS (
  SELECT bidder_account_id,
         COUNT(*)                         AS bids_30d,
         COUNT(DISTINCT item_id)          AS lots_bid,
         CAST(SUM(bid_amount) AS DOUBLE)  AS bid_value,
         CAST(MAX(bid_amount) AS DOUBLE)  AS max_bid,
         MAX(bid_ts)                      AS last_bid_ts,
         MODE(channel)                    AS top_channel,
         MODE(category)                   AS top_category
  FROM demo_catalog.auc_gold.fact_bids
  WHERE bidder_account_id = :accountId
  GROUP BY bidder_account_id
)
SELECT a.account_id, a.first_name, a.last_name, a.email, a.phone, a.tax_id,
       a.state, a.account_type, a.status, a.buyer_rating, a.total_bids,
       b.bids_30d, b.lots_bid, b.bid_value, b.max_bid, b.last_bid_ts, b.top_channel, b.top_category
FROM demo_catalog.auc_gold.v_account_360 a
LEFT JOIN b ON b.bidder_account_id = a.account_id
WHERE a.account_id = :accountId
