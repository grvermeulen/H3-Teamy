import * as matchers from "@testing-library/jest-dom/matchers";
import { expect } from "vitest";

if (matchers.default) {
  expect.extend(matchers.default);
} else {
  expect.extend(matchers);
}
