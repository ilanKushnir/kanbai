import { test } from "node:test";
import assert from "node:assert/strict";

import { ticketHref } from "@/lib/links";

const boards = [
  { id: "b1", slug: "alpha" },
  { id: "b2", slug: "beta" },
];

test("ticketHref deep-links to the owning board and the specific ticket", () => {
  const href = ticketHref({ id: "t9", boardId: "b2" }, boards);
  assert.equal(href, "/boards/beta?ticket=t9");
  // The link carries both identities: board slug and ticket id.
  assert.match(href, /\/boards\/beta(\?|$)/);
  assert.match(href, /[?&]ticket=t9(&|$)/);
});

test("ticketHref resolves the slug from the ticket's boardId, not order", () => {
  assert.equal(ticketHref({ id: "t1", boardId: "b1" }, boards), "/boards/alpha?ticket=t1");
});

test("ticketHref falls back to the boards index when the board is out of scope", () => {
  assert.equal(ticketHref({ id: "t1", boardId: "missing" }, boards), "/boards");
});


test("ticketHref can mark a ticket as opened from notes", () => {
  const href = ticketHref({ id: "t9", boardId: "b2" }, boards, { from: "notes" });
  assert.equal(href, "/boards/beta?ticket=t9&from=notes");
});
