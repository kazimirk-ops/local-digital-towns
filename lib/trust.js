// Unified permission system with trust levels

const LEVELS = {
  VISITOR: 0,        // Can view only (map, featured businesses, auctions, marketplace)
  INDIVIDUAL: 1,     // Free - Can buy/sell, no storefront in directory
  MODERATOR: 2,      // Individual + can manage chat channels
  LOCAL_BUSINESS: 3, // $10/mo - Storefront in Featured Local Businesses + events/promos
  ADMIN: 4           // Full access
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
  // Basic access
  VIEW_MAP: LEVELS.VISITOR,
  VIEW_PULSE: LEVELS.VISITOR,

  // View permissions (Tier 0 - Visitors can view)
  VIEW_MARKET: LEVELS.VISITOR,
  VIEW_AUCTIONS: LEVELS.VISITOR,
  VIEW_EVENTS: LEVELS.VISITOR,
  VIEW_CHANNELS: LEVELS.VISITOR,
  VIEW_ARCHIVE: LEVELS.VISITOR,
  VIEW_LOCALBIZ: LEVELS.VISITOR,
  VIEW_SCHEDULED: LEVELS.VISITOR,

  // Individual permissions (Tier 1 - subscribers can buy/sell/interact)
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

  // Moderator permissions (level 3)
  MODERATE_CHANNEL: LEVELS.MODERATOR,
  MUTE_USER: LEVELS.MODERATOR,
  APPROVE_EVENTS: LEVELS.MODERATOR,
  DELETE_MESSAGES: LEVELS.MODERATOR,

  // Local business permissions (level 4)
  CREATE_EVENTS: LEVELS.LOCAL_BUSINESS,
  LIVE_SCHEDULE: LEVELS.LOCAL_BUSINESS,  // Live shows separate from auctions
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
  LOCATION_VERIFIED: LEVELS.INDIVIDUAL,
  RESIDENT: LEVELS.INDIVIDUAL,
  LOCAL_BUSINESS: LEVELS.LOCAL_BUSINESS,
  ADMIN: LEVELS.ADMIN
};

const TRUST_TIER_LABELS = {
  0: "Visitor",
  1: "Individual",
  2: "Moderator",
  3: "Local Business",
  4: "Admin"
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

  // Legacy flag: residentVerified -> INDIVIDUAL (level 1)
  if (Number(user?.residentVerified ?? user?.residentverified ?? 0) === 1) {
    return LEVELS.INDIVIDUAL;
  }

  // Legacy flag: locationVerifiedSebastian (DB column) -> INDIVIDUAL (level 1)
  if (Number(user?.locationVerifiedSebastian ?? user?.locationverifiedsebastian ?? user?.locationVerified ?? user?.locationverified ?? 0) === 1) {
    return LEVELS.INDIVIDUAL;
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
  // Tier 0 (VISITOR): View only
  // Tier 1 (INDIVIDUAL Free): Buy/sell, listings, no storefront
  // Tier 2 (MODERATOR): Individual + channel management
  // Tier 3 (LOCAL_BUSINESS $10/mo): Individual + storefront, events, promos
  // Tier 4 (ADMIN): Everything
  return {
    // View permissions (Tier 0+)
    map: true,
    pulse: true,
    marketplace: true,
    auctions: true,
    channels: true,
    archive: true,
    // Individual permissions (Tier 1+)
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
    // Moderator permissions (Tier 2+)
    moderate: tier >= LEVELS.MODERATOR,
    // Local Business permissions (Tier 3+)
    localbiz: tier >= LEVELS.LOCAL_BUSINESS,
    hasStorefront: tier >= LEVELS.LOCAL_BUSINESS,
    events: tier >= LEVELS.LOCAL_BUSINESS,
    liveSchedule: tier >= LEVELS.LOCAL_BUSINESS,
    liveHost: tier >= LEVELS.LOCAL_BUSINESS,
    // Admin permissions (Tier 4)
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

function canBuyAsVerifiedVisitor(user) {
  return user && user.trustTier === 0 && Number(user.isBuyerVerified) === 1;
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
  getLevelLabel,
  canBuyAsVerifiedVisitor
};
