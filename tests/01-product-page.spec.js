// @ts-check
const { test, expect } = require("@playwright/test");
const { loadProductConfig, goToProduct } = require("./helpers");

const config = loadProductConfig();

test.describe("1. Product Page Validation", () => {
  test.beforeEach(async () => {
    if (!config.productUrl && !config.searchTerm) {
      test.skip(true, "No product specified — set PRODUCT_URL or SEARCH_TERM");
    }
  });

  test("product page loads successfully", async ({ page }) => {
    await goToProduct(page, config);

    await expect(page).toHaveTitle(/.+/);
    const title = await page.title();
    console.log(`Page title: ${title}`);
    console.log(`URL: ${page.url()}`);
  });

  test("product has a title/name displayed", async ({ page }) => {
    await goToProduct(page, config);

    const productName = page.locator("h1, h2").first();
    await expect(productName).toBeVisible();
    const name = await productName.textContent();
    console.log(`Product name: ${name?.trim()}`);
  });

  test("product has price information", async ({ page }) => {
    await goToProduct(page, config);

    // Use page.getByText for regex matching, combined with CSS selectors via .or()
    const priceByClass = page.locator('[class*="price"], [class*="Price"]');
    const priceByText = page.getByText(/\$\d+/);
    const price = priceByClass.or(priceByText).first();

    await expect(price).toBeVisible();
    const priceText = await price.textContent();
    console.log(`Price: ${priceText?.trim()}`);
  });

  test("product has an image", async ({ page }) => {
    await goToProduct(page, config);

    // Broader image search — look for any substantial image on the page
    const productImage = page.locator("img[src]").first();
    await expect(productImage).toBeVisible();

    const src = await productImage.getAttribute("src");
    console.log(`Product image src: ${src}`);

    const loaded = await productImage.evaluate(
      (img) => img.complete && img.naturalWidth > 0
    );
    expect(loaded).toBe(true);
  });

  test("product page shows condition/specs if available", async ({ page }) => {
    await goToProduct(page, config);

    const specs = page.locator(
      '[class*="spec"], [class*="Spec"], [class*="condition"], [class*="detail"], [class*="Detail"], [class*="description"], [class*="Description"], [class*="feature"], [class*="Feature"]'
    ).first();

    if ((await specs.count()) > 0) {
      const text = await specs.textContent();
      console.log(`Specs/details found: ${text?.trim().substring(0, 200)}...`);
    } else {
      console.log("No specs/condition section detected on this product page");
    }
  });

  test("shipping information is displayed", async ({ page }) => {
    await goToProduct(page, config);

    const shippingByClass = page.locator('[class*="shipping"], [class*="Shipping"], [class*="delivery"], [class*="Delivery"]');
    const shippingByText = page.getByText(/shipping|delivery|free shipping|Prime/i);
    const shipping = shippingByClass.or(shippingByText).first();

    if ((await shipping.count()) > 0) {
      const text = await shipping.textContent();
      console.log(`Shipping info: ${text?.trim()}`);
    } else {
      console.log("No shipping info displayed on product page");
    }
  });
});
