/**
 * Listings module routes (L1)
 * Marketplace listings, auctions, bids, moderation.
 * Extracted from DT routes/listings.js + server.js auctions.
 */

module.exports = function mountListings(app, db) {

  // ── Auth helpers (same pattern as L0 modules) ──
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
    if (flags[flag] !== undefined) return !!flags[flag];
    return true; // default enabled
  }
  function denyIfDisabled(res) {
    res.status(404).json({ error: "Module not enabled" });
  }

  // ── GET /api/listings ──
  // Extracted from DT routes/listings.js with place-based filtering
  app.get("/api/listings", async function(req, res) {
    try {
      if (!(await checkFlag(req, "listings"))) return denyIfDisabled(res);
      var place_slug = req.query.place_slug;
      var category = req.query.category;
      var niche = req.query.niche;
      var type = req.query.type;
      var status = req.query.status || "active";
      var search = req.query.search;
      var limit = parseInt(req.query.limit) || 40;
      var offset = parseInt(req.query.offset) || 0;

      var conditions = ["l.status = $1"];
      var params = [status];
      var idx = 2;

      if (place_slug) {
        conditions.push("p.slug = $" + idx); params.push(place_slug); idx++;
      }
      if (category) { conditions.push("l.category = $" + idx); params.push(category); idx++; }
      if (niche) { conditions.push("l.niche = $" + idx); params.push(niche); idx++; }
      if (type) { conditions.push("l.listing_type = $" + idx); params.push(type); idx++; }
      if (search) {
        conditions.push("(l.title ILIKE $" + idx + " OR l.description ILIKE $" + idx + ")");
        params.push("%" + search + "%"); idx++;
      }

      var where = conditions.join(" AND ");
      var countR = await db.query(
        "SELECT COUNT(*) FROM listings l LEFT JOIN places p ON p.id = l.place_id WHERE " + where, params
      );
      var total = parseInt(countR.rows[0].count);

      params.push(limit); params.push(offset);
      var result = await db.query(
        "SELECT l.*, u.display_name AS seller_name, u.avatar_url AS seller_avatar, p.name AS place_name, p.slug AS place_slug " +
        "FROM listings l " +
        "LEFT JOIN users u ON u.id = l.seller_id " +
        "LEFT JOIN places p ON p.id = l.place_id " +
        "WHERE " + where + " " +
        "ORDER BY l.featured DESC, l.created_at DESC " +
        "LIMIT $" + idx + " OFFSET $" + (idx + 1),
        params
      );

      res.json({ listings: result.rows, total: total });
    } catch (err) {
      console.error("listings GET error:", err.message);
      res.status(500).json({ error: "Failed to fetch listings" });
    }
  });

  // ── GET /api/listings/:id ──
  app.get("/api/listings/:id", async function(req, res) {
    try {
      var result = await db.query(
        "SELECT l.*, u.display_name AS seller_name, u.avatar_url AS seller_avatar, " +
        "p.name AS place_name, p.slug AS place_slug " +
        "FROM listings l " +
        "LEFT JOIN users u ON u.id = l.seller_id " +
        "LEFT JOIN places p ON p.id = l.place_id " +
        "WHERE l.id = $1",
        [req.params.id]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Not found" });
      // Increment view count (fire and forget)
      db.query("UPDATE listings SET view_count = view_count + 1 WHERE id = $1", [req.params.id]).catch(function() {});
      res.json(result.rows[0]);
    } catch (err) {
      console.error("listing detail error:", err.message);
      res.status(500).json({ error: "Failed to fetch listing" });
    }
  });

  // ── POST /api/listings ──
  // Extracted from DT: auth required, trust_tier >= 1
  app.post("/api/listings", async function(req, res) {
    try {
      if (!(await checkFlag(req, "listings"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      // Check trust tier
      var userR = await db.query("SELECT id, trust_tier, display_name FROM users WHERE id=$1", [uid]);
      if (!userR.rows.length) return res.status(404).json({ error: "User not found" });
      var user = userR.rows[0];
      if ((parseInt(user.trust_tier) || 0) < 1) {
        return res.status(403).json({ error: "Trust tier 1+ required to list items" });
      }

      var b = req.body || {};
      if (!b.title) return res.status(400).json({ error: "Title required" });

      // ── Cross-module: word filter check ──
      try { var mod = require('../moderation/routes');
        if (mod.checkWordFilter) {
          var wfResult = await mod.checkWordFilter(db, (b.title || '') + ' ' + (b.description || ''));
          if (wfResult.blocked) return res.status(400).json({ error: "Content blocked by word filter", matches: wfResult.matches });
        }
      } catch(e) { console.error('word filter listing:', e.message); }

      var result = await db.query(
        "INSERT INTO listings (seller_id, place_id, title, description, price_cents, currency, category, niche, " +
        "condition, listing_type, shipping_enabled, pickup_enabled, delivery_enabled, quantity, tags, meta) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *",
        [uid, b.place_id || null, b.title, b.description || "", parseInt(b.price_cents) || 0,
         b.currency || "USD", b.category || "general", b.niche || "",
         b.condition || "used", b.listing_type || "buy_now",
         b.shipping_enabled !== false, b.pickup_enabled !== false,
         b.delivery_enabled === true, parseInt(b.quantity) || 1,
         JSON.stringify(b.tags || []), JSON.stringify(b.meta || {})]
      );

      // ── Cross-module: sweeps, achievements (fire-and-forget) ──
      try { var sweeps = require('../sweepstakes/routes');
        if (sweeps.tryAwardSweepPoints) sweeps.tryAwardSweepPoints(db, uid, 'listing', 'listing-' + result.rows[0].id, { place_id: b.place_id }).catch(function(e) { console.error('sweeps listing:', e.message); });
      } catch(e) {}
      try { var ach = require('../achievements/routes');
        if (ach.recordActivity) ach.recordActivity(db, uid, 'listing', { listing_id: result.rows[0].id }).catch(function(e) { console.error('ach listing:', e.message); });
      } catch(e) {}

      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error("listing create error:", err.message);
      res.status(500).json({ error: "Failed to create listing" });
    }
  });

  // ── PUT /api/listings/:id ──
  // Extracted from DT: own listing or admin
  app.put("/api/listings/:id", async function(req, res) {
    try {
      if (!(await checkFlag(req, "listings"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var existing = await db.query("SELECT * FROM listings WHERE id=$1", [req.params.id]);
      if (!existing.rows.length) return res.status(404).json({ error: "Not found" });
      if (existing.rows[0].seller_id !== uid) {
        var adminR = await db.query("SELECT is_admin FROM users WHERE id=$1", [uid]);
        if (!adminR.rows.length || !adminR.rows[0].is_admin) {
          return res.status(403).json({ error: "Forbidden" });
        }
      }

      var b = req.body || {};
      var result = await db.query(
        "UPDATE listings SET " +
        "title = COALESCE($1, title), description = COALESCE($2, description), " +
        "price_cents = COALESCE($3, price_cents), category = COALESCE($4, category), " +
        "niche = COALESCE($5, niche), condition = COALESCE($6, condition), " +
        "listing_type = COALESCE($7, listing_type), status = COALESCE($8, status), " +
        "shipping_enabled = COALESCE($9, shipping_enabled), pickup_enabled = COALESCE($10, pickup_enabled), " +
        "delivery_enabled = COALESCE($11, delivery_enabled), quantity = COALESCE($12, quantity), " +
        "tags = COALESCE($13, tags), meta = COALESCE($14, meta), " +
        "updated_at = NOW() WHERE id = $15 RETURNING *",
        [b.title || null, b.description || null, b.price_cents != null ? parseInt(b.price_cents) : null,
         b.category || null, b.niche || null, b.condition || null,
         b.listing_type || null, b.status || null,
         b.shipping_enabled != null ? b.shipping_enabled : null,
         b.pickup_enabled != null ? b.pickup_enabled : null,
         b.delivery_enabled != null ? b.delivery_enabled : null,
         b.quantity != null ? parseInt(b.quantity) : null,
         b.tags ? JSON.stringify(b.tags) : null, b.meta ? JSON.stringify(b.meta) : null,
         req.params.id]
      );

      res.json(result.rows[0]);
    } catch (err) {
      console.error("listing update error:", err.message);
      res.status(500).json({ error: "Failed to update listing" });
    }
  });

  // ── DELETE /api/listings/:id ──
  // Extracted from DT: soft delete, cancel active auctions
  app.delete("/api/listings/:id", async function(req, res) {
    try {
      if (!(await checkFlag(req, "listings"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var existing = await db.query("SELECT * FROM listings WHERE id=$1", [req.params.id]);
      if (!existing.rows.length) return res.status(404).json({ error: "Not found" });
      if (existing.rows[0].seller_id !== uid) {
        var adminR = await db.query("SELECT is_admin FROM users WHERE id=$1", [uid]);
        if (!adminR.rows.length || !adminR.rows[0].is_admin) {
          return res.status(403).json({ error: "Forbidden" });
        }
      }

      await db.query("UPDATE listings SET status = 'removed', updated_at = NOW() WHERE id = $1", [req.params.id]);
      // Cancel active auctions for this listing
      await db.query("UPDATE auctions SET status = 'cancelled' WHERE listing_id = $1 AND status IN ('active')", [req.params.id]);
      res.json({ ok: true });
    } catch (err) {
      console.error("listing delete error:", err.message);
      res.status(500).json({ error: "Failed to delete listing" });
    }
  });

  // ── GET /api/listings/:id/similar ──
  app.get("/api/listings/:id/similar", async function(req, res) {
    try {
      var orig = await db.query("SELECT category, place_id, seller_id FROM listings WHERE id=$1", [req.params.id]);
      if (!orig.rows.length) return res.status(404).json({ error: "Not found" });
      var o = orig.rows[0];
      var result = await db.query(
        "SELECT l.id, l.title, l.price_cents, l.photos, l.status, l.category " +
        "FROM listings l WHERE l.category = $1 AND l.status = 'active' AND l.id != $2 AND l.seller_id != $3 " +
        "ORDER BY CASE WHEN l.place_id = $4 THEN 0 ELSE 1 END, l.created_at DESC LIMIT 12",
        [o.category, req.params.id, o.seller_id, o.place_id]
      );
      res.json({ listings: result.rows });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch similar" });
    }
  });

  // ── POST /api/listings/:id/view ──
  app.post("/api/listings/:id/view", async function(req, res) {
    try {
      await db.query("UPDATE listings SET view_count = view_count + 1 WHERE id = $1", [req.params.id]);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: "Failed" });
    }
  });

  // ══════════════════════════════════════
  // Auctions — extracted from DT server.js
  // ══════════════════════════════════════

  // ── GET /api/auctions ──
  app.get("/api/auctions", async function(req, res) {
    try {
      if (!(await checkFlag(req, "listings.auctions"))) return denyIfDisabled(res);
      var place_slug = req.query.place_slug;
      var status = req.query.status || "active";
      var limit = parseInt(req.query.limit) || 40;
      var offset = parseInt(req.query.offset) || 0;

      var conditions = ["a.status = $1"];
      var params = [status];
      var idx = 2;

      if (place_slug) {
        conditions.push("p.slug = $" + idx); params.push(place_slug); idx++;
      }

      var where = conditions.join(" AND ");
      params.push(limit); params.push(offset);

      var result = await db.query(
        "SELECT a.*, l.title, l.description, l.photos, l.category, l.niche, " +
        "u.display_name AS seller_name, p.name AS place_name, p.slug AS place_slug " +
        "FROM auctions a " +
        "LEFT JOIN listings l ON l.id = a.listing_id " +
        "LEFT JOIN users u ON u.id = a.seller_id " +
        "LEFT JOIN places p ON p.id = a.place_id " +
        "WHERE " + where + " " +
        "ORDER BY a.ends_at ASC LIMIT $" + idx + " OFFSET $" + (idx + 1),
        params
      );

      res.json({ auctions: result.rows });
    } catch (err) {
      console.error("auctions GET error:", err.message);
      res.status(500).json({ error: "Failed to fetch auctions" });
    }
  });

  // ── GET /api/auctions/:id ──
  app.get("/api/auctions/:id", async function(req, res) {
    try {
      var result = await db.query(
        "SELECT a.*, l.title, l.description, l.photos, l.category, " +
        "u.display_name AS seller_name, " +
        "(SELECT json_agg(row_to_json(b) ORDER BY b.amount_cents DESC) FROM auction_bids b WHERE b.auction_id = a.id) AS bids " +
        "FROM auctions a " +
        "LEFT JOIN listings l ON l.id = a.listing_id " +
        "LEFT JOIN users u ON u.id = a.seller_id " +
        "WHERE a.id = $1",
        [req.params.id]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Not found" });
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch auction" });
    }
  });

  // ── POST /api/auctions ──
  // Extracted from DT: create auction for a listing
  app.post("/api/auctions", async function(req, res) {
    try {
      if (!(await checkFlag(req, "listings.auctions"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var b = req.body || {};
      if (!b.listing_id || !b.start_price_cents || !b.ends_at) {
        return res.status(400).json({ error: "listing_id, start_price_cents, ends_at required" });
      }

      // Verify listing ownership
      var listing = await db.query("SELECT id, seller_id, place_id FROM listings WHERE id=$1", [b.listing_id]);
      if (!listing.rows.length) return res.status(404).json({ error: "Listing not found" });
      if (listing.rows[0].seller_id !== uid) return res.status(403).json({ error: "Not your listing" });

      var result = await db.query(
        "INSERT INTO auctions (listing_id, seller_id, place_id, start_price_cents, current_price_cents, " +
        "reserve_price_cents, buy_now_price_cents, ends_at) " +
        "VALUES ($1,$2,$3,$4,$4,$5,$6,$7) RETURNING *",
        [b.listing_id, uid, listing.rows[0].place_id,
         parseInt(b.start_price_cents), parseInt(b.reserve_price_cents) || null,
         parseInt(b.buy_now_price_cents) || null, b.ends_at]
      );

      // Mark listing as auction type
      await db.query("UPDATE listings SET listing_type = 'auction' WHERE id = $1", [b.listing_id]);

      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error("auction create error:", err.message);
      res.status(500).json({ error: "Failed to create auction" });
    }
  });

  // ── POST /api/auctions/:id/bid ──
  // Extracted from DT: place a bid
  app.post("/api/auctions/:id/bid", async function(req, res) {
    try {
      if (!(await checkFlag(req, "listings.auctions"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var auction = await db.query("SELECT * FROM auctions WHERE id=$1", [req.params.id]);
      if (!auction.rows.length) return res.status(404).json({ error: "Auction not found" });
      var a = auction.rows[0];

      if (a.status !== "active") return res.status(400).json({ error: "Auction is not active" });
      if (new Date(a.ends_at) < new Date()) return res.status(400).json({ error: "Auction has ended" });
      if (a.seller_id === uid) return res.status(400).json({ error: "Cannot bid on own auction" });

      var amount = parseInt((req.body || {}).amount_cents);
      if (!amount || amount <= 0) return res.status(400).json({ error: "Invalid bid amount" });
      if (amount <= (a.current_price_cents || a.start_price_cents)) {
        return res.status(400).json({ error: "Bid must be higher than current price" });
      }

      await db.query(
        "INSERT INTO auction_bids (auction_id, bidder_id, amount_cents) VALUES ($1,$2,$3)",
        [req.params.id, uid, amount]
      );
      await db.query(
        "UPDATE auctions SET current_price_cents = $1, bid_count = bid_count + 1 WHERE id = $2",
        [amount, req.params.id]
      );

      res.json({ ok: true, amount_cents: amount });
    } catch (err) {
      console.error("auction bid error:", err.message);
      res.status(500).json({ error: "Failed to place bid" });
    }
  });

  // ── POST /api/auctions/:id/end ──
  // End auction (seller or admin)
  app.post("/api/auctions/:id/end", async function(req, res) {
    try {
      if (!(await checkFlag(req, "listings.auctions"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var auction = await db.query("SELECT * FROM auctions WHERE id=$1", [req.params.id]);
      if (!auction.rows.length) return res.status(404).json({ error: "Auction not found" });
      var a = auction.rows[0];

      // Verify seller or admin
      if (a.seller_id !== uid) {
        var adminR = await db.query("SELECT is_admin FROM users WHERE id=$1", [uid]);
        if (!adminR.rows.length || !adminR.rows[0].is_admin) {
          return res.status(403).json({ error: "Forbidden" });
        }
      }

      // Find winner (highest bid)
      var topBid = await db.query(
        "SELECT bidder_id, amount_cents FROM auction_bids WHERE auction_id=$1 ORDER BY amount_cents DESC LIMIT 1",
        [req.params.id]
      );
      var winnerId = topBid.rows.length ? topBid.rows[0].bidder_id : null;
      var winStatus = winnerId ? "sold" : "ended";

      await db.query(
        "UPDATE auctions SET status = $1, winner_id = $2 WHERE id = $3",
        [winStatus, winnerId, req.params.id]
      );

      if (winnerId) {
        await db.query("UPDATE listings SET status = 'sold' WHERE id = $1", [a.listing_id]);
      }

      res.json({ ok: true, status: winStatus, winner_id: winnerId });
    } catch (err) {
      console.error("auction end error:", err.message);
      res.status(500).json({ error: "Failed to end auction" });
    }
  });

  // ══════════════════════════════════════
  // Admin endpoints — moderation queue
  // ══════════════════════════════════════

  // ── GET /api/admin/listings ──
  app.get("/api/admin/listings", async function(req, res) {
    try {
      var admin = await requireAdmin(req, res); if (!admin) return;
      var status = req.query.status || "pending";
      var limit = parseInt(req.query.limit) || 50;
      var offset = parseInt(req.query.offset) || 0;

      var result = await db.query(
        "SELECT l.*, u.display_name AS seller_name, u.email AS seller_email, p.name AS place_name " +
        "FROM listings l LEFT JOIN users u ON u.id = l.seller_id LEFT JOIN places p ON p.id = l.place_id " +
        "WHERE l.status = $1 ORDER BY l.created_at DESC LIMIT $2 OFFSET $3",
        [status, limit, offset]
      );
      var countR = await db.query("SELECT COUNT(*) FROM listings WHERE status = $1", [status]);
      res.json({ listings: result.rows, total: parseInt(countR.rows[0].count) });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch listings" });
    }
  });

  // ── POST /api/admin/listings/:id/approve ──
  app.post("/api/admin/listings/:id/approve", async function(req, res) {
    try {
      var admin = await requireAdmin(req, res); if (!admin) return;
      var result = await db.query(
        "UPDATE listings SET status = 'active', updated_at = NOW() WHERE id = $1 RETURNING id, title, status",
        [req.params.id]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Not found" });
      res.json({ ok: true, listing: result.rows[0] });
    } catch (err) {
      res.status(500).json({ error: "Failed to approve" });
    }
  });

  // ── POST /api/admin/listings/:id/reject ──
  app.post("/api/admin/listings/:id/reject", async function(req, res) {
    try {
      var admin = await requireAdmin(req, res); if (!admin) return;
      var result = await db.query(
        "UPDATE listings SET status = 'removed', updated_at = NOW() WHERE id = $1 RETURNING id, title, status",
        [req.params.id]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Not found" });
      res.json({ ok: true, listing: result.rows[0] });
    } catch (err) {
      res.status(500).json({ error: "Failed to reject" });
    }
  });

  console.log("[listings] L1 module mounted — listings, auctions, moderation");
};
