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

/** The seed viewer: joined to the sample trip by `make seed` (sharing). */
export const SEED_VIEWER = {
  email: process.env.SEED_VIEWER_EMAIL || "pripri@example.com",
  password: process.env.SEED_VIEWER_PASSWORD || "changeme-viewer",
};

/**
 * Logs in as the seed dev user, then opens the full trips list (signing in
 * itself lands on the next trip, not the list).
 */
export async function login(page, { email = SEED_EMAIL, password = SEED_PASSWORD } = {}) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname !== "/login" && url.pathname !== "/");
  await page.goto("/trips");
  await page.getByRole("heading", { name: "Trips" }).waitFor();
}

/** The trips list's link to a trip, opening the collapsed "Past" group if that's where it is. */
export async function tripLink(page, name) {
  const link = page.getByRole("link", { name });
  if (!(await link.isVisible())) {
    const past = page.getByRole("button", { name: /^Past \(/ });
    if (await past.isVisible()) await past.click();
  }
  return link;
}
