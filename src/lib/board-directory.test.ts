import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildBoardSections, sharedSummary, BOARD_SECTION_LABELS } from "./board-directory";

// ── Sectioning: pinned first, then a role-derived section ────────────────────

const b = (id: string) => ({ id });

test("no pins: managers get one 'workspace' section, members one 'shared' section", () => {
  const boards = [b("a"), b("c"), b("b")];
  assert.deepEqual(buildBoardSections(boards, [], true), [{ key: "workspace", boards }]);
  assert.deepEqual(buildBoardSections(boards, [], false), [{ key: "shared", boards }]);
});

test("pinned boards split out on top, both sections keeping the board order", () => {
  const boards = [b("a"), b("c"), b("b"), b("d")];
  // Pin-list order is storage order; display follows the boards' own order.
  const sections = buildBoardSections(boards, ["d", "c"], true);
  assert.deepEqual(sections, [
    { key: "pinned", boards: [b("c"), b("d")] },
    { key: "workspace", boards: [b("a"), b("b")] },
  ]);
});

test("pin ids that don't match a visible board are ignored", () => {
  const boards = [b("a"), b("c")];
  const sections = buildBoardSections(boards, ["deleted", "other-workspace", "c"], false);
  assert.deepEqual(sections, [
    { key: "pinned", boards: [b("c")] },
    { key: "shared", boards: [b("a")] },
  ]);
});

test("all boards pinned: the empty main section is dropped", () => {
  assert.deepEqual(buildBoardSections([b("a")], ["a"], true), [{ key: "pinned", boards: [b("a")] }]);
});

test("no boards at all: a single empty main section remains", () => {
  assert.deepEqual(buildBoardSections([], ["x"], false), [{ key: "shared", boards: [] }]);
});

test("section labels state the actual semantics (no per-board ownership exists)", () => {
  assert.equal(BOARD_SECTION_LABELS.workspace, "Workspace boards");
  assert.equal(BOARD_SECTION_LABELS.shared, "Shared with you");
  assert.equal(BOARD_SECTION_LABELS.pinned, "Pinned");
});

// ── Shared indicator summary ─────────────────────────────────────────────────

const person = (id: string, name: string) => ({ id, name, avatarUrl: null, avatarColor: null });

test("board with no grants gets no face-pile summary", () => {
  assert.equal(sharedSummary({ sharedWith: [] }), null);
});

test("single grant: named label, one avatar", () => {
  const s = sharedSummary({ sharedWith: [person("u1", "Bob")] });
  assert.deepEqual(s, { avatars: [person("u1", "Bob")], overflow: 0, label: "Shared with Bob" });
});

test("many grants: capped avatars with an overflow count", () => {
  const people = ["A", "B", "C", "D", "E"].map((n, i) => person(`u${i}`, n));
  const s = sharedSummary({ sharedWith: people });
  assert.equal(s?.avatars.length, 3);
  assert.equal(s?.overflow, 2);
  assert.equal(s?.label, "Shared with 5 members");
});

// ── Wiring guards: the page, card component, and pin route stay honest ───────

const page = readFileSync("src/app/(app)/boards/page.tsx", "utf8");
const directory = readFileSync("src/components/board/boards-directory.tsx", "utf8");
const pinRoute = readFileSync("src/app/api/boards/[boardId]/pin/route.ts", "utf8");

test("boards page feeds the directory per-user pins and the viewer's role", () => {
  assert.match(page, /parseUserSettings\(ctx\.user\.settings\)/);
  assert.match(page, /pinnedBoardIds=\{pinnedBoardIds\}/);
  assert.match(page, /isManager=\{ctx\.isManager\}/);
  // The face-pile must exclude the viewer, and managers never show a grant chip.
  assert.match(page, /a\.user\.id !== ctx\.user\.id/);
  assert.match(page, /ctx\.isManager\s*\?\s*null/);
});

test("board card pin control is a real toggle: accessible state + per-user API", () => {
  assert.match(directory, /aria-pressed=\{pinned\}/);
  assert.match(directory, /aria-label=\{pinned \? `Unpin \$\{b\.name\}` : `Pin \$\{b\.name\}`\}/);
  assert.match(directory, /\/api\/boards\/\$\{board\.id\}\/pin/);
  assert.match(directory, /method: "PUT"/);
  // Mixed Hebrew/English board names render with bidi-safe direction.
  assert.match(directory, /dir="auto"/);
});

test("card indicators: public badge renders from isPublic, not the face-pile summary", () => {
  // The meta row must consider isPublic on its own now that sharedSummary is people-only.
  assert.match(directory, /shared \|\| b\.isPublic \|\| b\.viewerLevel === "view"/);
  assert.match(directory, /\{b\.isPublic && \(/);
});

test("every section renders a real h2 so the h1→h3 outline never skips a level", () => {
  assert.match(directory, /<h2 className="sr-only">/);
});

test("pin route authenticates and checks board access before touching settings", () => {
  assert.match(pinRoute, /getCurrentContext\(\)/);
  assert.match(pinRoute, /assertBoardAccess\(ctx, boardId\)/);
  assert.match(pinRoute, /parse\(pinBoardSchema/);
  assert.match(pinRoute, /setBoardPinned\(ctx\.user\.id, boardId, pinned\)/);
});
