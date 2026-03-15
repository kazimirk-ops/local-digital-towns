/**
 * Sweepstakes module routes (L2)
 * Points, entries, draws, prizes, wheel.
 * Extracted from Sebastian server.js + data.js sweep system.
 */
const { canAccessModule } = require('../../lib/module-access');
var crypto = require("crypto");
var path = require("path");
var express = require("express");

// ── tryAwardSweepPoints (exported for cross-module use) ──
// Extracted from Sebastian data.js tryAwardSweepForEvent
async function tryAwardSweepPoints(db, userId, ruleType, eventKey, meta) {
  try {
    // Find enabled rules matching this ruleType
    var rulesR = await db.query(
      "SELECT * FROM sweep_rules WHERE rule_type = $1 AND enabled = true",
      [ruleType]
    );
    if (!rulesR.rows.length) return { awarded: false, reason: "no_matching_rule" };

    var totalAwarded = 0;
    for (var i = 0; i < rulesR.rows.length; i++) {
      var rule = rulesR.rows[i];

      // Check cooldown
      if (rule.cooldown_seconds > 0) {
        var cooldownR = await db.query(
          "SELECT id FROM sweep_award_events WHERE rule_id=$1 AND user_id=$2 AND created_at > NOW() - ($3 || ' seconds')::interval LIMIT 1",
          [rule.id, userId, rule.cooldown_seconds]
        );
        if (cooldownR.rows.length) continue;
      }

      // Check daily cap
      if (rule.daily_cap > 0) {
        var today = new Date().toISOString().slice(0, 10);
        var capR = await db.query(
          "SELECT COUNT(*)::integer AS cnt FROM sweep_award_events WHERE rule_id=$1 AND user_id=$2 AND created_at::date = $3::date",
          [rule.id, userId, today]
        );
        if ((capR.rows[0].cnt || 0) >= rule.daily_cap) continue;
      }

      // Determine amount (buyer/seller differentiation)
      var amount = rule.amount || 0;
      if (meta && meta.isBuyer && rule.buyer_amount != null) amount = rule.buyer_amount;
      if (meta && meta.isSeller && rule.seller_amount != null) amount = rule.seller_amount;
      if (amount <= 0) continue;

      // Check duplicate via event_key
      if (eventKey) {
        var dupR = await db.query(
          "SELECT id FROM sweep_award_events WHERE rule_id=$1 AND event_key=$2 LIMIT 1",
          [rule.id, eventKey]
        );
        if (dupR.rows.length) continue;
      }

      // Award points
      await db.query(
        "INSERT INTO sweep_award_events (user_id, rule_id, event_key) VALUES ($1,$2,$3)",
        [userId, rule.id, eventKey || ("auto:" + Date.now())]
      );
      await db.query(
        "INSERT INTO sweep_ledger (user_id, amount, reason, event_id, meta_json) VALUES ($1,$2,$3,$4,$5)",
        [userId, amount, ruleType, eventKey || null, JSON.stringify(meta || {})]
      );
      totalAwarded += amount;
    }

    return { awarded: totalAwarded > 0, amount: totalAwarded };
  } catch (err) {
    console.error("[sweepstakes] tryAwardSweepPoints error:", err.message);
    return { awarded: false, reason: "error" };
  }
}

module.exports = function mountSweepstakes(app, db) {

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

  // ── Serve public files ──
  app.use("/sweep", express.static(path.join(__dirname, "public")));

  // ══════════════════════════════════════
  // Balance & Rules
  // ══════════════════════════════════════

  // ── GET /api/sweep/balance ──
  app.get("/api/sweep/balance", async function(req, res) {
    try {
      if (!(await checkFlag(req, "sweepstakes"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;
      var r = await db.query("SELECT COALESCE(SUM(amount),0)::integer AS bal FROM sweep_ledger WHERE user_id=$1", [uid]);
      res.json({ balance: r.rows[0].bal || 0 });
    } catch (err) { res.status(500).json({ error: "Failed to fetch balance" }); }
  });

  // ── GET /api/sweep/leaderboard ──
  app.get("/api/sweep/leaderboard", async function(req, res) {
    try {
      if (!(await checkFlag(req, "sweepstakes"))) return denyIfDisabled(res);
      var sweepId = req.query.sweepstake_id || req.query.sweepId;
      var query_str = sweepId
        ? "SELECT se.user_id, u.display_name, SUM(se.entries)::integer AS total_entries FROM sweepstake_entries se LEFT JOIN users u ON u.id=se.user_id WHERE se.sweepstake_id=$1 GROUP BY se.user_id, u.display_name ORDER BY total_entries DESC LIMIT 50"
        : "SELECT user_id, u.display_name, SUM(amount)::integer AS total_points FROM sweep_ledger sl LEFT JOIN users u ON u.id=sl.user_id GROUP BY user_id, u.display_name ORDER BY total_points DESC LIMIT 50";
      var params = sweepId ? [sweepId] : [];
      var r = await db.query(query_str, params);
      res.json({ leaderboard: r.rows });
    } catch (err) { res.status(500).json({ error: "Failed" }); }
  });

  // ── GET /api/sweep/rules ──
  app.get("/api/sweep/rules", async function(req, res) {
    try {
      if (!(await checkFlag(req, "sweepstakes"))) return denyIfDisabled(res);
      var sweepId = req.query.sweepstake_id;
      var r;
      if (sweepId) {
        r = await db.query(
          "SELECT rule_type, amount, buyer_amount, seller_amount, daily_cap, cooldown_seconds FROM sweep_rules WHERE enabled=true AND (sweepstake_id=$1 OR sweepstake_id IS NULL) ORDER BY rule_type",
          [sweepId]
        );
      } else {
        r = await db.query(
          "SELECT rule_type, amount, buyer_amount, seller_amount, daily_cap, cooldown_seconds FROM sweep_rules WHERE enabled=true AND sweepstake_id IS NULL ORDER BY rule_type"
        );
      }
      res.json({ rules: r.rows });
    } catch (err) { res.status(500).json({ error: "Failed" }); }
  });

  // ══════════════════════════════════════
  // Sweepstakes CRUD
  // ══════════════════════════════════════

  // ── GET /api/sweepstakes ──
  app.get("/api/sweepstakes", async function(req, res) {
    try {
      if (!(await checkFlag(req, "sweepstakes"))) return denyIfDisabled(res);
      var uid = await getUserId(req);
      var r = await db.query(
        "SELECT s.*, " +
        "(SELECT COALESCE(SUM(entries),0)::integer FROM sweepstake_entries WHERE sweepstake_id=s.id) AS total_entries, " +
        "(SELECT COUNT(DISTINCT user_id)::integer FROM sweepstake_entries WHERE sweepstake_id=s.id) AS participant_count " +
        "FROM sweepstakes s WHERE s.status IN ('active','upcoming') ORDER BY s.created_at DESC"
      );

      // Add user's entries if logged in
      var sweeps = r.rows;
      if (uid) {
        for (var i = 0; i < sweeps.length; i++) {
          var ue = await db.query(
            "SELECT COALESCE(SUM(entries),0)::integer AS ent FROM sweepstake_entries WHERE sweepstake_id=$1 AND user_id=$2",
            [sweeps[i].id, uid]
          );
          sweeps[i].user_entries = ue.rows[0].ent;
        }
      }
      res.json({ sweepstakes: sweeps });
    } catch (err) { res.status(500).json({ error: "Failed to fetch sweepstakes" }); }
  });

  // ── GET /api/sweepstakes/:id ──
  app.get("/api/sweepstakes/:id", async function(req, res) {
    try {
      var r = await db.query("SELECT * FROM sweepstakes WHERE id=$1", [req.params.id]);
      if (!r.rows.length) return res.status(404).json({ error: "Not found" });
      res.json(r.rows[0]);
    } catch (err) { res.status(500).json({ error: "Failed" }); }
  });

  // ── POST /api/sweepstakes (admin create) ──
  app.post("/api/sweepstakes", async function(req, res) {
    try {
      if (!(await checkFlag(req, "sweepstakes"))) return denyIfDisabled(res);
      var admin = await requireAdmin(req, res); if (!admin) return;
      var b = req.body || {};
      if (!b.title || !b.prize) return res.status(400).json({ error: "title and prize required" });

      var r = await db.query(
        "INSERT INTO sweepstakes (title, prize, prize_description, prize_image_url, prize_value, " +
        "donor_name, donor_user_id, entry_cost, start_at, end_at, draw_at, max_entries_per_user_per_day, status) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *",
        [b.title, b.prize, b.description || null, b.image_url || null,
         parseInt(b.prize_value) || 0, b.donor_name || null, b.donor_user_id || null,
         parseInt(b.entry_cost) || 1, b.start_at || null, b.end_at || null,
         b.draw_at || null, parseInt(b.max_entries_per_user_per_day) || 10,
         b.status || "active"]
      );
      res.status(201).json(r.rows[0]);
    } catch (err) { res.status(500).json({ error: "Failed to create sweepstake" }); }
  });

  // ── POST /api/sweepstakes/:id/enter ──
  // Extracted from Sebastian POST /sweepstake/enter
  app.post("/api/sweepstakes/:id/enter", async function(req, res) {
    try {
      if (!(await checkFlag(req, "sweepstakes"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var sweep = await db.query("SELECT * FROM sweepstakes WHERE id=$1", [req.params.id]);
      if (!sweep.rows.length) return res.status(404).json({ error: "Sweepstake not found" });
      var s = sweep.rows[0];
      if (s.status !== "active") return res.status(400).json({ error: "Sweepstake not active" });

      // Check time window
      if (s.end_at && new Date(s.end_at) < new Date()) return res.status(400).json({ error: "Sweepstake has ended" });

      var entries = parseInt((req.body || {}).entries) || 1;
      if (entries < 1 || entries > 50) return res.status(400).json({ error: "Entries must be 1-50" });

      var cost = (s.entry_cost || 1) * entries;

      // Check balance
      var balR = await db.query("SELECT COALESCE(SUM(amount),0)::integer AS bal FROM sweep_ledger WHERE user_id=$1", [uid]);
      var balance = balR.rows[0].bal || 0;
      if (balance < cost) return res.status(400).json({ error: "Insufficient balance. Need " + cost + ", have " + balance });

      // Check daily cap
      var today = new Date().toISOString().slice(0, 10);
      if (s.max_entries_per_user_per_day > 0) {
        var dayR = await db.query(
          "SELECT COALESCE(SUM(entries),0)::integer AS ent FROM sweepstake_entries WHERE sweepstake_id=$1 AND user_id=$2 AND day_key=$3",
          [req.params.id, uid, today]
        );
        if ((dayR.rows[0].ent || 0) + entries > s.max_entries_per_user_per_day) {
          return res.status(400).json({ error: "Daily entry limit reached" });
        }
      }

      // Deduct balance and add entry
      await db.query(
        "INSERT INTO sweep_ledger (user_id, amount, reason, event_id) VALUES ($1,$2,'sweepstake_entry',$3)",
        [uid, -cost, "sweep:" + req.params.id]
      );
      await db.query(
        "INSERT INTO sweepstake_entries (sweepstake_id, user_id, entries, day_key) VALUES ($1,$2,$3,$4)",
        [req.params.id, uid, entries, today]
      );

      // Return updated state
      var newBal = await db.query("SELECT COALESCE(SUM(amount),0)::integer AS bal FROM sweep_ledger WHERE user_id=$1", [uid]);
      var totals = await db.query("SELECT COALESCE(SUM(entries),0)::integer AS t FROM sweepstake_entries WHERE sweepstake_id=$1", [req.params.id]);
      var userE = await db.query("SELECT COALESCE(SUM(entries),0)::integer AS e FROM sweepstake_entries WHERE sweepstake_id=$1 AND user_id=$2", [req.params.id, uid]);

      res.json({ ok: true, balance: newBal.rows[0].bal, total_entries: totals.rows[0].t, user_entries: userE.rows[0].e });
    } catch (err) {
      console.error("sweep enter error:", err.message);
      res.status(500).json({ error: "Failed to enter sweepstake" });
    }
  });

  // ── GET /api/sweepstakes/:id/entries ──
  app.get("/api/sweepstakes/:id/entries", async function(req, res) {
    try {
      var r = await db.query(
        "SELECT se.user_id, u.display_name, SUM(se.entries)::integer AS total_entries " +
        "FROM sweepstake_entries se LEFT JOIN users u ON u.id=se.user_id " +
        "WHERE se.sweepstake_id=$1 GROUP BY se.user_id, u.display_name ORDER BY total_entries DESC",
        [req.params.id]
      );
      res.json({ entries: r.rows });
    } catch (err) { res.status(500).json({ error: "Failed" }); }
  });

  // ── POST /api/sweepstakes/:id/draw (admin) ──
  // Extracted from Sebastian cryptographic draw
  app.post("/api/sweepstakes/:id/draw", async function(req, res) {
    try {
      if (!(await checkFlag(req, "sweepstakes.admin-draw"))) return denyIfDisabled(res);
      var admin = await requireAdmin(req, res); if (!admin) return;

      // Get all entries
      var entriesR = await db.query(
        "SELECT user_id, SUM(entries)::integer AS total FROM sweepstake_entries WHERE sweepstake_id=$1 GROUP BY user_id",
        [req.params.id]
      );
      if (!entriesR.rows.length) return res.status(400).json({ error: "No entries" });

      var totalEntries = 0;
      var pool = [];
      for (var i = 0; i < entriesR.rows.length; i++) {
        var e = entriesR.rows[i];
        totalEntries += e.total;
        pool.push({ user_id: e.user_id, entries: e.total });
      }

      // Cryptographic random selection (weighted by entries)
      var pick = crypto.randomInt(totalEntries);
      var cumulative = 0;
      var winnerId = null;
      for (var j = 0; j < pool.length; j++) {
        cumulative += pool[j].entries;
        if (pick < cumulative) { winnerId = pool[j].user_id; break; }
      }

      // Get winner display name
      var winnerR = await db.query("SELECT display_name, email FROM users WHERE id=$1", [winnerId]);
      var winnerName = winnerR.rows.length ? winnerR.rows[0].display_name : "Unknown";

      // Create draw record with snapshot
      var snapshot = { participants: pool, total_entries: totalEntries, pick_index: pick };
      var draw = await db.query(
        "INSERT INTO sweep_draws (sweep_id, created_by_user_id, winner_user_id, total_entries, snapshot_json) " +
        "VALUES ($1,$2,$3,$4,$5) RETURNING *",
        [req.params.id, admin.id, winnerId, totalEntries, JSON.stringify(snapshot)]
      );

      // Update sweepstake winner
      await db.query("UPDATE sweepstakes SET winner_user_id=$1, status='drawn' WHERE id=$2", [winnerId, req.params.id]);

      // Notify winner
      try {
        await db.query(
          "INSERT INTO notifications (user_id, type, title, body, data) VALUES ($1,'sweep_win',$2,$3,$4)",
          [winnerId, "You won the sweepstake!", "Congratulations! Check your prizes.",
           JSON.stringify({ sweep_id: parseInt(req.params.id), draw_id: draw.rows[0].id })]
        );
      } catch(nErr) { console.error("sweep draw notification error:", nErr.message); }

      res.json({
        ok: true, draw: draw.rows[0],
        winner: { user_id: winnerId, display_name: winnerName },
        total_entries: totalEntries, participants: pool.length
      });
    } catch (err) {
      console.error("sweep draw error:", err.message);
      res.status(500).json({ error: "Draw failed" });
    }
  });

  // ── POST /api/sweep/claim/:award_id ──
  // Extracted from Sebastian claim workflow
  app.post("/api/sweep/claim/:award_id", async function(req, res) {
    try {
      var uid = await requireLogin(req, res); if (!uid) return;

      var draw = await db.query("SELECT * FROM sweep_draws WHERE id=$1", [req.params.award_id]);
      if (!draw.rows.length) return res.status(404).json({ error: "Draw not found" });
      var d = draw.rows[0];
      if (d.winner_user_id !== uid) return res.status(403).json({ error: "Not the winner" });
      if (d.claimed_at) return res.status(400).json({ error: "Already claimed" });

      var b = req.body || {};
      await db.query(
        "UPDATE sweep_draws SET claimed_at=NOW(), claimed_by_user_id=$1, claimed_message=$2, claimed_photo_url=$3 WHERE id=$4",
        [uid, b.message || null, b.photo_url || null, req.params.award_id]
      );

      res.json({ ok: true, claimed: true });
    } catch (err) { res.status(500).json({ error: "Claim failed" }); }
  });

  // ══════════════════════════════════════
  // Prize Offers
  // ══════════════════════════════════════

  // ── GET /api/prize-offers ──
  app.get("/api/prize-offers", async function(req, res) {
    try {
      if (!(await checkFlag(req, "sweepstakes.prize-offers"))) return denyIfDisabled(res);
      var status = req.query.status || "approved";
      var r = await db.query(
        "SELECT * FROM prize_offers WHERE status=$1 ORDER BY created_at DESC LIMIT 50",
        [status]
      );
      res.json({ offers: r.rows });
    } catch (err) { res.status(500).json({ error: "Failed" }); }
  });

  // ── POST /api/prize-offers ──
  app.post("/api/prize-offers", async function(req, res) {
    try {
      if (!(await checkFlag(req, "sweepstakes.prize-offers"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var b = req.body || {};
      if (!b.title) return res.status(400).json({ error: "title required" });

      var r = await db.query(
        "INSERT INTO prize_offers (title, description, value_cents, prize_type, image_url, " +
        "donor_user_id, donor_place_id, donor_display_name) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
        [b.title, b.description || null, parseInt(b.value_cents) || 0,
         b.prize_type || "physical", b.image_url || null,
         uid, b.place_id || null, b.donor_display_name || null]
      );
      res.status(201).json(r.rows[0]);
    } catch (err) { res.status(500).json({ error: "Failed to create offer" }); }
  });

  // ── PUT /api/prize-offers/:id ──
  app.put("/api/prize-offers/:id", async function(req, res) {
    try {
      var admin = await requireAdmin(req, res); if (!admin) return;
      var b = req.body || {};
      var r = await db.query(
        "UPDATE prize_offers SET status=COALESCE($1,status), reviewed_at=NOW(), " +
        "reviewed_by_user_id=$2, decision_reason=$3 WHERE id=$4 RETURNING *",
        [b.status || null, admin.id, b.reason || null, req.params.id]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Not found" });
      res.json(r.rows[0]);
    } catch (err) { res.status(500).json({ error: "Failed" }); }
  });

  // ── DELETE /api/prize-offers/:id ──
  app.delete("/api/prize-offers/:id", async function(req, res) {
    try {
      var admin = await requireAdmin(req, res); if (!admin) return;
      await db.query("DELETE FROM prize_offers WHERE id=$1", [req.params.id]);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: "Failed" }); }
  });

  // ══════════════════════════════════════
  // Admin sweep management
  // ══════════════════════════════════════

  // ── GET /api/admin/sweep/rules ──
  app.get("/api/admin/sweep/rules", async function(req, res) {
    try {
      var admin = await requireAdmin(req, res); if (!admin) return;
      var r = await db.query("SELECT * FROM sweep_rules ORDER BY rule_type, sweepstake_id");
      res.json({ rules: r.rows });
    } catch (err) { res.status(500).json({ error: "Failed" }); }
  });

  // ── POST /api/admin/sweep/rules ──
  app.post("/api/admin/sweep/rules", async function(req, res) {
    try {
      var admin = await requireAdmin(req, res); if (!admin) return;
      var b = req.body || {};
      if (!b.rule_type) return res.status(400).json({ error: "rule_type required" });
      var r = await db.query(
        "INSERT INTO sweep_rules (rule_type, enabled, amount, buyer_amount, seller_amount, daily_cap, cooldown_seconds, sweepstake_id) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
        [b.rule_type, b.enabled !== false, parseInt(b.amount) || 0,
         b.buyer_amount != null ? parseInt(b.buyer_amount) : null,
         b.seller_amount != null ? parseInt(b.seller_amount) : null,
         parseInt(b.daily_cap) || 0, parseInt(b.cooldown_seconds) || 0,
         b.sweepstake_id || null]
      );
      res.status(201).json(r.rows[0]);
    } catch (err) { res.status(500).json({ error: "Failed to create rule" }); }
  });

  // ── DELETE /api/admin/sweep/rules/:id ──
  app.delete("/api/admin/sweep/rules/:id", async function(req, res) {
    try {
      var admin = await requireAdmin(req, res); if (!admin) return;
      await db.query("DELETE FROM sweep_rules WHERE id=$1", [req.params.id]);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: "Failed" }); }
  });

  console.log("[sweepstakes] L2 module mounted — points, entries, draws, prizes, wheel");
};

// Export helper for cross-module use
module.exports.tryAwardSweepPoints = tryAwardSweepPoints;
