import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Static guards for the "deep ink, vivid iris" color system: the tokens live
 * in globals.css and are consumed through CSS variables, so these tests parse
 * the real declarations and verify WCAG contrast arithmetic for both themes.
 */
const css = readFileSync("src/app/globals.css", "utf8");
const badge = readFileSync("src/components/ui/badge.tsx", "utf8");
const constants = readFileSync("src/lib/constants.ts", "utf8");
const appShell = readFileSync("src/components/app-shell.tsx", "utf8");
const layout = readFileSync("src/app/layout.tsx", "utf8");

function themeBlock(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `missing ${selector} block`);
  const end = css.indexOf("\n}", start);
  return css.slice(start, end);
}

function parseVars(block: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const m of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[`--${m[1]}`] = m[2].trim();
  return vars;
}

const rootVars = parseVars(themeBlock(":root"));
const darkVars = { ...rootVars, ...parseVars(themeBlock(".dark")) };

function resolve(value: string, vars: Record<string, string>): string {
  let v = value;
  for (let i = 0; i < 8; i++) {
    const m = v.match(/^var\((--[\w-]+)\)$/);
    if (!m) return v;
    const next = vars[m[1]];
    assert.ok(next, `unresolvable ${v}`);
    v = next;
  }
  throw new Error(`var() chain too deep: ${value}`);
}

type Rgb = { r: number; g: number; b: number; a: number };

function parseColor(value: string, vars: Record<string, string>): Rgb {
  const v = resolve(value, vars);
  const hex = v.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const rgba = v.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
  if (rgba) return { r: +rgba[1], g: +rgba[2], b: +rgba[3], a: +rgba[4] };
  throw new Error(`unparseable color: ${value} → ${v}`);
}

/** Alpha-blend `top` over an opaque `base`. */
function blend(top: Rgb, base: Rgb): Rgb {
  return {
    r: top.r * top.a + base.r * (1 - top.a),
    g: top.g * top.a + base.g * (1 - top.a),
    b: top.b * top.a + base.b * (1 - top.a),
    a: 1,
  };
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

const THEMES: [string, Record<string, string>][] = [
  ["light", rootVars],
  ["dark", darkVars],
];
const TONE_NAMES = ["slate", "iris", "aqua", "emerald", "amber", "rose", "violet", "blue"];

test("core text tiers stay readable on their surfaces in both themes", () => {
  for (const [name, vars] of THEMES) {
    const surface = parseColor(vars["--surface"], vars);
    const surface2 = parseColor(vars["--surface-2"], vars);
    assert.ok(contrast(parseColor(vars["--fg"], vars), surface) >= 7, `${name}: fg vs surface`);
    assert.ok(contrast(parseColor(vars["--fg-muted"], vars), surface) >= 4.5, `${name}: fg-muted vs surface`);
    assert.ok(contrast(parseColor(vars["--fg-muted"], vars), surface2) >= 4.5, `${name}: fg-muted vs surface-2`);
    assert.ok(contrast(parseColor(vars["--fg-subtle"], vars), surface) >= 4, `${name}: fg-subtle vs surface`);
  }
});

test("primary and soft-primary pairings hold AA contrast in both themes", () => {
  for (const [name, vars] of THEMES) {
    const primary = parseColor(vars["--primary"], vars);
    const primaryFg = parseColor(vars["--primary-fg"], vars);
    const soft = parseColor(vars["--primary-soft"], vars);
    const softFg = parseColor(vars["--primary-soft-fg"], vars);
    assert.ok(contrast(primaryFg, primary) >= 4.5, `${name}: primary-fg vs primary`);
    assert.ok(contrast(softFg, soft) >= 4.5, `${name}: primary-soft-fg vs primary-soft`);
  }
});

test("every chip tone defines bg/fg/dot per theme and its text meets AA on the chip", () => {
  for (const [name, vars] of THEMES) {
    const surface = parseColor(vars["--surface"], vars);
    for (const tone of TONE_NAMES) {
      for (const part of ["bg", "fg", "dot"]) {
        assert.ok(vars[`--tone-${tone}-${part}`], `${name}: missing --tone-${tone}-${part}`);
      }
      const chipBg = blend(parseColor(vars[`--tone-${tone}-bg`], vars), surface);
      const fg = parseColor(vars[`--tone-${tone}-fg`], vars);
      assert.ok(contrast(fg, chipBg) >= 4.5, `${name}: tone ${tone} fg on chip bg (${contrast(fg, chipBg).toFixed(2)})`);
    }
  }
});

test("priority colors are theme-aware and visible on cards", () => {
  for (const [name, vars] of THEMES) {
    const surface = parseColor(vars["--surface"], vars);
    for (const p of ["low", "medium", "high", "urgent"]) {
      assert.ok(vars[`--priority-${p}`], `${name}: missing --priority-${p}`);
      const c = parseColor(vars[`--priority-${p}`], vars);
      assert.ok(contrast(c, surface) >= 3, `${name}: priority ${p} vs surface (${contrast(c, surface).toFixed(2)})`);
    }
  }
});

test("badge tones and priority meta resolve through the theme-aware variables", () => {
  assert.match(badge, /var\(--tone-\$\{name\}-bg\)/);
  assert.ok(!/rgba\(/.test(badge), "badge.tsx should not hardcode rgba chip colors");
  for (const p of ["low", "medium", "high", "urgent"]) {
    assert.match(constants, new RegExp(`var\\(--priority-${p}\\)`));
  }
});

test("structure reads as solid panels, not translucent washes", () => {
  // Desktop sidebar is a solid surface panel; the frosted 60% wash was a major
  // contributor to the washed-out feel.
  assert.ok(!appShell.includes("bg-surface/60"), "sidebar must not be translucent");
  // The shared "today" surface exists for calendar-shaped views.
  assert.ok(css.includes(".kb-today"), "globals.css defines .kb-today");
});

test("iOS standalone status bar uses the same canvas colors as the app shell", () => {
  assert.match(layout, /statusBarStyle: "black-translucent"/);
  assert.match(layout, /#f2f3f8/);
  assert.match(layout, /#0b0d15/);
  assert.match(appShell, /pt-\[env\(safe-area-inset-top\)\]/);
  assert.match(appShell, /bg-bg/);
});
