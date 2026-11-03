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

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
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
 * Dictation via the browser's Web Speech API (`nl-NL`). Final phrases are
 * delivered through `onFinal`; interim text is exposed for live feedback.
 * Unsupported browsers (Firefox, some WebViews) get `supported: false`.
 *
 * @param onFinal - Called with each finalised phrase.
 */
export function useDictation(onFinal: (text: string) => void): Dictation {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<Recognition | null>(null);
  const onFinalRef = useRef(onFinal);

  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  useEffect(() => {
    setSupported(getRecognitionCtor() !== null);
    return () => recognitionRef.current?.stop();
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
    setInterim("");
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
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
          ? "Geen toegang tot de microfoon. Je kunt de oefening ook typen."
          : "Spraakherkenning is onderbroken. Probeer het opnieuw of typ de oefening.",
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
  }, []);

  return { supported, listening, interim, error, start, stop };
}
