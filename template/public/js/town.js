/**
 * Town config accessor for frontend JS.
 * Reads from window.__TOWN_CONFIG__ which is injected into every HTML page
 * by the server-side middleware.
 *
 * Usage: const tc = window.__TOWN_CONFIG__ || {};
 *        tc.name, tc.fullName, tc.slug, tc.contact.supportEmail, etc.
 */
(function () {
  if (!window.__TOWN_CONFIG__) {
    console.warn("Town config not injected — using empty defaults.");
    window.__TOWN_CONFIG__ = {};
  }
  window.getTownConfig = function () {
    return window.__TOWN_CONFIG__;
  };
})();
