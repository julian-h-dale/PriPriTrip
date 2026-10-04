// Generate the PWA icons from docs/brand/logo.svg (run via `make icons`).
//
// Rasterizes with the preinstalled Chromium through Playwright, so there's no
// image tool to install. Outputs go to ui/public/ and are committed; re-run
// only when the logo changes.
//
//   favicon.svg            the logo itself
//   pwa-192x192.png        "any" icons: the logo with its rounded tile
//   pwa-512x512.png
//   maskable-512x512.png   full-bleed tile, logo shrunk into the 80% safe zone
//   apple-touch-icon.png   180px, full-bleed (iOS rounds the corners itself)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "ui", "package.json"));
const { chromium } = require("playwright");

const logo = fs.readFileSync(path.join(root, "docs/brand/logo.svg"), "utf8");
const outDir = path.join(root, "ui/public");

// The tile is the first <rect>; everything after it is the artwork.
const tile = logo.match(/<rect [^>]*\/>/)[0];
const background = tile.match(/fill="([^"]+)"/)[1];
const artwork = logo.slice(logo.indexOf(tile) + tile.length, logo.lastIndexOf("</svg>"));

/** A square, full-bleed version with the artwork scaled about the center. */
function fullBleed(scale) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="${background}"/>
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${artwork}</g>
</svg>`;
}

const outputs = [
  { file: "pwa-192x192.png", size: 192, svg: logo },
  { file: "pwa-512x512.png", size: 512, svg: logo },
  { file: "maskable-512x512.png", size: 512, svg: fullBleed(0.8) },
  { file: "apple-touch-icon.png", size: 180, svg: fullBleed(0.9) },
];

fs.writeFileSync(path.join(outDir, "favicon.svg"), logo);

const browser = await chromium.launch();
try {
  for (const { file, size, svg } of outputs) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const sized = svg.replace(/width="512" height="512"/, `width="${size}" height="${size}"`);
    await page.setContent(`<html><body style="margin:0;background:transparent">${sized}</body></html>`);
    await page.screenshot({ path: path.join(outDir, file), omitBackground: true });
    await page.close();
    console.log(`  ui/public/${file}`);
  }
} finally {
  await browser.close();
}
