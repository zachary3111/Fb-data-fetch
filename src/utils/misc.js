import { Actor } from "apify";

export function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function waitForArticleReady(page) {
  try {
    await page.waitForSelector('[role="article"] time, [role="article"] [aria-label]', { timeout: 30000 });
  } catch {
    // fallback soft wait
    await page.waitForTimeout(800);
  }
}

export async function openDefaultDatasetInfo() {
  const ds = await Actor.openDataset();
  const info = await ds.getInfo();
  return { itemCount: info?.itemCount ?? 0 };
}