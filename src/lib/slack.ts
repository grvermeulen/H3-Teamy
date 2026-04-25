type SlackBlock = Record<string, unknown>;

export async function postSlackBlocks(
  blocks: SlackBlock[],
  text = "Weekly H3-Teamy idea report",
): Promise<{ ok: boolean; status: number }> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) {
    return { ok: false, status: 0 };
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, blocks }),
  });
  return { ok: res.ok, status: res.status };
}

type IdeaForSlack = {
  title: string;
  body: string;
  aiSummary: string | null;
  aiTheme: string | null;
  aiImpact: string | null;
  user: { firstName: string; lastName: string };
};

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
