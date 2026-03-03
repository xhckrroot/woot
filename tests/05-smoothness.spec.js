// @ts-check
const { test, expect } = require("@playwright/test");
const { loadProductConfig, goToProduct } = require("./helpers");

const config = loadProductConfig();

test.describe("5. Checkout Smoothness Report", () => {
  test.beforeEach(async () => {
    if (!config.productUrl && !config.searchTerm) {
      test.skip(true, "No product specified");
    }
  });

  test("measure product page performance", async ({ page }) => {
    await goToProduct(page, config);

    if (config.searchTerm) {
      const resultLink = page.locator('a[href*="/offers/"], a[href*="/deals/"]').first();
      if ((await resultLink.count()) > 0) {
        await resultLink.click();
        await page.waitForLoadState("load");
      }
    }

    const metrics = await page.evaluate(() => {
      const perf = performance.getEntriesByType("navigation")[0];
      return {
        dns: Math.round(perf.domainLookupEnd - perf.domainLookupStart),
        tcp: Math.round(perf.connectEnd - perf.connectStart),
        ttfb: Math.round(perf.responseStart - perf.requestStart),
        domInteractive: Math.round(perf.domInteractive - perf.startTime),
        domContentLoaded: Math.round(perf.domContentLoadedEventEnd - perf.startTime),
        fullLoad: Math.round(perf.loadEventEnd - perf.startTime),
      };
    });

    console.log("\n=== Product Page Performance ===");
    console.log(`DNS lookup:          ${metrics.dns}ms`);
    console.log(`TCP connection:      ${metrics.tcp}ms`);
    console.log(`Time to first byte:  ${metrics.ttfb}ms`);
    console.log(`DOM interactive:     ${metrics.domInteractive}ms`);
    console.log(`DOM content loaded:  ${metrics.domContentLoaded}ms`);
    console.log(`Full page load:      ${metrics.fullLoad}ms`);

    expect(metrics.ttfb).toBeLessThan(5000);
    expect(metrics.domContentLoaded).toBeLessThan(10000);
  });

  test("measure layout stability (CLS)", async ({ page }) => {
    await goToProduct(page, config);

    if (config.searchTerm) {
      const resultLink = page.locator('a[href*="/offers/"], a[href*="/deals/"]').first();
      if ((await resultLink.count()) > 0) {
        await resultLink.click();
        await page.waitForLoadState("load");
      }
    }

    await page.waitForTimeout(3000);

    const cls = await page.evaluate(() => {
      return new Promise((resolve) => {
        let clsValue = 0;
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) clsValue += entry.value;
          }
        });
        observer.observe({ type: "layout-shift", buffered: true });
        setTimeout(() => {
          observer.disconnect();
          resolve(Math.round(clsValue * 1000) / 1000);
        }, 1000);
      });
    });

    console.log(`\nCumulative Layout Shift: ${cls}`);
    if (cls <= 0.1) console.log("Rating: GOOD");
    else if (cls <= 0.25) console.log("Rating: NEEDS IMPROVEMENT");
    else console.log("Rating: POOR");
  });

  test("check for failed network requests", async ({ page }) => {
    const failed = [];

    page.on("response", (response) => {
      if (response.status() >= 400) {
        failed.push({ url: response.url(), status: response.status() });
      }
    });

    await goToProduct(page, config);

    if (config.searchTerm) {
      const resultLink = page.locator('a[href*="/offers/"], a[href*="/deals/"]').first();
      if ((await resultLink.count()) > 0) {
        await resultLink.click();
        await page.waitForLoadState("load");
      }
    }

    await page.waitForTimeout(2000);

    console.log(`\nFailed requests: ${failed.length}`);
    failed.forEach((r) => console.log(`  ${r.status} — ${r.url}`));

    const serverErrors = failed.filter(
      (r) => r.url.includes("woot.com") && r.status >= 500
    );
    expect(serverErrors.length).toBe(0);
  });

  test("mobile responsiveness on product page", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await goToProduct(page, config);

    if (config.searchTerm) {
      const resultLink = page.locator('a[href*="/offers/"], a[href*="/deals/"]').first();
      if ((await resultLink.count()) > 0) {
        await resultLink.click();
        await page.waitForLoadState("domcontentloaded");
      }
    }

    const hasHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );

    console.log(`\nMobile horizontal scroll: ${hasHorizontalScroll ? "YES (bad)" : "NO (good)"}`);

    const buyButton = page.locator(
      'button:has-text("Add to Cart"), button:has-text("I Want One"), button:has-text("Buy It")'
    ).or(page.locator('[class*="buy-button"], [class*="BuyButton"]')).first();

    if ((await buyButton.count()) > 0) {
      const visible = await buyButton.isVisible();
      console.log(`Buy button visible on mobile: ${visible}`);
    }

    await page.screenshot({ path: "test-results/mobile-product.png", fullPage: false });
    console.log("Screenshot saved: test-results/mobile-product.png");
  });

  test("overall smoothness summary", async ({ page }) => {
    const results = {
      steps: [],
      issues: [],
    };

    let start = Date.now();
    await goToProduct(page, config);
    results.steps.push({ name: "Navigate to product", time: Date.now() - start });

    if (config.searchTerm) {
      start = Date.now();
      const resultLink = page.locator('a[href*="/offers/"], a[href*="/deals/"]').first();
      if ((await resultLink.count()) > 0) {
        await resultLink.click();
        await page.waitForLoadState("domcontentloaded");
        results.steps.push({ name: "Select from results", time: Date.now() - start });
      } else {
        results.issues.push("No results found for search term");
      }
    }

    const soldOut = page.getByText(/sold out|out of stock/i).first();
    if ((await soldOut.count()) > 0) {
      results.issues.push("Product is sold out");
    }

    const buyButton = page.locator(
      'button:has-text("Add to Cart"), button:has-text("I Want One"), button:has-text("Buy It")'
    ).or(page.locator('[class*="buy-button"], [class*="BuyButton"]')).first();

    if ((await buyButton.count()) > 0) {
      const isDisabled = await buyButton.isDisabled();
      if (isDisabled) results.issues.push("Buy button is disabled");

      start = Date.now();
      await buyButton.click();
      await page.waitForTimeout(4000);
      results.steps.push({ name: "Click buy / add to cart", time: Date.now() - start });
    } else if ((await soldOut.count()) === 0) {
      results.issues.push("No buy button found on product page");
    }

    console.log("\n==============================");
    console.log("  CHECKOUT SMOOTHNESS REPORT");
    console.log("==============================");
    console.log(`\nProduct: ${config.productUrl || config.searchTerm}`);
    console.log(`URL: ${page.url()}`);

    console.log("\n--- Step Timings ---");
    let totalTime = 0;
    results.steps.forEach((s) => {
      console.log(`  ${s.name}: ${s.time}ms`);
      totalTime += s.time;
    });
    console.log(`  TOTAL: ${totalTime}ms`);

    if (results.issues.length > 0) {
      console.log("\n--- Issues Found ---");
      results.issues.forEach((i) => console.log(`  WARNING: ${i}`));
    } else {
      console.log("\n--- No issues detected ---");
    }

    const smooth = totalTime < 15000 && results.issues.length === 0;
    console.log(`\nVerdict: ${smooth ? "SMOOTH" : "NEEDS ATTENTION"}`);
  });
});
