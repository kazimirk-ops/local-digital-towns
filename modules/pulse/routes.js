/**
 * Pulse module routes
 * Daily digest, activity feed, Facebook export.
 * Extracted from Sebastian pulse handlers + DT pulse_posts.
 */

const { canAccessModule } = require('../../lib/module-access');

module.exports = function mountPulse(app, db) {

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
  function denyIfDisabled(res) { res.status(404).json({ error: "Not found" }); }

  async function resolvePlaceId(slug) {
    if (!slug) return null;
    var r = await db.query("SELECT id FROM places WHERE slug=$1", [slug]);
    return r.rows.length ? r.rows[0].id : null;
  }

  function dayKeyFromDate(d) {
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  // ── GET /api/pulse ─────────────────────────────────────────
  // Returns latest daily_pulse for place. Extracted from Sebastian GET /api/pulse/latest
  app.get("/api/pulse", async function(req, res) {
    try {
      var placeId = await resolvePlaceId(req.query.place_slug);
      var conditions = ["status = 'published'"];
      var params = [];
      if (placeId) {
        conditions.push("place_id = $1");
        params.push(placeId);
      }
      var where = "WHERE " + conditions.join(" AND ");
      var result = await db.query(
        "SELECT * FROM daily_pulses " + where + " ORDER BY day_key DESC LIMIT 1",
        params
      );
      res.json(result.rows[0] || null);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/pulse/posts ───────────────────────────────────
  // Returns recent pulse_posts. Extracted from DT GET /api/pulse.
  app.get("/api/pulse/posts", async function(req, res) {
    try {
      var conditions = [];
      var params = [];
      var idx = 1;
      if (req.query.place_slug) {
        conditions.push("pp.place_id = (SELECT id FROM places WHERE slug=$" + idx++ + ")");
        params.push(req.query.place_slug);
      }
      if (req.query.type) {
        conditions.push("pp.type = $" + idx++);
        params.push(req.query.type);
      }
      var where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
      var result = await db.query(
        "SELECT pp.*, u.display_name AS author_name, u.avatar_url AS author_avatar " +
        "FROM pulse_posts pp LEFT JOIN users u ON u.id = pp.author_id " +
        where + " ORDER BY pp.pinned DESC, pp.created_at DESC LIMIT 20",
        params
      );
      res.json({ posts: result.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/pulse/posts ──────────────────────────────────
  // Create pulse post. Extracted from DT POST /api/pulse.
  app.post("/api/pulse/posts", async function(req, res) {
    var uid = await requireLogin(req, res); if (!uid) return;
    try {
      var b = req.body || {};
      var placeId = b.place_id || (await resolvePlaceId(b.place_slug));
      var result = await db.query(
        "INSERT INTO pulse_posts (place_id, author_id, type, title, body, data) " +
        "VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
        [placeId, uid, b.type || "community", b.title || "", b.body || "", JSON.stringify(b.data || {})]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/admin/pulse ───────────────────────────────────
  // Returns recent pulses. Extracted from Sebastian GET /api/admin/pulse
  app.get("/api/admin/pulse", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var placeId = await resolvePlaceId(req.query.place_slug);
      var conditions = [];
      var params = [];
      if (placeId) {
        conditions.push("place_id = $1");
        params.push(placeId);
      }
      var where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
      var result = await db.query(
        "SELECT * FROM daily_pulses " + where + " ORDER BY day_key DESC LIMIT 30",
        params
      );
      res.json({ pulses: result.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/admin/pulse/generate ─────────────────────────
  // Adapted from Sebastian generateDailyPulse():
  // Aggregates metrics from available tables into a daily pulse.
  app.post("/api/admin/pulse/generate", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var b = req.body || {};
      var placeId = b.place_id || (await resolvePlaceId(b.place_slug));
      var dayKey = (b.day_key || "").toString().trim() || dayKeyFromDate(new Date(Date.now() - 24 * 60 * 60 * 1000));

      var metrics = {};
      var highlights = {};

      // Aggregate available metrics (try/catch each for graceful degradation)
      try {
        var u = await db.query("SELECT COUNT(*)::integer AS c FROM users WHERE created_at >= $1::date AND created_at < ($1::date + INTERVAL '1 day')", [dayKey]);
        metrics.newUsers = u.rows[0].c;
      } catch (e) { metrics.newUsers = 0; }

      try {
        var biz = await db.query("SELECT COUNT(*)::integer AS c FROM businesses WHERE created_at >= $1::date AND created_at < ($1::date + INTERVAL '1 day')", [dayKey]);
        metrics.newBusinesses = biz.rows[0].c;
      } catch (e) { metrics.newBusinesses = 0; }

      try {
        var ch = await db.query("SELECT COUNT(*)::integer AS c FROM channel_messages WHERE created_at >= $1::date AND created_at < ($1::date + INTERVAL '1 day')", [dayKey]);
        metrics.channelMessages = ch.rows[0].c;
      } catch (e) { metrics.channelMessages = 0; }

      try {
        var gig = await db.query("SELECT COUNT(*)::integer AS c FROM gig_bookings WHERE created_at >= $1::date AND created_at < ($1::date + INTERVAL '1 day')", [dayKey]);
        metrics.gigBookings = gig.rows[0].c;
      } catch (e) { metrics.gigBookings = 0; }

      try {
        var members = await db.query("SELECT COUNT(*)::integer AS c FROM place_memberships WHERE joined_at >= $1::date AND joined_at < ($1::date + INTERVAL '1 day')", [dayKey]);
        metrics.newMembers = members.rows[0].c;
      } catch (e) { metrics.newMembers = 0; }

      try {
        var posts = await db.query("SELECT COUNT(*)::integer AS c FROM pulse_posts WHERE created_at >= $1::date AND created_at < ($1::date + INTERVAL '1 day')", [dayKey]);
        metrics.pulsePosts = posts.rows[0].c;
      } catch (e) { metrics.pulsePosts = 0; }

      // Build markdown body (adapted from Sebastian generateDailyPulse markdown builder)
      var md = "# Daily Pulse — " + dayKey + "\n\n";
      md += "- New users: " + metrics.newUsers + "\n";
      md += "- New businesses: " + metrics.newBusinesses + "\n";
      md += "- Channel messages: " + metrics.channelMessages + "\n";
      md += "- Gig bookings: " + metrics.gigBookings + "\n";
      md += "- New members: " + metrics.newMembers + "\n";
      md += "- Pulse posts: " + metrics.pulsePosts + "\n";

      // Upsert (from Sebastian upsertDailyPulse pattern)
      var result = await db.query(
        "INSERT INTO daily_pulses (place_id, day_key, status, metrics_json, highlights_json, markdown_body, created_at) " +
        "VALUES ($1,$2,'published',$3,$4,$5,NOW()) " +
        "ON CONFLICT (place_id, day_key) DO UPDATE SET " +
        "metrics_json=$3, highlights_json=$4, markdown_body=$5, created_at=NOW() " +
        "RETURNING *",
        [placeId, dayKey, JSON.stringify(metrics), JSON.stringify(highlights), md]
      );
      res.json(result.rows[0]);
    } catch (err) {
      console.error("PULSE_GENERATE_ERROR", err.message);
      res.status(500).json({ error: "Internal error" });
    }
  });

  // ── POST /api/admin/pulse/export ───────────────────────────
  // Track Facebook export. Extracted from Sebastian POST /api/admin/pulse/export
  app.post("/api/admin/pulse/export", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var b = req.body || {};
      var placeId = b.place_id || (await resolvePlaceId(b.place_slug));
      await db.query(
        "INSERT INTO pulse_exports (place_id, export_type, exported_by, post_text, pulse_data, created_at) " +
        "VALUES ($1,$2,$3,$4,$5,NOW())",
        [placeId, b.export_type || "facebook", admin.id,
         b.post_text || "", JSON.stringify(b.pulse_data || {})]
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/admin/pulse/exports ───────────────────────────
  // Extracted from Sebastian GET /api/admin/pulse/history
  app.get("/api/admin/pulse/exports", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var limit = parseInt(req.query.limit, 10) || 20;
      var result = await db.query(
        "SELECT pe.*, u.display_name AS exported_by_name " +
        "FROM pulse_exports pe LEFT JOIN users u ON u.id = pe.exported_by " +
        "ORDER BY pe.created_at DESC LIMIT $1",
        [limit]
      );
      res.json({ exports: result.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

};
