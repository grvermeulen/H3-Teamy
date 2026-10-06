import { JEV_COMMENT_MARKER } from "./types";
import type { JevAnswer, JevResponse, RiskLevel } from "./types";

const RISK_LABELS: Record<RiskLevel, string> = {
  low: "laag",
  medium: "gemiddeld",
  high: "hoog",
};

/**
 * Formats the Dutch sticky PR comment from JEV answers.
 * @param response - JEV API response.
 * @param sensitivePaths - Matched sensitive path labels.
 */
export function formatJevPrComment(
  response: JevResponse,
  sensitivePaths: string[],
): string {
  const risk = response.answers.risk_level;
  const severity = response.answers.severity;
  const security = response.answers.security_concern;
  const migration = response.answers.data_migration_risk;
  const regression = response.answers.likely_runtime_regression;
  const tests = response.answers.test_coverage_adequate;

  const riskLevel = getChoice(risk) as RiskLevel | undefined;
  const riskProb = risk && risk.type === "choice"
    ? formatTopProbability(risk.probabilities, risk.choice)
    : "—";

  const flags = [
    formatNoulFlag("Beveiligingsrisico", security),
    formatNoulFlag("Migratie-/dataverliesrisico", migration),
    formatNoulFlag("Waarschijnlijke runtime-regressie", regression),
    formatNoulFlag("Testdekking adequaat", tests, true),
  ];

  const watchlist = buildWatchlist(
    sensitivePaths,
    security,
    migration,
    regression,
    tests,
    severity,
  );

  const severityLine =
    severity && severity.type === "score"
      ? `Ernst (score): **${severity.score.toFixed(2)}** (vertrouwen ${(severity.confidence * 100).toFixed(0)}%)`
      : "Ernst: —";

  return [
    JEV_COMMENT_MARKER,
    "### JEV PR-risico",
    "",
    `**Risiconiveau:** ${riskLevel ? RISK_LABELS[riskLevel] : "onbekend"} (${riskProb})`,
    severityLine,
    "",
    "**Signalen**",
    ...flags.map((f) => `- ${f}`),
    "",
    "**Waar op te letten**",
    ...watchlist.map((w) => `- ${w}`),
    "",
    `<sub>Model: \`${response.model}\` · tokens: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out · geautomatiseerde inschatting, geen blokkade</sub>`,
  ].join("\n");
}

/** Comment body when JEV could not run. */
export function formatJevUnavailableComment(reason: string): string {
  return [
    JEV_COMMENT_MARKER,
    "### JEV PR-risico",
    "",
    `JEV niet beschikbaar: ${reason}`,
    "",
    "<sub>Deze check is niet-blokkerend.</sub>",
  ].join("\n");
}

function getChoice(answer: JevAnswer | undefined): string | undefined {
  return answer?.type === "choice" ? answer.choice : undefined;
}

function formatTopProbability(
  probabilities: Record<string, number>,
  choice: string,
): string {
  const p = probabilities[choice];
  if (typeof p !== "number") {
    return "—";
  }
  return `${(p * 100).toFixed(0)}%`;
}

function formatNoulFlag(
  label: string,
  answer: JevAnswer | undefined,
  invert = false,
): string {
  if (!answer || answer.type !== "noul") {
    return `${label}: —`;
  }
  const yes = answer.noul >= 0.5;
  const display = invert ? !yes : yes;
  const pct = (answer.noul * 100).toFixed(0);
  return `${label}: ${display ? "ja" : "nee"} (${pct}%)`;
}

function buildWatchlist(
  sensitivePaths: string[],
  security: JevAnswer | undefined,
  migration: JevAnswer | undefined,
  regression: JevAnswer | undefined,
  tests: JevAnswer | undefined,
  severity: JevAnswer | undefined,
): string[] {
  const items: string[] = [];

  if (sensitivePaths.length > 0) {
    items.push(`Gevoelige paden: ${sensitivePaths.join(", ")}`);
  }
  if (security?.type === "noul" && security.noul >= 0.5) {
    items.push("Controleer auth, secrets en inputvalidatie handmatig.");
  }
  if (migration?.type === "noul" && migration.noul >= 0.5) {
    items.push("Plan migratie/rollback en controleer Prisma-wijzigingen.");
  }
  if (regression?.type === "noul" && regression.noul >= 0.5) {
    items.push("Overweeg extra smoke/E2E op preview vóór merge.");
  }
  if (tests?.type === "noul" && tests.noul < 0.5) {
    items.push("Overweeg gerichte tests voor gewijzigde businesslogica.");
  }
  if (severity?.type === "score" && severity.score >= 2) {
    items.push("Potentieel zware impact bij incident — extra review aanbevolen.");
  }
  if (items.length === 0) {
    items.push("Geen bijzondere aandachtspunten uit JEV-signalen.");
  }
  return items;
}
