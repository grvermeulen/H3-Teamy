// @vitest-environment node
// These tests build Request bodies with FormData/File; Node's Request rejects jsdom's File.
import { describe, expect, it } from "vitest";
import {
  isInvalidMultipartBodyError,
  isMultipartFormDataContentType,
  parseMultipartFormData,
} from "./multipartFormData";

describe("isMultipartFormDataContentType", () => {
  it("returns true for multipart/form-data", () => {
    expect(
      isMultipartFormDataContentType(
        "multipart/form-data; boundary=----WebKitFormBoundary",
      ),
    ).toBe(true);
  });

  it("returns false for missing or non-multipart content types", () => {
    expect(isMultipartFormDataContentType(null)).toBe(false);
    expect(isMultipartFormDataContentType("application/json")).toBe(false);
  });
});

describe("isInvalidMultipartBodyError", () => {
  it("recognizes undici FormData parse failures", () => {
    expect(
      isInvalidMultipartBodyError(
        new TypeError("Failed to parse body as FormData."),
      ),
    ).toBe(true);
  });

  it("returns false for other errors", () => {
    expect(isInvalidMultipartBodyError(new Error("boom"))).toBe(false);
    expect(isInvalidMultipartBodyError(new TypeError("other"))).toBe(false);
  });
});

describe("parseMultipartFormData", () => {
  it("rejects requests without multipart content type", async () => {
    const req = new Request("http://localhost/api/report/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    const result = await parseMultipartFormData(req);

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "invalid_content_type",
      message: "Verwacht multipart/form-data met een afbeelding.",
    });
  });

  it("rejects malformed multipart bodies with a client error", async () => {
    const req = new Request("http://localhost/api/report/extract", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=bad" },
      body: "not-multipart",
    });

    const result = await parseMultipartFormData(req);

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "invalid_form_data",
      message: "Kon het uploadformulier niet verwerken.",
    });
  });

  it("returns parsed form data for valid multipart requests", async () => {
    const form = new FormData();
    form.set(
      "image",
      new File(["pixels"], "match.jpg", { type: "image/jpeg" }),
    );

    const req = new Request("http://localhost/api/report/extract", {
      method: "POST",
      body: form,
    });

    const result = await parseMultipartFormData(req);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const image = result.form.get("image");
    expect(image).not.toBeNull();
    expect((image as File).size).toBeGreaterThan(0);
  });
});
