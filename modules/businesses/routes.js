/**
 * Businesses module routes
 * Map pins, Haversine geo filter, seeded pins, claim flow, local biz applications.
 * Extracted from DT routes/businesses.js + routes/seeded.js + Sebastian localbiz.
 */
var crypto = require("crypto");

module.exports = function mountBusinesses(app, db) {

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

  // Resolve place for geo context
  async function resolvePlace(slugOrQuery) {
    if (!slugOrQuery) return null;
    var r = await db.query("SELECT id, lat, lng, radius_meters FROM places WHERE slug=$1", [slugOrQuery]);
    return r.rows[0] || null;
  }

  // ── GET /api/businesses ────────────────────────────────────
  // Extracted from DT routes/businesses.js: Haversine geo filter
  app.get("/api/businesses", async function(req, res) {
    try {
      var conditions = ["approved = true"];
      var params = [];
      var idx = 1;

      if (req.query.category && req.query.category !== "all") {
        conditions.push("category = $" + idx++);
        params.push(req.query.category);
      }
      if (req.query.city) {
        conditions.push("city = $" + idx++);
        params.push(req.query.city);
      }
      if (req.query.place_id) {
        conditions.push("place_id = $" + idx++);
        params.push(parseInt(req.query.place_id, 10));
      }

      // Haversine geo filter (from DT — converted to meters)
      var place = req.query.place_slug ? await resolvePlace(req.query.place_slug) : null;
      if (place && place.lat && place.lng && place.radius_meters) {
        params.push(parseFloat(place.lat), parseFloat(place.lng), parseInt(place.radius_meters, 10));
        conditions.push(
          "latitude IS NOT NULL AND longitude IS NOT NULL" +
          " AND (6371000 * acos(LEAST(1.0, cos(radians($" + (idx) + ")) * cos(radians(latitude))" +
          " * cos(radians(longitude) - radians($" + (idx+1) + "))" +
          " + sin(radians($" + (idx) + ")) * sin(radians(latitude))))) <= $" + (idx+2)
        );
        idx += 3;
      }

      var where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
      var result = await db.query(
        "SELECT id, name, category, address, city, phone, website, " +
        "latitude, longitude, seeded, claimed, share_token, share_count, " +
        "rating, review_count, place_id " +
        "FROM businesses " + where +
        " AND (seeded = false OR (seeded = true AND share_token_expires_at > NOW()))" +
        " ORDER BY name",
        params
      );
      res.json({ businesses: result.rows });
    } catch (err) {
      console.error("GET /api/businesses error:", err.message);
      res.status(500).json({ error: "Failed to fetch businesses" });
    }
  });

  // ── GET /api/businesses/:id ────────────────────────────────
  app.get("/api/businesses/:id", async function(req, res) {
    try {
      var r = await db.query("SELECT * FROM businesses WHERE id=$1", [req.params.id]);
      if (!r.rows.length) return res.status(404).json({ error: "Not found" });
      res.json(r.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/businesses ───────────────────────────────────
  // Create new business (auth required)
  app.post("/api/businesses", async function(req, res) {
    var uid = await requireLogin(req, res); if (!uid) return;
    try {
      var b = req.body || {};
      if (!b.name) return res.status(400).json({ error: "name required" });
      var result = await db.query(
        "INSERT INTO businesses (name, category, address, latitude, longitude, city, phone, website, place_id, approved, created_at) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false,NOW()) RETURNING *",
        [b.name, b.category || "", b.address || "", b.latitude || null, b.longitude || null,
         b.city || "", b.phone || "", b.website || "", b.place_id || null]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── PUT /api/businesses/:id/claim ──────────────────────────
  // Extracted from DT routes/seeded.js POST /claim/:token
  app.put("/api/businesses/:id/claim", async function(req, res) {
    var uid = await requireLogin(req, res); if (!uid) return;
    try {
      var token = (req.body || {}).share_token || "";
      if (!token) return res.status(400).json({ error: "share_token required" });
      var result = await db.query(
        "UPDATE businesses SET claimed = true, claimed_at = NOW(), claimed_by = $1 " +
        "WHERE id = $2 AND share_token = $3 AND claimed = false AND removed IS NOT TRUE " +
        "AND (share_token_expires_at IS NULL OR share_token_expires_at > NOW()) " +
        "RETURNING id, name",
        [uid, req.params.id, token]
      );
      if (!result.rows.length) return res.status(409).json({ error: "Claim failed or already claimed" });
      res.json({ ok: true, business: result.rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/admin/businesses ──────────────────────────────
  // Extracted from DT GET /admin/businesses/seeded
  app.get("/api/admin/businesses", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var result = await db.query(
        "SELECT b.*, " +
        "EXTRACT(DAY FROM (share_token_expires_at - NOW())) AS days_left " +
        "FROM businesses b ORDER BY b.created_at DESC"
      );
      res.json({ businesses: result.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/admin/businesses/seed ────────────────────────
  // Extracted from DT POST /admin/businesses/seed
  app.post("/api/admin/businesses/seed", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var b = req.body || {};
      var shareToken = crypto.randomBytes(6).toString("hex");
      var result = await db.query(
        "INSERT INTO businesses " +
        "(name, category, address, city, phone, website, latitude, longitude, place_id, " +
        "seeded, seeded_at, share_token_expires_at, claimed, approved, share_token) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,NOW(),NOW()+INTERVAL '30 days',false,true,$10) RETURNING *",
        [b.name, b.category, b.address, b.city, b.phone, b.website,
         b.latitude, b.longitude, b.place_id || null, shareToken]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/localbiz/apply ───────────────────────────────
  // Extracted from Sebastian POST /api/localbiz/apply
  app.post("/api/localbiz/apply", async function(req, res) {
    var uid = await requireLogin(req, res); if (!uid) return;
    try {
      var b = req.body || {};
      if (!b.business_name || !b.owner_name || !b.email || !b.category || !b.description) {
        return res.status(400).json({ error: "business_name, owner_name, email, category, description required" });
      }
      var result = await db.query(
        "INSERT INTO business_applications (place_id, user_id, business_name, owner_name, email, phone, address, category, description) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
        [b.place_id || null, uid, b.business_name, b.owner_name, b.email, b.phone || "", b.address || "", b.category, b.description]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/admin/localbiz ────────────────────────────────
  // Extracted from Sebastian GET /api/admin/localbiz
  app.get("/api/admin/localbiz", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var status = req.query.status || "pending";
      var result = await db.query(
        "SELECT * FROM business_applications WHERE status=$1 ORDER BY created_at DESC",
        [status]
      );
      res.json({ applications: result.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/admin/localbiz/:id/approve ───────────────────
  // Extracted from Sebastian POST /api/admin/localbiz/:id/approve
  app.post("/api/admin/localbiz/:id/approve", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var result = await db.query(
        "UPDATE business_applications SET status='approved', reviewed_by=$1, reviewed_at=NOW() WHERE id=$2 RETURNING *",
        [admin.id, req.params.id]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Application not found" });
      res.json({ ok: true, application: result.rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/admin/localbiz/:id/deny ──────────────────────
  app.post("/api/admin/localbiz/:id/deny", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var reason = (req.body || {}).reason || "";
      var result = await db.query(
        "UPDATE business_applications SET status='denied', reviewed_by=$1, reviewed_at=NOW() WHERE id=$2 RETURNING *",
        [admin.id, req.params.id]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Application not found" });
      res.json({ ok: true, application: result.rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

};
