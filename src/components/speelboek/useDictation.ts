"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type RecognitionResultEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
};

type RecognitionCtor = new () => Recognition;

type MicrophonePermission = PermissionState | "unknown";

/** Shown when the site blocked the microphone and Chrome will not prompt again. */
export const MIC_BLOCKED_MESSAGE =
  "Geen toegang tot de microfoon. Klik op het slotje in de adresbalk, zet Microfoon op Toestaan, en probeer Inspreken opnieuw.";

/**
 * Shown when Chrome cannot see a microphone. On macOS that is often the
 * system privacy switch hiding the hardware, not a missing device.
 */
export const MIC_UNAVAILABLE_MESSAGE =
  "De microfoon is geblokkeerd of niet zichtbaar voor Chrome. Sta Chrome toe bij macOS Systeeminstellingen → Privacy en beveiliging → Microfoon, controleer of er een microfoon is aangesloten, en probeer Inspreken opnieuw.";

/** Shown when speech recognition stops for a reason other than microphone access. */
export const MIC_INTERRUPTED_MESSAGE =
  "Spraakherkenning is onderbroken. Probeer het opnieuw of typ de oefening.";

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function isSystemMicrophoneBlock(reason: DOMException): boolean {
  if (reason.name === "NotFoundError") return true;
  const systemDenied =
    reason.name === "NotAllowedError" ||
    reason.name === "PermissionDeniedError";
  // Chrome's DOMException message stays English, also in a Dutch UI.
  return systemDenied && /denied by system/i.test(reason.message);
}

function dictationErrorMessage(reason: unknown): string {
  if (reason instanceof DOMException) {
    if (isSystemMicrophoneBlock(reason)) return MIC_UNAVAILABLE_MESSAGE;
    if (
      reason.name === "NotAllowedError" ||
      reason.name === "PermissionDeniedError" ||
      reason.name === "SecurityError"
    ) {
      return MIC_BLOCKED_MESSAGE;
    }
  }
  return MIC_INTERRUPTED_MESSAGE;
}

/**
 * Site microphone permission. `"unknown"` when this browser has no
 * Permissions API entry for `"microphone"` — Safari rejects that name.
 */
async function microphonePermissionState(): Promise<MicrophonePermission> {
  const permissions = navigator.permissions;
  if (!permissions?.query) return "unknown";
  try {
    const query = permissions.query.bind(permissions) as (descriptor: {
      name: "microphone";
    }) => Promise<PermissionStatus>;
    const status = await query({ name: "microphone" });
    return status.state;
  } catch {
    return "unknown";
  }
}

/**
 * `true` when the browser lists an audio input. Before permission, Chrome
 * exposes at most one blank entry; an empty list means macOS privacy (or a
 * missing device) is hiding the microphone. `getUserMedia` in that state
 * opens Chrome's own "no microphone" dialog.
 */
async function browserCanSeeMicrophone(): Promise<boolean> {
  const media = navigator.mediaDevices;
  if (!media?.enumerateDevices) return true;
  try {
    const devices = await media.enumerateDevices();
    return devices.some((device) => device.kind === "audioinput");
  } catch {
    return false;
  }
}

/**
 * Shows the real site-permission prompt. Speech recognition alone often fires
 * `not-allowed` without one. The stream is stopped so recognition can take
 * the microphone afterwards.
 */
async function requestMicrophonePrompt(): Promise<void> {
  const media = navigator.mediaDevices;
  if (!media?.getUserMedia) return;
  const stream = await media.getUserMedia({ audio: true });
  for (const track of stream.getTracks()) track.stop();
}

/** State and controls for browser speech-to-text (Web Speech API, Dutch). */
export type Dictation = {
  /** `false` when the browser has no speech recognition. */
  supported: boolean;
  listening: boolean;
  /** Words recognised so far but not yet final. */
  interim: string;
  error: string | null;
  start: () => void;
  stop: () => void;
};

/**
 * Dictation via the browser's Web Speech API (`nl-NL`). Starts recognition
 * first. Only if that reports `not-allowed` and a site prompt is still
 * possible do we call `getUserMedia` — an unconditional call makes Chrome on
 * macOS show its own "no microphone" dialog when the OS hides the input.
 *
 * @param onFinal - Called with each finalised phrase.
 */
export function useDictation(onFinal: (text: string) => void): Dictation {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<Recognition | null>(null);
  const sessionRef = useRef(0);
  const activeRef = useRef(false);
  const promptedRef = useRef(false);
  const recoveringRef = useRef(false);
  const onFinalRef = useRef(onFinal);

  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  useEffect(() => {
    setSupported(getRecognitionCtor() !== null);
    return () => {
      sessionRef.current += 1;
      activeRef.current = false;
      recoveringRef.current = false;
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    sessionRef.current += 1;
    activeRef.current = false;
    recoveringRef.current = false;
    promptedRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
    setInterim("");
  }, []);

  const start = useCallback(() => {
    if (activeRef.current) return;
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;

    activeRef.current = true;
    promptedRef.current = false;
    recoveringRef.current = false;
    const session = sessionRef.current + 1;
    sessionRef.current = session;
    setError(null);
    setListening(true);

    function fail(message: string): void {
      if (sessionRef.current !== session) return;
      activeRef.current = false;
      recoveringRef.current = false;
      recognitionRef.current = null;
      setListening(false);
      setInterim("");
      setError(message);
    }

    function sessionEnded(): boolean {
      return sessionRef.current !== session;
    }

    async function recover(): Promise<void> {
      if (sessionEnded()) return;
      if (promptedRef.current) {
        fail(MIC_BLOCKED_MESSAGE);
        return;
      }
      const state = await microphonePermissionState();
      if (sessionEnded()) return;
      switch (state) {
        case "denied":
          fail(MIC_BLOCKED_MESSAGE);
          return;
        case "granted":
          fail(MIC_UNAVAILABLE_MESSAGE);
          return;
        case "prompt":
        case "unknown":
          break;
        default: {
          const unexpected: never = state;
          return unexpected;
        }
      }
      const visible = await browserCanSeeMicrophone();
      if (sessionEnded()) return;
      if (!visible) {
        fail(MIC_UNAVAILABLE_MESSAGE);
        return;
      }
      promptedRef.current = true;
      try {
        await requestMicrophonePrompt();
      } catch (reason: unknown) {
        if (sessionEnded()) return;
        fail(dictationErrorMessage(reason));
        return;
      }
      if (sessionEnded()) return;
      recoveringRef.current = false;
      open();
    }

    function open(): void {
      if (sessionEnded() || !Ctor) return;
      const rec = new Ctor();
      rec.lang = "nl-NL";
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (e) => {
        let interimText = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const phrase = e.results[i];
          if (phrase.isFinal) onFinalRef.current(phrase[0].transcript.trim());
          else interimText += phrase[0].transcript;
        }
        setInterim(interimText);
      };
      rec.onerror = (e) => {
        if (sessionEnded()) return;
        if (e.error === "not-allowed") {
          if (recoveringRef.current) return;
          recoveringRef.current = true;
          void recover();
          return;
        }
        if (e.error === "audio-capture") {
          fail(MIC_UNAVAILABLE_MESSAGE);
          return;
        }
        fail(MIC_INTERRUPTED_MESSAGE);
      };
      rec.onend = () => {
        if (sessionEnded() || recoveringRef.current) return;
        if (recognitionRef.current !== rec) return;
        recognitionRef.current = null;
        setListening(false);
        setInterim("");
        activeRef.current = false;
      };
      recognitionRef.current = rec;
      try {
        rec.start();
      } catch (reason: unknown) {
        if (sessionEnded()) return;
        const denied =
          reason instanceof DOMException &&
          (reason.name === "NotAllowedError" ||
            reason.name === "PermissionDeniedError" ||
            reason.name === "SecurityError") &&
          !isSystemMicrophoneBlock(reason);
        if (denied) {
          if (recoveringRef.current) return;
          recoveringRef.current = true;
          void recover();
          return;
        }
        fail(dictationErrorMessage(reason));
      }
    }

    open();
  }, []);

  return { supported, listening, interim, error, start, stop };
}
