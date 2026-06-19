// Client-safe parsing of the User.settings JSON blob (personal preferences).

export type LandingPage = "my-day" | "notes" | "boards";
export type Handedness = "right" | "left";
export type UserSettings = {
  defaultLanding: LandingPage;
  /** First day of the week: 0 = Sunday … 6 = Saturday. Drives Notes scheduling. */
  weekStartsOn: number;
  /** Which hand holds the phone — puts mobile drag handles on that side. */
  handedness: Handedness;
};

export const DEFAULT_USER_SETTINGS: UserSettings = {
  defaultLanding: "my-day",
  weekStartsOn: 0,
  handedness: "right",
};

const LANDINGS: LandingPage[] = ["my-day", "notes", "boards"];

export function parseUserSettings(raw?: string | null): UserSettings {
  if (!raw) return { ...DEFAULT_USER_SETTINGS };
  try {
    const o = JSON.parse(raw) as Partial<UserSettings>;
    return {
      defaultLanding: o.defaultLanding && LANDINGS.includes(o.defaultLanding) ? o.defaultLanding : "my-day",
      weekStartsOn:
        typeof o.weekStartsOn === "number" && o.weekStartsOn >= 0 && o.weekStartsOn <= 6
          ? Math.floor(o.weekStartsOn)
          : 0,
      handedness: o.handedness === "left" ? "left" : "right",
    };
  } catch {
    return { ...DEFAULT_USER_SETTINGS };
  }
}
