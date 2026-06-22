import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const homeRedirect = readFileSync("src/components/home-redirect.tsx", "utf8");

test("signed-in home defaults to My Day when no user preference is set", () => {
  assert.match(homeRedirect, /router\.replace\("\/my-day"\)/);
  assert.doesNotMatch(homeRedirect, /matchMedia\("\(max-width: 767px\)"\)/);
});
