/**
 * Broadcast module routes (L3)
 * Admin blasts, seller broadcast to buyers, Facebook page posting.
 * Extracted from PP/DT seller broadcast + TC Facebook broadcast patterns.
 */

const { canAccessModule } = require('../../lib/module-access');

module.exports = function mountBroadcast(app, db) {

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
  function denyIfDisabled(res) {
    res.status(404).json({ error: "Not found" });
  }

  // ── HTML email template ──
  function wrapEmailHtml(subject, body) {
    return '<div style="max-width:600px;margin:0 auto;padding:32px;background:#070b10;color:#e8eef6;font-family:system-ui,sans-serif;">' +
      '<h2 style="color:#06b6d4;margin-bottom:16px;">' + subject + '</h2>' +
      '<div style="font-size:15px;line-height:1.6;color:#e8eef6;">' + body + '</div>' +
      '<hr style="border:none;border-top:1px solid #1e293b;margin:24px 0;">' +
      '<p style="font-size:12px;color:#64748b;">Digital Towns — digitaltowns.app</p>' +
      '</div>';
  }

  // ── Resend email sender ──
  async function sendViaResend(to, subject, html) {
    var apiKey = (process.env.RESEND_API_KEY || "").trim();
    if (!apiKey) {
      console.log("[broadcast] EMAIL (no RESEND_API_KEY):", to, subject);
      return { ok: true };
    }

    var response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "Digital Towns <hello@digitaltowns.app>",
        to: to,
        subject: subject,
        html: html
      })
    });

    if (!response.ok) {
      var text = await response.text();
      console.error("[broadcast] Resend error:", response.status, text);
      return { ok: false, error: text };
    }
    return { ok: true };
  }

  // ══════════════════════════════════════
  // 1. POST /api/broadcast — Admin blast
  // ══════════════════════════════════════

  app.post("/api/broadcast", async function(req, res) {
    try {
      if (!(await checkFlag(req, "broadcast.admin-blast"))) return denyIfDisabled(res);
      var admin = await requireAdmin(req, res); if (!admin) return;

      var b = req.body || {};
      if (!b.subject || !b.body) {
        return res.status(400).json({ error: "subject and body required" });
      }

      var channel = b.channel || "email";
      var filter = b.target_filter || {};

      // Build user query based on target_filter
      var conditions = ["u.email IS NOT NULL"];
      var params = [];
      var joins = "";
      var paramIdx = 1;

      if (filter.place_slug) {
        joins = " JOIN place_memberships pm ON pm.user_id = u.id JOIN places p ON p.id = pm.place_id";
        conditions.push("p.slug = $" + paramIdx);
        params.push(filter.place_slug);
        paramIdx++;
      }

      if (filter.trust_tier_min) {
        conditions.push("u.trust_tier >= $" + paramIdx);
        params.push(parseInt(filter.trust_tier_min));
        paramIdx++;
      }

      var userQuery = "SELECT DISTINCT u.id, u.email FROM users u" + joins +
        " WHERE " + conditions.join(" AND ");
      var usersResult = await db.query(userQuery, params);
      var recipients = usersResult.rows;

      // Create broadcast record
      var broadcastR = await db.query(
        "INSERT INTO broadcasts (sender_id, type, channel, subject, body, target_filter, recipient_count, status) " +
        "VALUES ($1, 'admin', $2, $3, $4, $5, $6, 'sending') RETURNING *",
        [admin.id, channel, b.subject, b.body, JSON.stringify(filter), recipients.length]
      );
      var broadcast = broadcastR.rows[0];

      var sentCount = 0;

      if (channel === "email") {
        // Send in batches of 50
        var html = wrapEmailHtml(b.subject, b.body);
        for (var i = 0; i < recipients.length; i += 50) {
          var batch = recipients.slice(i, i + 50);
          for (var j = 0; j < batch.length; j++) {
            var result = await sendViaResend(batch[j].email, b.subject, html);
            if (result.ok) sentCount++;
          }
        }
      } else if (channel === "in-app") {
        // Insert in-app notifications
        for (var i = 0; i < recipients.length; i++) {
          try {
            await db.query(
              "INSERT INTO notifications (user_id, type, title, body, data) VALUES ($1, 'broadcast', $2, $3, $4)",
              [recipients[i].id, b.subject, b.body, JSON.stringify({ broadcast_id: broadcast.id })]
            );
            sentCount++;
          } catch (nErr) {
            console.error("[broadcast] notification insert error:", nErr.message);
          }
        }
      }

      // Update broadcast record
      await db.query(
        "UPDATE broadcasts SET sent_count=$1, status='sent', sent_at=NOW() WHERE id=$2",
        [sentCount, broadcast.id]
      );

      res.json({ ok: true, broadcast_id: broadcast.id, recipient_count: recipients.length, sent_count: sentCount });
    } catch (err) {
      console.error("[broadcast] admin blast error:", err.message);
      res.status(500).json({ error: "Failed to send broadcast" });
    }
  });

  // ══════════════════════════════════════
  // 2. GET /api/broadcasts — List broadcasts
  // ══════════════════════════════════════

  app.get("/api/broadcasts", async function(req, res) {
    try {
      if (!(await checkFlag(req, "broadcast"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      // Check if admin
      var adminR = await db.query("SELECT is_admin FROM users WHERE id=$1", [uid]);
      var isAdmin = adminR.rows.length && adminR.rows[0].is_admin;

      var result;
      if (isAdmin) {
        result = await db.query(
          "SELECT * FROM broadcasts ORDER BY created_at DESC LIMIT 50"
        );
      } else {
        result = await db.query(
          "SELECT * FROM broadcasts WHERE type='seller' AND sender_id=$1 ORDER BY created_at DESC LIMIT 50",
          [uid]
        );
      }

      res.json({ broadcasts: result.rows });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch broadcasts" });
    }
  });

  // ══════════════════════════════════════
  // 3. GET /api/broadcasts/:id/stats — Broadcast stats
  // ══════════════════════════════════════

  app.get("/api/broadcasts/:id/stats", async function(req, res) {
    try {
      if (!(await checkFlag(req, "broadcast"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var result = await db.query(
        "SELECT id, type, channel, subject, recipient_count, sent_count, status, scheduled_at, sent_at, created_at FROM broadcasts WHERE id=$1",
        [req.params.id]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Not found" });

      // Non-admin can only see their own seller broadcasts
      var b = result.rows[0];
      if (b.type !== "seller" || b.sender_id !== uid) {
        var adminR = await db.query("SELECT is_admin FROM users WHERE id=$1", [uid]);
        if (!adminR.rows.length || !adminR.rows[0].is_admin) {
          return res.status(403).json({ error: "Forbidden" });
        }
      }

      res.json(b);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch broadcast stats" });
    }
  });

  // ══════════════════════════════════════
  // 4. POST /api/broadcast/seller/buyers — Seller broadcast to buyers
  // ══════════════════════════════════════

  app.post("/api/broadcast/seller/buyers", async function(req, res) {
    try {
      if (!(await checkFlag(req, "broadcast.seller-broadcast"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var b = req.body || {};
      if (!b.subject || !b.body) {
        return res.status(400).json({ error: "subject and body required" });
      }

      // Get distinct buyer emails from orders (adapted from PP POST /api/seller/broadcast)
      var emails = [];
      var ordersR = await db.query(
        "SELECT DISTINCT u.email FROM orders o JOIN users u ON u.id = o.buyer_id " +
        "WHERE o.seller_id = $1 AND o.status = 'paid' AND u.email IS NOT NULL",
        [uid]
      );
      for (var i = 0; i < ordersR.rows.length; i++) {
        emails.push(ordersR.rows[i].email);
      }

      // Also check invoices table if it exists (try/catch)
      try {
        var invoicesR = await db.query(
          "SELECT DISTINCT bp.email FROM invoices inv JOIN buyer_profiles bp ON bp.id = inv.buyer_profile_id " +
          "WHERE inv.seller_id = $1 AND bp.email IS NOT NULL",
          [uid]
        );
        for (var j = 0; j < invoicesR.rows.length; j++) {
          if (emails.indexOf(invoicesR.rows[j].email) === -1) {
            emails.push(invoicesR.rows[j].email);
          }
        }
      } catch (invoiceErr) {
        // invoices table may not exist — that's fine
      }

      if (!emails.length) {
        return res.json({ ok: true, broadcast_id: null, sent_count: 0, message: "No buyers found" });
      }

      // Create broadcast record
      var broadcastR = await db.query(
        "INSERT INTO broadcasts (sender_id, type, channel, subject, body, recipient_count, status) " +
        "VALUES ($1, 'seller', 'email', $2, $3, $4, 'sending') RETURNING *",
        [uid, b.subject, b.body, emails.length]
      );
      var broadcast = broadcastR.rows[0];

      // Send via Resend API to each buyer
      var html = wrapEmailHtml(b.subject, b.body);
      var sentCount = 0;
      for (var k = 0; k < emails.length; k++) {
        var result = await sendViaResend(emails[k], b.subject, html);
        if (result.ok) sentCount++;
      }

      // Update sent_count
      await db.query(
        "UPDATE broadcasts SET sent_count=$1, status='sent', sent_at=NOW() WHERE id=$2",
        [sentCount, broadcast.id]
      );

      res.json({ ok: true, broadcast_id: broadcast.id, sent_count: sentCount });
    } catch (err) {
      console.error("[broadcast] seller broadcast error:", err.message);
      res.status(500).json({ error: "Failed to send seller broadcast" });
    }
  });

  // ══════════════════════════════════════
  // 5. POST /api/broadcast/facebook — Facebook page post
  // ══════════════════════════════════════

  app.post("/api/broadcast/facebook", async function(req, res) {
    try {
      if (!(await checkFlag(req, "broadcast.facebook"))) return denyIfDisabled(res);
      var admin = await requireAdmin(req, res); if (!admin) return;

      var b = req.body || {};
      if (!b.message) {
        return res.status(400).json({ error: "message required" });
      }

      var pageId = (process.env.FB_PAGE_ID || "").trim();
      var pageToken = (process.env.FB_PAGE_TOKEN || "").trim();
      if (!pageId || !pageToken) {
        return res.status(500).json({ error: "Facebook credentials not configured (FB_PAGE_ID, FB_PAGE_TOKEN)" });
      }

      // POST to Facebook Graph API v18.0 (adapted from TC broadcast pattern)
      var fbBody = {
        message: b.message,
        access_token: pageToken
      };
      if (b.link) fbBody.link = b.link;

      var fbResponse = await fetch("https://graph.facebook.com/v18.0/" + pageId + "/feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fbBody)
      });

      var fbData = await fbResponse.json();
      if (!fbResponse.ok) {
        console.error("[broadcast] Facebook API error:", fbData);
        return res.status(502).json({ error: "Facebook API error", details: fbData });
      }

      // Create broadcast record
      var broadcastR = await db.query(
        "INSERT INTO broadcasts (sender_id, type, channel, subject, body, recipient_count, sent_count, status, sent_at, meta) " +
        "VALUES ($1, 'facebook', 'facebook', $2, $3, 0, 1, 'sent', NOW(), $4) RETURNING *",
        [admin.id, b.message.substring(0, 100), b.message, JSON.stringify({ fb_post_id: fbData.id, link: b.link || null })]
      );

      res.json({ ok: true, broadcast_id: broadcastR.rows[0].id, fb_post_id: fbData.id });
    } catch (err) {
      console.error("[broadcast] facebook post error:", err.message);
      res.status(500).json({ error: "Failed to post to Facebook" });
    }
  });

  console.log("[broadcast] L3 module mounted — admin blast, seller broadcast, facebook");
};
