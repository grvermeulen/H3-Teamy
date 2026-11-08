// @vitest-environment node
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import {
  materializeScreenshotUploadFile,
  REPORT_SCREENSHOT_MAX_BYTES,
} from "./reportScreenshotUploadFile";

describe("materializeScreenshotUploadFile", () => {
  it("materialiseert bytes en gebruikt generieke bestandsnaam", async () => {
    const bytes = await sharp({
      create: {
        width: 1080,
        height: 400,
        channels: 3,
        background: { r: 200, g: 200, b: 200 },
      },
    })
      .jpeg({ quality: 60 })
      .toBuffer();

    const lazy = new File([bytes], "Picsew_secret.jpg", { type: "image/jpeg" });
    const result = await materializeScreenshotUploadFile(lazy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bytes).toBe(bytes.byteLength);
    expect(result.file.name).toBe("screenshot-upload.jpg");
    expect(result.file.name).not.toContain("Picsew");
    const roundtrip = Buffer.from(await result.file.arrayBuffer());
    expect(roundtrip.byteLength).toBe(bytes.byteLength);
  });

  it("weigert lege bestanden", async () => {
    const empty = new File([], "x.jpg", { type: "image/jpeg" });
    const result = await materializeScreenshotUploadFile(empty);
    expect(result).toEqual({ ok: false, errorClass: "empty_file" });
  });

  it("weigert te grote bestanden", async () => {
    const big = new File(
      [new Uint8Array(REPORT_SCREENSHOT_MAX_BYTES + 1)],
      "big.jpg",
      { type: "image/jpeg" },
    );
    const result = await materializeScreenshotUploadFile(big);
    expect(result).toEqual({ ok: false, errorClass: "too_large" });
  });

  it("markeert afgebroken reads", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "x.jpg", {
      type: "image/jpeg",
    });
    vi.spyOn(file, "arrayBuffer").mockImplementation(
      () =>
        new Promise<ArrayBuffer>((_resolve, reject) => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        }),
    );
    const result = await materializeScreenshotUploadFile(file);
    expect(result).toEqual({ ok: false, errorClass: "read_failed" });
  });
});
