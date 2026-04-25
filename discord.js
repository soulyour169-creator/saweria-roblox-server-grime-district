// api/discord.js — Forward Discord webhook dari Roblox ke Discord
// Menggunakan https module bawaan Node.js (bukan fetch) agar kompatibel semua versi

const https = require("https");

const DISCORD_WEBHOOK = "https://discord.com/api/webhooks/1491659680198692935/ckjpKMqdq8UHqIIBl9p8XjlmfWrVpOei4I9gntHecjV7gfNN4T24CvsdqZFy43tLe20U";

function postJSON(url, data) {
  return new Promise((resolve, reject) => {
    const body    = JSON.stringify(data);
    const parsed  = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   "POST",
      headers:  {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (chunk) => raw += chunk);
      res.on("end", () => resolve({ status: res.statusCode, body: raw }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "Invalid body" });
  }

  try {
    const result = await postJSON(DISCORD_WEBHOOK, body);

    if (result.status < 200 || result.status >= 300) {
      console.error(`[Discord] Error ${result.status}: ${result.body}`);
      return res.status(200).json({ ok: false, status: result.status, error: result.body });
    }

    console.log("[Discord] ✅ Webhook forwarded successfully");
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error("[Discord] Error:", err.message);
    return res.status(200).json({ ok: false, error: err.message });
  }
};
