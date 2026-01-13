const express = require("express");
const path = require("path");
const app = express();
const data = require("./data");

app.use(express.static(path.join(__dirname, "public")));

// Pages
app.get("/ui", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/signup", (req, res) => res.sendFile(path.join(__dirname, "public", "signup.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));

// Cookie helpers
function parseCookies(req) {
  const header = req.headers.cookie || "";
  const parts = header.split(";").map((p) => p.trim()).filter(Boolean);
  const out = {};
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx === -1) continue;
    out[p.slice(0, idx)] = decodeURIComponent(p.slice(idx + 1));
  }
  return out;
}
function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (opts.httpOnly) parts.push("HttpOnly");
  parts.push("Path=/");
  parts.push("SameSite=Lax");
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  res.setHeader("Set-Cookie", parts.join("; "));
}
function getUserId(req) {
  const sid = parseCookies(req).sid;
  if (!sid) return null;
  const result = data.getUserBySession(sid);
  return result?.user?.id ?? null;
}

// Auth
app.post("/auth/request-link", express.json(), (req, res) => {
  const email = (req.body?.email || "").toString().trim().toLowerCase();
  if (!email) return res.status(400).json({ error: "email required" });
  const created = data.createMagicLink(email);
  if (created.error) return res.status(400).json(created);
  const magicUrl = `http://localhost:3000/auth/magic?token=${created.token}`;
  res.json({ ok: true, magicUrl, expiresAt: created.expiresAt });
});
app.get("/auth/magic", (req, res) => {
  const token = (req.query.token || "").toString();
  if (!token) return res.status(400).send("Missing token");
  const consumed = data.consumeMagicToken(token);
  if (consumed.error) return res.status(400).send(consumed.error);
  const sess = data.createSession(consumed.userId);
  setCookie(res, "sid", sess.sid, { httpOnly: true, maxAge: 60 * 60 * 24 * 30 });
  res.redirect("/ui");
});
app.post("/auth/logout", (req, res) => {
  const sid = parseCookies(req).sid;
  if (sid) data.deleteSession(sid);
  setCookie(res, "sid", "", { httpOnly: true, maxAge: 0 });
  res.json({ ok: true });
});
app.get("/me", (req, res) => {
  const sid = parseCookies(req).sid;
  if (!sid) return res.json({ user: null, signup: null });
  const result = data.getUserBySession(sid);
  if (!result) return res.json({ user: null, signup: null });
  res.json(result);
});

// Basic
app.get("/health", (req, res) => res.json({ status: "ok" }));

// ✅ Sweep endpoints
app.get("/sweep/balance", (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.json({ loggedIn: false, balance: 0 });
  const bal = data.getSweepBalance(uid);
  res.json({ loggedIn: true, balance: bal });
});
app.post("/sweep/raffle/enter", (req, res) => {
  const uid = getUserId(req);
  const result = data.enterDailyRaffle(uid, 10);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// Signup
app.post("/api/signup", express.json(), (req, res) => {
  const result = data.addSignup(req.body || {});
  if (result?.error) return res.status(400).json(result);
  res.status(201).json(result);
});

// Admin analytics (login required)
app.get("/api/admin/pulse", (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ error: "Login required" });
  const hours = Number(req.query.hours || 24);
  res.json(data.townPulse(hours));
});
app.get("/api/admin/places", (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ error: "Login required" });
  const hours = Number(req.query.hours || 24);
  res.json(data.placeLeaderboard(hours, 10));
});

// ✅ Events endpoint: log + reward sweep
app.post("/events", express.json(), (req, res) => {
  const payload = req.body || {};
  const clientSessionId = (payload.clientSessionId || "").toString();
  const eventType = (payload.eventType || "").toString();
  if (!clientSessionId || !eventType) return res.status(400).json({ error: "clientSessionId and eventType required" });

  const userId = getUserId(req);

  const eventId = data.logEvent({
    eventType,
    townId: 1,
    districtId: payload.districtId ?? null,
    placeId: payload.placeId ?? null,
    listingId: payload.listingId ?? null,
    conversationId: payload.conversationId ?? null,
    userId,
    clientSessionId,
    meta: payload.meta || {},
  });

  const reward = data.applySweepRewardForEvent({ eventType, userId, eventId, meta: payload.meta || {} });

  res.json({ ok: true, reward: reward || null });
});

// Places + settings
app.get("/districts/:id/places", (req, res) => {
  const districtId = Number(req.params.id);
  res.json(data.places.filter((p) => p.districtId === districtId));
});
app.patch("/places/:id/settings", express.json(), (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ error: "Login required" });
  const updated = data.updatePlaceSettings(req.params.id, req.body || {});
  if (updated?.error) return res.status(404).json(updated);
  res.json(updated);
});

// Listings
app.get("/places/:id/listings", (req, res) => {
  const placeId = Number(req.params.id);
  res.json(data.getListings().filter((l) => l.placeId === placeId));
});
app.post("/places/:id/listings", express.json(), (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ error: "Login required" });

  const placeId = Number(req.params.id);
  const { title, description, quantity, price } = req.body || {};
  if (!title || typeof title !== "string") return res.status(400).json({ error: "title is required" });

  const listing = data.addListing({ placeId, title, description, quantity, price, status: "active" });
  res.status(201).json(listing);
});
app.patch("/listings/:id/sold", (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ error: "Login required" });

  const updated = data.markListingSold(req.params.id);
  if (!updated) return res.status(404).json({ error: "Listing not found" });
  res.json(updated);
});

// Messaging
app.get("/places/:id/conversations", (req, res) => {
  const placeId = Number(req.params.id);
  const viewer = (req.query.viewer || "buyer").toString();
  const convos = data.getConversationsForPlace(placeId).map((c) => ({
    ...c,
    unreadCount: data.getUnreadCount(c.id, viewer),
  }));
  res.json(convos);
});
app.get("/conversations/:id/messages", (req, res) => {
  const conversationId = Number(req.params.id);
  res.json(data.getMessages().filter((m) => m.conversationId === conversationId));
});
app.post("/conversations/:id/messages", express.json(), (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ error: "Login required" });

  const conversationId = Number(req.params.id);
  const { sender, text } = req.body || {};
  if (!text) return res.status(400).json({ error: "text required" });

  const msg = data.addMessage({ conversationId, sender: sender || "buyer", text });
  res.status(201).json(msg);
});
app.patch("/conversations/:id/read", (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ error: "Login required" });

  const conversationId = Number(req.params.id);
  const viewer = (req.query.viewer || "buyer").toString();
  data.markConversationRead(conversationId, viewer);
  res.json({ ok: true, conversationId, viewer });
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

