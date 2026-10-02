import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "./openapi.ts";

describe("buildOpenApiDocument", () => {
  it("generates an OpenAPI 3.0 document for the password-reset routes", () => {
    const document = buildOpenApiDocument();

    expect(document.openapi).toBe("3.0.0");
    expect(document.info).toEqual({ title: "H3 Teamy API", version: "1.0.0" });
    expect(Object.keys(document.paths)).toEqual([
      "/api/auth/password/reset-request",
      "/api/auth/password/reset-confirm",
    ]);
    expect(Object.keys(document.components?.schemas ?? {})).toEqual([
      "PasswordResetRequestBody",
      "PasswordResetRequestResponse",
      "PasswordResetConfirmBody",
      "PasswordResetConfirmResponse",
    ]);
  });

  it("derives request bodies from the Zod schemas", () => {
    const document = buildOpenApiDocument();
    const requestBody =
      document.paths["/api/auth/password/reset-request"]?.post?.requestBody;

    expect(requestBody).toMatchObject({
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["email"],
            properties: { email: { type: "string", format: "email" } },
          },
        },
      },
    });
  });
});
