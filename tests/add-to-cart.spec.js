// @ts-check
const { test, expect } = require("@playwright/test");

test.describe("Add to Cart Flow", () => {
  test("find and click an 'Add to Cart' or 'Buy' button on a deal", async ({ page }) => {
    await page.goto("/");

    // Navigate to a product/deal page
    const dealLink = page.locator(
      'a[href*="/deals/"], a[href*="/offers/"]'
    ).first();

    if ((await dealLink.count()) === 0) {
      test.skip(true, "No active deals found on homepage");
      return;
    }

    await dealLink.click();
    await page.waitForLoadState("domcontentloaded");

    // Look for Add to Cart / Buy / I Want One type buttons
    const buyButton = page.locator(
      'button:has-text("Add to Cart"), button:has-text("Buy"), button:has-text("I Want One"), button:has-text("Add to Bag"), a:has-text("Add to Cart"), [class*="buy-button"], [class*="add-to-cart"], [data-testid*="add-to-cart"]'
    ).first();

    const hasBuyButton = (await buyButton.count()) > 0;
    if (hasBuyButton) {
      await expect(buyButton).toBeVisible();
      console.log("Buy/Add to Cart button found and visible");

      // Check if it's enabled (not sold out)
      const isDisabled = await buyButton.evaluate(
        (el) => el.hasAttribute("disabled") || el.classList.contains("disabled")
      );
      console.log(`Button enabled: ${!isDisabled}`);
    } else {
      // Product might be sold out
      const soldOut = page.locator(
        'text=/sold out/i, text=/out of stock/i, [class*="sold-out"]'
      ).first();
      if ((await soldOut.count()) > 0) {
        console.log("Product is sold out — no buy button expected");
      } else {
        console.log("No buy button or sold out indicator found");
      }
    }
  });

  test("attempting add-to-cart prompts Amazon login if not signed in", async ({ page }) => {
    await page.goto("/");

    const dealLink = page.locator(
      'a[href*="/deals/"], a[href*="/offers/"]'
    ).first();

    if ((await dealLink.count()) === 0) {
      test.skip(true, "No active deals found");
      return;
    }

    await dealLink.click();
    await page.waitForLoadState("domcontentloaded");

    const buyButton = page.locator(
      'button:has-text("Add to Cart"), button:has-text("Buy"), button:has-text("I Want One"), [class*="buy-button"], [class*="add-to-cart"]'
    ).first();

    if ((await buyButton.count()) === 0) {
      test.skip(true, "No buy button available (product may be sold out)");
      return;
    }

    await buyButton.click();

    // Woot uses Amazon Pay — expect Amazon login redirect or popup
    await page.waitForTimeout(3000);
    const url = page.url();
    const hasAmazonRedirect = url.includes("amazon.com") || url.includes("amazon.co");

    // Or check for Amazon login modal/iframe
    const amazonFrame = page.frameLocator('iframe[src*="amazon"]');
    const amazonModal = page.locator('[class*="amazon"], [id*="amazon"]');
    const hasAmazonElement =
      hasAmazonRedirect ||
      (await amazonModal.count()) > 0;

    // Could also show a Woot sign-in page
    const signInPrompt = page.locator(
      'text=/sign in/i, text=/log in/i, text=/login/i, a[href*="signin"], a[href*="login"]'
    );

    const promptsLogin = hasAmazonElement || (await signInPrompt.count()) > 0;
    console.log(`Amazon redirect: ${hasAmazonRedirect}`);
    console.log(`Login/signin prompt detected: ${promptsLogin}`);
    console.log(`Current URL after clicking buy: ${url}`);

    // The checkout should require authentication
    expect(promptsLogin).toBe(true);
  });

  test("quantity selector works if available", async ({ page }) => {
    await page.goto("/");

    const dealLink = page.locator(
      'a[href*="/deals/"], a[href*="/offers/"]'
    ).first();

    if ((await dealLink.count()) === 0) {
      test.skip(true, "No active deals found");
      return;
    }

    await dealLink.click();
    await page.waitForLoadState("domcontentloaded");

    // Look for quantity selector
    const qtyInput = page.locator(
      'input[name*="quantity"], input[name*="qty"], select[name*="quantity"], select[name*="qty"], [class*="quantity"]'
    ).first();

    if ((await qtyInput.count()) > 0) {
      await expect(qtyInput).toBeVisible();
      console.log("Quantity selector found");

      const tagName = await qtyInput.evaluate((el) => el.tagName.toLowerCase());
      if (tagName === "select") {
        const options = await qtyInput.locator("option").allTextContents();
        console.log(`Quantity options: ${options.join(", ")}`);
        expect(options.length).toBeGreaterThan(0);
      } else {
        const value = await qtyInput.inputValue();
        console.log(`Default quantity: ${value}`);
      }
    } else {
      // Woot typically sells one item at a time — no qty selector expected
      console.log("No quantity selector (Woot often sells single items per deal)");
    }
  });
});
