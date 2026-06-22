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


test("My Day done controls are outline-first and completed items render a collapsed Done archive", () => {
  assert.match(myDayPage, /function DoneControl/);
  assert.match(myDayPage, /border-success/);
  assert.match(myDayPage, /bg-success text-white/);
  assert.match(myDayPage, /<details[^>]*>/);
  assert.match(myDayPage, /<summary[^>]*>[^]*Done archive/);
});
