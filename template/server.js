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
const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const trust = require("./lib/trust");
const { canBuyAsVerifiedVisitor } = require("./lib/trust");
const { sendAdminEmail, sendEmail } = require("./lib/notify");
const db = require("./lib/db");
const cron = require("node-cron");
const TRUST_TIER_LABELS = trust.TRUST_TIER_LABELS;
const { getCurrentTown } = require("./config/towns");
const townCfg = getCurrentTown();
async function getTrustBadgeForUser(userId){
  if (!userId || isNaN(Number(userId))) return null;
  const user = await data.getUserById(userId);
  if(!user) return null;
  const ctx = await data.getTownContext(1, userId);
  const tier = trust.resolveTier(user, ctx);
  const isAdmin = !!(user.isAdmin ?? user.isadmin);
  return {
    userId: user.id,
    displayName: isAdmin ? (townCfg.emails?.adminDisplayName || townCfg.fullName) : await data.getDisplayNameForUser(user),
    trustTier: tier,
    trustTierLabel: TRUST_TIER_LABELS[tier] || "Visitor"
  };
}
const crypto = require("crypto");
const app = express();
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

// --- Uber Direct OAuth ---
let uberToken = null;
let uberTokenExpiry = 0;

async function getUberDirectToken() {
  if (uberToken && Date.now() < uberTokenExpiry) return uberToken;
  const res = await fetch('https://auth.uber.com/oauth/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.UBER_DIRECT_CLIENT_ID,
      client_secret: process.env.UBER_DIRECT_CLIENT_SECRET,
      grant_type: 'client_credentials',
      scope: 'eats.deliveries'
    })
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Uber auth failed: ' + JSON.stringify(data));
  uberToken = data.access_token;
  uberTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  console.log('UBER_TOKEN_REFRESHED');
  return uberToken;
}

// ============ SECURITY MIDDLEWARE ============

// Helmet - Security headers
let helmet;
try {
  helmet = require("helmet");
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://js.stripe.com", "https://connect.facebook.net", "https://unpkg.com", "https://www.googletagmanager.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://unpkg.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        connectSrc: ["'self'", "https://api.stripe.com", "https://graph.facebook.com", "https://api.tidesandcurrents.noaa.gov", "wss:", "https://accounts.google.com", "https://oauth2.googleapis.com", "https://www.googleapis.com", "https://www.googletagmanager.com", "https://www.google-analytics.com"],
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
    town: process.env.TOWN_NAME || townCfg.name
  });
});

// --- Town config injection for HTML files ---
// Builds a safe subset of town config for frontend use and injects it into HTML responses.
const townPublicConfig = {
  id: townCfg.id, slug: townCfg.slug, name: townCfg.name, fullName: townCfg.fullName,
  state: townCfg.state, stateFullName: townCfg.stateFullName, region: townCfg.region,
  productionUrl: townCfg.productionUrl,
  location: townCfg.location, address: townCfg.address,
  branding: townCfg.branding, theme: townCfg.theme,
  contact: townCfg.contact, legal: townCfg.legal,
  features: townCfg.features, content: townCfg.content,
  pageTitles: townCfg.pageTitles, meta: townCfg.meta,
  channels: townCfg.channels, delivery: townCfg.delivery,
  emails: { adminDisplayName: townCfg.emails?.adminDisplayName, deliveryFromName: townCfg.emails?.deliveryFromName, deliveryHtmlHeading: townCfg.emails?.deliveryHtmlHeading },
  shareText: townCfg.shareText, pulse: townCfg.pulse,
  safety: townCfg.safety, verification: townCfg.verification,
  localBiz: townCfg.localBiz
};
const townConfigScript = `<script>window.__TOWN_CONFIG__=${JSON.stringify(townPublicConfig)};</script>`;

app.use((req, res, next) => {
  // Only intercept .html requests (or bare paths that resolve to .html)
  let filePath = req.path;
  if (filePath.endsWith("/")) filePath += "index.html";
  if (!filePath.endsWith(".html")) return next();

  const fullPath = path.join(__dirname, "public", filePath);
  fs.readFile(fullPath, "utf8", (err, html) => {
    if (err) return next(); // fall through to static or 404
    // Inject config script before </head>
    const injected = html.replace("</head>", townConfigScript + "\n</head>");
    res.type("html").send(injected);
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
  if(req.path === "/api/webhooks/uber") return next();
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
    if(pathName === "/api/auth/google") return next();
    if(pathName === "/api/auth/google/callback") return next();
    if(pathName === "/api/auth/guest") return next();
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

// Public town config endpoint for frontend
app.get("/api/town", (_req, res) => res.json(townPublicConfig));

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
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) =>{
  const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  if(!stripe || !webhookSecret){
    console.error("Stripe webhook not configured - stripe:", !!stripe, "secret:", !!webhookSecret);
    return res.status(400).json({error:"Stripe not configured"});
  }
  const sig = req.headers["stripe-signature"];
  if(!sig) return res.status(400).json({error:"Missing signature"});
  let event;
  try{
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  }catch(err){
    console.error("Stripe webhook signature error:", err.message);
    return res.status(400).json({error:"Invalid signature"});
  }
  console.log("Stripe webhook received:", event.type);

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

      // --- Dispatch Uber Direct delivery if applicable ---
      try {
        const paidOrder = await data.getOrderById(orderId);
        const uberQuoteId = paidOrder.uber_quote_id || paidOrder.uberQuoteId || paidOrder.uberquoteid;
        const deliveryAddr = paidOrder.delivery_address || paidOrder.deliveryAddress || paidOrder.deliveryaddress;
        if (paidOrder && uberQuoteId && deliveryAddr) {
          const uberToken = await getUberDirectToken();
          const customerId = process.env.UBER_DIRECT_CUSTOMER_ID;
          const parsedAddr = typeof deliveryAddr === 'string' ? JSON.parse(deliveryAddr) : deliveryAddr;

          const placeResult = await db.query("SELECT name, pickup_address_full FROM places WHERE id=$1", [paidOrder.sellerplaceid || paidOrder.sellerPlaceId]);
          const place = placeResult.rows[0];

          const deliveryRes = await fetch(`https://api.uber.com/v1/customers/${customerId}/deliveries`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${uberToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              quote_id: uberQuoteId,
              pickup_name: place?.name || 'Store',
              pickup_address: JSON.stringify({ street_address: [place?.pickup_address_full || ''] }),
              pickup_phone_number: '+13215551234',
              dropoff_name: parsedAddr.name || 'Customer',
              dropoff_address: JSON.stringify({ street_address: [parsedAddr.street || ''] }),
              dropoff_phone_number: parsedAddr.phone || '+13215551234',
              manifest_items: [{ name: 'Order #' + orderId, quantity: 1 }]
            })
          });
          const deliveryData = await deliveryRes.json();
          if (deliveryRes.ok) {
            await db.query("UPDATE orders SET uber_delivery_id=$1, delivery_status=$2 WHERE id=$3", [deliveryData.id, deliveryData.status || 'pending', orderId]);
            console.log("UBER_DELIVERY_CREATED", { orderId, deliveryId: deliveryData.id });
          } else {
            console.error("UBER_DELIVERY_FAILED", { orderId, error: deliveryData });
          }
        }
      } catch (uberErr) {
        console.error("UBER_DISPATCH_ERROR", { orderId, error: uberErr.message });
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

    // Handle NEW SUBSCRIPTION SIGNUP
    const signupEmail = session?.metadata?.signupEmail;
    if (signupEmail) {
      const signupDisplayName = session?.metadata?.signupDisplayName || '';
      const signupPhone = session?.metadata?.signupPhone || '';
      const plan = session?.metadata?.plan || 'individual';
      const referredById = session?.metadata?.referredById || null;
      const businessName = session?.metadata?.businessName || '';
      const businessType = session?.metadata?.businessType || '';
      const businessAddress = session?.metadata?.businessAddress || '';
      const businessWebsite = session?.metadata?.businessWebsite || '';

      console.log("WEBHOOK: Processing subscription signup for:", signupEmail, "plan:", plan);

      try {
        // Check if user already exists
        const existingUser = await data.query(`SELECT id FROM users WHERE LOWER(email) = $1`, [signupEmail.toLowerCase()]);

        if (existingUser.rows.length === 0) {
          // Set trustTier based on plan: individual=1, business=3
          const trustTier = plan === 'business' ? 3 : 1;

          // Generate referral code
          const referralCode = (signupDisplayName.slice(0,3) + Math.random().toString(36).slice(2,7)).toUpperCase();

          // Create user
          const createResult = await data.query(
            `INSERT INTO users (email, displayName, phone, trustTier, stripeCustomerId, referralCode, referredByUserId, createdAt)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [signupEmail.toLowerCase(), signupDisplayName, signupPhone, trustTier, session.customer, referralCode, referredById || null, new Date().toISOString()]
          );
          const newUserId = createResult.rows[0]?.id;
          console.log("WEBHOOK: Created user", newUserId, "with trustTier", trustTier);

          // If business plan, create store/place
          if (plan === 'business' && newUserId) {
            const placeResult = await data.query(
              `INSERT INTO places (name, ownerUserId, sellerType, category, website, addressPublic, isFeatured, townId, districtId, status)
               VALUES ($1, $2, 'business', $3, $4, $5, 1, 1, 1, 'approved') RETURNING id`,
              [businessName || signupDisplayName, newUserId, businessType, businessWebsite, businessAddress]
            );
            console.log("WEBHOOK: Created business place", placeResult.rows[0]?.id, "for user", newUserId);
          }
        } else {
          // User exists - update their tier and stripe ID
          const trustTier = plan === 'business' ? 3 : 1;
          await data.query(
            `UPDATE users SET trustTier = $1, stripeCustomerId = $2 WHERE LOWER(email) = $3`,
            [trustTier, session.customer, signupEmail.toLowerCase()]
          );
          console.log("WEBHOOK: Updated existing user", signupEmail, "to trustTier", trustTier);
        }
      } catch (err) {
        console.error("WEBHOOK: Error creating subscription user:", err);
      }
    }

    // Handle existing user upgrade (from /api/subscription/start)
    const upgradeUserId = session.metadata?.userId;
    const upgradePlan = session.metadata?.plan;
    if(upgradeUserId && !signupEmail) {
      const uid = Number(upgradeUserId);
      const newTier = upgradePlan === 'business' ? 3 : 1;
      console.log("EXISTING_USER_UPGRADE", { userId: uid, plan: upgradePlan, newTier });
      await data.setUserTrustTier(1, uid, newTier);
      // Update stripeCustomerId
      const custId = session.customer;
      if(custId) {
        await data.query("UPDATE users SET stripeCustomerId=$1 WHERE id=$2", [custId, uid]);
      }
      // If business, create store if needed
      if(upgradePlan === 'business') {
        const existingStore = await data.getPlaceByOwnerId(uid);
        if(!existingStore) {
          const user = await data.getUserById(uid);
          await data.addPlace({ name: user?.displayName || 'My Store', ownerUserId: uid, townId: 1, districtId: 1, category: 'Retail Store', status: 'approved' });
          console.log("AUTO_CREATED_STORE_FOR_UPGRADE", { userId: uid });
        }
      }
      // Create business_subscriptions record for the store
      if(upgradePlan === 'business') {
        const store = await data.getPlaceByOwnerId(uid);
        if(store) {
          const subId = session.subscription;
          const custId = session.customer;
          await data.query(`
            INSERT INTO business_subscriptions (placeId, userId, plan, status, stripeCustomerId, stripeSubscriptionId, createdAt, updatedAt)
            VALUES ($1, $2, 'business', 'active', $3, $4, NOW(), NOW())
            ON CONFLICT (placeId) DO UPDATE SET status='active', stripeSubscriptionId=$4, updatedAt=NOW()
          `, [store.id, uid, custId, subId]);
          console.log("CREATED_BUSINESS_SUBSCRIPTION", { userId: uid, placeId: store.id, subscriptionId: subId });
        }
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
      const result = await data.query(`SELECT * FROM business_subscriptions WHERE stripeCustomerId = $1`, [customerId]);
      if(result.rows.length > 0) {
        const localSub = result.rows[0];
        // Only update periodEnd if we have a valid value from Stripe
        if(periodEnd) {
          await data.query(
            `UPDATE business_subscriptions SET status = $1, currentPeriodStart = COALESCE($2, currentPeriodStart), currentPeriodEnd = $3, canceledAt = $4, updatedAt = NOW() WHERE id = $5`,
            [status, periodStart, periodEnd, sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null, localSub.id]
          );
        } else {
          // Just update status, don't overwrite period dates with null
          await data.query(
            `UPDATE business_subscriptions SET status = $1, canceledAt = $2, updatedAt = NOW() WHERE id = $3`,
            [status, sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null, localSub.id]
          );
        }
        console.log("Subscription updated for customer:", customerId);
      } else {
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
      const result = await data.query(`SELECT * FROM business_subscriptions WHERE stripeCustomerId = $1`, [customerId]);
      if(result.rows.length > 0) {
        const localSub = result.rows[0];
        await data.query(
          `UPDATE business_subscriptions SET status = 'expired', canceledAt = NOW(), updatedAt = NOW() WHERE id = $1`,
          [localSub.id]
        );
        console.log("Subscription expired for customer:", customerId);
      }
    } catch(err) {
      console.error("Error expiring subscription:", err);
    }
  }

  res.json({ received:true });
});

// --- Uber Direct Delivery Webhook ---
app.post("/api/webhooks/uber", express.json(), async (req, res) => {
  try {
    const event = req.body;
    console.log("UBER_WEBHOOK", JSON.stringify(event));
    const deliveryId = event.id || event.delivery_id;
    const status = event.status || event.data?.status;
    if (!deliveryId || !status) {
      console.log("UBER_WEBHOOK_SKIP", { deliveryId, status });
      return res.status(200).json({ ok: true });
    }
    const result = await db.query(
      "UPDATE orders SET delivery_status=$1 WHERE uber_delivery_id=$2 RETURNING id, buyeruserid",
      [status, deliveryId]
    );
    if (result.rows.length > 0) {
      console.log("UBER_WEBHOOK_UPDATED", { orderId: result.rows[0].id, status, deliveryId });
      // Send delivery status email to customer
      try {
        const buyerId = result.rows[0].buyeruserid;
        const userResult = await db.query("SELECT email, displayname FROM users WHERE id=$1", [buyerId]);
        const buyer = userResult.rows[0];
        if (buyer && buyer.email) {
          const orderId = result.rows[0].id;
          const statusMessages = {
            'pickup': '🏪 A courier is heading to pick up your order!',
            'pickup_complete': '📦 Your order has been picked up and is on the way!',
            'dropoff': '🚗 Your delivery is arriving soon!',
            'delivered': '✅ Your order has been delivered! Enjoy!',
            'canceled': '❌ Your delivery has been canceled. Please contact us.',
            'returned': '↩️ Your delivery could not be completed.'
          };
          const msg = statusMessages[status] || `Your delivery status updated to: ${status}`;
          const trackUrl = (process.env.BASE_URL || townCfg.productionUrl) + '/delivery-tracking?orderId=' + orderId;

          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: townCfg.delivery.serviceName + ' <' + townCfg.contact.noReplyEmail + '>',
              to: buyer.email,
              subject: townCfg.emails.deliverySubjectPrefix + (status === 'delivered' ? 'Order Delivered!' : 'Delivery Update'),
              html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;"><h2 style="color:#2dd4bf;">${townCfg.emails.deliveryHtmlHeading}</h2><p>Hi ${buyer.displayname || 'there'},</p><p style="font-size:18px;">${msg}</p><p><a href="${trackUrl}" style="display:inline-block;padding:10px 20px;background:#2dd4bf;color:#0f172a;border-radius:8px;text-decoration:none;font-weight:bold;">Track Your Delivery</a></p><p style="color:#888;font-size:12px;">Order #${orderId}</p></div>`
            })
          });
          console.log("DELIVERY_EMAIL_SENT", { orderId, status, email: buyer.email });
        }
      } catch (emailErr) {
        console.error("DELIVERY_EMAIL_ERROR", emailErr.message);
      }
    } else {
      console.log("UBER_WEBHOOK_NO_MATCH", { deliveryId, status });
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("UBER_WEBHOOK_ERROR", err.message);
    res.status(200).json({ ok: true });
  }
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
app.get("/signup", (req, res) => res.redirect("/subscribe"));
app.get("/waitlist", async (req, res) =>res.sendFile(path.join(__dirname,"public","waitlist.html")));
app.get("/subscribe", (req, res) => res.sendFile(path.join(__dirname, "public", "subscribe.html")));
app.get("/subscribe/success", (req, res) => res.sendFile(path.join(__dirname, "public", "subscribe", "success.html")));
app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.get("/verify", (req, res) => res.sendFile(path.join(__dirname, "public", "verify.html")));
app.get("/apply/business", async (req, res) =>res.sendFile(path.join(__dirname,"public","apply_business.html")));
app.get("/apply/resident", async (req, res) =>res.sendFile(path.join(__dirname,"public","apply_resident.html")));
app.get("/privacy", async (req, res) =>res.sendFile(path.join(__dirname,"public","privacy.html")));
app.get("/terms", async (req, res) =>res.sendFile(path.join(__dirname,"public","terms.html")));
app.get("/order-confirmed", (req, res) => res.sendFile(path.join(__dirname, "public", "order-confirmed.html")));
app.get("/u/:id", async (req, res) =>res.sendFile(path.join(__dirname,"public","profile.html")));
app.get("/me/store", async (req, res) =>res.sendFile(path.join(__dirname,"public","store_profile.html")));
app.get("/me/profile", async (req, res) =>res.sendFile(path.join(__dirname,"public","my_profile.html")));
app.get("/me/subscription", async (req, res) =>res.sendFile(path.join(__dirname,"public","my_subscription.html")));
app.get("/my-subscription", async (req, res) =>res.redirect("/me/subscription"));
app.get("/me/orders", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  res.sendFile(path.join(__dirname,"public","my_orders.html"));
});
app.get("/me/seller/orders", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  res.sendFile(path.join(__dirname,"public","seller_orders.html"));
});
app.get("/me/hub", async (req, res) =>res.redirect("/me/store"));
app.get("/pay/success", async (req, res) =>res.sendFile(path.join(__dirname,"public","pay_success.html")));
app.get("/pay/cancel", async (req, res) =>res.sendFile(path.join(__dirname,"public","pay_cancel.html")));
app.get("/pay/:id", async (req, res) =>res.sendFile(path.join(__dirname,"public","pay.html")));
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

function getAdminReviewLink(){
  const base = (process.env.PUBLIC_BASE_URL || process.env.SITE_URL || process.env.APP_URL || "").toString().trim();
  if(!base) return "/admin/applications";
  return `${base.replace(/\/$/,"")}/admin/applications`;
}

async function getSweepPrizeInfo(sweep, snapshotPrize){
  if(snapshotPrize && snapshotPrize.title) return snapshotPrize;
  // Find the prize offer linked to this specific sweepstake via giveaway_offers
  let offer = null;
  let giveawayEstimatedValue = 0; // giveaway_offers.estimatedValue is already in cents
  if(sweep?.id){
    try {
      const giveaway = await data.getGiveawayOfferBySweepstakeId(sweep.id);
      giveawayEstimatedValue = Math.round(giveaway?.estimatedvalue || giveaway?.estimatedValue || 0);
      const prizeOfferId = giveaway?.prizeOfferId || giveaway?.prize_offer_id || null;
      if(prizeOfferId){
        offer = await data.getPrizeOfferById(prizeOfferId);
      }
      // If no prize_offer link, use giveaway_offer data directly
      if(!offer && giveaway){
        offer = giveaway;
      }
    } catch(_){}
  }
  // Fallback: first active prize offer (legacy behavior)
  if(!offer){
    const offers = await data.listActivePrizeOffers();
    offer = offers[0];
  }
  const title = (offer?.title || sweep?.prize || sweep?.title || "").toString().trim();
  const donorName = (offer?.donordisplayname || offer?.donorDisplayName || "").toString().trim();
  const donorPlaceId = offer?.donorplaceid || offer?.donorPlaceId || offer?.placeid || offer?.placeId || null;
  const donorUserId = offer?.donoruserid || offer?.donorUserId || offer?.userid || offer?.userId || null;
  const imageUrl = (offer?.imageurl || offer?.imageUrl || "").toString().trim();
  // Prefer giveaway_offer.estimatedValue (already in cents, source of truth)
  // over prize_offer.valueCents (which may be 100x inflated from prior bug)
  let valueCents = giveawayEstimatedValue;
  if(!valueCents){
    valueCents = offer?.valuecents || offer?.valueCents || 0;
  }
  if(!valueCents && (offer?.estimatedvalue || offer?.estimatedValue)){
    valueCents = Math.round(offer.estimatedvalue || offer.estimatedValue);
  }
  const description = (offer?.description || "").toString().trim();

  // Resolve business name from place if donorName is just a username
  let businessName = donorName;
  if(donorPlaceId){
    try {
      const place = await data.getPlaceById(donorPlaceId);
      if(place && place.name) businessName = place.name;
    } catch(e) {}
  }

  return {
    title, donorName: businessName, donorUserId, donorPlaceId, prizeOfferId: offer?.id ?? null,
    imageUrl, valueCents, description, businessName
  };
}

async function getSweepDrawContext(draw){
  if(!draw) return { sweep: null, prize: null, snapshot: {} };
  const sweep = await data.getSweepstakeById(draw.sweepId);
  let snapshot = {};
  try{ snapshot = draw.snapshotJson ? (typeof draw.snapshotJson === "string" ? JSON.parse(draw.snapshotJson) : draw.snapshotJson) : {}; }catch(_){}
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

async function notifySweepDrawUsers({ draw, sweep, winner, prize, adminId, force }){
  console.log("SWEEP_NOTIFY_START", { drawId: draw?.id, winnerId: winner?.userId, adminId, force: !!force, notified: draw?.notified });
  if(!draw?.id || !winner?.userId){
    console.warn("SWEEP_NOTIFY_SKIP: missing draw.id or winner.userId", { drawId: draw?.id, winnerId: winner?.userId });
    return { sent: false, reason: "missing draw or winner" };
  }
  if(!force && Number(draw.notified) === 1){
    console.warn("SWEEP_NOTIFY_SKIP: already notified", { drawId: draw.id, notified: draw.notified });
    return { sent: false, reason: "already notified" };
  }
  const prizeTitle = (prize?.title || sweep?.prize || sweep?.title || "Prize").toString().trim();
  const donorUserId = await resolveSweepDonorUserId(prize);
  const donorName = await resolveSweepDonorName(prize, donorUserId) || "Donor";
  const winnerUser = await data.getUserById(winner.userId);
  const winnerName = winner.displayName || (winnerUser ? await data.getDisplayNameForUser(winnerUser) : "Winner");
  const drawnAt = draw.createdAt || new Date().toISOString();
  const systemPrefix = "[SYSTEM] ";
  const isSameUser = donorUserId && Number(donorUserId) === Number(winner.userId);
  console.log("SWEEP_NOTIFY_RESOLVED", { prizeTitle, donorUserId, donorName, winnerName, winnerEmail: winnerUser?.email || null, isSameUser });

  const result = { sent: true, dmSent: false, emailSent: false, donorDmSent: false, donorEmailSent: false };
  try{
    // 1. Always DM the winner via admin conversation
    const winnerConvo = await data.addDirectConversation(adminId, winner.userId);
    console.log("SWEEP_NOTIFY_WINNER_CONVO", { convoId: winnerConvo?.id, adminId, winnerId: winner.userId });
    if(winnerConvo?.id){
      const msg = isSameUser
        ? `${systemPrefix}\uD83C\uDF89 Congratulations! You won your own giveaway: ${prizeTitle}! Since you're also the donor, no coordination needed. Draw ID: ${draw.id}`
        : `${systemPrefix}\uD83C\uDF89 Congratulations! You won: ${prizeTitle}! Donated by ${donorName}. Check your inbox for a thread with the donor to coordinate pickup/delivery. Draw ID: ${draw.id}`;
      const dmResult = await data.addDirectMessage(winnerConvo.id, adminId, msg);
      console.log("SWEEP_NOTIFY_WINNER_DM", { messageId: dmResult?.id, convoId: winnerConvo.id });
      result.dmSent = !!dmResult?.id;
    } else {
      console.warn("SWEEP_NOTIFY_WINNER_CONVO_FAILED: no convo id");
    }

    // 2. Always email the winner
    if(winnerUser?.email){
      const winnerEmailText = isSameUser
        ? `Congratulations!\n\nYou won your own giveaway prize: ${prizeTitle}!\n\nSince you are also the prize donor, no further coordination is needed.\n\nDraw ID: ${draw.id}\nDrawn: ${drawnAt}\n\nThank you for supporting the community!`
        : `Congratulations!\n\nYou won: ${prizeTitle}!\nDonated by: ${donorName}\n\nPlease check your inbox on the app for a message thread with the donor to coordinate pickup or delivery.\n\nDraw ID: ${draw.id}\nDrawn: ${drawnAt}\n\nThank you for being part of our community!`;
      console.log("SWEEP_NOTIFY_WINNER_EMAIL_ATTEMPT", { to: winnerUser.email, subject: `You won: ${prizeTitle}!` });
      const emailResult = await sendEmail(winnerUser.email, `\uD83C\uDF89 You won: ${prizeTitle}!`, winnerEmailText);
      result.emailSent = !!emailResult?.ok;
      console.log("SWEEP_NOTIFY_WINNER_EMAIL_RESULT", emailResult);
    } else {
      console.warn("SWEEP_NOTIFY_NO_WINNER_EMAIL", { winnerId: winner.userId, email: winnerUser?.email });
    }

    // 3. If donor is different from winner, DM + email the donor, and create coordination thread
    if(donorUserId && !isSameUser){
      const coordConvo = await data.addDirectConversation(winner.userId, donorUserId);
      console.log("SWEEP_NOTIFY_COORD_CONVO", { convoId: coordConvo?.id });
      if(coordConvo?.id){
        await data.addDirectMessage(coordConvo.id, adminId, `${systemPrefix}\uD83C\uDF81 Prize Coordination: ${winnerName} won ${prizeTitle}. Please use this thread to arrange pickup/delivery.\nDraw ID: ${draw.id} | Drawn: ${drawnAt}`);
      }
      const donorConvo = await data.addDirectConversation(adminId, donorUserId);
      console.log("SWEEP_NOTIFY_DONOR_CONVO", { convoId: donorConvo?.id });
      if(donorConvo?.id){
        const donorDm = await data.addDirectMessage(donorConvo.id, adminId, `${systemPrefix}${winnerName} won your prize: ${prizeTitle}! Please check your inbox for a thread with the winner to coordinate pickup/delivery. Draw ID: ${draw.id}`);
        result.donorDmSent = !!donorDm?.id;
      }
      const donorUser = await data.getUserById(donorUserId);
      if(donorUser?.email){
        console.log("SWEEP_NOTIFY_DONOR_EMAIL_ATTEMPT", { to: donorUser.email });
        const donorEmailResult = await sendEmail(donorUser.email, `Your prize "${prizeTitle}" has been won!`, `Hello,\n\n${winnerName} has won your donated prize: ${prizeTitle}!\n\nPlease check your inbox on the app for a message thread with the winner to coordinate pickup or delivery.\n\nDraw ID: ${draw.id}\nDrawn: ${drawnAt}\n\nThank you for supporting the community!`);
        result.donorEmailSent = !!donorEmailResult?.ok;
        console.log("SWEEP_NOTIFY_DONOR_EMAIL_RESULT", donorEmailResult);
      }
    }

    await data.setSweepDrawNotified(draw.id);
    console.log("SWEEP_NOTIFY_COMPLETE", result);
    return result;
  }catch(err){
    console.error("SWEEP_NOTIFY_FAILED", err?.message || err, err?.stack);
    return { sent: false, reason: err?.message || "unknown error" };
  }
}

async function buildSweepParticipants(sweepId){
  const rows = await data.listSweepstakeParticipants(sweepId);
  const participants = await Promise.all(rows.map(async (row)=>{
    const user = await data.getUserById(row.userId);
    let displayName = await data.getDisplayNameForUser(user);
    // Show store/place name if user owns one
    try {
      const place = await data.getPlaceByOwnerId(row.userId);
      if(place && place.name) displayName = place.name;
    } catch(_){}
    return {
      userId: Number(row.userId),
      displayName,
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
    try{ snapshot = typeof draw.snapshotJson === "string" ? JSON.parse(draw.snapshotJson) : draw.snapshotJson; }catch(_){}
  }
  const prize = await getSweepPrizeInfo(sweep, snapshot.prize);
  const donor = {
    businessName: prize.businessName || prize.donorName || "",
    name: prize.donorName || "",
    placeId: prize.donorPlaceId,
    avatarUrl: "",
    website: "",
    description: ""
  };
  if(prize.donorPlaceId){
    try {
      const donorPlace = await data.getPlaceById(prize.donorPlaceId);
      if(donorPlace){
        donor.avatarUrl = donorPlace.avatarUrl || donorPlace.avatarurl || "";
        donor.website = donorPlace.website || "";
        donor.description = donorPlace.description || "";
        if(!donor.businessName) donor.businessName = donorPlace.name || "";
      }
    } catch(e) {}
  }
  const winnerUserId = draw?.winnerUserId || sweep.winnerUserId || null;
  let winner = null;
  if(winnerUserId){
    const participant = participants.find(p=>Number(p.userId)===Number(winnerUserId));
    let displayName = participant?.displayName || "";
    if(!displayName){
      const winnerUser = await data.getUserById(winnerUserId);
      displayName = await data.getDisplayNameForUser(winnerUser);
      try { const place = await data.getPlaceByOwnerId(winnerUserId); if(place?.name) displayName = place.name; } catch(_){}
    }
    winner = { userId: Number(winnerUserId), displayName, entries: participant?.entries || 0 };
  }
  const u = await getUserId(req);
  const userEntries = u ? await data.getUserEntriesForSweepstake(sweep.id, u) : 0;
  const balance = u ? await data.getSweepBalance(u) : 0;
  return {
    sweepstake: sweep,
    totals,
    participants,
    winner,
    prize,
    donor,
    drawId: draw?.id || null,
    createdAt: draw?.createdAt || "",
    userEntries,
    balance
  };
}

async function sendAuthCodeEmail(toEmail, code){
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  const from = (process.env.EMAIL_FROM || "").trim() || "onboarding@resend.dev";

  // Redirect house/seed account emails to support inbox
  const supportDomain = townCfg.contact.supportEmail.split("@")[1];
  const deliverTo = toEmail.endsWith("@" + supportDomain) ? townCfg.contact.supportEmail : toEmail;
  console.log("AUTH_CODE_EMAIL_ATTEMPT", { to: deliverTo, forAccount: toEmail, from });

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
  <p>Login code for <strong>${toEmail}</strong>:</p>
  <div style="background-color: #f5f5f5; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
    <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #333;">${code}</span>
  </div>
  <p style="color: #666;">This code expires in 10 minutes.</p>
  <p style="color: #999; font-size: 12px;">If you didn't request this code, you can safely ignore this email.</p>
</body>
</html>`;

  const payload = {
    from,
    to: [deliverTo],
    subject: townCfg.emails.loginCodeSubject,
    text: `Login code for ${toEmail}: ${code}\n\nThis code expires in 10 minutes.`,
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
  <p>Great news! ${townCfg.emails.approvalBody.replace("{{applicationType}}", '<strong>' + applicationType + '</strong>')}</p>
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
    subject: townCfg.emails.approvalSubject,
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
  const trustTier = ctx.trustTier ?? user.trustTier ?? user.trusttier ?? 0;
  const effectiveUser = { ...user, trustTier };
  const permKey = permissions.PERMS[perm] || perm;
  let allowed = permissions.hasPerm(effectiveUser, permKey);
  if (!allowed && (perm === "BUY_MARKET" || perm === "BID_AUCTIONS")) {
    if (canBuyAsVerifiedVisitor(user)) {
      allowed = true;
    }
  }
  if(!allowed){
    console.log("PERM_DENIED:", { userId, perm, permKey, trustTier, userTrustTier: user.trustTier, userTrusttier: user.trusttier, ctxMembership: ctx.membership });
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
  return stripe;
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
  const buyerId = order.buyerUserId ?? order.buyeruserid;
  if(buyerId) await data.clearCart(Number(buyerId));
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

// Google OAuth
app.get("/api/auth/google", (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if(!clientId) return res.status(500).json({ error: "Google OAuth not configured" });
  const redirectUri = encodeURIComponent((process.env.BASE_URL || townCfg.productionUrl) + "/api/auth/google/callback");
  const scope = encodeURIComponent("openid email profile");
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&prompt=select_account`;
  res.redirect(url);
});

app.get("/api/auth/google/callback", async (req, res) => {
  try {
    const code = req.query.code;
    if(!code) return res.redirect("/login?error=no_code");
    const baseUrl = process.env.BASE_URL || townCfg.productionUrl;
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: baseUrl + "/api/auth/google/callback",
        grant_type: "authorization_code"
      })
    });
    const tokenData = await tokenRes.json();
    if(!tokenData.access_token) {
      console.error("GOOGLE_AUTH_TOKEN_ERROR", tokenData);
      return res.redirect("/login?error=token_failed");
    }
    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const profile = await userRes.json();
    if(!profile.email) return res.redirect("/login?error=no_email");
    const email = profile.email.toLowerCase();
    const displayName = profile.name || email.split("@")[0];
    let userRow = await data.getUserByEmail(email);
    if(!userRow) {
      const referralCode = (displayName.slice(0,3) + Math.random().toString(36).slice(2,7)).toUpperCase();
      await data.query(
        `INSERT INTO users (email, displayname, trusttier, referralcode, createdat) VALUES ($1, $2, $3, $4, $5)`,
        [email, displayName, 1, referralCode, new Date().toISOString()]
      );
      userRow = await data.getUserByEmail(email);
      console.log("GOOGLE_AUTH_NEW_USER", { userId: userRow.id, email, displayName });
    }
    const s = await data.createSession(userRow.id);
    const isSecure = req.headers["x-forwarded-proto"] === "https" || req.protocol === "https";
    res.setHeader("Set-Cookie", `sid=${s.sid}; HttpOnly; Path=/; Max-Age=${60*60*24*30}; SameSite=Lax${isSecure ? "; Secure" : ""}`);
    res.redirect("/");
  } catch(err) {
    console.error("GOOGLE_AUTH_ERROR", err?.message);
    res.redirect("/login?error=auth_failed");
  }
});

app.post("/api/auth/verify-code", async (req, res) =>{
  const email = (req.body?.email || "").toString().trim().toLowerCase();
  const code = (req.body?.code || "").toString().trim();
  if(!email || !code) return res.status(400).json({ error: "Email and code required" });

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
      if(/^\d+$/.test(referralCode)){
        referrer = await data.getUserById(Number(referralCode));
      }else if(referralCode.includes("@")){
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

  const s = await data.createSession(result.userId);
  setCookie(res,"sid",s.sid,{httpOnly:true,maxAge:60*60*24*30,secure:isHttpsRequest(req)});
  res.json({ ok: true, userId: result.userId });
});

// Guest auth for managed store checkout (no password/verification required)
app.post("/api/auth/guest", async (req, res) => {
  try {
    const { email, placeId } = req.body || {};
    if (!email || !placeId) {
      return res.status(400).json({ error: "email and placeId are required" });
    }
    const place = await data.getPlaceById(Number(placeId));
    if (!place || (place.storeType || place.storetype) !== "managed") {
      return res.status(403).json({ error: "Guest checkout not available" });
    }
    const user = await data.upsertUserByEmail(email);
    if (!user) {
      return res.status(400).json({ error: "Invalid email" });
    }
    const s = await data.createSession(user.id);
    setCookie(res, "sid", s.sid, { httpOnly: true, maxAge: 60 * 60 * 24 * 30, secure: isHttpsRequest(req) });
    res.json({ success: true, userId: user.id });
  } catch (err) {
    console.error("GUEST_AUTH_ERROR", err?.message);
    res.status(500).json({ error: "Internal server error" });
  }
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
    inTown: (req.body?.inTown || req.body?.inSebastian || "").toString().trim(),
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
    yearsInTown: (req.body?.yearsInTown || req.body?.yearsInSebastian || "").toString().trim(),
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
      isAdmin: isAdminUser(r.user),
      isBuyerVerified: Number(r.user.isBuyerVerified ?? r.user.isbuyerverified ?? 0)
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
  const u=await requireLogin(req,res); if(!u) return;
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
  const u=await requireLogin(req,res); if(!u) return;
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
  res.json({ ...ctx, userId: u, trustTier: tier, trustTierLabel: tierName, tierName, permissions, limits });
});

function isInsideTown(lat, lng, accuracyMeters){
  const maxAccuracy = 200;
  if(!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok:false, error:"Invalid coordinates" };
  if(!Number.isFinite(accuracyMeters) || accuracyMeters > maxAccuracy){
    return { ok:false, error:"Accuracy must be <= 200 meters" };
  }
  const center = { lat: townCfg.location.lat, lng: townCfg.location.lng };
  const radiusMeters = townCfg.location.radiusMeters;
  const toRad = (d)=>d * Math.PI / 180;
  const dLat = toRad(lat - center.lat);
  const dLng = toRad(lng - center.lng);
  const a = Math.sin(dLat/2) ** 2 +
            Math.cos(toRad(center.lat)) * Math.cos(toRad(lat)) *
            Math.sin(dLng/2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = 6371000 * c;
  if(distance > radiusMeters) return { ok:false, error: townCfg.verification.outsideZoneMessage };
  return { ok:true };
}

function isInsideTownBox(lat, lng){
  if(!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok:false, error:"Invalid coordinates" };
  const bounds = townCfg.location.boundingBox;
  if(lat < bounds.minLat || lat > bounds.maxLat || lng < bounds.minLng || lng > bounds.maxLng){
    return { ok:false, error: townCfg.verification.outsideBoxMessage };
  }
  // Geofence bounds loaded from town config
  return { ok:true };
}

app.post("/api/presence/verify", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  const accuracyMeters = Number(req.body?.accuracyMeters);
  const check = isInsideTown(lat, lng, accuracyMeters);
  if(!check.ok) return res.status(400).json({ ok:false, inside:false, error: check.error });
  const updated = await data.updateUserPresence(u, { lat, lng, accuracyMeters });
  res.json({ ok:true, inside:true, presenceVerifiedAt: updated.presenceVerifiedAt });
});

app.post("/api/verify/location", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  const check = isInsideTownBox(lat, lng);
  if(!check.ok) return res.status(400).json({ ok:false, inside:false, error: check.error });
  await data.setUserLocationVerified(u, true);
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

app.post("/api/verify/buyer", async (req, res) => {
  const { fullName, email, password, address, city, phone } = req.body;
  if (!fullName || !email || !password || !address || !city) {
    return res.status(400).json({ error: "Name, email, password, address, and city are required" });
  }
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
  const existing = await db.query("SELECT id FROM users WHERE LOWER(email)=$1", [email.toLowerCase()]);
  if (existing.rows.length > 0) return res.status(400).json({ error: "Email already registered" });
  const addressJson = JSON.stringify({ fullName, address, city, phone: phone || null });
  const passwordHash = require("crypto").createHash("sha256").update(password).digest("hex");
  const result = await db.query(
    "INSERT INTO users (email, displayName, addressJson, isBuyerVerified, trustTier, createdAt, passwordHash) VALUES ($1,$2,$3,0,1,NOW(),$4) RETURNING id",
    [email.toLowerCase(), fullName, addressJson, passwordHash]
  );
  res.json({ ok: true, message: "Account created - pending admin approval", userId: result.rows[0].id });
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
    if(Number(user?.locationVerified || user?.locationverified || 0) !== 1){
      return res.status(400).json({error: townCfg.verification.locationRequiredError});
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
  const u=await requireLogin(req,res); if(!u) return;
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
app.get("/api/events/stats", async (req, res) =>{
  const access = await requirePerm(req,res,"VIEW_EVENTS"); if(!access) return;
  res.json(await data.getEventStats());
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
  const u=await requireLogin(req,res); if(!u) return;
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
  const access = await requirePerm(req,res,"BUY_MARKET"); if(!access) return;
  const u=access.userId;
  const items = await data.getCartItemsByUser(u);
  const listings = await data.getListings();
  const places = await data.getPlaces();
  const placeMap = new Map(places.map(p=>[Number(p.id), p]));
  const enriched = items.map((item)=>{
    const listing = listings.find(l=>Number(l.id)===Number(item.listingId));
    const place = listing ? placeMap.get(Number(listing.placeId)) : null;
    const priceCents = Math.round(Number(listing?.price || 0) * 100);
    return {
      id: item.id,
      listingId: item.listingId,
      quantity: item.quantity,
      title: listing?.title || "",
      listingType: listing?.listingType || "item",
      priceCents,
      placeId: listing?.placeId || null,
      placeName: place?.name || ""
    };
  });
  res.json({ items: enriched });
});
app.post("/api/cart/add", async (req, res) =>{
  const u=await requireBuyerTier(req,res); if(!u) return;
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
  const access = await requirePerm(req,res,"BUY_MARKET"); if(!access) return;
  const u=access.userId;
  const listingId = Number(req.body?.listingId || 0);
  if(!listingId) return res.status(400).json({error:"listingId required"});
  await data.removeCartItem(u, listingId);
  res.json({ ok:true });
});
app.post("/api/cart/clear", async (req, res) =>{
  const access = await requirePerm(req,res,"BUY_MARKET"); if(!access) return;
  const u=access.userId;
  await data.clearCart(u);
  res.json({ ok:true });
});

app.post("/api/checkout/create", async (req, res) =>{
  const u=await requireBuyerTier(req,res); if(!u) return;
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
  const deliveryAddress = req.body?.deliveryAddress || null;
  const deliveryFeeCents = Number(req.body?.deliveryFeeCents || 0);
  const uberQuoteId = (req.body?.uberQuoteId || "").toString();
  const serviceGratuityCents = 0; // Subscription model - no commission
  const storePlace = placeMap.get(Number(placeId));
  const isManaged = (storePlace?.storetype || storePlace?.storeType || 'peer') === 'managed';
  const shippingFeeCents = isManaged ? 1500 : 0;
  const totalCents = subtotalCents + serviceGratuityCents + (deliveryFeeCents || 0) + shippingFeeCents;
  const order = await data.createOrderFromCart({
    townId: 1,
    listingId: items[0].listingId,
    buyerUserId: u,
    sellerUserId,
    sellerPlaceId: placeId,
    quantity: items.reduce((sum, i)=>sum + i.quantity, 0),
    amountCents: totalCents,
    status: "pending_payment",
    paymentProvider: "stripe",
    paymentIntentId: "",
    subtotalCents,
    serviceGratuityCents,
    totalCents,
    fulfillmentType: (req.body?.fulfillmentType || "").toString(),
    fulfillmentNotes: (req.body?.fulfillmentNotes || "").toString(),
    deliveryAddress: deliveryAddress ? JSON.stringify(deliveryAddress) : null,
    deliveryFeeCents,
    uberQuoteId
  }, items);
  await data.createPaymentForOrder(order.id, totalCents, "stripe");

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
  res.json({ orderId: order.id, paymentStatus: "requires_payment", totals: { subtotalCents, serviceGratuityCents, totalCents } });
});
app.post("/api/checkout/stripe", async (req,res)=>{
  const u=await requireBuyerTier(req,res); if(!u) return;
  const s = requireStripeConfig(res); if(!s) return;
  const orderId = Number(req.body?.orderId || 0);
  if(!orderId) return res.status(400).json({error:"orderId required"});
  const order = await data.getOrderById(orderId);
  if(!order) return res.status(404).json({error:"Order not found"});
  if(Number(order.buyerUserId)!==Number(u)) return res.status(403).json({error:"Buyer only"});
  if(!["pending_payment","requires_payment"].includes(String(order.status||""))) return res.status(400).json({error:"Order not payable"});
  const items = await data.getOrderItems(order.id);
  if(!items.length) return res.status(400).json({error:"Order has no items"});
  const lineItems = items.map((item)=>({
    price_data: {
      currency: "usd",
      product_data: { name: item.titleSnapshot || item.titlesnapshot || `Item ${item.listingId}` },
        unit_amount: Math.max(0, parseInt(String(item.priceCentsSnapshot ?? item.priceCentssnapshot ?? item.pricecentssnapshot ?? "0"), 10) || 0)
    },
    quantity: Number(item.quantity || 1)
  }));
  if(Number(order.serviceGratuityCents || 0) > 0){
    lineItems.push({
      price_data: {
        currency: "usd",
        product_data: { name: "Service Gratuity" },
        unit_amount: Math.max(0, parseInt(String(order.serviceGratuityCents ?? "0"), 10) || 0)
      },
      quantity: 1
    });
  }
  const deliveryFee = Number(order.delivery_fee_cents || order.deliveryFeeCents || order.deliveryfeecents || 0);
  if (deliveryFee > 0) {
    lineItems.push({
      price_data: {
        currency: 'usd',
        product_data: { name: 'Delivery Fee' },
        unit_amount: deliveryFee
      },
      quantity: 1
    });
  }
  const orderPlaceId = order.sellerPlaceId ?? order.sellerplaceid;
  const orderPlace = orderPlaceId ? await data.getPlaceById(Number(orderPlaceId)) : null;
  const orderIsManaged = (orderPlace?.storetype || orderPlace?.storeType || 'peer') === 'managed';
  if (orderIsManaged) {
    lineItems.push({
      price_data: {
        currency: 'usd',
        product_data: { name: 'Flat Rate Shipping' },
        unit_amount: 1500
      },
      quantity: 1
    });
  }
  const baseUrl = process.env.BASE_URL || townCfg.productionUrl;
  const successUrl = `${baseUrl}/pay/success?orderId=${order.id}`;
  const cancelUrl = `${baseUrl}/pay/cancel?orderId=${order.id}`;
  try{
    const session = await s.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        orderId: String(order.id),
        townId: String(order.townId || 1),
        buyerUserId: String(order.buyerUserId)
      },
      client_reference_id: String(order.id)
    });
    await data.updateOrderPayment(order.id, "stripe", session.id || "");
    const existingPayment = await data.getPaymentForOrder(order.id);
    if(!existingPayment) await data.createPaymentForOrder(order.id, Number(order.totalCents || 0), "stripe");
    res.json({ checkoutUrl: session.url });
  }catch(e){
    res.status(500).json({error:"Stripe checkout failed"});
  }
});

// --- Uber Direct: Get Delivery Quote ---
app.post("/api/delivery/quote", async (req, res) => {
  try {
    const userId = await requireLogin(req, res);
    if (!userId) return;
    const { placeId, dropoffAddress, dropoffName, dropoffPhone } = req.body;
    if (!placeId || !dropoffAddress) return res.status(400).json({ error: "placeId and dropoffAddress required" });

    const placeResult = await db.query("SELECT id, name, pickup_address_full, storetype FROM places WHERE id=$1", [placeId]);
    const place = placeResult.rows[0];
    if (!place) return res.status(404).json({ error: "Store not found" });
    if (place.storetype !== 'managed') return res.status(400).json({ error: "Delivery only available for managed stores" });
    if (!place.pickup_address_full) return res.status(400).json({ error: "Store pickup address not configured" });

    const token = await getUberDirectToken();
    const customerId = process.env.UBER_DIRECT_CUSTOMER_ID;
    const quoteRes = await fetch(`https://api.uber.com/v1/customers/${customerId}/delivery_quotes`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        pickup_address: JSON.stringify({ street_address: [place.pickup_address_full] }),
        dropoff_address: JSON.stringify({ street_address: [dropoffAddress] })
      })
    });
    const quoteData = await quoteRes.json();
    if (!quoteRes.ok) {
      console.error("UBER_QUOTE_ERROR", quoteData);
      return res.status(400).json({ error: "Could not get delivery quote", details: quoteData });
    }
    console.log("UBER_QUOTE_SUCCESS", { placeId, fee: quoteData.fee, duration: quoteData.duration });
    res.json({
      quoteId: quoteData.id,
      feeCents: quoteData.fee,
      currency: quoteData.currency,
      estimatedMinutes: quoteData.duration,
      pickupEta: quoteData.pickup_duration,
      dropoffEta: quoteData.dropoff_eta,
      expires: quoteData.expires
    });
  } catch (err) {
    console.error("DELIVERY_QUOTE_ERROR", err.message);
    res.status(500).json({ error: "Failed to get delivery quote" });
  }
});

// --- Delivery tracking for customers ---
app.get("/api/orders/:id/delivery", async (req, res) => {
  try {
    const userId = await requireLogin(req, res);
    if (!userId) return;
    const orderId = Number(req.params.id);
    const result = await db.query(
      "SELECT id, buyeruserid, delivery_status, delivery_address, delivery_fee_cents, uber_delivery_id FROM orders WHERE id=$1",
      [orderId]
    );
    const order = result.rows[0];
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (Number(order.buyeruserid) !== userId) return res.status(403).json({ error: "Not your order" });
    const addr = order.delivery_address;
    const street = typeof addr === 'object' && addr ? addr.street : (typeof addr === 'string' ? JSON.parse(addr).street : '');
    res.json({
      orderId: order.id,
      deliveryStatus: order.delivery_status || 'pending',
      deliveryAddress: street,
      deliveryFeeCents: Number(order.delivery_fee_cents || order.deliveryfeecents || 0),
      uberDeliveryId: order.uber_delivery_id || ''
    });
  } catch (err) {
    console.error("DELIVERY_TRACKING_ERROR", err.message);
    res.status(500).json({ error: "Failed to load tracking" });
  }
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
app.get("/api/orders/:id/detail", async (req, res) => {
  const u = await requireLogin(req, res); if (!u) return;
  const order = await data.getOrderById(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (Number(order.buyerUserId) !== Number(u) && Number(order.sellerUserId) !== Number(u)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const items = await data.getOrderItems(order.id);
  const buyer = await data.getUserById(order.buyerUserId);
  const seller = order.sellerUserId ? await data.getUserById(order.sellerUserId) : null;
  const place = order.sellerPlaceId ? await data.getPlaceById(order.sellerPlaceId) : null;
  const listing = items[0]?.listingId ? await data.getListingById(items[0].listingId) : null;

  const enrichedItems = items.map(item => ({
    ...item,
    title: listing?.title || item.title || 'Item',
    priceCents: item.priceCents || listing?.price * 100 || 0
  }));

  res.json({ order, items: enrichedItems, buyer, seller, place });
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
  const place = order.sellerPlaceId ? await data.getPlaceById(order.sellerPlaceId) : null;
  res.json({ order, items, listing, storeType: place?.storeType || place?.storetype || 'peer' });
});
app.post("/api/orders/:id/pay", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  if(process.env.NODE_ENV === "production") return res.status(403).json({error:"Dev-only endpoint"});
  const order=await data.getOrderById(req.params.id);
  if(!order) return res.status(404).json({error:"Order not found"});
  if(Number(order.buyerUserId)!==Number(u)) return res.status(403).json({error:"Buyer only"});
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
  res.sendFile(path.join(__dirname, "public", "order.html"));
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
  try{
    await data.tryAwardSweepForEvent({
      townId: 1,
      userId: u,
      ruleType: "review_left",
      eventKey: `review:${created.id}`,
      meta: { orderId: order.id, rating }
    });
  }catch(err){
    console.error("SWEEP_AWARD_REVIEW_ERROR", err?.message);
  }
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
    result = await sendAdminEmail(townCfg.emails.testEmailSubject, "If you received this, Postmark is working.");
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
app.put("/api/admin/prizes/:id", async (req, res) =>{
  try {
  const admin=await requireAdmin(req,res); if(!admin) return;
  const id = Number(req.params.id);
  if(!id) return res.status(400).json({error:"Invalid ID"});
  const existing = await data.getPrizeOfferById(id);
  if(!existing) return res.status(404).json({error:"Not found"});
  const fields = [];
  const values = [];
  var idx = 1;
  if(req.body.title != null){ fields.push("title=$"+idx); values.push(String(req.body.title)); idx++; }
  if(req.body.description != null){ fields.push("description=$"+idx); values.push(String(req.body.description)); idx++; }
  if(req.body.valueCents != null){ fields.push("valuecents=$"+idx); values.push(Number(req.body.valueCents)); idx++; }
  if(req.body.imageUrl != null){ fields.push("imageurl=$"+idx); values.push(String(req.body.imageUrl)); idx++; }
  if(req.body.expiresAt != null){ fields.push("expiresat=$"+idx); values.push(String(req.body.expiresAt)); idx++; }
  if(req.body.status != null){ fields.push("status=$"+idx); values.push(String(req.body.status)); idx++; }
  if(req.body.donorDisplayName != null){ fields.push("donordisplayname=$"+idx); values.push(String(req.body.donorDisplayName)); idx++; }
  if(fields.length === 0) return res.status(400).json({error:"No fields to update"});
  values.push(id);
  const result = await db.one("UPDATE prize_offers SET "+fields.join(", ")+" WHERE id=$"+idx+" RETURNING *", values);
  if(!result) return res.status(500).json({error:"Update failed"});
  res.json(result);
  } catch(e) { console.error("PUT /api/admin/prizes/:id error:", e.message); res.status(500).json({error: e.message}); }
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
// Multi-sweepstake endpoint - returns ALL active + upcoming sweepstakes
app.get("/api/sweepstakes/active", async (req, res) => {
  try {
    const sweeps = await data.getActiveSweepstakes();
    if(!sweeps || !sweeps.length) return res.json({ sweepstakes: [], balance: 0 });
    const u = await getUserId(req);
    const balance = u ? await data.getSweepBalance(u) : 0;
    const results = [];
    for(const sweep of sweeps){
      try {
      const totals = await data.getSweepstakeEntryTotals(sweep.id);
      const draw = await data.getSweepDrawBySweepId(sweep.id);
      let snapshot = {};
      if(draw?.snapshotJson){ try{ snapshot = typeof draw.snapshotJson === "string" ? JSON.parse(draw.snapshotJson) : draw.snapshotJson; }catch(_){} }
      const prize = await getSweepPrizeInfo(sweep, snapshot.prize);
      const donor = {
        businessName: prize.businessName || prize.donorName || "",
        name: prize.donorName || "",
        placeId: prize.donorPlaceId,
        avatarUrl: "", website: "", description: ""
      };
      if(prize.donorPlaceId){
        try {
          const donorPlace = await data.getPlaceById(prize.donorPlaceId);
          if(donorPlace){
            donor.avatarUrl = donorPlace.avatarUrl || donorPlace.avatarurl || "";
            donor.website = donorPlace.website || "";
            donor.description = donorPlace.description || "";
            if(!donor.businessName) donor.businessName = donorPlace.name || "";
          }
        } catch(e) {}
      }
      const rules = await data.listSweepRules(1, sweep.id);
      const enabledRules = rules.filter(r => r.enabled).map(r => ({
        eventType: r.ruleType, amount: r.amount, buyerAmount: r.buyerAmount,
        sellerAmount: r.sellerAmount, dailyCap: r.dailyCap
      }));
      const participants = await buildSweepParticipants(sweep.id);
      const winnerUserId = draw?.winnerUserId || sweep.winnerUserId || null;
      let winner = null;
      if(winnerUserId){
        const participant = participants.find(p=>Number(p.userId)===Number(winnerUserId));
        let displayName = participant?.displayName || "";
        if(!displayName){
          const winnerUser = await data.getUserById(winnerUserId);
          displayName = await data.getDisplayNameForUser(winnerUser);
          try { const place = await data.getPlaceByOwnerId(winnerUserId); if(place?.name) displayName = place.name; } catch(_){}
        }
        winner = { userId: Number(winnerUserId), displayName, entries: participant?.entries || 0 };
      }
      const userEntries = u ? await data.getUserEntriesForSweepstake(sweep.id, u) : 0;
      results.push({
        sweepstake: sweep, totals, prize, donor, winner,
        participants, rules: enabledRules, userEntries,
        isUpcoming: sweep.status === 'scheduled' || (sweep.startAt || sweep.startat) > new Date().toISOString(),
        hasWinner: !!winnerUserId
      });
      } catch(itemErr) {
        console.warn("Skipping sweepstake", sweep.id, itemErr?.message || itemErr);
      }
    }
    res.json({ sweepstakes: results, balance });
  } catch(e) {
    console.error("Error fetching active sweepstakes:", e);
    res.status(500).json({ error: "Failed to fetch sweepstakes" });
  }
});
// Public endpoint - get enabled sweep rules for display
app.get("/api/sweepstake/rules", async (req, res) => {
  try {
    const sweepstakeId = req.query.sweepstakeId ? Number(req.query.sweepstakeId) : undefined;
    const rules = await data.listSweepRules(1, sweepstakeId);
    const enabled = rules.filter(r => r.enabled);
    res.json({ rules: enabled.map(r => ({
      eventType: r.ruleType,
      amount: r.amount,
      buyerAmount: r.buyerAmount,
      sellerAmount: r.sellerAmount,
      dailyCap: r.dailyCap,
      cooldownSeconds: r.cooldownSeconds
    })) });
  } catch (e) {
    console.error("Error fetching sweep rules:", e);
    res.status(500).json({ error: "Failed to fetch rules" });
  }
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
  const access = await requirePerm(req,res,"SWEEP_ENTER"); if(!access) return;
  const u=access.userId;
  const isSweepTestMode = process.env.SWEEP_TEST_MODE === "true" && isAdminUser(access.user);
  const sweepId = Number(req.body?.sweepstakeId);
  const entries = Number(req.body?.entries);
  if(!Number.isFinite(entries) || entries <= 0) return res.status(400).json({error:"entries must be > 0"});
  const sweep = await data.getSweepstakeById(sweepId);
  if(!sweep) return res.status(404).json({error:"Sweepstake not found"});
  if(String(sweep.status) !== "active") return res.status(400).json({error:"Sweepstake not active"});
  if(sweep.winnerUserId) return res.status(400).json({error:"Sweepstake already drawn"});
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
    try{ snapshot = existing.snapshotJson ? (typeof existing.snapshotJson === "string" ? JSON.parse(existing.snapshotJson) : existing.snapshotJson) : {}; }catch(_){}
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
app.post("/api/admin/sweep/notify/:drawId", async (req, res) =>{
  const admin = await requireAdmin(req,res,{ message: "Admin access required" }); if(!admin) return;
  const draw = await data.getSweepDrawById(req.params.drawId);
  if(!draw) return res.status(404).json({ error: "Draw not found" });
  const sweep = await data.getSweepstakeById(draw.sweepId);
  if(!sweep) return res.status(404).json({ error: "Sweepstake not found" });
  const participants = await buildSweepParticipants(sweep.id);
  const winnerUserId = draw.winnerUserId || sweep.winnerUserId;
  if(!winnerUserId) return res.status(400).json({ error: "No winner on this draw" });
  const participant = participants.find(p=>Number(p.userId)===Number(winnerUserId));
  let displayName = participant?.displayName || "";
  if(!displayName){
    const winnerUser = await data.getUserById(winnerUserId);
    displayName = await data.getDisplayNameForUser(winnerUser);
    try { const place = await data.getPlaceByOwnerId(winnerUserId); if(place?.name) displayName = place.name; } catch(_){}
  }
  const winner = { userId: Number(winnerUserId), displayName, entries: participant?.entries || 0 };
  let snapshot = {};
  try{ snapshot = draw.snapshotJson ? (typeof draw.snapshotJson === "string" ? JSON.parse(draw.snapshotJson) : draw.snapshotJson) : {}; }catch(_){}
  const prize = await getSweepPrizeInfo(sweep, snapshot.prize);
  // Force-bypass notified check since this is an explicit admin re-trigger
  const notifyResult = await notifySweepDrawUsers({ draw, sweep, winner, prize, adminId: admin.id, force: true });
  res.json({ ok: true, drawId: draw.id, winnerId: winnerUserId, notify: notifyResult });
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
  try{ snapshot = existing.snapshotJson ? (typeof existing.snapshotJson === "string" ? JSON.parse(existing.snapshotJson) : existing.snapshotJson) : {}; }catch(_){}
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
  const sweepstakeId = req.query.sweepstakeId ? Number(req.query.sweepstakeId) : undefined;
  const rows = await data.listSweepRules(1, sweepstakeId);
  res.json(rows.map(r=>({
    id: r.id,
    matchEventType: r.ruleType || "",
    sweepstakeId: r.sweepstakeId || null,
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
// Backfill: create default entry rules for sweepstakes that have none
app.post("/api/admin/sweep/backfill-rules", async (req, res) =>{
  const admin = await requireAdmin(req,res,{ message: "Admin access required" }); if(!admin) return;
  try {
    const allSweeps = await db.many("SELECT id, title, status FROM sweepstakes ORDER BY id");
    const defaultRules = { message_send: 1, listing_create: 2, purchase: 3, review_left: 2, listing_mark_sold: 1, social_share: 1 };
    const results = [];
    for(const sweep of allSweeps){
      const existing = await data.listSweepRules(1, sweep.id);
      if(existing.length > 0){ results.push({ id: sweep.id, title: sweep.title, status: 'skipped', existingRules: existing.length }); continue; }
      let created = 0;
      for(const [ruleType, amount] of Object.entries(defaultRules)){
        const rule = await data.createSweepRule(1, { ruleType, amount, enabled: true, sweepstakeId: sweep.id });
        if(rule && rule.id) created++;
      }
      results.push({ id: sweep.id, title: sweep.title, status: 'backfilled', rulesCreated: created });
    }
    res.json({ ok: true, results });
  } catch(e) {
    console.error("Backfill rules error:", e);
    res.status(500).json({ error: e.message });
  }
});
// Cleanup: deduplicate rules, rename local_purchase→purchase, reset globals
app.post("/api/admin/sweep/cleanup-rules", async (req, res) =>{
  const admin = await requireAdmin(req,res,{ message: "Admin access required" }); if(!admin) return;
  try {
    const before = (await data.query("SELECT id, rule_type, amount, sweepstake_id, enabled FROM sweep_rules ORDER BY rule_type, sweepstake_id")).rows;

    // 1. Rename stale local_purchase → purchase
    await data.query("UPDATE sweep_rules SET rule_type='purchase' WHERE rule_type='local_purchase'");

    // 2. Find keeper IDs: min(id) per (rule_type, sweepstake_id) for globals and sweepstake 4 only
    const keepers = (await data.query(`
      SELECT MIN(id) AS keeper_id FROM sweep_rules
      WHERE sweepstake_id IS NULL OR sweepstake_id = 4
      GROUP BY rule_type, sweepstake_id
    `)).rows.map(r => Number(r.keeper_id));

    // 3. Delete everything not in keeper set
    let deleted = 0;
    if(keepers.length > 0){
      const del = await data.query("DELETE FROM sweep_rules WHERE NOT (id = ANY($1::int[]))", [keepers]);
      deleted = del.rowCount || 0;
    }

    // 4. Set amount=0 on global rules (sweepstake_id IS NULL)
    await data.query("UPDATE sweep_rules SET amount=0 WHERE sweepstake_id IS NULL");

    // 5. Ensure sweepstake 4 has all 6 rule types
    const ruleTypes = ['message_send', 'listing_create', 'purchase', 'review_left', 'listing_mark_sold', 'social_share'];
    const defaults = { message_send: 1, listing_create: 2, purchase: 3, review_left: 2, listing_mark_sold: 1, social_share: 1 };
    const existing4 = (await data.query("SELECT rule_type FROM sweep_rules WHERE sweepstake_id = 4")).rows.map(r => r.rule_type);
    let created = 0;
    for(const rt of ruleTypes){
      if(!existing4.includes(rt)){
        await data.createSweepRule(1, { ruleType: rt, amount: defaults[rt], enabled: true, sweepstakeId: 4 });
        created++;
      }
    }

    const after = (await data.query("SELECT id, rule_type, amount, sweepstake_id, enabled FROM sweep_rules ORDER BY rule_type, sweepstake_id")).rows;
    res.json({ ok: true, before, after, deleted, createdForSweepstake4: created });
  } catch(e) {
    console.error("Cleanup rules error:", e);
    res.status(500).json({ error: e.message });
  }
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
app.put("/api/admin/sweep/sweepstake/:id", async (req, res) =>{
  const admin = await requireAdmin(req,res); if(!admin) return;
  const id = parseInt(req.params.id);
  const status = (req.body?.status || "").toString().trim();
  if(!id) return res.status(400).json({ error: "Invalid ID" });
  if(!status) return res.status(400).json({ error: "Status required" });
  const result = await db.one("UPDATE sweepstakes SET status = $1 WHERE id = $2 RETURNING *", [status, id]);
  if(!result) return res.status(404).json({ error: "Sweepstake not found" });
  res.json({ ok: true, sweepstake: result });
});
app.delete("/api/admin/sweep/sweepstake/:id", async (req, res) =>{
  const admin = await requireAdmin(req,res); if(!admin) return;
  const id = parseInt(req.params.id);
  if(!id) return res.status(400).json({ error: "Invalid ID" });
  const result = await db.one("UPDATE sweepstakes SET status = 'cancelled' WHERE id = $1 RETURNING *", [id]);
  if(!result) return res.status(404).json({ error: "Sweepstake not found" });
  res.json({ ok: true, sweepstake: result });
});

// Districts
app.get("/districts/:id/places", async (req, res) =>{
  const did=Number(req.params.id);
  // PostgreSQL returns lowercase column names
  const places = (await data.getPlaces()).filter(p=>Number(p.districtId || p.districtid)===did);
  res.json(places);
});

app.get("/market/listings", async (req, res) =>{
  // Allow anonymous viewing - no login required for marketplace browsing
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
    if((l.status || 'active') !== 'active') continue;
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
      offerCategory: l.offerCategory || l.offercategory || "",
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
  // Allow anonymous viewing - no login required for marketplace browsing
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
    if((l.status || 'active') !== 'active') continue;
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
  // Allow anonymous viewing - no login required for auction browsing
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
  // Allow anonymous viewing - no login required for auction browsing
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
  // Allow anonymous viewing - no login required for auction browsing
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
app.get("/channels/recent-activity", async (req, res) =>{
  const access = await requirePerm(req,res,"VIEW_CHANNELS"); if(!access) return;
  const messages = await data.getRecentChannelMessages(10);
  const msgs = await Promise.all(messages.map(async (m)=>({
    ...m,
    userId: m.userId || m.userid,
    channelId: m.channelId || m.channelid,
    channelName: m.channelName || m.channelname,
    createdAt: m.createdAt || m.createdat,
    imageUrl: m.imageUrl || m.imageurl,
    user: await getTrustBadgeForUser(m.userId || m.userid)
  })));
  res.json(msgs);
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
  if(tier < 1) return res.status(403).json({error:"Posting requires tier 1+"});
  const canPost = tier >= 1;
  const canCreateThread = tier >= 1;
  const replyToId=req.body?.replyToId ? Number(req.body.replyToId) : null;
  let threadId=null;
  if(replyToId){
    if(!canPost) return res.status(403).json({error:"Posting requires tier 1+"});
    const parent=await data.getChannelMessageById(replyToId);
    if(!parent || Number(parent.channelId)!==Number(channel.id)) return res.status(400).json({error:"Invalid replyToId"});
    threadId=parent.threadId;
  }else{
    if(!canCreateThread) return res.status(403).json({error:"Thread creation requires tier 1+"});
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

// Admin channel list (with message counts)
app.get("/api/admin/channels", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  res.json(await data.getChannelsAdmin());
});

// Direct admin channel creation
app.post("/api/admin/channels", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const { name, description, isPublic } = req.body || {};
  if(!name || !name.trim()) return res.status(400).json({error:"name required"});
  const channel = await data.createChannel(name.trim(), (description || "").trim(), isPublic !== undefined ? isPublic : 1);
  res.json(channel);
});

// Admin channel deletion (cascades messages, threads, memberships, mutes)
app.delete("/api/admin/channels/:id", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
  const channel=await data.getChannelById(req.params.id);
  if(!channel) return res.status(404).json({error:"Channel not found"});
  await data.deleteChannel(channel.id);
  res.json({ ok:true, deleted: channel });
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
  // Approval no longer required: if((place.status || "").toLowerCase() !== "approved") return res.status(403).json({error:"Store not approved"});
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
  try{
    await data.tryAwardSweepForEvent({
      townId: 1,
      userId: u,
      ruleType: "message_send",
      eventKey: `dm:${msg.id}`,
      meta: { conversationId: convo.id }
    });
  }catch(err){
    console.error("SWEEP_AWARD_MESSAGE_ERROR", err?.message);
  }
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
  const showAll = req.query.all === 'true';
  res.json(listings.filter(l=>{
    const placeId = Number(l.placeId ?? l.placeid);
    const isActive = (l.status || 'active') === 'active';
    return placeId === pid && (showAll || isActive);
  }));
});
app.post("/places/:id/listings", async (req, res) =>{
  console.log("LISTING REQUEST BODY:", JSON.stringify(req.body, null, 2));
  const u=await requireLogin(req,res); if(!u) return;
  const ctx=await data.getTownContext(1, u);
  const user=await data.getUserById(u);
  const listingGate = trust.can(user, ctx, "listing_create");
  if(!listingGate.ok) return res.status(403).json({error:"Listing creation requires tier 1+"});
  const pid=Number(req.params.id);
  const listingType=(req.body?.listingType||"item").toString();
  if(listingType === "auction"){
    const auctionGate = trust.can(user, ctx, "auction_host");
    if(!auctionGate.ok) return res.status(403).json({error:"Auction hosting requires tier 1+"});
  }
  const exchangeType=(req.body?.exchangeType||"money").toString();
  const offerCategory=(req.body?.offerCategory||"").toString().trim().toLowerCase();
  if(listingType==="offer" || listingType==="request"){
    const placeList = await data.getPlaces();
    const place = placeList.find(p=>Number(p.id)===pid);
    if(!place) return res.status(404).json({error:"Place not found"});
    if(Number(place.ownerUserId ?? place.owneruserid)!==Number(u)) return res.status(403).json({error:"Only store owner can post offers/requests"});
    const tier = trust.resolveTier(user, ctx);
    if(tier < 1) return res.status(403).json({error:"Posting requires tier 1+"});
  }
  if(!req.body?.title) return res.status(400).json({error:"title required"});
  if(req.body.listingType === "auction"){
    if(!req.body.auctionEndAt || !Date.parse(req.body.auctionEndAt)){
      return res.status(400).json({error:"Auction end time is required"});
    }
    if(!req.body.startBidCents || req.body.startBidCents < 1){
      return res.status(400).json({error:"Starting bid is required"});
    }
  }
  const created=await data.addListing({...req.body,placeId:pid});
  try{
    await data.tryAwardSweepForEvent({
      townId: 1,
      userId: u,
      ruleType: "listing_create",
      eventKey: `listing:${created.id}`,
      meta: { placeId: pid }
    });
  }catch(err){
    console.error("SWEEP_AWARD_LISTING_CREATE_ERROR", err?.message);
  }
  res.status(201).json(created);
});
app.patch("/listings/:id/sold", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const listing = await data.getListingById(req.params.id);
  if(!listing) return res.status(404).json({error:"Listing not found"});
  const updated = await data.updateListingStatus(listing.id, "sold");
  try{
    await data.tryAwardSweepForEvent({
      townId: 1,
      userId: u,
      ruleType: "listing_mark_sold",
      eventKey: `sold:${listing.id}`,
      meta: { listingId: listing.id }
    });
  }catch(err){
    console.error("SWEEP_AWARD_LISTING_SOLD_ERROR", err?.message);
  }
  res.json(updated);
});

// Edit listing
app.patch("/listings/:id", async (req, res) => {
  const u = await requireLogin(req, res); if (!u) return;
  const listing = await data.getListingById(req.params.id);
  if (!listing) return res.status(404).json({ error: "Listing not found" });
  const place = await data.getPlaceById(listing.placeId);
  if (!place || (place.ownerUserId ?? place.owneruserid) !== u) {
    return res.status(403).json({ error: "Only owner can edit listing" });
  }
  const updates = {};
  if (req.body.title) updates.title = req.body.title;
  if (req.body.description !== undefined) updates.description = req.body.description;
  if (req.body.priceCents !== undefined) updates.priceCents = Number(req.body.priceCents);
  if (req.body.quantity !== undefined) updates.quantity = Number(req.body.quantity);
  if (req.body.photoUrl !== undefined) updates.photoUrl = req.body.photoUrl;
  const updated = await data.updateListing(listing.id, updates);
  res.json(updated);
});

// Delete listing
app.delete("/listings/:id", async (req, res) => {
  const u = await requireLogin(req, res); if (!u) return;
  const listing = await data.getListingById(req.params.id);
  if (!listing) return res.status(404).json({ error: "Listing not found" });
  const place = await data.getPlaceById(listing.placeId);
  if (!place || (place.ownerUserId ?? place.owneruserid) !== u) {
    return res.status(403).json({ error: "Only owner can delete listing" });
  }
  await data.deleteListing(listing.id);
  res.json({ ok: true, deleted: listing.id });
});

// ✅ Apply / Message → creates conversation
app.post("/listings/:id/apply", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
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
  const u=await requireLogin(req,res); if(!u) return;
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
  if(amountCents < minBid) return res.status(400).json({error:`Bid too low. Minimum $${(minBid/100).toFixed(2)}`});
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
  const serviceGratuityCents = 0; // Subscription model - no commission
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
  const serviceGratuityCents = 0; // Subscription model - no commission
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
  const tier = Number(req.body?.trustTier ?? 1);
  await db.query("UPDATE users SET isBuyerVerified=1, trustTier=$1 WHERE id=$2", [tier, id]);
  res.json({ ok: true, userId: id, trustTier: tier });
});

app.get("/api/admin/pending-buyers", async (req, res) => {
  const admin = await requireAdmin(req, res, { message: "Admin only" }); if (!admin) return;
  const pending = await db.query("SELECT id, email, displayName, addressJson, createdAt FROM users WHERE isBuyerVerified = 0 AND trustTier = 0 AND (isAdmin IS NULL OR isAdmin != 1) ORDER BY createdAt DESC");
  res.json(pending.rows);
});

app.post("/api/admin/reject-buyer", async (req, res) => {
  const admin = await requireAdmin(req, res, { message: "Admin only" }); if (!admin) return;
  const userId = Number(req.body?.userId);
  if (!userId) return res.status(400).json({ error: "userId required" });
  await db.query("DELETE FROM users WHERE id = $1 AND isBuyerVerified = 0 AND (isAdmin IS NULL OR isAdmin != 1)", [userId]);
  res.json({ ok: true, deleted: userId });
});

// --- Admin: Active Deliveries ---
app.get("/api/admin/deliveries", async (req, res) => {
  const admin = await requireAdmin(req, res); if (!admin) return;
  const result = await db.query(`
    SELECT o.id, o.delivery_status, o.delivery_address, o.delivery_fee_cents, o.uber_delivery_id, o.status,
           u.email as buyeremail, p.name as storename
    FROM orders o
    LEFT JOIN users u ON o.buyeruserid = u.id
    LEFT JOIN places p ON o.sellerplaceid = p.id
    WHERE o.uber_quote_id IS NOT NULL AND o.uber_quote_id != ''
    ORDER BY o.id DESC
    LIMIT 50
  `);
  const rows = result.rows.map(r => {
    const addr = r.delivery_address;
    const street = typeof addr === 'object' && addr ? addr.street : '';
    return { ...r, street, delivery_address: undefined };
  });
  res.json(rows);
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

// ---------- Individual Subscriptions ----------
app.get("/api/subscription/status", async (req, res) => {
  const u = await requireLogin(req, res); if(!u) return;
  const user = await data.getUserById(u);
  if(!user) return res.status(404).json({ error: "User not found" });
  // Individual subscriptions are tracked via trustTier and trialUsedAt
  // Tier 0 = free, Tier 1 = individual, Tier 3+ = business
  const tier = user.trustTier ?? user.trusttier ?? 0;
  const trialUsedAt = user.trialUsedAt ?? user.trialusedat;
  // For now, return a virtual subscription based on tier
  let subscription = null;
  if(tier === 1) {
    subscription = {
      plan: 'individual',
      status: 'active',
      createdAt: user.createdAt ?? user.createdat,
      currentPeriodEnd: null, // TODO: track actual billing period
      trialEndsAt: null,
      canceledAt: null
    };
  }
  const isBuyerVerified = Number(user.isBuyerVerified ?? user.isbuyerverified ?? 0);
  res.json({ subscription, tier, trialUsedAt, isBuyerVerified });
});

app.post("/api/subscription/start", async (req, res) => {
  const u = await requireLogin(req, res); if(!u) return;
  const user = await data.getUserById(u);
  if(!user) return res.status(404).json({ error: "User not found" });
  const tier = user.trustTier ?? user.trusttier ?? 0;
  if(tier >= 3) return res.status(400).json({ error: "You already have a Business subscription" });
  const plan = req.body?.plan || 'individual';
  const trialUsedAt = user.trialUsedAt ?? user.trialusedat;
  if(plan === 'business') {
    // Create Stripe checkout for business upgrade
    const stripeKey = (process.env.STRIPE_SECRET_KEY || "").trim();
    if(!stripeKey) return res.status(500).json({ error: "Stripe not configured" });
    const stripe = require('stripe')(stripeKey);
    const priceId = process.env.STRIPE_BUSINESS_PRICE_ID;
    if(!priceId) return res.status(500).json({ error: "Business price not configured" });
    try {
      const trialDays = trialUsedAt ? null : 7;
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${process.env.BASE_URL || townCfg.productionUrl}/me/subscription?upgraded=true`,
        cancel_url: `${process.env.BASE_URL || townCfg.productionUrl}/me/subscription?canceled=true`,
        client_reference_id: String(user.id),
        customer_email: user.email,
        metadata: { userId: String(user.id), plan: 'business' },
        subscription_data: { ...(trialDays ? { trial_period_days: trialDays } : {}), metadata: { userId: String(user.id), plan: 'business' } }
      });
      return res.json({ url: session.url });
    } catch(e) {
      console.error("Stripe business checkout error:", e);
      return res.status(500).json({ error: "Failed to create checkout" });
    }
  }
  // Individual plan is now FREE - skip Stripe, upgrade directly
  try {
    await data.query(
      'UPDATE users SET trustTier = 1, trialUsedAt = NOW() WHERE id = $1',
      [u]
    );
    const updated = await data.getUserById(u);
    res.json({
      ok: true,
      subscription: { plan: 'individual', status: 'active' },
      user: updated
    });
  } catch(e) {
    console.error("Individual upgrade error:", e);
    res.status(500).json({ error: "Upgrade failed: " + e.message });
  }
});

app.post("/api/subscription/portal", async (req, res) => {
  const u = await requireLogin(req, res); if(!u) return;
  const stripeKey = (process.env.STRIPE_SECRET_KEY || "").trim();
  if(!stripeKey) return res.status(400).json({ error: "Billing portal not available" });
  // TODO: Implement Stripe customer portal for individual subscriptions
  return res.status(400).json({ error: "Billing portal coming soon" });
});

app.post("/api/subscription/cancel", async (req, res) => {
  const u = await requireLogin(req, res); if(!u) return;
  const user = await data.getUserById(u);
  if(!user) return res.status(404).json({ error: "User not found" });
  const tier = user.trustTier ?? user.trusttier ?? 0;
  if(tier < 1) return res.status(400).json({ error: "No active subscription to cancel" });
  // For trial users, downgrade immediately
  // For paid users, would need to cancel in Stripe and wait for period end
  await data.query(
    'UPDATE users SET trustTier = 0, updatedAt = NOW() WHERE id = $1',
    [u]
  );
  res.json({ ok: true });
});

app.post("/api/subscription/reactivate", async (req, res) => {
  const u = await requireLogin(req, res); if(!u) return;
  const user = await data.getUserById(u);
  if(!user) return res.status(404).json({ error: "User not found" });
  // Individual tier is free - just reactivate directly
  await data.query(
    'UPDATE users SET trustTier = 1, updatedAt = NOW() WHERE id = $1',
    [u]
  );
  res.json({ ok: true });
});

app.post("/api/subscription/upgrade", async (req, res) => {
  const u = await requireLogin(req, res); if(!u) return;
  const plan = req.body?.plan || 'business';
  if(plan === 'business') {
    return res.json({ url: '/subscribe?plan=business' });
  }
  return res.status(400).json({ error: "Invalid upgrade plan" });
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
    const priceId = (process.env.STRIPE_PRICE_ID || "").trim();

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

// New subscription signup checkout (public - no login required)
app.post("/api/subscribe/checkout", async (req, res) => {
  const email = (req.body?.email || "").trim().toLowerCase();
  const displayName = (req.body?.displayName || "").trim();
  const phone = (req.body?.phone || "").trim();
  const plan = (req.body?.plan || "").trim(); // 'individual' or 'business'
  const referralCode = (req.body?.referralCode || "").trim();
  const businessName = (req.body?.businessName || "").trim();
  const businessType = (req.body?.businessType || "").trim();
  const businessAddress = (req.body?.businessAddress || "").trim();
  const businessWebsite = (req.body?.businessWebsite || "").trim();

  console.log("SUBSCRIBE_CHECKOUT", { email, plan, referralCode });

  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "Valid email required" });
  }
  if (!displayName) {
    return res.status(400).json({ error: "Display name required" });
  }
  if (plan !== "individual" && plan !== "business") {
    return res.status(400).json({ error: "Plan must be 'individual' or 'business'" });
  }

  // Check if email already exists
  const existingUser = await data.query(`SELECT id FROM users WHERE LOWER(email) = $1`, [email]);
  if (existingUser.rows.length > 0) {
    return res.status(400).json({ error: "An account with this email already exists. Please log in instead." });
  }

  // Look up referrer if code provided
  let referredById = null;
  if (referralCode) {
    const referrer = await data.query(`SELECT id FROM users WHERE referralCode = $1`, [referralCode]);
    if (referrer.rows.length > 0) {
      referredById = referrer.rows[0].id;
    }
  }

  // Individual plan is FREE - create user directly, skip Stripe
  if (plan === "individual") {
    try {
      const userReferralCode = (displayName.slice(0,3) + Math.random().toString(36).slice(2,7)).toUpperCase();
      const createResult = await data.query(
        `INSERT INTO users (email, displayName, phone, trustTier, referralCode, referredByUserId, createdAt)
         VALUES ($1, $2, $3, 1, $4, $5, $6) RETURNING id`,
        [email, displayName, phone || null, userReferralCode, referredById, new Date().toISOString()]
      );
      const newUserId = createResult.rows[0]?.id;
      console.log("SUBSCRIBE_FREE_INDIVIDUAL", { userId: newUserId, email });
      return res.json({ url: `/login?signup=success&email=${encodeURIComponent(email)}` });
    } catch (e) {
      console.error("Free individual signup error:", e);
      return res.status(500).json({ error: "Failed to create account: " + e.message });
    }
  }

  // Business plan - use Stripe checkout
  const stripeKey = (process.env.STRIPE_SECRET_KEY || "").trim();
  if (!stripeKey || !stripe) {
    return res.status(400).json({ error: "Stripe not configured" });
  }

  const priceId = (process.env.STRIPE_BUSINESS_PRICE_ID || "").trim();
  if (!priceId) {
    return res.status(400).json({ error: "Stripe price not configured for business plan" });
  }

  try {
    const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const successUrl = `${baseUrl}/subscribe/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${baseUrl}/subscribe`;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { trial_period_days: 7 },
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        signupEmail: email,
        signupDisplayName: displayName,
        signupPhone: phone,
        plan: plan,
        referralCode: referralCode || "",
        referredById: referredById ? String(referredById) : "",
        businessName: businessName,
        businessType: businessType,
        businessAddress: businessAddress,
        businessWebsite: businessWebsite
      }
    });

    console.log("SUBSCRIBE_CHECKOUT_SESSION_CREATED", { sessionId: session.id, email, plan });
    res.json({ url: session.url });
  } catch (e) {
    console.error("Subscribe checkout error:", e);
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

// ---------- Giveaway Offers ----------
app.post("/api/giveaway/offer", async (req, res) => {
  const u = await requireLogin(req, res); if(!u) return;
  const placeId = Number(req.body?.placeId || 0);
  if(!placeId) return res.status(400).json({ error: "placeId required" });
  const place = await data.getPlaceById(placeId);
  if(!place) return res.status(404).json({ error: "Place not found" });
  const ownerId = place.ownerUserId ?? place.owneruserid;
  if(Number(ownerId) !== Number(u)) return res.status(403).json({ error: "Only owner can submit offers" });
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
Estimated Value: $${offer.estimatedValue || offer.estimatedvalue || 0}
Submitted by: ${user?.displayName || user?.email || 'Unknown'}

Review at: ${getAdminReviewLink()}`;
  sendAdminEmail("New Giveaway Offer Submission", adminText);
  res.json({ ok: true, offer });
});

app.get("/api/admin/giveaway/offers", async (req, res) => {
  const admin = await requireAdmin(req, res); if(!admin) return;
  const status = (req.query.status || "all").toString().trim().toLowerCase();
  const offers = status === "all"
    ? [].concat(await data.getGiveawayOffersByStatus("pending"), await data.getGiveawayOffersByStatus("approved"), await data.getGiveawayOffersByStatus("rejected"), await data.getGiveawayOffersByStatus("cancelled"))
    : await data.getGiveawayOffersByStatus(status);
  const enriched = await Promise.all(offers.map(async (offer) => {
    const place = await data.getPlaceById(offer.placeId);
    const user = await data.getUserById(offer.userId);
    // Read linked IDs directly from the offer row (set by bridge on approval)
    let prizeOfferId = offer.prize_offer_id || offer.prizeOfferid || null;
    let sweepstakeId = offer.sweepstake_id || offer.sweepstakeId || null;
    // Fallback: look up by place/title for offers approved before migration 0023
    if (offer.status === 'approved') {
      if (!prizeOfferId) {
        try {
          const pId = offer.placeid || offer.placeId;
          if (pId) {
            const prize = await db.one('SELECT id FROM prize_offers WHERE donorplaceid=$1 ORDER BY createdat DESC LIMIT 1', [pId]);
            if (prize) prizeOfferId = prize.id;
          }
        } catch(e) {}
      }
      if (!sweepstakeId) {
        try {
          const offerTitle = offer.title || '';
          if (offerTitle) {
            const sw = await db.one('SELECT id FROM sweepstakes WHERE title=$1 ORDER BY createdat DESC LIMIT 1', [offerTitle]);
            if (sw) sweepstakeId = sw.id;
          }
        } catch(e) {}
      }
    }
    return {
      ...offer,
      place: place ? { id: place.id, name: place.name } : null,
      user: user ? { id: user.id, email: user.email, displayName: user.displayName } : null,
      prizeOfferId,
      sweepstakeId
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
    try {
      subscription = await data.awardFreeMonth(offer.placeId);
    } catch (e) {
      console.error("awardFreeMonth failed (non-blocking):", e.message);
      subscription = null;
    }
  }
  // Bridge: create prize_offers + sweepstake + rules on approval
  // Each step is independent so one failure doesn't block the others
  let bridgePrizeOffer = null;
  let bridgeSweepstake = null;
  if(status === "approved"){
    // Step 1: Create prize_offers row
    try {
      const place = await data.getPlaceById(offer.placeId);
      const user = await data.getUserById(offer.userId);
      const donorName = (place && place.name) || (user && (user.displayName || user.email)) || "Local Business";
      // estimatedValue is already stored in cents by the giveaway offer form
      const valueCents = Math.round(offer.estimatedvalue || offer.estimatedValue || 0) || 1;
      console.log("GIVEAWAY_BRIDGE: Creating prize for offer " + offerId + ", valueCents=" + valueCents);
      bridgePrizeOffer = await data.addPrizeOffer({
        title: offer.title,
        description: offer.description,
        valueCents: valueCents,
        prizeType: "physical",
        fulfillmentMethod: "pickup",
        fulfillmentNotes: "",
        expiresAt: endsAt || new Date(Date.now() + 30*24*60*60*1000).toISOString(),
        imageUrl: offer.imageurl || offer.imageUrl || "",
        donorPlaceId: offer.placeid || offer.placeId,
        donorDisplayName: donorName,
      }, offer.userid || offer.userId);
      if(bridgePrizeOffer && bridgePrizeOffer.error){
        console.error("GIVEAWAY_BRIDGE: addPrizeOffer returned error:", bridgePrizeOffer.error);
        bridgePrizeOffer = null;
      } else if(bridgePrizeOffer && bridgePrizeOffer.id){
        console.log("GIVEAWAY_BRIDGE: Created prize id=" + bridgePrizeOffer.id);
        await data.updatePrizeOfferDecision(bridgePrizeOffer.id, "active", admin.id, "Auto-approved via giveaway offer");
      }
    } catch(e) {
      console.error("GIVEAWAY_BRIDGE: Prize creation failed:", e.message);
    }

    // Step 2: Create sweepstake + entry rules (independent of prize)
    try {
      const effectiveStartsAt = startsAt || new Date().toISOString();
      const effectiveEndsAt = endsAt || new Date(Date.now() + 30*24*60*60*1000).toISOString();
      console.log("GIVEAWAY_BRIDGE: Creating sweepstake for offer " + offerId + ", title='" + offer.title + "', start=" + effectiveStartsAt + ", end=" + effectiveEndsAt);
      bridgeSweepstake = await data.createSweepstake({
        status: 'active',
        title: offer.title,
        prize: offer.title,
        startAt: effectiveStartsAt,
        endAt: effectiveEndsAt,
        drawAt: effectiveEndsAt,
        entryCost: 1,
        maxEntriesPerUserPerDay: 10
      });
      if(bridgeSweepstake && bridgeSweepstake.error){
        console.error("GIVEAWAY_BRIDGE: createSweepstake returned error:", bridgeSweepstake.error);
        bridgeSweepstake = null;
      } else if(bridgeSweepstake && bridgeSweepstake.id){
        console.log("GIVEAWAY_BRIDGE: Created sweepstake id=" + bridgeSweepstake.id);
        const entryRules = req.body?.entryRules || {};
        const defaultRules = { message_send: 1, listing_create: 2, purchase: 3, review_left: 2, listing_mark_sold: 1, social_share: 1 };
        let rulesCreated = 0;
        for(const [ruleType, defaultAmount] of Object.entries(defaultRules)){
          const amount = Number(entryRules[ruleType]) || defaultAmount;
          const rule = await data.createSweepRule(1, { ruleType, amount, enabled: true, sweepstakeId: bridgeSweepstake.id });
          if(rule && rule.id) rulesCreated++;
          else console.error("GIVEAWAY_BRIDGE: Failed to create rule " + ruleType + ", result:", rule);
        }
        console.log("GIVEAWAY_BRIDGE: Created " + rulesCreated + "/6 entry rules for sweepstake " + bridgeSweepstake.id);
      } else {
        console.error("GIVEAWAY_BRIDGE: createSweepstake returned unexpected:", JSON.stringify(bridgeSweepstake));
      }
    } catch(e) {
      console.error("GIVEAWAY_BRIDGE: Sweepstake creation failed:", e.message, e.stack);
    }

    // Step 3: Link IDs back to the giveaway offer row
    try {
      const linkIds = {};
      if(bridgePrizeOffer && bridgePrizeOffer.id) linkIds.prizeOfferId = bridgePrizeOffer.id;
      if(bridgeSweepstake && bridgeSweepstake.id) linkIds.sweepstakeId = bridgeSweepstake.id;
      if(Object.keys(linkIds).length > 0){
        await data.linkGiveawayOffer(offerId, linkIds);
        console.log("GIVEAWAY_BRIDGE: Linked offer " + offerId + " →", JSON.stringify(linkIds));
      }
    } catch(e) {
      console.error("GIVEAWAY_BRIDGE: Link failed:", e.message);
    }
  }
  const place = await data.getPlaceById(offer.placeId);
  const owner = offer.userId ? await data.getUserById(offer.userId) : null;
  if(owner?.email){
    const statusText = status === "approved" ? "approved" : "not approved";
    const rewardText = status === "approved"
      ? "Your prize will be featured in the Town Giveaway. Thank you for supporting the community!"
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

// Cancel an active giveaway (offer + linked sweepstake)
app.post("/api/admin/giveaway/:id/cancel", async (req, res) => {
  const admin = await requireAdmin(req, res); if(!admin) return;
  const offerId = Number(req.params.id || 0);
  if(!offerId) return res.status(400).json({ error: "offerId required" });
  const offer = await db.one("SELECT * FROM giveaway_offers WHERE id=$1", [offerId]);
  if(!offer) return res.status(404).json({ error: "Offer not found" });
  // Cancel the giveaway offer
  await db.query("UPDATE giveaway_offers SET status='cancelled', adminNotes=COALESCE(adminNotes,'')||$1, reviewedAt=$2, reviewedByUserId=$3 WHERE id=$4",
    ['\nCancelled by admin', new Date().toISOString(), admin.id, offerId]);
  // Cancel the linked sweepstake (multiple fallback lookups)
  let sweepstakeId = offer.sweepstake_id || null;
  // Fallback 1: title match
  if(!sweepstakeId && offer.title){
    try {
      const sw = await db.one("SELECT id FROM sweepstakes WHERE title=$1 ORDER BY createdat DESC LIMIT 1", [offer.title]);
      if(sw) sweepstakeId = sw.id;
    } catch(e){}
  }
  // Fallback 2: via prize_offer_id -> prize title -> sweepstake
  if(!sweepstakeId && offer.prize_offer_id){
    try {
      const prize = await db.one("SELECT title FROM prize_offers WHERE id=$1", [offer.prize_offer_id]);
      if(prize && prize.title){
        const sw = await db.one("SELECT id FROM sweepstakes WHERE title=$1 ORDER BY createdat DESC LIMIT 1", [prize.title]);
        if(sw) sweepstakeId = sw.id;
      }
    } catch(e){}
  }
  // Fallback 3: via placeId -> prize donor -> sweepstake title
  if(!sweepstakeId){
    const pId = offer.placeid || offer.place_id;
    if(pId){
      try {
        const sw = await db.one("SELECT s.id FROM sweepstakes s JOIN prize_offers p ON p.title = s.title WHERE p.donorplaceid=$1 AND s.status != 'cancelled' ORDER BY s.createdat DESC LIMIT 1", [pId]);
        if(sw) sweepstakeId = sw.id;
      } catch(e){}
    }
  }
  if(sweepstakeId){
    await db.query("UPDATE sweepstakes SET status='cancelled' WHERE id=$1", [sweepstakeId]);
  }
  res.json({ ok: true, offerId, sweepstakeId });
});

// Repair: create missing sweepstake + rules for approved offers that lack them
app.post("/api/admin/giveaway/offer/:id/repair", async (req, res) => {
  const admin = await requireAdmin(req, res); if(!admin) return;
  const offerId = Number(req.params.id || 0);
  if(!offerId) return res.status(400).json({ error: "offerId required" });
  const offer = await db.one("SELECT * FROM giveaway_offers WHERE id=$1", [offerId]);
  if(!offer) return res.status(404).json({ error: "Offer not found" });
  if(offer.status !== 'approved') return res.status(400).json({ error: "Offer is not approved (status: " + offer.status + ")" });
  const existingSwId = offer.sweepstake_id;
  if(existingSwId){
    // Already has a sweepstake — just check if it needs rules
    const existingRules = await data.listSweepRules(1, existingSwId);
    if(existingRules.length > 0) return res.json({ ok: true, message: "Already has sweepstake " + existingSwId + " with " + existingRules.length + " rules", sweepstakeId: existingSwId });
    // Create rules for existing sweepstake
    const defaultRules = { message_send: 1, listing_create: 2, purchase: 3, review_left: 2, listing_mark_sold: 1, social_share: 1 };
    let rulesCreated = 0;
    for(const [ruleType, amount] of Object.entries(defaultRules)){
      const rule = await data.createSweepRule(1, { ruleType, amount, enabled: true, sweepstakeId: existingSwId });
      if(rule && rule.id) rulesCreated++;
    }
    return res.json({ ok: true, message: "Created " + rulesCreated + " rules for existing sweepstake " + existingSwId, sweepstakeId: existingSwId, rulesCreated });
  }
  // No sweepstake — create one
  const startDate = offer.startsat || offer.startsAt || new Date().toISOString();
  const endDate = offer.endsat || offer.endsAt || new Date(Date.now() + 30*24*60*60*1000).toISOString();
  console.log("REPAIR: Creating sweepstake for offer " + offerId + ", title='" + offer.title + "'");
  const newSweepstake = await data.createSweepstake({
    status: 'active',
    title: offer.title,
    prize: offer.title,
    startAt: startDate,
    endAt: endDate,
    drawAt: endDate,
    entryCost: 1,
    maxEntriesPerUserPerDay: 10
  });
  if(!newSweepstake || newSweepstake.error){
    console.error("REPAIR: createSweepstake failed:", newSweepstake);
    return res.status(500).json({ error: "createSweepstake failed", detail: newSweepstake?.error || "returned null" });
  }
  console.log("REPAIR: Created sweepstake id=" + newSweepstake.id);
  // Create rules
  const defaultRules = { message_send: 1, listing_create: 2, purchase: 3, review_left: 2, listing_mark_sold: 1, social_share: 1 };
  let rulesCreated = 0;
  for(const [ruleType, amount] of Object.entries(defaultRules)){
    const rule = await data.createSweepRule(1, { ruleType, amount, enabled: true, sweepstakeId: newSweepstake.id });
    if(rule && rule.id) rulesCreated++;
    else console.error("REPAIR: Failed to create rule " + ruleType + ":", rule);
  }
  // Link to offer + prize
  const linkIds = { sweepstakeId: newSweepstake.id };
  const existingPrizeId = offer.prize_offer_id;
  if(!existingPrizeId){
    // Also look up prize by placeId
    try {
      const pId = offer.placeid;
      if(pId){
        const prize = await db.one('SELECT id FROM prize_offers WHERE donorplaceid=$1 ORDER BY createdat DESC LIMIT 1', [pId]);
        if(prize) linkIds.prizeOfferId = prize.id;
      }
    } catch(e) {}
  }
  await data.linkGiveawayOffer(offerId, linkIds);
  console.log("REPAIR: Linked offer " + offerId + " → sweepstake " + newSweepstake.id + ", rules created: " + rulesCreated);
  res.json({ ok: true, sweepstakeId: newSweepstake.id, rulesCreated, linked: linkIds });
});

// ---------- Featured Stores ----------
app.get("/api/featured-stores", async (req, res) => {
  try {
    const rows = await data.getFeaturedStores();
    // Group by placeId server-side
    const grouped = {};
    for(const r of rows){
      const pid = String(r.placeId || r.placeid || r.placeid || 0);
      if(!grouped[pid]){
        grouped[pid] = {
          placeId: Number(pid),
          placeName: r.placeName || r.placename || "Store",
          avatarUrl: r.avatarUrl || r.avatarurl || "",
          category: r.category || "",
          giveawayCount: 0,
          offers: []
        };
      }
      grouped[pid].giveawayCount++;
      grouped[pid].offers.push({
        title: r.title || "",
        endsAt: r.endsAt || r.endsat || ""
      });
    }
    res.json(Object.values(grouped));
  } catch(e) {
    console.error("Featured stores error:", e);
    res.status(500).json({ error: "Failed to load featured stores" });
  }
});

app.get("/api/places/featured", async (req, res) => {
  try {
    const businesses = await data.getFeaturedBusinesses();
    res.json(businesses);
  } catch(e) {
    console.error("Featured businesses error:", e);
    res.status(500).json({ error: "Failed to load featured businesses" });
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
  return (process.env.PUBLIC_BASE_URL || process.env.SITE_URL || process.env.APP_URL || "").toString().trim().replace(/\/$/, "") || townCfg.localFallbackUrl;
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
  const text = townCfg.shareText.purchase.replace("{{itemName}}", itemName).replace("{{storeName}}", storeName);
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
  const text = townCfg.shareText.giveawayWin.replace("{{prizeName}}", prizeName);
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
  const text = townCfg.shareText.sweepstakesWin.replace("{{prizeName}}", prizeName);
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
  const text = (rating >= 4 ? townCfg.shareText.reviewPositive : townCfg.shareText.reviewNeutral).replace("{{storeName}}", storeName);
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
  // Award sweep tokens for social share
  try {
    const eventKey = `social_share_${u}_${itemType}_${itemId}_${platform}`;
    await data.tryAwardSweepForEvent({
      townId: 1,
      userId: u,
      ruleType: 'social_share',
      eventKey,
      meta: { platform, itemType, itemId }
    });
  } catch(e) {
    console.error("Sweep award for share failed:", e);
  }
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

// --- Weekly Batch Order Email for Managed Stores ---
async function generateBatchOrderEmail(){
  try{
    const result1 = await db.query(`
      SELECT oi.titlesnapshot AS title, SUM(oi.quantity) AS total_qty, oi.pricecentssnapshot AS price_cents
      FROM order_items oi
      JOIN orders o ON o.id = oi.orderid
      JOIN places p ON p.id = o.sellerplaceid
      WHERE o.status = 'paid'
        AND p.storetype = 'managed'
        AND o.createdat >= NOW() - INTERVAL '7 days'
      GROUP BY oi.titlesnapshot, oi.pricecentssnapshot
      ORDER BY oi.titlesnapshot
    `);
    const rows = result1.rows;
    if(!rows.length){
      console.log("BATCH_ORDER: No paid managed store orders this week");
      return { ok: true, skipped: true, reason: "no orders" };
    }
    let totalCost = 0;
    const lines = rows.map(r => {
      const qty = Number(r.total_qty || 0);
      const cost = qty * Number(r.price_cents || 0);
      totalCost += cost;
      return `${r.title} — Qty: ${qty} — ${(cost/100).toFixed(2)}`;
    });
    const result2 = await db.query(`
      SELECT COUNT(DISTINCT o.id) AS c
      FROM orders o
      JOIN places p ON p.id = o.sellerplaceid
      WHERE o.status = 'paid'
        AND p.storetype = 'managed'
        AND o.createdat >= NOW() - INTERVAL '7 days'
    `);
    const orderCount = result2.rows[0];
    const subject = `Weekly Batch Order — ${new Date().toLocaleDateString("en-US")} — ${rows.length} products, ${orderCount.c} orders`;
    const text = `Weekly Batch Order Summary\n` +
      `Generated: ${new Date().toISOString()}\n` +
      `Orders this week: ${orderCount.c}\n` +
      `Products to order: ${rows.length}\n` +
      `Total revenue: ${(totalCost/100).toFixed(2)}\n\n` +
      `--- Shopping List ---\n` +
      lines.join("\n") +
      `\n\nThis is your master order list to send to the supplier.`;
    const result = await sendAdminEmail(subject, text);
    console.log("BATCH_ORDER_EMAIL_SENT", { items: rows.length, orders: orderCount.c, result: result.ok });
    return { ok: true, items: rows.length, orders: Number(orderCount.c) };
  }catch(err){
    console.error("BATCH_ORDER_EMAIL_ERROR", err?.message);
    return { ok: false, error: err?.message };
  }
}

// Friday 6am ET (11:00 UTC)
cron.schedule("0 11 * * 5", () => {
  console.log("CRON: Running weekly batch order email");
  generateBatchOrderEmail();
});

// Admin manual trigger
app.post("/api/admin/batch-order-email", async (req, res) => {
  const result = await generateBatchOrderEmail();
  res.json(result);
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
  1: "Individual",
  2: "Moderator",
  3: "Local Business",
  4: "Admin"
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
    PERMS.ENTER_GIVEAWAY,
    // Individual tier - can sell and message, but no store in featured section
    PERMS.SELL_MARKET,
    PERMS.CREATE_LISTING,
    PERMS.MESSAGE,
    PERMS.POST_CHANNEL
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
