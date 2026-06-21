import { handler, ok } from "@/lib/api";
import { getCurrentContext } from "@/lib/auth";
import { DICTATION_LANGUAGES } from "@/lib/user-settings";

export const GET = handler(async () => {
  await getCurrentContext();
  return ok({
    configured: Boolean(process.env.KANBAI_WHISPER_ENDPOINT),
    languages: DICTATION_LANGUAGES,
    limitation:
      "Kanbai uses foreground recording/upload. iOS Safari/home-screen apps do not support reliable background sync or practical on-device Whisper model execution.",
  });
});
