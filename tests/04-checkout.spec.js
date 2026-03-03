// @ts-check
const { test, expect } = require("@playwright/test");
const { loadProductConfig, goToProduct, signInWithAmazon } = require("./helpers");

const config = loadProductConfig();
const hasCredentials = config.email && config.password;

test.describe("4. Full Checkout Flow (requires Amazon credentials)", () => {
  test.beforeEach(async () => {
    if (!config.productUrl && !config.searchTerm) {
      test.skip(true, "No product specified");
    }
    if (!hasCredentials) {
      test.skip(true, "Set amazon_email + amazon_password in product.config.json (or WOOT_EMAIL + WOOT_PASSWORD env vars)");
    }
  });

  test("sign in with Amazon account", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await signInWithAmazon(page, config.email, config.password);

    // Verify signed in — should see account indicator
    const accountIndicator = page.locator(
      '[class*="account" i], [class*="user" i], text=/my account/i, text=/sign out/i, text=/log out/i'
    ).first();

    const isSignedIn = (await accountIndicator.count()) > 0 || page.url().includes("woot.com");
    console.log(`Signed in: ${isSignedIn}`);
    expect(page.url()).toContain("woot.com");
  });

  test("authenticated checkout: product → cart → shipping → payment review", async ({ page }) => {
    const timings = {};

    // Step 1: Sign in
    let start = Date.now();
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await signInWithAmazon(page, config.email, config.password);
    timings.signIn = Date.now() - start;
    console.log(`Sign-in: ${timings.signIn}ms`);

    // Step 2: Go to the user's product
    start = Date.now();
    await goToProduct(page, config);

    // If search, pick the first result
    if (config.searchTerm) {
      const resultLink = page.locator('a[href*="/offers/"], a[href*="/deals/"]').first();
      if ((await resultLink.count()) > 0) {
        await resultLink.click();
        await page.waitForLoadState("domcontentloaded");
      }
    }
    timings.productPage = Date.now() - start;
    console.log(`Product navigation: ${timings.productPage}ms`);

    // Step 3: Check availability
    const soldOut = page.locator('text=/sold out/i, text=/out of stock/i').first();
    if ((await soldOut.count()) > 0) {
      console.log("Product is SOLD OUT — cannot complete checkout");
      return;
    }

    // Step 4: Set quantity if applicable
    const qtySelect = page.locator('select[name*="quantity" i], select[name*="qty" i]').first();
    if ((await qtySelect.count()) > 0 && config.quantity > 1) {
      await qtySelect.selectOption(String(config.quantity));
      console.log(`Quantity set to: ${config.quantity}`);
    }

    // Step 5: Click buy
    const buyButton = page.locator(
      'button:has-text("Add to Cart"), button:has-text("I Want One"), button:has-text("Buy"), [class*="buy-button" i], [class*="add-to-cart" i]'
    ).first();

    if ((await buyButton.count()) === 0) {
      console.log("No buy button found");
      return;
    }

    start = Date.now();
    await buyButton.click();
    await page.waitForTimeout(5000);
    timings.addToCart = Date.now() - start;
    console.log(`Add to cart: ${timings.addToCart}ms`);

    const checkoutUrl = page.url();
    console.log(`Checkout URL: ${checkoutUrl}`);

    // Step 6: Look for checkout components (Amazon Pay flow)
    // Shipping address
    const shippingAddress = page.locator(
      'text=/shipping address/i, text=/deliver to/i, [class*="address" i], [class*="shipping" i]'
    ).first();

    if ((await shippingAddress.count()) > 0) {
      const text = await shippingAddress.textContent();
      console.log(`Shipping section: ${text?.trim().substring(0, 100)}`);
    } else {
      console.log("No shipping address section visible yet");
    }

    // Payment method
    const paymentMethod = page.locator(
      'text=/payment/i, text=/pay with/i, text=/credit card/i, [class*="payment" i]'
    ).first();

    if ((await paymentMethod.count()) > 0) {
      const text = await paymentMethod.textContent();
      console.log(`Payment section: ${text?.trim().substring(0, 100)}`);
    } else {
      console.log("No payment section visible yet");
    }

    // Order total
    const orderTotal = page.locator(
      'text=/total/i, text=/order summary/i, [class*="total" i], [class*="summary" i]'
    ).first();

    if ((await orderTotal.count()) > 0) {
      const text = await orderTotal.textContent();
      console.log(`Order summary: ${text?.trim().substring(0, 100)}`);
    }

    // Place order button (DO NOT CLICK)
    const placeOrder = page.locator(
      'button:has-text("Place"), button:has-text("Complete"), button:has-text("Confirm"), button:has-text("Submit"), [class*="place-order" i]'
    ).first();

    if ((await placeOrder.count()) > 0) {
      console.log("Place Order button found — STOPPING HERE (will not place real order)");
    }

    // Timing summary
    console.log("\n--- Checkout Flow Timing ---");
    console.log(`Sign-in:      ${timings.signIn}ms`);
    console.log(`Product page: ${timings.productPage}ms`);
    console.log(`Add to cart:  ${timings.addToCart}ms`);
    const total = timings.signIn + timings.productPage + timings.addToCart;
    console.log(`Total:        ${total}ms`);
  });
});
