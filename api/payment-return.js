export default function handler(req, res) {
  const status = req.query.status;

  if (status === "SUCCESS") {
    return res.redirect(
      `https://${process.env.SHOPPLAZA_STORE_DOMAIN}/checkout/thank_you`
    );
  }

  return res.redirect(
    `https://${process.env.SHOPPLAZA_STORE_DOMAIN}/cart`
  );
}
