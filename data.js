const Database = require("better-sqlite3");
const db = new Database("town.db");
db.pragma("journal_mode = WAL");

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
`);

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

function getTown() {
  return db.prepare("SELECT * FROM towns WHERE id=1").get();
}
function getDistricts() {
  return db.prepare("SELECT * FROM districts WHERE townId=1 ORDER BY id").all();
}
function getPlaces() {
  return db.prepare("SELECT * FROM places WHERE townId=1 ORDER BY id").all();
}
function getListings() {
  return db.prepare("SELECT * FROM listings ORDER BY id").all();
}
function addListing(listing) {
  const now = new Date().toISOString();
  const info = db.prepare(
    "INSERT INTO listings (placeId, title, description, quantity, price, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(
    listing.placeId,
    listing.title,
    listing.description || "",
    listing.quantity ?? 1,
    listing.price ?? 0,
    listing.status || "active",
    now
  );
  return db.prepare("SELECT * FROM listings WHERE id=?").get(info.lastInsertRowid);
}

// ✅ NEW: mark listing sold (SQLite update)
function markListingSold(listingId) {
  const id = Number(listingId);
  const exists = db.prepare("SELECT * FROM listings WHERE id=?").get(id);
  if (!exists) return null;

  db.prepare("UPDATE listings SET status='sold' WHERE id=?").run(id);
  return db.prepare("SELECT * FROM listings WHERE id=?").get(id);
}

function getConversations() {
  return db.prepare("SELECT * FROM conversations ORDER BY id").all();
}
function addConversation(conversation) {
  const now = new Date().toISOString();
  const info = db.prepare("INSERT INTO conversations (placeId, participant, createdAt) VALUES (?, ?, ?)")
    .run(conversation.placeId, conversation.participant || "buyer", now);
  return db.prepare("SELECT * FROM conversations WHERE id=?").get(info.lastInsertRowid);
}

function getMessages() {
  return db.prepare("SELECT * FROM messages ORDER BY id").all()
    .map((m) => ({ ...m, readBy: JSON.parse(m.readBy || "[]") }));
}
function addMessage(message) {
  const now = new Date().toISOString();
  const readBy = message.readBy ? message.readBy : [message.sender || "buyer"];
  const info = db.prepare("INSERT INTO messages (conversationId, sender, text, createdAt, readBy) VALUES (?, ?, ?, ?, ?)")
    .run(message.conversationId, message.sender || "buyer", message.text, now, JSON.stringify(readBy));
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

function getTownMetrics() {
  const placesCount = db.prepare("SELECT COUNT(*) AS c FROM places WHERE townId=1").get().c;
  const totalListings = db.prepare("SELECT COUNT(*) AS c FROM listings").get().c;
  const activeListings = db.prepare("SELECT COUNT(*) AS c FROM listings WHERE status='active'").get().c;
  const soldListings = db.prepare("SELECT COUNT(*) AS c FROM listings WHERE status='sold'").get().c;
  const conversationsCount = db.prepare("SELECT COUNT(*) AS c FROM conversations").get().c;
  const messagesCount = db.prepare("SELECT COUNT(*) AS c FROM messages").get().c;

  const healthIndex = Math.min(
    100,
    (placesCount * 2) +
      (activeListings * 3) +
      (conversationsCount * 4) +
      Math.min(30, messagesCount)
  );

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
    updatedAt: new Date().toISOString(),
  };
}

module.exports = {
  get town() { return getTown(); },
  get districts() { return getDistricts(); },
  get places() { return getPlaces(); },

  getListings,
  addListing,
  markListingSold, // ✅ export it

  getConversations,
  addConversation,
  getMessages,
  addMessage,

  getConversationsForPlace,
  getUnreadCount,
  markConversationRead,

  getTownMetrics,
};

