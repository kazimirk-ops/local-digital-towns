/**
 * UI Base module (L5)
 * Clean town shell with installable UI sub-modules.
 * Each page checks feature flags before rendering.
 */

var path = require("path");
var express = require("express");

module.exports = function mountUIBase(app, db) {
  var pub = path.join(__dirname, "public");

  // Serve static assets (CSS, JS)
  app.use("/town/assets", express.static(pub));

  // All town pages
  var pages = [
    "login", "marketplace", "auctions", "channels", "bst",
    "sweep", "pulse", "businesses", "gigs", "leaderboard",
    "live", "orders", "payments", "trust", "notifications",
    "referrals", "shipping", "disputes", "profile"
  ];

  app.get("/town", function(req, res) {
    res.sendFile(path.join(pub, "shell.html"));
  });

  pages.forEach(function(page) {
    app.get("/town/" + page, function(req, res) {
      res.sendFile(path.join(pub, page + ".html"));
    });
  });

  // Feature flags endpoint
  app.get("/api/feature-flags", async function(req, res) {
    try {
      var slug = (req.community && req.community.slug) || "digitaltowns";
      var r = await db.query("SELECT feature_flags FROM communities WHERE slug = $1", [slug]);
      res.json((r.rows[0] && r.rows[0].feature_flags) || {});
    } catch(e) {
      res.json({});
    }
  });

  console.log("[ui-base] L5 module mounted — town shell + 19 sub-module pages");
};
