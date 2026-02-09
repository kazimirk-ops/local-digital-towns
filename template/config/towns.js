/**
 * Multi-Town Configuration System
 *
 * This module manages configuration for multiple towns/cities.
 * All town-specific values live in config/town-config.json.
 * This file provides lookup helpers and the Express middleware.
 */

const townConfigs = require("./town-config.json");

// Resolve the default town slug (first key in the JSON, or env override)
const DEFAULT_SLUG = process.env.TOWN_SLUG || Object.keys(townConfigs)[0] || "sebastian";

// Build a lookup map keyed by slug
const towns = {};
for (const [slug, raw] of Object.entries(townConfigs)) {
  towns[slug] = {
    ...raw,

    // Flatten branding for backwards-compat with code that reads town.primaryColor
    primaryColor: raw.branding?.primaryColor,
    secondaryColor: raw.branding?.secondaryColor,
    logoUrl: raw.branding?.logoUrl,
    faviconUrl: raw.branding?.faviconUrl,
    ogImage: raw.branding?.ogImage,

    // Flatten content for backwards-compat
    welcomeMessage: raw.content?.welcomeMessage,
    supportEmail: raw.contact?.supportEmail,

    // Flatten location for backwards-compat with code that reads town.location.lat
    location: raw.location
  };
}

function getDefaultTown() {
  return towns[DEFAULT_SLUG] || Object.values(towns)[0];
}

/**
 * Get town configuration by domain
 */
function getTownByDomain(domain) {
  const normalizedDomain = (domain || "").toLowerCase().replace(/^www\./, "");

  for (const config of Object.values(towns)) {
    if (config.domains?.includes(normalizedDomain)) {
      return config;
    }
  }

  return getDefaultTown();
}

/**
 * Get town configuration by slug
 */
function getTownBySlug(slug) {
  return towns[slug] || getDefaultTown();
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
  return getDefaultTown();
}

/**
 * Get current town from environment
 */
function getCurrentTown() {
  const townId = parseInt(process.env.TOWN_ID || "0");
  const townSlug = process.env.TOWN_SLUG || DEFAULT_SLUG;

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

// Re-export the raw JSON for consumers that need the full unflattened config
const defaultTownConfig = getDefaultTown();

module.exports = {
  getTownByDomain,
  getTownBySlug,
  getTownById,
  getCurrentTown,
  townMiddleware,
  getAllTowns,
  isFeatureEnabled,
  defaultTownConfig,
  towns,
  townConfigs
};
