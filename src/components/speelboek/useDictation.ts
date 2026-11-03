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

/** Shown when the browser refuses microphone access without a new prompt. */
export const MIC_BLOCKED_MESSAGE =
  "Geen toegang tot de microfoon. Klik op het slotje in de adresbalk, zet Microfoon op Toestaan, en probeer Inspreken opnieuw.";

const MIC_MISSING_MESSAGE =
  "Geen microfoon gevonden. Controleer of er een microfoon is aangesloten.";

const MIC_INTERRUPTED_MESSAGE =
  "Spraakherkenning is onderbroken. Probeer het opnieuw of typ de oefening.";

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function dictationErrorMessage(reason: unknown): string {
  if (reason instanceof DOMException) {
    if (
      reason.name === "NotAllowedError" ||
      reason.name === "PermissionDeniedError" ||
      reason.name === "SecurityError"
    ) {
      return MIC_BLOCKED_MESSAGE;
    }
    if (reason.name === "NotFoundError") return MIC_MISSING_MESSAGE;
  }
  return MIC_INTERRUPTED_MESSAGE;
}

/**
 * Chrome's SpeechRecognition often fires `not-allowed` without a permission
 * popup. `getUserMedia` is what actually shows the prompt; the stream is
 * stopped so recognition can take over the microphone.
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
 * Dictation via the browser's Web Speech API (`nl-NL`). Asks for the
 * microphone first (`getUserMedia`) so Chrome shows a permission popup,
 * then streams phrases through `onFinal`. Unsupported browsers (Firefox,
 * some WebViews) get `supported: false`.
 *
 * @param onFinal - Called with each finalised phrase.
 */
export function useDictation(onFinal: (text: string) => void): Dictation {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<Recognition | null>(null);
  const startingRef = useRef(false);
  const onFinalRef = useRef(onFinal);

  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  useEffect(() => {
    setSupported(getRecognitionCtor() !== null);
    return () => recognitionRef.current?.stop();
  }, []);

  const stop = useCallback(() => {
    startingRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
    setInterim("");
  }, []);

  const start = useCallback(() => {
    if (startingRef.current || recognitionRef.current) return;
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    startingRef.current = true;
    void (async () => {
      try {
        await requestMicrophonePrompt();
        if (!startingRef.current) return;
        const rec = new Ctor();
        rec.lang = "nl-NL";
        rec.continuous = true;
        rec.interimResults = true;
        rec.onresult = (e) => {
          let interimText = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i];
            if (r.isFinal) onFinalRef.current(r[0].transcript.trim());
            else interimText += r[0].transcript;
          }
          setInterim(interimText);
        };
        rec.onerror = (e) => {
          setError(
            e.error === "not-allowed"
              ? MIC_BLOCKED_MESSAGE
              : MIC_INTERRUPTED_MESSAGE,
          );
          setListening(false);
        };
        rec.onend = () => {
          setListening(false);
          setInterim("");
        };
        recognitionRef.current = rec;
        setError(null);
        rec.start();
        setListening(true);
      } catch (reason) {
        setError(dictationErrorMessage(reason));
        setListening(false);
      } finally {
        startingRef.current = false;
      }
    })();
  }, []);

  return { supported, listening, interim, error, start, stop };
}
