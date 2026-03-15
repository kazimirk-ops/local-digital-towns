/**
 * Referrals module routes (L2)
 * Referral codes, commissions, credits, cashout.
 * Extracted from Sebastian data.js referral system.
 */
const { canAccessModule } = require('../../lib/module-access');

// ── fireReferralEvent (exported for cross-module use) ──
async function fireReferralEvent(db, referrerUserId, type, amountCents, referredUserId, description) {
  try {
    await db.query(
      "INSERT INTO referral_transactions (user_id, type, amount_cents, referred_user_id, description) VALUES ($1,$2,$3,$4,$5)",
      [referrerUserId, type, amountCents, referredUserId || null, description || ""]
    );
    if (type === "commission" && amountCents > 0) {
      await db.query(
        "UPDATE users SET referral_balance_cents = referral_balance_cents + $1, referral_earnings_total = referral_earnings_total + $1 WHERE id = $2",
        [amountCents, referrerUserId]
      );
    }
    return { ok: true };
  } catch (err) {
    console.error("[referrals] fireReferralEvent error:", err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = function mountReferrals(app, db) {

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
  function denyIfDisabled(res) { res.status(404).json({ error: "Not found" }); }

  // ── Referral code generator (from Sebastian) ──
  function generateReferralCode() {
    var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    var result = "";
    for (var i = 0; i < 8; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  // ══════════════════════════════════════
  // Referral codes
  // ══════════════════════════════════════

  // ── GET /api/referrals/code ──
  app.get("/api/referrals/code", async function(req, res) {
    try {
      if (!(await checkFlag(req, "referrals.codes"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var r = await db.query("SELECT referral_code FROM users WHERE id=$1", [uid]);
      if (!r.rows.length) return res.status(404).json({ error: "User not found" });

      var code = r.rows[0].referral_code;
      if (!code) {
        // Auto-generate
        for (var attempt = 0; attempt < 5; attempt++) {
          code = generateReferralCode();
          try {
            await db.query("UPDATE users SET referral_code=$1 WHERE id=$2 AND referral_code IS NULL", [code, uid]);
            var check = await db.query("SELECT referral_code FROM users WHERE id=$1", [uid]);
            code = check.rows[0].referral_code;
            break;
          } catch (e) { code = null; }
        }
      }

      res.json({ referral_code: code });
    } catch (err) { res.status(500).json({ error: "Failed" }); }
  });

  // ── GET /api/referrals/stats ──
  app.get("/api/referrals/stats", async function(req, res) {
    try {
      if (!(await checkFlag(req, "referrals"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var userR = await db.query(
        "SELECT referral_code, referral_balance_cents, referral_earnings_total FROM users WHERE id=$1",
        [uid]
      );
      if (!userR.rows.length) return res.status(404).json({ error: "User not found" });
      var u = userR.rows[0];

      var countR = await db.query("SELECT COUNT(*)::integer AS cnt FROM users WHERE referred_by=$1", [uid]);
      var activeR = await db.query(
        "SELECT COUNT(*)::integer AS cnt FROM users WHERE referred_by=$1 AND suspended IS NOT true",
        [uid]
      );

      res.json({
        referral_code: u.referral_code,
        total_referred: countR.rows[0].cnt,
        active_referred: activeR.rows[0].cnt,
        balance_cents: u.referral_balance_cents || 0,
        earnings_total_cents: u.referral_earnings_total || 0
      });
    } catch (err) { res.status(500).json({ error: "Failed" }); }
  });

  // ── POST /api/referrals/apply ──
  app.post("/api/referrals/apply", async function(req, res) {
    try {
      if (!(await checkFlag(req, "referrals.codes"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var code = ((req.body || {}).code || "").trim().toUpperCase();
      if (!code) return res.status(400).json({ error: "Referral code required" });

      // Check not already referred
      var selfR = await db.query("SELECT referred_by FROM users WHERE id=$1", [uid]);
      if (selfR.rows.length && selfR.rows[0].referred_by) {
        return res.status(400).json({ error: "Already referred" });
      }

      // Find referrer
      var referrerR = await db.query("SELECT id FROM users WHERE UPPER(referral_code)=$1 AND id != $2", [code, uid]);
      if (!referrerR.rows.length) return res.status(404).json({ error: "Invalid referral code" });
      var referrerId = referrerR.rows[0].id;

      // Link referral
      await db.query("UPDATE users SET referred_by=$1 WHERE id=$2", [referrerId, uid]);

      res.json({ ok: true, referred_by: referrerId });
    } catch (err) { res.status(500).json({ error: "Failed to apply referral" }); }
  });

  // ── GET /api/referrals/transactions ──
  app.get("/api/referrals/transactions", async function(req, res) {
    try {
      if (!(await checkFlag(req, "referrals"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var r = await db.query(
        "SELECT rt.*, u.display_name AS referred_name " +
        "FROM referral_transactions rt " +
        "LEFT JOIN users u ON u.id = rt.referred_user_id " +
        "WHERE rt.user_id = $1 ORDER BY rt.created_at DESC LIMIT 50",
        [uid]
      );
      res.json({ transactions: r.rows });
    } catch (err) { res.status(500).json({ error: "Failed" }); }
  });

  // ── POST /api/referrals/cashout ──
  app.post("/api/referrals/cashout", async function(req, res) {
    try {
      if (!(await checkFlag(req, "referrals.cashout"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var userR = await db.query("SELECT referral_balance_cents FROM users WHERE id=$1", [uid]);
      if (!userR.rows.length) return res.status(404).json({ error: "User not found" });
      var balance = userR.rows[0].referral_balance_cents || 0;

      if (balance < 2500) return res.status(400).json({ error: "Minimum cashout is $25.00" });

      await db.query("UPDATE users SET referral_balance_cents = 0 WHERE id = $1", [uid]);
      await db.query(
        "INSERT INTO referral_transactions (user_id, type, amount_cents, description) VALUES ($1,'cashout',$2,'Referral cashout')",
        [uid, -balance]
      );

      res.json({ ok: true, amount_cents: balance });
    } catch (err) { res.status(500).json({ error: "Cashout failed" }); }
  });

  console.log("[referrals] L2 module mounted — codes, commissions, credits, cashout");
};

// Export helper for cross-module use
module.exports.fireReferralEvent = fireReferralEvent;
