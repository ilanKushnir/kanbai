import { handler, ok, HttpError } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { DICTATION_LANGUAGES, type DictationLanguage } from "@/lib/user-settings";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

function languageMeta(value: FormDataEntryValue | null) {
  const lang = typeof value === "string" ? (value as DictationLanguage) : "auto";
  return DICTATION_LANGUAGES.find((l) => l.value === lang) ?? DICTATION_LANGUAGES[0];
}

/**
 * Server-side Whisper proxy. The app records in the foreground and uploads the
 * blob here; a self-hosted Whisper service owns model download/cache. That is
 * intentional: iPhone Safari cannot reliably run large Whisper models locally,
 * and iOS does not provide dependable web background-sync for this workload.
 *
 * Expected backend: OpenAI-compatible /audio/transcriptions endpoint. Set
 * KANBAI_WHISPER_ENDPOINT to that URL and optionally KANBAI_WHISPER_API_KEY.
 */
export const POST = handler(async (req: Request) => {
  await getCurrentContext();
  const endpoint = process.env.KANBAI_WHISPER_ENDPOINT;
  if (!endpoint) {
    throw new HttpError(
      503,
      "Server-side Whisper is not configured yet. Set KANBAI_WHISPER_ENDPOINT to a self-hosted Whisper transcription endpoint.",
      "dictation_unconfigured",
    );
  }

  const form = await req.formData();
  const audio = form.get("audio");
  if (!(audio instanceof Blob)) throw new HttpError(400, "Missing audio blob", "missing_audio");
  if (audio.size > MAX_AUDIO_BYTES) throw new HttpError(413, "Audio clip is too large", "audio_too_large");

  const meta = languageMeta(form.get("language"));
  const filename = audio instanceof File && audio.name ? audio.name : "dictation.webm";
  const upstream = new FormData();
  upstream.set("file", audio, filename);
  upstream.set("model", meta.model);
  if (meta.whisperLanguage) upstream.set("language", meta.whisperLanguage);
  upstream.set("response_format", "json");

  const headers: Record<string, string> = {};
  if (process.env.KANBAI_WHISPER_API_KEY) headers.Authorization = `Bearer ${process.env.KANBAI_WHISPER_API_KEY}`;

  const res = await fetch(endpoint, { method: "POST", headers, body: upstream });
  if (!res.ok) {
    throw new HttpError(502, `Whisper backend returned ${res.status}`, "whisper_backend_error");
  }
  const data = (await res.json()) as { text?: unknown; language?: unknown; duration?: unknown };
  const text = typeof data.text === "string" ? data.text.trim() : "";
  if (!text) throw new HttpError(422, "No speech was recognized", "empty_transcript");
  return ok({ text, language: data.language ?? meta.value, model: meta.model });
});
