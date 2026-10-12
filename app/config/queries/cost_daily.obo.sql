-- Daily list-price $ by workload (for the stacked trend).
-- @param days INT
SELECT CAST(usage_date AS STRING) AS usage_date,
       workload,
       ROUND(SUM(list_usd), 2) AS list_usd
FROM demo_catalog.auc_gold.v_demo_cost
WHERE usage_date >= current_date() - :days
GROUP BY usage_date, workload
ORDER BY usage_date
