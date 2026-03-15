// lib/module-access.js
function canAccessModule(flags, moduleId, userTier = 0) {
  if (!flags[moduleId]) return false;
  const minTier = flags[`${moduleId}.tier`] ?? 0;
  return userTier >= minTier;
}

module.exports = { canAccessModule };
