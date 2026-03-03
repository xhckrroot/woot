(function () {
  "use strict";

  // ── State ───────────────────────────────────────────────────────────
  const state = {
    products: [],
    cart: {},          // { productId: quantity }
    validatedCart: null,
    shipping: null,
    payment: null,
    currentStep: 1,
  };

  // ── DOM helpers ─────────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function showStep(step) {
    const panels = ["step-products", "step-cart", "step-shipping", "step-payment", "step-confirm", "step-success"];
    panels.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.remove("active");
    });

    const target = panels[step - 1];
    if (target) document.getElementById(target).classList.add("active");

    // Update progress bar
    $$(".progress-bar .step").forEach((el) => {
      const s = parseInt(el.dataset.step);
      el.classList.remove("active", "completed");
      if (s === step) el.classList.add("active");
      else if (s < step) el.classList.add("completed");
    });

    state.currentStep = step;

    // Hide progress bar on success
    const progressBar = $("#progress-bar");
    if (step === 6) {
      progressBar.style.display = "none";
    } else {
      progressBar.style.display = "flex";
    }
  }

  function getCartCount() {
    return Object.values(state.cart).reduce((sum, qty) => sum + qty, 0);
  }

  function updateCartBadge() {
    $("#cart-count").textContent = getCartCount();
    $("#btn-go-cart").disabled = getCartCount() === 0;
  }

  // ── API calls ───────────────────────────────────────────────────────
  async function fetchProducts() {
    const res = await fetch("/api/products");
    return res.json();
  }

  async function validateCart() {
    const items = Object.entries(state.cart)
      .filter(([, qty]) => qty > 0)
      .map(([productId, quantity]) => ({ productId: parseInt(productId), quantity }));

    const res = await fetch("/api/cart/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    return res.json();
  }

  async function submitShipping(data) {
    const res = await fetch("/api/checkout/shipping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return { ok: res.ok, data: await res.json() };
  }

  async function submitPayment(data) {
    const res = await fetch("/api/checkout/payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return { ok: res.ok, data: await res.json() };
  }

  async function placeOrder(cart, shipping, payment) {
    const res = await fetch("/api/checkout/place-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cart, shipping, payment }),
    });
    return { ok: res.ok, data: await res.json() };
  }

  // ── Renderers ───────────────────────────────────────────────────────
  function renderProducts() {
    const grid = $("#products-grid");
    grid.innerHTML = state.products
      .map(
        (p) => `
      <div class="product-card" data-id="${p.id}">
        <div class="product-emoji">${p.image}</div>
        <div class="product-name">${p.name}</div>
        <div class="product-price">$${p.price.toFixed(2)}</div>
        <div class="product-stock">${p.stock} in stock</div>
        <div class="qty-controls">
          <button class="qty-btn" data-action="dec" data-id="${p.id}">-</button>
          <span class="qty-value" id="qty-${p.id}">${state.cart[p.id] || 0}</span>
          <button class="qty-btn" data-action="inc" data-id="${p.id}">+</button>
        </div>
      </div>
    `
      )
      .join("");
  }

  function renderCart(cartData) {
    const container = $("#cart-items");
    container.innerHTML = cartData.items
      .map((item) => {
        const product = state.products.find((p) => p.id === item.productId);
        return `
        <div class="cart-item">
          <div class="cart-item-info">
            <span class="cart-item-emoji">${product ? product.image : ""}</span>
            <div>
              <div class="cart-item-name">${item.name}</div>
              <div class="cart-item-qty">Qty: ${item.quantity} x $${item.price.toFixed(2)}</div>
            </div>
          </div>
          <div class="cart-item-price">$${item.subtotal.toFixed(2)}</div>
        </div>
      `;
      })
      .join("");

    const summary = $("#cart-summary");
    summary.innerHTML = `
      <div class="summary-line"><span>Subtotal</span><span>$${cartData.subtotal.toFixed(2)}</span></div>
      <div class="summary-line ${cartData.shipping === 0 ? "free-shipping" : ""}">
        <span>Shipping</span>
        <span>${cartData.shipping === 0 ? "FREE" : "$" + cartData.shipping.toFixed(2)}</span>
      </div>
      <div class="summary-line"><span>Tax (8%)</span><span>$${cartData.tax.toFixed(2)}</span></div>
      <div class="summary-line total"><span>Total</span><span>$${cartData.total.toFixed(2)}</span></div>
    `;
  }

  function renderConfirmation() {
    const cart = state.validatedCart;

    // Items
    $("#confirm-items").innerHTML = cart.items
      .map(
        (i) => `<div class="confirm-detail">${i.quantity}x ${i.name} — $${i.subtotal.toFixed(2)}</div>`
      )
      .join("");

    // Shipping
    const s = state.shipping;
    $("#confirm-shipping").innerHTML = `
      <div class="confirm-detail">${s.fullName}</div>
      <div class="confirm-detail">${s.address}</div>
      <div class="confirm-detail">${s.city}, ${s.state} ${s.zip}</div>
      <div class="confirm-detail">${s.email}</div>
    `;

    // Payment
    $("#confirm-payment").innerHTML = `
      <div class="confirm-detail">Card ending in ${state.payment.last4}</div>
    `;

    // Totals
    $("#confirm-totals").innerHTML = `
      <div class="summary-line"><span>Subtotal</span><span>$${cart.subtotal.toFixed(2)}</span></div>
      <div class="summary-line"><span>Shipping</span><span>${cart.shipping === 0 ? "FREE" : "$" + cart.shipping.toFixed(2)}</span></div>
      <div class="summary-line"><span>Tax</span><span>$${cart.tax.toFixed(2)}</span></div>
      <div class="summary-line total"><span>Total</span><span>$${cart.total.toFixed(2)}</span></div>
    `;
  }

  function showErrors(containerId, errors) {
    const el = document.getElementById(containerId);
    if (!errors || errors.length === 0) {
      el.innerHTML = "";
      return;
    }
    el.innerHTML = `<ul>${errors.map((e) => `<li>${e}</li>`).join("")}</ul>`;
  }

  // ── Event handlers ──────────────────────────────────────────────────
  function handleQtyClick(e) {
    const btn = e.target.closest(".qty-btn");
    if (!btn) return;

    const id = parseInt(btn.dataset.id);
    const action = btn.dataset.action;
    const product = state.products.find((p) => p.id === id);
    if (!product) return;

    const current = state.cart[id] || 0;
    if (action === "inc" && current < product.stock) {
      state.cart[id] = current + 1;
    } else if (action === "dec" && current > 0) {
      state.cart[id] = current - 1;
      if (state.cart[id] === 0) delete state.cart[id];
    }

    document.getElementById(`qty-${id}`).textContent = state.cart[id] || 0;
    updateCartBadge();
  }

  async function handleGoCart() {
    const data = await validateCart();
    state.validatedCart = data;
    renderCart(data);
    showStep(2);
  }

  async function handleShippingSubmit(e) {
    e.preventDefault();
    const formData = {
      fullName: $("#fullName").value,
      email: $("#email").value,
      address: $("#address").value,
      city: $("#city").value,
      state: $("#state").value,
      zip: $("#zip").value,
    };

    const result = await submitShipping(formData);
    if (!result.ok) {
      showErrors("shipping-errors", result.data.errors);
      return;
    }

    showErrors("shipping-errors", []);
    state.shipping = result.data.shipping;
    showStep(4);
  }

  async function handlePaymentSubmit(e) {
    e.preventDefault();
    const formData = {
      nameOnCard: $("#nameOnCard").value,
      cardNumber: $("#cardNumber").value,
      expiry: $("#expiry").value,
      cvv: $("#cvv").value,
    };

    const result = await submitPayment(formData);
    if (!result.ok) {
      showErrors("payment-errors", result.data.errors);
      return;
    }

    showErrors("payment-errors", []);
    state.payment = result.data;
    renderConfirmation();
    showStep(5);
  }

  async function handlePlaceOrder() {
    const btn = $("#btn-place-order");
    btn.disabled = true;
    btn.textContent = "Processing...";

    const result = await placeOrder(state.validatedCart, state.shipping, state.payment);
    if (!result.ok) {
      showErrors("order-errors", [result.data.error || "Something went wrong"]);
      btn.disabled = false;
      btn.textContent = "Place Order";
      return;
    }

    $("#success-order-id").textContent = `Order ID: ${result.data.order.orderId}`;
    $("#success-email").textContent = state.shipping.email;
    showStep(6);
  }

  function handleNewOrder() {
    state.cart = {};
    state.validatedCart = null;
    state.shipping = null;
    state.payment = null;
    renderProducts();
    updateCartBadge();
    showStep(1);

    // Clear forms
    $("#shipping-form").reset();
    $("#payment-form").reset();
    showErrors("shipping-errors", []);
    showErrors("payment-errors", []);
    showErrors("order-errors", []);
  }

  // Card number formatting
  function handleCardNumberInput(e) {
    let value = e.target.value.replace(/\D/g, "");
    value = value.replace(/(\d{4})(?=\d)/g, "$1 ");
    e.target.value = value;
  }

  // Expiry formatting
  function handleExpiryInput(e) {
    let value = e.target.value.replace(/\D/g, "");
    if (value.length >= 2) {
      value = value.slice(0, 2) + "/" + value.slice(2, 4);
    }
    e.target.value = value;
  }

  // ── Init ────────────────────────────────────────────────────────────
  async function init() {
    state.products = await fetchProducts();
    renderProducts();
    updateCartBadge();
    showStep(1);

    // Product quantity controls
    $("#products-grid").addEventListener("click", handleQtyClick);

    // Navigation buttons
    $("#btn-go-cart").addEventListener("click", handleGoCart);
    $("#cart-icon").addEventListener("click", () => {
      if (getCartCount() > 0) handleGoCart();
    });
    $("#btn-back-products").addEventListener("click", () => showStep(1));
    $("#btn-go-shipping").addEventListener("click", () => showStep(3));
    $("#btn-back-cart").addEventListener("click", () => showStep(2));
    $("#btn-back-shipping").addEventListener("click", () => showStep(3));
    $("#btn-back-payment").addEventListener("click", () => showStep(4));

    // Forms
    $("#shipping-form").addEventListener("submit", handleShippingSubmit);
    $("#payment-form").addEventListener("submit", handlePaymentSubmit);

    // Place order
    $("#btn-place-order").addEventListener("click", handlePlaceOrder);
    $("#btn-new-order").addEventListener("click", handleNewOrder);

    // Input formatting
    $("#cardNumber").addEventListener("input", handleCardNumberInput);
    $("#expiry").addEventListener("input", handleExpiryInput);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
