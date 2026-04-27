import * as ai from "ai";
import { initLogger, wrapAISDK } from "braintrust";

/** Default Braintrust project name when `BRAINTRUST_PROJECT_NAME` is not set. */
const DEFAULT_PROJECT_NAME = "H3-Teamy";

let cachedSdk: typeof ai | null = null;

/**
 * Returns the AI SDK namespace, wrapped with Braintrust tracing when
 * `BRAINTRUST_API_KEY` is available. Without the key it returns the bare AI
 * SDK so preview/local environments without Braintrust still function.
 *
 * Project resolution prefers `BRAINTRUST_PROJECT_ID` (precise UUID supplied
 * by the Vercel marketplace integration or set manually) and falls back to
 * `BRAINTRUST_PROJECT_NAME` then a hardcoded default. Memoized per process —
 * `initLogger` and `wrapAISDK` only run on first use.
 */
function getSdk(): typeof ai {
  if (cachedSdk) return cachedSdk;

  const apiKey = process.env.BRAINTRUST_API_KEY;
  if (!apiKey) {
    cachedSdk = ai;
    return cachedSdk;
  }

  const projectId = process.env.BRAINTRUST_PROJECT_ID;
  const projectName =
    process.env.BRAINTRUST_PROJECT_NAME ?? DEFAULT_PROJECT_NAME;

  initLogger(projectId ? { projectId, apiKey } : { projectName, apiKey });
  cachedSdk = wrapAISDK(ai) as unknown as typeof ai;
  return cachedSdk;
}

/** AI SDK `generateText`, traced via Braintrust when configured. */
export const generateText: typeof ai.generateText = (...args) =>
  getSdk().generateText(...args);

/** AI SDK `generateObject`, traced via Braintrust when configured. */
export const generateObject: typeof ai.generateObject = (...args) =>
  // The wrapped overload set is identical to the source; cast preserves the
  // generic signature without re-declaring all overloads here.
  (getSdk().generateObject as typeof ai.generateObject)(...args);

/** AI SDK `streamText`, traced via Braintrust when configured. */
export const streamText: typeof ai.streamText = (...args) =>
  getSdk().streamText(...args);

/** AI SDK `streamObject`, traced via Braintrust when configured. */
export const streamObject: typeof ai.streamObject = (...args) =>
  (getSdk().streamObject as typeof ai.streamObject)(...args);
