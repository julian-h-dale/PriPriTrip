import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Where named screenshots land, so they're easy to find after a run. */
export const SCREENSHOTS_DIR = path.join(__dirname, "screenshots");

export function screenshotPath(name) {
  return path.join(SCREENSHOTS_DIR, `${name}.png`);
}

const SEED_EMAIL = process.env.SEED_USER_EMAIL || "user@example.com";
const SEED_PASSWORD = process.env.SEED_USER_PASSWORD || "changeme-user";

/** Logs in as the seed dev user and waits for the trips list. */
export async function login(page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(SEED_EMAIL);
  await page.getByRole("textbox", { name: "Password" }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Trips" }).waitFor();
}
