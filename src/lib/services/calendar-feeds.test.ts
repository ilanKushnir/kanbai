import { test } from "node:test";
import assert from "node:assert/strict";
import ICAL from "ical.js";
import { expandEvents, normalizeFeedUrl, feedHost } from "./calendar-feeds";

// A Google-style feed: a weekly standup (one occurrence moved, one removed),
// a cancelled one-off, a 3-day all-day trip and a UTC one-off.
const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "X-WR-CALNAME:Family",
  "BEGIN:VTIMEZONE",
  "TZID:Asia/Jerusalem",
  "BEGIN:STANDARD",
  "DTSTART:19701025T020000",
  "TZOFFSETFROM:+0300",
  "TZOFFSETTO:+0200",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "BEGIN:DAYLIGHT",
  "DTSTART:19700327T020000",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0300",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1FR",
  "END:DAYLIGHT",
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  "UID:standup",
  "SUMMARY:Standup",
  "DTSTART;TZID=Asia/Jerusalem:20261005T093000",
  "DTEND;TZID=Asia/Jerusalem:20261005T100000",
  "RRULE:FREQ=WEEKLY;BYDAY=MO",
  "EXDATE;TZID=Asia/Jerusalem:20261019T093000",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:standup",
  "RECURRENCE-ID;TZID=Asia/Jerusalem:20261012T093000",
  "SUMMARY:Standup (moved)",
  "DTSTART;TZID=Asia/Jerusalem:20261013T110000",
  "DTEND;TZID=Asia/Jerusalem:20261013T113000",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:trip",
  "SUMMARY:Eilat trip",
  "DTSTART;VALUE=DATE:20261015",
  "DTEND;VALUE=DATE:20261018",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:gone",
  "SUMMARY:Cancelled thing",
  "STATUS:CANCELLED",
  "DTSTART:20261014T080000Z",
  "DTEND:20261014T090000Z",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:call",
  "SUMMARY:Call",
  "DTSTART:20261016T140000Z",
  "DTEND:20261016T143000Z",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

function parse() {
  const comp = new ICAL.Component(ICAL.parse(ICS));
  for (const tz of comp.getAllSubcomponents("vtimezone")) ICAL.TimezoneService.register(tz);
  return comp;
}

test("expands recurrence with exceptions, all-day ranges, skips cancelled", () => {
  const events = expandEvents(parse(), "f1", "2026-10-01", "2026-10-31");
  const titles = events.map((e) => `${e.title}@${e.allDay ? e.startDay : e.start}`).sort();
  assert.deepEqual(titles, [
    "Call@2026-10-16T14:00:00.000Z",
    "Eilat trip@2026-10-15",
    "Standup (moved)@2026-10-13T08:00:00.000Z", // 11:00 Jerusalem (UTC+3)
    "Standup@2026-10-05T06:30:00.000Z",
    "Standup@2026-10-26T07:30:00.000Z", // after the DST change: UTC+2
  ]);
  const trip = events.find((e) => e.title === "Eilat trip")!;
  assert.equal(trip.endDay, "2026-10-17"); // DTEND is exclusive
});

test("range is honoured (with a day of slack for zone offsets; the client places events on exact days)", () => {
  const titles = expandEvents(parse(), "f1", "2026-10-15", "2026-10-15").map((e) => e.title).sort();
  assert.deepEqual(titles, ["Call", "Eilat trip"]); // Call is on the 16th — inside the slack
  assert.equal(expandEvents(parse(), "f1", "2026-11-01", "2026-11-03").filter((e) => e.title === "Standup").length, 1); // Mon Nov 2
});

test("feed URLs: webcal becomes https, private and plain-http addresses are refused", () => {
  assert.equal(normalizeFeedUrl("webcal://p01-caldav.icloud.com/x.ics"), "https://p01-caldav.icloud.com/x.ics");
  for (const bad of ["http://calendar.google.com/x.ics", "https://localhost/x", "https://192.168.1.20/x.ics", "https://10.0.0.1/a", "https://[::1]/a", "nope"]) {
    assert.throws(() => normalizeFeedUrl(bad), Error, bad);
  }
  assert.equal(feedHost("https://calendar.google.com/calendar/ical/x/private-y/basic.ics"), "calendar.google.com");
});

test("agentCalendar: local times in the workspace zone, all-day first, only the asked days", async () => {
  const { agentCalendar, clearFeedCache } = await import("./calendar-feeds");
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:lunch",
    "SUMMARY:Lunch with Yuval",
    "LOCATION:Café Noir",
    "DTSTART:20261018T100000Z",
    "DTEND:20261018T110000Z",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:standup",
    "SUMMARY:Standup",
    "DTSTART:20261018T063000Z",
    "DTEND:20261018T070000Z",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:bday",
    "SUMMARY:Mom's birthday",
    "DTSTART;VALUE=DATE:20261018",
    "DTEND;VALUE=DATE:20261019",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:tomorrow",
    "SUMMARY:Dentist",
    "DTSTART:20261019T080000Z",
    "DTEND:20261019T083000Z",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(ics, { status: 200 })) as typeof fetch;
  try {
    clearFeedCache();
    const settings = JSON.stringify({ calendarFeeds: [{ id: "f1", name: "Family", url: "https://calendar.example.com/a.ics", color: "blue" }] });
    const cal = await agentCalendar(settings, "2026-10-18", "2026-10-18", "Asia/Jerusalem");
    assert.equal(cal.connected, true);
    assert.deepEqual(
      cal.events.map((e) => [e.title, e.allDay, e.start, e.end, e.calendar]),
      [
        ["Mom's birthday", true, null, null, "Family"],
        ["Standup", false, "09:30", "10:00", "Family"],
        ["Lunch with Yuval", false, "13:00", "14:00", "Family"],
      ],
    );
    assert.equal(cal.events[2].location, "Café Noir");
    assert.deepEqual(await agentCalendar(null, "2026-10-18", "2026-10-18", "Asia/Jerusalem"), { connected: false, events: [], errors: [] });
  } finally {
    globalThis.fetch = realFetch;
    clearFeedCache();
  }
});
