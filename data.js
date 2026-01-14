const Database = require("better-sqlite3");
const crypto = require("crypto");

const db = new Database("town.db");
db.pragma("journal_mode = WAL");

function nowISO() { return new Date().toISOString(); }
function normalizeEmail(e) { return (e || "").toString().trim().toLowerCase(); }
function randToken(bytes = 24) { return crypto.randomBytes(bytes).toString("hex"); }
function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function columnExists(table, col) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((r) => r.name === col);
}
function addColumn(table, colDef) {
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${colDef};`);
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

-- Events: older DBs may have column 'type' instead of 'eventType'.
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
CREATE INDEX IF NOT EXISTS idx_events_createdAt ON events(createdAt);

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

-- Sweep rules v2 (buyer vs seller)
CREATE TABLE IF NOT EXISTS sweep_rules_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  matchEventType TEXT NOT NULL UNIQUE,
  buyerAmount INTEGER NOT NULL,
  sellerAmount INTEGER NOT NULL,
  dailyCap INTEGER NOT NULL,
  cooldownSeconds INTEGER NOT NULL,
  enabled INTEGER NOT NULL
);

-- Sweepstakes
CREATE TABLE IF NOT EXISTS sweepstakes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  prize TEXT NOT NULL,
  entryCost INTEGER NOT NULL,
  startAt TEXT NOT NULL,
  endAt TEXT NOT NULL,
  drawAt TEXT NOT NULL,
  maxEntriesPerUserPerDay INTEGER NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sweepstake_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sweepstakeId INTEGER NOT NULL,
  createdAt TEXT NOT NULL,
  userId INTEGER NOT NULL,
  dayKey TEXT NOT NULL,
  cost INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sweepstake_unique_user_day
ON sweepstake_entries(sweepstakeId, userId, dayKey);
`);

// ---------- Migrations: place fields ----------
(function migratePlaces() {
  if (!columnExists("places", "sellerType")) addColumn("places", "sellerType TEXT NOT NULL DEFAULT 'individual'");
  if (!columnExists("places", "visibilityLevel")) addColumn("places", "visibilityLevel TEXT NOT NULL DEFAULT 'town_only'");
  if (!columnExists("places", "pickupZone")) addColumn("places", "pickupZone TEXT NOT NULL DEFAULT ''");
  if (!columnExists("places", "addressPublic")) addColumn("places", "addressPublic TEXT NOT NULL DEFAULT ''");
  if (!columnExists("places", "addressPrivate")) addColumn("places", "addressPrivate TEXT NOT NULL DEFAULT ''");
  if (!columnExists("places", "meetupInstructions")) addColumn("places", "meetupInstructions TEXT NOT NULL DEFAULT ''");
  if (!columnExists("places", "hours")) addColumn("places", "hours TEXT NOT NULL DEFAULT ''");
  if (!columnExists("places", "verifiedStatus")) addColumn("places", "verifiedStatus TEXT NOT NULL DEFAULT 'unverified'");
})();

// ---------- Seed town if empty ----------
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

  db.prepare("INSERT INTO listings (placeId, title, description, quantity, price, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(102, "Bell Peppers (5 lb bag)", "Fresh, local. Pickup today.", 10, 12, "active", nowISO());
}

// ---------- Seed sweep rules v2 if missing ----------
function ensureRuleV2(matchEventType, buyerAmount, sellerAmount, dailyCap, cooldownSeconds, enabled) {
  const existing = db.prepare("SELECT id FROM sweep_rules_v2 WHERE matchEventType=?").get(matchEventType);
  if (existing) return;
  db.prepare(`
    INSERT INTO sweep_rules_v2 (matchEventType, buyerAmount, sellerAmount, dailyCap, cooldownSeconds, enabled)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(matchEventType, buyerAmount, sellerAmount, dailyCap, cooldownSeconds, enabled ? 1 : 0);
}
ensureRuleV2("district_enter", 0, 0, 0, 0, false);
ensureRuleV2("place_view", 0, 0, 0, 0, false);
ensureRuleV2("message_send", 1, 1, 30, 10, true);
ensureRuleV2("listing_create", 0, 5, 50, 30, true);
ensureRuleV2("listing_mark_sold", 10, 5, 60, 30, true);

// ---------- Core getters ----------
function getDistricts() { return db.prepare("SELECT * FROM districts WHERE townId=1 ORDER BY id").all(); }
function getPlaces() {
  return db.prepare(`
    SELECT id, townId, districtId, name, category, status,
           sellerType, visibilityLevel, pickupZone, addressPublic, addressPrivate,
           meetupInstructions, hours, verifiedStatus
    FROM places WHERE townId=1 ORDER BY id
  `).all();
}
function getListings() { return db.prepare("SELECT * FROM listings ORDER BY id").all(); }
function getMessages() {
  return db.prepare("SELECT * FROM messages ORDER BY id").all()
    .map(m => ({ ...m, readBy: JSON.parse(m.readBy || "[]") }));
}
function getConversationsForPlace(placeId) {
  return db.prepare("SELECT * FROM conversations WHERE placeId=? ORDER BY id").all(Number(placeId));
}

// ---------- Place settings ----------
function updatePlaceSettings(placeId, patch) {
  const id = Number(placeId);
  const exists = db.prepare("SELECT id FROM places WHERE id=?").get(id);
  if (!exists) return { error: "Place not found" };

  const allowedSeller = ["individual","business"];
  const allowedVis = ["town_only","zone","exact_address","meetup_only"];

  const sellerType = allowedSeller.includes(String(patch.sellerType||"")) ? String(patch.sellerType) : null;
  const visibilityLevel = allowedVis.includes(String(patch.visibilityLevel||"")) ? String(patch.visibilityLevel) : null;

  const pickupZone = (patch.pickupZone ?? "").toString();
  const addressPublic = (patch.addressPublic ?? "").toString();
  const addressPrivate = (patch.addressPrivate ?? "").toString();
  const meetupInstructions = (patch.meetupInstructions ?? "").toString();
  const hours = (patch.hours ?? "").toString();

  const sets=[]; const vals=[];
  if (sellerType) { sets.push("sellerType=?"); vals.push(sellerType); }
  if (visibilityLevel) { sets.push("visibilityLevel=?"); vals.push(visibilityLevel); }
  sets.push("pickupZone=?"); vals.push(pickupZone);
  sets.push("addressPublic=?"); vals.push(addressPublic);
  sets.push("addressPrivate=?"); vals.push(addressPrivate);
  sets.push("meetupInstructions=?"); vals.push(meetupInstructions);
  sets.push("hours=?"); vals.push(hours);

  vals.push(id);
  db.prepare(`UPDATE places SET ${sets.join(", ")} WHERE id=?`).run(...vals);

  return db.prepare(`
    SELECT id, townId, districtId, name, category, status,
           sellerType, visibilityLevel, pickupZone, addressPublic, addressPrivate,
           meetupInstructions, hours, verifiedStatus
    FROM places WHERE id=?
  `).get(id);
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

// ---------- Conversations + messages ----------
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
function getUnreadCount(conversationId, viewer="buyer") {
  const rows = db.prepare("SELECT readBy FROM messages WHERE conversationId=?").all(Number(conversationId));
  let unread = 0;
  for (const r of rows) {
    const rb = JSON.parse(r.readBy || "[]");
    if (!rb.includes(viewer)) unread++;
  }
  return unread;
}
function markConversationRead(conversationId, viewer="buyer") {
  const rows = db.prepare("SELECT id, readBy FROM messages WHERE conversationId=?").all(Number(conversationId));
  const upd = db.prepare("UPDATE messages SET readBy=? WHERE id=?");
  for (const r of rows) {
    const rb = JSON.parse(r.readBy || "[]");
    if (!rb.includes(viewer)) rb.push(viewer);
    upd.run(JSON.stringify(rb), r.id);
  }
  return true;
}

// ---------- Signup + auth ----------
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
function getLatestSignupByEmail(email){
  const e=normalizeEmail(email);
  return db.prepare("SELECT * FROM signups WHERE email=? ORDER BY id DESC LIMIT 1").get(e) || null;
}
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
  db.prepare("INSERT INTO magic_links (token,userId,expiresAt,createdAt) VALUES (?,?,?,?)").run(token,user.id,expiresAt,nowISO());
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
  db.prepare("INSERT INTO sessions (sid,userId,expiresAt,createdAt) VALUES (?,?,?,?)").run(sid,userId,expiresAt,nowISO());
  return {sid,expiresAt};
}
function deleteSession(sid){ db.prepare("DELETE FROM sessions WHERE sid=?").run(sid); }
function getUserBySession(sid){
  const sess=db.prepare("SELECT * FROM sessions WHERE sid=?").get(sid);
  if(!sess) return null;
  if(new Date(sess.expiresAt).getTime()<Date.now()){ deleteSession(sid); return null; }
  const user=db.prepare("SELECT * FROM users WHERE id=?").get(sess.userId);
  if(!user) return null;
  const signup=getLatestSignupByEmail(user.email);
  return {user,signup};
}

// ---------- Events logging (compat old schema type vs eventType) ----------
function logEvent(evt) {
  const metaJson = JSON.stringify(evt.meta || {});
  const createdAt = nowISO();
  const hasEventType = columnExists("events", "eventType");
  const hasType = columnExists("events", "type");

  if (hasEventType) {
    const info = db.prepare(`
      INSERT INTO events (createdAt, eventType, townId, districtId, placeId, listingId, conversationId, userId, clientSessionId, metaJson)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(createdAt, evt.eventType, evt.townId ?? 1, evt.districtId ?? null, evt.placeId ?? null, evt.listingId ?? null, evt.conversationId ?? null, evt.userId ?? null, evt.clientSessionId, metaJson);
    return info.lastInsertRowid;
  }
  if (hasType) {
    const info = db.prepare(`
      INSERT INTO events (createdAt, type, townId, districtId, placeId, listingId, conversationId, userId, clientSessionId, metaJson)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(createdAt, evt.eventType, evt.townId ?? 1, evt.districtId ?? null, evt.placeId ?? null, evt.listingId ?? null, evt.conversationId ?? null, evt.userId ?? null, evt.clientSessionId, metaJson);
    return info.lastInsertRowid;
  }
  throw new Error("events table missing both eventType and type columns");
}

// ---------- Sweep ----------
function getSweepBalance(userId){
  const row=db.prepare("SELECT COALESCE(SUM(amount),0) AS bal FROM sweep_ledger WHERE userId=?").get(Number(userId));
  return row.bal||0;
}
function creditSweep({userId,amount,reason,eventId=null,meta={}}){
  const uid=Number(userId);
  if(!uid||!Number.isFinite(Number(amount))||Number(amount)===0) return;
  db.prepare("INSERT INTO sweep_ledger (createdAt,userId,amount,reason,eventId,metaJson) VALUES (?,?,?,?,?,?)")
    .run(nowISO(),uid,Number(amount),reason,eventId,JSON.stringify(meta||{}));
}
function getRuleV2(matchEventType){
  return db.prepare("SELECT * FROM sweep_rules_v2 WHERE matchEventType=?").get(matchEventType) || null;
}
function applySweepRewardForEvent({eventType,userId,eventId,meta}){
  if(!userId) return null;
  const rule = getRuleV2(eventType);
  if(!rule || rule.enabled !== 1) return null;

  const actorRole = (meta?.actorRole || "").toString(); // buyer|seller
  const buyerAmt = Number(rule.buyerAmount) || 0;
  const sellerAmt = Number(rule.sellerAmount) || 0;

  const credited = [];
  if(actorRole === "buyer" && buyerAmt > 0){
    creditSweep({ userId, amount: buyerAmt, reason: `Buyer reward for ${eventType}`, eventId, meta });
    credited.push({ role:"buyer", amount: buyerAmt });
  }
  if(actorRole === "seller" && sellerAmt > 0){
    creditSweep({ userId, amount: sellerAmt, reason: `Seller reward for ${eventType}`, eventId, meta });
    credited.push({ role:"seller", amount: sellerAmt });
  }
  if(credited.length === 0) return null;
  return { credited, matchEventType: rule.matchEventType };
}

// ---------- Sweep rules CRUD ----------
function listSweepRulesV2(){
  return db.prepare("SELECT * FROM sweep_rules_v2 ORDER BY matchEventType").all();
}
function createSweepRuleV2(payload){
  const matchEventType = (payload.matchEventType || "").toString().trim();
  if(!matchEventType) return { error: "matchEventType required" };
  const buyerAmount = Number(payload.buyerAmount || 0);
  const sellerAmount = Number(payload.sellerAmount || 0);
  const dailyCap = Number(payload.dailyCap || 0);
  const cooldownSeconds = Number(payload.cooldownSeconds || 0);
  const enabled = payload.enabled ? 1 : 0;

  try{
    const info = db.prepare(`
      INSERT INTO sweep_rules_v2 (matchEventType,buyerAmount,sellerAmount,dailyCap,cooldownSeconds,enabled)
      VALUES (?,?,?,?,?,?)
    `).run(matchEventType, buyerAmount, sellerAmount, dailyCap, cooldownSeconds, enabled);
    return db.prepare("SELECT * FROM sweep_rules_v2 WHERE id=?").get(info.lastInsertRowid);
  } catch {
    return { error: "matchEventType must be unique" };
  }
}
function updateSweepRuleV2(id, patch){
  const rid = Number(id);
  const rule = db.prepare("SELECT * FROM sweep_rules_v2 WHERE id=?").get(rid);
  if(!rule) return { error:"Rule not found" };

  const matchEventType = (patch.matchEventType ?? rule.matchEventType).toString().trim();
  const buyerAmount = Number.isFinite(Number(patch.buyerAmount)) ? Number(patch.buyerAmount) : rule.buyerAmount;
  const sellerAmount = Number.isFinite(Number(patch.sellerAmount)) ? Number(patch.sellerAmount) : rule.sellerAmount;
  const dailyCap = Number.isFinite(Number(patch.dailyCap)) ? Number(patch.dailyCap) : rule.dailyCap;
  const cooldownSeconds = Number.isFinite(Number(patch.cooldownSeconds)) ? Number(patch.cooldownSeconds) : rule.cooldownSeconds;
  const enabled = patch.enabled ? 1 : 0;

  try {
    db.prepare(`
      UPDATE sweep_rules_v2
      SET matchEventType=?, buyerAmount=?, sellerAmount=?, dailyCap=?, cooldownSeconds=?, enabled=?
      WHERE id=?
    `).run(matchEventType, buyerAmount, sellerAmount, dailyCap, cooldownSeconds, enabled, rid);
  } catch {
    return { error: "matchEventType must be unique" };
  }

  return db.prepare("SELECT * FROM sweep_rules_v2 WHERE id=?").get(rid);
}

// ---------- Sweepstakes ----------
function getActiveSweepstake(){
  const now = nowISO();
  return db.prepare(`
    SELECT * FROM sweepstakes
    WHERE status='active' AND startAt <= ? AND endAt >= ?
    ORDER BY id DESC LIMIT 1
  `).get(now, now) || null;
}
function upsertSweepstake(payload){
  const info = db.prepare(`
    INSERT INTO sweepstakes (status,title,prize,entryCost,startAt,endAt,drawAt,maxEntriesPerUserPerDay,createdAt)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(
    payload.status,
    payload.title,
    payload.prize,
    Number(payload.entryCost),
    payload.startAt,
    payload.endAt,
    payload.drawAt,
    Number(payload.maxEntriesPerUserPerDay),
    nowISO()
  );
  return db.prepare("SELECT * FROM sweepstakes WHERE id=?").get(info.lastInsertRowid);
}
function sweepstakeStats(sweepstakeId){
  const sid = Number(sweepstakeId);
  const totalEntries = db.prepare("SELECT COUNT(*) AS c FROM sweepstake_entries WHERE sweepstakeId=?").get(sid).c;
  const uniqueUsers = db.prepare("SELECT COUNT(DISTINCT userId) AS c FROM sweepstake_entries WHERE sweepstakeId=?").get(sid).c;
  const pot = db.prepare("SELECT COALESCE(SUM(cost),0) AS c FROM sweepstake_entries WHERE sweepstakeId=?").get(sid).c;
  return { totalEntries, uniqueUsers, pot };
}
function enterActiveSweepstake(userId){
  const uid = Number(userId);
  if(!uid) return { error:"Login required" };
  const s = getActiveSweepstake();
  if(!s) return { error:"No active sweepstake" };

  const day = todayKey();
  const maxPerDay = Number(s.maxEntriesPerUserPerDay) || 1;

  const count = db.prepare("SELECT COUNT(*) AS c FROM sweepstake_entries WHERE sweepstakeId=? AND userId=? AND dayKey=?")
    .get(s.id, uid, day).c;
  if(count >= maxPerDay) return { error:`Max entries reached today (${maxPerDay})` };

  const cost = Number(s.entryCost);
  const bal = getSweepBalance(uid);
  if(bal < cost) return { error:"Insufficient sweep balance" };

  creditSweep({ userId: uid, amount: -cost, reason: `Sweepstake entry: ${s.title}`, meta: { sweepstakeId: s.id } });

  db.prepare("INSERT INTO sweepstake_entries (sweepstakeId, createdAt, userId, dayKey, cost) VALUES (?,?,?,?,?)")
    .run(s.id, nowISO(), uid, day, cost);

  const stats = sweepstakeStats(s.id);
  return { ok:true, sweepstake:s, balance:getSweepBalance(uid), ...stats };
}

module.exports = {
  get districts(){ return getDistricts(); },
  get places(){ return getPlaces(); },
  getListings,
  updatePlaceSettings,
  addListing,
  markListingSold,

  addConversation,
  addMessage,
  getMessages,
  getConversationsForPlace,
  getUnreadCount,
  markConversationRead,

  addSignup,
  createMagicLink,
  consumeMagicToken,
  createSession,
  deleteSession,
  getUserBySession,

  logEvent,
  applySweepRewardForEvent,
  getSweepBalance,

  listSweepRulesV2,
  createSweepRuleV2,
  updateSweepRuleV2,

  getActiveSweepstake,
  upsertSweepstake,
  sweepstakeStats,
  enterActiveSweepstake,
};

