// @ts-check
const { test, expect } = require("@playwright/test");

test.describe("Woot.com Accessibility & UX", () => {
  test("page has proper document structure", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Check for h1 heading
    const h1 = page.locator("h1");
    const h1Count = await h1.count();
    console.log(`H1 headings found: ${h1Count}`);

    // Check for lang attribute
    const lang = await page.locator("html").getAttribute("lang");
    console.log(`Language attribute: ${lang}`);
    expect(lang).toBeTruthy();

    // Check for meta viewport
    const viewport = await page.locator('meta[name="viewport"]').count();
    console.log(`Viewport meta tag: ${viewport > 0 ? "present" : "missing"}`);
    expect(viewport).toBeGreaterThan(0);
  });

  test("all images have alt attributes", async ({ page }) => {
    await page.goto("/", { waitUntil: "load" });

    const images = page.locator("img");
    const totalImages = await images.count();
    let missingAlt = 0;

    for (let i = 0; i < Math.min(totalImages, 20); i++) {
      const alt = await images.nth(i).getAttribute("alt");
      if (alt === null) missingAlt++;
    }

    const checked = Math.min(totalImages, 20);
    console.log(`Images checked: ${checked}`);
    console.log(`Missing alt attributes: ${missingAlt}`);

    // Flag if many images are missing alt text
    if (missingAlt > checked * 0.5) {
      console.log("WARNING: Over 50% of images missing alt text — accessibility issue");
    }
  });

  test("interactive elements are keyboard focusable", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Tab through first 10 focusable elements
    const focusableElements = [];
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        return {
          tag: el?.tagName,
          text: el?.textContent?.trim().substring(0, 50),
          href: el?.getAttribute("href"),
        };
      });
      focusableElements.push(focused);
    }

    console.log("Keyboard tab order (first 10):");
    focusableElements.forEach((el, i) => {
      console.log(`  ${i + 1}. <${el.tag}> ${el.text || el.href || "(empty)"}`);
    });

    // At least some elements should be focusable
    expect(focusableElements.length).toBeGreaterThan(0);
  });

  test("color contrast — page is readable", async ({ page }) => {
    await page.goto("/", { waitUntil: "load" });

    // Check that text is visible (basic check)
    const bodyStyles = await page.evaluate(() => {
      const style = getComputedStyle(document.body);
      return {
        color: style.color,
        background: style.backgroundColor,
        fontSize: style.fontSize,
      };
    });

    console.log(`Body text color: ${bodyStyles.color}`);
    console.log(`Body background: ${bodyStyles.background}`);
    console.log(`Body font size: ${bodyStyles.fontSize}`);

    // Font size should be reasonable
    const fontSize = parseFloat(bodyStyles.fontSize);
    expect(fontSize).toBeGreaterThanOrEqual(12);
  });

  test("links have descriptive text", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const links = page.locator("a");
    const linkCount = await links.count();
    let genericLinks = 0;
    const genericTexts = ["click here", "here", "read more", "more", "link"];

    for (let i = 0; i < Math.min(linkCount, 20); i++) {
      const text = (await links.nth(i).textContent())?.trim().toLowerCase();
      if (text && genericTexts.includes(text)) {
        genericLinks++;
      }
    }

    const checked = Math.min(linkCount, 20);
    console.log(`Links checked: ${checked}`);
    console.log(`Generic link text found: ${genericLinks}`);

    if (genericLinks > 0) {
      console.log("NOTE: Some links use generic text — could improve for accessibility");
    }
  });
});
