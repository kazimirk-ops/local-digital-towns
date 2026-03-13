/**
 * Shipping module routes (L1)
 * Shippo rates, labels, tracking.
 * Extracted from PP server.js Shippo handlers.
 */

module.exports = function mountShipping(app, db) {

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

  // ── Feature flag enforcement ──
  async function checkFlag(req, flag) {
    var community = req.community || { slug: "digitaltowns", feature_flags: {} };
    var flags = community.feature_flags || {};
    if (flags[flag] !== undefined) return !!flags[flag];
    return true;
  }
  function denyIfDisabled(res) {
    res.status(404).json({ error: "Module not enabled" });
  }

  // ── Shippo API helper (from PP) ──
  async function shippoFetch(path, method, body) {
    var apiKey = (process.env.SHIPPO_API_KEY || "").trim();
    if (!apiKey) throw new Error("SHIPPO_API_KEY not configured");

    var opts = {
      method: method || "GET",
      headers: {
        "Authorization": "ShippoToken " + apiKey,
        "Content-Type": "application/json"
      }
    };
    if (body) opts.body = JSON.stringify(body);

    var response = await fetch("https://api.goshippo.com/" + path, opts);
    if (!response.ok) {
      var text = await response.text();
      throw new Error("Shippo API error: " + response.status + " " + text);
    }
    return response.json();
  }

  // ══════════════════════════════════════
  // Shipping rates — extracted from PP
  // ══════════════════════════════════════

  // ── POST /api/shipping/rates ──
  app.post("/api/shipping/rates", async function(req, res) {
    try {
      if (!(await checkFlag(req, "shipping.rates"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var b = req.body || {};
      if (!b.from || !b.to || !b.parcel) {
        return res.status(400).json({ error: "from, to, and parcel required" });
      }

      var shipment = await shippoFetch("shipments/", "POST", {
        address_from: {
          name: b.from.name || "Sender",
          street1: b.from.street1, city: b.from.city,
          state: b.from.state, zip: b.from.zip, country: b.from.country || "US"
        },
        address_to: {
          name: b.to.name || "Recipient",
          street1: b.to.street1, city: b.to.city,
          state: b.to.state, zip: b.to.zip, country: b.to.country || "US"
        },
        parcels: [{
          length: String(b.parcel.length || 10),
          width: String(b.parcel.width || 8),
          height: String(b.parcel.height || 4),
          distance_unit: "in",
          weight: String(b.parcel.weight_oz || 16),
          mass_unit: "oz"
        }],
        async: false
      });

      // Sort rates by price
      var rates = (shipment.rates || []).map(function(r) {
        return {
          rate_id: r.object_id,
          carrier: r.provider,
          service: r.servicelevel && r.servicelevel.name,
          amount_cents: Math.round(parseFloat(r.amount) * 100),
          currency: r.currency,
          estimated_days: r.estimated_days,
          duration_terms: r.duration_terms
        };
      }).sort(function(a, b) { return a.amount_cents - b.amount_cents; });

      res.json({ rates: rates, shippo_shipment_id: shipment.object_id });
    } catch (err) {
      console.error("shipping rates error:", err.message);
      res.status(500).json({ error: "Failed to fetch rates: " + err.message });
    }
  });

  // ══════════════════════════════════════
  // Label generation — extracted from PP
  // ══════════════════════════════════════

  // ── POST /api/shipping/labels ──
  app.post("/api/shipping/labels", async function(req, res) {
    try {
      if (!(await checkFlag(req, "shipping.labels"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var b = req.body || {};
      if (!b.rate_id) return res.status(400).json({ error: "rate_id required" });

      var txn = await shippoFetch("transactions", "POST", {
        rate: b.rate_id,
        label_file_type: "PDF",
        async: false
      });

      // Save shipment record
      var orderId = parseInt(b.order_id) || null;
      var result = await db.query(
        "INSERT INTO shipments (order_id, seller_id, carrier, service, tracking_number, label_url, " +
        "shippo_transaction_id, shippo_rate_id, rate_cents, status) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'label_created') RETURNING *",
        [orderId, uid, txn.carrier || null, txn.servicelevel_name || null,
         txn.tracking_number || null, txn.label_url || null,
         txn.object_id, b.rate_id,
         txn.rate ? Math.round(parseFloat(txn.rate) * 100) : null]
      );

      // Update order with tracking if linked
      if (orderId && txn.tracking_number) {
        await db.query(
          "UPDATE orders SET tracking_number=$1, carrier=$2, status='shipped', updated_at=NOW() WHERE id=$3",
          [txn.tracking_number, txn.carrier || null, orderId]
        );
      }

      res.json({
        shipment: result.rows[0],
        tracking_number: txn.tracking_number,
        label_url: txn.label_url
      });
    } catch (err) {
      console.error("shipping label error:", err.message);
      res.status(500).json({ error: "Failed to create label: " + err.message });
    }
  });

  // ── GET /api/shipping/label/:shipment_id ──
  app.get("/api/shipping/label/:shipment_id", async function(req, res) {
    try {
      var uid = await requireLogin(req, res); if (!uid) return;
      var r = await db.query("SELECT label_url FROM shipments WHERE id=$1 AND seller_id=$2", [req.params.shipment_id, uid]);
      if (!r.rows.length) return res.status(404).json({ error: "Not found" });
      if (!r.rows[0].label_url) return res.status(404).json({ error: "No label available" });
      res.json({ label_url: r.rows[0].label_url });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch label" });
    }
  });

  // ══════════════════════════════════════
  // Tracking — extracted from PP Shippo
  // ══════════════════════════════════════

  // ── GET /api/shipping/track/:tracking_number ──
  app.get("/api/shipping/track/:tracking_number", async function(req, res) {
    try {
      if (!(await checkFlag(req, "shipping.tracking"))) return denyIfDisabled(res);

      // Look up carrier from our records
      var shipR = await db.query("SELECT carrier FROM shipments WHERE tracking_number=$1 LIMIT 1", [req.params.tracking_number]);
      var carrier = shipR.rows.length ? shipR.rows[0].carrier : (req.query.carrier || "usps");

      var tracking = await shippoFetch(
        "tracks/" + encodeURIComponent(carrier) + "/" + encodeURIComponent(req.params.tracking_number),
        "GET"
      );

      res.json({
        tracking_number: req.params.tracking_number,
        carrier: carrier,
        status: tracking.tracking_status && tracking.tracking_status.status,
        status_details: tracking.tracking_status && tracking.tracking_status.status_details,
        eta: tracking.eta,
        events: (tracking.tracking_history || []).map(function(e) {
          return {
            status: e.status,
            details: e.status_details,
            location: e.location,
            date: e.status_date
          };
        })
      });
    } catch (err) {
      console.error("tracking error:", err.message);
      res.status(500).json({ error: "Failed to fetch tracking: " + err.message });
    }
  });

  // ══════════════════════════════════════
  // Shippo webhook
  // ══════════════════════════════════════

  // ── POST /api/webhooks/shippo ──
  app.post("/api/webhooks/shippo", async function(req, res) {
    try {
      var event = req.body || {};
      var eventType = event.event;

      if (eventType === "track_updated") {
        var data = event.data || {};
        var trackingNumber = data.tracking_number;
        var status = data.tracking_status && data.tracking_status.status;

        if (trackingNumber && status) {
          var statusMap = {
            "DELIVERED": "delivered",
            "IN_TRANSIT": "in_transit",
            "RETURNED": "returned",
            "FAILURE": "returned"
          };
          var newStatus = statusMap[status] || "in_transit";

          await db.query(
            "UPDATE shipments SET status=$1" +
            (newStatus === "delivered" ? ", delivered_at=NOW()" : "") +
            (newStatus === "in_transit" ? ", shipped_at=COALESCE(shipped_at,NOW())" : "") +
            " WHERE tracking_number=$2",
            [newStatus, trackingNumber]
          );

          // Update order status if delivered
          if (newStatus === "delivered") {
            await db.query(
              "UPDATE orders SET status='delivered', updated_at=NOW() WHERE id IN " +
              "(SELECT order_id FROM shipments WHERE tracking_number=$1)",
              [trackingNumber]
            );

            // Notify buyer
            try {
              var shipR = await db.query("SELECT buyer_id, order_id FROM shipments WHERE tracking_number=$1 LIMIT 1", [trackingNumber]);
              if (shipR.rows.length && shipR.rows[0].buyer_id) {
                await db.query(
                  "INSERT INTO notifications (user_id, type, title, body, data) VALUES ($1,$2,$3,$4,$5)",
                  [shipR.rows[0].buyer_id, "order_update", "Your package has been delivered!",
                   "Tracking: " + trackingNumber, JSON.stringify({ tracking_number: trackingNumber })]
                );
              }
            } catch(nErr) { console.error("shippo webhook notification error:", nErr.message); }
          }
        }
      }

      else if (eventType === "transaction_created") {
        var data = event.data || {};
        if (data.tracking_number && data.object_id) {
          await db.query(
            "UPDATE shipments SET tracking_number=$1, status='label_created' WHERE shippo_transaction_id=$2",
            [data.tracking_number, data.object_id]
          );
        }
      }

      res.json({ received: true });
    } catch (err) {
      console.error("shippo webhook error:", err.message);
      res.json({ received: true });
    }
  });

  // ══════════════════════════════════════
  // Seller shipment management
  // ══════════════════════════════════════

  // ── GET /api/shipments ──
  app.get("/api/shipments", async function(req, res) {
    try {
      var uid = await requireLogin(req, res); if (!uid) return;
      var result = await db.query(
        "SELECT s.*, o.total_cents AS order_total, l.title AS listing_title " +
        "FROM shipments s " +
        "LEFT JOIN orders o ON o.id = s.order_id " +
        "LEFT JOIN listings l ON l.id = o.listing_id " +
        "WHERE s.seller_id = $1 ORDER BY s.created_at DESC",
        [uid]
      );
      res.json({ shipments: result.rows });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch shipments" });
    }
  });

  // ── GET /api/shipments/:id ──
  app.get("/api/shipments/:id", async function(req, res) {
    try {
      var uid = await requireLogin(req, res); if (!uid) return;
      var result = await db.query(
        "SELECT s.*, o.total_cents AS order_total, l.title AS listing_title, " +
        "buyer.display_name AS buyer_name " +
        "FROM shipments s " +
        "LEFT JOIN orders o ON o.id = s.order_id " +
        "LEFT JOIN listings l ON l.id = o.listing_id " +
        "LEFT JOIN users buyer ON buyer.id = s.buyer_id " +
        "WHERE s.id = $1 AND s.seller_id = $2",
        [req.params.id, uid]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Not found" });
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch shipment" });
    }
  });

  console.log("[shipping] L1 module mounted — Shippo rates, labels, tracking");
};
