import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import {
  SERVICE_WORKER_URL,
  setupServiceWorker,
  shouldRegisterServiceWorker,
} from "./serviceWorkerRegistration";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

type FakeWorker = EventTarget & {
  state: ServiceWorkerState;
  postMessage: ReturnType<typeof vi.fn>;
};

type FakeRegistration = EventTarget & {
  waiting: FakeWorker | null;
  installing: FakeWorker | null;
  unregister: ReturnType<typeof vi.fn>;
};

type FakeContainer = EventTarget & {
  controller: FakeWorker | null;
  register: ReturnType<typeof vi.fn>;
  getRegistrations: ReturnType<typeof vi.fn>;
};

/** Builds a `ServiceWorker` stand-in with a mutable `state` and a recorded `postMessage`. */
function createFakeWorker(state: ServiceWorkerState): FakeWorker {
  return Object.assign(new EventTarget(), { state, postMessage: vi.fn() });
}

/** Builds a `ServiceWorkerRegistration` stand-in whose `unregister` resolves `true`. */
function createFakeRegistration(
  overrides: Partial<Pick<FakeRegistration, "waiting" | "installing">> = {},
): FakeRegistration {
  return Object.assign(new EventTarget(), {
    waiting: null,
    installing: null,
    unregister: vi.fn().mockResolvedValue(true),
    ...overrides,
  });
}

/** Installs a fake `navigator.serviceWorker`; jsdom ships none, so the default is "unsupported". */
function installFakeContainer(
  overrides: Partial<Pick<FakeContainer, "controller">> = {},
): FakeContainer {
  const container: FakeContainer = Object.assign(new EventTarget(), {
    controller: null,
    register: vi.fn().mockResolvedValue(createFakeRegistration()),
    getRegistrations: vi.fn().mockResolvedValue([]),
    ...overrides,
  });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: container,
  });
  return container;
}

/** Overrides `document.readyState`; `afterEach` drops the override via `Reflect.deleteProperty`. */
function setDocumentReadyState(readyState: DocumentReadyState): void {
  Object.defineProperty(document, "readyState", {
    configurable: true,
    value: readyState,
  });
}

describe("shouldRegisterServiceWorker", () => {
  it("registers only on production builds", () => {
    expect(shouldRegisterServiceWorker("production")).toBe(true);
    expect(shouldRegisterServiceWorker("development")).toBe(false);
    expect(shouldRegisterServiceWorker("test")).toBe(false);
    expect(shouldRegisterServiceWorker(undefined)).toBe(false);
  });
});

describe("setupServiceWorker", () => {
  const reload = vi.fn();
  const cacheKeys = vi.fn();
  const cacheDelete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    setDocumentReadyState("complete");
    vi.stubGlobal("location", { reload });
    cacheKeys.mockResolvedValue([]);
    cacheDelete.mockResolvedValue(true);
    vi.stubGlobal("caches", { keys: cacheKeys, delete: cacheDelete });
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, "serviceWorker");
    Reflect.deleteProperty(document, "readyState");
    vi.unstubAllGlobals();
  });

  it("does nothing in browsers without service worker support", () => {
    expect("serviceWorker" in navigator).toBe(false);

    const cleanup = setupServiceWorker("production");

    expect(cleanup).toBeTypeOf("function");
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("registers the worker on production builds", async () => {
    const container = installFakeContainer();

    setupServiceWorker("production");

    await vi.waitFor(() => {
      expect(container.register).toHaveBeenCalledWith(SERVICE_WORKER_URL);
    });
    expect(container.getRegistrations).not.toHaveBeenCalled();
    expect(cacheDelete).not.toHaveBeenCalled();
  });

  it("does not register the worker on development builds", async () => {
    const container = installFakeContainer();

    setupServiceWorker("development");

    await vi.waitFor(() => {
      expect(container.getRegistrations).toHaveBeenCalledTimes(1);
    });
    expect(container.register).not.toHaveBeenCalled();
  });

  it("removes leftover workers and caches on development builds without reloading an uncontrolled page", async () => {
    const container = installFakeContainer();
    const staleRegistration = createFakeRegistration();
    container.getRegistrations.mockResolvedValue([staleRegistration]);
    cacheKeys.mockResolvedValue(["static-v5", "static-v6"]);

    setupServiceWorker("development");

    await vi.waitFor(() => {
      expect(cacheDelete).toHaveBeenCalledTimes(2);
    });
    expect(staleRegistration.unregister).toHaveBeenCalledTimes(1);
    expect(cacheDelete).toHaveBeenCalledWith("static-v5");
    expect(cacheDelete).toHaveBeenCalledWith("static-v6");
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads a development page that a leftover worker was still controlling", async () => {
    const container = installFakeContainer({
      controller: createFakeWorker("activated"),
    });
    container.getRegistrations.mockResolvedValue([createFakeRegistration()]);

    setupServiceWorker("development");

    await vi.waitFor(() => {
      expect(reload).toHaveBeenCalledTimes(1);
    });
  });

  it("waits for the load event before applying the policy and cancels on cleanup", () => {
    setDocumentReadyState("loading");
    const container = installFakeContainer();

    const cleanup = setupServiceWorker("production");
    expect(container.register).not.toHaveBeenCalled();

    cleanup();
    window.dispatchEvent(new Event("load"));
    expect(container.register).not.toHaveBeenCalled();

    setupServiceWorker("production");
    window.dispatchEvent(new Event("load"));
    expect(container.register).toHaveBeenCalledTimes(1);
  });

  it("activates a worker that is already waiting and reloads once it takes control", async () => {
    const container = installFakeContainer();
    const waitingWorker = createFakeWorker("installed");
    container.register.mockResolvedValue(
      createFakeRegistration({ waiting: waitingWorker }),
    );

    setupServiceWorker("production");

    await vi.waitFor(() => {
      expect(waitingWorker.postMessage).toHaveBeenCalledWith({
        type: "SKIP_WAITING",
      });
    });
    container.dispatchEvent(new Event("controllerchange"));
    container.dispatchEvent(new Event("controllerchange"));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("activates an updated worker once it is installed while an older worker controls the page", async () => {
    const container = installFakeContainer({
      controller: createFakeWorker("activated"),
    });
    const registration = createFakeRegistration();
    container.register.mockResolvedValue(registration);

    setupServiceWorker("production");
    await vi.waitFor(() => {
      expect(container.register).toHaveBeenCalledTimes(1);
    });

    const installingWorker = createFakeWorker("installing");
    registration.installing = installingWorker;
    registration.dispatchEvent(new Event("updatefound"));
    installingWorker.dispatchEvent(new Event("statechange"));
    expect(installingWorker.postMessage).not.toHaveBeenCalled();

    installingWorker.state = "installed";
    installingWorker.dispatchEvent(new Event("statechange"));
    expect(installingWorker.postMessage).toHaveBeenCalledWith({
      type: "SKIP_WAITING",
    });
  });

  it("leaves a first install alone until it activates instead of skipping its waiting phase", async () => {
    const container = installFakeContainer();
    const registration = createFakeRegistration();
    container.register.mockResolvedValue(registration);

    setupServiceWorker("production");
    await vi.waitFor(() => {
      expect(container.register).toHaveBeenCalledTimes(1);
    });

    const installingWorker = createFakeWorker("installed");
    registration.installing = installingWorker;
    registration.dispatchEvent(new Event("updatefound"));
    installingWorker.dispatchEvent(new Event("statechange"));
    expect(installingWorker.postMessage).not.toHaveBeenCalled();
  });

  it("reports a failed registration to Sentry", async () => {
    const container = installFakeContainer();
    const failure = new Error("registration blocked");
    container.register.mockRejectedValue(failure);

    setupServiceWorker("production");

    await vi.waitFor(() => {
      expect(Sentry.captureException).toHaveBeenCalledWith(
        failure,
        expect.objectContaining({ tags: { area: "service-worker" } }),
      );
    });
    expect(reload).not.toHaveBeenCalled();
  });

  it("reports a failed cleanup to Sentry", async () => {
    const container = installFakeContainer();
    const failure = new Error("registrations unavailable");
    container.getRegistrations.mockRejectedValue(failure);

    setupServiceWorker("development");

    await vi.waitFor(() => {
      expect(Sentry.captureException).toHaveBeenCalledWith(
        failure,
        expect.objectContaining({ tags: { area: "service-worker" } }),
      );
    });
    expect(cacheDelete).not.toHaveBeenCalled();
  });
});
