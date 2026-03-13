/**
 * Location Graph module routes (L3)
 * Location signals from niche sales + ZIP clustering for town genesis.
 *
 * Dependencies: core, places, niche-network
 */

// ── Exported cross-module helper ─────────────────────────────────
async function recordLocationSignal(db, saleEvent) {
  // saleEvent = { id, ship_to_zip, ship_to_city, ship_to_state, ship_to_country, platform_slug, buyer_email, place_id, user_id }
  try {
    // 1. Insert location_signals row
    await db.query(
      "INSERT INTO location_signals (zip, city, state, country, place_id, platform_slug, sale_event_id, user_id, buyer_email) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [saleEvent.ship_to_zip || '', saleEvent.ship_to_city || '', saleEvent.ship_to_state || '',
       saleEvent.ship_to_country || 'US', saleEvent.place_id || null, saleEvent.platform_slug || '',
       saleEvent.id, saleEvent.user_id || null, saleEvent.buyer_email || '']
    );

    // 2. Upsert zip_clusters
    await db.query(
      "INSERT INTO zip_clusters (zip, city, state, signal_count, unique_buyers, place_id, last_signal_at, updated_at) " +
      "VALUES ($1, $2, $3, 1, 1, $4, NOW(), NOW()) " +
      "ON CONFLICT (zip) DO UPDATE SET " +
      "signal_count = zip_clusters.signal_count + 1, " +
      "last_signal_at = NOW(), updated_at = NOW(), " +
      "place_id = COALESCE(zip_clusters.place_id, $4)",
      [saleEvent.ship_to_zip || '', saleEvent.ship_to_city || '', saleEvent.ship_to_state || '', saleEvent.place_id || null]
    );

    // 3. Update unique_buyers count accurately
    var uniqueR = await db.query(
      "SELECT COUNT(DISTINCT buyer_email)::integer AS cnt FROM location_signals WHERE zip = $1 AND buyer_email IS NOT NULL AND buyer_email != ''",
      [saleEvent.ship_to_zip || '']
    );
    var uniqueCount = uniqueR.rows[0].cnt || 0;

    // 4. Check genesis eligibility
    var clusterR = await db.query(
      "SELECT signal_count, genesis_threshold FROM zip_clusters WHERE zip = $1",
      [saleEvent.ship_to_zip || '']
    );
    var cluster = clusterR.rows[0];
    var isEligible = cluster && cluster.signal_count >= cluster.genesis_threshold;

    await db.query(
      "UPDATE zip_clusters SET unique_buyers = $1, genesis_eligible = $2 WHERE zip = $3",
      [uniqueCount, isEligible, saleEvent.ship_to_zip || '']
    );

    return { ok: true, genesis_eligible: isEligible };
  } catch (err) {
    console.error("[location-graph] recordLocationSignal error:", err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = function mountLocationGraph(app, db) {

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
  // GET /api/location-graph
  // Public — returns zip_clusters with signal_count >= 1
  // Groups into mapped (have place_id) and unmapped (place_id IS NULL)
  // ──────────────────────────────────────────────────────────────
  app.get("/api/location-graph", async function(req, res) {
    try {
      if (!(await checkFlag(req, "location-graph"))) return denyIfDisabled(res);

      var result = await db.query(
        "SELECT zc.*, p.name AS place_name " +
        "FROM zip_clusters zc " +
        "LEFT JOIN places p ON p.id = zc.place_id " +
        "WHERE zc.signal_count >= 1 " +
        "ORDER BY zc.signal_count DESC"
      );

      var mapped = [];
      var unmapped = [];
      result.rows.forEach(function(row) {
        if (row.place_id) {
          mapped.push(row);
        } else {
          unmapped.push(row);
        }
      });

      res.json({ mapped: mapped, unmapped: unmapped });
    } catch (err) {
      console.error("[location-graph] GET /api/location-graph error:", err.message);
      res.status(500).json({ error: "Internal error" });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // GET /api/location-graph/clusters
  // Public — query zip_clusters with optional filters
  // ?state= ?min_signals=1 ?limit=100
  // ──────────────────────────────────────────────────────────────
  app.get("/api/location-graph/clusters", async function(req, res) {
    try {
      if (!(await checkFlag(req, "location-graph.clustering"))) return denyIfDisabled(res);

      var conditions = [];
      var params = [];
      var idx = 1;

      var minSignals = parseInt(req.query.min_signals, 10);
      if (isNaN(minSignals) || minSignals < 1) minSignals = 1;
      conditions.push("signal_count >= $" + idx++);
      params.push(minSignals);

      if (req.query.state) {
        conditions.push("state = $" + idx++);
        params.push(req.query.state);
      }

      var limit = parseInt(req.query.limit, 10);
      if (isNaN(limit) || limit < 1 || limit > 1000) limit = 100;

      var where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

      var result = await db.query(
        "SELECT * FROM zip_clusters " + where +
        " ORDER BY signal_count DESC LIMIT $" + idx,
        params.concat([limit])
      );

      res.json({ clusters: result.rows });
    } catch (err) {
      console.error("[location-graph] GET /api/location-graph/clusters error:", err.message);
      res.status(500).json({ error: "Internal error" });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // GET /api/location-graph/stats
  // Public — aggregate stats for the location graph
  // ──────────────────────────────────────────────────────────────
  app.get("/api/location-graph/stats", async function(req, res) {
    try {
      if (!(await checkFlag(req, "location-graph"))) return denyIfDisabled(res);

      var totalR = await db.query("SELECT COUNT(*)::integer AS cnt FROM location_signals");
      var uniqueZipsR = await db.query("SELECT COUNT(DISTINCT zip)::integer AS cnt FROM location_signals");
      var mappedR = await db.query("SELECT COUNT(*)::integer AS cnt FROM location_signals WHERE place_id IS NOT NULL");
      var unmappedR = await db.query("SELECT COUNT(*)::integer AS cnt FROM location_signals WHERE place_id IS NULL");
      var topZipsR = await db.query(
        "SELECT * FROM zip_clusters ORDER BY signal_count DESC LIMIT 10"
      );

      res.json({
        total_signals: totalR.rows[0].cnt || 0,
        unique_zips: uniqueZipsR.rows[0].cnt || 0,
        mapped_signals: mappedR.rows[0].cnt || 0,
        unmapped_signals: unmappedR.rows[0].cnt || 0,
        top_zips: topZipsR.rows
      });
    } catch (err) {
      console.error("[location-graph] GET /api/location-graph/stats error:", err.message);
      res.status(500).json({ error: "Internal error" });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // GET /api/admin/location-graph/unmapped
  // Admin — ZIPs with signals but no place_id
  // ──────────────────────────────────────────────────────────────
  app.get("/api/admin/location-graph/unmapped", async function(req, res) {
    try {
      var admin = await requireAdmin(req, res);
      if (!admin) return;

      var result = await db.query(
        "SELECT * FROM zip_clusters " +
        "WHERE place_id IS NULL AND signal_count > 0 " +
        "ORDER BY signal_count DESC"
      );

      res.json({ unmapped: result.rows });
    } catch (err) {
      console.error("[location-graph] GET /api/admin/location-graph/unmapped error:", err.message);
      res.status(500).json({ error: "Internal error" });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // POST /api/admin/location-graph/assign
  // Admin — assign a place_id to a ZIP cluster and its signals
  // Body: { zip, place_id }
  // ──────────────────────────────────────────────────────────────
  app.post("/api/admin/location-graph/assign", async function(req, res) {
    try {
      var admin = await requireAdmin(req, res);
      if (!admin) return;

      var zip = req.body.zip;
      var placeId = req.body.place_id;
      if (!zip || !placeId) {
        return res.status(400).json({ error: "zip and place_id are required" });
      }

      await db.query(
        "UPDATE zip_clusters SET place_id = $1 WHERE zip = $2",
        [placeId, zip]
      );

      await db.query(
        "UPDATE location_signals SET place_id = $1 WHERE zip = $2 AND place_id IS NULL",
        [placeId, zip]
      );

      res.json({ ok: true, zip: zip, place_id: placeId });
    } catch (err) {
      console.error("[location-graph] POST /api/admin/location-graph/assign error:", err.message);
      res.status(500).json({ error: "Internal error" });
    }
  });

  console.log("[location-graph] L3 module mounted — signals, clustering, thresholds");
};

module.exports.recordLocationSignal = recordLocationSignal;
