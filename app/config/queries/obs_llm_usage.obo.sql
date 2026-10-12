-- LLM calls through the governed serving endpoint: who called it, volume, tokens, errors.
SELECT u.requester,
       COUNT(*)                   AS requests,
       SUM(u.input_token_count)   AS input_tokens,
       SUM(u.output_token_count)  AS output_tokens,
       SUM(CASE WHEN u.status_code <> 200 THEN 1 ELSE 0 END) AS errors,
       CAST(MAX(u.request_time) AS STRING) AS last_request
FROM system.serving.endpoint_usage u
JOIN system.serving.served_entities s ON s.served_entity_id = u.served_entity_id
WHERE s.endpoint_name = 'databricks-claude-sonnet-5'
  AND u.request_time >= current_timestamp() - INTERVAL 30 DAYS
  AND u.requester IN ('<your-email>', '<app-service-principal-id>')
GROUP BY u.requester
