/**
 * Multi-Town Configuration System
 *
 * This module manages configuration for multiple towns/cities
 * Each town can have its own:
 * - Domain
 * - Branding (name, colors, logo)
 * - Features enabled/disabled
 * - Payment settings
 * - Custom content
 */

// Default town configuration
const defaultTownConfig = {
  id: 1,
  slug: "sebastian",
  name: "Sebastian",
  fullName: "Digital Sebastian",
  tagline: "Your Local Digital Town Square",
  region: "Florida",
  country: "US",
  timezone: "America/New_York",

  // Branding
  branding: {
    primaryColor: "#3b82f6",
    secondaryColor: "#22d3ee",
    logoUrl: "/images/logo.png",
    faviconUrl: "/favicon.ico",
    ogImage: "/images/og-image.png"
  },

  // Features
  features: {
    marketplace: true,
    auctions: true,
    giveaways: true,
    sweepstakes: true,
    liveStreaming: true,
    channels: true,
    directMessages: true,
    businessSubscriptions: true,
    reviews: true
  },

  // Payment settings
  payments: {
    currency: "usd",
    stripeEnabled: true,
    userSubscriptionPriceCents: 0,       // Free Individual tier
    businessSubscriptionPriceCents: 1000, // $10/mo Business tier
    trialDays: 30,
    referralCommissionPercent: 25  // 25% commission on referrals
  },

  // Content
  content: {
    welcomeMessage: "Welcome to Digital Sebastian!",
    aboutUrl: "/about",
    termsUrl: "/terms",
    privacyUrl: "/privacy",
    supportEmail: "support@digitalsebastian.com"
  },

  // Social
  social: {
    facebook: null,
    instagram: null,
    twitter: null
  },

  // Coordinates (for map center)
  location: {
    lat: 27.8164,
    lng: -80.4706,
    zoom: 13
  }
};

// Town registry - add new towns here
const towns = {
  sebastian: {
    ...defaultTownConfig,
    id: 1,
    slug: "sebastian",
    name: "Sebastian",
    fullName: "Digital Sebastian",
    domains: ["digitalsebastian.com", "sebastian.digitaltowns.com", "localhost"]
  },

  // Example: Add more towns as needed
  // verobeach: {
  //   ...defaultTownConfig,
  //   id: 2,
  //   slug: "verobeach",
  //   name: "Vero Beach",
  //   fullName: "Digital Vero Beach",
  //   domains: ["digitalverobeach.com", "verobeach.digitaltowns.com"],
  //   branding: {
  //     ...defaultTownConfig.branding,
  //     primaryColor: "#10b981"
  //   }
  // }
};

/**
 * Get town configuration by domain
 */
function getTownByDomain(domain) {
  const normalizedDomain = (domain || "").toLowerCase().replace(/^www\./, "");

  for (const [slug, config] of Object.entries(towns)) {
    if (config.domains?.includes(normalizedDomain)) {
      return config;
    }
  }

  // Default to sebastian for development
  return towns.sebastian;
}

/**
 * Get town configuration by slug
 */
function getTownBySlug(slug) {
  return towns[slug] || towns.sebastian;
}

/**
 * Get town configuration by ID
 */
function getTownById(id) {
  for (const config of Object.values(towns)) {
    if (config.id === id) {
      return config;
    }
  }
  return towns.sebastian;
}

/**
 * Get current town from environment
 */
function getCurrentTown() {
  const townId = parseInt(process.env.TOWN_ID || "1");
  const townSlug = process.env.TOWN_SLUG || "sebastian";

  if (townId) {
    return getTownById(townId);
  }

  return getTownBySlug(townSlug);
}

/**
 * Middleware to attach town config to request
 */
function townMiddleware(req, res, next) {
  const host = req.get("host") || "localhost";
  req.town = getTownByDomain(host);
  res.locals.town = req.town;
  next();
}

/**
 * Get all registered towns
 */
function getAllTowns() {
  return Object.values(towns);
}

/**
 * Check if a feature is enabled for a town
 */
function isFeatureEnabled(town, feature) {
  const config = typeof town === "string" ? getTownBySlug(town) : town;
  return config?.features?.[feature] ?? false;
}

module.exports = {
  getTownByDomain,
  getTownBySlug,
  getTownById,
  getCurrentTown,
  townMiddleware,
  getAllTowns,
  isFeatureEnabled,
  defaultTownConfig,
  towns
};
