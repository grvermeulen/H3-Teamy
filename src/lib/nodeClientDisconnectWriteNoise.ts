/**
 * Detecteert `EPIPE`-schrijffouten wanneer de client de HTTP-verbinding al heeft
 * gesloten (navigatie weg, tab dicht, timeout). Next.js/Vercel behandelt dit als
 * requestfout via `onRequestError`; zonder filter levert dat Sentry-ruis op
 * (o.a. JAVASCRIPT-NEXTJS-51).
 *
 * @param error - Fout uit `onRequestError`, uncaught handlers of `catch`.
 * @returns `true` wanneer de melding overeenkomt met een verwachte disconnect-write.
 */
export function isNodeClientDisconnectWriteNoise(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (!isEpipeWriteMessage(error)) return false;

  const stack = error.stack ?? "";
  if (stack.length === 0) {
    return isEpipeWriteErrno(error);
  }

  return isHttpOrSocketWriteStack(stack);
}

function isEpipeWriteErrno(error: Error): boolean {
  const errnoEx = error as NodeJS.ErrnoException;
  return errnoEx.code === "EPIPE" && errnoEx.syscall === "write";
}

function isEpipeWriteMessage(error: Error): boolean {
  if (isEpipeWriteErrno(error)) return true;

  const lower = error.message.trim().toLowerCase();
  if (lower === "write epipe") return true;
  return (
    lower.includes("epipe") &&
    lower.includes("broken pipe") &&
    lower.includes("write")
  );
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
