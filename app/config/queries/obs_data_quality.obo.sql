-- Latest data-quality result per pipeline expectation, from the auc_demo_elt event log.
WITH e AS (
  SELECT `timestamp`, origin.flow_name AS flow, x.name AS expectation,
         x.passed_records, x.failed_records,
         ROW_NUMBER() OVER (PARTITION BY origin.flow_name, x.name ORDER BY `timestamp` DESC) AS rn
  FROM demo_catalog.auc_gold.event_log_<pipeline_id_with_underscores>
  LATERAL VIEW explode(from_json(get_json_object(details, '$.flow_progress.data_quality.expectations'),
    'array<struct<name:string,dataset:string,passed_records:bigint,failed_records:bigint>>')) t AS x
  WHERE event_type = 'flow_progress' AND get_json_object(details, '$.flow_progress.data_quality.expectations') IS NOT NULL
)
SELECT replace(flow, 'demo_catalog.', '') AS dataset, expectation,
       passed_records, failed_records,
       CAST(`timestamp` AS STRING) AS evaluated_at
FROM e WHERE rn = 1
ORDER BY dataset, expectation
