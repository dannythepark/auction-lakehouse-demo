-- Buyer search list. Runs on-behalf-of the viewer, so the UC column mask on
-- dim_account decides whether PII comes back as plaintext or AES ciphertext.
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
