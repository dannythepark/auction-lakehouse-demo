-- Daily bid activity for one buyer over the demo window.
-- @param accountId BIGINT
SELECT CAST(DATE(bid_ts) AS STRING) AS bid_date,
       COUNT(*)                     AS bids
FROM demo_catalog.auc_gold.fact_bids
WHERE bidder_account_id = :accountId
GROUP BY DATE(bid_ts)
ORDER BY bid_date
