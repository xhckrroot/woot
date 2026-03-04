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

  // Step 1: Navigate directly to woot's sign-in page
  await page.goto(
    "https://account.woot.com/welcome?returnurl=https%3A%2F%2Fwww.woot.com%2F#signin",
    { waitUntil: "domcontentloaded" }
  );
  console.log(`Sign-in page URL: ${page.url()}`);

  // Step 2: Click "Login with Amazon" button on account.woot.com
  const amazonLogin = page.locator(
    '#lwa-button, [id*="LoginWithAmazon"], [class*="LoginWithAmazon"], [class*="login-with-amazon"], img[alt*="Amazon"], a:has-text("Login with Amazon"), button:has-text("Login with Amazon"), a:has-text("Sign in with Amazon"), button:has-text("Sign in with Amazon")'
  ).first();

  await amazonLogin.waitFor({ state: "visible", timeout: 15000 });
  console.log("Found Amazon login button");
  await amazonLogin.click();
  await page.waitForLoadState("domcontentloaded");
  console.log(`After Amazon button URL: ${page.url()}`);

  // Disable WebAuthn/passkey prompts via CDP so they don't interfere
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable", { enableUI: false });
  console.log("WebAuthn disabled via CDP");

  // Step 3: Fill Amazon email (now on amazon.com domain)
  const emailInput = page.locator("input#ap_email").first();
  await emailInput.waitFor({ state: "visible", timeout: 15000 });
  await emailInput.fill(email);
  console.log("Filled email");

  const continueBtn = page.locator("input#continue").first();
  if ((await continueBtn.count()) > 0) {
    await continueBtn.click();
    await page.waitForLoadState("domcontentloaded");
  }

  // Step 4: Fill Amazon password
  const passwordInput = page.locator("input#ap_password").first();
  await passwordInput.waitFor({ state: "visible", timeout: 15000 });
  await passwordInput.fill(password);
  console.log("Filled password");

  const signInBtn = page.locator("input#signInSubmit").first();
  await signInBtn.click();

  // Step 5: Wait for redirect back to woot.com
  await page.waitForURL("**/woot.com/**", { timeout: 30000 });
  await page.waitForLoadState("domcontentloaded");

  console.log(`Post-login URL: ${page.url()}`);
}

module.exports = { loadProductConfig, goToProduct, signInWithAmazon };
