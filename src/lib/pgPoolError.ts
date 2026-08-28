/**
 * Detecteert `pg.Pool`-fouten die optreden wanneer een idle TCP-sessie door NAT,
 * load balancer of de databasebroker wordt gesloten. Die worden asynchroon via
 * `onPoolError` gemeld; de pool gebruikt daarna gewoon een nieuwe connectie.
 *
 * @param error - Fout uit de pool-error-handler van `pg`.
 * @returns `true` wanneer de melding overeenkomt met bekende idle-disconnect-teksten van `pg`.
 */
export function isPgPoolIdleDisconnectNoise(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const lower = error.message.trim().toLowerCase();
  return (
    lower.includes("connection terminated unexpectedly") ||
    lower.includes("connection terminated due to connection timeout") ||
    lower.includes("timeout exceeded when trying to connect") ||
    lower.includes("error while reading client passwordmessage") ||
    lower === "connection terminated"
  );
}
