# Reports

## Summary

Generate reports for events.

## Entry Points

- UI: `src/components/GenerateReportButton.tsx`, `src/app/report/[eventId]/page.tsx`
- API: `src/app/api/report/**`

## WhatsApp Notification (WaAPI)

After a successful report generation, the API can send a WhatsApp group notification with a deep link to the report.

Required environment variables:

- `WAAPI_NOTIFICATIONS_ENABLED=true`
- `WAAPI_INSTANCE_ID=<your_instance_id>`
- `WAAPI_API_TOKEN=<your_waapi_api_token>`
- `WAAPI_GROUP_CHAT_ID=1467733237@g.us`
- `APP_URL=https://<your-domain>`

Optional:

- `WAAPI_BASE_URL=https://waapi.app/api/v1` (defaults to this value)
