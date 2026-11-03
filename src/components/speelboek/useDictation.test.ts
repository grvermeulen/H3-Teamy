import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MIC_BLOCKED_MESSAGE, useDictation } from "./useDictation";

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

let lastRecognition: FakeRecognition | undefined;

function stubRecognition(): void {
  lastRecognition = undefined;
  vi.stubGlobal(
    "SpeechRecognition",
    class extends FakeRecognition {
      constructor() {
        super();
        lastRecognition = this;
      }
    },
  );
}

function stubMicrophone(
  getUserMedia: () => Promise<{ getTracks: () => { stop: () => void }[] }>,
): ReturnType<typeof vi.fn> {
  const fn = vi.fn(getUserMedia);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: fn },
  });
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useDictation", () => {
  it("asks for the microphone before starting recognition", async () => {
    stubRecognition();
    const stopTrack = vi.fn();
    const getUserMedia = stubMicrophone(async () => ({
      getTracks: () => [{ stop: stopTrack }],
    }));
    const { result } = renderHook(() => useDictation(vi.fn()));

    await act(async () => {
      result.current.start();
    });

    await waitFor(() => expect(lastRecognition?.start).toHaveBeenCalledOnce());
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(result.current.listening).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("does not start recognition when the microphone stays blocked", async () => {
    stubRecognition();
    stubMicrophone(async () => {
      throw new DOMException("Permission denied", "NotAllowedError");
    });
    const { result } = renderHook(() => useDictation(vi.fn()));

    await act(async () => {
      result.current.start();
    });

    await waitFor(() => expect(result.current.error).toBe(MIC_BLOCKED_MESSAGE));
    expect(lastRecognition).toBeUndefined();
    expect(result.current.listening).toBe(false);
  });
});
