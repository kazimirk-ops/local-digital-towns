const TRUST_TIERS = {
  VISITOR: 0,
  VERIFIED_REMOTE: 1,
  VERIFIED_IN_TOWN: 2,
  LOCAL_RESIDENT: 3,
  TRUSTED_LOCAL: 4,
  VERIFIED_BUSINESS: 5,
  ADMIN: 6,
};

const TRUST_TIER_LABELS = {
  0: "Visitor",
  1: "Verified Remote",
  2: "Verified In-Town Visitor",
  3: "Local Resident",
  4: "Trusted Local",
  5: "Verified Business",
  6: "Admin"
};

function resolveTier(user, ctx) {
  if (user?.isAdmin) return TRUST_TIERS.ADMIN;
  const userTier = Number(user?.trustTier || 0);
  if (Number.isFinite(userTier) && userTier > 0) return userTier;
  const memberTier = Number(ctx?.membership?.trustTier || 0);
  if (Number.isFinite(memberTier) && memberTier > 0) return memberTier;
  const trustLevel = (ctx?.trustLevel || "visitor").toString();
  if (trustLevel === "trusted") return TRUST_TIERS.TRUSTED_LOCAL;
  if (trustLevel === "member") return TRUST_TIERS.LOCAL_RESIDENT;
  if (trustLevel === "verified_visitor") return TRUST_TIERS.VERIFIED_IN_TOWN;
  if (user?.isSellerVerified) return TRUST_TIERS.VERIFIED_BUSINESS;
  return TRUST_TIERS.VISITOR;
}

function permissionsForTier(tier) {
  return {
    map: true,
    marketplace: tier >= TRUST_TIERS.VERIFIED_REMOTE,
    auctions: tier >= TRUST_TIERS.VERIFIED_REMOTE,
    channels: tier >= TRUST_TIERS.VERIFIED_REMOTE,
    events: tier >= TRUST_TIERS.VERIFIED_REMOTE,
    archive: tier >= TRUST_TIERS.VERIFIED_REMOTE,
    localbiz: tier >= TRUST_TIERS.VERIFIED_REMOTE,
    chatPost: tier >= TRUST_TIERS.VERIFIED_IN_TOWN,
    chatImages: tier >= TRUST_TIERS.VERIFIED_IN_TOWN,
    listingCreate: tier >= TRUST_TIERS.LOCAL_RESIDENT,
    auctionHost: tier >= TRUST_TIERS.TRUSTED_LOCAL,
    bid: tier >= TRUST_TIERS.VERIFIED_REMOTE,
    dm: tier >= TRUST_TIERS.VERIFIED_REMOTE
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
    chat_text: TRUST_TIERS.VERIFIED_REMOTE,
    chat_image: TRUST_TIERS.VERIFIED_IN_TOWN,
    listing_create: TRUST_TIERS.LOCAL_RESIDENT,
    auction_host: TRUST_TIERS.TRUSTED_LOCAL,
    auction_bid: TRUST_TIERS.VERIFIED_REMOTE,
    image_upload: TRUST_TIERS.VERIFIED_IN_TOWN,
    prize_submit: TRUST_TIERS.LOCAL_RESIDENT
  }[action];

  if (required == null) return { ok: true, tier, required: 0 };
  return { ok: tier >= required, tier, required };
}

module.exports = { TRUST_TIERS, TRUST_TIER_LABELS, resolveTier, can, permissionsForTier, limitsForTier };
