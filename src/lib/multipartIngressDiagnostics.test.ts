import { describe, expect, it } from "vitest";
import { readMultipartIngressDiagnostics } from "./multipartIngressDiagnostics";

describe("readMultipartIngressDiagnostics", () => {
  it("onderscheidt ontbrekende en nul content-length", () => {
    const missing = readMultipartIngressDiagnostics(
      new Request("http://localhost", { method: "POST" }),
    );
    expect(missing.contentLength).toEqual({ present: false });

    const zero = readMultipartIngressDiagnostics(
      new Request("http://localhost", {
        method: "POST",
        headers: {
          "content-type": "multipart/form-data; boundary=x",
          "content-length": "0",
        },
      }),
    );
    expect(zero.contentTypeHasBoundary).toBe(true);
    expect(zero.contentLength).toEqual({ present: true, value: 0 });
  });
});
