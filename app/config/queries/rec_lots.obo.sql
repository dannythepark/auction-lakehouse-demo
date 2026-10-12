-- Lot details (title, location, auction date) for a buyer's recommended lots.
-- @param accountId BIGINT
SELECT r.item_id, i.title, i.state AS lot_state, CAST(i.auction_date AS STRING) AS auction_date
FROM demo_catalog.auc_gold.buyer_recommendations r
JOIN demo_catalog.auc_raw.item_basics i ON i.item_id = r.item_id
WHERE r.account_id = :accountId
ORDER BY r.rec_rank
