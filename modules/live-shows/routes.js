/**
 * Live Shows module routes (L2)
 * Live rooms, CloudFlare Calls, chat, schedule, bookmarks.
 * Extracted from Sebastian server.js live endpoints.
 */

module.exports = function mountLiveShows(app, db) {

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
    var flags = (req.community && req.community.feature_flags) || {};
    if (flags[flag] !== undefined) return !!flags[flag];
    return true;
  }
  function denyIfDisabled(res) { res.status(404).json({ error: "Module not enabled" }); }

  // ── CloudFlare Calls helper (from Sebastian) ──
  var CF_CALLS_APP_ID = process.env.CF_CALLS_APP_ID || "";
  var CF_CALLS_APP_SECRET = process.env.CF_CALLS_APP_SECRET || "";
  var CF_CALLS_BASE_URL = (process.env.CF_CALLS_BASE_URL || "https://rtc.live.cloudflare.com/v1").replace(/\/$/, "");

  async function createCallsRoom() {
    if (!CF_CALLS_APP_ID || !CF_CALLS_APP_SECRET) {
      return { id: "mock-" + Date.now(), token: "mock-token", mock: true };
    }
    try {
      var response = await fetch(CF_CALLS_BASE_URL + "/apps/" + CF_CALLS_APP_ID + "/sessions/new", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + CF_CALLS_APP_SECRET,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ })
      });
      if (!response.ok) throw new Error("CF API error: " + response.status);
      var data = await response.json();
      return { id: data.sessionId || data.id, token: data.sessionId || data.token, mock: false };
    } catch (err) {
      console.error("[live-shows] CF Calls error:", err.message);
      return { id: "mock-" + Date.now(), token: "mock-token", mock: true, error: err.message };
    }
  }

  // ══════════════════════════════════════
  // Live Rooms — from Sebastian
  // ══════════════════════════════════════

  // ── GET /api/live-rooms ──
  app.get("/api/live-rooms", async function(req, res) {
    try {
      if (!(await checkFlag(req, "live-shows"))) return denyIfDisabled(res);
      var status = req.query.status || "live";
      var r = await db.query(
        "SELECT lr.*, u.display_name AS host_name, u.avatar_url AS host_avatar, " +
        "p.name AS place_name " +
        "FROM live_rooms lr " +
        "LEFT JOIN users u ON u.id = lr.host_user_id " +
        "LEFT JOIN places p ON p.id = lr.host_place_id " +
        "WHERE lr.status = $1 ORDER BY lr.started_at DESC NULLS LAST",
        [status]
      );
      res.json({ rooms: r.rows });
    } catch (err) { res.status(500).json({ error: "Failed" }); }
  });

  // ── GET /api/live-rooms/:id ──
  app.get("/api/live-rooms/:id", async function(req, res) {
    try {
      var r = await db.query(
        "SELECT lr.*, u.display_name AS host_name, u.avatar_url AS host_avatar, " +
        "p.name AS place_name, " +
        "l.title AS pinned_listing_title, l.price_cents AS pinned_listing_price, l.photos AS pinned_listing_photos " +
        "FROM live_rooms lr " +
        "LEFT JOIN users u ON u.id = lr.host_user_id " +
        "LEFT JOIN places p ON p.id = lr.host_place_id " +
        "LEFT JOIN listings l ON l.id = lr.pinned_listing_id " +
        "WHERE lr.id = $1",
        [req.params.id]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Not found" });
      var room = r.rows[0];
      room.cf_configured = !!(CF_CALLS_APP_ID && CF_CALLS_APP_SECRET);
      res.json(room);
    } catch (err) { res.status(500).json({ error: "Failed" }); }
  });

  // ── POST /api/live-rooms (create) ──
  app.post("/api/live-rooms", async function(req, res) {
    try {
      if (!(await checkFlag(req, "live-shows"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var b = req.body || {};
      var cfRoom = await createCallsRoom();

      var r = await db.query(
        "INSERT INTO live_rooms (title, description, host_user_id, host_place_id, host_type, cf_room_id, cf_room_token) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [b.title || "Live Room", b.description || null, uid,
         b.place_id || null, b.host_type || "individual",
         cfRoom.id, cfRoom.token]
      );

      res.status(201).json({ room: r.rows[0], cf_room_id: cfRoom.id, mock: cfRoom.mock });
    } catch (err) {
      console.error("live room create error:", err.message);
      res.status(500).json({ error: "Failed to create room" });
    }
  });

  // ── PUT /api/live-rooms/:id/start ──
  app.put("/api/live-rooms/:id/start", async function(req, res) {
    try {
      var uid = await requireLogin(req, res); if (!uid) return;
      var room = await db.query("SELECT host_user_id FROM live_rooms WHERE id=$1", [req.params.id]);
      if (!room.rows.length) return res.status(404).json({ error: "Not found" });
      if (room.rows[0].host_user_id !== uid) return res.status(403).json({ error: "Not your room" });

      await db.query("UPDATE live_rooms SET status='live', started_at=NOW() WHERE id=$1", [req.params.id]);
      res.json({ ok: true, status: "live" });
    } catch (err) { res.status(500).json({ error: "Failed" }); }
  });

  // ── PUT /api/live-rooms/:id/end ──
  app.put("/api/live-rooms/:id/end", async function(req, res) {
    try {
      var uid = await requireLogin(req, res); if (!uid) return;
      var room = await db.query("SELECT host_user_id FROM live_rooms WHERE id=$1", [req.params.id]);
      if (!room.rows.length) return res.status(404).json({ error: "Not found" });
      if (room.rows[0].host_user_id !== uid) {
        var adminR = await db.query("SELECT is_admin FROM users WHERE id=$1", [uid]);
        if (!adminR.rows.length || !adminR.rows[0].is_admin) return res.status(403).json({ error: "Forbidden" });
      }

      await db.query("UPDATE live_rooms SET status='ended', ended_at=NOW() WHERE id=$1", [req.params.id]);
      res.json({ ok: true, status: "ended" });
    } catch (err) { res.status(500).json({ error: "Failed" }); }
  });

  // ── DELETE /api/live-rooms/:id ──
  app.delete("/api/live-rooms/:id", async function(req, res) {
    try {
      var admin = await requireAdmin(req, res); if (!admin) return;
      await db.query("DELETE FROM live_chat_messages WHERE room_id=$1", [req.params.id]);
      await db.query("DELETE FROM live_rooms WHERE id=$1", [req.params.id]);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: "Failed" }); }
  });

  // ── POST /api/live-rooms/:id/token ──
  app.post("/api/live-rooms/:id/token", async function(req, res) {
    try {
      if (!(await checkFlag(req, "live-shows.video"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var room = await db.query("SELECT cf_room_id, cf_room_token FROM live_rooms WHERE id=$1", [req.params.id]);
      if (!room.rows.length) return res.status(404).json({ error: "Not found" });

      res.json({
        token: room.rows[0].cf_room_token,
        app_id: CF_CALLS_APP_ID || "mock",
        room_id: room.rows[0].cf_room_id
      });
    } catch (err) { res.status(500).json({ error: "Failed" }); }
  });

  // ── POST /api/live-rooms/:id/pin-listing ──
  app.post("/api/live-rooms/:id/pin-listing", async function(req, res) {
    try {
      if (!(await checkFlag(req, "live-shows.in-stream-buy"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var room = await db.query("SELECT host_user_id FROM live_rooms WHERE id=$1", [req.params.id]);
      if (!room.rows.length) return res.status(404).json({ error: "Not found" });
      if (room.rows[0].host_user_id !== uid) return res.status(403).json({ error: "Not your room" });

      var listingId = (req.body || {}).listing_id || null;
      await db.query("UPDATE live_rooms SET pinned_listing_id=$1 WHERE id=$2", [listingId, req.params.id]);
      res.json({ ok: true, pinned_listing_id: listingId });
    } catch (err) { res.status(500).json({ error: "Failed" }); }
  });

  // ══════════════════════════════════════
  // Chat
  // ══════════════════════════════════════

  // ── GET /api/live-rooms/:id/chat ──
  app.get("/api/live-rooms/:id/chat", async function(req, res) {
    try {
      if (!(await checkFlag(req, "live-shows.chat"))) return denyIfDisabled(res);
      var r = await db.query(
        "SELECT m.*, u.display_name, u.avatar_url FROM live_chat_messages m " +
        "LEFT JOIN users u ON u.id = m.user_id " +
        "WHERE m.room_id = $1 ORDER BY m.created_at DESC LIMIT 100",
        [req.params.id]
      );
      res.json({ messages: r.rows.reverse() });
    } catch (err) { res.status(500).json({ error: "Failed" }); }
  });

  // ── POST /api/live-rooms/:id/chat ──
  app.post("/api/live-rooms/:id/chat", async function(req, res) {
    try {
      if (!(await checkFlag(req, "live-shows.chat"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var message = ((req.body || {}).message || "").trim();
      if (!message) return res.status(400).json({ error: "Message required" });

      var r = await db.query(
        "INSERT INTO live_chat_messages (room_id, user_id, message) VALUES ($1,$2,$3) RETURNING *",
        [req.params.id, uid, message]
      );
      res.status(201).json(r.rows[0]);
    } catch (err) { res.status(500).json({ error: "Failed" }); }
  });

  // ══════════════════════════════════════
  // Schedule — from Sebastian
  // ══════════════════════════════════════

  // ── GET /api/live-schedule ──
  app.get("/api/live-schedule", async function(req, res) {
    try {
      if (!(await checkFlag(req, "live-shows.schedule"))) return denyIfDisabled(res);
      var days = parseInt(req.query.days) || 7;
      var uid = await getUserId(req);

      var r = await db.query(
        "SELECT ls.*, u.display_name AS host_name, u.avatar_url AS host_avatar, p.name AS place_name " +
        "FROM live_show_schedule ls " +
        "LEFT JOIN users u ON u.id = ls.host_user_id " +
        "LEFT JOIN places p ON p.id = ls.host_place_id " +
        "WHERE ls.start_at > NOW() AND ls.start_at < NOW() + ($1 || ' days')::interval " +
        "AND ls.status = 'scheduled' ORDER BY ls.start_at ASC",
        [days]
      );

      var shows = r.rows;
      if (uid) {
        for (var i = 0; i < shows.length; i++) {
          var bm = await db.query("SELECT id FROM live_show_bookmarks WHERE user_id=$1 AND show_id=$2", [uid, shows[i].id]);
          shows[i].bookmarked = bm.rows.length > 0;
        }
      }

      res.json({ schedule: shows });
    } catch (err) { res.status(500).json({ error: "Failed" }); }
  });

  // ── POST /api/live-schedule ──
  app.post("/api/live-schedule", async function(req, res) {
    try {
      if (!(await checkFlag(req, "live-shows.schedule"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var b = req.body || {};
      if (!b.title || !b.start_at) return res.status(400).json({ error: "title and start_at required" });

      var r = await db.query(
        "INSERT INTO live_show_schedule (title, description, start_at, end_at, host_user_id, host_type, host_place_id, thumbnail_url) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
        [b.title, b.description || null, b.start_at, b.end_at || null,
         uid, b.host_type || "individual", b.place_id || null, b.thumbnail_url || null]
      );
      res.status(201).json(r.rows[0]);
    } catch (err) { res.status(500).json({ error: "Failed" }); }
  });

  // ── PUT /api/live-schedule/:id ──
  app.put("/api/live-schedule/:id", async function(req, res) {
    try {
      var uid = await requireLogin(req, res); if (!uid) return;
      var existing = await db.query("SELECT host_user_id FROM live_show_schedule WHERE id=$1", [req.params.id]);
      if (!existing.rows.length) return res.status(404).json({ error: "Not found" });
      if (existing.rows[0].host_user_id !== uid) return res.status(403).json({ error: "Forbidden" });

      var b = req.body || {};
      var r = await db.query(
        "UPDATE live_show_schedule SET title=COALESCE($1,title), description=COALESCE($2,description), " +
        "start_at=COALESCE($3,start_at), end_at=COALESCE($4,end_at), thumbnail_url=COALESCE($5,thumbnail_url), " +
        "updated_at=NOW() WHERE id=$6 RETURNING *",
        [b.title, b.description, b.start_at, b.end_at, b.thumbnail_url, req.params.id]
      );
      res.json(r.rows[0]);
    } catch (err) { res.status(500).json({ error: "Failed" }); }
  });

  // ── DELETE /api/live-schedule/:id ──
  app.delete("/api/live-schedule/:id", async function(req, res) {
    try {
      var uid = await requireLogin(req, res); if (!uid) return;
      var existing = await db.query("SELECT host_user_id FROM live_show_schedule WHERE id=$1", [req.params.id]);
      if (!existing.rows.length) return res.status(404).json({ error: "Not found" });
      if (existing.rows[0].host_user_id !== uid) {
        var adminR = await db.query("SELECT is_admin FROM users WHERE id=$1", [uid]);
        if (!adminR.rows.length || !adminR.rows[0].is_admin) return res.status(403).json({ error: "Forbidden" });
      }
      await db.query("DELETE FROM live_show_bookmarks WHERE show_id=$1", [req.params.id]);
      await db.query("DELETE FROM live_show_schedule WHERE id=$1", [req.params.id]);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: "Failed" }); }
  });

  // ══════════════════════════════════════
  // Bookmarks
  // ══════════════════════════════════════

  // ── POST /api/live-schedule/:id/bookmark ──
  app.post("/api/live-schedule/:id/bookmark", async function(req, res) {
    try {
      if (!(await checkFlag(req, "live-shows.bookmarks"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;
      await db.query(
        "INSERT INTO live_show_bookmarks (user_id, show_id) VALUES ($1,$2) ON CONFLICT (user_id, show_id) DO NOTHING",
        [uid, req.params.id]
      );
      res.json({ ok: true, bookmarked: true });
    } catch (err) { res.status(500).json({ error: "Failed" }); }
  });

  // ── DELETE /api/live-schedule/:id/bookmark ──
  app.delete("/api/live-schedule/:id/bookmark", async function(req, res) {
    try {
      var uid = await requireLogin(req, res); if (!uid) return;
      await db.query("DELETE FROM live_show_bookmarks WHERE user_id=$1 AND show_id=$2", [uid, req.params.id]);
      res.json({ ok: true, bookmarked: false });
    } catch (err) { res.status(500).json({ error: "Failed" }); }
  });

  console.log("[live-shows] L2 module mounted — rooms, CF Calls, chat, schedule, bookmarks");
};
