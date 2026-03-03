// @ts-check
const fs = require("fs");
const path = require("path");

/**
 * Load product configuration from:
 *   1. Environment variables (PRODUCT_URL, SEARCH_TERM, QUANTITY, WOOT_EMAIL, WOOT_PASSWORD)
 *   2. product.config.json in project root
 *
 * Environment variables take priority over the config file.
 */
function loadProductConfig() {
  let fileConfig = {};
  const configPath = path.join(__dirname, "..", "product.config.json");

  if (fs.existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch {
      // ignore parse errors
    }
  }

  return {
    productUrl: process.env.PRODUCT_URL || fileConfig.product_url || "",
    searchTerm: process.env.SEARCH_TERM || fileConfig.search_term || "",
    quantity: parseInt(process.env.QUANTITY || fileConfig.quantity || "1", 10),
    email: process.env.WOOT_EMAIL || fileConfig.amazon_email || "",
    password: process.env.WOOT_PASSWORD || fileConfig.amazon_password || "",
  };
}

/**
 * Navigate to the user-specified product page.
 * Supports direct URL or searching by term on woot.com.
 */
async function goToProduct(page, config) {
  if (config.productUrl) {
    console.log(`Navigating to product URL: ${config.productUrl}`);
    await page.goto(config.productUrl, { waitUntil: "domcontentloaded" });
    return;
  }

  if (config.searchTerm) {
    console.log(`Searching woot.com for: "${config.searchTerm}"`);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Look for search input
    const searchInput = page.locator(
      'input[type="search"], input[name="search"], input[name="q"], input[placeholder*="search"], input[placeholder*="Search"], [class*="search"] input, [class*="Search"] input'
    ).first();

    if ((await searchInput.count()) > 0) {
      await searchInput.click();
      await searchInput.fill(config.searchTerm);
      await page.keyboard.press("Enter");
      await page.waitForLoadState("domcontentloaded");
    } else {
      // Fallback: navigate to search URL directly
      await page.goto(`/search?query=${encodeURIComponent(config.searchTerm)}`, {
        waitUntil: "domcontentloaded",
      });
    }
    return;
  }

  throw new Error(
    "No product specified. Set PRODUCT_URL or SEARCH_TERM env var, or fill in product.config.json"
  );
}

/**
 * Sign in with Amazon credentials on woot.com
 */
async function signInWithAmazon(page, email, password) {
  console.log("Attempting Amazon sign-in...");

  // Woot's header overlays can intercept clicks, so we use specific selectors
  // and force-click or JS-click when needed.
  const signIn = page.locator('[data-test-ui="prime-header-lwa"]').or(
    page.locator('.login-with-amazon')
  ).or(
    page.locator('a:has-text("Sign In"), a:has-text("Log In"), button:has-text("Sign In")')
  ).or(
    page.locator('[class*="sign-in"], [class*="SignIn"], [class*="login"], [class*="Login"], [class*="signin"]')
  ).first();

  if ((await signIn.count()) > 0) {
    try {
      await signIn.click({ timeout: 5000 });
    } catch {
      // Header elements overlap the sign-in button; use JS click to bypass
      console.log("Normal click blocked by overlay — using JS click");
      await signIn.dispatchEvent("click");
    }
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);
  }

  // Click "Log in with Amazon" button (may appear as a popup/modal or redirect)
  const amazonLogin = page.locator(
    '[id*="LoginWithAmazon"], img[alt*="Amazon"], button:has-text("Amazon"), a:has-text("Amazon")'
  ).first();

  if ((await amazonLogin.count()) > 0) {
    try {
      await amazonLogin.click({ timeout: 5000 });
    } catch {
      console.log("Amazon login button blocked — using JS click");
      await amazonLogin.dispatchEvent("click");
    }
    await page.waitForLoadState("domcontentloaded");
  }

  // Fill Amazon email
  const emailInput = page.locator(
    'input[name="email"], input[type="email"], input#ap_email'
  ).first();

  if ((await emailInput.count()) > 0) {
    await emailInput.fill(email);
    const continueBtn = page.locator(
      'input#continue, input[type="submit"], button[type="submit"]'
    ).first();
    if ((await continueBtn.count()) > 0) {
      await continueBtn.click();
      await page.waitForLoadState("domcontentloaded");
    }
  }

  // Fill Amazon password
  const passwordInput = page.locator(
    'input[name="password"], input[type="password"], input#ap_password'
  ).first();

  if ((await passwordInput.count()) > 0) {
    await passwordInput.fill(password);
    const signInBtn = page.locator(
      'input#signInSubmit, input[type="submit"], button[type="submit"]'
    ).first();
    if ((await signInBtn.count()) > 0) {
      await signInBtn.click();
      await page.waitForLoadState("domcontentloaded");
    }
  }

  console.log(`Post-login URL: ${page.url()}`);
}

module.exports = { loadProductConfig, goToProduct, signInWithAmazon };
