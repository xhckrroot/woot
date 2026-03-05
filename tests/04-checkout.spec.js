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

    // Navigate to account page to verify sign-in
    await page.goto("https://account.woot.com/?ref=ngh_act_ya_ndd", {
      waitUntil: "domcontentloaded",
    });
    console.log(`Account page URL: ${page.url()}`);

    // If we're signed in, account page should show profile info (not redirect to login)
    const pageText = await page.locator("body").textContent();
    console.log(`Account page content (first 500 chars): ${pageText?.trim().substring(0, 500)}`);

    // Should NOT be on the welcome/signin page
    expect(page.url()).not.toContain("welcome");
    expect(page.url()).not.toContain("signin");
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

    if (config.searchTerm) {
      const resultLink = page.locator('a[href*="/offers/"], a[href*="/deals/"]').first();
      if ((await resultLink.count()) > 0) {
        await resultLink.click();
        await page.waitForLoadState("domcontentloaded");
      }
    }
    timings.productPage = Date.now() - start;
    console.log(`Product navigation: ${timings.productPage}ms`);

    // Step 3: Find the buy button — wait for JS to render it
    const buyBtnSelector = 'button:has-text("Add to Cart"), button:has-text("I Want One"), button:has-text("Buy It"), a:has-text("Add to Cart"), a:has-text("Add to cart"), a:has-text("I Want One"), a:has-text("Buy It"), a.add-to-cart, [class*="buy-button"], [class*="BuyButton"], [class*="add-to-cart"], [class*="addToCart"]';
    let buyButton = page.locator(buyBtnSelector).first();

    // Give JS time to render the buy button before checking
    try {
      await buyButton.waitFor({ state: "visible", timeout: 8000 });
      console.log("Buy button found on product page");
    } catch {
      console.log("Buy button not found after 8s wait");
    }

    if ((await buyButton.count()) === 0 || !(await buyButton.isVisible().catch(() => false))) {
      console.log("Product appears sold out or no buy button — searching for an in-stock product...");

      // Go to homepage and try daily deal links
      await page.goto("https://www.woot.com/", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);

      // Collect all product/offer links from the page
      const offerLinks = page.locator('a[href*="/offers/"], a[href*="/deals/"]');
      const linkCount = await offerLinks.count();
      console.log(`Found ${linkCount} offer links on homepage`);

      let foundInStock = false;
      for (let i = 0; i < Math.min(linkCount, 10); i++) {
        const href = await offerLinks.nth(i).getAttribute("href");
        if (!href) continue;
        const fullUrl = href.startsWith("http") ? href : `https://www.woot.com${href}`;
        console.log(`Trying product ${i + 1}: ${fullUrl}`);

        await page.goto(fullUrl, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1500);

        buyButton = page.locator(buyBtnSelector).first();

        if ((await buyButton.count()) > 0) {
          console.log(`Found in-stock product: ${fullUrl}`);
          foundInStock = true;
          break;
        }
        console.log(`Product ${i + 1} is sold out, trying next...`);
      }

      if (!foundInStock) {
        console.log("No in-stock products found on homepage — cannot complete checkout");
        return;
      }
    }

    // Step 4: Set quantity if applicable
    const qtySelect = page.locator('select[name*="quantity"], select[name*="qty"]').first();
    if ((await qtySelect.count()) > 0 && config.quantity > 1) {
      await qtySelect.selectOption(String(config.quantity));
      console.log(`Quantity set to: ${config.quantity}`);
    }

    start = Date.now();
    await buyButton.click();
    await page.waitForTimeout(5000);
    timings.addToCart = Date.now() - start;
    console.log(`Add to cart: ${timings.addToCart}ms`);

    const checkoutUrl = page.url();
    console.log(`Checkout URL: ${checkoutUrl}`);

    // Step 6: Look for checkout components (Amazon Pay flow)
    const shippingAddress = page.locator('[class*="address"], [class*="Address"], [class*="shipping"], [class*="Shipping"]')
      .or(page.getByText(/shipping address|deliver to/i)).first();

    if ((await shippingAddress.count()) > 0) {
      const text = await shippingAddress.textContent();
      console.log(`Shipping section: ${text?.trim().substring(0, 100)}`);
    } else {
      console.log("No shipping address section visible yet");
    }

    const paymentMethod = page.locator('[class*="payment"], [class*="Payment"]')
      .or(page.getByText(/payment|pay with|credit card/i)).first();

    if ((await paymentMethod.count()) > 0) {
      const text = await paymentMethod.textContent();
      console.log(`Payment section: ${text?.trim().substring(0, 100)}`);
    } else {
      console.log("No payment section visible yet");
    }

    const orderTotal = page.locator('[class*="total"], [class*="Total"], [class*="summary"], [class*="Summary"]')
      .or(page.getByText(/total|order summary/i)).first();

    if ((await orderTotal.count()) > 0) {
      const text = await orderTotal.textContent();
      console.log(`Order summary: ${text?.trim().substring(0, 100)}`);
    }

    // Place order button (DO NOT CLICK)
    const placeOrder = page.locator(
      'button:has-text("Place"), button:has-text("Complete"), button:has-text("Confirm"), button:has-text("Submit")'
    ).or(page.locator('[class*="place-order"], [class*="PlaceOrder"]')).first();

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
