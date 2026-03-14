/**
 * Treasure Coast UI module (L5)
 * Serves the TC town-facing frontend from the module system.
 * Only active when feature flag "ui-treasurecoast" is enabled.
 */

var path = require("path");
var express = require("express");

module.exports = function mountTCUI(app, db) {

  var publicDir = path.join(__dirname, "public");

  function getFlags(req) {
    var community = req.community || {};
    return community.feature_flags || {};
  }

  // Serve TC index.html as the root when flag is on
  app.get("/", function(req, res, next) {
    var f = getFlags(req);
    if (f["ui-treasurecoast"]) {
      return res.sendFile(path.join(publicDir, "index.html"));
    }
    next();
  });

  // Serve all TC HTML pages (except admin pages which are handled elsewhere)
  var tcPages = [
    "login", "dashboard", "auctions", "listing", "cart",
    "inbox", "messages", "profile", "gigs", "gigs-book", "gigs-review",
    "bst-groups", "bst-group", "groups", "events", "rides", "junk",
    "leaderboard", "wheel", "giveaway", "live",
    "seller-apply", "claim", "complete-profile", "profile-complete",
    "order-confirmed", "delivery-quote", "delivery-quote-approve",
    "delivery-tracking", "flash-sale-success", "stripe-connect-return",
    "mod-apply", "mod-dashboard",
    "privacy", "terms", "data-deletion", "underage"
  ];

  tcPages.forEach(function(page) {
    app.get("/" + page, function(req, res, next) {
      var f = getFlags(req);
      if (f["ui-treasurecoast"]) {
        return res.sendFile(path.join(publicDir, page + ".html"));
      }
      next();
    });
  });

  // Serve profile by user ID: /profile/:id
  app.get("/profile/:id", function(req, res, next) {
    var f = getFlags(req);
    if (f["ui-treasurecoast"]) {
      return res.sendFile(path.join(publicDir, "profile.html"));
    }
    next();
  });

  // Serve static JS files (auth-gate.js, login.js, etc.)
  app.use(express.static(publicDir, { index: false }));

  console.log("[ui-treasurecoast] L5 module mounted — TC frontend");
};
