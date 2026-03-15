import { AsyncLocalStorage } from "async_hooks";

type SlowQuery = {
  durationMs: number;
  querySnippet: string;
};

type RequestMetricsContext = {
  endpoint: string;
  startedAtMs: number;
  queryCount: number;
  totalQueryMs: number;
  slowQueries: SlowQuery[];
};

const requestStore = new AsyncLocalStorage<RequestMetricsContext>();
const SLOW_QUERY_MS = Number(process.env.DB_SLOW_QUERY_MS || 100);
const MAX_CAPTURED_SLOW_QUERIES = 5;

export function isDbMetricsEnabled(): boolean {
  return process.env.DB_METRICS_ENABLED !== "0";
}

export function recordPrismaQuery(durationMs: number, query: string): void {
  if (!isDbMetricsEnabled()) return;
  const ctx = requestStore.getStore();
  if (!ctx) return;
  ctx.queryCount += 1;
  ctx.totalQueryMs += durationMs;
  if (
    durationMs >= SLOW_QUERY_MS &&
    ctx.slowQueries.length < MAX_CAPTURED_SLOW_QUERIES
  ) {
    const compact = query.replace(/\s+/g, " ").trim();
    ctx.slowQueries.push({
      durationMs,
      querySnippet: compact.slice(0, 180),
    });
  }
}

function getResultStatus(result: unknown): number | undefined {
  if (!result || typeof result !== "object") return undefined;
  const maybeStatus = (result as { status?: unknown }).status;
  return typeof maybeStatus === "number" ? maybeStatus : undefined;
}

export async function withDbRequestMetrics<T>(
  endpoint: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!isDbMetricsEnabled()) return fn();
  const ctx: RequestMetricsContext = {
    endpoint,
    startedAtMs: Date.now(),
    queryCount: 0,
    totalQueryMs: 0,
    slowQueries: [],
  };
  return requestStore.run(ctx, async () => {
    try {
      const result = await fn();
      const requestMs = Date.now() - ctx.startedAtMs;
      console.info("db_request_metrics", {
        endpoint: ctx.endpoint,
        ok: true,
        status: getResultStatus(result),
        requestMs,
        queryCount: ctx.queryCount,
        totalQueryMs: ctx.totalQueryMs,
        slowQueryCount: ctx.slowQueries.length,
        slowQueries: ctx.slowQueries,
      });
      return result;
    } catch (error: unknown) {
      const requestMs = Date.now() - ctx.startedAtMs;
      console.warn("db_request_metrics", {
        endpoint: ctx.endpoint,
        ok: false,
        requestMs,
        queryCount: ctx.queryCount,
        totalQueryMs: ctx.totalQueryMs,
        slowQueryCount: ctx.slowQueries.length,
        slowQueries: ctx.slowQueries,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message }
            : String(error),
      });
      throw error;
    }
  });
}
