CREATE OR REPLACE VIEW demo_catalog.auc_gold.v_demo_cost
COMMENT 'AuctionCo demo cost attribution. Tag-first (custom_tags project=auctionco from the serverless usage policy), falling back to resource IDs for usage recorded before tagging.'
AS
WITH u AS (
  SELECT u.*,
    CASE
      WHEN u.custom_tags['project'] = 'auctionco' THEN coalesce(u.custom_tags['workload'], initcap(lower(u.billing_origin_product)))
      WHEN u.usage_metadata.dlt_pipeline_id = '<pipeline-id>' THEN 'ELT pipeline (auc_demo_elt)'
      WHEN u.usage_metadata.app_name = 'buyer-360' THEN 'Buyer 360 app'
      WHEN u.usage_metadata.app_name = 'cost-app' THEN 'Cost app (retired)'
      WHEN u.usage_metadata.project_id = '<lakebase-project-uid>' THEN 'Lakebase serving (auction-recs)'
      WHEN u.usage_metadata.genie.agent_id = '<genie-space-id>' THEN 'Genie space (Auction Analytics)'
      WHEN u.usage_metadata.endpoint_name = 'databricks-claude-sonnet-5'
           AND u.identity_metadata.run_as IN ('<your-email>', '<app-service-principal-id>')
           THEN 'AI: Claude Sonnet 5'
    END AS workload,
    CASE WHEN u.custom_tags['project'] = 'auctionco' THEN 'tag' ELSE 'resource id' END AS attributed_by
  FROM system.billing.usage u
  WHERE u.usage_date >= current_date() - INTERVAL 60 DAYS
)
SELECT u.usage_date, u.workload, u.attributed_by, u.billing_origin_product, u.sku_name,
       u.custom_tags['cost_center'] AS cost_center,
       SUM(u.usage_quantity) AS dbus,
       SUM(u.usage_quantity * coalesce(CAST(lp.pricing.default AS DOUBLE), 0)) AS list_usd
FROM u
LEFT JOIN system.billing.list_prices lp
  ON u.sku_name = lp.sku_name
 AND u.usage_end_time >= lp.price_start_time
 AND (lp.price_end_time IS NULL OR u.usage_end_time < lp.price_end_time)
WHERE u.workload IS NOT NULL
GROUP BY ALL
