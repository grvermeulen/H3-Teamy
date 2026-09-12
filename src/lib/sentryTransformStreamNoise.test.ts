import { describe, expect, it } from "vitest";
import { isNodeTransformStreamRaceNoise } from "./nodeTransformStreamNoise";
import { shouldDropNodeTransformStreamNoiseForSentry } from "./sentryTransformStreamNoise";

describe("isNodeTransformStreamRaceNoise", () => {
  it("returns true for the JAVASCRIPT-NEXTJS-3D Node webstreams race", () => {
    const error = new TypeError(
      "controller[kState].transformAlgorithm is not a function",
    );
    error.stack = [
      "TypeError: controller[kState].transformAlgorithm is not a function",
      "    at transformStreamDefaultControllerPerformTransform (node:internal/webstreams/transformstream:527:37)",
      "    at <unknown> (node:internal/webstreams/transformstream:568:16)",
      "    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)",
    ].join("\n");

    expect(isNodeTransformStreamRaceNoise(error)).toBe(true);
  });

  it("returns false when the stack is not from node webstreams", () => {
    const error = new TypeError(
      "controller[kState].transformAlgorithm is not a function",
    );
    error.stack =
      "TypeError: controller[kState].transformAlgorithm is not a function\n    at app/page.tsx:1:1";

    expect(isNodeTransformStreamRaceNoise(error)).toBe(false);
  });

  it("returns false for unrelated TypeErrors", () => {
    expect(
      isNodeTransformStreamRaceNoise(new TypeError("x is not a function")),
    ).toBe(false);
  });
});

describe("shouldDropNodeTransformStreamNoiseForSentry", () => {
  const baseEvent = { event_id: "test" } as Parameters<
    typeof shouldDropNodeTransformStreamNoiseForSentry
  >[0];

  it("drops the JAVASCRIPT-NEXTJS-3D event", () => {
    const error = new TypeError(
      "controller[kState].transformAlgorithm is not a function",
    );
    error.stack =
      "TypeError: controller[kState].transformAlgorithm is not a function\n    at transformStreamDefaultControllerPerformTransform (node:internal/webstreams/transformstream:527:37)";

    expect(
      shouldDropNodeTransformStreamNoiseForSentry(baseEvent, {
        originalException: error,
      }),
    ).toBe(true);
  });

  it("keeps unrelated application errors", () => {
    expect(
      shouldDropNodeTransformStreamNoiseForSentry(baseEvent, {
        originalException: new Error("password authentication failed"),
      }),
    ).toBe(false);
  });
});
