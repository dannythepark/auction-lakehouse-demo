-- What AuctionCo's own auction history says about an appraised category.
-- @param category STRING = Tractor
SELECT COUNT(*)                                AS bids,
       COUNT(DISTINCT item_id)                 AS lots,
       COUNT(DISTINCT bidder_account_id)       AS active_bidders,
       CAST(AVG(bid_amount) AS DOUBLE)         AS avg_bid,
       CAST(PERCENTILE(bid_amount, 0.9) AS DOUBLE) AS p90_bid,
       CAST(MAX(bid_amount) AS DOUBLE)         AS max_bid,
       CAST(AVG(reserve_price) AS DOUBLE)      AS avg_reserve
FROM demo_catalog.auc_gold.fact_bids
WHERE category = :category
