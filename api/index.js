export default function handler(req, res) {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  if (pathname === "/api/health") {
    return res.status(200).json({ status: "OK" });
  }

  return res.status(404).json({ error: "Route not found" });
}
