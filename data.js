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
  createdAt TEXT NOT NULL,
  offerCategory TEXT NOT NULL DEFAULT '',
  availabilityWindow TEXT NOT NULL DEFAULT '',
  compensationType TEXT NOT NULL DEFAULT '',
  auctionStartAt TEXT NOT NULL DEFAULT '',
  auctionEndAt TEXT NOT NULL DEFAULT '',
  startBidCents INTEGER NOT NULL DEFAULT 0,
  minIncrementCents INTEGER NOT NULL DEFAULT 0,
  reserveCents INTEGER,
  buyNowCents INTEGER
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listingId INTEGER NOT NULL,
  buyerUserId INTEGER NOT NULL,
  sellerUserId INTEGER,
  quantity INTEGER NOT NULL,
  amountCents INTEGER NOT NULL,
  status TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  completedAt TEXT,
  paymentProvider TEXT NOT NULL,
  paymentIntentId TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  orderId INTEGER NOT NULL,
  reviewerUserId INTEGER NOT NULL,
  revieweeUserId INTEGER NOT NULL,
  role TEXT NOT NULL,
  rating INTEGER NOT NULL,
  text TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS disputes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  orderId INTEGER NOT NULL,
  reporterUserId INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  resolvedAt TEXT,
  resolutionNote TEXT
);

CREATE TABLE IF NOT EXISTS trust_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  orderId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  eventType TEXT NOT NULL,
  metaJson TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listingId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  amountCents INTEGER NOT NULL,
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

CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  isPublic INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channelId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS message_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channelId INTEGER NOT NULL,
  createdBy INTEGER NOT NULL,
  createdAt TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS channel_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channelId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  text TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  replyToId INTEGER,
  threadId INTEGER NOT NULL
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

CREATE TABLE IF NOT EXISTS event_rsvps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  eventId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  status TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS store_follows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  createdAt TEXT NOT NULL,
  userId INTEGER NOT NULL,
  placeId INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyerUserId, createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(sellerUserId, createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_order_reviewer ON reviews(orderId, reviewerUserId);
CREATE INDEX IF NOT EXISTS idx_disputes_order ON disputes(orderId);
CREATE INDEX IF NOT EXISTS idx_trust_events_user ON trust_events(userId, createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_event_rsvp_unique ON event_rsvps(eventId, userId);

CREATE INDEX IF NOT EXISTS idx_channel_membership_unique ON channel_memberships(channelId, userId);
CREATE INDEX IF NOT EXISTS idx_channel_messages_channel_created ON channel_messages(channelId, createdAt);
CREATE INDEX IF NOT EXISTS idx_channel_messages_thread ON channel_messages(threadId, createdAt);

CREATE INDEX IF NOT EXISTS idx_bids_listing_amount ON bids(listingId, amountCents DESC, createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_bids_listing_user ON bids(listingId, userId, createdAt DESC);

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
  if(!columnExists("listings","offerCategory")) addColumn("listings","offerCategory TEXT NOT NULL DEFAULT ''");
  if(!columnExists("listings","availabilityWindow")) addColumn("listings","availabilityWindow TEXT NOT NULL DEFAULT ''");
  if(!columnExists("listings","compensationType")) addColumn("listings","compensationType TEXT NOT NULL DEFAULT ''");
  if(!columnExists("listings","auctionStartAt")) addColumn("listings","auctionStartAt TEXT NOT NULL DEFAULT ''");
  if(!columnExists("listings","auctionEndAt")) addColumn("listings","auctionEndAt TEXT NOT NULL DEFAULT ''");
  if(!columnExists("listings","startBidCents")) addColumn("listings","startBidCents INTEGER NOT NULL DEFAULT 0");
  if(!columnExists("listings","minIncrementCents")) addColumn("listings","minIncrementCents INTEGER NOT NULL DEFAULT 0");
  if(!columnExists("listings","reserveCents")) addColumn("listings","reserveCents INTEGER");
  if(!columnExists("listings","buyNowCents")) addColumn("listings","buyNowCents INTEGER");
})();

(function migrateCalendarEvents(){
  if(!columnExists("events","title")) addColumn("events","title TEXT NOT NULL DEFAULT ''");
  if(!columnExists("events","description")) addColumn("events","description TEXT NOT NULL DEFAULT ''");
  if(!columnExists("events","startsAt")) addColumn("events","startsAt TEXT NOT NULL DEFAULT ''");
  if(!columnExists("events","endsAt")) addColumn("events","endsAt TEXT NOT NULL DEFAULT ''");
  if(!columnExists("events","locationName")) addColumn("events","locationName TEXT NOT NULL DEFAULT ''");
  if(!columnExists("events","isPublic")) addColumn("events","isPublic INTEGER NOT NULL DEFAULT 1");
  if(!columnExists("events","organizerUserId")) addColumn("events","organizerUserId INTEGER");
})();

// ---------- Seed ----------
(function seedChannels(){
  const row = db.prepare("SELECT COUNT(*) AS c FROM channels").get();
  if((row?.c || 0) > 0) return;
  const now = nowISO();
  db.prepare("INSERT INTO channels (name, description, isPublic, createdAt) VALUES (?,?,?,?)").run("announcements","Town-wide updates",1,now);
  db.prepare("INSERT INTO channels (name, description, isPublic, createdAt) VALUES (?,?,?,?)").run("marketplace","Local offers and requests",1,now);
  db.prepare("INSERT INTO channels (name, description, isPublic, createdAt) VALUES (?,?,?,?)").run("events","Upcoming events and meetups",1,now);
  db.prepare("INSERT INTO channels (name, description, isPublic, createdAt) VALUES (?,?,?,?)").run("general","Community discussion",1,now);
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
    offerCategory: l.offerCategory || "",
    availabilityWindow: l.availabilityWindow || "",
    compensationType: l.compensationType || "",
    auctionStartAt: l.auctionStartAt || "",
    auctionEndAt: l.auctionEndAt || "",
    startBidCents: Number(l.startBidCents || 0),
    minIncrementCents: Number(l.minIncrementCents || 0),
    reserveCents: l.reserveCents == null ? null : Number(l.reserveCents),
    buyNowCents: l.buyNowCents == null ? null : Number(l.buyNowCents),
  }));
}

function getChannels(){
  return db.prepare("SELECT id, name, description, isPublic, createdAt FROM channels ORDER BY id").all();
}
function getChannelById(id){
  return db.prepare("SELECT id, name, description, isPublic, createdAt FROM channels WHERE id=?")
    .get(Number(id)) || null;
}
function isChannelMember(channelId, userId){
  return db.prepare("SELECT 1 FROM channel_memberships WHERE channelId=? AND userId=?")
    .get(Number(channelId), Number(userId)) || null;
}
function getChannelMessages(channelId, limit=200){
  return db.prepare(`
    SELECT id, channelId, userId, text, createdAt, replyToId, threadId
    FROM channel_messages
    WHERE channelId=?
    ORDER BY createdAt ASC
    LIMIT ?
  `).all(Number(channelId), Number(limit));
}
function getChannelMessageById(id){
  return db.prepare(`
    SELECT id, channelId, userId, text, createdAt, replyToId, threadId
    FROM channel_messages
    WHERE id=?
  `).get(Number(id)) || null;
}
function createChannelThread(channelId, userId){
  const info = db.prepare("INSERT INTO message_threads (channelId, createdBy, createdAt) VALUES (?,?,?)")
    .run(Number(channelId), Number(userId), nowISO());
  return info.lastInsertRowid;
}
function addChannelMessage(channelId, userId, text, replyToId, threadId){
  const info = db.prepare("INSERT INTO channel_messages (channelId, userId, text, createdAt, replyToId, threadId) VALUES (?,?,?,?,?,?)")
    .run(Number(channelId), Number(userId), String(text), nowISO(), replyToId ?? null, Number(threadId));
  return { id: info.lastInsertRowid };
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

function getListingById(id){
  const l = db.prepare("SELECT * FROM listings WHERE id=?").get(Number(id));
  if(!l) return null;
  return {
    ...l,
    photoUrls: parseJsonArray(l.photoUrlsJson || "[]"),
    listingType: l.listingType || "item",
    exchangeType: l.exchangeType || "money",
    startAt: l.startAt || "",
    endAt: l.endAt || "",
    auctionStartAt: l.auctionStartAt || "",
    auctionEndAt: l.auctionEndAt || "",
    startBidCents: Number(l.startBidCents || 0),
    minIncrementCents: Number(l.minIncrementCents || 0),
    reserveCents: l.reserveCents == null ? null : Number(l.reserveCents),
    buyNowCents: l.buyNowCents == null ? null : Number(l.buyNowCents),
  };
}
function getHighestBidForListing(listingId){
  return db.prepare("SELECT amountCents, userId, createdAt FROM bids WHERE listingId=? ORDER BY amountCents DESC, createdAt DESC LIMIT 1")
    .get(Number(listingId)) || null;
}
function getBidCountForListing(listingId){
  const row = db.prepare("SELECT COUNT(*) AS c FROM bids WHERE listingId=?").get(Number(listingId));
  return row?.c || 0;
}
function getLastBidForUser(listingId, userId){
  return db.prepare("SELECT createdAt FROM bids WHERE listingId=? AND userId=? ORDER BY createdAt DESC LIMIT 1")
    .get(Number(listingId), Number(userId)) || null;
}
function addBid(listingId, userId, amountCents){
  const createdAt = nowISO();
  const info = db.prepare("INSERT INTO bids (listingId,userId,amountCents,createdAt) VALUES (?,?,?,?)")
    .run(Number(listingId), Number(userId), Number(amountCents), createdAt);
  return {id: info.lastInsertRowid, listingId:Number(listingId), userId:Number(userId), amountCents:Number(amountCents), createdAt};
}
function getAuctionSummary(listingId){
  const highest = getHighestBidForListing(listingId);
  const bidCount = getBidCountForListing(listingId);
  return {highestBidCents: highest?.amountCents || 0, bidCount};
}

function addSignup(payload){
  const name=(payload?.name||"").toString().trim();
  const email=normalizeEmail(payload?.email);
  const address1=(payload?.address1||"").toString().trim();
  const address2=(payload?.address2||"").toString().trim();
  const city=(payload?.city||"").toString().trim();
  const state=(payload?.state||"").toString().trim();
  const zip=(payload?.zip||"").toString().trim();
  if(!name||!email||!address1||!city||!state||!zip){
    return {error:"Missing required fields"};
  }
  const cityMatch=city.toLowerCase().includes("sebastian");
  const zipMatch=zip==="32958";
  const status=(cityMatch||zipMatch) ? "eligible" : "waitlist";
  const reason=(status==="eligible")
    ? "Address matches Sebastian pilot."
    : "Outside Sebastian/32958; added to waitlist.";

  db.prepare("INSERT INTO signups (name,email,address1,address2,city,state,zip,status,reason,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(name,email,address1,address2,city,state,zip,status,reason,nowISO());
  return {status,reason};
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

function addCalendarEvent(payload, userId){
  const createdAt = nowISO();
  const title = (payload.title || "").toString().trim();
  const description = (payload.description || "").toString().trim();
  const startsAt = toISOOrEmpty(payload.startsAt);
  const endsAt = toISOOrEmpty(payload.endsAt);
  const locationName = (payload.locationName || "").toString().trim();
  const isPublic = payload.isPublic === false ? 0 : 1;
  const placeId = payload.placeId != null ? Number(payload.placeId) : null;
  const info = db.prepare(`
    INSERT INTO events
      (createdAt, eventType, townId, districtId, placeId, listingId, conversationId, userId, clientSessionId, metaJson,
       title, description, startsAt, endsAt, locationName, isPublic, organizerUserId)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    createdAt,
    "calendar_event",
    1,
    null,
    placeId,
    null,
    null,
    null,
    "",
    "{}",
    title,
    description,
    startsAt,
    endsAt,
    locationName,
    isPublic,
    Number(userId)
  );
  return db.prepare("SELECT * FROM events WHERE id=?").get(info.lastInsertRowid);
}

function getCalendarEvents(range){
  const now = new Date();
  const start = now.toISOString();
  const end = new Date(now.getTime() + (range==="month" ? 30 : 7) * 24 * 60 * 60 * 1000).toISOString();
  return db.prepare(`
    SELECT id, title, description, startsAt, endsAt, locationName, isPublic, placeId, organizerUserId, createdAt
    FROM events
    WHERE eventType='calendar_event' AND startsAt >= ? AND startsAt <= ?
    ORDER BY startsAt ASC
  `).all(start, end);
}

function getCalendarEventById(id){
  return db.prepare(`
    SELECT id, title, description, startsAt, endsAt, locationName, isPublic, placeId, organizerUserId, createdAt
    FROM events
    WHERE id=? AND eventType='calendar_event'
  `).get(Number(id)) || null;
}

function addEventRsvp(eventId, userId, status="going"){
  db.prepare("INSERT OR REPLACE INTO event_rsvps (eventId, userId, status, createdAt) VALUES (?,?,?,?)")
    .run(Number(eventId), Number(userId), status, nowISO());
  return { ok:true };
}

function addOrder(payload){
  const createdAt = nowISO();
  const info = db.prepare(`
    INSERT INTO orders
      (listingId, buyerUserId, sellerUserId, quantity, amountCents, status, createdAt, completedAt, paymentProvider, paymentIntentId)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(
    Number(payload.listingId),
    Number(payload.buyerUserId),
    payload.sellerUserId == null ? null : Number(payload.sellerUserId),
    Number(payload.quantity),
    Number(payload.amountCents),
    String(payload.status || "pending"),
    createdAt,
    null,
    String(payload.paymentProvider || "stub"),
    String(payload.paymentIntentId || "")
  );
  return db.prepare("SELECT * FROM orders WHERE id=?").get(info.lastInsertRowid);
}
function getOrderById(id){
  return db.prepare("SELECT * FROM orders WHERE id=?").get(Number(id)) || null;
}
function completeOrder(id){
  const completedAt = nowISO();
  db.prepare("UPDATE orders SET status='completed', completedAt=? WHERE id=?").run(completedAt, Number(id));
  return db.prepare("SELECT * FROM orders WHERE id=?").get(Number(id));
}

function getReviewForOrder(orderId, reviewerUserId){
  return db.prepare("SELECT * FROM reviews WHERE orderId=? AND reviewerUserId=?")
    .get(Number(orderId), Number(reviewerUserId)) || null;
}
function addReview(payload){
  const info=db.prepare(`
    INSERT INTO reviews (orderId, reviewerUserId, revieweeUserId, role, rating, text, createdAt)
    VALUES (?,?,?,?,?,?,?)
  `).run(
    Number(payload.orderId),
    Number(payload.reviewerUserId),
    Number(payload.revieweeUserId),
    String(payload.role),
    Number(payload.rating),
    String(payload.text || ""),
    nowISO()
  );
  return db.prepare("SELECT * FROM reviews WHERE id=?").get(info.lastInsertRowid);
}
function addDispute(payload){
  const info=db.prepare(`
    INSERT INTO disputes (orderId, reporterUserId, reason, status, createdAt)
    VALUES (?,?,?,?,?)
  `).run(
    Number(payload.orderId),
    Number(payload.reporterUserId),
    String(payload.reason || ""),
    String(payload.status || "open"),
    nowISO()
  );
  return db.prepare("SELECT * FROM disputes WHERE id=?").get(info.lastInsertRowid);
}
function listReviews(limit=200){
  return db.prepare("SELECT * FROM reviews ORDER BY createdAt DESC LIMIT ?").all(Number(limit));
}
function listDisputes(limit=200){
  return db.prepare("SELECT * FROM disputes ORDER BY createdAt DESC LIMIT ?").all(Number(limit));
}
function addTrustEvent(payload){
  db.prepare("INSERT INTO trust_events (orderId, userId, eventType, metaJson, createdAt) VALUES (?,?,?,?,?)")
    .run(Number(payload.orderId), Number(payload.userId), String(payload.eventType), JSON.stringify(payload.meta||{}), nowISO());
}

// ---------- Listing creation (new) ----------
function addListing(payload){
  const listingType = sanitizeListingType(payload.listingType);
  const exchangeType = sanitizeExchangeType(payload.exchangeType);
  const startAt = toISOOrEmpty(payload.startAt);
  const endAt = toISOOrEmpty(payload.endAt);
  const offerCategory = (payload.offerCategory || "").toString().trim();
  const availabilityWindow = (payload.availabilityWindow || "").toString().trim();
  const compensationType = (payload.compensationType || "").toString().trim();
  const auctionStartAt = toISOOrEmpty(payload.auctionStartAt);
  const auctionEndAt = toISOOrEmpty(payload.auctionEndAt);
  const startBidCents = Number.isFinite(Number(payload.startBidCents)) ? Number(payload.startBidCents) : 0;
  const minIncrementCents = Number.isFinite(Number(payload.minIncrementCents)) ? Number(payload.minIncrementCents) : 0;
  const reserveRaw = payload.reserveCents;
  const buyNowRaw = payload.buyNowCents;
  const reserveCents = (reserveRaw === "" || reserveRaw == null) ? null : Number(reserveRaw);
  const buyNowCents = (buyNowRaw === "" || buyNowRaw == null) ? null : Number(buyNowRaw);
  const reserveVal = Number.isFinite(reserveCents) ? reserveCents : null;
  const buyNowVal = Number.isFinite(buyNowCents) ? buyNowCents : null;
  const photoUrls = normalizePhotoUrls(payload.photoUrls || []);

  const info = db.prepare(`
    INSERT INTO listings
      (placeId, title, description, quantity, price, status, createdAt, photoUrlsJson, listingType, exchangeType, startAt, endAt, offerCategory, availabilityWindow, compensationType, auctionStartAt, auctionEndAt, startBidCents, minIncrementCents, reserveCents, buyNowCents)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
    endAt,
    offerCategory,
    availabilityWindow,
    compensationType,
    auctionStartAt,
    auctionEndAt,
    startBidCents,
    minIncrementCents,
    reserveVal,
    buyNowVal
  );

  const row = db.prepare("SELECT * FROM listings WHERE id=?").get(info.lastInsertRowid);
  return {
    ...row,
    photoUrls,
    listingType,
    exchangeType,
    startAt: row.startAt || "",
    endAt: row.endAt || "",
    offerCategory: row.offerCategory || "",
    availabilityWindow: row.availabilityWindow || "",
    compensationType: row.compensationType || "",
    auctionStartAt: row.auctionStartAt || "",
    auctionEndAt: row.auctionEndAt || "",
    startBidCents: Number(row.startBidCents || 0),
    minIncrementCents: Number(row.minIncrementCents || 0),
    reserveCents: row.reserveCents == null ? null : Number(row.reserveCents),
    buyNowCents: row.buyNowCents == null ? null : Number(row.buyNowCents),
  };
}

module.exports = {
  get places(){ return getPlaces(); },
  getListings,
  getListingById,
  getHighestBidForListing,
  getBidCountForListing,
  getLastBidForUser,
  addBid,
  getAuctionSummary,
  getChannels,
  getChannelById,
  isChannelMember,
  getChannelMessages,
  getChannelMessageById,
  createChannelThread,
  addChannelMessage,

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
  addSignup,

  // events + sweep
  logEvent,
  getSweepBalance,
  addCalendarEvent,
  getCalendarEvents,
  getCalendarEventById,
  addEventRsvp,
  addOrder,
  getOrderById,
  completeOrder,
  getReviewForOrder,
  addReview,
  addDispute,
  listReviews,
  listDisputes,
  addTrustEvent,

  // listings
  addListing,
};
