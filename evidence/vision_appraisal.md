# Vision lot appraisal: live model output

Called the Foundation Model serving endpoint (OpenAI-compatible `/serving-endpoints/databricks-claude-sonnet-5/invocations`) with a lot photo and the same appraisal prompt the app's Lot intake page uses (`app/server/routes/appraise-routes.ts`). Captured 2026-10-19.

```text
endpoint: databricks-claude-sonnet-5 | photo: komatsu_pc210_excavator.jpg | latency_s: 5.41
model output:
```json
{
  "category": "Excavator",
  "make": "Komatsu",
  "model": "PC210LC",
  "condition_1_to_5": 3,
  "est_low_usd": 55000,
  "est_high_usd": 80000,
  "rationale": "Komatsu PC210LC is a mid-size (21-ton class) hydraulic excavator. Unit shows visible wear, paint fading, and dirt/mud consistent with active construction use, but appears mechanically intact with no major structural damage visible. Pricing reflects typical used market values for this model/size in fair-to-good working condition, varying with hours and undercarriage wear not visible in photo."
}
```
usage: {"cache_read_input_tokens": 0, "completion_tokens": 226, "prompt_tokens": 1546, "total_tokens": 1772, "cache_creation_input_tokens": 0}
```

The app puts this range next to the category's real auction comps from gold (`app/config/queries/category_comps.obo.sql`).
