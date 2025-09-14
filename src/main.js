import { Actor, log } from "apify";
import { chromium } from "playwright";
import { parseCookiesInput } from "./utils/cookies.js";
import { runPostDetails } from "./flows/details.js";
import { runPostDates } from "./flows/dates.js";
import { openDefaultDatasetInfo } from "./utils/misc.js";

await Actor.main(async () => {
  const input = await Actor.getInput();
  const {
    mode = "POST_DETAILS",
    urls = [],
    cookies,
    enableOcr = false,
    min_wait_ms = 1200,
    max_wait_ms = 2500,
    headless = true,
    viewport = { width: 1280, height: 900 },
    timezoneId = "UTC",
    locale = "en-US",
    userAgent,
  } = input || {};

  if (!Array.isArray(urls) || urls.length === 0) throw new Error("Input 'urls' must be a non-empty array");
  if (min_wait_ms < 0 || max_wait_ms < 0 || max_wait_ms < min_wait_ms) throw new Error("Invalid waits: ensure 0 <= min <= max");

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ viewport, userAgent: userAgent || undefined, timezoneId, locale });
  const page = await context.newPage();

  try {
    const parsedCookies = parseCookiesInput(cookies, "https://www.facebook.com/");
    if (parsedCookies.length) {
      await context.addCookies(parsedCookies);
      log.info("Added " + parsedCookies.length + " cookies.");
    }

    await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(rand(min_wait_ms, max_wait_ms));

    if (mode === "POST_DATES") {
      await runPostDates(page, urls, { min_wait_ms, max_wait_ms, enableOcr });
    } else {
      await runPostDetails(page, urls, { min_wait_ms, max_wait_ms, enableOcr });
    }

    const { itemCount } = await openDefaultDatasetInfo();
    log.info("Run done. Items in default dataset: " + itemCount);
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
});

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }