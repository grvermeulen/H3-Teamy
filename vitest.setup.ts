import * as matchers from "@testing-library/jest-dom/matchers";
import { expect, vi } from "vitest";

// @sentry/nextjs 10.72.0+ throws at import under jsdom (`document` exists):
// https://github.com/getsentry/sentry-javascript/issues/23789
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
  setTag: vi.fn(),
  startSpan: vi.fn((_ctx: unknown, cb: () => unknown) => cb()),
  captureRequestError: vi.fn(),
}));

if (matchers.default) {
  expect.extend(matchers.default);
} else {
  expect.extend(matchers);
}
