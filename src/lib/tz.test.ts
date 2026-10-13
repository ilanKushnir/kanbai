import test from "node:test";
import assert from "node:assert/strict";
import { addDaysYmd, endOfDayInTz, startOfDayInTz, todayYmd, tzOffsetMinutes, ymdInTz, zonedTime } from "./tz";

// Calendar-day math in a fixed IANA zone — the server (Docker, UTC) must agree
// with the workspace (Asia/Jerusalem) on what "today" is.

const TZ = "Asia/Jerusalem";

test("ymdInTz follows the zone, not the host", () => {
  // 22:30Z on Oct 13 is already 01:30 on Oct 14 in Jerusalem (UTC+3 in summer).
  assert.equal(ymdInTz(new Date("2026-10-13T22:30:00Z"), TZ), "2026-10-14");
  assert.equal(ymdInTz(new Date("2026-10-13T22:30:00Z"), "UTC"), "2026-10-13");
  // 22:30Z on Jan 13 is 00:30 on Jan 14 (UTC+2 in winter).
  assert.equal(ymdInTz(new Date("2026-01-13T22:30:00Z"), TZ), "2026-01-14");
  assert.equal(ymdInTz(new Date("2026-01-13T21:30:00Z"), TZ), "2026-01-13");
});

test("todayYmd accepts an explicit now", () => {
  assert.equal(todayYmd(TZ, new Date("2026-06-30T21:00:00Z")), "2026-07-01");
});

test("addDaysYmd is pure calendar math across month/year ends", () => {
  assert.equal(addDaysYmd("2026-10-31", 1), "2026-11-01");
  assert.equal(addDaysYmd("2026-12-31", 1), "2027-01-01");
  assert.equal(addDaysYmd("2026-03-01", -1), "2026-02-28");
  assert.equal(addDaysYmd("2026-10-13", 7), "2026-10-20");
});

test("zonedTime resolves local wall-clock to the right instant incl. DST", () => {
  assert.equal(tzOffsetMinutes(new Date("2026-07-01T12:00:00Z"), TZ), 180);
  assert.equal(tzOffsetMinutes(new Date("2026-01-01T12:00:00Z"), TZ), 120);
  assert.equal(zonedTime("2026-07-01", 12, 0, TZ).toISOString(), "2026-07-01T09:00:00.000Z");
  assert.equal(zonedTime("2026-01-15", 12, 0, TZ).toISOString(), "2026-01-15T10:00:00.000Z");
  assert.equal(zonedTime("2026-01-15", 12, 0, "UTC").toISOString(), "2026-01-15T12:00:00.000Z");
});

test("day bounds are half-open [start, nextStart)", () => {
  const start = startOfDayInTz("2026-10-13", TZ);
  const end = endOfDayInTz("2026-10-13", TZ);
  assert.equal(start.toISOString(), "2026-10-12T21:00:00.000Z");
  assert.equal(end.toISOString(), "2026-10-13T21:00:00.000Z");
  assert.equal(ymdInTz(start, TZ), "2026-10-13");
  assert.equal(ymdInTz(new Date(end.getTime() - 1), TZ), "2026-10-13");
  assert.equal(ymdInTz(end, TZ), "2026-10-14");
});
