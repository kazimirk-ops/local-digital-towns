const express = require("express");
const path = require("path");
const app = express();

const data = require("./data");

// Serve frontend files
app.use(express.static(path.join(__dirname, "public")));

// Pages
app.get("/ui", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/signup", (req, res) => res.sendFile(path.join(__dirname, "public", "signup.html")));

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
  if (opts.maxAge) parts.push(`Max-Age=${opts.maxAge}`);
  res.setHeader("Set-Cookie", parts.join("; "));
}

// Auth endpoints
app.post("/auth/request-link", express.json(), (req, res) => {
  const email = (req.body?.email || "").toString().trim().toLowerCase();
  if (!email) return res.status(400).json({ error: "email required" });

  const created = data.createMagicLink(email);
  if (created.error) return res.status(400).json(created);

  // Dev mode: return link to user directly
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
  const cookies = parseCookies(req);
  const sid = cookies.sid;
  if (sid) data.deleteSession(sid);
  setCookie(res, "sid", "", { httpOnly: true, maxAge: 0 });
  res.json({ ok: true });
});

// Who am I
app.get("/me", (req, res) => {
  const cookies = parseCookies(req);
  const sid = cookies.sid;
  if (!sid) return res.json({ user: null, signup: null });

  const result = data.getUserBySession(sid);
  if (!result) return res.json({ user: null, signup: null });

  res.json(result);
});

// Basic
app.get("/", (req, res) => res.json({ message: "Sebastian Digital Town API", status: "running" }));
app.get("/health", (req, res) => res.json({ status: "ok" }));

// Town Health
app.get("/metrics/town", (req, res) => res.json(data.getTownMetrics()));

// Signup
app.post("/api/signup", express.json(), (req, res) => {
  const result = data.addSignup(req.body || {});
  if (result?.error) return res.status(400).json(result);
  res.status(201).json(result);
});
app.get("/api/signups", (req, res) => res.json(data.listSignups(100)));

// Town
app.get("/town", (req, res) => res.json(data.town));
app.get("/districts", (req, res) => res.json(data.districts));
app.get("/districts/:id/places", (req, res) => {
  const districtId = Number(req.params.id);
  res.json(data.places.filter((p) => p.districtId === districtId));
});

// Listings
app.get("/places/:id/listings", (req, res) => {
  const placeId = Number(req.params.id);
  res.json(data.getListings().filter((l) => l.placeId === placeId));
});
app.post("/places/:id/listings", express.json(), (req, res) => {
  const placeId = Number(req.params.id);
  const { title, description, quantity, price } = req.body || {};
  if (!title || typeof title !== "string") return res.status(400).json({ error: "title is required" });

  const listing = data.addListing({
    placeId,
    title,
    description: typeof description === "string" ? description : "",
    quantity: Number.isFinite(Number(quantity)) ? Number(quantity) : 1,
    price: Number.isFinite(Number(price)) ? Number(price) : 0,
    status: "active",
  });

  res.status(201).json(listing);
});
app.patch("/listings/:id/sold", (req, res) => {
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
  const conversationId = Number(req.params.id);
  const { sender, text } = req.body || {};
  if (!text) return res.status(400).json({ error: "text required" });
  const msg = data.addMessage({ conversationId, sender: sender || "buyer", text });
  res.status(201).json(msg);
});
app.patch("/conversations/:id/read", (req, res) => {
  const conversationId = Number(req.params.id);
  const viewer = (req.query.viewer || "buyer").toString();
  data.markConversationRead(conversationId, viewer);
  res.json({ ok: true, conversationId, viewer });
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

