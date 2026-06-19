"use client";

import * as React from "react";

// Minimal typing for the Web Speech API (not in the standard TS DOM lib).
type SpeechResult = { isFinal: boolean; 0: { transcript: string } };
type SpeechResultEvent = { resultIndex: number; results: { length: number } & Record<number, SpeechResult> };
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort?(): void;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  onstart?: (() => void) | null;
};
type SpeechWindow = {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

/**
 * Live speech-to-text using the browser's Web Speech API — on-device, no key.
 * `onText` receives the running transcript (final + interim) as the user speaks.
 */
export function useDictation(onText: (text: string) => void) {
  const [listening, setListening] = React.useState(false);
  const [supported, setSupported] = React.useState(false);
  const recRef = React.useRef<Recognition | null>(null);
  const onTextRef = React.useRef(onText);
  onTextRef.current = onText;

  React.useEffect(() => {
    const w = window as unknown as SpeechWindow;
    setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  // Flip the UI immediately and fully tear down the recognizer so a "stop" tap
  // always works — some engines don't reliably fire onend after stop().
  const stop = React.useCallback(() => {
    const rec = recRef.current;
    recRef.current = null;
    setListening(false);
    if (!rec) return;
    rec.onresult = null;
    rec.onend = null;
    rec.onerror = null;
    rec.onstart = null;
    try {
      rec.abort?.();
    } catch {
      /* noop */
    }
    try {
      rec.stop();
    } catch {
      /* noop */
    }
  }, []);

  const start = React.useCallback(() => {
    const w = window as unknown as SpeechWindow;
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor || recRef.current) return;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    let finalText = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      onTextRef.current((finalText + interim).replace(/\s+/g, " ").trim());
    };
    rec.onstart = () => setListening(true);
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
    };
    rec.onerror = () => {
      recRef.current = null;
      setListening(false);
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      recRef.current = null;
      setListening(false);
    }
  }, []);

  const toggle = React.useCallback(() => {
    if (recRef.current) stop();
    else start();
  }, [start, stop]);

  React.useEffect(() => () => stop(), [stop]);

  return { listening, supported, toggle, stop };
}
