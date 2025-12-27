const express = require("express");
const serverless = require("serverless-http");
const crypto = require("crypto");
const axios = require("axios");

const app = express();

/* -------------------- MIDDLEWARE -------------------- */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* -------------------- SIGNATURE UTILS -------------------- */
function generateSignature(payload) {
  const data = Object.keys(payload)
    .filter(k => k !== "signature")
    .sort()
    .map(k => `${k}=${payload[k]}`)
    .join("&");

  return crypto
    .createHmac("sha256", process.env.PINE_SECRET_KEY)
    .update(data)
    .digest("hex");
}

function verifySignature(payload) {
  if (!payload.signature) return false;

  const expected = generateSignature(payload);
  return crypto.timingSafeEqual(
    Buffer.from(payload.signature),
    Buffer.from(expected)
  );
}

/* -------------------- SHOPPLAZA CLIENT -------------------- */
const shopplaza = axios.create({
  baseURL: `https://${process.env.SHOPPLAZA_STORE_DOMAIN}/admin/api`,
  headers: {
    "X-Shopplaza-Access-Token": process.env.SHOPPLAZA_ACCESS_TOKEN,
    "Content-Type": "application/json"
  }
});

async function markOrderPaid(orderId, transactionId, amount) {
  const orderRes = await shopplaza.get(`/orders/${orderId}.json`);
  const order = orderRes.data.order;

  if (order.financial_status === "paid") return;

  await shopplaza.post(`/orders/${orderId}/transactions.json`, {
    transaction: {
      kind: "sale",
      status: "success",
      gateway: "Pine Labs",
      authorization: transactionId,
      amount
    }
  });
}

/* -------------------- ROUTES -------------------- */

/** Health check */
app.get("/", (_, res) => {
  res.json({ status: "OK" });
});

/** Payment initiation (Shopplaza → Backend) */
app.post("/payment/initiate", async (req, res) => {
  try {
    const order = req.body;

    const payload = {
      merchant_id: process.env.PINE_MERCHANT_ID,
      order_id: order.id,
      amount: order.total_price,
      currency: "INR",
      customer_email: order.customer?.email || "",
      customer_mobile: order.customer?.phone || "",
      return_url: `${process.env.BASE_URL}/payment/return`,
      notify_url: `${process.env.BASE_URL}/payment/webhook`
    };

    payload.signature = generateSignature(payload);

    const redirectUrl =
      process.env.PINE_PAYMENT_URL +
      "?" +
      new URLSearchParams(payload).toString();

    res.redirect(302, redirectUrl);
  } catch (err) {
    console.error("INITIATE ERROR:", err);
    res.status(500).send("Payment initiation failed");
  }
});

/** Return URL (browser redirect only — NO payment logic) */
app.all("/payment/return", (req, res) => {
  const status = req.query.status || req.body?.status;

  if (status === "SUCCESS") {
    return res.redirect(
      `https://${process.env.SHOPPLAZA_STORE_DOMAIN}/checkout/thank_you`
    );
  }

  return res.redirect(
    `https://${process.env.SHOPPLAZA_STORE_DOMAIN}/cart`
  );
});

/** Webhook (ONLY place where order is marked PAID) */
app.post("/payment/webhook", async (req, res) => {
  try {
    if (!verifySignature(req.body)) {
      return res.status(400).send("Invalid signature");
    }

    const { order_id, transaction_id, status, amount } = req.body;

    if (status === "SUCCESS") {
      await markOrderPaid(order_id, transaction_id, amount);
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("WEBHOOK ERROR:", err);
    res.status(500).send("Webhook failed");
  }
});

/* -------------------- EXPORT FOR VERCEL -------------------- */
module.exports = serverless(app);
