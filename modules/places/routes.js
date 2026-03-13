/**
 * Places module routes
 * Geographic hierarchy, domain routing, Haversine geo filter,
 * place memberships, place requests.
 *
 * Extracted from:
 *  - DT: DOMAIN_MAP, resolveCommunity, Haversine, community CRUD
 *  - Sebastian: places CRUD, isInsideTown, town/context
 *  - PP: network_levels, town_connections, town-requests
 */

module.exports = function mountPlaces(app, db) {

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

  // ── Haversine distance (extracted from DT routes/businesses.js) ──
  // Returns distance in meters between two lat/lng points
  function haversineMeters(lat1, lng1, lat2, lng2) {
    var toRad = function(d) { return d * Math.PI / 180; };
    var dLat = toRad(lat2 - lat1);
    var dLng = toRad(lng2 - lng1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return 6371000 * c;
  }

  // ── resolveCommunity middleware (adapted from DT resolveCommunity) ──
  // Reads host header, finds place by domain column, attaches to req.place
  async function resolvePlaceMiddleware(req, res, next) {
    try {
      var hostname = (req.headers["x-forwarded-host"] || req.headers["host"] || req.hostname || "")
        .split(":")[0].toLowerCase().replace(/^www\./, "");
      var result;
      if (hostname) {
        result = await db.query("SELECT * FROM places WHERE domain=$1 AND status='active' LIMIT 1", [hostname]);
      }
      if (!result || !result.rows.length) {
        result = await db.query("SELECT * FROM places WHERE slug='digitaltowns' LIMIT 1");
      }
      req.place = result.rows[0] || { id: 0, slug: "digitaltowns", name: "Digital Towns Staging" };
    } catch (err) {
      req.place = { id: 0, slug: "digitaltowns", name: "Digital Towns Staging" };
    }
    next();
  }
  app._places = { resolvePlaceMiddleware: resolvePlaceMiddleware };

  // ──────────────────────────────────────────────────────────────
  // GET /api/places
  // List places, filterable by type, parent_slug, status
  // Extracted from DT GET /api/communities + PP GET /api/network/levels
  // ──────────────────────────────────────────────────────────────
  app.get("/api/places", async function(req, res) {
    try {
      var conditions = [];
      var params = [];
      var idx = 1;

      if (req.query.type) {
        conditions.push("p.type = $" + idx++);
        params.push(req.query.type);
      }
      if (req.query.status) {
        conditions.push("p.status = $" + idx++);
        params.push(req.query.status);
      }
      if (req.query.parent_slug) {
        conditions.push("p.parent_id = (SELECT id FROM places WHERE slug = $" + idx++ + ")");
        params.push(req.query.parent_slug);
      }

      var where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

      var result = await db.query(
        "SELECT p.*, parent.slug AS parent_slug, parent.name AS parent_name " +
        "FROM places p LEFT JOIN places parent ON parent.id = p.parent_id " +
        where + " ORDER BY p.type, p.name",
        params
      );

      // Add member counts (like DT community member_count subquery)
      var places = result.rows.map(function(p) {
        return p;
      });

      // Batch member counts
      if (places.length) {
        var ids = places.map(function(p) { return p.id; });
        var counts = await db.query(
          "SELECT place_id, COUNT(*)::integer AS member_count FROM place_memberships WHERE place_id = ANY($1) GROUP BY place_id",
          [ids]
        );
        var countMap = {};
        counts.rows.forEach(function(r) { countMap[r.place_id] = r.member_count; });
        places.forEach(function(p) { p.member_count = countMap[p.id] || 0; });
      }

      res.json({ places: places });
    } catch (err) {
      console.error("GET /api/places error:", err.message);
      res.status(500).json({ error: "Failed to fetch places" });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // GET /api/places/resolve-domain
  // Adapted from DT DOMAIN_MAP lookup pattern
  // ──────────────────────────────────────────────────────────────
  app.get("/api/places/resolve-domain", async function(req, res) {
    try {
      var domain = (req.query.domain || "").toLowerCase().replace(/^www\./, "");
      if (!domain) return res.status(400).json({ error: "domain param required" });
      var result = await db.query(
        "SELECT * FROM places WHERE domain=$1 LIMIT 1",
        [domain]
      );
      if (!result.rows.length) return res.status(404).json({ error: "No place found for domain" });
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // GET /api/places/network
  // From PP GET /api/network/levels — all places with level/progress,
  // grouped by type for genesis map
  // ──────────────────────────────────────────────────────────────
  app.get("/api/places/network", async function(req, res) {
    try {
      var result = await db.query(
        "SELECT id, name, slug, type, parent_id, status, lat, lng, level, level_progress, domain " +
        "FROM places ORDER BY type, level DESC, name ASC"
      );
      var grouped = {};
      result.rows.forEach(function(row) {
        var t = row.type;
        if (!grouped[t]) grouped[t] = [];
        grouped[t].push(row);
      });
      res.json(grouped);
    } catch (err) {
      console.error("GET /api/places/network error:", err.message);
      res.status(500).json({ error: "Failed to fetch network" });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // GET /api/places/:slug
  // Returns single place + parent chain
  // Adapted from Sebastian GET /places/:id + DT community context
  // ──────────────────────────────────────────────────────────────
  app.get("/api/places/:slug", async function(req, res) {
    try {
      var result = await db.query("SELECT * FROM places WHERE slug=$1", [req.params.slug]);
      if (!result.rows.length) return res.status(404).json({ error: "Place not found" });

      var place = result.rows[0];

      // Build parent chain (walk up the tree)
      var parents = [];
      var currentParentId = place.parent_id;
      var safety = 0;
      while (currentParentId && safety < 10) {
        var pr = await db.query("SELECT * FROM places WHERE id=$1", [currentParentId]);
        if (!pr.rows.length) break;
        parents.unshift(pr.rows[0]);
        currentParentId = pr.rows[0].parent_id;
        safety++;
      }

      // Member count
      var mc = await db.query(
        "SELECT COUNT(*)::integer AS count FROM place_memberships WHERE place_id=$1",
        [place.id]
      );
      place.member_count = mc.rows[0].count;
      place.parents = parents;

      res.json(place);
    } catch (err) {
      console.error("GET /api/places/:slug error:", err.message);
      res.status(500).json({ error: "Failed to fetch place" });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // GET /api/places/:slug/context
  // Returns place + parent + children + stats
  // Adapted from Sebastian GET /town/context
  // ──────────────────────────────────────────────────────────────
  app.get("/api/places/:slug/context", async function(req, res) {
    try {
      var result = await db.query("SELECT * FROM places WHERE slug=$1", [req.params.slug]);
      if (!result.rows.length) return res.status(404).json({ error: "Place not found" });

      var place = result.rows[0];

      // Parent
      var parent = null;
      if (place.parent_id) {
        var pr = await db.query("SELECT id, name, slug, type FROM places WHERE id=$1", [place.parent_id]);
        parent = pr.rows[0] || null;
      }

      // Children
      var children = await db.query(
        "SELECT id, name, slug, type, status, lat, lng, level, level_progress FROM places WHERE parent_id=$1 ORDER BY name",
        [place.id]
      );

      // Member count
      var mc = await db.query(
        "SELECT COUNT(*)::integer AS count FROM place_memberships WHERE place_id=$1",
        [place.id]
      );

      res.json({
        place: place,
        parent: parent,
        children: children.rows,
        member_count: mc.rows[0].count
      });
    } catch (err) {
      console.error("GET /api/places/:slug/context error:", err.message);
      res.status(500).json({ error: "Failed to fetch context" });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // GET /api/places/:slug/children
  // Direct children only
  // ──────────────────────────────────────────────────────────────
  app.get("/api/places/:slug/children", async function(req, res) {
    try {
      var p = await db.query("SELECT id FROM places WHERE slug=$1", [req.params.slug]);
      if (!p.rows.length) return res.status(404).json({ error: "Place not found" });

      var children = await db.query(
        "SELECT p.*, " +
        "(SELECT COUNT(*)::integer FROM place_memberships WHERE place_id=p.id) AS member_count " +
        "FROM places p WHERE p.parent_id=$1 ORDER BY p.name",
        [p.rows[0].id]
      );
      res.json({ children: children.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // GET /api/places/:slug/nearby
  // Haversine geo filter — adapted from DT businesses.js
  // ──────────────────────────────────────────────────────────────
  app.get("/api/places/:slug/nearby", async function(req, res) {
    try {
      var p = await db.query("SELECT * FROM places WHERE slug=$1", [req.params.slug]);
      if (!p.rows.length) return res.status(404).json({ error: "Place not found" });

      var center = p.rows[0];
      var lat = parseFloat(req.query.lat || center.lat);
      var lng = parseFloat(req.query.lng || center.lng);
      var radiusM = parseInt(req.query.radius || center.radius_meters || 40000, 10);

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return res.status(400).json({ error: "Invalid coordinates" });
      }

      // Haversine SQL filter (adapted from DT — converted to meters, 6371000 = earth radius in meters)
      var result = await db.query(
        "SELECT *, " +
        "(6371000 * acos(LEAST(1.0, cos(radians($1)) * cos(radians(lat)) " +
        "* cos(radians(lng) - radians($2)) " +
        "+ sin(radians($1)) * sin(radians(lat))))) AS distance_m " +
        "FROM places " +
        "WHERE lat IS NOT NULL AND lng IS NOT NULL " +
        "AND type = 'town' AND status = 'active' " +
        "AND (6371000 * acos(LEAST(1.0, cos(radians($1)) * cos(radians(lat)) " +
        "* cos(radians(lng) - radians($2)) " +
        "+ sin(radians($1)) * sin(radians(lat))))) <= $3 " +
        "ORDER BY distance_m",
        [lat, lng, radiusM]
      );
      res.json({ places: result.rows });
    } catch (err) {
      console.error("GET /api/places/:slug/nearby error:", err.message);
      res.status(500).json({ error: "Failed to fetch nearby places" });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // POST /api/places (admin only)
  // Adapted from DT POST /api/admin/communities + Sebastian addPlace()
  // ──────────────────────────────────────────────────────────────
  app.post("/api/places", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var b = req.body || {};
      var name = (b.name || "").toString().trim();
      var slug = (b.slug || "").toString().trim().toLowerCase();
      if (!name || !slug) return res.status(400).json({ error: "name and slug required" });

      var type = (b.type || "town").toString().trim();
      var allowed = ["country", "state", "region", "town", "neighborhood"];
      if (allowed.indexOf(type) === -1) return res.status(400).json({ error: "Invalid type" });

      // Resolve parent_id from parent_slug if provided
      var parentId = null;
      if (b.parent_slug) {
        var pr = await db.query("SELECT id FROM places WHERE slug=$1", [b.parent_slug]);
        if (!pr.rows.length) return res.status(400).json({ error: "Parent place not found" });
        parentId = pr.rows[0].id;
      } else if (b.parent_id) {
        parentId = parseInt(b.parent_id, 10);
      }

      var result = await db.query(
        "INSERT INTO places (name, slug, type, parent_id, domain, status, feature_flags, " +
        "lat, lng, radius_meters, bounding_box, zoom, population, timezone, county, meta, level, level_progress) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *",
        [
          name, slug, type, parentId,
          b.domain || null,
          b.status || "pending",
          JSON.stringify(b.feature_flags || {}),
          b.lat || null, b.lng || null,
          b.radius_meters || 40000,
          b.bounding_box ? JSON.stringify(b.bounding_box) : null,
          b.zoom || 13,
          b.population || null,
          b.timezone || "America/New_York",
          b.county || "",
          JSON.stringify(b.meta || {}),
          b.level || 0,
          b.level_progress || 0
        ]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error("POST /api/places error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // PUT /api/places/:id (admin only)
  // Adapted from DT PUT /api/admin/communities/:id
  // ──────────────────────────────────────────────────────────────
  app.put("/api/places/:id", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var b = req.body || {};
      var result = await db.query(
        "UPDATE places SET " +
        "name = COALESCE($1, name), " +
        "domain = COALESCE($2, domain), " +
        "status = COALESCE($3, status), " +
        "feature_flags = COALESCE($4, feature_flags), " +
        "lat = COALESCE($5, lat), " +
        "lng = COALESCE($6, lng), " +
        "radius_meters = COALESCE($7, radius_meters), " +
        "bounding_box = COALESCE($8, bounding_box), " +
        "zoom = COALESCE($9, zoom), " +
        "population = COALESCE($10, population), " +
        "timezone = COALESCE($11, timezone), " +
        "county = COALESCE($12, county), " +
        "meta = COALESCE($13, meta) " +
        "WHERE id = $14 RETURNING *",
        [
          b.name || null,
          b.domain || null,
          b.status || null,
          b.feature_flags ? JSON.stringify(b.feature_flags) : null,
          b.lat !== undefined ? b.lat : null,
          b.lng !== undefined ? b.lng : null,
          b.radius_meters !== undefined ? b.radius_meters : null,
          b.bounding_box ? JSON.stringify(b.bounding_box) : null,
          b.zoom !== undefined ? b.zoom : null,
          b.population !== undefined ? b.population : null,
          b.timezone || null,
          b.county !== undefined ? b.county : null,
          b.meta ? JSON.stringify(b.meta) : null,
          req.params.id
        ]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Place not found" });
      res.json(result.rows[0]);
    } catch (err) {
      console.error("PUT /api/places/:id error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // PUT /api/admin/places/:id/level (admin only)
  // Adapted from PP PATCH /api/network/levels/:slug
  // ──────────────────────────────────────────────────────────────
  app.put("/api/admin/places/:id/level", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var b = req.body || {};
      var result = await db.query(
        "UPDATE places SET " +
        "level = COALESCE($1, level), " +
        "level_progress = COALESCE($2, level_progress) " +
        "WHERE id = $3 RETURNING *",
        [
          b.level !== undefined ? b.level : null,
          b.level_progress !== undefined ? b.level_progress : null,
          req.params.id
        ]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Place not found" });
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // POST /api/places/:slug/join (auth required)
  // Adapted from DT autoJoinCommunity + PP BST group join
  // ──────────────────────────────────────────────────────────────
  app.post("/api/places/:slug/join", async function(req, res) {
    var uid = await requireLogin(req, res); if (!uid) return;
    try {
      var p = await db.query("SELECT id FROM places WHERE slug=$1", [req.params.slug]);
      if (!p.rows.length) return res.status(404).json({ error: "Place not found" });

      await db.query(
        "INSERT INTO place_memberships (place_id, user_id) VALUES ($1, $2) ON CONFLICT (place_id, user_id) DO NOTHING",
        [p.rows[0].id, uid]
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // DELETE /api/places/:slug/leave (auth required)
  // ──────────────────────────────────────────────────────────────
  app.delete("/api/places/:slug/leave", async function(req, res) {
    var uid = await requireLogin(req, res); if (!uid) return;
    try {
      var p = await db.query("SELECT id FROM places WHERE slug=$1", [req.params.slug]);
      if (!p.rows.length) return res.status(404).json({ error: "Place not found" });

      await db.query(
        "DELETE FROM place_memberships WHERE place_id=$1 AND user_id=$2",
        [p.rows[0].id, uid]
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // POST /api/place-requests (public)
  // Adapted from PP POST /api/town-requests
  // ──────────────────────────────────────────────────────────────
  app.post("/api/place-requests", async function(req, res) {
    try {
      var b = req.body || {};
      if (!b.name || !b.email || !b.place_name) {
        return res.status(400).json({ error: "name, email, and place_name required" });
      }
      await db.query(
        "INSERT INTO place_requests (name, email, place_name, state, country, population_range, message) " +
        "VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [
          (b.name || "").toString().slice(0, 255),
          (b.email || "").toString().slice(0, 255),
          (b.place_name || "").toString().slice(0, 255),
          (b.state || "").toString().slice(0, 255),
          (b.country || "US").toString().slice(0, 255),
          (b.population_range || "").toString().slice(0, 50),
          (b.message || "").toString().slice(0, 5000)
        ]
      );
      res.json({ ok: true });
    } catch (err) {
      console.error("POST /api/place-requests error:", err.message);
      res.status(500).json({ error: "Failed to submit request" });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // GET /api/admin/place-requests (admin only)
  // ──────────────────────────────────────────────────────────────
  app.get("/api/admin/place-requests", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var result = await db.query(
        "SELECT * FROM place_requests ORDER BY created_at DESC"
      );
      res.json({ requests: result.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

};
