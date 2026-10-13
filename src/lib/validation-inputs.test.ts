import test from "node:test";
import assert from "node:assert/strict";
import {
  createCommentSchema,
  createTicketV1Schema,
  dueDateInput,
  dueDateSchema,
  moveTicketSchema,
  normalizeDueDate,
  updateTicketSchema,
} from "./validation";
import { tzOffsetMinutes, workspaceTz } from "./tz";

// The dueDate contract (formerly checked by scripts/check-webhook-policy.ts)
// plus the forgiving input aliases every agent write accepts.

test("dueDate accepts date-only / Z / offset and rejects ambiguous or garbage input", () => {
  const accept = ["2026-06-20", "2026-06-20T17:00:00.000Z", "2026-06-20T17:00:00Z", "2026-06-20T17:00:00+02:00"];
  const reject = ["2026-06-20T17:00:00", "garbage", "2026-13-40", "20/06/2026", ""];
  for (const v of accept) assert.equal(dueDateSchema.safeParse(v).success, true, v);
  for (const v of reject) assert.equal(dueDateSchema.safeParse(v).success, false, v);
});

test("normalizeDueDate: instants pass through as UTC; a plain day lands at noon in KANBAI_TZ", () => {
  assert.equal(normalizeDueDate("2026-06-20T17:00:00+02:00"), "2026-06-20T15:00:00.000Z");
  assert.equal(normalizeDueDate("2026-06-20T17:00:00Z"), "2026-06-20T17:00:00.000Z");
  const tz = workspaceTz();
  const noon = new Date(normalizeDueDate("2026-01-15"));
  const offset = tzOffsetMinutes(noon, tz);
  // 12:00 local == 12:00 - offset in UTC.
  assert.equal(noon.getUTCHours() * 60 + noon.getUTCMinutes(), (12 * 60 - offset + 24 * 60) % (24 * 60));
  if (tz === "Asia/Jerusalem") assert.equal(noon.toISOString(), "2026-01-15T10:00:00.000Z");
  assert.equal(normalizeDueDate(null), null);
  assert.equal(normalizeDueDate(undefined), undefined);
});

test("dueDateInput schema normalizes and accepts null", () => {
  assert.equal(dueDateInput.parse(null), null);
  assert.match(dueDateInput.parse("2026-06-20") as string, /^2026-06-20T\d{2}:00:00\.000Z$/);
  const ticket = createTicketV1Schema.parse({ boardId: "b", title: "t", dueDate: "2026-06-20T17:00:00+02:00" });
  assert.equal(ticket.dueDate, "2026-06-20T15:00:00.000Z");
  const cleared = updateTicketSchema.parse({ dueDate: null });
  assert.equal(cleared.dueDate, null);
});

test("comments accept `content` as an alias of `body`", () => {
  assert.deepEqual(createCommentSchema.parse({ body: "hi" }), { body: "hi" });
  assert.deepEqual(createCommentSchema.parse({ content: "  hello " }), { body: "hello" });
  assert.equal(createCommentSchema.safeParse({}).success, false);
  assert.equal(createCommentSchema.safeParse({ content: "   " }).success, false);
});

test("move accepts columnId | column | columnName | stage and an optional position", () => {
  assert.equal(moveTicketSchema.safeParse({ column: "Done" }).success, true);
  assert.equal(moveTicketSchema.safeParse({ columnName: "Done", position: 2 }).success, true);
  assert.equal(moveTicketSchema.safeParse({ stage: "done", subState: null }).success, true);
  assert.equal(moveTicketSchema.safeParse({ columnId: "c1" }).success, true);
  assert.equal(moveTicketSchema.safeParse({ position: 0 }).success, false);
  assert.equal(moveTicketSchema.safeParse({ stage: "nope" }).success, false);
});

test("create/patch accept column aliases and labelNames", () => {
  const c = createTicketV1Schema.parse({ boardId: "b", title: "t", column: "backlog", labelNames: ["a", "b"] });
  assert.equal(c.column, "backlog");
  assert.deepEqual(c.labelNames, ["a", "b"]);
  const p = updateTicketSchema.parse({ stage: "active", labelNames: ["x"] });
  assert.equal(p.stage, "active");
  assert.deepEqual(p.labelNames, ["x"]);
});
