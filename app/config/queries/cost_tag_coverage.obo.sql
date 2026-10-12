-- How much of the spend is attributed by a cost tag vs by resource ID.
-- @param days INT
SELECT attributed_by,
       ROUND(SUM(list_usd), 2) AS list_usd,
       ROUND(SUM(dbus), 2)     AS dbus
FROM demo_catalog.auc_gold.v_demo_cost
WHERE usage_date >= current_date() - :days
GROUP BY attributed_by
