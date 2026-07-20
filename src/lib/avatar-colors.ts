// Curated palette for the initials avatar. Every value must keep white
// initials legible (≥ 4.5:1 on the solid color — guarded by avatar-colors.test).
// Stored on User.avatarColor as the hex itself (mirrors Agent.color), so the
// Avatar component needs no lookup; null/absent falls back to the brand iris.

export const AVATAR_COLORS: { value: string; label: string }[] = [
  { value: "#6d5dfb", label: "Iris" },
  { value: "#4c36d4", label: "Indigo" },
  { value: "#7c3aed", label: "Violet" },
  { value: "#be185d", label: "Magenta" },
  { value: "#dc3355", label: "Rose" },
  { value: "#c2410c", label: "Ember" },
  { value: "#047857", label: "Emerald" },
  { value: "#0f766e", label: "Teal" },
  { value: "#2563eb", label: "Blue" },
  { value: "#52607b", label: "Slate" },
];

/** The brand iris the Avatar component falls back to when no color is stored. */
export const DEFAULT_AVATAR_COLOR = "#6d5dfb";

export function isAvatarColor(value: unknown): value is string {
  return typeof value === "string" && AVATAR_COLORS.some((c) => c.value === value);
}
