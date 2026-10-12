-- Databricks notebook source
-- MAGIC %md
-- MAGIC # 03 · PII tagging and masking, step by step
-- MAGIC
-- MAGIC The goal the engineering lead described: **one table, one set of views, no copies.** The data team sees all 20 columns.
-- MAGIC Everyone else sees the same 20 columns, with the 5 sensitive ones protected.
-- MAGIC
-- MAGIC | Step | What happens |
-- MAGIC |---|---|
-- MAGIC | 1 | Look at the account table: 20 columns, 5 of them PII |
-- MAGIC | 2 | **Tag** the 5 PII columns |
-- MAGIC | 3 | Decide **who's in which tier** |
-- MAGIC | 4 | Write the **mask functions**: one rule per kind of column |
-- MAGIC | 5 | **Attach** the masks to the table |
-- MAGIC | 6 | See what I get back |
-- MAGIC | 7 | Run the same query **as all three tiers** |
-- MAGIC | 8 | Tags, masks and results **side by side** |

-- COMMAND ----------

-- MAGIC %md
-- MAGIC ## 1 · The account table: 20 columns, 5 of them PII
-- MAGIC `auc_silver.dim_account` is the SCD2 account dimension built by the pipeline. `first_name`, `last_name`,
-- MAGIC `email`, `phone` and `tax_id` are the sensitive ones.

-- COMMAND ----------

-- DBTITLE 1,Cell 1 · The account table (20 columns)
SELECT account_id, first_name, last_name, email, phone, tax_id,
       company_name, city, state, zip, country, account_type, status,
       registration_date, buyer_rating, seller_rating, total_bids, total_purchases, updated_at, _source_file
FROM demo_catalog.auc_silver.dim_account
WHERE __END_AT IS NULL
ORDER BY account_id
LIMIT 5;


-- COMMAND ----------

-- MAGIC %md
-- MAGIC ## 2 · Tag the five PII columns
-- MAGIC Tags are governed objects in Unity Catalog. They're queryable, visible in Catalog Explorer, and they're what a
-- MAGIC catalog-wide masking policy keys off in production. (Key `auc_pii` here because this shared demo metastore already
-- MAGIC has a policy on `pii`; in AuctionCo's account it's your own `pii` taxonomy.)

-- COMMAND ----------

-- DBTITLE 1,Cell 2 · Tag the five PII columns
ALTER TABLE demo_catalog.auc_silver.dim_account ALTER COLUMN first_name SET TAGS ('auc_pii' = 'name');
ALTER TABLE demo_catalog.auc_silver.dim_account ALTER COLUMN last_name  SET TAGS ('auc_pii' = 'name');
ALTER TABLE demo_catalog.auc_silver.dim_account ALTER COLUMN email      SET TAGS ('auc_pii' = 'email');
ALTER TABLE demo_catalog.auc_silver.dim_account ALTER COLUMN phone      SET TAGS ('auc_pii' = 'phone');
ALTER TABLE demo_catalog.auc_silver.dim_account ALTER COLUMN tax_id     SET TAGS ('auc_pii' = 'government_id');


-- COMMAND ----------

-- DBTITLE 1,Cell 3 · The tags on the table
SELECT column_name, tag_name, tag_value
FROM demo_catalog.information_schema.column_tags
WHERE schema_name = 'auc_silver' AND table_name = 'dim_account' AND tag_name = 'auc_pii'
ORDER BY column_name;


-- COMMAND ----------

-- MAGIC %md
-- MAGIC ## 3 · Who's in which tier
-- MAGIC Three tiers. In this demo workspace they're two small allowlist tables, because account groups aren't federated here.
-- MAGIC In AuctionCo's account they're **groups from your identity provider** (`auc_data_team`, `auc_marketing`), with OpenFGA
-- MAGIC generating the membership if you adopt it.
-- MAGIC
-- MAGIC | Tier | Names & email | Phone & tax ID |
-- MAGIC |---|---|---|
-- MAGIC | **Data team** | plaintext | plaintext |
-- MAGIC | **Marketing** (partial) | plaintext | last 4 digits only |
-- MAGIC | **Everyone else** | encrypted | encrypted |

-- COMMAND ----------

-- DBTITLE 1,Cell 4 · Who's in which tier
SELECT 'Data team (full PII)' AS tier, principal, CAST(NULL AS STRING) AS persona FROM demo_catalog.auc_gov.pii_authorized
UNION ALL
SELECT 'Marketing (partial PII)', principal, persona FROM demo_catalog.auc_gov.pii_partial;


-- COMMAND ----------

-- MAGIC %md
-- MAGIC ## 4 · The mask functions: one rule per kind of column
-- MAGIC Each function decides, **per person running the query**, what comes back. The encrypted value is still a string, so
-- MAGIC nothing downstream breaks, and the data is kept, not dropped. The key lives in a secret scope, not in code.

-- COMMAND ----------

-- DBTITLE 1,Cell 5 · Rule for names and email
-- names and email
CREATE OR REPLACE FUNCTION demo_catalog.auc_gov.enc_pii(v STRING)
  RETURNS STRING
  COMMENT 'Names / email: plaintext for the data team and the partial tier; AES-GCM ciphertext for everyone else'
  RETURN CASE
    WHEN current_user() IN (SELECT principal FROM demo_catalog.auc_gov.pii_authorized) THEN v
    WHEN current_user() IN (SELECT principal FROM demo_catalog.auc_gov.pii_partial)    THEN v
    ELSE base64(aes_encrypt(v, secret('auc_pii_demo','cmk'), 'GCM'))
  END;


-- COMMAND ----------

-- DBTITLE 1,Cell 6 · Rule for phone and tax ID
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


-- COMMAND ----------

-- MAGIC %md
-- MAGIC ## 5 · Attach the masks to the table, not to a view
-- MAGIC Because the rule lives on the table, every view, dashboard, Genie space, app and AI tool that reads it gets the
-- MAGIC same answer for the same person.

-- COMMAND ----------

-- DBTITLE 1,Cell 7 · Attach the masks to the table
ALTER TABLE demo_catalog.auc_silver.dim_account ALTER COLUMN first_name SET MASK demo_catalog.auc_gov.enc_pii;
ALTER TABLE demo_catalog.auc_silver.dim_account ALTER COLUMN last_name  SET MASK demo_catalog.auc_gov.enc_pii;
ALTER TABLE demo_catalog.auc_silver.dim_account ALTER COLUMN email      SET MASK demo_catalog.auc_gov.enc_pii;
ALTER TABLE demo_catalog.auc_silver.dim_account ALTER COLUMN phone      SET MASK demo_catalog.auc_gov.mask_last4;
ALTER TABLE demo_catalog.auc_silver.dim_account ALTER COLUMN tax_id     SET MASK demo_catalog.auc_gov.mask_last4;


-- COMMAND ----------

-- DBTITLE 1,Cell 8 · The masks on the table
SELECT column_name, mask_name
FROM demo_catalog.information_schema.column_masks
WHERE table_schema = 'auc_silver' AND table_name = 'dim_account'
ORDER BY column_name;


-- COMMAND ----------

-- MAGIC %md
-- MAGIC ## 6 · What comes back
-- MAGIC First, **me**. I'm on the data team, so I see everything, through the plain `v_account_360` view.

-- COMMAND ----------

-- DBTITLE 1,Cell 9 · Who am I?
SELECT current_user() AS running_as,
       CASE WHEN current_user() IN (SELECT principal FROM demo_catalog.auc_gov.pii_authorized) THEN 'Data team (full PII)'
            WHEN current_user() IN (SELECT principal FROM demo_catalog.auc_gov.pii_partial)    THEN 'Marketing (partial PII)'
            ELSE 'Everyone else (encrypted)' END AS my_tier;


-- COMMAND ----------

-- DBTITLE 1,Cell 10 · What I see
SELECT account_id, first_name, last_name, email, phone, tax_id, state, account_type
FROM demo_catalog.auc_gold.v_account_360
WHERE account_id IN (1248, 1269, 3559)
ORDER BY account_id;


-- COMMAND ----------

-- MAGIC %md
-- MAGIC ## 7 · The same query, run as all three tiers
-- MAGIC Now the real thing. The identical query runs as three real identities, the same ones the Buyer 360 app uses:
-- MAGIC
-- MAGIC | Tier | Identity |
-- MAGIC |---|---|
-- MAGIC | Data team | me (the notebook runner) |
-- MAGIC | Marketing | the Buyer 360 app's service principal, the app's *View as → Marketing rep* |
-- MAGIC | Everyone else | the business service principal |
-- MAGIC
-- MAGIC Each service principal gets a short-lived OAuth secret for this cell, and it's deleted at the end.

-- COMMAND ----------

-- DBTITLE 1,Cell 11 · Run the same query as all three tiers
-- MAGIC %python
-- MAGIC import pandas as pd
-- MAGIC from databricks.sdk import WorkspaceClient
-- MAGIC
-- MAGIC w = WorkspaceClient()
-- MAGIC WAREHOUSE = "<warehouse-id>"
-- MAGIC QUERY = """
-- MAGIC SELECT account_id, first_name, last_name, email, phone, tax_id, state
-- MAGIC FROM demo_catalog.auc_gold.v_account_360
-- MAGIC WHERE account_id IN (1248, 1269, 3559)
-- MAGIC ORDER BY account_id
-- MAGIC """
-- MAGIC TIERS = {
-- MAGIC     "Data team (me)": None,
-- MAGIC     "Marketing (app SP)": "<app-service-principal-id>",
-- MAGIC     "Everyone else (business SP)": "<business-sp-id>",
-- MAGIC }
-- MAGIC
-- MAGIC def run(client, sql):
-- MAGIC     r = client.statement_execution.execute_statement(statement=sql, warehouse_id=WAREHOUSE, wait_timeout="50s")
-- MAGIC     if r.status.state.value != "SUCCEEDED":
-- MAGIC         raise RuntimeError(r.status.error.message if r.status.error else r.status.state.value)
-- MAGIC     return pd.DataFrame(r.result.data_array or [], columns=[c.name for c in r.manifest.schema.columns])
-- MAGIC
-- MAGIC results = {}
-- MAGIC for tier, app_id in TIERS.items():
-- MAGIC     if app_id is None:
-- MAGIC         results[tier] = (w.current_user.me().user_name, run(w, QUERY))
-- MAGIC         continue
-- MAGIC     sp = next(iter(w.service_principals.list(filter=f'applicationId eq "{app_id}"')))
-- MAGIC     path = f"/api/2.0/accounts/servicePrincipals/{sp.id}/credentials/secrets"
-- MAGIC     sec = w.api_client.do("POST", path)
-- MAGIC     try:
-- MAGIC         c = WorkspaceClient(host=w.config.host, client_id=app_id, client_secret=sec["secret"], auth_type="oauth-m2m")
-- MAGIC         results[tier] = (run(c, "SELECT current_user() AS u").iloc[0, 0], run(c, QUERY))
-- MAGIC     finally:
-- MAGIC         w.api_client.do("DELETE", f"{path}/{sec['id']}")
-- MAGIC
-- MAGIC display(pd.DataFrame([{"tier": t, "Unity Catalog saw": who} for t, (who, _) in results.items()]))


-- COMMAND ----------

-- MAGIC %md
-- MAGIC ### Data team: everything in plaintext

-- COMMAND ----------

-- DBTITLE 1,Cell 12 · Data team result
-- MAGIC %python
-- MAGIC display(results["Data team (me)"][1])


-- COMMAND ----------

-- MAGIC %md
-- MAGIC ### Marketing: names and email, phone and tax ID masked to the last 4
-- MAGIC Exactly what the Buyer 360 app shows under *View as → Marketing rep*.

-- COMMAND ----------

-- DBTITLE 1,Cell 13 · Marketing result
-- MAGIC %python
-- MAGIC display(results["Marketing (app SP)"][1])


-- COMMAND ----------

-- MAGIC %md
-- MAGIC ### Everyone else: all five encrypted, every other column untouched

-- COMMAND ----------

-- DBTITLE 1,Cell 14 · Everyone-else result
-- MAGIC %python
-- MAGIC display(results["Everyone else (business SP)"][1])


-- COMMAND ----------

-- MAGIC %md
-- MAGIC ## 8 · Tags, masks and what each tier got, side by side (buyer #1248)
-- MAGIC One row per PII column: the tag on it, the policy that masks it, and the value each identity actually received.

-- COMMAND ----------

-- DBTITLE 1,Cell 15 · Side by side: tag, mask, what each tier got
-- MAGIC %python
-- MAGIC tags  = run(w, "SELECT column_name, tag_value FROM demo_catalog.information_schema.column_tags "
-- MAGIC                "WHERE schema_name='auc_silver' AND table_name='dim_account' AND tag_name='auc_pii'")
-- MAGIC masks = run(w, "SELECT column_name, mask_name FROM demo_catalog.information_schema.column_masks "
-- MAGIC                "WHERE table_schema='auc_silver' AND table_name='dim_account'")
-- MAGIC rows = []
-- MAGIC for col in ["first_name", "last_name", "email", "phone", "tax_id"]:
-- MAGIC     row = {"column": col,
-- MAGIC            "auc_pii tag": tags.loc[tags.column_name == col, "tag_value"].iloc[0],
-- MAGIC            "mask policy": masks.loc[masks.column_name == col, "mask_name"].iloc[0].split(".")[-1]}
-- MAGIC     for tier, (_, df) in results.items():
-- MAGIC         row[tier] = df.loc[df.account_id == "1248", col].iloc[0]
-- MAGIC     rows.append(row)
-- MAGIC display(pd.DataFrame(rows))


-- COMMAND ----------

-- MAGIC %md
-- MAGIC ## In production
-- MAGIC - Swap each allowlist check for `is_account_group_member('auc_data_team')` / `('auc_marketing')`.
-- MAGIC - Replace the five `SET MASK` lines with **one tag-based policy at the catalog**: anything tagged PII gets the mask. A
-- MAGIC   newly tagged column is protected the moment it's tagged.
-- MAGIC - Row filters work the same way for rows, e.g. replacing `a hand-built row-level-security table`.
-- MAGIC - Lock the secret scope down: anyone who queries a masked column needs READ on it, even if their tier never encrypts.
