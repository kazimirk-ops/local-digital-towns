/**
 * Disputes module routes (L4)
 * Order disputes, ghost reports, bidding suspension, trust events, admin resolution.
 * Extracted from Sebastian server.js dispute endpoints + data.js ghost report functions.
 */

const { canAccessModule } = require('../../lib/module-access');

module.exports = function mountDisputes(app, db) {

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

  // ── POST /api/disputes — file a dispute on an order ──
  // Adapted from Sebastian addDispute function
  app.post("/api/disputes", async function(req, res) {
    var uid = await requireLogin(req, res); if (!uid) return;
    try {
      var b = req.body || {};
      var orderId = parseInt(b.order_id, 10);
      if (!orderId) return res.status(400).json({ error: "order_id required" });
      if (!b.reason) return res.status(400).json({ error: "reason required" });

      // Verify user is party to order
      var order = await db.query(
        "SELECT * FROM orders WHERE id=$1 AND (buyer_user_id=$2 OR seller_user_id=$2)",
        [orderId, uid]
      );
      if (!order.rows.length) return res.status(403).json({ error: "Not your order" });

      // Check for existing open dispute
      var existing = await db.query(
        "SELECT id FROM disputes WHERE order_id=$1 AND status='open'", [orderId]
      );
      if (existing.rows.length) return res.status(400).json({ error: "Dispute already open for this order" });

      var respondent = order.rows[0].buyer_user_id === uid
        ? order.rows[0].seller_user_id
        : order.rows[0].buyer_user_id;

      var result = await db.query(
        "INSERT INTO disputes (place_id, order_id, reporter_user_id, respondent_user_id, reason, status, created_at) " +
        "VALUES ($1,$2,$3,$4,$5,'open',NOW()) RETURNING *",
        [order.rows[0].place_id || null, orderId, uid, respondent, b.reason]
      );

      // Record trust event
      await db.query(
        "INSERT INTO trust_events (order_id, user_id, event_type, meta, created_at) VALUES ($1,$2,$3,$4,NOW())",
        [orderId, uid, "dispute_filed", JSON.stringify({ reason: b.reason })]
      );

      res.status(201).json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/disputes — user's own disputes ──
  app.get("/api/disputes", async function(req, res) {
    var uid = await requireLogin(req, res); if (!uid) return;
    try {
      var result = await db.query(
        "SELECT d.*, u.display_name AS reporter_name " +
        "FROM disputes d LEFT JOIN users u ON u.id = d.reporter_user_id " +
        "WHERE d.reporter_user_id=$1 OR d.respondent_user_id=$1 " +
        "ORDER BY d.created_at DESC",
        [uid]
      );
      res.json({ disputes: result.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/admin/disputes — all disputes (admin) ──
  app.get("/api/admin/disputes", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var status = req.query.status || null;
      var conditions = [];
      var params = [];
      if (status) {
        conditions.push("d.status=$" + (params.length + 1));
        params.push(status);
      }
      var where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
      var result = await db.query(
        "SELECT d.*, reporter.display_name AS reporter_name, respondent.display_name AS respondent_name " +
        "FROM disputes d " +
        "LEFT JOIN users reporter ON reporter.id = d.reporter_user_id " +
        "LEFT JOIN users respondent ON respondent.id = d.respondent_user_id " +
        where + " ORDER BY d.created_at DESC LIMIT 200",
        params
      );
      res.json({ disputes: result.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/admin/disputes/:id/resolve — resolve a dispute ──
  app.post("/api/admin/disputes/:id/resolve", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var b = req.body || {};
      await db.query(
        "UPDATE disputes SET status='resolved', resolution_note=$1, resolved_by_user_id=$2, resolved_at=NOW() WHERE id=$3",
        [b.resolution_note || "Resolved", admin.id, req.params.id]
      );

      // Record trust event
      var dispute = await db.query("SELECT * FROM disputes WHERE id=$1", [req.params.id]);
      if (dispute.rows.length) {
        await db.query(
          "INSERT INTO trust_events (order_id, user_id, event_type, meta, created_at) VALUES ($1,$2,$3,$4,NOW())",
          [dispute.rows[0].order_id, admin.id, "dispute_resolved", JSON.stringify({ dispute_id: dispute.rows[0].id, note: b.resolution_note || "" })]
        );
      }

      // Record moderation action
      await db.query(
        "INSERT INTO moderation_actions (target_type, target_id, action_type, admin_user_id, reason, created_at) VALUES ($1,$2,$3,$4,$5,NOW())",
        ["dispute", parseInt(req.params.id, 10), "resolve", admin.id, b.resolution_note || "Resolved"]
      );

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/admin/disputes/:id/dismiss — dismiss a dispute ──
  app.post("/api/admin/disputes/:id/dismiss", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      await db.query(
        "UPDATE disputes SET status='dismissed', resolution_note=$1, resolved_by_user_id=$2, resolved_at=NOW() WHERE id=$3",
        [(req.body || {}).reason || "Dismissed", admin.id, req.params.id]
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Ghost Reports (Buyer Non-Payment) ──

  // POST /api/ghost-reports — report a buyer as ghost (seller only, 48hr gate)
  // Adapted from Sebastian createGhostReport
  app.post("/api/ghost-reports", async function(req, res) {
    var uid = await requireLogin(req, res); if (!uid) return;
    try {
      var b = req.body || {};
      var orderId = parseInt(b.order_id, 10);
      if (!orderId) return res.status(400).json({ error: "order_id required" });

      // Must be the seller
      var order = await db.query(
        "SELECT * FROM orders WHERE id=$1 AND seller_user_id=$2", [orderId, uid]
      );
      if (!order.rows.length) return res.status(403).json({ error: "Only the seller can file a ghost report" });

      // 48-hour gate: order must be at least 48 hours old
      var orderAge = Date.now() - new Date(order.rows[0].created_at).getTime();
      if (orderAge < 48 * 60 * 60 * 1000) {
        return res.status(400).json({ error: "Must wait 48 hours after order before filing ghost report" });
      }

      // Check for existing report
      var existing = await db.query("SELECT id FROM ghost_reports WHERE order_id=$1", [orderId]);
      if (existing.rows.length) return res.status(400).json({ error: "Ghost report already filed for this order" });

      var buyerUserId = order.rows[0].buyer_user_id;
      var result = await db.query(
        "INSERT INTO ghost_reports (order_id, buyer_user_id, seller_user_id, reason, reported_at, status) " +
        "VALUES ($1,$2,$3,$4,NOW(),'active') RETURNING *",
        [orderId, buyerUserId, uid, b.reason || ""]
      );

      // Recalculate buyer's ghosting stats
      await recalculateGhostingPercent(buyerUserId);

      // Record trust event
      await db.query(
        "INSERT INTO trust_events (order_id, user_id, event_type, meta, created_at) VALUES ($1,$2,$3,$4,NOW())",
        [orderId, buyerUserId, "ghost_report", JSON.stringify({ seller_id: uid, reason: b.reason || "" })]
      );

      res.status(201).json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/ghost-reports/user/:userId — ghosting stats for a user
  app.get("/api/ghost-reports/user/:userId", async function(req, res) {
    try {
      var stats = await getGhostingStats(parseInt(req.params.userId, 10));
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/admin/ghost-reports — all ghost reports (admin)
  app.get("/api/admin/ghost-reports", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var result = await db.query(
        "SELECT gr.*, buyer.display_name AS buyer_name, seller.display_name AS seller_name " +
        "FROM ghost_reports gr " +
        "LEFT JOIN users buyer ON buyer.id = gr.buyer_user_id " +
        "LEFT JOIN users seller ON seller.id = gr.seller_user_id " +
        "ORDER BY gr.reported_at DESC LIMIT 200"
      );
      res.json({ reports: result.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/ghost-reports/:id/dismiss — dismiss a ghost report
  app.post("/api/admin/ghost-reports/:id/dismiss", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var report = await db.query("SELECT * FROM ghost_reports WHERE id=$1", [req.params.id]);
      if (!report.rows.length) return res.status(404).json({ error: "Report not found" });

      await db.query("UPDATE ghost_reports SET status='dismissed' WHERE id=$1", [req.params.id]);

      // Recalculate buyer stats
      await recalculateGhostingPercent(report.rows[0].buyer_user_id);

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Bidding Suspension ──

  // POST /api/admin/bidding-suspend — suspend user from bidding
  app.post("/api/admin/bidding-suspend", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var b = req.body || {};
      var userId = parseInt(b.user_id, 10);
      var days = parseInt(b.days, 10) || 7;
      if (!userId) return res.status(400).json({ error: "user_id required" });

      var until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      await db.query("UPDATE users SET bidding_suspended_until = $1 WHERE id = $2", [until, userId]);

      await db.query(
        "INSERT INTO trust_events (user_id, event_type, meta, created_at) VALUES ($1,$2,$3,NOW())",
        [userId, "bidding_suspended", JSON.stringify({ days, until, admin_id: admin.id, reason: b.reason || "" })]
      );

      await db.query(
        "INSERT INTO moderation_actions (target_type, target_id, action_type, admin_user_id, reason, created_at) VALUES ($1,$2,$3,$4,$5,NOW())",
        ["user", userId, "bidding_suspend", admin.id, b.reason || "Bidding suspended for " + days + " days"]
      );

      res.json({ ok: true, until });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/bidding-unsuspend — lift bidding suspension
  app.post("/api/admin/bidding-unsuspend", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var userId = parseInt((req.body || {}).user_id, 10);
      if (!userId) return res.status(400).json({ error: "user_id required" });

      await db.query("UPDATE users SET bidding_suspended_until = NULL WHERE id = $1", [userId]);

      await db.query(
        "INSERT INTO trust_events (user_id, event_type, meta, created_at) VALUES ($1,$2,$3,NOW())",
        [userId, "bidding_unsuspended", JSON.stringify({ admin_id: admin.id })]
      );

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Trust Events (audit log) ──

  // GET /api/admin/trust-events — trust event log
  app.get("/api/admin/trust-events", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var userId = req.query.user_id ? parseInt(req.query.user_id, 10) : null;
      var conditions = [];
      var params = [];
      if (userId) {
        conditions.push("te.user_id=$" + (params.length + 1));
        params.push(userId);
      }
      var where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
      var result = await db.query(
        "SELECT te.*, u.display_name " +
        "FROM trust_events te LEFT JOIN users u ON u.id = te.user_id " +
        where + " ORDER BY te.created_at DESC LIMIT 200",
        params
      );
      res.json({ events: result.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Moderation Actions log ──

  // GET /api/admin/moderation-actions
  app.get("/api/admin/moderation-actions", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var result = await db.query(
        "SELECT ma.*, u.display_name AS admin_name " +
        "FROM moderation_actions ma LEFT JOIN users u ON u.id = ma.admin_user_id " +
        "ORDER BY ma.created_at DESC LIMIT 200"
      );
      res.json({ actions: result.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Helper functions ──

  async function getGhostingStats(userId) {
    var totalRow = await db.query("SELECT COUNT(*)::integer AS count FROM orders WHERE buyer_user_id=$1", [userId]);
    var totalOrders = totalRow.rows[0]?.count || 0;

    var ghostRow = await db.query("SELECT COUNT(*)::integer AS count FROM ghost_reports WHERE buyer_user_id=$1 AND status='active'", [userId]);
    var ghostCount = ghostRow.rows[0]?.count || 0;

    var ghostingPercent = totalOrders > 0 ? Math.round((ghostCount / totalOrders) * 1000) / 10 : 0;

    return { totalOrders, ghostCount, ghostingPercent };
  }

  async function recalculateGhostingPercent(userId) {
    var stats = await getGhostingStats(userId);
    await db.query(
      "UPDATE users SET ghosting_percent=$1, ghost_report_count=$2, total_orders_as_buyer=$3 WHERE id=$4",
      [stats.ghostingPercent, stats.ghostCount, stats.totalOrders, userId]
    );
    return stats;
  }

};
