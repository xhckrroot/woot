const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Mock product catalog
const products = [
  { id: 1, name: "Wireless Bluetooth Speaker", price: 29.99, image: "🔊", stock: 15 },
  { id: 2, name: "USB-C Hub Adapter", price: 24.99, image: "🔌", stock: 30 },
  { id: 3, name: "LED Desk Lamp", price: 19.99, image: "💡", stock: 22 },
  { id: 4, name: "Portable Phone Charger", price: 14.99, image: "🔋", stock: 50 },
];

// In-memory store for orders
const orders = [];

// GET /api/products
app.get("/api/products", (req, res) => {
  res.json(products);
});

// GET /api/products/:id
app.get("/api/products/:id", (req, res) => {
  const product = products.find((p) => p.id === parseInt(req.params.id));
  if (!product) return res.status(404).json({ error: "Product not found" });
  res.json(product);
});

// POST /api/cart/validate
app.post("/api/cart/validate", (req, res) => {
  const { items } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Cart is empty" });
  }

  const errors = [];
  const validatedItems = [];

  for (const item of items) {
    const product = products.find((p) => p.id === item.productId);
    if (!product) {
      errors.push(`Product ${item.productId} not found`);
      continue;
    }
    if (item.quantity < 1) {
      errors.push(`Invalid quantity for ${product.name}`);
      continue;
    }
    if (item.quantity > product.stock) {
      errors.push(`Only ${product.stock} of ${product.name} available`);
      continue;
    }
    validatedItems.push({
      productId: product.id,
      name: product.name,
      price: product.price,
      quantity: item.quantity,
      subtotal: +(product.price * item.quantity).toFixed(2),
    });
  }

  const subtotal = validatedItems.reduce((sum, i) => sum + i.subtotal, 0);
  const shipping = subtotal >= 35 ? 0 : 5.99;
  const tax = +(subtotal * 0.08).toFixed(2);
  const total = +(subtotal + shipping + tax).toFixed(2);

  res.json({
    items: validatedItems,
    subtotal: +subtotal.toFixed(2),
    shipping,
    tax,
    total,
    errors,
  });
});

// POST /api/checkout/shipping - Validate shipping info
app.post("/api/checkout/shipping", (req, res) => {
  const { fullName, address, city, state, zip, email } = req.body;
  const errors = [];

  if (!fullName || fullName.trim().length < 2) errors.push("Full name is required");
  if (!address || address.trim().length < 5) errors.push("Valid address is required");
  if (!city || city.trim().length < 2) errors.push("City is required");
  if (!state || state.trim().length < 2) errors.push("State is required");
  if (!zip || !/^\d{5}(-\d{4})?$/.test(zip)) errors.push("Valid ZIP code is required");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Valid email is required");

  if (errors.length > 0) {
    return res.status(400).json({ valid: false, errors });
  }

  res.json({ valid: true, shipping: { fullName, address, city, state, zip, email } });
});

// POST /api/checkout/payment - Validate payment info
app.post("/api/checkout/payment", (req, res) => {
  const { cardNumber, expiry, cvv, nameOnCard } = req.body;
  const errors = [];

  const cleanCard = (cardNumber || "").replace(/\s/g, "");
  if (!/^\d{16}$/.test(cleanCard)) errors.push("Valid 16-digit card number is required");
  if (!expiry || !/^(0[1-9]|1[0-2])\/\d{2}$/.test(expiry)) errors.push("Valid expiry (MM/YY) is required");
  if (!cvv || !/^\d{3,4}$/.test(cvv)) errors.push("Valid CVV is required");
  if (!nameOnCard || nameOnCard.trim().length < 2) errors.push("Name on card is required");

  if (errors.length > 0) {
    return res.status(400).json({ valid: false, errors });
  }

  res.json({ valid: true, last4: cleanCard.slice(-4) });
});

// POST /api/checkout/place-order
app.post("/api/checkout/place-order", (req, res) => {
  const { cart, shipping, payment } = req.body;

  if (!cart || !cart.items || cart.items.length === 0) {
    return res.status(400).json({ error: "Cart is empty" });
  }
  if (!shipping || !shipping.fullName) {
    return res.status(400).json({ error: "Shipping information is required" });
  }
  if (!payment || !payment.last4) {
    return res.status(400).json({ error: "Payment information is required" });
  }

  const order = {
    orderId: `WOOT-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    items: cart.items,
    subtotal: cart.subtotal,
    shipping: cart.shipping,
    tax: cart.tax,
    total: cart.total,
    shippingAddress: shipping,
    paymentLast4: payment.last4,
    status: "confirmed",
    createdAt: new Date().toISOString(),
  };

  orders.push(order);

  // Decrease stock
  for (const item of cart.items) {
    const product = products.find((p) => p.id === item.productId);
    if (product) product.stock -= item.quantity;
  }

  res.json({ success: true, order });
});

// GET /api/orders/:id
app.get("/api/orders/:id", (req, res) => {
  const order = orders.find((o) => o.orderId === req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json(order);
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Woot checkout server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
