-- Marketing-rep persona: same as category_buyers.obo.sql, run as the app service principal (partial PII tier).
-- @param category STRING = Tractor
WITH c AS (
  SELECT bidder_account_id, COUNT(*) AS bids_in_category, CAST(MAX(bid_amount) AS DOUBLE) AS top_bid
  FROM demo_catalog.auc_gold.fact_bids
  WHERE category = :category AND bidder_account_id IS NOT NULL
  GROUP BY bidder_account_id
)
SELECT a.account_id, a.first_name, a.last_name, a.email, a.phone, a.state,
       c.bids_in_category, c.top_bid
FROM c JOIN demo_catalog.auc_gold.v_account_360 a ON a.account_id = c.bidder_account_id
WHERE a.status = 'active'
ORDER BY c.bids_in_category DESC, c.top_bid DESC
LIMIT 5
