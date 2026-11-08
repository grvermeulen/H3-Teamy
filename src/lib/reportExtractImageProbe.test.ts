// @vitest-environment node
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { probeExtractImageUpload } from "./reportExtractImageProbe";

describe("probeExtractImageUpload", () => {
  it("meet geplande vision-resize voor hoge stitched fixtures (geen spelersdata)", async () => {
    const buffer = await sharp({
      create: {
        width: 1080,
        height: 9348,
        channels: 3,
        background: { r: 240, g: 240, b: 240 },
      },
    })
      .jpeg({ quality: 70 })
      .toBuffer();

    const file = new File([buffer], "synthetic-tall.jpeg", {
      type: "image/jpeg",
    });
    const probe = await probeExtractImageUpload(file);
    expect(probe.ok).toBe(true);
    if (!probe.ok) return;
    expect(probe.width).toBe(1080);
    expect(probe.height).toBe(9348);
    expect(probe.visionResizePlanned).toBe(true);
    expect(probe.outputHeight).toBe(7800);
    expect(probe.outputWidth).toBe(901);
    expect(probe.outputMimeType).toBe("image/png");
  });

  it("markeert onleesbare bytes als preprocess_unreadable", async () => {
    const file = new File([Buffer.from([0, 1, 2])], "x.bin", {
      type: "image/jpeg",
    });
    const probe = await probeExtractImageUpload(file);
    expect(probe.ok).toBe(false);
    if (probe.ok) return;
    expect(probe.errorClass).toBe("preprocess_unreadable");
  });
});
