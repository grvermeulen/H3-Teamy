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

const registry = new OpenAPIRegistry();

// Register schemas
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

// Paths (document the routes that exist)
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

function main() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  const doc = generator.generateDocument({
    openapi: "3.0.0",
    info: { title: "H3 Teamy API", version: "1.0.0" },
    servers: [{ url: "" }],
  });
  const outDir = path.join(process.cwd(), "docs/api");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "openapi.json"),
    JSON.stringify(doc, null, 2),
  );
  console.log("Wrote docs/api/openapi.json");
}

if (require.main === module) main();
