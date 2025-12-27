import crypto from "crypto";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const order = req.body;

    const payload = {
      merchant_id: process.env.PINE_MERCHANT_ID,
      order_id: order.id,
      amount: order.total_price,
      currency: "INR",
      customer_email: order.customer?.email || "",
      customer_mobile: order.customer?.phone || "",
      return_url: `${process.env.BASE_URL}/api/payment-return`,
      notify_url: `${process.env.BASE_URL}/api/payment-webhook`
    };

    const signature = crypto
      .createHmac("sha256", process.env.PINE_SECRET_KEY)
      .update(
        Object.keys(payload)
          .sort()
          .map(k => `${k}=${payload[k]}`)
          .join("&")
      )
      .digest("hex");

    payload.signature = signature;

    const redirectUrl =
      process.env.PINE_PAYMENT_URL +
      "?" +
      new URLSearchParams(payload).toString();

    res.writeHead(302, { Location: redirectUrl });
    res.end();
  } catch (err) {
    console.error("INITIATE ERROR:", err);
    res.status(500).send("Payment initiation failed");
  }
}
