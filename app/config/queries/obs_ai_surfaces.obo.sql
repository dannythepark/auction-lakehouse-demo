-- Governed data access by surface, scoped to this demo's surfaces: the Auction
-- Analytics Genie space, the Buyer 360 app (AppKit), and the two persona service
-- principals. Genie statement text is redacted, but the space ID is recorded.
SELECT CASE
         WHEN query_source.genie_space_id = '<genie-space-id>' THEN 'Genie (Auction Analytics)'
         WHEN client_application = '@databricks' THEN 'Buyer 360 app'
         WHEN executed_by = '<data-team-sp-id>' THEN 'Data-team SP (SQL connector)'
         WHEN executed_by = '<business-sp-id>' THEN 'Business SP (SQL connector)'
       END AS surface,
       COUNT(*) AS queries,
       SUM(read_rows) AS rows_read,
       CAST(PERCENTILE(total_duration_ms, 0.5) AS BIGINT) AS p50_ms,
       SUM(CASE WHEN execution_status = 'FAILED' THEN 1 ELSE 0 END) AS failed,
       CAST(MAX(start_time) AS STRING) AS last_query
FROM system.query.history
WHERE start_time >= current_timestamp() - INTERVAL 30 DAYS
  AND (query_source.genie_space_id = '<genie-space-id>'
       OR (client_application = '@databricks' AND compute.warehouse_id = '<warehouse-id>')
       OR executed_by IN ('<data-team-sp-id>', '<business-sp-id>'))
GROUP BY ALL
ORDER BY queries DESC
