const Database = require("better-sqlite3");
const crypto = require("crypto");
const { TRUST, getTownConfig } = require("./town_config");

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

function sanitizeListingType(x){
  const v = (x || "item").toString().trim().toLowerCase();
  const allowed = new Set(["item","offer","request","auction"]);
  return allowed.has(v) ? v : "item";
}
function sanitizeExchangeType(x){
  const v = (x || "money").toString().trim().toLowerCase();
  const allowed = new Set(["money","barter","volunteer","education","hybrid"]);
  return allowed.has(v) ? v : "money";
}
function toISOOrEmpty(x){
  const s = (x || "").toString().trim();
  if(!s) return "";
  const t = Date.parse(s);
  if(Number.isNaN(t)) return "";
  return new Date(t).toISOString();
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

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  createdAt TEXT NOT NULL,
  eventType TEXT NOT NULL,
  townId INTEGER NOT NULL,
  districtId INTEGER,
  placeId INTEGER,
  listingId INTEGER,
  conversationId INTEGER,
  userId INTEGER,
  clientSessionId TEXT NOT NULL,
  metaJson TEXT NOT NULL
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

CREATE TABLE IF NOT EXISTS store_follows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  createdAt TEXT NOT NULL,
  userId INTEGER NOT NULL,
  placeId INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS town_memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  createdAt TEXT NOT NULL,
  townId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  trustLevel TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_membership_unique ON town_memberships(townId, userId);
`);

// ---------- Migrations ----------
(function migratePlaces(){
  if(!columnExists("places","sellerType")) addColumn("places","sellerType TEXT NOT NULL DEFAULT 'individual'");
  if(!columnExists("places","visibilityLevel")) addColumn("places","visibilityLevel TEXT NOT NULL DEFAULT 'town_only'");
  if(!columnExists("places","pickupZone")) addColumn("places","pickupZone TEXT NOT NULL DEFAULT ''");
  if(!columnExists("places","addressPublic")) addColumn("places","addressPublic TEXT NOT NULL DEFAULT ''");
  if(!columnExists("places","addressPrivate")) addColumn("places","addressPrivate TEXT NOT NULL DEFAULT ''");
  if(!columnExists("places","meetupInstructions")) addColumn("places","meetupInstructions TEXT NOT NULL DEFAULT ''");
  if(!columnExists("places","hours")) addColumn("places","hours TEXT NOT NULL DEFAULT ''");
  if(!columnExists("places","verifiedStatus")) addColumn("places","verifiedStatus TEXT NOT NULL DEFAULT 'unverified'");
  if(!columnExists("places","ownerUserId")) addColumn("places","ownerUserId INTEGER");
})();

(function migrateListingExtensions(){
  if(!columnExists("listings","photoUrlsJson")) addColumn("listings","photoUrlsJson TEXT NOT NULL DEFAULT '[]'");
  if(!columnExists("listings","listingType")) addColumn("listings","listingType TEXT NOT NULL DEFAULT 'item'");
  if(!columnExists("listings","exchangeType")) addColumn("listings","exchangeType TEXT NOT NULL DEFAULT 'money'");
  if(!columnExists("listings","startAt")) addColumn("listings","startAt TEXT NOT NULL DEFAULT ''");
  if(!columnExists("listings","endAt")) addColumn("listings","endAt TEXT NOT NULL DEFAULT ''");
})();

// ---------- Core getters ----------
function getPlaces(){
  return db.prepare(`
    SELECT id, townId, districtId, name, category, status,
           sellerType, visibilityLevel, pickupZone, addressPublic, addressPrivate,
           meetupInstructions, hours, verifiedStatus, ownerUserId
    FROM places WHERE townId=1 ORDER BY id
  `).all();
}

function getListings(){
  return db.prepare("SELECT * FROM listings ORDER BY id").all().map(l=>({
    ...l,
    photoUrls: parseJsonArray(l.photoUrlsJson || "[]"),
    listingType: l.listingType || "item",
    exchangeType: l.exchangeType || "money",
    startAt: l.startAt || "",
    endAt: l.endAt || "",
  }));
}

// ---------- Trust / memberships ----------
function ensureTownMembership(townId, userId){
  const tid = Number(townId || 1);
  const uid = Number(userId);
  const cfg = getTownConfig(tid);
  const defaultLevel = cfg.trustDefaults?.defaultLevel || TRUST.VISITOR;

  const existing = db.prepare("SELECT * FROM town_memberships WHERE townId=? AND userId=?").get(tid, uid);
  if(existing) return existing;

  db.prepare("INSERT INTO town_memberships (createdAt, townId, userId, trustLevel, notes) VALUES (?,?,?,?,?)")
    .run(nowISO(), tid, uid, defaultLevel, "");
  return db.prepare("SELECT * FROM town_memberships WHERE townId=? AND userId=?").get(tid, uid);
}

function getCapabilitiesFor(townId, trustLevel){
  const cfg = getTownConfig(Number(townId || 1));
  return cfg.capabilitiesByTrust?.[trustLevel] || cfg.capabilitiesByTrust?.[TRUST.VISITOR] || {};
}

function getTownContext(townId, userId){
  const tid = Number(townId || 1);
  const cfg = getTownConfig(tid);

  if(!userId){
    const trustLevel = cfg.trustDefaults?.defaultLevel || TRUST.VISITOR;
    return { town: cfg, membership: null, trustLevel, capabilities: getCapabilitiesFor(tid, trustLevel) };
  }

  const membership = ensureTownMembership(tid, userId);
  const trustLevel = membership.trustLevel;
  return { town: cfg, membership, trustLevel, capabilities: getCapabilitiesFor(tid, trustLevel) };
}

// ---------- Auth ----------
function upsertUserByEmail(email){
  const e = normalizeEmail(email);
  if(!e) return null;
  const existing = db.prepare("SELECT * FROM users WHERE email=?").get(e);
  if(existing) return existing;
  const info = db.prepare("INSERT INTO users (email, createdAt) VALUES (?,?)").run(e, nowISO());
  return db.prepare("SELECT * FROM users WHERE id=?").get(info.lastInsertRowid);
}
function createMagicLink(email){
  const user = upsertUserByEmail(email);
  if(!user) return {error:"Invalid email"};
  const token = randToken(24);
  const expiresAt = new Date(Date.now()+15*60*1000).toISOString();
  db.prepare("INSERT INTO magic_links (token,userId,expiresAt,createdAt) VALUES (?,?,?,?)")
    .run(token,user.id,expiresAt,nowISO());
  return {token,userId:user.id,expiresAt};
}
function consumeMagicToken(token){
  const row = db.prepare("SELECT * FROM magic_links WHERE token=?").get(token);
  if(!row) return {error:"Invalid token"};
  if(new Date(row.expiresAt).getTime() < Date.now()){
    db.prepare("DELETE FROM magic_links WHERE token=?").run(token);
    return {error:"Token expired"};
  }
  db.prepare("DELETE FROM magic_links WHERE token=?").run(token);
  return {userId: row.userId};
}
function createSession(userId){
  const sid = randToken(24);
  const expiresAt = new Date(Date.now()+30*24*60*60*1000).toISOString();
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

// ---------- Events + sweep ----------
function logEvent(evt){
  const metaJson = JSON.stringify(evt.meta || {});
  const createdAt = nowISO();
  const info = db.prepare(`
    INSERT INTO events (createdAt, eventType, townId, districtId, placeId, listingId, conversationId, userId, clientSessionId, metaJson)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(createdAt, evt.eventType, evt.townId ?? 1, evt.districtId ?? null, evt.placeId ?? null, evt.listingId ?? null, evt.conversationId ?? null, evt.userId ?? null, evt.clientSessionId, metaJson);
  return info.lastInsertRowid;
}
function getSweepBalance(userId){
  const row=db.prepare("SELECT COALESCE(SUM(amount),0) AS bal FROM sweep_ledger WHERE userId=?").get(Number(userId));
  return row?.bal || 0;
}

// ---------- Listing creation (new) ----------
function addListing(payload){
  const listingType = sanitizeListingType(payload.listingType);
  const exchangeType = sanitizeExchangeType(payload.exchangeType);
  const startAt = toISOOrEmpty(payload.startAt);
  const endAt = toISOOrEmpty(payload.endAt);
  const photoUrls = normalizePhotoUrls(payload.photoUrls || []);

  const info = db.prepare(`
    INSERT INTO listings
      (placeId, title, description, quantity, price, status, createdAt, photoUrlsJson, listingType, exchangeType, startAt, endAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    Number(payload.placeId),
    String(payload.title),
    (payload.description || "").toString(),
    Number.isFinite(Number(payload.quantity)) ? Number(payload.quantity) : 1,
    Number.isFinite(Number(payload.price)) ? Number(payload.price) : 0,
    (payload.status || "active").toString(),
    nowISO(),
    JSON.stringify(photoUrls),
    listingType,
    exchangeType,
    startAt,
    endAt
  );

  const row = db.prepare("SELECT * FROM listings WHERE id=?").get(info.lastInsertRowid);
  return {
    ...row,
    photoUrls,
    listingType,
    exchangeType,
    startAt: row.startAt || "",
    endAt: row.endAt || "",
  };
}

module.exports = {
  get places(){ return getPlaces(); },
  getListings,

  // trust
  ensureTownMembership,
  getTownContext,
  getCapabilitiesFor,

  // auth
  createMagicLink,
  consumeMagicToken,
  createSession,
  deleteSession,
  getUserBySession,

  // events + sweep
  logEvent,
  getSweepBalance,

  // listings
  addListing,
};
