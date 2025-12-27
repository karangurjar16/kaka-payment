import axios from "axios";
import CryptoJS from "crypto-js";

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function generateChecksum(payload, secret) {
  const data = Object.keys(payload)
    .filter(k => k !== "checksum")
    .sort()
    .map(k => `${k}=${payload[k]}`)
    .join("&");

  return CryptoJS.HmacSHA256(data, secret).toString();
}

export default async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname.replace("/api", "") || "/";

  /* ---------------- HEALTH ---------------- */
  if (path === "/health") {
    return json(res, 200, { status: "OK" });
  }

  /* ---------------- INITIATE ---------------- */
  if (path === "/initiate" && req.method === "GET") {
    const order_id = url.searchParams.get("order_id");
    if (!order_id) return json(res, 400, { error: "order_id required" });

    const shopplaza = axios.create({
      baseURL: `${process.env.SHOPPLAZA_STORE_URL}/admin/api`,
      headers: {
        "X-Shopplaza-Access-Token": process.env.SHOPPLAZA_ACCESS_TOKEN
      }
    });

    const orderRes = await shopplaza.get(`/orders/${order_id}.json`);
    const order = orderRes.data.order;

    const payload = {
      merchant_id: process.env.PINELABS_MERCHANT_ID,
      order_id: order.id,
      amount: order.total_price,
      currency: "INR",
      customer_email: order.email,
      return_url: `${process.env.BASE_URL}/api/return`,
      notify_url: `${process.env.BASE_URL}/api/webhook`
    };

    payload.checksum = generateChecksum(
      payload,
      process.env.PINELABS_SECRET_KEY
    );

    const redirectUrl =
      process.env.PINELABS_PAYMENT_URL +
      "?" +
      new URLSearchParams(payload).toString();

    res.statusCode = 302;
    res.setHeader("Location", redirectUrl);
    return res.end();
  }

  /* ---------------- WEBHOOK ---------------- */
  if (path === "/webhook" && req.method === "POST") {
    const body = req.body;
    const valid =
      generateChecksum(body, process.env.PINELABS_SECRET_KEY) === body.checksum;

    if (!valid) return json(res, 400, { error: "invalid checksum" });

    if (body.status === "SUCCESS") {
      await axios.post(
        `${process.env.SHOPPLAZA_STORE_URL}/admin/api/orders/${body.order_id}/transactions.json`,
        {
          transaction: {
            kind: "sale",
            status: "success",
            gateway: "Pine Labs",
            authorization: body.transaction_id
          }
        },
        {
          headers: {
            "X-Shopplaza-Access-Token":
              process.env.SHOPPLAZA_ACCESS_TOKEN
          }
        }
      );
    }

    return json(res, 200, { ok: true });
  }

  /* ---------------- RETURN ---------------- */
  if (path === "/return") {
    const order_id = url.searchParams.get("order_id");
    const status = url.searchParams.get("status");

    const redirect =
      status === "SUCCESS"
        ? `${process.env.SHOPPLAZA_STORE_URL}/checkout/thank_you?order_id=${order_id}`
        : `${process.env.SHOPPLAZA_STORE_URL}/checkout/payment_failed`;

    res.statusCode = 302;
    res.setHeader("Location", redirect);
    return res.end();
  }

  /* ---------------- NOT FOUND ---------------- */
  json(res, 404, { error: "Route not found" });
}
