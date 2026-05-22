const express = require("express");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const twilio = require("twilio");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// --- CONFIG (set in Glitch env vars) ---
const TWILIO_SID = process.env.TWILIO_SID;
const TWILIO_TOKEN = process.env.TWILIO_TOKEN;
const FROM_NUMBER = process.env.FROM_NUMBER; // whatsapp:+14155238886
const SHEET_ID = process.env.SHEET_ID;
const SHEET_EMAIL = process.env.SHEET_EMAIL;
const SHEET_KEY = (process.env.SHEET_KEY || "").replace(/\\n/g, "\n");

const client = twilio(TWILIO_SID, TWILIO_TOKEN);

// In-memory session (resets on restart — fine for experiments)
const sessions = {};

// --- SERVICES ---
const SERVICES = {
  "1": { name: "MEP Contracting", subs: ["Electrical", "Plumbing", "HVAC", "Fire & Safety", "Smart Home"] },
  "2": { name: "Facility Management", subs: ["Electrical Maintenance", "Plumbing Maintenance", "AC Servicing", "Housekeeping", "Pest Control"] },
  "3": { name: "HVAC Home Services", subs: ["AC Installation", "AC Repair", "AC Maintenance", "Gas Refill", "AMC"] },
};

const SLOTS = ["9–11 AM", "11 AM–1 PM", "2–4 PM", "4–6 PM"];

// --- SEND MESSAGE ---
async function send(to, msg) {
  await client.messages.create({ from: FROM_NUMBER, to, body: msg });
}

// --- SAVE TO SHEET ---
async function saveBooking(data) {
  try {
    const doc = new GoogleSpreadsheet(SHEET_ID);
    await doc.useServiceAccountAuth({ client_email: SHEET_EMAIL, private_key: SHEET_KEY });
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    await sheet.addRow({
      ID: "AG-" + Date.now(),
      Phone: data.phone,
      Service: data.service,
      SubService: data.sub,
      Slot: data.slot,
      Status: "New",
      Timestamp: new Date().toLocaleString("en-IN"),
    });
  } catch (e) {
    console.error("Sheet error:", e.message);
  }
}

// --- BOT LOGIC ---
async function handleMessage(phone, text) {
  const s = sessions[phone] || { step: "start" };
  sessions[phone] = s;
  const t = text.trim();

  if (t.toLowerCase() === "hi" || t.toLowerCase() === "hello" || s.step === "start") {
    s.step = "service";
    return send(phone,
      "👋 Welcome to *Adeeb Group*!\n\nSelect a service:\n\n1️⃣ MEP Contracting\n2️⃣ Facility Management\n3️⃣ HVAC Home Services\n\nReply with 1, 2, or 3"
    );
  }

  if (s.step === "service") {
    if (!SERVICES[t]) return send(phone, "Please reply with 1, 2, or 3");
    s.service = SERVICES[t].name;
    s.subs = SERVICES[t].subs;
    s.step = "sub";
    const list = s.subs.map((x, i) => `${i + 1}️⃣ ${x}`).join("\n");
    return send(phone, `*${s.service}*\n\nSelect type:\n\n${list}\n\nReply with number`);
  }

  if (s.step === "sub") {
    const idx = parseInt(t) - 1;
    if (idx < 0 || idx >= s.subs.length) return send(phone, "Invalid. Reply with correct number.");
    s.sub = s.subs[idx];
    s.step = "slot";
    const slotList = SLOTS.map((x, i) => `${i + 1}️⃣ ${x}`).join("\n");
    return send(phone, `*${s.sub}*\n\nPick a time slot:\n\n${slotList}\n\nReply 1–4`);
  }

  if (s.step === "slot") {
    const idx = parseInt(t) - 1;
    if (idx < 0 || idx >= SLOTS.length) return send(phone, "Reply 1, 2, 3, or 4");
    s.slot = SLOTS[idx];
    s.step = "confirm";
    return send(phone,
      `📋 *Booking Summary*\n\nService: ${s.service}\nType: ${s.sub}\nSlot: ${s.slot}\n\nConfirm? Reply *YES* or *NO*`
    );
  }

  if (s.step === "confirm") {
    if (t.toLowerCase() === "yes") {
      await saveBooking({ phone, service: s.service, sub: s.sub, slot: s.slot });
      delete sessions[phone];
      return send(phone,
        "✅ *Booking Confirmed!*\n\nWe'll assign a technician and contact you shortly.\n\nThank you for choosing Adeeb Group! 🙏"
      );
    } else {
      delete sessions[phone];
      return send(phone, "Booking cancelled. Send *Hi* to start again.");
    }
  }

  return send(phone, "Send *Hi* to start a new booking.");
}

// --- WEBHOOK ---
app.post("/webhook", async (req, res) => {
  const from = req.body.From;
  const body = req.body.Body;
  if (from && body) await handleMessage(from, body);
  res.sendStatus(200);
});

// --- SIMPLE DASHBOARD ---
app.get("/", async (req, res) => {
  try {
    const doc = new GoogleSpreadsheet(SHEET_ID);
    await doc.useServiceAccountAuth({ client_email: SHEET_EMAIL, private_key: SHEET_KEY });
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();
    const html = rows.map(r =>
      `<tr><td>${r.ID}</td><td>${r.Phone}</td><td>${r.Service}</td><td>${r.SubService}</td><td>${r.Slot}</td><td><b>${r.Status}</b></td><td>${r.Timestamp}</td></tr>`
    ).join("");
    res.send(`<!DOCTYPE html><html><head><title>Adeeb Bookings</title>
    <style>body{font-family:sans-serif;padding:20px;}table{border-collapse:collapse;width:100%;}th,td{border:1px solid #ddd;padding:8px;font-size:13px;}th{background:#075E54;color:#fff;}tr:nth-child(even){background:#f9f9f9;}</style>
    </head><body><h2>📋 Adeeb Group — Bookings</h2>
    <table><tr><th>ID</th><th>Phone</th><th>Service</th><th>Type</th><th>Slot</th><th>Status</th><th>Time</th></tr>${html}</table>
    </body></html>`);
  } catch (e) {
    res.send("Error loading sheet: " + e.message);
  }
});

app.listen(3000, () => console.log("Bot running on port 3000"));
