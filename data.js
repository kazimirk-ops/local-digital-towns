const Database = require("better-sqlite3");
const crypto = require("crypto");

const db = new Database("town.db");
db.pragma("journal_mode = WAL");

function nowISO() { return new Date().toISOString(); }
function normalizeEmail(e) { return (e || "").toString().trim().toLowerCase(); }
function randToken(bytes = 24) { return crypto.randomBytes(bytes).toString("hex"); }

function columnExists(table, col) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((r) => r.name === col);
}
function addColumn(table, colDef) {
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${colDef};`);
}
function parseJsonArray(s){
  try { const v = JSON.parse(s || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function normalizePhotoUrls(urls){
  const out = [];
  for(const u of (urls || [])){
    const s = (u || "").toString().trim();
    if(!s) continue;
    if(s.length > 400) continue;
    if(!/^https?:\/\//i.test(s)) continue;
    out.push(s);
    if(out.length >= 5) break;
  }
  return out;
}

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

CREATE TABLE IF NOT EXISTS signups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  address1 TEXT NOT NULL,
  address2 TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signups_email ON signups(email);

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

CREATE TABLE IF NOT EXISTS sweep_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  createdAt TEXT NOT NULL,
  userId INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  eventId INTEGER,
  metaJson TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sweep_user ON sweep_ledger(userId);

CREATE TABLE IF NOT EXISTS store_follows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  createdAt TEXT NOT NULL,
  userId INTEGER NOT NULL,
  placeId INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_store_follow_unique ON store_follows(userId, placeId);
CREATE INDEX IF NOT EXISTS idx_store_follow_place ON store_follows(placeId);
`);

// ---------- Migrations ----------
(function migratePlaces() {
  if (!columnExists("places", "sellerType")) addColumn("places", "sellerType TEXT NOT NULL DEFAULT 'individual'");
  if (!columnExists("places", "visibilityLevel")) addColumn("places", "visibilityLevel TEXT NOT NULL DEFAULT 'town_only'");
  if (!columnExists("places", "pickupZone")) addColumn("places", "pickupZone TEXT NOT NULL DEFAULT ''");
  if (!columnExists("places", "addressPublic")) addColumn("places", "addressPublic TEXT NOT NULL DEFAULT ''");
  if (!columnExists("places", "addressPrivate")) addColumn("places", "addressPrivate TEXT NOT NULL DEFAULT ''");
  if (!columnExists("places", "meetupInstructions")) addColumn("places", "meetupInstructions TEXT NOT NULL DEFAULT ''");
  if (!columnExists("places", "hours")) addColumn("places", "hours TEXT NOT NULL DEFAULT ''");
  if (!columnExists("places", "verifiedStatus")) addColumn("places", "verifiedStatus TEXT NOT NULL DEFAULT 'unverified'");
  if (!columnExists("places", "ownerUserId")) addColumn("places", "ownerUserId INTEGER");
})();

(function migrateUsers(){
  if (!columnExists("users", "displayName")) addColumn("users", "displayName TEXT NOT NULL DEFAULT ''");
  if (!columnExists("users", "bio")) addColumn("users", "bio TEXT NOT NULL DEFAULT ''");
  if (!columnExists("users", "avatarUrl")) addColumn("users", "avatarUrl TEXT NOT NULL DEFAULT ''");
  if (!columnExists("users", "isAdmin")) addColumn("users", "isAdmin INTEGER NOT NULL DEFAULT 0");
})();

(function migrateListingPhotos(){
  if (!columnExists("listings", "photoUrlsJson")) addColumn("listings", "photoUrlsJson TEXT NOT NULL DEFAULT '[]'");
})();

// ---------- Seed (only if empty) ----------
const townCount = db.prepare("SELECT COUNT(*) AS c FROM towns").get()?.c || 0;
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

  db.prepare("INSERT INTO listings (placeId, title, description, quantity, price, status, createdAt, photoUrlsJson) VALUES (?,?,?,?,?,?,?,?)")
    .run(102, "Bell Peppers (5 lb bag)", "Fresh, local. Pickup today.", 10, 12, "active", nowISO(), JSON.stringify([]));
}

// ---------- Core getters ----------
function getDistricts() { return db.prepare("SELECT * FROM districts WHERE townId=1 ORDER BY id").all(); }
function getPlaces() {
  return db.prepare(`
    SELECT id, townId, districtId, name, category, status,
           sellerType, visibilityLevel, pickupZone, addressPublic, addressPrivate,
           meetupInstructions, hours, verifiedStatus, ownerUserId
    FROM places WHERE townId=1 ORDER BY id
  `).all();
}
function getListings() {
  return db.prepare("SELECT * FROM listings ORDER BY id").all().map(l=>({
    ...l,
    photoUrls: parseJsonArray(l.photoUrlsJson || "[]"),
  }));
}
function getConversationsForPlace(placeId) {
  return db.prepare("SELECT * FROM conversations WHERE placeId=? ORDER BY id").all(Number(placeId));
}
function getMessages() {
  return db.prepare("SELECT * FROM messages ORDER BY id").all()
    .map(m => ({ ...m, readBy: JSON.parse(m.readBy || "[]") }));
}

// ---------- Signup ----------
function classifySignup({city,zip}) {
  const c=(city||"").toString().trim().toLowerCase();
  const z=(zip||"").toString().trim();
  if(c.includes("sebastian")) return {status:"eligible", reason:"City contains 'Sebastian' (pilot zone)"};
  if(z==="32958") return {status:"eligible", reason:"ZIP is 32958 (Sebastian pilot zone)"};
  return {status:"waitlist", reason:"Outside Sebastian pilot zone (address gate)"};
}
function addSignup(payload) {
  const name=(payload.name||"").toString().trim();
  const email=normalizeEmail(payload.email);
  const address1=(payload.address1||"").toString().trim();
  const address2=(payload.address2||"").toString().trim();
  const city=(payload.city||"").toString().trim();
  const state=(payload.state||"").toString().trim();
  const zip=(payload.zip||"").toString().trim();
  if(!name||!email||!address1||!city||!state||!zip) return {error:"Missing required fields"};

  const {status,reason}=classifySignup({city,zip});
  const existing=db.prepare("SELECT * FROM signups WHERE email=? ORDER BY id DESC LIMIT 1").get(email);
  if(existing){
    db.prepare("UPDATE signups SET name=?, address1=?, address2=?, city=?, state=?, zip=?, status=?, reason=? WHERE id=?")
      .run(name,address1,address2,city,state,zip,status,reason,existing.id);
    return db.prepare("SELECT * FROM signups WHERE id=?").get(existing.id);
  }
  const info=db.prepare("INSERT INTO signups (name,email,address1,address2,city,state,zip,status,reason,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(name,email,address1,address2,city,state,zip,status,reason,nowISO());
  return db.prepare("SELECT * FROM signups WHERE id=?").get(info.lastInsertRowid);
}

// ---------- Auth ----------
function upsertUserByEmail(email){
  const e=normalizeEmail(email);
  if(!e) return null;
  const existing=db.prepare("SELECT * FROM users WHERE email=?").get(e);
  if(existing) return existing;
  const info=db.prepare("INSERT INTO users (email, createdAt) VALUES (?,?)").run(e, nowISO());
  return db.prepare("SELECT * FROM users WHERE id=?").get(info.lastInsertRowid);
}
function createMagicLink(email){
  const user=upsertUserByEmail(email);
  if(!user) return {error:"Invalid email"};
  const token=randToken(24);
  const expiresAt=new Date(Date.now()+15*60*1000).toISOString();
  db.prepare("INSERT INTO magic_links (token,userId,expiresAt,createdAt) VALUES (?,?,?,?)")
    .run(token,user.id,expiresAt,nowISO());
  return {token,userId:user.id,expiresAt};
}
function consumeMagicToken(token){
  const row=db.prepare("SELECT * FROM magic_links WHERE token=?").get(token);
  if(!row) return {error:"Invalid token"};
  if(new Date(row.expiresAt).getTime()<Date.now()){
    db.prepare("DELETE FROM magic_links WHERE token=?").run(token);
    return {error:"Token expired"};
  }
  db.prepare("DELETE FROM magic_links WHERE token=?").run(token);
  return {userId:row.userId};
}
function createSession(userId){
  const sid=randToken(24);
  const expiresAt=new Date(Date.now()+30*24*60*60*1000).toISOString();
  db.prepare("INSERT INTO sessions (sid,userId,expiresAt,createdAt) VALUES (?,?,?,?)")
    .run(sid, Number(userId), expiresAt, nowISO());
  return {sid,expiresAt};
}
function deleteSession(sid){ db.prepare("DELETE FROM sessions WHERE sid=?").run(sid); }
function getUserBySession(sid){
  const sess=db.prepare("SELECT * FROM sessions WHERE sid=?").get(sid);
  if(!sess) return null;
  if(new Date(sess.expiresAt).getTime()<Date.now()){ deleteSession(sid); return null; }
  const user=db.prepare("SELECT * FROM users WHERE id=?").get(sess.userId);
  if(!user) return null;
  const signup=db.prepare("SELECT * FROM signups WHERE email=? ORDER BY id DESC LIMIT 1").get(user.email) || null;
  return {user,signup};
}

function getUserById(userId){
  return db.prepare("SELECT * FROM users WHERE id=?").get(Number(userId)) || null;
}
function updateMyProfile(userId, patch){
  const uid = Number(userId);
  const displayName = (patch.displayName ?? "").toString().slice(0, 60);
  const bio = (patch.bio ?? "").toString().slice(0, 280);
  const avatarUrl = (patch.avatarUrl ?? "").toString().slice(0, 300);
  db.prepare("UPDATE users SET displayName=?, bio=?, avatarUrl=? WHERE id=?")
    .run(displayName, bio, avatarUrl, uid);
  return getUserById(uid);
}

// ---------- Ownership ----------
function getPlaceOwner(placeId){
  const row = db.prepare("SELECT ownerUserId FROM places WHERE id=?").get(Number(placeId));
  if(!row?.ownerUserId) return null;
  return getUserById(row.ownerUserId);
}
function claimPlace(placeId, userId){
  const pid = Number(placeId);
  const uid = Number(userId);
  const place = db.prepare("SELECT id, ownerUserId FROM places WHERE id=?").get(pid);
  if(!place) return { error: "Place not found" };
  if(place.ownerUserId) return { error: "Place already claimed" };
  db.prepare("UPDATE places SET ownerUserId=? WHERE id=?").run(uid, pid);
  return { ok:true, placeId: pid, ownerUserId: uid };
}

// ---------- Follows ----------
function followStore(userId, placeId){
  const uid = Number(userId);
  const pid = Number(placeId);
  if(!uid || !pid) return { error: "Invalid userId/placeId" };
  try{
    db.prepare("INSERT INTO store_follows (createdAt, userId, placeId) VALUES (?,?,?)")
      .run(nowISO(), uid, pid);
  } catch {}
  return { ok:true };
}
function unfollowStore(userId, placeId){
  db.prepare("DELETE FROM store_follows WHERE userId=? AND placeId=?")
    .run(Number(userId), Number(placeId));
  return { ok:true };
}
function isFollowingStore(userId, placeId){
  const row = db.prepare("SELECT id FROM store_follows WHERE userId=? AND placeId=?")
    .get(Number(userId), Number(placeId));
  return !!row;
}
function storeFollowersCount(placeId){
  const row = db.prepare("SELECT COUNT(*) AS c FROM store_follows WHERE placeId=?")
    .get(Number(placeId));
  return row?.c || 0;
}

// ---------- Listings ----------
function addListing(listing) {
  const photoUrls = normalizePhotoUrls(listing.photoUrls || []);
  const info = db.prepare(
    "INSERT INTO listings (placeId, title, description, quantity, price, status, createdAt, photoUrlsJson) VALUES (?,?,?,?,?,?,?,?)"
  ).run(
    Number(listing.placeId),
    String(listing.title),
    (listing.description || "").toString(),
    Number(listing.quantity ?? 1),
    Number(listing.price ?? 0),
    String(listing.status || "active"),
    nowISO(),
    JSON.stringify(photoUrls)
  );
  const row = db.prepare("SELECT * FROM listings WHERE id=?").get(info.lastInsertRowid);
  return { ...row, photoUrls };
}

function updateListingPhotos(listingId, photoUrls){
  const id = Number(listingId);
  const cur = db.prepare("SELECT * FROM listings WHERE id=?").get(id);
  if(!cur) return { error:"Listing not found" };
  const urls = normalizePhotoUrls(photoUrls);
  db.prepare("UPDATE listings SET photoUrlsJson=? WHERE id=?").run(JSON.stringify(urls), id);
  const row = db.prepare("SELECT * FROM listings WHERE id=?").get(id);
  return { ...row, photoUrls: urls };
}

function updateListingFields(listingId, patch){
  const id = Number(listingId);
  const cur = db.prepare("SELECT * FROM listings WHERE id=?").get(id);
  if(!cur) return { error:"Listing not found" };

  const title = (patch.title ?? cur.title).toString().trim();
  if(!title) return { error:"title required" };
  const description = (patch.description ?? cur.description ?? "").toString();
  const quantity = Number.isFinite(Number(patch.quantity)) ? Number(patch.quantity) : Number(cur.quantity);
  const price = Number.isFinite(Number(patch.price)) ? Number(patch.price) : Number(cur.price);

  db.prepare("UPDATE listings SET title=?, description=?, quantity=?, price=? WHERE id=?")
    .run(title, description, quantity, price, id);

  const row = db.prepare("SELECT * FROM listings WHERE id=?").get(id);
  return { ...row, photoUrls: parseJsonArray(row.photoUrlsJson || "[]") };
}

function updateListingStatus(listingId, status){
  const id = Number(listingId);
  const cur = db.prepare("SELECT * FROM listings WHERE id=?").get(id);
  if(!cur) return { error:"Listing not found" };
  const allowed = new Set(["active","inactive","sold"]);
  const s = (status || "").toString().trim();
  if(!allowed.has(s)) return { error:"Invalid status" };
  db.prepare("UPDATE listings SET status=? WHERE id=?").run(s, id);
  const row = db.prepare("SELECT * FROM listings WHERE id=?").get(id);
  return { ...row, photoUrls: parseJsonArray(row.photoUrlsJson || "[]") };
}

// ---------- Messaging ----------
function addConversation({ placeId, participant="buyer" }) {
  const info = db.prepare("INSERT INTO conversations (placeId, participant, createdAt) VALUES (?,?,?)")
    .run(Number(placeId), participant, nowISO());
  return db.prepare("SELECT * FROM conversations WHERE id=?").get(info.lastInsertRowid);
}
function addMessage({ conversationId, sender="buyer", text, readBy }) {
  const rb = readBy ? readBy : [sender];
  const info = db.prepare("INSERT INTO messages (conversationId, sender, text, createdAt, readBy) VALUES (?,?,?,?,?)")
    .run(Number(conversationId), sender, text, nowISO(), JSON.stringify(rb));
  const row = db.prepare("SELECT * FROM messages WHERE id=?").get(info.lastInsertRowid);
  return { ...row, readBy: JSON.parse(row.readBy || "[]") };
}

// ---------- Sweep ----------
function getSweepBalance(userId){
  const row=db.prepare("SELECT COALESCE(SUM(amount),0) AS bal FROM sweep_ledger WHERE userId=?").get(Number(userId));
  return row?.bal || 0;
}

module.exports = {
  get districts(){ return getDistricts(); },
  get places(){ return getPlaces(); },
  getListings,

  addListing,
  updateListingPhotos,
  updateListingFields,
  updateListingStatus,

  addConversation,
  getConversationsForPlace,
  addMessage,
  getMessages,

  addSignup,
  createMagicLink,
  consumeMagicToken,
  createSession,
  deleteSession,
  getUserBySession,

  getUserById,
  updateMyProfile,
  getPlaceOwner,
  claimPlace,

  followStore,
  unfollowStore,
  isFollowingStore,
  storeFollowersCount,

  getSweepBalance,
};
