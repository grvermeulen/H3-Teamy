import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

// Zod 4 copies `ZodType.prototype` extensions onto each schema when it is
// constructed, so `.openapi()` only exists on schemas created after this call.
// Import this module before any module that defines schemas.
extendZodWithOpenApi(z);
