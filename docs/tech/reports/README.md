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
