// Client-safe parsing of the User.settings JSON blob (personal preferences).

export type LandingPage = "my-day" | "notes" | "boards";
export type Handedness = "right" | "left";
export type DictationLanguage = "auto" | "en" | "he" | "es" | "fr" | "de" | "it" | "pt" | "ar" | "ru" | "zh" | "ja" | "ko";
export type UserSettings = {
  defaultLanding: LandingPage;
  /** First day of the week: 0 = Sunday … 6 = Saturday. Drives Notes scheduling. */
  weekStartsOn: number;
  /** Which hand holds the phone — puts mobile drag handles on that side. */
  handedness: Handedness;
  /** Preferred server-side Whisper transcription language. */
  dictationLanguage: DictationLanguage;
  /** Boards the user pinned on the Boards page (ids across all their workspaces). */
  pinnedBoardIds: string[];
};

export const DEFAULT_USER_SETTINGS: UserSettings = {
  defaultLanding: "my-day",
  weekStartsOn: 0,
  handedness: "right",
  dictationLanguage: "auto",
  pinnedBoardIds: [],
};

/** Sanity cap — nobody scans hundreds of pins, and it bounds the settings blob. */
export const MAX_PINNED_BOARDS = 100;

function parsePinnedBoardIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const id of value) {
    if (typeof id !== "string" || !id || ids.includes(id)) continue;
    ids.push(id);
    if (ids.length >= MAX_PINNED_BOARDS) break;
  }
  return ids;
}

const LANDINGS: LandingPage[] = ["my-day", "notes", "boards"];
export const DICTATION_LANGUAGES: { value: DictationLanguage; label: string; whisperLanguage?: string; model: string; note?: string }[] = [
  { value: "auto", label: "Auto-detect", model: "whisper-large-v3" },
  { value: "en", label: "English", whisperLanguage: "en", model: "whisper-base/en or whisper-large-v3" },
  { value: "he", label: "Hebrew", whisperLanguage: "he", model: "ivrit-ai/whisper-large-v3-turbo-ct2 or whisper-ivrit" },
  { value: "es", label: "Spanish", whisperLanguage: "es", model: "whisper-large-v3" },
  { value: "fr", label: "French", whisperLanguage: "fr", model: "whisper-large-v3" },
  { value: "de", label: "German", whisperLanguage: "de", model: "whisper-large-v3" },
  { value: "it", label: "Italian", whisperLanguage: "it", model: "whisper-large-v3" },
  { value: "pt", label: "Portuguese", whisperLanguage: "pt", model: "whisper-large-v3" },
  { value: "ar", label: "Arabic", whisperLanguage: "ar", model: "whisper-large-v3" },
  { value: "ru", label: "Russian", whisperLanguage: "ru", model: "whisper-large-v3" },
  { value: "zh", label: "Chinese", whisperLanguage: "zh", model: "whisper-large-v3" },
  { value: "ja", label: "Japanese", whisperLanguage: "ja", model: "whisper-large-v3" },
  { value: "ko", label: "Korean", whisperLanguage: "ko", model: "whisper-large-v3" },
];
const DICTATION_VALUES = DICTATION_LANGUAGES.map((l) => l.value);

export function parseUserSettings(raw?: string | null): UserSettings {
  if (!raw) return { ...DEFAULT_USER_SETTINGS, pinnedBoardIds: [] };
  try {
    const o = JSON.parse(raw) as Partial<UserSettings>;
    return {
      defaultLanding: o.defaultLanding && LANDINGS.includes(o.defaultLanding) ? o.defaultLanding : "my-day",
      weekStartsOn:
        typeof o.weekStartsOn === "number" && o.weekStartsOn >= 0 && o.weekStartsOn <= 6
          ? Math.floor(o.weekStartsOn)
          : 0,
      handedness: o.handedness === "left" ? "left" : "right",
      dictationLanguage: o.dictationLanguage && DICTATION_VALUES.includes(o.dictationLanguage) ? o.dictationLanguage : "auto",
      pinnedBoardIds: parsePinnedBoardIds(o.pinnedBoardIds),
    };
  } catch {
    return { ...DEFAULT_USER_SETTINGS, pinnedBoardIds: [] };
  }
}
