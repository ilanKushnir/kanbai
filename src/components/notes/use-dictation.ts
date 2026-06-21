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

const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/aac"];
function recordingMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  return MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

function browserLang(language: string) {
  if (language === "auto") return navigator.language || "en-US";
  return language === "he" ? "he-IL" : language;
}

/** Foreground dictation: preferred path is server-side Whisper; Web Speech is fallback. */
export function useDictation(onText: (text: string) => void, language = "auto") {
  const [listening, setListening] = React.useState(false);
  const [supported] = React.useState(() => {
    if (typeof window === "undefined") return false;
    const w = window as unknown as SpeechWindow;
    const mediaSupported = !!(navigator.mediaDevices && typeof MediaRecorder !== "undefined" && recordingMimeType());
    return mediaSupported || !!(w.SpeechRecognition || w.webkitSpeechRecognition);
  });
  const [status, setStatus] = React.useState("");
  const [progress, setProgress] = React.useState(0);
  const [serverConfigured, setServerConfigured] = React.useState(false);
  const recRef = React.useRef<Recognition | null>(null);
  const mediaRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const onTextRef = React.useRef(onText);
  React.useEffect(() => {
    onTextRef.current = onText;
  }, [onText]);

  React.useEffect(() => {
    fetch("/api/dictation/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setServerConfigured(Boolean(data?.configured)))
      .catch(() => setServerConfigured(false));
  }, []);

  const stopWebSpeech = React.useCallback(() => {
    const rec = recRef.current;
    recRef.current = null;
    setListening(false);
    if (!rec) return;
    rec.onresult = null;
    rec.onend = null;
    rec.onerror = null;
    rec.onstart = null;
    try { rec.abort?.(); } catch {}
    try { rec.stop(); } catch {}
  }, []);

  const startWebSpeech = React.useCallback(() => {
    const w = window as unknown as SpeechWindow;
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor || recRef.current) return;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = browserLang(language);
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
    rec.onstart = () => { setListening(true); setStatus("Browser dictation"); };
    rec.onend = () => { recRef.current = null; setListening(false); setStatus(""); };
    rec.onerror = () => { recRef.current = null; setListening(false); setStatus(""); };
    recRef.current = rec;
    try { rec.start(); setListening(true); } catch { recRef.current = null; setListening(false); }
  }, [language]);

  const transcribe = React.useCallback(async (blob: Blob) => {
    setStatus(language === "he" ? "Preparing Hebrew Whisper model…" : "Preparing Whisper model…");
    setProgress(35);
    const form = new FormData();
    form.set("language", language);
    form.set("audio", blob, `dictation.${blob.type.includes("mp4") ? "mp4" : "webm"}`);
    setStatus("Uploading audio…");
    setProgress(60);
    const res = await fetch("/api/dictation/transcribe", { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || "Dictation failed");
    setProgress(100);
    onTextRef.current(String(data.text || ""));
  }, [language]);

  const stopServer = React.useCallback(() => {
    const media = mediaRef.current;
    if (!media) return;
    setStatus("Transcribing…");
    try { media.stop(); } catch {}
  }, []);

  const startServer = React.useCallback(async () => {
    if (!serverConfigured || mediaRef.current) return false;
    const mimeType = recordingMimeType();
    if (!mimeType) return false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];
      const media = new MediaRecorder(stream, { mimeType });
      mediaRef.current = media;
      media.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      media.onstop = () => {
        mediaRef.current = null;
        setListening(false);
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];
        void transcribe(blob).catch((e) => setStatus(e instanceof Error ? e.message : "Dictation failed"));
      };
      media.start();
      setListening(true);
      setProgress(10);
      setStatus("Recording… tap to transcribe");
      return true;
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Microphone unavailable");
      mediaRef.current = null;
      setListening(false);
      return false;
    }
  }, [serverConfigured, transcribe]);

  const stop = React.useCallback(() => {
    if (mediaRef.current) stopServer();
    stopWebSpeech();
  }, [stopServer, stopWebSpeech]);

  const start = React.useCallback(async () => {
    setStatus("");
    setProgress(0);
    if (await startServer()) return;
    startWebSpeech();
  }, [startServer, startWebSpeech]);

  const toggle = React.useCallback(() => {
    if (recRef.current || mediaRef.current) stop();
    else void start();
  }, [start, stop]);

  React.useEffect(() => () => stop(), [stop]);

  return { listening, supported, serverConfigured, status, progress, toggle, stop };
}
