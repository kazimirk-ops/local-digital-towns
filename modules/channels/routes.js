/**
 * Channels module routes
 * Discussion channels, threaded messages, DMs, muting, channel requests.
 * Extracted from Sebastian server.js channel handlers + data.js functions.
 */

module.exports = function mountChannels(app, db) {

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

  // ── GET /api/channels ─────────────────────────────────────
  // Extracted from Sebastian GET /channels
  app.get("/api/channels", async function(req, res) {
    try {
      var uid = await getUserId(req);
      var conditions = [];
      var params = [];
      var idx = 1;
      if (req.query.place_slug) {
        conditions.push("c.place_id = (SELECT id FROM places WHERE slug=$" + idx++ + ")");
        params.push(req.query.place_slug);
      }
      if (!uid) {
        conditions.push("c.is_public = true");
      }
      var where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
      var result = await db.query(
        "SELECT c.*, " +
        "(SELECT COUNT(*)::integer FROM channel_messages WHERE channel_id=c.id) AS message_count " +
        "FROM channels c " + where + " ORDER BY c.name",
        params
      );
      res.json({ channels: result.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/channels/:id ─────────────────────────────────
  app.get("/api/channels/:id", async function(req, res) {
    try {
      var r = await db.query("SELECT * FROM channels WHERE id=$1", [req.params.id]);
      if (!r.rows.length) return res.status(404).json({ error: "Channel not found" });
      res.json(r.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/channels (admin/mod only) ────────────────────
  // Extracted from Sebastian POST /api/admin/channels
  app.post("/api/channels", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var b = req.body || {};
      if (!b.name) return res.status(400).json({ error: "name required" });
      var result = await db.query(
        "INSERT INTO channels (place_id, name, description, is_public, created_by, created_at) " +
        "VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING *",
        [b.place_id || null, b.name, b.description || "", b.is_public !== false, admin.id]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── DELETE /api/channels/:id (admin only) ──────────────────
  // Extracted from Sebastian DELETE /api/admin/channels/:id — cascading delete
  app.delete("/api/channels/:id", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var cid = req.params.id;
      await db.query("DELETE FROM channel_messages WHERE channel_id=$1", [cid]);
      await db.query("DELETE FROM channel_mutes WHERE channel_id=$1", [cid]);
      await db.query("DELETE FROM channel_memberships WHERE channel_id=$1", [cid]);
      await db.query("DELETE FROM channels WHERE id=$1", [cid]);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/channels/:id/messages ─────────────────────────
  // Extracted from Sebastian GET /channels/:id/messages
  app.get("/api/channels/:id/messages", async function(req, res) {
    try {
      var channel = await db.query("SELECT id FROM channels WHERE id=$1", [req.params.id]);
      if (!channel.rows.length) return res.status(404).json({ error: "Channel not found" });

      var conditions = ["m.channel_id = $1"];
      var params = [req.params.id];
      if (req.query.before) {
        conditions.push("m.id < $2");
        params.push(parseInt(req.query.before, 10));
      }
      var where = "WHERE " + conditions.join(" AND ");
      var result = await db.query(
        "SELECT m.*, u.display_name, u.avatar_url, u.email " +
        "FROM channel_messages m LEFT JOIN users u ON u.id = m.user_id " +
        where + " ORDER BY m.created_at DESC LIMIT 50",
        params
      );
      res.json({ messages: result.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/channels/:id/messages ────────────────────────
  // Extracted from Sebastian POST /channels/:id/messages
  app.post("/api/channels/:id/messages", async function(req, res) {
    var uid = await requireLogin(req, res); if (!uid) return;
    try {
      var channel = await db.query("SELECT id FROM channels WHERE id=$1", [req.params.id]);
      if (!channel.rows.length) return res.status(404).json({ error: "Channel not found" });

      // Check if muted (from Sebastian channel_mutes pattern)
      var muted = await db.query(
        "SELECT id FROM channel_mutes WHERE channel_id=$1 AND user_id=$2 AND (expires_at IS NULL OR expires_at > NOW())",
        [req.params.id, uid]
      );
      if (muted.rows.length) return res.status(403).json({ error: "You are muted in this channel" });

      var b = req.body || {};
      var text = (b.text || "").toString().trim();
      var imageUrl = (b.image_url || "").toString().trim();
      if (!text && !imageUrl) return res.status(400).json({ error: "text or image_url required" });

      var result = await db.query(
        "INSERT INTO channel_messages (channel_id, user_id, text, image_url, reply_to_id, thread_id, created_at) " +
        "VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *",
        [req.params.id, uid, text, imageUrl, b.reply_to_id || null, b.thread_id || null]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Channel Requests ───────────────────────────────────────

  // GET /api/channel-requests (user's own)
  app.get("/api/channel-requests", async function(req, res) {
    var uid = await requireLogin(req, res); if (!uid) return;
    try {
      var result = await db.query("SELECT * FROM channel_requests WHERE user_id=$1 ORDER BY created_at DESC", [uid]);
      res.json({ requests: result.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/channel-requests (auth required)
  // Extracted from Sebastian POST /api/channels/request
  app.post("/api/channel-requests", async function(req, res) {
    var uid = await requireLogin(req, res); if (!uid) return;
    try {
      var b = req.body || {};
      if (!b.name) return res.status(400).json({ error: "name required" });
      await db.query(
        "INSERT INTO channel_requests (place_id, user_id, name, description, created_at) VALUES ($1,$2,$3,$4,NOW())",
        [b.place_id || null, uid, b.name, b.description || ""]
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/channel-requests/:id/approve
  // Extracted from Sebastian POST /api/admin/channel-requests/:id/approve
  app.post("/api/admin/channel-requests/:id/approve", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var rr = await db.query("SELECT * FROM channel_requests WHERE id=$1", [req.params.id]);
      if (!rr.rows.length) return res.status(404).json({ error: "Request not found" });
      var request = rr.rows[0];

      await db.query("UPDATE channel_requests SET status='approved', reviewed_by=$1, reviewed_at=NOW() WHERE id=$2", [admin.id, request.id]);

      // Auto-create channel
      var ch = await db.query(
        "INSERT INTO channels (place_id, name, description, is_public, created_by, created_at) VALUES ($1,$2,$3,true,$4,NOW()) RETURNING *",
        [request.place_id, request.name, request.description || "", request.user_id]
      );
      // Add requester as moderator
      if (ch.rows.length) {
        await db.query(
          "INSERT INTO channel_memberships (channel_id, user_id, role, joined_at) VALUES ($1,$2,'moderator',NOW()) ON CONFLICT DO NOTHING",
          [ch.rows[0].id, request.user_id]
        );
      }
      res.json({ ok: true, channel: ch.rows[0] || null });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/channel-requests/:id/deny
  app.post("/api/admin/channel-requests/:id/deny", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      await db.query("UPDATE channel_requests SET status='denied', reviewed_by=$1, reviewed_at=NOW() WHERE id=$2", [admin.id, req.params.id]);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Direct Messages ────────────────────────────────────────

  // GET /api/dm/conversations
  app.get("/api/dm/conversations", async function(req, res) {
    var uid = await requireLogin(req, res); if (!uid) return;
    try {
      var result = await db.query(
        "SELECT dc.*, " +
        "ua.display_name AS user_a_name, ub.display_name AS user_b_name " +
        "FROM direct_conversations dc " +
        "LEFT JOIN users ua ON ua.id = dc.user_a " +
        "LEFT JOIN users ub ON ub.id = dc.user_b " +
        "WHERE dc.user_a=$1 OR dc.user_b=$1 " +
        "ORDER BY dc.last_message_at DESC NULLS LAST",
        [uid]
      );
      res.json({ conversations: result.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/dm/conversations
  app.post("/api/dm/conversations", async function(req, res) {
    var uid = await requireLogin(req, res); if (!uid) return;
    try {
      var b = req.body || {};
      var otherUserId = parseInt(b.user_id, 10);
      if (!otherUserId || otherUserId === uid) return res.status(400).json({ error: "Valid user_id required" });

      // Check existing
      var existing = await db.query(
        "SELECT * FROM direct_conversations WHERE (user_a=$1 AND user_b=$2) OR (user_a=$2 AND user_b=$1)",
        [uid, otherUserId]
      );
      if (existing.rows.length) return res.json(existing.rows[0]);

      var result = await db.query(
        "INSERT INTO direct_conversations (user_a, user_b, place_id, created_at) VALUES ($1,$2,$3,NOW()) RETURNING *",
        [uid, otherUserId, b.place_id || null]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/dm/conversations/:id/messages
  app.get("/api/dm/conversations/:id/messages", async function(req, res) {
    var uid = await requireLogin(req, res); if (!uid) return;
    try {
      // Verify membership
      var conv = await db.query("SELECT * FROM direct_conversations WHERE id=$1 AND (user_a=$2 OR user_b=$2)", [req.params.id, uid]);
      if (!conv.rows.length) return res.status(403).json({ error: "Not your conversation" });

      // Mark as read
      await db.query("UPDATE direct_messages SET read=true WHERE conversation_id=$1 AND sender_id != $2", [req.params.id, uid]);

      var result = await db.query(
        "SELECT dm.*, u.display_name, u.avatar_url " +
        "FROM direct_messages dm LEFT JOIN users u ON u.id = dm.sender_id " +
        "WHERE dm.conversation_id=$1 ORDER BY dm.created_at ASC LIMIT 200",
        [req.params.id]
      );
      res.json({ messages: result.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/dm/conversations/:id/messages
  app.post("/api/dm/conversations/:id/messages", async function(req, res) {
    var uid = await requireLogin(req, res); if (!uid) return;
    try {
      var conv = await db.query("SELECT * FROM direct_conversations WHERE id=$1 AND (user_a=$2 OR user_b=$2)", [req.params.id, uid]);
      if (!conv.rows.length) return res.status(403).json({ error: "Not your conversation" });

      var b = req.body || {};
      var text = (b.text || "").toString().trim();
      if (!text) return res.status(400).json({ error: "text required" });

      var result = await db.query(
        "INSERT INTO direct_messages (conversation_id, sender_id, text, created_at) VALUES ($1,$2,$3,NOW()) RETURNING *",
        [req.params.id, uid, text]
      );
      // Update conversation last message
      await db.query(
        "UPDATE direct_conversations SET last_message=$1, last_message_at=NOW() WHERE id=$2",
        [text.slice(0, 100), req.params.id]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

};
