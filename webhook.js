// api/webhook.js — Upstash Redis + Forward ke Discord
// Terima dari BagiBagi → simpan ke Redis → forward ke Discord

const { kv } = require("@vercel/kv");

// Discord Webhook URL
const DISCORD_WEBHOOK = "https://discord.com/api/webhooks/1491659680198692935/ckjpKMqdq8UHqIIBl9p8XjlmfWrVpOei4I9gntHecjV7gfNN4T24CvsdqZFy43tLe20U";

async function redisCommand(args) {
  const url   = process.env.STORAGE_URL   || process.env.KV_REST_API_URL;
  const token = process.env.STORAGE_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("Missing STORAGE_URL or STORAGE_TOKEN");
  const res = await fetch(`${url}/${args.map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  return data.result;
}

function normalize(raw) {
  let timestamp = Math.floor(Date.now() / 1000);
  if (raw.created_at) {
    const parsed = new Date(raw.created_at);
    if (!isNaN(parsed.getTime())) {
      timestamp = Math.floor(parsed.getTime() / 1000);
    }
  }
  return {
    id:        String(raw.transaction_id || raw.id || `bb_${Date.now()}_${Math.random().toString(36).slice(2)}`),
    name:      String(raw.donator_name || raw.name || raw.fullName || raw.username || "Anonymous").trim(),
    amount:    Number(raw.amount) || 0,
    message:   String(raw.message || raw.note || "").trim(),
    timestamp: timestamp,
  };
}

function formatRupiah(n) {
  return Number(n).toLocaleString("id-ID");
}

async function sendDiscord(donation) {
  if (!DISCORD_WEBHOOK || DISCORD_WEBHOOK === "") return;
  try {
    const fields = [
      { name: "Jumlah", value: "Rp " + formatRupiah(donation.amount), inline: true },
    ];
    if (donation.message && donation.message !== "") {
      fields.push({ name: "Pesan", value: donation.message, inline: false });
    }
    const payload = {
      username: "BagiBagi Bot",
      embeds: [{
        title:       "DONASI BAGIBAGI BARU",
        description: `**${donation.name}** baru saja berdonasi via BagiBagi!`,
        color:       5793266,
        fields:      fields,
        timestamp:   new Date().toISOString(),
        footer:      { text: "BagiBagi Donation System" },
      }],
    };
    const res = await fetch(DISCORD_WEBHOOK, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    if (res.ok) {
      console.log(`[Discord] ✅ Notifikasi terkirim: ${donation.name} Rp${donation.amount}`);
    } else {
      const text = await res.text();
      console.error(`[Discord] ❌ Error ${res.status}: ${text}`);
    }
  } catch (err) {
    console.error("[Discord] Fetch error:", err.message);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Bagibagi-Signature");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    try {
      const count = await redisCommand(["LLEN", "donations"]);
      return res.status(200).json({
        ok:       true,
        status:   "BagiBagi webhook ready (Upstash + Discord)",
        buffered: count || 0,
      });
    } catch {
      return res.status(200).json({ ok: true, status: "BagiBagi webhook ready" });
    }
  }

  if (req.method !== "POST") {
    return res.status(200).json({ ok: true });
  }

  console.log("[Webhook] Headers:", JSON.stringify(req.headers));

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  if (!body || typeof body !== "object") {
    return res.status(200).json({ ok: false, reason: "invalid body" });
  }

  console.log("[Webhook] Payload:", JSON.stringify(body));

  const donation = normalize(body);

  if (donation.amount <= 0) {
    return res.status(200).json({ ok: true, skipped: "amount <= 0" });
  }

  try {
    // Cek duplikat
    const isDup = await redisCommand(["SISMEMBER", "processed_ids", donation.id]);
    if (isDup === 1) {
      console.log(`[Webhook] Duplikat: ${donation.id}`);
      return res.status(200).json({ ok: true, skipped: "duplicate" });
    }

    // Simpan ke Redis
    await redisCommand(["LPUSH", "donations", JSON.stringify(donation)]);
    await redisCommand(["LTRIM", "donations", "0", "499"]);
    await redisCommand(["SADD", "processed_ids", donation.id]);
    await redisCommand(["EXPIRE", "processed_ids", "604800"]);

    console.log(`[Webhook] ✅ ${donation.name} Rp${donation.amount} → Redis`);

    // Forward ke Discord (tidak tunggu, jalan paralel)
    sendDiscord(donation).catch(err => console.error("[Discord] Background error:", err.message));

    return res.status(200).json({ ok: true, received: true });

  } catch (err) {
    console.error("[Webhook] Redis Error:", err.message);
    return res.status(200).json({ ok: true, error: err.message });
  }
};
