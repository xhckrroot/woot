const http = require("http");
const app = require("../server");

let server;
let baseUrl;

beforeAll((done) => {
  server = app.listen(0, () => {
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;
    done();
  });
});

afterAll((done) => {
  server.close(done);
});

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: { "Content-Type": "application/json" },
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        resolve({ status: res.statusCode, body: JSON.parse(data) });
      });
    });

    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────
// Product Catalog
// ─────────────────────────────────────────────────────────────────────
describe("Product Catalog", () => {
  test("GET /api/products returns all products", async () => {
    const res = await request("GET", "/api/products");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(4);
    expect(res.body[0]).toHaveProperty("id");
    expect(res.body[0]).toHaveProperty("name");
    expect(res.body[0]).toHaveProperty("price");
    expect(res.body[0]).toHaveProperty("stock");
  });

  test("GET /api/products/:id returns a single product", async () => {
    const res = await request("GET", "/api/products/1");
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Wireless Bluetooth Speaker");
    expect(res.body.price).toBe(29.99);
  });

  test("GET /api/products/:id returns 404 for unknown product", async () => {
    const res = await request("GET", "/api/products/999");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Product not found");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Cart Validation
// ─────────────────────────────────────────────────────────────────────
describe("Cart Validation", () => {
  test("validates a valid cart", async () => {
    const res = await request("POST", "/api/cart/validate", {
      items: [
        { productId: 1, quantity: 2 },
        { productId: 3, quantity: 1 },
      ],
    });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].subtotal).toBe(59.98);
    expect(res.body.items[1].subtotal).toBe(19.99);
    expect(res.body.subtotal).toBeCloseTo(79.97, 2);
    expect(res.body.shipping).toBe(0); // over $35, free shipping
    expect(res.body.tax).toBeCloseTo(79.97 * 0.08, 2);
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.errors).toHaveLength(0);
  });

  test("rejects empty cart", async () => {
    const res = await request("POST", "/api/cart/validate", { items: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Cart is empty");
  });

  test("rejects missing items", async () => {
    const res = await request("POST", "/api/cart/validate", {});
    expect(res.status).toBe(400);
  });

  test("reports errors for invalid product IDs", async () => {
    const res = await request("POST", "/api/cart/validate", {
      items: [{ productId: 999, quantity: 1 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.errors.length).toBeGreaterThan(0);
    expect(res.body.items).toHaveLength(0);
  });

  test("charges shipping under $35", async () => {
    const res = await request("POST", "/api/cart/validate", {
      items: [{ productId: 4, quantity: 1 }], // $14.99
    });
    expect(res.status).toBe(200);
    expect(res.body.shipping).toBe(5.99);
  });

  test("free shipping at $35+", async () => {
    const res = await request("POST", "/api/cart/validate", {
      items: [{ productId: 1, quantity: 2 }], // $59.98
    });
    expect(res.status).toBe(200);
    expect(res.body.shipping).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Shipping Validation
// ─────────────────────────────────────────────────────────────────────
describe("Shipping Validation", () => {
  const validShipping = {
    fullName: "John Doe",
    address: "123 Main St",
    city: "Springfield",
    state: "IL",
    zip: "62704",
    email: "john@example.com",
  };

  test("accepts valid shipping info", async () => {
    const res = await request("POST", "/api/checkout/shipping", validShipping);
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.shipping.fullName).toBe("John Doe");
  });

  test("rejects missing full name", async () => {
    const res = await request("POST", "/api/checkout/shipping", {
      ...validShipping,
      fullName: "",
    });
    expect(res.status).toBe(400);
    expect(res.body.valid).toBe(false);
    expect(res.body.errors).toContain("Full name is required");
  });

  test("rejects invalid email", async () => {
    const res = await request("POST", "/api/checkout/shipping", {
      ...validShipping,
      email: "not-an-email",
    });
    expect(res.status).toBe(400);
    expect(res.body.errors).toContain("Valid email is required");
  });

  test("rejects invalid ZIP code", async () => {
    const res = await request("POST", "/api/checkout/shipping", {
      ...validShipping,
      zip: "abc",
    });
    expect(res.status).toBe(400);
    expect(res.body.errors).toContain("Valid ZIP code is required");
  });

  test("accepts ZIP+4 format", async () => {
    const res = await request("POST", "/api/checkout/shipping", {
      ...validShipping,
      zip: "62704-1234",
    });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
  });

  test("rejects short address", async () => {
    const res = await request("POST", "/api/checkout/shipping", {
      ...validShipping,
      address: "Hi",
    });
    expect(res.status).toBe(400);
    expect(res.body.errors).toContain("Valid address is required");
  });

  test("returns all errors at once", async () => {
    const res = await request("POST", "/api/checkout/shipping", {});
    expect(res.status).toBe(400);
    expect(res.body.errors.length).toBeGreaterThanOrEqual(5);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Payment Validation
// ─────────────────────────────────────────────────────────────────────
describe("Payment Validation", () => {
  const validPayment = {
    nameOnCard: "John Doe",
    cardNumber: "4111111111111111",
    expiry: "12/28",
    cvv: "123",
  };

  test("accepts valid payment info", async () => {
    const res = await request("POST", "/api/checkout/payment", validPayment);
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.last4).toBe("1111");
  });

  test("accepts card number with spaces", async () => {
    const res = await request("POST", "/api/checkout/payment", {
      ...validPayment,
      cardNumber: "4111 1111 1111 1111",
    });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
  });

  test("rejects short card number", async () => {
    const res = await request("POST", "/api/checkout/payment", {
      ...validPayment,
      cardNumber: "41111111",
    });
    expect(res.status).toBe(400);
    expect(res.body.errors).toContain("Valid 16-digit card number is required");
  });

  test("rejects invalid expiry", async () => {
    const res = await request("POST", "/api/checkout/payment", {
      ...validPayment,
      expiry: "13/99",
    });
    expect(res.status).toBe(400);
    expect(res.body.errors).toContain("Valid expiry (MM/YY) is required");
  });

  test("rejects short CVV", async () => {
    const res = await request("POST", "/api/checkout/payment", {
      ...validPayment,
      cvv: "12",
    });
    expect(res.status).toBe(400);
    expect(res.body.errors).toContain("Valid CVV is required");
  });

  test("accepts 4-digit CVV (Amex)", async () => {
    const res = await request("POST", "/api/checkout/payment", {
      ...validPayment,
      cvv: "1234",
    });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Full Checkout Flow (End-to-End)
// ─────────────────────────────────────────────────────────────────────
describe("Full Checkout Flow", () => {
  test("complete checkout flow: browse → cart → ship → pay → order", async () => {
    // Step 1: Browse products
    const products = await request("GET", "/api/products");
    expect(products.status).toBe(200);
    expect(products.body.length).toBeGreaterThan(0);

    // Step 2: Add items to cart and validate
    const cart = await request("POST", "/api/cart/validate", {
      items: [
        { productId: 1, quantity: 1 }, // Bluetooth Speaker $29.99
        { productId: 2, quantity: 1 }, // USB-C Hub $24.99
      ],
    });
    expect(cart.status).toBe(200);
    expect(cart.body.items).toHaveLength(2);
    expect(cart.body.subtotal).toBeCloseTo(54.98, 2);
    expect(cart.body.shipping).toBe(0); // free shipping over $35

    // Step 3: Submit shipping information
    const shipping = await request("POST", "/api/checkout/shipping", {
      fullName: "Jane Smith",
      address: "456 Oak Avenue",
      city: "Chicago",
      state: "IL",
      zip: "60601",
      email: "jane@example.com",
    });
    expect(shipping.status).toBe(200);
    expect(shipping.body.valid).toBe(true);

    // Step 4: Submit payment information
    const payment = await request("POST", "/api/checkout/payment", {
      nameOnCard: "Jane Smith",
      cardNumber: "4242424242424242",
      expiry: "06/27",
      cvv: "456",
    });
    expect(payment.status).toBe(200);
    expect(payment.body.valid).toBe(true);
    expect(payment.body.last4).toBe("4242");

    // Step 5: Place order
    const order = await request("POST", "/api/checkout/place-order", {
      cart: cart.body,
      shipping: shipping.body.shipping,
      payment: { last4: payment.body.last4 },
    });
    expect(order.status).toBe(200);
    expect(order.body.success).toBe(true);
    expect(order.body.order.orderId).toMatch(/^WOOT-/);
    expect(order.body.order.status).toBe("confirmed");
    expect(order.body.order.total).toBe(cart.body.total);

    // Verify order can be retrieved
    const fetched = await request("GET", `/api/orders/${order.body.order.orderId}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.orderId).toBe(order.body.order.orderId);
  });

  test("rejects order with empty cart", async () => {
    const res = await request("POST", "/api/checkout/place-order", {
      cart: { items: [] },
      shipping: { fullName: "Test" },
      payment: { last4: "1234" },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Cart is empty");
  });

  test("rejects order without shipping", async () => {
    const res = await request("POST", "/api/checkout/place-order", {
      cart: { items: [{ productId: 1 }] },
      shipping: {},
      payment: { last4: "1234" },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Shipping information is required");
  });

  test("rejects order without payment", async () => {
    const res = await request("POST", "/api/checkout/place-order", {
      cart: { items: [{ productId: 1 }] },
      shipping: { fullName: "Test" },
      payment: {},
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Payment information is required");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Checkout Flow Smoothness Tests
// ─────────────────────────────────────────────────────────────────────
describe("Checkout Flow Smoothness", () => {
  test("all API responses are under 200ms", async () => {
    const endpoints = [
      () => request("GET", "/api/products"),
      () => request("GET", "/api/products/1"),
      () =>
        request("POST", "/api/cart/validate", {
          items: [{ productId: 1, quantity: 1 }],
        }),
      () =>
        request("POST", "/api/checkout/shipping", {
          fullName: "Test User",
          address: "123 Test St",
          city: "TestCity",
          state: "TS",
          zip: "12345",
          email: "test@test.com",
        }),
      () =>
        request("POST", "/api/checkout/payment", {
          nameOnCard: "Test User",
          cardNumber: "4111111111111111",
          expiry: "12/28",
          cvv: "123",
        }),
    ];

    for (const fn of endpoints) {
      const start = Date.now();
      await fn();
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(200);
    }
  });

  test("cart validation handles multiple items efficiently", async () => {
    const start = Date.now();
    await request("POST", "/api/cart/validate", {
      items: [
        { productId: 1, quantity: 2 },
        { productId: 2, quantity: 3 },
        { productId: 3, quantity: 1 },
        { productId: 4, quantity: 4 },
      ],
    });
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(100);
  });

  test("validation errors are descriptive and actionable", async () => {
    // Shipping errors
    const shippingRes = await request("POST", "/api/checkout/shipping", {
      fullName: "",
      address: "",
      city: "",
      state: "",
      zip: "bad",
      email: "bad",
    });
    expect(shippingRes.body.errors.length).toBe(6);
    for (const err of shippingRes.body.errors) {
      expect(err.length).toBeGreaterThan(10); // descriptive messages
    }

    // Payment errors
    const paymentRes = await request("POST", "/api/checkout/payment", {
      nameOnCard: "",
      cardNumber: "123",
      expiry: "99/99",
      cvv: "1",
    });
    expect(paymentRes.body.errors.length).toBe(4);
    for (const err of paymentRes.body.errors) {
      expect(err.length).toBeGreaterThan(10);
    }
  });

  test("order totals are calculated correctly", async () => {
    const res = await request("POST", "/api/cart/validate", {
      items: [
        { productId: 1, quantity: 1 }, // 29.99
        { productId: 4, quantity: 1 }, // 14.99
      ],
    });

    const expectedSubtotal = 44.98;
    const expectedShipping = 0; // over $35
    const expectedTax = +(expectedSubtotal * 0.08).toFixed(2);
    const expectedTotal = +(expectedSubtotal + expectedShipping + expectedTax).toFixed(2);

    expect(res.body.subtotal).toBeCloseTo(expectedSubtotal, 2);
    expect(res.body.shipping).toBe(expectedShipping);
    expect(res.body.tax).toBeCloseTo(expectedTax, 2);
    expect(res.body.total).toBeCloseTo(expectedTotal, 2);
  });
});
