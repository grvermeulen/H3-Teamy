/**
 * Lists WaAPI instances for your account. Use this to find the correct WAAPI_INSTANCE_ID
 * (the id in the URL path), which is not always the same as a numeric label shown in the UI.
 *
 * Requires only WAAPI_API_TOKEN (same token used for send-message).
 *
 * Usage:
 *   export WAAPI_API_TOKEN="..."
 *   npx tsx scripts/waapi-list-instances.ts
 */

type WaapiInstanceRow = {
  id?: string | number;
  name?: string;
  status?: string;
  phone?: string;
  webhookUrl?: string;
};

type WaapiListInstancesResponse =
  | WaapiInstanceRow[]
  | {
      instances?: WaapiInstanceRow[];
      data?: WaapiInstanceRow[];
      items?: WaapiInstanceRow[];
      result?: WaapiInstanceRow[];
    };

function requiredEnv(name: string): string {
  const value = (process.env[name] || "").trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function normalizeInstances(
  payload: WaapiListInstancesResponse,
): WaapiInstanceRow[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.instances)) return payload.instances;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.result)) return payload.result;
  return [];
}

function formatId(row: WaapiInstanceRow): string {
  if (row.id === undefined || row.id === null) return "(missing-id)";
  return String(row.id);
}

async function main(): Promise<void> {
  const baseUrl = (
    process.env.WAAPI_BASE_URL || "https://waapi.app/api/v1"
  ).replace(/\/$/, "");
  const apiToken = requiredEnv("WAAPI_API_TOKEN");

  const endpoint = `${baseUrl}/instances`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiToken}`,
    },
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`WAAPI list-instances failed: ${response.status} ${details}`);
  }

  const json = (await response.json()) as WaapiListInstancesResponse;
  const rows = normalizeInstances(json);

  if (rows.length === 0) {
    process.stdout.write(
      "No instances returned. Check your API token and WaAPI account.\n",
    );
    return;
  }

  process.stdout.write(
    `Found ${rows.length} instance(s). Use the id in WAAPI_INSTANCE_ID (Vercel / env):\n\n`,
  );
  for (const row of rows) {
    const id = formatId(row);
    const name = (row.name || "").trim() || "(no-name)";
    const status = (row.status || "").trim() || "?";
    const phone = (row.phone || "").trim();
    const phonePart = phone ? `\tphone: ${phone}` : "";
    process.stdout.write(`${id}\t${name}\tstatus: ${status}${phonePart}\n`);
  }
  process.stdout.write(
    "\nThen set WAAPI_INSTANCE_ID to that id and run: npx tsx scripts/waapi-list-groups.ts --filter \"rijn\"\n",
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
