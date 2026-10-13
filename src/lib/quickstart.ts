// Copy-paste curl examples advertised by GET /api/v1/me.

/** Five copy-paste calls that cover a day's work. `$KANBAI_KEY` is the bearer key. */
export function buildQuickstart(baseUrl: string): string[] {
  const b = baseUrl || "http://localhost:3000/api/v1";
  const h = `-H "Authorization: Bearer $KANBAI_KEY"`;
  const j = `-H "content-type: application/json"`;
  return [
    `curl ${b}/me ${h}`,
    `curl ${b}/today ${h}`,
    `curl -X POST ${b}/tickets ${h} ${j} -d '{"boardId":"<boardId from /boards>","title":"Renew passport","column":"Backlog","priority":"high","dueDate":"2026-10-20"}'`,
    `curl -X POST ${b}/tickets/<ticketId>/move ${h} ${j} -d '{"stage":"done"}'`,
    `curl -X POST ${b}/tickets/<ticketId>/comments ${h} ${j} -d '{"content":"Booked for Tuesday 10:00."}'`,
  ];
}
