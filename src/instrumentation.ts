/**
 * Server start-up hook. Pins the process timezone so every server-side
 * "today" (Today page, nav badge, agenda for agents, note rollover) is judged
 * in the household's wall-clock, not the container's UTC. KANBAI_TZ / TZ win
 * when set; Asia/Jerusalem is the default for this deployment.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return;
  const tz = process.env.KANBAI_TZ || process.env.TZ || "Asia/Jerusalem";
  process.env.TZ = tz;
  process.env.KANBAI_TZ = tz;
}
