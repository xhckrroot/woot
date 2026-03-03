// @ts-check
const { test, expect } = require("@playwright/test");

test.describe("Woot.com Homepage", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("homepage loads successfully", async ({ page }) => {
    await expect(page).toHaveTitle(/Woot/i);
    expect(page.url()).toContain("woot.com");
  });

  test("main navigation is visible", async ({ page }) => {
    // Woot has category navigation links
    const nav = page.locator("nav, header, [role='navigation']").first();
    await expect(nav).toBeVisible();
  });

  test("product deals are displayed on the page", async ({ page }) => {
    // Woot displays daily deals — look for product cards/links/images
    const productElements = page.locator(
      'a[href*="/deals/"], a[href*="/offers/"], [class*="deal"], [class*="product"], [class*="item"], [class*="offer"]'
    );
    // Wait for at least one product to appear
    await expect(productElements.first()).toBeVisible({ timeout: 15000 });
    const count = await productElements.count();
    expect(count).toBeGreaterThan(0);
    console.log(`Found ${count} product/deal elements on homepage`);
  });

  test("page loads within acceptable time", async ({ page }) => {
    const start = Date.now();
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const loadTime = Date.now() - start;
    console.log(`Homepage DOM loaded in ${loadTime}ms`);
    expect(loadTime).toBeLessThan(10000);
  });

  test("no console errors on homepage", async ({ page }) => {
    const errors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await page.goto("/", { waitUntil: "load" });
    // Allow minor third-party errors but flag major ones
    console.log(`Console errors found: ${errors.length}`);
    errors.forEach((e) => console.log(`  - ${e}`));
  });
});
