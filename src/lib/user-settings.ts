// Client-safe parsing of the User.settings JSON blob (personal preferences).

export type LandingPage = "my-day" | "notes" | "boards";
export type UserSettings = { defaultLanding: LandingPage };

export const DEFAULT_USER_SETTINGS: UserSettings = { defaultLanding: "my-day" };

const LANDINGS: LandingPage[] = ["my-day", "notes", "boards"];

export function parseUserSettings(raw?: string | null): UserSettings {
  if (!raw) return { ...DEFAULT_USER_SETTINGS };
  try {
    const o = JSON.parse(raw) as Partial<UserSettings>;
    return {
      defaultLanding: o.defaultLanding && LANDINGS.includes(o.defaultLanding) ? o.defaultLanding : "my-day",
    };
  } catch {
    return { ...DEFAULT_USER_SETTINGS };
  }
}
