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
- `REPORT_EXTRACT_OPENAI_MODEL=<model-name>` (optional; default `google/gemini-2.5-flash` wanneer unset — gateway-ids `google/`, `openai/` of `anthropic/` worden gehonoreerd; legacy `gpt-5-chat-latest`/`gpt-5.2-2025-12-11` en `openai/claude-*` worden naar de default gemapt).
- `REPORT_EXTRACT_VISION_FALLBACK_MODEL=<model-name>` (optional; default `openai/gpt-6-luna`; zet op `none` om fallback uit te zetten — één VLM-retry na primaire falen, `fallbackUsed: true`, trace `vision_model_fallback` met `errorClass` + `fallbackModel`).

**Gecontroleerde model-vergelijking (preview):** zet per branch `REPORT_EXTRACT_OPENAI_MODEL` op preview (Vercel dashboard of `vercel env add … --environment preview --git-branch <branch>`), redeploy, `POST /api/report/extract` met hetzelfde bestand; zet **`REPORT_EXTRACT_VISION_FALLBACK_MODEL=none`** op dezelfde branch zodat een enkel-arm niet stil via de code-default fallback (`openai/gpt-6-luna`) kan slagen. Lokaal: `VISION_AB_IMAGE=tests/fixtures/Home-Match-1.JPG npx tsx scripts/run-vision-model-ab-once.ts <model|default>` met `AI_GATEWAY_API_KEY` of Vercel-runtime OIDC (script zet fallback op `none`).

### Flow-telemetrie (screenshot → extract → generate)

- Eén **`flowId`** (client `createReportExtractAttemptId`, headers `X-Report-Flow-Id` / `X-Report-Extract-Attempt`, body `reportFlowId`) koppelt extract, generate en client-traces.
- Server: `report_extract_trace` (extract) en `report_flow_trace` (scope `extract`|`generate`|`client`) met allowlisted `providerTelemetry` (`sdkErrorName`, `upstreamHttpStatus`, `failureKind`, `isRetryable`, request-id uit allowlisted headers, token counts zonder prompt/body).
- App-HTTP (`appHttpStatus` / route status) staat los van `upstreamHttpStatus` (bijv. app 502 `openai_failed` met upstream 429).
- Sentry extras via `sanitizeReportFlowSentryExtra` — geen `info`, prompts, response bodies of modeltekst.
- **Client** `report_flow_trace` (scope `client`) gaat alleen naar de **browserconsole** (admin-UI); zoekbaar in Vercel/serverlogs blijven `report_extract_trace` en `report_flow_trace` met scope `extract`|`generate`. Geen apart telemetry-endpoint.
- **Materialisatie vóór genereren**: bij bestandskeuze wordt een `selectionFlowId` gezet; `materialize_fail`/`materialize_ok` gebruiken die id; dezelfde id wordt bij “Verslag genereren” hergebruikt.
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

- Operational provider 502s (`openai_failed`) log via `report_extract_trace` and a Sentry breadcrumb only — not grouped issues (see JAVASCRIPT-NEXTJS-5J). Misconfiguration and unexpected failures still call `captureException`.
- Structured server log event `report_extract_completed` for successful calls.
- Trace lines `report_extract_trace` with correlators `attemptId`, `requestId`, optional `vercelRequestId` (`x-vercel-id`), phases (`entry`, `multipart_*`, `preprocess_*`, `provider_*`, `completed`/`failed`), allowlisted `errorClass`, and safe image metadata (MIME, bytes, dimensions only — no filenames, pixels, or team/player text).

Clients send header `X-Report-Extract-Attempt` (UUID); responses include `X-Report-Extract-Request-Id` and JSON `diagnostic.supportRef` for UI support references.

Mobile uploads materialize the selected image into an in-memory `File` on selection (`GenerateReportButton` + `reportScreenshotUploadFile.ts`) so uploads do not depend on a stale OS file reference. Multipart parse failures log safe `uploadIngress` metadata (`contentTypeHasBoundary`, `contentLength` present/value).

## Sharing in WhatsApp

Nothing is sent to WhatsApp automatically. After **Verslag genereren**, `GenerateReportButton` shows **Deel in WhatsApp**: a `wa.me` click-to-chat link (`src/lib/whatsappShare.ts`, `MatchReportShareLink`) that opens WhatsApp with the message filled in. The admin picks the team group and taps send. The report page offers the same link so anyone can share it again later.

- `POST /api/report/generate` returns `match` (`opponentTeam`, `ourScore`, `opponentScore`) next to `report`, so the message can name the opponent and score.
- The link is built from the browser's own origin, so it points at the deployment the admin is using (production or preview).
- `/report/[eventId]` exports `generateMetadata` (`src/lib/reportShareMetadata.ts`): title plus the report's opening lines, so WhatsApp shows a preview card. Next.js serves this metadata in `<head>` for WhatsApp's crawler (it is in Next's HTML-limited bot list).

This replaced the WaAPI integration (an unofficial, automated WhatsApp Web session), which risked the linked number being banned.

## Screenshot end-to-end test

`npx vitest run src/app/api/report/generate/route.screenshot-e2e.test.ts`

- Runs the generate route on 3 screenshot-derived fixtures in `src/app/api/report/generate/__fixtures__/screenshot-*.json`.
- Mocks the AI call and storage, and fails on any outbound `fetch`.
- Checks the `match` details returned for sharing.
