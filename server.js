try {
  require("dotenv").config();
} catch (err) {
  if (err && err.code !== "MODULE_NOT_FOUND") throw err;
  const fs = require("fs");
  const path = require("path");
  const envPath = path.join(__dirname, ".env");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      if (!line || line.trim().startsWith("#")) continue;
      const idx = line.indexOf("=");
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim().replace(/^"|"$/g, "");
      if (!(key in process.env)) process.env[key] = val;
    }
  }
}

// ============ SENTRY ERROR MONITORING ============
let Sentry;
if (process.env.SENTRY_DSN) {
  try {
    Sentry = require("@sentry/node");
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || "development",
      tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
      beforeSend(event) {
        // Don't send events in development unless explicitly enabled
        if (process.env.NODE_ENV !== "production" && !process.env.SENTRY_FORCE_ENABLE) {
          return null;
        }
        return event;
      }
    });
    console.log("Monitoring: Sentry enabled");
  } catch (e) {
    console.log("Monitoring: Sentry not installed (npm install @sentry/node)");
  }
} else {
  console.log("Monitoring: Sentry disabled (no SENTRY_DSN)");
}

const express = require("express");
const path = require("path");
const multer = require("multer");
const trust = require("./lib/trust");
const { sendAdminEmail, sendEmail } = require("./lib/notify");
const db = require("./lib/db");
const TRUST_TIER_LABELS = trust.TRUST_TIER_LABELS;
async function getTrustBadgeForUser(userId){
  if (!userId || isNaN(Number(userId))) return null;
  const user = await data.getUserById(userId);
  if(!user) return null;
  const ctx = await data.getTownContext(1, userId);
  const tier = trust.resolveTier(user, ctx);
  return {
    userId: user.id,
    displayName: await data.getDisplayNameForUser(user),
    trustTier: tier,
    trustTierLabel: TRUST_TIER_LABELS[tier] || "Visitor"
  };
}
const crypto = require("crypto");
const app = express();

// Sentry is auto-instrumented in v8+ (no request handler needed)

const data = require("./data");
const { TOWN_DIRECTORY } = require("./town_directory");
const { uploadImage } = require("./lib/r2");
const permissions = require("./lib/permissions");
const stripe = process.env.STRIPE_SECRET_KEY ? require("stripe")(process.env.STRIPE_SECRET_KEY) : null;
const CF_CALLS_APP_ID = process.env.CF_CALLS_APP_ID || "";
const CF_CALLS_APP_SECRET = process.env.CF_CALLS_APP_SECRET || "";
const CF_CALLS_BASE_URL = (process.env.CF_CALLS_BASE_URL || "https://api.cloudflare.com/client/v4").replace(/\/$/, "");
const ADMIN_EMAIL_ALLOWLIST = new Set((process.env.ADMIN_EMAILS || "").split(",").map(s=>s.trim().toLowerCase()).filter(Boolean));
const adminSweepRules = [];
let nextSweepRuleId = 1;
let nextSweepstakeId = 1;
const chatImageUploadRate = new Map();

// ============ SECURITY MIDDLEWARE ============

// Helmet - Security headers
let helmet;
try {
  helmet = require("helmet");
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://js.stripe.com", "https://connect.facebook.net"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        connectSrc: ["'self'", "https://api.stripe.com", "https://graph.facebook.com", "wss:"],
        frameSrc: ["'self'", "https://js.stripe.com", "https://www.facebook.com"],
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
  }));
  console.log("Security: Helmet enabled");
} catch(e) {
  console.log("Security: Helmet not installed (npm install helmet)");
}

// CORS - Cross-Origin Resource Sharing
let cors;
try {
  cors = require("cors");
  const allowedOrigins = (process.env.CORS_ORIGINS || "").split(",").filter(Boolean);
  app.use(cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"]
  }));
  console.log("Security: CORS enabled");
} catch(e) {
  console.log("Security: CORS not installed (npm install cors)");
}

// Rate Limiting
let rateLimit;
try {
  rateLimit = require("express-rate-limit");
  // General API rate limit
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 500, // limit each IP to 500 requests per windowMs
    message: { error: "Too many requests, please try again later." },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      // Skip rate limiting for health checks
      return req.path === "/health";
    }
  });
  app.use("/api/", apiLimiter);

  // Stricter limit for auth endpoints
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20, // 20 attempts per 15 minutes
    message: { error: "Too many authentication attempts, please try again later." },
    standardHeaders: true,
    legacyHeaders: false
  });
  app.use("/api/auth/", authLimiter);
  app.use("/signup/", authLimiter);

  console.log("Security: Rate limiting enabled");
} catch(e) {
  console.log("Security: Rate limiting not installed (npm install express-rate-limit)");
}

// Trust proxy for proper IP detection behind Render's load balancer
app.set("trust proxy", 1);

// Health check endpoint (before static files)
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    town: process.env.TOWN_NAME || "Sebastian"
  });
});

app.use(express.static(path.join(__dirname, "public")));

// X-Request-Id middleware
app.use((req, res, next) => {
  const requestId = crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
});

const jsonParser = express.json({ limit: "5mb" });
const urlencodedParser = express.urlencoded({ extended: false });
app.use(async (req,res,next)=>{
  if(req.path === "/api/stripe/webhook") return next();
  return jsonParser(req,res,next);
});
const LOCKDOWN = (process.env.LOCKDOWN_MODE || "").toLowerCase() === "true";
app.use(async (req,res,next)=>{
  if(!LOCKDOWN) return next();
  const pathName = req.path || "";
  const isGet = req.method === "GET";
  if(isGet && pathName === "/health") return next();
  if(isGet && (pathName === "/waitlist" || pathName === "/apply/business" || pathName === "/apply/resident")) return next();
  if(isGet && (pathName === "/admin/login" || pathName === "/admin/bootstrap")) return next();
  if(isGet && pathName.startsWith("/sweep/claim/")) return next();
  if(isGet && pathName === "/auth/magic") return next();
  if(pathName === "/auth/logout" && (req.method === "GET" || req.method === "POST")) return next();
  if(req.method === "POST" && pathName === "/auth/request-link") return next();
  if(req.method === "POST" && pathName === "/admin/login") return next();
  if(req.method === "POST"){
    if(pathName === "/api/public/waitlist") return next();
    if(pathName === "/api/public/apply/business") return next();
    if(pathName === "/api/public/apply/resident") return next();
    if(pathName === "/api/auth/request-code") return next();
    if(pathName === "/api/auth/verify-code") return next();
    if(pathName.startsWith("/api/sweep/claim/")) return next();
    if(pathName === "/api/admin/test-email") return next();
  }
  if(isGet && pathName.startsWith("/api/sweep/claim/")) return next();
  if(isGet && pathName === "/api/me") return next();
  if(isGet){
    const isStatic =
      pathName === "/favicon.ico" ||
      pathName.startsWith("/images/") ||
      pathName.startsWith("/css/") ||
      pathName.startsWith("/js/") ||
      pathName.startsWith("/fonts/") ||
      pathName.startsWith("/uploads/") ||
      /\.[a-z0-9]+$/i.test(pathName);
    if(isStatic) return next();
  }
  const userId = await getUserId(req);
  const user = userId ? await data.getUserById(userId) : null;
  if(isAdminUser(user)) return next();
  if(pathName.startsWith("/api")){
    return res.status(403).json({ error: "coming soon" });
  }
  setCookie(res, "lockdown_logged_in", userId ? "1" : "0", { maxAge: 300 });
  return res.status(200).sendFile(path.join(__dirname,"public","coming_soon.html"));
});
app.use("/admin", async (req, res, next) =>{
  if(req.path === "/login" || req.path === "/bootstrap") return next();
  const userId = await getUserId(req);
  const user = userId ? await data.getUserById(userId) : null;
  if(isAdminUser(user)) return next();
  if(req.method === "GET" || req.method === "HEAD"){
    return res.redirect("/ui");
  }
  return res.status(403).json({ error: "Admin access required" });
});
app.use("/api/admin", async (req, res, next) =>{
  if(req.path === "/test-email") return next();
  const userId = await getUserId(req);
  const user = userId ? await data.getUserById(userId) : null;
  if(isAdminUser(user)) return next();
  return res.status(403).json({ error: "Admin access required" });
});

// Health
app.get("/health", async (req, res) =>res.json({status:"ok"}));
app.get("/api/health/db", async (_req, res) =>{
  try{
    const dbRow = await db.one("SELECT current_database() AS db");
    const regRow = await db.one("SELECT to_regclass('public.auth_codes') AS t");
    const hasAuthCodes = !!(regRow && regRow.t);
    res.json({ ok:true, db: dbRow?.db || null, hasAuthCodes });
  }catch(err){
    res.status(500).json({ ok:false, error: err?.message || "db error", code: err?.code || "" });
  }
});
app.get("/api/health/auth-codes-schema", async (_req, res) =>{
  try{
    const rows = await db.many(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='auth_codes'
      ORDER BY ordinal_position ASC
    `);
    const columns = rows.map(r=>({
      name: r.column_name,
      type: r.data_type,
      is_nullable: r.is_nullable,
      default: r.column_default
    }));
    res.json({ ok:true, columns });
  }catch(err){
    res.status(500).json({ ok:false, error: err?.message || "db error", code: err?.code || "" });
  }
});
app.get("/api/health/session", async (req, res) =>{
  const sid = parseCookies(req).sid;
  if(!sid) return res.json({ ok:true, hasSid:false, sessionFound:false });
  const row = await db.one("SELECT sid, userid, expiresat FROM sessions WHERE sid=$1", [sid]).catch(()=>null);
  res.json({ ok:true, hasSid:true, sessionFound: !!row, keys: Object.keys(row || {}) });
});

// ---------- Stripe Diagnostic Endpoint ----------
app.get("/api/stripe/test", async (req, res) => {
  const results = {
    stripeConfigured: !!stripe,
    secretKeyPrefix: (process.env.STRIPE_SECRET_KEY || "").substring(0, 12) + "...",
    userPriceId: process.env.STRIPE_USER_PRICE_ID || "(not set)",
    businessPriceId: process.env.STRIPE_BUSINESS_PRICE_ID || "(not set)",
    legacyPriceId: process.env.STRIPE_PRICE_ID || "(not set)",
  };

  if (stripe && process.env.STRIPE_USER_PRICE_ID) {
    try {
      const price = await stripe.prices.retrieve(process.env.STRIPE_USER_PRICE_ID);
      results.userPriceValid = true;
      results.userPriceDetails = {
        id: price.id,
        active: price.active,
        currency: price.currency,
        unit_amount: price.unit_amount,
        recurring: price.recurring
      };
    } catch (e) {
      results.userPriceValid = false;
      results.userPriceError = e.message;
    }
  }

  if (stripe && process.env.STRIPE_BUSINESS_PRICE_ID) {
    try {
      const price = await stripe.prices.retrieve(process.env.STRIPE_BUSINESS_PRICE_ID);
      results.businessPriceValid = true;
      results.businessPriceDetails = {
        id: price.id,
        active: price.active,
        currency: price.currency,
        unit_amount: price.unit_amount,
        recurring: price.recurring
      };
    } catch (e) {
      results.businessPriceValid = false;
      results.businessPriceError = e.message;
    }
  }

  res.json(results);
});

// ---------- Signup Checkout (No Login Required) ----------
// Creates Stripe checkout for new user signup - account created on payment success
app.post("/api/signup/checkout", async (req, res) => {
  const email = (req.body?.email || "").toString().trim().toLowerCase();
  const displayName = (req.body?.displayName || "").toString().trim();
  const plan = (req.body?.plan || "user").toString().toLowerCase();
  const referralCode = (req.body?.referralCode || "").toString().trim();

  if(!email) {
    return res.status(400).json({ error: "Email is required" });
  }
  if(!email.includes("@") || !email.includes(".")) {
    return res.status(400).json({ error: "Invalid email address" });
  }
  if(!["user", "business"].includes(plan)) {
    return res.status(400).json({ error: "Invalid plan. Choose 'user' or 'business'." });
  }
  if(!stripe) {
    return res.status(400).json({ error: "Stripe not configured" });
  }

  // Check if email already exists
  const existingUser = await data.query(`SELECT id FROM users WHERE LOWER(email) = $1`, [email]);
  if(existingUser.rows.length > 0) {
    return res.status(400).json({
      error: "An account with this email already exists. Please log in instead.",
      existingAccount: true
    });
  }

  // Validate referral code if provided
  let referrerId = null;
  if(referralCode) {
    const referrer = await data.getUserByReferralCode(referralCode);
    if(referrer) {
      referrerId = referrer.id;
    }
  }

  // Get the correct price ID based on plan
  const priceId = plan === "business"
    ? (process.env.STRIPE_BUSINESS_PRICE_ID || process.env.STRIPE_PRICE_ID || "").trim()
    : (process.env.STRIPE_USER_PRICE_ID || "").trim();

  console.log("=== SIGNUP CHECKOUT DEBUG ===");
  console.log("Plan requested:", plan);
  console.log("Price ID being used:", priceId);
  console.log("STRIPE_USER_PRICE_ID env:", process.env.STRIPE_USER_PRICE_ID || "(not set)");
  console.log("STRIPE_BUSINESS_PRICE_ID env:", process.env.STRIPE_BUSINESS_PRICE_ID || "(not set)");
  console.log("STRIPE_PRICE_ID env:", process.env.STRIPE_PRICE_ID || "(not set)");
  const stripeKeyPrefix = (process.env.STRIPE_SECRET_KEY || "").substring(0, 8);
  console.log("STRIPE_SECRET_KEY mode:", stripeKeyPrefix.includes("test") ? "TEST MODE" : stripeKeyPrefix.includes("live") ? "LIVE MODE" : "UNKNOWN - " + stripeKeyPrefix);

  if(!priceId) {
    return res.status(400).json({ error: `Stripe price ID not configured for ${plan} plan` });
  }

  try {
    const successUrl = `${req.protocol}://${req.get('host')}/signup-success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${req.protocol}://${req.get('host')}/signup?canceled=true`;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: email,
      subscription_data: {
        trial_period_days: 7
      },
      metadata: {
        signupEmail: email,
        signupDisplayName: displayName,
        plan: plan,
        referrerId: referrerId ? String(referrerId) : ""
      }
    });

    res.json({ checkoutUrl: session.url });
  } catch(e) {
    console.error("=== STRIPE CHECKOUT ERROR ===");
    console.error("Error message:", e.message);
    console.error("Error type:", e.type);
    console.error("Error code:", e.code);
    console.error("Error param:", e.param);
    console.error("Full error:", JSON.stringify(e, null, 2));
    console.error("Price ID that was used:", priceId);
    console.error("Price ID length:", priceId.length);
    console.error("Price ID char codes:", [...priceId].map(c => c.charCodeAt(0)).join(','));
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) =>{
  console.log("=== STRIPE WEBHOOK RECEIVED ===");
  console.log("Timestamp:", new Date().toISOString());
  console.log("Content-Type:", req.headers["content-type"]);
  console.log("Body length:", req.body?.length || 0);

  const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  if(!stripe || !webhookSecret){
    console.error("Stripe webhook not configured - stripe:", !!stripe, "secret length:", webhookSecret.length);
    return res.status(400).json({error:"Stripe not configured"});
  }
  const sig = req.headers["stripe-signature"];
  if(!sig) {
    console.error("Missing stripe-signature header");
    return res.status(400).json({error:"Missing signature"});
  }
  console.log("Signature header present, length:", sig.length);

  let event;
  try{
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  }catch(err){
    console.error("Stripe webhook signature error:", err.message);
    console.error("This usually means STRIPE_WEBHOOK_SECRET is incorrect or body was modified");
    return res.status(400).json({error:"Invalid signature"});
  }
  console.log("Stripe webhook verified successfully, event type:", event.type);

  if(event.type === "checkout.session.completed"){
    const session = event.data?.object;
    const orderId = Number(session?.metadata?.orderId || 0);
    const placeId = Number(session?.metadata?.placeId || 0);
    const userId = Number(session?.metadata?.userId || 0);

    console.log("checkout.session.completed - orderId:", orderId, "placeId:", placeId, "userId:", userId);
    console.log("session.customer:", session.customer, "session.subscription:", session.subscription);

    // Handle marketplace order payment
    if(orderId){
      const order = await data.getOrderById(orderId);
      if(order && order.status !== "paid"){
        await data.updateOrderPayment(order.id, "stripe", session.id || "");
        const existingPayment = await data.getPaymentForOrder(order.id);
        if(!existingPayment) await data.createPaymentForOrder(order.id, Number(order.totalCents || 0), "stripe");
        await finalizeOrderPayment(order);
      }
    }

    // Handle business subscription payment
    if(placeId && session.subscription){
      console.log("Processing business subscription for placeId:", placeId);
      try {
        // First check if subscription exists
        const existing = await data.getBusinessSubscription(placeId);
        console.log("Existing subscription:", existing ? `id=${existing.id}, status=${existing.status}` : "none");

        if(existing) {
          // Update existing subscription
          const updateSql = `
            UPDATE business_subscriptions
            SET stripeCustomerId = $1, stripeSubscriptionId = $2, plan = 'monthly', status = 'active',
                currentPeriodStart = NOW(), currentPeriodEnd = NOW() + INTERVAL '1 month', updatedAt = NOW()
            WHERE id = $3
          `;
          const result = await data.query(updateSql, [session.customer, session.subscription, existing.id]);
          console.log("Updated subscription id:", existing.id, "rows affected:", result.rowCount);
        } else {
          // Create new subscription
          console.log("Creating new subscription for placeId:", placeId, "userId:", userId);
          const insertSql = `
            INSERT INTO business_subscriptions
            (placeId, userId, plan, status, stripeCustomerId, stripeSubscriptionId, currentPeriodStart, currentPeriodEnd, createdAt, updatedAt)
            VALUES ($1, $2, 'monthly', 'active', $3, $4, NOW(), NOW() + INTERVAL '1 month', NOW(), NOW())
          `;
          await data.query(insertSql, [placeId, userId, session.customer, session.subscription]);
          console.log("Created new subscription for placeId:", placeId);
        }
        console.log("Business subscription activated for placeId:", placeId);
      } catch(err) {
        console.error("Error updating business subscription:", err);
      }
    }

    // Handle NEW USER SIGNUP via Stripe checkout (signupEmail in metadata, no userId)
    const signupEmail = (session?.metadata?.signupEmail || "").trim().toLowerCase();
    const signupDisplayName = (session?.metadata?.signupDisplayName || "").trim();
    const signupReferrerId = Number(session?.metadata?.referrerId || 0);

    if(signupEmail && !userId && session.subscription){
      const plan = session?.metadata?.plan || "user";
      console.log("Processing NEW USER SIGNUP for email:", signupEmail, "plan:", plan);

      try {
        // Check if user already exists (shouldn't happen, but just in case)
        const existingCheck = await data.query(`SELECT id FROM users WHERE LOWER(email) = $1`, [signupEmail]);
        if(existingCheck.rows.length > 0) {
          console.log("User already exists for email:", signupEmail, "- skipping account creation");
        } else {
          // Create new user account
          const nowISO = () => new Date().toISOString();
          const createResult = await data.query(
            `INSERT INTO users (email, displayName, createdAt) VALUES ($1, $2, $3) RETURNING id`,
            [signupEmail, signupDisplayName || null, nowISO()]
          );
          const newUserId = createResult.rows?.[0]?.id;
          console.log("Created new user id:", newUserId, "for email:", signupEmail);

          if(newUserId) {
            // Set referrer if provided
            if(signupReferrerId) {
              await data.query(`UPDATE users SET referredByUserId = $1 WHERE id = $2`, [signupReferrerId, newUserId]);
              console.log("Set referrer:", signupReferrerId, "for user:", newUserId);
            }

            // Fetch subscription details from Stripe to get trial info
            let subStatus = 'active';
            let trialEnd = null;
            let periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // Default 30 days
            try {
              const stripeSub = await stripe.subscriptions.retrieve(session.subscription);
              subStatus = stripeSub.status; // 'trialing', 'active', etc.
              if(stripeSub.trial_end) {
                trialEnd = new Date(stripeSub.trial_end * 1000).toISOString();
                periodEnd = trialEnd; // During trial, period end is trial end
              }
              if(stripeSub.current_period_end) {
                periodEnd = new Date(stripeSub.current_period_end * 1000).toISOString();
              }
              console.log("Stripe subscription status:", subStatus, "trialEnd:", trialEnd, "periodEnd:", periodEnd);
            } catch(subErr) {
              console.error("Error fetching subscription from Stripe:", subErr.message);
            }

            // Create user subscription (status will be 'trialing' for free trial)
            const insertSubSql = `
              INSERT INTO user_subscriptions
              (userId, plan, status, stripeCustomerId, stripeSubscriptionId, currentPeriodStart, currentPeriodEnd, trialEnd, createdAt, updatedAt)
              VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, NOW(), NOW())
            `;
            await data.query(insertSubSql, [newUserId, plan, subStatus, session.customer, session.subscription, periodEnd, trialEnd]);
            console.log("Created user subscription for new user:", newUserId, "plan:", plan, "status:", subStatus);

            // Note: Don't award referral commission until trial converts to paid
            // Commission will be awarded when subscription status changes to 'active' (after trial)
            if(signupReferrerId && subStatus === 'active') {
              const subscriptionAmountCents = plan === 'business' ? 1000 : 500; // $10 or $5
              await data.addReferralCommission(signupReferrerId, newUserId, subscriptionAmountCents, 25);
              console.log("Referral commission added for referrer:", signupReferrerId, "from new user:", newUserId);
            } else if(signupReferrerId) {
              console.log("Referrer noted, commission will be awarded when trial converts:", signupReferrerId);
            }

            // Generate a one-time login token for auto-login after signup
            const loginToken = crypto.randomBytes(32).toString('hex');
            const tokenExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
            await data.query(
              `INSERT INTO signup_login_tokens (userId, token, expiresAt, createdAt) VALUES ($1, $2, $3, NOW())
               ON CONFLICT (userId) DO UPDATE SET token = $2, expiresAt = $3, createdAt = NOW()`,
              [newUserId, loginToken, tokenExpiry]
            );
            console.log("Generated login token for new user:", newUserId);
          }
        }
      } catch(err) {
        console.error("Error creating new user from signup:", err);
      }
    }

    // Handle user subscription payment (no placeId, has plan in metadata)
    const plan = session?.metadata?.plan;
    if(!placeId && userId && session.subscription && plan){
      console.log("Processing user subscription for userId:", userId, "plan:", plan);
      try {
        // Check if user already has a subscription
        const existing = await data.query(
          `SELECT * FROM user_subscriptions WHERE userId = $1 ORDER BY createdAt DESC LIMIT 1`,
          [userId]
        );

        if(existing.rows.length > 0) {
          // Update existing subscription
          const updateSql = `
            UPDATE user_subscriptions
            SET stripeCustomerId = $1, stripeSubscriptionId = $2, plan = $3, status = 'active',
                currentPeriodStart = NOW(), currentPeriodEnd = NOW() + INTERVAL '1 month', updatedAt = NOW()
            WHERE id = $4
          `;
          await data.query(updateSql, [session.customer, session.subscription, plan, existing.rows[0].id]);
          console.log("Updated user subscription id:", existing.rows[0].id);
        } else {
          // Create new user subscription
          const insertSql = `
            INSERT INTO user_subscriptions
            (userId, plan, status, stripeCustomerId, stripeSubscriptionId, currentPeriodStart, currentPeriodEnd, createdAt, updatedAt)
            VALUES ($1, $2, 'active', $3, $4, NOW(), NOW() + INTERVAL '1 month', NOW(), NOW())
          `;
          await data.query(insertSql, [userId, plan, session.customer, session.subscription]);
          console.log("Created new user subscription for userId:", userId);

          // Award referral commission if this user was referred
          const subscribedUser = await data.getUserById(userId);
          const referrerId = subscribedUser?.referredByUserId ?? subscribedUser?.referredbyuserid;
          if(referrerId) {
            const subscriptionAmountCents = plan === 'business' ? 1000 : 500; // $10 or $5
            await data.addReferralCommission(referrerId, userId, subscriptionAmountCents, 25);
            console.log("Referral commission added for referrer:", referrerId, "from user:", userId);
          }
        }
        console.log("User subscription activated for userId:", userId, "plan:", plan);
      } catch(err) {
        console.error("Error updating user subscription:", err);
      }
    }
  }

  if(event.type === "payment_intent.succeeded"){
    const intent = event.data?.object;
    const orderId = Number(intent?.metadata?.orderId || 0);
    if(orderId){
      const order = await data.getOrderById(orderId);
      if(order && order.status !== "paid"){
        await data.updateOrderPayment(order.id, "stripe", intent.id || "");
        const existingPayment = await data.getPaymentForOrder(order.id);
        if(!existingPayment) await data.createPaymentForOrder(order.id, Number(order.totalCents || 0), "stripe");
        await finalizeOrderPayment(order);
      }
    }
  }

  // Handle subscription updates from Stripe
  if(event.type === "customer.subscription.updated"){
    const sub = event.data.object;
    const customerId = sub.customer;
    const status = sub.status === 'active' ? 'active' : (sub.status === 'canceled' ? 'canceled' : sub.status);
    const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null;
    const periodStart = sub.current_period_start ? new Date(sub.current_period_start * 1000).toISOString() : null;

    console.log("customer.subscription.updated - customer:", customerId, "status:", status, "periodEnd:", periodEnd);

    try {
      // Check business subscriptions first
      const bizResult = await data.query(`SELECT * FROM business_subscriptions WHERE stripeCustomerId = $1`, [customerId]);
      if(bizResult.rows.length > 0) {
        const localSub = bizResult.rows[0];
        if(periodEnd) {
          await data.query(
            `UPDATE business_subscriptions SET status = $1, currentPeriodStart = COALESCE($2, currentPeriodStart), currentPeriodEnd = $3, canceledAt = $4, updatedAt = NOW() WHERE id = $5`,
            [status, periodStart, periodEnd, sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null, localSub.id]
          );
        } else {
          await data.query(
            `UPDATE business_subscriptions SET status = $1, canceledAt = $2, updatedAt = NOW() WHERE id = $3`,
            [status, sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null, localSub.id]
          );
        }
        console.log("Business subscription updated for customer:", customerId);
      }

      // Check user subscriptions
      const userResult = await data.query(`SELECT * FROM user_subscriptions WHERE stripeCustomerId = $1`, [customerId]);
      if(userResult.rows.length > 0) {
        const localSub = userResult.rows[0];
        const oldStatus = localSub.status;

        if(periodEnd) {
          await data.query(
            `UPDATE user_subscriptions SET status = $1, currentPeriodStart = COALESCE($2, currentPeriodStart), currentPeriodEnd = $3, canceledAt = $4, updatedAt = NOW() WHERE id = $5`,
            [status, periodStart, periodEnd, sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null, localSub.id]
          );
        } else {
          await data.query(
            `UPDATE user_subscriptions SET status = $1, canceledAt = $2, updatedAt = NOW() WHERE id = $3`,
            [status, sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null, localSub.id]
          );
        }
        console.log("User subscription updated for customer:", customerId, "oldStatus:", oldStatus, "newStatus:", status);

        // Award referral commission when trial converts to active (first payment)
        if(oldStatus === 'trialing' && status === 'active') {
          const userId = localSub.userid ?? localSub.userId;
          const plan = localSub.plan;
          const user = await data.getUserById(userId);
          const referrerId = user?.referredByUserId ?? user?.referredbyuserid;
          if(referrerId) {
            const subscriptionAmountCents = plan === 'business' ? 1000 : 500; // $10 or $5
            await data.addReferralCommission(referrerId, userId, subscriptionAmountCents, 25);
            console.log("Referral commission awarded on trial conversion for referrer:", referrerId, "from user:", userId);
          }
        }
      }

      if(bizResult.rows.length === 0 && userResult.rows.length === 0) {
        console.log("No local subscription found for customer:", customerId);
      }
    } catch(err) {
      console.error("Error updating subscription:", err);
    }
  }

  // Handle subscription cancellation/deletion
  if(event.type === "customer.subscription.deleted"){
    const sub = event.data.object;
    const customerId = sub.customer;

    try {
      // Check business subscriptions
      const bizResult = await data.query(`SELECT * FROM business_subscriptions WHERE stripeCustomerId = $1`, [customerId]);
      if(bizResult.rows.length > 0) {
        await data.query(
          `UPDATE business_subscriptions SET status = 'expired', canceledAt = NOW(), updatedAt = NOW() WHERE id = $1`,
          [bizResult.rows[0].id]
        );
        console.log("Business subscription expired for customer:", customerId);
      }

      // Check user subscriptions
      const userResult = await data.query(`SELECT * FROM user_subscriptions WHERE stripeCustomerId = $1`, [customerId]);
      if(userResult.rows.length > 0) {
        await data.query(
          `UPDATE user_subscriptions SET status = 'expired', canceledAt = NOW(), updatedAt = NOW() WHERE id = $1`,
          [userResult.rows[0].id]
        );
        console.log("User subscription expired for customer:", customerId);
      }
    } catch(err) {
      console.error("Error expiring subscription:", err);
    }
  }

  console.log("=== STRIPE WEBHOOK COMPLETED ===", event.type);
  res.json({ received:true });
});
app.get("/debug/routes", async (req, res) =>{
  const admin=await requireAdminOrDev(req,res); if(!admin) return;
  const routes = [];
  const stack = app._router?.stack || [];
  for(const layer of stack){
    if(!layer.route) continue;
    const methods = Object.keys(layer.route.methods || {}).map(m=>m.toUpperCase());
    routes.push({ methods, path: layer.route.path });
  }
  res.json(routes);
});
app.get("/api/debug/env", async (req, res) =>{
  if((process.env.NODE_ENV || "").toLowerCase() === "production"){
    return res.status(404).json({ error: "not found" });
  }
  res.json({
    hasTestAuthCode: !!(process.env.TEST_AUTH_CODE || "").toString().trim(),
    hasAdminEmails: !!(process.env.ADMIN_EMAILS || "").toString().trim()
  });
});
app.get("/api/version", async (req, res) =>{
  res.json({ sha: process.env.RENDER_GIT_COMMIT || process.env.GIT_SHA || "unknown" });
});

// Pages
app.get("/ui", async (req, res) =>res.sendFile(path.join(__dirname,"public","index.html")));
app.get("/signup", async (req, res) =>res.sendFile(path.join(__dirname,"public","signup.html")));
app.get("/signup-success", async (req, res) =>res.sendFile(path.join(__dirname,"public","signup-success.html")));
app.get("/login", async (req, res) =>res.sendFile(path.join(__dirname,"public","login.html")));
app.get("/waitlist", async (req, res) =>res.sendFile(path.join(__dirname,"public","waitlist.html")));
app.get("/apply/business", async (req, res) =>res.sendFile(path.join(__dirname,"public","apply_business.html")));
app.get("/apply/resident", async (req, res) =>res.sendFile(path.join(__dirname,"public","apply_resident.html")));
app.get("/privacy", async (req, res) =>res.sendFile(path.join(__dirname,"public","privacy.html")));
app.get("/terms", async (req, res) =>res.sendFile(path.join(__dirname,"public","terms.html")));
app.get("/u/:id", async (req, res) =>res.sendFile(path.join(__dirname,"public","profile.html")));
app.get("/me/store", async (req, res) =>res.sendFile(path.join(__dirname,"public","store_profile.html")));
app.get("/me/profile", async (req, res) =>res.sendFile(path.join(__dirname,"public","my_profile.html")));
app.get("/me/orders", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  res.sendFile(path.join(__dirname,"public","my_orders.html"));
});
app.get("/me/seller/orders", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  res.sendFile(path.join(__dirname,"public","seller_orders.html"));
});
app.get("/me/hub", async (req, res) =>res.redirect("/me/store"));
app.get("/pay/:id", async (req, res) =>res.sendFile(path.join(__dirname,"public","pay.html")));
app.get("/pay/success", async (req, res) =>res.sendFile(path.join(__dirname,"public","pay_success.html")));
app.get("/pay/cancel", async (req, res) =>res.sendFile(path.join(__dirname,"public","pay_cancel.html")));
app.get("/order-confirmed", async (req, res) =>res.sendFile(path.join(__dirname,"public","order-confirmed.html")));
app.get("/debug/context", async (req, res) =>{
  const admin=await requireAdminOrDev(req,res); if(!admin) return;
  const u = await getUserId(req);
  const user = u ? await data.getUserById(u) : null;
  const ctx = await data.getTownContext(1, u);
  const tier = trust.resolveTier(user, ctx);
  res.json({
    user: user ? { id: user.id, email: user.email } : null,
    townId: 1,
    trustTier: tier,
    tierName: TRUST_TIER_LABELS[tier] || "Visitor",
    permissions: trust.permissionsForTier(tier),
    limits: trust.limitsForTier(tier),
    presence: user ? {
      presenceVerifiedAt: user.presenceVerifiedAt || "",
      presenceLat: user.presenceLat ?? null,
      presenceLng: user.presenceLng ?? null,
      presenceAccuracyMeters: user.presenceAccuracyMeters ?? null
    } : null
  });
});
app.get("/debug/context/ui", async (req, res) =>res.sendFile(path.join(__dirname,"public","debug_context.html")));
app.get("/live/:id", async (req, res) =>res.sendFile(path.join(__dirname,"public","live.html")));
app.get("/me/live", async (req, res) =>res.sendFile(path.join(__dirname,"public","live_host.html")));
async function requireAdminPage(req,res){
  const uid = await getUserId(req);
  if(!uid){ res.redirect("/admin/login"); return null; }
  const user = await data.getUserById(uid);
  if(!isAdminUser(user)){
    res.status(403).sendFile(path.join(__dirname,"public","admin_login.html"));
    return null;
  }
  return user;
}
app.get("/admin/login", async (req, res) =>res.sendFile(path.join(__dirname,"public","admin_login.html")));
app.post("/admin/login", urlencodedParser, async (req, res) =>{
  const wantsHtml = (req.headers.accept || "").includes("text/html");
  const email = (req.body?.email || "").toString().trim().toLowerCase();
  const passphrase = (req.body?.passphrase || "").toString();
  const expected = (process.env.ADMIN_LOGIN_PASSPHRASE || "").toString();
  if(!email){
    if(wantsHtml) return res.redirect("/admin/login?error=Email%20required");
    return res.status(400).json({ error: "Email required" });
  }
  if(!expected || passphrase !== expected){
    if(wantsHtml) return res.redirect("/admin/login?error=Invalid%20passphrase");
    return res.status(403).json({ error: "Invalid passphrase" });
  }
  const user = await data.upsertUserByEmail(email);
  if(!user){
    if(wantsHtml) return res.redirect("/admin/login?error=Invalid%20email");
    return res.status(400).json({ error: "Invalid email" });
  }
  const adminUser = await data.setUserAdmin(user.id, true);
  if(adminUser?.error){
    if(wantsHtml) return res.redirect("/admin/login?error=Failed%20to%20set%20admin");
    return res.status(500).json({ error: "Failed to set admin" });
  }
  const s = await data.createSession(user.id);
  setCookie(res,"sid",s.sid,{httpOnly:true,maxAge:60*60*24*30,secure:isHttpsRequest(req)});
  if(wantsHtml) return res.redirect("/admin");
  return res.json({ ok:true });
});
app.get("/admin/bootstrap", async (req, res) =>{
  const token = (req.query.token || "").toString();
  const expected = (process.env.ADMIN_BOOTSTRAP_TOKEN || "").toString();
  if(!token || token !== expected) return res.status(403).send("Forbidden");
  const email = (req.query.email || "").toString().trim().toLowerCase();
  if(!email) return res.status(400).send("Email required");
  const user = await data.upsertUserByEmail(email);
  if(!user) return res.status(400).send("Invalid email");
  const adminUser = await data.setUserAdmin(user.id, true);
  if(adminUser?.error) return res.status(500).send("Failed to set admin");
  console.log("ADMIN_BOOTSTRAP_USED", email);
  const s = await data.createSession(user.id);
  setCookie(res,"sid",s.sid,{httpOnly:true,maxAge:60*60*24*30,secure:isHttpsRequest(req)});
  res.redirect("/admin");
});
app.get("/admin", async (req, res) =>{
  const admin=await requireAdminPage(req,res); if(!admin) return;
  res.sendFile(path.join(__dirname,"public","admin.html"));
});
app.get("/admin/analytics", async (req, res) =>{
  const admin=await requireAdminPage(req,res); if(!admin) return;
  res.sendFile(path.join(__dirname,"public","admin_analytics.html"));
});
app.get("/admin/media", async (req, res) =>{
  const admin=await requireAdminPage(req,res); if(!admin) return;
  res.sendFile(path.join(__dirname,"public","admin_media.html"));
});
app.get("/store/:id", async (req, res) =>res.sendFile(path.join(__dirname,"public","store.html")));
app.get("/business-subscription", async (req, res) =>res.sendFile(path.join(__dirname,"public","business_subscription.html")));
app.get("/subscription", async (req, res) =>res.sendFile(path.join(__dirname,"public","subscription.html")));
app.get("/referrals", async (req, res) =>res.sendFile(path.join(__dirname,"public","referrals.html")));
app.get("/giveaway-offer", async (req, res) =>res.sendFile(path.join(__dirname,"public","giveaway_offer_form.html")));
app.get("/admin/sweep", async (req, res) =>{
  const admin=await requireAdminPage(req,res); if(!admin) return;
  res.sendFile(path.join(__dirname,"public","admin_sweep.html"));
});
app.get("/admin/trust", async (req, res) =>{
  const admin=await requireAdminPage(req,res); if(!admin) return;
  res.sendFile(path.join(__dirname,"public","admin_trust.html"));
});
app.get("/admin/applications", async (req, res) =>{
  const admin=await requireAdminPage(req,res); if(!admin) return;
  res.sendFile(path.join(__dirname,"public","admin_applications.html"));
});
app.get("/admin/waitlist", async (req, res) =>{
  const admin=await requireAdminPage(req,res); if(!admin) return;
  res.sendFile(path.join(__dirname,"public","admin_applications.html"));
});
app.get("/admin/pulse", async (req, res) =>{
  const admin=await requireAdminPage(req,res); if(!admin) return;
  res.sendFile(path.join(__dirname,"public","admin_pulse.html"));
});
app.get("/admin/giveaway-offers", async (req, res) =>{
  const admin=await requireAdminPage(req,res); if(!admin) return;
  res.sendFile(path.join(__dirname,"public","admin_giveaway_offers.html"));
});

// Neighbor towns (directory only; no identity sharing)
app.get("/towns/neighbor", async (req, res) =>res.json({towns:TOWN_DIRECTORY}));

// Cookies
function parseCookies(req){
  const header=req.headers.cookie||"";
  const parts=header.split(";").map(p=>p.trim()).filter(Boolean);
  const out={};
  for(const p of parts){
    const i=p.indexOf("=");
    if(i>-1) out[p.slice(0,i)]=decodeURIComponent(p.slice(i+1));
  }
  return out;
}
function isHttpsRequest(req){
  const proto = (req.headers["x-forwarded-proto"] || "").toString().split(",")[0].trim().toLowerCase();
  return req.secure || proto === "https";
}
function setCookie(res,n,v,o={}){
  const p=[`${n}=${encodeURIComponent(v)}`,"Path=/","SameSite=Lax"];
  if(o.httpOnly) p.push("HttpOnly");
  if(o.secure) p.push("Secure");
  if(o.maxAge!=null) p.push(`Max-Age=${o.maxAge}`);
  res.setHeader("Set-Cookie",p.join("; "));
}
function redactEmail(email){
  const s = (email || "").toString().trim();
  const at = s.indexOf("@");
  if(at < 1) return s ? `${s.slice(0,3)}...` : "";
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  const prefix = local.slice(0, 3);
  const dots = local.length > 3 ? "..." : "";
  return `${prefix}${dots}@${domain}`;
}
async function getUserId(req){
  const sid=parseCookies(req).sid;
  if(!sid) return null;
  const r=await data.getUserBySession(sid);
  return r?.user?.id ?? null;
}
async function requireLogin(req,res){
  const u=await getUserId(req);
  if(!u){res.status(401).json({error:"Login required"});return null;}
  return u;
}
function isAdminEmail(email){
  const e = (email || "").toString().trim().toLowerCase();
  return !!(e && ADMIN_EMAIL_ALLOWLIST.has(e));
}
function isAdminUser(user){
  if(!user) return false;
  const email=(user.email||"").toString().trim().toLowerCase();
  const adminFlag = user.isAdmin ?? user.isadmin;
  if(adminFlag === true) return true;
  if(Number(adminFlag)===1) return true;
  if(isAdminEmail(email)) return true;
  return false;
}
async function requireAdmin(req,res,options={}){
  const u=await requireLogin(req,res); if(!u) return null;
  const user=await data.getUserById(u);
  if(!isAdminUser(user)){
    const message = (options.message || "Admin required").toString();
    res.status(403).json({error: message});
    return null;
  }
  return user;
}
async function requireAdminOrDev(req,res){
  if(process.env.NODE_ENV !== "production"){
    const u=await requireLogin(req,res); if(!u) return null;
    return await data.getUserById(u);
  }
  return await requireAdmin(req,res);
}

async function requireActiveSubscription(req, res, placeId){
  if(!placeId){
    res.status(400).json({ error: "placeId required" });
    return false;
  }
  const isActive = await data.isSubscriptionActive(placeId);
  if(!isActive){
    res.status(403).json({ error: "Active subscription required" });
    return false;
  }
  return true;
}

// Check if user has any active subscription (user or business tier)
async function hasActiveUserSubscription(userId) {
  if (!userId) return false;
  try {
    // Include both 'active' and 'trialing' as valid subscription states
    const result = await data.query(
      `SELECT * FROM user_subscriptions WHERE userId = $1 AND status IN ('active', 'trialing') AND currentPeriodEnd > NOW() ORDER BY createdAt DESC LIMIT 1`,
      [Number(userId)]
    );
    return result.rows.length > 0;
  } catch (e) {
    return false;
  }
}

// Require user to have an active subscription for actions
async function requireUserSubscription(req, res) {
  const u = await getUserId(req);
  if (!u) {
    res.status(401).json({ error: "Login required", subscriptionRequired: true });
    return null;
  }

  // Check if admin (admins bypass subscription check)
  const user = await data.getUserById(u);
  if (isAdminUser(user)) return u;

  // Check for active user subscription
  const hasUserSub = await hasActiveUserSubscription(u);
  if (hasUserSub) return u;

  // Check if user owns a store with active business subscription
  const places = await data.query(
    `SELECT p.id FROM places p
     INNER JOIN business_subscriptions bs ON bs.placeId = p.id
     WHERE p.ownerUserId = $1 AND bs.status = 'active' AND (bs.currentPeriodEnd IS NULL OR bs.currentPeriodEnd > NOW())
     LIMIT 1`,
    [Number(u)]
  );
  if (places.rows.length > 0) return u;

  res.status(403).json({
    error: "Subscription required",
    subscriptionRequired: true,
    message: "Sign up for $5/month to buy, sell, and enter giveaways"
  });
  return null;
}

function getAdminReviewLink(){
  const base = (process.env.PUBLIC_BASE_URL || process.env.SITE_URL || process.env.APP_URL || "").toString().trim();
  if(!base) return "/admin/applications";
  return `${base.replace(/\/$/,"")}/admin/applications`;
}

async function getSweepPrizeInfo(sweep, snapshotPrize){
  if(snapshotPrize && snapshotPrize.title) return snapshotPrize;
  const offers = await data.listActivePrizeOffers();
  const offer = offers[0];
  const title = (offer?.title || sweep?.prize || sweep?.title || "").toString().trim();
  const donorName = (offer?.donorDisplayName || "").toString().trim();
  return {
    title,
    donorName,
    donorUserId: offer?.donorUserId ?? null,
    donorPlaceId: offer?.donorPlaceId ?? null,
    prizeOfferId: offer?.id ?? null
  };
}

async function getSweepDrawContext(draw){
  if(!draw) return { sweep: null, prize: null, snapshot: {} };
  const sweep = await data.getSweepstakeById(draw.sweepId);
  let snapshot = {};
  try{ snapshot = JSON.parse(draw.snapshotJson || "{}"); }catch(_){}
  const prize = await getSweepPrizeInfo(sweep, snapshot.prize);
  return { sweep, prize, snapshot };
}

async function resolveSweepDonorUserId(prize){
  if(!prize) return null;
  if(prize.donorUserId) return Number(prize.donorUserId);
  if(prize.donorPlaceId){
    const place = await data.getPlaceById(prize.donorPlaceId);
    if(place?.ownerUserId ?? place?.owneruserid) return Number(place.ownerUserId ?? place.owneruserid);
  }
  return null;
}

async function resolveSweepDonorName(prize, donorUserId){
  const name = (prize?.donorName || "").toString().trim();
  if(name) return name;
  if(donorUserId){
    const donorUser = await data.getUserById(donorUserId);
    return donorUser ? await data.getDisplayNameForUser(donorUser) : "";
  }
  return "";
}

async function notifySweepDrawUsers({ draw, sweep, winner, prize, adminId }){
  if(!draw?.id || !winner?.userId) return;
  if(Number(draw.notified) === 1) return;
  const prizeTitle = (prize?.title || sweep?.prize || sweep?.title || "Prize").toString().trim();
  const donorUserId = await resolveSweepDonorUserId(prize);
  const donorName = await resolveSweepDonorName(prize, donorUserId) || "Donor";
  const winnerUser = await data.getUserById(winner.userId);
  const winnerName = winner.displayName || (winnerUser ? await data.getDisplayNameForUser(winnerUser) : "Winner");
  const drawnAt = draw.createdAt || new Date().toISOString();
  const systemPrefix = "[SYSTEM] ";

  try{
    if(donorUserId && Number(donorUserId) !== Number(winner.userId)){
      const convo = await data.addDirectConversation(winner.userId, donorUserId);
      const longText = `${systemPrefix}🎉 You won: ${prizeTitle} (Donor: ${donorName}). Please coordinate pickup/delivery here. Winner: reply with preferred pickup time/location. Donor: reply with instructions.\nDraw ID: ${draw.id}\nDrawn: ${drawnAt}`;
      if(convo?.id){
        await data.addDirectMessage(convo.id, adminId, longText);
        const winnerNote = `${systemPrefix}🎉 You won ${prizeTitle}! Check your inbox thread with ${donorName} for instructions.`;
        await data.addDirectMessage(convo.id, adminId, winnerNote);
        const donorNote = `${systemPrefix}${winnerName} won your prize ${prizeTitle}. Please send pickup instructions in this thread.`;
        await data.addDirectMessage(convo.id, adminId, donorNote);
      }
    }else{
      const convo = await data.addDirectConversation(adminId, winner.userId);
      if(convo?.id){
        const winnerNote = `${systemPrefix}🎉 You won ${prizeTitle}! We will follow up with donor details soon.`;
        await data.addDirectMessage(convo.id, adminId, winnerNote);
      }
      if(donorUserId){
        const donorConvo = await data.addDirectConversation(adminId, donorUserId);
        if(donorConvo?.id){
          const donorNote = `${systemPrefix}${winnerName} won your prize ${prizeTitle}. Please send pickup instructions in the winner thread.`;
          await data.addDirectMessage(donorConvo.id, adminId, donorNote);
        }
      }
    }
    await data.setSweepDrawNotified(draw.id);
  }catch(err){
    console.warn("Sweep draw notify failed", err?.message || err);
  }
}

async function buildSweepParticipants(sweepId){
  const rows = await data.listSweepstakeParticipants(sweepId);
  const participants = await Promise.all(rows.map(async (row)=>{
    const user = await data.getUserById(row.userId);
    return {
      userId: Number(row.userId),
      displayName: await data.getDisplayNameForUser(user),
      entries: Number(row.entries || 0)
    };
  }));
  return participants.filter((p)=>p.entries > 0);
}

async function getSweepstakeActivePayload(req){
  const sweep = await data.getActiveSweepstake();
  if(!sweep) return { sweepstake:null };
  const totals = await data.getSweepstakeEntryTotals(sweep.id);
  const participants = await buildSweepParticipants(sweep.id);
  const draw = await data.getSweepDrawBySweepId(sweep.id);
  let snapshot = {};
  if(draw?.snapshotJson){
    try{ snapshot = JSON.parse(draw.snapshotJson || "{}"); }catch(_){}
  }
  const prize = await getSweepPrizeInfo(sweep, snapshot.prize);
  const winnerUserId = draw?.winnerUserId || sweep.winnerUserId || null;
  const winner = winnerUserId
    ? {
      userId: Number(winnerUserId),
      displayName: await data.getDisplayNameForUser(await data.getUserById(winnerUserId)),
      entries: participants.find(p=>Number(p.userId)===Number(winnerUserId))?.entries || 0
    }
    : null;
  const u = await getUserId(req);
  const userEntries = u ? await data.getUserEntriesForSweepstake(sweep.id, u) : 0;
  const balance = u ? await data.getSweepBalance(u) : 0;
  return {
    sweepstake: sweep,
    totals,
    participants,
    winner,
    prize,
    drawId: draw?.id || null,
    createdAt: draw?.createdAt || "",
    userEntries,
    balance
  };
}

async function sendAuthCodeEmail(toEmail, code){
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  const from = (process.env.EMAIL_FROM || "").trim() || "onboarding@resend.dev";

  console.log("AUTH_CODE_EMAIL_ATTEMPT", { to: toEmail, from });

  if(!apiKey){
    console.warn("Auth code email not configured (missing RESEND_API_KEY)");
    return { ok: false, skipped: true, statusCode: null };
  }

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #333;">Your Login Code</h2>
  <p>Use this code to log in to Sebastian Digital Town:</p>
  <div style="background-color: #f5f5f5; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
    <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #333;">${code}</span>
  </div>
  <p style="color: #666;">This code expires in 10 minutes.</p>
  <p style="color: #999; font-size: 12px;">If you didn't request this code, you can safely ignore this email.</p>
</body>
</html>`;

  const payload = {
    from,
    to: [toEmail],
    subject: "Your Sebastian Digital Town login code",
    text: `Your login code is: ${code}\n\nThis code expires in 10 minutes.`,
    html
  };

  try{
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if(!resp.ok){
      const errBody = await resp.text().catch(() => "");
      console.error("AUTH_CODE_EMAIL_ERROR", { statusCode: resp.status, error: errBody });
      return { ok: false, statusCode: resp.status, error: errBody };
    }

    const result = await resp.json().catch(() => ({}));
    console.log("AUTH_CODE_EMAIL_SUCCESS", { statusCode: resp.status, id: result.id });
    return { ok: true, statusCode: resp.status, id: result.id };
  }catch(err){
    console.error("AUTH_CODE_EMAIL_ERROR", { error: err?.message || String(err) });
    return { ok: false, error: err?.message || String(err), statusCode: null };
  }
}

async function sendApprovalEmail(toEmail, applicationType, tierName){
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  const from = (process.env.EMAIL_FROM || "").trim() || "onboarding@resend.dev";
  const loginUrl = (process.env.PUBLIC_BASE_URL || "").trim() + "/signup";

  console.log("APPROVAL_EMAIL_ATTEMPT", { to: toEmail, type: applicationType });

  if(!apiKey){
    console.warn("Approval email not configured (missing RESEND_API_KEY)");
    return { ok: false, skipped: true };
  }

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #333;">Your Application Has Been Approved!</h2>
  <p>Great news! Your <strong>${applicationType}</strong> application for Sebastian Digital Town has been approved.</p>
  <p>You have been granted <strong>${tierName}</strong> access.</p>
  <div style="background-color: #f5f5f5; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
    <a href="${loginUrl}" style="background: linear-gradient(90deg, #22d3ee, #3b82f6); color: #0b1120; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">Log In Now</a>
  </div>
  <p style="color: #666;">Use the email address you applied with to receive your login code.</p>
</body>
</html>`;

  const payload = {
    from,
    to: [toEmail],
    subject: "Your Sebastian Digital Town Application is Approved!",
    text: `Your ${applicationType} application has been approved! You now have ${tierName} access. Log in at: ${loginUrl}`,
    html
  };

  try{
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if(!resp.ok){
      const errBody = await resp.text().catch(() => "");
      console.error("APPROVAL_EMAIL_ERROR", { statusCode: resp.status, error: errBody });
      return { ok: false, error: errBody };
    }

    const result = await resp.json().catch(() => ({}));
    console.log("APPROVAL_EMAIL_SUCCESS", { to: toEmail, id: result.id });
    return { ok: true, id: result.id };
  }catch(err){
    console.error("APPROVAL_EMAIL_ERROR", { error: err?.message || String(err) });
    return { ok: false, error: err?.message || String(err) };
  }
}

async function getUserTier(req){
  const userId = await getUserId(req);
  const user = userId ? await data.getUserById(userId) : null;
  const ctx = await data.getTownContext(1, userId);
  const tier = trust.resolveTier(user, ctx);
  return { userId, user, ctx, tier };
}
async function hasPerm(user, perm, ctx){
  if(!user) return false;
  const context = ctx || await data.getTownContext(1, user.id);
  return trust.hasPerm(user, context, perm);
}
async function requirePerm(req,res,perm){
  const userId = await requireLogin(req,res); if(!userId) return null;
  const user = await data.getUserById(userId);
  const ctx = await data.getTownContext(1, userId);
  const trustTier = (ctx.membership?.trustTier ?? ctx.membership?.trusttier ?? user.trustTier ?? 0);
  const effectiveUser = { ...user, trustTier };
  const permKey = permissions.PERMS[perm] || perm;
  if(!permissions.hasPerm(effectiveUser, permKey)){
    res.status(403).json({error:`Requires ${perm}`});
    return null;
  }
  return { userId, user, ctx };
}

async function requireBuyerTier(req,res){
  const access = await requirePerm(req,res,"BUY_MARKET");
  return access ? access.userId : null;
}
function requireStripeConfig(res){
  if(!stripe){
    res.status(500).json({error:"Stripe not configured"});
    return null;
  }
  // Allow fallback to PUBLIC_BASE_URL if specific URLs not set
  const baseUrl = process.env.PUBLIC_BASE_URL || "http://localhost:3000";
  if(!process.env.STRIPE_SUCCESS_URL && !baseUrl){
    res.status(500).json({error:"Stripe URLs not configured"});
    return null;
  }
  return stripe;
}
function getStripeUrls(orderId){
  const baseUrl = process.env.PUBLIC_BASE_URL || "http://localhost:3000";
  const successUrl = process.env.STRIPE_SUCCESS_URL
    ? String(process.env.STRIPE_SUCCESS_URL).replace("{ORDER_ID}", String(orderId))
    : `${baseUrl}/pay/success?orderId=${orderId}`;
  const cancelUrl = process.env.STRIPE_CANCEL_URL
    ? String(process.env.STRIPE_CANCEL_URL).replace("{ORDER_ID}", String(orderId))
    : `${baseUrl}/store`;
  return { successUrl, cancelUrl };
}

function rangeToBounds(range){
  const now = new Date();
  const start = new Date(now);
  const key = (range || "7d").toString();
  if(key === "today"){
    start.setHours(0,0,0,0);
  }else if(key === "30d"){
    start.setDate(start.getDate() - 29);
    start.setHours(0,0,0,0);
  }else{
    start.setDate(start.getDate() - 6);
    start.setHours(0,0,0,0);
  }
  return { from: start.toISOString(), to: now.toISOString(), range: key };
}
async function finalizeOrderPayment(order){
  if(!order) return { ok:false, error:"Order not found" };
  if(order.status === "paid") return { ok:true, alreadyPaid:true, order };
  const items = await data.getOrderItems(order.id);
  const listingId = items[0]?.listingId || order.listingId;
  const listing = listingId ? await data.getListingById(listingId) : null;
  const updated = await data.markOrderPaid(order.id);
  await data.markPaymentPaid(order.id);
  if(listing && (listing.listingType||"item")==="auction"){
    await data.updateListingAuctionState(listing.id, {
      auctionStatus: "paid",
      paymentStatus: "paid",
      winningBidId: listing.winningBidId,
      winnerUserId: listing.winnerUserId,
      paymentDueAt: listing.paymentDueAt || ""
    });
  }else if(items.length){
    for(const item of items){
      await data.decrementListingQuantity(item.listingId, item.quantity);
    }
  }
  return { ok:true, order: updated };
}

function parseRange(range, from, to){
  const today = new Date();
  const startOfDay = (d)=> new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if(range === "today"){
    const s = startOfDay(today);
    const e = new Date(s.getTime() + 24*60*60*1000);
    return { fromIso: s.toISOString(), toIso: e.toISOString(), label: "today" };
  }
  if(range === "7d" || range === "30d"){
    const days = range === "7d" ? 6 : 29;
    const s = startOfDay(new Date(today.getTime() - days*24*60*60*1000));
    const e = new Date(startOfDay(today).getTime() + 24*60*60*1000);
    return { fromIso: s.toISOString(), toIso: e.toISOString(), label: range };
  }
  if(range === "custom" && from && to){
    const s = new Date(`${from}T00:00:00`);
    const e = new Date(`${to}T00:00:00`);
    const end = new Date(e.getTime() + 24*60*60*1000);
    return { fromIso: s.toISOString(), toIso: end.toISOString(), label: "custom" };
  }
  const s = startOfDay(new Date(today.getTime() - 6*24*60*60*1000));
  const e = new Date(startOfDay(today).getTime() + 24*60*60*1000);
  return { fromIso: s.toISOString(), toIso: e.toISOString(), label: "7d" };
}
function isProfileComplete(user){
  if(!user) return false;
  const displayName = (user.displayName || "").toString().trim();
  const phone = (user.phone || "").toString().trim();
  const ageRange = (user.ageRange || "").toString().trim();
  let address = {};
  if(user.addressJson && typeof user.addressJson === "object") address = user.addressJson;
  if(typeof user.addressJson === "string"){
    try{ address = JSON.parse(user.addressJson || "{}"); }catch(_e){}
  }
  const address1 = (address.address1 || address.addressLine1 || address.line1 || "").toString().trim();
  return !!(displayName && phone && ageRange && address1);
}

async function createCallsRoom(){
  if(!CF_CALLS_APP_ID || !CF_CALLS_APP_SECRET){
    return { id: `mock-${Date.now()}`, token: "", mock: true, error: "Calls not configured" };
  }
  const url = `${CF_CALLS_BASE_URL}/apps/${CF_CALLS_APP_ID}/rooms`;
  try{
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${CF_CALLS_APP_SECRET}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    });
    const data = await resp.json().catch(()=>({}));
    if(!resp.ok) throw new Error(data?.errors?.[0]?.message || `Calls API ${resp.status}`);
    const roomId = data?.result?.id || data?.id || data?.result?.room_id;
    if(!roomId) throw new Error("Calls API response missing room id");
    return { id: roomId, token: data?.result?.token || "", mock: false };
  }catch(err){
    return { id: `mock-${Date.now()}`, token: "", mock: true, error: err.message };
  }
}

// Auth
app.post("/api/auth/request-code", async (req, res) =>{
  try{
    const email = (req.body?.email || "").toString().trim().toLowerCase();
    if(!email) return res.status(400).json({ error: "Email required" });

    // Check if user exists (signup requires payment first, so only existing users can log in)
    const existingUser = await data.query(`SELECT id FROM users WHERE LOWER(email) = $1`, [email]);
    if(existingUser.rows.length === 0) {
      // Don't reveal that the account doesn't exist
      return res.json({ ok: true, message: "If this email is valid, a code has been sent" });
    }

    const result = await data.createAuthCode(email);
    if(result.error){
      // Return ok to avoid email enumeration, but log rate limit errors
      if(result.error.includes("wait")) console.log("AUTH_RATE_LIMITED", { email });
      return res.json({ ok: true, message: "If this email is valid, a code has been sent" });
    }

    try{
      await sendAuthCodeEmail(email, result.code);
    }catch(err){
      console.error("AUTH_EMAIL_SEND_ERROR", { error: err?.message });
    }

    const response = { ok: true, message: "Code sent to your email" };
    // In dev mode, optionally return the code for testing
    if(process.env.SHOW_AUTH_CODE === "true"){
      response.code = result.code;
    }
    res.json(response);
  }catch(err){
    console.error("AUTH_REQUEST_CODE_FATAL", { message: err.message });
    res.json({ ok: true, message: "If this email is valid, a code has been sent" });
  }
});
app.post("/api/auth/verify-code", async (req, res) =>{
  const email = (req.body?.email || "").toString().trim().toLowerCase();
  const code = (req.body?.code || "").toString().trim();
  if(!email || !code) return res.status(400).json({ error: "Email and code required" });

  // Check if user exists (signup now requires payment first)
  const existingUser = await data.query(`SELECT id FROM users WHERE LOWER(email) = $1`, [email]);
  if(existingUser.rows.length === 0) {
    return res.status(400).json({
      error: "No account found with this email. Please sign up first.",
      noAccount: true
    });
  }

  const result = await data.verifyAuthCode(email, code);
  if(result.error){
    return res.status(400).json({ error: result.error });
  }

  // Handle referral for new users
  const user = await data.getUserById(result.userId);

  // Apply approved application tier on first login
  const currentTier = user?.trustTier ?? user?.trusttier ?? 0;
  if(currentTier === 0){
    const approvedTier = await data.getApprovedApplicationTier(email);
    if(approvedTier && approvedTier > 0){
      await data.setUserTrustTier(1, result.userId, approvedTier);
      console.log("APPLIED_APPROVED_TIER", { userId: result.userId, email, tier: approvedTier });
    }
  }

  const referralCode = (req.body?.referralCode || req.headers["x-referral-code"] || "").toString().trim();
  if(referralCode && user){
    const existingReferrer = user.referredByUserId ?? user.referredbyuserid;
    if(!existingReferrer){
      let referrer = null;
      // Try to find referrer by referralCode first (new system)
      referrer = await data.getUserByReferralCode(referralCode);
      // Fall back to legacy lookup by user ID or email
      if(!referrer && /^\d+$/.test(referralCode)){
        referrer = await data.getUserById(Number(referralCode));
      }else if(!referrer && referralCode.includes("@")){
        referrer = await data.getUserByEmail(referralCode);
      }
      if(referrer && Number(referrer.id) !== Number(user.id)){
        await data.setUserReferredByUserId(user.id, referrer.id);
        try{
          await data.tryAwardSweepForEvent({
            townId: 1,
            userId: referrer.id,
            ruleType: "referral_verified",
            eventKey: `ref:${referrer.id}->${user.id}`,
            meta: { referredUserId: user.id }
          });
        }catch(err){
          console.error("SWEEP_AWARD_REFERRAL_ERROR", err?.message);
        }
      }
    }
  }

  // Ensure user has a referral code
  await data.ensureUserReferralCode(result.userId);

  const s = await data.createSession(result.userId);
  setCookie(res,"sid",s.sid,{httpOnly:true,maxAge:60*60*24*30,secure:isHttpsRequest(req)});
  res.json({ ok: true, userId: result.userId });
});
app.post("/auth/request-link", async (_req, res) =>{
  res.status(410).json({ error: "deprecated" });
});
app.get("/auth/magic", async (_req, res) =>{
  res.status(410).json({ error: "Magic links are no longer supported" });
});
app.get("/auth/logout", async (req, res) =>{
  const sid=parseCookies(req).sid;
  if(sid) await data.deleteSession(sid);
  setCookie(res,"sid","",{httpOnly:true,maxAge:0,secure:isHttpsRequest(req)});
  res.redirect("/ui");
});
app.post("/auth/logout", async (req, res) =>{
  const sid=parseCookies(req).sid;
  if(sid) await data.deleteSession(sid);
  setCookie(res,"sid","",{httpOnly:true,maxAge:0,secure:isHttpsRequest(req)});
  res.json({ok:true});
});

// Auto-login for new signups - consumes one-time token from Stripe checkout
app.post("/api/signup/auto-login", async (req, res) => {
  const sessionId = (req.body?.sessionId || "").toString().trim();
  console.log("Auto-login attempt for sessionId:", sessionId ? sessionId.substring(0, 20) + "..." : "missing");
  if(!sessionId) {
    return res.status(400).json({ error: "Session ID required" });
  }

  if(!stripe) {
    return res.status(400).json({ error: "Stripe not configured" });
  }

  try {
    // Retrieve the checkout session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if(!session) {
      return res.status(400).json({ error: "Invalid session" });
    }
    console.log("Stripe session retrieved - status:", session.status, "customer:", session.customer);

    const signupEmail = (session.metadata?.signupEmail || "").trim().toLowerCase();
    const signupDisplayName = (session.metadata?.signupDisplayName || "").trim();
    const signupPlan = session.metadata?.plan || "user";
    const signupReferrerId = Number(session.metadata?.referrerId || 0);

    if(!signupEmail) {
      return res.status(400).json({ error: "Not a signup session" });
    }
    console.log("Signup email from session:", signupEmail);

    // Find the user by email
    let userResult = await data.query(`SELECT id FROM users WHERE LOWER(email) = $1`, [signupEmail]);
    let userId = userResult.rows?.[0]?.id;

    // FALLBACK: If user doesn't exist (webhook may have failed), create them now
    if(!userId && session.subscription) {
      console.log("User not found - webhook may have failed. Creating user now as fallback...");
      try {
        const nowISO = () => new Date().toISOString();
        const createResult = await data.query(
          `INSERT INTO users (email, displayName, createdAt) VALUES ($1, $2, $3) RETURNING id`,
          [signupEmail, signupDisplayName || null, nowISO()]
        );
        userId = createResult.rows?.[0]?.id;
        console.log("Fallback: Created new user id:", userId, "for email:", signupEmail);

        if(userId) {
          // Set referrer if provided
          if(signupReferrerId) {
            await data.query(`UPDATE users SET referredByUserId = $1 WHERE id = $2`, [signupReferrerId, userId]);
          }

          // Fetch subscription details from Stripe
          let subStatus = 'active';
          let trialEnd = null;
          let periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
          try {
            const stripeSub = await stripe.subscriptions.retrieve(session.subscription);
            subStatus = stripeSub.status;
            if(stripeSub.trial_end) {
              trialEnd = new Date(stripeSub.trial_end * 1000).toISOString();
              periodEnd = trialEnd;
            }
            if(stripeSub.current_period_end) {
              periodEnd = new Date(stripeSub.current_period_end * 1000).toISOString();
            }
            console.log("Fallback: Stripe subscription status:", subStatus, "trialEnd:", trialEnd);
          } catch(subErr) {
            console.error("Fallback: Error fetching subscription:", subErr.message);
          }

          // Create user subscription
          const insertSubSql = `
            INSERT INTO user_subscriptions
            (userId, plan, status, stripeCustomerId, stripeSubscriptionId, currentPeriodStart, currentPeriodEnd, trialEnd, createdAt, updatedAt)
            VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, NOW(), NOW())
          `;
          await data.query(insertSubSql, [userId, signupPlan, subStatus, session.customer, session.subscription, periodEnd, trialEnd]);
          console.log("Fallback: Created subscription for user:", userId, "plan:", signupPlan, "status:", subStatus);
        }
      } catch(createErr) {
        console.error("Fallback user creation failed:", createErr);
        return res.status(400).json({ error: "Failed to create user account. Please contact support." });
      }
    }

    if(!userId) {
      return res.status(400).json({ error: "User not found. Please wait a moment and try again." });
    }

    console.log("User found/created, userId:", userId);

    // Check for valid login token (skip if we just created the user via fallback)
    const tokenResult = await data.query(
      `SELECT * FROM signup_login_tokens WHERE userId = $1 AND usedAt IS NULL AND expiresAt > NOW()`,
      [userId]
    );

    // If no token exists (webhook didn't create one), create one now
    if(tokenResult.rows.length === 0) {
      console.log("No login token found - creating one now");
      const loginToken = crypto.randomBytes(32).toString('hex');
      const tokenExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await data.query(
        `INSERT INTO signup_login_tokens (userId, token, expiresAt, createdAt) VALUES ($1, $2, $3, NOW())
         ON CONFLICT (userId) DO UPDATE SET token = $2, expiresAt = $3, usedAt = NULL, createdAt = NOW()`,
        [userId, loginToken, tokenExpiry]
      );
    }

    // Mark token as used
    await data.query(`UPDATE signup_login_tokens SET usedAt = NOW() WHERE userId = $1`, [userId]);

    // Create session
    const s = await data.createSession(userId);
    setCookie(res, "sid", s.sid, { httpOnly: true, maxAge: 60*60*24*30, secure: isHttpsRequest(req) });

    console.log("Auto-login successful for userId:", userId);
    res.json({ ok: true, userId });
  } catch(e) {
    console.error("Signup auto-login error:", e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/public/waitlist", async (req, res) =>{
  const result = await data.addWaitlistSignup(req.body || {});
  if(result?.error) return res.status(400).json({ error: result.error });
  const waitlistSummary = {
    name: (req.body?.name || "").toString().trim(),
    email: (req.body?.email || "").toString().trim(),
    phone: (req.body?.phone || "").toString().trim(),
    interests: Array.isArray(req.body?.interests) ? req.body.interests : (req.body?.interests || ""),
    notes: (req.body?.notes || "").toString().trim(),
    status: "pending"
  };
  const waitlistText = [
    "New waitlist signup",
    "",
    JSON.stringify(waitlistSummary, null, 2),
    "",
    `Review: ${getAdminReviewLink()}`
  ].join("\n");
  sendAdminEmail("New waitlist signup", waitlistText);
  res.json({ ok:true });
});

app.post("/api/public/apply/business", async (req, res) =>{
  const result = await data.addBusinessApplication(req.body || {});
  if(result?.error) return res.status(400).json({ error: result.error });
  const businessSummary = {
    contactName: (req.body?.contactName || "").toString().trim(),
    email: (req.body?.email || "").toString().trim(),
    phone: (req.body?.phone || "").toString().trim(),
    businessName: (req.body?.businessName || "").toString().trim(),
    type: (req.body?.type || "").toString().trim(),
    category: (req.body?.category || "").toString().trim(),
    website: (req.body?.website || "").toString().trim(),
    inSebastian: (req.body?.inSebastian || "").toString().trim(),
    address: (req.body?.address || "").toString().trim(),
    notes: (req.body?.notes || "").toString().trim(),
    status: "pending"
  };
  const businessText = [
    "New business/service application",
    "",
    JSON.stringify(businessSummary, null, 2),
    "",
    `Review: ${getAdminReviewLink()}`
  ].join("\n");
  sendAdminEmail("New business/service application", businessText);
  res.json({ ok:true });
});

app.post("/api/public/apply/resident", async (req, res) =>{
  const result = await data.addResidentApplication(req.body || {});
  if(result?.error) return res.status(400).json({ error: result.error });
  const residentSummary = {
    name: (req.body?.name || "").toString().trim(),
    email: (req.body?.email || "").toString().trim(),
    phone: (req.body?.phone || "").toString().trim(),
    addressLine1: (req.body?.addressLine1 || "").toString().trim(),
    city: (req.body?.city || "").toString().trim(),
    state: (req.body?.state || "").toString().trim(),
    zip: (req.body?.zip || "").toString().trim(),
    yearsInSebastian: (req.body?.yearsInSebastian || "").toString().trim(),
    notes: (req.body?.notes || "").toString().trim(),
    status: "pending"
  };
  const residentText = [
    "New resident application",
    "",
    JSON.stringify(residentSummary, null, 2),
    "",
    `Review: ${getAdminReviewLink()}`
  ].join("\n");
  sendAdminEmail("New resident application", residentText);
  res.json({ ok:true });
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});
function prefixForKind(kind){
  const k = (kind || "").toString();
  if(k.startsWith("store_")) return "stores";
  if(k.startsWith("listing")) return "listings";
  if(k.startsWith("profile")) return "profiles";
  if(k.startsWith("event")) return "events";
  return "uploads";
}

app.post("/api/uploads", upload.single("file"), async (req,res)=>{
  const u=await requireLogin(req,res); if(!u) return;
  const ctx=await data.getTownContext(1, u);
  const user=await data.getUserById(u);
  const file = req.file;
  if(!file) return res.status(400).json({error:"file required"});
  if(!file.mimetype || !file.mimetype.startsWith("image/")){
    return res.status(400).json({error:"Images only"});
  }
  const kind = (req.body?.kind || "other").toString();
  if(kind.startsWith("chat_")){
    const last = chatImageUploadRate.get(u) || 0;
    if(Date.now() - last < 5000){
      return res.status(429).json({error:"Rate limit: 1 image per 5 seconds"});
    }
    chatImageUploadRate.set(u, Date.now());
  }
  const action = kind.startsWith("chat_") ? "chat_image" : "image_upload";
  const gate = trust.can(user, ctx, action);
  if(!gate.ok) return res.status(403).json({error:`Requires trust tier ${gate.required} for ${action}`});
  const placeId = req.body?.placeId;
  const listingId = req.body?.listingId;
  const eventId = req.body?.eventId;
  try{
    const { url, key } = await uploadImage({
      buffer: file.buffer,
      filename: file.originalname,
      contentType: file.mimetype,
      prefix: prefixForKind(kind)
    });
    const media = await data.addMediaObject({
      townId: 1,
      ownerUserId: u,
      placeId: placeId == null ? null : Number(placeId),
      listingId: listingId == null ? null : Number(listingId),
      eventId: eventId == null ? null : Number(eventId),
      kind,
      storageDriver: "r2",
      key,
      url,
      mime: file.mimetype,
      bytes: file.size
    });
    res.json({ url, publicUrl: url, id: media.id });
  }catch(e){
    res.status(500).json({error: e.message});
  }
});
app.get("/me", async (req, res) =>{
  const sid=parseCookies(req).sid;
  if(!sid) return res.json({user:null});
  const r=await data.getUserBySession(sid);
  if(!r) return res.json({user:null});
  await data.ensureTownMembership(1,r.user.id);
  r.user.isAdmin = isAdminUser(r.user);
  res.json(r);
});
app.get("/api/me", async (req, res) =>{
  const sid = parseCookies(req).sid;
  if(!sid) return res.status(401).json({ error: "not logged in" });
  const r = await data.getUserBySession(sid);
  if(!r) return res.status(401).json({ error: "not logged in" });
  const ctx = await data.getTownContext(1, r.user.id);
  const trustTier = (ctx.membership?.trustTier ?? ctx.membership?.trusttier ?? r.user.trustTier ?? 0);
const tierName = permissions.tierName(trustTier);
  res.json({
    ok: true,
    user: {
      id: r.user.id,
      email: r.user.email,
      trustLevel: ctx.trustLevel,
      trustTier,
      trustTierLabel: tierName,
      level: trustTier,
      isAdmin: isAdminUser(r.user)
    }
  });
});
app.get("/api/users/:id", async (req, res) =>{
  const profile = await data.getUserProfilePublic(req.params.id);
  if(!profile) return res.status(404).json({error:"User not found"});
  const user = await data.getUserById(profile.id);
  const ctx = await data.getTownContext(1, profile.id);
  const tier = trust.resolveTier(user, ctx);
  res.json({ ...profile, trustTier: tier, trustTierLabel: TRUST_TIER_LABELS[tier] || "Visitor" });
});
app.get("/api/me/profile", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const profile = await data.getUserProfilePrivate(u);
  if(!profile) return res.status(404).json({error:"User not found"});
  res.json(profile);
});
app.patch("/api/me/profile", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const beforeUser = await data.getUserById(u);
  const beforeComplete = isProfileComplete(beforeUser);
  const displayName = (req.body?.displayName || "").toString();
  const bio = (req.body?.bio || "").toString();
  const avatarUrl = (req.body?.avatarUrl || "").toString();
  const ageRange = (req.body?.ageRange || "").toString();
  const interests = Array.isArray(req.body?.interests) ? req.body.interests : [];
  if(displayName.length > 60) return res.status(400).json({error:"displayName too long"});
  if(bio.length > 500) return res.status(400).json({error:"bio too long"});
  if(avatarUrl.length > 400) return res.status(400).json({error:"avatarUrl too long"});
  if(ageRange.length > 40) return res.status(400).json({error:"ageRange too long"});
  if(interests.length > 12) return res.status(400).json({error:"too many interests"});
  for(const t of interests){
    if((t || "").toString().length > 24) return res.status(400).json({error:"interest too long"});
  }
  const updated = await data.updateUserProfile(u, {
    displayName,
    bio,
    avatarUrl,
    ageRange,
    interests,
    showAvatar: req.body?.showAvatar == null ? undefined : !!req.body.showAvatar,
    showBio: req.body?.showBio == null ? undefined : !!req.body.showBio,
    showInterests: req.body?.showInterests == null ? undefined : !!req.body.showInterests,
    showAgeRange: req.body?.showAgeRange == null ? undefined : !!req.body.showAgeRange
  });
  const afterUser = await data.getUserById(u);
  const afterComplete = isProfileComplete(afterUser);
  if(!beforeComplete && afterComplete){
    try{
      await data.tryAwardSweepForEvent({
        townId: 1,
        userId: u,
        ruleType: "profile_complete",
        eventKey: `profile_complete:${u}`,
        meta: {}
      });
    }catch(err){
      console.error("SWEEP_AWARD_PROFILE_ERROR", err?.message);
    }
  }
  res.json(updated);
});

app.get("/dm", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const convos = await data.listDirectConversationsForUser(u);
  const rows = await Promise.all(convos.map(async (c)=>{
    const other = c.otherUser?.id ? await getTrustBadgeForUser(c.otherUser.id) : null;
    return { ...c, otherUser: other || c.otherUser };
  }));
  res.json(rows);
});
app.post("/dm/start", async (req, res) =>{
  const u=await requireUserSubscription(req,res); if(!u) return;
  const otherUserId = Number(req.body?.otherUserId);
  if(!otherUserId) return res.status(400).json({error:"otherUserId required"});
  if(Number(otherUserId)===Number(u)) return res.status(400).json({error:"Cannot message self"});
  const other = await data.getUserById(otherUserId);
  if(!other) return res.status(404).json({error:"User not found"});
  const convo = await data.addDirectConversation(u, otherUserId);
  res.status(201).json({ id: convo.id, otherUserId });
});
app.get("/dm/:id/messages", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  if(!await data.isDirectConversationMember(req.params.id, u)) return res.status(403).json({error:"Forbidden"});
  const messages = await data.getDirectMessages(req.params.id);
  const msgs = await Promise.all(messages.map(async (m)=>({
    ...m,
    senderUserId: m.senderUserId || m.senderuserid,
    conversationId: m.conversationId || m.conversationid,
    createdAt: m.createdAt || m.createdat,
    sender: await getTrustBadgeForUser(m.senderUserId || m.senderuserid)
  })));
  res.json(msgs);
});
app.post("/dm/:id/messages", async (req, res) =>{
  const u=await requireUserSubscription(req,res); if(!u) return;
  const ctx=await data.getTownContext(1, u);
  const user=await data.getUserById(u);
  const gate = trust.can(user, ctx, "chat_text");
  if(!gate.ok) return res.status(403).json({error:"Chat requires verified access"});
  if(!await data.isDirectConversationMember(req.params.id, u)) return res.status(403).json({error:"Forbidden"});
  const text = (req.body?.text || "").toString().trim();
  if(!text) return res.status(400).json({error:"text required"});
  const msg = await data.addDirectMessage(req.params.id, u, text);
  res.status(201).json({ ok:true, id: msg.id });
});
app.get("/town/context", async (req, res) =>{
  const u=await getUserId(req);
  const ctx = await data.getTownContext(1, u);
  const user = u ? await data.getUserById(u) : null;
  const tier = trust.resolveTier(user, ctx);
  const tierName = TRUST_TIER_LABELS[tier] || "Visitor";
  const permissions = trust.permissionsForTier(tier);
  const limits = trust.limitsForTier(tier);
  res.json({ ...ctx, trustTier: tier, trustTierLabel: tierName, tierName, permissions, limits });
});

function isInsideSebastian(lat, lng, accuracyMeters){
  const maxAccuracy = 200;
  if(!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok:false, error:"Invalid coordinates" };
  if(!Number.isFinite(accuracyMeters) || accuracyMeters > maxAccuracy){
    return { ok:false, error:"Accuracy must be <= 200 meters" };
  }
  const center = { lat: 27.816, lng: -80.470 };
  const radiusMeters = 15000;
  const toRad = (d)=>d * Math.PI / 180;
  const dLat = toRad(lat - center.lat);
  const dLng = toRad(lng - center.lng);
  const a = Math.sin(dLat/2) ** 2 +
            Math.cos(toRad(center.lat)) * Math.cos(toRad(lat)) *
            Math.sin(dLng/2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = 6371000 * c;
  if(distance > radiusMeters) return { ok:false, error:"Not inside Sebastian verification zone." };
  return { ok:true };
}

function isInsideSebastianBox(lat, lng){
  if(!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok:false, error:"Invalid coordinates" };
  const bounds = {
    minLat: 27.72,
    maxLat: 27.88,
    minLng: -80.56,
    maxLng: -80.39
  };
  if(lat < bounds.minLat || lat > bounds.maxLat || lng < bounds.minLng || lng > bounds.maxLng){
    return { ok:false, error:"Not inside Sebastian verification box." };
  }
  // TODO: Replace with a precise geofence/polygon for Sebastian.
  return { ok:true };
}

app.post("/api/presence/verify", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  const accuracyMeters = Number(req.body?.accuracyMeters);
  const check = isInsideSebastian(lat, lng, accuracyMeters);
  if(!check.ok) return res.status(400).json({ ok:false, inside:false, error: check.error });
  const updated = await data.updateUserPresence(u, { lat, lng, accuracyMeters });
  res.json({ ok:true, inside:true, presenceVerifiedAt: updated.presenceVerifiedAt });
});

app.post("/api/verify/location", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  const check = isInsideSebastianBox(lat, lng);
  if(!check.ok) return res.status(400).json({ ok:false, inside:false, error: check.error });
  await data.setUserLocationVerifiedSebastian(u, true);
  res.json({ ok:true, inside:true });
});

app.post("/api/verify/resident", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const created = await data.addResidentVerificationRequest(req.body || {}, u);
  if(created?.error) return res.status(400).json(created);
  res.status(201).json(created);
});

app.post("/api/admin/verify/resident/approve", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const userId = Number(req.body?.userId);
  if(!userId) return res.status(400).json({error:"userId required"});
  const approved = await data.approveResidentVerification(userId, admin.id);
  if(approved?.error) return res.status(400).json(approved);
  const updated = await data.setUserTrustTier(1, userId, 2);
  if(updated?.error) return res.status(400).json(updated);
  res.json({ ok:true });
});

app.post("/api/admin/verify/business/approve", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const userId = Number(req.body?.userId);
  if(!userId) return res.status(400).json({error:"userId required"});
  const updated = await data.setUserTrustTier(1, userId, 3);
  if(updated?.error) return res.status(400).json(updated);
  res.json({ ok:true });
});

app.post("/api/trust/apply", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const requestedTier = Number(req.body?.requestedTier);
  if(![1,2,3].includes(requestedTier)) return res.status(400).json({error:"requestedTier must be 1, 2, or 3"});
  const payload = {
    email: (req.body?.email || "").toString().trim(),
    phone: (req.body?.phone || "").toString().trim(),
    address1: (req.body?.address1 || "").toString().trim(),
    address2: (req.body?.address2 || "").toString().trim(),
    city: (req.body?.city || "").toString().trim(),
    state: (req.body?.state || "").toString().trim(),
    zip: (req.body?.zip || "").toString().trim(),
    identityMethod: (req.body?.identityMethod || "").toString().trim()
  };
  if(!payload.email || !payload.phone || !payload.address1 || !payload.city || !payload.state || !payload.zip || !payload.identityMethod){
    return res.status(400).json({error:"Missing required fields"});
  }
  const user = await data.getUserById(u);
  if(requestedTier === 1){
    if(Number(user?.locationVerifiedSebastian || 0) !== 1){
      return res.status(400).json({error:"Location verified in Sebastian required."});
    }
  }
  if(requestedTier === 2){
    const reqRow = await data.addResidentVerificationRequest({
      addressLine1: payload.address1,
      city: payload.city,
      state: payload.state,
      zip: payload.zip
    }, u);
    if(reqRow?.error) return res.status(400).json(reqRow);
  }
  await data.updateUserContact(u, {
    phone: payload.phone,
    address: {
      address1: payload.address1,
      address2: payload.address2,
      city: payload.city,
      state: payload.state,
      zip: payload.zip
    }
  });
  const autoApprove = requestedTier === 1;
  const appRow = await data.addTrustApplication({
    townId: 1,
    userId: u,
    requestedTier,
    status: autoApprove ? "approved" : "pending",
    email: payload.email,
    phone: payload.phone,
    address1: payload.address1,
    address2: payload.address2,
    city: payload.city,
    state: payload.state,
    zip: payload.zip,
    identityMethod: payload.identityMethod,
    identityStatus: autoApprove ? "verified" : "pending",
    presenceStatus: "not_required"
  });
  res.status(201).json({ ok:true, id: appRow.id, status: autoApprove ? "approved" : "pending" });
});

app.get("/api/trust/my", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const ctx = await data.getTownContext(1, u);
  const user = await data.getUserById(u);
  const tier = trust.resolveTier(user, ctx);
  const apps = await data.getTrustApplicationsByUser(u);
  res.json({ trustTier: tier, tierName: TRUST_TIER_LABELS[tier] || "Visitor", applications: apps });
});

app.get("/api/admin/trust/apps", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const status = (req.query?.status || "pending").toString();
  res.json(await data.getTrustApplicationsByStatus(status));
});
app.post("/api/admin/trust/apps/:id/approve", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const pendingApps = await data.getTrustApplicationsByStatus("pending");
  const appRow = pendingApps.find(a=>a.id==req.params.id);
  if(!appRow) return res.status(404).json({error:"Application not found"});
  await data.updateTrustApplicationStatus(appRow.id, "approved", admin.id, "");
  await data.setUserTrustTier(1, appRow.userId, appRow.requestedTier);
  res.json({ ok:true });
});
app.post("/api/admin/trust/apps/:id/reject", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const reason = (req.body?.reason || "").toString().trim();
  if(!reason) return res.status(400).json({error:"reason required"});
  await data.updateTrustApplicationStatus(Number(req.params.id), "rejected", admin.id, reason);
  res.json({ ok:true });
});

app.post("/api/live/rooms/create", async (req,res)=>{
  const access = await requirePerm(req,res,"LIVE_HOST"); if(!access) return;
  const u=access.userId;
  const user=access.user;
  const title=(req.body?.title||"").toString().trim();
  const description=(req.body?.description||"").toString().trim();
  const hostType = (req.body?.hostType || "individual").toString().trim();
  const hostPlaceId = req.body?.hostPlaceId == null ? null : Number(req.body.hostPlaceId);
  const hostEventId = req.body?.hostEventId == null ? null : Number(req.body.hostEventId);
  if(!["individual","place","event"].includes(hostType)) return res.status(400).json({error:"Invalid hostType"});
  if(hostType === "place" && !hostPlaceId) return res.status(400).json({error:"hostPlaceId required"});
  if(hostType === "event" && !hostEventId) return res.status(400).json({error:"hostEventId required"});
  if(hostType === "individual" && (hostPlaceId || hostEventId)) return res.status(400).json({error:"No linkage allowed for individual"});
  if(hostPlaceId && hostEventId) return res.status(400).json({error:"Only one linkage allowed"});
  if(hostType === "place"){
    const place = await data.getPlaceById(hostPlaceId);
    if(!place) return res.status(404).json({error:"Place not found"});
    if(Number(place.ownerUserId ?? place.owneruserid)!==Number(u)) return res.status(403).json({error:"Only owner can host for place"});
  }
  if(hostType === "event"){
    const ev = await data.getEventById(hostEventId);
    if(!ev) return res.status(404).json({error:"Event not found"});
    const isOrganizer = (ev.organizerEmail || "").toLowerCase() === (user.email || "").toLowerCase();
    if(!isOrganizer && !isAdminUser(user)) return res.status(403).json({error:"Only organizer or admin can host"});
  }
  const calls = await createCallsRoom();
  const channelName = `live-${Date.now()}-${Math.random().toString(16).slice(2,6)}`;
  const channel = await data.createChannel(channelName, `Live room: ${title || "Untitled"}`, 1);
  const room = await data.createLiveRoom({
    townId: 1,
    status: "idle",
    title,
    description,
    hostUserId: u,
    hostPlaceId,
    hostEventId,
    hostType,
    hostChannelId: channel.id,
    cfRoomId: calls.id,
    cfRoomToken: calls.token || ""
  });
  res.status(201).json({ roomId: room.id, joinUrl: `/live/${room.id}`, cfRoomId: room.cfRoomId, mock: calls.mock, error: calls.error || "" });
});

app.post("/api/live/rooms/:id/start", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const room = await data.getLiveRoomById(req.params.id);
  if(!room) return res.status(404).json({error:"Room not found"});
  if(Number(room.hostUserId)!==Number(u) && !isAdminUser(await data.getUserById(u))){
    return res.status(403).json({error:"Only host or admin can start"});
  }
  const updated = await data.updateLiveRoom(room.id, { status:"live", startedAt: new Date().toISOString() });
  res.json(updated);
});

app.post("/api/live/rooms/:id/end", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const room = await data.getLiveRoomById(req.params.id);
  if(!room) return res.status(404).json({error:"Room not found"});
  if(Number(room.hostUserId)!==Number(u) && !isAdminUser(await data.getUserById(u))){
    return res.status(403).json({error:"Only host or admin can end"});
  }
  const updated = await data.updateLiveRoom(room.id, { status:"ended", endedAt: new Date().toISOString() });
  res.json(updated);
});

app.post("/api/live/rooms/:id/pin", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const room = await data.getLiveRoomById(req.params.id);
  if(!room) return res.status(404).json({error:"Room not found"});
  if(Number(room.hostUserId)!==Number(u) && !isAdminUser(await data.getUserById(u))){
    return res.status(403).json({error:"Only host or admin can pin"});
  }
  const listingId = Number(req.body?.listingId);
  if(!listingId) return res.status(400).json({error:"listingId required"});
  const listing = await data.getListingById(listingId);
  if(!listing) return res.status(404).json({error:"Listing not found"});
  const place = await data.getPlaceById(listing.placeId);
  if(room.hostPlaceId && Number(listing.placeId)!==Number(room.hostPlaceId)){
    return res.status(403).json({error:"Listing must belong to host store"});
  }
  if(place && Number(place.ownerUserId ?? place.owneruserid)!==Number(room.hostUserId ?? room.hostuserid)){
    return res.status(403).json({error:"Only host listings can be pinned"});
  }
  const updated = await data.updateLiveRoom(room.id, { pinnedListingId: listing.id });
  res.json(updated);
});

app.get("/api/live/rooms/active", async (req, res) =>{
  const access = await requirePerm(req,res,"VIEW_SCHEDULED"); if(!access) return;
  const rooms = await data.listActiveLiveRooms(1);
  const rows = rooms.map((r)=>({ id:r.id, title:r.title, hostType:r.hostType || "individual", joinUrl:`/live/${r.id}` }));
  res.json(rows);
});

app.get("/api/live/rooms/:id", async (req, res) =>{
  const access = await requirePerm(req,res,"VIEW_SCHEDULED"); if(!access) return;
  const room = await data.getLiveRoomById(req.params.id);
  if(!room) return res.status(404).json({error:"Room not found"});
  const hostUser = await data.getUserById(room.hostUserId);
  const hostPlace = room.hostPlaceId ? await data.getPlaceById(room.hostPlaceId) : null;
  const hostEvent = room.hostEventId ? await data.getEventById(room.hostEventId) : null;
  const pinned = room.pinnedListingId ? await data.getListingById(room.pinnedListingId) : null;
  const pinnedPlace = pinned ? await data.getPlaceById(pinned.placeId) : null;
  res.json({
    ...room,
    joinUrl: `/live/${room.id}`,
    host: {
      type: room.hostType || "individual",
      displayName: await data.getDisplayNameForUser(hostUser),
      placeName: hostPlace?.name || "",
      eventTitle: hostEvent?.title || "",
      eventStartAt: hostEvent?.startAt || "",
      eventEndAt: hostEvent?.endAt || ""
    },
    pinnedListing: pinned ? {
      id: pinned.id,
      title: pinned.title,
      description: pinned.description,
      placeId: pinned.placeId,
      placeName: pinnedPlace?.name || ""
    } : null,
    calls: {
      configured: !!(CF_CALLS_APP_ID && CF_CALLS_APP_SECRET),
      mock: room.cfRoomId.startsWith("mock-")
    }
  });
});

app.get("/api/live/scheduled", async (req, res) =>{
  const access = await requirePerm(req,res,"VIEW_SCHEDULED"); if(!access) return;
  const from = req.query.from;
  const to = req.query.to;
  const shows = await data.listScheduledLiveShows({ from, to });
  const u = access.userId;
  let bookmarks = new Set();
  if(u){
    const rows = await data.getLiveShowBookmarksForUser(u);
    bookmarks = new Set(rows.map(r=>Number(r.showId)));
  }
  const activeRooms = await data.listActiveLiveRooms(1);
  const matchKey = (r)=>`${r.hostType || "individual"}:${r.hostUserId}:${r.hostPlaceId || ""}:${r.hostEventId || ""}`;
  const activeMap = new Map(activeRooms.map(r=>[matchKey(r), r]));
  const out = await Promise.all(shows.map(async (s)=>{
    const hostUser = await data.getUserById(s.hostUserId);
    const place = s.hostPlaceId ? await data.getPlaceById(s.hostPlaceId) : null;
    const ev = s.hostEventId ? await data.getEventById(s.hostEventId) : null;
    const active = activeMap.get(`${s.hostType || "individual"}:${s.hostUserId}:${s.hostPlaceId || ""}:${s.hostEventId || ""}`);
    const hostName = await data.getDisplayNameForUser(hostUser);
    const hostAvatarUrl = (hostUser?.avatarUrl || place?.avatarUrl || "").toString().trim();
    return {
      ...s,
      bookmarked: u ? bookmarks.has(Number(s.id)) : false,
      hostLabel: s.hostType === "place" ? (place?.name || "Store") :
        s.hostType === "event" ? (ev?.title || "Event") :
        hostName,
      hostName,
      hostStoreName: place?.name || "",
      hostAvatarUrl,
      joinUrl: active ? `/live/${active.id}` : ""
    };
  }));
  res.json(out);
});

app.post("/api/live/scheduled", async (req, res) =>{
  const access = await requirePerm(req,res,"LIVE_SCHEDULE"); if(!access) return;
  const u=access.userId;
  const user=access.user;
  const title=(req.body?.title||"").toString().trim();
  const description=(req.body?.description||"").toString().trim();
  const startAt=toISOOrEmpty(req.body?.startAt);
  const endAt=toISOOrEmpty(req.body?.endAt || "");
  const hostType=(req.body?.hostType || "individual").toString().trim();
  const hostPlaceId = req.body?.hostPlaceId == null ? null : Number(req.body.hostPlaceId);
  const hostEventId = req.body?.hostEventId == null ? null : Number(req.body.hostEventId);
  const thumbnailUrl=(req.body?.thumbnailUrl || "").toString().trim();
  if(!title || !startAt) return res.status(400).json({error:"title and startAt required"});
  if(!["individual","place","event"].includes(hostType)) return res.status(400).json({error:"Invalid hostType"});
  if(hostType === "place" && !hostPlaceId) return res.status(400).json({error:"hostPlaceId required"});
  if(hostType === "event" && !hostEventId) return res.status(400).json({error:"hostEventId required"});
  if(hostType === "individual" && (hostPlaceId || hostEventId)) return res.status(400).json({error:"No linkage allowed for individual"});
  if(hostPlaceId && hostEventId) return res.status(400).json({error:"Only one linkage allowed"});
  if(hostType === "place"){
    const place = await data.getPlaceById(hostPlaceId);
    if(!place) return res.status(404).json({error:"Place not found"});
    if(Number(place.ownerUserId ?? place.owneruserid)!==Number(u)) return res.status(403).json({error:"Only owner can host for place"});
  }
  if(hostType === "event"){
    const ev = await data.getEventById(hostEventId);
    if(!ev) return res.status(404).json({error:"Event not found"});
    const isOrganizer = (ev.organizerEmail || "").toLowerCase() === (user.email || "").toLowerCase();
    if(!isOrganizer && !isAdminUser(user)) return res.status(403).json({error:"Only organizer or admin can host"});
  }
  const created = await data.addScheduledLiveShow({
    townId: 1,
    status: "scheduled",
    title,
    description,
    startAt,
    endAt,
    hostUserId: u,
    hostType,
    hostPlaceId,
    hostEventId,
    thumbnailUrl
  });
  res.status(201).json(created);
});

app.get("/api/live/scheduled/:id/bookmark", async (req, res) =>{
  const access = await requirePerm(req,res,"VIEW_SCHEDULED"); if(!access) return;
  const u=access.userId;
  const showId = Number(req.params.id);
  const rows = await data.getLiveShowBookmarksForUser(u);
  const bookmarked = rows.some(r=>Number(r.showId)===showId);
  res.json({ bookmarked });
});
app.post("/api/live/scheduled/:id/bookmark", async (req, res) =>{
  const access = await requirePerm(req,res,"VIEW_SCHEDULED"); if(!access) return;
  const u=access.userId;
  const showId = Number(req.params.id);
  const toggled = await data.toggleLiveShowBookmark(u, showId);
  res.json(toggled);
});

app.post("/api/signup", async (req, res) =>{
  const r=await data.addSignup(req.body||{});
  if(r?.error) return res.status(400).json(r);
  res.json(r);
});

// Events v1 (submission + approvals)
app.post("/api/events/submit", async (req, res) =>{
  const access = await requirePerm(req,res,"CREATE_EVENTS"); if(!access) return;
  const created=await data.addEventSubmission(req.body || {});
  if(created?.error) return res.status(400).json(created);
  res.status(201).json(created);
});
app.get("/api/events", async (req, res) =>{
  const access = await requirePerm(req,res,"VIEW_EVENTS"); if(!access) return;
  const status=(req.query.status || "approved").toString().trim().toLowerCase();
  if(status && status !== "approved") return res.status(400).json({error:"Only approved events can be listed"});
  const from=req.query.from;
  const to=req.query.to;
  const events = await data.listApprovedEvents({ from, to });
  const rows = await Promise.all(events.map(async (ev)=>{
    const orgUserId = ev.organizerUserId || ev.organizeruserid;
    if(!orgUserId) return ev;
    const badge = await getTrustBadgeForUser(orgUserId);
    return { ...ev, organizerTrustTierLabel: badge?.trustTierLabel || null };
  }));
  res.json(rows);
});

// Local businesses (applications) - any logged in user can apply for business status
app.post("/api/localbiz/apply", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const created=await data.addLocalBizApplication(req.body || {}, u);
  if(created?.error) return res.status(400).json(created);
  res.status(201).json(created);
});
app.get("/api/localbiz/my", async (req, res) =>{
  const access = await requirePerm(req,res,"VIEW_LOCALBIZ"); if(!access) return;
  res.json(await data.listLocalBizApplicationsByUser(access.userId));
});

// Prize offers
app.post("/api/prizes/submit", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const ctx=await data.getTownContext(1, u);
  const user=await data.getUserById(u);
  const gate = trust.can(user, ctx, "prize_submit");
  if(!gate.ok) return res.status(403).json({error:"Prize offers require resident trust"});
  const created=await data.addPrizeOffer(req.body || {}, u);
  if(created?.error) return res.status(400).json(created);
  res.status(201).json(created);
});
app.get("/api/prizes/active", async (req, res) =>{
  const offers = await data.listActivePrizeOffers();
  const rows = await Promise.all(offers.map(async (p)=>{
    const badge = await getTrustBadgeForUser(p.donorUserId || p.donoruserid);
    return { ...p, donorTrustTierLabel: badge?.trustTierLabel || null };
  }));
  res.json(rows);
});

// Archive
app.get("/api/archive", async (req, res) =>{
  const access = await requirePerm(req,res,"VIEW_ARCHIVE"); if(!access) return;
  res.json(await data.listArchiveEntries());
});
app.get("/api/archive/:slug", async (req, res) =>{
  const access = await requirePerm(req,res,"VIEW_ARCHIVE"); if(!access) return;
  const entry=await data.getArchiveEntryBySlug(req.params.slug);
  if(!entry) return res.status(404).json({error:"Not found"});
  res.json(entry);
});
app.get("/api/pulse/archive", async (req, res) =>{
  try{
    const u=await requireLogin(req,res); if(!u) return;
    res.json(await data.listDailyPulses(1, 90));
  }catch(err){
    console.error("PULSE_ARCHIVE_ERROR", err?.message);
    res.status(500).json({ error: "internal error" });
  }
});

app.get("/api/prize_awards/my", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const placeId = req.query.placeId ? Number(req.query.placeId) : null;
  if(placeId){
    const place = await data.getPlaceById(placeId);
    if(!place || Number(place.ownerUserId ?? place.owneruserid)!==Number(u)) return res.status(403).json({error:"Only owner"});
  }
  res.json(await data.listPrizeAwardsForUser(u, placeId));
});
app.post("/api/prize_awards/:id/claim", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const award = await data.getPrizeAwardById(req.params.id);
  if(!award) return res.status(404).json({error:"Not found"});
  if(Number(award.winnerUserId)!==Number(u)) return res.status(403).json({error:"Winner only"});
  const updated = await data.updatePrizeAwardStatus(award.id, "claimed", {});
  res.json(updated);
});
app.post("/api/prize_awards/:id/scheduled", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const award = await data.getPrizeAwardById(req.params.id);
  if(!award) return res.status(404).json({error:"Not found"});
  if(Number(award.donorUserId)!==Number(u)) return res.status(403).json({error:"Donor only"});
  const updated = await data.updatePrizeAwardStatus(award.id, "scheduled", {});
  res.json(updated);
});
app.post("/api/prize_awards/:id/fulfilled", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const award = await data.getPrizeAwardById(req.params.id);
  if(!award) return res.status(404).json({error:"Not found"});
  if(Number(award.donorUserId)!==Number(u)) return res.status(403).json({error:"Donor only"});
  const proofUrl = (req.body?.proofUrl || "").toString().trim();
  const updated = await data.updatePrizeAwardStatus(award.id, "fulfilled", { proofUrl });
  res.json(updated);
});
app.post("/api/prize_awards/:id/confirm_received", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const award = await data.getPrizeAwardById(req.params.id);
  if(!award) return res.status(404).json({error:"Not found"});
  if(Number(award.winnerUserId)!==Number(u)) return res.status(403).json({error:"Winner only"});
  const updated = await data.updatePrizeAwardStatus(award.id, "fulfilled", {});
  res.json(updated);
});
app.post("/api/prize_awards/:id/report_issue", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const award = await data.getPrizeAwardById(req.params.id);
  if(!award) return res.status(404).json({error:"Not found"});
  if(Number(award.winnerUserId)!==Number(u)) return res.status(403).json({error:"Winner only"});
  const updated = await data.updatePrizeAwardStatus(award.id, "disputed", {});
  res.json(updated);
});

// Events (boot + calendar)
app.get("/events", async (req, res) =>{
  const access = await requirePerm(req,res,"VIEW_EVENTS"); if(!access) return;
  const range = (req.query.range || "week").toString();
  const safeRange = (range === "month") ? "month" : "week";
  res.json(await data.getCalendarEvents(safeRange));
});
app.post("/events", async (req, res) =>{
  if(req.body?.eventType || req.body?.clientSessionId){
    await data.logEvent(req.body || {});
    return res.json({ok:true});
  }
  const access = await requirePerm(req,res,"CREATE_EVENTS"); if(!access) return;
  const u=access.userId;
  if(!req.body?.title || !req.body?.startsAt) return res.status(400).json({error:"title and startsAt required"});
  const created = await data.addCalendarEvent(req.body, u);
  res.status(201).json(created);
});
app.post("/events/:id/rsvp", async (req, res) =>{
  const access = await requirePerm(req,res,"RSVP_EVENTS"); if(!access) return;
  const u=access.userId;
  const ev = await data.getCalendarEventById(req.params.id);
  if(!ev) return res.status(404).json({error:"Event not found"});
  await data.addEventRsvp(ev.id, u, req.body?.status || "going");
  try{
    await data.tryAwardSweepForEvent({
      townId: 1,
      userId: u,
      ruleType: "rsvp_event",
      eventKey: `rsvp:${ev.id}:${u}`,
      meta: { eventId: ev.id }
    });
  }catch(err){
    console.error("SWEEP_AWARD_RSVP_ERROR", err?.message);
  }
  res.json({ok:true});
});

// Orders (payment scaffolding)
app.get("/api/cart", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const items = await data.getCartItemsByUser(u);
  const listings = await data.getListings();
  const places = await data.getPlaces();
  const placeMap = new Map(places.map(p=>[Number(p.id), p]));
  const enriched = items.map((item)=>{
    // Handle PostgreSQL lowercase column names
    const itemListingId = item.listingId ?? item.listingid;
    const listing = listings.find(l=>Number(l.id)===Number(itemListingId));
    const place = listing ? placeMap.get(Number(listing.placeId ?? listing.placeid)) : null;
    const priceCents = Math.round(Number(listing?.price || 0) * 100);
    return {
      id: item.id,
      listingId: itemListingId,
      quantity: item.quantity,
      title: listing?.title || "",
      listingType: (listing?.listingType ?? listing?.listingtype) || "item",
      priceCents,
      placeId: (listing?.placeId ?? listing?.placeid) || null,
      placeName: place?.name || ""
    };
  });
  res.json({ items: enriched });
});
app.post("/api/cart/add", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const listingId = Number(req.body?.listingId || 0);
  const quantity = Number(req.body?.quantity || 1);
  if(!listingId || !Number.isFinite(quantity) || quantity === 0) return res.status(400).json({error:"listingId and quantity required"});
  const listing = await data.getListingById(listingId);
  if(!listing) return res.status(404).json({error:"Listing not found"});
  if((listing.listingType||"item")!=="item") return res.status(400).json({error:"Only item listings can be added to cart"});
  if((listing.status || "active")!=="active") return res.status(400).json({error:"Listing not active"});
  if(quantity > 0){
    const existing = await data.getCartItem(u, listingId);
    const existingQty = Number(existing?.quantity || 0);
    if(Number(listing.quantity || 0) < (existingQty + quantity)) return res.status(400).json({error:"Insufficient quantity"});
  }
  const created = await data.addCartItem(u, listingId, quantity);
  res.json({ ok:true, item: created });
});
app.post("/api/cart/remove", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const listingId = Number(req.body?.listingId || 0);
  if(!listingId) return res.status(400).json({error:"listingId required"});
  await data.removeCartItem(u, listingId);
  res.json({ ok:true });
});
app.post("/api/cart/clear", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  await data.clearCart(u);
  res.json({ ok:true });
});

// Simplified checkout - no online payment, buyers/sellers arrange payment offline
app.post("/api/checkout/create", async (req, res) =>{
  const u=await requireUserSubscription(req,res); if(!u) return;
  const cart = await data.getCartItemsByUser(u);
  if(!cart.length) return res.status(400).json({error:"Cart is empty"});
  const listings = await data.getListings();
  const places = await data.getPlaces();
  const placeMap = new Map(places.map(p=>[Number(p.id), p]));
  const items = [];
  let placeId = null;
  let sellerUserId = null;
  let subtotalCents = 0;
  for(const item of cart){
    const itemListingId = item.listingId ?? item.listingid;
    const listing = listings.find(l=>Number(l.id)===Number(itemListingId));
    if(!listing) return res.status(400).json({error:"Listing not found"});
    const listingPlaceId = listing.placeId ?? listing.placeid;
    if((listing.listingType||"item")!=="item") return res.status(400).json({error:"Only item listings can be purchased"});
    if((listing.status || "active")!=="active") return res.status(400).json({error:"Listing not active"});
    if(Number(listing.quantity || 0) < Number(item.quantity || 0)) return res.status(400).json({error:"Insufficient quantity"});
    if(placeId == null) placeId = listingPlaceId;
    if(Number(placeId) !== Number(listingPlaceId)) return res.status(400).json({error:"Checkout supports a single store per order"});
    const place = placeMap.get(Number(listingPlaceId));
    if(place) sellerUserId = place.ownerUserId ?? place.owneruserid ?? null;
    const priceCents = Math.round(Number(listing.price || 0) * 100);
    subtotalCents += priceCents * Number(item.quantity || 0);
    items.push({
      listingId: listing.id,
      titleSnapshot: listing.title,
      priceCentsSnapshot: priceCents,
      quantity: Number(item.quantity || 0)
    });
  }
  // No deposit - just the item total. Payment handled offline between buyer/seller
  const totalCents = subtotalCents;
  const order = await data.createOrderFromCart({
    townId: 1,
    listingId: items[0].listingId,
    buyerUserId: u,
    sellerUserId,
    sellerPlaceId: placeId,
    quantity: items.reduce((sum, i)=>sum + i.quantity, 0),
    amountCents: totalCents,
    status: "pending",
    paymentProvider: "offline",
    paymentIntentId: "",
    subtotalCents,
    serviceGratuityCents: 0,
    totalCents,
    fulfillmentType: (req.body?.fulfillmentType || "").toString(),
    fulfillmentNotes: (req.body?.fulfillmentNotes || "").toString()
  }, items);
  await data.clearCart(u);
  // Award sweep points for purchase
  try{
    await data.tryAwardSweepForEvent({
      townId: 1,
      userId: u,
      ruleType: "purchase",
      eventKey: `order:${order.id}:buyer`,
      meta: { totalCents, role: "buyer" }
    });
    if(sellerUserId){
      await data.tryAwardSweepForEvent({
        townId: 1,
        userId: sellerUserId,
        ruleType: "purchase",
        eventKey: `order:${order.id}:seller`,
        meta: { totalCents, role: "seller" }
      });
    }
  }catch(err){
    console.error("SWEEP_AWARD_PURCHASE_ERROR", err?.message);
  }
  res.json({ orderId: order.id, status: "pending", totals: { subtotalCents, totalCents } });
});
// Purchase payment is handled offline - this endpoint is deprecated
app.post("/api/checkout/stripe", async (req,res)=>{
  res.status(400).json({error:"Online payment not available. Please arrange payment directly with the seller."});
});

app.get("/api/orders", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  res.json(await data.getOrdersForBuyer(u));
});
app.get("/api/seller/orders", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const places = (await data.getPlaces()).filter(p=>Number(p.ownerUserId)===Number(u));
  const placeIds = places.map(p=>Number(p.id));
  const orders = await data.getOrdersForSellerPlaces(placeIds);
  res.json(orders);
});

app.post("/orders", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const listingId=Number(req.body?.listingId);
  const qtyRaw=req.body?.quantity;
  const quantity=Number.isFinite(Number(qtyRaw)) ? Number(qtyRaw) : 1;
  if(!listingId) return res.status(400).json({error:"listingId required"});
  const listing=await data.getListingById(listingId);
  if(!listing) return res.status(404).json({error:"Listing not found"});
  if(quantity < 1) return res.status(400).json({error:"quantity must be >= 1"});
  const amountCents=Math.round(Number(listing.price || 0) * 100) * quantity;
  const placeList = await data.getPlaces();
  const place = placeList.find(p=>Number(p.id)===Number(listing.placeId));
  if(!place) return res.status(404).json({error:"Place not found"});
  // Payment provider not configured - create order directly
  try{
    const order = await data.addOrder({
      listingId,
      buyerUserId: u,
      sellerUserId: place.ownerUserId ?? place.owneruserid ?? null,
      quantity,
      amountCents,
      status: "pending",
      paymentProvider: "none",
      paymentIntentId: null
    });
    res.status(201).json({order});
  }catch(e){
    res.status(500).json({error:e.message});
  }
});
app.get("/api/orders/:id", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const order=await data.getOrderById(req.params.id);
  if(!order) return res.status(404).json({error:"Order not found"});
  if(Number(order.buyerUserId)!==Number(u) && Number(order.sellerUserId)!==Number(u)){
    return res.status(403).json({error:"Forbidden"});
  }
  const items = await data.getOrderItems(order.id);
  const listingId = items[0]?.listingId || order.listingId;
  const listing = listingId ? await data.getListingById(listingId) : null;
  res.json({ order, items, listing });
});
app.post("/api/orders/:id/pay", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  if(process.env.NODE_ENV === "production") return res.status(403).json({error:"Dev-only endpoint"});
  const order=await data.getOrderById(req.params.id);
  if(!order) return res.status(404).json({error:"Order not found"});
  const orderBuyerId = order.buyerUserId ?? order.buyeruserid;
  if(Number(orderBuyerId)!==Number(u)) return res.status(403).json({error:"Not the order buyer"});
  if(order.status === "paid") return res.status(400).json({error:"Already paid"});
  const items = await data.getOrderItems(order.id);
  const listingId = items[0]?.listingId || order.listingId;
  const listing = listingId ? await data.getListingById(listingId) : null;
  if(listing?.paymentDueAt){
    const dueAt = Date.parse(listing.paymentDueAt);
    if(Number.isFinite(dueAt) && Date.now() > dueAt) return res.status(400).json({error:"Payment overdue"});
  }
  const existingPayment = await data.getPaymentForOrder(order.id);
  if(existingPayment && existingPayment.status === "paid") return res.status(400).json({error:"Already paid"});
  if(!existingPayment){
    await data.createPaymentForOrder(order.id, Number(order.totalCents || 0), "stub");
  }
  const result = await finalizeOrderPayment(order);
  if(!result.ok) return res.status(400).json({error: result.error || "Payment failed"});
  res.json({ok:true, order: result.order || order});
});
app.get("/orders/:id", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const order=await data.getOrderById(req.params.id);
  if(!order) return res.status(404).json({error:"Order not found"});
  if(Number(order.buyerUserId)!==Number(u) && Number(order.sellerUserId)!==Number(u)){
    return res.status(403).json({error:"Forbidden"});
  }
  res.json(order);
});
app.post("/orders/:id/complete", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const order=await data.getOrderById(req.params.id);
  if(!order) return res.status(404).json({error:"Order not found"});
  if(Number(order.buyerUserId)!==Number(u) && Number(order.sellerUserId)!==Number(u)){
    return res.status(403).json({error:"Forbidden"});
  }
  try{
    // Payment capture skipped - no payment provider configured
    const updated = await data.completeOrder(order.id);
    res.json(updated);
  }catch(e){
    res.status(500).json({error:e.message});
  }
});

// Trust: reviews + disputes
app.post("/orders/:id/review", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const order=await data.getOrderById(req.params.id);
  if(!order) return res.status(404).json({error:"Order not found"});
  if(order.status!=="completed") return res.status(400).json({error:"Order must be completed"});
  if(Number(order.buyerUserId)!==Number(u) && Number(order.sellerUserId)!==Number(u)){
    return res.status(403).json({error:"Forbidden"});
  }
  if(await data.getReviewForOrder(order.id, u)) return res.status(400).json({error:"Review already submitted"});
  const rating=Number(req.body?.rating);
  const text=(req.body?.text||"").toString().trim();
  if(!Number.isFinite(rating) || rating<1 || rating>5) return res.status(400).json({error:"rating 1-5 required"});
  const reviewerIsBuyer = Number(order.buyerUserId)===Number(u);
  const revieweeUserId = reviewerIsBuyer ? order.sellerUserId : order.buyerUserId;
  const role = reviewerIsBuyer ? "buyer" : "seller";
  const created=await data.addReview({orderId:order.id, reviewerUserId:u, revieweeUserId, role, rating, text});
  await data.addTrustEvent({orderId:order.id, userId:revieweeUserId, eventType:"review_received", meta:{rating, role}});
  res.status(201).json(created);
});
app.post("/orders/:id/dispute", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const order=await data.getOrderById(req.params.id);
  if(!order) return res.status(404).json({error:"Order not found"});
  if(Number(order.buyerUserId)!==Number(u) && Number(order.sellerUserId)!==Number(u)){
    return res.status(403).json({error:"Forbidden"});
  }
  const reason=(req.body?.reason||"").toString().trim();
  if(!reason) return res.status(400).json({error:"reason required"});
  const created=await data.addDispute({orderId:order.id, reporterUserId:u, reason, status:"open"});
  await data.addTrustEvent({orderId:order.id, userId:u, eventType:"dispute_opened", meta:{reason}});
  res.status(201).json(created);
});

// Admin moderation (basic)
app.get("/api/admin/pulse", async (req, res) =>{
  const hours = Number(req.query.hours || 24);
  const since = new Date(Date.now() - (Number.isFinite(hours) ? hours : 24) * 60 * 60 * 1000).toISOString();
  const counts = await data.getEventCountsSince(since, 1);
  const sessions = await data.getSessionCountSince(since, 1);
  res.json({ since, sessions, counts });
});
app.get("/api/admin/analytics/summary", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const user = await data.getUserById(u);
  user.isAdmin = isAdminUser(user);
  if(!permissions.hasPerm(user, permissions.PERMS.ADMIN)){
    return res.status(403).json({ error: "forbidden" });
  }
  const { from, to, range } = rangeToBounds(req.query?.range);
  const listings = await data.getListings();
  const now = Date.now();
  const auctions = listings.filter((l)=> (l.listingType || "item") === "auction" || l.auctionId);
  const auctionsActive = auctions.filter((l)=>{
    const endAt = Date.parse(l.auctionEndAt || "");
    const ended = (String(l.auctionStatus || "").toLowerCase() === "ended") ||
      (Number.isFinite(endAt) && now > endAt);
    return !ended;
  }).length;
  const auctionsEnded = Math.max(0, auctions.length - auctionsActive);
  const buyNowActive = listings.filter((l)=>{
    const listingType = l.listingType || "item";
    const isAuction = listingType === "auction" || l.auctionId;
    if(isAuction) return false;
    return String(l.status || "active").toLowerCase() === "active";
  }).length;

  const places = await data.getPlaces();
  const pendingPlaces = await data.listPlacesByStatus("pending");
  const trustPending = (await data.getTrustApplicationsByStatus("pending")).length;
  const residentPending = (await data.listResidentVerificationRequestsByStatus("pending")).length;
  const businessPending = (await data.listLocalBizApplicationsByStatus("pending")).length;

  const usersTotal = await data.countUsers();
  const usersNew = await data.countUsersSince(from);
  const ordersTotal = await data.countOrders();
  const ordersRange = await data.countOrdersSince(from);
  const revenueTotalCents = await data.sumOrderRevenue();
  const revenueRangeCents = await data.sumOrderRevenueSince(from);

  const liveActive = (await data.listActiveLiveRooms(1)).length;
  const liveScheduled = (await data.listScheduledLiveShows({})).length;

  const sweep = await data.getActiveSweepstake();
  let sweepStatus = "inactive";
  let sweepEntries = 0;
  if(sweep){
    sweepStatus = String(sweep.status || "active");
    const totals = await data.getSweepstakeEntryTotals(sweep.id);
    sweepEntries = Number(totals?.totalEntries || 0);
  }

  res.json({
    range,
    from,
    to,
    users: { total: usersTotal, new: usersNew },
    places: { total: places.length, pending: pendingPlaces.length },
    approvals: { trustPending, residentPending, businessPending },
    listings: { buyNowActive, auctionsActive, auctionsEnded },
    orders: { total: ordersTotal, rangeOrders: ordersRange, totalRevenueCents: revenueTotalCents, rangeRevenueCents: revenueRangeCents },
    live: { activeRooms: liveActive, scheduledShows: liveScheduled },
    sweep: { status: sweepStatus, totalEntries: sweepEntries }
  });
});
app.get("/api/seller/sales/summary", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const placeId = Number(req.query.placeId || 0);
  if(!placeId) return res.status(400).json({error:"placeId required"});
  const place = await data.getPlaceById(placeId);
  if(!place) return res.status(404).json({error:"Place not found"});
  if(Number(place.ownerUserId ?? place.owneruserid)!==Number(u)) return res.status(403).json({error:"Owner only"});
  const range = (req.query.range || "7d").toString();
  const { fromIso, toIso, label } = parseRange(range, req.query.from, req.query.to);
  const summary = await data.getSellerSalesSummary(placeId, fromIso, toIso);
  const revenueCents = Number(summary.totals.revenueCents || 0);
  const orderCount = Number(summary.totals.orderCount || 0);
  const avgOrderValueCents = orderCount ? Math.round(revenueCents / orderCount) : 0;
  res.json({
    placeId,
    range: label,
    totals: { revenueCents, orderCount, avgOrderValueCents },
    topItems: summary.topItems,
    daily: summary.daily,
    recentOrders: summary.recentOrders
  });
});
app.get("/api/seller/sales/export.csv", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const placeId = Number(req.query.placeId || 0);
  if(!placeId) return res.status(400).json({error:"placeId required"});
  const place = await data.getPlaceById(placeId);
  if(!place) return res.status(404).json({error:"Place not found"});
  if(Number(place.ownerUserId ?? place.owneruserid)!==Number(u)) return res.status(403).json({error:"Owner only"});
  const { fromIso, toIso } = parseRange("custom", req.query.from, req.query.to);
  const rows = await data.getSellerSalesExport(placeId, fromIso, toIso);
  const header = "orderId,createdAt,status,totalCents,subtotalCents,serviceGratuityCents,listingId,titleSnapshot,quantity,priceCentsSnapshot";
  const csv = rows.map(r=>[
    r.orderId, r.createdAt, r.status, r.totalCents, r.subtotalCents, r.serviceGratuityCents,
    r.listingId, JSON.stringify(r.titleSnapshot || ""), r.quantity, r.priceCentsSnapshot
  ].join(","));
  res.setHeader("Content-Type","text/csv");
  res.send([header, ...csv].join("\n"));
});
app.post("/api/admin/pulse/generate", async (req, res) =>{
  try{
    const admin=await requireAdminOrDev(req,res); if(!admin) return;
    const dayKey=(req.body?.dayKey || "").toString().trim() || null;
    const pulse=await data.generateDailyPulse(1, dayKey || undefined);
    res.json(pulse);
  }catch(err){
    console.error("PULSE_GENERATE_ERROR", err?.message);
    res.status(500).json({ error: "internal error" });
  }
});
app.post("/api/admin/pulse/cleanup", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const deletedCount = await data.cleanupDailyPulses(1);
  res.json({ ok:true, deletedCount });
});

// Admin CSV Exports
app.get("/api/admin/export/users.csv", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const users = await data.getAllUsers();
  const header = "id,email,displayName,phone,isAdmin,isVerified,trustTier,createdAt,lastLoginAt";
  const csv = users.map(u=>[
    u.id,
    JSON.stringify(u.email || ""),
    JSON.stringify(u.displayName || u.displayname || ""),
    JSON.stringify(u.phone || ""),
    u.isAdmin || u.isadmin || 0,
    u.isVerified || u.isverified || 0,
    u.trustTier || u.trusttier || 0,
    u.createdAt || u.createdat || "",
    u.lastLoginAt || u.lastloginat || ""
  ].join(","));
  res.setHeader("Content-Type","text/csv");
  res.setHeader("Content-Disposition","attachment; filename=users_export.csv");
  res.send([header, ...csv].join("\n"));
});

app.get("/api/admin/export/orders.csv", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const orders = await data.getAllOrders();
  const header = "id,buyerUserId,sellerPlaceId,status,totalCents,subtotalCents,paymentMethod,createdAt,updatedAt";
  const csv = orders.map(o=>[
    o.id,
    o.buyerUserId || o.buyeruserid || "",
    o.sellerPlaceId || o.sellerplaceid || "",
    o.status || "",
    o.totalCents || o.totalcents || 0,
    o.subtotalCents || o.subtotalcents || 0,
    o.paymentMethod || o.paymentmethod || "",
    o.createdAt || o.createdat || "",
    o.updatedAt || o.updatedat || ""
  ].join(","));
  res.setHeader("Content-Type","text/csv");
  res.setHeader("Content-Disposition","attachment; filename=orders_export.csv");
  res.send([header, ...csv].join("\n"));
});

app.get("/api/admin/export/subscriptions.csv", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const subs = await data.getAllSubscriptions();
  const header = "id,placeId,plan,status,trialEndsAt,currentPeriodStart,currentPeriodEnd,canceledAt,createdAt";
  const csv = subs.map(s=>[
    s.id,
    s.placeId || s.placeid || "",
    s.plan || "",
    s.status || "",
    s.trialEndsAt || s.trialendsat || "",
    s.currentPeriodStart || s.currentperiodstart || "",
    s.currentPeriodEnd || s.currentperiodend || "",
    s.canceledAt || s.canceledat || "",
    s.createdAt || s.createdat || ""
  ].join(","));
  res.setHeader("Content-Type","text/csv");
  res.setHeader("Content-Disposition","attachment; filename=subscriptions_export.csv");
  res.send([header, ...csv].join("\n"));
});

app.get("/api/admin/export/places.csv", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const places = await data.getPlaces();
  const header = "id,name,category,ownerUserId,status,sellerType,districtId,createdAt";
  const csv = places.map(p=>[
    p.id,
    JSON.stringify(p.name || ""),
    JSON.stringify(p.category || ""),
    p.ownerUserId || p.owneruserid || "",
    p.status || "",
    p.sellerType || p.sellertype || "",
    p.districtId || p.districtid || "",
    p.createdAt || p.createdat || ""
  ].join(","));
  res.setHeader("Content-Type","text/csv");
  res.setHeader("Content-Disposition","attachment; filename=places_export.csv");
  res.send([header, ...csv].join("\n"));
});

// Support Requests
app.post("/api/support/request", async (req, res) =>{
  const u = await getUserId(req);
  const payload = req.body || {};
  const created = await data.createSupportRequest(u, payload);
  if(created?.error) return res.status(400).json(created);
  res.status(201).json(created);
});

app.get("/api/support/my", async (req, res) =>{
  const u = await requireLogin(req, res); if(!u) return;
  const requests = await data.getSupportRequestsByUser(u);
  res.json(requests);
});

app.get("/api/admin/support", async (req, res) =>{
  const admin = await requireAdmin(req, res); if(!admin) return;
  const requests = await data.getAllSupportRequests();
  res.json(requests);
});

app.patch("/api/admin/support/:id", async (req, res) =>{
  const admin = await requireAdmin(req, res); if(!admin) return;
  const status = (req.body?.status || "").toString().trim();
  const adminNotes = (req.body?.adminNotes || "").toString().trim();
  if(!status) return res.status(400).json({error:"status required"});
  const updated = await data.updateSupportRequestStatus(req.params.id, status, adminNotes);
  if(!updated) return res.status(404).json({error:"Request not found"});
  res.json(updated);
});

app.get("/api/pulse/latest", async (req, res) =>{
  const pulse=await data.getLatestPulse(1);
  if(!pulse) return res.status(404).json({error:"No pulse found"});
  res.json(pulse);
});
app.get("/api/pulse/:dayKey", async (req, res) =>{
  const dayKey=(req.params.dayKey || "").toString().trim();
  if(!dayKey) return res.status(400).json({error:"dayKey required"});
  const pulse=await data.getPulseByDayKey(dayKey, 1);
  if(!pulse) return res.status(404).json({error:"Pulse not found"});
  res.json(pulse);
});
app.get("/api/admin/places", async (req, res) =>{
  res.json([]);
});
app.get("/api/admin/events", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const status=(req.query.status || "pending").toString().trim().toLowerCase();
  res.json(await data.listEventsByStatus(status));
});
app.post("/api/admin/events/:id/approve", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const updated=await data.updateEventDecision(req.params.id, "approved", admin.id, "");
  if(!updated) return res.status(404).json({error:"Not found"});
  res.json(updated);
});
app.post("/api/admin/events/:id/deny", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const reason=(req.body?.decisionReason || "").toString().trim();
  if(!reason) return res.status(400).json({error:"decisionReason required"});
  const updated=await data.updateEventDecision(req.params.id, "denied", admin.id, reason);
  if(!updated) return res.status(404).json({error:"Not found"});
  res.json(updated);
});

app.get("/api/admin/localbiz", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const status=(req.query.status || "pending").toString().trim().toLowerCase();
  res.json(await data.listLocalBizApplicationsByStatus(status));
});
app.post("/api/admin/localbiz/:id/approve", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;

  // Get the application first to access its data
  const bizApp = await data.getLocalBizApplicationById(req.params.id);
  if(!bizApp) return res.status(404).json({error:"Not found"});

  // Update the application status
  const updated=await data.updateLocalBizDecision(req.params.id, "approved", admin.id, "");
  if(!updated) return res.status(404).json({error:"Not found"});

  // If the applicant has a userId, create/approve their store and set tier
  const userId = bizApp.userId ?? bizApp.userid;
  if(userId){
    // Check if they already have a place
    const existingPlaces = await data.listPlacesByOwner(userId);
    if(existingPlaces.length > 0){
      // Approve their first pending place
      const pending = existingPlaces.find(p => (p.status || "").toLowerCase() === "pending");
      if(pending){
        await data.updatePlaceStatus(pending.id, "approved");
        console.log("APPROVED_EXISTING_PLACE", { placeId: pending.id, userId });
      }
    } else {
      // Create an approved place for them using application data
      const newPlace = await data.addPlace({
        townId: 1,
        districtId: 1,
        name: bizApp.businessName || bizApp.businessname,
        category: bizApp.category,
        description: bizApp.description,
        sellerType: "business",
        addressPrivate: `${bizApp.address}, ${bizApp.city}, ${bizApp.state} ${bizApp.zip}`,
        website: bizApp.website || "",
        ownerUserId: userId,
        status: "approved"
      });
      console.log("CREATED_APPROVED_PLACE", { placeId: newPlace?.id, userId });
    }
  }

  res.json(updated);
});
app.post("/api/admin/localbiz/:id/deny", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const reason=(req.body?.reason || "").toString().trim();
  if(!reason) return res.status(400).json({error:"reason required"});
  const updated=await data.updateLocalBizDecision(req.params.id, "denied", admin.id, reason);
  if(!updated) return res.status(404).json({error:"Not found"});
  res.json(updated);
});

app.post("/api/admin/test-email", async (req,res)=>{
  const userId = await getUserId(req);
  const user = userId ? await data.getUserById(userId) : null;
  const isAdmin = isAdminUser(user);
  console.log("TEST_EMAIL_ENDPOINT_HIT", {
    loggedIn: !!userId,
    isAdmin,
    hasPostmarkToken: !!process.env.POSTMARK_SERVER_TOKEN
  });
  if(!userId) return res.status(401).json({ error: "Login required" });
  if(!isAdmin) return res.status(403).json({ error: "Admin access required" });
  console.log("POSTMARK_TEST_SEND", {
    hasToken: !!process.env.POSTMARK_SERVER_TOKEN,
    hasFrom: !!process.env.EMAIL_FROM,
    hasBase: !!process.env.PUBLIC_BASE_URL,
    toCount: (process.env.ADMIN_NOTIFY_EMAILS || "").split(",").length
  });
  let result;
  try{
    result = await sendAdminEmail("[Sebastian Beta] Test Email", "If you received this, Postmark is working.");
  }catch(err){
    result = { ok:false, error: err?.message || String(err) };
  }
  const statusCode = typeof result?.statusCode === "number"
    ? result.statusCode
    : (result?.ok ? 200 : 500);
  console.log("POSTMARK_TEST_RESULT", statusCode);
  if(!result?.ok){
    console.warn("POSTMARK_TEST_ERROR", result?.error || "Unknown error");
  }
  res.json({ ok:true });
});

app.get("/api/admin/waitlist", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const status=(req.query.status || "pending").toString().trim().toLowerCase();
  res.json(await data.listWaitlistSignupsByStatus(status));
});
app.post("/api/admin/waitlist/:id/status", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const status=(req.body?.status || "").toString().trim().toLowerCase();
  const approvedTier = req.body?.approvedTier != null ? Number(req.body.approvedTier) : null;
  if(status !== "approved" && status !== "rejected" && status !== "pending"){
    return res.status(400).json({error:"status must be approved, rejected, or pending"});
  }
  const updated = await data.updateWaitlistStatus(req.params.id, status, status === "approved" ? approvedTier : null);
  if(!updated) return res.status(404).json({error:"Not found"});
  // Set trust tier if user exists, send approval notification
  if(status === "approved" && updated.email && approvedTier){
    const user = await data.getUserByEmail(updated.email);
    if(user){
      await data.setUserTrustTier(1, user.id, approvedTier);
      // Copy terms acceptance from application to user
      if(updated.termsAcceptedAt || updated.termsacceptedat){
        await data.setUserTermsAcceptedAt(user.id, updated.termsAcceptedAt || updated.termsacceptedat);
      }
    }
    const tierName = trust.TRUST_TIER_LABELS[approvedTier] || `Tier ${approvedTier}`;
    sendApprovalEmail(updated.email, "Waitlist", tierName).catch(err => {
      console.error("Failed to send waitlist approval email:", err);
    });
  }
  res.json(updated);
});

app.get("/api/admin/applications/business", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const status=(req.query.status || "pending").toString().trim().toLowerCase();
  res.json(await data.listBusinessApplicationsByStatus(status));
});
app.post("/api/admin/applications/business/:id/status", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const status=(req.body?.status || "").toString().trim().toLowerCase();
  const approvedTier = req.body?.approvedTier != null ? Number(req.body.approvedTier) : null;
  if(status !== "approved" && status !== "rejected" && status !== "pending"){
    return res.status(400).json({error:"status must be approved, rejected, or pending"});
  }
  const updated = await data.updateBusinessApplicationStatus(req.params.id, status, status === "approved" ? approvedTier : null);
  if(!updated) return res.status(404).json({error:"Not found"});
  console.log("BUSINESS_APP_STATUS_UPDATE", { id: req.params.id, status, email: updated.email, approvedTier });
  // Set trust tier if user exists, send approval notification, create store
  if(status === "approved" && updated.email){
    const user = await data.getUserByEmail(updated.email);
    console.log("BUSINESS_APP_USER_LOOKUP", { email: updated.email, userFound: !!user, userId: user?.id });
    if(user){
      if(approvedTier){
        await data.setUserTrustTier(1, user.id, approvedTier);
      }
      // Copy terms acceptance from application to user
      if(updated.termsAcceptedAt || updated.termsacceptedat){
        await data.setUserTermsAcceptedAt(user.id, updated.termsAcceptedAt || updated.termsacceptedat);
      }
      // Create/approve store for user
      const existingPlaces = await data.listPlacesByOwner(user.id);
      console.log("BUSINESS_APP_EXISTING_PLACES", { userId: user.id, count: existingPlaces.length, places: existingPlaces.map(p=>({id:p.id,status:p.status})) });
      if(existingPlaces.length > 0){
        const pending = existingPlaces.find(p => (p.status || "").toLowerCase() === "pending");
        if(pending){
          await data.updatePlaceStatus(pending.id, "approved");
          console.log("APPROVED_EXISTING_PLACE", { placeId: pending.id, userId: user.id });
        } else {
          console.log("BUSINESS_APP_NO_PENDING_PLACE", { userId: user.id });
        }
      } else {
        const placeName = updated.businessName || updated.businessname || "Business";
        const placeCategory = updated.category || "Business";
        console.log("CREATING_PLACE", { placeName, placeCategory, userId: user.id });
        const newPlace = await data.addPlace({
          townId: 1,
          districtId: 1,
          name: placeName,
          category: placeCategory,
          description: updated.notes || "",
          sellerType: "business",
          addressPrivate: updated.address || "",
          website: updated.website || "",
          ownerUserId: user.id,
          status: "approved"
        });
        if(newPlace?.error){
          console.log("PLACE_CREATION_ERROR", { error: newPlace.error, userId: user.id });
        } else {
          console.log("CREATED_APPROVED_PLACE", { placeId: newPlace?.id, userId: user.id });
        }
      }
    } else {
      console.log("BUSINESS_APP_NO_USER_FOUND", { email: updated.email });
    }
    if(approvedTier){
      const tierName = trust.TRUST_TIER_LABELS[approvedTier] || `Tier ${approvedTier}`;
      sendApprovalEmail(updated.email, "Business", tierName).catch(err => {
        console.error("Failed to send business approval email:", err);
      });
    }
  }
  res.json(updated);
});

app.get("/api/admin/applications/resident", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const status=(req.query.status || "pending").toString().trim().toLowerCase();
  res.json(await data.listResidentApplicationsByStatus(status));
});
app.post("/api/admin/applications/resident/:id/status", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const status=(req.body?.status || "").toString().trim().toLowerCase();
  const approvedTier = req.body?.approvedTier != null ? Number(req.body.approvedTier) : null;
  if(status !== "approved" && status !== "rejected" && status !== "pending"){
    return res.status(400).json({error:"status must be approved, rejected, or pending"});
  }
  const updated = await data.updateResidentApplicationStatus(req.params.id, status, status === "approved" ? approvedTier : null);
  if(!updated) return res.status(404).json({error:"Not found"});
  if(status === "approved" && updated.email && approvedTier){
    // Set trust tier if user exists
    const user = await data.getUserByEmail(updated.email);
    if(user){
      if(approvedTier >= trust.LEVELS.VERIFIED_RESIDENT){
        await data.setUserResidentVerified(user.id, true);
      }
      await data.setUserTrustTier(1, user.id, approvedTier);
      // Copy terms acceptance from application to user
      if(updated.termsAcceptedAt || updated.termsacceptedat){
        await data.setUserTermsAcceptedAt(user.id, updated.termsAcceptedAt || updated.termsacceptedat);
      }
    }
    // Send approval notification
    const tierName = trust.TRUST_TIER_LABELS[approvedTier] || `Tier ${approvedTier}`;
    sendApprovalEmail(updated.email, "Resident", tierName).catch(err => {
      console.error("Failed to send resident approval email:", err);
    });
  }
  res.json(updated);
});

app.get("/api/admin/prizes", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const status=(req.query.status || "pending").toString().trim().toLowerCase();
  res.json(await data.listPrizeOffersByStatus(status));
});
app.post("/api/admin/prizes/:id/approve", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const updated=await data.updatePrizeOfferDecision(req.params.id, "approved", admin.id, "");
  if(!updated) return res.status(404).json({error:"Not found"});
  res.json(updated);
});
app.post("/api/admin/prizes/:id/reject", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const reason=(req.body?.reason || "").toString().trim();
  if(!reason) return res.status(400).json({error:"reason required"});
  const updated=await data.updatePrizeOfferDecision(req.params.id, "rejected", admin.id, reason);
  if(!updated) return res.status(404).json({error:"Not found"});
  res.json(updated);
});
app.post("/api/admin/prizes/:id/award", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const winnerUserId = Number(req.body?.winnerUserId);
  if(!winnerUserId) return res.status(400).json({error:"winnerUserId required"});
  const offer = await data.getPrizeOfferById(req.params.id);
  if(!offer) return res.status(404).json({error:"Not found"});
  const convo = await data.addDirectConversation(offer.donorUserId, winnerUserId);
  const dueBy = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const award = await data.addPrizeAward({
    prizeOfferId: offer.id,
    winnerUserId,
    donorUserId: offer.donorUserId,
    donorPlaceId: offer.donorPlaceId,
    status: "notified",
    dueBy,
    convoId: convo.id,
    proofUrl: ""
  });
  await data.updatePrizeOfferDecision(offer.id, "awarded", admin.id, "");
  res.json({ ok:true, award });
});

app.get("/api/admin/media", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const townId = Number(req.query.townId || 1);
  const kind = (req.query.kind || "").toString().trim();
  const limit = Number(req.query.limit || 200);
  res.json(await data.listMediaObjects({ townId, kind, limit: Number.isFinite(limit) ? limit : 200 }));
});
app.get("/api/admin/media/orphans", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const townId = Number(req.query.townId || 1);
  const limit = Number(req.query.limit || 200);
  const orphans = await data.listMediaOrphans(townId, Number.isFinite(limit) ? limit : 200);
  const missingLocal = await data.listMissingLocalMedia(townId, Number.isFinite(limit) ? limit : 200);
  res.json({ orphans, missingLocal });
});
app.get("/api/admin/trust/reviews", async (req, res) =>{
  const reviews = await data.listReviews(200);
  const rows = await Promise.all(reviews.map(async (r)=>{
    const reviewer = await getTrustBadgeForUser(r.reviewerUserId || r.revieweruserid);
    const reviewee = await getTrustBadgeForUser(r.revieweeUserId || r.revieweeuserid);
    return {
      ...r,
      reviewerTrustTierLabel: reviewer?.trustTierLabel || null,
      revieweeTrustTierLabel: reviewee?.trustTierLabel || null
    };
  }));
  res.json(rows);
});
app.get("/api/admin/trust/disputes", async (req, res) =>{
  const disputes = await data.listDisputes(200);
  const rows = await Promise.all(disputes.map(async (d)=>{
    const reporter = await getTrustBadgeForUser(d.reporterUserId || d.reporteruserid);
    return { ...d, reporterTrustTierLabel: reporter?.trustTierLabel || null };
  }));
  res.json(rows);
});
app.get("/api/admin/stores", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const status = (req.query.status || "").toString().trim();
  res.json(await data.listPlacesByStatus(status));
});
app.patch("/api/admin/stores/:id", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const status = (req.body?.status || "").toString().trim().toLowerCase();
  if(!["pending","approved","rejected"].includes(status)) return res.status(400).json({error:"Invalid status"});
  const updated = await data.updatePlaceStatus(req.params.id, status);
  if(!updated) return res.status(404).json({error:"not found"});
  res.json(updated);
});

// Sweep
app.get("/sweep/balance", async (req, res) =>{
  const u=await getUserId(req);
  if(!u) return res.json({loggedIn:false,balance:0});
  res.json({loggedIn:true,balance:await data.getSweepBalance(u)});
});
app.get("/sweepstake/active", async (req, res) =>{
  return res.json(await getSweepstakeActivePayload(req));
});
app.get("/api/sweepstake/active", async (req, res) =>{
  return res.json(await getSweepstakeActivePayload(req));
});
app.get("/sweep/claim/:drawId", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const draw = await data.getSweepDrawById(req.params.drawId);
  if(!draw) return res.status(404).send("Draw not found");
  if(Number(draw.winnerUserId) !== Number(u)){
    return res.status(403).send("Forbidden");
  }
  res.sendFile(path.join(__dirname,"public","sweep_claim.html"));
});
app.get("/api/sweep/claim/:drawId", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const draw = await data.getSweepDrawById(req.params.drawId);
  if(!draw) return res.status(404).json({error:"Draw not found"});
  if(Number(draw.winnerUserId) !== Number(u)){
    return res.status(403).json({error:"Forbidden"});
  }
  const { sweep, prize } = await getSweepDrawContext(draw);
  res.json({
    ok:true,
    drawId: draw.id,
    sweepId: draw.sweepId,
    prize,
    donorName: prize?.donorName || "",
    status: (draw.claimedAt || "").toString().trim() ? "claimed" : "pending",
    claimedAt: draw.claimedAt || "",
    claimedMessage: draw.claimedMessage || "",
    claimedPhotoUrl: draw.claimedPhotoUrl || "",
    sweepTitle: sweep?.title || "",
    sweepPrize: sweep?.prize || ""
  });
});
app.post("/sweepstake/enter", async (req, res) =>{
  const u = await requireUserSubscription(req,res); if(!u) return;
  const user = await data.getUserById(u);
  const isSweepTestMode = process.env.SWEEP_TEST_MODE === "true" && isAdminUser(user);
  const sweepId = Number(req.body?.sweepstakeId);
  const entries = Number(req.body?.entries);
  if(!Number.isFinite(entries) || entries <= 0) return res.status(400).json({error:"entries must be > 0"});
  const sweep = await data.getSweepstakeById(sweepId);
  if(!sweep) return res.status(404).json({error:"Sweepstake not found"});
  if(String(sweep.status) !== "active") return res.status(400).json({error:"Sweepstake not active"});
  const now = Date.now();
  const startAt = Date.parse(sweep.startAt || "");
  const endAt = Date.parse(sweep.endAt || "");
  if(Number.isFinite(startAt) && now < startAt) return res.status(400).json({error:"Sweepstake not started"});
  if(Number.isFinite(endAt) && now > endAt) return res.status(400).json({error:"Sweepstake ended"});
  const cost = Number(sweep.entryCost || 1) * entries;
  const balance = await data.getSweepBalance(u);
  if(!isSweepTestMode){
    if(balance < cost) return res.status(400).json({error:"Insufficient sweep balance"});
    await data.addSweepLedgerEntry({ userId: u, amount: -cost, reason: "sweepstake_entry", meta: { sweepstakeId: sweep.id, entries } });
  }
  await data.addSweepstakeEntry(sweep.id, u, entries);
  const totals = await data.getSweepstakeEntryTotals(sweep.id);
  const userEntries = await data.getUserEntriesForSweepstake(sweep.id, u);
  const nextBalance = isSweepTestMode ? balance : balance - cost;
  res.json({ ok:true, balance: nextBalance, totals, userEntries });
});
app.post("/api/sweep/claim/:drawId", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const draw = await data.getSweepDrawById(req.params.drawId);
  if(!draw) return res.status(404).json({error:"Draw not found"});
  if(Number(draw.winnerUserId) !== Number(u)){
    return res.status(403).json({error:"Forbidden"});
  }
  if((draw.claimedAt || "").toString().trim()){
    return res.json({
      ok:true,
      drawId: draw.id,
      claimedAt: draw.claimedAt || "",
      claimedMessage: draw.claimedMessage || "",
      claimedPhotoUrl: draw.claimedPhotoUrl || "",
      claimedPostedMessageId: draw.claimedPostedMessageId || null
    });
  }
  const messageToDonor = (req.body?.messageToDonor || "").toString().trim();
  const photoUrl = (req.body?.photoUrl || "").toString().trim();
  const claimed = await data.setSweepClaimed(draw.id, {
    claimedByUserId: u,
    claimedMessage: messageToDonor,
    claimedPhotoUrl: photoUrl
  });
  const { sweep, prize } = await getSweepDrawContext(draw);
  const prizeTitle = (prize?.title || sweep?.prize || sweep?.title || "Prize").toString().trim();
  const donorUserId = await resolveSweepDonorUserId(prize);
  const donorName = await resolveSweepDonorName(prize, donorUserId) || "Donor";
  const winnerUser = await data.getUserById(u);
  const winnerName = winnerUser ? await data.getDisplayNameForUser(winnerUser) : "Winner";
  const systemSenderId = draw.createdByUserId || u;
  const claimLines = [`[SYSTEM] ✅ Prize claimed: ${winnerName} confirmed receipt of ${prizeTitle}.`];
  if(messageToDonor) claimLines.push(`Message: ${messageToDonor}`);
  if(photoUrl) claimLines.push(`Photo: ${photoUrl}`);
  const claimText = claimLines.join("\n");
  try{
    if(donorUserId && Number(donorUserId) !== Number(u)){
      const convo = await data.addDirectConversation(u, donorUserId);
      if(convo?.id) await data.addDirectMessage(convo.id, systemSenderId, claimText);
    }else if(draw.createdByUserId && Number(draw.createdByUserId) !== Number(u)){
      const convo = await data.addDirectConversation(u, draw.createdByUserId);
      if(convo?.id) await data.addDirectMessage(convo.id, systemSenderId, claimText);
    }
  }catch(err){
    console.warn("Sweep claim DM failed", err?.message || err);
  }

  try{
    if(!claimed?.claimedPostedMessageId){
      let channelId = Number(process.env.SWEETSTAKE_ANNOUNCE_CHANNEL_ID || 0);
      if(!channelId){
        const chans = await data.getChannels();
        channelId = chans[0]?.id ? Number(chans[0].id) : 0;
      }
      if(channelId){
        const announceText = `🎉 Prize Claimed! ${winnerName} received: ${prizeTitle} (Donor: ${donorName}).`;
        const msg = await data.addChannelMessage(channelId, systemSenderId, announceText, photoUrl || "");
        if(msg?.id) await data.setSweepClaimPostedMessageId(draw.id, msg.id);
      }else{
        console.warn("Sweep claim announce channel missing");
      }
    }
  }catch(err){
    console.warn("Sweep claim announce failed", err?.message || err);
  }

  return res.json({
    ok:true,
    drawId: draw.id,
    claimedAt: claimed?.claimedAt || "",
    claimedMessage: claimed?.claimedMessage || "",
    claimedPhotoUrl: claimed?.claimedPhotoUrl || "",
    claimedPostedMessageId: claimed?.claimedPostedMessageId || null
  });
});
app.post("/api/admin/sweep/draw", async (req, res) =>{
  const admin = await requireAdmin(req,res,{ message: "Admin access required" }); if(!admin) return;
  const sweep = await data.getActiveSweepstake();
  if(!sweep) return res.status(400).json({ error: "No active sweepstake" });
  const existing = await data.getSweepDrawBySweepId(sweep.id);
  if(existing){
    let snapshot = {};
    try{ snapshot = JSON.parse(existing.snapshotJson || "{}"); }catch(_){}
    const participants = Array.isArray(snapshot.participants) ? snapshot.participants : await buildSweepParticipants(sweep.id);
    const winner = snapshot.winner || participants.find(p=>Number(p.userId)===Number(existing.winnerUserId)) || null;
    const prize = await getSweepPrizeInfo(sweep, snapshot.prize);
    return res.json({
      ok:true,
      drawId: existing.id,
      sweepId: sweep.id,
      totalEntries: Number(existing.totalEntries || 0),
      participants,
      winner,
      prize,
      createdAt: existing.createdAt || "",
      claimedAt: existing.claimedAt || ""
    });
  }
  const participants = await buildSweepParticipants(sweep.id);
  const totalEntries = participants.reduce((sum,p)=>sum + Number(p.entries || 0), 0);
  if(totalEntries <= 0) return res.status(400).json({ error: "No entries to draw" });
  const r = crypto.randomInt(totalEntries);
  let acc = 0;
  let winner = null;
  for(const p of participants){
    acc += Number(p.entries || 0);
    if(r < acc){ winner = p; break; }
  }
  if(!winner) return res.status(500).json({ error: "Failed to select winner" });
  const prize = await getSweepPrizeInfo(sweep);
  const snapshot = { participants, winner, totalEntries, prize };
  const draw = await data.createSweepDraw({
    sweepId: sweep.id,
    createdByUserId: admin.id,
    winnerUserId: winner.userId,
    totalEntries,
    snapshot
  });
  await data.setSweepstakeWinner(sweep.id, winner.userId);
  await notifySweepDrawUsers({ draw, sweep, winner, prize, adminId: admin.id });
  return res.json({
    ok:true,
    drawId: draw?.id || null,
    sweepId: sweep.id,
    totalEntries,
    participants,
    winner,
    prize,
    createdAt: draw?.createdAt || "",
    claimedAt: draw?.claimedAt || ""
  });
});
app.post("/api/admin/sweep/grant_test_balance", async (req, res) =>{
  const admin = await requireAdmin(req,res,{ message: "Admin access required" }); if(!admin) return;
  if(process.env.SWEEP_TEST_MODE !== "true") return res.status(403).json({error:"Sweep test mode disabled"});
  await data.addSweepLedgerEntry({ userId: admin.id, amount: 999999, reason: "sweep_test_grant", meta: { mode: "test" } });
  res.json({ ok:true, balance: await data.getSweepBalance(admin.id) });
});
app.get("/api/admin/sweep/last", async (req, res) =>{
  const admin = await requireAdmin(req,res,{ message: "Admin access required" }); if(!admin) return;
  const existing = await data.getLatestSweepDraw();
  if(!existing) return res.status(404).json({ error: "No draw yet" });
  let snapshot = {};
  try{ snapshot = JSON.parse(existing.snapshotJson || "{}"); }catch(_){}
  const participants = Array.isArray(snapshot.participants) ? snapshot.participants : await buildSweepParticipants(existing.sweepId);
  const winner = snapshot.winner || participants.find(p=>Number(p.userId)===Number(existing.winnerUserId)) || null;
  const sweep = await data.getSweepstakeById(existing.sweepId);
  const prize = await getSweepPrizeInfo(sweep, snapshot.prize);
  return res.json({
    ok:true,
    drawId: existing.id,
    sweepId: Number(existing.sweepId),
    totalEntries: Number(existing.totalEntries || 0),
    participants,
    winner,
    prize,
    createdAt: existing.createdAt || "",
    claimedAt: existing.claimedAt || ""
  });
});
app.get("/api/admin/sweep/rules", async (req, res) =>{
  const admin = await requireAdmin(req,res,{ message: "Admin access required" }); if(!admin) return;
  const rows = await data.listSweepRules(1);
  res.json(rows.map(r=>({
    id: r.id,
    matchEventType: r.ruleType || "",
    enabled: !!r.enabled,
    amount: Number(r.amount || 0),
    buyerAmount: Number(r.buyerAmount || 0),
    sellerAmount: Number(r.sellerAmount || 0),
    dailyCap: Number(r.dailyCap || 0),
    cooldownSeconds: Number(r.cooldownSeconds || 0),
    meta: r.meta || {}
  })));
});
app.post("/api/admin/sweep/rules", async (req, res) =>{
  const admin = await requireAdmin(req,res,{ message: "Admin access required" }); if(!admin) return;
  const created = await data.createSweepRule(1, req.body || {});
  if(created?.error) return res.status(400).json({ error: created.error });
  res.status(201).json({
    id: created.id,
    matchEventType: created.rule_type || created.ruleType || "",
    enabled: created.enabled === true || Number(created.enabled) === 1,
    amount: Number(created.amount || 0),
    buyerAmount: Number(created.buyer_amount || created.buyerAmount || 0),
    sellerAmount: Number(created.seller_amount || created.sellerAmount || 0),
    dailyCap: Number(created.daily_cap || created.dailyCap || 0),
    cooldownSeconds: Number(created.cooldown_seconds || created.cooldownSeconds || 0),
    meta: created.meta_json || created.meta || {}
  });
});
app.patch("/api/admin/sweep/rules/:id", async (req, res) =>{
  const admin = await requireAdmin(req,res,{ message: "Admin access required" }); if(!admin) return;
  const updated = await data.updateSweepRule(1, req.params.id, req.body || {});
  if(!updated) return res.status(404).json({error:"Rule not found"});
  res.json({
    id: updated.id,
    matchEventType: updated.rule_type || updated.ruleType || "",
    enabled: updated.enabled === true || Number(updated.enabled) === 1,
    amount: Number(updated.amount || 0),
    buyerAmount: Number(updated.buyer_amount || updated.buyerAmount || 0),
    sellerAmount: Number(updated.seller_amount || updated.sellerAmount || 0),
    dailyCap: Number(updated.daily_cap || updated.dailyCap || 0),
    cooldownSeconds: Number(updated.cooldown_seconds || updated.cooldownSeconds || 0),
    meta: updated.meta_json || updated.meta || {}
  });
});
app.delete("/api/admin/sweep/rules/:id", async (req, res) =>{
  const admin = await requireAdmin(req,res,{ message: "Admin access required" }); if(!admin) return;
  const ok = await data.deleteSweepRule(1, req.params.id);
  if(!ok) return res.status(404).json({error:"Rule not found"});
  res.json({ ok:true });
});
app.post("/api/admin/sweep/sweepstake", async (req, res) =>{
  const created = await data.createSweepstake({
    status: (req.body?.status || "").toString(),
    title: (req.body?.title || "").toString(),
    prize: (req.body?.prize || "").toString(),
    entryCost: Number(req.body?.entryCost) || 1,
    maxEntriesPerUserPerDay: Number(req.body?.maxEntriesPerUserPerDay) || 1,
    startAt: (req.body?.startAt || "").toString(),
    endAt: (req.body?.endAt || "").toString(),
    drawAt: (req.body?.drawAt || "").toString(),
  });
  if(created?.error) return res.status(400).json(created);
  res.status(201).json(created);
});

// Districts
app.get("/districts/:id/places", async (req, res) =>{
  const did=Number(req.params.id);
  // PostgreSQL returns lowercase column names
  const places = (await data.getPlaces()).filter(p=>Number(p.districtId || p.districtid)===did);
  res.json(places);
});

app.get("/market/listings", async (req, res) =>{
  const access = await requirePerm(req,res,"VIEW_MARKET"); if(!access) return;
  const townId = Number(req.query.townId || 1);
  const places = await data.getPlaces();
  const placeById = new Map(places.map(p=>[Number(p.id), p]));
  const out = [];
  const listings = await data.getListings();
  for(const l of listings){
    const placeId = Number(l.placeId ?? l.placeid);
    const p = placeById.get(placeId);
    if(!p) continue;
    if(townId && Number(p.townId ?? p.townid)!==Number(townId)) continue;
    const listingType = l.listingType ?? l.listingtype ?? "item";
    const auctionStartAt = l.auctionStartAt ?? l.auctionstartat;
    const auctionEndAt = l.auctionEndAt ?? l.auctionendat;
    const startBidCents = l.startBidCents ?? l.startbidcents ?? 0;
    const minIncrementCents = l.minIncrementCents ?? l.minincrementcents ?? 0;
    const reserveCents = l.reserveCents ?? l.reservecents ?? 0;
    const auctionId = l.auctionId ?? l.auctionid;
    const hasAuctionFields = !!(auctionStartAt || auctionEndAt || Number(startBidCents || 0) || Number(minIncrementCents || 0) || Number(reserveCents || 0));
    const hasAuctionId = !!auctionId;
    if(listingType === "auction" || hasAuctionFields || hasAuctionId) continue;
    const joined = {
      id: l.id,
      placeId,
      title: l.title,
      description: l.description,
      price: l.price,
      listingType,
      auctionEndAt: auctionEndAt || "",
      startBidCents: startBidCents || 0,
      placeName: p.name || "Store",
      placeCategory: p.category || "",
      districtId: p.districtId ?? p.districtid,
      photoUrls: l.photoUrls || l.photourls || []
    };
    if(listingType === "auction"){
      const summary = await data.getAuctionSummary(l.id);
      joined.highestBidCents = summary.highestBidCents || 0;
    }
    out.push(joined);
  }
  res.json(out);
});
app.get("/api/market/listings", async (req, res) =>{
  const access = await requirePerm(req,res,"VIEW_MARKET"); if(!access) return;
  const townId = Number(req.query.townId || 1);
  const places = await data.getPlaces();
  const placeById = new Map(places.map(p=>[Number(p.id), p]));
  const out = [];
  const listings = await data.getListings();
  for(const l of listings){
    const placeId = Number(l.placeId ?? l.placeid);
    const p = placeById.get(placeId);
    if(!p) continue;
    if(townId && Number(p.townId ?? p.townid)!==Number(townId)) continue;
    const listingType = l.listingType ?? l.listingtype ?? "item";
    const auctionStartAt = l.auctionStartAt ?? l.auctionstartat;
    const auctionEndAt = l.auctionEndAt ?? l.auctionendat;
    const startBidCents = l.startBidCents ?? l.startbidcents ?? 0;
    const minIncrementCents = l.minIncrementCents ?? l.minincrementcents ?? 0;
    const reserveCents = l.reserveCents ?? l.reservecents ?? 0;
    const auctionId = l.auctionId ?? l.auctionid;
    const hasAuctionFields = !!(auctionStartAt || auctionEndAt || Number(startBidCents || 0) || Number(minIncrementCents || 0) || Number(reserveCents || 0));
    const hasAuctionId = !!auctionId;
    if(listingType === "auction" || hasAuctionFields || hasAuctionId) continue;
    const joined = {
      id: l.id,
      placeId,
      title: l.title,
      description: l.description,
      price: l.price,
      listingType,
      auctionEndAt: auctionEndAt || "",
      startBidCents: startBidCents || 0,
      placeName: p.name || "Store",
      placeCategory: p.category || "",
      districtId: p.districtId ?? p.districtid,
      photoUrls: l.photoUrls || l.photourls || []
    };
    if(listingType === "auction"){
      const summary = await data.getAuctionSummary(l.id);
      joined.highestBidCents = summary.highestBidCents || 0;
    }
    out.push(joined);
  }
  res.json(out);
});

app.get("/market/auctions", async (req, res) =>{
  const access = await requirePerm(req,res,"VIEW_AUCTIONS"); if(!access) return;
  const townId = Number(req.query.townId || 1);
  const places = await data.getPlaces();
  const placeById = new Map(places.map(p=>[Number(p.id), p]));
  const out = [];
  const listings = await data.getListings();
  for(const l of listings){
    const p = placeById.get(Number(l.placeId));
    if(!p) continue;
    if(townId && Number(p.townId)!==Number(townId)) continue;
    const listingType = l.listingType || "item";
    const hasAuctionId = !!l.auctionId;
    if(listingType !== "auction" && !hasAuctionId) continue;
    const joined = {
      id: l.id,
      placeId: l.placeId,
      title: l.title,
      description: l.description,
      price: l.price,
      listingType: l.listingType || "item",
      auctionEndAt: l.auctionEndAt || "",
      startBidCents: l.startBidCents || 0,
      placeName: p.name || "Store",
      placeCategory: p.category || "",
      districtId: p.districtId,
      photoUrls: l.photoUrls || l.photourls || []
    };
    const summary = await data.getAuctionSummary(l.id);
    joined.highestBidCents = summary.highestBidCents || 0;
    out.push(joined);
  }
  res.json(out);
});
app.get("/api/auctions/active", async (req, res) =>{
  const access = await requirePerm(req,res,"VIEW_AUCTIONS"); if(!access) return;
  const townId = Number(req.query.townId || 1);
  const places = await data.getPlaces();
  const placeById = new Map(places.map(p=>[Number(p.id), p]));
  const out = [];
  const listings = await data.getListings();
  const now = Date.now();
  for(const l of listings){
    const p = placeById.get(Number(l.placeId));
    if(!p) continue;
    if(townId && Number(p.townId)!==Number(townId)) continue;
    const listingType = l.listingType || "item";
    const hasAuctionId = !!l.auctionId;
    if(listingType !== "auction" && !hasAuctionId) continue;
    const endAt = Date.parse(l.auctionEndAt || "");
    const ended = (String(l.auctionStatus || "").toLowerCase() === "ended") ||
      (Number.isFinite(endAt) && now > endAt);
    if(ended) continue;
    const joined = {
      id: l.id,
      placeId: l.placeId,
      title: l.title,
      description: l.description,
      price: l.price,
      listingType: l.listingType || "item",
      auctionEndAt: l.auctionEndAt || "",
      startBidCents: l.startBidCents || 0,
      placeName: p.name || "Store",
      placeCategory: p.category || "",
      districtId: p.districtId
    };
    const summary = await data.getAuctionSummary(l.id);
    joined.highestBidCents = summary.highestBidCents || 0;
    out.push(joined);
  }
  res.json(out);
});
app.get("/api/auctions/ended", async (req, res) =>{
  const access = await requirePerm(req,res,"VIEW_AUCTIONS"); if(!access) return;
  const townId = Number(req.query.townId || 1);
  const places = await data.getPlaces();
  const placeById = new Map(places.map(p=>[Number(p.id), p]));
  const out = [];
  const listings = await data.getListings();
  const now = Date.now();
  for(const l of listings){
    const p = placeById.get(Number(l.placeId));
    if(!p) continue;
    if(townId && Number(p.townId)!==Number(townId)) continue;
    const listingType = l.listingType || "item";
    const hasAuctionId = !!l.auctionId;
    if(listingType !== "auction" && !hasAuctionId) continue;
    const endAt = Date.parse(l.auctionEndAt || "");
    const ended = (String(l.auctionStatus || "").toLowerCase() === "ended") ||
      (Number.isFinite(endAt) && now > endAt);
    if(!ended) continue;
    const joined = {
      id: l.id,
      placeId: l.placeId,
      title: l.title,
      description: l.description,
      price: l.price,
      listingType: l.listingType || "item",
      auctionEndAt: l.auctionEndAt || "",
      startBidCents: l.startBidCents || 0,
      placeName: p.name || "Store",
      placeCategory: p.category || "",
      districtId: p.districtId
    };
    const summary = await data.getAuctionSummary(l.id);
    joined.highestBidCents = summary.highestBidCents || 0;
    out.push(joined);
  }
  res.json(out);
});

// Channels
app.get("/channels", async (req, res) =>{
  const access = await requirePerm(req,res,"VIEW_CHANNELS"); if(!access) return;
  const u=access.userId;
  const channels=await data.getChannels();
  if(!u) return res.json(channels.filter(c=>Number(c.isPublic)===1));
  res.json(channels);
});
app.get("/channels/:id/messages", async (req, res) =>{
  const access = await requirePerm(req,res,"VIEW_CHANNELS"); if(!access) return;
  const channel=await data.getChannelById(req.params.id);
  if(!channel) return res.status(404).json({error:"Channel not found"});
  const messages = await data.getChannelMessages(channel.id, 200);
  const msgs = await Promise.all(messages.map(async (m)=>({
    ...m,
    userId: m.userId || m.userid,
    channelId: m.channelId || m.channelid,
    createdAt: m.createdAt || m.createdat,
    replyToId: m.replyToId || m.replytoid,
    threadId: m.threadId || m.threadid,
    imageUrl: m.imageUrl || m.imageurl,
    user: await getTrustBadgeForUser(m.userId || m.userid)
  })));
  res.json(msgs);
});
app.post("/channels/:id/messages", async (req, res) =>{
  const access = await requirePerm(req,res,"COMMENT_CHANNELS"); if(!access) return;
  const u=access.userId;
  const ctx=access.ctx;
  const user=access.user;
  const gate = trust.can(user, ctx, "chat_text");
  if(!gate.ok) return res.status(403).json({error:"Chat requires verified access"});
  const channel=await data.getChannelById(req.params.id);
  if(!channel) return res.status(404).json({error:"Channel not found"});
  if(await data.isUserMutedInChannel(channel.id, u)) return res.status(403).json({error:"Muted"});
  const text=(req.body?.text||"").toString().trim();
  const imageUrl=(req.body?.imageUrl||"").toString().trim();
  if(!text && !imageUrl) return res.status(400).json({error:"text or imageUrl required"});
  if(imageUrl){
    if(/^file:\/\//i.test(imageUrl)) return res.status(400).json({error:"Invalid imageUrl"});
    const isAllowed = imageUrl.startsWith("https://") || imageUrl.startsWith("/uploads/");
    if(!isAllowed) return res.status(400).json({error:"Invalid imageUrl"});
    const imageGate = trust.can(user, ctx, "chat_image");
    if(!imageGate.ok) return res.status(403).json({error:"Chat images require tier 1+"});
  }
  const tier = trust.resolveTier(user, ctx);
  if(tier < 2) return res.status(403).json({error:"Posting requires tier 2+"});
  const canPost = tier >= 2;
  const canCreateThread = tier >= 2;
  const replyToId=req.body?.replyToId ? Number(req.body.replyToId) : null;
  let threadId=null;
  if(replyToId){
    if(!canPost) return res.status(403).json({error:"Posting requires tier 2+"});
    const parent=await data.getChannelMessageById(replyToId);
    if(!parent || Number(parent.channelId)!==Number(channel.id)) return res.status(400).json({error:"Invalid replyToId"});
    threadId=parent.threadId;
  }else{
    if(!canCreateThread) return res.status(403).json({error:"Thread creation requires tier 2+"});
    threadId=await data.createChannelThread(channel.id, u);
  }
  const created=await data.addChannelMessage(channel.id, u, text, imageUrl, replyToId, threadId);
  try{
    const ruleType = imageUrl ? "channel_photo" : "channel_post";
    const eventKey = imageUrl ? `msgimg:${created.id}` : `msg:${created.id}`;
    await data.tryAwardSweepForEvent({
      townId: 1,
      userId: u,
      ruleType,
      eventKey,
      meta: { channelId: channel.id }
    });
  }catch(err){
    console.error("SWEEP_AWARD_CHANNEL_ERROR", err?.message);
  }
  res.status(201).json({ok:true, id: created.id, threadId});
});
app.delete("/channels/:channelId/messages/:messageId", async (req, res) =>{
  const u = await requireLogin(req, res); if(!u) return;
  const message = await data.getChannelMessageById(req.params.messageId);
  if(!message) return res.status(404).json({error:"Message not found"});
  const msgUserId = message.userId || message.userid;
  const isOwner = Number(msgUserId) === Number(u);
  const user = await data.getUserById(u);
  const isAdmin = isAdminUser(user);
  if(!isOwner && !isAdmin) return res.status(403).json({error:"Not authorized to delete this message"});
  await data.deleteChannelMessage(req.params.messageId);
  res.json({ok:true});
});
app.post("/api/mod/channels/:id/mute", async (req, res) =>{
  const access = await requirePerm(req,res,"MODERATE_CHANNELS"); if(!access) return;
  const channel=await data.getChannelById(req.params.id);
  if(!channel) return res.status(404).json({error:"Channel not found"});
  const userId = Number(req.body?.userId);
  if(!userId) return res.status(400).json({error:"userId required"});
  const reason = (req.body?.reason || "").toString();
  await data.upsertChannelMute(channel.id, userId, access.userId, reason);
  res.json({ ok:true });
});
app.post("/api/mod/channels/:id/unmute", async (req, res) =>{
  const access = await requirePerm(req,res,"MODERATE_CHANNELS"); if(!access) return;
  const channel=await data.getChannelById(req.params.id);
  if(!channel) return res.status(404).json({error:"Channel not found"});
  const userId = Number(req.body?.userId);
  if(!userId) return res.status(400).json({error:"userId required"});
  await data.deleteChannelMute(channel.id, userId);
  res.json({ ok:true });
});

// Channel requests - users can request new channels
app.post("/api/channels/request", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const created=await data.addChannelRequest(u, req.body || {});
  if(created?.error) return res.status(400).json(created);
  res.status(201).json(created);
});
app.get("/api/channels/requests/my", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  res.json(await data.listChannelRequestsByUser(u));
});
app.get("/api/admin/channel-requests", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const status=(req.query.status || "pending").toString().trim().toLowerCase();
  res.json(await data.listChannelRequestsByStatus(status));
});
app.post("/api/admin/channel-requests/:id/approve", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const updated=await data.updateChannelRequestStatus(req.params.id, "approved", admin.id);
  if(!updated) return res.status(404).json({error:"Not found"});
  // Optionally create the channel automatically
  if(updated.name){
    const channel = await data.createChannel(updated.name, updated.description || "", 1);
    if(channel?.id){
      // Make the requester a moderator of their channel
      await data.setChannelMemberRole(channel.id, updated.userId ?? updated.userid, "moderator");
    }
    res.json({ ok:true, request: updated, channel });
  } else {
    res.json({ ok:true, request: updated });
  }
});
app.post("/api/admin/channel-requests/:id/deny", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const updated=await data.updateChannelRequestStatus(req.params.id, "denied", admin.id);
  if(!updated) return res.status(404).json({error:"Not found"});
  res.json(updated);
});

// Channel moderator management
app.get("/api/admin/channels/:id/moderators", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const channel=await data.getChannelById(req.params.id);
  if(!channel) return res.status(404).json({error:"Channel not found"});
  res.json(await data.listChannelModerators(channel.id));
});
app.post("/api/admin/channels/:id/moderators", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const channel=await data.getChannelById(req.params.id);
  if(!channel) return res.status(404).json({error:"Channel not found"});
  const userId = Number(req.body?.userId);
  const role = (req.body?.role || "moderator").toString().trim();
  if(!userId) return res.status(400).json({error:"userId required"});
  const result = await data.setChannelMemberRole(channel.id, userId, role);
  if(result?.error) return res.status(400).json(result);
  res.json(result);
});
app.delete("/api/admin/channels/:id/moderators/:userId", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const channel=await data.getChannelById(req.params.id);
  if(!channel) return res.status(404).json({error:"Channel not found"});
  const userId = Number(req.params.userId);
  // Set role back to member (removes mod status)
  const result = await data.setChannelMemberRole(channel.id, userId, "member");
  res.json({ ok:true, result });
});

// Get places owned by current user
app.get("/api/places/mine", async (req, res) =>{
  const u = await requireLogin(req, res); if(!u) return;
  const allPlaces = await data.getPlaces();
  const owned = allPlaces.filter(p => Number(p.ownerUserId || p.owneruserid) === Number(u));
  res.json(owned);
});

// Get featured businesses (places with active business subscriptions)
app.get("/api/places/featured", async (req, res) =>{
  try {
    // Get all places with active business subscriptions
    const result = await data.query(`
      SELECT p.id, p.name, p.category, p.avatarUrl, p.status,
             bs.plan, bs.status as subStatus, bs.currentPeriodEnd
      FROM places p
      INNER JOIN business_subscriptions bs ON bs.placeId = p.id
      WHERE p.status = 'live'
        AND bs.status = 'active'
        AND (bs.currentPeriodEnd IS NULL OR bs.currentPeriodEnd > NOW())
      ORDER BY p.name ASC
    `);
    res.json(result.rows || []);
  } catch(e) {
    console.error("Featured places error:", e);
    res.status(500).json({ error: "Failed to load featured businesses" });
  }
});

// Place meta
app.get("/places/:id", async (req, res) =>{
  const p=await data.getPlaceById(req.params.id);
  if(!p) return res.status(404).json({error:"not found"});
  const u = await getUserId(req);
  const followCount = await data.getStoreFollowCount(p.id);
  const isFollowing = u ? await data.isFollowingStore(u, p.id) : false;
  const reviewSummary = p.ownerUserId ? await data.getReviewSummaryForUserDetailed(p.ownerUserId) : { count:0, average:0, buyerCount:0, sellerCount:0 };
  const owner = p.ownerUserId ? await getTrustBadgeForUser(p.ownerUserId) : null;
  res.json({ ...p, followCount, isFollowing, reviewSummary, owner });
});
app.post("/places", async (req, res) =>{
  const access = await requirePerm(req, res, "CREATE_LISTING"); if(!access) return;
  const payload = req.body || {};
  const created = await data.addPlace({
    ...payload,
    ownerUserId: access.userId,
    townId: 1
  });
  if(created?.error) return res.status(400).json(created);
  res.status(201).json(created);
});
app.get("/places/:id/owner", async (req, res) =>{
  const owner = await data.getPlaceOwnerPublic(req.params.id);
  if(!owner) return res.json({owner:null});
  const trustBadge = await getTrustBadgeForUser(owner.id);
  res.json({owner: { ...owner, trustTier: trustBadge?.trustTier, trustTierLabel: trustBadge?.trustTierLabel }});
});
app.patch("/places/:id/settings", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const updated = await data.updatePlaceSettings(req.params.id, req.body || {});
  if(!updated) return res.status(404).json({error:"not found"});
  res.json(updated);
});
app.patch("/places/:id/profile", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const place = await data.getPlaceById(req.params.id);
  if(!place) return res.status(404).json({error:"not found"});
  const ownerId = place.ownerUserId ?? place.owneruserid;
  if(Number(ownerId)!==Number(u)) return res.status(403).json({error:"Only owner can edit"});
  if((place.status || "").toLowerCase() !== "approved") return res.status(403).json({error:"Store not approved"});
  const updated = await data.updatePlaceProfile(place.id, req.body || {});
  res.json(updated);
});
app.post("/places/:id/follow", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const place = await data.getPlaceById(req.params.id);
  if(!place) return res.status(404).json({error:"not found"});
  await data.followStore(u, place.id);
  res.json({ ok:true });
});
app.delete("/places/:id/follow", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  await data.unfollowStore(u, req.params.id);
  res.json({ ok:true });
});
app.get("/places/:id/conversations", async (req, res) =>{
  const viewer = (req.query.viewer || "").toString();
  res.json(await data.getConversationsForPlace(req.params.id, viewer));
});
app.get("/conversations/:id/messages", async (req, res) =>{
  const convo = await data.getConversationById(req.params.id);
  if(!convo) return res.status(404).json({error:"Conversation not found"});
  res.json(await data.getConversationMessages(convo.id));
});
app.post("/conversations/:id/messages", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const ctx=await data.getTownContext(1, u);
  const user=await data.getUserById(u);
  const gate = trust.can(user, ctx, "chat_text");
  if(!gate.ok) return res.status(403).json({error:"Chat requires verified access"});
  const convo = await data.getConversationById(req.params.id);
  if(!convo) return res.status(404).json({error:"Conversation not found"});
  const sender = (req.body?.sender || "buyer").toString().trim() || "buyer";
  const text = (req.body?.text || "").toString().trim();
  if(!text) return res.status(400).json({error:"text required"});
  const msg = await data.addMessage({ conversationId: convo.id, sender, text });
  res.status(201).json({ ok:true, id: msg.id });
});
app.patch("/conversations/:id/read", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const convo = await data.getConversationById(req.params.id);
  if(!convo) return res.status(404).json({error:"Conversation not found"});
  const viewer = (req.query.viewer || "").toString();
  const result = await data.markConversationRead(convo.id, viewer);
  res.json(result);
});

// Listings
app.get("/places/:id/listings", async (req, res) =>{
  const pid=Number(req.params.id);
  const listings = await data.getListings();
  res.json(listings.filter(l=>{
    const placeId = Number(l.placeId ?? l.placeid);
    return placeId === pid;
  }));
});
app.post("/places/:id/listings", async (req, res) =>{
  const u=await requireUserSubscription(req,res); if(!u) return;
  const ctx=await data.getTownContext(1, u);
  const user=await data.getUserById(u);
  const listingGate = trust.can(user, ctx, "listing_create");
  if(!listingGate.ok) return res.status(403).json({error:"Listing creation requires Sebastian Resident trust"});
  const pid=Number(req.params.id);
  const listingType=(req.body?.listingType||"item").toString();
  if(listingType === "auction"){
    const auctionGate = trust.can(user, ctx, "auction_host");
    if(!auctionGate.ok) return res.status(403).json({error:"Auction hosting requires Local Business trust"});
  }
  const exchangeType=(req.body?.exchangeType||"money").toString();
  const offerCategory=(req.body?.offerCategory||"").toString().trim().toLowerCase();
  if(listingType==="offer" || listingType==="request"){
    const placeList = await data.getPlaces();
    const place = placeList.find(p=>Number(p.id)===pid);
    if(!place) return res.status(404).json({error:"Place not found"});
    if(Number(place.ownerUserId ?? place.owneruserid)!==Number(u)) return res.status(403).json({error:"Only store owner can post offers/requests"});
    const tier = trust.resolveTier(user, ctx);
    if(tier < 2) return res.status(403).json({error:"Sebastian Resident required for offers/requests"});
  }
  if(!req.body?.title) return res.status(400).json({error:"title required"});
  const created=await data.addListing({...req.body,placeId:pid});
  res.status(201).json(created);
});
app.patch("/listings/:id/sold", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const listing = await data.getListingById(req.params.id);
  if(!listing) return res.status(404).json({error:"Listing not found"});
  const updated = await data.updateListingStatus(listing.id, "sold");
  res.json(updated);
});

// ✅ Apply / Message → creates conversation
app.post("/listings/:id/apply", async (req, res) =>{
  const u=await requireUserSubscription(req,res); if(!u) return;
  const ctx=await data.getTownContext(1, u);
  const user=await data.getUserById(u);
  const gate = trust.can(user, ctx, "chat_text");
  if(!gate.ok) return res.status(403).json({error:"Chat requires verified access"});
  const listings = await data.getListings();
  const listing = listings.find(l=>l.id==req.params.id);
  if(!listing) return res.status(404).json({error:"Listing not found"});
  const convo=await data.addConversation({placeId:listing.placeId,participant:"buyer"});
  await data.addMessage({
    conversationId:convo.id,
    sender:"buyer",
    text:req.body?.message||"Interested in this offer."
  });
  res.json({ok:true,conversationId:convo.id});
});

// Auctions
app.get("/listings/:id/auction", async (req, res) =>{
  const access = await requirePerm(req,res,"VIEW_AUCTIONS"); if(!access) return;
  const listing = await data.getListingById(req.params.id);
  if(!listing) return res.status(404).json({error:"Listing not found"});
  if((listing.listingType||"item")!=="auction") return res.status(400).json({error:"Not an auction"});
  const summary = await data.getAuctionSummary(listing.id);
  const order = listing.winnerUserId ? await data.getLatestOrderForListingAndBuyer(listing.id, listing.winnerUserId) : null;
  res.json({
    listingId: listing.id,
    auctionStartAt: listing.auctionStartAt || "",
    auctionEndAt: listing.auctionEndAt || "",
    startBidCents: listing.startBidCents || 0,
    minIncrementCents: listing.minIncrementCents || 0,
    reserveCents: listing.reserveCents ?? null,
    buyNowCents: listing.buyNowCents ?? null,
    highestBidCents: summary.highestBidCents,
    bidCount: summary.bidCount,
    auctionStatus: listing.auctionStatus || "active",
    winnerUserId: listing.winnerUserId ?? null,
    winningBidId: listing.winningBidId ?? null,
    paymentStatus: listing.paymentStatus || "none",
    paymentDueAt: listing.paymentDueAt || "",
    orderId: order?.id || null
  });
});
app.post("/listings/:id/bid", async (req, res) =>{
  const u=await requireUserSubscription(req,res); if(!u) return;
  const ctx=await data.getTownContext(1, u);
  const user=await data.getUserById(u);
  const gate = trust.can(user, ctx, "auction_bid");
  if(!gate.ok) return res.status(403).json({error:"Auction bidding requires verified access"});
  const listing = await data.getListingById(req.params.id);
  if(!listing) return res.status(404).json({error:"Listing not found"});
  if((listing.listingType||"item")!=="auction") return res.status(400).json({error:"Not an auction"});
  const endAt = Date.parse(listing.auctionEndAt || "");
  if(listing.auctionEndAt && Number.isNaN(endAt)) return res.status(400).json({error:"Invalid auctionEndAt"});
  if(endAt && Date.now() > endAt) return res.status(400).json({error:"Auction ended"});
  const amountCents = Number(req.body?.amountCents);
  if(!Number.isFinite(amountCents) || amountCents<=0) return res.status(400).json({error:"amountCents required"});
  const last = await data.getLastBidForUser(listing.id, u);
  if(last?.createdAt){
    const lastTs = Date.parse(last.createdAt);
    if(!Number.isNaN(lastTs) && (Date.now()-lastTs) < 2000) return res.status(429).json({error:"Rate limit: one bid per 2s"});
  }
  const highest = await data.getHighestBidForListing(listing.id);
  const minBid = highest ? (highest.amountCents + (listing.minIncrementCents||0)) : (listing.startBidCents||0);
  if(amountCents < minBid) return res.status(400).json({error:`Bid too low. Minimum ${minBid}`});
  const bid = await data.addBid(listing.id, u, amountCents);
  const summary = await data.getAuctionSummary(listing.id);
  res.json({ok:true, bidId: bid.id, highestBidCents: summary.highestBidCents, bidCount: summary.bidCount});
});

app.post("/api/auctions/:listingId/close", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const listing = await data.getListingById(req.params.listingId);
  if(!listing) return res.status(404).json({error:"Listing not found"});
  if((listing.listingType||"item")!=="auction") return res.status(400).json({error:"Not an auction"});
  const endAt = Date.parse(listing.auctionEndAt || "");
  if(!listing.auctionEndAt || Number.isNaN(endAt)) return res.status(400).json({error:"Invalid auctionEndAt"});
  if(Date.now() < endAt) return res.status(400).json({error:"Auction not ended yet"});
  const place = await data.getPlaceById(listing.placeId);
  if(!place) return res.status(404).json({error:"Place not found"});
  const user = await data.getUserById(u);
  if(!isAdminUser(user) && Number(place.ownerUserId ?? place.owneruserid)!==Number(u)){
    return res.status(403).json({error:"Only owner or admin can close"});
  }
  const highest = await data.getHighestBidForListing(listing.id);
  if(!highest){
    await data.updateListingAuctionState(listing.id, {
      auctionStatus: "ended",
      paymentStatus: "none",
      winningBidId: null,
      winnerUserId: null,
      paymentDueAt: ""
    });
    return res.json({ok:true, winnerUserId:null, orderId:null, payUrl:null});
  }
  const subtotalCents = Number(highest.amountCents || 0);
  const serviceGratuityCents = Math.ceil(subtotalCents * 0.05);
  const totalCents = subtotalCents + serviceGratuityCents;
  const order = await data.createOrderWithItems({
    townId: listing.townId || 1,
    listingId: listing.id,
    buyerUserId: highest.userId,
    sellerUserId: place.ownerUserId ?? place.owneruserid ?? null,
    sellerPlaceId: place.id,
    quantity: 1,
    amountCents: totalCents,
    status: "pending_payment",
    paymentProvider: "stub",
    paymentIntentId: "",
    subtotalCents,
    serviceGratuityCents,
    totalCents,
    fulfillmentType: "pickup",
    fulfillmentNotes: "",
    titleSnapshot: listing.title || "Auction item",
    priceCentsSnapshot: subtotalCents
  });
  const paymentDueAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  await data.updateListingAuctionState(listing.id, {
    auctionStatus: "pending_payment",
    paymentStatus: "required",
    winningBidId: highest.id,
    winnerUserId: highest.userId,
    paymentDueAt
  });
  res.json({ok:true, winnerUserId: highest.userId, orderId: order.id, payUrl: `/pay/${order.id}`});
});

app.post("/api/auctions/:listingId/expire_winner", async (req, res) =>{
  const admin=await requireAdminOrDev(req,res); if(!admin) return;
  const listing = await data.getListingById(req.params.listingId);
  if(!listing) return res.status(404).json({error:"Listing not found"});
  if((listing.listingType||"item")!=="auction") return res.status(400).json({error:"Not an auction"});
  const dueAt = Date.parse(listing.paymentDueAt || "");
  if(!listing.paymentDueAt || Number.isNaN(dueAt)) return res.status(400).json({error:"paymentDueAt missing"});
  if(Date.now() < dueAt) return res.status(400).json({error:"Payment not overdue"});
  if(listing.paymentStatus === "paid") return res.status(400).json({error:"Already paid"});
  const previousWinner = listing.winnerUserId;
  const nextBid = await data.getNextHighestBidForListing(listing.id, previousWinner);
  if(!nextBid){
    await data.updateListingAuctionState(listing.id, {
      auctionStatus: "failed",
      paymentStatus: "failed",
      winningBidId: null,
      winnerUserId: null,
      paymentDueAt: ""
    });
    return res.json({ok:true, winnerUserId:null, orderId:null, payUrl:null});
  }
  const place = await data.getPlaceById(listing.placeId);
  if(!place) return res.status(404).json({error:"Place not found"});
  const subtotalCents = Number(nextBid.amountCents || 0);
  const serviceGratuityCents = Math.ceil(subtotalCents * 0.05);
  const totalCents = subtotalCents + serviceGratuityCents;
  const order = await data.createOrderWithItems({
    townId: listing.townId || 1,
    listingId: listing.id,
    buyerUserId: nextBid.userId,
    sellerUserId: place.ownerUserId ?? place.owneruserid ?? null,
    sellerPlaceId: place.id,
    quantity: 1,
    amountCents: totalCents,
    status: "pending_payment",
    paymentProvider: "stub",
    paymentIntentId: "",
    subtotalCents,
    serviceGratuityCents,
    totalCents,
    fulfillmentType: "pickup",
    fulfillmentNotes: "",
    titleSnapshot: listing.title || "Auction item",
    priceCentsSnapshot: subtotalCents
  });
  const paymentDueAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  await data.updateListingAuctionState(listing.id, {
    auctionStatus: "pending_payment",
    paymentStatus: "required",
    winningBidId: nextBid.id,
    winnerUserId: nextBid.userId,
    paymentDueAt
  });
  res.json({ok:true, winnerUserId: nextBid.userId, orderId: order.id, payUrl: `/pay/${order.id}`, previousWinnerUserId: previousWinner});
});
// =====================
// ADMIN VERIFY (TEMP)
// =====================
app.post("/admin/verify/buyer", async (req, res) =>{
  const admin=await requireAdmin(req,res,{ message: "Admin access required" }); if(!admin) return;
  const id = Number(req.body?.userId);
  if(!id) return res.status(400).json({error:"userId required"});
  const r = await data.verifyBuyer(id, "verified", "admin");
  res.json(r);
});

app.post("/admin/verify/store", async (req, res) =>{
  const admin=await requireAdmin(req,res,{ message: "Admin access required" }); if(!admin) return;
  const id = Number(req.body?.placeId);
  if(!id) return res.status(400).json({error:"placeId required"});
  const r = await data.verifyStore(id);
  if(r?.error) return res.status(400).json(r);
  res.json(r);
});

app.post("/api/admin/trust/tiers", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const userId = Number(req.body?.userId);
  const trustTier = Number(req.body?.trustTier);
  if(!userId || !Number.isFinite(trustTier)) return res.status(400).json({error:"userId and trustTier required"});
  if(trustTier < 0 || trustTier > 3) return res.status(400).json({error:"trustTier must be 0-3 (0 resets to automatic)"});
  const updated = await data.setUserTrustTier(1, userId, trustTier);
  if(updated?.error) return res.status(400).json(updated);
  res.json({ ok:true, membership: updated });
});
app.post("/api/admin/places/status", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const placeId = Number(req.body?.placeId);
  const status = (req.body?.status || "").toString().trim().toLowerCase();
  if(!placeId || !status) return res.status(400).json({ error: "placeId and status required" });
  const allowed = new Set(["approved","pending","rejected"]);
  if(!allowed.has(status)) return res.status(400).json({ error: "invalid status" });
  const place = await data.updatePlaceStatus(placeId, status);
  if(!place) return res.status(404).json({ error: "Place not found" });
  res.json({ ok:true, place });
});

// ---------- Business Subscriptions ----------
app.post("/api/business/subscribe", async (req, res) => {
  const u = await requireLogin(req, res); if(!u) return;
  const placeId = Number(req.body?.placeId || 0);
  if(!placeId) return res.status(400).json({ error: "placeId required" });
  const place = await data.getPlaceById(placeId);
  if(!place) return res.status(404).json({ error: "Place not found" });
  const ownerId = place.ownerUserId ?? place.owneruserid;
  if(Number(ownerId) !== Number(u)) return res.status(403).json({ error: "Only owner can subscribe" });
  const existing = await data.getBusinessSubscription(placeId);
  if(existing) return res.status(400).json({ error: "Subscription already exists", subscription: existing });
  const subscription = await data.createBusinessSubscription(placeId, u, req.body?.plan || 'free_trial');
  res.json({ ok: true, subscription });
});

app.get("/api/business/subscription/:placeId", async (req, res) => {
  const u = await requireLogin(req, res); if(!u) return;
  const placeId = Number(req.params.placeId || 0);
  if(!placeId) return res.status(400).json({ error: "placeId required" });
  const place = await data.getPlaceById(placeId);
  if(!place) return res.status(404).json({ error: "Place not found" });
  const user = await data.getUserById(u);
  const ownerId = place.ownerUserId ?? place.owneruserid;
  if(Number(ownerId) !== Number(u) && !isAdminUser(user)){
    return res.status(403).json({ error: "Only owner or admin can view subscription" });
  }
  let subscription = await data.getBusinessSubscription(placeId);
  // Normalize PostgreSQL lowercase column names to camelCase
  if(subscription) {
    subscription = {
      ...subscription,
      placeId: subscription.placeId ?? subscription.placeid,
      userId: subscription.userId ?? subscription.userid,
      trialEndsAt: subscription.trialEndsAt ?? subscription.trialendsat,
      currentPeriodStart: subscription.currentPeriodStart ?? subscription.currentperiodstart,
      currentPeriodEnd: subscription.currentPeriodEnd ?? subscription.currentperiodend,
      canceledAt: subscription.canceledAt ?? subscription.canceledat,
      stripeCustomerId: subscription.stripeCustomerId ?? subscription.stripecustomerid,
      stripeSubscriptionId: subscription.stripeSubscriptionId ?? subscription.stripesubscriptionid,
      createdAt: subscription.createdAt ?? subscription.createdat,
      updatedAt: subscription.updatedAt ?? subscription.updatedat,
    };
  }
  const isActive = await data.isSubscriptionActive(placeId);
  res.json({ subscription, isActive });
});

// Stripe Checkout for paid subscription
app.post("/api/business/subscribe/checkout", async (req, res) => {
  const u = await requireLogin(req, res); if(!u) return;
  const placeId = Number(req.body?.placeId || 0);
  if(!placeId) return res.status(400).json({ error: "placeId required" });

  const place = await data.getPlaceById(placeId);
  if(!place) return res.status(404).json({ error: "Place not found" });

  const ownerId = place.ownerUserId ?? place.owneruserid;
  if(Number(ownerId) !== Number(u)) return res.status(403).json({ error: "Only owner can subscribe" });

  const stripeKey = (process.env.STRIPE_SECRET_KEY || "").trim();
  if(!stripeKey) {
    return res.status(400).json({ error: "Paid subscriptions coming soon. Stripe not configured." });
  }

  try {
    const stripe = require('stripe')(stripeKey);
    const user = await data.getUserById(u);
    // Use new STRIPE_BUSINESS_PRICE_ID, fall back to legacy STRIPE_PRICE_ID
    const priceId = (process.env.STRIPE_BUSINESS_PRICE_ID || process.env.STRIPE_PRICE_ID || "").trim();

    if(!priceId) {
      return res.status(400).json({ error: "Stripe price not configured" });
    }

    const successUrl = `${req.protocol}://${req.get('host')}/business-subscription?placeId=${placeId}&success=true&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${req.protocol}://${req.get('host')}/business-subscription?placeId=${placeId}&canceled=true`;

    const sessionParams = {
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price: priceId,
        quantity: 1,
      }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      subscription_data: {
        trial_period_days: 7
      },
      metadata: {
        placeId: placeId.toString(),
        userId: u.toString()
      }
    };

    if(user?.email) {
      sessionParams.customer_email = user.email;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });
  } catch(e) {
    console.error("Stripe checkout error:", e);
    res.status(500).json({ error: e.message || "Failed to create checkout session" });
  }
});

// Stripe Customer Portal for managing subscription
app.post("/api/business/subscribe/portal", async (req, res) => {
  const u = await requireLogin(req, res); if(!u) return;
  const placeId = Number(req.body?.placeId || 0);
  if(!placeId) return res.status(400).json({ error: "placeId required" });

  const place = await data.getPlaceById(placeId);
  if(!place) return res.status(404).json({ error: "Place not found" });

  const ownerId = place.ownerUserId ?? place.owneruserid;
  if(Number(ownerId) !== Number(u)) return res.status(403).json({ error: "Only owner can manage subscription" });

  const subscription = await data.getBusinessSubscription(placeId);
  if(!subscription || !subscription.stripeCustomerId) {
    return res.status(400).json({ error: "No Stripe subscription found" });
  }

  const stripeKey = (process.env.STRIPE_SECRET_KEY || "").trim();
  if(!stripeKey) {
    return res.status(400).json({ error: "Stripe not configured" });
  }

  try {
    const stripe = require('stripe')(stripeKey);
    const returnUrl = `${req.protocol}://${req.get('host')}/business-subscription?placeId=${placeId}`;

    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: returnUrl,
    });

    res.json({ url: session.url });
  } catch(e) {
    console.error("Stripe portal error:", e);
    res.status(500).json({ error: e.message || "Failed to create portal session" });
  }
});

// Cancel subscription
app.post("/api/business/subscribe/cancel", async (req, res) => {
  const u = await requireLogin(req, res); if(!u) return;
  const placeId = Number(req.body?.placeId || 0);
  if(!placeId) return res.status(400).json({ error: "placeId required" });

  const place = await data.getPlaceById(placeId);
  if(!place) return res.status(404).json({ error: "Place not found" });

  const ownerId = place.ownerUserId ?? place.owneruserid;
  if(Number(ownerId) !== Number(u)) return res.status(403).json({ error: "Only owner can cancel subscription" });

  const subscription = await data.getBusinessSubscription(placeId);
  if(!subscription) {
    return res.status(400).json({ error: "No subscription found" });
  }

  // If has Stripe subscription, cancel at period end
  if(subscription.stripeSubscriptionId) {
    const stripeKey = (process.env.STRIPE_SECRET_KEY || "").trim();
    if(stripeKey) {
      try {
        const stripe = require('stripe')(stripeKey);
        await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
          cancel_at_period_end: true
        });
      } catch(e) {
        console.error("Stripe cancel error:", e);
      }
    }
  }

  // Update local subscription status
  await data.updateSubscriptionStatus(subscription.id, 'canceled');
  res.json({ ok: true, message: "Subscription will be canceled at end of billing period" });
});

// Payment history
app.get("/api/business/subscribe/history/:placeId", async (req, res) => {
  const u = await requireLogin(req, res); if(!u) return;
  const placeId = Number(req.params.placeId || 0);
  if(!placeId) return res.status(400).json({ error: "placeId required" });

  const place = await data.getPlaceById(placeId);
  if(!place) return res.status(404).json({ error: "Place not found" });

  const ownerId = place.ownerUserId ?? place.owneruserid;
  if(Number(ownerId) !== Number(u)) return res.status(403).json({ error: "Only owner can view history" });

  const subscription = await data.getBusinessSubscription(placeId);

  // If has Stripe, fetch from Stripe
  if(subscription?.stripeCustomerId) {
    const stripeKey = (process.env.STRIPE_SECRET_KEY || "").trim();
    if(stripeKey) {
      try {
        const stripe = require('stripe')(stripeKey);
        const invoices = await stripe.invoices.list({
          customer: subscription.stripeCustomerId,
          limit: 20
        });

        const payments = invoices.data.map(inv => ({
          id: inv.id,
          date: new Date(inv.created * 1000).toISOString(),
          createdAt: new Date(inv.created * 1000).toISOString(),
          description: inv.lines?.data?.[0]?.description || 'Subscription payment',
          amount: inv.amount_paid,
          status: inv.status === 'paid' ? 'paid' : (inv.status === 'open' ? 'pending' : inv.status)
        }));

        return res.json({ payments });
      } catch(e) {
        console.error("Stripe history error:", e);
      }
    }
  }

  // Return empty if no Stripe history
  res.json({ payments: [] });
});

// Admin: manually activate subscription (for testing/support)
app.post("/api/admin/subscription/activate", async (req, res) => {
  const admin = await requireAdminOrDev(req, res); if(!admin) return;
  const placeId = Number(req.body?.placeId || 0);
  if(!placeId) return res.status(400).json({ error: "placeId required" });

  try {
    const existing = await data.getBusinessSubscription(placeId);
    if(existing) {
      const updateSql = `
        UPDATE business_subscriptions
        SET plan = 'monthly', status = 'active',
            currentPeriodStart = NOW(), currentPeriodEnd = NOW() + INTERVAL '1 month', updatedAt = NOW()
        WHERE id = $1
      `;
      await data.query(updateSql, [existing.id]);
      console.log("Admin activated subscription for placeId:", placeId);
      res.json({ ok: true, message: "Subscription activated", subscriptionId: existing.id });
    } else {
      res.status(404).json({ error: "No subscription found for this place" });
    }
  } catch(err) {
    console.error("Error activating subscription:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- User Subscriptions ----------
// Check user's subscription status
app.get("/api/user/subscription", async (req, res) => {
  const u = await getUserId(req);
  if(!u) return res.json({ subscription: null, isActive: false });

  try {
    const result = await data.query(
      `SELECT * FROM user_subscriptions WHERE userId = $1 ORDER BY createdAt DESC LIMIT 1`,
      [u]
    );
    const sub = result.rows?.[0];
    if(!sub) return res.json({ subscription: null, isActive: false });

    const now = new Date();
    const periodEnd = sub.currentperiodend || sub.currentPeriodEnd;
    const status = sub.status || "";
    const isActive = (status === "active" || status === "trialing") &&
                     periodEnd && new Date(periodEnd) > now;

    res.json({
      subscription: {
        id: sub.id,
        plan: sub.plan,
        status: sub.status,
        currentPeriodStart: sub.currentperiodstart || sub.currentPeriodStart,
        currentPeriodEnd: periodEnd,
        createdAt: sub.createdat || sub.createdAt
      },
      isActive
    });
  } catch(e) {
    console.error("User subscription check error:", e);
    res.json({ subscription: null, isActive: false });
  }
});

// Create Stripe checkout for user subscription (User $5 or Business $10)
app.post("/api/subscription/checkout", async (req, res) => {
  const u = await requireLogin(req, res); if(!u) return;
  const plan = (req.body?.plan || "user").toString().toLowerCase();

  if(!["user", "business"].includes(plan)) {
    return res.status(400).json({ error: "Invalid plan. Choose 'user' or 'business'." });
  }

  if(!stripe) {
    return res.status(400).json({ error: "Stripe not configured" });
  }

  // Get the correct price ID based on plan
  const priceId = plan === "business"
    ? (process.env.STRIPE_BUSINESS_PRICE_ID || process.env.STRIPE_PRICE_ID || "").trim()
    : (process.env.STRIPE_USER_PRICE_ID || "").trim();

  if(!priceId) {
    return res.status(400).json({ error: `Stripe price ID not configured for ${plan} plan` });
  }

  try {
    const user = await data.getUserById(u);
    const successUrl = `${req.protocol}://${req.get('host')}/subscription?success=true&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${req.protocol}://${req.get('host')}/subscription?canceled=true`;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: user?.email || undefined,
      metadata: { userId: String(u), plan }
    });

    res.json({ checkoutUrl: session.url });
  } catch(e) {
    console.error("Subscription checkout error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ---------- Referral System ----------
// Get user's referral stats and code (requires subscription)
app.get("/api/referral/stats", async (req, res) => {
  const u = await requireUserSubscription(req, res); if(!u) return;

  // Ensure user has a referral code
  await data.ensureUserReferralCode(u);
  const stats = await data.getReferralStats(u);
  res.json(stats);
});

// Get referral transactions history
app.get("/api/referral/transactions", async (req, res) => {
  const u = await requireLogin(req, res); if(!u) return;
  const transactions = await data.getReferralTransactions(u);
  res.json({ transactions });
});

// Get list of referred users
app.get("/api/referral/users", async (req, res) => {
  const u = await requireLogin(req, res); if(!u) return;
  const users = await data.getReferredUsers(u);
  // Mask email addresses for privacy
  const maskedUsers = users.map(user => ({
    ...user,
    email: user.email ? user.email.replace(/(.{2}).*@/, "$1***@") : null
  }));
  res.json({ users: maskedUsers });
});

// Request cashout (min $25)
app.post("/api/referral/cashout", async (req, res) => {
  const u = await requireLogin(req, res); if(!u) return;
  const result = await data.requestReferralCashout(u);

  if(result.error) {
    return res.status(400).json(result);
  }

  // Notify admin about cashout request
  const user = await data.getUserById(u);
  sendAdminEmail("Referral Cashout Request", `
User: ${user?.displayName || user?.email || 'Unknown'} (ID: ${u})
Amount: $${(result.cashoutAmountCents / 100).toFixed(2)}

Please process this payout manually and mark as complete.
  `);

  res.json(result);
});

// Validate a referral code (for displaying referrer name during signup)
app.get("/api/referral/validate/:code", async (req, res) => {
  const code = (req.params.code || "").toString().trim();
  if(!code) return res.json({ valid: false });

  const referrer = await data.getUserByReferralCode(code);
  if(!referrer) return res.json({ valid: false });

  res.json({
    valid: true,
    referrerName: referrer.displayName || "A Digital Sebastian member"
  });
});

// ---------- Giveaway Offers ----------
// Store owners with subscription can submit giveaway offers for admin review
app.post("/api/giveaway/offer", async (req, res) => {
  const u = await requireUserSubscription(req, res); if(!u) return;
  const placeId = Number(req.body?.placeId || 0);
  if(!placeId) return res.status(400).json({ error: "placeId required" });
  const place = await data.getPlaceById(placeId);
  if(!place) return res.status(404).json({ error: "Place not found" });
  const ownerId = place.ownerUserId ?? place.owneruserid;
  if(Number(ownerId) !== Number(u)) return res.status(403).json({ error: "Only store owner can submit giveaways" });
  const offer = await data.createGiveawayOffer(placeId, u, {
    title: req.body?.title,
    description: req.body?.description,
    estimatedValue: req.body?.estimatedValue,
    imageUrl: req.body?.imageUrl,
    rewardType: req.body?.rewardType
  });
  if(offer?.error) return res.status(400).json(offer);
  const user = await data.getUserById(u);
  const adminText = `New giveaway offer submitted for review:

Business: ${place.name}
Title: ${offer.title}
Description: ${offer.description}
Estimated Value: $${(offer.estimatedValue || 0) / 100}
Submitted by: ${user?.displayName || user?.email || 'Unknown'}

Review at: ${getAdminReviewLink()}`;
  sendAdminEmail("New Giveaway Offer Submission", adminText);
  res.json({ ok: true, offer });
});

app.get("/api/admin/giveaway/offers", async (req, res) => {
  const admin = await requireAdmin(req, res); if(!admin) return;
  const status = (req.query.status || "pending").toString().trim().toLowerCase();
  const offers = await data.getGiveawayOffersByStatus(status);
  const enriched = await Promise.all(offers.map(async (offer) => {
    const place = await data.getPlaceById(offer.placeId);
    const user = await data.getUserById(offer.userId);
    return {
      ...offer,
      place: place ? { id: place.id, name: place.name } : null,
      user: user ? { id: user.id, email: user.email, displayName: user.displayName } : null
    };
  }));
  res.json(enriched);
});

app.get("/api/giveaway/offers/place/:placeId", async (req, res) => {
  const u = await requireLogin(req, res); if(!u) return;
  const placeId = Number(req.params.placeId || 0);
  if(!placeId) return res.status(400).json({ error: "placeId required" });
  const place = await data.getPlaceById(placeId);
  if(!place) return res.status(404).json({ error: "Place not found" });
  const ownerId = place.ownerUserId ?? place.owneruserid;
  if(Number(ownerId) !== Number(u)) return res.status(403).json({ error: "Only owner can view offers" });
  const offers = await data.getGiveawayOffersByPlace(placeId);
  res.json(offers);
});

app.post("/api/admin/giveaway/offer/:id/review", async (req, res) => {
  const admin = await requireAdmin(req, res); if(!admin) return;
  const offerId = Number(req.params.id || 0);
  if(!offerId) return res.status(400).json({ error: "offerId required" });
  const status = (req.body?.status || "").toString().trim().toLowerCase();
  const notes = (req.body?.notes || "").toString().trim();
  const startsAt = req.body?.startsAt || null;
  const endsAt = req.body?.endsAt || null;
  if(status !== "approved" && status !== "rejected"){
    return res.status(400).json({ error: "status must be 'approved' or 'rejected'" });
  }
  let offer = await data.updateGiveawayOfferStatus(offerId, status, admin.id, notes);
  if(!offer) return res.status(404).json({ error: "Offer not found" });
  // Update start/end dates if provided (for featured store scheduling)
  if(status === "approved" && (startsAt || endsAt)){
    offer = await data.updateGiveawayOfferDates(offerId, startsAt, endsAt);
  }
  let subscription = null;
  if(status === "approved"){
    subscription = await data.awardFreeMonth(offer.placeId);
  }
  const place = await data.getPlaceById(offer.placeId);
  const owner = offer.userId ? await data.getUserById(offer.userId) : null;
  if(owner?.email){
    const statusText = status === "approved" ? "approved" : "not approved";
    const rewardText = status === "approved"
      ? "As a thank you, your subscription has been extended by one free month!"
      : "";
    const emailText = `Hello,

Your giveaway offer "${offer.title}" for ${place?.name || 'your business'} has been ${statusText}.

${notes ? `Admin notes: ${notes}` : ""}

${rewardText}

Thank you for being part of our community!`;
    sendEmail(owner.email, `Giveaway Offer ${status === "approved" ? "Approved" : "Update"}`, emailText);
  }
  res.json({ ok: true, offer, subscription });
});

// ---------- Featured Stores ----------
app.get("/api/featured-stores", async (req, res) => {
  try {
    const stores = await data.getFeaturedStores();
    res.json(stores);
  } catch(e) {
    console.error("Featured stores error:", e);
    res.status(500).json({ error: "Failed to load featured stores" });
  }
});

// ---------- Ghost Reports (Buyer Non-Payment) ----------
app.post("/api/orders/:id/report-ghost", async (req, res) => {
  const u = await requireLogin(req, res); if(!u) return;
  const orderId = Number(req.params.id || 0);
  if(!orderId) return res.status(400).json({ error: "orderId required" });

  const order = await data.getOrderById(orderId);
  if(!order) return res.status(404).json({ error: "Order not found" });

  // Verify caller is the seller
  const sellerUserId = order.sellerUserId ?? order.selleruserid;
  if(Number(sellerUserId) !== Number(u)) {
    return res.status(403).json({ error: "Only the seller can report non-payment" });
  }

  // Verify order is still pending payment
  const status = (order.status || "").toLowerCase();
  if(!["pending_payment", "requires_payment", "pending"].includes(status)) {
    return res.status(400).json({ error: "Order is not pending payment" });
  }

  // Check 48 hours have passed since order creation
  const createdAt = new Date(order.createdAt || order.createdat);
  const hoursSince = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
  if(hoursSince < 48) {
    const hoursRemaining = Math.ceil(48 - hoursSince);
    return res.status(400).json({ error: `Cannot report until 48 hours have passed. ${hoursRemaining} hours remaining.` });
  }

  const buyerUserId = order.buyerUserId ?? order.buyeruserid;
  const reason = (req.body?.reason || "").toString().trim();

  const report = await data.createGhostReport(orderId, buyerUserId, sellerUserId, reason);
  if(!report) {
    return res.status(400).json({ error: "Order already reported" });
  }

  // Recalculate buyer's ghosting percentage
  await data.recalculateGhostingPercent(buyerUserId);

  res.json({ ok: true, report });
});

app.get("/api/users/:id/ghosting", async (req, res) => {
  const userId = Number(req.params.id || 0);
  if(!userId) return res.status(400).json({ error: "userId required" });

  const stats = await data.getGhostingStats(userId);
  res.json(stats);
});

// ---------- Social Sharing ----------
function getPublicBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || process.env.SITE_URL || process.env.APP_URL || "").toString().trim().replace(/\/$/, "") || "https://sebastian.local";
}

app.get("/api/share/purchase/:orderId", async (req, res) => {
  const u = await requireLogin(req, res); if(!u) return;
  const orderId = Number(req.params.orderId || 0);
  if(!orderId) return res.status(400).json({ error: "orderId required" });
  const order = await data.getOrderById(orderId);
  if(!order) return res.status(404).json({ error: "Order not found" });
  if(Number(order.buyerUserId) !== Number(u)) return res.status(403).json({ error: "Only buyer can share" });
  const listing = order.listingId ? await data.getListingById(order.listingId) : null;
  const place = order.sellerPlaceId ? await data.getPlaceById(order.sellerPlaceId) : null;
  const itemName = listing?.title || order.titleSnapshot || "something special";
  const storeName = place?.name || "a local business";
  const baseUrl = getPublicBaseUrl();
  const text = `Just bought ${itemName} from ${storeName} on Digital Sebastian! Support local businesses in Sebastian, FL.`;
  const url = place ? `${baseUrl}/places/${place.id}` : baseUrl;
  const imageUrl = listing?.photoUrls?.[0] || place?.avatarUrl || `${baseUrl}/images/share-default.png`;
  res.json({ text, url, imageUrl, orderId, itemName, storeName });
});

app.get("/api/share/giveaway-win/:awardId", async (req, res) => {
  const u = await requireLogin(req, res); if(!u) return;
  const awardId = Number(req.params.awardId || 0);
  if(!awardId) return res.status(400).json({ error: "awardId required" });
  const award = await data.getPrizeAwardById(awardId);
  if(!award) return res.status(404).json({ error: "Award not found" });
  if(Number(award.userId) !== Number(u)) return res.status(403).json({ error: "Only winner can share" });
  const prizeName = award.prizeTitle || award.prizeName || "an amazing prize";
  const baseUrl = getPublicBaseUrl();
  const text = `I won ${prizeName} in the Sebastian Giveaway! Join Digital Sebastian and enter to win amazing local prizes.`;
  const url = `${baseUrl}/giveaway`;
  const imageUrl = award.prizeImageUrl || `${baseUrl}/images/giveaway-share.png`;
  res.json({ text, url, imageUrl, awardId, prizeName });
});

app.get("/api/share/sweep-win/:drawId", async (req, res) => {
  const u = await requireLogin(req, res); if(!u) return;
  const drawId = Number(req.params.drawId || 0);
  if(!drawId) return res.status(400).json({ error: "drawId required" });
  const draw = await data.getSweepDrawById(drawId);
  if(!draw) return res.status(404).json({ error: "Draw not found" });
  if(Number(draw.winnerUserId) !== Number(u)) return res.status(403).json({ error: "Only winner can share" });
  const sweep = draw.sweepId ? await data.getSweepstakeById(draw.sweepId) : null;
  const snapshot = draw.snapshotJson ? (typeof draw.snapshotJson === "string" ? JSON.parse(draw.snapshotJson) : draw.snapshotJson) : {};
  const prizeName = snapshot.prize?.title || sweep?.prize || sweep?.title || "an amazing prize";
  const baseUrl = getPublicBaseUrl();
  const text = `I won ${prizeName} in the Sebastian Sweepstakes! Join Digital Sebastian and enter to win amazing local prizes.`;
  const url = `${baseUrl}/giveaway`;
  const imageUrl = snapshot.prize?.imageUrl || draw.claimedPhotoUrl || `${baseUrl}/images/giveaway-share.png`;
  res.json({ text, url, imageUrl, drawId, prizeName });
});

app.get("/api/share/review/:reviewId", async (req, res) => {
  const u = await requireLogin(req, res); if(!u) return;
  const reviewId = Number(req.params.reviewId || 0);
  if(!reviewId) return res.status(400).json({ error: "reviewId required" });
  const review = await db.one("SELECT * FROM reviews WHERE id=$1", [reviewId]);
  if(!review) return res.status(404).json({ error: "Review not found" });
  if(Number(review.reviewerUserId || review.revieweruserid) !== Number(u)){
    return res.status(403).json({ error: "Only reviewer can share" });
  }
  const order = review.orderId ? await data.getOrderById(review.orderId || review.orderid) : null;
  const place = order?.sellerPlaceId ? await data.getPlaceById(order.sellerPlaceId) : null;
  const storeName = place?.name || "a local business";
  const rating = Number(review.rating || 0);
  const stars = rating >= 4 ? "loved" : "found";
  const baseUrl = getPublicBaseUrl();
  const text = `I ${stars} ${storeName} on Digital Sebastian! ${rating >= 4 ? "Highly recommend checking them out." : "Support local businesses in Sebastian, FL."}`;
  const url = place ? `${baseUrl}/places/${place.id}` : baseUrl;
  const imageUrl = place?.avatarUrl || `${baseUrl}/images/share-default.png`;
  res.json({ text, url, imageUrl, reviewId, storeName, rating });
});

app.post("/api/share/log", async (req, res) => {
  const u = await getUserId(req);
  const shareType = (req.body?.shareType || "").toString().trim();
  const itemType = (req.body?.itemType || "").toString().trim();
  const itemId = Number(req.body?.itemId || 0);
  const platform = (req.body?.platform || "facebook").toString().trim();
  if(!shareType || !itemType || !itemId){
    return res.status(400).json({ error: "shareType, itemType, and itemId required" });
  }
  const share = await data.logSocialShare(u, shareType, itemType, itemId, platform);
  res.json({ ok: true, share });
});

// ---------- Daily Pulse Export ----------
app.get("/api/pulse/daily", async (req, res) => {
  const townId = Number(req.query.townId || 1);
  const pulse = await data.getDailyPulseSummary(townId);
  res.json(pulse);
});

app.get("/api/pulse/export/facebook", async (req, res) => {
  const townId = Number(req.query.townId || 1);
  const result = await data.formatPulseForFacebook(townId);
  res.json(result);
});

app.get("/api/pulse/export/image", async (req, res) => {
  const baseUrl = getPublicBaseUrl();
  res.json({
    imageUrl: `${baseUrl}/images/pulse-card.png`,
    templateUrl: `${baseUrl}/pulse-card`,
    note: "Dynamic image generation can be added via Cloudflare Workers or similar service"
  });
});

app.post("/api/admin/pulse/export", async (req, res) => {
  const admin = await requireAdmin(req, res); if(!admin) return;
  const townId = Number(req.body?.townId || 1);
  const exportType = (req.body?.exportType || "facebook").toString().trim();
  const result = await data.formatPulseForFacebook(townId);
  const logged = await data.logPulseExport(townId, exportType, admin.id, result.pulse, result.text);
  res.json({ ok: true, export: logged, text: result.text, pulse: result.pulse });
});

app.get("/api/admin/pulse/history", async (req, res) => {
  const admin = await requireAdmin(req, res); if(!admin) return;
  const townId = Number(req.query.townId || 1);
  const limit = Number(req.query.limit || 30);
  const exports = await data.listPulseExports(townId, limit);
  const lastExport = exports[0] || null;
  res.json({ exports, lastExport });
});

app.get("/api/admin/pulse/last", async (req, res) => {
  const admin = await requireAdmin(req, res); if(!admin) return;
  const townId = Number(req.query.townId || 1);
  const exportType = (req.query.exportType || "facebook").toString();
  const lastExport = await data.getLastPulseExport(townId, exportType);
  res.json({ lastExport });
});

// ============ SENTRY ERROR HANDLER ============
// Must be before the global error handler (Sentry v8+ API)
if (Sentry) {
  Sentry.setupExpressErrorHandler(app);
}

// ============ GLOBAL ERROR HANDLER ============
// Must be defined after all routes to catch unhandled errors
app.use((err, req, res, next) => {
  // Log error for debugging (server-side only)
  console.error("UNHANDLED_ERROR:", {
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  });

  // Never expose stack traces or internal details to client in production
  const isProduction = process.env.NODE_ENV === 'production';
  const statusCode = err.statusCode || err.status || 500;

  res.status(statusCode).json({
    error: isProduction ? 'An unexpected error occurred' : err.message,
    ...(isProduction ? {} : { stack: err.stack })
  });
});

// Handle 404 for undefined routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

const PORT = Number(process.env.PORT || 3000);
async function start(){
  await data.initDb();
  app.listen(PORT, "0.0.0.0", () => console.log(`Server running on http://localhost:${PORT}`));
}
start().catch((err)=>{
  console.error("Failed to start server:", err);
  process.exit(1);
});
// lib/permissions.js

const PERMS = {
  VIEW_MAP: "VIEW_MAP",
  BUY_MARKET: "BUY_MARKET",
  VIEW_EVENTS: "VIEW_EVENTS",
  ENTER_GIVEAWAY: "ENTER_GIVEAWAY",
  SELL_MARKET: "SELL_MARKET",
  POST_CHANNEL: "POST_CHANNEL",
  CREATE_LISTING: "CREATE_LISTING",
  MESSAGE: "MESSAGE",
  MODERATE_CHANNEL: "MODERATE_CHANNEL",
  APPROVE_EVENTS: "APPROVE_EVENTS",
  INVENTORY_UPLOAD: "INVENTORY_UPLOAD",
  DONATE_GIVEAWAY: "DONATE_GIVEAWAY",
  ADMIN: "ADMIN"
};

const TIER_NAMES = {
  0: "Visitor",
  1: "Verified Visitor",
  2: "Verified Resident",
  3: "Moderator",
  4: "Local Business",
  5: "Admin"
};

function tierToPerms(tier) {
  const t = Number(tier) || 0;

  if (t >= 5) return Object.values(PERMS);

  if (t === 4) return [
    PERMS.VIEW_MAP,
    PERMS.BUY_MARKET,
    PERMS.VIEW_EVENTS,
    PERMS.ENTER_GIVEAWAY,
    PERMS.SELL_MARKET,
    PERMS.POST_CHANNEL,
    PERMS.CREATE_LISTING,
    PERMS.MESSAGE,
    PERMS.MODERATE_CHANNEL,
    PERMS.APPROVE_EVENTS,
    PERMS.INVENTORY_UPLOAD,
    PERMS.DONATE_GIVEAWAY
  ];

  if (t === 3) return [
    PERMS.VIEW_MAP,
    PERMS.BUY_MARKET,
    PERMS.VIEW_EVENTS,
    PERMS.ENTER_GIVEAWAY,
    PERMS.SELL_MARKET,
    PERMS.POST_CHANNEL,
    PERMS.CREATE_LISTING,
    PERMS.MESSAGE,
    PERMS.MODERATE_CHANNEL,
    PERMS.APPROVE_EVENTS
  ];

  if (t === 2) return [
    PERMS.VIEW_MAP,
    PERMS.BUY_MARKET,
    PERMS.VIEW_EVENTS,
    PERMS.ENTER_GIVEAWAY,
    PERMS.SELL_MARKET,
    PERMS.POST_CHANNEL,
    PERMS.CREATE_LISTING,
    PERMS.MESSAGE
  ];

  if (t === 1) return [
    PERMS.VIEW_MAP,
    PERMS.BUY_MARKET,
    PERMS.VIEW_EVENTS,
    PERMS.ENTER_GIVEAWAY
  ];

  return [PERMS.VIEW_MAP];
}

function hasPerm(user, perm) {
  if (!user) return false;

  const adminFlag = user.isAdmin ?? user.isadmin;
  if (adminFlag === true || Number(adminFlag) === 1) return true;

  const perms = tierToPerms(user.trustTier);
  return perms.includes(perm);
}

function tierName(tier) {
  const t = Number(tier) || 0;
  return TIER_NAMES[t] || TIER_NAMES[0];
}

module.exports = {
  PERMS,
  hasPerm,
  tierToPerms,
  tierName
};
