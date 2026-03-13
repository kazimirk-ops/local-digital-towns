/**
 * Gigs module routes
 * Gig categories, providers, bookings, reviews, service inquiries.
 * Extracted from DT routes/gigs.js + Sebastian service_inquiries.
 */

module.exports = function mountGigs(app, db) {

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

  // ── GET /api/gigs/categories ───────────────────────────────
  // Extracted from DT GET /api/gigs/categories
  app.get("/api/gigs/categories", async function(req, res) {
    try {
      var result = await db.query("SELECT * FROM gig_categories WHERE active=true ORDER BY sort_order ASC, name ASC");
      res.json({ categories: result.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/gigs/providers ────────────────────────────────
  // Extracted from DT GET /api/gigs/providers with category/place filtering
  app.get("/api/gigs/providers", async function(req, res) {
    try {
      var conditions = ["p.active = true"];
      var params = [];
      var idx = 1;
      if (req.query.category) {
        conditions.push("p.category_slug = $" + idx++);
        params.push(req.query.category);
      }
      if (req.query.place_slug) {
        conditions.push("p.place_id = (SELECT id FROM places WHERE slug=$" + idx++ + ")");
        params.push(req.query.place_slug);
      }
      var where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
      var result = await db.query(
        "SELECT p.*, u.display_name, u.avatar_url, u.email " +
        "FROM gig_providers p LEFT JOIN users u ON u.id = p.user_id " +
        where + " ORDER BY p.featured DESC, p.avg_rating DESC, p.review_count DESC",
        params
      );
      res.json({ providers: result.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/gigs/providers/:id ────────────────────────────
  // Extracted from DT GET /api/gigs/providers/:id with reviews
  app.get("/api/gigs/providers/:id", async function(req, res) {
    try {
      var p = await db.query(
        "SELECT p.*, u.display_name, u.avatar_url " +
        "FROM gig_providers p LEFT JOIN users u ON u.id = p.user_id WHERE p.id=$1",
        [req.params.id]
      );
      if (!p.rows.length) return res.status(404).json({ error: "Provider not found" });
      var reviews = await db.query(
        "SELECT r.*, u.display_name AS reviewer_name " +
        "FROM gig_reviews r LEFT JOIN users u ON u.id = r.reviewer_id " +
        "WHERE r.provider_id=$1 ORDER BY r.created_at DESC LIMIT 10",
        [req.params.id]
      );
      res.json({ provider: p.rows[0], reviews: reviews.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/gigs/applications ────────────────────────────
  // Extracted from DT POST /api/gigs/apply/individual + /apply/business
  app.post("/api/gigs/applications", async function(req, res) {
    var uid = await requireLogin(req, res); if (!uid) return;
    try {
      var b = req.body || {};
      if (!b.name || !b.category_slug) return res.status(400).json({ error: "name and category_slug required" });
      var result = await db.query(
        "INSERT INTO gig_applications (user_id, category_slug, place_id, business_name, name, phone, email, experience, availability, services) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
        [uid, b.category_slug, b.place_id || null, b.business_name || "",
         b.name, b.phone || "", b.email || "",
         b.experience || "", b.availability || "",
         JSON.stringify(b.services || [])]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/gigs/bookings ─────────────────────────────────
  // User's own bookings. Extracted from DT GET /api/gigs/my-bookings.
  app.get("/api/gigs/bookings", async function(req, res) {
    var uid = await requireLogin(req, res); if (!uid) return;
    try {
      var result = await db.query(
        "SELECT b.*, p.business_name AS provider_name, gc.name AS category_name " +
        "FROM gig_bookings b " +
        "LEFT JOIN gig_providers p ON p.id = b.provider_id " +
        "LEFT JOIN gig_categories gc ON gc.slug = b.category_slug " +
        "WHERE b.customer_id=$1 ORDER BY b.created_at DESC",
        [uid]
      );
      res.json({ bookings: result.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/gigs/bookings ────────────────────────────────
  // Extracted from DT POST /api/gigs/book (without Stripe for now)
  app.post("/api/gigs/bookings", async function(req, res) {
    var uid = await requireLogin(req, res); if (!uid) return;
    try {
      var b = req.body || {};
      if (!b.provider_id) return res.status(400).json({ error: "provider_id required" });
      var result = await db.query(
        "INSERT INTO gig_bookings (provider_id, customer_id, category_slug, description, scheduled_at, address, price_cents) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [b.provider_id, uid, b.category_slug || "",
         b.description || "", b.scheduled_at || null,
         b.address || "", b.price_cents || 0]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── PUT /api/gigs/bookings/:id/status ──────────────────────
  // Extracted from DT PATCH /api/admin/gigs/admin-bookings/:id/status
  app.put("/api/gigs/bookings/:id/status", async function(req, res) {
    var uid = await requireLogin(req, res); if (!uid) return;
    try {
      var b = req.body || {};
      var allowed = ["confirmed", "in_progress", "completed", "cancelled"];
      if (allowed.indexOf(b.status) === -1) return res.status(400).json({ error: "Invalid status" });
      var extra = "";
      if (b.status === "confirmed") extra = ", confirmed_at = NOW()";
      if (b.status === "completed") extra = ", completed_at = NOW()";
      if (b.status === "cancelled") extra = ", cancelled_at = NOW(), cancellation_reason = $3";
      var params = [b.status, req.params.id];
      if (b.status === "cancelled") params.push(b.reason || "");
      var result = await db.query(
        "UPDATE gig_bookings SET status = $1" + extra + " WHERE id = $2 RETURNING *",
        params
      );
      if (!result.rows.length) return res.status(404).json({ error: "Booking not found" });
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/gigs/reviews/:provider_id ─────────────────────
  app.get("/api/gigs/reviews/:provider_id", async function(req, res) {
    try {
      var result = await db.query(
        "SELECT r.*, u.display_name AS reviewer_name " +
        "FROM gig_reviews r LEFT JOIN users u ON u.id = r.reviewer_id " +
        "WHERE r.provider_id=$1 ORDER BY r.created_at DESC",
        [req.params.provider_id]
      );
      res.json({ reviews: result.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/gigs/reviews ─────────────────────────────────
  // Extracted from DT POST /api/gigs/reviews
  app.post("/api/gigs/reviews", async function(req, res) {
    var uid = await requireLogin(req, res); if (!uid) return;
    try {
      var b = req.body || {};
      if (!b.booking_id || !b.rating) return res.status(400).json({ error: "booking_id and rating required" });
      var rating = Math.min(5, Math.max(1, parseInt(b.rating, 10)));

      // Verify booking belongs to user and is completed
      var booking = await db.query(
        "SELECT * FROM gig_bookings WHERE id=$1 AND customer_id=$2 AND status='completed'",
        [b.booking_id, uid]
      );
      if (!booking.rows.length) return res.status(400).json({ error: "Booking not found or not completed" });

      var result = await db.query(
        "INSERT INTO gig_reviews (booking_id, reviewer_id, provider_id, rating, comment) " +
        "VALUES ($1,$2,$3,$4,$5) RETURNING *",
        [b.booking_id, uid, booking.rows[0].provider_id, rating, b.comment || ""]
      );

      // Update provider avg_rating and review_count
      await db.query(
        "UPDATE gig_providers SET " +
        "avg_rating = (SELECT ROUND(AVG(rating)::numeric, 1) FROM gig_reviews WHERE provider_id=$1), " +
        "review_count = (SELECT COUNT(*)::integer FROM gig_reviews WHERE provider_id=$1) " +
        "WHERE id=$1",
        [booking.rows[0].provider_id]
      );

      res.status(201).json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/service-inquiries ────────────────────────────
  // Extracted from Sebastian POST /api/service-inquiries
  app.post("/api/service-inquiries", async function(req, res) {
    try {
      var b = req.body || {};
      var uid = await getUserId(req);
      var result = await db.query(
        "INSERT INTO service_inquiries (place_id, user_id, provider_id, category, form_data) " +
        "VALUES ($1,$2,$3,$4,$5) RETURNING *",
        [b.place_id || null, uid, b.provider_id || null, b.category || "", JSON.stringify(b.form_data || {})]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/service-inquiries ─────────────────────────────
  // User's own inquiries
  app.get("/api/service-inquiries", async function(req, res) {
    var uid = await requireLogin(req, res); if (!uid) return;
    try {
      var result = await db.query(
        "SELECT si.*, gc.name AS category_name " +
        "FROM service_inquiries si LEFT JOIN gig_categories gc ON gc.slug = si.category " +
        "WHERE si.user_id=$1 ORDER BY si.created_at DESC",
        [uid]
      );
      res.json({ inquiries: result.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Admin endpoints ────────────────────────────────────────

  // GET /api/admin/gig-applications
  app.get("/api/admin/gig-applications", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var status = req.query.status || "pending";
      var result = await db.query(
        "SELECT a.*, u.display_name, u.email AS user_email " +
        "FROM gig_applications a LEFT JOIN users u ON u.id = a.user_id " +
        "WHERE a.status=$1 ORDER BY a.created_at DESC",
        [status]
      );
      res.json({ applications: result.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/gig-applications/:id/approve
  // Extracted from DT PATCH /api/admin/gigs/applications/:id — auto-create provider
  app.post("/api/admin/gig-applications/:id/approve", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var app_r = await db.query("SELECT * FROM gig_applications WHERE id=$1", [req.params.id]);
      if (!app_r.rows.length) return res.status(404).json({ error: "Application not found" });
      var application = app_r.rows[0];

      await db.query(
        "UPDATE gig_applications SET status='approved', reviewed_by=$1, reviewed_at=NOW() WHERE id=$2",
        [admin.id, application.id]
      );

      // Auto-create provider
      await db.query(
        "INSERT INTO gig_providers (user_id, category_slug, place_id, business_name, bio, phone, active) " +
        "VALUES ($1,$2,$3,$4,$5,$6,true)",
        [application.user_id, application.category_slug, application.place_id,
         application.business_name || application.name, application.experience || "", application.phone || ""]
      );

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/gig-applications/:id/reject
  app.post("/api/admin/gig-applications/:id/reject", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      await db.query(
        "UPDATE gig_applications SET status='rejected', reviewed_by=$1, reviewed_at=NOW() WHERE id=$2",
        [admin.id, req.params.id]
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

};
