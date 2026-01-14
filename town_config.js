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

const TOWNS = {
  1: {
    id: 1,
    slug: "sebastian",
    name: "Sebastian",
    state: "FL",
    region: "Treasure Coast",
    theme: {
      accent: "#00ffae",
      bg: "#070b10",
      panel: "#0f1722",
      text: "#e8eef6",
      muted: "#9fb0c3",
    },
    trustDefaults: { defaultLevel: TRUST.VISITOR },
    capabilitiesByTrust: CAPABILITIES,
  },
};

function getTownConfig(townId = 1) {
  return TOWNS[Number(townId)] || TOWNS[1];
}

module.exports = { TRUST, getTownConfig };
