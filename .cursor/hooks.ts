// Experimental Cursor Hooks. Adjust to match your Cursor version.
// Guardrails: block destructive commands; auto-run linters/formatters after edits.

type ShellCommand = {
  command: string;
  cwd?: string;
};

type FileEdit = {
  filePath: string;
};

export async function onBeforeRunCommand(cmd: ShellCommand): Promise<void> {
  const dangerous = [
    / rm\s+-rf\s+\/$/,
    / rm\s+-rf\s+\*\s*$/,
    / git\s+push\s+--force(?!-with-lease)/,
    / docker\s+system\s+prune\s+-f/,
    / shutdown|reboot|format\s+c:/i,
  ];
  if (dangerous.some((re) => re.test(cmd.command))) {
    throw new Error(`Blocked potentially destructive command: ${cmd.command}`);
  }
}

export async function onAfterApplyEdits(edits: FileEdit[]): Promise<void> {
  const hasTsOrJsChanges = edits.some((e) =>
    /\.(ts|tsx|js|jsx)$/.test(e.filePath),
  );
  if (!hasTsOrJsChanges) return;
  const { exec } = await import("node:child_process");
  await new Promise<void>((resolve) => {
    exec(
      "npm run lint --silent || npx eslint . --fix",
      { cwd: process.cwd() },
      () => resolve(),
    );
  });
}
