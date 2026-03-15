/**
 * Niche Network module routes (L3)
 * Inbound webhooks from niche platforms, platform registry, sale events.
 * Adapted from TC auction-win webhook pattern + DT module conventions.
 */
var crypto = require("crypto");
var { linkPlatformUser } = require("../../lib/identity-bridge");

module.exports = function mountNicheNetwork(app, db) {

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
    var flags = (req.community && req.community.feature_flags) || {};
    if (flags[flag] !== undefined) return !!flags[flag];
    return true;
  }
  function denyIfDisabled(res) { res.status(404).json({ error: "Module not enabled" }); }

  // ══════════════════════════════════════
  // Inbound Webhook — THE KEY ENDPOINT
  // ══════════════════════════════════════

  // ── POST /api/webhooks/niche-sale ──
  // Receives sale events from niche platforms (no auth, secret in body).
  // Adapted from TC→PP auction win webhook pattern.
  app.post("/api/webhooks/niche-sale", async function(req, res) {
    try {
      if (!(await checkFlag(req, "niche-network.inbound-webhooks"))) return denyIfDisabled(res);

      var b = req.body || {};
      if (!b.platform || !b.secret) {
        return res.status(400).json({ error: "platform and secret required" });
      }

      // Validate platform slug exists, secret matches, and platform is active
      var platR = await db.query(
        "SELECT id, slug, webhook_secret, active FROM niche_platforms WHERE slug=$1",
        [b.platform]
      );
      if (!platR.rows.length) {
        return res.status(404).json({ error: "Platform not found" });
      }
      var plat = platR.rows[0];
      if (!plat.active) {
        return res.status(403).json({ error: "Platform is inactive" });
      }
      if (plat.webhook_secret !== b.secret) {
        return res.status(401).json({ error: "Invalid secret" });
      }

      // Deduplicate via UNIQUE(platform_slug, external_ref)
      if (b.external_ref) {
        var dupR = await db.query(
          "SELECT id FROM niche_sale_events WHERE platform_slug=$1 AND external_ref=$2",
          [b.platform, b.external_ref]
        );
        if (dupR.rows.length) {
          return res.json({ ok: true, event_id: dupR.rows[0].id, duplicate: true });
        }
      }

      // Try to match ZIP to place_id
      var placeId = null;
      if (b.ship_to_zip) {
        var zipR = await db.query(
          "SELECT id FROM places WHERE $1 = ANY(zip_codes) LIMIT 1",
          [b.ship_to_zip]
        );
        if (zipR.rows.length) placeId = zipR.rows[0].id;
      }

      // Fallback: match by city name
      if (!placeId && b.ship_to_city) {
        var cityR = await db.query(
          "SELECT id FROM places WHERE lower(name) LIKE lower($1) AND type = 'town' LIMIT 1",
          ["%" + b.ship_to_city + "%"]
        );
        if (cityR.rows.length) placeId = cityR.rows[0].id;
      }

      // Insert sale event
      var insertR = await db.query(
        "INSERT INTO niche_sale_events (platform_id, platform_slug, external_ref, buyer_email, buyer_name, " +
        "buyer_phone, ship_to_city, ship_to_state, ship_to_zip, ship_to_country, amount_cents, category, " +
        "tags, place_id, raw) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id",
        [plat.id, b.platform, b.external_ref || null, b.buyer_email || null, b.buyer_name || null,
         b.buyer_phone || null, b.ship_to_city || null, b.ship_to_state || null,
         b.ship_to_zip || null, b.ship_to_country || "US",
         parseInt(b.amount_cents) || 0, b.category || "",
         JSON.stringify(b.tags || []), placeId, JSON.stringify(b.raw || {})]
      );
      var eventId = insertR.rows[0].id;

      // Fire location tag event (may not match, that's ok)
      if (b.ship_to_state) {
        try {
          await db.query(
            "INSERT INTO tag_events (user_id, tag_id, event_type, source_table, source_id) " +
            "SELECT null, t.id, 'location-signal', 'niche_sale_events', $1 " +
            "FROM tags t WHERE t.name = 'location-' || lower($2)",
            [eventId, b.ship_to_state]
          );
          await db.query(
            "UPDATE niche_sale_events SET location_tag_fired=true WHERE id=$1",
            [eventId]
          );
        } catch (tagErr) {
          // Tag may not exist — that's expected, not an error
        }
      }

      // Update platform stats
      await db.query(
        "UPDATE niche_platforms SET sale_count = sale_count + 1, last_event_at = NOW() WHERE slug=$1",
        [b.platform]
      );

      // Link buyer to DT user via identity bridge
      if (b.buyer_email) {
        try {
          await linkPlatformUser(db, {
            email: b.buyer_email,
            platformSlug: b.platform || "plant-purge",
            platformUserId: b.buyer_id || null,
            platformUserType: "buyer",
            platformDisplayName: b.buyer_name || null,
            metadata: { source: "niche-sale", event_id: eventId }
          });
        } catch (linkErr) {
          console.error("[niche-network] identity-bridge error:", linkErr.message);
        }
      }

      res.json({ ok: true, event_id: eventId, place_id: placeId, place_matched: !!placeId });
    } catch (err) {
      console.error("[niche-network] webhook error:", err.message);
      res.status(500).json({ error: "Internal error" });
    }
  });

  // ── POST /api/webhooks/niche-signup ──
  // Receives signup events from niche platforms (no auth, secret in body).
  // Same validation pattern as niche-sale.
  app.post("/api/webhooks/niche-signup", async function(req, res) {
    try {
      if (!(await checkFlag(req, "niche-network.inbound-webhooks"))) return denyIfDisabled(res);

      var b = req.body || {};
      if (!b.platform || !b.secret) {
        return res.status(400).json({ error: "platform and secret required" });
      }

      // Validate platform slug exists, secret matches, and platform is active
      var platR = await db.query(
        "SELECT id, slug, webhook_secret, active FROM niche_platforms WHERE slug=$1",
        [b.platform]
      );
      if (!platR.rows.length) {
        return res.status(404).json({ error: "Platform not found" });
      }
      var plat = platR.rows[0];
      if (!plat.active) {
        return res.status(403).json({ error: "Platform is inactive" });
      }
      if (plat.webhook_secret !== b.secret) {
        return res.status(401).json({ error: "Invalid secret" });
      }

      // Deduplicate via UNIQUE(platform_slug, external_ref)
      if (b.external_ref) {
        var dupR = await db.query(
          "SELECT id FROM niche_signup_events WHERE platform_slug=$1 AND external_ref=$2",
          [b.platform, b.external_ref]
        );
        if (dupR.rows.length) {
          return res.json({ ok: true, event_id: dupR.rows[0].id, duplicate: true });
        }
      }

      // Try to match ZIP to place_id
      var placeId = null;
      if (b.user_zip) {
        var zipR = await db.query(
          "SELECT id FROM places WHERE $1 = ANY(zip_codes) LIMIT 1",
          [b.user_zip]
        );
        if (zipR.rows.length) placeId = zipR.rows[0].id;
      }

      // Fallback: match by city name
      if (!placeId && b.user_city) {
        var cityR = await db.query(
          "SELECT id FROM places WHERE lower(name) LIKE lower($1) AND type = 'town' LIMIT 1",
          ["%" + b.user_city + "%"]
        );
        if (cityR.rows.length) placeId = cityR.rows[0].id;
      }

      // Insert signup event
      var insertR = await db.query(
        "INSERT INTO niche_signup_events (platform_id, platform_slug, external_ref, user_email, user_name, " +
        "user_zip, user_city, user_state, place_id, raw) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id",
        [plat.id, b.platform, b.external_ref || null, b.user_email || null, b.user_name || null,
         b.user_zip || null, b.user_city || null, b.user_state || null,
         placeId, JSON.stringify(b.raw || {})]
      );
      var eventId = insertR.rows[0].id;

      // Fire location tag event (may not match, that's ok)
      if (b.user_state) {
        try {
          await db.query(
            "INSERT INTO tag_events (user_id, tag_id, event_type, source_table, source_id) " +
            "SELECT null, t.id, 'location-signal', 'niche_signup_events', $1 " +
            "FROM tags t WHERE t.name = 'location-' || lower($2)",
            [eventId, b.user_state]
          );
        } catch (tagErr) {
          // Tag may not exist — that's expected
        }
      }

      // Update platform stats
      await db.query(
        "UPDATE niche_platforms SET buyer_count = buyer_count + 1, last_event_at = NOW() WHERE slug=$1",
        [b.platform]
      );

      // Link user to DT user via identity bridge
      if (b.user_email) {
        try {
          await linkPlatformUser(db, {
            email: b.user_email,
            platformSlug: b.platform || "plant-purge",
            platformUserId: b.user_id || null,
            platformUserType: b.user_type || null,
            platformDisplayName: b.user_name || null,
            platformAvatarUrl: b.avatar_url || null,
            platformStripeConnected: b.stripe_connected || false,
            metadata: { source: "niche-signup", event_id: eventId }
          });
        } catch (linkErr) {
          console.error("[niche-network] identity-bridge error:", linkErr.message);
        }
      }

      res.json({ ok: true, event_id: eventId, place_id: placeId, place_matched: !!placeId });
    } catch (err) {
      console.error("[niche-network] signup webhook error:", err.message);
      res.status(500).json({ error: "Internal error" });
    }
  });

  // ══════════════════════════════════════
  // Platform Registry (admin)
  // ══════════════════════════════════════

  // ── GET /api/niche-platforms ──
  // List all registered niche platforms.
  app.get("/api/niche-platforms", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var r = await db.query("SELECT * FROM niche_platforms ORDER BY created_at DESC");
      res.json({ platforms: r.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/niche-platforms/:slug/stats ──
  // Platform detail + recent events count.
  app.get("/api/niche-platforms/:slug/stats", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var platR = await db.query("SELECT * FROM niche_platforms WHERE slug=$1", [req.params.slug]);
      if (!platR.rows.length) return res.status(404).json({ error: "Platform not found" });

      var countR = await db.query(
        "SELECT COUNT(*)::integer AS total, " +
        "COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::integer AS last_24h, " +
        "COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::integer AS last_7d, " +
        "COUNT(*) FILTER (WHERE processed = false)::integer AS unprocessed " +
        "FROM niche_sale_events WHERE platform_slug=$1",
        [req.params.slug]
      );

      res.json({
        platform: platR.rows[0],
        stats: countR.rows[0]
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/niche-platforms ──
  // Register a new niche platform.
  app.post("/api/niche-platforms", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var b = req.body || {};
      if (!b.name || !b.slug || !b.webhook_secret) {
        return res.status(400).json({ error: "name, slug, and webhook_secret required" });
      }

      var r = await db.query(
        "INSERT INTO niche_platforms (name, slug, webhook_secret) VALUES ($1,$2,$3) RETURNING *",
        [b.name, b.slug, b.webhook_secret]
      );
      res.status(201).json(r.rows[0]);
    } catch (err) {
      if (err.code === "23505") return res.status(409).json({ error: "Platform slug already exists" });
      res.status(500).json({ error: err.message });
    }
  });

  // ── PUT /api/niche-platforms/:slug/rotate-secret ──
  // Generate and set a new webhook secret.
  app.put("/api/niche-platforms/:slug/rotate-secret", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var newSecret = crypto.randomBytes(32).toString("hex");
      var r = await db.query(
        "UPDATE niche_platforms SET webhook_secret=$1 WHERE slug=$2 RETURNING id, name, slug, active, created_at",
        [newSecret, req.params.slug]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Platform not found" });
      res.json({ ok: true, platform: r.rows[0], new_secret: newSecret });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── DELETE /api/niche-platforms/:slug ──
  // Soft delete (set active=false).
  app.delete("/api/niche-platforms/:slug", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var r = await db.query(
        "UPDATE niche_platforms SET active=false WHERE slug=$1 RETURNING *",
        [req.params.slug]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Platform not found" });
      res.json({ ok: true, platform: r.rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ══════════════════════════════════════
  // Sale Events (admin)
  // ══════════════════════════════════════

  // ── GET /api/niche-sale-events ──
  // List events with optional filters: ?platform= ?place_slug= ?limit=50
  app.get("/api/niche-sale-events", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var conditions = [];
      var params = [];
      var idx = 1;

      if (req.query.platform) {
        conditions.push("nse.platform_slug = $" + idx++);
        params.push(req.query.platform);
      }
      if (req.query.place_slug) {
        conditions.push("nse.place_id = (SELECT id FROM places WHERE slug=$" + idx++ + ")");
        params.push(req.query.place_slug);
      }

      var where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
      var limit = parseInt(req.query.limit, 10) || 50;
      params.push(limit);

      var r = await db.query(
        "SELECT nse.*, np.name AS platform_name " +
        "FROM niche_sale_events nse " +
        "LEFT JOIN niche_platforms np ON np.id = nse.platform_id " +
        where + " ORDER BY nse.created_at DESC LIMIT $" + idx,
        params
      );
      res.json({ events: r.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/niche-sale-events/unprocessed ──
  // List events where processed=false.
  app.get("/api/niche-sale-events/unprocessed", async function(req, res) {
    var admin = await requireAdmin(req, res); if (!admin) return;
    try {
      var limit = parseInt(req.query.limit, 10) || 50;
      var r = await db.query(
        "SELECT nse.*, np.name AS platform_name " +
        "FROM niche_sale_events nse " +
        "LEFT JOIN niche_platforms np ON np.id = nse.platform_id " +
        "WHERE nse.processed = false ORDER BY nse.created_at DESC LIMIT $1",
        [limit]
      );
      res.json({ events: r.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  console.log("[niche-network] L3 module mounted — platforms, webhooks, sale events, buyer linkage");
};
