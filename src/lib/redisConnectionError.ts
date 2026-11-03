/**
 * Detecteert ioredis-fouten wanneer een commando op een gesloten socket draait
 * (idle timeout, broker-reset, serverless instance recycle). `kv.ts` valt dan
 * terug op KV REST of geheugen; dit is geen applicatiefout.
 *
 * @param error - Fout uit een Redis GET/SET/increment in {@link ./kv.ts}.
 * @returns `true` voor bekende transient connection-teksten van ioredis.
 */
export function isRedisTransientConnectionNoise(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const lower = error.message.trim().toLowerCase();
  return (
    lower === "connection is closed." ||
    lower === "connection is closed" ||
    lower.includes("connection is closed")
  );
}
