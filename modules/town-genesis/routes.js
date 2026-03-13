/**
 * Town Genesis module routes (L3)
 * Genesis map, thresholds, auto-provisioning of new towns
 * from location signals and zip cluster data.
 *
 * Dependencies: core, places, location-graph
 */

module.exports = function mountTownGenesis(app, db) {

  var path = require("path");
  var express = require("express");

  // ── helpers ──────────────────────────────────────────────────
  function parseCookies(req) {
    var obj = {};
    var header = req.headers.cookie || "";
    header.split(";").forEach(function(pair) {
      var idx = pair.indexOf("=");
      if (idx < 0) return;
      var key = pair.slice(0, idx).trim();
      obj[key] = pair.slice(idx + 1).trim();
    });
    return obj;
  }

  async function getUserId(req) {
    var sid = parseCookies(req).sid;
    if (!sid) return null;
    var r = await db.query(
      "SELECT user_id FROM sessions WHERE sid=$1 AND expires_at > NOW()",
      [sid]
    );
    return r.rows.length ? r.rows[0].user_id : null;
  }

  async function requireLogin(req, res) {
    var uid = await getUserId(req);
    if (!uid) { res.status(401).json({ error: "Login required" }); return null; }
    return uid;
  }

  async function requireAdmin(req, res) {
    var uid = await requireLogin(req, res);
    if (!uid) return null;
    var r = await db.query("SELECT id, is_admin FROM users WHERE id=$1", [uid]);
    if (!r.rows.length || !r.rows[0].is_admin) {
      res.status(403).json({ error: "Admin required" });
      return null;
    }
    return r.rows[0];
  }

  // ── Feature flag enforcement ──
  async function checkFlag(req, flag) {
    var community = req.community || { slug: "digitaltowns", feature_flags: {} };
    var flags = community.feature_flags || {};
    if (flags[flag] !== undefined) return !!flags[flag];
    return true; // default enabled
  }
  function denyIfDisabled(res) {
    res.status(404).json({ error: "Module not enabled" });
  }

  // ──────────────────────────────────────────────────────────────
  // GET /api/genesis/candidates
  // Public — list genesis candidates ordered by progress
  // ──────────────────────────────────────────────────────────────
  app.get("/api/genesis/candidates", async function(req, res) {
    try {
      if (!(await checkFlag(req, "town-genesis"))) return denyIfDisabled(res);

      var result = await db.query(
        "SELECT id, name, zip, city, state, lat, lng, signal_count, threshold, " +
        "progress_pct, status, place_id, auto_provisioned, created_at, updated_at " +
        "FROM genesis_candidates ORDER BY progress_pct DESC"
      );
      res.json({ candidates: result.rows });
    } catch (err) {
      console.error("GET /api/genesis/candidates error:", err.message);
      res.status(500).json({ error: "Failed to fetch genesis candidates" });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // GET /api/genesis/map-data
  // THE KEY ENDPOINT for the genesis map
  // Returns towns + clusters + candidates for map rendering
  // ──────────────────────────────────────────────────────────────
  app.get("/api/genesis/map-data", async function(req, res) {
    try {
      if (!(await checkFlag(req, "town-genesis.map"))) return denyIfDisabled(res);

      // a) Existing towns with member counts
      var townsResult = await db.query(
        "SELECT p.id, p.name, p.slug, p.lat, p.lng, p.level, p.level_progress, p.status, " +
        "(SELECT COUNT(*)::integer FROM place_memberships WHERE place_id = p.id) AS member_count " +
        "FROM places p WHERE p.type = 'town' AND p.lat IS NOT NULL AND p.lng IS NOT NULL"
      );

      // b) Zip clusters with signal data
      var clustersResult = await db.query(
        "SELECT * FROM zip_clusters WHERE signal_count > 0 ORDER BY signal_count DESC"
      );

      // c) Genesis candidates not yet provisioned
      var candidatesResult = await db.query(
        "SELECT * FROM genesis_candidates WHERE status != 'provisioned' ORDER BY progress_pct DESC"
      );

      res.json({
        towns: townsResult.rows,
        clusters: clustersResult.rows,
        candidates: candidatesResult.rows
      });
    } catch (err) {
      console.error("GET /api/genesis/map-data error:", err.message);
      res.status(500).json({ error: "Failed to fetch map data" });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // POST /api/genesis/:id/provision
  // Admin only — provision a genesis candidate into a real town
  // ──────────────────────────────────────────────────────────────
  app.post("/api/genesis/:id/provision", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      if (!(await checkFlag(req, "town-genesis.auto-provision"))) return denyIfDisabled(res);

      var candidateId = parseInt(req.params.id, 10);
      if (!candidateId) return res.status(400).json({ error: "Invalid candidate id" });

      // Fetch candidate
      var c = await db.query("SELECT * FROM genesis_candidates WHERE id=$1", [candidateId]);
      if (!c.rows.length) return res.status(404).json({ error: "Candidate not found" });
      var candidate = c.rows[0];

      if (candidate.status === "provisioned") {
        return res.status(400).json({ error: "Candidate already provisioned" });
      }

      // Build slug: lower(city) + '-' + lower(state), spaces replaced by dashes
      var slug = (candidate.city.toLowerCase() + "-" + candidate.state.toLowerCase())
        .replace(/\s+/g, "-");

      // Create the new place
      var placeResult = await db.query(
        "INSERT INTO places (name, slug, type, status, lat, lng, level, level_progress, county) " +
        "VALUES ($1, $2, 'town', 'pending', $3, $4, 0, 0, $5) RETURNING *",
        [candidate.name, slug, candidate.lat, candidate.lng, candidate.state]
      );
      var newPlace = placeResult.rows[0];

      // Update genesis candidate
      await db.query(
        "UPDATE genesis_candidates SET status = 'provisioned', place_id = $1, " +
        "provisioned_at = NOW(), updated_at = NOW() WHERE id = $2",
        [newPlace.id, candidateId]
      );

      res.json({ place: newPlace, candidate_id: candidateId });
    } catch (err) {
      console.error("POST /api/genesis/:id/provision error:", err.message);
      res.status(500).json({ error: "Failed to provision town" });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // Serve genesis map HTML
  // ──────────────────────────────────────────────────────────────
  app.get("/genesis", function(req, res) {
    res.sendFile(path.join(__dirname, "public", "genesis.html"));
  });
  app.use("/genesis", express.static(path.join(__dirname, "public")));

  console.log("[town-genesis] L3 module mounted — genesis map, thresholds, provisioning");
};
