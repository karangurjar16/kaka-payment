import crypto from "crypto";
import axios from "axios";

function verifySignature(payload) {
  const received = payload.signature;
  if (!received) return false;

  const computed = crypto
    .createHmac("sha256", process.env.PINE_SECRET_KEY)
    .update(
      Object.keys(payload)
        .filter(k => k !== "signature")
        .sort()
        .map(k => `${k}=${payload[k]}`)
        .join("&")
    )
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(received),
    Buffer.from(computed)
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const data = req.body;

    if (!verifySignature(data)) {
      return res.status(400).send("Invalid signature");
    }

    if (data.status === "SUCCESS") {
      const shopplazaApi = axios.create({
        baseURL: `https://${process.env.SHOPPLAZA_STORE_DOMAIN}/admin/api`,
        headers: {
          "X-Shopplaza-Access-Token": process.env.SHOPPLAZA_ACCESS_TOKEN,
          "Content-Type": "application/json"
        }
      });

      // Prevent double payment
      const orderRes = await shopplazaApi.get(
        `/orders/${data.order_id}.json`
      );

      if (orderRes.data.order.financial_status !== "paid") {
        await shopplazaApi.post(
          `/orders/${data.order_id}/transactions.json`,
          {
            transaction: {
              kind: "sale",
              status: "success",
              gateway: "Pine Labs",
              authorization: data.transaction_id,
              amount: data.amount
            }
          }
        );
      }
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("WEBHOOK ERROR:", err);
    res.status(500).send("Webhook failed");
  }
}
