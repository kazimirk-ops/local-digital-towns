/**
 * Orders & Invoices module routes (L1)
 * Orders, invoices, buyer profiles, deposits.
 * Extracted from PP invoices + DT orders.
 */

const { canAccessModule } = require('../../lib/module-access');

module.exports = function mountOrders(app, db) {

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
  function denyIfDisabled(res) {
    res.status(404).json({ error: "Module not enabled" });
  }

  // ── Invoice number generator (from PP) ──
  function generateInvoiceNumber() {
    var now = new Date();
    var y = now.getFullYear().toString().slice(-2);
    var m = String(now.getMonth() + 1).padStart(2, "0");
    var rand = Math.random().toString(36).substring(2, 8).toUpperCase();
    return "INV-" + y + m + "-" + rand;
  }

  // ══════════════════════════════════════
  // Orders — extracted from DT orders
  // ══════════════════════════════════════

  // ── POST /api/orders ──
  app.post("/api/orders", async function(req, res) {
    try {
      if (!(await checkFlag(req, "orders"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var b = req.body || {};
      if (!b.listing_id) return res.status(400).json({ error: "listing_id required" });

      // Verify listing exists and is active
      var listing = await db.query("SELECT * FROM listings WHERE id=$1 AND status='active'", [b.listing_id]);
      if (!listing.rows.length) return res.status(404).json({ error: "Listing not found or not active" });
      var l = listing.rows[0];

      // Get or create buyer profile
      var profileId = null;
      if (await checkFlag(req, "orders.buyer-profiles")) {
        var bp = await db.query("SELECT id FROM buyer_profiles WHERE user_id=$1", [uid]);
        if (bp.rows.length) {
          profileId = bp.rows[0].id;
        } else {
          var userR = await db.query("SELECT email, display_name FROM users WHERE id=$1", [uid]);
          if (userR.rows.length) {
            var u = userR.rows[0];
            var newBp = await db.query(
              "INSERT INTO buyer_profiles (user_id, email, name) VALUES ($1,$2,$3) RETURNING id",
              [uid, u.email, u.display_name]
            );
            profileId = newBp.rows[0].id;
          }
        }
      }

      var subtotal = l.price_cents;
      var shippingCents = parseInt(b.shipping_cents) || 0;
      var platformFee = Math.round(subtotal * 0.10); // 10% platform fee
      var total = subtotal + shippingCents;
      var depositCents = 0;
      var depositPct = parseInt(b.deposit_pct) || 0;
      if (depositPct > 0 && (await checkFlag(req, "orders.deposits"))) {
        depositCents = Math.round(total * depositPct / 100);
      }

      var result = await db.query(
        "INSERT INTO orders (listing_id, seller_id, buyer_id, buyer_profile_id, place_id, " +
        "subtotal_cents, shipping_cents, platform_fee_cents, total_cents, " +
        "deposit_cents, deposit_pct, balance_due_cents, payment_method, shipping_address, notes) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *",
        [b.listing_id, l.seller_id, uid, profileId, l.place_id,
         subtotal, shippingCents, platformFee, total,
         depositCents, depositPct, total - depositCents,
         b.payment_method || "stripe",
         JSON.stringify(b.shipping_address || {}), b.notes || null]
      );

      // ── Cross-module: sweeps, achievements, referrals (fire-and-forget) ──
      try { var sweeps = require('../sweepstakes/routes');
        if (sweeps.tryAwardSweepPoints) sweeps.tryAwardSweepPoints(db, uid, 'purchase', 'order-' + result.rows[0].id, { amount_cents: subtotal, place_id: l.place_id }).catch(function(e) { console.error('sweeps order:', e.message); });
      } catch(e) {}
      try { var ach = require('../achievements/routes');
        if (ach.recordActivity) ach.recordActivity(db, uid, 'purchase', { amount_cents: subtotal, listing_id: b.listing_id }).catch(function(e) { console.error('ach order:', e.message); });
      } catch(e) {}
      try { var ref = require('../referrals/routes');
        if (ref.fireReferralEvent) ref.fireReferralEvent(db, uid, 'purchase', subtotal, null, 'Order #' + result.rows[0].id).catch(function(e) { console.error('ref order:', e.message); });
      } catch(e) {}

      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error("order create error:", err.message);
      res.status(500).json({ error: "Failed to create order" });
    }
  });

  // ── GET /api/orders (buyer's orders) ──
  app.get("/api/orders", async function(req, res) {
    try {
      if (!(await checkFlag(req, "orders"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var result = await db.query(
        "SELECT o.*, l.title AS listing_title, l.photos AS listing_photos, " +
        "seller.display_name AS seller_name, buyer.display_name AS buyer_name " +
        "FROM orders o " +
        "LEFT JOIN listings l ON l.id = o.listing_id " +
        "LEFT JOIN users seller ON seller.id = o.seller_id " +
        "LEFT JOIN users buyer ON buyer.id = o.buyer_id " +
        "WHERE o.buyer_id = $1 ORDER BY o.created_at DESC",
        [uid]
      );
      res.json({ orders: result.rows });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch orders" });
    }
  });

  // ── GET /api/orders/selling (seller's orders) ──
  app.get("/api/orders/selling", async function(req, res) {
    try {
      if (!(await checkFlag(req, "orders"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var result = await db.query(
        "SELECT o.*, l.title AS listing_title, l.photos AS listing_photos, " +
        "buyer.display_name AS buyer_name, buyer.email AS buyer_email " +
        "FROM orders o " +
        "LEFT JOIN listings l ON l.id = o.listing_id " +
        "LEFT JOIN users buyer ON buyer.id = o.buyer_id " +
        "WHERE o.seller_id = $1 ORDER BY o.created_at DESC",
        [uid]
      );
      res.json({ orders: result.rows });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch orders" });
    }
  });

  // ── GET /api/orders/:id ──
  app.get("/api/orders/:id", async function(req, res) {
    try {
      var uid = await requireLogin(req, res); if (!uid) return;
      var result = await db.query(
        "SELECT o.*, l.title AS listing_title, l.photos AS listing_photos, l.description AS listing_description, " +
        "seller.display_name AS seller_name, seller.email AS seller_email, " +
        "buyer.display_name AS buyer_name, buyer.email AS buyer_email " +
        "FROM orders o " +
        "LEFT JOIN listings l ON l.id = o.listing_id " +
        "LEFT JOIN users seller ON seller.id = o.seller_id " +
        "LEFT JOIN users buyer ON buyer.id = o.buyer_id " +
        "WHERE o.id = $1 AND (o.buyer_id = $2 OR o.seller_id = $2)",
        [req.params.id, uid]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Not found" });
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch order" });
    }
  });

  // ── PUT /api/orders/:id/status ──
  app.put("/api/orders/:id/status", async function(req, res) {
    try {
      var uid = await requireLogin(req, res); if (!uid) return;
      var order = await db.query("SELECT * FROM orders WHERE id=$1", [req.params.id]);
      if (!order.rows.length) return res.status(404).json({ error: "Not found" });
      var o = order.rows[0];
      if (o.seller_id !== uid && o.buyer_id !== uid) {
        var adminR = await db.query("SELECT is_admin FROM users WHERE id=$1", [uid]);
        if (!adminR.rows.length || !adminR.rows[0].is_admin) return res.status(403).json({ error: "Forbidden" });
      }

      var newStatus = (req.body || {}).status;
      var allowed = ["confirmed", "paid", "shipped", "delivered", "cancelled", "refunded"];
      if (!newStatus || allowed.indexOf(newStatus) === -1) {
        return res.status(400).json({ error: "Invalid status. Allowed: " + allowed.join(", ") });
      }

      var result = await db.query(
        "UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
        [newStatus, req.params.id]
      );
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: "Failed to update order" });
    }
  });

  // ── POST /api/orders/:id/cancel ──
  app.post("/api/orders/:id/cancel", async function(req, res) {
    try {
      var uid = await requireLogin(req, res); if (!uid) return;
      var order = await db.query("SELECT * FROM orders WHERE id=$1", [req.params.id]);
      if (!order.rows.length) return res.status(404).json({ error: "Not found" });
      var o = order.rows[0];
      if (o.buyer_id !== uid) return res.status(403).json({ error: "Only buyer can cancel" });
      if (o.status !== "pending" && o.status !== "confirmed") {
        return res.status(400).json({ error: "Order cannot be cancelled in status: " + o.status });
      }

      await db.query("UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1", [req.params.id]);
      // Restore listing if it was marked sold
      await db.query("UPDATE listings SET status = 'active' WHERE id = $1 AND status = 'sold'", [o.listing_id]);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to cancel order" });
    }
  });

  // ══════════════════════════════════════
  // Invoices — extracted from PP
  // ══════════════════════════════════════

  // ── POST /api/invoices ──
  app.post("/api/invoices", async function(req, res) {
    try {
      if (!(await checkFlag(req, "orders.invoices"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var b = req.body || {};
      if (!b.line_items || !b.line_items.length) {
        return res.status(400).json({ error: "line_items required" });
      }

      // Calculate totals from line items
      var subtotal = 0;
      for (var i = 0; i < b.line_items.length; i++) {
        subtotal += parseInt(b.line_items[i].amount_cents) || 0;
      }
      var shippingCents = parseInt(b.shipping_cents) || 0;
      var discountCents = parseInt(b.discount_cents) || 0;
      var total = subtotal + shippingCents - discountCents;
      var depositPct = parseInt(b.deposit_pct) || 0;
      var depositAmount = depositPct > 0 ? Math.round(total * depositPct / 100) : 0;

      // Find or create buyer profile
      var buyerProfileId = null;
      if (b.buyer_email) {
        var bpR = await db.query("SELECT id FROM buyer_profiles WHERE email=$1", [b.buyer_email]);
        if (bpR.rows.length) {
          buyerProfileId = bpR.rows[0].id;
        }
      }

      var result = await db.query(
        "INSERT INTO invoices (seller_id, buyer_profile_id, invoice_number, line_items, " +
        "subtotal_cents, shipping_cents, discount_cents, total_cents, " +
        "deposit_pct, deposit_amount_cents, notes, due_date) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *",
        [uid, buyerProfileId, generateInvoiceNumber(),
         JSON.stringify(b.line_items), subtotal, shippingCents, discountCents, total,
         depositPct, depositAmount, b.notes || null, b.due_date || null]
      );

      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error("invoice create error:", err.message);
      res.status(500).json({ error: "Failed to create invoice" });
    }
  });

  // ── GET /api/invoices ──
  app.get("/api/invoices", async function(req, res) {
    try {
      if (!(await checkFlag(req, "orders.invoices"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var result = await db.query(
        "SELECT i.*, bp.email AS buyer_email, bp.name AS buyer_name " +
        "FROM invoices i " +
        "LEFT JOIN buyer_profiles bp ON bp.id = i.buyer_profile_id " +
        "WHERE i.seller_id = $1 ORDER BY i.created_at DESC",
        [uid]
      );
      res.json({ invoices: result.rows });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch invoices" });
    }
  });

  // ── GET /api/invoices/:id ──
  app.get("/api/invoices/:id", async function(req, res) {
    try {
      var uid = await getUserId(req);
      var result = await db.query(
        "SELECT i.*, bp.email AS buyer_email, bp.name AS buyer_name, " +
        "s.display_name AS seller_name, s.email AS seller_email " +
        "FROM invoices i " +
        "LEFT JOIN buyer_profiles bp ON bp.id = i.buyer_profile_id " +
        "LEFT JOIN users s ON s.id = i.seller_id " +
        "WHERE i.id = $1",
        [req.params.id]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Not found" });
      // Allow access to seller, buyer (matched by profile), or admin
      var inv = result.rows[0];
      if (uid && inv.seller_id === uid) { /* ok */ }
      else if (uid) {
        var bpCheck = await db.query("SELECT id FROM buyer_profiles WHERE user_id=$1 AND id=$2", [uid, inv.buyer_profile_id]);
        if (!bpCheck.rows.length) {
          var adminR = await db.query("SELECT is_admin FROM users WHERE id=$1", [uid]);
          if (!adminR.rows.length || !adminR.rows[0].is_admin) {
            return res.status(403).json({ error: "Forbidden" });
          }
        }
      }
      res.json(inv);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch invoice" });
    }
  });

  // ── PUT /api/invoices/:id ──
  app.put("/api/invoices/:id", async function(req, res) {
    try {
      if (!(await checkFlag(req, "orders.invoices"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var existing = await db.query("SELECT * FROM invoices WHERE id=$1 AND seller_id=$2", [req.params.id, uid]);
      if (!existing.rows.length) return res.status(404).json({ error: "Not found" });
      if (existing.rows[0].status !== "draft") {
        return res.status(400).json({ error: "Can only edit draft invoices" });
      }

      var b = req.body || {};
      var lineItems = b.line_items || existing.rows[0].line_items;
      var subtotal = 0;
      for (var i = 0; i < lineItems.length; i++) {
        subtotal += parseInt(lineItems[i].amount_cents) || 0;
      }
      var shippingCents = b.shipping_cents != null ? parseInt(b.shipping_cents) : existing.rows[0].shipping_cents;
      var discountCents = b.discount_cents != null ? parseInt(b.discount_cents) : existing.rows[0].discount_cents;
      var total = subtotal + shippingCents - discountCents;

      var result = await db.query(
        "UPDATE invoices SET line_items=$1, subtotal_cents=$2, shipping_cents=$3, discount_cents=$4, " +
        "total_cents=$5, notes=COALESCE($6, notes), due_date=COALESCE($7, due_date), updated_at=NOW() " +
        "WHERE id=$8 RETURNING *",
        [JSON.stringify(lineItems), subtotal, shippingCents, discountCents, total,
         b.notes || null, b.due_date || null, req.params.id]
      );
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: "Failed to update invoice" });
    }
  });

  // ── POST /api/invoices/:id/send ──
  // Extracted from PP: mark as sent + email buyer
  app.post("/api/invoices/:id/send", async function(req, res) {
    try {
      if (!(await checkFlag(req, "orders.invoices"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var inv = await db.query(
        "SELECT i.*, bp.email AS buyer_email, bp.name AS buyer_name " +
        "FROM invoices i LEFT JOIN buyer_profiles bp ON bp.id = i.buyer_profile_id " +
        "WHERE i.id=$1 AND i.seller_id=$2",
        [req.params.id, uid]
      );
      if (!inv.rows.length) return res.status(404).json({ error: "Not found" });

      await db.query(
        "UPDATE invoices SET status='sent', sent_at=NOW(), updated_at=NOW() WHERE id=$1",
        [req.params.id]
      );

      // Send email via Resend (if available)
      if (inv.rows[0].buyer_email) {
        try {
          var notify = null;
          try { notify = require("./modules/notifications/routes"); } catch(e) {}
          if (notify && notify.sendEmail) {
            var sellerR = await db.query("SELECT display_name FROM users WHERE id=$1", [uid]);
            var sellerName = sellerR.rows.length ? sellerR.rows[0].display_name : "Seller";
            await notify.sendEmail(
              inv.rows[0].buyer_email,
              "Invoice from " + sellerName + " — " + inv.rows[0].invoice_number,
              "<div style=\"font-family:sans-serif;max-width:500px;margin:0 auto;\">" +
              "<h2 style=\"color:#0ea5e9;\">You have a new invoice</h2>" +
              "<p><strong>From:</strong> " + sellerName + "</p>" +
              "<p><strong>Invoice:</strong> " + inv.rows[0].invoice_number + "</p>" +
              "<p><strong>Total:</strong> $" + (inv.rows[0].total_cents / 100).toFixed(2) + "</p>" +
              "</div>"
            );
          }
        } catch(emailErr) { console.error("invoice send email error:", emailErr.message); }
      }

      res.json({ ok: true, status: "sent" });
    } catch (err) {
      res.status(500).json({ error: "Failed to send invoice" });
    }
  });

  // ── POST /api/invoices/:id/pay ──
  // Buyer marks invoice as paid (after Stripe webhook or manual)
  app.post("/api/invoices/:id/pay", async function(req, res) {
    try {
      if (!(await checkFlag(req, "orders.invoices"))) return denyIfDisabled(res);

      var inv = await db.query("SELECT * FROM invoices WHERE id=$1", [req.params.id]);
      if (!inv.rows.length) return res.status(404).json({ error: "Not found" });
      var i = inv.rows[0];
      if (i.status === "paid" || i.status === "fulfilled") {
        return res.status(400).json({ error: "Invoice already paid" });
      }

      var amountPaid = parseInt((req.body || {}).amount_cents) || i.total_cents;
      var newStatus = amountPaid >= i.total_cents ? "paid" : "partial";

      await db.query(
        "UPDATE invoices SET status=$1, amount_paid_cents=amount_paid_cents+$2, paid_at=NOW(), updated_at=NOW() WHERE id=$3",
        [newStatus, amountPaid, req.params.id]
      );

      // ── Cross-module: sweeps, achievements, referrals on invoice paid (fire-and-forget) ──
      try { var sweeps2 = require('../sweepstakes/routes');
        if (sweeps2.tryAwardSweepPoints) sweeps2.tryAwardSweepPoints(db, i.seller_id, 'sale', 'invoice-' + req.params.id, { amount_cents: amountPaid }).catch(function(e) { console.error('sweeps invoice:', e.message); });
      } catch(e) {}
      try { var ach2 = require('../achievements/routes');
        if (ach2.recordActivity) ach2.recordActivity(db, i.seller_id, 'sale', { amount_cents: amountPaid, invoice_id: req.params.id }).catch(function(e) { console.error('ach invoice:', e.message); });
      } catch(e) {}
      try { var ref2 = require('../referrals/routes');
        if (ref2.fireReferralEvent) ref2.fireReferralEvent(db, i.seller_id, 'sale', amountPaid, null, 'Invoice #' + req.params.id).catch(function(e) { console.error('ref invoice:', e.message); });
      } catch(e) {}

      res.json({ ok: true, status: newStatus, amount_paid_cents: amountPaid });
    } catch (err) {
      res.status(500).json({ error: "Failed to process payment" });
    }
  });

  // ── POST /api/invoices/:id/refund ──
  app.post("/api/invoices/:id/refund", async function(req, res) {
    try {
      if (!(await checkFlag(req, "orders.refunds"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var inv = await db.query("SELECT * FROM invoices WHERE id=$1 AND seller_id=$2", [req.params.id, uid]);
      if (!inv.rows.length) return res.status(404).json({ error: "Not found" });
      if (inv.rows[0].status !== "paid") {
        return res.status(400).json({ error: "Can only refund paid invoices" });
      }

      await db.query(
        "UPDATE invoices SET status='refunded', updated_at=NOW() WHERE id=$1",
        [req.params.id]
      );
      res.json({ ok: true, status: "refunded" });
    } catch (err) {
      res.status(500).json({ error: "Failed to refund invoice" });
    }
  });

  // ══════════════════════════════════════
  // Buyer profiles
  // ══════════════════════════════════════

  // ── GET /api/buyer-profile ──
  app.get("/api/buyer-profile", async function(req, res) {
    try {
      if (!(await checkFlag(req, "orders.buyer-profiles"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var result = await db.query("SELECT * FROM buyer_profiles WHERE user_id=$1", [uid]);
      if (!result.rows.length) return res.json({ profile: null });
      res.json({ profile: result.rows[0] });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch profile" });
    }
  });

  // ── PUT /api/buyer-profile ──
  app.put("/api/buyer-profile", async function(req, res) {
    try {
      if (!(await checkFlag(req, "orders.buyer-profiles"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var b = req.body || {};
      var existing = await db.query("SELECT id FROM buyer_profiles WHERE user_id=$1", [uid]);

      if (existing.rows.length) {
        var result = await db.query(
          "UPDATE buyer_profiles SET " +
          "name=COALESCE($1,name), phone=COALESCE($2,phone), " +
          "ship_to_name=COALESCE($3,ship_to_name), ship_to_street=COALESCE($4,ship_to_street), " +
          "ship_to_city=COALESCE($5,ship_to_city), ship_to_state=COALESCE($6,ship_to_state), " +
          "ship_to_zip=COALESCE($7,ship_to_zip), ship_to_country=COALESCE($8,ship_to_country), " +
          "notes=COALESCE($9,notes) WHERE user_id=$10 RETURNING *",
          [b.name, b.phone, b.ship_to_name, b.ship_to_street,
           b.ship_to_city, b.ship_to_state, b.ship_to_zip,
           b.ship_to_country, b.notes, uid]
        );
        res.json({ profile: result.rows[0] });
      } else {
        var userR = await db.query("SELECT email FROM users WHERE id=$1", [uid]);
        var email = userR.rows.length ? userR.rows[0].email : "";
        var result = await db.query(
          "INSERT INTO buyer_profiles (user_id, email, name, phone, " +
          "ship_to_name, ship_to_street, ship_to_city, ship_to_state, ship_to_zip, ship_to_country, notes) " +
          "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
          [uid, email, b.name, b.phone, b.ship_to_name, b.ship_to_street,
           b.ship_to_city, b.ship_to_state, b.ship_to_zip, b.ship_to_country || "US", b.notes]
        );
        res.json({ profile: result.rows[0] });
      }
    } catch (err) {
      console.error("buyer profile update error:", err.message);
      res.status(500).json({ error: "Failed to update profile" });
    }
  });

  console.log("[orders] L1 module mounted — orders, invoices, buyer profiles");
};
