type WaapiChat = {
  id?: string;
  name?: string;
  pushName?: string;
  subject?: string;
  archived?: boolean;
};

type WaapiGetChatsResponse =
  | WaapiChat[]
  | {
      chats?: WaapiChat[];
      data?: WaapiChat[];
      items?: WaapiChat[];
      result?: WaapiChat[];
    };

type CliOptions = {
  filter: string;
  limit: number;
};

function parseArgs(argv: string[]): CliOptions {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key.startsWith("--")) continue;
    if (!value || value.startsWith("--")) {
      values.set(key, "true");
      continue;
    }
    values.set(key, value);
  }

  const rawLimit = Number(values.get("--limit") || "200");
  return {
    filter: (values.get("--filter") || "").trim().toLowerCase(),
    limit:
      Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 200,
  };
}

function requiredEnv(name: string): string {
  const value = (process.env[name] || "").trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function normalizeChats(payload: WaapiGetChatsResponse): WaapiChat[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.chats)) return payload.chats;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.result)) return payload.result;
  return [];
}

function displayName(chat: WaapiChat): string {
  return (chat.name || chat.subject || chat.pushName || "").trim();
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const baseUrl = (
    process.env.WAAPI_BASE_URL || "https://waapi.app/api/v1"
  ).replace(/\/$/, "");
  const instanceId = requiredEnv("WAAPI_INSTANCE_ID");
  const apiToken = requiredEnv("WAAPI_API_TOKEN");

  const endpoint = `${baseUrl}/instances/${encodeURIComponent(instanceId)}/client/action/get-chats`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${apiToken}`,
    },
    body: JSON.stringify({ limit: options.limit }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`WAAPI get-chats failed: ${response.status} ${details}`);
  }

  const json = (await response.json()) as WaapiGetChatsResponse;
  const chats = normalizeChats(json);
  const groups = chats.filter((chat) => (chat.id || "").endsWith("@g.us"));
  const filtered = options.filter
    ? groups.filter((chat) =>
        displayName(chat).toLowerCase().includes(options.filter),
      )
    : groups;

  if (filtered.length === 0) {
    process.stdout.write(
      "No group chats found for the current filter. Try without --filter.\n",
    );
    return;
  }

  process.stdout.write(`Found ${filtered.length} group chat(s):\n`);
  for (const group of filtered) {
    process.stdout.write(
      `${group.id || "(missing-id)"}\t${displayName(group) || "(no-name)"}\n`,
    );
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
