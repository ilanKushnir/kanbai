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

test("My Day done controls are outline-first and completed items render a collapsed Done archive", () => {
  assert.match(myDayPage, /function DoneControl/);
  assert.match(myDayPage, /border-success/);
  // Filled state uses the success-fg token (contrast-safe in dark mode), not raw white.
  assert.match(myDayPage, /hover:bg-success hover:text-success-fg/);
  assert.match(myDayPage, /<details[^>]*>/);
  assert.match(myDayPage, /<summary[^>]*>[^]*Done archive/);
});
