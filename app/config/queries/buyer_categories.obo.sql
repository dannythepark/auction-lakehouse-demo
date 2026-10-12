-- Category affinity for one buyer: where their bidding attention goes.
-- @param accountId BIGINT
SELECT category,
       COUNT(*)                        AS bids,
       CAST(SUM(bid_amount) AS DOUBLE) AS bid_value
FROM demo_catalog.auc_gold.fact_bids
WHERE bidder_account_id = :accountId
GROUP BY category
ORDER BY bids DESC
