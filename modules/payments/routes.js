/**
 * Payments module routes (L1)
 * Stripe Connect, checkout, wallet, webhooks.
 * Extracted from PP Stripe + DT Connect onboarding.
 */

const { canAccessModule } = require('../../lib/module-access');

module.exports = function mountPayments(app, db) {

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
    res.status(404).json({ error: "Not found" });
  }

  // ── Stripe init (lazy — only if STRIPE_SECRET_KEY set) ──
  var stripe = null;
  try {
    if (process.env.STRIPE_SECRET_KEY) {
      stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
    }
  } catch(e) { console.error("[payments] Stripe not available:", e.message); }

  // ══════════════════════════════════════
  // Stripe Connect — seller onboarding
  // Extracted from DT routes/stripe.js + PP
  // ══════════════════════════════════════

  // ── GET /api/payments/connect/status ──
  app.get("/api/payments/connect/status", async function(req, res) {
    try {
      if (!(await checkFlag(req, "payments.stripe-connect"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var r = await db.query("SELECT * FROM seller_accounts WHERE user_id=$1", [uid]);
      if (!r.rows.length) return res.json({ connected: false });

      var sa = r.rows[0];
      // Optionally refresh from Stripe
      if (stripe && sa.stripe_account_id && !sa.stripe_charges_enabled) {
        try {
          var account = await stripe.accounts.retrieve(sa.stripe_account_id);
          if (account.charges_enabled !== sa.stripe_charges_enabled || account.payouts_enabled !== sa.stripe_payouts_enabled) {
            await db.query(
              "UPDATE seller_accounts SET stripe_charges_enabled=$1, stripe_payouts_enabled=$2, " +
              "stripe_onboarded=$3, updated_at=NOW() WHERE user_id=$4",
              [!!account.charges_enabled, !!account.payouts_enabled,
               !!account.charges_enabled, uid]
            );
            sa.stripe_charges_enabled = !!account.charges_enabled;
            sa.stripe_payouts_enabled = !!account.payouts_enabled;
            sa.stripe_onboarded = !!account.charges_enabled;
          }
        } catch(stripeErr) { console.error("stripe account refresh error:", stripeErr.message); }
      }

      res.json({
        connected: !!sa.stripe_onboarded,
        stripe_account_id: sa.stripe_account_id,
        charges_enabled: !!sa.stripe_charges_enabled,
        payouts_enabled: !!sa.stripe_payouts_enabled,
        platform_fee_pct: parseFloat(sa.platform_fee_pct) || 10
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch status" });
    }
  });

  // ── POST /api/payments/connect/start ──
  // Extracted from DT + PP: create Express account + onboarding link
  app.post("/api/payments/connect/start", async function(req, res) {
    try {
      if (!(await checkFlag(req, "payments.stripe-connect"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;
      if (!stripe) return res.status(500).json({ error: "Stripe not configured" });

      var existing = await db.query("SELECT stripe_account_id FROM seller_accounts WHERE user_id=$1", [uid]);
      var accountId;

      if (existing.rows.length && existing.rows[0].stripe_account_id) {
        accountId = existing.rows[0].stripe_account_id;
      } else {
        var account = await stripe.accounts.create({ type: "express" });
        accountId = account.id;
        if (existing.rows.length) {
          await db.query("UPDATE seller_accounts SET stripe_account_id=$1, updated_at=NOW() WHERE user_id=$2", [accountId, uid]);
        } else {
          await db.query("INSERT INTO seller_accounts (user_id, stripe_account_id) VALUES ($1,$2)", [uid, accountId]);
        }
      }

      var baseUrl = process.env.BASE_URL || "https://digitaltowns.app";
      var link = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: baseUrl + "/api/payments/connect/refresh",
        return_url: baseUrl + "/api/payments/connect/callback",
        type: "account_onboarding"
      });

      res.json({ url: link.url });
    } catch (err) {
      console.error("stripe connect start error:", err.message);
      res.status(500).json({ error: "Failed to start onboarding" });
    }
  });

  // ── GET /api/payments/connect/callback ──
  app.get("/api/payments/connect/callback", async function(req, res) {
    try {
      var uid = await getUserId(req);
      if (!uid) return res.redirect("/");

      var sa = await db.query("SELECT stripe_account_id FROM seller_accounts WHERE user_id=$1", [uid]);
      if (sa.rows.length && sa.rows[0].stripe_account_id && stripe) {
        var account = await stripe.accounts.retrieve(sa.rows[0].stripe_account_id);
        await db.query(
          "UPDATE seller_accounts SET stripe_onboarded=$1, stripe_charges_enabled=$2, " +
          "stripe_payouts_enabled=$3, updated_at=NOW() WHERE user_id=$4",
          [!!account.charges_enabled, !!account.charges_enabled, !!account.payouts_enabled, uid]
        );
      }

      res.redirect("/");
    } catch (err) {
      console.error("stripe connect callback error:", err.message);
      res.redirect("/");
    }
  });

  // ── POST /api/payments/connect/refresh ──
  app.post("/api/payments/connect/refresh", async function(req, res) {
    try {
      var uid = await requireLogin(req, res); if (!uid) return;
      if (!stripe) return res.status(500).json({ error: "Stripe not configured" });

      var sa = await db.query("SELECT stripe_account_id FROM seller_accounts WHERE user_id=$1", [uid]);
      if (!sa.rows.length || !sa.rows[0].stripe_account_id) {
        return res.status(400).json({ error: "No Stripe account found" });
      }

      var baseUrl = process.env.BASE_URL || "https://digitaltowns.app";
      var link = await stripe.accountLinks.create({
        account: sa.rows[0].stripe_account_id,
        refresh_url: baseUrl + "/api/payments/connect/refresh",
        return_url: baseUrl + "/api/payments/connect/callback",
        type: "account_onboarding"
      });

      res.json({ url: link.url });
    } catch (err) {
      res.status(500).json({ error: "Failed to refresh onboarding" });
    }
  });

  // ══════════════════════════════════════
  // Checkout — Stripe PaymentIntents
  // Extracted from PP destination charges
  // ══════════════════════════════════════

  // ── POST /api/payments/checkout ──
  app.post("/api/payments/checkout", async function(req, res) {
    try {
      if (!(await checkFlag(req, "payments.stripe-connect"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;
      if (!stripe) return res.status(500).json({ error: "Stripe not configured" });

      var b = req.body || {};
      if (!b.order_id) return res.status(400).json({ error: "order_id required" });

      var order = await db.query("SELECT * FROM orders WHERE id=$1 AND buyer_id=$2", [b.order_id, uid]);
      if (!order.rows.length) return res.status(404).json({ error: "Order not found" });
      var o = order.rows[0];

      // Get seller's Stripe account
      var sa = await db.query("SELECT stripe_account_id FROM seller_accounts WHERE user_id=$1", [o.seller_id]);
      if (!sa.rows.length || !sa.rows[0].stripe_account_id) {
        return res.status(400).json({ error: "Seller has not connected Stripe" });
      }

      var amountCents = o.total_cents;
      var platformFee = o.platform_fee_cents;

      var piParams = {
        amount: amountCents,
        currency: "usd",
        metadata: { order_id: String(o.id), buyer_id: String(uid) },
        application_fee_amount: platformFee,
        transfer_data: { destination: sa.rows[0].stripe_account_id }
      };

      var pi = await stripe.paymentIntents.create(piParams);

      await db.query("UPDATE orders SET stripe_payment_intent_id=$1 WHERE id=$2", [pi.id, o.id]);

      res.json({ client_secret: pi.client_secret, payment_intent_id: pi.id });
    } catch (err) {
      console.error("checkout error:", err.message);
      res.status(500).json({ error: "Checkout failed" });
    }
  });

  // ── POST /api/payments/deposit ──
  app.post("/api/payments/deposit", async function(req, res) {
    try {
      if (!(await checkFlag(req, "payments.deposits"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;
      if (!stripe) return res.status(500).json({ error: "Stripe not configured" });

      var b = req.body || {};
      if (!b.order_id) return res.status(400).json({ error: "order_id required" });

      var order = await db.query("SELECT * FROM orders WHERE id=$1 AND buyer_id=$2", [b.order_id, uid]);
      if (!order.rows.length) return res.status(404).json({ error: "Order not found" });
      var o = order.rows[0];

      if (o.deposit_cents <= 0) return res.status(400).json({ error: "No deposit configured for this order" });

      var sa = await db.query("SELECT stripe_account_id FROM seller_accounts WHERE user_id=$1", [o.seller_id]);
      if (!sa.rows.length || !sa.rows[0].stripe_account_id) {
        return res.status(400).json({ error: "Seller has not connected Stripe" });
      }

      var depositFee = Math.round(o.deposit_cents * 0.10);

      var pi = await stripe.paymentIntents.create({
        amount: o.deposit_cents,
        currency: "usd",
        metadata: { order_id: String(o.id), buyer_id: String(uid), type: "deposit" },
        application_fee_amount: depositFee,
        transfer_data: { destination: sa.rows[0].stripe_account_id }
      });

      res.json({ client_secret: pi.client_secret, payment_intent_id: pi.id });
    } catch (err) {
      console.error("deposit error:", err.message);
      res.status(500).json({ error: "Deposit failed" });
    }
  });

  // ══════════════════════════════════════
  // Stripe Webhook — extracted from PP
  // ══════════════════════════════════════

  // ── POST /api/webhooks/stripe ──
  app.post("/api/webhooks/stripe", async function(req, res) {
    try {
      if (!stripe) return res.sendStatus(400);

      var sig = req.headers["stripe-signature"];
      var event;
      try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
      } catch (err) {
        console.error("Webhook sig error:", err.message);
        return res.sendStatus(400);
      }

      if (event.type === "payment_intent.succeeded") {
        var pi = event.data.object;
        var orderId = pi.metadata && pi.metadata.order_id;
        var isDeposit = pi.metadata && pi.metadata.type === "deposit";

        if (orderId) {
          if (isDeposit) {
            await db.query(
              "UPDATE orders SET status='confirmed', stripe_payment_intent_id=$1, updated_at=NOW() WHERE id=$2",
              [pi.id, orderId]
            );
          } else {
            await db.query(
              "UPDATE orders SET status='paid', stripe_payment_intent_id=$1, updated_at=NOW() WHERE id=$2",
              [pi.id, orderId]
            );
            // Mark listing as sold
            var o = await db.query("SELECT listing_id FROM orders WHERE id=$1", [orderId]);
            if (o.rows.length && o.rows[0].listing_id) {
              await db.query("UPDATE listings SET status='sold', updated_at=NOW() WHERE id=$1", [o.rows[0].listing_id]);
            }
          }

          // Record transaction
          await db.query(
            "INSERT INTO payment_transactions (order_id, user_id, type, amount_cents, " +
            "platform_fee_cents, stripe_payment_intent_id, status) " +
            "VALUES ($1,$2,$3,$4,$5,$6,'succeeded')",
            [orderId, pi.metadata.buyer_id || null, isDeposit ? "deposit" : "charge",
             pi.amount, pi.application_fee_amount || 0, pi.id]
          );

          // Create notification for seller
          try {
            var orderR = await db.query("SELECT seller_id, total_cents FROM orders WHERE id=$1", [orderId]);
            if (orderR.rows.length) {
              var sellerId = orderR.rows[0].seller_id;
              var amount = (orderR.rows[0].total_cents / 100).toFixed(2);
              await db.query(
                "INSERT INTO notifications (user_id, type, title, body, data) VALUES ($1,$2,$3,$4,$5)",
                [sellerId, "order_update",
                 isDeposit ? "Deposit received" : "New sale!",
                 isDeposit ? "A $" + amount + " deposit was placed on your order" : "You made a $" + amount + " sale!",
                 JSON.stringify({ order_id: orderId })]
              );
            }
          } catch(nErr) { console.error("webhook notification error:", nErr.message); }
        }

        // Wallet deposit (from PP pattern)
        if (pi.metadata && pi.metadata.wallet_deposit === "true") {
          var walletUserId = parseInt(pi.metadata.user_id);
          var walletAmount = pi.amount;
          if (walletUserId && walletAmount > 0) {
            await db.query(
              "UPDATE wallet_balances SET balance_cents=balance_cents+$1, total_earned_cents=total_earned_cents+$1, updated_at=NOW() WHERE user_id=$2",
              [walletAmount, walletUserId]
            );
            await db.query(
              "INSERT INTO wallet_transactions (user_id, type, amount_cents, description) VALUES ($1,'credit',$2,'Wallet top-up via Stripe')",
              [walletUserId, walletAmount]
            );
          }
        }
      }

      else if (event.type === "payment_intent.payment_failed") {
        var pi = event.data.object;
        var orderId = pi.metadata && pi.metadata.order_id;
        if (orderId) {
          await db.query("UPDATE orders SET status='pending', updated_at=NOW() WHERE id=$1 AND status='pending'", [orderId]);
          await db.query(
            "INSERT INTO payment_transactions (order_id, user_id, type, amount_cents, stripe_payment_intent_id, status) " +
            "VALUES ($1,$2,'charge',$3,$4,'failed')",
            [orderId, pi.metadata.buyer_id || null, pi.amount, pi.id]
          );
        }
      }

      else if (event.type === "account.updated") {
        var account = event.data.object;
        await db.query(
          "UPDATE seller_accounts SET stripe_charges_enabled=$1, stripe_payouts_enabled=$2, " +
          "stripe_onboarded=$3, updated_at=NOW() WHERE stripe_account_id=$4",
          [!!account.charges_enabled, !!account.payouts_enabled,
           !!account.charges_enabled, account.id]
        );
      }

      else if (event.type === "charge.refunded") {
        var charge = event.data.object;
        var piId = charge.payment_intent;
        if (piId) {
          var txn = await db.query("SELECT order_id, user_id FROM payment_transactions WHERE stripe_payment_intent_id=$1 LIMIT 1", [piId]);
          if (txn.rows.length) {
            await db.query(
              "INSERT INTO payment_transactions (order_id, user_id, type, amount_cents, stripe_payment_intent_id, status) " +
              "VALUES ($1,$2,'refund',$3,$4,'succeeded')",
              [txn.rows[0].order_id, txn.rows[0].user_id, charge.amount_refunded, piId]
            );
            await db.query("UPDATE orders SET status='refunded', updated_at=NOW() WHERE id=$1", [txn.rows[0].order_id]);
          }
        }
      }

      res.json({ received: true });
    } catch (err) {
      console.error("webhook error:", err.message);
      res.json({ received: true });
    }
  });

  // ══════════════════════════════════════
  // Wallet — extracted from PP
  // ══════════════════════════════════════

  // ── GET /api/wallet ──
  app.get("/api/wallet", async function(req, res) {
    try {
      if (!(await checkFlag(req, "payments.wallet"))) return denyIfDisabled(res);
      var uid = await requireLogin(req, res); if (!uid) return;

      var bal = await db.query("SELECT * FROM wallet_balances WHERE user_id=$1", [uid]);
      var txns = await db.query(
        "SELECT * FROM wallet_transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50", [uid]
      );

      res.json({
        balance_cents: bal.rows.length ? bal.rows[0].balance_cents : 0,
        total_earned_cents: bal.rows.length ? bal.rows[0].total_earned_cents : 0,
        total_spent_cents: bal.rows.length ? bal.rows[0].total_spent_cents : 0,
        transactions: txns.rows
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch wallet" });
    }
  });

  // ── POST /api/wallet/credit (admin only) ──
  app.post("/api/wallet/credit", async function(req, res) {
    try {
      if (!(await checkFlag(req, "payments.wallet"))) return denyIfDisabled(res);
      var admin = await requireAdmin(req, res); if (!admin) return;

      var b = req.body || {};
      if (!b.user_id || !b.amount_cents) return res.status(400).json({ error: "user_id and amount_cents required" });

      var amount = parseInt(b.amount_cents);
      var userId = parseInt(b.user_id);

      // Upsert wallet balance
      var existing = await db.query("SELECT id FROM wallet_balances WHERE user_id=$1", [userId]);
      if (existing.rows.length) {
        await db.query(
          "UPDATE wallet_balances SET balance_cents=balance_cents+$1, total_earned_cents=total_earned_cents+$1, updated_at=NOW() WHERE user_id=$2",
          [amount, userId]
        );
      } else {
        await db.query(
          "INSERT INTO wallet_balances (user_id, balance_cents, total_earned_cents) VALUES ($1,$2,$2)",
          [userId, amount]
        );
      }

      await db.query(
        "INSERT INTO wallet_transactions (user_id, type, amount_cents, description) VALUES ($1,'credit',$2,$3)",
        [userId, amount, b.description || "Admin credit"]
      );

      res.json({ ok: true, amount_cents: amount });
    } catch (err) {
      res.status(500).json({ error: "Failed to credit wallet" });
    }
  });

  console.log("[payments] L1 module mounted — Stripe Connect, checkout, wallet, webhooks");
};
