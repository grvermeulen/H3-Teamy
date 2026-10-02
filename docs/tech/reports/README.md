# Reports

## Summary

Generate reports for events.

### “Page not found” on `/report/[eventId]`

The report page returns **404** when there is **no report in KV** for that exact `eventId` (same string as in the calendar). It is not a missing Next.js route.

Common causes: verslag never generated on **production**, generated only on **Preview**, or wrong `eventId` in the link. After deploy, ensure an admin uses **Verslag genereren** on **heren-3-de-rijn.com** for that match.

The app uses `await Promise.resolve(params)` for `eventId` so Next.js 15+ async `params` still resolve correctly.

## Entry Points

- UI: `src/components/GenerateReportButton.tsx`, `src/app/report/[eventId]/page.tsx`
- API: `src/app/api/report/**`

## Extract Provider Switch

`/api/report/extract` supports a runtime provider flag so extraction can switch without code changes.

- `REPORT_EXTRACT_PROVIDER=vlm|ocr|hybrid` (default: `vlm`)
- `REPORT_EXTRACT_OPENAI_MODEL=<model-name>` (optional; defaults to `openai/gpt-5.6-sol` when unset. Removed snapshots and non-OpenAI model ids are remapped to this vision-capable default.)
- `REPORT_GENERATE_MODEL=<model-name>` (optional; defaults to `openai/gpt-4o` for `/api/report/generate`. Premium GPT-5 chat ids are remapped in code — see Sentry JAVASCRIPT-NEXTJS-1S.)
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

### Finding the correct `WAAPI_INSTANCE_ID`

The instance id in env must be the **API instance id** (used in URLs like `/instances/{id}/...`), not necessarily a small number shown elsewhere in the WaAPI UI.

List all instances with **only** your API token:

`npx tsx scripts/waapi-list-instances.ts`

(Set `WAAPI_API_TOKEN` first, e.g. from `vercel env pull`.) Copy the **id** column of the instance that is logged in to WhatsApp for the team, then update `WAAPI_INSTANCE_ID` in Vercel (Preview + Production).

WaAPI reference: [list instances](https://waapi.readme.io/reference/list-instances).

### Why notifications previously looked "successful" but were not delivered

The old implementation dispatched the WAAPI send call in fire-and-forget style from `report/generate`.
In serverless runtimes this can be interrupted when the request closes, and non-send outcomes (`disabled`, `missing_config`, `upstream_error`) were not surfaced in the API response.

Current behavior awaits the send result, returns `whatsappNotification` in the JSON (so admins see failures in the UI), and reports non-delivery to Sentry (tag `waapi_notification_reason`).

### Troubleshooting: no message in the group

1. **Wrong `chatId`**: Group JIDs must match what WhatsApp/WaAPI use (often a long number ending in `@g.us`). List groups for this instance:

   ```bash
   export WAAPI_INSTANCE_ID="86986"
   export WAAPI_API_TOKEN="..."   # same token as in Vercel
   npx tsx scripts/waapi-list-groups.ts --limit 400
   ```

   Output is two columns: **`chatId`** (tab) **`groupName`**. Optional: `--filter "rijn"` (case-insensitive substring on name). If you get no rows, try `--verbose true` to see how many chats the API returned.

   Copy the exact `...@g.us` id for your team into `WAAPI_GROUP_CHAT_ID` in Vercel.

2. **HTTP 200 but WaAPI rejects the send**: The API can return `200` with `{ "success": false, "message": "..." }`. The app now treats that as a failed send and surfaces `details` in the response / Sentry.

3. **Config not loaded**: `WAAPI_NOTIFICATIONS_ENABLED` must be exactly `true`, and `APP_URL` must be a full URL (`https://...`) so Zod validation passes.

4. **Instance offline**: If the WaAPI client is disconnected, sends fail until you reconnect (QR) in the WaAPI dashboard.

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
