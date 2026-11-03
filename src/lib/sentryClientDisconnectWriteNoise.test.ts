import { describe, expect, it } from "vitest";
import { isNodeClientDisconnectWriteNoise } from "./nodeClientDisconnectWriteNoise";
import { shouldDropNodeClientDisconnectWriteNoiseForSentry } from "./sentryClientDisconnectWriteNoise";

describe("isNodeClientDisconnectWriteNoise", () => {
  it("returns true for the JAVASCRIPT-NEXTJS-51 EPIPE write shape", () => {
    const error = new Error(
      "EPIPE: broken pipe, write",
    ) as NodeJS.ErrnoException;
    error.code = "EPIPE";
    error.errno = -32;
    error.syscall = "write";
    error.stack = [
      "Error: EPIPE: broken pipe, write",
      "    at WriteWrap.onWriteComplete [as oncomplete] (node:internal/stream_base_commons:878:16)",
      "    at writevGeneric (node:internal/stream_base_commons:136:3)",
      "    at Socket._writeGeneric (node:net:966:11)",
      "    at Socket._write (node:net:978:8)",
    ].join("\n");

    expect(isNodeClientDisconnectWriteNoise(error)).toBe(true);
  });

  it("returns true for write EPIPE errno without Sentry title formatting", () => {
    const error = new Error("write EPIPE") as NodeJS.ErrnoException;
    error.code = "EPIPE";
    error.syscall = "write";
    error.stack =
      "Error: write EPIPE\n    at afterWriteDispatched (node:internal/stream_base_commons:161:15)";

    expect(isNodeClientDisconnectWriteNoise(error)).toBe(true);
  });

  it("returns false when the stack is not from HTTP/socket writes", () => {
    const error = new Error(
      "EPIPE: broken pipe, write",
    ) as NodeJS.ErrnoException;
    error.code = "EPIPE";
    error.syscall = "write";
    error.stack = "Error: EPIPE: broken pipe, write\n    at src/lib/kv.ts:10:1";

    expect(isNodeClientDisconnectWriteNoise(error)).toBe(false);
  });

  it("returns false for unrelated application errors", () => {
    expect(
      isNodeClientDisconnectWriteNoise(
        new Error("password authentication failed"),
      ),
    ).toBe(false);
  });
});

describe("shouldDropNodeClientDisconnectWriteNoiseForSentry", () => {
  const baseEvent = { event_id: "test" } as Parameters<
    typeof shouldDropNodeClientDisconnectWriteNoiseForSentry
  >[0];

  it("drops the JAVASCRIPT-NEXTJS-51 event", () => {
    const error = new Error(
      "EPIPE: broken pipe, write",
    ) as NodeJS.ErrnoException;
    error.code = "EPIPE";
    error.syscall = "write";
    error.stack =
      "Error: EPIPE: broken pipe, write\n    at Socket._write (node:net:978:8)";

    expect(
      shouldDropNodeClientDisconnectWriteNoiseForSentry(baseEvent, {
        originalException: error,
      }),
    ).toBe(true);
  });

  it("keeps unrelated application errors", () => {
    expect(
      shouldDropNodeClientDisconnectWriteNoiseForSentry(baseEvent, {
        originalException: new Error("Prisma schema drift"),
      }),
    ).toBe(false);
  });
});
