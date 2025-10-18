import fs from "fs";

export function injectSection(
  filePath: string,
  marker: string,
  content: string,
): void {
  const start = `<!-- ${marker} -->`;
  const end = `<!-- /${marker} -->`;
  const src = fs.readFileSync(filePath, "utf8");
  const next = src.replace(
    new RegExp(`${start}[\\n\\r\\s\\S]*?${end}`),
    `${start}\n${content}\n${end}`,
  );
  fs.writeFileSync(filePath, next);
}
