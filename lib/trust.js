// Unified permission system with trust levels

const LEVELS = {
  VISITOR: 0,
  VERIFIED_VISITOR: 1,
  VERIFIED_RESIDENT: 2,
  MODERATOR: 3,
  LOCAL_BUSINESS: 4,
  ADMIN: 5
};

const LEVEL_LABELS = {
  [LEVELS.VISITOR]: "Visitor",
  [LEVELS.VERIFIED_VISITOR]: "Verified Visitor",
  [LEVELS.VERIFIED_RESIDENT]: "Verified Resident",
  [LEVELS.MODERATOR]: "Moderator",
  [LEVELS.LOCAL_BUSINESS]: "Local Business",
  [LEVELS.ADMIN]: "Admin"
};

// Permissions mapped to minimum required level
const PERMISSIONS = {
  // Basic access
  VIEW_MAP: LEVELS.VISITOR,
  VIEW_PULSE: LEVELS.VISITOR,

  // Verified visitor permissions (level 1)
  VIEW_MARKET: LEVELS.VERIFIED_VISITOR,
  BUY_MARKET: LEVELS.VERIFIED_VISITOR,
  VIEW_AUCTIONS: LEVELS.VERIFIED_VISITOR,
  BID_AUCTIONS: LEVELS.VERIFIED_VISITOR,
  VIEW_EVENTS: LEVELS.VERIFIED_VISITOR,
  RSVP_EVENTS: LEVELS.VERIFIED_VISITOR,
  VIEW_CHANNELS: LEVELS.VERIFIED_VISITOR,
  VIEW_ARCHIVE: LEVELS.VERIFIED_VISITOR,
  SWEEP_ENTER: LEVELS.VERIFIED_VISITOR,
  CHAT_POST: LEVELS.VERIFIED_VISITOR,
  CHAT_IMAGES: LEVELS.VERIFIED_VISITOR,
  IMAGE_UPLOAD: LEVELS.VERIFIED_VISITOR,

  // Verified resident permissions (level 2)
  SELL_MARKET: LEVELS.VERIFIED_RESIDENT,
  CREATE_LISTINGS: LEVELS.VERIFIED_RESIDENT,
  COMMENT_CHANNELS: LEVELS.VERIFIED_RESIDENT,
  VIEW_LOCALBIZ: LEVELS.VERIFIED_RESIDENT,
  VIEW_SCHEDULED: LEVELS.VERIFIED_RESIDENT,
  SEND_DM: LEVELS.VERIFIED_RESIDENT,
  PRIZE_SUBMIT: LEVELS.VERIFIED_RESIDENT,
  WRITE_REVIEWS: LEVELS.VERIFIED_RESIDENT,

  // Moderator permissions (level 3)
  MODERATE_CHANNEL: LEVELS.MODERATOR,
  MUTE_USER: LEVELS.MODERATOR,
  APPROVE_EVENTS: LEVELS.MODERATOR,
  DELETE_MESSAGES: LEVELS.MODERATOR,

  // Local business permissions (level 4)
  HOST_AUCTION: LEVELS.LOCAL_BUSINESS,
  CREATE_EVENTS: LEVELS.LOCAL_BUSINESS,
  LIVE_SCHEDULE: LEVELS.LOCAL_BUSINESS,
  LIVE_HOST: LEVELS.LOCAL_BUSINESS,
  INVENTORY_TOOLS: LEVELS.LOCAL_BUSINESS,
  DONATE_GIVEAWAY: LEVELS.LOCAL_BUSINESS,

  // Admin permissions (level 5)
  ADMIN_PANEL: LEVELS.ADMIN,
  MANAGE_USERS: LEVELS.ADMIN,
  MANAGE_TIERS: LEVELS.ADMIN,
  MANAGE_SWEEPS: LEVELS.ADMIN,
  VIEW_ANALYTICS: LEVELS.ADMIN
};

// Backwards compatibility aliases
const TRUST_TIERS = {
  GUEST: LEVELS.VISITOR,
  LOCATION_VERIFIED: LEVELS.VERIFIED_VISITOR,
  RESIDENT: LEVELS.VERIFIED_RESIDENT,
  LOCAL_BUSINESS: LEVELS.LOCAL_BUSINESS,
  ADMIN: LEVELS.ADMIN
};

const TRUST_TIER_LABELS = {
  0: "Visitor",
  1: "Verified Visitor",
  2: "Verified Resident",
  3: "Moderator",
  4: "Local Business",
  5: "Admin"
};

function getDefaultTrustLevel() {
  return "visitor";
}

function resolveTier(user, ctx) {
  // Admin check first (level 5)
  if (user?.isAdmin || Number(user?.isadmin || 0) === 1) {
    return LEVELS.ADMIN;
  }

  // Check explicit trustTier on user
  const userTier = Number(user?.trustTier ?? user?.trusttier ?? 0);
  if (Number.isFinite(userTier) && userTier > 0 && userTier <= LEVELS.LOCAL_BUSINESS) {
    return userTier;
  }

  // Check membership trustTier from context
  const memberTier = Number(ctx?.membership?.trustTier ?? ctx?.membership?.trusttier ?? 0);
  if (Number.isFinite(memberTier) && memberTier > 0 && memberTier <= LEVELS.LOCAL_BUSINESS) {
    return memberTier;
  }

  // Legacy flag: residentVerified -> VERIFIED_RESIDENT (level 2)
  if (Number(user?.residentVerified ?? user?.residentverified ?? 0) === 1) {
    return LEVELS.VERIFIED_RESIDENT;
  }

  // Legacy flag: locationVerifiedSebastian -> VERIFIED_VISITOR (level 1)
  if (Number(user?.locationVerifiedSebastian ?? user?.locationverifiedsebastian ?? 0) === 1) {
    return LEVELS.VERIFIED_VISITOR;
  }

  // Default: VISITOR (level 0)
  return LEVELS.VISITOR;
}

function hasPerm(user, ctx, perm) {
  // Admins have all permissions
  if (user?.isAdmin || Number(user?.isadmin || 0) === 1) {
    return true;
  }

  const tier = resolveTier(user, ctx);
  const required = PERMISSIONS[perm];

  // Unknown permission defaults to allowed
  if (required == null) return true;

  return tier >= required;
}

function can(user, ctx, action) {
  // Map legacy action names to permission names
  const actionMap = {
    chat_text: "CHAT_POST",
    chat_image: "CHAT_IMAGES",
    listing_create: "CREATE_LISTINGS",
    auction_host: "HOST_AUCTION",
    auction_bid: "BID_AUCTIONS",
    image_upload: "IMAGE_UPLOAD",
    prize_submit: "PRIZE_SUBMIT"
  };

  const perm = actionMap[action] || action.toUpperCase();
  const tier = resolveTier(user, ctx);
  const required = PERMISSIONS[perm] ?? 0;

  return { ok: tier >= required, tier, required };
}

function permissionsForTier(tier) {
  return {
    map: true,
    pulse: true,
    marketplace: tier >= LEVELS.VERIFIED_VISITOR,
    auctions: tier >= LEVELS.VERIFIED_VISITOR,
    channels: tier >= LEVELS.VERIFIED_VISITOR,
    events: tier >= LEVELS.VERIFIED_VISITOR,
    archive: tier >= LEVELS.VERIFIED_VISITOR,
    localbiz: tier >= LEVELS.VERIFIED_RESIDENT,
    scheduled: tier >= LEVELS.VERIFIED_RESIDENT,
    chatPost: tier >= LEVELS.VERIFIED_VISITOR,
    chatImages: tier >= LEVELS.VERIFIED_VISITOR,
    listingCreate: tier >= LEVELS.VERIFIED_RESIDENT,
    auctionHost: tier >= LEVELS.LOCAL_BUSINESS,
    bid: tier >= LEVELS.VERIFIED_VISITOR,
    dm: tier >= LEVELS.VERIFIED_RESIDENT,
    sweepEnter: tier >= LEVELS.VERIFIED_VISITOR,
    liveSchedule: tier >= LEVELS.LOCAL_BUSINESS,
    liveHost: tier >= LEVELS.LOCAL_BUSINESS,
    moderate: tier >= LEVELS.MODERATOR,
    admin: tier >= LEVELS.ADMIN
  };
}

function limitsForTier(tier) {
  return {
    maxUploadBytes: 5 * 1024 * 1024,
    maxListingPhotos: 5
  };
}

function getLevelLabel(level) {
  return LEVEL_LABELS[level] || "Unknown";
}

module.exports = {
  LEVELS,
  LEVEL_LABELS,
  PERMISSIONS,
  TRUST_TIERS,
  TRUST_TIER_LABELS,
  getDefaultTrustLevel,
  resolveTier,
  hasPerm,
  can,
  permissionsForTier,
  limitsForTier,
  getLevelLabel
};
