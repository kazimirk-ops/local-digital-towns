/**
 * Trust module routes (L4)
 * Trust tiers, identity verification, resident verification, business subscriptions.
 * Extracted from Sebastian server.js trust/verify endpoints + lib/trust.js.
 */

const trust = require("./lib/trust");

module.exports = function mountTrust(app, db) {

  function parseCookies(req) {
    var obj = {}; var header = req.headers.cookie || "";
    header.split(";").forEach(function(p) { var i = p.indexOf("="); if (i < 0) return; obj[p.slice(0,i).trim()] = p.slice(i+1).trim(); });
    return obj;
  }
  async function getUserId(req) {
    var sid = parseCookies(req).sid; if (!sid) return null;
    var r = await db.query("SELECT user_id FROM sessions WHERE sid=$1 AND expires_at > NOW()", [sid]);
    return r.rows.length ? r.rows[0].user_id : null;
  }
  async function requireLogin(req, res) {
    var uid = await getUserId(req); if (!uid) { res.status(401).json({ error: "Login required" }); return null; }
    var susp = await db.query("SELECT suspended FROM users WHERE id=$1", [uid]);
    if (susp.rows.length && susp.rows[0].suspended) { res.status(403).json({ error: "Account suspended" }); return null; }
    return uid;
  }
  async function requireAdmin(req, res) {
    var uid = await requireLogin(req, res); if (!uid) return null;
    var r = await db.query("SELECT id, is_admin FROM users WHERE id=$1", [uid]);
    if (!r.rows.length || !r.rows[0].is_admin) { res.status(403).json({ error: "Admin required" }); return null; }
    return r.rows[0];
  }

  // Helper: get full user row with trust resolution
  async function getUserWithTrust(userId) {
    var r = await db.query("SELECT * FROM users WHERE id=$1", [userId]);
    if (!r.rows.length) return null;
    var user = r.rows[0];
    var tier = trust.resolveTier(user, {});
    var label = trust.TRUST_TIER_LABELS[tier] || "Visitor";
    var perms = trust.permissionsForTier(tier);
    return { user, tier, label, permissions: perms };
  }

  // ── GET /api/trust/status — current user's trust tier + permissions ──
  app.get("/api/trust/status", async function(req, res) {
    var uid = await getUserId(req);
    if (!uid) return res.json({ tier: 0, label: "Visitor", permissions: trust.permissionsForTier(0) });
    try {
      var data = await getUserWithTrust(uid);
      if (!data) return res.json({ tier: 0, label: "Visitor", permissions: trust.permissionsForTier(0) });
      res.json({
        tier: data.tier,
        label: data.label,
        permissions: data.permissions,
        is_buyer_verified: !!data.user.is_buyer_verified,
        is_seller_verified: !!data.user.is_seller_verified,
        resident_verified: !!data.user.resident_verified,
        location_verified: !!data.user.location_verified,
        suspended: !!data.user.suspended
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/trust/user/:id — trust info for a specific user (admin) ──
  app.get("/api/trust/user/:id", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var data = await getUserWithTrust(parseInt(req.params.id, 10));
      if (!data) return res.status(404).json({ error: "User not found" });
      res.json({
        user_id: data.user.id,
        display_name: data.user.display_name,
        email: data.user.email,
        tier: data.tier,
        label: data.label,
        permissions: data.permissions,
        is_buyer_verified: !!data.user.is_buyer_verified,
        is_seller_verified: !!data.user.is_seller_verified,
        resident_verified: !!data.user.resident_verified,
        location_verified: !!data.user.location_verified,
        suspended: !!data.user.suspended,
        ghosting_percent: data.user.ghosting_percent || 0,
        bidding_suspended_until: data.user.bidding_suspended_until
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/trust/verify-location — verify user by geolocation ──
  // Adapted from Sebastian POST /api/verify-location
  app.post("/api/trust/verify-location", async function(req, res) {
    var uid = await requireLogin(req, res); if (!uid) return;
    try {
      var b = req.body || {};
      var lat = parseFloat(b.lat);
      var lng = parseFloat(b.lng);
      var accuracy = parseFloat(b.accuracy) || 0;
      if (isNaN(lat) || isNaN(lng)) return res.status(400).json({ error: "lat and lng required" });

      // Check if within any place's geographic bounds (simple radius check)
      var places = await db.query(
        "SELECT id, slug, name, lat, lng FROM places WHERE lat IS NOT NULL AND lng IS NOT NULL"
      );
      var matched = null;
      for (var p of places.rows) {
        var dist = haversineKm(lat, lng, parseFloat(p.lat), parseFloat(p.lng));
        if (dist <= 50) { matched = p; break; } // 50km radius
      }

      if (!matched) return res.status(400).json({ error: "Not within any registered community" });

      await db.query(
        "UPDATE users SET location_verified = true, trust_tier = GREATEST(COALESCE(trust_tier, 0), 1) WHERE id = $1",
        [uid]
      );

      // Record trust event
      await db.query(
        "INSERT INTO trust_events (user_id, event_type, meta, created_at) VALUES ($1, $2, $3, NOW())",
        [uid, "location_verified", JSON.stringify({ lat, lng, accuracy, place_id: matched.id, place_slug: matched.slug })]
      );

      res.json({ ok: true, place: matched.slug, tier: 1, label: "Individual" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/trust/verify-resident — submit resident verification request ──
  app.post("/api/trust/verify-resident", async function(req, res) {
    var uid = await requireLogin(req, res); if (!uid) return;
    try {
      var b = req.body || {};
      if (!b.address_line1 || !b.city || !b.state || !b.zip) {
        return res.status(400).json({ error: "address_line1, city, state, zip required" });
      }

      // Check for existing pending request
      var existing = await db.query(
        "SELECT id FROM resident_verification_requests WHERE user_id=$1 AND status='pending'", [uid]
      );
      if (existing.rows.length) return res.status(400).json({ error: "You already have a pending request" });

      var place = null;
      if (b.place_id) {
        place = parseInt(b.place_id, 10);
      }

      var result = await db.query(
        "INSERT INTO resident_verification_requests (place_id, user_id, status, address_line1, city, state, zip, created_at) " +
        "VALUES ($1,$2,'pending',$3,$4,$5,$6,NOW()) RETURNING *",
        [place, uid, b.address_line1, b.city, b.state, b.zip]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/trust/apply — submit trust tier upgrade application ──
  app.post("/api/trust/apply", async function(req, res) {
    var uid = await requireLogin(req, res); if (!uid) return;
    try {
      var b = req.body || {};
      var requestedTier = parseInt(b.requested_tier, 10);
      if (!requestedTier || requestedTier < 1 || requestedTier > 3) {
        return res.status(400).json({ error: "requested_tier must be 1-3" });
      }

      // Check for existing pending application
      var existing = await db.query(
        "SELECT id FROM trust_applications WHERE user_id=$1 AND status='pending'", [uid]
      );
      if (existing.rows.length) return res.status(400).json({ error: "You already have a pending application" });

      var result = await db.query(
        "INSERT INTO trust_applications (place_id, user_id, requested_tier, status, email, phone, address1, city, state, zip, identity_method, identity_status, presence_status, created_at) " +
        "VALUES ($1,$2,$3,'pending',$4,$5,$6,$7,$8,$9,$10,'pending','pending',NOW()) RETURNING *",
        [
          b.place_id ? parseInt(b.place_id, 10) : null,
          uid,
          requestedTier,
          b.email || "",
          b.phone || "",
          b.address1 || "",
          b.city || "",
          b.state || "",
          b.zip || "",
          b.identity_method || "self"
        ]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/trust/applications — user's own applications ──
  app.get("/api/trust/applications", async function(req, res) {
    var uid = await requireLogin(req, res); if (!uid) return;
    try {
      var result = await db.query(
        "SELECT * FROM trust_applications WHERE user_id=$1 ORDER BY created_at DESC", [uid]
      );
      res.json({ applications: result.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/trust/resident-requests — user's own resident verification requests ──
  app.get("/api/trust/resident-requests", async function(req, res) {
    var uid = await requireLogin(req, res); if (!uid) return;
    try {
      var result = await db.query(
        "SELECT * FROM resident_verification_requests WHERE user_id=$1 ORDER BY created_at DESC", [uid]
      );
      res.json({ requests: result.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/admin/trust/applications — all pending applications ──
  app.get("/api/admin/trust/applications", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var status = req.query.status || "pending";
      var result = await db.query(
        "SELECT ta.*, u.display_name, u.email AS user_email " +
        "FROM trust_applications ta LEFT JOIN users u ON u.id = ta.user_id " +
        "WHERE ta.status=$1 ORDER BY ta.created_at ASC",
        [status]
      );
      res.json({ applications: result.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/admin/trust/applications/:id/approve ──
  app.post("/api/admin/trust/applications/:id/approve", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var appRow = await db.query("SELECT * FROM trust_applications WHERE id=$1", [req.params.id]);
      if (!appRow.rows.length) return res.status(404).json({ error: "Application not found" });
      var application = appRow.rows[0];

      await db.query(
        "UPDATE trust_applications SET status='approved', reviewed_at=NOW(), reviewed_by_user_id=$1, identity_status='verified', presence_status='verified', decision_reason=$2 WHERE id=$3",
        [admin.id, (req.body || {}).reason || "Approved", application.id]
      );

      // Upgrade user's trust tier
      await db.query(
        "UPDATE users SET trust_tier = GREATEST(COALESCE(trust_tier, 0), $1) WHERE id = $2",
        [application.requested_tier, application.user_id]
      );

      // If tier 1+, mark location_verified
      if (application.requested_tier >= 1) {
        await db.query("UPDATE users SET location_verified = true WHERE id = $1", [application.user_id]);
      }

      // Record trust event
      await db.query(
        "INSERT INTO trust_events (user_id, event_type, meta, created_at) VALUES ($1, $2, $3, NOW())",
        [application.user_id, "trust_upgraded", JSON.stringify({ tier: application.requested_tier, approved_by: admin.id })]
      );

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/admin/trust/applications/:id/reject ──
  app.post("/api/admin/trust/applications/:id/reject", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      await db.query(
        "UPDATE trust_applications SET status='rejected', reviewed_at=NOW(), reviewed_by_user_id=$1, decision_reason=$2 WHERE id=$3",
        [admin.id, (req.body || {}).reason || "Rejected", req.params.id]
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/admin/trust/resident-requests — all pending resident verification requests ──
  app.get("/api/admin/trust/resident-requests", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var status = req.query.status || "pending";
      var result = await db.query(
        "SELECT rvr.*, u.display_name, u.email AS user_email " +
        "FROM resident_verification_requests rvr LEFT JOIN users u ON u.id = rvr.user_id " +
        "WHERE rvr.status=$1 ORDER BY rvr.created_at ASC",
        [status]
      );
      res.json({ requests: result.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/admin/trust/resident-requests/:id/approve ──
  app.post("/api/admin/trust/resident-requests/:id/approve", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var reqRow = await db.query("SELECT * FROM resident_verification_requests WHERE id=$1", [req.params.id]);
      if (!reqRow.rows.length) return res.status(404).json({ error: "Request not found" });
      var request = reqRow.rows[0];

      await db.query(
        "UPDATE resident_verification_requests SET status='approved', reviewed_at=NOW(), reviewed_by_user_id=$1, decision_reason=$2 WHERE id=$3",
        [admin.id, (req.body || {}).reason || "Approved", request.id]
      );

      // Mark user as resident verified + upgrade tier to at least 1
      await db.query(
        "UPDATE users SET resident_verified = true, trust_tier = GREATEST(COALESCE(trust_tier, 0), 1) WHERE id = $1",
        [request.user_id]
      );

      // Record trust event
      await db.query(
        "INSERT INTO trust_events (user_id, event_type, meta, created_at) VALUES ($1, $2, $3, NOW())",
        [request.user_id, "resident_verified", JSON.stringify({ approved_by: admin.id })]
      );

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/admin/trust/resident-requests/:id/reject ──
  app.post("/api/admin/trust/resident-requests/:id/reject", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      await db.query(
        "UPDATE resident_verification_requests SET status='rejected', reviewed_at=NOW(), reviewed_by_user_id=$1, decision_reason=$2 WHERE id=$3",
        [admin.id, (req.body || {}).reason || "Rejected", req.params.id]
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/admin/trust/set-tier — manually set user trust tier ──
  app.post("/api/admin/trust/set-tier", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var b = req.body || {};
      var userId = parseInt(b.user_id, 10);
      var tier = parseInt(b.tier, 10);
      if (!userId || isNaN(tier) || tier < 0 || tier > 4) {
        return res.status(400).json({ error: "user_id and tier (0-4) required" });
      }

      await db.query("UPDATE users SET trust_tier = $1 WHERE id = $2", [tier, userId]);

      // Record trust event
      await db.query(
        "INSERT INTO trust_events (user_id, event_type, meta, created_at) VALUES ($1, $2, $3, NOW())",
        [userId, "tier_set_by_admin", JSON.stringify({ tier, admin_id: admin.id })]
      );

      res.json({ ok: true, tier });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/admin/trust/suspend — suspend/unsuspend user ──
  app.post("/api/admin/trust/suspend", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var b = req.body || {};
      var userId = parseInt(b.user_id, 10);
      if (!userId) return res.status(400).json({ error: "user_id required" });
      var suspended = b.suspended !== false && b.suspended !== "false";

      await db.query("UPDATE users SET suspended = $1 WHERE id = $2", [suspended, userId]);

      await db.query(
        "INSERT INTO trust_events (user_id, event_type, meta, created_at) VALUES ($1, $2, $3, NOW())",
        [userId, suspended ? "suspended" : "unsuspended", JSON.stringify({ admin_id: admin.id, reason: b.reason || "" })]
      );

      res.json({ ok: true, suspended });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Business subscriptions ──

  // GET /api/trust/subscription/:placeId — check subscription status
  app.get("/api/trust/subscription/:placeId", async function(req, res) {
    try {
      var sub = await db.query(
        "SELECT * FROM business_subscriptions WHERE place_id=$1 ORDER BY id DESC LIMIT 1",
        [req.params.placeId]
      );
      if (!sub.rows.length) return res.json({ active: false, subscription: null });
      var row = sub.rows[0];
      var now = new Date();
      var active = row.status === "active" && (
        (row.trial_ends_at && new Date(row.trial_ends_at) > now) ||
        (row.current_period_end && new Date(row.current_period_end) > now)
      );
      res.json({ active: !!active, subscription: row });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/trust/subscription — create business subscription (admin)
  app.post("/api/trust/subscription", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var b = req.body || {};
      var placeId = parseInt(b.place_id, 10);
      var userId = parseInt(b.user_id, 10);
      if (!placeId || !userId) return res.status(400).json({ error: "place_id and user_id required" });

      var plan = b.plan || "free_trial";
      var trialEnds = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      var result = await db.query(
        "INSERT INTO business_subscriptions (place_id, user_id, plan, status, trial_ends_at, current_period_start, current_period_end, created_at, updated_at) " +
        "VALUES ($1,$2,$3,'active',$4,NOW(),$5,NOW(),NOW()) RETURNING *",
        [placeId, userId, plan, trialEnds, trialEnds]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Haversine helper ──
  function haversineKm(lat1, lon1, lat2, lon2) {
    var R = 6371;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  // ── Cross-module exports ──

  // upgradeTrust(db, userId, tier) — upgrade user's trust tier
  async function upgradeTrust(userId, tier) {
    await db.query(
      "UPDATE users SET trust_tier = GREATEST(COALESCE(trust_tier, 0), $1) WHERE id = $2",
      [tier, userId]
    );
  }

  // checkTrustGate(db, userId, requiredTier) — check if user meets minimum tier
  async function checkTrustGate(userId, requiredTier) {
    var r = await db.query("SELECT * FROM users WHERE id=$1", [userId]);
    if (!r.rows.length) return { ok: false, tier: 0, required: requiredTier };
    var tier = trust.resolveTier(r.rows[0], {});
    return { ok: tier >= requiredTier, tier, required: requiredTier };
  }

  // Expose for cross-module use
  app._trust = { upgradeTrust, checkTrustGate, trust };

};
