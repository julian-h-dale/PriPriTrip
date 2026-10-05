import { describe, expect, it } from "vitest";
import { glyphSrcFor, NEW_PLACE_GLYPH_SRC } from "@/features/map/mapStyle";
import { MODE_ICON } from "@/features/timeline/describeEntry";

const svgOf = (src) => decodeURIComponent(src.replace("data:image/svg+xml;charset=utf-8,", ""));

describe("pin glyphs", () => {
  const kinds = [
    { kind: "stay" },
    { kind: "activity" },
    { kind: "memory" },
    ...Object.keys(MODE_ICON).map((mode) => ({ kind: "travel", mode })),
  ];

  it("every kind and travel mode has a white outline SVG", () => {
    for (const marker of kinds) {
      const svg = svgOf(glyphSrcFor(marker));
      expect(svg).toMatch(/^<svg [^>]*stroke="#fff"/);
      expect(svg).toContain('fill="none"');
      expect(svg).toMatch(/<(path|circle|rect|line|polyline)/);
    }
  });

  it("each kind has its own icon, and a travel with no known mode still gets one", () => {
    const srcs = ["stay", "activity", "memory"].map((kind) => glyphSrcFor({ kind }));
    expect(new Set(srcs).size).toBe(3);
    expect(glyphSrcFor({ kind: "travel", mode: "rocket" })).toBe(glyphSrcFor({ kind: "travel", mode: "other" }));
  });

  it("the new-place glyph is dark, for the white pin", () => {
    expect(svgOf(NEW_PLACE_GLYPH_SRC)).toContain('stroke="#12151c"');
  });
});
