import { describe, expect, it } from "vitest";
import postcss from "postcss";
import tailwind from "tailwindcss";
import config from "../../tailwind.config.js";

/**
 * Run stage 21: hover fills apply only where something really hovers, so a
 * tap on a phone doesn't leave a button looking pressed (the tool pages'
 * Back button, under the finger that tapped ☰ → the tool).
 */
describe("hover styles", () => {
  it("sit inside @media (hover: hover)", async () => {
    const { css } = await postcss([
      tailwind({ ...config, content: [{ raw: '<button class="hover:bg-accent focus-visible:ring-2">' }] }),
    ]).process("@tailwind utilities;", { from: undefined });
    const hover = css.indexOf(":hover");
    expect(hover).toBeGreaterThan(-1);
    expect(css.lastIndexOf("@media (hover: hover)", hover)).toBeGreaterThan(-1);
    expect(css).toMatch(/:focus-visible/); // the keyboard's ring is untouched
  });
});
