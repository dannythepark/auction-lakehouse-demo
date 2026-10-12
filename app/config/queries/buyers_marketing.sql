-- Marketing-rep persona: identical to buyers.obo.sql, but runs as the app's service
-- principal (a real, separate UC identity on the auc_gov.pii_partial tier).
-- @param search STRING
SELECT account_id, first_name, last_name, email, state, account_type, buyer_rating, total_bids
FROM demo_catalog.auc_gold.v_account_360
WHERE status = 'active'
  AND (:search = ''
       OR CAST(account_id AS STRING) = :search
       OR lower(concat_ws(' ', first_name, last_name)) LIKE concat('%', lower(:search), '%')
       OR lower(state) = lower(:search))
ORDER BY total_bids DESC, account_id
LIMIT 25
