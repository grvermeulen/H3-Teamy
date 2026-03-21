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
      data?: WaapiChat[] | Record<string, unknown>;
      items?: WaapiChat[];
      result?: WaapiChat[];
    };

type CliOptions = {
  filter: string;
  limit: number;
  verbose: boolean;
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
    verbose: values.get("--verbose") === "true",
  };
}

function requiredEnv(name: string): string {
  const value = (process.env[name] || "").trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function isChatLikeEntry(value: unknown): value is WaapiChat {
  if (typeof value !== "object" || value === null) return false;
  const id = (value as WaapiChat).id;
  return typeof id === "string" && id.length > 0;
}

/**
 * Finds arrays of chat-like objects anywhere in the JSON tree (handles nested `data`, etc.).
 */
function collectChatArrays(value: unknown, depth: number): WaapiChat[][] {
  if (depth > 8 || value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every(isChatLikeEntry)) {
      return [value];
    }
    const nested: WaapiChat[][] = [];
    for (const el of value) {
      nested.push(...collectChatArrays(el, depth + 1));
    }
    return nested;
  }
  if (typeof value === "object") {
    const nested: WaapiChat[][] = [];
    for (const v of Object.values(value as Record<string, unknown>)) {
      nested.push(...collectChatArrays(v, depth + 1));
    }
    return nested;
  }
  return [];
}

function normalizeChats(payload: unknown): WaapiChat[] {
  if (payload === null || payload === undefined) return [];

  if (Array.isArray(payload) && payload.every(isChatLikeEntry)) {
    return payload;
  }

  if (typeof payload === "object" && !Array.isArray(payload)) {
    const p = payload as WaapiGetChatsResponse;
    if (Array.isArray(p.chats)) return p.chats;
    if (Array.isArray(p.items)) return p.items;
    if (Array.isArray(p.result)) return p.result;
    if (Array.isArray(p.data)) return p.data;

    if (p.data && typeof p.data === "object" && !Array.isArray(p.data)) {
      const inner = p.data as Record<string, unknown>;
      if (Array.isArray(inner.chats)) return inner.chats as WaapiChat[];
      if (Array.isArray(inner.data)) return inner.data as WaapiChat[];
    }
  }

  const candidates = collectChatArrays(payload, 0);
  if (candidates.length === 0) return [];
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0] ?? [];
}

function displayName(chat: WaapiChat): string {
  return (chat.name || chat.subject || chat.pushName || "").trim();
}

function summarizePayloadKeys(payload: unknown): string {
  try {
    if (payload === null || payload === undefined) return "empty";
    if (Array.isArray(payload)) return `array(length=${payload.length})`;
    if (typeof payload === "object") {
      return `keys: ${Object.keys(payload as object).join(", ")}`;
    }
    return typeof payload;
  } catch {
    return "unreadable";
  }
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

  const json: unknown = await response.json();
  const chats = normalizeChats(json);
  const groups = chats.filter((chat) => (chat.id || "").endsWith("@g.us"));
  const filtered = options.filter
    ? groups.filter((chat) =>
        displayName(chat).toLowerCase().includes(options.filter),
      )
    : groups;

  if (options.verbose) {
    process.stderr.write(
      `[verbose] Top-level ${summarizePayloadKeys(json)}\n[verbose] Parsed ${chats.length} chat(s), ${groups.length} group(s)\n`,
    );
  }

  if (filtered.length === 0) {
    process.stdout.write(
      "No group chats found for the current filter. Try without --filter, or use --verbose true to inspect the API response.\n",
    );
    if (groups.length === 0 && chats.length > 0) {
      process.stdout.write(
        `\nNote: ${chats.length} non-group chat(s) were returned (no id ending with @g.us).\n`,
      );
    }
    return;
  }

  process.stdout.write(
    `chatId\tgroupName\n${filtered.map((g) => `${g.id || "(missing-id)"}\t${displayName(g) || "(no-name)"}`).join("\n")}\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
