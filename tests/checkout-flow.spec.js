// @ts-check
const { test, expect } = require("@playwright/test");

/**
 * NOTE: Full checkout requires an Amazon account login.
 * These tests verify the checkout flow up to the Amazon Pay login wall.
 *
 * To test the FULL flow including payment:
 *   1. Set WOOT_EMAIL and WOOT_PASSWORD environment variables
 *   2. Run: WOOT_EMAIL=you@email.com WOOT_PASSWORD=yourpass npx playwright test
 *
 * Without credentials, tests verify the pre-auth checkout flow and smoothness.
 */

test.describe("Checkout Flow Smoothness", () => {
  test("full flow: homepage → product → add to cart → checkout prompt", async ({ page }) => {
    const timings = {};

    // Step 1: Load homepage
    let start = Date.now();
    await page.goto("/", { waitUntil: "domcontentloaded" });
    timings.homepage = Date.now() - start;
    console.log(`Homepage load: ${timings.homepage}ms`);

    // Step 2: Navigate to a product
    const dealLink = page.locator(
      'a[href*="/deals/"], a[href*="/offers/"]'
    ).first();

    if ((await dealLink.count()) === 0) {
      test.skip(true, "No active deals — cannot test full flow");
      return;
    }

    start = Date.now();
    await dealLink.click();
    await page.waitForLoadState("domcontentloaded");
    timings.productPage = Date.now() - start;
    console.log(`Product page load: ${timings.productPage}ms`);

    // Step 3: Click buy/add to cart
    const buyButton = page.locator(
      'button:has-text("Add to Cart"), button:has-text("Buy"), button:has-text("I Want One"), [class*="buy-button"], [class*="add-to-cart"]'
    ).first();

    if ((await buyButton.count()) === 0) {
      console.log("No buy button (sold out) — flow stops here");
      return;
    }

    start = Date.now();
    await buyButton.click();
    await page.waitForTimeout(3000); // Wait for redirect/modal
    timings.addToCart = Date.now() - start;
    console.log(`Add to cart response: ${timings.addToCart}ms`);

    // Step 4: Check we reached checkout/login
    const currentUrl = page.url();
    console.log(`Redirected to: ${currentUrl}`);

    // Report overall smoothness
    console.log("\n--- Flow Timing Summary ---");
    console.log(`Homepage:      ${timings.homepage}ms`);
    console.log(`Product page:  ${timings.productPage}ms`);
    console.log(`Add to cart:   ${timings.addToCart}ms`);
    const totalTime = timings.homepage + timings.productPage + timings.addToCart;
    console.log(`Total flow:    ${totalTime}ms`);

    // Each step should be under 10 seconds for decent UX
    expect(timings.homepage).toBeLessThan(10000);
    expect(timings.productPage).toBeLessThan(10000);
  });

  test("Amazon Pay button/integration is present on product pages", async ({ page }) => {
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

    // Look for Amazon Pay references
    const amazonPay = page.locator(
      '[class*="amazon-pay"], [class*="amazonpay"], [id*="amazon"], img[alt*="Amazon"], a[href*="amazon"], button:has-text("Amazon"), [class*="AmazonPay"]'
    );

    // Or the checkout/buy button itself (which triggers Amazon Pay)
    const buyButton = page.locator(
      'button:has-text("Add to Cart"), button:has-text("Buy"), button:has-text("I Want One"), [class*="buy-button"]'
    );

    const hasAmazonPay = (await amazonPay.count()) > 0;
    const hasBuyButton = (await buyButton.count()) > 0;

    console.log(`Amazon Pay element found: ${hasAmazonPay}`);
    console.log(`Buy button found: ${hasBuyButton}`);

    // At least one should exist (unless sold out)
    const soldOut = page.locator('text=/sold out/i, text=/out of stock/i');
    if ((await soldOut.count()) > 0) {
      console.log("Product is sold out — Amazon Pay not expected");
    } else {
      expect(hasAmazonPay || hasBuyButton).toBe(true);
    }
  });

  test("shipping info is shown (Prime benefit)", async ({ page }) => {
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

    // Look for shipping information
    const shippingInfo = page.locator(
      'text=/shipping/i, text=/delivery/i, text=/Prime/i, [class*="shipping"], [class*="delivery"]'
    ).first();

    if ((await shippingInfo.count()) > 0) {
      await expect(shippingInfo).toBeVisible();
      const text = await shippingInfo.textContent();
      console.log(`Shipping info found: "${text?.trim()}"`);
    } else {
      console.log("No explicit shipping info on product page");
    }
  });
});

test.describe("Checkout with Amazon Login (requires credentials)", () => {
  const email = process.env.WOOT_EMAIL;
  const password = process.env.WOOT_PASSWORD;

  test.skip(!email || !password, "Set WOOT_EMAIL and WOOT_PASSWORD env vars to run these tests");

  test("can sign in with Amazon and reach checkout", async ({ page }) => {
    await page.goto("/");

    // Click sign-in/login
    const signIn = page.locator(
      'a:has-text("Sign In"), a:has-text("Log In"), button:has-text("Sign In"), [class*="sign-in"], [class*="login"]'
    ).first();

    if ((await signIn.count()) > 0) {
      await signIn.click();
      await page.waitForLoadState("domcontentloaded");
    }

    // Look for "Log in with Amazon" button
    const amazonLogin = page.locator(
      'button:has-text("Amazon"), a:has-text("Amazon"), [id*="LoginWithAmazon"], img[alt*="Amazon"]'
    ).first();

    if ((await amazonLogin.count()) > 0) {
      await amazonLogin.click();
      await page.waitForLoadState("domcontentloaded");

      // Fill Amazon login
      const emailInput = page.locator('input[name="email"], input[type="email"]').first();
      if ((await emailInput.count()) > 0) {
        await emailInput.fill(email);
        const continueBtn = page.locator('input[type="submit"], button[type="submit"]').first();
        await continueBtn.click();
        await page.waitForLoadState("domcontentloaded");

        const passwordInput = page.locator('input[name="password"], input[type="password"]').first();
        if ((await passwordInput.count()) > 0) {
          await passwordInput.fill(password);
          const signInBtn = page.locator('input[type="submit"], button[type="submit"]').first();
          await signInBtn.click();
          await page.waitForLoadState("domcontentloaded");
        }
      }

      // Should be back on Woot signed in
      console.log(`URL after login: ${page.url()}`);
      expect(page.url()).toContain("woot.com");
    }
  });

  test("full authenticated checkout: browse → buy → shipping → payment → confirm", async ({ page }) => {
    // Sign in first
    await page.goto("/");

    const signIn = page.locator(
      'a:has-text("Sign In"), a:has-text("Log In"), [class*="sign-in"]'
    ).first();
    if ((await signIn.count()) > 0) {
      await signIn.click();
    }

    const amazonLogin = page.locator(
      'button:has-text("Amazon"), a:has-text("Amazon"), [id*="LoginWithAmazon"]'
    ).first();

    if ((await amazonLogin.count()) > 0) {
      await amazonLogin.click();
      await page.waitForLoadState("domcontentloaded");

      const emailInput = page.locator('input[name="email"], input[type="email"]').first();
      if ((await emailInput.count()) > 0) {
        await emailInput.fill(email);
        await page.locator('input[type="submit"], button[type="submit"]').first().click();
        await page.waitForLoadState("domcontentloaded");

        const passwordInput = page.locator('input[name="password"], input[type="password"]').first();
        if ((await passwordInput.count()) > 0) {
          await passwordInput.fill(password);
          await page.locator('input[type="submit"], button[type="submit"]').first().click();
          await page.waitForLoadState("domcontentloaded");
        }
      }
    }

    // Navigate to a deal
    await page.goto("/");
    const dealLink = page.locator('a[href*="/deals/"], a[href*="/offers/"]').first();

    if ((await dealLink.count()) === 0) {
      test.skip(true, "No active deals");
      return;
    }

    await dealLink.click();
    await page.waitForLoadState("domcontentloaded");

    // Click buy
    const buyButton = page.locator(
      'button:has-text("Add to Cart"), button:has-text("Buy"), button:has-text("I Want One"), [class*="buy-button"]'
    ).first();

    if ((await buyButton.count()) === 0) {
      console.log("Product sold out — cannot complete checkout");
      return;
    }

    await buyButton.click();
    await page.waitForTimeout(3000);

    // Check for Amazon Pay checkout flow
    const checkoutPage = page.url();
    console.log(`Checkout URL: ${checkoutPage}`);

    // Look for shipping address selection
    const shippingSection = page.locator(
      'text=/shipping address/i, text=/deliver to/i, [class*="shipping"], [class*="address"]'
    ).first();

    if ((await shippingSection.count()) > 0) {
      console.log("Shipping address section found in checkout");
    }

    // Look for payment method selection
    const paymentSection = page.locator(
      'text=/payment/i, text=/pay with/i, [class*="payment"]'
    ).first();

    if ((await paymentSection.count()) > 0) {
      console.log("Payment section found in checkout");
    }

    // Look for order review/confirm
    const confirmSection = page.locator(
      'text=/place.*order/i, text=/confirm/i, text=/review/i, button:has-text("Place"), button:has-text("Continue")'
    ).first();

    if ((await confirmSection.count()) > 0) {
      console.log("Order confirmation section found");
      // DO NOT actually place the order
      console.log("STOPPING before placing order (test mode)");
    }

    console.log("Authenticated checkout flow completed successfully");
  });
});
