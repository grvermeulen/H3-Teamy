// Keep this side-effect import first: it installs `.openapi()` on Zod before
// the schema modules below are evaluated (see zodOpenApi.ts).
import "./zodOpenApi.ts";
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import fs from "fs";
import path from "path";
import {
  PasswordResetRequestBodySchema,
  PasswordResetRequestResponseSchema,
  PasswordResetConfirmBodySchema,
  PasswordResetConfirmResponseSchema,
} from "../../src/lib/schemas/auth";
import { isMainModule } from "./utils.ts";

/** OpenAPI 3.0 document as produced by `OpenApiGeneratorV3`. */
export type OpenApiDocument = ReturnType<
  OpenApiGeneratorV3["generateDocument"]
>;

/**
 * Registers the documented Zod schemas and routes and generates the OpenAPI
 * 3.0 document that `npm run docs:generate` writes to `docs/api/openapi.json`.
 */
export function buildOpenApiDocument(): OpenApiDocument {
  const registry = new OpenAPIRegistry();

  registry.register("PasswordResetRequestBody", PasswordResetRequestBodySchema);
  registry.register(
    "PasswordResetRequestResponse",
    PasswordResetRequestResponseSchema,
  );
  registry.register("PasswordResetConfirmBody", PasswordResetConfirmBodySchema);
  registry.register(
    "PasswordResetConfirmResponse",
    PasswordResetConfirmResponseSchema,
  );

  registry.registerPath({
    method: "post",
    path: "/api/auth/password/reset-request",
    request: {
      body: {
        content: {
          "application/json": { schema: PasswordResetRequestBodySchema },
        },
      },
    },
    responses: {
      200: {
        description: "OK",
        content: {
          "application/json": { schema: PasswordResetRequestResponseSchema },
        },
      },
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/auth/password/reset-confirm",
    request: {
      body: {
        content: {
          "application/json": { schema: PasswordResetConfirmBodySchema },
        },
      },
    },
    responses: {
      200: {
        description: "OK",
        content: {
          "application/json": { schema: PasswordResetConfirmResponseSchema },
        },
      },
      400: { description: "Bad Request" },
    },
  });

  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: "3.0.0",
    info: { title: "H3 Teamy API", version: "1.0.0" },
    servers: [{ url: "" }],
  });
}

function main(): void {
  const outDir = path.join(process.cwd(), "docs/api");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "openapi.json"),
    JSON.stringify(buildOpenApiDocument(), null, 2),
  );
  console.log("Wrote docs/api/openapi.json");
}

if (isMainModule(import.meta.url)) main();
