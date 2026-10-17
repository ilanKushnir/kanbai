// Client-safe parsing of the User.settings JSON blob (personal preferences).

export type LandingPage = "today" | "boards";
export type Handedness = "right" | "left";
export type DictationLanguage = "auto" | "en" | "he" | "es" | "fr" | "de" | "it" | "pt" | "ar" | "ru" | "zh" | "ja" | "ko";
/** An external calendar shown read-only in Plan (e.g. Google's "secret address in iCal format"). */
export type CalendarFeed = { id: string; name: string; url: string; color: string };

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
  /** Last release the user dismissed in "What's new" (null = never). */
  whatsNewSeen: string | null;
  /** Read-only iCal feeds overlaid on the Plan calendar. The url is a secret — never sent to the client. */
  calendarFeeds: CalendarFeed[];
};

export const DEFAULT_USER_SETTINGS: UserSettings = {
  defaultLanding: "today",
  weekStartsOn: 0,
  handedness: "right",
  dictationLanguage: "auto",
  pinnedBoardIds: [],
  whatsNewSeen: null,
  calendarFeeds: [],
};

export const MAX_CALENDAR_FEEDS = 8;

function parseCalendarFeeds(value: unknown): CalendarFeed[] {
  if (!Array.isArray(value)) return [];
  const feeds: CalendarFeed[] = [];
  for (const f of value) {
    if (!f || typeof f !== "object") continue;
    const { id, name, url, color } = f as Record<string, unknown>;
    if (typeof id !== "string" || typeof url !== "string" || !id || !url) continue;
    feeds.push({ id, url, name: typeof name === "string" && name ? name : "Calendar", color: typeof color === "string" ? color : "blue" });
    if (feeds.length >= MAX_CALENDAR_FEEDS) break;
  }
  return feeds;
}

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

const LANDINGS: LandingPage[] = ["today", "boards"];
// Older installs stored the retired surfaces; both fold into Today.
const LEGACY_LANDINGS: Record<string, LandingPage> = { "my-day": "today", notes: "today" };
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
  if (!raw) return { ...DEFAULT_USER_SETTINGS, pinnedBoardIds: [], calendarFeeds: [] };
  try {
    const o = JSON.parse(raw) as Partial<UserSettings>;
    return {
      defaultLanding:
        o.defaultLanding && LANDINGS.includes(o.defaultLanding)
          ? o.defaultLanding
          : (o.defaultLanding && LEGACY_LANDINGS[o.defaultLanding as string]) || "today",
      weekStartsOn:
        typeof o.weekStartsOn === "number" && o.weekStartsOn >= 0 && o.weekStartsOn <= 6
          ? Math.floor(o.weekStartsOn)
          : 0,
      handedness: o.handedness === "left" ? "left" : "right",
      dictationLanguage: o.dictationLanguage && DICTATION_VALUES.includes(o.dictationLanguage) ? o.dictationLanguage : "auto",
      pinnedBoardIds: parsePinnedBoardIds(o.pinnedBoardIds),
      whatsNewSeen: typeof o.whatsNewSeen === "string" ? o.whatsNewSeen.slice(0, 32) : null,
      calendarFeeds: parseCalendarFeeds(o.calendarFeeds),
    };
  } catch {
    return { ...DEFAULT_USER_SETTINGS, pinnedBoardIds: [], calendarFeeds: [] };
  }
}
