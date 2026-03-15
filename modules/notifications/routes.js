/**
 * Notifications module routes (L1)
 * In-app notifications + email sending via Resend.
 * Extracted from DT notifications CRUD + PP/SB Resend pattern.
 */
const { canAccessModule } = require('../../lib/module-access');

// ── Email helper (exported for other modules) ──
async function sendEmail(to, subject, html) {
  var apiKey = (process.env.RESEND_API_KEY || "").trim();
  if (!apiKey) {
    console.log("[notifications] EMAIL (no RESEND_API_KEY):", to, subject);
    return { ok: true };
  }

  var response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: process.env.FROM_EMAIL || "Digital Towns <hello@digitaltowns.app>",
      to: to,
      subject: subject,
      html: html
    })
  });

  if (!response.ok) {
    var text = await response.text();
    console.error("[notifications] Resend error:", response.status, text);
    return { ok: false, error: text };
  }
  return { ok: true };
}

// ── createNotification helper (exported for other modules) ──
async function createNotification(db, userId, type, title, body, data, shouldEmail) {
  var result = await db.query(
    "INSERT INTO notifications (user_id, type, title, body, data, email_sent) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
    [userId, type, title, body || "", JSON.stringify(data || {}), false]
  );

  if (shouldEmail) {
    try {
      var userR = await db.query("SELECT email FROM users WHERE id=$1", [userId]);
      if (userR.rows.length && userR.rows[0].email) {
        await sendEmail(
          userR.rows[0].email,
          title,
          "<div style=\"font-family:sans-serif;max-width:500px;margin:0 auto;\">" +
          "<h2 style=\"color:#0ea5e9;\">" + title + "</h2>" +
          "<p>" + (body || "") + "</p>" +
          "<p style=\"color:#888;font-size:12px;margin-top:20px;\">digitaltowns.app</p>" +
          "</div>"
        );
        await db.query("UPDATE notifications SET email_sent=true WHERE id=$1", [result.rows[0].id]);
      }
    } catch(emailErr) {
      console.error("[notifications] email send error:", emailErr.message);
    }
  }

  return result.rows[0];
}

// Export helpers for use by other modules
module.exports = function mountNotifications(app, db) {

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

  // ══════════════════════════════════════
  // In-app notifications — extracted from DT
  // ══════════════════════════════════════

  // ── GET /api/notifications ──
  app.get("/api/notifications", async function(req, res) {
    try {
      if (!(await checkFlag(req, "notifications.in-app"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var result = await db.query(
        "SELECT * FROM notifications WHERE user_id = $1 ORDER BY read ASC, created_at DESC LIMIT 50",
        [uid]
      );
      res.json({ notifications: result.rows });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  });

  // ── GET /api/notifications/unread-count ──
  app.get("/api/notifications/unread-count", async function(req, res) {
    try {
      var uid = await getUserId(req);
      if (!uid) return res.json({ count: 0 });

      var result = await db.query(
        "SELECT COUNT(*)::integer AS count FROM notifications WHERE user_id = $1 AND read = false",
        [uid]
      );
      res.json({ count: result.rows[0].count });
    } catch (err) {
      res.json({ count: 0 });
    }
  });

  // ── POST /api/notifications/:id/read ──
  app.post("/api/notifications/:id/read", async function(req, res) {
    try {
      var uid = await requireLogin(req, res); if (!uid) return;
      await db.query(
        "UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2",
        [req.params.id, uid]
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to mark read" });
    }
  });

  // ── POST /api/notifications/read-all ──
  app.post("/api/notifications/read-all", async function(req, res) {
    try {
      var uid = await requireLogin(req, res); if (!uid) return;
      await db.query(
        "UPDATE notifications SET read = true WHERE user_id = $1 AND read = false",
        [uid]
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to mark all read" });
    }
  });

  console.log("[notifications] L1 module mounted — in-app notifications, email via Resend");
};

// Attach helpers to the mount function for cross-module use
module.exports.sendEmail = sendEmail;
module.exports.createNotification = createNotification;
