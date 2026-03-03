// @ts-check
const { test, expect } = require("@playwright/test");
const { loadProductConfig, goToProduct } = require("./helpers");

const config = loadProductConfig();

test.describe("3. Add to Cart", () => {
  test.beforeEach(async () => {
    if (!config.productUrl && !config.searchTerm) {
      test.skip(true, "No product specified");
    }
  });

  test("buy button is present and clickable", async ({ page }) => {
    await goToProduct(page, config);

    // If search was used, click into the first result
    if (config.searchTerm) {
      const resultLink = page.locator(
        'a[href*="/offers/"], a[href*="/deals/"], [class*="result"] a, [class*="product"] a'
      ).first();
      if ((await resultLink.count()) > 0) {
        await resultLink.click();
        await page.waitForLoadState("domcontentloaded");
      }
    }

    const buyButton = page.locator(
      'button:has-text("Add to Cart"), button:has-text("I Want One"), button:has-text("Buy"), [class*="buy-button" i], [class*="add-to-cart" i], [class*="addToCart" i]'
    ).first();

    const soldOut = page.locator(
      'text=/sold out/i, text=/out of stock/i, [class*="sold-out" i], [class*="soldout" i]'
    ).first();

    if ((await soldOut.count()) > 0) {
      console.log("SOLD OUT — product is no longer available for purchase");
      console.log("Cannot test add-to-cart on a sold out product");
      return;
    }

    await expect(buyButton).toBeVisible();
    const buttonText = await buyButton.textContent();
    console.log(`Buy button text: "${buttonText?.trim()}"`);

    const isDisabled = await buyButton.isDisabled();
    console.log(`Button enabled: ${!isDisabled}`);
    expect(isDisabled).toBe(false);
  });

  test("set quantity before adding to cart", async ({ page }) => {
    await goToProduct(page, config);

    if (config.searchTerm) {
      const resultLink = page.locator('a[href*="/offers/"], a[href*="/deals/"]').first();
      if ((await resultLink.count()) > 0) {
        await resultLink.click();
        await page.waitForLoadState("domcontentloaded");
      }
    }

    // Look for quantity selector
    const qtySelect = page.locator(
      'select[name*="quantity" i], select[name*="qty" i], select[class*="quantity" i]'
    ).first();

    const qtyInput = page.locator(
      'input[name*="quantity" i], input[name*="qty" i], input[class*="quantity" i]'
    ).first();

    if ((await qtySelect.count()) > 0) {
      const options = await qtySelect.locator("option").allTextContents();
      console.log(`Quantity options: ${options.join(", ")}`);

      const targetQty = String(config.quantity);
      const available = options.map((o) => o.trim());

      if (available.includes(targetQty)) {
        await qtySelect.selectOption(targetQty);
        console.log(`Selected quantity: ${targetQty}`);
      } else {
        console.log(`Quantity ${targetQty} not available. Max appears to be: ${available[available.length - 1]}`);
        await qtySelect.selectOption(available[available.length - 1]);
      }
    } else if ((await qtyInput.count()) > 0) {
      await qtyInput.fill(String(config.quantity));
      console.log(`Set quantity to: ${config.quantity}`);
    } else {
      console.log("No quantity selector — Woot typically limits to 1 per deal");
    }
  });

  test("clicking buy triggers checkout/login flow", async ({ page }) => {
    await goToProduct(page, config);

    if (config.searchTerm) {
      const resultLink = page.locator('a[href*="/offers/"], a[href*="/deals/"]').first();
      if ((await resultLink.count()) > 0) {
        await resultLink.click();
        await page.waitForLoadState("domcontentloaded");
      }
    }

    const soldOut = page.locator('text=/sold out/i, text=/out of stock/i').first();
    if ((await soldOut.count()) > 0) {
      test.skip(true, "Product sold out");
      return;
    }

    const buyButton = page.locator(
      'button:has-text("Add to Cart"), button:has-text("I Want One"), button:has-text("Buy"), [class*="buy-button" i], [class*="add-to-cart" i]'
    ).first();

    if ((await buyButton.count()) === 0) {
      test.skip(true, "No buy button found");
      return;
    }

    console.log("Clicking buy button...");
    await buyButton.click();

    // Wait for response (redirect, modal, or page change)
    await page.waitForTimeout(4000);

    const currentUrl = page.url();
    console.log(`URL after clicking buy: ${currentUrl}`);

    // Check what happened
    const wentToAmazon = currentUrl.includes("amazon.com");
    const wentToCart = currentUrl.includes("cart") || currentUrl.includes("checkout");
    const loginPrompt = page.locator(
      'text=/sign in/i, text=/log in/i, text=/login/i, [class*="signin" i], [class*="login" i]'
    );
    const cartModal = page.locator(
      '[class*="cart" i], [class*="modal" i], [class*="overlay" i]'
    );

    const hasLogin = (await loginPrompt.count()) > 0;
    const hasCart = (await cartModal.count()) > 0;

    console.log(`Redirected to Amazon: ${wentToAmazon}`);
    console.log(`Went to cart/checkout: ${wentToCart}`);
    console.log(`Login prompt shown: ${hasLogin}`);
    console.log(`Cart/modal appeared: ${hasCart}`);

    // Something should have happened
    expect(wentToAmazon || wentToCart || hasLogin || hasCart).toBe(true);
  });
});
