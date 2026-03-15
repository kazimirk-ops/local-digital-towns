/**
 * Moderation module routes (L4)
 * Content reports, moderation queue, word filters, audit log, appeals.
 * Extracted from Sebastian server.js moderation patterns.
 */

// ── Cross-module export: checkWordFilter(db, text) ──
async function checkWordFilter(db, text) {
  if (!text) return { flagged: false, matches: [] };
  var filters = await db.query("SELECT word, severity FROM word_filters WHERE active=true");
  var lower = text.toLowerCase();
  var matches = [];
  for (var f of filters.rows) {
    if (lower.includes(f.word)) {
      matches.push({ word: f.word, severity: f.severity });
    }
  }
  return {
    flagged: matches.length > 0,
    blocked: matches.some(function(m) { return m.severity === "block"; }),
    matches: matches
  };
}

const { canAccessModule } = require('../../lib/module-access');

module.exports = function mountModeration(app, db) {

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

  // ── Feature flag enforcement ──
  async function checkFlag(req, flag) {
    var community = req.community || { slug: "digitaltowns", feature_flags: {} };
    var flags = community.feature_flags || {};
    var userTier = (req.user && req.user.trust_tier) || 0;
    return canAccessModule(flags, flag, userTier);
  }
  function denyIfDisabled(res) { res.status(404).json({ error: "Module not enabled" }); }

  // ── POST /api/reports — submit a content report ──
  app.post("/api/reports", async function(req, res) {
    var uid = await requireLogin(req, res); if (!uid) return;
    try {
      var b = req.body || {};
      if (!b.target_type || !b.target_id) return res.status(400).json({ error: "target_type and target_id required" });
      if (!b.reason) return res.status(400).json({ error: "reason required" });

      // Validate target_type
      var validTypes = ["listing", "message", "user", "channel_message", "dm", "review", "event", "gig"];
      if (!validTypes.includes(b.target_type)) return res.status(400).json({ error: "Invalid target_type" });

      // Check for duplicate report
      var existing = await db.query(
        "SELECT id FROM content_reports WHERE reporter_user_id=$1 AND target_type=$2 AND target_id=$3 AND status='pending'",
        [uid, b.target_type, parseInt(b.target_id, 10)]
      );
      if (existing.rows.length) return res.status(400).json({ error: "You already reported this item" });

      var result = await db.query(
        "INSERT INTO content_reports (place_id, reporter_user_id, target_type, target_id, target_user_id, reason, details, status, created_at) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',NOW()) RETURNING *",
        [
          b.place_id ? parseInt(b.place_id, 10) : null,
          uid,
          b.target_type,
          parseInt(b.target_id, 10),
          b.target_user_id ? parseInt(b.target_user_id, 10) : null,
          b.reason,
          b.details || ""
        ]
      );

      res.status(201).json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/reports — user's own submitted reports ──
  app.get("/api/reports", async function(req, res) {
    var uid = await requireLogin(req, res); if (!uid) return;
    try {
      var result = await db.query(
        "SELECT * FROM content_reports WHERE reporter_user_id=$1 ORDER BY created_at DESC", [uid]
      );
      res.json({ reports: result.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/admin/reports — moderation queue (admin) ──
  app.get("/api/admin/reports", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var status = req.query.status || "pending";
      var result = await db.query(
        "SELECT cr.*, reporter.display_name AS reporter_name, target_u.display_name AS target_user_name " +
        "FROM content_reports cr " +
        "LEFT JOIN users reporter ON reporter.id = cr.reporter_user_id " +
        "LEFT JOIN users target_u ON target_u.id = cr.target_user_id " +
        "WHERE cr.status=$1 ORDER BY cr.created_at ASC LIMIT 200",
        [status]
      );
      res.json({ reports: result.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/admin/reports/stats — report statistics ──
  app.get("/api/admin/reports/stats", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var stats = await db.query(
        "SELECT status, COUNT(*)::integer AS count FROM content_reports GROUP BY status"
      );
      var byType = await db.query(
        "SELECT target_type, COUNT(*)::integer AS count FROM content_reports WHERE status='pending' GROUP BY target_type"
      );
      res.json({ by_status: stats.rows, by_type: byType.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/admin/reports/:id/resolve — resolve a report ──
  app.post("/api/admin/reports/:id/resolve", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var b = req.body || {};
      await db.query(
        "UPDATE content_reports SET status='resolved', reviewed_by=$1, reviewed_at=NOW(), resolution=$2 WHERE id=$3",
        [admin.id, b.resolution || "Resolved", req.params.id]
      );

      // Log moderation action
      await db.query(
        "INSERT INTO moderation_log (admin_user_id, action, target_type, target_id, reason, created_at) VALUES ($1,$2,$3,$4,$5,NOW())",
        [admin.id, "resolve_report", "content_report", parseInt(req.params.id, 10), b.resolution || "Resolved"]
      );

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/admin/reports/:id/dismiss — dismiss a report ──
  app.post("/api/admin/reports/:id/dismiss", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      await db.query(
        "UPDATE content_reports SET status='dismissed', reviewed_by=$1, reviewed_at=NOW(), resolution=$2 WHERE id=$3",
        [admin.id, (req.body || {}).reason || "Dismissed", req.params.id]
      );

      await db.query(
        "INSERT INTO moderation_log (admin_user_id, action, target_type, target_id, reason, created_at) VALUES ($1,$2,$3,$4,$5,NOW())",
        [admin.id, "dismiss_report", "content_report", parseInt(req.params.id, 10), (req.body || {}).reason || "Dismissed"]
      );

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Word Filters ──

  // GET /api/admin/word-filters — list all word filters
  app.get("/api/admin/word-filters", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var result = await db.query("SELECT * FROM word_filters ORDER BY word");
      res.json({ filters: result.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/word-filters — add a word filter
  app.post("/api/admin/word-filters", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var b = req.body || {};
      var word = (b.word || "").toString().trim().toLowerCase();
      if (!word) return res.status(400).json({ error: "word required" });
      var severity = b.severity || "flag"; // flag, block, shadow

      var result = await db.query(
        "INSERT INTO word_filters (word, severity, active, created_by, created_at) VALUES ($1,$2,true,$3,NOW()) ON CONFLICT (word) DO UPDATE SET severity=$2, active=true RETURNING *",
        [word, severity, admin.id]
      );

      await db.query(
        "INSERT INTO moderation_log (admin_user_id, action, target_type, target_id, reason, created_at) VALUES ($1,$2,$3,$4,$5,NOW())",
        [admin.id, "add_word_filter", "word_filter", result.rows[0].id, "Added: " + word + " (" + severity + ")"]
      );

      res.status(201).json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/admin/word-filters/:id — remove a word filter
  app.delete("/api/admin/word-filters/:id", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      await db.query("UPDATE word_filters SET active=false WHERE id=$1", [req.params.id]);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Moderation Audit Log ──

  // GET /api/admin/moderation-log
  app.get("/api/admin/moderation-log", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var result = await db.query(
        "SELECT ml.*, u.display_name AS admin_name " +
        "FROM moderation_log ml LEFT JOIN users u ON u.id = ml.admin_user_id " +
        "ORDER BY ml.created_at DESC LIMIT 200"
      );
      res.json({ log: result.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Appeals ──

  // POST /api/reports/:id/appeal — user can appeal a resolved report
  app.post("/api/reports/:id/appeal", async function(req, res) {
    var uid = await requireLogin(req, res); if (!uid) return;
    try {
      var report = await db.query(
        "SELECT * FROM content_reports WHERE id=$1 AND target_user_id=$2 AND status='resolved'",
        [req.params.id, uid]
      );
      if (!report.rows.length) return res.status(404).json({ error: "No resolved report found against you" });

      var b = req.body || {};
      if (!b.reason) return res.status(400).json({ error: "reason required" });

      await db.query(
        "UPDATE content_reports SET status='appealed', resolution=$1 WHERE id=$2",
        ["APPEAL: " + b.reason, req.params.id]
      );

      await db.query(
        "INSERT INTO moderation_log (admin_user_id, action, target_type, target_id, reason, created_at) VALUES ($1,$2,$3,$4,$5,NOW())",
        [uid, "appeal", "content_report", parseInt(req.params.id, 10), b.reason]
      );

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Expose for cross-module use (backward compat wrapper)
  app._moderation = { checkWordFilter: function(text) { return checkWordFilter(db, text); } };

};

module.exports.checkWordFilter = checkWordFilter;
