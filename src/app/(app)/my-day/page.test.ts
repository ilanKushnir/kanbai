import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const myDayPage = readFileSync("src/app/(app)/my-day/page.tsx", "utf8");

test("My Day focus note cards expose a Done action backed by the note done server action", () => {
  const noteCard = myDayPage.slice(myDayPage.indexOf("function FocusNoteCard"), myDayPage.indexOf("function DeckRow"));
  assert.match(myDayPage, /async function markMyDayNoteDone/);
  assert.match(noteCard, /<form action=\{markMyDayNoteDone\}/);
  assert.match(noteCard, /name="noteId"/);
  assert.match(noteCard, />\s*Done\s*</);
});

test("My Day focus ticket cards expose a Done action backed by the ticket done server action", () => {
  const ticketCard = myDayPage.slice(myDayPage.indexOf("function FocusCard"), myDayPage.indexOf("function FocusNoteCard"));
  assert.match(myDayPage, /async function markMyDayTicketDone/);
  assert.match(myDayPage, /assertTicketAccess\(ctx, ticketId, true\)/);
  assert.match(ticketCard, /<form action=\{markMyDayTicketDone\}/);
  assert.match(ticketCard, /name="ticketId"/);
  assert.match(ticketCard, />\s*Done\s*</);
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


test("My Day done controls are outline-first and completed items render a collapsed Done archive", () => {
  assert.match(myDayPage, /function DoneControl/);
  assert.match(myDayPage, /border-success/);
  assert.match(myDayPage, /bg-success text-white/);
  assert.match(myDayPage, /<details[^>]*>/);
  assert.match(myDayPage, /<summary[^>]*>[^]*Done archive/);
});
