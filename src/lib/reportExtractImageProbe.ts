const MAX_VISION_DIMENSION = 7800;

export type ExtractImageProbeResult =
  | {
      ok: true;
      mimeType: string;
      bytes: number;
      width: number;
      height: number;
      visionResizePlanned: boolean;
      outputMimeType: string;
      outputWidth: number;
      outputHeight: number;
    }
  | {
      ok: false;
      mimeType: string;
      bytes: number;
      errorClass: "preprocess_unreadable";
    };

function normalizeUploadMimeType(type: string | undefined): string {
  const t = (type || "").trim().toLowerCase();
  if (t.startsWith("image/")) return t;
  return "application/octet-stream";
}

function plannedOutputDimensions(
  width: number,
  height: number,
): { outputWidth: number; outputHeight: number; visionResizePlanned: boolean } {
  if (width <= MAX_VISION_DIMENSION && height <= MAX_VISION_DIMENSION) {
    return {
      outputWidth: width,
      outputHeight: height,
      visionResizePlanned: false,
    };
  }
  if (height >= width) {
    const scale = MAX_VISION_DIMENSION / height;
    return {
      outputWidth: Math.round(width * scale),
      outputHeight: MAX_VISION_DIMENSION,
      visionResizePlanned: true,
    };
  }
  const scale = MAX_VISION_DIMENSION / width;
  return {
    outputWidth: MAX_VISION_DIMENSION,
    outputHeight: Math.round(height * scale),
    visionResizePlanned: true,
  };
}

/**
 * Leest alleen MIME, bytegrootte en afmetingen van een upload (geen bestandsnaam, geen pixels naar logs).
 */
export async function probeExtractImageUpload(
  file: File,
): Promise<ExtractImageProbeResult> {
  const mimeType = normalizeUploadMimeType(file.type);
  const bytes = file.size;
  try {
    const sharpModule = await import("sharp");
    const sharp = sharpModule.default;
    const buffer = Buffer.from(await file.arrayBuffer());
    const meta = await sharp(buffer).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (!width || !height) {
      return {
        ok: false,
        mimeType,
        bytes,
        errorClass: "preprocess_unreadable",
      };
    }
    const planned = plannedOutputDimensions(width, height);
    return {
      ok: true,
      mimeType,
      bytes,
      width,
      height,
      visionResizePlanned: planned.visionResizePlanned,
      outputMimeType: planned.visionResizePlanned ? "image/png" : mimeType,
      outputWidth: planned.outputWidth,
      outputHeight: planned.outputHeight,
    };
  } catch {
    return { ok: false, mimeType, bytes, errorClass: "preprocess_unreadable" };
  }
}
