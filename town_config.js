/**
 * Legacy town config — now backed by config/town-config.json.
 *
 * This file preserves the original TRUST / CAPABILITIES / getTownConfig API
 * so that existing require("./town_config") calls keep working.
 */

const townConfigs = require("./config/town-config.json");

const TRUST = {
  VISITOR: "visitor",
  VERIFIED_VISITOR: "verified_visitor",
  MEMBER: "member",
  TRUSTED: "trusted",
};

const CAPABILITIES = {
  [TRUST.VISITOR]: {
    canBrowse: true,
    canFollow: true,
    canMessage: true,
    canBuyFixedPrice: true,
    canBidAuctions: true,
    canCreateOffers: false,
    canCreateRequests: false,
    canCreateLodging: false,
    canBarter: false,
    canHostAuctions: false,
    canCreateListings: false,
    maxPurchaseCents: 15000,
    maxBidCents: 5000,
    dailyActionsCap: 60,
  },
  [TRUST.VERIFIED_VISITOR]: {
    canBrowse: true,
    canFollow: true,
    canMessage: true,
    canBuyFixedPrice: true,
    canBidAuctions: true,
    canCreateOffers: true,
    canCreateRequests: true,
    canCreateLodging: false,
    canBarter: false,
    canHostAuctions: false,
    canCreateListings: false,
    maxPurchaseCents: 50000,
    maxBidCents: 25000,
    dailyActionsCap: 200,
  },
  [TRUST.MEMBER]: {
    canBrowse: true,
    canFollow: true,
    canMessage: true,
    canBuyFixedPrice: true,
    canBidAuctions: true,
    canCreateOffers: true,
    canCreateRequests: true,
    canCreateLodging: true,
    canBarter: true,
    canHostAuctions: true,
    canCreateListings: true,
    maxPurchaseCents: 200000,
    maxBidCents: 100000,
    dailyActionsCap: 500,
  },
  [TRUST.TRUSTED]: {
    canBrowse: true,
    canFollow: true,
    canMessage: true,
    canBuyFixedPrice: true,
    canBidAuctions: true,
    canCreateOffers: true,
    canCreateRequests: true,
    canCreateLodging: true,
    canBarter: true,
    canHostAuctions: true,
    canCreateListings: true,
    maxPurchaseCents: 1000000,
    maxBidCents: 500000,
    dailyActionsCap: 2000,
  },
};

// Build the TOWNS map from the JSON config
const TOWNS = {};
for (const [slug, cfg] of Object.entries(townConfigs)) {
  TOWNS[cfg.id] = {
    id: cfg.id,
    slug: cfg.slug,
    name: cfg.name,
    state: cfg.state,
    region: cfg.region,
    theme: cfg.theme,
    trustDefaults: { defaultLevel: cfg.trustDefaults?.defaultLevel || TRUST.VISITOR },
    capabilitiesByTrust: CAPABILITIES,
  };
}

function getTownConfig(townId = 1) {
  return TOWNS[Number(townId)] || TOWNS[Object.keys(TOWNS)[0]];
}

module.exports = { TRUST, getTownConfig };
