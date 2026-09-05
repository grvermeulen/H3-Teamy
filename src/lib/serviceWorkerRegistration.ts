import * as Sentry from "@sentry/nextjs";

/** Path of the service worker script, served verbatim from `public/sw.js`. */
export const SERVICE_WORKER_URL = "/sw.js";

/** `process.env.NODE_ENV` of the only builds that register the worker. */
const PRODUCTION_NODE_ENV = "production";

/** Message type `public/sw.js` listens for to activate a waiting worker without a manual reload. */
const SKIP_WAITING_MESSAGE_TYPE = "SKIP_WAITING";

const SENTRY_CONTEXT = { tags: { area: "service-worker" } };

/**
 * True when the worker should be registered for this build.
 *
 * `next dev` reuses stable, unhashed chunk URLs under `/_next/static/chunks/` across edits and
 * restarts, so a worker that caches them keeps serving stale code. Only production builds, whose
 * chunk names are content-hashed, register the worker.
 */
export function shouldRegisterServiceWorker(
  nodeEnv: string | undefined,
): boolean {
  return nodeEnv === PRODUCTION_NODE_ENV;
}

/** `navigator.serviceWorker`, or `null` when the browser does not support service workers. */
function getServiceWorkerContainer(): ServiceWorkerContainer | null {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }
  return navigator.serviceWorker;
}

/** Reloads the page once a new worker takes control, so every chunk comes from the new build. */
function reloadOnControllerChange(container: ServiceWorkerContainer): void {
  container.addEventListener(
    "controllerchange",
    () => {
      window.location.reload();
    },
    { once: true },
  );
}

/** Tells a worker that finished installing to activate now instead of waiting for all tabs to close. */
function activateWorker(worker: ServiceWorker): void {
  worker.postMessage({ type: SKIP_WAITING_MESSAGE_TYPE });
}

/**
 * Registers the worker and wires up its update flow: a worker that is already waiting, or one that
 * finishes installing while an older worker controls the page, is told to skip waiting, and the
 * page reloads once the new worker takes control. A failed registration is reported to Sentry;
 * the app works without the worker.
 */
async function registerServiceWorker(
  container: ServiceWorkerContainer,
): Promise<void> {
  try {
    const registration = await container.register(SERVICE_WORKER_URL);
    reloadOnControllerChange(container);
    if (registration.waiting) {
      activateWorker(registration.waiting);
      return;
    }
    registration.addEventListener("updatefound", () => {
      const installingWorker = registration.installing;
      if (!installingWorker) return;
      installingWorker.addEventListener("statechange", () => {
        if (installingWorker.state === "installed" && container.controller) {
          activateWorker(installingWorker);
        }
      });
    });
  } catch (error: unknown) {
    Sentry.captureException(error, SENTRY_CONTEXT);
  }
}

/**
 * Unregisters every worker for this origin and deletes all of its caches, then reloads the page
 * when a worker was controlling it so no stale chunk stays in use. Runs on non-production builds:
 * a worker left behind by a production build or a local `next start` would otherwise keep serving
 * cached `/_next/` chunks to `next dev`. Failures are reported to Sentry.
 */
async function unregisterServiceWorkers(
  container: ServiceWorkerContainer,
): Promise<void> {
  try {
    const wasControlled = container.controller !== null;
    const registrations = await container.getRegistrations();
    await Promise.all(
      registrations.map((registration) => registration.unregister()),
    );
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
    if (wasControlled) window.location.reload();
  } catch (error: unknown) {
    Sentry.captureException(error, SENTRY_CONTEXT);
  }
}

/**
 * Applies the build's service worker policy once the page has finished loading, so registration
 * never competes with the initial page resources: production builds register `public/sw.js`,
 * every other build removes leftover workers and their caches. Browsers without service worker
 * support are left alone. Returns a cleanup that cancels a still-pending `load` listener, for use
 * as a React effect.
 */
export function setupServiceWorker(nodeEnv: string | undefined): () => void {
  const container = getServiceWorkerContainer();
  if (!container) return () => {};

  const applyPolicy = (): void => {
    if (shouldRegisterServiceWorker(nodeEnv)) {
      void registerServiceWorker(container);
      return;
    }
    void unregisterServiceWorkers(container);
  };

  if (document.readyState === "complete") {
    applyPolicy();
    return () => {};
  }
  window.addEventListener("load", applyPolicy, { once: true });
  return () => window.removeEventListener("load", applyPolicy);
}
