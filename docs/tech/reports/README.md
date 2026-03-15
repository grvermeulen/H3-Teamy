# Reports

## Summary

Generate reports for events.

## Entry Points

- UI: `src/components/GenerateReportButton.tsx`, `src/app/report/[eventId]/page.tsx`
- API: `src/app/api/report/**`

## Extract Provider Switch

`/api/report/extract` supports a runtime provider flag so extraction can switch without code changes.

- `REPORT_EXTRACT_PROVIDER=vlm|ocr|hybrid` (default: `vlm`)
- `REPORT_EXTRACT_OPENAI_MODEL=<model-name>` (required)
- `OPENAI_API_KEY=<secret>` (required)
- `OCR_WORKER_URL=<url>` (required for `ocr` and `hybrid`)
- `OCR_WORKER_TOKEN=<token>` (required for `ocr` and `hybrid`)

### Behavior

- `vlm`: sends the uploaded image directly to the OpenAI vision-capable model.
- `ocr`: sends image to OCR worker, then normalizes OCR text via OpenAI.
- `hybrid`: tries `vlm` first, falls back to `ocr` on failure.

### Rollback

If the VLM path fails in production, set:

`REPORT_EXTRACT_PROVIDER=ocr`

No deploy is needed when env vars can be changed at runtime by your platform.

### Observability

The extract route records:

- Sentry exceptions with provider/model/fallback/latency metadata.
- Structured server log event `report_extract_completed` for successful calls.

## WhatsApp Notification (WaAPI)

After a successful report generation, the API can send a WhatsApp group notification with a deep link to the report.

Required environment variables:

- `WAAPI_NOTIFICATIONS_ENABLED=true`
- `WAAPI_INSTANCE_ID=<your_instance_id>`
- `WAAPI_API_TOKEN=<your_waapi_api_token>`
- `WAAPI_GROUP_CHAT_ID=<your_group_chat_id>` (e.g. `1234567890@g.us`)
- `APP_URL=https://<your-domain>`

Optional:

- `WAAPI_BASE_URL=https://waapi.app/api/v1` (defaults to this value)
