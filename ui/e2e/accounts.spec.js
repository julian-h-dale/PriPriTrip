import { test, expect } from "@playwright/test";
import { API_URL } from "../playwright.config.js";
import { SEED_ADMIN, login, screenshotPath } from "./helpers.js";

// One throwaway account, reused run after run (there's no deleting accounts):
// invited the first time, reset after that.
const INVITEE = "e2e-invitee@example.com";

/** Signs in with a temporary password: the app shows only "Choose a new password". */
async function signInExpectingForcedChange(page, password) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(INVITEE);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
}

/** `temporary`: null straight after signing in, when the app doesn't ask for it again. */
async function chooseNewPassword(page, temporary, mine) {
  if (temporary == null) await expect(page.getByLabel("Temporary password")).toHaveCount(0);
  else await page.getByLabel("Temporary password").fill(temporary);
  await page.getByLabel("New password", { exact: true }).fill(mine);
  await page.getByLabel("New password again").fill(mine);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toHaveCount(0);
}

/** The Admin page's Reset (two taps): returns the temporary password it shows. */
async function resetOnAdminPage(admin) {
  await admin.goto("/admin");
  const row = admin.getByRole("row").filter({ hasText: INVITEE });
  await row.getByRole("button", { name: `Reset ${INVITEE}’s password` }).click();
  await row.getByRole("button", { name: `Confirm resetting ${INVITEE}’s password` }).click();
  const dialog = admin.getByRole("dialog", { name: "Password reset" });
  const temporary = (await dialog.locator(".font-mono").textContent()).trim();
  await admin.screenshot({ path: screenshotPath("41-admin-reset") });
  await dialog.getByRole("button", { name: "Done" }).click();
  return temporary;
}

test("accounts: invite, forced change, reset, forced again", async ({ browser }) => {
  const adminContext = await browser.newContext();
  const inviteeContext = await browser.newContext();
  try {
    const admin = await adminContext.newPage();
    await login(admin, SEED_ADMIN);
    const token = await admin.evaluate(() => localStorage.getItem("auth_token"));
    const users = await (await admin.request.get(`${API_URL}/admin/users`, { headers: { Authorization: `Bearer ${token}` } })).json();

    let temporary;
    if (users.some((u) => u.email === INVITEE)) {
      temporary = await resetOnAdminPage(admin);
    } else {
      await admin.getByRole("button", { name: "Open menu" }).click();
      await admin.getByRole("button", { name: "Invite someone" }).click();
      const dialog = admin.getByRole("dialog", { name: "Invite someone" });
      await dialog.getByLabel("Email").fill(INVITEE);
      await dialog.getByLabel("Name (optional)").fill("E2E Invitee");
      await dialog.getByRole("button", { name: "Create account" }).click();
      const sent = admin.getByRole("dialog", { name: "Send them this" });
      temporary = (await sent.locator(".font-mono").textContent()).trim();
      await admin.screenshot({ path: screenshotPath("40-invite-sent") });
      await sent.getByRole("button", { name: "Done" }).click();
    }
    expect(temporary).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);

    const invitee = await inviteeContext.newPage();
    await signInExpectingForcedChange(invitee, temporary);
    await invitee.screenshot({ path: screenshotPath("42-forced-password-change") });
    await chooseNewPassword(invitee, null, `e2e own ${Date.now()}`);
    await invitee.goto("/trips");
    await expect(invitee.getByRole("heading", { name: "Trips" })).toBeVisible();

    // Reset again: the invitee's open session is locked on its next request,
    // and (not having just signed in) has to give the new temporary password.
    const again = await resetOnAdminPage(admin);
    await invitee.reload();
    await expect(invitee.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
    await chooseNewPassword(invitee, again, `e2e own ${Date.now()}`);
  } finally {
    await adminContext.close();
    await inviteeContext.close();
  }
});

test("accounts: an admin makes someone an admin from the users table, then a user again", async ({ page }) => {
  await login(page, SEED_ADMIN);
  await page.goto("/admin");
  const row = page.getByRole("row").filter({ hasText: "user@example.com" });
  const role = row.getByRole("combobox", { name: "Role for user@example.com" });
  await expect(role).toHaveValue("user");
  // Your own row is a badge, not a choice.
  await expect(page.getByRole("row").filter({ hasText: SEED_ADMIN.email }).getByRole("combobox")).toHaveCount(0);

  try {
    await role.selectOption("admin");
    const confirm = page.getByRole("dialog", { name: "Make them an admin?" });
    await page.screenshot({ path: screenshotPath("31-admin-make-admin") });
    await confirm.getByRole("button", { name: "Make admin" }).click();
    await expect(confirm).toBeHidden();
    await expect(role).toHaveValue("admin");
    await page.screenshot({ path: screenshotPath("31a-admin-users-roles") });
  } finally {
    // Back as it was, for every other spec.
    if ((await role.inputValue()) === "admin") {
      await role.selectOption("user");
      await page.getByRole("dialog", { name: "Make them a user?" }).getByRole("button", { name: "Make user" }).click();
    }
    await expect(role).toHaveValue("user");
  }
});
