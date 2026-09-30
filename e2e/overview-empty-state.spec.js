/**
 * The Overview's empty state must agree with what the Overview is showing.
 *
 * Found 2026-09-29 in a screen recording of a live account: the full-page
 * "WELCOME TO MĪZAN · Connect your first brokerage" hero rendered directly
 * above the user's own $64,981.57 of cash and a real Zakat figure, greeting
 * somebody with a funded account as though they had just signed up.
 *
 * It was not a render race. `isEmpty` was `snapAccounts.length===0 &&
 * merged.length===0` — brokerage only — while CASH ON HAND sums Plaid
 * depository balances, ZAKAT DUE comes from the worksheet and compliance comes
 * from the screening cache. None of those involve SnapTrade, so "no brokerage"
 * was never the same condition as "nothing to show", and any Plaid-only user
 * hit it deterministically.
 */
import { test, expect } from "@playwright/test";
import { signedIn, appReady } from "./support/app.js";

// Plaid connected, SnapTrade empty — the shape that produced the contradiction.
const BANK_ONLY = {
  "/api/plaid/accounts": {
    accounts: [
      { account_id: "bank-1", name: "Ally Bank — Savings", type: "depository",
        subtype: "savings", current_bal: 64981.57, iso_currency_code: "USD" },
    ],
  },
  "/api/snaptrade/all": { accounts: [], activities: [] },
  "/api/snaptrade/accounts": { accounts: [] },
};

test("a funded bank account is not greeted as a new signup", async ({ page }) => {
  test.setTimeout(120_000);
  await signedIn(page, { fixtures: BANK_ONLY });
  await page.goto("/");
  await appReady(page);
  await page.waitForTimeout(1200);

  const body = await page.locator("body").innerText();

  // The money must be on screen — otherwise this test would pass on a blank page.
  expect(body, "the bank balance should be rendered").toMatch(/64,981/);

  // ...and the new-user hero must not be.
  expect(body, "the WELCOME hero rendered above a funded account")
    .not.toMatch(/WELCOME TO MĪZAN/i);
  expect(body, "the full-page new-user headline rendered above real money")
    .not.toMatch(/Connect your first brokerage/i);

  // The honest prompt takes its place, so a Plaid-only user still knows what
  // linking a brokerage would add.
  expect(body, "no brokerage prompt shown at all").toMatch(/NO BROKERAGE CONNECTED/i);
});

test("a genuinely new account still gets the welcome", async ({ page }) => {
  test.setTimeout(120_000);
  // The property the hero exists for, pinned so narrowing isEmpty cannot drift
  // into deleting the new-user experience.
  await signedIn(page);
  await page.goto("/");
  await appReady(page);
  await page.waitForTimeout(1200);

  const body = await page.locator("body").innerText();
  expect(body, "a brand-new empty account lost its welcome")
    .toMatch(/Connect your first brokerage/i);
});
