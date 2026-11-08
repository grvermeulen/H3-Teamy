// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildReportExtractVisionUserContent } from "./reportExtractProvider";

describe("buildReportExtractVisionUserContent", () => {
  it("gebruikt file-parts i.p.v. deprecated image-parts", () => {
    const content = buildReportExtractVisionUserContent(
      Buffer.from([1, 2, 3]),
      "image/png",
      "prompt",
    );
    expect(content[1]).toEqual({
      type: "file",
      data: expect.any(Buffer),
      mediaType: "image/png",
    });
    expect(
      content.some((part) => (part as { type?: string }).type === "image"),
    ).toBe(false);
  });
});
