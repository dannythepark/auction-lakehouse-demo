# 03_pii_tagging_and_masking: executed notebook with saved output

_Exported from the Databricks workspace (Jupyter format, with results) after running the notebook as a serverless job. Tables below are the real query results, converted from HTML to Markdown._

# 03 · PII tagging and masking, step by step

The goal the engineering lead described: **one table, one set of views, no copies.** The data team sees all 20 columns.
Everyone else sees the same 20 columns, with the 5 sensitive ones protected.

| Step | What happens |
|---|---|
| 1 | Look at the account table: 20 columns, 5 of them PII |
| 2 | **Tag** the 5 PII columns |
| 3 | Decide **who's in which tier** |
| 4 | Write the **mask functions**: one rule per kind of column |
| 5 | **Attach** the masks to the table |
| 6 | See what I get back |
| 7 | Run the same query **as all three tiers** |
| 8 | Tags, masks and results **side by side** |

## 1 · The account table: 20 columns, 5 of them PII
`auc_silver.dim_account` is the SCD2 account dimension built by the pipeline. `first_name`, `last_name`,
`email`, `phone` and `tax_id` are the sensitive ones.

### Code cell 1

```sql
SELECT account_id, first_name, last_name, email, phone, tax_id,
       company_name, city, state, zip, country, account_type, status,
       registration_date, buyer_rating, seller_rating, total_bids, total_purchases, updated_at, _source_file
FROM demo_catalog.auc_silver.dim_account
WHERE __END_AT IS NULL
ORDER BY account_id
LIMIT 5;
```

**Output:**

| account_id | first_name | last_name | email | phone | tax_id | company_name | city | state | zip | country | account_type | status | registration_date | buyer_rating | seller_rating | total_bids | total_purchases | updated_at | _source_file |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | James | Garcia | james.garcia1@example.com | +12676853709 | 923230080 | Garcia Equipment LLC | Lincoln | IA | 86081 | US | Both | active | 2022-12-19 | 2.3 | 4.4 | 328 | 38 | 2026-09-10T21:30:50.348Z | /Volumes/demo_catalog/auc_raw/landing/accounts/part-00000-tid-7652785322671250959-24fec654-ecfb-4df4-a6e6-91da06f6395d-157-1-c000.json |
| 2 | Joseph | Miller | joseph.miller2@example.com | +11314614437 | 378809050 | Miller Equipment LLC | Lincoln | KS | 96047 | US | Buyer | active | 2025-10-13 | 2.3 | 0.3 | 104 | 29 | 2026-09-10T21:30:50.348Z | /Volumes/demo_catalog/auc_raw/landing/accounts/part-00000-tid-7652785322671250959-24fec654-ecfb-4df4-a6e6-91da06f6395d-157-1-c000.json |
| 3 | Robert | Williams | robert.williams3@example.com | +16532221433 | 365221552 | Williams Equipment LLC | Lincoln | KS | 29362 | US | Buyer | active | 2024-01-18 | 3.6 | 0.5 | 289 | 59 | 2026-09-10T21:30:50.348Z | /Volumes/demo_catalog/auc_raw/landing/accounts/part-00000-tid-7652785322671250959-24fec654-ecfb-4df4-a6e6-91da06f6395d-157-1-c000.json |
| 4 | Barbara | Jones | barbara.jones4@example.com | +16744674862 | 207032901 | Jones Equipment LLC | Lincoln | CO | 38054 | US | Buyer | active | 2023-12-14 | 0.6 | 2.6 | 306 | 7 | 2026-09-10T21:30:50.348Z | /Volumes/demo_catalog/auc_raw/landing/accounts/part-00000-tid-7652785322671250959-24fec654-ecfb-4df4-a6e6-91da06f6395d-157-1-c000.json |
| 5 | Jennifer | Williams | jennifer.williams5@example.com | +16771820740 | 942838634 | Williams Equipment LLC | Lincoln | TX | 30336 | US | Both | active | 2023-09-11 | 1.3 | 3.6 | 290 | 69 | 2026-09-10T21:30:50.348Z | /Volumes/demo_catalog/auc_raw/landing/accounts/part-00000-tid-7652785322671250959-24fec654-ecfb-4df4-a6e6-91da06f6395d-157-1-c000.json |

## 2 · Tag the five PII columns
Tags are governed objects in Unity Catalog. They're queryable, visible in Catalog Explorer, and they're what a
catalog-wide masking policy keys off in production. (Key `auc_pii` here because this shared demo metastore already
has a policy on `pii`; in AuctionCo's account it's your own `pii` taxonomy.)

### Code cell 2

```sql
ALTER TABLE demo_catalog.auc_silver.dim_account ALTER COLUMN first_name SET TAGS ('auc_pii' = 'name');
ALTER TABLE demo_catalog.auc_silver.dim_account ALTER COLUMN last_name  SET TAGS ('auc_pii' = 'name');
ALTER TABLE demo_catalog.auc_silver.dim_account ALTER COLUMN email      SET TAGS ('auc_pii' = 'email');
ALTER TABLE demo_catalog.auc_silver.dim_account ALTER COLUMN phone      SET TAGS ('auc_pii' = 'phone');
ALTER TABLE demo_catalog.auc_silver.dim_account ALTER COLUMN tax_id     SET TAGS ('auc_pii' = 'government_id');
```

_(no output)_

### Code cell 3

```sql
SELECT column_name, tag_name, tag_value
FROM demo_catalog.information_schema.column_tags
WHERE schema_name = 'auc_silver' AND table_name = 'dim_account' AND tag_name = 'auc_pii'
ORDER BY column_name;
```

**Output:**

| column_name | tag_name | tag_value |
|---|---|---|
| email | auc_pii | email |
| first_name | auc_pii | name |
| last_name | auc_pii | name |
| phone | auc_pii | phone |
| tax_id | auc_pii | government_id |

## 3 · Who's in which tier
Three tiers. In this demo workspace they're two small allowlist tables, because account groups aren't federated here.
In AuctionCo's account they're **groups from your identity provider** (`auc_data_team`, `auc_marketing`), with OpenFGA
generating the membership if you adopt it.

| Tier | Names & email | Phone & tax ID |
|---|---|---|
| **Data team** | plaintext | plaintext |
| **Marketing** (partial) | plaintext | last 4 digits only |
| **Everyone else** | encrypted | encrypted |

### Code cell 4

```sql
SELECT 'Data team (full PII)' AS tier, principal, CAST(NULL AS STRING) AS persona FROM demo_catalog.auc_gov.pii_authorized
UNION ALL
SELECT 'Marketing (partial PII)', principal, persona FROM demo_catalog.auc_gov.pii_partial;
```

**Output:**

| tier | principal | persona |
|---|---|---|
| Data team (full PII) | <data-team-sp-id> | null |
| Data team (full PII) | <your-email> | null |
| Marketing (partial PII) | <app-service-principal-id> | Marketing rep |

## 4 · The mask functions: one rule per kind of column
Each function decides, **per person running the query**, what comes back. The encrypted value is still a string, so
nothing downstream breaks, and the data is kept, not dropped. The key lives in a secret scope, not in code.

### Code cell 5

```sql
-- names and email
CREATE OR REPLACE FUNCTION demo_catalog.auc_gov.enc_pii(v STRING)
  RETURNS STRING
  COMMENT 'Names / email: plaintext for the data team and the partial tier; AES-GCM ciphertext for everyone else'
  RETURN CASE
    WHEN current_user() IN (SELECT principal FROM demo_catalog.auc_gov.pii_authorized) THEN v
    WHEN current_user() IN (SELECT principal FROM demo_catalog.auc_gov.pii_partial)    THEN v
    ELSE base64(aes_encrypt(v, secret('auc_pii_demo','cmk'), 'GCM'))
  END;
```

_(no output)_

### Code cell 6

```sql
-- phone and tax ID
CREATE OR REPLACE FUNCTION demo_catalog.auc_gov.mask_last4(v STRING)
  RETURNS STRING
  COMMENT 'Phone / tax ID: plaintext for the data team, last 4 for the partial tier, AES-GCM ciphertext for everyone else'
  RETURN CASE
    WHEN current_user() IN (SELECT principal FROM demo_catalog.auc_gov.pii_authorized) THEN v
    WHEN current_user() IN (SELECT principal FROM demo_catalog.auc_gov.pii_partial)
      THEN concat(repeat('•', greatest(length(v) - 4, 0)), right(v, 4))
    ELSE base64(aes_encrypt(v, secret('auc_pii_demo','cmk'), 'GCM'))
  END;
```

_(no output)_

## 5 · Attach the masks to the table, not to a view
Because the rule lives on the table, every view, dashboard, Genie space, app and AI tool that reads it gets the
same answer for the same person.

### Code cell 7

```sql
ALTER TABLE demo_catalog.auc_silver.dim_account ALTER COLUMN first_name SET MASK demo_catalog.auc_gov.enc_pii;
ALTER TABLE demo_catalog.auc_silver.dim_account ALTER COLUMN last_name  SET MASK demo_catalog.auc_gov.enc_pii;
ALTER TABLE demo_catalog.auc_silver.dim_account ALTER COLUMN email      SET MASK demo_catalog.auc_gov.enc_pii;
ALTER TABLE demo_catalog.auc_silver.dim_account ALTER COLUMN phone      SET MASK demo_catalog.auc_gov.mask_last4;
ALTER TABLE demo_catalog.auc_silver.dim_account ALTER COLUMN tax_id     SET MASK demo_catalog.auc_gov.mask_last4;
```

_(no output)_

### Code cell 8

```sql
SELECT column_name, mask_name
FROM demo_catalog.information_schema.column_masks
WHERE table_schema = 'auc_silver' AND table_name = 'dim_account'
ORDER BY column_name;
```

**Output:**

| column_name | mask_name |
|---|---|
| email | demo_catalog.auc_gov.enc_pii |
| first_name | demo_catalog.auc_gov.enc_pii |
| last_name | demo_catalog.auc_gov.enc_pii |
| phone | demo_catalog.auc_gov.mask_last4 |
| tax_id | demo_catalog.auc_gov.mask_last4 |

## 6 · What comes back
First, **me**. I'm on the data team, so I see everything, through the plain `v_account_360` view.

### Code cell 9

```sql
SELECT current_user() AS running_as,
       CASE WHEN current_user() IN (SELECT principal FROM demo_catalog.auc_gov.pii_authorized) THEN 'Data team (full PII)'
            WHEN current_user() IN (SELECT principal FROM demo_catalog.auc_gov.pii_partial)    THEN 'Marketing (partial PII)'
            ELSE 'Everyone else (encrypted)' END AS my_tier;
```

**Output:**

| running_as | my_tier |
|---|---|
| <your-email> | Data team (full PII) |

### Code cell 10

```sql
SELECT account_id, first_name, last_name, email, phone, tax_id, state, account_type
FROM demo_catalog.auc_gold.v_account_360
WHERE account_id IN (1248, 1269, 3559)
ORDER BY account_id;
```

**Output:**

| account_id | first_name | last_name | email | phone | tax_id | state | account_type |
|---|---|---|---|---|---|---|---|
| 1248 | David | Smith | david.smith1248@example.com | +13134721759 | 191688647 | MO | Both |
| 1269 | Jennifer | Rodriguez | jennifer.rodriguez1269@example.com | +17796264381 | 029151343 | OK | Buyer |
| 3559 | Michael | Johnson | michael.johnson3559@example.com | +19724453184 | 960512761 | KS | Buyer |

## 7 · The same query, run as all three tiers
Now the real thing. The identical query runs as three real identities, the same ones the Buyer 360 app uses:

| Tier | Identity |
|---|---|
| Data team | me (the notebook runner) |
| Marketing | the Buyer 360 app's service principal, the app's *View as → Marketing rep* |
| Everyone else | the business service principal |

Each service principal gets a short-lived OAuth secret for this cell, and it's deleted at the end.

### Code cell 11

```sql
%python
import pandas as pd
from databricks.sdk import WorkspaceClient

w = WorkspaceClient()
WAREHOUSE = "<warehouse-id>"
QUERY = """
SELECT account_id, first_name, last_name, email, phone, tax_id, state
FROM demo_catalog.auc_gold.v_account_360
WHERE account_id IN (1248, 1269, 3559)
ORDER BY account_id
"""
TIERS = {
    "Data team (me)": None,
    "Marketing (app SP)": "<app-service-principal-id>",
    "Everyone else (business SP)": "<business-sp-id>",
}

def run(client, sql):
    r = client.statement_execution.execute_statement(statement=sql, warehouse_id=WAREHOUSE, wait_timeout="50s")
    if r.status.state.value != "SUCCEEDED":
        raise RuntimeError(r.status.error.message if r.status.error else r.status.state.value)
    return pd.DataFrame(r.result.data_array or [], columns=[c.name for c in r.manifest.schema.columns])

results = {}
for tier, app_id in TIERS.items():
    if app_id is None:
        results[tier] = (w.current_user.me().user_name, run(w, QUERY))
        continue
    sp = next(iter(w.service_principals.list(filter=f'applicationId eq "{app_id}"')))
    path = f"/api/2.0/accounts/servicePrincipals/{sp.id}/credentials/secrets"
    sec = w.api_client.do("POST", path)
    try:
        c = WorkspaceClient(host=w.config.host, client_id=app_id, client_secret=sec["secret"], auth_type="oauth-m2m")
        results[tier] = (run(c, "SELECT current_user() AS u").iloc[0, 0], run(c, QUERY))
    finally:
        w.api_client.do("DELETE", f"{path}/{sec['id']}")

display(pd.DataFrame([{"tier": t, "Unity Catalog saw": who} for t, (who, _) in results.items()]))
```

**Output:**

| tier | Unity Catalog saw |
|---|---|
| Data team (me) | <your-email> |
| Marketing (app SP) | <app-service-principal-id> |
| Everyone else (business SP) | <business-sp-id> |

### Data team: everything in plaintext

### Code cell 12

```sql
%python
display(results["Data team (me)"][1])
```

**Output:**

| account_id | first_name | last_name | email | phone | tax_id | state |
|---|---|---|---|---|---|---|
| 1248 | David | Smith | david.smith1248@example.com | +13134721759 | 191688647 | MO |
| 1269 | Jennifer | Rodriguez | jennifer.rodriguez1269@example.com | +17796264381 | 029151343 | OK |
| 3559 | Michael | Johnson | michael.johnson3559@example.com | +19724453184 | 960512761 | KS |

### Marketing: names and email, phone and tax ID masked to the last 4
Exactly what the Buyer 360 app shows under *View as → Marketing rep*.

### Code cell 13

```sql
%python
display(results["Marketing (app SP)"][1])
```

**Output:**

| account_id | first_name | last_name | email | phone | tax_id | state |
|---|---|---|---|---|---|---|
| 1248 | David | Smith | david.smith1248@example.com | ••••••••1759 | •••••8647 | MO |
| 1269 | Jennifer | Rodriguez | jennifer.rodriguez1269@example.com | ••••••••4381 | •••••1343 | OK |
| 3559 | Michael | Johnson | michael.johnson3559@example.com | ••••••••3184 | •••••2761 | KS |

### Everyone else: all five encrypted, every other column untouched

### Code cell 14

```sql
%python
display(results["Everyone else (business SP)"][1])
```

**Output:**

| account_id | first_name | last_name | email | phone | tax_id | state |
|---|---|---|---|---|---|---|
| 1248 | tyzXmCkfV3lyR6CcDkErvg5wIrGzqMjeFZ3Nkrs6mRTf | uMxmyXMnP9Ruye8RZscF4doSdc60RRc0vE+SGZH3PrFo | 1Zzpj0bQ7pP4JBPswpyarLyguGcz2HWLOSfdb6oOfjr1Tnqstr/Jok656tjKe7HiELY50GKP0Q== | fLwr/QrxWZ/1ba0JzPPQ2Z4YhSXf9qF/LTvTgE2RzGSuGFBeJEXTBQ== | w9ZLXuAer9OKOavZDlL+8jGrQEqyUkF7jXdpQOHvyzXvxq4Tmg== | MO |
| 1269 | D/FxhMB5YAdlZf2bA4Zh6KBcGW3dNwohqhNpMkNLdS+nHF2k | MAyEAcSEiO5KYbTDLyxqPEOyp3luEdAzcbWSUVT7zoQAp4nY8A== | JIG2yrPAmHeR59V2smz4wpjUpALlCQsFQ5qaKtZ8JzpzgGkCZjaozzE2/R3+qLgK5HwuEmpjqjoF
<br>qOXmCjI= | 74NjHx2WOSjd7W/gQpYk7ZQP7iqun9WVL4VymaL3xHpVa6FtjC3hBw== | fTNGG4JD8hqKu4OVek5qxC0eHCz1FBtIgAfoSzv6WXpt3eIbvw== | OK |
| 3559 | Yv8jSLMblbtR7gS1wKQa5oOse+ApvMoZFKg2Gv6EKaRatJE= | r2fuSWIPD9p8DFTKrslZKvzbAdY3kvHCbLeO1lb7PWyE4Lc= | laoqOTqYjWObqUhmY3UO9UX81iPDQl8IJyP0bEXzcgWSHTLX5m90nLcgfVnisQ8AZFpxF2nCcOO8
<br>kt0= | sJ65yecnbbWB7DJUh/7M0TFEqNwzV4/Cy8NeoxU437gKkbXmUJrskw== | MyTrejlV6th1EOatJjtVo+PTUXgIjYRXAx6dR4ndXm/hPKFntw== | KS |

## 8 · Tags, masks and what each tier got, side by side (buyer #1248)
One row per PII column: the tag on it, the policy that masks it, and the value each identity actually received.

### Code cell 15

```sql
%python
tags  = run(w, "SELECT column_name, tag_value FROM demo_catalog.information_schema.column_tags "
               "WHERE schema_name='auc_silver' AND table_name='dim_account' AND tag_name='auc_pii'")
masks = run(w, "SELECT column_name, mask_name FROM demo_catalog.information_schema.column_masks "
               "WHERE table_schema='auc_silver' AND table_name='dim_account'")
rows = []
for col in ["first_name", "last_name", "email", "phone", "tax_id"]:
    row = {"column": col,
           "auc_pii tag": tags.loc[tags.column_name == col, "tag_value"].iloc[0],
           "mask policy": masks.loc[masks.column_name == col, "mask_name"].iloc[0].split(".")[-1]}
    for tier, (_, df) in results.items():
        row[tier] = df.loc[df.account_id == "1248", col].iloc[0]
    rows.append(row)
display(pd.DataFrame(rows))
```

**Output:**

| column | auc_pii tag | mask policy | Data team (me) | Marketing (app SP) | Everyone else (business SP) |
|---|---|---|---|---|---|
| first_name | name | enc_pii | David | David | tyzXmCkfV3lyR6CcDkErvg5wIrGzqMjeFZ3Nkrs6mRTf |
| last_name | name | enc_pii | Smith | Smith | uMxmyXMnP9Ruye8RZscF4doSdc60RRc0vE+SGZH3PrFo |
| email | email | enc_pii | david.smith1248@example.com | david.smith1248@example.com | 1Zzpj0bQ7pP4JBPswpyarLyguGcz2HWLOSfdb6oOfjr1Tnqstr/Jok656tjKe7HiELY50GKP0Q== |
| phone | phone | mask_last4 | +13134721759 | ••••••••1759 | fLwr/QrxWZ/1ba0JzPPQ2Z4YhSXf9qF/LTvTgE2RzGSuGFBeJEXTBQ== |
| tax_id | government_id | mask_last4 | 191688647 | •••••8647 | w9ZLXuAer9OKOavZDlL+8jGrQEqyUkF7jXdpQOHvyzXvxq4Tmg== |

## In production
- Swap each allowlist check for `is_account_group_member('auc_data_team')` / `('auc_marketing')`.
- Replace the five `SET MASK` lines with **one tag-based policy at the catalog**: anything tagged PII gets the mask. A
  newly tagged column is protected the moment it's tagged.
- Row filters work the same way for rows, e.g. replacing `a hand-built row-level-security table`.
- Lock the secret scope down: anyone who queries a masked column needs READ on it, even if their tier never encrypts.
