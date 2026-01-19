const Database = require("better-sqlite3");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
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
  description TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  yearsInTown TEXT NOT NULL DEFAULT '',
  bannerUrl TEXT NOT NULL DEFAULT '',
  avatarUrl TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  townId INTEGER NOT NULL DEFAULT 1,
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
  buyNowCents INTEGER,
  auctionStatus TEXT NOT NULL DEFAULT 'active',
  winningBidId INTEGER,
  winnerUserId INTEGER,
  paymentDueAt TEXT NOT NULL DEFAULT '',
  paymentStatus TEXT NOT NULL DEFAULT 'none'
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  townId INTEGER NOT NULL DEFAULT 1,
  listingId INTEGER NOT NULL,
  buyerUserId INTEGER NOT NULL,
  sellerUserId INTEGER,
  sellerPlaceId INTEGER,
  quantity INTEGER NOT NULL,
  amountCents INTEGER NOT NULL,
  status TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL DEFAULT '',
  completedAt TEXT,
  paymentProvider TEXT NOT NULL,
  paymentIntentId TEXT NOT NULL,
  subtotalCents INTEGER NOT NULL DEFAULT 0,
  serviceGratuityCents INTEGER NOT NULL DEFAULT 0,
  totalCents INTEGER NOT NULL DEFAULT 0,
  fulfillmentType TEXT NOT NULL DEFAULT '',
  fulfillmentNotes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  orderId INTEGER NOT NULL,
  listingId INTEGER NOT NULL,
  titleSnapshot TEXT NOT NULL,
  priceCentsSnapshot INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  sellerPlaceId INTEGER NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cart_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  townId INTEGER NOT NULL DEFAULT 1,
  userId INTEGER NOT NULL,
  listingId INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  createdAt TEXT NOT NULL,
  UNIQUE(userId, listingId)
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  orderId INTEGER NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  amountCents INTEGER NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  townId INTEGER NOT NULL DEFAULT 1,
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
  townId INTEGER NOT NULL DEFAULT 1,
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
  townId INTEGER NOT NULL DEFAULT 1,
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

CREATE TABLE IF NOT EXISTS direct_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  townId INTEGER NOT NULL DEFAULT 1,
  userA INTEGER NOT NULL,
  userB INTEGER NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS direct_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  townId INTEGER NOT NULL DEFAULT 1,
  conversationId INTEGER NOT NULL,
  senderUserId INTEGER NOT NULL,
  text TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  townId INTEGER NOT NULL DEFAULT 1,
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
  imageUrl TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  replyToId INTEGER,
  threadId INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS live_rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  townId INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'idle',
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  hostUserId INTEGER NOT NULL,
  hostPlaceId INTEGER,
  hostEventId INTEGER,
  hostType TEXT NOT NULL DEFAULT 'individual',
  hostChannelId INTEGER,
  pinnedListingId INTEGER,
  createdAt TEXT NOT NULL,
  startedAt TEXT NOT NULL DEFAULT '',
  endedAt TEXT NOT NULL DEFAULT '',
  cfRoomId TEXT NOT NULL DEFAULT '',
  cfRoomToken TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS live_show_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  townId INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'scheduled',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  startAt TEXT NOT NULL,
  endAt TEXT NOT NULL DEFAULT '',
  hostUserId INTEGER NOT NULL,
  hostType TEXT NOT NULL DEFAULT 'individual',
  hostPlaceId INTEGER,
  hostEventId INTEGER,
  thumbnailUrl TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS live_show_bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  townId INTEGER NOT NULL DEFAULT 1,
  userId INTEGER NOT NULL,
  showId INTEGER NOT NULL,
  createdAt TEXT NOT NULL,
  UNIQUE(userId, showId)
);
CREATE TABLE IF NOT EXISTS signups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  townId INTEGER NOT NULL DEFAULT 1,
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
CREATE TABLE IF NOT EXISTS trust_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  townId INTEGER NOT NULL DEFAULT 1,
  userId INTEGER NOT NULL,
  requestedTier INTEGER NOT NULL,
  status TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  address1 TEXT NOT NULL,
  address2 TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT NOT NULL,
  identityMethod TEXT NOT NULL,
  identityStatus TEXT NOT NULL,
  presenceStatus TEXT NOT NULL,
  presenceVerifiedAt TEXT NOT NULL DEFAULT '',
  presenceLat REAL,
  presenceLng REAL,
  presenceAccuracyMeters REAL,
  createdAt TEXT NOT NULL,
  reviewedAt TEXT NOT NULL DEFAULT '',
  reviewedByUserId INTEGER,
  decisionReason TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS resident_verification_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  townId INTEGER NOT NULL DEFAULT 1,
  userId INTEGER NOT NULL,
  status TEXT NOT NULL,
  addressLine1 TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  reviewedAt TEXT NOT NULL DEFAULT '',
  reviewedByUserId INTEGER,
  decisionReason TEXT NOT NULL DEFAULT ''
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

CREATE TABLE IF NOT EXISTS events_v1 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  townId INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  startAt TEXT NOT NULL,
  endAt TEXT NOT NULL,
  locationName TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  placeId INTEGER,
  organizerName TEXT NOT NULL,
  organizerEmail TEXT NOT NULL,
  organizerPhone TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'community',
  imageUrl TEXT NOT NULL DEFAULT '',
  notesToAdmin TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  reviewedAt TEXT NOT NULL DEFAULT '',
  reviewedByUserId INTEGER,
  decisionReason TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS archive_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  townId INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'published',
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  bodyMarkdown TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  createdByUserId INTEGER,
  pinned INTEGER NOT NULL DEFAULT 0,
  tagsJson TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS daily_pulses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  townId INTEGER NOT NULL DEFAULT 1,
  dayKey TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'published',
  metricsJson TEXT NOT NULL DEFAULT '{}',
  highlightsJson TEXT NOT NULL DEFAULT '{}',
  markdownBody TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_business_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  townId INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  businessName TEXT NOT NULL,
  ownerName TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT NOT NULL,
  category TEXT NOT NULL,
  website TEXT NOT NULL DEFAULT '',
  instagram TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  sustainabilityNotes TEXT NOT NULL DEFAULT '',
  confirmSebastian INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  reviewedAt TEXT NOT NULL DEFAULT '',
  reviewedByUserId INTEGER,
  decisionReason TEXT NOT NULL DEFAULT '',
  userId INTEGER
);

CREATE TABLE IF NOT EXISTS waitlist_signups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  createdAt TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  interests TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS business_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  createdAt TEXT NOT NULL,
  contactName TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  businessName TEXT NOT NULL,
  type TEXT NOT NULL,
  category TEXT NOT NULL,
  website TEXT NOT NULL DEFAULT '',
  inSebastian TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS resident_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  createdAt TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  addressLine1 TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT NOT NULL,
  yearsInSebastian TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS event_rsvps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  townId INTEGER NOT NULL DEFAULT 1,
  eventId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  status TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sweep_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  townId INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  userId INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  eventId INTEGER,
  metaJson TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sweepstakes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  townId INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  prize TEXT NOT NULL,
  entryCost INTEGER NOT NULL,
  startAt TEXT NOT NULL,
  endAt TEXT NOT NULL,
  drawAt TEXT NOT NULL,
  maxEntriesPerUserPerDay INTEGER NOT NULL DEFAULT 1,
  winnerUserId INTEGER,
  winnerEntryId INTEGER,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sweepstake_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  townId INTEGER NOT NULL DEFAULT 1,
  sweepstakeId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  entries INTEGER NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sweep_draws (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sweepId INTEGER NOT NULL,
  createdAt TEXT NOT NULL,
  createdByUserId INTEGER,
  winnerUserId INTEGER NOT NULL,
  totalEntries INTEGER NOT NULL,
  snapshotJson TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS store_follows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  townId INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  userId INTEGER NOT NULL,
  placeId INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS media_objects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  townId INTEGER NOT NULL DEFAULT 1,
  ownerUserId INTEGER NOT NULL,
  placeId INTEGER,
  listingId INTEGER,
  eventId INTEGER,
  kind TEXT NOT NULL,
  storageDriver TEXT NOT NULL,
  key TEXT NOT NULL,
  url TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  deletedAt TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyerUserId, createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(sellerUserId, createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_orders_seller_place_created ON orders(sellerPlaceId, createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(orderId);
CREATE INDEX IF NOT EXISTS idx_reviews_order_reviewer ON reviews(orderId, reviewerUserId);
CREATE INDEX IF NOT EXISTS idx_disputes_order ON disputes(orderId);
CREATE INDEX IF NOT EXISTS idx_trust_events_user ON trust_events(userId, createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_event_rsvp_unique ON event_rsvps(eventId, userId);
CREATE INDEX IF NOT EXISTS idx_events_v1_town_status_start ON events_v1(townId, status, startAt);
CREATE INDEX IF NOT EXISTS idx_archive_entries_town_status ON archive_entries(townId, status, createdAt);
CREATE INDEX IF NOT EXISTS idx_archive_entries_pinned ON archive_entries(townId, status, pinned, createdAt);
CREATE INDEX IF NOT EXISTS idx_daily_pulses_town_day ON daily_pulses(townId, dayKey);
CREATE INDEX IF NOT EXISTS idx_daily_pulses_created ON daily_pulses(createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_localbiz_status ON local_business_applications(townId, status, createdAt);
CREATE INDEX IF NOT EXISTS idx_localbiz_user ON local_business_applications(userId, createdAt);
CREATE INDEX IF NOT EXISTS idx_waitlist_status ON waitlist_signups(status, createdAt);
CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist_signups(email);
CREATE INDEX IF NOT EXISTS idx_business_apps_status ON business_applications(status, createdAt);
CREATE INDEX IF NOT EXISTS idx_business_apps_email ON business_applications(email);
CREATE INDEX IF NOT EXISTS idx_resident_apps_status ON resident_applications(status, createdAt);
CREATE INDEX IF NOT EXISTS idx_resident_apps_email ON resident_applications(email);
-- townId indexes created in migrations to avoid errors on existing DBs

CREATE INDEX IF NOT EXISTS idx_channel_membership_unique ON channel_memberships(channelId, userId);
CREATE INDEX IF NOT EXISTS idx_channel_messages_channel_created ON channel_messages(channelId, createdAt);
CREATE INDEX IF NOT EXISTS idx_channel_messages_thread ON channel_messages(threadId, createdAt);

CREATE INDEX IF NOT EXISTS idx_bids_listing_amount ON bids(listingId, amountCents DESC, createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_bids_listing_user ON bids(listingId, userId, createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_sweepstake_entries_sweepstake ON sweepstake_entries(sweepstakeId, createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_sweepstake_entries_user ON sweepstake_entries(userId, createdAt DESC);

CREATE INDEX IF NOT EXISTS idx_dm_conversation ON direct_conversations(userA, userB);
CREATE INDEX IF NOT EXISTS idx_dm_messages ON direct_messages(conversationId, createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_trust_apps_status ON trust_applications(townId, status, createdAt);
CREATE INDEX IF NOT EXISTS idx_trust_apps_user ON trust_applications(userId, createdAt);
CREATE INDEX IF NOT EXISTS idx_resident_verify_status ON resident_verification_requests(townId, status, createdAt);
CREATE INDEX IF NOT EXISTS idx_resident_verify_user ON resident_verification_requests(userId, createdAt);

CREATE TABLE IF NOT EXISTS town_memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  createdAt TEXT NOT NULL,
  townId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  trustLevel TEXT NOT NULL,
  trustTier INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS prize_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  townId INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  valueCents INTEGER NOT NULL,
  prizeType TEXT NOT NULL,
  fulfillmentMethod TEXT NOT NULL,
  fulfillmentNotes TEXT NOT NULL DEFAULT '',
  expiresAt TEXT NOT NULL DEFAULT '',
  imageUrl TEXT NOT NULL DEFAULT '',
  donorUserId INTEGER NOT NULL,
  donorPlaceId INTEGER,
  donorDisplayName TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  reviewedAt TEXT NOT NULL DEFAULT '',
  reviewedByUserId INTEGER,
  decisionReason TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS prize_awards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  townId INTEGER NOT NULL DEFAULT 1,
  prizeOfferId INTEGER NOT NULL,
  winnerUserId INTEGER NOT NULL,
  donorUserId INTEGER NOT NULL,
  donorPlaceId INTEGER,
  status TEXT NOT NULL,
  dueBy TEXT NOT NULL DEFAULT '',
  convoId INTEGER,
  proofUrl TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
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
  if(!columnExists("places","description")) addColumn("places","description TEXT NOT NULL DEFAULT ''");
  if(!columnExists("places","website")) addColumn("places","website TEXT NOT NULL DEFAULT ''");
  if(!columnExists("places","yearsInTown")) addColumn("places","yearsInTown TEXT NOT NULL DEFAULT ''");
  if(!columnExists("places","bannerUrl")) addColumn("places","bannerUrl TEXT NOT NULL DEFAULT ''");
  if(!columnExists("places","avatarUrl")) addColumn("places","avatarUrl TEXT NOT NULL DEFAULT ''");
})();

(function migrateUsers(){
  if(!columnExists("users","trustTier")) addColumn("users","trustTier INTEGER NOT NULL DEFAULT 0");
  if(!columnExists("users","trustTierUpdatedAt")) addColumn("users","trustTierUpdatedAt TEXT NOT NULL DEFAULT ''");
  if(!columnExists("users","phone")) addColumn("users","phone TEXT NOT NULL DEFAULT ''");
  if(!columnExists("users","addressJson")) addColumn("users","addressJson TEXT NOT NULL DEFAULT '{}'");
  if(!columnExists("users","presenceVerifiedAt")) addColumn("users","presenceVerifiedAt TEXT NOT NULL DEFAULT ''");
  if(!columnExists("users","presenceLat")) addColumn("users","presenceLat REAL");
  if(!columnExists("users","presenceLng")) addColumn("users","presenceLng REAL");
  if(!columnExists("users","presenceAccuracyMeters")) addColumn("users","presenceAccuracyMeters REAL");
})();

(function migrateChannelMessages(){
  if(!columnExists("channel_messages","imageUrl")) addColumn("channel_messages","imageUrl TEXT NOT NULL DEFAULT ''");
})();

(function migrateLiveRooms(){
  if(!columnExists("live_rooms","hostEventId")) addColumn("live_rooms","hostEventId INTEGER");
  if(!columnExists("live_rooms","hostType")) addColumn("live_rooms","hostType TEXT NOT NULL DEFAULT 'individual'");
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
  if(!columnExists("listings","auctionStatus")) addColumn("listings","auctionStatus TEXT NOT NULL DEFAULT 'active'");
  if(!columnExists("listings","winningBidId")) addColumn("listings","winningBidId INTEGER");
  if(!columnExists("listings","winnerUserId")) addColumn("listings","winnerUserId INTEGER");
  if(!columnExists("listings","paymentDueAt")) addColumn("listings","paymentDueAt TEXT NOT NULL DEFAULT ''");
  if(!columnExists("listings","paymentStatus")) addColumn("listings","paymentStatus TEXT NOT NULL DEFAULT 'none'");
})();

(function migrateUserProfiles(){
  if(!columnExists("users","displayName")) addColumn("users","displayName TEXT NOT NULL DEFAULT ''");
  if(!columnExists("users","bio")) addColumn("users","bio TEXT NOT NULL DEFAULT ''");
  if(!columnExists("users","avatarUrl")) addColumn("users","avatarUrl TEXT NOT NULL DEFAULT ''");
  if(!columnExists("users","interestsJson")) addColumn("users","interestsJson TEXT NOT NULL DEFAULT '[]'");
  if(!columnExists("users","ageRange")) addColumn("users","ageRange TEXT NOT NULL DEFAULT ''");
  if(!columnExists("users","showAvatar")) addColumn("users","showAvatar INTEGER NOT NULL DEFAULT 0");
  if(!columnExists("users","showBio")) addColumn("users","showBio INTEGER NOT NULL DEFAULT 1");
  if(!columnExists("users","showInterests")) addColumn("users","showInterests INTEGER NOT NULL DEFAULT 1");
  if(!columnExists("users","showAgeRange")) addColumn("users","showAgeRange INTEGER NOT NULL DEFAULT 0");
  if(!columnExists("users","isBuyerVerified")) addColumn("users","isBuyerVerified INTEGER NOT NULL DEFAULT 0");
  if(!columnExists("users","isSellerVerified")) addColumn("users","isSellerVerified INTEGER NOT NULL DEFAULT 0");
  if(!columnExists("users","locationVerifiedSebastian")) addColumn("users","locationVerifiedSebastian INTEGER NOT NULL DEFAULT 0");
  if(!columnExists("users","residentVerified")) addColumn("users","residentVerified INTEGER NOT NULL DEFAULT 0");
  if(!columnExists("users","facebookVerified")) addColumn("users","facebookVerified INTEGER NOT NULL DEFAULT 0");
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

(function migrateUsers(){
  if(!columnExists("users","isAdmin")) addColumn("users","isAdmin INTEGER NOT NULL DEFAULT 0");
})();

(function migrateTownIds(){
  if(!columnExists("listings","townId")) addColumn("listings","townId INTEGER NOT NULL DEFAULT 1");
  if(!columnExists("orders","townId")) addColumn("orders","townId INTEGER NOT NULL DEFAULT 1");
  if(!columnExists("orders","sellerPlaceId")) addColumn("orders","sellerPlaceId INTEGER");
  if(!columnExists("orders","updatedAt")) addColumn("orders","updatedAt TEXT NOT NULL DEFAULT ''");
  if(!columnExists("orders","subtotalCents")) addColumn("orders","subtotalCents INTEGER NOT NULL DEFAULT 0");
  if(!columnExists("orders","serviceGratuityCents")) addColumn("orders","serviceGratuityCents INTEGER NOT NULL DEFAULT 0");
  if(!columnExists("orders","totalCents")) addColumn("orders","totalCents INTEGER NOT NULL DEFAULT 0");
  if(!columnExists("orders","fulfillmentType")) addColumn("orders","fulfillmentType TEXT NOT NULL DEFAULT ''");
  if(!columnExists("orders","fulfillmentNotes")) addColumn("orders","fulfillmentNotes TEXT NOT NULL DEFAULT ''");
  if(!columnExists("reviews","townId")) addColumn("reviews","townId INTEGER NOT NULL DEFAULT 1");
  if(!columnExists("disputes","townId")) addColumn("disputes","townId INTEGER NOT NULL DEFAULT 1");
  if(!columnExists("bids","townId")) addColumn("bids","townId INTEGER NOT NULL DEFAULT 1");
  if(!columnExists("channels","townId")) addColumn("channels","townId INTEGER NOT NULL DEFAULT 1");
  if(!columnExists("direct_conversations","townId")) addColumn("direct_conversations","townId INTEGER NOT NULL DEFAULT 1");
  if(!columnExists("direct_messages","townId")) addColumn("direct_messages","townId INTEGER NOT NULL DEFAULT 1");
  if(!columnExists("signups","townId")) addColumn("signups","townId INTEGER NOT NULL DEFAULT 1");
  if(!columnExists("event_rsvps","townId")) addColumn("event_rsvps","townId INTEGER NOT NULL DEFAULT 1");
  if(!columnExists("sweep_ledger","townId")) addColumn("sweep_ledger","townId INTEGER NOT NULL DEFAULT 1");
  if(!columnExists("sweepstakes","townId")) addColumn("sweepstakes","townId INTEGER NOT NULL DEFAULT 1");
  if(!columnExists("sweepstake_entries","townId")) addColumn("sweepstake_entries","townId INTEGER NOT NULL DEFAULT 1");
  if(!columnExists("store_follows","townId")) addColumn("store_follows","townId INTEGER NOT NULL DEFAULT 1");
})();

(function migrateTownIndexes(){
  const safe = (sql)=>{
    try{ db.exec(sql); }catch{}
  };
  safe("CREATE INDEX IF NOT EXISTS idx_listings_town_created ON listings(townId, createdAt DESC);");
  safe("CREATE INDEX IF NOT EXISTS idx_orders_town_created ON orders(townId, createdAt DESC);");
  safe("CREATE INDEX IF NOT EXISTS idx_bids_town_created ON bids(townId, createdAt DESC);");
  safe("CREATE INDEX IF NOT EXISTS idx_reviews_town_created ON reviews(townId, createdAt DESC);");
  safe("CREATE INDEX IF NOT EXISTS idx_disputes_town_created ON disputes(townId, createdAt DESC);");
  safe("CREATE INDEX IF NOT EXISTS idx_channels_town_created ON channels(townId, createdAt DESC);");
  safe("CREATE INDEX IF NOT EXISTS idx_dm_town_created ON direct_messages(townId, createdAt DESC);");
  safe("CREATE INDEX IF NOT EXISTS idx_media_town ON media_objects(townId);");
  safe("CREATE INDEX IF NOT EXISTS idx_media_owner ON media_objects(ownerUserId);");
  safe("CREATE INDEX IF NOT EXISTS idx_media_kind ON media_objects(kind);");
  safe("CREATE INDEX IF NOT EXISTS idx_media_created ON media_objects(createdAt DESC);");
})();
(function migrateTrustTiers(){
  if(!columnExists("town_memberships","trustTier")) addColumn("town_memberships","trustTier INTEGER NOT NULL DEFAULT 0");
})();
(function migrateSweepstakes(){
  if(!columnExists("sweepstakes","maxEntriesPerUserPerDay")) addColumn("sweepstakes","maxEntriesPerUserPerDay INTEGER NOT NULL DEFAULT 1");
})();

(function migrateSweepstakeEntries(){
  if(!columnExists("sweepstake_entries","entries")) addColumn("sweepstake_entries","entries INTEGER NOT NULL DEFAULT 0");
  if(!columnExists("sweepstake_entries","dayKey")) addColumn("sweepstake_entries","dayKey TEXT NOT NULL DEFAULT ''");
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

(function seedArchiveEntries(){
  const slug = "archive-introduction";
  const row = db.prepare("SELECT id FROM archive_entries WHERE slug=?").get(slug);
  if(row) return;
  const body = `# Archive

*A living record of the land, the people, and the place.*

## Before the Town
Long before roads, storefronts, or addresses, this land was shaped by water.

For thousands of years, Indigenous peoples lived along the Indian River Lagoon, traveling by canoe, fishing its waters, and gathering from the shoreline. The river was not a boundary — it was a connection. Life moved with the tides, seasons, and shared knowledge of the land.

This place was never empty. It was lived with.

## First Contact
In the early 1500s, European explorers passed along Florida’s east coast. They encountered established communities and deep local knowledge, but left behind lasting disruption. Disease and displacement followed, changing the course of life here long before permanent settlements took shape.

Much of what was lost was never written down.

## A Remote Coast
For centuries, the land remained quiet and difficult to settle. The coastline was dangerous, the lagoon unpredictable, and the land resistant to rapid development. Travelers passed through more often than they stayed.

The river continued to shape life, just as it always had.

## The Name Sebastian
The settlement that would become Sebastian grew slowly around what is now known as Sebastian Inlet — a passage carved and reshaped repeatedly by storms, tides, and human effort. Fishing, small farms, and river trade defined early life here.

Growth came carefully, never all at once.

## A Town That Chose Its Pace
While much of Florida experienced rapid expansion, Sebastian remained modest. Families settled, communities formed, and the town developed an identity tied more to water and land than to spectacle.

Even as the world sped up, this place did not.

## Sebastian Today
Sebastian is shaped as much by what it *did not become* as by what it did.

The river, wildlife, and surrounding land remain central to daily life. Conservation, local knowledge, and community still matter here. The town carries its past quietly — not as nostalgia, but as foundation.

## The Digital Town
This Digital Town exists as a continuation of that story.

It is not meant to replace the physical town, but to support it — to create a shared space for local exchange, communication, and stewardship that respects place over scale.

Just as the river once connected people, this digital layer does the same.

## This Archive Is Ongoing
History here is not finished.

This archive will grow with:
- Stories from residents
- Photos and memories
- Community milestones
- Changes to the land and town

The archive belongs to the place — and to the people who live here now.

This archive will grow with the Daily Digital Sebastian Pulse.`;
  db.prepare(`
    INSERT INTO archive_entries
      (townId, status, title, slug, bodyMarkdown, createdAt, createdByUserId, pinned, tagsJson)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(
    1,
    "published",
    "Archive",
    slug,
    body,
    nowISO(),
    null,
    1,
    JSON.stringify(["history","sebastian","identity"])
  );
})();

(function seedAdminUser(){
  const email = (process.env.DEV_ADMIN_EMAIL || "admin@local.test").toLowerCase().trim();
  if(!email) return;
  let user = db.prepare("SELECT * FROM users WHERE email=?").get(email);
  if(!user){
    const info = db.prepare("INSERT INTO users (email, createdAt) VALUES (?,?)").run(email, nowISO());
    user = db.prepare("SELECT * FROM users WHERE id=?").get(info.lastInsertRowid);
  }
  if(Number(user.isAdmin) !== 1){
    db.prepare("UPDATE users SET isAdmin=1 WHERE id=?").run(user.id);
  }
  if(!(user.displayName || "").toString().trim()){
    db.prepare("UPDATE users SET displayName=? WHERE id=?").run("Admin", user.id);
  }
})();

(function seedAdminTestStore(){
  const adminUser = db.prepare("SELECT * FROM users WHERE isAdmin=1 ORDER BY id LIMIT 1").get();
  if(!adminUser) return;
  const existing = db.prepare("SELECT 1 FROM places WHERE ownerUserId=? LIMIT 1").get(adminUser.id);
  if(existing) return;
  db.prepare(`
    INSERT INTO places
      (townId, districtId, name, category, status, description, sellerType, addressPrivate, website, yearsInTown, ownerUserId)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    1,
    1,
    "Admin Test Store",
    "Test",
    "approved",
    "Test storefront for admin setup.",
    "individual",
    "",
    "",
    "",
    adminUser.id
  );
})();

// ---------- Core getters ----------
function getPlaces(){
  return db.prepare(`
    SELECT id, townId, districtId, name, category, status,
           description, website, yearsInTown, bannerUrl, avatarUrl,
           sellerType, visibilityLevel, pickupZone, addressPublic, addressPrivate,
           meetupInstructions, hours, verifiedStatus, ownerUserId
    FROM places WHERE townId=1 ORDER BY id
  `).all();
}
function getPlaceById(id){
  return db.prepare(`
    SELECT id, townId, districtId, name, category, status,
           description, website, yearsInTown, bannerUrl, avatarUrl,
           sellerType, visibilityLevel, pickupZone, addressPublic, addressPrivate,
           meetupInstructions, hours, verifiedStatus, ownerUserId
    FROM places WHERE id=?
  `).get(Number(id)) || null;
}
function getPlaceOwnerPublic(placeId){
  const place = getPlaceById(placeId);
  if(!place || !place.ownerUserId) return null;
  const user = db.prepare("SELECT id, email FROM users WHERE id=?").get(Number(place.ownerUserId)) || null;
  return user ? { id: user.id, email: user.email } : null;
}
function updatePlaceSettings(placeId, payload){
  const place = getPlaceById(placeId);
  if(!place) return null;
  const updated = {
    sellerType: (payload?.sellerType ?? place.sellerType),
    visibilityLevel: (payload?.visibilityLevel ?? place.visibilityLevel),
    pickupZone: (payload?.pickupZone ?? place.pickupZone),
    addressPublic: (payload?.addressPublic ?? place.addressPublic),
    addressPrivate: (payload?.addressPrivate ?? place.addressPrivate),
    meetupInstructions: (payload?.meetupInstructions ?? place.meetupInstructions),
    hours: (payload?.hours ?? place.hours)
  };
  db.prepare(`
    UPDATE places
    SET sellerType=?, visibilityLevel=?, pickupZone=?, addressPublic=?, addressPrivate=?, meetupInstructions=?, hours=?
    WHERE id=?
  `).run(
    updated.sellerType,
    updated.visibilityLevel,
    updated.pickupZone,
    updated.addressPublic,
    updated.addressPrivate,
    updated.meetupInstructions,
    updated.hours,
    Number(placeId)
  );
  return getPlaceById(placeId);
}

function listPlacesByStatus(status){
  if(!status) return db.prepare("SELECT * FROM places ORDER BY id DESC").all();
  return db.prepare("SELECT * FROM places WHERE status=? ORDER BY id DESC")
    .all(String(status));
}
function updatePlaceStatus(placeId, status){
  const place = getPlaceById(placeId);
  if(!place) return null;
  db.prepare("UPDATE places SET status=? WHERE id=?")
    .run(String(status), Number(placeId));
  return getPlaceById(placeId);
}

function addPlace(payload){
  const name = (payload?.name || "").toString().trim();
  const category = (payload?.category || "").toString().trim();
  const description = (payload?.description || "").toString().trim();
  const sellerType = (payload?.sellerType || "individual").toString().trim();
  const addressPrivate = (payload?.addressPrivate || "").toString().trim();
  const website = (payload?.website || "").toString().trim();
  const yearsInTown = (payload?.yearsInTown || "").toString().trim();
  if(!name || !category) return { error: "name and category required" };
  const info = db.prepare(`
    INSERT INTO places
      (townId, districtId, name, category, status, description, sellerType, addressPrivate, website, yearsInTown, ownerUserId)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    Number(payload.townId || 1),
    Number(payload.districtId || 1),
    name,
    category,
    "pending",
    description,
    sellerType,
    addressPrivate,
    website,
    yearsInTown,
    payload.ownerUserId == null ? null : Number(payload.ownerUserId)
  );
  return getPlaceById(info.lastInsertRowid);
}

function updatePlaceProfile(placeId, payload){
  const place = getPlaceById(placeId);
  if(!place) return null;
  const name = (payload?.name ?? place.name).toString().trim();
  const category = (payload?.category ?? place.category).toString().trim();
  const description = (payload?.description ?? place.description).toString().trim();
  const bannerUrl = (payload?.bannerUrl ?? place.bannerUrl).toString().trim();
  const avatarUrl = (payload?.avatarUrl ?? place.avatarUrl).toString().trim();
  const visibilityLevel = (payload?.visibilityLevel ?? place.visibilityLevel).toString().trim();
  const pickupZone = (payload?.pickupZone ?? place.pickupZone).toString().trim();
  const meetupInstructions = (payload?.meetupInstructions ?? place.meetupInstructions).toString().trim();
  const hours = (payload?.hours ?? place.hours).toString().trim();
  db.prepare(`
    UPDATE places
    SET name=?, category=?, description=?, bannerUrl=?, avatarUrl=?, visibilityLevel=?, pickupZone=?, meetupInstructions=?, hours=?
    WHERE id=?
  `).run(name, category, description, bannerUrl, avatarUrl, visibilityLevel, pickupZone, meetupInstructions, hours, Number(placeId));
  return getPlaceById(placeId);
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
    auctionStatus: l.auctionStatus || "active",
    winningBidId: l.winningBidId == null ? null : Number(l.winningBidId),
    winnerUserId: l.winnerUserId == null ? null : Number(l.winnerUserId),
    paymentDueAt: l.paymentDueAt || "",
    paymentStatus: l.paymentStatus || "none",
  }));
}

function getChannels(){
  return db.prepare("SELECT id, name, description, isPublic, createdAt FROM channels ORDER BY id").all();
}
function createChannel(name, description, isPublic=1){
  const info = db.prepare("INSERT INTO channels (name, description, isPublic, createdAt) VALUES (?,?,?,?)")
    .run(String(name), String(description || ""), Number(isPublic ? 1 : 0), nowISO());
  return db.prepare("SELECT id, name, description, isPublic, createdAt FROM channels WHERE id=?")
    .get(info.lastInsertRowid);
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
    SELECT id, channelId, userId, text, imageUrl, createdAt, replyToId, threadId
    FROM channel_messages
    WHERE channelId=?
    ORDER BY createdAt ASC
    LIMIT ?
  `).all(Number(channelId), Number(limit));
}
function getChannelMessageById(id){
  return db.prepare(`
    SELECT id, channelId, userId, text, imageUrl, createdAt, replyToId, threadId
    FROM channel_messages
    WHERE id=?
  `).get(Number(id)) || null;
}
function createChannelThread(channelId, userId){
  const info = db.prepare("INSERT INTO message_threads (channelId, createdBy, createdAt) VALUES (?,?,?)")
    .run(Number(channelId), Number(userId), nowISO());
  return info.lastInsertRowid;
}
function addChannelMessage(channelId, userId, text, imageUrl, replyToId, threadId){
  const info = db.prepare("INSERT INTO channel_messages (channelId, userId, text, imageUrl, createdAt, replyToId, threadId) VALUES (?,?,?,?,?,?,?)")
    .run(Number(channelId), Number(userId), String(text), String(imageUrl || ""), nowISO(), replyToId ?? null, Number(threadId));
  return { id: info.lastInsertRowid };
}

function createLiveRoom(payload){
  const info = db.prepare(`
    INSERT INTO live_rooms
    (townId, status, title, description, hostUserId, hostPlaceId, hostEventId, hostType, hostChannelId, pinnedListingId, createdAt, startedAt, endedAt, cfRoomId, cfRoomToken)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    Number(payload.townId || 1),
    String(payload.status || "idle"),
    String(payload.title || ""),
    String(payload.description || ""),
    Number(payload.hostUserId),
    payload.hostPlaceId == null ? null : Number(payload.hostPlaceId),
    payload.hostEventId == null ? null : Number(payload.hostEventId),
    String(payload.hostType || "individual"),
    payload.hostChannelId == null ? null : Number(payload.hostChannelId),
    payload.pinnedListingId == null ? null : Number(payload.pinnedListingId),
    nowISO(),
    String(payload.startedAt || ""),
    String(payload.endedAt || ""),
    String(payload.cfRoomId || ""),
    String(payload.cfRoomToken || "")
  );
  return getLiveRoomById(info.lastInsertRowid);
}
function getLiveRoomById(id){
  return db.prepare("SELECT * FROM live_rooms WHERE id=?").get(Number(id)) || null;
}
function listActiveLiveRooms(townId=1){
  return db.prepare("SELECT * FROM live_rooms WHERE townId=? AND status='live' ORDER BY startedAt DESC").all(Number(townId));
}
function updateLiveRoom(id, fields){
  const updates = [];
  const params = [];
  const add = (key, val)=>{
    updates.push(`${key}=?`);
    params.push(val);
  };
  if(fields.status != null) add("status", String(fields.status));
  if(fields.title != null) add("title", String(fields.title));
  if(fields.description != null) add("description", String(fields.description));
  if(fields.hostChannelId != null) add("hostChannelId", Number(fields.hostChannelId));
  if(fields.hostEventId != null) add("hostEventId", Number(fields.hostEventId));
  if(fields.hostType != null) add("hostType", String(fields.hostType));
  if(fields.pinnedListingId != null) add("pinnedListingId", Number(fields.pinnedListingId));
  if(fields.startedAt != null) add("startedAt", String(fields.startedAt));
  if(fields.endedAt != null) add("endedAt", String(fields.endedAt));
  if(fields.cfRoomId != null) add("cfRoomId", String(fields.cfRoomId));
  if(fields.cfRoomToken != null) add("cfRoomToken", String(fields.cfRoomToken));
  if(!updates.length) return getLiveRoomById(id);
  db.prepare(`UPDATE live_rooms SET ${updates.join(", ")} WHERE id=?`).run(...params, Number(id));
  return getLiveRoomById(id);
}

// ---------- Trust / memberships ----------
function ensureTownMembership(townId, userId){
  const tid = Number(townId || 1);
  const uid = Number(userId);
  const cfg = getTownConfig(tid);
  const defaultLevel = cfg.trustDefaults?.defaultLevel || TRUST.VISITOR;

  const existing = db.prepare("SELECT * FROM town_memberships WHERE townId=? AND userId=?").get(tid, uid);
  if(existing) return existing;

  db.prepare("INSERT INTO town_memberships (createdAt, townId, userId, trustLevel, trustTier, notes) VALUES (?,?,?,?,?,?)")
    .run(nowISO(), tid, uid, defaultLevel, 0, "");
  return db.prepare("SELECT * FROM town_memberships WHERE townId=? AND userId=?").get(tid, uid);
}

function setUserTrustTier(townId, userId, trustTier){
  const tid = Number(townId || 1);
  const uid = Number(userId);
  const tier = Number(trustTier);
  if(!uid || !Number.isFinite(tier)) return { error: "Invalid userId or trustTier" };
  ensureTownMembership(tid, uid);
  db.prepare("UPDATE town_memberships SET trustTier=? WHERE townId=? AND userId=?")
    .run(tier, tid, uid);
  db.prepare("UPDATE users SET trustTier=?, trustTierUpdatedAt=? WHERE id=?")
    .run(tier, nowISO(), uid);
  return db.prepare("SELECT * FROM town_memberships WHERE townId=? AND userId=?").get(tid, uid);
}

function updateUserPresence(userId, payload){
  const uid = Number(userId);
  if(!uid) return { error:"Invalid userId" };
  const now = nowISO();
  db.prepare(`
    UPDATE users
    SET presenceVerifiedAt=?, presenceLat=?, presenceLng=?, presenceAccuracyMeters=?
    WHERE id=?
  `).run(now, payload.lat, payload.lng, payload.accuracyMeters, uid);
  return { ok:true, presenceVerifiedAt: now };
}

function setUserLocationVerifiedSebastian(userId, verified){
  const uid = Number(userId);
  if(!uid) return { error:"Invalid userId" };
  db.prepare("UPDATE users SET locationVerifiedSebastian=? WHERE id=?")
    .run(verified ? 1 : 0, uid);
  return { ok:true };
}

function setUserFacebookVerified(userId, verified){
  const uid = Number(userId);
  if(!uid) return { error:"Invalid userId" };
  db.prepare("UPDATE users SET facebookVerified=? WHERE id=?")
    .run(verified ? 1 : 0, uid);
  return { ok:true };
}

function setUserResidentVerified(userId, verified){
  const uid = Number(userId);
  if(!uid) return { error:"Invalid userId" };
  db.prepare("UPDATE users SET residentVerified=? WHERE id=?")
    .run(verified ? 1 : 0, uid);
  return { ok:true };
}

function addResidentVerificationRequest(payload, userId){
  const uid = Number(userId);
  if(!uid) return { error:"Invalid userId" };
  const addressLine1 = (payload.addressLine1 || "").toString().trim();
  const city = (payload.city || "").toString().trim();
  const state = (payload.state || "").toString().trim();
  const zip = (payload.zip || "").toString().trim();
  if(!addressLine1 || !city || !state || !zip) return { error:"addressLine1, city, state, zip required" };
  const info = db.prepare(`
    INSERT INTO resident_verification_requests
      (townId, userId, status, addressLine1, city, state, zip, createdAt)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(1, uid, "pending", addressLine1, city, state, zip, nowISO());
  return db.prepare("SELECT * FROM resident_verification_requests WHERE id=?").get(info.lastInsertRowid);
}

function approveResidentVerification(userId, adminUserId){
  const uid = Number(userId);
  if(!uid) return { error:"Invalid userId" };
  const now = nowISO();
  db.prepare(`
    UPDATE resident_verification_requests
    SET status='approved', reviewedAt=?, reviewedByUserId=?, decisionReason=''
    WHERE userId=? AND status='pending'
  `).run(now, adminUserId == null ? null : Number(adminUserId), uid);
  setUserResidentVerified(uid, true);
  return { ok:true };
}

function updateUserContact(userId, payload){
  const uid = Number(userId);
  if(!uid) return { error:"Invalid userId" };
  db.prepare("UPDATE users SET phone=?, addressJson=? WHERE id=?")
    .run(payload.phone || "", JSON.stringify(payload.address || {}), uid);
  return { ok:true };
}

function addTrustApplication(payload){
  const now = nowISO();
  const stmt = db.prepare(`
    INSERT INTO trust_applications
    (townId, userId, requestedTier, status, email, phone, address1, address2, city, state, zip,
     identityMethod, identityStatus, presenceStatus, presenceVerifiedAt, presenceLat, presenceLng, presenceAccuracyMeters, createdAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const info = stmt.run(
    payload.townId || 1,
    payload.userId,
    payload.requestedTier,
    payload.status || "pending",
    payload.email,
    payload.phone,
    payload.address1,
    payload.address2 || "",
    payload.city,
    payload.state,
    payload.zip,
    payload.identityMethod,
    payload.identityStatus || "pending",
    payload.presenceStatus || "not_required",
    payload.presenceVerifiedAt || "",
    payload.presenceLat ?? null,
    payload.presenceLng ?? null,
    payload.presenceAccuracyMeters ?? null,
    now
  );
  return { id: info.lastInsertRowid, createdAt: now };
}

function getTrustApplicationsByUser(userId){
  return db.prepare("SELECT * FROM trust_applications WHERE userId=? ORDER BY createdAt DESC")
    .all(userId);
}

function getTrustApplicationsByStatus(status){
  return db.prepare("SELECT * FROM trust_applications WHERE status=? ORDER BY createdAt ASC")
    .all(status || "pending");
}

function updateTrustApplicationStatus(id, status, reviewedByUserId, decisionReason){
  const now = nowISO();
  db.prepare(`
    UPDATE trust_applications
    SET status=?, reviewedAt=?, reviewedByUserId=?, decisionReason=?
    WHERE id=?
  `).run(status, now, reviewedByUserId || null, decisionReason || "", id);
  return { ok:true };
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

// ---------- Prize offers ----------
function addPrizeOffer(payload, userId){
  const title = (payload.title || "").toString().trim();
  const description = (payload.description || "").toString().trim();
  const valueCents = Number(payload.valueCents || 0);
  const prizeType = (payload.prizeType || "").toString().trim();
  const fulfillmentMethod = (payload.fulfillmentMethod || "").toString().trim();
  const fulfillmentNotes = (payload.fulfillmentNotes || "").toString().trim();
  const expiresAt = (payload.expiresAt || "").toString().trim();
  const imageUrl = (payload.imageUrl || "").toString().trim();
  const donorPlaceId = payload.donorPlaceId == null ? null : Number(payload.donorPlaceId);
  if(!title) return { error: "title required" };
  if(!description) return { error: "description required" };
  if(!Number.isFinite(valueCents) || valueCents <= 0) return { error: "valueCents required" };
  if(!["physical","service","giftcard","experience"].includes(prizeType)) return { error: "invalid prizeType" };
  if(!["pickup","meetup","shipping"].includes(fulfillmentMethod)) return { error: "invalid fulfillmentMethod" };
  const donor = getUserById(userId);
  const donorDisplayName = donor ? getDisplayNameForUser(donor) : "Donor";
  const info = db.prepare(`
    INSERT INTO prize_offers
      (townId, status, title, description, valueCents, prizeType, fulfillmentMethod, fulfillmentNotes, expiresAt, imageUrl, donorUserId, donorPlaceId, donorDisplayName, createdAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    1,
    "pending",
    title,
    description,
    Number(valueCents),
    prizeType,
    fulfillmentMethod,
    fulfillmentNotes,
    expiresAt,
    imageUrl,
    Number(userId),
    donorPlaceId,
    donorDisplayName,
    nowISO()
  );
  return db.prepare("SELECT * FROM prize_offers WHERE id=?").get(info.lastInsertRowid);
}
function listPrizeOffersByStatus(status){
  const s = (status || "").toString().trim().toLowerCase();
  const where = s ? "WHERE status=?" : "";
  const rows = db.prepare(`
    SELECT * FROM prize_offers
    ${where}
    ORDER BY createdAt DESC
  `).all(s ? s : undefined);
  return rows;
}
function listActivePrizeOffers(){
  return db.prepare(`
    SELECT * FROM prize_offers
    WHERE status IN ('approved','active')
    ORDER BY createdAt DESC
  `).all();
}
function updatePrizeOfferDecision(id, status, reviewerUserId, decisionReason){
  const reviewedAt = nowISO();
  db.prepare(`
    UPDATE prize_offers
    SET status=?, reviewedAt=?, reviewedByUserId=?, decisionReason=?
    WHERE id=?
  `).run(String(status), reviewedAt, reviewerUserId == null ? null : Number(reviewerUserId), String(decisionReason || ""), Number(id));
  return db.prepare("SELECT * FROM prize_offers WHERE id=?").get(Number(id)) || null;
}
function getPrizeOfferById(id){
  return db.prepare("SELECT * FROM prize_offers WHERE id=?").get(Number(id)) || null;
}
function addPrizeAward(payload){
  const createdAt = nowISO();
  const updatedAt = createdAt;
  const info = db.prepare(`
    INSERT INTO prize_awards
      (townId, prizeOfferId, winnerUserId, donorUserId, donorPlaceId, status, dueBy, convoId, proofUrl, createdAt, updatedAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    1,
    Number(payload.prizeOfferId),
    Number(payload.winnerUserId),
    Number(payload.donorUserId),
    payload.donorPlaceId == null ? null : Number(payload.donorPlaceId),
    String(payload.status || "notified"),
    String(payload.dueBy || ""),
    payload.convoId == null ? null : Number(payload.convoId),
    String(payload.proofUrl || ""),
    createdAt,
    updatedAt
  );
  return db.prepare("SELECT * FROM prize_awards WHERE id=?").get(info.lastInsertRowid);
}
function updatePrizeAwardStatus(id, status, patch){
  const updatedAt = nowISO();
  const proofUrl = (patch?.proofUrl || "").toString();
  const convoId = patch?.convoId == null ? null : Number(patch.convoId);
  db.prepare(`
    UPDATE prize_awards
    SET status=?, proofUrl=COALESCE(NULLIF(?,''), proofUrl), convoId=COALESCE(?, convoId), updatedAt=?
    WHERE id=?
  `).run(String(status), proofUrl, convoId, updatedAt, Number(id));
  return db.prepare("SELECT * FROM prize_awards WHERE id=?").get(Number(id)) || null;
}
function getPrizeAwardById(id){
  return db.prepare("SELECT * FROM prize_awards WHERE id=?").get(Number(id)) || null;
}
function listPrizeAwardsForUser(userId, placeId){
  const uid = Number(userId);
  if(placeId){
    return db.prepare(`
      SELECT pa.*, po.title, po.donorDisplayName
      FROM prize_awards pa
      JOIN prize_offers po ON po.id=pa.prizeOfferId
      WHERE pa.donorPlaceId=?
      ORDER BY pa.updatedAt DESC
    `).all(Number(placeId));
  }
  return db.prepare(`
    SELECT pa.*, po.title, po.donorDisplayName
    FROM prize_awards pa
    JOIN prize_offers po ON po.id=pa.prizeOfferId
    WHERE pa.winnerUserId=? OR pa.donorUserId=?
    ORDER BY pa.updatedAt DESC
  `).all(uid, uid);
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
function setUserAdmin(userId, isAdmin){
  const uid = Number(userId);
  if(!uid) return { error:"Invalid userId" };
  db.prepare("UPDATE users SET isAdmin=? WHERE id=?")
    .run(isAdmin ? 1 : 0, uid);
  return db.prepare("SELECT * FROM users WHERE id=?").get(uid) || null;
}
function setUserAdminByEmail(email, isAdmin){
  const user = upsertUserByEmail(email);
  if(!user) return { error:"Invalid email" };
  return setUserAdmin(user.id, isAdmin);
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

function getUserById(id){
  return db.prepare("SELECT * FROM users WHERE id=?").get(Number(id)) || null;
}
function getUserByEmail(email){
  const e = normalizeEmail(email);
  if(!e) return null;
  return db.prepare("SELECT * FROM users WHERE email=?").get(e) || null;
}
function getDisplayNameForUser(user){
  const name = (user?.displayName || "").toString().trim();
  if(name) return name;
  const email = (user?.email || "").toString().trim();
  if(email) return email.split("@")[0] || email;
  return `User #${user?.id || "?"}`;
}
function getReviewSummaryForUser(userId){
  const row = db.prepare("SELECT COUNT(*) AS count, AVG(rating) AS avg FROM reviews WHERE revieweeUserId=?")
    .get(Number(userId)) || { count: 0, avg: null };
  return { count: row.count || 0, average: row.avg == null ? 0 : Number(row.avg) };
}
function getReviewSummaryForUserDetailed(userId){
  const row = db.prepare(`
    SELECT
      COUNT(*) AS count,
      AVG(rating) AS avg,
      SUM(CASE WHEN role='buyer' THEN 1 ELSE 0 END) AS buyerCount,
      SUM(CASE WHEN role='seller' THEN 1 ELSE 0 END) AS sellerCount
    FROM reviews
    WHERE revieweeUserId=?
  `).get(Number(userId)) || { count: 0, avg: null, buyerCount: 0, sellerCount: 0 };
  return {
    count: row.count || 0,
    average: row.avg == null ? 0 : Number(row.avg),
    buyerCount: row.buyerCount || 0,
    sellerCount: row.sellerCount || 0
  };
}
function getUserRoles(userId){
  const seller = db.prepare("SELECT 1 FROM places WHERE ownerUserId=? LIMIT 1").get(Number(userId));
  const buyer = db.prepare("SELECT 1 FROM orders WHERE buyerUserId=? LIMIT 1").get(Number(userId));
  return { isBuyer: !!buyer, isSeller: !!seller };
}
function getUserProfilePublic(userId){
  const user = getUserById(userId);
  if(!user) return null;
  const profile = { id: user.id, displayName: getDisplayNameForUser(user) };
  if(Number(user.showAvatar) === 1 && user.avatarUrl) profile.avatarUrl = user.avatarUrl;
  if(Number(user.showBio) === 1 && user.bio) profile.bio = user.bio;
  if(Number(user.showInterests) === 1){
    const interests = parseJsonArray(user.interestsJson || "[]");
    if(interests.length) profile.interests = interests;
  }
  if(Number(user.showAgeRange) === 1 && user.ageRange) profile.ageRange = user.ageRange;
  if(Number(user.isBuyerVerified) === 1) profile.isBuyerVerified = true;
  if(Number(user.isSellerVerified) === 1) profile.isSellerVerified = true;
  const roles = getUserRoles(user.id);
  if(roles.isBuyer) profile.isBuyer = true;
  if(roles.isSeller) profile.isSeller = true;
  const reviews = getReviewSummaryForUser(user.id);
  if(reviews.count > 0) profile.reviews = reviews;
  return profile;
}
function getUserProfilePrivate(userId){
  const user = getUserById(userId);
  if(!user) return null;
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName || "",
    bio: user.bio || "",
    avatarUrl: user.avatarUrl || "",
    interests: parseJsonArray(user.interestsJson || "[]"),
    ageRange: user.ageRange || "",
    showAvatar: Number(user.showAvatar || 0),
    showBio: Number(user.showBio || 0),
    showInterests: Number(user.showInterests || 0),
    showAgeRange: Number(user.showAgeRange || 0),
    isBuyerVerified: Number(user.isBuyerVerified || 0),
    isSellerVerified: Number(user.isSellerVerified || 0),
    locationVerifiedSebastian: Number(user.locationVerifiedSebastian || 0),
    residentVerified: Number(user.residentVerified || 0),
    facebookVerified: Number(user.facebookVerified || 0)
  };
}
function updateUserProfile(userId, payload){
  const user = getUserById(userId);
  if(!user) return null;
  const displayName = (payload.displayName ?? user.displayName ?? "").toString().trim();
  const bio = (payload.bio ?? user.bio ?? "").toString().trim();
  const avatarUrl = (payload.avatarUrl ?? user.avatarUrl ?? "").toString().trim();
  const ageRange = (payload.ageRange ?? user.ageRange ?? "").toString().trim();
  const interestsRaw = Array.isArray(payload.interests) ? payload.interests : parseJsonArray(payload.interestsJson || "[]");
  const interests = [];
  for(const t of interestsRaw){
    const s = (t || "").toString().trim();
    if(!s) continue;
    interests.push(s.slice(0, 24));
    if(interests.length >= 12) break;
  }
  const showAvatar = payload.showAvatar != null ? (payload.showAvatar ? 1 : 0) : Number(user.showAvatar || 0);
  const showBio = payload.showBio != null ? (payload.showBio ? 1 : 0) : Number(user.showBio || 0);
  const showInterests = payload.showInterests != null ? (payload.showInterests ? 1 : 0) : Number(user.showInterests || 0);
  const showAgeRange = payload.showAgeRange != null ? (payload.showAgeRange ? 1 : 0) : Number(user.showAgeRange || 0);
  db.prepare(`
    UPDATE users
    SET displayName=?, bio=?, avatarUrl=?, interestsJson=?, ageRange=?, showAvatar=?, showBio=?, showInterests=?, showAgeRange=?
    WHERE id=?
  `).run(
    displayName,
    bio,
    avatarUrl,
    JSON.stringify(interests),
    ageRange,
    showAvatar,
    showBio,
    showInterests,
    showAgeRange,
    Number(userId)
  );
  return getUserProfilePrivate(userId);
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
    auctionStatus: l.auctionStatus || "active",
    winningBidId: l.winningBidId == null ? null : Number(l.winningBidId),
    winnerUserId: l.winnerUserId == null ? null : Number(l.winnerUserId),
    paymentDueAt: l.paymentDueAt || "",
    paymentStatus: l.paymentStatus || "none",
  };
}
function updateListingStatus(listingId, status){
  db.prepare("UPDATE listings SET status=? WHERE id=?").run(String(status), Number(listingId));
  return getListingById(listingId);
}
function getHighestBidForListing(listingId){
  return db.prepare("SELECT id, amountCents, userId, createdAt FROM bids WHERE listingId=? ORDER BY amountCents DESC, createdAt DESC LIMIT 1")
    .get(Number(listingId)) || null;
}
function getNextHighestBidForListing(listingId, excludeUserId){
  return db.prepare(`
    SELECT id, amountCents, userId, createdAt
    FROM bids
    WHERE listingId=? AND userId!=?
    ORDER BY amountCents DESC, createdAt DESC
    LIMIT 1
  `).get(Number(listingId), Number(excludeUserId)) || null;
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

function updateListingAuctionState(listingId, payload){
  const auctionStatus = (payload.auctionStatus || "").toString().trim() || "active";
  const winningBidId = payload.winningBidId == null ? null : Number(payload.winningBidId);
  const winnerUserId = payload.winnerUserId == null ? null : Number(payload.winnerUserId);
  const paymentDueAt = (payload.paymentDueAt || "").toString();
  const paymentStatus = (payload.paymentStatus || "").toString().trim() || "none";
  db.prepare(`
    UPDATE listings
    SET auctionStatus=?, winningBidId=?, winnerUserId=?, paymentDueAt=?, paymentStatus=?
    WHERE id=?
  `).run(auctionStatus, winningBidId, winnerUserId, paymentDueAt, paymentStatus, Number(listingId));
  return getListingById(listingId);
}

function createOrderWithItems(payload){
  const createdAt = nowISO();
  const updatedAt = createdAt;
  const info = db.prepare(`
    INSERT INTO orders
      (townId, listingId, buyerUserId, sellerUserId, sellerPlaceId, quantity, amountCents, status, createdAt, updatedAt, completedAt, paymentProvider, paymentIntentId, subtotalCents, serviceGratuityCents, totalCents, fulfillmentType, fulfillmentNotes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    Number(payload.townId || 1),
    Number(payload.listingId),
    Number(payload.buyerUserId),
    payload.sellerUserId == null ? null : Number(payload.sellerUserId),
    payload.sellerPlaceId == null ? null : Number(payload.sellerPlaceId),
    Number(payload.quantity || 1),
    Number(payload.amountCents || 0),
    String(payload.status || "pending"),
    createdAt,
    updatedAt,
    null,
    String(payload.paymentProvider || "stub"),
    String(payload.paymentIntentId || ""),
    Number(payload.subtotalCents || 0),
    Number(payload.serviceGratuityCents || 0),
    Number(payload.totalCents || 0),
    String(payload.fulfillmentType || ""),
    String(payload.fulfillmentNotes || "")
  );
  const orderId = info.lastInsertRowid;
  db.prepare(`
    INSERT INTO order_items
      (orderId, listingId, titleSnapshot, priceCentsSnapshot, quantity, sellerPlaceId, createdAt)
    VALUES (?,?,?,?,?,?,?)
  `).run(
    Number(orderId),
    Number(payload.listingId),
    String(payload.titleSnapshot || ""),
    Number(payload.priceCentsSnapshot || 0),
    Number(payload.quantity || 1),
    Number(payload.sellerPlaceId || 0),
    createdAt
  );
  return db.prepare("SELECT * FROM orders WHERE id=?").get(Number(orderId));
}

function getOrderItems(orderId){
  return db.prepare(`
    SELECT id, orderId, listingId, titleSnapshot, priceCentsSnapshot, quantity, sellerPlaceId, createdAt
    FROM order_items
    WHERE orderId=?
    ORDER BY id
  `).all(Number(orderId));
}

function getCartItemsByUser(userId){
  return db.prepare(`
    SELECT id, townId, userId, listingId, quantity, createdAt
    FROM cart_items
    WHERE userId=?
    ORDER BY id DESC
  `).all(Number(userId));
}
function getCartItem(userId, listingId){
  return db.prepare(`
    SELECT id, townId, userId, listingId, quantity, createdAt
    FROM cart_items
    WHERE userId=? AND listingId=?
  `).get(Number(userId), Number(listingId)) || null;
}
function addCartItem(userId, listingId, quantity){
  const createdAt = nowISO();
  const existing = getCartItem(userId, listingId);
  if(existing){
    const nextQty = Number(existing.quantity || 0) + Number(quantity || 0);
    if(nextQty <= 0){
      db.prepare("DELETE FROM cart_items WHERE id=?").run(Number(existing.id));
      return null;
    }
    db.prepare("UPDATE cart_items SET quantity=? WHERE id=?").run(nextQty, Number(existing.id));
    return getCartItem(userId, listingId);
  }
  const info = db.prepare(`
    INSERT INTO cart_items (townId, userId, listingId, quantity, createdAt)
    VALUES (?,?,?,?,?)
  `).run(1, Number(userId), Number(listingId), Number(quantity || 1), createdAt);
  return db.prepare("SELECT * FROM cart_items WHERE id=?").get(info.lastInsertRowid);
}
function removeCartItem(userId, listingId){
  db.prepare("DELETE FROM cart_items WHERE userId=? AND listingId=?").run(Number(userId), Number(listingId));
  return { ok:true };
}
function clearCart(userId){
  db.prepare("DELETE FROM cart_items WHERE userId=?").run(Number(userId));
  return { ok:true };
}

function createPaymentForOrder(orderId, amountCents, provider="stub"){
  const createdAt = nowISO();
  const info = db.prepare(`
    INSERT INTO payments (orderId, provider, status, amountCents, createdAt)
    VALUES (?,?,?,?,?)
  `).run(Number(orderId), String(provider), "requires_payment", Number(amountCents), createdAt);
  return db.prepare("SELECT * FROM payments WHERE id=?").get(info.lastInsertRowid);
}
function getPaymentForOrder(orderId){
  return db.prepare("SELECT * FROM payments WHERE orderId=? ORDER BY id DESC LIMIT 1")
    .get(Number(orderId)) || null;
}
function markPaymentPaid(orderId){
  db.prepare("UPDATE payments SET status='paid' WHERE orderId=?").run(Number(orderId));
  return db.prepare("SELECT * FROM payments WHERE orderId=? ORDER BY id DESC LIMIT 1").get(Number(orderId)) || null;
}
function updateOrderPayment(orderId, provider, paymentIntentId){
  const updatedAt = nowISO();
  db.prepare("UPDATE orders SET paymentProvider=?, paymentIntentId=?, updatedAt=? WHERE id=?")
    .run(String(provider || "stripe"), String(paymentIntentId || ""), updatedAt, Number(orderId));
  return db.prepare("SELECT * FROM orders WHERE id=?").get(Number(orderId)) || null;
}

function createOrderFromCart(payload, items){
  const createdAt = nowISO();
  const updatedAt = createdAt;
  const info = db.prepare(`
    INSERT INTO orders
      (townId, listingId, buyerUserId, sellerUserId, sellerPlaceId, quantity, amountCents, status, createdAt, updatedAt, completedAt, paymentProvider, paymentIntentId, subtotalCents, serviceGratuityCents, totalCents, fulfillmentType, fulfillmentNotes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    Number(payload.townId || 1),
    Number(payload.listingId),
    Number(payload.buyerUserId),
    payload.sellerUserId == null ? null : Number(payload.sellerUserId),
    payload.sellerPlaceId == null ? null : Number(payload.sellerPlaceId),
    Number(payload.quantity || 1),
    Number(payload.amountCents || 0),
    String(payload.status || "pending_payment"),
    createdAt,
    updatedAt,
    null,
    String(payload.paymentProvider || "stub"),
    String(payload.paymentIntentId || ""),
    Number(payload.subtotalCents || 0),
    Number(payload.serviceGratuityCents || 0),
    Number(payload.totalCents || 0),
    String(payload.fulfillmentType || ""),
    String(payload.fulfillmentNotes || "")
  );
  const orderId = info.lastInsertRowid;
  const stmt = db.prepare(`
    INSERT INTO order_items
      (orderId, listingId, titleSnapshot, priceCentsSnapshot, quantity, sellerPlaceId, createdAt)
    VALUES (?,?,?,?,?,?,?)
  `);
  items.forEach((item)=>{
    stmt.run(
      Number(orderId),
      Number(item.listingId),
      String(item.titleSnapshot || ""),
      Number(item.priceCentsSnapshot || 0),
      Number(item.quantity || 1),
      Number(payload.sellerPlaceId || 0),
      createdAt
    );
  });
  return db.prepare("SELECT * FROM orders WHERE id=?").get(Number(orderId));
}

function getOrdersForBuyer(userId){
  return db.prepare(`
    SELECT * FROM orders
    WHERE buyerUserId=?
    ORDER BY createdAt DESC
  `).all(Number(userId));
}
function getOrdersForSellerPlaces(placeIds){
  if(!placeIds.length) return [];
  const ids = placeIds.map(Number);
  const placeholders = ids.map(()=>"?").join(",");
  return db.prepare(`
    SELECT * FROM orders
    WHERE sellerPlaceId IN (${placeholders})
    ORDER BY createdAt DESC
  `).all(...ids);
}

function decrementListingQuantity(listingId, quantity){
  const listing = getListingById(listingId);
  if(!listing) return null;
  const current = Number(listing.quantity || 0);
  const next = Math.max(0, current - Number(quantity || 0));
  const status = next <= 0 ? "sold" : listing.status;
  db.prepare("UPDATE listings SET quantity=?, status=? WHERE id=?")
    .run(next, String(status || listing.status || "active"), Number(listingId));
  return getListingById(listingId);
}

function getSellerSalesSummary(placeId, fromIso, toIso){
  const pid = Number(placeId);
  const totals = db.prepare(`
    SELECT COALESCE(SUM(totalCents),0) AS revenueCents, COUNT(*) AS orderCount
    FROM orders
    WHERE sellerPlaceId=? AND status='paid' AND createdAt>=? AND createdAt<?
  `).get(pid, fromIso, toIso);

  const topItems = db.prepare(`
    SELECT oi.listingId AS listingId,
           oi.titleSnapshot AS title,
           SUM(oi.quantity) AS qty,
           SUM(oi.priceCentsSnapshot * oi.quantity) AS revenueCents
    FROM order_items oi
    JOIN orders o ON o.id=oi.orderId
    WHERE o.sellerPlaceId=? AND o.status='paid' AND o.createdAt>=? AND o.createdAt<?
    GROUP BY oi.listingId, oi.titleSnapshot
    ORDER BY revenueCents DESC
    LIMIT 10
  `).all(pid, fromIso, toIso);

  const daily = db.prepare(`
    SELECT substr(createdAt,1,10) AS dayKey,
           COALESCE(SUM(totalCents),0) AS revenueCents,
           COUNT(*) AS orderCount
    FROM orders
    WHERE sellerPlaceId=? AND status='paid' AND createdAt>=? AND createdAt<?
    GROUP BY dayKey
    ORDER BY dayKey
  `).all(pid, fromIso, toIso);

  const recentOrders = db.prepare(`
    SELECT id AS orderId, createdAt, status, totalCents
    FROM orders
    WHERE sellerPlaceId=? AND status='paid' AND createdAt>=? AND createdAt<?
    ORDER BY createdAt DESC
    LIMIT 10
  `).all(pid, fromIso, toIso);

  return { totals, topItems, daily, recentOrders };
}

function getSellerSalesExport(placeId, fromIso, toIso){
  return db.prepare(`
    SELECT o.id AS orderId, o.createdAt, o.status, o.totalCents, o.subtotalCents, o.serviceGratuityCents,
           oi.listingId, oi.titleSnapshot, oi.quantity, oi.priceCentsSnapshot
    FROM orders o
    JOIN order_items oi ON oi.orderId=o.id
    WHERE o.sellerPlaceId=? AND o.status='paid' AND o.createdAt>=? AND o.createdAt<?
    ORDER BY o.createdAt DESC, oi.id ASC
  `).all(Number(placeId), fromIso, toIso);
}

function countUsers(){
  const row = db.prepare("SELECT COUNT(*) AS c FROM users").get();
  return Number(row?.c || 0);
}
function countUsersSince(fromIso){
  const row = db.prepare("SELECT COUNT(*) AS c FROM users WHERE createdAt>=?").get(String(fromIso || ""));
  return Number(row?.c || 0);
}
function countOrders(){
  const row = db.prepare("SELECT COUNT(*) AS c FROM orders").get();
  return Number(row?.c || 0);
}
function countOrdersSince(fromIso){
  const row = db.prepare("SELECT COUNT(*) AS c FROM orders WHERE createdAt>=?").get(String(fromIso || ""));
  return Number(row?.c || 0);
}
function sumOrderRevenue(){
  const row = db.prepare("SELECT COALESCE(SUM(totalCents),0) AS s FROM orders WHERE status='paid'").get();
  return Number(row?.s || 0);
}
function sumOrderRevenueSince(fromIso){
  const row = db.prepare("SELECT COALESCE(SUM(totalCents),0) AS s FROM orders WHERE status='paid' AND createdAt>=?").get(String(fromIso || ""));
  return Number(row?.s || 0);
}

function listResidentVerificationRequestsByStatus(status){
  const s = (status || "").toString().trim().toLowerCase();
  const where = s ? "WHERE status=?" : "";
  return db.prepare(`
    SELECT * FROM resident_verification_requests
    ${where}
    ORDER BY createdAt ASC
  `).all(s ? s : undefined);
}

function getLatestOrderForListingAndBuyer(listingId, buyerUserId){
  return db.prepare(`
    SELECT o.*
    FROM orders o
    JOIN order_items oi ON oi.orderId=o.id
    WHERE oi.listingId=? AND o.buyerUserId=?
    ORDER BY o.id DESC
    LIMIT 1
  `).get(Number(listingId), Number(buyerUserId)) || null;
}

function markOrderPaid(orderId){
  const updatedAt = nowISO();
  db.prepare("UPDATE orders SET status='paid', updatedAt=? WHERE id=?").run(updatedAt, Number(orderId));
  return db.prepare("SELECT * FROM orders WHERE id=?").get(Number(orderId)) || null;
}

function getDirectConversationById(id){
  return db.prepare("SELECT * FROM direct_conversations WHERE id=?").get(Number(id)) || null;
}
function findDirectConversation(userA, userB){
  const a = Number(userA);
  const b = Number(userB);
  const low = Math.min(a,b);
  const high = Math.max(a,b);
  return db.prepare("SELECT * FROM direct_conversations WHERE userA=? AND userB=?")
    .get(low, high) || null;
}
function addDirectConversation(userA, userB){
  const a = Number(userA);
  const b = Number(userB);
  const low = Math.min(a,b);
  const high = Math.max(a,b);
  const existing = findDirectConversation(low, high);
  if(existing) return existing;
  const info = db.prepare("INSERT INTO direct_conversations (userA, userB, createdAt) VALUES (?,?,?)")
    .run(low, high, nowISO());
  return getDirectConversationById(info.lastInsertRowid);
}
function listDirectConversationsForUser(userId){
  const uid = Number(userId);
  const rows = db.prepare(`
    SELECT id, userA, userB, createdAt
    FROM direct_conversations
    WHERE userA=? OR userB=?
    ORDER BY createdAt DESC
  `).all(uid, uid);
  return rows.map((r)=>{
    const otherUserId = Number(r.userA) === uid ? r.userB : r.userA;
    const otherUser = getUserById(otherUserId);
    const last = db.prepare(`
      SELECT id, senderUserId, text, createdAt
      FROM direct_messages
      WHERE conversationId=?
      ORDER BY createdAt DESC
      LIMIT 1
    `).get(Number(r.id)) || null;
    return {
      id: r.id,
      otherUser: otherUser ? { id: otherUser.id, displayName: getDisplayNameForUser(otherUser), avatarUrl: otherUser.avatarUrl || "" } : null,
      lastMessage: last
    };
  });
}
function isDirectConversationMember(conversationId, userId){
  const convo = getDirectConversationById(conversationId);
  if(!convo) return false;
  const uid = Number(userId);
  return Number(convo.userA) === uid || Number(convo.userB) === uid;
}
function getDirectMessages(conversationId){
  return db.prepare(`
    SELECT id, conversationId, senderUserId, text, createdAt
    FROM direct_messages
    WHERE conversationId=?
    ORDER BY createdAt ASC
  `).all(Number(conversationId));
}
function addDirectMessage(conversationId, senderUserId, text){
  const info = db.prepare("INSERT INTO direct_messages (conversationId, senderUserId, text, createdAt) VALUES (?,?,?,?)")
    .run(Number(conversationId), Number(senderUserId), String(text || ""), nowISO());
  return db.prepare("SELECT * FROM direct_messages WHERE id=?").get(info.lastInsertRowid);
}

function addConversation(payload){
  const info = db.prepare("INSERT INTO conversations (placeId, participant, createdAt) VALUES (?,?,?)")
    .run(Number(payload.placeId), String(payload.participant || "buyer"), nowISO());
  return db.prepare("SELECT * FROM conversations WHERE id=?").get(info.lastInsertRowid);
}
function getConversationById(id){
  return db.prepare("SELECT id, placeId, participant, createdAt FROM conversations WHERE id=?")
    .get(Number(id)) || null;
}
function addMessage(payload){
  const readBy = JSON.stringify([String(payload.sender || "buyer")]);
  const info = db.prepare("INSERT INTO messages (conversationId, sender, text, createdAt, readBy) VALUES (?,?,?,?,?)")
    .run(Number(payload.conversationId), String(payload.sender || "buyer"), String(payload.text || ""), nowISO(), readBy);
  return db.prepare("SELECT * FROM messages WHERE id=?").get(info.lastInsertRowid);
}
function getConversationMessages(conversationId){
  return db.prepare(`
    SELECT id, conversationId, sender, text, createdAt, readBy
    FROM messages
    WHERE conversationId=?
    ORDER BY createdAt ASC
  `).all(Number(conversationId));
}
function getConversationsForPlace(placeId, viewer){
  const convos = db.prepare(`
    SELECT id, placeId, participant, createdAt
    FROM conversations
    WHERE placeId=?
    ORDER BY createdAt DESC
  `).all(Number(placeId));
  if(!viewer) return convos.map(c=>({ ...c, unreadCount: 0 }));
  const v = String(viewer);
  return convos.map((c)=>{
    const msgs = db.prepare("SELECT readBy FROM messages WHERE conversationId=?").all(Number(c.id));
    let unreadCount = 0;
    for(const m of msgs){
      const readBy = parseJsonArray(m.readBy || "[]").map(String);
      if(!readBy.includes(v)) unreadCount += 1;
    }
    return { ...c, unreadCount };
  });
}
function markConversationRead(conversationId, viewer){
  const v = String(viewer || "");
  if(!v) return { ok:false };
  const rows = db.prepare("SELECT id, readBy FROM messages WHERE conversationId=?").all(Number(conversationId));
  for(const row of rows){
    const readBy = parseJsonArray(row.readBy || "[]").map(String);
    if(!readBy.includes(v)){
      readBy.push(v);
      db.prepare("UPDATE messages SET readBy=? WHERE id=?")
        .run(JSON.stringify(readBy), Number(row.id));
    }
  }
  return { ok:true };
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
function addSweepLedgerEntry(payload){
  const info = db.prepare(`
    INSERT INTO sweep_ledger (createdAt, userId, amount, reason, eventId, metaJson)
    VALUES (?,?,?,?,?,?)
  `).run(
    nowISO(),
    Number(payload.userId),
    Number(payload.amount),
    String(payload.reason || ""),
    payload.eventId == null ? null : Number(payload.eventId),
    JSON.stringify(payload.meta || {})
  );
  return info.lastInsertRowid;
}

function createSweepstake(payload){
  const createdAt = nowISO();
  const status = (payload.status || "scheduled").toString().trim().toLowerCase();
  const title = (payload.title || "").toString().trim();
  const prize = (payload.prize || "").toString().trim();
  const entryCost = Number.isFinite(Number(payload.entryCost)) ? Number(payload.entryCost) : 1;
  const maxEntriesPerUserPerDay = Number.isFinite(Number(payload.maxEntriesPerUserPerDay))
    ? Number(payload.maxEntriesPerUserPerDay)
    : 1;
  const startAt = toISOOrEmpty(payload.startAt);
  const endAt = toISOOrEmpty(payload.endAt);
  const drawAt = toISOOrEmpty(payload.drawAt);
  if(!title || !prize || !startAt || !endAt || !drawAt) return { error: "title, prize, startAt, endAt, drawAt required" };
  const info = db.prepare(`
    INSERT INTO sweepstakes (status, title, prize, entryCost, startAt, endAt, drawAt, maxEntriesPerUserPerDay, createdAt)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(status, title, prize, entryCost, startAt, endAt, drawAt, maxEntriesPerUserPerDay, createdAt);
  return getSweepstakeById(info.lastInsertRowid);
}
function getSweepstakeById(id){
  return db.prepare("SELECT * FROM sweepstakes WHERE id=?").get(Number(id)) || null;
}
function getActiveSweepstake(){
  const now = nowISO();
  return db.prepare(`
    SELECT * FROM sweepstakes
    WHERE status='active' AND startAt <= ? AND endAt >= ?
    ORDER BY startAt DESC
    LIMIT 1
  `).get(now, now) || null;
}
function addSweepstakeEntry(sweepstakeId, userId, entries){
  const dayKey = nowISO().slice(0,10);
  const info = db.prepare(`
    INSERT INTO sweepstake_entries (sweepstakeId, userId, entries, dayKey, createdAt)
    VALUES (?,?,?,?,?)
  `).run(Number(sweepstakeId), Number(userId), Number(entries), dayKey, nowISO());
  return db.prepare("SELECT * FROM sweepstake_entries WHERE id=?").get(info.lastInsertRowid);
}
function getSweepstakeEntryTotals(sweepstakeId){
  const row = db.prepare(`
    SELECT COALESCE(SUM(entries),0) AS totalEntries, COUNT(DISTINCT userId) AS totalUsers
    FROM sweepstake_entries
    WHERE sweepstakeId=?
  `).get(Number(sweepstakeId));
  return { totalEntries: row?.totalEntries || 0, totalUsers: row?.totalUsers || 0 };
}
function getUserEntriesForSweepstake(sweepstakeId, userId){
  const row = db.prepare(`
    SELECT COALESCE(SUM(entries),0) AS totalEntries
    FROM sweepstake_entries
    WHERE sweepstakeId=? AND userId=?
  `).get(Number(sweepstakeId), Number(userId));
  return row?.totalEntries || 0;
}
function listSweepstakeParticipants(sweepstakeId){
  return db.prepare(`
    SELECT userId, COALESCE(SUM(entries),0) AS entries
    FROM sweepstake_entries
    WHERE sweepstakeId=?
    GROUP BY userId
    ORDER BY entries DESC, userId ASC
  `).all(Number(sweepstakeId));
}
function getSweepDrawBySweepId(sweepId){
  return db.prepare(`
    SELECT * FROM sweep_draws
    WHERE sweepId=?
    ORDER BY id DESC
    LIMIT 1
  `).get(Number(sweepId)) || null;
}
function getLatestSweepDraw(){
  return db.prepare(`
    SELECT * FROM sweep_draws
    ORDER BY id DESC
    LIMIT 1
  `).get() || null;
}
function createSweepDraw(payload){
  const createdAt = nowISO();
  const info = db.prepare(`
    INSERT INTO sweep_draws
      (sweepId, createdAt, createdByUserId, winnerUserId, totalEntries, snapshotJson)
    VALUES (?,?,?,?,?,?)
  `).run(
    Number(payload.sweepId),
    createdAt,
    payload.createdByUserId == null ? null : Number(payload.createdByUserId),
    Number(payload.winnerUserId),
    Number(payload.totalEntries || 0),
    JSON.stringify(payload.snapshot || {})
  );
  return db.prepare("SELECT * FROM sweep_draws WHERE id=?").get(info.lastInsertRowid) || null;
}
function setSweepstakeWinner(sweepstakeId, winnerUserId){
  db.prepare("UPDATE sweepstakes SET winnerUserId=?, winnerEntryId=NULL, status='ended' WHERE id=?")
    .run(Number(winnerUserId), Number(sweepstakeId));
  return getSweepstakeById(sweepstakeId);
}
function drawSweepstakeWinner(sweepstakeId){
  const sweep = getSweepstakeById(sweepstakeId);
  if(!sweep) return null;
  if(sweep.winnerUserId) return sweep;
  const entries = db.prepare(`
    SELECT id, userId, entries FROM sweepstake_entries
    WHERE sweepstakeId=?
    ORDER BY id ASC
  `).all(Number(sweepstakeId));
  const total = entries.reduce((a,e)=>a + Number(e.entries || 0), 0);
  if(total <= 0){
    db.prepare("UPDATE sweepstakes SET status='ended' WHERE id=?").run(Number(sweepstakeId));
    return getSweepstakeById(sweepstakeId);
  }
  const pick = Math.floor(Math.random() * total) + 1;
  let acc = 0;
  let winner = null;
  for(const e of entries){
    acc += Number(e.entries || 0);
    if(acc >= pick){ winner = e; break; }
  }
  if(!winner) return sweep;
  db.prepare("UPDATE sweepstakes SET winnerUserId=?, winnerEntryId=?, status='ended' WHERE id=?")
    .run(Number(winner.userId), Number(winner.id), Number(sweepstakeId));
  return getSweepstakeById(sweepstakeId);
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

function addEventSubmission(payload){
  const createdAt = nowISO();
  const title = (payload.title || "").toString().trim();
  const description = (payload.description || "").toString().trim();
  const startAt = toISOOrEmpty(payload.startAt);
  const endAt = toISOOrEmpty(payload.endAt);
  const organizerName = (payload.organizerName || "").toString().trim();
  const organizerEmail = normalizeEmail(payload.organizerEmail);
  const category = (payload.category || "community").toString().trim();
  if(!title || !description || !startAt || !endAt || !organizerName || !organizerEmail){
    return { error: "title, description, startAt, endAt, organizerName, organizerEmail required" };
  }
  const info = db.prepare(`
    INSERT INTO events_v1
      (townId, status, title, description, startAt, endAt, locationName, address, placeId,
       organizerName, organizerEmail, organizerPhone, website, category, imageUrl, notesToAdmin,
       createdAt, reviewedAt, reviewedByUserId, decisionReason)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    1,
    "pending",
    title,
    description,
    startAt,
    endAt,
    (payload.locationName || "").toString().trim(),
    (payload.address || "").toString().trim(),
    payload.placeId != null ? Number(payload.placeId) : null,
    organizerName,
    organizerEmail,
    (payload.organizerPhone || "").toString().trim(),
    (payload.website || "").toString().trim(),
    category,
    (payload.imageUrl || "").toString().trim(),
    (payload.notesToAdmin || "").toString().trim(),
    createdAt,
    "",
    null,
    ""
  );
  return db.prepare("SELECT * FROM events_v1 WHERE id=?").get(info.lastInsertRowid);
}

function listApprovedEvents(range){
  const now = new Date();
  const start = range?.from ? toISOOrEmpty(range.from) : now.toISOString();
  const end = range?.to ? toISOOrEmpty(range.to) : new Date(now.getTime()+30*24*60*60*1000).toISOString();
  return db.prepare(`
    SELECT *
    FROM events_v1
    WHERE townId=1 AND status='approved' AND startAt >= ? AND startAt <= ?
    ORDER BY startAt ASC
  `).all(start, end);
}

function getEventById(id){
  return db.prepare("SELECT * FROM events_v1 WHERE id=?").get(Number(id)) || null;
}

function addScheduledLiveShow(payload){
  const createdAt = nowISO();
  const info = db.prepare(`
    INSERT INTO live_show_schedule
    (townId, status, title, description, startAt, endAt, hostUserId, hostType, hostPlaceId, hostEventId, thumbnailUrl, createdAt, updatedAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    Number(payload.townId || 1),
    String(payload.status || "scheduled"),
    String(payload.title || ""),
    String(payload.description || ""),
    String(payload.startAt || ""),
    String(payload.endAt || ""),
    Number(payload.hostUserId),
    String(payload.hostType || "individual"),
    payload.hostPlaceId == null ? null : Number(payload.hostPlaceId),
    payload.hostEventId == null ? null : Number(payload.hostEventId),
    String(payload.thumbnailUrl || ""),
    createdAt,
    ""
  );
  return db.prepare("SELECT * FROM live_show_schedule WHERE id=?").get(info.lastInsertRowid);
}

function listScheduledLiveShows(range){
  const now = new Date();
  const start = range?.from ? toISOOrEmpty(range.from) : now.toISOString();
  const end = range?.to ? toISOOrEmpty(range.to) : new Date(now.getTime()+7*24*60*60*1000).toISOString();
  return db.prepare(`
    SELECT *
    FROM live_show_schedule
    WHERE townId=1 AND status IN ('scheduled','live') AND startAt >= ? AND startAt <= ?
    ORDER BY startAt ASC
  `).all(start, end);
}

function toggleLiveShowBookmark(userId, showId){
  const existing = db.prepare("SELECT id FROM live_show_bookmarks WHERE userId=? AND showId=?")
    .get(Number(userId), Number(showId));
  if(existing){
    db.prepare("DELETE FROM live_show_bookmarks WHERE id=?").run(existing.id);
    return { bookmarked: false };
  }
  db.prepare("INSERT INTO live_show_bookmarks (townId,userId,showId,createdAt) VALUES (?,?,?,?)")
    .run(1, Number(userId), Number(showId), nowISO());
  return { bookmarked: true };
}

function getLiveShowBookmarksForUser(userId){
  return db.prepare("SELECT showId FROM live_show_bookmarks WHERE userId=?").all(Number(userId));
}

function listEventsByStatus(status){
  const s = (status || "pending").toString().trim().toLowerCase();
  return db.prepare("SELECT * FROM events_v1 WHERE status=? ORDER BY createdAt DESC").all(s);
}

function updateEventDecision(id, status, reviewerUserId, decisionReason){
  const reviewedAt = nowISO();
  db.prepare(`
    UPDATE events_v1
    SET status=?, reviewedAt=?, reviewedByUserId=?, decisionReason=?
    WHERE id=?
  `).run(String(status), reviewedAt, reviewerUserId == null ? null : Number(reviewerUserId), String(decisionReason || ""), Number(id));
  return db.prepare("SELECT * FROM events_v1 WHERE id=?").get(Number(id)) || null;
}

function addMediaObject(payload){
  const info = db.prepare(`
    INSERT INTO media_objects
      (townId, ownerUserId, placeId, listingId, eventId, kind, storageDriver, key, url, mime, bytes, createdAt, deletedAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    Number(payload.townId || 1),
    Number(payload.ownerUserId),
    payload.placeId == null ? null : Number(payload.placeId),
    payload.listingId == null ? null : Number(payload.listingId),
    payload.eventId == null ? null : Number(payload.eventId),
    String(payload.kind || "other"),
    String(payload.storageDriver || "local"),
    String(payload.key || ""),
    String(payload.url || ""),
    String(payload.mime || ""),
    Number(payload.bytes || 0),
    nowISO(),
    ""
  );
  return db.prepare("SELECT * FROM media_objects WHERE id=?").get(info.lastInsertRowid);
}

function listMediaObjects({ townId = 1, kind = "", limit = 200 } = {}){
  if(kind){
    return db.prepare(`
      SELECT *
      FROM media_objects
      WHERE townId=? AND kind=?
      ORDER BY createdAt DESC
      LIMIT ?
    `).all(Number(townId), String(kind), Number(limit));
  }
  return db.prepare(`
    SELECT *
    FROM media_objects
    WHERE townId=?
    ORDER BY createdAt DESC
    LIMIT ?
  `).all(Number(townId), Number(limit));
}

function collectUsedMedia(townId = 1){
  const used = new Set();
  const add = (v)=>{
    if(!v) return;
    used.add(v);
    if(typeof v === "string" && v.startsWith("/")) used.add(v.slice(1));
  };
  const places = db.prepare("SELECT bannerUrl, avatarUrl FROM places WHERE townId=?").all(Number(townId));
  places.forEach(p=>{ add(p.bannerUrl); add(p.avatarUrl); });
  const users = db.prepare("SELECT avatarUrl FROM users").all();
  users.forEach(u=>add(u.avatarUrl));
  const events = db.prepare("SELECT imageUrl FROM events_v1 WHERE townId=?").all(Number(townId));
  events.forEach(e=>add(e.imageUrl));
  const listings = db.prepare("SELECT photoUrlsJson FROM listings WHERE townId=?").all(Number(townId));
  listings.forEach(l=>parseJsonArray(l.photoUrlsJson || "[]").forEach(add));
  const archives = db.prepare("SELECT bodyMarkdown FROM archive_entries WHERE townId=?").all(Number(townId));
  const urlRe = /https?:\/\/[^\s)]+|\/uploads\/[^\s)]+/g;
  archives.forEach(a=>{
    const matches = (a.bodyMarkdown || "").match(urlRe) || [];
    matches.forEach(add);
  });
  return used;
}

function listMediaOrphans(townId = 1, limit = 200){
  const media = listMediaObjects({ townId, limit });
  const used = collectUsedMedia(townId);
  return media.filter(m=>{
    if(used.has(m.url)) return false;
    if(used.has(m.key)) return false;
    if(used.has(`/${m.key}`)) return false;
    return true;
  });
}

function listMissingLocalMedia(townId = 1, limit = 200){
  const media = listMediaObjects({ townId, limit }).filter(m=>m.storageDriver === "local");
  const missing = [];
  for(const m of media){
    let key = (m.key || "").toString();
    if(!key && m.url && m.url.startsWith("/")) key = m.url.slice(1);
    if(!key) continue;
    const filePath = path.join(__dirname, "public", key);
    if(!fs.existsSync(filePath)) missing.push(m);
  }
  return missing;
}

function listArchiveEntries(){
  return db.prepare(`
    SELECT *
    FROM archive_entries
    WHERE townId=1 AND status='published'
    ORDER BY pinned DESC, createdAt DESC
  `).all();
}

function getArchiveEntryBySlug(slug){
  return db.prepare(`
    SELECT *
    FROM archive_entries
    WHERE townId=1 AND status='published' AND slug=?
  `).get(String(slug)) || null;
}

function dayKeyFromDate(date){
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function dayRangeForKey(dayKey){
  const start = new Date(`${dayKey}T00:00:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}
function parseJsonObject(text){
  try{
    const obj = JSON.parse(text || "{}");
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
  }catch{
    return {};
  }
}
function normalizePulseRow(row){
  if(!row) return null;
  return {
    ...row,
    metrics: parseJsonObject(row.metricsJson),
    highlights: parseJsonObject(row.highlightsJson)
  };
}
function getLatestPulse(townId = 1){
  const row = db.prepare(`
    SELECT *
    FROM daily_pulses
    WHERE townId=? AND status='published'
    ORDER BY dayKey DESC, createdAt DESC
    LIMIT 1
  `).get(Number(townId));
  return normalizePulseRow(row);
}
function getPulseByDayKey(dayKey, townId = 1){
  const row = db.prepare(`
    SELECT *
    FROM daily_pulses
    WHERE townId=? AND status='published' AND dayKey=?
  `).get(Number(townId), String(dayKey));
  return normalizePulseRow(row);
}
function upsertDailyPulse(payload){
  const createdAt = payload.createdAt || nowISO();
  db.prepare(`
    INSERT INTO daily_pulses
      (townId, dayKey, status, metricsJson, highlightsJson, markdownBody, createdAt)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(dayKey) DO UPDATE SET
      status=excluded.status,
      metricsJson=excluded.metricsJson,
      highlightsJson=excluded.highlightsJson,
      markdownBody=excluded.markdownBody,
      createdAt=excluded.createdAt
  `).run(
    Number(payload.townId || 1),
    String(payload.dayKey),
    String(payload.status || "published"),
    JSON.stringify(payload.metrics || {}),
    JSON.stringify(payload.highlights || {}),
    String(payload.markdownBody || ""),
    createdAt
  );
  return getPulseByDayKey(payload.dayKey, payload.townId || 1);
}
function generateDailyPulse(townId = 1, dayKey){
  const key = (dayKey && String(dayKey).trim()) || dayKeyFromDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const { startIso, endIso } = dayRangeForKey(key);
  const listingsByType = db.prepare(`
    SELECT listingType, COUNT(*) AS c
    FROM listings
    WHERE townId=? AND createdAt>=? AND createdAt<?
    GROUP BY listingType
  `).all(Number(townId), startIso, endIso);
  const listingTypeCounts = {};
  let listingTotal = 0;
  listingsByType.forEach(r=>{
    listingTypeCounts[r.listingType || "item"] = r.c;
    listingTotal += r.c;
  });
  const listingsByCategory = db.prepare(`
    SELECT p.category AS category, COUNT(*) AS c
    FROM listings l
    JOIN places p ON p.id=l.placeId
    WHERE l.townId=? AND l.createdAt>=? AND l.createdAt<?
    GROUP BY p.category
    ORDER BY c DESC
  `).all(Number(townId), startIso, endIso);
  const auctionsStartedCount = db.prepare(`
    SELECT COUNT(*) AS c
    FROM listings
    WHERE townId=? AND listingType='auction' AND auctionStartAt>=? AND auctionStartAt<?
  `).get(Number(townId), startIso, endIso).c || 0;
  const auctionsEndedCount = db.prepare(`
    SELECT COUNT(*) AS c
    FROM listings
    WHERE townId=? AND listingType='auction' AND auctionEndAt>=? AND auctionEndAt<?
  `).get(Number(townId), startIso, endIso).c || 0;
  const highestBidCents = db.prepare(`
    SELECT MAX(amountCents) AS m
    FROM bids
    WHERE townId=? AND createdAt>=? AND createdAt<?
  `).get(Number(townId), startIso, endIso).m || 0;

  const channelPostsCount = db.prepare(`
    SELECT COUNT(*) AS c
    FROM channel_messages
    WHERE createdAt>=? AND createdAt<?
  `).get(startIso, endIso).c || 0;
  const channelImagePostsCount = db.prepare(`
    SELECT COUNT(*) AS c
    FROM channel_messages
    WHERE createdAt>=? AND createdAt<? AND imageUrl!=''
  `).get(startIso, endIso).c || 0;
  const storeMessagesCount = db.prepare(`
    SELECT COUNT(*) AS c
    FROM messages
    WHERE createdAt>=? AND createdAt<?
  `).get(startIso, endIso).c || 0;
  const messagesSentCount = channelPostsCount + storeMessagesCount;

  const newFollowsCount = db.prepare(`
    SELECT COUNT(*) AS c
    FROM store_follows
    WHERE townId=? AND createdAt>=? AND createdAt<?
  `).get(Number(townId), startIso, endIso).c || 0;
  const trustApplicationsSubmittedCount = db.prepare(`
    SELECT COUNT(*) AS c
    FROM trust_applications
    WHERE townId=? AND createdAt>=? AND createdAt<?
  `).get(Number(townId), startIso, endIso).c || 0;
  const trustApprovalsCount = db.prepare(`
    SELECT COUNT(*) AS c
    FROM trust_applications
    WHERE townId=? AND status='approved' AND reviewedAt>=? AND reviewedAt<?
  `).get(Number(townId), startIso, endIso).c || 0;
  const eventsSubmittedCount = db.prepare(`
    SELECT COUNT(*) AS c
    FROM events_v1
    WHERE townId=? AND createdAt>=? AND createdAt<?
  `).get(Number(townId), startIso, endIso).c || 0;
  const eventsApprovedCount = db.prepare(`
    SELECT COUNT(*) AS c
    FROM events_v1
    WHERE townId=? AND status='approved' AND reviewedAt>=? AND reviewedAt<?
  `).get(Number(townId), startIso, endIso).c || 0;
  const liveShowsScheduledCount = db.prepare(`
    SELECT COUNT(*) AS c
    FROM live_show_schedule
    WHERE townId=? AND createdAt>=? AND createdAt<?
  `).get(Number(townId), startIso, endIso).c || 0;
  const liveShowBookmarksCount = db.prepare(`
    SELECT COUNT(*) AS c
    FROM live_show_bookmarks
    WHERE townId=? AND createdAt>=? AND createdAt<?
  `).get(Number(townId), startIso, endIso).c || 0;

  const topChannels = db.prepare(`
    SELECT c.name AS name, COUNT(*) AS c
    FROM channel_messages m
    JOIN channels c ON c.id=m.channelId
    WHERE m.createdAt>=? AND m.createdAt<?
    GROUP BY m.channelId
    ORDER BY c DESC
    LIMIT 3
  `).all(startIso, endIso);
  const topStores = db.prepare(`
    SELECT p.name AS name, COUNT(*) AS c
    FROM store_follows f
    JOIN places p ON p.id=f.placeId
    WHERE f.createdAt>=? AND f.createdAt<?
    GROUP BY f.placeId
    ORDER BY c DESC
    LIMIT 3
  `).all(startIso, endIso);
  const topListings = db.prepare(`
    SELECT l.title AS title, p.name AS placeName
    FROM listings l
    LEFT JOIN places p ON p.id=l.placeId
    WHERE l.createdAt>=? AND l.createdAt<?
    ORDER BY l.createdAt DESC
    LIMIT 3
  `).all(startIso, endIso);

  const metrics = {
    listingTotal,
    listingTypeCounts,
    listingsByCategory,
    auctionsStartedCount,
    auctionsEndedCount,
    highestBidCents,
    messagesSentCount,
    channelPostsCount,
    channelImagePostsCount,
    storeMessagesCount,
    newFollowsCount,
    trustApplicationsSubmittedCount,
    trustApprovalsCount,
    eventsSubmittedCount,
    eventsApprovedCount,
    liveShowsScheduledCount,
    liveShowBookmarksCount
  };
  const highlights = {
    topChannels,
    topStores,
    topListings
  };

  const lines = [];
  lines.push(`# Daily Pulse — Sebastian — ${key}`);
  lines.push("");
  lines.push("## Marketplace");
  const items = listingTypeCounts.item || 0;
  const offers = listingTypeCounts.offer || 0;
  const requests = listingTypeCounts.request || 0;
  const auctions = listingTypeCounts.auction || 0;
  lines.push(`- New listings: ${listingTotal} (items ${items}, offers ${offers}, requests ${requests}, auctions ${auctions})`);
  if(listingsByCategory.length){
    const topCats = listingsByCategory.slice(0,3).map(r=>`${r.category} (${r.c})`).join(", ");
    lines.push(`- Top categories: ${topCats}`);
  }
  if(topStores.length){
    const storeNames = topStores.map(s=>`${s.name} (${s.c})`).join(", ");
    lines.push(`- Most followed stores: ${storeNames}`);
  }
  lines.push(`- Auctions started: ${auctionsStartedCount}, ended: ${auctionsEndedCount}, highest bid: ${highestBidCents} cents`);

  lines.push("");
  lines.push("## Community");
  lines.push(`- Messages sent: ${messagesSentCount} (channels ${channelPostsCount}, stores ${storeMessagesCount})`);
  lines.push(`- Channel image posts: ${channelImagePostsCount}`);
  if(topChannels.length){
    const channelNames = topChannels.map(c=>`${c.name} (${c.c})`).join(", ");
    lines.push(`- Top channels: ${channelNames}`);
  }

  lines.push("");
  lines.push("## Events");
  lines.push(`- Events submitted: ${eventsSubmittedCount}, approved: ${eventsApprovedCount}`);

  lines.push("");
  lines.push("## Trust");
  lines.push(`- Trust applications: ${trustApplicationsSubmittedCount}, approvals: ${trustApprovalsCount}`);

  lines.push("");
  lines.push("## Live");
  lines.push(`- Shows scheduled: ${liveShowsScheduledCount}, bookmarks: ${liveShowBookmarksCount}`);

  const markdownBody = lines.join("\n");
  const pulse = upsertDailyPulse({
    townId,
    dayKey: key,
    status: "published",
    metrics,
    highlights,
    markdownBody
  });

  const slug = `daily-pulse-${key}`;
  const existing = db.prepare("SELECT id FROM archive_entries WHERE slug=?").get(slug);
  if(existing){
    db.prepare(`
      UPDATE archive_entries
      SET title=?, bodyMarkdown=?, createdAt=?
      WHERE slug=?
    `).run(`Daily Pulse — Sebastian — ${key}`, markdownBody, nowISO(), slug);
  }else{
    db.prepare(`
      INSERT INTO archive_entries
        (townId, status, title, slug, bodyMarkdown, createdAt, createdByUserId, pinned, tagsJson)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(
      Number(townId),
      "published",
      `Daily Pulse — Sebastian — ${key}`,
      slug,
      markdownBody,
      nowISO(),
      null,
      0,
      JSON.stringify(["pulse"])
    );
  }
  return pulse;
}

function addWaitlistSignup(payload){
  const createdAt = nowISO();
  const email = normalizeEmail(payload?.email);
  if(!email) return { error: "email required" };
  const name = (payload?.name || "").toString().trim();
  const phone = (payload?.phone || "").toString().trim();
  const notes = (payload?.notes || "").toString().trim();
  let interests = "";
  if(Array.isArray(payload?.interests)){
    interests = payload.interests.map(i=>String(i || "").trim()).filter(Boolean).join(",");
  }else{
    interests = (payload?.interests || "").toString().trim();
  }
  const info = db.prepare(`
    INSERT INTO waitlist_signups
      (createdAt, name, email, phone, interests, notes, status)
    VALUES (?,?,?,?,?,?,?)
  `).run(createdAt, name, email, phone, interests, notes, "pending");
  return db.prepare("SELECT * FROM waitlist_signups WHERE id=?").get(info.lastInsertRowid);
}

function listWaitlistSignupsByStatus(status){
  const s = (status || "pending").toString().trim().toLowerCase();
  return db.prepare("SELECT * FROM waitlist_signups WHERE status=? ORDER BY createdAt DESC")
    .all(s);
}

function updateWaitlistStatus(id, status){
  db.prepare("UPDATE waitlist_signups SET status=? WHERE id=?")
    .run(String(status), Number(id));
  return db.prepare("SELECT * FROM waitlist_signups WHERE id=?").get(Number(id)) || null;
}

function addBusinessApplication(payload){
  const createdAt = nowISO();
  const contactName = (payload?.contactName || "").toString().trim();
  const email = normalizeEmail(payload?.email);
  const businessName = (payload?.businessName || "").toString().trim();
  const type = (payload?.type || "").toString().trim();
  const category = (payload?.category || "").toString().trim();
  const inSebastian = (payload?.inSebastian || "").toString().trim();
  if(!contactName || !email || !businessName || !type || !category || !inSebastian){
    return { error: "contactName, email, businessName, type, category, inSebastian required" };
  }
  const info = db.prepare(`
    INSERT INTO business_applications
      (createdAt, contactName, email, phone, businessName, type, category, website, inSebastian, address, notes, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    createdAt,
    contactName,
    email,
    (payload?.phone || "").toString().trim(),
    businessName,
    type,
    category,
    (payload?.website || "").toString().trim(),
    inSebastian,
    (payload?.address || "").toString().trim(),
    (payload?.notes || "").toString().trim(),
    "pending"
  );
  return db.prepare("SELECT * FROM business_applications WHERE id=?").get(info.lastInsertRowid);
}

function listBusinessApplicationsByStatus(status){
  const s = (status || "pending").toString().trim().toLowerCase();
  return db.prepare("SELECT * FROM business_applications WHERE status=? ORDER BY createdAt DESC")
    .all(s);
}

function updateBusinessApplicationStatus(id, status){
  db.prepare("UPDATE business_applications SET status=? WHERE id=?")
    .run(String(status), Number(id));
  return db.prepare("SELECT * FROM business_applications WHERE id=?").get(Number(id)) || null;
}

function addResidentApplication(payload){
  const createdAt = nowISO();
  const name = (payload?.name || "").toString().trim();
  const email = normalizeEmail(payload?.email);
  const addressLine1 = (payload?.addressLine1 || "").toString().trim();
  const city = (payload?.city || "").toString().trim();
  const state = (payload?.state || "").toString().trim();
  const zip = (payload?.zip || "").toString().trim();
  if(!name || !email || !addressLine1 || !city || !state || !zip){
    return { error: "name, email, addressLine1, city, state, zip required" };
  }
  const info = db.prepare(`
    INSERT INTO resident_applications
      (createdAt, name, email, phone, addressLine1, city, state, zip, yearsInSebastian, notes, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    createdAt,
    name,
    email,
    (payload?.phone || "").toString().trim(),
    addressLine1,
    city,
    state,
    zip,
    (payload?.yearsInSebastian || "").toString().trim(),
    (payload?.notes || "").toString().trim(),
    "pending"
  );
  return db.prepare("SELECT * FROM resident_applications WHERE id=?").get(info.lastInsertRowid);
}

function listResidentApplicationsByStatus(status){
  const s = (status || "pending").toString().trim().toLowerCase();
  return db.prepare("SELECT * FROM resident_applications WHERE status=? ORDER BY createdAt DESC")
    .all(s);
}

function getResidentApplicationById(id){
  return db.prepare("SELECT * FROM resident_applications WHERE id=?").get(Number(id)) || null;
}

function updateResidentApplicationStatus(id, status){
  db.prepare("UPDATE resident_applications SET status=? WHERE id=?")
    .run(String(status), Number(id));
  return db.prepare("SELECT * FROM resident_applications WHERE id=?").get(Number(id)) || null;
}

function addLocalBizApplication(payload, userId){
  const createdAt = nowISO();
  const businessName = (payload.businessName || "").toString().trim();
  const ownerName = (payload.ownerName || "").toString().trim();
  const email = normalizeEmail(payload.email);
  const address = (payload.address || "").toString().trim();
  const city = (payload.city || "Sebastian").toString().trim();
  const state = (payload.state || "FL").toString().trim();
  const zip = (payload.zip || "").toString().trim();
  const category = (payload.category || "").toString().trim();
  const description = (payload.description || "").toString().trim();
  const confirm = payload.confirmSebastian === true || payload.confirmSebastian === 1 || payload.confirmSebastian === "1" || payload.confirmSebastian === "true";
  if(!businessName || !ownerName || !email || !address || !city || !state || !zip || !category || !description){
    return { error: "businessName, ownerName, email, address, city, state, zip, category, description required" };
  }
  if(!confirm) return { error: "confirmSebastian required" };
  const info = db.prepare(`
    INSERT INTO local_business_applications
      (townId, status, businessName, ownerName, email, phone, address, city, state, zip, category,
       website, instagram, description, sustainabilityNotes, confirmSebastian, createdAt, reviewedAt,
       reviewedByUserId, decisionReason, userId)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    1,
    "pending",
    businessName,
    ownerName,
    email,
    (payload.phone || "").toString().trim(),
    address,
    city,
    state,
    zip,
    category,
    (payload.website || "").toString().trim(),
    (payload.instagram || "").toString().trim(),
    description,
    (payload.sustainabilityNotes || "").toString().trim(),
    1,
    createdAt,
    "",
    null,
    "",
    userId == null ? null : Number(userId)
  );
  return db.prepare("SELECT * FROM local_business_applications WHERE id=?").get(info.lastInsertRowid);
}

function listLocalBizApplicationsByUser(userId){
  return db.prepare("SELECT * FROM local_business_applications WHERE userId=? ORDER BY createdAt DESC")
    .all(Number(userId));
}

function listLocalBizApplicationsByStatus(status){
  const s = (status || "pending").toString().trim().toLowerCase();
  return db.prepare("SELECT * FROM local_business_applications WHERE townId=1 AND status=? ORDER BY createdAt DESC")
    .all(s);
}

function updateLocalBizDecision(id, status, reviewerUserId, decisionReason){
  const reviewedAt = nowISO();
  db.prepare(`
    UPDATE local_business_applications
    SET status=?, reviewedAt=?, reviewedByUserId=?, decisionReason=?
    WHERE id=?
  `).run(String(status), reviewedAt, reviewerUserId == null ? null : Number(reviewerUserId), String(decisionReason || ""), Number(id));
  return db.prepare("SELECT * FROM local_business_applications WHERE id=?").get(Number(id)) || null;
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

function getStoreFollowCount(placeId){
  const row = db.prepare("SELECT COUNT(*) AS c FROM store_follows WHERE placeId=?").get(Number(placeId));
  return row?.c || 0;
}
function isFollowingStore(userId, placeId){
  return !!db.prepare("SELECT 1 FROM store_follows WHERE userId=? AND placeId=?")
    .get(Number(userId), Number(placeId));
}
function followStore(userId, placeId){
  db.prepare("INSERT OR IGNORE INTO store_follows (createdAt, userId, placeId) VALUES (?,?,?)")
    .run(nowISO(), Number(userId), Number(placeId));
  return { ok:true };
}
function unfollowStore(userId, placeId){
  db.prepare("DELETE FROM store_follows WHERE userId=? AND placeId=?")
    .run(Number(userId), Number(placeId));
  return { ok:true };
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
  getPlaceById,
  getPlaceOwnerPublic,
  updatePlaceSettings,
  listPlacesByStatus,
  updatePlaceStatus,
  addPlace,
  updatePlaceProfile,
  getListings,
  getListingById,
  updateListingStatus,
  getHighestBidForListing,
  getNextHighestBidForListing,
  getBidCountForListing,
  getLastBidForUser,
  addBid,
  getAuctionSummary,
  updateListingAuctionState,
  createOrderWithItems,
  getOrderItems,
  getLatestOrderForListingAndBuyer,
  markOrderPaid,
  getCartItemsByUser,
  getCartItem,
  addCartItem,
  removeCartItem,
  clearCart,
  createPaymentForOrder,
  getPaymentForOrder,
  markPaymentPaid,
  updateOrderPayment,
  createOrderFromCart,
  getOrdersForBuyer,
  getOrdersForSellerPlaces,
  decrementListingQuantity,
  getDirectConversationById,
  addDirectConversation,
  listDirectConversationsForUser,
  isDirectConversationMember,
  getDirectMessages,
  addDirectMessage,
  addConversation,
  getConversationById,
  getConversationsForPlace,
  getConversationMessages,
  addMessage,
  markConversationRead,
  getChannels,
  createChannel,
  getChannelById,
  isChannelMember,
  getChannelMessages,
  getChannelMessageById,
  createChannelThread,
  addChannelMessage,
  createLiveRoom,
  getLiveRoomById,
  listActiveLiveRooms,
  updateLiveRoom,

  // trust
  ensureTownMembership,
  addPrizeOffer,
  listPrizeOffersByStatus,
  listActivePrizeOffers,
  updatePrizeOfferDecision,
  getPrizeOfferById,
  addPrizeAward,
  updatePrizeAwardStatus,
  getPrizeAwardById,
  listPrizeAwardsForUser,
  setUserTrustTier,
  getTownContext,
  updateUserPresence,
  setUserLocationVerifiedSebastian,
  setUserFacebookVerified,
  setUserResidentVerified,
  setUserAdmin,
  setUserAdminByEmail,
  addResidentVerificationRequest,
  approveResidentVerification,
  updateUserContact,
  addTrustApplication,
  getTrustApplicationsByUser,
  getTrustApplicationsByStatus,
  updateTrustApplicationStatus,
  getCapabilitiesFor,

  // auth
  createMagicLink,
  upsertUserByEmail,
  consumeMagicToken,
  createSession,
  deleteSession,
  getUserBySession,
  getUserById,
  getUserByEmail,
  getUserProfilePublic,
  getUserProfilePrivate,
  updateUserProfile,
  addSignup,

  // events + sweep
  logEvent,
  getSweepBalance,
  addSweepLedgerEntry,
  createSweepstake,
  getSweepstakeById,
  getActiveSweepstake,
  addSweepstakeEntry,
  getSweepstakeEntryTotals,
  getUserEntriesForSweepstake,
  listSweepstakeParticipants,
  getSweepDrawBySweepId,
  getLatestSweepDraw,
  createSweepDraw,
  setSweepstakeWinner,
  drawSweepstakeWinner,
  addCalendarEvent,
  getCalendarEvents,
  getCalendarEventById,
  addEventRsvp,
  addEventSubmission,
  listApprovedEvents,
  getEventById,
  addScheduledLiveShow,
  listScheduledLiveShows,
  toggleLiveShowBookmark,
  getLiveShowBookmarksForUser,
  listEventsByStatus,
  updateEventDecision,
  listArchiveEntries,
  getArchiveEntryBySlug,
  getLatestPulse,
  getPulseByDayKey,
  generateDailyPulse,
  getSellerSalesSummary,
  getSellerSalesExport,
  countUsers,
  countUsersSince,
  countOrders,
  countOrdersSince,
  sumOrderRevenue,
  sumOrderRevenueSince,
  listResidentVerificationRequestsByStatus,
  addMediaObject,
  listMediaObjects,
  listMediaOrphans,
  listMissingLocalMedia,
  addWaitlistSignup,
  listWaitlistSignupsByStatus,
  updateWaitlistStatus,
  addBusinessApplication,
  listBusinessApplicationsByStatus,
  updateBusinessApplicationStatus,
  addResidentApplication,
  listResidentApplicationsByStatus,
  getResidentApplicationById,
  updateResidentApplicationStatus,
  addLocalBizApplication,
  listLocalBizApplicationsByUser,
  listLocalBizApplicationsByStatus,
  updateLocalBizDecision,
  addOrder,
  getOrderById,
  completeOrder,
  getReviewForOrder,
  addReview,
  addDispute,
  listReviews,
  listDisputes,
  addTrustEvent,
  getReviewSummaryForUserDetailed,
  getDisplayNameForUser,
  getStoreFollowCount,
  isFollowingStore,
  followStore,
  unfollowStore,

  // listings
  addListing,
};
