// @ts-check
const { test, expect } = require("@playwright/test");

test.describe("Product Browsing", () => {
  test("can navigate to a deal/product page", async ({ page }) => {
    await page.goto("/");

    // Find and click any product/deal link
    const dealLink = page.locator(
      'a[href*="/deals/"], a[href*="/offers/"], a[href*="/sale/"]'
    ).first();

    // If no deal links, try category links
    const link = (await dealLink.count()) > 0
      ? dealLink
      : page.locator('a[href*="/electronics"], a[href*="/computers"], a[href*="/home"]').first();

    await expect(link).toBeVisible({ timeout: 15000 });
    await link.click();
    await page.waitForLoadState("domcontentloaded");

    // Should navigate to a new page
    expect(page.url()).not.toBe("https://www.woot.com/");
  });

  test("product page has price information", async ({ page }) => {
    await page.goto("/");

    // Navigate to a product
    const dealLink = page.locator('a[href*="/deals/"], a[href*="/offers/"]').first();
    if ((await dealLink.count()) > 0) {
      await dealLink.click();
      await page.waitForLoadState("domcontentloaded");

      // Look for price elements ($ symbol or price-related classes)
      const priceElement = page.locator(
        '[class*="price"], [class*="Price"], [data-testid*="price"], text=/\\$\\d/'
      ).first();
      await expect(priceElement).toBeVisible({ timeout: 10000 });
      console.log("Price found on product page");
    } else {
      console.log("No deal links found — skipping price check");
    }
  });

  test("category navigation works", async ({ page }) => {
    await page.goto("/");

    // Woot has categories like Electronics, Computers, Home, etc.
    const categories = [
      "electronics",
      "computers",
      "home",
      "tools",
      "sports",
      "kitchen",
    ];

    for (const category of categories) {
      const link = page.locator(`a[href*="/${category}"]`).first();
      if ((await link.count()) > 0) {
        console.log(`Found category link: ${category}`);
        await link.click();
        await page.waitForLoadState("domcontentloaded");
        expect(page.url().toLowerCase()).toContain(category);
        await page.goBack();
        await page.waitForLoadState("domcontentloaded");
        return; // One successful category nav is enough
      }
    }
    console.log("No standard category links found on homepage");
  });

  test("product images load correctly", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("load");

    const images = page.locator("img[src]");
    const imgCount = await images.count();
    expect(imgCount).toBeGreaterThan(0);

    // Check first 5 images loaded (naturalWidth > 0)
    const checkCount = Math.min(5, imgCount);
    let loadedCount = 0;
    for (let i = 0; i < checkCount; i++) {
      const loaded = await images.nth(i).evaluate(
        (img) => img.complete && img.naturalWidth > 0
      );
      if (loaded) loadedCount++;
    }
    console.log(`${loadedCount}/${checkCount} checked images loaded successfully`);
    expect(loadedCount).toBeGreaterThan(0);
  });
});
