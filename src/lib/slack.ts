import * as Sentry from "@sentry/nextjs";

type SlackBlock = Record<string, unknown>;

/**
 * Posts a Slack Block Kit message to the workspace incoming-webhook configured
 * in `SLACK_WEBHOOK_URL`. When the env var is missing or the network call
 * fails, returns `{ ok: false, status: 0 }` and logs to Sentry — never throws,
 * so a Slack outage cannot break the cron handler that calls it.
 *
 * @param blocks - Block Kit message blocks.
 * @param text - Fallback `text` shown in notifications and old clients.
 * @returns The response status from Slack (or 0 when unset / failed).
 */
export async function postSlackBlocks(
  blocks: SlackBlock[],
  text = "Weekly H3-Teamy idea report",
): Promise<{ ok: boolean; status: number }> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) {
    return { ok: false, status: 0 };
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, blocks }),
    });
    if (!res.ok) {
      Sentry.captureException(
        new Error(`Slack webhook returned ${res.status}`),
        { tags: { component: "slack" } },
      );
    }
    return { ok: res.ok, status: res.status };
  } catch (err: unknown) {
    Sentry.captureException(err, { tags: { component: "slack" } });
    return { ok: false, status: 0 };
  }
}

type IdeaForSlack = {
  title: string;
  body: string;
  aiSummary: string | null;
  aiTheme: string | null;
  aiImpact: string | null;
  user: { firstName: string; lastName: string };
};

/**
 * Builds a Block Kit payload for the weekly idea digest: a header, then for
 * each theme a section heading and one bullet per idea, followed by a divider.
 * Renders an empty-state message when there are no groups.
 *
 * @param groups - Ideas keyed by AI-derived theme.
 * @param weekLabel - Human-readable label for the period (e.g. "2026-04-18 → 2026-04-25").
 */
export function buildWeeklyIdeaBlocks(
  groups: Record<string, IdeaForSlack[]>,
  weekLabel: string,
): SlackBlock[] {
  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `H3-Teamy ideas — ${weekLabel}` },
    },
  ];
  const themes = Object.keys(groups).sort();
  if (themes.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_No new ideas this week._" },
    });
    return blocks;
  }
  for (const theme of themes) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*${theme}*` },
    });
    for (const idea of groups[theme]) {
      const author =
        `${idea.user.firstName} ${idea.user.lastName}`.trim() || "Someone";
      const summary = idea.aiSummary || idea.body.slice(0, 200);
      const impact = idea.aiImpact ? ` · impact ${idea.aiImpact}` : "";
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `• *${idea.title}* — ${summary}\n_${author}${impact}_`,
        },
      });
    }
    blocks.push({ type: "divider" });
  }
  return blocks;
}
