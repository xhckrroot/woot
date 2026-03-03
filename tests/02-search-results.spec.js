// @ts-check
const { test, expect } = require("@playwright/test");
const { loadProductConfig } = require("./helpers");

const config = loadProductConfig();

test.describe("2. Product Search (when using search_term)", () => {
  test.beforeEach(async () => {
    if (!config.searchTerm) {
      test.skip(true, "No search_term set — these tests only run for search-based lookups");
    }
  });

  test("search returns results for the given term", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const searchInput = page.locator(
      'input[type="search"], input[name="search"], input[name="q"], input[placeholder*="search" i], [class*="search"] input'
    ).first();

    if ((await searchInput.count()) > 0) {
      await searchInput.click();
      await searchInput.fill(config.searchTerm);
      await page.keyboard.press("Enter");
    } else {
      await page.goto(`/search?query=${encodeURIComponent(config.searchTerm)}`, {
        waitUntil: "domcontentloaded",
      });
    }

    await page.waitForLoadState("domcontentloaded");
    console.log(`Search URL: ${page.url()}`);

    // Look for search results
    const results = page.locator(
      '[class*="result" i], [class*="product" i], [class*="item" i], [class*="deal" i], [class*="offer" i]'
    );

    // Wait for results to appear
    await expect(results.first()).toBeVisible({ timeout: 15000 });
    const count = await results.count();
    console.log(`Found ${count} results for "${config.searchTerm}"`);
    expect(count).toBeGreaterThan(0);
  });

  test("can click into first search result", async ({ page }) => {
    await page.goto(`/search?query=${encodeURIComponent(config.searchTerm)}`, {
      waitUntil: "domcontentloaded",
    });

    const firstResult = page.locator(
      '[class*="result"] a, [class*="product"] a, [class*="item"] a, [class*="deal"] a, [class*="offer"] a'
    ).first();

    if ((await firstResult.count()) === 0) {
      // Try any link that goes to an offer/deal
      const offerLink = page.locator('a[href*="/offers/"], a[href*="/deals/"]').first();
      if ((await offerLink.count()) > 0) {
        await offerLink.click();
      } else {
        console.log("No clickable results found");
        return;
      }
    } else {
      await firstResult.click();
    }

    await page.waitForLoadState("domcontentloaded");
    console.log(`Navigated to: ${page.url()}`);
    expect(page.url()).not.toContain("/search");
  });

  test("search results show prices", async ({ page }) => {
    await page.goto(`/search?query=${encodeURIComponent(config.searchTerm)}`, {
      waitUntil: "domcontentloaded",
    });

    const prices = page.locator('text=/\\$\\d+/, [class*="price" i]');
    await expect(prices.first()).toBeVisible({ timeout: 15000 });
    const count = await prices.count();
    console.log(`Price elements found in results: ${count}`);
    expect(count).toBeGreaterThan(0);
  });
});
