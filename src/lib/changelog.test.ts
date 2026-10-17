import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CHANGELOG, LATEST_RELEASE_VERSION } from "./changelog";
import { APP_VERSION } from "./version";
import { parseUserSettings } from "./user-settings";

const semver = (v: string) => v.split(".").map(Number);
const cmp = (a: string, b: string) => {
  const [x, y] = [semver(a), semver(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

test("changelog is newest-first, unique, and never ahead of the app", () => {
  const versions = CHANGELOG.map((r) => r.version);
  assert.equal(new Set(versions).size, versions.length);
  for (let i = 1; i < versions.length; i++) assert.ok(cmp(versions[i - 1], versions[i]) > 0, `${versions[i - 1]} before ${versions[i]}`);
  assert.equal(LATEST_RELEASE_VERSION, versions[0]);
  assert.ok(cmp(APP_VERSION, LATEST_RELEASE_VERSION) >= 0, "latest changelog entry is newer than APP_VERSION");
  for (const r of CHANGELOG) {
    assert.ok(r.items.length > 0);
    for (const it of r.items) assert.ok(it.emoji && it.title && it.body);
  }
});

test("seen marker round-trips through user settings", () => {
  assert.equal(parseUserSettings(null).whatsNewSeen, null);
  assert.equal(parseUserSettings(JSON.stringify({ whatsNewSeen: "0.13.0" })).whatsNewSeen, "0.13.0");
});

test("the dialog is mounted for every signed-in page and new accounts start as seen", () => {
  assert.match(readFileSync("src/app/(app)/layout.tsx", "utf8"), /<WhatsNew seenVersion=/);
  assert.match(readFileSync("src/app/api/auth/signup/route.ts", "utf8"), /whatsNewSeen: LATEST_RELEASE_VERSION/);
  assert.match(readFileSync("src/lib/services/invites.ts", "utf8"), /whatsNewSeen: LATEST_RELEASE_VERSION/);
});
