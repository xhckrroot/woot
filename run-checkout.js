#!/usr/bin/env node
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const CONFIG_PATH = path.join(__dirname, "product.config.json");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  console.log("=================================");
  console.log("  Woot.com Checkout Test Runner");
  console.log("=================================\n");

  // Check for CLI args first: npm run checkout -- "https://woot.com/offers/..."
  const cliArg = process.argv[2];
  if (cliArg) {
    const isUrl = cliArg.startsWith("http");
    const env = isUrl
      ? `PRODUCT_URL="${cliArg}"`
      : `SEARCH_TERM="${cliArg}"`;

    console.log(`Running tests for: ${cliArg}\n`);
    execSync(`${env} npx playwright test --reporter=list`, {
      stdio: "inherit",
      cwd: __dirname,
    });
    return;
  }

  // Interactive mode
  console.log("How would you like to specify the product?\n");
  console.log("  1. Paste a woot.com product URL");
  console.log("  2. Search by product name/keyword");
  console.log("  3. Use product.config.json (edit it first)\n");

  const choice = await ask("Choose (1/2/3): ");

  let env = "";

  if (choice === "1") {
    const url = await ask("\nProduct URL: ");
    if (!url.includes("woot.com")) {
      console.log("Warning: URL doesn't contain woot.com — proceeding anyway");
    }
    env = `PRODUCT_URL="${url}"`;
  } else if (choice === "2") {
    const term = await ask("\nSearch term: ");
    env = `SEARCH_TERM="${term}"`;
  } else {
    // Use config file
    if (!fs.existsSync(CONFIG_PATH)) {
      console.log("\nNo product.config.json found. Creating from template...");
      fs.copyFileSync(
        path.join(__dirname, "product.config.example.json"),
        CONFIG_PATH
      );
      console.log("Edit product.config.json and run again.");
      rl.close();
      return;
    }
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    if (!config.product_url && !config.search_term) {
      console.log("\nproduct.config.json has no product_url or search_term set.");
      console.log("Edit the file and try again.");
      rl.close();
      return;
    }
    console.log(`\nUsing config: ${config.product_url || config.search_term}`);
  }

  // Ask which tests to run
  console.log("\nWhich tests do you want to run?\n");
  console.log("  1. All tests (product page, search, add-to-cart, checkout, smoothness)");
  console.log("  2. Complete checkout only (sign in → cart → shipping → payment review)");
  console.log("  3. Quick tests only (product page, search, add-to-cart)\n");

  const scope = await ask("Choose (1/2/3): ");

  let testFilter = "";
  if (scope === "2") {
    testFilter = " tests/04-checkout.spec.js";
  } else if (scope === "3") {
    testFilter = " tests/01-product-page.spec.js tests/02-search-results.spec.js tests/03-add-to-cart.spec.js";
  }

  // Ask about headed mode
  const headed = await ask("\nRun with visible browser? (y/N): ");
  const headedFlag = headed.toLowerCase() === "y" ? " --headed" : "";

  rl.close();

  console.log("\nStarting tests...\n");

  try {
    execSync(`${env} npx playwright test${headedFlag}${testFilter} --reporter=list`, {
      stdio: "inherit",
      cwd: __dirname,
    });
  } catch {
    console.log("\nSome tests failed — check the report above.");
    console.log("Run 'npm run test:report' to see the full HTML report.");
  }
}

main().catch(console.error);
