// @ts-check
const fs = require("fs");
const path = require("path");

const CAPMONSTER_API = "https://api.capmonster.cloud";

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
 * Detect and solve AWS WAF CAPTCHA on the current page using CapMonster.
 * Returns true if a CAPTCHA was found and solved, false otherwise.
 */
async function solveAwsCaptchaIfPresent(page) {
  const captchaHeader = page.locator("#aacb-captcha-header");
  if ((await captchaHeader.count()) === 0) return false;

  const apiKey = process.env.CAPMONSTER_API_KEY;
  if (!apiKey) throw new Error("CAPTCHA detected but CAPMONSTER_API_KEY env var is not set");

  console.log("CAPTCHA detected — waiting for full page load...");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3000);

  // Extract params using multiple strategies
  const params = await page.evaluate(() => {
    let websiteKey = null, context = null, iv = null;
    let challengeScript = null, captchaScript = null;

    // Strategy 1: window.gokuProps (standard AWS WAF)
    if (window.gokuProps) {
      websiteKey = window.gokuProps.key || null;
      context = window.gokuProps.context || null;
      iv = window.gokuProps.iv || null;
    }

    // Strategy 2: Search inline scripts for gokuProps or key/context/iv patterns
    if (!websiteKey || !context || !iv) {
      const inlineScripts = Array.from(document.querySelectorAll("script:not([src])"));
      for (const script of inlineScripts) {
        const text = script.textContent || "";
        // Look for gokuProps assignment
        const gokuMatch = text.match(/gokuProps\s*=\s*\{([^}]*)\}/);
        if (gokuMatch) {
          const keyM = gokuMatch[1].match(/["']?key["']?\s*:\s*["']([^"']+)["']/);
          const ctxM = gokuMatch[1].match(/["']?context["']?\s*:\s*["']([^"']+)["']/);
          const ivM = gokuMatch[1].match(/["']?iv["']?\s*:\s*["']([^"']+)["']/);
          if (keyM) websiteKey = websiteKey || keyM[1];
          if (ctxM) context = context || ctxM[1];
          if (ivM) iv = iv || ivM[1];
        }
      }
    }

    // Find challenge/captcha script URLs
    const srcScripts = Array.from(document.querySelectorAll("script[src]"));
    challengeScript = (srcScripts.find(s => s.src.includes("challenge.js")) || {}).src || null;
    captchaScript = (srcScripts.find(s => s.src.includes("captcha.js")) || {}).src || null;

    // Debug info
    const scriptSrcs = srcScripts.map(s => s.src);
    const inlineSnippets = Array.from(document.querySelectorAll("script:not([src])"))
      .map(s => (s.textContent || "").substring(0, 500));
    const iframes = Array.from(document.querySelectorAll("iframe")).map(f => f.src);
    const captchaGlobals = Object.keys(window).filter(k =>
      /goku|captcha|waf|challenge|aacb/i.test(k)
    );

    return {
      websiteKey, context, iv, challengeScript, captchaScript,
      debug: { scriptSrcs, inlineSnippets, iframes, captchaGlobals },
    };
  });

  console.log(`Params: key=${params.websiteKey ? "found" : "missing"}, context=${params.context ? "found" : "missing"}, iv=${params.iv ? "found" : "missing"}`);
  console.log(`Challenge script: ${params.challengeScript || "not found"}`);
  console.log(`Captcha script: ${params.captchaScript || "not found"}`);
  console.log(`Script sources: ${JSON.stringify(params.debug.scriptSrcs)}`);
  console.log(`Iframes: ${JSON.stringify(params.debug.iframes)}`);
  console.log(`CAPTCHA globals: ${JSON.stringify(params.debug.captchaGlobals)}`);
  params.debug.inlineSnippets.forEach((s, i) => console.log(`Inline[${i}]: ${s}`));

  // Check child frames for gokuProps
  if (!params.websiteKey || !params.context || !params.iv) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      try {
        const fp = await frame.evaluate(() => ({
          key: (window.gokuProps || {}).key || null,
          context: (window.gokuProps || {}).context || null,
          iv: (window.gokuProps || {}).iv || null,
          url: location.href,
        }));
        console.log(`Frame [${fp.url}]: key=${fp.key ? "found" : "missing"}`);
        if (fp.key) params.websiteKey = fp.key;
        if (fp.context) params.context = fp.context;
        if (fp.iv) params.iv = fp.iv;
      } catch (e) {
        console.log(`Frame error: ${e.message}`);
      }
    }
  }

  if (!params.websiteKey || !params.context || !params.iv) {
    throw new Error("Could not extract CAPTCHA parameters — see debug logs above for page structure");
  }

  // Create CapMonster task
  const createRes = await fetch(`${CAPMONSTER_API}/createTask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientKey: apiKey,
      task: {
        type: "AmazonTaskProxyless",
        websiteURL: page.url(),
        challengeScript: params.challengeScript || "",
        captchaScript: params.captchaScript || "",
        websiteKey: params.websiteKey,
        context: params.context,
        iv: params.iv,
        cookieSolution: true,
      },
    }),
  });
  const createData = await createRes.json();
  if (createData.errorId) throw new Error(`CapMonster createTask error: ${createData.errorDescription}`);

  const taskId = createData.taskId;
  console.log(`CapMonster task created: ${taskId}`);

  // Poll for result (max 120s)
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const resultRes = await fetch(`${CAPMONSTER_API}/getTaskResult`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey: apiKey, taskId }),
    });
    const resultData = await resultRes.json();

    if (resultData.status === "ready") {
      console.log("CapMonster CAPTCHA solved!");
      const solution = resultData.solution || {};
      const cookies = solution.cookies || {};

      // Apply aws-waf-token cookie
      for (const [name, value] of Object.entries(cookies)) {
        const url = new URL(page.url());
        await page.context().addCookies([{
          name,
          value,
          domain: url.hostname,
          path: "/",
        }]);
        console.log(`Set cookie: ${name}`);
      }

      // Reload page with the new cookie
      await page.reload({ waitUntil: "domcontentloaded" });
      return true;
    }

    if (resultData.errorId) throw new Error(`CapMonster solve error: ${resultData.errorDescription}`);
  }

  throw new Error("CapMonster CAPTCHA solving timed out");
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

  // Check for CAPTCHA after email step
  await solveAwsCaptchaIfPresent(page);

  // Step 4: Fill Amazon password
  const passwordInput = page.locator("input#ap_password").first();
  await passwordInput.waitFor({ state: "visible", timeout: 15000 });
  await passwordInput.fill(password);
  console.log("Filled password");

  const signInBtn = page.locator("input#signInSubmit").first();
  await signInBtn.click();

  // Check for CAPTCHA after password step
  await page.waitForTimeout(2000);
  const captchaSolved = await solveAwsCaptchaIfPresent(page);

  // Step 5: Wait for redirect back to woot.com
  if (!captchaSolved) {
    await page.waitForURL("**/woot.com/**", { timeout: 30000 });
  } else {
    // After CAPTCHA solve + reload, we may need to wait for redirect
    try {
      await page.waitForURL("**/woot.com/**", { timeout: 30000 });
    } catch {
      // Already on woot.com after reload
    }
  }
  await page.waitForLoadState("domcontentloaded");

  console.log(`Post-login URL: ${page.url()}`);
}

module.exports = { loadProductConfig, goToProduct, signInWithAmazon, solveAwsCaptchaIfPresent };
