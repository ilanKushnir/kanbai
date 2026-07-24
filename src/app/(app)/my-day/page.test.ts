import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const myDayPage = readFileSync("src/app/(app)/my-day/page.tsx", "utf8");
const doneButton = readFileSync("src/components/my-day/done-button.tsx", "utf8");

test("My Day queries are scoped to tickets assigned to the current user", () => {
  // Both the open-ticket and done-ticket queries must carry the assignee scope —
  // unassigned tickets and tickets assigned to other users/agents are not "my day".
  assert.match(myDayPage, /column: \{ isDone: false \}, deletedAt: null, \.\.\.myDayTicketScope\(ctx\.user\.id\)/);
  assert.match(myDayPage, /column: \{ isDone: true \}, deletedAt: null, \.\.\.myDayTicketScope\(ctx\.user\.id\)/);
});

test("My Day focus note cards expose a Done action backed by the note done server action", () => {
  const noteCard = myDayPage.slice(myDayPage.indexOf("function FocusNoteCard"), myDayPage.indexOf("function DeckRow"));
  assert.match(myDayPage, /async function markMyDayNoteDone/);
  assert.match(noteCard, /<form action=\{markMyDayNoteDone\}/);
  assert.match(noteCard, /name="noteId"/);
  assert.match(noteCard, /<DoneControl /); // visible "Done" label lives in the client DoneButton
  assert.match(doneButton, /\bDone\b\s*<\/button>/);
  assert.match(doneButton, /useFormStatus/); // pending-aware: spinner + disabled while saving
});

test("My Day focus ticket cards expose a Done action backed by the ticket done server action", () => {
  const ticketCard = myDayPage.slice(myDayPage.indexOf("function FocusCard"), myDayPage.indexOf("function FocusNoteCard"));
  assert.match(myDayPage, /async function markMyDayTicketDone/);
  assert.match(myDayPage, /assertTicketAccess\(ctx, ticketId, true\)/);
  assert.match(ticketCard, /<form action=\{markMyDayTicketDone\}/);
  assert.match(ticketCard, /name="ticketId"/);
  assert.match(ticketCard, /<DoneControl /); // label rendered by the client DoneButton (pending-aware)
});


test("My Day mobile focus cards keep titles in a wide RTL-safe content column", () => {
  const ticketCard = myDayPage.slice(myDayPage.indexOf("function FocusCard"), myDayPage.indexOf("function FocusNoteCard"));
  const noteCard = myDayPage.slice(myDayPage.indexOf("function FocusNoteCard"), myDayPage.indexOf("function DoneControl"));

  assert.match(ticketCard, /className="group rounded-2xl/);
  assert.match(ticketCard, /className="flex min-w-0 items-start gap-3/);
  assert.match(ticketCard, /className="min-w-0 flex-1 text-start/);
  assert.match(ticketCard, /className="text-base font-semibold leading-snug break-words/);
  assert.match(ticketCard, /className="mt-3 flex flex-wrap items-center gap-2/);
  assert.doesNotMatch(ticketCard, /items-center gap-3 rounded-2xl[^]*ml-auto flex shrink-0 items-center gap-2/);

  assert.match(noteCard, /className="group rounded-2xl/);
  assert.match(noteCard, /className="flex min-w-0 items-start gap-3/);
  assert.match(noteCard, /className="min-w-0 flex-1 text-start/);
  assert.match(noteCard, /className="line-clamp-3 text-base font-semibold leading-snug break-words/);
  assert.match(noteCard, /className="mt-3 flex flex-wrap items-center gap-2/);
});

test("My Day mobile shell leaves enough bottom scroll room for the fixed nav", () => {
  assert.match(myDayPage, /pb-24 pt-6 md:px-6 md:pb-8/);
});


test("My Day aside surfaces Echoes from today and Tomorrow Radar as compact expandable panels", () => {
  // EchoRow sits between the two panel functions; RadarRow closes the file.
  const echoesPanel = myDayPage.slice(myDayPage.indexOf("function EchoesPanel"), myDayPage.indexOf("function TomorrowRadarPanel"));
  const radarPanel = myDayPage.slice(myDayPage.indexOf("function TomorrowRadarPanel"));

  assert.match(myDayPage, /Echoes from today/);
  assert.match(myDayPage, /Tomorrow Radar/);
  assert.match(myDayPage, /<EchoesPanel echoes=\{echoes\} \/>/);
  assert.match(myDayPage, /<TomorrowRadarPanel radar=\{radar\} dateLabel=\{tomorrowLabel\} \/>/);

  // Peek → expand-to-all via native details/summary, and honest empty states.
  assert.match(echoesPanel, /<details/);
  assert.match(radarPanel, /<details/);
  assert.match(echoesPanel, /Quiet so far/);
  assert.match(radarPanel, /Clear skies/);

  // RTL-safe rows: dir="auto" titles in logical-property columns.
  assert.match(echoesPanel, /dir="auto"/);
  assert.match(radarPanel, /dir="auto"/);
  assert.match(echoesPanel, /text-start break-words/);
  assert.match(radarPanel, /text-start break-words/);

  // Completed echoes carry their completion time and never re-render due
  // chips — a finished item must not read "overdue".
  assert.match(echoesPanel, /doneAtLabel\(item\.ticket\.completedAt\)/);
  assert.doesNotMatch(echoesPanel, /dueMeta/);
});

test("My Day Anytime renders as a compact shelf, not a numbered queue group", () => {
  // Anytime is optional extra capacity, so it must not reuse the QueueGroup
  // command-list treatment or join the day's execution numbering.
  assert.doesNotMatch(myDayPage, /<QueueGroup[^>]*title="Anytime"/);
  assert.doesNotMatch(myDayPage, /anytimeOffset/);
  // The shelf is always mounted (its empty state is part of the design) and
  // the main lane's "clear" check only counts dated work.
  assert.match(myDayPage, /<AnytimeShelf items=\{queue\.anytime\} \/>/);
  assert.match(myDayPage, /const queueEmpty = remaining === 0/);
});

test("My Day Anytime shelf previews a few items and expands natively to the rest", () => {
  const shelf = myDayPage.slice(myDayPage.indexOf("const ANYTIME_PEEK"), myDayPage.indexOf("function AnytimeRow"));

  // Top-shelf preview within the 3–5 target, remainder split off for expand.
  assert.match(myDayPage, /const ANYTIME_PEEK = 4;/);
  assert.match(shelf, /items\.slice\(0, ANYTIME_PEEK\)/);
  assert.match(shelf, /items\.slice\(ANYTIME_PEEK\)/);

  // Native details/summary expand with a clear hidden count, plus a count pill
  // and a polished empty state — same panel grammar as Echoes/Radar.
  assert.match(shelf, /<details className="group\/shelf/);
  assert.match(shelf, /\{shelfRest\.length\} hidden/);
  assert.match(shelf, /group-open\/shelf:hidden/);
  assert.match(shelf, /\{items\.length\}<\/span>/);
  assert.match(shelf, /The shelf is clear/);
});

test("My Day Anytime shelf rows keep item actions and stay RTL-safe on a 390px screen", () => {
  const row = myDayPage.slice(myDayPage.indexOf("function AnytimeRow"), myDayPage.indexOf("const countLabel"));

  // Both kinds render: tickets and notes keep their navigation and Done action.
  assert.match(row, /\/boards\/\$\{item\.ticket\.boardSlug\}\?ticket=\$\{item\.ticket\.id\}/);
  assert.match(row, /\/notes\?focus=\$\{item\.note\.id\}/);
  assert.match(row, /<form action=\{isTicket \? markMyDayTicketDone : markMyDayNoteDone\}/);
  assert.match(row, /name=\{isTicket \? "ticketId" : "noteId"\}/);
  assert.match(row, /<DoneControl/);
  assert.match(row, /doneColumnId/); // tickets without a done column stay disabled

  // 390px / RTL guards: shrinkable text column, bidi-aware full-width titles,
  // logical padding, wrapping meta — nothing that can force horizontal scroll.
  assert.match(row, /className="flex min-w-0 items-center gap-2/);
  assert.match(row, /className="block min-w-0 flex-1/);
  assert.match(row, /dir="auto"/);
  assert.match(row, /line-clamp-2 min-w-0 text-sm font-medium text-start break-words/);
  assert.match(row, /pe-2 ps-3/);
  assert.match(row, /flex-wrap/);
  const shelfAndRow = myDayPage.slice(myDayPage.indexOf("const ANYTIME_PEEK"), myDayPage.indexOf("const countLabel"));
  assert.doesNotMatch(shelfAndRow, /whitespace-nowrap/);
  assert.doesNotMatch(shelfAndRow, /\bw-\[\d/); // no fixed pixel widths on the shelf
  assert.doesNotMatch(shelfAndRow, /\bml-|\bmr-|\bpl-|\bpr-|text-left|text-right/); // logical properties only
});

test("My Day done controls are outline-first and completed items render a collapsed Done archive", () => {
  assert.match(myDayPage, /function DoneControl/);
  assert.match(myDayPage, /border-success/);
  // Filled state uses the success-fg token (contrast-safe in dark mode), not raw white.
  assert.match(myDayPage, /hover:bg-success hover:text-success-fg/);
  assert.match(myDayPage, /<details[^>]*>/);
  assert.match(myDayPage, /<summary[^>]*>[^]*Done archive/);
});
