const Database = require("better-sqlite3");
const crypto = require("crypto");

const db = new Database("town.db");
db.pragma("journal_mode = WAL");

// ---------- Schema ----------
db.exec(`
CREATE TABLE IF NOT EXISTS towns (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  state TEXT NOT NULL,
  region TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS districts (
  id INTEGER PRIMARY KEY,
  townId INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS places (
  id INTEGER PRIMARY KEY,
  townId INTEGER NOT NULL,
  districtId INTEGER NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  placeId INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  price REAL NOT NULL,
  status TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  placeId INTEGER NOT NULL,
  participant TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversationId INTEGER NOT NULL,
  sender TEXT NOT NULL,
  text TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  readBy TEXT NOT NULL
);

-- Signup gate
CREATE TABLE IF NOT EXISTS signups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  address1 TEXT NOT NULL,
  address2 TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT NOT NULL,
  status TEXT NOT NULL,          -- eligible | waitlist
  reason TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signups_email ON signups(email);

-- ✅ Auth: users + magic links + sessions (passwordless)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS magic_links (
  token TEXT PRIMARY KEY,
  userId INTEGER NOT NULL,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  userId INTEGER NOT NULL,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
`);

// ---------- Seed (only if empty) ----------
const townCount = db.prepare("SELECT COUNT(*) AS c FROM towns").get().c;
if (townCount === 0) {
  db.prepare("INSERT INTO towns (id, name, state, region, status) VALUES (1, ?, ?, ?, ?)")
    .run("Sebastian", "FL", "Treasure Coast", "active");

  const districtSeed = [
    [1, 1, "Market Square", "market"],
    [2, 1, "Service Row", "service"],
    [3, 1, "Retail Way", "retail"],
    [4, 1, "Marina / Live Hall", "live"],
    [5, 1, "Town Hall", "civic"],
  ];
  const insD = db.prepare("INSERT INTO districts (id, townId, name, type) VALUES (?, ?, ?, ?)");
  for (const r of districtSeed) insD.run(...r);

  const placeSeed = [
    [101, 1, 1, "Saturday Market Booth A", "hybrid", "open"],
    [102, 1, 1, "Joe's Produce", "grower", "open"],
    [201, 1, 2, "Riverfront Plumbing", "service", "open"],
    [202, 1, 2, "Sebastian Lawn & Landscape", "service", "open"],
    [301, 1, 3, "Coastal Outfitters", "retail", "open"],
    [302, 1, 3, "Harbor Gift Shop", "retail", "open"],
    [401, 1, 4, "Sebastian Auction Hall", "live", "open"],
    [501, 1, 5, "Town Hall Desk", "civic", "open"],
  ];
  const insP = db.prepare("INSERT INTO places (id, townId, districtId, name, category, status) VALUES (?, ?, ?, ?, ?, ?)");
  for (const r of placeSeed) insP.run(...r);

  const now = new Date().toISOString();
  const insL = db.prepare("INSERT INTO listings (placeId, title, description, quantity, price, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)");
  insL.run(102, "Bell Peppers (5 lb bag)", "Fresh, local. Pickup today.", 10, 12, "active", now);
  insL.run(301, "Coastal Hat", "One size fits most.", 5, 20, "active", now);

  const insC = db.prepare("INSERT INTO conversations (placeId, participant, createdAt) VALUES (?, ?, ?)");
  const convoId = insC.run(102, "buyer", now).lastInsertRowid;

  const insM = db.prepare("INSERT INTO messages (conversationId, sender, text, createdAt, readBy) VALUES (?, ?, ?, ?, ?)");
  insM.run(convoId, "buyer", "Hi, are the bell peppers still available?", now, JSON.stringify(["buyer"]));
}

// ---------- Helpers ----------
function nowISO() { return new Date().toISOString(); }
function normalizeEmail(e) { return (e || "").toString().trim().toLowerCase(); }
function randToken(bytes = 24) { return crypto.randomBytes(bytes).toString("hex"); }

// ---------- Live getters ----------
function getTown() { return db.prepare("SELECT * FROM towns WHERE id=1").get(); }
function getDistricts() { return db.prepare("SELECT * FROM districts WHERE townId=1 ORDER BY id").all(); }
function getPlaces() { return db.prepare("SELECT * FROM places WHERE townId=1 ORDER BY id").all(); }
function getListings() { return db.prepare("SELECT * FROM listings ORDER BY id").all(); }
function getConversations() { return db.prepare("SELECT * FROM conversations ORDER BY id").all(); }
function getMessages() {
  return db.prepare("SELECT * FROM messages ORDER BY id").all()
    .map((m) => ({ ...m, readBy: JSON.parse(m.readBy || "[]") }));
}

// ---------- Listings ----------
function addListing(listing) {
  const info = db.prepare(
    "INSERT INTO listings (placeId, title, description, quantity, price, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(
    listing.placeId,
    listing.title,
    listing.description || "",
    listing.quantity ?? 1,
    listing.price ?? 0,
    listing.status || "active",
    nowISO()
  );
  return db.prepare("SELECT * FROM listings WHERE id=?").get(info.lastInsertRowid);
}

function markListingSold(listingId) {
  const id = Number(listingId);
  const exists = db.prepare("SELECT * FROM listings WHERE id=?").get(id);
  if (!exists) return null;
  db.prepare("UPDATE listings SET status='sold' WHERE id=?").run(id);
  return db.prepare("SELECT * FROM listings WHERE id=?").get(id);
}

// ---------- Conversations & Messages ----------
function addConversation(conversation) {
  const info = db.prepare("INSERT INTO conversations (placeId, participant, createdAt) VALUES (?, ?, ?)")
    .run(conversation.placeId, conversation.participant || "buyer", nowISO());
  return db.prepare("SELECT * FROM conversations WHERE id=?").get(info.lastInsertRowid);
}

function addMessage(message) {
  const readBy = message.readBy ? message.readBy : [message.sender || "buyer"];
  const info = db.prepare("INSERT INTO messages (conversationId, sender, text, createdAt, readBy) VALUES (?, ?, ?, ?, ?)")
    .run(message.conversationId, message.sender || "buyer", message.text, nowISO(), JSON.stringify(readBy));
  const row = db.prepare("SELECT * FROM messages WHERE id=?").get(info.lastInsertRowid);
  return { ...row, readBy: JSON.parse(row.readBy || "[]") };
}

function getConversationsForPlace(placeId) {
  return db.prepare("SELECT * FROM conversations WHERE placeId=? ORDER BY id").all(Number(placeId));
}
function getUnreadCount(conversationId, viewer = "buyer") {
  const rows = db.prepare("SELECT readBy FROM messages WHERE conversationId=?").all(Number(conversationId));
  let unread = 0;
  for (const r of rows) {
    const rb = JSON.parse(r.readBy || "[]");
    if (!rb.includes(viewer)) unread += 1;
  }
  return unread;
}
function markConversationRead(conversationId, viewer = "buyer") {
  const rows = db.prepare("SELECT id, readBy FROM messages WHERE conversationId=?").all(Number(conversationId));
  const upd = db.prepare("UPDATE messages SET readBy=? WHERE id=?");
  for (const r of rows) {
    const rb = JSON.parse(r.readBy || "[]");
    if (!rb.includes(viewer)) rb.push(viewer);
    upd.run(JSON.stringify(rb), r.id);
  }
  return true;
}

// ---------- Town Metrics ----------
function getTownMetrics() {
  const placesCount = db.prepare("SELECT COUNT(*) AS c FROM places WHERE townId=1").get().c;
  const totalListings = db.prepare("SELECT COUNT(*) AS c FROM listings").get().c;
  const activeListings = db.prepare("SELECT COUNT(*) AS c FROM listings WHERE status='active'").get().c;
  const soldListings = db.prepare("SELECT COUNT(*) AS c FROM listings WHERE status='sold'").get().c;
  const conversationsCount = db.prepare("SELECT COUNT(*) AS c FROM conversations").get().c;
  const messagesCount = db.prepare("SELECT COUNT(*) AS c FROM messages").get().c;

  const healthIndex = Math.min(100, (placesCount * 2) + (activeListings * 3) + (conversationsCount * 4) + Math.min(30, messagesCount));

  return {
    townId: 1,
    townName: getTown().name,
    placesCount,
    totalListings,
    activeListings,
    soldListings,
    conversationsCount,
    messagesCount,
    healthIndex,
    updatedAt: nowISO(),
  };
}

// ---------- Signup Gate ----------
function classifySignup({ city, zip }) {
  const c = (city || "").toString().trim().toLowerCase();
  const z = (zip || "").toString().trim();

  if (c.includes("sebastian")) return { status: "eligible", reason: "City contains 'Sebastian' (pilot zone)" };
  if (z === "32958") return { status: "eligible", reason: "ZIP is 32958 (Sebastian pilot zone)" };
  return { status: "waitlist", reason: "Outside Sebastian pilot zone (address gate)" };
}

function addSignup(payload) {
  const name = (payload.name || "").toString().trim();
  const email = normalizeEmail(payload.email);
  const address1 = (payload.address1 || "").toString().trim();
  const address2 = (payload.address2 || "").toString().trim();
  const city = (payload.city || "").toString().trim();
  const state = (payload.state || "").toString().trim();
  const zip = (payload.zip || "").toString().trim();

  if (!name || !email || !address1 || !city || !state || !zip) return { error: "Missing required fields" };

  const { status, reason } = classifySignup({ city, zip });

  const existing = db.prepare("SELECT * FROM signups WHERE email=? ORDER BY id DESC LIMIT 1").get(email);
  if (existing) {
    db.prepare("UPDATE signups SET name=?, address1=?, address2=?, city=?, state=?, zip=?, status=?, reason=? WHERE id=?")
      .run(name, address1, address2, city, state, zip, status, reason, existing.id);
    return db.prepare("SELECT * FROM signups WHERE id=?").get(existing.id);
  }

  const info = db.prepare(
    "INSERT INTO signups (name, email, address1, address2, city, state, zip, status, reason, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(name, email, address1, address2, city, state, zip, status, reason, nowISO());

  return db.prepare("SELECT * FROM signups WHERE id=?").get(info.lastInsertRowid);
}

function listSignups(limit = 100) {
  return db.prepare("SELECT * FROM signups ORDER BY id DESC LIMIT ?").all(Number(limit));
}

function getLatestSignupByEmail(email) {
  const e = normalizeEmail(email);
  return db.prepare("SELECT * FROM signups WHERE email=? ORDER BY id DESC LIMIT 1").get(e) || null;
}

// ---------- ✅ Magic Link Auth (B: everyone can login; waitlist limited) ----------
function upsertUserByEmail(email) {
  const e = normalizeEmail(email);
  if (!e) return null;

  const existing = db.prepare("SELECT * FROM users WHERE email=?").get(e);
  if (existing) return existing;

  const info = db.prepare("INSERT INTO users (email, createdAt) VALUES (?, ?)").run(e, nowISO());
  return db.prepare("SELECT * FROM users WHERE id=?").get(info.lastInsertRowid);
}

function createMagicLink(email) {
  const user = upsertUserByEmail(email);
  if (!user) return { error: "Invalid email" };

  const token = randToken(24);
  const createdAt = nowISO();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes

  db.prepare("INSERT INTO magic_links (token, userId, expiresAt, createdAt) VALUES (?, ?, ?, ?)")
    .run(token, user.id, expiresAt, createdAt);

  return { token, userId: user.id, expiresAt };
}

function consumeMagicToken(token) {
  const row = db.prepare("SELECT * FROM magic_links WHERE token=?").get(token);
  if (!row) return { error: "Invalid token" };

  if (new Date(row.expiresAt).getTime() < Date.now()) {
    db.prepare("DELETE FROM magic_links WHERE token=?").run(token);
    return { error: "Token expired" };
  }

  db.prepare("DELETE FROM magic_links WHERE token=?").run(token);
  return { userId: row.userId };
}

function createSession(userId) {
  const sid = randToken(24);
  const createdAt = nowISO();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

  db.prepare("INSERT INTO sessions (sid, userId, expiresAt, createdAt) VALUES (?, ?, ?, ?)")
    .run(sid, userId, expiresAt, createdAt);

  return { sid, expiresAt };
}

function deleteSession(sid) {
  db.prepare("DELETE FROM sessions WHERE sid=?").run(sid);
}

function getUserBySession(sid) {
  const sess = db.prepare("SELECT * FROM sessions WHERE sid=?").get(sid);
  if (!sess) return null;
  if (new Date(sess.expiresAt).getTime() < Date.now()) {
    deleteSession(sid);
    return null;
  }
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(sess.userId);
  if (!user) return null;

  const signup = getLatestSignupByEmail(user.email);
  return { user, signup };
}

module.exports = {
  get town() { return getTown(); },
  get districts() { return getDistricts(); },
  get places() { return getPlaces(); },

  getListings,
  addListing,
  markListingSold,

  getConversations,
  addConversation,
  getMessages,
  addMessage,

  getConversationsForPlace,
  getUnreadCount,
  markConversationRead,

  getTownMetrics,

  addSignup,
  listSignups,

  // auth
  createMagicLink,
  consumeMagicToken,
  createSession,
  deleteSession,
  getUserBySession,
};

