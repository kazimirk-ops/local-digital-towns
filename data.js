const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const db = require("./lib/db");
const { runMigrations } = require("./db/migrate");
const { getTownConfig } = require("./town_config");
const trust = require("./lib/trust");

function nowISO() { return new Date().toISOString(); }
function normalizeEmail(e) { return (e || "").toString().trim().toLowerCase(); }
function randToken(bytes = 24) { return crypto.randomBytes(bytes).toString("hex"); }

function stmt(text) {
  return {
    get: (...params) => db.one(text, params),
    all: (...params) => db.many(text, params),
    run: (...params) => db.query(text, params),
  };
}

// Expose raw query for server.js usage
async function query(sql, params) {
  return db.query(sql, params);
}

function parseJsonArray(s){
  if(Array.isArray(s)) return s;
  try { const v = JSON.parse(s || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function parseJsonObject(s){
  if(s && typeof s === "object" && !Array.isArray(s)) return s;
  try {
    const v = JSON.parse(s || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
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
function normalizeUserRow(row){
  if(!row) return row;
  if(row.isAdmin == null && row.isadmin != null) row.isAdmin = row.isadmin;
  return row;
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
async function runStatements(sql){
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for(const statement of statements){
    await db.query(statement);
  }
}

async function initDb(){
  await runMigrations();

  await seedChannels();
  await seedArchiveEntries();
  await seedAdminUser();
  await seedAdminTestStore();
}

// ---------- Seed ----------
async function seedChannels(){
  const row = await stmt("SELECT COUNT(*) AS c FROM channels").get();
  if((row?.c || 0) > 0) return;
  const now = nowISO();
  await stmt("INSERT INTO channels (name, description, isPublic, createdAt) VALUES ($1,$2,$3,$4)")
    .run("announcements","Town-wide updates",1,now);
  await stmt("INSERT INTO channels (name, description, isPublic, createdAt) VALUES ($1,$2,$3,$4)")
    .run("marketplace","Local offers and requests",1,now);
  await stmt("INSERT INTO channels (name, description, isPublic, createdAt) VALUES ($1,$2,$3,$4)")
    .run("events","Upcoming events and meetups",1,now);
  await stmt("INSERT INTO channels (name, description, isPublic, createdAt) VALUES ($1,$2,$3,$4)")
    .run("general","Community discussion",1,now);
}

async function seedArchiveEntries(){
  const slug = "archive-introduction";
  const row = await stmt("SELECT id FROM archive_entries WHERE slug=$1").get(slug);
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
  await stmt(`
    INSERT INTO archive_entries
      (townId, status, title, slug, bodyMarkdown, createdAt, createdByUserId, pinned, tagsJson)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
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
}

async function seedAdminUser(){
  const email = (process.env.DEV_ADMIN_EMAIL || "admin@local.test").toLowerCase().trim();
  if(!email) return;
  let user = await stmt("SELECT * FROM users WHERE email=$1").get(email);
  if(!user){
    const created = await stmt("INSERT INTO users (email, createdAt) VALUES ($1,$2) RETURNING id").run(email, nowISO());
    user = await stmt("SELECT * FROM users WHERE id=$1").get(created.rows?.[0]?.id);
  }
  if(Number(user.isAdmin) !== 1){
    await stmt("UPDATE users SET isAdmin=1 WHERE id=$1").run(user.id);
  }
  if(!(user.displayName || "").toString().trim()){
    await stmt("UPDATE users SET displayName=$1 WHERE id=$2").run("Admin", user.id);
  }
}

async function seedAdminTestStore(){
  const adminUser = await stmt("SELECT * FROM users WHERE isAdmin=1 ORDER BY id LIMIT 1").get();
  if(!adminUser) return;
  const existing = await stmt("SELECT 1 FROM places WHERE ownerUserId=$1 LIMIT 1").get(adminUser.id);
  if(existing) return;
  await stmt(`
    INSERT INTO places
      (townId, districtId, name, category, status, description, sellerType, addressPrivate, website, yearsInTown, ownerUserId)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
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
}

// ---------- Core getters ----------
async function getPlaces(){
  return stmt(`
    SELECT id, townId, districtId, name, category, status,
           description, website, yearsInTown, bannerUrl, avatarUrl,
           sellerType, visibilityLevel, pickupZone, addressPublic, addressPrivate,
           meetupInstructions, hours, verifiedStatus, ownerUserId
    FROM places WHERE townId=1 ORDER BY id
  `).all();
}
async function getPlaceById(id){
  return stmt(`
    SELECT id, townId, districtId, name, category, status,
           description, website, yearsInTown, bannerUrl, avatarUrl,
           sellerType, visibilityLevel, pickupZone, addressPublic, addressPrivate,
           meetupInstructions, hours, verifiedStatus, ownerUserId
    FROM places WHERE id=$1
  `).get(Number(id)) || null;
}
async function getPlaceOwnerPublic(placeId){
  const place = await getPlaceById(placeId);
  if(!place || !place.ownerUserId) return null;
  const user = await stmt("SELECT id, email FROM users WHERE id=$1").get(Number(place.ownerUserId)) || null;
  return user ? { id: user.id, email: user.email } : null;
}
async function updatePlaceSettings(placeId, payload){
  const place = await getPlaceById(placeId);
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
  await stmt(`
    UPDATE places
    SET sellerType=$1, visibilityLevel=$2, pickupZone=$3, addressPublic=$4, addressPrivate=$5, meetupInstructions=$6, hours=$7
    WHERE id=$8
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

async function listPlacesByStatus(status){
  if(!status) return stmt("SELECT * FROM places ORDER BY id DESC").all();
  return stmt("SELECT * FROM places WHERE status=$1 ORDER BY id DESC")
    .all(String(status));
}
async function updatePlaceStatus(placeId, status){
  const place = await getPlaceById(placeId);
  if(!place) return null;
  await stmt("UPDATE places SET status=$1 WHERE id=$2")
    .run(String(status), Number(placeId));
  return getPlaceById(placeId);
}

async function listPlacesByOwner(userId){
  if(!userId) return [];
  return stmt("SELECT * FROM places WHERE ownerUserId=$1 ORDER BY createdAt DESC").all(Number(userId));
}

async function addPlace(payload){
  const name = (payload?.name || "").toString().trim();
  const category = (payload?.category || "").toString().trim();
  const description = (payload?.description || "").toString().trim();
  const sellerType = (payload?.sellerType || "individual").toString().trim();
  const addressPrivate = (payload?.addressPrivate || "").toString().trim();
  const website = (payload?.website || "").toString().trim();
  const yearsInTown = (payload?.yearsInTown || "").toString().trim();
  const status = (payload?.status || "pending").toString().trim();
  if(!name || !category) return { error: "name and category required" };
  const info = await stmt(`
    INSERT INTO places
      (townId, districtId, name, category, status, description, sellerType, addressPrivate, website, yearsInTown, ownerUserId)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING id
  `).run(
    Number(payload.townId || 1),
    Number(payload.districtId || 1),
    name,
    category,
    status,
    description,
    sellerType,
    addressPrivate,
    website,
    yearsInTown,
    payload.ownerUserId == null ? null : Number(payload.ownerUserId)
  );
  return getPlaceById(info.rows?.[0]?.id);
}

async function updatePlaceProfile(placeId, payload){
  const place = await getPlaceById(placeId);
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
  await stmt(`
    UPDATE places
    SET name=$1, category=$2, description=$3, bannerUrl=$4, avatarUrl=$5, visibilityLevel=$6, pickupZone=$7, meetupInstructions=$8, hours=$9
    WHERE id=$10
  `).run(name, category, description, bannerUrl, avatarUrl, visibilityLevel, pickupZone, meetupInstructions, hours, Number(placeId));
  return getPlaceById(placeId);
}

async function getListings(){
  const rows = await stmt("SELECT * FROM listings ORDER BY id").all();
  return rows.map((l)=>({
    ...l,
    photoUrls: parseJsonArray(l.photoUrlsJson || l.photourlsjson || "[]"),
    listingType: l.listingType || l.listingtype || "item",
    exchangeType: l.exchangeType || l.exchangetype || "money",
    startAt: l.startAt || l.startat || "",
    endAt: l.endAt || l.endat || "",
    offerCategory: l.offerCategory || l.offercategory || "",
    availabilityWindow: l.availabilityWindow || l.availabilitywindow || "",
    compensationType: l.compensationType || l.compensationtype || "",
    auctionStartAt: l.auctionStartAt || l.auctionstartat || "",
    auctionEndAt: l.auctionEndAt || l.auctionendat || "",
    startBidCents: Number(l.startBidCents || l.startbidcents || 0),
    minIncrementCents: Number(l.minIncrementCents || l.minincrementcents || 0),
    reserveCents: (l.reserveCents ?? l.reservecents) == null ? null : Number(l.reserveCents ?? l.reservecents),
    buyNowCents: (l.buyNowCents ?? l.buynowcents) == null ? null : Number(l.buyNowCents ?? l.buynowcents),
    auctionStatus: l.auctionStatus || l.auctionstatus || "active",
    winningBidId: (l.winningBidId ?? l.winningbidid) == null ? null : Number(l.winningBidId ?? l.winningbidid),
    winnerUserId: (l.winnerUserId ?? l.winneruserid) == null ? null : Number(l.winnerUserId ?? l.winneruserid),
    paymentDueAt: l.paymentDueAt || l.paymentdueat || "",
    paymentStatus: l.paymentStatus || l.paymentstatus || "none",
  }));
}

async function getChannels(){
  return stmt("SELECT id, name, description, isPublic, createdAt FROM channels ORDER BY id").all();
}
async function createChannel(name, description, isPublic=1){
  const info = await stmt("INSERT INTO channels (name, description, isPublic, createdAt) VALUES ($1,$2,$3,$4) RETURNING id")
    .run(String(name), String(description || ""), Number(isPublic ? 1 : 0), nowISO());
  return stmt("SELECT id, name, description, isPublic, createdAt FROM channels WHERE id=$1")
    .get(info.rows?.[0]?.id);
}
async function getChannelById(id){
  return stmt("SELECT id, name, description, isPublic, createdAt FROM channels WHERE id=$1")
    .get(Number(id)) || null;
}
async function isChannelMember(channelId, userId){
  return stmt("SELECT 1 FROM channel_memberships WHERE channelId=$1 AND userId=$2")
    .get(Number(channelId), Number(userId)) || null;
}
async function getChannelMessages(channelId, limit=200){
  return stmt(`
    SELECT id, channelId, userId, text, imageUrl, createdAt, replyToId, threadId
    FROM channel_messages
    WHERE channelId=$1
    ORDER BY createdAt ASC
    LIMIT $2
  `).all(Number(channelId), Number(limit));
}
async function getChannelMessageById(id){
  return stmt(`
    SELECT id, channelId, userId, text, imageUrl, createdAt, replyToId, threadId
    FROM channel_messages
    WHERE id=$1
  `).get(Number(id)) || null;
}
async function createChannelThread(channelId, userId){
  const info = await stmt("INSERT INTO message_threads (channelId, createdBy, createdAt) VALUES ($1,$2,$3) RETURNING id")
    .run(Number(channelId), Number(userId), nowISO());
  return info.rows?.[0]?.id;
}
async function addChannelMessage(channelId, userId, text, imageUrl, replyToId, threadId){
  const info = await stmt("INSERT INTO channel_messages (channelId, userId, text, imageUrl, createdAt, replyToId, threadId) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id")
    .run(Number(channelId), Number(userId), String(text), String(imageUrl || ""), nowISO(), replyToId ?? null, Number(threadId));
  return { id: info.rows?.[0]?.id };
}
async function deleteChannelMessage(messageId){
  await stmt("DELETE FROM channel_messages WHERE id=$1").run(Number(messageId));
  return { ok: true };
}
async function isUserMutedInChannel(channelId, userId){
  return !!(await stmt("SELECT 1 FROM channel_mutes WHERE channel_id=$1 AND user_id=$2")
    .get(Number(channelId), Number(userId)));
}
async function upsertChannelMute(channelId, userId, mutedByUserId, reason){
  await stmt(`
    INSERT INTO channel_mutes (channel_id, user_id, muted_by_user_id, reason)
    VALUES ($1,$2,$3,$4)
    ON CONFLICT (channel_id, user_id)
    DO UPDATE SET muted_by_user_id=EXCLUDED.muted_by_user_id, reason=EXCLUDED.reason, created_at=now()
  `).run(Number(channelId), Number(userId), Number(mutedByUserId), String(reason || ""));
  return { ok:true };
}
async function deleteChannelMute(channelId, userId){
  await stmt("DELETE FROM channel_mutes WHERE channel_id=$1 AND user_id=$2")
    .run(Number(channelId), Number(userId));
  return { ok:true };
}

async function createLiveRoom(payload){
  const info = await stmt(`
    INSERT INTO live_rooms
    (townId, status, title, description, hostUserId, hostPlaceId, hostEventId, hostType, hostChannelId, pinnedListingId, createdAt, startedAt, endedAt, cfRoomId, cfRoomToken)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    RETURNING id
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
  return getLiveRoomById(info.rows?.[0]?.id);
}
async function getLiveRoomById(id){
  return (await stmt("SELECT * FROM live_rooms WHERE id=$1").get(Number(id))) || null;
}
async function listActiveLiveRooms(townId=1){
  return stmt("SELECT * FROM live_rooms WHERE townId=$1 AND status='live' ORDER BY startedAt DESC").all(Number(townId));
}
async function updateLiveRoom(id, fields){
  const updates = [];
  const params = [];
  const add = (key, val)=>{
    const index = params.length + 1;
    updates.push(`${key}=$${index}`);
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
  const whereIndex = params.length + 1;
  await stmt(`UPDATE live_rooms SET ${updates.join(", ")} WHERE id=$${whereIndex}`).run(...params, Number(id));
  return getLiveRoomById(id);
}

// ---------- Trust / memberships ----------
async function ensureTownMembership(townId, userId){
  const tid = Number(townId || 1);
  const uid = Number(userId);
  const defaultLevel = trust.getDefaultTrustLevel();

  const existing = await stmt("SELECT * FROM town_memberships WHERE townId=$1 AND userId=$2").get(tid, uid);
  if(existing) return existing;

  await stmt("INSERT INTO town_memberships (createdAt, townId, userId, trustLevel, trustTier, notes) VALUES ($1,$2,$3,$4,$5,$6)")
    .run(nowISO(), tid, uid, defaultLevel, 0, "");
  return stmt("SELECT * FROM town_memberships WHERE townId=$1 AND userId=$2").get(tid, uid);
}

async function setUserTrustTier(townId, userId, trustTier){
  const tid = Number(townId || 1);
  const uid = Number(userId);
  const tier = Number(trustTier);
  if(!uid || !Number.isFinite(tier)) return { error: "Invalid userId or trustTier" };
  await ensureTownMembership(tid, uid);
  await stmt("UPDATE town_memberships SET trustTier=$1 WHERE townId=$2 AND userId=$3")
    .run(tier, tid, uid);
  await stmt("UPDATE users SET trustTier=$1, trustTierUpdatedAt=$2 WHERE id=$3")
    .run(tier, nowISO(), uid);
  return stmt("SELECT * FROM town_memberships WHERE townId=$1 AND userId=$2").get(tid, uid);
}

async function setUserTermsAcceptedAt(userId, termsAcceptedAt){
  const uid = Number(userId);
  if(!uid) return { error: "Invalid userId" };
  const ts = termsAcceptedAt ? new Date(termsAcceptedAt).toISOString() : nowISO();
  await stmt("UPDATE users SET termsAcceptedAt=$1 WHERE id=$2").run(ts, uid);
  return { ok: true, termsAcceptedAt: ts };
}

async function updateUserPresence(userId, payload){
  const uid = Number(userId);
  if(!uid) return { error:"Invalid userId" };
  const now = nowISO();
  await stmt(`
    UPDATE users
    SET presenceVerifiedAt=$1, presenceLat=$2, presenceLng=$3, presenceAccuracyMeters=$4
    WHERE id=$5
  `).run(now, payload.lat, payload.lng, payload.accuracyMeters, uid);
  return { ok:true, presenceVerifiedAt: now };
}

async function setUserLocationVerifiedSebastian(userId, verified){
  const uid = Number(userId);
  if(!uid) return { error:"Invalid userId" };
  await stmt("UPDATE users SET locationVerifiedSebastian=$1 WHERE id=$2")
    .run(verified ? 1 : 0, uid);
  return { ok:true };
}

async function setUserFacebookVerified(userId, verified){
  const uid = Number(userId);
  if(!uid) return { error:"Invalid userId" };
  await stmt("UPDATE users SET facebookVerified=$1 WHERE id=$2")
    .run(verified ? 1 : 0, uid);
  return { ok:true };
}

async function setUserResidentVerified(userId, verified){
  const uid = Number(userId);
  if(!uid) return { error:"Invalid userId" };
  await stmt("UPDATE users SET residentVerified=$1 WHERE id=$2")
    .run(verified ? 1 : 0, uid);
  return { ok:true };
}

async function addResidentVerificationRequest(payload, userId){
  const uid = Number(userId);
  if(!uid) return { error:"Invalid userId" };
  const addressLine1 = (payload.addressLine1 || "").toString().trim();
  const city = (payload.city || "").toString().trim();
  const state = (payload.state || "").toString().trim();
  const zip = (payload.zip || "").toString().trim();
  if(!addressLine1 || !city || !state || !zip) return { error:"addressLine1, city, state, zip required" };
  const info = await stmt(`
    INSERT INTO resident_verification_requests
      (townId, userId, status, addressLine1, city, state, zip, createdAt)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING id
  `).run(1, uid, "pending", addressLine1, city, state, zip, nowISO());
  return stmt("SELECT * FROM resident_verification_requests WHERE id=$1").get(info.rows?.[0]?.id);
}

async function approveResidentVerification(userId, adminUserId){
  const uid = Number(userId);
  if(!uid) return { error:"Invalid userId" };
  const now = nowISO();
  await stmt(`
    UPDATE resident_verification_requests
    SET status='approved', reviewedAt=$1, reviewedByUserId=$2, decisionReason=''
    WHERE userId=$3 AND status='pending'
  `).run(now, adminUserId == null ? null : Number(adminUserId), uid);
  await setUserResidentVerified(uid, true);
  return { ok:true };
}

async function updateUserContact(userId, payload){
  const uid = Number(userId);
  if(!uid) return { error:"Invalid userId" };
  await stmt("UPDATE users SET phone=$1, addressJson=$2 WHERE id=$3")
    .run(payload.phone || "", JSON.stringify(payload.address || {}), uid);
  return { ok:true };
}

async function addTrustApplication(payload){
  const now = nowISO();
  const info = await stmt(`
    INSERT INTO trust_applications
    (townId, userId, requestedTier, status, email, phone, address1, address2, city, state, zip,
     identityMethod, identityStatus, presenceStatus, presenceVerifiedAt, presenceLat, presenceLng, presenceAccuracyMeters, createdAt)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
    RETURNING id
  `).run(
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
  return { id: info.rows?.[0]?.id, createdAt: now };
}

async function getTrustApplicationsByUser(userId){
  return stmt("SELECT * FROM trust_applications WHERE userId=$1 ORDER BY createdAt DESC")
    .all(userId);
}

async function getTrustApplicationsByStatus(status){
  return stmt("SELECT * FROM trust_applications WHERE status=$1 ORDER BY createdAt ASC")
    .all(status || "pending");
}

async function updateTrustApplicationStatus(id, status, reviewedByUserId, decisionReason){
  const now = nowISO();
  await stmt(`
    UPDATE trust_applications
    SET status=$1, reviewedAt=$2, reviewedByUserId=$3, decisionReason=$4
    WHERE id=$5
  `).run(status, now, reviewedByUserId || null, decisionReason || "", id);
  return { ok:true };
}

async function getCapabilitiesFor(townId, trustTier){
  return trust.permissionsForTier(trustTier);
}

async function getTownContext(townId, userId){
  const tid = Number(townId || 1);
  const cfg = await getTownConfig(tid);

  if(!userId){
    const trustTier = trust.LEVELS.VISITOR;
    return { town: cfg, membership: null, trustTier, trustLevel: trust.getDefaultTrustLevel(), capabilities: await getCapabilitiesFor(tid, trustTier) };
  }

  const user = await getUserById(userId);
  const membership = await ensureTownMembership(tid, userId);
  const trustTier = trust.resolveTier(user, { membership });
  const tierName = trust.TRUST_TIER_LABELS[trustTier] || "Visitor";
  return { town: cfg, membership, trustTier, tierName, trustLevel: membership.trustLevel, capabilities: await getCapabilitiesFor(tid, trustTier) };
}

// ---------- Prize offers ----------
async function addPrizeOffer(payload, userId){
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
  const donor = await getUserById(userId);
  const donorDisplayName = donor ? await getDisplayNameForUser(donor) : "Donor";
  const info = await stmt(`
    INSERT INTO prize_offers
      (townId, status, title, description, valueCents, prizeType, fulfillmentMethod, fulfillmentNotes, expiresAt, imageUrl, donorUserId, donorPlaceId, donorDisplayName, createdAt)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    RETURNING id
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
  return stmt("SELECT * FROM prize_offers WHERE id=$1").get(info.rows?.[0]?.id);
}
async function listPrizeOffersByStatus(status){
  const s = (status || "").toString().trim().toLowerCase();
  const where = s ? "WHERE status=$1" : "";
  if(!s){
    return stmt(`
      SELECT * FROM prize_offers
      ORDER BY createdAt DESC
    `).all();
  }
  return stmt(`
    SELECT * FROM prize_offers
    ${where}
    ORDER BY createdAt DESC
  `).all(s);
}
async function listActivePrizeOffers(){
  return stmt(`
    SELECT * FROM prize_offers
    WHERE status IN ('approved','active')
    ORDER BY createdAt DESC
  `).all();
}
async function updatePrizeOfferDecision(id, status, reviewerUserId, decisionReason){
  const reviewedAt = nowISO();
  await stmt(`
    UPDATE prize_offers
    SET status=$1, reviewedAt=$2, reviewedByUserId=$3, decisionReason=$4
    WHERE id=$5
  `).run(String(status), reviewedAt, reviewerUserId == null ? null : Number(reviewerUserId), String(decisionReason || ""), Number(id));
  return (await stmt("SELECT * FROM prize_offers WHERE id=$1").get(Number(id))) || null;
}
async function getPrizeOfferById(id){
  return (await stmt("SELECT * FROM prize_offers WHERE id=$1").get(Number(id))) || null;
}
async function addPrizeAward(payload){
  const createdAt = nowISO();
  const updatedAt = createdAt;
  const info = await stmt(`
    INSERT INTO prize_awards
      (townId, prizeOfferId, winnerUserId, donorUserId, donorPlaceId, status, dueBy, convoId, proofUrl, createdAt, updatedAt)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING id
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
  return stmt("SELECT * FROM prize_awards WHERE id=$1").get(info.rows?.[0]?.id);
}
async function updatePrizeAwardStatus(id, status, patch){
  const updatedAt = nowISO();
  const proofUrl = (patch?.proofUrl || "").toString();
  const convoId = patch?.convoId == null ? null : Number(patch.convoId);
  await stmt(`
    UPDATE prize_awards
    SET status=$1, proofUrl=COALESCE(NULLIF($2,''), proofUrl), convoId=COALESCE($3, convoId), updatedAt=$4
    WHERE id=$5
  `).run(String(status), proofUrl, convoId, updatedAt, Number(id));
  return (await stmt("SELECT * FROM prize_awards WHERE id=$1").get(Number(id))) || null;
}
async function getPrizeAwardById(id){
  return (await stmt("SELECT * FROM prize_awards WHERE id=$1").get(Number(id))) || null;
}
async function listPrizeAwardsForUser(userId, placeId){
  const uid = Number(userId);
  if(placeId){
    return stmt(`
      SELECT pa.*, po.title, po.donorDisplayName
      FROM prize_awards pa
      JOIN prize_offers po ON po.id=pa.prizeOfferId
      WHERE pa.donorPlaceId=$1
      ORDER BY pa.updatedAt DESC
    `).all(Number(placeId));
  }
  return stmt(`
    SELECT pa.*, po.title, po.donorDisplayName
    FROM prize_awards pa
    JOIN prize_offers po ON po.id=pa.prizeOfferId
    WHERE pa.winnerUserId=$1 OR pa.donorUserId=$2
    ORDER BY pa.updatedAt DESC
  `).all(uid, uid);
}

// ---------- Auth ----------
async function upsertUserByEmail(email){
  const e = normalizeEmail(email);
  if(!e) return null;
  const existing = await stmt("SELECT * FROM users WHERE email=$1").get(e);
  if(existing) return existing;
  const info = await stmt("INSERT INTO users (email, createdAt) VALUES ($1,$2) RETURNING id").run(e, nowISO());
  return stmt("SELECT * FROM users WHERE id=$1").get(info.rows?.[0]?.id);
}
async function setUserAdmin(userId, isAdmin){
  const uid = Number(userId);
  if(!uid) return { error:"Invalid userId" };
  await stmt("UPDATE users SET isAdmin=$1 WHERE id=$2")
    .run(isAdmin ? 1 : 0, uid);
  return normalizeUserRow((await stmt("SELECT * FROM users WHERE id=$1").get(uid)) || null);
}
async function setUserAdminByEmail(email, isAdmin){
  const user = await upsertUserByEmail(email);
  if(!user) return { error:"Invalid email" };
  return setUserAdmin(user.id, isAdmin);
}
function generateSixDigitCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function createAuthCode(email) {
  const e = normalizeEmail(email);
  if (!e) return { error: "Invalid email" };

  // Rate limit: 1 code per 60 seconds
  const recent = await stmt(`
    SELECT * FROM auth_codes
    WHERE email=$1 AND createdAt > $2
    ORDER BY createdAt DESC
    LIMIT 1
  `).get(e, new Date(Date.now() - 60 * 1000).toISOString());

  if (recent) {
    return { error: "Please wait 60 seconds before requesting another code" };
  }

  const code = generateSixDigitCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const createdAt = nowISO();

  await stmt(`
    INSERT INTO auth_codes (email, code, expiresAt, createdAt)
    VALUES ($1, $2, $3, $4)
  `).run(e, code, expiresAt, createdAt);

  return { ok: true, code, email: e, expiresAt };
}

async function verifyAuthCode(email, code) {
  const e = normalizeEmail(email);
  if (!e) return { error: "Invalid email" };

  const row = await stmt(`
    SELECT * FROM auth_codes
    WHERE email=$1 AND code=$2 AND used=0
    ORDER BY createdAt DESC
    LIMIT 1
  `).get(e, String(code));

  if (!row) {
    return { error: "Invalid code" };
  }

  const expiresAt = row.expiresAt ?? row.expiresat;
  if (new Date(expiresAt).getTime() < Date.now()) {
    return { error: "Code expired" };
  }

  // Mark as used
  await stmt("UPDATE auth_codes SET used=1 WHERE id=$1").run(row.id);

  // Get or create user
  const user = await upsertUserByEmail(e);
  if (!user) {
    return { error: "Failed to create user" };
  }

  return { ok: true, userId: user.id };
}

async function cleanupExpiredAuthCodes() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await stmt("DELETE FROM auth_codes WHERE createdAt < $1").run(cutoff);
}
async function createSession(userId){
  const sid = randToken(24);
  const expiresAt = new Date(Date.now()+30*24*60*60*1000).toISOString();
  console.log("SESSION_CREATE", { userId: Number(userId) });
  await stmt("INSERT INTO sessions (sid,userId,expiresAt,createdAt) VALUES ($1,$2,$3,$4)")
    .run(sid, Number(userId), expiresAt, nowISO());
  return {sid,expiresAt};
}
async function deleteSession(sid){
  await stmt("DELETE FROM sessions WHERE sid=$1").run(sid);
}
async function getUserBySession(sid){
  const sess= await stmt("SELECT * FROM sessions WHERE sid=$1").get(sid);
  console.log("SESSION_LOOKUP", { found: !!sess });
  if(!sess) return null;
    const expiresAt = sess.expiresAt ?? sess.expiresat;
  const userId = sess.userId ?? sess.userid;
  if(new Date(expiresAt).getTime() < Date.now()){ await deleteSession(sid); return null; }
  const user = normalizeUserRow(await stmt("SELECT * FROM users WHERE id=$1").get(userId));
  if(!user) return null;
  const signup= await stmt("SELECT * FROM signups WHERE email=$1 ORDER BY id DESC LIMIT 1").get(user.email) || null;
  return {user,signup};
}

async function getUserById(id){
  if (!id || isNaN(Number(id))) return null;
  return normalizeUserRow((await stmt("SELECT * FROM users WHERE id=$1").get(Number(id))) || null);
}
async function getUserByEmail(email){
  const e = normalizeEmail(email);
  if(!e) return null;
  return normalizeUserRow((await stmt("SELECT * FROM users WHERE email=$1").get(e)) || null);
}
async function getAllUsers(){
  return stmt("SELECT * FROM users ORDER BY id DESC").all();
}
async function setUserReferredByUserId(userId, referrerUserId){
  const u = await getUserById(userId);
  if(!u) return null;
  const existing = u.referredByUserId ?? u.referredbyuserid;
  if(existing) return u;
  await stmt("UPDATE users SET referredByUserId=$1 WHERE id=$2")
    .run(Number(referrerUserId), Number(userId));
  return getUserById(userId);
}
async function getDisplayNameForUser(user){
  const name = (user?.displayName || "").toString().trim();
  if(name) return name;
  const email = (user?.email || "").toString().trim();
  if(email) return email.split("@")[0] || email;
  return `User #${user?.id || "?"}`;
}
async function getReviewSummaryForUser(userId){
  const row = await stmt("SELECT COUNT(*) AS count, AVG(rating) AS avg FROM reviews WHERE revieweeUserId=$1")
    .get(Number(userId)) || { count: 0, avg: null };
  return { count: row.count || 0, average: row.avg == null ? 0 : Number(row.avg) };
}
async function getReviewSummaryForUserDetailed(userId){
  const row = await stmt(`
    SELECT
      COUNT(*) AS count,
      AVG(rating) AS avg,
      SUM(CASE WHEN role='buyer' THEN 1 ELSE 0 END) AS buyerCount,
      SUM(CASE WHEN role='seller' THEN 1 ELSE 0 END) AS sellerCount
    FROM reviews
    WHERE revieweeUserId=$1
  `).get(Number(userId)) || { count: 0, avg: null, buyerCount: 0, sellerCount: 0 };
  return {
    count: row.count || 0,
    average: row.avg == null ? 0 : Number(row.avg),
    buyerCount: row.buyerCount || 0,
    sellerCount: row.sellerCount || 0
  };
}
async function getUserRoles(userId){
  const seller = await stmt("SELECT 1 FROM places WHERE ownerUserId=$1 LIMIT 1").get(Number(userId));
  const buyer = await stmt("SELECT 1 FROM orders WHERE buyerUserId=$1 LIMIT 1").get(Number(userId));
  return { isBuyer: !!buyer, isSeller: !!seller };
}
async function getUserProfilePublic(userId){
  const user = await getUserById(userId);
  if(!user) return null;
  const profile = { id: user.id, displayName: await getDisplayNameForUser(user) };
  if(Number(user.showAvatar) === 1 && user.avatarUrl) profile.avatarUrl = user.avatarUrl;
  if(Number(user.showBio) === 1 && user.bio) profile.bio = user.bio;
  if(Number(user.showInterests) === 1){
    const interests = parseJsonArray(user.interestsJson || "[]");
    if(interests.length) profile.interests = interests;
  }
  if(Number(user.showAgeRange) === 1 && user.ageRange) profile.ageRange = user.ageRange;
  if(Number(user.isBuyerVerified) === 1) profile.isBuyerVerified = true;
  if(Number(user.isSellerVerified) === 1) profile.isSellerVerified = true;
  const roles = await getUserRoles(user.id);
  if(roles.isBuyer) profile.isBuyer = true;
  if(roles.isSeller) profile.isSeller = true;
  const reviews = await getReviewSummaryForUser(user.id);
  if(reviews.count > 0) profile.reviews = reviews;
  return profile;
}
async function getUserProfilePrivate(userId){
  const user = await getUserById(userId);
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
async function updateUserProfile(userId, payload){
  const user = await getUserById(userId);
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
  await stmt(`
    UPDATE users
    SET displayName=$1, bio=$2, avatarUrl=$3, interestsJson=$4, ageRange=$5, showAvatar=$6, showBio=$7, showInterests=$8, showAgeRange=$9
    WHERE id=$10
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

async function getListingById(id){
  const l = await stmt("SELECT * FROM listings WHERE id=$1").get(Number(id));
  if(!l) return null;
  return {
    ...l,
    photoUrls: parseJsonArray(l.photoUrlsJson || l.photourlsjson || "[]"),
    listingType: l.listingType || l.listingtype || "item",
    exchangeType: l.exchangeType || l.exchangetype || "money",
    startAt: l.startAt || l.startat || "",
    endAt: l.endAt || l.endat || "",
    auctionStartAt: l.auctionStartAt || l.auctionstartat || "",
    auctionEndAt: l.auctionEndAt || l.auctionendat || "",
    startBidCents: Number(l.startBidCents || l.startbidcents || 0),
    minIncrementCents: Number(l.minIncrementCents || l.minincrementcents || 0),
    reserveCents: (l.reserveCents ?? l.reservecents) == null ? null : Number(l.reserveCents ?? l.reservecents),
    buyNowCents: (l.buyNowCents ?? l.buynowcents) == null ? null : Number(l.buyNowCents ?? l.buynowcents),
    auctionStatus: l.auctionStatus || l.auctionstatus || "active",
    winningBidId: (l.winningBidId ?? l.winningbidid) == null ? null : Number(l.winningBidId ?? l.winningbidid),
    winnerUserId: (l.winnerUserId ?? l.winneruserid) == null ? null : Number(l.winnerUserId ?? l.winneruserid),
    paymentDueAt: l.paymentDueAt || l.paymentdueat || "",
    paymentStatus: l.paymentStatus || l.paymentstatus || "none",
  };
}
async function updateListingStatus(listingId, status){
  await stmt("UPDATE listings SET status=$1 WHERE id=$2").run(String(status), Number(listingId));
  return getListingById(listingId);
}
async function getHighestBidForListing(listingId){
  const row = await stmt("SELECT id, amountCents, userId, createdAt FROM bids WHERE listingId=$1 ORDER BY amountCents DESC, createdAt DESC LIMIT 1")
    .get(Number(listingId));
  if (!row) return null;
  // Normalize PostgreSQL lowercase columns
  return {
    id: row.id,
    amountCents: row.amountCents || row.amountcents || 0,
    userId: row.userId || row.userid,
    createdAt: row.createdAt || row.createdat
  };
}
async function getNextHighestBidForListing(listingId, excludeUserId){
  const row = await stmt(`
    SELECT id, amountCents, userId, createdAt
    FROM bids
    WHERE listingId=$1 AND userId!=$2
    ORDER BY amountCents DESC, createdAt DESC
    LIMIT 1
  `).get(Number(listingId), Number(excludeUserId));
  if (!row) return null;
  // Normalize PostgreSQL lowercase columns
  return {
    id: row.id,
    amountCents: row.amountCents || row.amountcents || 0,
    userId: row.userId || row.userid,
    createdAt: row.createdAt || row.createdat
  };
}
async function getBidCountForListing(listingId){
  const row = await stmt("SELECT COUNT(*) AS c FROM bids WHERE listingId=$1").get(Number(listingId));
  return row?.c || 0;
}
async function getLastBidForUser(listingId, userId){
  const row = await stmt("SELECT createdAt FROM bids WHERE listingId=$1 AND userId=$2 ORDER BY createdAt DESC LIMIT 1")
    .get(Number(listingId), Number(userId));
  if (!row) return null;
  // Normalize PostgreSQL lowercase columns
  return {
    createdAt: row.createdAt || row.createdat
  };
}
async function addBid(listingId, userId, amountCents){
  const createdAt = nowISO();
  const info = await stmt("INSERT INTO bids (listingId,userId,amountCents,createdAt) VALUES ($1,$2,$3,$4) RETURNING id")
    .run(Number(listingId), Number(userId), Number(amountCents), createdAt);
  return {id: info.rows?.[0]?.id, listingId:Number(listingId), userId:Number(userId), amountCents:Number(amountCents), createdAt};
}
async function getAuctionSummary(listingId){
  const highest = await getHighestBidForListing(listingId);
  const bidCount = await getBidCountForListing(listingId);
  return {highestBidCents: highest?.amountCents || 0, bidCount};
}

async function updateListingAuctionState(listingId, payload){
  const auctionStatus = (payload.auctionStatus || "").toString().trim() || "active";
  const winningBidId = payload.winningBidId == null ? null : Number(payload.winningBidId);
  const winnerUserId = payload.winnerUserId == null ? null : Number(payload.winnerUserId);
  const paymentDueAt = (payload.paymentDueAt || "").toString();
  const paymentStatus = (payload.paymentStatus || "").toString().trim() || "none";
  await stmt(`
    UPDATE listings
    SET auctionStatus=$1, winningBidId=$2, winnerUserId=$3, paymentDueAt=$4, paymentStatus=$5
    WHERE id=$6
  `).run(auctionStatus, winningBidId, winnerUserId, paymentDueAt, paymentStatus, Number(listingId));
  return getListingById(listingId);
}

async function createOrderWithItems(payload){
  const createdAt = nowISO();
  const updatedAt = createdAt;
  const info = await stmt(`
    INSERT INTO orders
      (townId, listingId, buyerUserId, sellerUserId, sellerPlaceId, quantity, amountCents, status, createdAt, updatedAt, completedAt, paymentProvider, paymentIntentId, subtotalCents, serviceGratuityCents, totalCents, fulfillmentType, fulfillmentNotes)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    RETURNING id
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
  const orderId = info.rows?.[0]?.id;
  await stmt(`
    INSERT INTO order_items
      (orderId, listingId, titleSnapshot, priceCentsSnapshot, quantity, sellerPlaceId, createdAt)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
  `).run(
    Number(orderId),
    Number(payload.listingId),
    String(payload.titleSnapshot || ""),
    Number(payload.priceCentsSnapshot || 0),
    Number(payload.quantity || 1),
    Number(payload.sellerPlaceId || 0),
    createdAt
  );
  return stmt("SELECT * FROM orders WHERE id=$1").get(Number(orderId));
}

async function getOrderItems(orderId){
  return stmt(`
    SELECT id, orderId, listingId, titleSnapshot, priceCentsSnapshot, quantity, sellerPlaceId, createdAt
    FROM order_items
    WHERE orderId=$1
    ORDER BY id
  `).all(Number(orderId));
}

async function getCartItemsByUser(userId){
  return stmt(`
    SELECT id, townId, userId, listingId, quantity, createdAt
    FROM cart_items
    WHERE userId=$1
    ORDER BY id DESC
  `).all(Number(userId));
}
async function getCartItem(userId, listingId){
  return (await stmt(`
    SELECT id, townId, userId, listingId, quantity, createdAt
    FROM cart_items
    WHERE userId=$1 AND listingId=$2
  `).get(Number(userId), Number(listingId))) || null;
}
async function addCartItem(userId, listingId, quantity){
  const createdAt = nowISO();
  const existing = await getCartItem(userId, listingId);
  if(existing){
    const nextQty = Number(existing.quantity || 0) + Number(quantity || 0);
    if(nextQty <= 0){
      await stmt("DELETE FROM cart_items WHERE id=$1").run(Number(existing.id));
      return null;
    }
    await stmt("UPDATE cart_items SET quantity=$1 WHERE id=$2").run(nextQty, Number(existing.id));
    return getCartItem(userId, listingId);
  }
  const info = await stmt(`
    INSERT INTO cart_items (townId, userId, listingId, quantity, createdAt)
    VALUES ($1,$2,$3,$4,$5)
    RETURNING id
  `).run(1, Number(userId), Number(listingId), Number(quantity || 1), createdAt);
  return stmt("SELECT * FROM cart_items WHERE id=$1").get(info.rows?.[0]?.id);
}
async function removeCartItem(userId, listingId){
  await stmt("DELETE FROM cart_items WHERE userId=$1 AND listingId=$2").run(Number(userId), Number(listingId));
  return { ok:true };
}
async function clearCart(userId){
  await stmt("DELETE FROM cart_items WHERE userId=$1").run(Number(userId));
  return { ok:true };
}

async function createPaymentForOrder(orderId, amountCents, provider="stub"){
  const createdAt = nowISO();
  const info = await stmt(`
    INSERT INTO payments (orderId, provider, status, amountCents, createdAt)
    VALUES ($1,$2,$3,$4,$5)
    RETURNING id
  `).run(Number(orderId), String(provider), "requires_payment", Number(amountCents), createdAt);
  return stmt("SELECT * FROM payments WHERE id=$1").get(info.rows?.[0]?.id);
}
async function getPaymentForOrder(orderId){
  return (await stmt("SELECT * FROM payments WHERE orderId=$1 ORDER BY id DESC LIMIT 1")
    .get(Number(orderId))) || null;
}
async function markPaymentPaid(orderId){
  await stmt("UPDATE payments SET status='paid' WHERE orderId=$1").run(Number(orderId));
  return (await stmt("SELECT * FROM payments WHERE orderId=$1 ORDER BY id DESC LIMIT 1").get(Number(orderId))) || null;
}
async function updateOrderPayment(orderId, provider, paymentIntentId){
  const updatedAt = nowISO();
  await stmt("UPDATE orders SET paymentProvider=$1, paymentIntentId=$2, updatedAt=$3 WHERE id=$4")
    .run(String(provider || "stripe"), String(paymentIntentId || ""), updatedAt, Number(orderId));
  return (await stmt("SELECT * FROM orders WHERE id=$1").get(Number(orderId))) || null;
}

async function createOrderFromCart(payload, items){
  const createdAt = nowISO();
  const updatedAt = createdAt;
  const info = await stmt(`
    INSERT INTO orders
      (townId, listingId, buyerUserId, sellerUserId, sellerPlaceId, quantity, amountCents, status, createdAt, updatedAt, completedAt, paymentProvider, paymentIntentId, subtotalCents, serviceGratuityCents, totalCents, fulfillmentType, fulfillmentNotes)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    RETURNING id
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
  const orderId = info.rows?.[0]?.id;
  for(const item of items){
    await stmt(`
      INSERT INTO order_items
        (orderId, listingId, titleSnapshot, priceCentsSnapshot, quantity, sellerPlaceId, createdAt)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
    `).run(
      Number(orderId),
      Number(item.listingId),
      String(item.titleSnapshot || ""),
      Number(item.priceCentsSnapshot || 0),
      Number(item.quantity || 1),
      Number(payload.sellerPlaceId || 0),
      createdAt
    );
  }
  return stmt("SELECT * FROM orders WHERE id=$1").get(Number(orderId));
}

async function getOrdersForBuyer(userId){
  return stmt(`
    SELECT * FROM orders
    WHERE buyerUserId=$1
    ORDER BY createdAt DESC
  `).all(Number(userId));
}
async function getOrdersForSellerPlaces(placeIds){
  if(!placeIds.length) return [];
  const ids = placeIds.map(Number);
  const placeholders = ids.map((_, idx)=>`$${idx + 1}`).join(",");
  return stmt(`
    SELECT * FROM orders
    WHERE sellerPlaceId IN (${placeholders})
    ORDER BY createdAt DESC
  `).all(...ids);
}

async function getAllOrders(){
  return stmt("SELECT * FROM orders ORDER BY createdAt DESC").all();
}

async function decrementListingQuantity(listingId, quantity){
  const listing = await getListingById(listingId);
  if(!listing) return null;
  const current = Number(listing.quantity || 0);
  const next = Math.max(0, current - Number(quantity || 0));
  const status = next <= 0 ? "sold" : listing.status;
  await stmt("UPDATE listings SET quantity=$1, status=$2 WHERE id=$3")
    .run(next, String(status || listing.status || "active"), Number(listingId));
  return getListingById(listingId);
}

async function getSellerSalesSummary(placeId, fromIso, toIso){
  const pid = Number(placeId);
  const totals = await stmt(`
    SELECT COALESCE(SUM(totalCents),0) AS revenueCents, COUNT(*) AS orderCount
    FROM orders
    WHERE sellerPlaceId=$1 AND status='paid' AND createdAt>=$2 AND createdAt<$3
  `).get(pid, fromIso, toIso);

  const topItems = await stmt(`
    SELECT oi.listingId AS listingId,
           oi.titleSnapshot AS title,
           SUM(oi.quantity) AS qty,
           SUM(oi.priceCentsSnapshot * oi.quantity) AS revenueCents
    FROM order_items oi
    JOIN orders o ON o.id=oi.orderId
    WHERE o.sellerPlaceId=$1 AND o.status='paid' AND o.createdAt>=$2 AND o.createdAt<$3
    GROUP BY oi.listingId, oi.titleSnapshot
    ORDER BY revenueCents DESC
    LIMIT 10
  `).all(pid, fromIso, toIso);

  const daily = await stmt(`
    SELECT to_char(createdAt, 'YYYY-MM-DD') AS dayKey,
           COALESCE(SUM(totalCents),0) AS revenueCents,
           COUNT(*) AS orderCount
    FROM orders
    WHERE sellerPlaceId=$1 AND status='paid' AND createdAt>=$2 AND createdAt<$3
    GROUP BY dayKey
    ORDER BY dayKey
  `).all(pid, fromIso, toIso);

  const recentOrders = await stmt(`
    SELECT id AS orderId, createdAt, status, totalCents
    FROM orders
    WHERE sellerPlaceId=$1 AND status='paid' AND createdAt>=$2 AND createdAt<$3
    ORDER BY createdAt DESC
    LIMIT 10
  `).all(pid, fromIso, toIso);

  return { totals, topItems, daily, recentOrders };
}

async function getSellerSalesExport(placeId, fromIso, toIso){
  return stmt(`
    SELECT o.id AS orderId, o.createdAt, o.status, o.totalCents, o.subtotalCents, o.serviceGratuityCents,
           oi.listingId, oi.titleSnapshot, oi.quantity, oi.priceCentsSnapshot
    FROM orders o
    JOIN order_items oi ON oi.orderId=o.id
    WHERE o.sellerPlaceId=$1 AND o.status='paid' AND o.createdAt>=$2 AND o.createdAt<$3
    ORDER BY o.createdAt DESC, oi.id ASC
  `).all(Number(placeId), fromIso, toIso);
}

async function countUsers(){
  const row = await stmt("SELECT COUNT(*) AS c FROM users").get();
  return Number(row?.c || 0);
}
async function countUsersSince(fromIso){
  const row = await stmt("SELECT COUNT(*) AS c FROM users WHERE createdAt>=$1").get(String(fromIso || ""));
  return Number(row?.c || 0);
}
async function countOrders(){
  const row = await stmt("SELECT COUNT(*) AS c FROM orders").get();
  return Number(row?.c || 0);
}
async function countOrdersSince(fromIso){
  const row = await stmt("SELECT COUNT(*) AS c FROM orders WHERE createdAt>=$1").get(String(fromIso || ""));
  return Number(row?.c || 0);
}
async function sumOrderRevenue(){
  const row = await stmt("SELECT COALESCE(SUM(totalCents),0) AS s FROM orders WHERE status='paid'").get();
  return Number(row?.s || 0);
}
async function sumOrderRevenueSince(fromIso){
  const row = await stmt("SELECT COALESCE(SUM(totalCents),0) AS s FROM orders WHERE status='paid' AND createdAt>=$1").get(String(fromIso || ""));
  return Number(row?.s || 0);
}

async function listResidentVerificationRequestsByStatus(status){
  const s = (status || "").toString().trim().toLowerCase();
  const where = s ? "WHERE status=$1" : "";
  if(!s){
    return stmt(`
      SELECT * FROM resident_verification_requests
      ORDER BY createdAt ASC
    `).all();
  }
  return stmt(`
    SELECT * FROM resident_verification_requests
    ${where}
    ORDER BY createdAt ASC
  `).all(s);
}

async function getLatestOrderForListingAndBuyer(listingId, buyerUserId){
  return (await stmt(`
    SELECT o.*
    FROM orders o
    JOIN order_items oi ON oi.orderId=o.id
    WHERE oi.listingId=$1 AND o.buyerUserId=$2
    ORDER BY o.id DESC
    LIMIT 1
  `).get(Number(listingId), Number(buyerUserId))) || null;
}

async function markOrderPaid(orderId){
  const updatedAt = nowISO();
  await stmt("UPDATE orders SET status='paid', updatedAt=$1 WHERE id=$2").run(updatedAt, Number(orderId));
  return (await stmt("SELECT * FROM orders WHERE id=$1").get(Number(orderId))) || null;
}

async function getDirectConversationById(id){
  return (await stmt("SELECT * FROM direct_conversations WHERE id=$1").get(Number(id))) || null;
}
async function findDirectConversation(userA, userB){
  const a = Number(userA);
  const b = Number(userB);
  const low = Math.min(a,b);
  const high = Math.max(a,b);
  return (await stmt("SELECT * FROM direct_conversations WHERE userA=$1 AND userB=$2")
    .get(low, high)) || null;
}
async function addDirectConversation(userA, userB){
  const a = Number(userA);
  const b = Number(userB);
  const low = Math.min(a,b);
  const high = Math.max(a,b);
  const existing = await findDirectConversation(low, high);
  if(existing) return existing;
  const info = await stmt("INSERT INTO direct_conversations (userA, userB, createdAt) VALUES ($1,$2,$3) RETURNING id")
    .run(low, high, nowISO());
  return getDirectConversationById(info.rows?.[0]?.id);
}
async function listDirectConversationsForUser(userId){
  const uid = Number(userId);
  const rows = await stmt(`
    SELECT id, userA, userB, createdAt
    FROM direct_conversations
    WHERE userA=$1 OR userB=$2
    ORDER BY createdAt DESC
  `).all(uid, uid);
  return Promise.all(rows.map(async (r)=>{
    const otherUserId = Number(r.userA) === uid ? r.userB : r.userA;
    const otherUser = await getUserById(otherUserId);
    const last = (await stmt(`
      SELECT id, senderUserId, text, createdAt
      FROM direct_messages
      WHERE conversationId=$1
      ORDER BY createdAt DESC
      LIMIT 1
    `).get(Number(r.id))) || null;
    return {
      id: r.id,
      otherUser: otherUser ? { id: otherUser.id, displayName: await getDisplayNameForUser(otherUser), avatarUrl: otherUser.avatarUrl || "" } : null,
      lastMessage: last
    };
  }));
}
async function isDirectConversationMember(conversationId, userId){
  const convo = await getDirectConversationById(conversationId);
  if(!convo) return false;
  const uid = Number(userId);
  return Number(convo.userA) === uid || Number(convo.userB) === uid;
}
async function getDirectMessages(conversationId){
  return stmt(`
    SELECT id, conversationId, senderUserId, text, createdAt
    FROM direct_messages
    WHERE conversationId=$1
    ORDER BY createdAt ASC
  `).all(Number(conversationId));
}
async function addDirectMessage(conversationId, senderUserId, text){
  const info = await stmt("INSERT INTO direct_messages (conversationId, senderUserId, text, createdAt) VALUES ($1,$2,$3,$4) RETURNING id")
    .run(Number(conversationId), Number(senderUserId), String(text || ""), nowISO());
  return stmt("SELECT * FROM direct_messages WHERE id=$1").get(info.rows?.[0]?.id);
}

async function addConversation(payload){
  const info = await stmt("INSERT INTO conversations (placeId, participant, createdAt) VALUES ($1,$2,$3) RETURNING id")
    .run(Number(payload.placeId), String(payload.participant || "buyer"), nowISO());
  return stmt("SELECT * FROM conversations WHERE id=$1").get(info.rows?.[0]?.id);
}
async function getConversationById(id){
  return (await stmt("SELECT id, placeId, participant, createdAt FROM conversations WHERE id=$1")
    .get(Number(id))) || null;
}
async function addMessage(payload){
  const readBy = JSON.stringify([String(payload.sender || "buyer")]);
  const info = await stmt("INSERT INTO messages (conversationId, sender, text, createdAt, readBy) VALUES ($1,$2,$3,$4,$5) RETURNING id")
    .run(Number(payload.conversationId), String(payload.sender || "buyer"), String(payload.text || ""), nowISO(), readBy);
  return stmt("SELECT * FROM messages WHERE id=$1").get(info.rows?.[0]?.id);
}
async function getConversationMessages(conversationId){
  return stmt(`
    SELECT id, conversationId, sender, text, createdAt, readBy
    FROM messages
    WHERE conversationId=$1
    ORDER BY createdAt ASC
  `).all(Number(conversationId));
}
async function getConversationsForPlace(placeId, viewer){
  const convos = await stmt(`
    SELECT id, placeId, participant, createdAt
    FROM conversations
    WHERE placeId=$1
    ORDER BY createdAt DESC
  `).all(Number(placeId));
  if(!viewer) return convos.map(c=>({ ...c, unreadCount: 0 }));
  const v = String(viewer);
  return Promise.all(convos.map(async (c)=>{
    const msgs = await stmt("SELECT readBy FROM messages WHERE conversationId=$1").all(Number(c.id));
    let unreadCount = 0;
    for(const m of msgs){
      const readBy = parseJsonArray(m.readBy || "[]").map(String);
      if(!readBy.includes(v)) unreadCount += 1;
    }
    return { ...c, unreadCount };
  }));
}
async function markConversationRead(conversationId, viewer){
  const v = String(viewer || "");
  if(!v) return { ok:false };
  const rows = await stmt("SELECT id, readBy FROM messages WHERE conversationId=$1").all(Number(conversationId));
  for(const row of rows){
    const readBy = parseJsonArray(row.readBy || "[]").map(String);
    if(!readBy.includes(v)){
      readBy.push(v);
      await stmt("UPDATE messages SET readBy=$1 WHERE id=$2")
        .run(JSON.stringify(readBy), Number(row.id));
    }
  }
  return { ok:true };
}

async function addSignup(payload){
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

  await stmt("INSERT INTO signups (name,email,address1,address2,city,state,zip,status,reason,createdAt) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)")
    .run(name,email,address1,address2,city,state,zip,status,reason,nowISO());
  return {status,reason};
}

// ---------- Events + sweep ----------
async function logEvent(evt){
  const metaJson = JSON.stringify(evt.meta || {});
  const createdAt = nowISO();
  const info = await stmt(`
    INSERT INTO events (createdAt, eventType, townId, districtId, placeId, listingId, conversationId, userId, clientSessionId, metaJson)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING id
  `).run(createdAt, evt.eventType, evt.townId ?? 1, evt.districtId ?? null, evt.placeId ?? null, evt.listingId ?? null, evt.conversationId ?? null, evt.userId ?? null, evt.clientSessionId, metaJson);
  return info.rows?.[0]?.id;
}
async function getEventCountsSince(sinceIso, townId = 1){
  const rows = await stmt(`
    SELECT eventType, COUNT(*) AS c
    FROM events
    WHERE townId=$1 AND createdAt>=$2
    GROUP BY eventType
    ORDER BY c DESC
  `).all(Number(townId), sinceIso);
  // PostgreSQL returns lowercase column names, normalize for frontend
  return rows.map(r => ({ eventType: r.eventtype || r.eventType, c: r.c }));
}
async function getSessionCountSince(sinceIso, townId = 1){
  const row = await stmt(`
    SELECT COUNT(DISTINCT clientSessionId) AS c
    FROM events
    WHERE townId=$1 AND createdAt>=$2
  `).get(Number(townId), sinceIso);
  return row?.c || 0;
}
async function getSweepBalance(userId){
  const row= await stmt("SELECT COALESCE(SUM(amount),0) AS bal FROM sweep_ledger WHERE userId=$1").get(Number(userId));
  return row?.bal || 0;
}
async function addSweepLedgerEntry(payload){
  const info = await stmt(`
    INSERT INTO sweep_ledger (createdAt, userId, amount, reason, eventId, metaJson)
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING id
  `).run(
    nowISO(),
    Number(payload.userId),
    Number(payload.amount),
    String(payload.reason || ""),
    payload.eventId == null ? null : Number(payload.eventId),
    JSON.stringify(payload.meta || {})
  );
  return info.rows?.[0]?.id;
}
async function listSweepRules(townId=1){
  const rows = await stmt("SELECT * FROM sweep_rules WHERE town_id=$1 ORDER BY id").all(Number(townId));
  return rows.map((r)=>({
    id: r.id,
    townId: r.town_id ?? r.townid ?? r.townId ?? Number(townId),
    ruleType: r.rule_type ?? r.ruleType ?? "",
    enabled: r.enabled === true || Number(r.enabled) === 1,
    amount: Number(r.amount || 0),
    buyerAmount: Number(r.buyer_amount || 0),
    sellerAmount: Number(r.seller_amount || 0),
    dailyCap: Number(r.daily_cap || 0),
    cooldownSeconds: Number(r.cooldown_seconds || 0),
    meta: parseJsonObject(r.meta_json),
    createdAt: r.created_at || r.createdAt || "",
    updatedAt: r.updated_at || r.updatedAt || ""
  }));
}
async function createSweepRule(townId=1, payload){
  const ruleType = (payload.ruleType || payload.rule_type || payload.matchEventType || "").toString().trim();
  if(!ruleType) return { error: "ruleType required" };
  const enabled = payload.enabled == null ? true : !!payload.enabled;
  const amount = Number(payload.amount || 0);
  const buyerAmount = Number(payload.buyerAmount || payload.buyer_amount || 0);
  const sellerAmount = Number(payload.sellerAmount || payload.seller_amount || 0);
  const dailyCap = Number(payload.dailyCap || payload.daily_cap || 0);
  const cooldownSeconds = Number(payload.cooldownSeconds || payload.cooldown_seconds || 0);
  const meta = payload.meta || payload.meta_json || {};
  const info = await stmt(`
    INSERT INTO sweep_rules
      (town_id, rule_type, enabled, amount, buyer_amount, seller_amount, daily_cap, cooldown_seconds, meta_json)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    RETURNING id
  `).run(
    Number(townId),
    ruleType,
    enabled ? 1 : 0,
    amount,
    buyerAmount,
    sellerAmount,
    dailyCap,
    cooldownSeconds,
    JSON.stringify(meta || {})
  );
  const row = await stmt("SELECT * FROM sweep_rules WHERE id=$1").get(info.rows?.[0]?.id);
  return row || null;
}
async function updateSweepRule(townId=1, ruleId, patch){
  const existing = await stmt("SELECT * FROM sweep_rules WHERE town_id=$1 AND id=$2").get(Number(townId), Number(ruleId));
  if(!existing) return null;
  const ruleType = (patch.ruleType || patch.rule_type || patch.matchEventType || existing.rule_type || "").toString().trim();
  const enabled = patch.enabled == null ? existing.enabled : (patch.enabled ? 1 : 0);
  const amount = Number.isFinite(Number(patch.amount)) ? Number(patch.amount) : Number(existing.amount || 0);
  const buyerAmount = Number.isFinite(Number(patch.buyerAmount ?? patch.buyer_amount))
    ? Number(patch.buyerAmount ?? patch.buyer_amount)
    : Number(existing.buyer_amount || 0);
  const sellerAmount = Number.isFinite(Number(patch.sellerAmount ?? patch.seller_amount))
    ? Number(patch.sellerAmount ?? patch.seller_amount)
    : Number(existing.seller_amount || 0);
  const dailyCap = Number.isFinite(Number(patch.dailyCap ?? patch.daily_cap))
    ? Number(patch.dailyCap ?? patch.daily_cap)
    : Number(existing.daily_cap || 0);
  const cooldownSeconds = Number.isFinite(Number(patch.cooldownSeconds ?? patch.cooldown_seconds))
    ? Number(patch.cooldownSeconds ?? patch.cooldown_seconds)
    : Number(existing.cooldown_seconds || 0);
  const meta = patch.meta == null && patch.meta_json == null ? parseJsonObject(existing.meta_json) : (patch.meta || patch.meta_json || {});
  await stmt(`
    UPDATE sweep_rules
    SET rule_type=$1, enabled=$2, amount=$3, buyer_amount=$4, seller_amount=$5, daily_cap=$6, cooldown_seconds=$7, meta_json=$8, updated_at=now()
    WHERE town_id=$9 AND id=$10
  `).run(
    ruleType,
    enabled,
    amount,
    buyerAmount,
    sellerAmount,
    dailyCap,
    cooldownSeconds,
    JSON.stringify(meta || {}),
    Number(townId),
    Number(ruleId)
  );
  return stmt("SELECT * FROM sweep_rules WHERE id=$1").get(Number(ruleId));
}
async function deleteSweepRule(townId=1, ruleId){
  const result = await stmt("DELETE FROM sweep_rules WHERE town_id=$1 AND id=$2").run(Number(townId), Number(ruleId));
  return Number(result?.rowCount || 0) > 0;
}
async function tryAwardSweepForEvent({ townId=1, userId, ruleType, eventKey, meta }){
  if(!userId || !ruleType || !eventKey) return { awarded:false, reason:"invalid" };
  const rules = await stmt("SELECT * FROM sweep_rules WHERE town_id=$1 AND rule_type=$2 AND enabled=true ORDER BY id")
    .all(Number(townId), String(ruleType));
  if(!rules.length) return { awarded:false, reason:"no_rules" };
  let awardedTotal = 0;
  let lastReason = "no_rules";
  for(const rule of rules){
    const cooldownSeconds = Number(rule.cooldown_seconds || 0);
    const dailyCap = Number(rule.daily_cap || 0);
    const ruleMeta = parseJsonObject(rule.meta_json);
    const entriesPerDollar = Number(ruleMeta.entriesPerDollar ?? ruleMeta.perDollar ?? 0);
    let amount = Number(rule.amount || 0);
    if(String(ruleType) === "purchase"){
      if(meta?.role === "buyer") amount = Number(rule.buyer_amount || 0) || amount;
      if(meta?.role === "seller") amount = Number(rule.seller_amount || 0) || amount;
    }
    if(entriesPerDollar > 0){
      const totalCents = Number(meta?.totalCents || 0);
      const dollars = Math.floor(totalCents / 100);
      amount = dollars * entriesPerDollar;
    }
    if(amount <= 0){
      lastReason = "zero_amount";
      continue;
    }
    if(cooldownSeconds > 0){
      const last = await stmt(`
        SELECT created_at
        FROM sweep_award_events
        WHERE rule_id=$1 AND user_id=$2
        ORDER BY created_at DESC
        LIMIT 1
      `).get(Number(rule.id), Number(userId));
      if(last?.created_at){
        const lastTs = Date.parse(last.created_at);
        if(!Number.isNaN(lastTs) && (Date.now() - lastTs) < (cooldownSeconds * 1000)){
          lastReason = "cooldown";
          continue;
        }
      }
    }
    if(dailyCap > 0){
      const row = await stmt(`
        SELECT COUNT(*) AS c
        FROM sweep_award_events
        WHERE rule_id=$1 AND user_id=$2
          AND created_at >= date_trunc('day', now())
          AND created_at < date_trunc('day', now()) + interval '1 day'
      `).get(Number(rule.id), Number(userId));
      if(Number(row?.c || 0) >= dailyCap){
        lastReason = "daily_cap";
        continue;
      }
    }
    const inserted = await stmt(`
      INSERT INTO sweep_award_events (town_id, user_id, rule_id, event_key)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (rule_id, event_key) DO NOTHING
      RETURNING id
    `).run(Number(townId), Number(userId), Number(rule.id), String(eventKey));
    if(!inserted?.rowCount){
      lastReason = "duplicate";
      continue;
    }
    await addSweepLedgerEntry({
      userId,
      amount,
      reason: "sweep_award",
      meta: {
        ruleId: rule.id,
        ruleType,
        eventKey,
        ...meta
      }
    });
    awardedTotal += amount;
  }
  if(awardedTotal > 0) return { awarded:true, amount: awardedTotal };
  return { awarded:false, reason:lastReason };
}

async function createSweepstake(payload){
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
  const info = await stmt(`
    INSERT INTO sweepstakes (status, title, prize, entryCost, startAt, endAt, drawAt, maxEntriesPerUserPerDay, createdAt)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    RETURNING id
  `).run(status, title, prize, entryCost, startAt, endAt, drawAt, maxEntriesPerUserPerDay, createdAt);
  return getSweepstakeById(info.rows?.[0]?.id);
}
async function getSweepstakeById(id){
  return (await stmt("SELECT * FROM sweepstakes WHERE id=$1").get(Number(id))) || null;
}
async function getActiveSweepstake(){
  const now = nowISO();
  return (await stmt(`
    SELECT * FROM sweepstakes
    WHERE status='active' AND startAt <= $1 AND endAt >= $2
    ORDER BY startAt DESC
    LIMIT 1
  `).get(now, now)) || null;
}
async function addSweepstakeEntry(sweepstakeId, userId, entries){
  const dayKey = nowISO().slice(0,10);
  const info = await stmt(`
    INSERT INTO sweepstake_entries (sweepstakeId, userId, entries, dayKey, createdAt)
    VALUES ($1,$2,$3,$4,$5)
    RETURNING id
  `).run(Number(sweepstakeId), Number(userId), Number(entries), dayKey, nowISO());
  return stmt("SELECT * FROM sweepstake_entries WHERE id=$1").get(info.rows?.[0]?.id);
}
async function getSweepstakeEntryTotals(sweepstakeId){
  const row = await stmt(`
    SELECT COALESCE(SUM(entries),0) AS totalEntries, COUNT(DISTINCT userId) AS totalUsers
    FROM sweepstake_entries
    WHERE sweepstakeId=$1
  `).get(Number(sweepstakeId));
  return { totalEntries: row?.totalEntries || 0, totalUsers: row?.totalUsers || 0 };
}
async function getUserEntriesForSweepstake(sweepstakeId, userId){
  const row = await stmt(`
    SELECT COALESCE(SUM(entries),0) AS totalEntries
    FROM sweepstake_entries
    WHERE sweepstakeId=$1 AND userId=$2
  `).get(Number(sweepstakeId), Number(userId));
  return row?.totalEntries || 0;
}
async function listSweepstakeParticipants(sweepstakeId){
  return stmt(`
    SELECT userId, COALESCE(SUM(entries),0) AS entries
    FROM sweepstake_entries
    WHERE sweepstakeId=$1
    GROUP BY userId
    ORDER BY entries DESC, userId ASC
  `).all(Number(sweepstakeId));
}
async function getSweepDrawBySweepId(sweepId){
  return (await stmt(`
    SELECT * FROM sweep_draws
    WHERE sweepId=$1
    ORDER BY id DESC
    LIMIT 1
  `).get(Number(sweepId))) || null;
}
async function getSweepDrawById(drawId){
  return (await stmt("SELECT * FROM sweep_draws WHERE id=$1").get(Number(drawId))) || null;
}
async function getLatestSweepDraw(){
  return (await stmt(`
    SELECT * FROM sweep_draws
    ORDER BY id DESC
    LIMIT 1
  `).get()) || null;
}
async function createSweepDraw(payload){
  const createdAt = nowISO();
  const info = await stmt(`
    INSERT INTO sweep_draws
      (sweepId, createdAt, createdByUserId, winnerUserId, totalEntries, snapshotJson)
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING id
  `).run(
    Number(payload.sweepId),
    createdAt,
    payload.createdByUserId == null ? null : Number(payload.createdByUserId),
    Number(payload.winnerUserId),
    Number(payload.totalEntries || 0),
    JSON.stringify(payload.snapshot || {})
  );
  return (await stmt("SELECT * FROM sweep_draws WHERE id=$1").get(info.rows?.[0]?.id)) || null;
}
async function setSweepDrawNotified(drawId){
  const id = Number(drawId);
  if(!id) return false;
  await stmt("UPDATE sweep_draws SET notified=1 WHERE id=$1").run(id);
  return true;
}
async function setSweepClaimed(drawId, payload){
  const draw = await getSweepDrawById(drawId);
  if(!draw) return null;
  if((draw.claimedAt || "").toString().trim()) return draw;
  const claimedAt = payload?.claimedAt || nowISO();
  const claimedByUserId = payload?.claimedByUserId == null ? null : Number(payload.claimedByUserId);
  const claimedMessage = (payload?.claimedMessage || "").toString();
  const claimedPhotoUrl = (payload?.claimedPhotoUrl || "").toString();
  await stmt(`
    UPDATE sweep_draws
    SET claimedAt=$1, claimedByUserId=$2, claimedMessage=$3, claimedPhotoUrl=$4
    WHERE id=$5
  `).run(claimedAt, claimedByUserId, claimedMessage, claimedPhotoUrl, Number(drawId));
  return getSweepDrawById(drawId);
}
async function setSweepClaimPostedMessageId(drawId, messageId){
  const id = Number(drawId);
  const msgId = Number(messageId);
  if(!id || !msgId) return false;
  await stmt("UPDATE sweep_draws SET claimedPostedMessageId=$1 WHERE id=$2").run(msgId, id);
  return true;
}
async function setSweepstakeWinner(sweepstakeId, winnerUserId){
  await stmt("UPDATE sweepstakes SET winnerUserId=$1, winnerEntryId=NULL, status='ended' WHERE id=$2")
    .run(Number(winnerUserId), Number(sweepstakeId));
  return getSweepstakeById(sweepstakeId);
}
async function drawSweepstakeWinner(sweepstakeId){
  const sweep = await getSweepstakeById(sweepstakeId);
  if(!sweep) return null;
  if(sweep.winnerUserId) return sweep;
  const entries = await stmt(`
    SELECT id, userId, entries FROM sweepstake_entries
    WHERE sweepstakeId=$1
    ORDER BY id ASC
  `).all(Number(sweepstakeId));
  const total = entries.reduce((a,e)=>a + Number(e.entries || 0), 0);
  if(total <= 0){
    await stmt("UPDATE sweepstakes SET status='ended' WHERE id=$1").run(Number(sweepstakeId));
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
  await stmt("UPDATE sweepstakes SET winnerUserId=$1, winnerEntryId=$2, status='ended' WHERE id=$3")
    .run(Number(winner.userId), Number(winner.id), Number(sweepstakeId));
  return getSweepstakeById(sweepstakeId);
}

async function addCalendarEvent(payload, userId){
  const createdAt = nowISO();
  const title = (payload.title || "").toString().trim();
  const description = (payload.description || "").toString().trim();
  const startsAt = toISOOrEmpty(payload.startsAt);
  const endsAt = toISOOrEmpty(payload.endsAt);
  const locationName = (payload.locationName || "").toString().trim();
  const isPublic = payload.isPublic === false ? 0 : 1;
  const placeId = payload.placeId != null ? Number(payload.placeId) : null;
  const info = await stmt(`
    INSERT INTO events
      (createdAt, eventType, townId, districtId, placeId, listingId, conversationId, userId, clientSessionId, metaJson,
       title, description, startsAt, endsAt, locationName, isPublic, organizerUserId)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
    RETURNING id
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
  return stmt("SELECT * FROM events WHERE id=$1").get(info.rows?.[0]?.id);
}

async function addEventSubmission(payload){
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
  const info = await stmt(`
    INSERT INTO events_v1
      (townId, status, title, description, startAt, endAt, locationName, address, placeId,
       organizerName, organizerEmail, organizerPhone, website, category, imageUrl, notesToAdmin,
       createdAt, reviewedAt, reviewedByUserId, decisionReason)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
    RETURNING id
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
  return stmt("SELECT * FROM events_v1 WHERE id=$1").get(info.rows?.[0]?.id);
}

async function listApprovedEvents(range){
  const now = new Date();
  const start = range?.from ? toISOOrEmpty(range.from) : now.toISOString();
  const end = range?.to ? toISOOrEmpty(range.to) : new Date(now.getTime()+30*24*60*60*1000).toISOString();
  return stmt(`
    SELECT *
    FROM events_v1
    WHERE townId=1 AND status='approved' AND startAt >= $1 AND startAt <= $2
    ORDER BY startAt ASC
  `).all(start, end);
}

async function getEventById(id){
  return (await stmt("SELECT * FROM events_v1 WHERE id=$1").get(Number(id))) || null;
}

async function addScheduledLiveShow(payload){
  const createdAt = nowISO();
  const info = await stmt(`
    INSERT INTO live_show_schedule
    (townId, status, title, description, startAt, endAt, hostUserId, hostType, hostPlaceId, hostEventId, thumbnailUrl, createdAt, updatedAt)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    RETURNING id
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
  return stmt("SELECT * FROM live_show_schedule WHERE id=$1").get(info.rows?.[0]?.id);
}

async function listScheduledLiveShows(range){
  const now = new Date();
  const start = range?.from ? toISOOrEmpty(range.from) : now.toISOString();
  const end = range?.to ? toISOOrEmpty(range.to) : new Date(now.getTime()+7*24*60*60*1000).toISOString();
  return stmt(`
    SELECT *
    FROM live_show_schedule
    WHERE townId=1 AND status IN ('scheduled','live') AND startAt >= $1 AND startAt <= $2
    ORDER BY startAt ASC
  `).all(start, end);
}

async function toggleLiveShowBookmark(userId, showId){
  const existing = await stmt("SELECT id FROM live_show_bookmarks WHERE userId=$1 AND showId=$2")
    .get(Number(userId), Number(showId));
  if(existing){
    await stmt("DELETE FROM live_show_bookmarks WHERE id=$1").run(existing.id);
    return { bookmarked: false };
  }
  await stmt("INSERT INTO live_show_bookmarks (townId,userId,showId,createdAt) VALUES ($1,$2,$3,$4)")
    .run(1, Number(userId), Number(showId), nowISO());
  return { bookmarked: true };
}

async function getLiveShowBookmarksForUser(userId){
  return stmt("SELECT showId FROM live_show_bookmarks WHERE userId=$1").all(Number(userId));
}

async function listEventsByStatus(status){
  const s = (status || "pending").toString().trim().toLowerCase();
  return stmt("SELECT * FROM events_v1 WHERE status=$1 ORDER BY createdAt DESC").all(s);
}

async function updateEventDecision(id, status, reviewerUserId, decisionReason){
  const reviewedAt = nowISO();
  await stmt(`
    UPDATE events_v1
    SET status=$1, reviewedAt=$2, reviewedByUserId=$3, decisionReason=$4
    WHERE id=$5
  `).run(String(status), reviewedAt, reviewerUserId == null ? null : Number(reviewerUserId), String(decisionReason || ""), Number(id));
  return (await stmt("SELECT * FROM events_v1 WHERE id=$1").get(Number(id))) || null;
}

async function addMediaObject(payload){
  const info = await stmt(`
    INSERT INTO media_objects
      (townId, ownerUserId, placeId, listingId, eventId, kind, storageDriver, key, url, mime, bytes, createdAt, deletedAt)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    RETURNING id
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
  return stmt("SELECT * FROM media_objects WHERE id=$1").get(info.rows?.[0]?.id);
}

async function listMediaObjects({ townId = 1, kind = "", limit = 200 } = {}){
  if(kind){
    return stmt(`
      SELECT *
      FROM media_objects
      WHERE townId=$1 AND kind=$2
      ORDER BY createdAt DESC
      LIMIT $3
    `).all(Number(townId), String(kind), Number(limit));
  }
  return stmt(`
    SELECT *
    FROM media_objects
    WHERE townId=$1
    ORDER BY createdAt DESC
    LIMIT $2
  `).all(Number(townId), Number(limit));
}

async function collectUsedMedia(townId = 1){
  const used = new Set();
  const add = (v)=>{
    if(!v) return;
    used.add(v);
    if(typeof v === "string" && v.startsWith("/")) used.add(v.slice(1));
  };
  const places = await stmt("SELECT bannerUrl, avatarUrl FROM places WHERE townId=$1").all(Number(townId));
  places.forEach(p=>{ add(p.bannerUrl); add(p.avatarUrl); });
  const users = await stmt("SELECT avatarUrl FROM users").all();
  users.forEach(u=>add(u.avatarUrl));
  const events = await stmt("SELECT imageUrl FROM events_v1 WHERE townId=$1").all(Number(townId));
  events.forEach(e=>add(e.imageUrl));
  const listings = await stmt("SELECT photoUrlsJson FROM listings WHERE townId=$1").all(Number(townId));
  listings.forEach(l=>parseJsonArray(l.photoUrlsJson || l.photourlsjson || "[]").forEach(add));
  const archives = await stmt("SELECT bodyMarkdown FROM archive_entries WHERE townId=$1").all(Number(townId));
  const urlRe = /https?:\/\/[^\s)]+|\/uploads\/[^\s)]+/g;
  archives.forEach(a=>{
    const matches = (a.bodyMarkdown || "").match(urlRe) || [];
    matches.forEach(add);
  });
  return used;
}

async function listMediaOrphans(townId = 1, limit = 200){
  const media = await listMediaObjects({ townId, limit });
  const used = await collectUsedMedia(townId);
  return media.filter(m=>{
    if(used.has(m.url)) return false;
    if(used.has(m.key)) return false;
    if(used.has(`/${m.key}`)) return false;
    return true;
  });
}

async function listMissingLocalMedia(townId = 1, limit = 200){
  const media = (await listMediaObjects({ townId, limit })).filter(m=>m.storageDriver === "local");
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

async function listArchiveEntries(){
  return stmt(`
    SELECT *
    FROM archive_entries
    WHERE townId=1 AND status='published'
    ORDER BY pinned DESC, createdAt DESC
  `).all();
}

async function getArchiveEntryBySlug(slug){
  return (await stmt(`
    SELECT *
    FROM archive_entries
    WHERE townId=1 AND status='published' AND slug=$1
  `).get(String(slug))) || null;
}

function dayKeyFromDate(date){
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function isValidDate(d){
  return d instanceof Date && !Number.isNaN(d.getTime());
}
async function dayRangeForKey(dayKey){
  const key = (dayKey || "").toString().trim();
  let start = key ? new Date(`${key}T00:00:00`) : null;
  if(!isValidDate(start)){
    const now = new Date();
    const todayKey = dayKeyFromDate(now);
    start = new Date(`${todayKey}T00:00:00`);
    if(!isValidDate(start)){
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
  }
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}
async function normalizePulseRow(row){
  if(!row) return null;
  return {
    ...row,
    metrics: parseJsonObject(row.metricsJson),
    highlights: parseJsonObject(row.highlightsJson)
  };
}
async function getLatestPulse(townId = 1){
  const row = await stmt(`
    SELECT *
    FROM daily_pulses
    WHERE townId=$1 AND status='published'
    ORDER BY dayKey DESC, createdAt DESC
    LIMIT 1
  `).get(Number(townId));
  return normalizePulseRow(row);
}
async function getPulseByDayKey(dayKey, townId = 1){
  const row = await stmt(`
    SELECT *
    FROM daily_pulses
    WHERE townId=$1 AND status='published' AND dayKey=$2
  `).get(Number(townId), String(dayKey));
  return normalizePulseRow(row);
}
async function listDailyPulses(townId=1, limit=60){
  return stmt(`
   SELECT daykey AS "dayKey", createdat AS "createdAt"
FROM daily_pulses
WHERE townId=$1
ORDER BY daykey DESC
LIMIT $2


  `).all(Number(townId), Number(limit));
}
async function cleanupDailyPulses(townId=1){
  const r = await stmt("DELETE FROM daily_pulses WHERE townId=$1 AND dayKey NOT LIKE '____-__-__'").run(Number(townId));
  return Number(r.rowCount || 0);
}
async function upsertDailyPulse(payload){
  const createdAt = payload.createdAt || nowISO();
  await stmt(`
    INSERT INTO daily_pulses
      (townId, dayKey, status, metricsJson, highlightsJson, markdownBody, createdAt)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
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
async function generateDailyPulse(townId = 1, dayKey){
  const key = (dayKey && String(dayKey).trim()) || dayKeyFromDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const { startIso, endIso } = dayRangeForKey(key);
  const listingsByType = await stmt(`
    SELECT listingType, COUNT(*) AS c
    FROM listings
    WHERE townId=$1 AND createdAt>=$2 AND createdAt<$3
    GROUP BY listingType
  `).all(Number(townId), startIso, endIso);
  const listingTypeCounts = {};
  let listingTotal = 0;
  listingsByType.forEach(r=>{
    listingTypeCounts[r.listingType || "item"] = r.c;
    listingTotal += r.c;
  });
  const listingsByCategory = await stmt(`
    SELECT p.category AS category, COUNT(*) AS c
    FROM listings l
    JOIN places p ON p.id=l.placeId
    WHERE l.townId=$1 AND l.createdAt>=$2 AND l.createdAt<$3
    GROUP BY p.category
    ORDER BY c DESC
  `).all(Number(townId), startIso, endIso);
  const auctionsStartedCount = await stmt(`
    SELECT COUNT(*) AS c
    FROM listings
    WHERE townId=$1 AND listingType='auction' AND auctionStartAt>=$2 AND auctionStartAt<$3
  `).get(Number(townId), startIso, endIso).c || 0;
  const auctionsEndedCount = await stmt(`
    SELECT COUNT(*) AS c
    FROM listings
    WHERE townId=$1 AND listingType='auction' AND auctionEndAt>=$2 AND auctionEndAt<$3
  `).get(Number(townId), startIso, endIso).c || 0;
  const highestBidCents = await stmt(`
    SELECT MAX(amountCents) AS m
    FROM bids
    WHERE townId=$1 AND createdAt>=$2 AND createdAt<$3
  `).get(Number(townId), startIso, endIso).m || 0;

  const channelPostsCount = await stmt(`
    SELECT COUNT(*) AS c
    FROM channel_messages
    WHERE createdAt>=$1 AND createdAt<$2
  `).get(startIso, endIso).c || 0;
  const channelImagePostsCount = await stmt(`
    SELECT COUNT(*) AS c
    FROM channel_messages
    WHERE createdAt>=$1 AND createdAt<$2 AND imageUrl!=''
  `).get(startIso, endIso).c || 0;
  const storeMessagesCount = await stmt(`
    SELECT COUNT(*) AS c
    FROM messages
    WHERE createdAt>=$1 AND createdAt<$2
  `).get(startIso, endIso).c || 0;
  const messagesSentCount = channelPostsCount + storeMessagesCount;

  const newFollowsCount = await stmt(`
    SELECT COUNT(*) AS c
    FROM store_follows
    WHERE townId=$1 AND createdAt>=$2 AND createdAt<$3
  `).get(Number(townId), startIso, endIso).c || 0;
  const trustApplicationsSubmittedCount = await stmt(`
    SELECT COUNT(*) AS c
    FROM trust_applications
    WHERE townId=$1 AND createdAt>=$2 AND createdAt<$3
  `).get(Number(townId), startIso, endIso).c || 0;
  const trustApprovalsCount = await stmt(`
    SELECT COUNT(*) AS c
    FROM trust_applications
    WHERE townId=$1 AND status='approved' AND reviewedAt>=$2 AND reviewedAt<$3
  `).get(Number(townId), startIso, endIso).c || 0;
  const eventsSubmittedCount = await stmt(`
    SELECT COUNT(*) AS c
    FROM events_v1
    WHERE townId=$1 AND createdAt>=$2 AND createdAt<$3
  `).get(Number(townId), startIso, endIso).c || 0;
  const eventsApprovedCount = await stmt(`
    SELECT COUNT(*) AS c
    FROM events_v1
    WHERE townId=$1 AND status='approved' AND reviewedAt>=$2 AND reviewedAt<$3
  `).get(Number(townId), startIso, endIso).c || 0;
  const liveShowsScheduledCount = await stmt(`
    SELECT COUNT(*) AS c
    FROM live_show_schedule
    WHERE townId=$1 AND createdAt>=$2 AND createdAt<$3
  `).get(Number(townId), startIso, endIso).c || 0;
  const liveShowBookmarksCount = await stmt(`
    SELECT COUNT(*) AS c
    FROM live_show_bookmarks
    WHERE townId=$1 AND createdAt>=$2 AND createdAt<$3
  `).get(Number(townId), startIso, endIso).c || 0;

  const topChannels = await stmt(`
    SELECT c.name AS name, COUNT(*) AS c
    FROM channel_messages m
    JOIN channels c ON c.id=m.channelId
    WHERE m.createdAt>=$1 AND m.createdAt<$2
    GROUP BY m.channelId, c.name
    ORDER BY c DESC
    LIMIT 3
  `).all(startIso, endIso);
  const topStores = await stmt(`
    SELECT p.name AS name, COUNT(*) AS c
    FROM store_follows f
    JOIN places p ON p.id=f.placeId
    WHERE f.createdAt>=$1 AND f.createdAt<$2
    GROUP BY f.placeId, p.name
    ORDER BY c DESC
    LIMIT 3
  `).all(startIso, endIso);
  const topListings = await stmt(`
    SELECT l.title AS title, p.name AS placeName
    FROM listings l
    LEFT JOIN places p ON p.id=l.placeId
    WHERE l.createdAt>=$1 AND l.createdAt<$2
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
  const pulse = await upsertDailyPulse({
    townId,
    dayKey: key,
    status: "published",
    metrics,
    highlights,
    markdownBody
  });

  const slug = `daily-pulse-${key}`;
  const existing = await stmt("SELECT id FROM archive_entries WHERE slug=$1").get(slug);
  if(existing){
    await stmt(`
      UPDATE archive_entries
      SET title=$1, bodyMarkdown=$2, createdAt=$3
      WHERE slug=$4
    `).run(`Daily Pulse — Sebastian — ${key}`, markdownBody, nowISO(), slug);
  }else{
    await stmt(`
      INSERT INTO archive_entries
        (townId, status, title, slug, bodyMarkdown, createdAt, createdByUserId, pinned, tagsJson)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
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

// ---------- Daily Pulse Summary for Facebook Export ----------
async function getDailyPulseSummary(townId = 1) {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const nowIso = now.toISOString();

  // New listings in last 24 hours
  const newListingsRow = await stmt(`
    SELECT COUNT(*) AS c FROM listings
    WHERE townId=$1 AND createdAt >= $2
  `).get(Number(townId), oneDayAgo);
  const newListingsCount = Number(newListingsRow?.c || 0);

  // New orders in last 24 hours
  const newOrdersRow = await stmt(`
    SELECT COUNT(*) AS c FROM orders
    WHERE createdAt >= $1 AND status IN ('paid', 'completed')
  `).get(oneDayAgo);
  const newOrdersCount = Number(newOrdersRow?.c || 0);

  // Giveaway winners in last 7 days
  const giveawayWinnersRow = await stmt(`
    SELECT COUNT(*) AS c FROM sweep_draws
    WHERE createdAt >= $1 AND winnerUserId IS NOT NULL
  `).get(sevenDaysAgo);
  const giveawayWinnersCount = Number(giveawayWinnersRow?.c || 0);

  // Upcoming events in next 7 days
  const upcomingEventsRow = await stmt(`
    SELECT COUNT(*) AS c FROM events_v1
    WHERE townId=$1 AND status='approved' AND startAt >= $2 AND startAt <= $3
  `).get(Number(townId), nowIso, sevenDaysFromNow);
  const upcomingEventsCount = Number(upcomingEventsRow?.c || 0);

  // New reviews in last 24 hours
  const newReviewsRow = await stmt(`
    SELECT COUNT(*) AS c FROM reviews
    WHERE createdAt >= $1
  `).get(oneDayAgo);
  const newReviewsCount = Number(newReviewsRow?.c || 0);

  // Top 3 listings (most recent with good data)
  const topListings = await stmt(`
    SELECT l.id, l.title, l.price, p.name AS placeName
    FROM listings l
    LEFT JOIN places p ON p.id = l.placeId
    WHERE l.townId=$1 AND l.status='active'
    ORDER BY l.createdAt DESC
    LIMIT 3
  `).all(Number(townId));

  // Most recent giveaway winner (if they agreed to share / claimed)
  const recentWinnerRow = await stmt(`
    SELECT sd.id, sd.winnerUserId, sd.claimedAt, sd.snapshotJson,
           u.displayName, u.email
    FROM sweep_draws sd
    LEFT JOIN users u ON u.id = sd.winnerUserId
    WHERE sd.winnerUserId IS NOT NULL AND sd.claimedAt IS NOT NULL
    ORDER BY sd.createdAt DESC
    LIMIT 1
  `).get();

  let recentWinner = null;
  if (recentWinnerRow) {
    let snapshot = {};
    try {
      snapshot = typeof recentWinnerRow.snapshotJson === 'string'
        ? JSON.parse(recentWinnerRow.snapshotJson || '{}')
        : (recentWinnerRow.snapshotJson || {});
    } catch { snapshot = {}; }
    const winnerName = recentWinnerRow.displayName ||
      (recentWinnerRow.email ? recentWinnerRow.email.split('@')[0] : 'A lucky winner');
    const prizeName = snapshot.prize?.title || snapshot.prizeTitle || 'an amazing prize';
    recentWinner = {
      name: winnerName,
      prize: prizeName,
      claimedAt: recentWinnerRow.claimedAt
    };
  }

  // New users in last 24 hours
  const newUsersRow = await stmt(`
    SELECT COUNT(*) AS c FROM users
    WHERE createdAt >= $1
  `).get(oneDayAgo);
  const newUsersCount = Number(newUsersRow?.c || 0);

  // Active stores count
  const activeStoresRow = await stmt(`
    SELECT COUNT(*) AS c FROM places
    WHERE townId=$1 AND status='approved'
  `).get(Number(townId));
  const activeStoresCount = Number(activeStoresRow?.c || 0);

  return {
    generatedAt: nowIso,
    townId,
    newListingsCount,
    newOrdersCount,
    giveawayWinnersCount,
    upcomingEventsCount,
    newReviewsCount,
    newUsersCount,
    activeStoresCount,
    topListings,
    recentWinner
  };
}

async function formatPulseForFacebook(townId = 1) {
  const pulse = await getDailyPulseSummary(townId);
  const baseUrl = (process.env.PUBLIC_BASE_URL || process.env.SITE_URL || '').replace(/\/$/, '') || 'https://sebastian.local';

  const lines = [];
  lines.push("🌴 Today in Sebastian:");
  lines.push("");

  if (pulse.newListingsCount > 0) {
    lines.push(`• ${pulse.newListingsCount} new marketplace listing${pulse.newListingsCount !== 1 ? 's' : ''}`);
  }

  if (pulse.upcomingEventsCount > 0) {
    lines.push(`• ${pulse.upcomingEventsCount} local event${pulse.upcomingEventsCount !== 1 ? 's' : ''} this week`);
  }

  if (pulse.newOrdersCount > 0) {
    lines.push(`• ${pulse.newOrdersCount} purchase${pulse.newOrdersCount !== 1 ? 's' : ''} supporting local businesses`);
  }

  if (pulse.newReviewsCount > 0) {
    lines.push(`• ${pulse.newReviewsCount} new review${pulse.newReviewsCount !== 1 ? 's' : ''}`);
  }

  if (pulse.recentWinner) {
    lines.push("");
    lines.push(`🏆 Congrats to ${pulse.recentWinner.name} for winning ${pulse.recentWinner.prize}!`);
  }

  if (pulse.topListings && pulse.topListings.length > 0) {
    lines.push("");
    lines.push("📦 New on the marketplace:");
    pulse.topListings.slice(0, 3).forEach(listing => {
      const price = listing.price ? ` - $${Number(listing.price).toFixed(2)}` : '';
      const store = listing.placeName ? ` from ${listing.placeName}` : '';
      lines.push(`  → ${listing.title}${price}${store}`);
    });
  }

  lines.push("");
  lines.push(`See what's happening → ${baseUrl}`);
  lines.push("");
  lines.push("#SebastianFL #SupportLocal #ShopLocal #DigitalSebastian");

  return {
    text: lines.join("\n"),
    pulse,
    baseUrl
  };
}

async function logPulseExport(townId, exportType, userId, pulseData, postText) {
  const info = await stmt(`
    INSERT INTO pulse_exports (townId, exportType, exportedAt, exportedByUserId, pulseData, postText)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id
  `).run(
    Number(townId),
    String(exportType),
    nowISO(),
    userId == null ? null : Number(userId),
    JSON.stringify(pulseData || {}),
    String(postText || '')
  );
  return stmt("SELECT * FROM pulse_exports WHERE id=$1").get(info.rows?.[0]?.id);
}

async function getLastPulseExport(townId = 1, exportType = 'facebook') {
  return (await stmt(`
    SELECT * FROM pulse_exports
    WHERE townId=$1 AND exportType=$2
    ORDER BY exportedAt DESC
    LIMIT 1
  `).get(Number(townId), String(exportType))) || null;
}

async function listPulseExports(townId = 1, limit = 30) {
  return stmt(`
    SELECT pe.*, u.displayName AS exportedByName, u.email AS exportedByEmail
    FROM pulse_exports pe
    LEFT JOIN users u ON u.id = pe.exportedByUserId
    WHERE pe.townId=$1
    ORDER BY pe.exportedAt DESC
    LIMIT $2
  `).all(Number(townId), Number(limit));
}

async function addWaitlistSignup(payload){
  const createdAt = nowISO();
  const email = normalizeEmail(payload?.email);
  if(!email) return { error: "email required" };
  const name = (payload?.name || "").toString().trim();
  const phone = (payload?.phone || "").toString().trim();
  const notes = (payload?.notes || "").toString().trim();
  const termsAcceptedAt = (payload?.termsAcceptedAt || "").toString().trim() || null;
  let interests = "";
  if(Array.isArray(payload?.interests)){
    interests = payload.interests.map(i=>String(i || "").trim()).filter(Boolean).join(",");
  }else{
    interests = (payload?.interests || "").toString().trim();
  }
  const info = await stmt(`
    INSERT INTO waitlist_signups
      (createdAt, name, email, phone, interests, notes, status, termsAcceptedAt)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING id
  `).run(createdAt, name, email, phone, interests, notes, "pending", termsAcceptedAt);
  return stmt("SELECT * FROM waitlist_signups WHERE id=$1").get(info.rows?.[0]?.id);
}

async function listWaitlistSignupsByStatus(status){
  const s = (status || "pending").toString().trim().toLowerCase();
  return stmt("SELECT * FROM waitlist_signups WHERE status=$1 ORDER BY createdAt DESC")
    .all(s);
}

async function updateWaitlistStatus(id, status, approvedTier = null){
  if(approvedTier != null){
    await stmt("UPDATE waitlist_signups SET status=$1, approvedTier=$2 WHERE id=$3")
      .run(String(status), Number(approvedTier), Number(id));
  } else {
    await stmt("UPDATE waitlist_signups SET status=$1 WHERE id=$2")
      .run(String(status), Number(id));
  }
  return (await stmt("SELECT * FROM waitlist_signups WHERE id=$1").get(Number(id))) || null;
}

async function addBusinessApplication(payload){
  const createdAt = nowISO();
  const contactName = (payload?.contactName || "").toString().trim();
  const email = normalizeEmail(payload?.email);
  const businessName = (payload?.businessName || "").toString().trim();
  const type = (payload?.type || "").toString().trim();
  const category = (payload?.category || "").toString().trim();
  const inSebastian = (payload?.inSebastian || "").toString().trim();
  const termsAcceptedAt = (payload?.termsAcceptedAt || "").toString().trim() || null;
  if(!contactName || !email || !businessName || !type || !category || !inSebastian){
    return { error: "contactName, email, businessName, type, category, inSebastian required" };
  }
  const info = await stmt(`
    INSERT INTO business_applications
      (createdAt, contactName, email, phone, businessName, type, category, website, inSebastian, address, notes, status, termsAcceptedAt)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    RETURNING id
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
    "pending",
    termsAcceptedAt
  );
  return stmt("SELECT * FROM business_applications WHERE id=$1").get(info.rows?.[0]?.id);
}

async function listBusinessApplicationsByStatus(status){
  const s = (status || "pending").toString().trim().toLowerCase();
  return stmt("SELECT * FROM business_applications WHERE status=$1 ORDER BY createdAt DESC")
    .all(s);
}

async function updateBusinessApplicationStatus(id, status, approvedTier = null){
  if(approvedTier != null){
    await stmt("UPDATE business_applications SET status=$1, approvedTier=$2 WHERE id=$3")
      .run(String(status), Number(approvedTier), Number(id));
  } else {
    await stmt("UPDATE business_applications SET status=$1 WHERE id=$2")
      .run(String(status), Number(id));
  }
  return (await stmt("SELECT * FROM business_applications WHERE id=$1").get(Number(id))) || null;
}

async function addResidentApplication(payload){
  const createdAt = nowISO();
  const name = (payload?.name || "").toString().trim();
  const email = normalizeEmail(payload?.email);
  const addressLine1 = (payload?.addressLine1 || "").toString().trim();
  const city = (payload?.city || "").toString().trim();
  const state = (payload?.state || "").toString().trim();
  const zip = (payload?.zip || "").toString().trim();
  const termsAcceptedAt = (payload?.termsAcceptedAt || "").toString().trim() || null;
  if(!name || !email || !addressLine1 || !city || !state || !zip){
    return { error: "name, email, addressLine1, city, state, zip required" };
  }
  const info = await stmt(`
    INSERT INTO resident_applications
      (createdAt, name, email, phone, addressLine1, city, state, zip, yearsInSebastian, notes, status, termsAcceptedAt)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    RETURNING id
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
    "pending",
    termsAcceptedAt
  );
  return stmt("SELECT * FROM resident_applications WHERE id=$1").get(info.rows?.[0]?.id);
}

async function listResidentApplicationsByStatus(status){
  const s = (status || "pending").toString().trim().toLowerCase();
  return stmt("SELECT * FROM resident_applications WHERE status=$1 ORDER BY createdAt DESC")
    .all(s);
}

async function getResidentApplicationById(id){
  return (await stmt("SELECT * FROM resident_applications WHERE id=$1").get(Number(id))) || null;
}

async function updateResidentApplicationStatus(id, status, approvedTier = null){
  if(approvedTier != null){
    await stmt("UPDATE resident_applications SET status=$1, approvedTier=$2 WHERE id=$3")
      .run(String(status), Number(approvedTier), Number(id));
  } else {
    await stmt("UPDATE resident_applications SET status=$1 WHERE id=$2")
      .run(String(status), Number(id));
  }
  return (await stmt("SELECT * FROM resident_applications WHERE id=$1").get(Number(id))) || null;
}

async function getApprovedApplicationTier(email){
  const e = normalizeEmail(email);
  if(!e) return null;

  // Check all application types for approved applications with a tier
  const waitlist = await stmt("SELECT approvedTier FROM waitlist_signups WHERE email=$1 AND status='approved' AND approvedTier IS NOT NULL ORDER BY id DESC LIMIT 1").get(e);
  const business = await stmt("SELECT approvedTier FROM business_applications WHERE email=$1 AND status='approved' AND approvedTier IS NOT NULL ORDER BY id DESC LIMIT 1").get(e);
  const resident = await stmt("SELECT approvedTier FROM resident_applications WHERE email=$1 AND status='approved' AND approvedTier IS NOT NULL ORDER BY id DESC LIMIT 1").get(e);

  // Return the highest approved tier
  const tiers = [
    waitlist?.approvedtier ?? waitlist?.approvedTier,
    business?.approvedtier ?? business?.approvedTier,
    resident?.approvedtier ?? resident?.approvedTier
  ].filter(t => t != null).map(Number);

  if(tiers.length === 0) return null;
  return Math.max(...tiers);
}

async function addLocalBizApplication(payload, userId){
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
  const info = await stmt(`
    INSERT INTO local_business_applications
      (townId, status, businessName, ownerName, email, phone, address, city, state, zip, category,
       website, instagram, description, sustainabilityNotes, confirmSebastian, createdAt, reviewedAt,
       reviewedByUserId, decisionReason, userId)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
    RETURNING id
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
  return stmt("SELECT * FROM local_business_applications WHERE id=$1").get(info.rows?.[0]?.id);
}

async function listLocalBizApplicationsByUser(userId){
  return stmt("SELECT * FROM local_business_applications WHERE userId=$1 ORDER BY createdAt DESC")
    .all(Number(userId));
}

async function listLocalBizApplicationsByStatus(status){
  const s = (status || "pending").toString().trim().toLowerCase();
  return stmt("SELECT * FROM local_business_applications WHERE townId=1 AND status=$1 ORDER BY createdAt DESC")
    .all(s);
}

async function getLocalBizApplicationById(id){
  return (await stmt("SELECT * FROM local_business_applications WHERE id=$1").get(Number(id))) || null;
}

async function updateLocalBizDecision(id, status, reviewerUserId, decisionReason){
  const reviewedAt = nowISO();
  await stmt(`
    UPDATE local_business_applications
    SET status=$1, reviewedAt=$2, reviewedByUserId=$3, decisionReason=$4
    WHERE id=$5
  `).run(String(status), reviewedAt, reviewerUserId == null ? null : Number(reviewerUserId), String(decisionReason || ""), Number(id));
  return (await stmt("SELECT * FROM local_business_applications WHERE id=$1").get(Number(id))) || null;
}
async function getCalendarEvents(range){
  const now = new Date();
  const start = now.toISOString();
  const end = new Date(now.getTime() + (range==="month" ? 30 : 7) * 24 * 60 * 60 * 1000).toISOString();
  return stmt(`
    SELECT id, title, description, startsAt, endsAt, locationName, isPublic, placeId, organizerUserId, createdAt
    FROM events
    WHERE eventType='calendar_event' AND startsAt >= $1 AND startsAt <= $2
    ORDER BY startsAt ASC
  `).all(start, end);
}

async function getCalendarEventById(id){
  return (await stmt(`
    SELECT id, title, description, startsAt, endsAt, locationName, isPublic, placeId, organizerUserId, createdAt
    FROM events
    WHERE id=$1 AND eventType='calendar_event'
  `).get(Number(id))) || null;
}

async function addEventRsvp(eventId, userId, status="going"){
  await stmt(`
    INSERT INTO event_rsvps (eventId, userId, status, createdAt)
    VALUES ($1,$2,$3,$4)
    ON CONFLICT (eventId, userId)
    DO UPDATE SET status=EXCLUDED.status, createdAt=EXCLUDED.createdAt
  `).run(Number(eventId), Number(userId), status, nowISO());
  return { ok:true };
}

async function addOrder(payload){
  const createdAt = nowISO();
  const info = await stmt(`
    INSERT INTO orders
      (listingId, buyerUserId, sellerUserId, quantity, amountCents, status, createdAt, completedAt, paymentProvider, paymentIntentId)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING id
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
  return stmt("SELECT * FROM orders WHERE id=$1").get(info.rows?.[0]?.id);
}
async function getOrderById(id){
  return (await stmt("SELECT * FROM orders WHERE id=$1").get(Number(id))) || null;
}
async function completeOrder(id){
  const completedAt = nowISO();
  await stmt("UPDATE orders SET status='completed', completedAt=$1 WHERE id=$2").run(completedAt, Number(id));
  return stmt("SELECT * FROM orders WHERE id=$1").get(Number(id));
}

async function getReviewForOrder(orderId, reviewerUserId){
  return (await stmt("SELECT * FROM reviews WHERE orderId=$1 AND reviewerUserId=$2")
    .get(Number(orderId), Number(reviewerUserId))) || null;
}
async function addReview(payload){
  const info= await stmt(`
    INSERT INTO reviews (orderId, reviewerUserId, revieweeUserId, role, rating, text, createdAt)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    RETURNING id
  `).run(
    Number(payload.orderId),
    Number(payload.reviewerUserId),
    Number(payload.revieweeUserId),
    String(payload.role),
    Number(payload.rating),
    String(payload.text || ""),
    nowISO()
  );
  return stmt("SELECT * FROM reviews WHERE id=$1").get(info.rows?.[0]?.id);
}
async function addDispute(payload){
  const info= await stmt(`
    INSERT INTO disputes (orderId, reporterUserId, reason, status, createdAt)
    VALUES ($1,$2,$3,$4,$5)
    RETURNING id
  `).run(
    Number(payload.orderId),
    Number(payload.reporterUserId),
    String(payload.reason || ""),
    String(payload.status || "open"),
    nowISO()
  );
  return stmt("SELECT * FROM disputes WHERE id=$1").get(info.rows?.[0]?.id);
}
async function listReviews(limit=200){
  return stmt("SELECT * FROM reviews ORDER BY createdAt DESC LIMIT $1").all(Number(limit));
}
async function listDisputes(limit=200){
  return stmt("SELECT * FROM disputes ORDER BY createdAt DESC LIMIT $1").all(Number(limit));
}
async function addTrustEvent(payload){
  await stmt("INSERT INTO trust_events (orderId, userId, eventType, metaJson, createdAt) VALUES ($1,$2,$3,$4,$5)")
    .run(Number(payload.orderId), Number(payload.userId), String(payload.eventType), JSON.stringify(payload.meta||{}), nowISO());
}

async function getStoreFollowCount(placeId){
  const row = await stmt("SELECT COUNT(*) AS c FROM store_follows WHERE placeId=$1").get(Number(placeId));
  return row?.c || 0;
}
async function isFollowingStore(userId, placeId){
  return !!(await stmt("SELECT 1 FROM store_follows WHERE userId=$1 AND placeId=$2")
    .get(Number(userId), Number(placeId)));
}
async function followStore(userId, placeId){
  await stmt(`
    INSERT INTO store_follows (createdAt, userId, placeId)
    VALUES ($1,$2,$3)
    ON CONFLICT (userId, placeId) DO NOTHING
  `).run(nowISO(), Number(userId), Number(placeId));
  return { ok:true };
}
async function unfollowStore(userId, placeId){
  await stmt("DELETE FROM store_follows WHERE userId=$1 AND placeId=$2")
    .run(Number(userId), Number(placeId));
  return { ok:true };
}

// ---------- Channel requests ----------
async function addChannelRequest(userId, payload){
  const name = (payload?.name || "").toString().trim();
  const description = (payload?.description || "").toString().trim();
  const reason = (payload?.reason || "").toString().trim();
  if(!name || !description) return { error: "name and description required" };
  const info = await stmt(`
    INSERT INTO channel_requests (townId, userId, name, description, reason, status, createdAt)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id
  `).run(1, Number(userId), name, description, reason, "pending", nowISO());
  return stmt("SELECT * FROM channel_requests WHERE id=$1").get(info.rows?.[0]?.id);
}

async function listChannelRequestsByStatus(status){
  const s = (status || "pending").toString().trim().toLowerCase();
  return stmt("SELECT * FROM channel_requests WHERE townId=1 AND status=$1 ORDER BY createdAt DESC").all(s);
}

async function listChannelRequestsByUser(userId){
  return stmt("SELECT * FROM channel_requests WHERE userId=$1 ORDER BY createdAt DESC").all(Number(userId));
}

async function updateChannelRequestStatus(id, status, reviewerUserId){
  await stmt(`
    UPDATE channel_requests SET status=$1, reviewedByUserId=$2, reviewedAt=$3 WHERE id=$4
  `).run(String(status), reviewerUserId ? Number(reviewerUserId) : null, nowISO(), Number(id));
  return stmt("SELECT * FROM channel_requests WHERE id=$1").get(Number(id));
}

async function setChannelMemberRole(channelId, userId, role){
  const validRoles = ["member", "moderator", "admin"];
  if(!validRoles.includes(role)) return { error: "Invalid role" };
  // Check if membership exists
  const existing = await stmt("SELECT * FROM channel_memberships WHERE channelId=$1 AND userId=$2").get(Number(channelId), Number(userId));
  if(existing){
    await stmt("UPDATE channel_memberships SET role=$1 WHERE id=$2").run(role, existing.id);
  } else {
    await stmt(`
      INSERT INTO channel_memberships (channelId, userId, role, createdAt)
      VALUES ($1, $2, $3, $4)
    `).run(Number(channelId), Number(userId), role, nowISO());
  }
  return stmt("SELECT * FROM channel_memberships WHERE channelId=$1 AND userId=$2").get(Number(channelId), Number(userId));
}

async function getChannelMembership(channelId, userId){
  return stmt("SELECT * FROM channel_memberships WHERE channelId=$1 AND userId=$2").get(Number(channelId), Number(userId));
}

async function listChannelModerators(channelId){
  return stmt("SELECT * FROM channel_memberships WHERE channelId=$1 AND (role='moderator' OR role='admin') ORDER BY createdAt").all(Number(channelId));
}

// ---------- Listing creation (new) ----------
async function addListing(payload){
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

  const info = await stmt(`
    INSERT INTO listings
      (placeId, title, description, quantity, price, status, createdAt, photoUrlsJson, listingType, exchangeType, startAt, endAt, offerCategory, availabilityWindow, compensationType, auctionStartAt, auctionEndAt, startBidCents, minIncrementCents, reserveCents, buyNowCents)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
    RETURNING id
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

  const row = await stmt("SELECT * FROM listings WHERE id=$1").get(info.rows?.[0]?.id);
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

// ---------- Business Subscriptions ----------
async function createBusinessSubscription(placeId, userId, plan = 'free_trial') {
  const now = nowISO();
  const trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const info = await stmt(`
    INSERT INTO business_subscriptions
      (placeId, userId, plan, status, trialEndsAt, currentPeriodStart, currentPeriodEnd, createdAt, updatedAt)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING id
  `).run(
    Number(placeId),
    Number(userId),
    String(plan),
    'active',
    trialEndsAt,
    now,
    trialEndsAt,
    now,
    now
  );
  return stmt("SELECT * FROM business_subscriptions WHERE id=$1").get(info.rows?.[0]?.id);
}

function normalizeSubscriptionRow(row) {
  if (!row) return row;
  // Normalize lowercase PostgreSQL columns to camelCase
  if (row.placeid != null && row.placeId == null) row.placeId = row.placeid;
  if (row.userid != null && row.userId == null) row.userId = row.userid;
  if (row.trialendsat != null && row.trialEndsAt == null) row.trialEndsAt = row.trialendsat;
  if (row.currentperiodstart != null && row.currentPeriodStart == null) row.currentPeriodStart = row.currentperiodstart;
  if (row.currentperiodend != null && row.currentPeriodEnd == null) row.currentPeriodEnd = row.currentperiodend;
  if (row.canceledat != null && row.canceledAt == null) row.canceledAt = row.canceledat;
  if (row.stripecustomerid != null && row.stripeCustomerId == null) row.stripeCustomerId = row.stripecustomerid;
  if (row.stripesubscriptionid != null && row.stripeSubscriptionId == null) row.stripeSubscriptionId = row.stripesubscriptionid;
  if (row.createdat != null && row.createdAt == null) row.createdAt = row.createdat;
  if (row.updatedat != null && row.updatedAt == null) row.updatedAt = row.updatedat;
  return row;
}

async function getBusinessSubscription(placeId) {
  const row = await stmt("SELECT * FROM business_subscriptions WHERE placeId=$1 ORDER BY id DESC LIMIT 1")
    .get(Number(placeId));
  return normalizeSubscriptionRow(row) || null;
}

async function updateSubscriptionStatus(subscriptionId, status) {
  const now = nowISO();
  await stmt("UPDATE business_subscriptions SET status=$1, updatedAt=$2 WHERE id=$3")
    .run(String(status), now, Number(subscriptionId));
  return stmt("SELECT * FROM business_subscriptions WHERE id=$1").get(Number(subscriptionId));
}

async function isSubscriptionActive(placeId) {
  const sub = await getBusinessSubscription(placeId);
  if (!sub) return false;
  if (sub.status !== 'active') return false;
  const now = new Date();
  if (sub.trialEndsAt && new Date(sub.trialEndsAt) > now) return true;
  if (sub.currentPeriodEnd && new Date(sub.currentPeriodEnd) > now) return true;
  return false;
}

async function getAllSubscriptions() {
  return stmt("SELECT * FROM business_subscriptions ORDER BY id DESC").all();
}

// ---------- Giveaway Offers ----------
async function createGiveawayOffer(placeId, userId, payload) {
  const now = nowISO();
  const title = (payload?.title || "").toString().trim();
  const description = (payload?.description || "").toString().trim();
  const estimatedValue = Number(payload?.estimatedValue || 0);
  const imageUrl = (payload?.imageUrl || "").toString().trim();
  const rewardType = (payload?.rewardType || "free_month").toString().trim();
  if (!title || !description) return { error: "title and description required" };
  const info = await stmt(`
    INSERT INTO giveaway_offers
      (placeId, userId, title, description, estimatedValue, imageUrl, status, rewardType, createdAt)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING id
  `).run(
    Number(placeId),
    Number(userId),
    title,
    description,
    estimatedValue,
    imageUrl,
    'pending',
    rewardType,
    now
  );
  return stmt("SELECT * FROM giveaway_offers WHERE id=$1").get(info.rows?.[0]?.id);
}

async function getGiveawayOffersByStatus(status) {
  const s = (status || "pending").toString().trim().toLowerCase();
  return stmt("SELECT * FROM giveaway_offers WHERE status=$1 ORDER BY createdAt DESC").all(s);
}

async function getGiveawayOffersByPlace(placeId) {
  return stmt("SELECT * FROM giveaway_offers WHERE placeId=$1 ORDER BY createdAt DESC").all(Number(placeId));
}

async function updateGiveawayOfferStatus(offerId, status, adminUserId, notes) {
  const reviewedAt = nowISO();
  await stmt(`
    UPDATE giveaway_offers
    SET status=$1, reviewedAt=$2, reviewedByUserId=$3, adminNotes=$4
    WHERE id=$5
  `).run(
    String(status),
    reviewedAt,
    adminUserId == null ? null : Number(adminUserId),
    String(notes || ""),
    Number(offerId)
  );
  return stmt("SELECT * FROM giveaway_offers WHERE id=$1").get(Number(offerId));
}

async function awardFreeMonth(placeId) {
  const sub = await getBusinessSubscription(placeId);
  if (!sub) return { error: "no subscription found" };
  const now = new Date();
  const currentEnd = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : now;
  const baseDate = currentEnd > now ? currentEnd : now;
  const newEnd = new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const updatedAt = nowISO();
  await stmt("UPDATE business_subscriptions SET currentPeriodEnd=$1, updatedAt=$2, status=$3 WHERE id=$4")
    .run(newEnd, updatedAt, 'active', Number(sub.id));
  return stmt("SELECT * FROM business_subscriptions WHERE id=$1").get(Number(sub.id));
}

// ---------- Social Shares ----------
async function logSocialShare(userId, shareType, itemType, itemId, platform = 'facebook') {
  const now = nowISO();
  const info = await stmt(`
    INSERT INTO social_shares (userId, shareType, itemType, itemId, platform, createdAt)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id
  `).run(
    userId == null ? null : Number(userId),
    String(shareType),
    String(itemType),
    Number(itemId),
    String(platform),
    now
  );
  return stmt("SELECT * FROM social_shares WHERE id=$1").get(info.rows?.[0]?.id);
}

async function getShareCountByItem(itemType, itemId) {
  const row = await stmt(`
    SELECT COUNT(*) AS count FROM social_shares
    WHERE itemType=$1 AND itemId=$2
  `).get(String(itemType), Number(itemId));
  return Number(row?.count || 0);
}

// ---------- Support Requests ----------
async function createSupportRequest(userId, payload) {
  const now = nowISO();
  const type = (payload?.type || "bug").toString().trim();
  const name = (payload?.name || "").toString().trim();
  const email = (payload?.email || "").toString().trim();
  const subject = (payload?.subject || "").toString().trim();
  const details = (payload?.details || "").toString().trim();
  const page = (payload?.page || "").toString().trim();
  const device = (payload?.device || "").toString().trim();
  const userAgent = (payload?.userAgent || "").toString().trim();
  if (!subject || !details) return { error: "subject and details required" };
  const info = await stmt(`
    INSERT INTO support_requests
      (userId, type, name, email, subject, details, page, device, userAgent, status, createdAt)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING id
  `).run(
    userId == null ? null : Number(userId),
    type,
    name,
    email,
    subject,
    details,
    page,
    device,
    userAgent,
    'pending',
    now
  );
  return stmt("SELECT * FROM support_requests WHERE id=$1").get(info.rows?.[0]?.id);
}

async function getSupportRequestsByUser(userId) {
  return stmt(`
    SELECT * FROM support_requests
    WHERE userId=$1
    ORDER BY createdAt DESC
  `).all(Number(userId));
}

async function getAllSupportRequests() {
  return stmt("SELECT * FROM support_requests ORDER BY createdAt DESC").all();
}

async function updateSupportRequestStatus(requestId, status, adminNotes = "") {
  const now = nowISO();
  await stmt(`
    UPDATE support_requests
    SET status=$1, adminNotes=$2, updatedAt=$3
    WHERE id=$4
  `).run(String(status), String(adminNotes), now, Number(requestId));
  return stmt("SELECT * FROM support_requests WHERE id=$1").get(Number(requestId));
}

// ---------- Featured Stores (Active Giveaways) ----------
async function updateGiveawayOfferDates(offerId, startsAt, endsAt) {
  await stmt(`
    UPDATE giveaway_offers
    SET startsAt=$1, endsAt=$2
    WHERE id=$3
  `).run(
    startsAt ? new Date(startsAt).toISOString() : null,
    endsAt ? new Date(endsAt).toISOString() : null,
    Number(offerId)
  );
  return stmt("SELECT * FROM giveaway_offers WHERE id=$1").get(Number(offerId));
}

async function getFeaturedStores() {
  // Get businesses with currently active giveaways (status=approved, startsAt <= now <= endsAt)
  const now = new Date().toISOString();
  const rows = await stmt(`
    SELECT g.*, p.id AS placeId, p.name AS placeName, p.category, p.avatarUrl, p.description AS placeDescription
    FROM giveaway_offers g
    JOIN places p ON p.id = g.placeId
    WHERE g.status = 'approved'
      AND g.startsAt IS NOT NULL
      AND g.endsAt IS NOT NULL
      AND g.startsAt <= $1
      AND g.endsAt >= $1
    ORDER BY g.startsAt ASC
  `).all(now);
  return rows;
}

// ---------- Ghost Reports (Buyer Non-Payment) ----------
async function createGhostReport(orderId, buyerUserId, sellerUserId, reason = '') {
  const now = nowISO();
  const info = await stmt(`
    INSERT INTO ghost_reports (orderId, buyerUserId, sellerUserId, reason, reportedAt, status)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (orderId) DO NOTHING
    RETURNING id
  `).run(
    Number(orderId),
    Number(buyerUserId),
    Number(sellerUserId),
    String(reason),
    now,
    'active'
  );
  if (!info.rows?.[0]?.id) return null; // Already reported
  return stmt("SELECT * FROM ghost_reports WHERE id=$1").get(info.rows[0].id);
}

async function getGhostReportByOrder(orderId) {
  return stmt("SELECT * FROM ghost_reports WHERE orderId=$1").get(Number(orderId));
}

async function getGhostReportsByBuyer(buyerUserId) {
  return stmt("SELECT * FROM ghost_reports WHERE buyerUserId=$1 ORDER BY reportedAt DESC").all(Number(buyerUserId));
}

async function getGhostingStats(userId) {
  // Get total orders as buyer
  const totalRow = await stmt(`
    SELECT COUNT(*) AS count FROM orders WHERE buyerUserId=$1
  `).get(Number(userId));
  const totalOrders = Number(totalRow?.count || 0);

  // Get ghost report count
  const ghostRow = await stmt(`
    SELECT COUNT(*) AS count FROM ghost_reports WHERE buyerUserId=$1 AND status='active'
  `).get(Number(userId));
  const ghostCount = Number(ghostRow?.count || 0);

  // Calculate percentage
  const ghostingPercent = totalOrders > 0 ? (ghostCount / totalOrders) * 100 : 0;

  return { totalOrders, ghostCount, ghostingPercent: Math.round(ghostingPercent * 10) / 10 };
}

async function recalculateGhostingPercent(userId) {
  const stats = await getGhostingStats(userId);
  await stmt(`
    UPDATE users
    SET ghostingPercent=$1, ghostReportCount=$2, totalOrdersAsBuyer=$3
    WHERE id=$4
  `).run(
    stats.ghostingPercent,
    stats.ghostCount,
    stats.totalOrders,
    Number(userId)
  );
  return stats;
}

// ---------- Referral System ----------
function generateReferralCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function ensureUserReferralCode(userId) {
  const user = await getUserById(userId);
  if (!user) return null;
  if (user.referralCode || user.referralcode) return user;

  // Generate unique code
  let attempts = 0;
  while (attempts < 10) {
    const code = generateReferralCode();
    try {
      await stmt(`UPDATE users SET referralCode = $1 WHERE id = $2 AND referralCode IS NULL`)
        .run(code, Number(userId));
      return getUserById(userId);
    } catch (e) {
      if (e.code === '23505') { // unique violation
        attempts++;
        continue;
      }
      throw e;
    }
  }
  return user;
}

async function getUserByReferralCode(code) {
  if (!code) return null;
  const result = await stmt(`SELECT * FROM users WHERE UPPER(referralCode) = UPPER($1)`).all(code.toString().trim());
  return result[0] || null;
}

async function getReferralStats(userId) {
  // Get count of users referred
  const totalReferred = await stmt(`
    SELECT COUNT(*) as count FROM users WHERE referredByUserId = $1
  `).all(Number(userId));

  // Get count of active referred users (those with active subscriptions)
  const activeReferred = await stmt(`
    SELECT COUNT(DISTINCT u.id) as count
    FROM users u
    JOIN user_subscriptions us ON us.userId = u.id
    WHERE u.referredByUserId = $1
      AND us.status = 'active'
      AND us.currentPeriodEnd > NOW()
  `).all(Number(userId));

  // Get user's referral balance and total earnings
  const user = await getUserById(userId);

  return {
    totalReferred: Number(totalReferred[0]?.count || 0),
    activeReferred: Number(activeReferred[0]?.count || 0),
    referralBalanceCents: Number(user?.referralBalanceCents || user?.referralbalancecents || 0),
    referralEarningsTotal: Number(user?.referralEarningsTotal || user?.referralearningsTotal || 0),
    referralCode: user?.referralCode || user?.referralcode || null
  };
}

async function getReferralTransactions(userId, limit = 50) {
  const result = await stmt(`
    SELECT rt.*, u.displayName as referredUserName, u.email as referredUserEmail
    FROM referral_transactions rt
    LEFT JOIN users u ON u.id = rt.referredUserId
    WHERE rt.userId = $1
    ORDER BY rt.createdAt DESC
    LIMIT $2
  `).all(Number(userId), Number(limit));
  return result;
}

async function addReferralCommission(referrerUserId, referredUserId, subscriptionAmountCents, commissionPercent = 25) {
  const commissionCents = Math.floor(subscriptionAmountCents * commissionPercent / 100);
  if (commissionCents <= 0) return null;

  // Add transaction record
  await stmt(`
    INSERT INTO referral_transactions (userId, type, amountCents, referredUserId, description, createdAt)
    VALUES ($1, 'commission', $2, $3, $4, NOW())
  `).run(
    Number(referrerUserId),
    commissionCents,
    Number(referredUserId),
    `${commissionPercent}% commission on referral subscription`
  );

  // Update referrer's balance and total
  await stmt(`
    UPDATE users
    SET referralBalanceCents = COALESCE(referralBalanceCents, 0) + $1,
        referralEarningsTotal = COALESCE(referralEarningsTotal, 0) + $1
    WHERE id = $2
  `).run(commissionCents, Number(referrerUserId));

  return { commissionCents, referrerUserId, referredUserId };
}

async function applyReferralCredit(userId, amountCents, subscriptionId = null) {
  // Deduct from balance
  await stmt(`
    UPDATE users
    SET referralBalanceCents = GREATEST(0, COALESCE(referralBalanceCents, 0) - $1)
    WHERE id = $2
  `).run(Number(amountCents), Number(userId));

  // Log the transaction
  await stmt(`
    INSERT INTO referral_transactions (userId, type, amountCents, subscriptionId, description, createdAt)
    VALUES ($1, 'credit_applied', $2, $3, 'Credit applied to subscription', NOW())
  `).run(Number(userId), -Number(amountCents), subscriptionId);

  return { appliedCents: amountCents };
}

async function requestReferralCashout(userId) {
  const user = await getUserById(userId);
  const balance = Number(user?.referralBalanceCents || user?.referralbalancecents || 0);

  if (balance < 2500) { // $25 minimum
    return { error: 'Minimum cashout is $25', balance };
  }

  // Log the cashout request (admin handles actual payout manually)
  await stmt(`
    INSERT INTO referral_transactions (userId, type, amountCents, description, createdAt)
    VALUES ($1, 'cashout', $2, 'Cashout requested - pending admin approval', NOW())
  `).run(Number(userId), -balance);

  // Zero out the balance
  await stmt(`UPDATE users SET referralBalanceCents = 0 WHERE id = $1`).run(Number(userId));

  return { success: true, cashoutAmountCents: balance };
}

async function getReferredUsers(referrerUserId, limit = 100) {
  const result = await stmt(`
    SELECT u.id, u.displayName, u.email, u.createdAt,
           us.status as subscriptionStatus, us.plan as subscriptionPlan
    FROM users u
    LEFT JOIN user_subscriptions us ON us.userId = u.id
    WHERE u.referredByUserId = $1
    ORDER BY u.createdAt DESC
    LIMIT $2
  `).all(Number(referrerUserId), Number(limit));
  return result;
}

module.exports = {
  initDb,
  getPlaces,
  getPlaceById,
  getPlaceOwnerPublic,
  updatePlaceSettings,
  listPlacesByStatus,
  listPlacesByOwner,
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
  getAllOrders,
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
  deleteChannelMessage,
  isUserMutedInChannel,
  upsertChannelMute,
  deleteChannelMute,
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
  setUserTermsAcceptedAt,
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
  createAuthCode,
  verifyAuthCode,
  cleanupExpiredAuthCodes,
  upsertUserByEmail,
  createSession,
  deleteSession,
  getUserBySession,
  getUserById,
  getUserByEmail,
  getAllUsers,
  setUserReferredByUserId,
  getUserProfilePublic,
  getUserProfilePrivate,
  updateUserProfile,
  addSignup,

  // events + sweep
  logEvent,
  getEventCountsSince,
  getSessionCountSince,
  getSweepBalance,
  addSweepLedgerEntry,
  listSweepRules,
  createSweepRule,
  updateSweepRule,
  deleteSweepRule,
  tryAwardSweepForEvent,
  createSweepstake,
  getSweepstakeById,
  getActiveSweepstake,
  addSweepstakeEntry,
  getSweepstakeEntryTotals,
  getUserEntriesForSweepstake,
  listSweepstakeParticipants,
  getSweepDrawBySweepId,
  getSweepDrawById,
  getLatestSweepDraw,
  createSweepDraw,
  setSweepDrawNotified,
  setSweepClaimed,
  setSweepClaimPostedMessageId,
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
  listDailyPulses,
  cleanupDailyPulses,
  generateDailyPulse,
  getDailyPulseSummary,
  formatPulseForFacebook,
  logPulseExport,
  getLastPulseExport,
  listPulseExports,
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
  getApprovedApplicationTier,
  addLocalBizApplication,
  getLocalBizApplicationById,
  listLocalBizApplicationsByUser,
  listLocalBizApplicationsByStatus,
  updateLocalBizDecision,
  addChannelRequest,
  listChannelRequestsByStatus,
  listChannelRequestsByUser,
  updateChannelRequestStatus,
  setChannelMemberRole,
  getChannelMembership,
  listChannelModerators,
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

  // business subscriptions
  createBusinessSubscription,
  getBusinessSubscription,
  updateSubscriptionStatus,
  isSubscriptionActive,
  getAllSubscriptions,
  createGiveawayOffer,
  getGiveawayOffersByStatus,
  getGiveawayOffersByPlace,
  updateGiveawayOfferStatus,
  awardFreeMonth,

  // social shares
  logSocialShare,
  getShareCountByItem,

  // support requests
  createSupportRequest,
  getSupportRequestsByUser,
  getAllSupportRequests,
  updateSupportRequestStatus,

  // featured stores
  updateGiveawayOfferDates,
  getFeaturedStores,

  // ghost reports
  createGhostReport,
  getGhostReportByOrder,
  getGhostReportsByBuyer,
  getGhostingStats,
  recalculateGhostingPercent,

  // referral system
  generateReferralCode,
  ensureUserReferralCode,
  getUserByReferralCode,
  getReferralStats,
  getReferralTransactions,
  addReferralCommission,
  applyReferralCredit,
  requestReferralCashout,
  getReferredUsers,

  // raw query
  query,
};
