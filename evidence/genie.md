# Genie Agent: space definition and live answers

## Space definition (exported with `databricks genie get-space --include-serialized-space`)

Title: **AuctionCo Auction Analytics** · warehouse: `<warehouse-id>`

```json
{
 "version": 2,
 "config": {
  "sample_questions": [
   {
    "id": "a0000000000000000000000000000001",
    "question": [
     "What was total GMV by category last month?"
    ]
   },
   {
    "id": "a0000000000000000000000000000002",
    "question": [
     "Which equipment category has the most active bidders?"
    ]
   },
   {
    "id": "a0000000000000000000000000000003",
    "question": [
     "Show the top 10 accounts by total bids"
    ]
   }
  ]
 },
 "data_sources": {
  "tables": [
   {
    "identifier": "demo_catalog.auc_gold.fact_bids"
   },
   {
    "identifier": "demo_catalog.auc_gold.metrics_auction"
   },
   {
    "identifier": "demo_catalog.auc_gold.v_account_360"
   }
  ]
 },
 "instructions": {
  "text_instructions": [
   {
    "id": "b0000000000000000000000000000001",
    "content": [
     "Use the metric view metrics_auction for GMV, Total Bids, Active Bidders and Avg Bid; group by its Category / Bidder State / Bid Date dimensions.Account PII (first_name, last_name, email, phone, tax_id) in v_account_360 is governed by a Unity Catalog column mask: authorized users see plaintext, everyone else sees encrypted values. Never attempt to decrypt or work around the mask."
    ]
   }
  ]
 }
}
```

## Live question 1 · as the data-team user (Genie Conversation API, `genie start-conversation`)

**Question:** What was total GMV by equipment category? Show the top 5.
**Status:** COMPLETED · rows returned: 5

Genie chose the governed **metric view** (`MEASURE(GMV)`) rather than re-deriving GMV:

```sql
WITH `ranked_categories` AS (
  SELECT
    `Category`,
    MEASURE(`GMV`) AS `total_gmv`,
    RANK() OVER (ORDER BY MEASURE(`GMV`) DESC) AS `gmv_rank`
  FROM `demo_catalog`.`auc_gold`.`metrics_auction`
  WHERE `Category` IS NOT NULL
  GROUP BY ALL
)
SELECT
  `Category`,
  `total_gmv`
FROM `ranked_categories`
WHERE `gmv_rank` <= 5
ORDER BY `gmv_rank` ASC, `Category` ASC;
```

**Answer text:**

The top 5 equipment categories by **total GMV** are:
- **Skid Steer** — **$380,113,804.70**
- **Excavator** — **$376,617,164.57**
- **Semi Truck** — **$369,241,981.91**
- **Loader** — **$365,273,017.51**
- **Trailer** — **$356,753,511.03**

Across these 5 categories, **Skid Steer** is highest and **Trailer** is lowest, with all five totals falling in a relatively tight range of about **$357M to $380M**.

## Live question 2 · as the Marketing rep (through the deployed app, `POST /api/genie/as-marketing`)

This route runs Genie as the app's service principal, which sits in the partial-PII tier. Genie wrote SQL against `v_account_360` that selects phone and tax ID in full. **Unity Catalog's column masks still returned only the last 4 digits.** The AI can't leak data the asker isn't entitled to.

**Question:** Show the name, email, phone and tax ID of the 3 buyers with the most bids
**Ran as:** Marketing rep (app service principal)

```sql
WITH ranked_buyers AS (
  SELECT
    `first_name`,
    `last_name`,
    `email`,
    `phone`,
    `tax_id`,
    `total_bids`,
    RANK() OVER (ORDER BY `total_bids` DESC) AS `bid_rank`
  FROM `demo_catalog`.`auc_gold`.`v_account_360`
  WHERE `account_type` ILIKE '%buyer%' AND `total_bids` IS NOT NULL
)
SELECT `first_name`, `last_name`, `email`, `phone`, `tax_id`, `total_bids`
FROM ranked_buyers
WHERE `bid_rank` <= 3
ORDER BY `total_bids` DESC
```

| first_name | last_name | email | phone | tax_id | total_bids |
|---|---|---|---|---|---|
| Jennifer | Rodriguez | jennifer.rodriguez1269@example.com | ••••••••4381 | •••••1343 | 399 |
| Karen | Martinez | karen.martinez1365@example.com | ••••••••0080 | •••••7577 | 399 |
| Barbara | Anderson | barbara.anderson664@example.com | ••••••••8955 | •••••2076 | 398 |
| Elizabeth | Johnson | elizabeth.johnson800@example.com | ••••••••4823 | •••••3082 | 398 |
| John | Miller | john.miller1271@example.com | ••••••••9370 | •••••9339 | 398 |
| Patricia | Smith | patricia.smith1747@example.com | ••••••••5093 | •••••6356 | 398 |
| Karen | Thomas | karen.thomas1819@example.com | ••••••••0022 | •••••6344 | 398 |
| Mary | Hernandez | mary.hernandez2150@example.com | ••••••••1108 | •••••9467 | 398 |
| Robert | Davis | robert.davis2405@example.com | ••••••••3035 | •••••9166 | 398 |
| Michael | Johnson | michael.johnson3559@example.com | ••••••••3184 | •••••2761 | 398 |

**Answer text:**

You're looking for the name, email, phone number, and tax ID of the top 3 buyers ranked by their total number of bids.
The request asked for the top 3 buyers by bid count, but due to a tie at 398 total bids, 10 buyers qualify for the top 3 ranks. The leading buyers are **Jennifer Rodriguez** and **Karen Martinez**, each with **399 bids**, followed by eight tied buyers—including **Barbara Anderson**, **Elizabeth Johnson**, and **John Miller**—each with **398 bids**. For all buyers shown, phone numbers and tax IDs appear masked (e.g., showing only the last 4 digits), as this personal information is protected and only visible in plaintext to authorized users.
Would you prefer the ranking to be based on actual bid counts from the bid activity records instead of the stored total bids figure?

(All names are synthetic, generated by `notebooks/00_setup_and_synthetic_data.py`.)
