// @ts-check
const { test, expect } = require("@playwright/test");

test.describe("Woot.com Performance & Smoothness", () => {
  test("page load performance metrics", async ({ page }) => {
    await page.goto("/", { waitUntil: "load" });

    const metrics = await page.evaluate(() => {
      const perf = performance.getEntriesByType("navigation")[0];
      return {
        dns: Math.round(perf.domainLookupEnd - perf.domainLookupStart),
        tcp: Math.round(perf.connectEnd - perf.connectStart),
        ttfb: Math.round(perf.responseStart - perf.requestStart),
        domContentLoaded: Math.round(perf.domContentLoadedEventEnd - perf.startTime),
        fullLoad: Math.round(perf.loadEventEnd - perf.startTime),
        domInteractive: Math.round(perf.domInteractive - perf.startTime),
      };
    });

    console.log("\n--- Performance Metrics ---");
    console.log(`DNS lookup:          ${metrics.dns}ms`);
    console.log(`TCP connection:      ${metrics.tcp}ms`);
    console.log(`Time to first byte:  ${metrics.ttfb}ms`);
    console.log(`DOM interactive:     ${metrics.domInteractive}ms`);
    console.log(`DOM content loaded:  ${metrics.domContentLoaded}ms`);
    console.log(`Full page load:      ${metrics.fullLoad}ms`);

    // Reasonable performance thresholds
    expect(metrics.ttfb).toBeLessThan(5000);
    expect(metrics.domContentLoaded).toBeLessThan(10000);
    expect(metrics.fullLoad).toBeLessThan(15000);
  });

  test("no layout shift issues (CLS check)", async ({ page }) => {
    await page.goto("/", { waitUntil: "load" });

    // Wait a bit for any delayed content
    await page.waitForTimeout(2000);

    const cls = await page.evaluate(() => {
      return new Promise((resolve) => {
        let clsValue = 0;
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) {
              clsValue += entry.value;
            }
          }
        });
        observer.observe({ type: "layout-shift", buffered: true });
        setTimeout(() => {
          observer.disconnect();
          resolve(clsValue);
        }, 1000);
      });
    });

    console.log(`Cumulative Layout Shift (CLS): ${cls}`);
    // Good CLS is under 0.1, needs improvement under 0.25
    if (cls <= 0.1) console.log("CLS: GOOD");
    else if (cls <= 0.25) console.log("CLS: NEEDS IMPROVEMENT");
    else console.log("CLS: POOR");

    expect(cls).toBeLessThan(0.5); // Allow some tolerance
  });

  test("critical resources load without errors", async ({ page }) => {
    const failedRequests = [];

    page.on("response", (response) => {
      if (response.status() >= 400 && response.status() !== 403) {
        failedRequests.push({
          url: response.url(),
          status: response.status(),
        });
      }
    });

    await page.goto("/", { waitUntil: "load" });
    await page.waitForTimeout(2000);

    console.log(`Failed requests: ${failedRequests.length}`);
    failedRequests.forEach((r) => {
      console.log(`  ${r.status}: ${r.url}`);
    });

    // Allow some third-party failures, but flag them
    const criticalFailures = failedRequests.filter(
      (r) => r.url.includes("woot.com") && r.status >= 500
    );
    expect(criticalFailures.length).toBe(0);
  });

  test("responsive design - mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 }); // iPhone X
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Check no horizontal scroll
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    console.log(`Horizontal scroll on mobile: ${hasHorizontalScroll}`);

    // Check content is visible
    const bodyVisible = await page.locator("body").isVisible();
    expect(bodyVisible).toBe(true);

    // Take a screenshot for visual inspection
    await page.screenshot({ path: "test-results/mobile-homepage.png", fullPage: false });
    console.log("Mobile screenshot saved to test-results/mobile-homepage.png");
  });

  test("responsive design - tablet viewport", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 }); // iPad
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const bodyVisible = await page.locator("body").isVisible();
    expect(bodyVisible).toBe(true);

    await page.screenshot({ path: "test-results/tablet-homepage.png", fullPage: false });
    console.log("Tablet screenshot saved to test-results/tablet-homepage.png");
  });
});
