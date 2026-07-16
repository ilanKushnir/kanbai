import assert from "node:assert/strict";
import test from "node:test";
import { buildChecklistHtml, type ExportData } from "./services/export";

// Behavior tests for the offline checklist HTML: notes lead, boards fold,
// user content is escaped, RTL lines carry their own direction, and the
// embedded script round-trips ticks + local-only extras as a progress file.

const data: ExportData = {
  app: "kanbai",
  version: 1,
  exportedAt: "2026-07-16T10:00:00.000Z",
  workspace: "Home",
  user: "Ilan",
  boards: [
    {
      id: "b1",
      name: "Roadmap <script>alert(1)</script>",
      slug: "roadmap",
      columns: [
        {
          id: "c1",
          name: "In Work",
          isDone: false,
          subStates: ["Doing", "Blocked"],
          tickets: [
            {
              id: "t1",
              number: 7,
              title: 'Fix the "big" bug',
              description: "",
              priority: "high",
              subState: "Doing",
              dueDate: "2026-07-20",
              done: false,
              labels: ["infra"],
              createdAt: "2026-07-01T00:00:00.000Z",
            },
            {
              id: "t2",
              number: 8,
              title: "לתקן באג ב-API",
              description: "",
              priority: "none",
              subState: null,
              dueDate: null,
              done: false,
              labels: [],
              createdAt: "2026-07-02T00:00:00.000Z",
            },
          ],
        },
        {
          id: "c2",
          name: "Done",
          isDone: true,
          subStates: [],
          tickets: [
            {
              id: "t3",
              number: 9,
              title: "Shipped already",
              description: "",
              priority: "none",
              subState: null,
              dueDate: null,
              done: true,
              labels: [],
              createdAt: "2026-07-03T00:00:00.000Z",
            },
          ],
        },
      ],
    },
  ],
  notes: [
    {
      id: "n1",
      body: "משימה דחופה",
      scheduledDay: "2026-07-16",
      doneOn: null,
      priority: "urgent",
      pinned: false,
      status: "inbox",
      createdAt: "2026-07-10T00:00:00.000Z",
    },
    {
      id: "n2",
      body: "unscheduled thought",
      scheduledDay: null,
      doneOn: null,
      priority: "none",
      pinned: false,
      status: "inbox",
      createdAt: "2026-07-11T00:00:00.000Z",
    },
  ],
};

const html = buildChecklistHtml(data);

test("notes come before boards", () => {
  const notesAt = html.indexOf("unscheduled thought");
  const boardAt = html.indexOf('data-board="b1"');
  assert.ok(notesAt > -1 && boardAt > -1);
  assert.ok(notesAt < boardAt, "notes section must render above the boards");
});

test("boards are collapsible <details> with a persisted id, open by default", () => {
  assert.match(html, /<details class="board" open data-board="b1">/);
  assert.match(html, /details\.board/); // styled summary/fold
  assert.match(html, /state\.\$open/); // fold state persists in localStorage
});

test("done columns are excluded; open tickets keep sub-state bands", () => {
  assert.ok(!html.includes("Shipped already"));
  assert.match(html, /class="band">Doing</);
  assert.ok(html.includes("due 2026-07-20"));
});

test("user content is escaped", () => {
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("Roadmap &lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("Fix the &quot;big&quot; bug"));
});

test("RTL lines carry dir=rtl, LTR lines dir=ltr, extras use dir=auto", () => {
  assert.match(html, /<li dir="rtl"><label><input type="checkbox" data-t="ticket" data-id="t2"/);
  assert.match(html, /<li dir="ltr"><label><input type="checkbox" data-t="ticket" data-id="t1"/);
  assert.match(html, /<li dir="rtl"><label><input type="checkbox" data-t="note" data-id="n1"/);
  assert.match(html, /id="x-input" dir="auto"/);
});

test("extras can be added offline and are included in the progress JSON", () => {
  assert.match(html, /id="x-add"/);
  assert.match(html, /state\.\$extras/);
  assert.match(html, /extras: extras/); // progress file carries them
  assert.match(html, /version: 2/);
});

test("progress + ticks persist in a per-export localStorage key", () => {
  assert.match(html, /kanbai-checklist-20260716100000/);
  assert.match(html, /localStorage\.setItem\(KEY/);
  assert.match(html, /kanbai-progress-/); // downloadable file name
  assert.match(html, /navigator\.clipboard/); // copy fallback for file://
});

test("header shows live progress out of tickets + notes (+ extras at runtime)", () => {
  // 2 open tickets + 2 open notes; the done-column ticket doesn't count.
  assert.match(html, /<span id="total-count">4<\/span>/);
  assert.match(html, /id="meter-fill"/);
});
