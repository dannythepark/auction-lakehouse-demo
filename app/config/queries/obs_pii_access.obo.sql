-- PII exposure audit: every principal that read the governed account data (from
-- Unity Catalog lineage), and whether the masks gave them plaintext, partial (last 4) or ciphertext.
WITH reads AS (
  SELECT created_by AS principal,
         COUNT(*) AS reads,
         CAST(MAX(event_time) AS STRING) AS last_read
  FROM system.access.table_lineage
  WHERE source_table_full_name IN ('demo_catalog.auc_gold.v_account_360',
                                   'demo_catalog.auc_silver.dim_account')
    AND event_date >= current_date() - 60
  GROUP BY created_by
)
SELECT r.principal,
       CASE r.principal
         WHEN '<data-team-sp-id>' THEN 'Data-team service principal'
         WHEN '<business-sp-id>' THEN 'Business service principal'
         WHEN '<app-service-principal-id>' THEN 'Marketing rep (app service principal)'
         ELSE 'User'
       END AS principal_type,
       CASE WHEN a.principal IS NOT NULL THEN 'plaintext'
            WHEN pp.principal IS NOT NULL THEN 'partial'
            ELSE 'ciphertext' END AS pii_result,
       r.reads, r.last_read
FROM reads r
LEFT JOIN demo_catalog.auc_gov.pii_authorized a ON a.principal = r.principal
LEFT JOIN demo_catalog.auc_gov.pii_partial pp ON pp.principal = r.principal
ORDER BY r.reads DESC
