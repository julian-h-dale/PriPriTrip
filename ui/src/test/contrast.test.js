import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = fs.readFileSync(path.resolve(__dirname, "../index.css"), "utf8");

/**
 * The key colour pairs, in both themes, against their targets (Run stage
 * 22). Light is for bright sun, so its text targets are WCAG AAA (7:1),
 * secondary text included; dark keeps the original AA (4.5:1). Fills
 * (buttons' text on primary, the coverage colours on a card) need 3:1 at
 * least as shapes, 4.5:1 as text.
 */
function tokens(selector) {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/g)].map((m) => [m[1], [+m[2], +m[3], +m[4]]]));
}

function luminance([h, s, l]) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(f(0)) + 0.7152 * lin(f(8)) + 0.0722 * lin(f(4));
}

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const THEMES = { dark: tokens(":root"), light: tokens(":root.light") };
const TEXT = { dark: 4.5, light: 7 };

describe.each(Object.entries(THEMES))("the %s theme", (name, t) => {
  it("defines every token the dark theme does", () => {
    expect(Object.keys(t).sort()).toEqual(Object.keys(THEMES.dark).sort());
  });

  it.each([
    ["foreground", "background"],
    ["card-foreground", "card"],
    ["muted-foreground", "background"],
    ["muted-foreground", "card"],
  ])("%s on %s reads outdoors", (fg, bg) => {
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(name === "light" ? 7 : TEXT.dark);
  });

  it.each([["primary"], ["warning"], ["destructive"], ["success"]])("%s as text on the background", (fg) => {
    expect(contrast(t[fg], t.background)).toBeGreaterThanOrEqual(name === "light" ? 4.5 : 3);
  });

  it("button text on primary", () => {
    expect(contrast(t["primary-foreground"], t.primary)).toBeGreaterThanOrEqual(4.5);
  });

  it("each coverage colour stands out on a card", () => {
    for (let i = 1; i <= 8; i += 1) expect(contrast(t[`series-${i}`], t.card)).toBeGreaterThanOrEqual(3);
  });
});
