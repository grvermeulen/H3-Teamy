import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sendMatchReportToWhatsAppGroup } from "../src/lib/services/waapiService";

type FixtureEvent = {
  quarter: 1 | 2 | 3 | 4;
  time: string;
  team: "home" | "away";
  type: "goal" | "personal_foul";
  player?: string;
};

type Fixture = {
  screenshotLabel: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  date: string;
  events: FixtureEvent[];
};

type CliOptions = {
  fixtureId: "1" | "2" | "3";
  eventId?: string;
  liveSend: boolean;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv: string[]): CliOptions {
  const argMap = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key.startsWith("--")) continue;
    if (!value || value.startsWith("--")) {
      argMap.set(key, "true");
      continue;
    }
    argMap.set(key, value);
  }

  const fixture = argMap.get("--fixture") ?? "1";
  if (fixture !== "1" && fixture !== "2" && fixture !== "3") {
    throw new Error("Invalid --fixture value. Use 1, 2, or 3.");
  }

  const eventId = argMap.get("--event-id");
  const liveSend = (argMap.get("--live-send") ?? "false") === "true";
  return {
    fixtureId: fixture,
    eventId,
    liveSend,
  };
}

function fixturePath(fixtureId: "1" | "2" | "3"): string {
  return path.resolve(
    __dirname,
    `../src/app/api/report/generate/__fixtures__/waapi-e2e-screenshot-${fixtureId}.json`,
  );
}

async function loadFixture(fixtureId: "1" | "2" | "3"): Promise<Fixture> {
  const raw = await readFile(fixturePath(fixtureId), "utf8");
  return JSON.parse(raw) as Fixture;
}

function isOurTeamName(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized.includes("de rijn");
}

function inferOpponent(fixture: Fixture): string {
  if (isOurTeamName(fixture.homeTeam) && !isOurTeamName(fixture.awayTeam)) {
    return fixture.awayTeam;
  }
  if (!isOurTeamName(fixture.homeTeam) && isOurTeamName(fixture.awayTeam)) {
    return fixture.homeTeam;
  }
  return fixture.awayTeam;
}

function inferScoreFromOurPerspective(fixture: Fixture): {
  ourScore: number;
  opponentScore: number;
} {
  if (isOurTeamName(fixture.homeTeam) && !isOurTeamName(fixture.awayTeam)) {
    return { ourScore: fixture.homeScore, opponentScore: fixture.awayScore };
  }
  if (!isOurTeamName(fixture.homeTeam) && isOurTeamName(fixture.awayTeam)) {
    return { ourScore: fixture.awayScore, opponentScore: fixture.homeScore };
  }
  return { ourScore: fixture.awayScore, opponentScore: fixture.homeScore };
}

function assertLiveSendEnv(): void {
  const required = [
    "WAAPI_E2E_GROUP_CHAT_ID",
    "WAAPI_INSTANCE_ID",
    "WAAPI_API_TOKEN",
    "APP_URL",
  ];
  const missing = required.filter((name) => !(process.env[name] || "").trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing required env var(s) for live send: ${missing.join(", ")}`,
    );
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const fixture = await loadFixture(options.fixtureId);
  const eventId =
    options.eventId ||
    `e2e-waapi-live-fixture-${options.fixtureId}-${Date.now().toString(36)}`;
  const opponentTeam = inferOpponent(fixture);
  const score = inferScoreFromOurPerspective(fixture);
  const groupChatId = (process.env.WAAPI_E2E_GROUP_CHAT_ID || "").trim();
  const appUrl = (process.env.APP_URL || "").trim();

  if (!groupChatId) {
    throw new Error(
      "Missing WAAPI_E2E_GROUP_CHAT_ID. Use a WhatsApp group chat id ending with @g.us (invite links cannot be sent directly).",
    );
  }

  if (!appUrl) {
    throw new Error("Missing APP_URL.");
  }

  if (!options.liveSend) {
    process.stdout.write(
      [
        "WAAPI live send is disabled (dry-run mode).",
        "No WhatsApp message has been sent.",
        `Fixture: ${options.fixtureId} (${fixture.screenshotLabel})`,
        `Group chat id: ${groupChatId}`,
        `Event id: ${eventId}`,
        `Deep link: ${appUrl.replace(/\/$/, "")}/report/${encodeURIComponent(eventId)}`,
        "",
        "To really send to your test group only:",
        "  --live-send true",
      ].join("\n"),
    );
    return;
  }

  assertLiveSendEnv();
  process.env.WAAPI_NOTIFICATIONS_ENABLED = "true";
  process.env.WAAPI_GROUP_CHAT_ID = groupChatId;

  const result = await sendMatchReportToWhatsAppGroup({
    eventId,
    opponentTeam,
    ourScore: score.ourScore,
    opponentScore: score.opponentScore,
  });

  if (!result.sent) {
    throw new Error(
      `WAAPI e2e live send failed: ${result.reason}${result.details ? ` (${result.details})` : ""}`,
    );
  }

  process.stdout.write(
    [
      "WAAPI e2e live send succeeded.",
      `Fixture: ${options.fixtureId} (${fixture.screenshotLabel})`,
      `Group chat id: ${groupChatId}`,
      `Event id: ${eventId}`,
    ].join("\n"),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
