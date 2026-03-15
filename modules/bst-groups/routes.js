/**
 * BST Groups module routes
 * Buy/Sell/Trade groups with mod system, join requests, analytics.
 * Extracted from DT routes/bst-groups.js + PP BST handlers.
 */

const { canAccessModule } = require('../../lib/module-access');

module.exports = function mountBstGroups(app, db) {

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
  function denyIfDisabled(res) { res.status(404).json({ error: "Not found" }); }

  // Extracted from PP ppBstRequireMod — checks mod_user_id, member role, or admin
  async function requireGroupMod(req, res, slug) {
    var uid = await requireLogin(req, res); if (!uid) return null;
    var g = await db.query("SELECT id, mod_user_id FROM bst_groups WHERE slug=$1", [slug]);
    if (!g.rows.length) { res.status(404).json({ error: "Group not found" }); return null; }
    var group = g.rows[0];
    if (group.mod_user_id === uid) return { uid: uid, groupId: group.id };
    var m = await db.query("SELECT role FROM bst_group_members WHERE group_id=$1 AND user_id=$2 AND role IN ('mod','co-mod')", [group.id, uid]);
    if (m.rows.length) return { uid: uid, groupId: group.id };
    var u = await db.query("SELECT is_admin FROM users WHERE id=$1", [uid]);
    if (u.rows.length && u.rows[0].is_admin) return { uid: uid, groupId: group.id };
    res.status(403).json({ error: "Mod access required" }); return null;
  }

  function slugify(s) {
    return (s || "").toString().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
  }

  // ── GET /api/bst-groups ────────────────────────────────────
  // Extracted from DT GET /api/bst-groups/:city + PP GET /api/bst-groups
  app.get("/api/bst-groups", async function(req, res) {
    try {
      var conditions = ["g.status = 'active'"];
      var params = [];
      var idx = 1;
      if (req.query.place_slug) {
        conditions.push("g.place_id = (SELECT id FROM places WHERE slug=$" + idx++ + ")");
        params.push(req.query.place_slug);
      }
      var where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
      var result = await db.query(
        "SELECT g.*, u.display_name AS mod_display_name " +
        "FROM bst_groups g LEFT JOIN users u ON u.id = g.mod_user_id " +
        where + " ORDER BY g.featured DESC, g.member_count DESC",
        params
      );
      res.json({ groups: result.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/bst-groups/:slug ──────────────────────────────
  // Extracted from DT GET /api/bst-groups/:city/:slug + PP GET /api/bst-groups/:slug
  app.get("/api/bst-groups/:slug", async function(req, res) {
    try {
      var r = await db.query(
        "SELECT g.*, u.display_name AS mod_display_name " +
        "FROM bst_groups g LEFT JOIN users u ON u.id = g.mod_user_id " +
        "WHERE g.slug=$1",
        [req.params.slug]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Group not found" });
      res.json(r.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/bst-groups/:slug/members ──────────────────────
  // Extracted from PP GET /api/bst-groups/:slug/members
  app.get("/api/bst-groups/:slug/members", async function(req, res) {
    try {
      var g = await db.query("SELECT id FROM bst_groups WHERE slug=$1", [req.params.slug]);
      if (!g.rows.length) return res.status(404).json({ error: "Group not found" });
      var result = await db.query(
        "SELECT m.*, u.email, u.display_name, u.avatar_url " +
        "FROM bst_group_members m JOIN users u ON u.id = m.user_id " +
        "WHERE m.group_id=$1 AND m.approved=true ORDER BY m.joined_at DESC",
        [g.rows[0].id]
      );
      res.json({ members: result.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/bst-groups ───────────────────────────────────
  // Create group (admin only). Extracted from DT POST /api/bst-groups/create
  app.post("/api/bst-groups", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var b = req.body || {};
      if (!b.name) return res.status(400).json({ error: "name required" });
      var slug = slugify(b.name);
      var result = await db.query(
        "INSERT INTO bst_groups (place_id, name, slug, description, rules, facebook_group_url, " +
        "banner_color, is_private, group_type, mod_user_id, member_count, status) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,'active') RETURNING *",
        [b.place_id || null, b.name, slug, b.description || "", b.rules || "",
         b.facebook_group_url || "", b.banner_color || "#10b981",
         b.is_private || false, b.group_type || "seller",
         b.mod_user_id || admin.id]
      );
      var group = result.rows[0];
      // Add creator as mod member
      await db.query(
        "INSERT INTO bst_group_members (group_id, user_id, role, approved) VALUES ($1,$2,'mod',true) ON CONFLICT DO NOTHING",
        [group.id, group.mod_user_id]
      );
      res.status(201).json(group);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/bst-groups/:slug/join ────────────────────────
  // Extracted from DT + PP join logic: public=immediate, private=request
  app.post("/api/bst-groups/:slug/join", async function(req, res) {
    var uid = await requireLogin(req, res); if (!uid) return;
    try {
      var g = await db.query("SELECT id, is_private FROM bst_groups WHERE slug=$1 AND status='active'", [req.params.slug]);
      if (!g.rows.length) return res.status(404).json({ error: "Group not found" });
      var group = g.rows[0];

      // Check already member
      var existing = await db.query("SELECT id FROM bst_group_members WHERE group_id=$1 AND user_id=$2", [group.id, uid]);
      if (existing.rows.length) return res.json({ ok: true, status: "already_member" });

      if (group.is_private) {
        await db.query(
          "INSERT INTO bst_join_requests (group_id, user_id, message) VALUES ($1,$2,$3) ON CONFLICT (group_id, user_id) DO NOTHING",
          [group.id, uid, (req.body || {}).message || ""]
        );
        return res.json({ ok: true, status: "requested" });
      }

      await db.query(
        "INSERT INTO bst_group_members (group_id, user_id, role, approved) VALUES ($1,$2,'member',true) ON CONFLICT DO NOTHING",
        [group.id, uid]
      );
      await db.query("UPDATE bst_groups SET member_count = member_count + 1 WHERE id=$1", [group.id]);

      // ── Cross-module: sweeps, achievements (fire-and-forget) ──
      try { var sweeps = require('../sweepstakes/routes');
        if (sweeps.tryAwardSweepPoints) sweeps.tryAwardSweepPoints(db, uid, 'bst_join', 'bstjoin-' + group.id + '-' + uid, {}).catch(function(e) { console.error('sweeps bstjoin:', e.message); });
      } catch(e) {}
      try { var ach = require('../achievements/routes');
        if (ach.recordActivity) ach.recordActivity(db, uid, 'bst_join', { group_id: group.id }).catch(function(e) { console.error('ach bstjoin:', e.message); });
      } catch(e) {}

      res.json({ ok: true, status: "joined" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/bst-groups/:slug/apply ───────────────────────
  // Extracted from PP POST /api/bst-groups/apply + DT POST /api/bst-groups/apply
  app.post("/api/bst-groups/apply", async function(req, res) {
    try {
      var b = req.body || {};
      if (!b.applicant_name || !b.applicant_email || !b.group_name) {
        return res.status(400).json({ error: "applicant_name, applicant_email, group_name required" });
      }
      await db.query(
        "INSERT INTO bst_group_applications (applicant_name, applicant_email, group_name, facebook_group_url, facebook_group_size, why_apply) " +
        "VALUES ($1,$2,$3,$4,$5,$6)",
        [b.applicant_name, b.applicant_email, b.group_name, b.facebook_group_url || "", b.facebook_group_size || null, b.why_apply || ""]
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/bst-groups/:slug/join-requests ────────────────
  // Extracted from PP GET /api/bst-groups/:slug/join-requests
  app.get("/api/bst-groups/:slug/join-requests", async function(req, res) {
    var mod = await requireGroupMod(req, res, req.params.slug); if (!mod) return;
    try {
      var result = await db.query(
        "SELECT r.*, u.email, u.display_name, u.avatar_url " +
        "FROM bst_join_requests r JOIN users u ON u.id = r.user_id " +
        "WHERE r.group_id=$1 AND r.status='pending' ORDER BY r.created_at DESC",
        [mod.groupId]
      );
      res.json({ requests: result.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/bst-groups/:slug/join-requests/:id ───────────
  // Extracted from PP PATCH + DT PATCH approve/decline
  app.post("/api/bst-groups/:slug/join-requests/:id", async function(req, res) {
    var mod = await requireGroupMod(req, res, req.params.slug); if (!mod) return;
    try {
      var action = (req.body || {}).action;
      if (action !== "approve" && action !== "decline") return res.status(400).json({ error: "action must be approve or decline" });

      var rr = await db.query("SELECT * FROM bst_join_requests WHERE id=$1 AND group_id=$2", [req.params.id, mod.groupId]);
      if (!rr.rows.length) return res.status(404).json({ error: "Request not found" });
      var request = rr.rows[0];

      await db.query(
        "UPDATE bst_join_requests SET status=$1, reviewed_by=$2, reviewed_at=NOW() WHERE id=$3",
        [action === "approve" ? "approved" : "declined", mod.uid, request.id]
      );

      if (action === "approve") {
        await db.query(
          "INSERT INTO bst_group_members (group_id, user_id, role, approved) VALUES ($1,$2,'member',true) ON CONFLICT DO NOTHING",
          [mod.groupId, request.user_id]
        );
        await db.query("UPDATE bst_groups SET member_count = member_count + 1 WHERE id=$1", [mod.groupId]);
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/bst-groups/:slug/analytics ────────────────────
  // Extracted from PP GET /api/bst-groups/:slug/analytics
  app.get("/api/bst-groups/:slug/analytics", async function(req, res) {
    var mod = await requireGroupMod(req, res, req.params.slug); if (!mod) return;
    try {
      var mc = await db.query("SELECT COUNT(*)::integer AS c FROM bst_group_members WHERE group_id=$1 AND approved=true", [mod.groupId]);
      var newM = await db.query(
        "SELECT COUNT(*)::integer AS c FROM bst_group_members WHERE group_id=$1 AND approved=true AND joined_at >= date_trunc('month', NOW())",
        [mod.groupId]
      );
      var pending = await db.query(
        "SELECT COUNT(*)::integer AS c FROM bst_join_requests WHERE group_id=$1 AND status='pending'",
        [mod.groupId]
      );
      res.json({
        memberCount: mc.rows[0].c,
        newThisMonth: newM.rows[0].c,
        pendingRequests: pending.rows[0].c
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── DELETE /api/bst-groups/:slug/members/:userId ───────────
  // Extracted from PP DELETE + DT DELETE
  app.delete("/api/bst-groups/:slug/members/:userId", async function(req, res) {
    var mod = await requireGroupMod(req, res, req.params.slug); if (!mod) return;
    try {
      var targetId = parseInt(req.params.userId, 10);
      if (targetId === mod.uid) return res.status(400).json({ error: "Cannot remove yourself" });
      await db.query("DELETE FROM bst_group_members WHERE group_id=$1 AND user_id=$2", [mod.groupId, targetId]);
      await db.query(
        "UPDATE bst_groups SET member_count = GREATEST(0, (SELECT COUNT(*)::integer FROM bst_group_members WHERE group_id=$1 AND approved=true)) WHERE id=$1",
        [mod.groupId]
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/admin/bst-groups/applications ─────────────────
  app.get("/api/admin/bst-groups/applications", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var result = await db.query("SELECT * FROM bst_group_applications ORDER BY created_at DESC");
      res.json({ applications: result.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Serve mod dashboard ────────────────────────────────────
  var path = require("path");
  app.get("/bst-groups/:slug/mod", async function(req, res) {
    res.sendFile(path.join(__dirname, "public", "mod.html"));
  });

};
