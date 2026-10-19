# PII plaintext-tier guardrail: live run

Source: `sql/pii_plaintext_alert.sql`. This turns the PII-exposure audit (notebook 07) into an enforced check: an approved roster, a violations view over the plaintext tier plus `system.access.table_lineage`, and a Databricks SQL alert. Captured 2026-10-19 with the SQL Statement Execution API and `databricks alerts-v2`.

## 1 · Normal state: no violations

| violations |
|---|
| 0 |

## 2 · Test: an unapproved principal is added to the plaintext tier

`INSERT INTO demo_catalog.auc_gov.pii_authorized VALUES ('new.contractor@example.com')`

| principal | reads_7d | violation |
|---|---|---|
| new.contractor@example.com | 0 | in plaintext tier, not approved (no reads yet) |

## 3 · Reverted (`DELETE ... WHERE principal = 'new.contractor@example.com'`): back to zero

| violations |
|---|
| 0 |

Plaintext tier after the test (only the two approved principals):

| principal |
|---|
| <data-team-sp-id> |
| <your-email> |

## 4 · The alert

Created with `databricks alerts-v2 create-alert` (id `1950588379353567`, lifecycle `ACTIVE`):

- query: `SELECT count(*) AS violations FROM demo_catalog.auc_gov.v_pii_plaintext_violations`
- fires when: `violations` GREATER_THAN 0
- schedule: `0 0 * * * ?` (America/Chicago), **PAUSED** in the demo workspace so it doesn't wake the warehouse every hour. Unpause it in production and route it to the data-platform on-call.
