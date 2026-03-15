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

### Why notifications previously looked "successful" but were not delivered

The old implementation dispatched the WAAPI send call in fire-and-forget style from `report/generate`.
In serverless runtimes this can be interrupted when the request closes, and non-send outcomes (`disabled`, `missing_config`, `upstream_error`) were not surfaced in the API response.

Current behavior awaits the send result and reports non-delivery reasons to Sentry while still returning a successful report response.

## WAAPI end-to-end test (safe mode)

Run:

`npx vitest run src/app/api/report/generate/route.waapi-e2e.test.ts`

Safety guarantees in this e2e test:

- Uses 3 screenshot-derived fixtures in `src/app/api/report/generate/__fixtures__/waapi-e2e-screenshot-*.json`.
- Mocks KV storage (`getReport`/`setReport`) so no real report keys are written.
- Mocks WAAPI and OpenAI HTTP calls so no production WhatsApp messages are sent.
- Uses `e2e-waapi-*` event IDs only, to prevent accidental overlap with real match event IDs.

## WAAPI live e2e to a dedicated test group

If you want to send a real test message to a WhatsApp test group, use:

`npx tsx scripts/waapi-e2e-live.ts --fixture 1`

This command is dry-run by default and does not send anything.

To send for real:

`npx tsx scripts/waapi-e2e-live.ts --fixture 1 --live-send true`

Required env vars for live send:

- `WAAPI_E2E_GROUP_CHAT_ID=<group_chat_id@g.us>` (dedicated test group only)
- `WAAPI_INSTANCE_ID=<your_instance_id>`
- `WAAPI_API_TOKEN=<your_waapi_api_token>`
- `APP_URL=https://<your-domain>`

Notes:

- Invite links like `https://chat.whatsapp.com/...` are not direct `chatId` values; convert/copy the actual `...@g.us` id from your WAAPI tooling first.
- Live e2e uses only generated `e2e-waapi-live-*` event IDs and calls the WAAPI service directly, so it does not overwrite production match report keys.
