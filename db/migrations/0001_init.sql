CREATE TABLE IF NOT EXISTS towns (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  state TEXT NOT NULL,
  region TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS districts (
  id SERIAL PRIMARY KEY,
  townId INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS places (
  id SERIAL PRIMARY KEY,
  townId INTEGER NOT NULL,
  districtId INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  yearsInTown TEXT NOT NULL DEFAULT '',
  bannerUrl TEXT NOT NULL DEFAULT '',
  avatarUrl TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  status TEXT NOT NULL,
  sellerType TEXT NOT NULL DEFAULT 'individual',
  visibilityLevel TEXT NOT NULL DEFAULT 'town_only',
  pickupZone TEXT NOT NULL DEFAULT '',
  addressPublic TEXT NOT NULL DEFAULT '',
  addressPrivate TEXT NOT NULL DEFAULT '',
  meetupInstructions TEXT NOT NULL DEFAULT '',
  hours TEXT NOT NULL DEFAULT '',
  verifiedStatus TEXT NOT NULL DEFAULT 'unverified',
  ownerUserId INTEGER
);

CREATE TABLE IF NOT EXISTS listings (
  id SERIAL PRIMARY KEY,
  townId INTEGER NOT NULL DEFAULT 1,
  placeId INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL,
  createdAt TIMESTAMPTZ NOT NULL,
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
  paymentStatus TEXT NOT NULL DEFAULT 'none',
  photoUrlsJson JSONB NOT NULL DEFAULT '[]'::jsonb,
  listingType TEXT NOT NULL DEFAULT 'item',
  exchangeType TEXT NOT NULL DEFAULT 'money',
  startAt TEXT NOT NULL DEFAULT '',
  endAt TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  townId INTEGER NOT NULL DEFAULT 1,
  listingId INTEGER NOT NULL,
  buyerUserId INTEGER NOT NULL,
  sellerUserId INTEGER,
  sellerPlaceId INTEGER,
  quantity INTEGER NOT NULL,
  amountCents INTEGER NOT NULL,
  status TEXT NOT NULL,
  createdAt TIMESTAMPTZ NOT NULL,
  updatedAt TEXT NOT NULL DEFAULT '',
  completedAt TIMESTAMPTZ,
  paymentProvider TEXT NOT NULL,
  paymentIntentId TEXT NOT NULL,
  subtotalCents INTEGER NOT NULL DEFAULT 0,
  serviceGratuityCents INTEGER NOT NULL DEFAULT 0,
  totalCents INTEGER NOT NULL DEFAULT 0,
  fulfillmentType TEXT NOT NULL DEFAULT '',
  fulfillmentNotes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  orderId INTEGER NOT NULL,
  listingId INTEGER NOT NULL,
  titleSnapshot TEXT NOT NULL,
  priceCentsSnapshot INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  sellerPlaceId INTEGER NOT NULL,
  createdAt TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS cart_items (
  id SERIAL PRIMARY KEY,
  townId INTEGER NOT NULL DEFAULT 1,
  userId INTEGER NOT NULL,
  listingId INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  createdAt TIMESTAMPTZ NOT NULL,
  UNIQUE(userId, listingId)
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  orderId INTEGER NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  amountCents INTEGER NOT NULL,
  createdAt TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id SERIAL PRIMARY KEY,
  townId INTEGER NOT NULL DEFAULT 1,
  orderId INTEGER NOT NULL,
  reviewerUserId INTEGER NOT NULL,
  revieweeUserId INTEGER NOT NULL,
  role TEXT NOT NULL,
  rating INTEGER NOT NULL,
  text TEXT NOT NULL,
  createdAt TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS disputes (
  id SERIAL PRIMARY KEY,
  townId INTEGER NOT NULL DEFAULT 1,
  orderId INTEGER NOT NULL,
  reporterUserId INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  createdAt TIMESTAMPTZ NOT NULL,
  resolvedAt TIMESTAMPTZ,
  resolutionNote TEXT
);

CREATE TABLE IF NOT EXISTS trust_events (
  id SERIAL PRIMARY KEY,
  orderId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  eventType TEXT NOT NULL,
  metaJson JSONB NOT NULL,
  createdAt TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS bids (
  id SERIAL PRIMARY KEY,
  townId INTEGER NOT NULL DEFAULT 1,
  listingId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  amountCents INTEGER NOT NULL,
  createdAt TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id SERIAL PRIMARY KEY,
  placeId INTEGER NOT NULL,
  participant TEXT NOT NULL,
  createdAt TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  conversationId INTEGER NOT NULL,
  sender TEXT NOT NULL,
  text TEXT NOT NULL,
  createdAt TIMESTAMPTZ NOT NULL,
  readBy TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS direct_conversations (
  id SERIAL PRIMARY KEY,
  townId INTEGER NOT NULL DEFAULT 1,
  userA INTEGER NOT NULL,
  userB INTEGER NOT NULL,
  createdAt TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS direct_messages (
  id SERIAL PRIMARY KEY,
  townId INTEGER NOT NULL DEFAULT 1,
  conversationId INTEGER NOT NULL,
  senderUserId INTEGER NOT NULL,
  text TEXT NOT NULL,
  createdAt TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS channels (
  id SERIAL PRIMARY KEY,
  townId INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  isPublic INTEGER NOT NULL DEFAULT 1,
  createdAt TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_memberships (
  id SERIAL PRIMARY KEY,
  channelId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  createdAt TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS message_threads (
  id SERIAL PRIMARY KEY,
  channelId INTEGER NOT NULL,
  createdBy INTEGER NOT NULL,
  createdAt TIMESTAMPTZ NOT NULL,
  title TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS channel_messages (
  id SERIAL PRIMARY KEY,
  channelId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  text TEXT NOT NULL,
  imageUrl TEXT NOT NULL DEFAULT '',
  createdAt TIMESTAMPTZ NOT NULL,
  replyToId INTEGER,
  threadId INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS live_rooms (
  id SERIAL PRIMARY KEY,
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
  createdAt TIMESTAMPTZ NOT NULL,
  startedAt TEXT NOT NULL DEFAULT '',
  endedAt TEXT NOT NULL DEFAULT '',
  cfRoomId TEXT NOT NULL DEFAULT '',
  cfRoomToken TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS live_show_schedule (
  id SERIAL PRIMARY KEY,
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
  createdAt TIMESTAMPTZ NOT NULL,
  updatedAt TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS live_show_bookmarks (
  id SERIAL PRIMARY KEY,
  townId INTEGER NOT NULL DEFAULT 1,
  userId INTEGER NOT NULL,
  showId INTEGER NOT NULL,
  createdAt TIMESTAMPTZ NOT NULL,
  UNIQUE(userId, showId)
);
CREATE TABLE IF NOT EXISTS signups (
  id SERIAL PRIMARY KEY,
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
  createdAt TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  createdAt TIMESTAMPTZ NOT NULL,
  trustTier INTEGER NOT NULL DEFAULT 0,
  trustTierUpdatedAt TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  addressJson JSONB NOT NULL DEFAULT '{}'::jsonb,
  presenceVerifiedAt TEXT NOT NULL DEFAULT '',
  presenceLat DOUBLE PRECISION,
  presenceLng DOUBLE PRECISION,
  presenceAccuracyMeters DOUBLE PRECISION,
  displayName TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  avatarUrl TEXT NOT NULL DEFAULT '',
  interestsJson JSONB NOT NULL DEFAULT '[]'::jsonb,
  ageRange TEXT NOT NULL DEFAULT '',
  showAvatar INTEGER NOT NULL DEFAULT 0,
  showBio INTEGER NOT NULL DEFAULT 1,
  showInterests INTEGER NOT NULL DEFAULT 1,
  showAgeRange INTEGER NOT NULL DEFAULT 0,
  isBuyerVerified INTEGER NOT NULL DEFAULT 0,
  isSellerVerified INTEGER NOT NULL DEFAULT 0,
  locationVerifiedSebastian INTEGER NOT NULL DEFAULT 0,
  residentVerified INTEGER NOT NULL DEFAULT 0,
  facebookVerified INTEGER NOT NULL DEFAULT 0,
  isAdmin INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS trust_applications (
  id SERIAL PRIMARY KEY,
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
  presenceLat DOUBLE PRECISION,
  presenceLng DOUBLE PRECISION,
  presenceAccuracyMeters DOUBLE PRECISION,
  createdAt TIMESTAMPTZ NOT NULL,
  reviewedAt TEXT NOT NULL DEFAULT '',
  reviewedByUserId INTEGER,
  decisionReason TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS resident_verification_requests (
  id SERIAL PRIMARY KEY,
  townId INTEGER NOT NULL DEFAULT 1,
  userId INTEGER NOT NULL,
  status TEXT NOT NULL,
  addressLine1 TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT NOT NULL,
  createdAt TIMESTAMPTZ NOT NULL,
  reviewedAt TEXT NOT NULL DEFAULT '',
  reviewedByUserId INTEGER,
  decisionReason TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS magic_links (
  token TEXT PRIMARY KEY,
  userId INTEGER NOT NULL,
  expiresAt TIMESTAMPTZ NOT NULL,
  createdAt TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  userId INTEGER NOT NULL,
  expiresAt TIMESTAMPTZ NOT NULL,
  createdAt TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  createdAt TIMESTAMPTZ NOT NULL,
  eventType TEXT NOT NULL,
  townId INTEGER NOT NULL,
  districtId INTEGER,
  placeId INTEGER,
  listingId INTEGER,
  conversationId INTEGER,
  userId INTEGER,
  clientSessionId TEXT NOT NULL,
  metaJson JSONB NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  startsAt TEXT NOT NULL DEFAULT '',
  endsAt TEXT NOT NULL DEFAULT '',
  locationName TEXT NOT NULL DEFAULT '',
  isPublic INTEGER NOT NULL DEFAULT 1,
  organizerUserId INTEGER
);

CREATE TABLE IF NOT EXISTS events_v1 (
  id SERIAL PRIMARY KEY,
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
  createdAt TIMESTAMPTZ NOT NULL,
  reviewedAt TEXT NOT NULL DEFAULT '',
  reviewedByUserId INTEGER,
  decisionReason TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS archive_entries (
  id SERIAL PRIMARY KEY,
  townId INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'published',
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  bodyMarkdown TEXT NOT NULL,
  createdAt TIMESTAMPTZ NOT NULL,
  createdByUserId INTEGER,
  pinned INTEGER NOT NULL DEFAULT 0,
  tagsJson JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS daily_pulses (
  id SERIAL PRIMARY KEY,
  townId INTEGER NOT NULL DEFAULT 1,
  dayKey TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'published',
  metricsJson JSONB NOT NULL DEFAULT '{}'::jsonb,
  highlightsJson JSONB NOT NULL DEFAULT '{}'::jsonb,
  markdownBody TEXT NOT NULL DEFAULT '',
  createdAt TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS local_business_applications (
  id SERIAL PRIMARY KEY,
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
  createdAt TIMESTAMPTZ NOT NULL,
  reviewedAt TEXT NOT NULL DEFAULT '',
  reviewedByUserId INTEGER,
  decisionReason TEXT NOT NULL DEFAULT '',
  userId INTEGER
);

CREATE TABLE IF NOT EXISTS waitlist_signups (
  id SERIAL PRIMARY KEY,
  createdAt TIMESTAMPTZ NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  interests TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS business_applications (
  id SERIAL PRIMARY KEY,
  createdAt TIMESTAMPTZ NOT NULL,
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
  id SERIAL PRIMARY KEY,
  createdAt TIMESTAMPTZ NOT NULL,
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
  id SERIAL PRIMARY KEY,
  townId INTEGER NOT NULL DEFAULT 1,
  eventId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  status TEXT NOT NULL,
  createdAt TIMESTAMPTZ NOT NULL,
  UNIQUE(eventId, userId)
);

CREATE TABLE IF NOT EXISTS sweep_ledger (
  id SERIAL PRIMARY KEY,
  townId INTEGER NOT NULL DEFAULT 1,
  createdAt TIMESTAMPTZ NOT NULL,
  userId INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  eventId INTEGER,
  metaJson JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS sweepstakes (
  id SERIAL PRIMARY KEY,
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
  createdAt TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS sweepstake_entries (
  id SERIAL PRIMARY KEY,
  townId INTEGER NOT NULL DEFAULT 1,
  sweepstakeId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  entries INTEGER NOT NULL DEFAULT 0,
  dayKey TEXT NOT NULL DEFAULT '',
  createdAt TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS sweep_draws (
  id SERIAL PRIMARY KEY,
  sweepId INTEGER NOT NULL,
  createdAt TIMESTAMPTZ NOT NULL,
  createdByUserId INTEGER,
  winnerUserId INTEGER NOT NULL,
  totalEntries INTEGER NOT NULL,
  snapshotJson JSONB NOT NULL,
  notified INTEGER NOT NULL DEFAULT 0,
  claimedAt TEXT NOT NULL DEFAULT '',
  claimedByUserId INTEGER,
  claimedMessage TEXT NOT NULL DEFAULT '',
  claimedPhotoUrl TEXT NOT NULL DEFAULT '',
  claimedPostedMessageId INTEGER
);

CREATE TABLE IF NOT EXISTS store_follows (
  id SERIAL PRIMARY KEY,
  townId INTEGER NOT NULL DEFAULT 1,
  createdAt TIMESTAMPTZ NOT NULL,
  userId INTEGER NOT NULL,
  placeId INTEGER NOT NULL,
  UNIQUE(userId, placeId)
);

CREATE TABLE IF NOT EXISTS media_objects (
  id SERIAL PRIMARY KEY,
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
  createdAt TIMESTAMPTZ NOT NULL,
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
  id SERIAL PRIMARY KEY,
  createdAt TIMESTAMPTZ NOT NULL,
  townId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  trustLevel TEXT NOT NULL,
  trustTier INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS prize_offers (
  id SERIAL PRIMARY KEY,
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
  createdAt TIMESTAMPTZ NOT NULL,
  reviewedAt TEXT NOT NULL DEFAULT '',
  reviewedByUserId INTEGER,
  decisionReason TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS prize_awards (
  id SERIAL PRIMARY KEY,
  townId INTEGER NOT NULL DEFAULT 1,
  prizeOfferId INTEGER NOT NULL,
  winnerUserId INTEGER NOT NULL,
  donorUserId INTEGER NOT NULL,
  donorPlaceId INTEGER,
  status TEXT NOT NULL,
  dueBy TEXT NOT NULL DEFAULT '',
  convoId INTEGER,
  proofUrl TEXT NOT NULL DEFAULT '',
  createdAt TIMESTAMPTZ NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_membership_unique ON town_memberships(townId, userId);
