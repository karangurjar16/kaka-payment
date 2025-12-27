import axios from "axios";
import CryptoJS from "crypto-js";

/* --------------------------------------------------
   Helpers
-------------------------------------------------- */

function generateChecksum(payload, secret) {
  const data = Object.keys(payload)
    .filter(k => k !== "checksum")
    .sort()
    .map(k => `${k}=${payload[k]}`)
    .join("&");

  return CryptoJS.HmacSHA256(data, secret).toString();
}

function verifyChecksum(payload, secret, checksum) {
  return generateChecksum(payload, secret) === checksum;
}

const shopplazaApi = axios.create({
  baseURL: `${process.env.SHOPPLAZA_STORE_URL}/admin/api`,
  headers: {
    "X-Shopplaza-Access-Token": process.env.SHOPPLAZA_ACCESS_TOKEN,
    "Content-Type": "application/json"
  }
});

/* --------------------------------------------------
   Main Handler (Vercel)
-------------------------------------------------- */

export default async function handler(req, res) {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  try {
    /* --------------------------------------------------
       HEALTH CHECK
    -------------------------------------------------- */
    if (pathname === "/api/health") {
      return res.status(200).json({ status: "OK" });
    }

    /* --------------------------------------------------
       PAYMENT INITIATION
       /api/initiate?order_id=123
    -------------------------------------------------- */
    if (pathname === "/api/initiate") {
      const { order_id } = req.query;
      if (!order_id) return res.status(400).send("Order ID missing");

      const orderRes = await shopplazaApi.get(`/orders/${order_id}.json`);
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

      res.writeHead(302, { Location: redirectUrl });
      return res.end();
    }

    /* --------------------------------------------------
       PINE LABS WEBHOOK
       POST /api/webhook
    -------------------------------------------------- */
    if (pathname === "/api/webhook" && req.method === "POST") {
      const data = req.body;
      const { checksum, order_id, transaction_id, status } = data;

      const isValid = verifyChecksum(
        data,
        process.env.PINELABS_SECRET_KEY,
        checksum
      );

      if (!isValid) {
        return res.status(400).send("Invalid checksum");
      }

      if (status === "SUCCESS") {
        await shopplazaApi.post(
          `/orders/${order_id}/transactions.json`,
          {
            transaction: {
              kind: "sale",
              status: "success",
              gateway: "Pine Labs",
              authorization: transaction_id
            }
          }
        );
      }

      return res.status(200).send("OK");
    }

    /* --------------------------------------------------
       CUSTOMER RETURN
       /api/return?order_id=123&status=SUCCESS
    -------------------------------------------------- */
    if (pathname === "/api/return") {
      const { order_id, status } = req.query;

      if (status === "SUCCESS") {
        return res.redirect(
          `${process.env.SHOPPLAZA_STORE_URL}/checkout/thank_you?order_id=${order_id}`
        );
      }

      return res.redirect(
        `${process.env.SHOPPLAZA_STORE_URL}/checkout/payment_failed`
      );
    }

    /* --------------------------------------------------
       NOT FOUND
    -------------------------------------------------- */
    res.status(404).send("Route not found");
  } catch (error) {
    console.error(error);
    res.status(500).send("Server error");
  }
}
