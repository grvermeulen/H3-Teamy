import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MIC_BLOCKED_MESSAGE,
  MIC_INTERRUPTED_MESSAGE,
  MIC_UNAVAILABLE_MESSAGE,
  useDictation,
} from "./useDictation";

class FakeRecognition {
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
}

const recognitions: FakeRecognition[] = [];

function stubRecognition(): void {
  recognitions.length = 0;
  vi.stubGlobal(
    "SpeechRecognition",
    class extends FakeRecognition {
      constructor() {
        super();
        recognitions.push(this);
      }
    },
  );
}

type Stream = { getTracks: () => { stop: () => void }[] };

function stubMedia(options?: {
  permission?: PermissionState | "error";
  devices?: { kind: "audioinput" | "audiooutput" }[];
  getUserMedia?: () => Promise<Stream>;
}): {
  getUserMedia: ReturnType<typeof vi.fn>;
  enumerateDevices: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
} {
  const getUserMedia = vi.fn(
    options?.getUserMedia ??
      (async () => ({
        getTracks: () => [{ stop: vi.fn() }],
      })),
  );
  const enumerateDevices = vi.fn(
    async () => options?.devices ?? [{ kind: "audioinput" as const }],
  );
  const query = vi.fn(async () => {
    if (options?.permission === "error") {
      throw new DOMException("The name is not supported", "NotSupportedError");
    }
    return { state: options?.permission ?? "prompt" };
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia, enumerateDevices },
  });
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: { query },
  });
  return { getUserMedia, enumerateDevices, query };
}

async function denyRecognition(index = 0): Promise<void> {
  await waitFor(() => expect(recognitions.length).toBeGreaterThan(index));
  const rec = recognitions[index];
  await act(async () => {
    rec.onerror?.({ error: "not-allowed" });
    rec.onend?.();
  });
}

beforeEach(() => {
  recognitions.length = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useDictation", () => {
  it("starts speech recognition without calling getUserMedia", async () => {
    stubRecognition();
    const media = stubMedia();
    const { result } = renderHook(() => useDictation(vi.fn()));

    await act(async () => {
      result.current.start();
    });

    await waitFor(() => expect(recognitions[0]?.start).toHaveBeenCalledOnce());
    expect(media.getUserMedia).not.toHaveBeenCalled();
    expect(media.enumerateDevices).not.toHaveBeenCalled();
    expect(result.current.listening).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("asks for the microphone only after not-allowed when a prompt is still possible", async () => {
    stubRecognition();
    const stopTrack = vi.fn();
    const media = stubMedia({
      permission: "prompt",
      getUserMedia: async () => ({
        getTracks: () => [{ stop: stopTrack }],
      }),
    });
    const { result } = renderHook(() => useDictation(vi.fn()));

    await act(async () => {
      result.current.start();
    });
    await denyRecognition();

    await waitFor(() => expect(recognitions).toHaveLength(2));
    expect(media.query).toHaveBeenCalledWith({ name: "microphone" });
    expect(media.getUserMedia).toHaveBeenCalledOnce();
    expect(media.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(recognitions[0]?.start.mock.invocationCallOrder[0]).toBeLessThan(
      media.getUserMedia.mock.invocationCallOrder[0],
    );
    expect(media.getUserMedia.mock.invocationCallOrder[0]).toBeLessThan(
      recognitions[1]?.start.mock.invocationCallOrder[0] ?? 0,
    );
    expect(result.current.listening).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("does not ask again when recognition stays blocked after the prompt", async () => {
    stubRecognition();
    const media = stubMedia({ permission: "prompt" });
    const { result } = renderHook(() => useDictation(vi.fn()));

    await act(async () => {
      result.current.start();
    });
    await denyRecognition();
    await waitFor(() => expect(recognitions).toHaveLength(2));
    await denyRecognition(1);

    await waitFor(() => expect(result.current.error).toBe(MIC_BLOCKED_MESSAGE));
    expect(media.getUserMedia).toHaveBeenCalledOnce();
    expect(recognitions).toHaveLength(2);
    expect(result.current.listening).toBe(false);
  });

  it("shows the lock-icon message when the site already blocked the microphone", async () => {
    stubRecognition();
    const media = stubMedia({ permission: "denied" });
    const { result } = renderHook(() => useDictation(vi.fn()));

    await act(async () => {
      result.current.start();
    });
    await denyRecognition();

    await waitFor(() => expect(result.current.error).toBe(MIC_BLOCKED_MESSAGE));
    expect(media.getUserMedia).not.toHaveBeenCalled();
    expect(media.enumerateDevices).not.toHaveBeenCalled();
    expect(recognitions).toHaveLength(1);
    expect(result.current.listening).toBe(false);
  });

  it("does not call getUserMedia when the site already granted the microphone", async () => {
    stubRecognition();
    const media = stubMedia({ permission: "granted" });
    const { result } = renderHook(() => useDictation(vi.fn()));

    await act(async () => {
      result.current.start();
    });
    await denyRecognition();

    await waitFor(() =>
      expect(result.current.error).toBe(MIC_UNAVAILABLE_MESSAGE),
    );
    expect(media.getUserMedia).not.toHaveBeenCalled();
    expect(result.current.listening).toBe(false);
  });

  it("skips getUserMedia when no microphone is enumerated", async () => {
    stubRecognition();
    const media = stubMedia({
      permission: "prompt",
      devices: [{ kind: "audiooutput" }],
    });
    const { result } = renderHook(() => useDictation(vi.fn()));

    await act(async () => {
      result.current.start();
    });
    await denyRecognition();

    await waitFor(() =>
      expect(result.current.error).toBe(MIC_UNAVAILABLE_MESSAGE),
    );
    expect(media.enumerateDevices).toHaveBeenCalledOnce();
    expect(media.getUserMedia).not.toHaveBeenCalled();
    expect(recognitions).toHaveLength(1);
  });

  it("explains macOS privacy when getUserMedia throws NotFoundError", async () => {
    stubRecognition();
    const media = stubMedia({
      permission: "prompt",
      getUserMedia: async () => {
        throw new DOMException("Requested device not found", "NotFoundError");
      },
    });
    const { result } = renderHook(() => useDictation(vi.fn()));

    await act(async () => {
      result.current.start();
    });
    await denyRecognition();

    await waitFor(() =>
      expect(result.current.error).toBe(MIC_UNAVAILABLE_MESSAGE),
    );
    expect(media.getUserMedia).toHaveBeenCalledOnce();
    expect(recognitions).toHaveLength(1);
    expect(result.current.listening).toBe(false);
  });

  it("explains macOS privacy when the system denies getUserMedia", async () => {
    stubRecognition();
    stubMedia({
      permission: "prompt",
      getUserMedia: async () => {
        throw new DOMException(
          "Permission denied by system",
          "NotAllowedError",
        );
      },
    });
    const { result } = renderHook(() => useDictation(vi.fn()));

    await act(async () => {
      result.current.start();
    });
    await denyRecognition();

    await waitFor(() =>
      expect(result.current.error).toBe(MIC_UNAVAILABLE_MESSAGE),
    );
    expect(recognitions).toHaveLength(1);
  });

  it("shows the lock-icon message when the user dismisses the permission prompt", async () => {
    stubRecognition();
    stubMedia({
      permission: "prompt",
      getUserMedia: async () => {
        throw new DOMException("Permission denied", "NotAllowedError");
      },
    });
    const { result } = renderHook(() => useDictation(vi.fn()));

    await act(async () => {
      result.current.start();
    });
    await denyRecognition();

    await waitFor(() => expect(result.current.error).toBe(MIC_BLOCKED_MESSAGE));
    expect(recognitions).toHaveLength(1);
    expect(result.current.listening).toBe(false);
  });

  it("still prompts when the Permissions API cannot report microphone state", async () => {
    stubRecognition();
    const media = stubMedia({ permission: "error" });
    const { result } = renderHook(() => useDictation(vi.fn()));

    await act(async () => {
      result.current.start();
    });
    await denyRecognition();

    await waitFor(() => expect(recognitions).toHaveLength(2));
    expect(media.getUserMedia).toHaveBeenCalledOnce();
    expect(result.current.listening).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("maps audio-capture to the macOS privacy message without getUserMedia", async () => {
    stubRecognition();
    const media = stubMedia({ permission: "prompt" });
    const { result } = renderHook(() => useDictation(vi.fn()));

    await act(async () => {
      result.current.start();
    });
    await waitFor(() => expect(recognitions[0]).toBeDefined());
    await act(async () => {
      recognitions[0]?.onerror?.({ error: "audio-capture" });
      recognitions[0]?.onend?.();
    });

    await waitFor(() =>
      expect(result.current.error).toBe(MIC_UNAVAILABLE_MESSAGE),
    );
    expect(media.getUserMedia).not.toHaveBeenCalled();
    expect(result.current.listening).toBe(false);
  });

  it("keeps other recognition failures on the interrupted message", async () => {
    stubRecognition();
    const media = stubMedia();
    const { result } = renderHook(() => useDictation(vi.fn()));

    await act(async () => {
      result.current.start();
    });
    await waitFor(() => expect(recognitions[0]).toBeDefined());
    await act(async () => {
      recognitions[0]?.onerror?.({ error: "network" });
      recognitions[0]?.onend?.();
    });

    await waitFor(() =>
      expect(result.current.error).toBe(MIC_INTERRUPTED_MESSAGE),
    );
    expect(media.getUserMedia).not.toHaveBeenCalled();
  });
});
