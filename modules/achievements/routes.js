/**
 * Achievements & Leaderboard module routes (L2)
 * Leaderboard scoring, badges, share tracking, admin tools.
 * Adapted from DT routes/leaderboard.js
 */
const { canAccessModule } = require('../../lib/module-access');

var crypto = require("crypto");
var engine = require("./lib/engine");

// ── recordActivity (exported for cross-module use) ──
async function recordActivity(db, userId, activityType, meta) {
  try {
    var now = new Date();
    var month = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    await db.query(
      "INSERT INTO leaderboard_scores (place_slug, track, entity_id, entity_type, score, month) " +
      "VALUES ($1, 'community', $2, 'member', 0, $3) " +
      "ON CONFLICT (place_slug, track, entity_id, month) DO NOTHING",
      [meta && meta.place_slug || "digitaltowns", String(userId), month]
    );
    return { ok: true };
  } catch (err) {
    console.error("[achievements] recordActivity error:", err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = function mountAchievements(app, db) {

  // ── Auth helpers ──
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
    var uid = await getUserId(req); if (!uid) { res.status(401).json({ error: "Login required" }); return null; } return uid;
  }
  async function requireAdmin(req, res) {
    var uid = await requireLogin(req, res); if (!uid) return null;
    var r = await db.query("SELECT id, is_admin FROM users WHERE id=$1", [uid]);
    if (!r.rows.length || !r.rows[0].is_admin) { res.status(403).json({ error: "Admin required" }); return null; }
    return r.rows[0];
  }

  // ── Feature flag enforcement ──
  async function checkFlag(req, flag) {
    var community = req.community || { slug: "digitaltowns", feature_flags: {} };
    var flags = community.feature_flags || {};
    var userTier = (req.user && req.user.trust_tier) || 0;
    return canAccessModule(flags, flag, userTier);
  }
  function denyIfDisabled(res) { res.status(404).json({ error: "Module not enabled" }); }

  // ── Resolve entity_id to human-readable display_name ──
  async function resolveEntityNames(rows) {
    if (!rows || rows.length === 0) return rows;

    var driverWorkerIds = [];
    var memberIds = [];
    var groupIds = [];
    rows.forEach(function(r) {
      if (r.entity_type === "driver" || r.entity_type === "worker") {
        if (driverWorkerIds.indexOf(r.entity_id) === -1) driverWorkerIds.push(r.entity_id);
      } else if (r.entity_type === "member") {
        if (memberIds.indexOf(r.entity_id) === -1) memberIds.push(r.entity_id);
      } else if (r.entity_type === "group") {
        if (groupIds.indexOf(r.entity_id) === -1) groupIds.push(r.entity_id);
      }
    });

    var nameMap = {};

    if (driverWorkerIds.length > 0) {
      try {
        var pResult = await db.query(
          "SELECT id::text AS eid, business_name FROM gig_providers WHERE id::text = ANY($1)",
          [driverWorkerIds]
        );
        pResult.rows.forEach(function(p) { nameMap[p.eid] = p.business_name; });
      } catch (err) { console.error("[achievements] resolve provider names:", err.message); }
    }

    if (memberIds.length > 0) {
      try {
        var uResult = await db.query(
          "SELECT id::text AS eid, display_name FROM users WHERE id::text = ANY($1)",
          [memberIds]
        );
        uResult.rows.forEach(function(u) { nameMap[u.eid] = u.display_name; });
      } catch (err) { console.error("[achievements] resolve user names:", err.message); }
    }

    if (groupIds.length > 0) {
      try {
        var gResult = await db.query(
          "SELECT id::text AS eid, name FROM groups WHERE id::text = ANY($1)",
          [groupIds]
        );
        gResult.rows.forEach(function(g) { nameMap[g.eid] = g.name; });
      } catch (err) { console.error("[achievements] resolve group names:", err.message); }
    }

    rows.forEach(function(r) {
      r.display_name = nameMap[r.entity_id] || r.entity_id;
    });

    return rows;
  }

  // ══════════════════════════════════════
  // Share tracking
  // ══════════════════════════════════════

  // ── POST /api/share ──
  app.post("/api/share", async function(req, res) {
    try {
      if (!(await checkFlag(req, "achievements.shares"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var b = req.body || {};
      if (!b.type || !b.id) return res.status(400).json({ error: "type and id required" });

      var validTypes = ["listing", "group", "provider", "review"];
      if (validTypes.indexOf(b.type) === -1) {
        return res.status(400).json({ error: "type must be one of: " + validTypes.join(", ") });
      }

      var utmToken = crypto.randomBytes(12).toString("base64url");
      await db.query(
        "INSERT INTO leaderboard_shares (user_id, share_type, share_ref_id, utm_token) VALUES ($1, $2, $3, $4)",
        [uid, b.type, String(b.id), utmToken]
      );

      var baseUrl = process.env.PUBLIC_BASE_URL || process.env.BASE_URL || "https://digitaltowns.app";
      var shareUrl = baseUrl + "/api/share/click/" + utmToken;

      res.json({ share_url: shareUrl, utm_token: utmToken });
    } catch (err) {
      console.error("[achievements] share create error:", err.message);
      res.status(500).json({ error: "Failed to create share link" });
    }
  });

  // ── GET /api/share/click/:token ──
  app.get("/api/share/click/:token", async function(req, res) {
    try {
      var result = await db.query(
        "UPDATE leaderboard_shares SET clicked = true, clicked_at = NOW() " +
        "WHERE utm_token = $1 AND clicked = false RETURNING share_type, share_ref_id",
        [req.params.token]
      );

      var row;
      if (result.rows.length > 0) {
        row = result.rows[0];
      } else {
        var lookup = await db.query(
          "SELECT share_type, share_ref_id FROM leaderboard_shares WHERE utm_token = $1",
          [req.params.token]
        );
        if (lookup.rows.length === 0) return res.redirect("/");
        row = lookup.rows[0];
      }

      var redirectUrl = "/";
      if (row.share_type === "listing") redirectUrl = "/listing/" + row.share_ref_id;
      else if (row.share_type === "group") redirectUrl = "/?group=" + row.share_ref_id;
      else if (row.share_type === "provider") redirectUrl = "/gigs/book?provider=" + row.share_ref_id;
      else if (row.share_type === "review") redirectUrl = "/gigs";

      res.redirect(redirectUrl);
    } catch (err) {
      console.error("[achievements] share click error:", err.message);
      res.redirect("/");
    }
  });

  // ══════════════════════════════════════
  // Leaderboard
  // ══════════════════════════════════════

  // ── GET /api/leaderboard/user/:userId/badges ──
  app.get("/api/leaderboard/user/:userId/badges", async function(req, res) {
    try {
      if (!(await checkFlag(req, "achievements.badges"))) return denyIfDisabled(res);
      var result = await db.query(
        "SELECT * FROM leaderboard_badges WHERE entity_id = $1 ORDER BY created_at DESC",
        [req.params.userId]
      );
      res.json({ badges: result.rows });
    } catch (err) {
      console.error("[achievements] badges error:", err.message);
      res.status(500).json({ error: "Failed to fetch badges" });
    }
  });

  // ── GET /api/leaderboard/user/:userId/score ──
  app.get("/api/leaderboard/user/:userId/score", async function(req, res) {
    try {
      if (!(await checkFlag(req, "achievements.leaderboard"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var now = new Date();
      var month = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");

      var result = await db.query(
        "SELECT score, rank, month FROM leaderboard_scores " +
        "WHERE entity_id = $1 AND track = 'community' AND month = $2 LIMIT 1",
        [req.params.userId, month]
      );

      var badges = await db.query(
        "SELECT * FROM leaderboard_badges WHERE entity_id = $1 ORDER BY created_at DESC",
        [req.params.userId]
      );

      var userR = await db.query("SELECT display_name FROM users WHERE id = $1", [req.params.userId]);
      var displayName = (userR.rows.length && userR.rows[0].display_name) || req.params.userId;

      if (result.rows.length === 0) {
        return res.json({ score: 0, rank: null, track: "community", month: month, badges: badges.rows, display_name: displayName });
      }

      var row = result.rows[0];
      res.json({ score: parseFloat(row.score), rank: row.rank, track: "community", month: month, badges: badges.rows, display_name: displayName });
    } catch (err) {
      console.error("[achievements] user score error:", err.message);
      res.status(500).json({ error: "Failed to fetch user score" });
    }
  });

  // ── GET /api/leaderboard/stats ── (admin)
  app.get("/api/leaderboard/stats", async function(req, res) {
    try {
      if (!(await checkFlag(req, "achievements.leaderboard"))) return denyIfDisabled(res);
      var admin = await requireAdmin(req, res); if (!admin) return;

      var now = new Date();
      var month = req.query.month || (now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0"));

      var scored = await db.query(
        "SELECT COUNT(*)::integer AS cnt FROM leaderboard_scores WHERE month = $1",
        [month]
      );
      var topScore = await db.query(
        "SELECT MAX(score)::decimal(5,2) AS top FROM leaderboard_scores WHERE month = $1",
        [month]
      );
      var shares = await db.query(
        "SELECT COUNT(*)::integer AS total, COUNT(*) FILTER (WHERE clicked = true)::integer AS clicked FROM leaderboard_shares"
      );

      res.json({
        entities_scored: scored.rows[0].cnt || 0,
        top_score: parseFloat(topScore.rows[0].top) || 0,
        total_shares: shares.rows[0].total || 0,
        clicked_shares: shares.rows[0].clicked || 0
      });
    } catch (err) {
      console.error("[achievements] stats error:", err.message);
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  // ── GET /api/leaderboard/shares ── (admin)
  app.get("/api/leaderboard/shares", async function(req, res) {
    try {
      if (!(await checkFlag(req, "achievements.shares"))) return denyIfDisabled(res);
      var admin = await requireAdmin(req, res); if (!admin) return;

      var result = await db.query(
        "SELECT ls.*, u.display_name AS user_name, u.email AS user_email " +
        "FROM leaderboard_shares ls " +
        "LEFT JOIN users u ON u.id = ls.user_id " +
        "ORDER BY ls.created_at DESC LIMIT 100"
      );

      res.json({ shares: result.rows });
    } catch (err) {
      console.error("[achievements] shares error:", err.message);
      res.status(500).json({ error: "Failed to fetch shares" });
    }
  });

  // ── GET /api/leaderboard/:place ── all four tracks
  app.get("/api/leaderboard/:place", async function(req, res) {
    try {
      if (!(await checkFlag(req, "achievements.leaderboard"))) return denyIfDisabled(res);

      var now = new Date();
      var month = req.query.month || (now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0"));

      var result = await db.query(
        "SELECT * FROM leaderboard_scores " +
        "WHERE place_slug = $1 AND month = $2 " +
        "ORDER BY track, rank ASC NULLS LAST, score DESC",
        [req.params.place, month]
      );

      var enriched = await resolveEntityNames(result.rows);
      var tracks = { bst_group: [], rides: [], gigs: [], community: [] };
      enriched.forEach(function(row) {
        if (tracks[row.track]) tracks[row.track].push(row);
      });

      res.json(tracks);
    } catch (err) {
      console.error("[achievements] leaderboard place error:", err.message);
      res.status(500).json({ error: "Failed to fetch leaderboard" });
    }
  });

  // ── GET /api/leaderboard/:place/:track ── single track
  app.get("/api/leaderboard/:place/:track", async function(req, res) {
    try {
      if (!(await checkFlag(req, "achievements.leaderboard"))) return denyIfDisabled(res);

      var validTracks = ["bst_group", "rides", "gigs", "community"];
      if (validTracks.indexOf(req.params.track) === -1) {
        return res.status(400).json({ error: "Invalid track" });
      }

      var now = new Date();
      var month = req.query.month || (now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0"));

      var result = await db.query(
        "SELECT * FROM leaderboard_scores " +
        "WHERE place_slug = $1 AND track = $2 AND month = $3 " +
        "ORDER BY rank ASC NULLS LAST, score DESC",
        [req.params.place, req.params.track, month]
      );

      var enriched = await resolveEntityNames(result.rows);
      res.json({ track: req.params.track, place: req.params.place, month: month, entries: enriched });
    } catch (err) {
      console.error("[achievements] leaderboard track error:", err.message);
      res.status(500).json({ error: "Failed to fetch leaderboard track" });
    }
  });

  // ══════════════════════════════════════
  // Admin endpoints
  // ══════════════════════════════════════

  // ── POST /api/admin/leaderboard/override ──
  app.post("/api/admin/leaderboard/override", async function(req, res) {
    try {
      if (!(await checkFlag(req, "achievements.leaderboard"))) return denyIfDisabled(res);
      var admin = await requireAdmin(req, res); if (!admin) return;

      var b = req.body || {};
      if (!b.place_slug || !b.track || !b.entity_id || !b.month || b.rank_override === undefined) {
        return res.status(400).json({ error: "place_slug, track, entity_id, month, rank_override required" });
      }

      await db.query(
        "UPDATE leaderboard_scores SET rank = $1, updated_at = NOW() " +
        "WHERE place_slug = $2 AND track = $3 AND entity_id = $4 AND month = $5",
        [b.rank_override, b.place_slug, b.track, b.entity_id, b.month]
      );

      console.log("[achievements] RANK_OVERRIDE", { admin: admin.id, place_slug: b.place_slug, track: b.track, entity_id: b.entity_id, rank: b.rank_override });
      res.json({ success: true });
    } catch (err) {
      console.error("[achievements] override error:", err.message);
      res.status(500).json({ error: "Override failed" });
    }
  });

  // ── POST /api/admin/leaderboard/award-badge ──
  app.post("/api/admin/leaderboard/award-badge", async function(req, res) {
    try {
      if (!(await checkFlag(req, "achievements.badges"))) return denyIfDisabled(res);
      var admin = await requireAdmin(req, res); if (!admin) return;

      var b = req.body || {};
      if (!b.entity_id || !b.entity_type || !b.badge_type || !b.place_slug) {
        return res.status(400).json({ error: "entity_id, entity_type, badge_type, place_slug required" });
      }

      var now = new Date();
      var month = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");

      await db.query(
        "INSERT INTO leaderboard_badges (entity_id, entity_type, badge_type, place_slug, awarded_month) " +
        "VALUES ($1, $2, $3, $4, $5)",
        [b.entity_id, b.entity_type, b.badge_type, b.place_slug, month]
      );

      console.log("[achievements] BADGE_AWARDED", { admin: admin.id, entity_id: b.entity_id, badge_type: b.badge_type, place_slug: b.place_slug });
      res.json({ success: true });
    } catch (err) {
      console.error("[achievements] award badge error:", err.message);
      res.status(500).json({ error: "Award badge failed" });
    }
  });

  // ── POST /api/admin/leaderboard/recalculate ──
  app.post("/api/admin/leaderboard/recalculate", async function(req, res) {
    try {
      if (!(await checkFlag(req, "achievements.nightly-cron"))) return denyIfDisabled(res);
      var admin = await requireAdmin(req, res); if (!admin) return;

      var now = new Date();
      var placeSlug = (req.body || {}).place_slug || "digitaltowns";
      var month = (req.body || {}).month || (now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0"));

      var startTime = Date.now();
      var result = await engine.calculateForPlace(db, placeSlug, month);
      var duration = Date.now() - startTime;

      res.json({ success: true, place_slug: placeSlug, month: month, scored: result, duration_ms: duration });
    } catch (err) {
      console.error("[achievements] recalculate error:", err.message);
      res.status(500).json({ error: "Recalculation failed" });
    }
  });

  console.log("[achievements] L2 module mounted — leaderboard, badges, shares, scoring engine");
};

// Export helper for cross-module use
module.exports.recordActivity = recordActivity;
