// =============================================
// SAWERIA ROBLOX SERVER - Vercel + tmp storage
// =============================================

const express = require("express");
const fs = require("fs");
const path = require("path");
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Simpan di /tmp agar tidak hilang antar request
const DATA_FILE = "/tmp/donations.json";

// =============================================
// HELPER: Load data dari file
// =============================================
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf8");
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error("[LOAD ERROR]", e.message);
  }
  return { donations: [], processedIds: [] };
}

// =============================================
// HELPER: Save data ke file
// =============================================
function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data), "utf8");
  } catch (e) {
    console.error("[SAVE ERROR]", e.message);
  }
}

// =============================================
// HELPER: Generate ID unik
// =============================================
function generateId() {
  return Date.now().toString() + "_" + Math.random().toString(36).substr(2, 9);
}

// =============================================
// ROOT - cek server hidup
// =============================================
app.get("/", (req, res) => {
  const data = loadData();
  res.json({
    status: "OK",
    message: "Saweria Roblox Server is RUNNING!",
    total_donations: data.donations.length,
    platform: "Vercel",
  });
});

// =============================================
// GET /api/donations - Roblox polling ke sini
// =============================================
app.get("/api/donations", (req, res) => {
  const since = parseInt(req.query.since) || 0;
  const data = loadData();

  const newDonations = since === 0
    ? data.donations
    : data.donations.filter((d) => d.timestamp > since);

  console.log(`[GET /api/donations] since=${since}, found=${newDonations.length}`);

  res.json({
    donations: newDonations,
    total: newDonations.length,
    server_time: Math.floor(Date.now() / 1000),
  });
});

// =============================================
// POST /webhook - Saweria kirim donasi ke sini
// =============================================
app.post("/webhook", (req, res) => {
  try {
    const body = req.body;
    console.log("[WEBHOOK RECEIVED]", JSON.stringify(body));

    let donorName = "";
    let amount = 0;
    let message = "";
    let donationId = "";

    // Format 1: Saweria standar
    if (body.donator_name !== undefined) {
      donorName = body.donator_name || "Anonymous";
      amount = parseInt(body.amount_raw || body.amount || 0);
      message = body.donator_comment || body.message || body.comment || "";
      donationId = body.id || generateId();
    }
    // Format 2: Alternatif
    else if (body.name !== undefined) {
      donorName = body.name || "Anonymous";
      amount = parseInt(body.amount || 0);
      message = body.message || body.comment || body.donator_comment || "";
      donationId = body.id || generateId();
    }
    // Format 3: Saweria payload baru
    else if (body.data !== undefined) {
      const d = body.data;
      donorName = d.donator_name || d.name || "Anonymous";
      amount = parseInt(d.amount_raw || d.amount || 0);
      message = d.donator_comment || d.message || d.comment || "";
      donationId = d.id || generateId();
    }
    else {
      console.warn("[WEBHOOK] Format tidak dikenal:", body);
      return res.status(200).json({ status: "received_unknown_format" });
    }

    const data = loadData();
    const processedSet = new Set(data.processedIds);

    // Cegah duplikat
    if (donationId && processedSet.has(donationId)) {
      console.log("[WEBHOOK] Duplikat, skip:", donationId);
      return res.status(200).json({ status: "duplicate" });
    }

    // Validasi
    if (!donorName || amount <= 0) {
      console.warn("[WEBHOOK] Data tidak valid:", { donorName, amount });
      return res.status(200).json({ status: "invalid_data" });
    }

    // Simpan donasi
    const donationEntry = {
      id: donationId,
      name: donorName,
      amount: amount,
      message: message,
      timestamp: Math.floor(Date.now() / 1000),
    };

    data.donations.push(donationEntry);
    processedSet.add(donationId);
    data.processedIds = Array.from(processedSet);

    // Jaga memory max 500
    if (data.donations.length > 500) {
      data.donations = data.donations.slice(-500);
    }

    saveData(data);

    console.log(`[WEBHOOK] SAVED: ${donorName} - Rp ${amount} | Pesan: ${message}`);
    res.status(200).json({ status: "ok", saved: donationEntry });

  } catch (err) {
    console.error("[WEBHOOK ERROR]", err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// POST /api/donations - endpoint tambahan
app.post("/api/donations", (req, res) => {
  req.url = "/webhook";
  app._router.handle(req, res, () => {});
});

// POST /test - tes manual
app.post("/test", (req, res) => {
  const data = loadData();
  const testDonation = {
    id: "TEST_" + generateId(),
    name: req.body.name || "TestDonor",
    amount: parseInt(req.body.amount || 10000),
    message: req.body.message || "Pesan test donation",
    timestamp: Math.floor(Date.now() / 1000),
  };
  data.donations.push(testDonation);
  saveData(data);
  console.log("[TEST] Donation added:", testDonation);
  res.json({ status: "ok", donation: testDonation });
});

// GET /all - lihat semua donasi
app.get("/all", (req, res) => {
  const data = loadData();
  res.json({
    total: data.donations.length,
    donations: data.donations.slice(-20),
  });
});

// DELETE /clear - hapus semua donasi
app.delete("/clear", (req, res) => {
  const data = loadData();
  const count = data.donations.length;
  saveData({ donations: [], processedIds: [] });
  res.json({ status: "cleared", deleted: count });
});

module.exports = app;