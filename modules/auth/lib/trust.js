// Unified trust tier system
// Adapted from Sebastian lib/trust.js — expanded to 6 levels

const LEVELS = {
  VISITOR: 0,
  INDIVIDUAL: 1,
  MODERATOR: 2,
  LOCAL_BUSINESS: 3,
  ADMIN: 4
};

const LEVEL_LABELS = {
  [LEVELS.VISITOR]: "Visitor",
  [LEVELS.INDIVIDUAL]: "Individual",
  [LEVELS.MODERATOR]: "Moderator",
  [LEVELS.LOCAL_BUSINESS]: "Local Business",
  [LEVELS.ADMIN]: "Admin"
};

// Permissions mapped to minimum required level
const PERMISSIONS = {
  // View permissions (Tier 0 - Visitors)
  VIEW_MAP: LEVELS.VISITOR,
  VIEW_PULSE: LEVELS.VISITOR,
  VIEW_MARKET: LEVELS.VISITOR,
  VIEW_AUCTIONS: LEVELS.VISITOR,
  VIEW_EVENTS: LEVELS.VISITOR,
  VIEW_CHANNELS: LEVELS.VISITOR,
  VIEW_ARCHIVE: LEVELS.VISITOR,
  VIEW_LOCALBIZ: LEVELS.VISITOR,
  VIEW_SCHEDULED: LEVELS.VISITOR,

  // Individual permissions (Tier 1)
  BUY_MARKET: LEVELS.INDIVIDUAL,
  BID_AUCTIONS: LEVELS.INDIVIDUAL,
  SELL_MARKET: LEVELS.INDIVIDUAL,
  CREATE_LISTINGS: LEVELS.INDIVIDUAL,
  HOST_AUCTION: LEVELS.INDIVIDUAL,
  RSVP_EVENTS: LEVELS.INDIVIDUAL,
  SWEEP_ENTER: LEVELS.INDIVIDUAL,
  CHAT_POST: LEVELS.INDIVIDUAL,
  CHAT_IMAGES: LEVELS.INDIVIDUAL,
  IMAGE_UPLOAD: LEVELS.INDIVIDUAL,
  COMMENT_CHANNELS: LEVELS.INDIVIDUAL,
  SEND_DM: LEVELS.INDIVIDUAL,
  PRIZE_SUBMIT: LEVELS.INDIVIDUAL,
  WRITE_REVIEWS: LEVELS.INDIVIDUAL,

  // Moderator permissions (Tier 2)
  MODERATE_CHANNEL: LEVELS.MODERATOR,
  MUTE_USER: LEVELS.MODERATOR,
  APPROVE_EVENTS: LEVELS.MODERATOR,
  DELETE_MESSAGES: LEVELS.MODERATOR,

  // Local business permissions (Tier 3)
  CREATE_EVENTS: LEVELS.LOCAL_BUSINESS,
  LIVE_SCHEDULE: LEVELS.LOCAL_BUSINESS,
  LIVE_HOST: LEVELS.LOCAL_BUSINESS,
  INVENTORY_TOOLS: LEVELS.LOCAL_BUSINESS,
  DONATE_GIVEAWAY: LEVELS.LOCAL_BUSINESS,

  // Admin permissions (Tier 4)
  ADMIN_PANEL: LEVELS.ADMIN,
  MANAGE_USERS: LEVELS.ADMIN,
  MANAGE_TIERS: LEVELS.ADMIN,
  MANAGE_SWEEPS: LEVELS.ADMIN,
  VIEW_ANALYTICS: LEVELS.ADMIN
};

function resolveTier(user, ctx) {
  // Admin check first
  if (user?.isAdmin || Number(user?.isadmin || 0) === 1) {
    return LEVELS.ADMIN;
  }

  // Check explicit trust_tier_num on user
  const userTier = Number(user?.trust_tier_num ?? user?.trustTier ?? user?.trusttier ?? 0);
  if (Number.isFinite(userTier) && userTier > 0 && userTier <= LEVELS.LOCAL_BUSINESS) {
    return userTier;
  }

  // Check membership trustTier from context
  const memberTier = Number(ctx?.membership?.trustTier ?? ctx?.membership?.trusttier ?? 0);
  if (Number.isFinite(memberTier) && memberTier > 0 && memberTier <= LEVELS.LOCAL_BUSINESS) {
    return memberTier;
  }

  // Legacy flag: residentVerified -> INDIVIDUAL
  if (Number(user?.residentVerified ?? user?.residentverified ?? user?.resident_verified ?? 0) === 1) {
    return LEVELS.INDIVIDUAL;
  }

  // Legacy flag: locationVerified -> INDIVIDUAL
  if (Number(user?.locationVerified ?? user?.locationverified ?? user?.location_verified ?? 0) === 1) {
    return LEVELS.INDIVIDUAL;
  }

  // Default: VISITOR
  return LEVELS.VISITOR;
}

function hasPerm(user, ctx, perm) {
  if (user?.isAdmin || Number(user?.isadmin || 0) === 1) {
    return true;
  }
  const tier = resolveTier(user, ctx);
  const required = PERMISSIONS[perm];
  if (required == null) return true;
  return tier >= required;
}

function can(user, ctx, action) {
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
    marketplace: true,
    auctions: true,
    channels: true,
    archive: true,
    buy: tier >= LEVELS.INDIVIDUAL,
    sell: tier >= LEVELS.INDIVIDUAL,
    listingCreate: tier >= LEVELS.INDIVIDUAL,
    bid: tier >= LEVELS.INDIVIDUAL,
    auctionHost: tier >= LEVELS.INDIVIDUAL,
    dm: tier >= LEVELS.INDIVIDUAL,
    chatPost: tier >= LEVELS.INDIVIDUAL,
    chatImages: tier >= LEVELS.INDIVIDUAL,
    sweepEnter: tier >= LEVELS.INDIVIDUAL,
    sweepDonate: tier >= LEVELS.INDIVIDUAL,
    moderate: tier >= LEVELS.MODERATOR,
    localbiz: tier >= LEVELS.LOCAL_BUSINESS,
    hasStorefront: tier >= LEVELS.LOCAL_BUSINESS,
    events: tier >= LEVELS.LOCAL_BUSINESS,
    liveSchedule: tier >= LEVELS.LOCAL_BUSINESS,
    liveHost: tier >= LEVELS.LOCAL_BUSINESS,
    admin: tier >= LEVELS.ADMIN
  };
}

function getLevelLabel(level) {
  return LEVEL_LABELS[level] || "Unknown";
}

module.exports = {
  LEVELS,
  LEVEL_LABELS,
  PERMISSIONS,
  resolveTier,
  hasPerm,
  can,
  permissionsForTier,
  getLevelLabel
};
