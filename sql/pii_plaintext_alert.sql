-- PII plaintext-tier guardrail: turns the PII-exposure audit (notebook 07) into an alert.
-- Policy lives in an approved roster. The view returns anyone in the plaintext tier, or anyone who read buyer
-- PII in plaintext in the last 7 days, who isn't on that roster. A Databricks SQL alert fires when it returns rows.
-- Run output: evidence/pii_plaintext_alert.md

CREATE TABLE IF NOT EXISTS demo_catalog.auc_gov.pii_plaintext_approved (
  principal STRING, approved_by STRING, reason STRING, approved_on DATE)
COMMENT 'Who policy says may see buyer PII in plaintext. The pii_authorized tier must never contain anyone not listed here.';

INSERT INTO demo_catalog.auc_gov.pii_plaintext_approved
SELECT * FROM VALUES
  ('<your-email>',       'data-platform lead', 'data team member',                        DATE'2026-09-10'),
  ('<data-team-sp-id>',  'data-platform lead', 'data-team service principal (pipelines)', DATE'2026-09-10')
  AS v(principal, approved_by, reason, approved_on)
WHERE NOT EXISTS (SELECT 1 FROM demo_catalog.auc_gov.pii_plaintext_approved);

CREATE OR REPLACE VIEW demo_catalog.auc_gov.v_pii_plaintext_violations
COMMENT 'Alert source: plaintext-tier members or plaintext reads of buyer PII by anyone not on the approved roster.' AS
WITH reads AS (
  SELECT created_by AS principal, COUNT(*) AS reads_7d, MAX(event_time) AS last_read
  FROM system.access.table_lineage
  WHERE source_table_full_name IN ('demo_catalog.auc_gold.v_account_360', 'demo_catalog.auc_silver.dim_account')
    AND event_date >= current_date() - 7
  GROUP BY created_by)
SELECT a.principal,
       CASE WHEN r.principal IS NULL THEN 'in plaintext tier, not approved (no reads yet)'
            ELSE 'plaintext read by unapproved principal' END AS violation,
       coalesce(r.reads_7d, 0) AS reads_7d, r.last_read
FROM demo_catalog.auc_gov.pii_authorized a
LEFT JOIN demo_catalog.auc_gov.pii_plaintext_approved ok ON ok.principal = a.principal
LEFT JOIN reads r ON r.principal = a.principal
WHERE ok.principal IS NULL;

-- Alert (create with: databricks alerts-v2 create-alert --json @sql/pii_plaintext_alert.json -p <profile>)
SELECT count(*) AS violations FROM demo_catalog.auc_gov.v_pii_plaintext_violations;
