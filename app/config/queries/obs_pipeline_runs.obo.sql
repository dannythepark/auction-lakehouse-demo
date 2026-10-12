-- Recent auc_demo_elt updates: outcome and wall-clock duration, from the event log.
SELECT origin.update_id AS update_id,
       CAST(MIN(`timestamp`) AS STRING) AS started_at,
       MAX_BY(get_json_object(details, '$.update_progress.state'), `timestamp`) AS final_state,
       ROUND((unix_millis(MAX(`timestamp`)) - unix_millis(MIN(`timestamp`))) / 1000.0, 0) AS duration_s
FROM demo_catalog.auc_gold.event_log_<pipeline_id_with_underscores>
WHERE event_type = 'update_progress'
GROUP BY origin.update_id
ORDER BY started_at DESC
LIMIT 10
