-- Cost per demo workload over the window, from auc_gold.v_demo_cost
-- (system.billing.usage x list_prices, tag-first attribution).
-- @param days INT
SELECT workload,
       ROUND(SUM(dbus), 2)     AS dbus,
       ROUND(SUM(list_usd), 2) AS list_usd,
       MAX(attributed_by)      AS attributed_by,
       CAST(MAX(usage_date) AS STRING) AS last_usage
FROM demo_catalog.auc_gold.v_demo_cost
WHERE usage_date >= current_date() - :days
GROUP BY workload
ORDER BY list_usd DESC
