import { WEBHOOK_EVENTS, type WebhookEvent } from "./constants";

/**
 * Per-agent webhook event subscriptions, stored as a compact spec string on
 * Agent.webhookEvents:
 *   "*"            → every event, including ones added in future versions
 *   "a,b,c"        → only those events
 *   ""             → nothing but "ping"
 * "ping" is always delivered regardless of the spec so "Send test" and setup
 * verification keep working. Pure module — safe for client components.
 */

export const ALL_EVENTS_SPEC = "*";

/** Events a user can subscribe to (ping is implicit, always on). */
export const SELECTABLE_EVENTS = WEBHOOK_EVENTS.filter((e) => e !== "ping");

export function isSubscribed(spec: string | null | undefined, event: WebhookEvent): boolean {
  if (event === "ping") return true;
  const s = (spec ?? ALL_EVENTS_SPEC).trim();
  if (s === ALL_EVENTS_SPEC) return true;
  return s.split(",").map((e) => e.trim()).includes(event);
}

/** The concrete event list a spec resolves to today (excluding implicit ping). */
export function resolveEventSpec(spec: string | null | undefined): WebhookEvent[] {
  return SELECTABLE_EVENTS.filter((e) => isSubscribed(spec, e));
}

/**
 * Collapse a selected list back into a spec. Selecting every known event
 * stores "*" so future event types stay opted-in rather than silently dropped.
 */
export function eventsToSpec(events: readonly WebhookEvent[]): string {
  const set = new Set(events.filter((e) => e !== "ping"));
  if (SELECTABLE_EVENTS.every((e) => set.has(e))) return ALL_EVENTS_SPEC;
  return SELECTABLE_EVENTS.filter((e) => set.has(e)).join(",");
}

/** Toggle one event in a spec (used by the subscription chips in the UI). */
export function toggleEventSpec(spec: string | null | undefined, event: WebhookEvent): string {
  const current = new Set(resolveEventSpec(spec));
  if (current.has(event)) current.delete(event);
  else current.add(event);
  return eventsToSpec([...current]);
}
