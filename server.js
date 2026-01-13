const express = require("express");
const path = require("path");
const app = express();

const data = require("./data");

// Serve frontend files
app.use(express.static(path.join(__dirname, "public")));

// UI route
app.get("/ui", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ✅ Signup route
app.get("/signup", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "signup.html"));
});

// Basic
app.get("/", (req, res) => res.json({ message: "Sebastian Digital Town API", status: "running" }));
app.get("/health", (req, res) => res.json({ status: "ok" }));

// Town Health
app.get("/metrics/town", (req, res) => res.json(data.getTownMetrics()));

// ✅ Signup API
app.post("/api/signup", express.json(), (req, res) => {
  const result = data.addSignup(req.body || {});
  if (result?.error) return res.status(400).json(result);
  res.status(201).json(result);
});

// ✅ Admin: list signups (for you only in dev)
app.get("/api/signups", (req, res) => {
  res.json(data.listSignups(100));
});

// Town
app.get("/town", (req, res) => res.json(data.town));
app.get("/districts", (req, res) => res.json(data.districts));
app.get("/districts/:id/places", (req, res) => {
  const districtId = Number(req.params.id);
  res.json(data.places.filter((p) => p.districtId === districtId));
});

// Places
app.get("/places", (req, res) => res.json(data.places));
app.get("/places/:id", (req, res) => {
  const placeId = Number(req.params.id);
  const place = data.places.find((p) => p.id === placeId);
  if (!place) return res.status(404).json({ error: "Place not found" });
  res.json(place);
});

// Listings
app.get("/places/:id/listings", (req, res) => {
  const placeId = Number(req.params.id);
  const place = data.places.find((p) => p.id === placeId);
  if (!place) return res.status(404).json({ error: "Place not found" });
  res.json(data.getListings().filter((l) => l.placeId === placeId));
});

app.post("/places/:id/listings", express.json(), (req, res) => {
  const placeId = Number(req.params.id);
  const place = data.places.find((p) => p.id === placeId);
  if (!place) return res.status(404).json({ error: "Place not found" });

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

// SOLD
app.patch("/listings/:id/sold", (req, res) => {
  const updated = data.markListingSold(req.params.id);
  if (!updated) return res.status(404).json({ error: "Listing not found" });
  res.json(updated);
});

// Conversations
app.get("/conversations", (req, res) => res.json(data.getConversations()));
app.post("/conversations", express.json(), (req, res) => {
  const { placeId } = req.body || {};
  if (!placeId) return res.status(400).json({ error: "placeId required" });
  const convo = data.addConversation({ placeId: Number(placeId), participant: "buyer" });
  res.status(201).json(convo);
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

// Place conversations + unread
app.get("/places/:id/conversations", (req, res) => {
  const placeId = Number(req.params.id);
  const viewer = (req.query.viewer || "buyer").toString();
  const convos = data.getConversationsForPlace(placeId).map((c) => ({
    ...c,
    unreadCount: data.getUnreadCount(c.id, viewer),
  }));
  res.json(convos);
});

// Mark read
app.patch("/conversations/:id/read", (req, res) => {
  const conversationId = Number(req.params.id);
  const viewer = (req.query.viewer || "buyer").toString();
  data.markConversationRead(conversationId, viewer);
  res.json({ ok: true, conversationId, viewer });
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

