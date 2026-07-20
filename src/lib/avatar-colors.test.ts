import assert from "node:assert/strict";
import test from "node:test";

import { AVATAR_COLORS, DEFAULT_AVATAR_COLOR, isAvatarColor } from "@/lib/avatar-colors";

type Rgb = { r: number; g: number; b: number };

function hex(h: string): Rgb {
  const n = parseInt(h.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function luminance({ r, g, b }: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("every avatar color keeps white initials AA-legible", () => {
  const white = { r: 255, g: 255, b: 255 };
  for (const { value, label } of AVATAR_COLORS) {
    assert.match(value, /^#[0-9a-f]{6}$/, `${label}: stored as lowercase hex`);
    const c = contrast(white, hex(value));
    assert.ok(c >= 4.5, `${label} (${value}): white initials contrast ${c.toFixed(2)} < 4.5`);
  }
});

test("the default color is part of the curated palette", () => {
  assert.ok(isAvatarColor(DEFAULT_AVATAR_COLOR));
});

test("isAvatarColor rejects anything outside the palette", () => {
  assert.equal(isAvatarColor("#123456"), false);
  assert.equal(isAvatarColor(""), false);
  assert.equal(isAvatarColor(null), false);
  assert.equal(isAvatarColor("iris"), false);
});

test("palette values are unique", () => {
  const values = AVATAR_COLORS.map((c) => c.value);
  assert.equal(new Set(values).size, values.length);
});
