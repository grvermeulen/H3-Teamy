import { describe, expect, it } from "vitest";
import { classifyWaapiHttpFailure } from "./waapiUpstreamError";

describe("classifyWaapiHttpFailure", () => {
  it("maps 401 to api_unauthenticated with Dutch guidance", () => {
    expect(
      classifyWaapiHttpFailure(401, '{"message":"Unauthenticated."}'),
    ).toEqual({
      reason: "api_unauthenticated",
      details: expect.stringContaining("WAAPI_API_TOKEN"),
    });
  });

  it("extracts message from JSON bodies for other statuses", () => {
    expect(classifyWaapiHttpFailure(400, '{"message":"Bad chat id"}')).toEqual({
      reason: "upstream_error",
      details: "Bad chat id",
    });
  });
});
