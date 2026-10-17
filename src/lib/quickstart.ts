// Copy-paste curl examples advertised by GET /api/v1/me.

/** Copy-paste calls that cover a day's work. `$KANBAI_KEY` is the bearer key. */
export function buildQuickstart(baseUrl: string): string[] {
  const b = baseUrl || "http://localhost:3000/api/v1";
  const h = `-H "Authorization: Bearer $KANBAI_KEY"`;
  const j = `-H "content-type: application/json"`;
  return [
    `curl ${b}/me ${h}`,
    `curl ${b}/today ${h}`,
    // Everyday errand → a simple task on Today (default day: today).
    `curl -X POST ${b}/tasks ${h} ${j} -d '{"title":"Order groceries"}'`,
    `curl -X POST ${b}/tasks/<taskId>/done ${h}`,
    // Work on a specific project → a ticket on that project's board.
    `curl -X POST ${b}/tickets ${h} ${j} -d '{"boardId":"<boardId from /boards>","title":"Design the LED mount","stage":"backlog","priority":"medium"}'`,
    `curl -X POST ${b}/tickets/<ticketId>/done ${h}`,
    `curl -X POST ${b}/tickets/<ticketId>/comments ${h} ${j} -d '{"content":"Booked for Tuesday 10:00."}'`,
  ];
}
