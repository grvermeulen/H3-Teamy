export const MVP_PLACEHOLDER = "De MVP-stemming staat nog open via de knop hieronder!";
const MVP_RESULT_PREFIX = "Onze MVP:";

export function formatMvpResultLine(name: string, percent: number, totalVotes: number): string {
  return `${MVP_RESULT_PREFIX} ${name} (${percent}% van ${totalVotes} stemmen).`;
}

export function applyMvpResultLine(content: string | undefined, resultLine: string): string {
  const base = (content || "").trim();
  if (!base) return resultLine;
  if (base.includes(MVP_PLACEHOLDER)) {
    return base.replace(MVP_PLACEHOLDER, resultLine);
  }
  return `${base}\n\n${resultLine}`;
}

export function reinstateMvpPlaceholder(content: string | undefined): string {
  const base = (content || "").trim();
  if (!base) return MVP_PLACEHOLDER;
  if (base.includes(MVP_PLACEHOLDER)) return base;
  const regex = new RegExp(`${MVP_RESULT_PREFIX}.*`, "i");
  if (regex.test(base)) {
    return base.replace(regex, MVP_PLACEHOLDER);
  }
  return `${base}\n\n${MVP_PLACEHOLDER}`;
}

