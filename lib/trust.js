const TRUST_TIERS = {
  GUEST: 0,
  LOCATION_VERIFIED: 1,
  RESIDENT: 2,
  LOCAL_BUSINESS: 3,
  ADMIN: 4,
};

const TRUST_TIER_LABELS = {
  0: "Not logged in",
  1: "Location Verified",
  2: "Sebastian Resident",
  3: "Local Business",
  4: "Admin"
};

function resolveTier(user, ctx) {
  if (user?.isAdmin) return TRUST_TIERS.ADMIN;
  const userTier = Number(user?.trustTier || 0);
  if (Number.isFinite(userTier) && userTier > 0) return Math.min(userTier, TRUST_TIERS.LOCAL_BUSINESS);
  const memberTier = Number((ctx?.membership?.trustTier ?? ctx?.membership?.trusttier ?? 0));
  if (Number.isFinite(memberTier) && memberTier > 0) return Math.min(memberTier, TRUST_TIERS.LOCAL_BUSINESS);
  if (Number(user?.residentVerified || 0) === 1) return TRUST_TIERS.RESIDENT;
  // Reserved for future Facebook OAuth; currently not required.
  if (Number(user?.locationVerifiedSebastian || 0) === 1){
    return TRUST_TIERS.LOCATION_VERIFIED;
  }
  return TRUST_TIERS.GUEST;
}

function permissionsForTier(tier) {
  return {
    map: true,
    marketplace: tier >= TRUST_TIERS.LOCATION_VERIFIED,
    auctions: tier >= TRUST_TIERS.LOCATION_VERIFIED,
    channels: tier >= TRUST_TIERS.LOCATION_VERIFIED,
    events: tier >= TRUST_TIERS.LOCATION_VERIFIED,
    archive: tier >= TRUST_TIERS.LOCATION_VERIFIED,
    localbiz: tier >= TRUST_TIERS.RESIDENT,
    scheduled: tier >= TRUST_TIERS.RESIDENT,
    chatPost: tier >= TRUST_TIERS.LOCATION_VERIFIED,
    chatImages: tier >= TRUST_TIERS.LOCATION_VERIFIED,
    listingCreate: tier >= TRUST_TIERS.RESIDENT,
    auctionHost: tier >= TRUST_TIERS.LOCAL_BUSINESS,
    bid: tier >= TRUST_TIERS.LOCATION_VERIFIED,
    dm: tier >= TRUST_TIERS.RESIDENT,
    sweepEnter: tier >= TRUST_TIERS.LOCATION_VERIFIED,
    liveSchedule: tier >= TRUST_TIERS.LOCAL_BUSINESS,
    liveHost: tier >= TRUST_TIERS.LOCAL_BUSINESS
  };
}

function limitsForTier() {
  return {
    maxUploadBytes: 5 * 1024 * 1024,
    maxListingPhotos: 5
  };
}

function can(user, ctx, action) {
  const tier = resolveTier(user, ctx);
  const required = {
    chat_text: TRUST_TIERS.LOCATION_VERIFIED,
    chat_image: TRUST_TIERS.LOCATION_VERIFIED,
    listing_create: TRUST_TIERS.RESIDENT,
    auction_host: TRUST_TIERS.LOCAL_BUSINESS,
    auction_bid: TRUST_TIERS.LOCATION_VERIFIED,
    image_upload: TRUST_TIERS.LOCATION_VERIFIED,
    prize_submit: TRUST_TIERS.RESIDENT
  }[action];

  if (required == null) return { ok: true, tier, required: 0 };
  return { ok: tier >= required, tier, required };
}

function hasPerm(user, ctx, perm) {
  if (user?.isAdmin) return true;
  const tier = resolveTier(user, ctx);
  const required = {
    VIEW_MAP: TRUST_TIERS.GUEST,
    VIEW_MARKET: TRUST_TIERS.LOCATION_VERIFIED,
    BUY_MARKET: TRUST_TIERS.LOCATION_VERIFIED,
    VIEW_AUCTIONS: TRUST_TIERS.LOCATION_VERIFIED,
    BID_AUCTIONS: TRUST_TIERS.LOCATION_VERIFIED,
    VIEW_EVENTS: TRUST_TIERS.LOCATION_VERIFIED,
    RSVP_EVENTS: TRUST_TIERS.LOCATION_VERIFIED,
    VIEW_CHANNELS: TRUST_TIERS.LOCATION_VERIFIED,
    COMMENT_CHANNELS: TRUST_TIERS.LOCATION_VERIFIED,
    SWEEP_ENTER: TRUST_TIERS.LOCATION_VERIFIED,
    VIEW_ARCHIVE: TRUST_TIERS.LOCATION_VERIFIED,
    VIEW_LOCALBIZ: TRUST_TIERS.RESIDENT,
    VIEW_SCHEDULED: TRUST_TIERS.RESIDENT,
    LIVE_SCHEDULE: TRUST_TIERS.LOCAL_BUSINESS,
    LIVE_HOST: TRUST_TIERS.LOCAL_BUSINESS,
    SELL_LISTINGS: TRUST_TIERS.RESIDENT,
    CREATE_LISTINGS: TRUST_TIERS.RESIDENT,
    CREATE_EVENTS: TRUST_TIERS.LOCAL_BUSINESS
  }[perm];
  if (required == null) return true;
  return tier >= required;
}

module.exports = { TRUST_TIERS, TRUST_TIER_LABELS, resolveTier, can, hasPerm, permissionsForTier, limitsForTier };
