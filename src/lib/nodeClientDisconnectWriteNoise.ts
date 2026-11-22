/** Node errno-codes voor verwachte disconnect-/timeout-writes naar HTTP-clients. */
const CLIENT_DISCONNECT_WRITE_ERRNO = new Set(["EPIPE", "ETIMEDOUT"]);

/**
 * Detecteert `EPIPE`- en `ETIMEDOUT`-schrijffouten wanneer de client de HTTP-verbinding
 * al heeft gesloten of niet meer reageert (navigatie weg, tab dicht, trage client).
 * Next.js/Vercel behandelt dit als requestfout via `onRequestError`; zonder filter
 * levert dat Sentry-ruis op (o.a. JAVASCRIPT-NEXTJS-51, JAVASCRIPT-NEXTJS-5P).
 *
 * @param error - Fout uit `onRequestError`, uncaught handlers of `catch`.
 * @returns `true` wanneer de melding overeenkomt met een verwachte disconnect-write.
 */
export function isNodeClientDisconnectWriteNoise(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (!isClientDisconnectWriteMessage(error)) return false;

  const stack = error.stack ?? "";
  if (stack.length === 0) {
    return isClientDisconnectWriteErrno(error);
  }

  return isHttpOrSocketWriteStack(stack);
}

/**
 * Herkenbare Sentry-issue-titels voor client-disconnect writes (resolve-sync).
 *
 * @param title - Sentry issue title.
 */
export function isNodeClientDisconnectWriteSentryIssueTitle(
  title: string,
): boolean {
  const normalized = title.trim().toLowerCase();
  if (normalized === "error: write epipe") return true;
  if (normalized === "error: write etimedout") return true;
  return (
    normalized.includes("write") &&
    (normalized.includes("epipe") || normalized.includes("etimedout"))
  );
}

function isClientDisconnectWriteErrno(error: Error): boolean {
  const errnoEx = error as NodeJS.ErrnoException;
  if (errnoEx.syscall !== "write") return false;
  const code = errnoEx.code;
  return typeof code === "string" && CLIENT_DISCONNECT_WRITE_ERRNO.has(code);
}

function isClientDisconnectWriteMessage(error: Error): boolean {
  if (isClientDisconnectWriteErrno(error)) return true;

  const lower = error.message.trim().toLowerCase();
  if (lower === "write epipe" || lower === "write etimedout") return true;
  if (
    lower.includes("epipe") &&
    lower.includes("broken pipe") &&
    lower.includes("write")
  ) {
    return true;
  }
  return lower.includes("etimedout") && lower.includes("write");
}

function isHttpOrSocketWriteStack(stack: string): boolean {
  return (
    stack.includes("node:net") ||
    stack.includes("node:internal/stream_base_commons") ||
    stack.includes("node:_http_outgoing") ||
    stack.includes("node:_http_server") ||
    stack.includes("node:internal/http") ||
    stack.includes("ServerResponse") ||
    stack.includes("internal/streams/writable")
  );
}
