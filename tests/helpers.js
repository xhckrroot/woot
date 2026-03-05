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

  const cmApiKey = process.env.CAPMONSTER_API_KEY;
  if (!cmApiKey) throw new Error("CAPTCHA detected but CAPMONSTER_API_KEY env var is not set");

  console.log("CAPTCHA detected — extracting AWS WAF parameters...");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2000);

  let websiteKey = null, context = null, iv = null;
  let challengeScript = null, captchaScript = null;

  // Strategy 1: page.evaluate — check gokuProps + search inline scripts for apiKey/context/iv
  const evalResult = await page.evaluate(() => {
    let wk = null, ctx = null, ivVal = null;

    // Check gokuProps
    if (window.gokuProps) {
      wk = window.gokuProps.key || null;
      ctx = window.gokuProps.context || null;
      ivVal = window.gokuProps.iv || null;
    }

    // Search ALL inline scripts for apiKey, context (base64), iv (base64)
    if (!wk || !ctx || !ivVal) {
      const scripts = Array.from(document.querySelectorAll("script:not([src])"));
      for (const s of scripts) {
        const t = s.textContent || "";
        if (!wk) {
          const m = t.match(/["']?apiKey["']?\s*:\s*["']([A-Za-z0-9+/=]{10,})["']/);
          if (m) wk = m[1];
        }
        if (!ctx) {
          // WAF context is a long base64 string (50+ chars)
          const matches = [...t.matchAll(/["']?context["']?\s*:\s*["']([A-Za-z0-9+/=]{50,})["']/g)];
          if (matches.length > 0) ctx = matches[0][1];
        }
        if (!ivVal) {
          const m = t.match(/["']?iv["']?\s*:\s*["']([A-Za-z0-9+/=]{5,50})["']/);
          if (m) ivVal = m[1];
        }
      }
    }

    // Find script URLs
    const srcScripts = Array.from(document.querySelectorAll("script[src]"));
    const cs = (srcScripts.find(s => s.src.includes("challenge.js")) || {}).src || null;
    const cps = (srcScripts.find(s => s.src.includes("captcha.js")) || {}).src || null;

    // Get full captcha init script for debugging
    const captchaInitScript = Array.from(document.querySelectorAll("script:not([src])"))
      .filter(s => (s.textContent || "").includes("captcha-container"))
      .map(s => s.textContent)[0] || null;

    return { wk, ctx, ivVal, cs, cps, captchaInitScript };
  });

  websiteKey = evalResult.wk;
  context = evalResult.ctx;
  iv = evalResult.ivVal;
  challengeScript = evalResult.cs;
  captchaScript = evalResult.cps;

  if (evalResult.captchaInitScript) {
    console.log("CAPTCHA init script:", evalResult.captchaInitScript.substring(0, 2000));
  }

  // Strategy 2: Search full page HTML via page.content()
  if (!websiteKey || !context || !iv) {
    console.log("Strategy 1 incomplete — searching full page HTML...");
    const html = await page.content();

    if (!websiteKey) {
      const m = html.match(/["']apiKey["']\s*:\s*["']([A-Za-z0-9+/=]{10,})["']/);
      if (m) websiteKey = m[1];
    }
    if (!context) {
      const matches = [...html.matchAll(/["']context["']\s*:\s*["']([A-Za-z0-9+/=]{50,})["']/g)];
      if (matches.length > 0) context = matches[0][1];
    }
    if (!iv) {
      // iv is base64, typically 10-30 chars, avoid false matches with common "iv" strings
      const matches = [...html.matchAll(/["']iv["']\s*:\s*["']([A-Za-z0-9+/=]{5,50})["']/g)];
      if (matches.length > 0) iv = matches[0][1];
    }
  }

  console.log(`After page extraction: key=${websiteKey ? "found" : "missing"}, context=${context ? "found" : "missing"}, iv=${iv ? "found" : "missing"}`);

  // Strategy 3: Network interception — reload page and capture WAF API responses
  if (!websiteKey || !context || !iv) {
    console.log("Params not in page HTML — trying network interception on reload...");

    const wafResponses = [];
    const handler = async (response) => {
      const url = response.url();
      // Capture non-JS responses from captcha.awswaf.com (API calls)
      if (url.includes("captcha.awswaf.com") && !url.endsWith(".js")) {
        try {
          const body = await response.text();
          wafResponses.push({ url, body });
        } catch {}
      }
    };
    page.on("response", handler);

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(5000);
    page.off("response", handler);

    console.log(`Captured ${wafResponses.length} WAF API responses`);
    for (const resp of wafResponses) {
      console.log(`WAF response [${resp.url}]: ${resp.body.substring(0, 500)}`);
      try {
        const data = JSON.parse(resp.body);
        // Check top-level
        if (data.key && !websiteKey) websiteKey = data.key;
        if (data.context && !context) context = data.context;
        if (data.iv && !iv) iv = data.iv;
        // Check nested state object (AWS WAF /problem endpoint returns state.iv + state.payload)
        if (data.state) {
          if (data.state.iv && !iv) iv = data.state.iv;
          if (data.state.payload && !context) context = data.state.payload;
        }
      } catch {
        // Regex fallback for non-JSON responses
        if (!websiteKey) { const m = resp.body.match(/"key"\s*:\s*"([^"]+)"/); if (m) websiteKey = m[1]; }
        if (!context) { const m = resp.body.match(/"context"\s*:\s*"([^"]+)"/); if (m) context = m[1]; }
        if (!iv) { const m = resp.body.match(/"iv"\s*:\s*"([^"]+)"/); if (m) iv = m[1]; }
      }
    }

    // Re-try page extraction after reload (new HTML may have params)
    if (!websiteKey || !context || !iv) {
      const reloadParams = await page.evaluate(() => {
        if (window.gokuProps) {
          return { key: window.gokuProps.key, context: window.gokuProps.context, iv: window.gokuProps.iv };
        }
        return null;
      });
      if (reloadParams) {
        websiteKey = websiteKey || reloadParams.key;
        context = context || reloadParams.context;
        iv = iv || reloadParams.iv;
      }
    }
  }

  console.log(`Final extraction: key=${websiteKey ? websiteKey.substring(0, 20) + "..." : "MISSING"}, context=${context ? "found (" + context.length + " chars)" : "MISSING"}, iv=${iv || "MISSING"}`);
  console.log(`Challenge script: ${challengeScript || "not found"}`);
  console.log(`Captcha script: ${captchaScript || "not found"}`);

  // Construct challengeScript URL from captchaScript if missing
  if (!challengeScript && captchaScript) {
    challengeScript = captchaScript.replace("captcha.js", "challenge.js");
  }

  if (!websiteKey || !context || !iv) {
    throw new Error("Could not extract CAPTCHA parameters from page or network");
  }

  // Create CapMonster task
  console.log(`Sending to CapMonster: websiteURL=${page.url()}, key=${websiteKey.substring(0, 30)}..., iv=${iv}, context=${context.substring(0, 30)}... (${context.length} chars), captchaScript=${captchaScript}, challengeScript=${challengeScript}`);
  const createRes = await fetch(`${CAPMONSTER_API}/createTask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientKey: cmApiKey,
      task: {
        type: "AmazonTaskProxyless",
        websiteURL: page.url(),
        challengeScript: challengeScript || "",
        captchaScript: captchaScript || "",
        websiteKey,
        context,
        iv,
        cookieSolution: true,
      },
    }),
  });
  const createData = await createRes.json();
  console.log(`CapMonster createTask response: ${JSON.stringify(createData)}`);
  if (createData.errorId) throw new Error(`CapMonster createTask error [${createData.errorCode}]: ${createData.errorDescription}`);

  const taskId = createData.taskId;
  console.log(`CapMonster task created: ${taskId}`);

  // Poll for result (max 120s)
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const resultRes = await fetch(`${CAPMONSTER_API}/getTaskResult`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey: cmApiKey, taskId }),
    });
    const rawText = await resultRes.text();
    console.log(`CapMonster poll #${i + 1} (HTTP ${resultRes.status}): ${rawText}`);

    let resultData;
    try {
      resultData = JSON.parse(rawText);
    } catch {
      console.log(`CapMonster poll #${i + 1}: non-JSON response, retrying...`);
      continue;
    }

    if (resultData.status === "ready") {
      console.log(`CapMonster CAPTCHA solved! Full response: ${JSON.stringify(resultData, null, 2)}`);
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
        console.log(`Set cookie: ${name}=${value.substring(0, 40)}...`);
      }

      // Also log other solution fields (userAgent, token, etc.)
      const { cookies: _c, ...solutionRest } = solution;
      if (Object.keys(solutionRest).length > 0) {
        console.log(`Solution extras: ${JSON.stringify(solutionRest, null, 2)}`);
      }

      // Reload page with the new cookie
      await page.reload({ waitUntil: "domcontentloaded" });
      return true;
    }

    if (resultData.errorId && resultData.errorId !== 0) {
      console.log(`CapMonster error — full response: ${JSON.stringify(resultData, null, 2)}`);
      console.log(`  errorId: ${resultData.errorId}`);
      console.log(`  errorCode: ${resultData.errorCode || "(empty)"}`);
      console.log(`  errorDescription: ${resultData.errorDescription || "(empty)"}`);
      console.log(`  taskId: ${resultData.taskId || "(none)"}`);
      throw new Error(`CapMonster solve error: errorId=${resultData.errorId}, errorCode=${resultData.errorCode || "none"}, desc=${resultData.errorDescription || "none"}`);
    }
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

  // Step 3: Fill Amazon email with human-like typing delays
  const emailInput = page.locator("input#ap_email").first();
  await emailInput.waitFor({ state: "visible", timeout: 15000 });
  await emailInput.click();
  await page.waitForTimeout(500);
  await emailInput.pressSequentially(email, { delay: 80 + Math.random() * 60 });
  console.log("Typed email");

  await page.waitForTimeout(1000 + Math.random() * 500);
  const continueBtn = page.locator("input#continue").first();
  if ((await continueBtn.count()) > 0) {
    await continueBtn.click();
    await page.waitForLoadState("domcontentloaded");
  }

  // Check for CAPTCHA after email step
  await page.waitForTimeout(1500);
  await solveAwsCaptchaIfPresent(page);

  // Step 4: Fill Amazon password with human-like typing delays
  const passwordInput = page.locator("input#ap_password").first();
  await passwordInput.waitFor({ state: "visible", timeout: 15000 });
  await passwordInput.click();
  await page.waitForTimeout(500);
  await passwordInput.pressSequentially(password, { delay: 90 + Math.random() * 70 });
  console.log("Typed password");

  await page.waitForTimeout(1000 + Math.random() * 500);
  const signInBtn = page.locator("input#signInSubmit").first();
  await signInBtn.click();

  // Step 5: Wait and detect what happened after sign-in
  await page.waitForTimeout(3000);
  await page.waitForLoadState("domcontentloaded");

  // Diagnostic: log current state
  const postClickUrl = page.url();
  console.log(`Post sign-in click URL: ${postClickUrl}`);

  // Check for CAPTCHA
  const captchaSolved = await solveAwsCaptchaIfPresent(page);
  if (captchaSolved) {
    console.log("CAPTCHA solved, waiting for redirect...");
    try {
      await page.waitForURL("**/woot.com/**", { timeout: 30000 });
    } catch {
      console.log(`After CAPTCHA solve, still on: ${page.url()}`);
    }
    await page.waitForLoadState("domcontentloaded");
    console.log(`Post-login URL: ${page.url()}`);
    return;
  }

  // Already on woot.com? Great, we're done
  if (page.url().includes("woot.com")) {
    await page.waitForLoadState("domcontentloaded");
    console.log(`Post-login URL (already on woot): ${page.url()}`);
    return;
  }

  // Detect common Amazon post-login pages
  const pageState = await page.evaluate(() => {
    const body = document.body?.innerText || "";
    const title = document.title || "";
    const url = window.location.href;

    // Check for error messages
    const errorBox = document.querySelector("#auth-error-message-box, .a-alert-content, #auth-warning-message-box, .a-box-inner .a-alert-content");
    const errorText = errorBox ? errorBox.innerText.trim() : null;

    // Check for OTP / 2FA
    const otpInput = document.querySelector("input#auth-mfa-otpcode, input[name='otpCode'], input[name='code']");
    const hasOtp = !!otpInput;

    // Check for approval / notification page
    const hasApproval = body.includes("Approve the notification") || body.includes("approve this sign-in") || body.includes("sent a notification");

    // Check for image CAPTCHA (not WAF)
    const hasImageCaptcha = !!document.querySelector("#auth-captcha-image, img[src*='captcha']");

    // Check for "important message" or account hold
    const hasAccountIssue = body.includes("Important Message") || body.includes("account on hold") || body.includes("verify your identity");

    // Check if password field is still visible (login failed silently)
    const passwordStillVisible = !!document.querySelector("input#ap_password:not([type='hidden'])");

    return {
      url,
      title,
      errorText,
      hasOtp,
      hasApproval,
      hasImageCaptcha,
      hasAccountIssue,
      passwordStillVisible,
      bodySnippet: body.substring(0, 500),
    };
  });

  console.log(`Post sign-in page state:`);
  console.log(`  URL: ${pageState.url}`);
  console.log(`  Title: ${pageState.title}`);
  if (pageState.errorText) console.log(`  Error: ${pageState.errorText}`);
  if (pageState.hasOtp) console.log(`  OTP/2FA input detected — needs manual code`);
  if (pageState.hasApproval) console.log(`  Push approval required — check your phone`);
  if (pageState.hasImageCaptcha) console.log(`  Image CAPTCHA detected (not WAF type)`);
  if (pageState.hasAccountIssue) console.log(`  Account issue / identity verification required`);
  if (pageState.passwordStillVisible) console.log(`  Password field still visible — login may have failed`);
  console.log(`  Page body: ${pageState.bodySnippet}`);

  // Handle OTP: wait for user to manually enter it, then continue
  if (pageState.hasOtp) {
    console.log("Waiting up to 60s for OTP submission...");
    try {
      await page.waitForURL("**/woot.com/**", { timeout: 60000 });
    } catch {
      throw new Error(`OTP/2FA required but never completed. Still on: ${page.url()}`);
    }
    await page.waitForLoadState("domcontentloaded");
    console.log(`Post-login URL (after OTP): ${page.url()}`);
    return;
  }

  // Handle approval: wait longer for push notification approval
  if (pageState.hasApproval) {
    console.log("Waiting up to 60s for push approval...");
    try {
      await page.waitForURL("**/woot.com/**", { timeout: 60000 });
    } catch {
      throw new Error(`Push approval required but never completed. Still on: ${page.url()}`);
    }
    await page.waitForLoadState("domcontentloaded");
    console.log(`Post-login URL (after approval): ${page.url()}`);
    return;
  }

  // If there's an error or we're stuck, throw with details
  if (pageState.errorText) {
    throw new Error(`Amazon login error: ${pageState.errorText}`);
  }

  // Last resort: try waiting for redirect anyway
  try {
    await page.waitForURL("**/woot.com/**", { timeout: 15000 });
    await page.waitForLoadState("domcontentloaded");
    console.log(`Post-login URL: ${page.url()}`);
  } catch {
    // Take a screenshot path for debugging
    console.log(`Login stuck on: ${page.url()}`);
    console.log(`Page content: ${pageState.bodySnippet}`);
    throw new Error(`Login did not redirect to woot.com. Stuck on: ${page.url()}. Page title: "${pageState.title}". Error: ${pageState.errorText || "none detected"}`);
  }
}

module.exports = { loadProductConfig, goToProduct, signInWithAmazon, solveAwsCaptchaIfPresent };
