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
const multer = require("multer");
const trust = require("./lib/trust");
const { sendAdminEmail } = require("./lib/notify");
const TRUST_TIER_LABELS = trust.TRUST_TIER_LABELS;
async function getTrustBadgeForUser(userId){
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
const data = require("./data");
const { TRUST } = require("./town_config");
const { TOWN_DIRECTORY } = require("./town_directory");
const { StubPaymentProvider } = require("./payment_provider");
const paymentProvider = new StubPaymentProvider();
const { uploadImage } = require("./lib/r2");
const stripe = process.env.STRIPE_SECRET_KEY ? require("stripe")(process.env.STRIPE_SECRET_KEY) : null;
const CF_CALLS_APP_ID = process.env.CF_CALLS_APP_ID || "";
const CF_CALLS_APP_SECRET = process.env.CF_CALLS_APP_SECRET || "";
const CF_CALLS_BASE_URL = (process.env.CF_CALLS_BASE_URL || "https://api.cloudflare.com/client/v4").replace(/\/$/, "");
const ADMIN_EMAIL_ALLOWLIST = new Set((process.env.ADMIN_EMAILS || "").split(",").map(s=>s.trim().toLowerCase()).filter(Boolean));
const adminSweepRules = [];
let nextSweepRuleId = 1;
let nextSweepstakeId = 1;
const chatImageUploadRate = new Map();
const loginLinkRateLimit = new Map();

app.use(express.static(path.join(__dirname, "public")));
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
    if(pathName.startsWith("/api/sweep/claim/")) return next();
  }
  if(isGet && pathName.startsWith("/api/sweep/claim/")) return next();
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
  const userId = await getUserId(req);
  const user = userId ? await data.getUserById(userId) : null;
  if(isAdminUser(user)) return next();
  return res.status(403).json({ error: "Admin access required" });
});

// Health
app.get("/health", async (req, res) =>res.json({status:"ok"}));
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) =>{
  if(!stripe || !process.env.STRIPE_WEBHOOK_SECRET){
    return res.status(400).json({error:"Stripe not configured"});
  }
  const sig = req.headers["stripe-signature"];
  if(!sig) return res.status(400).json({error:"Missing signature"});
  let event;
  try{
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET || "");
  }catch(err){
    return res.status(400).json({error:"Invalid signature"});
  }
  if(event.type === "checkout.session.completed"){
    const session = event.data?.object;
    const orderId = Number(session?.metadata?.orderId || 0);
    if(orderId){
      const order = await data.getOrderById(orderId);
      if(order && order.status !== "paid"){
        await data.updateOrderPayment(order.id, "stripe", session.id || "");
        const existingPayment = await data.getPaymentForOrder(order.id);
        if(!existingPayment) await data.createPaymentForOrder(order.id, Number(order.totalCents || 0), "stripe");
        await finalizeOrderPayment(order);
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

// Pages
app.get("/ui", async (req, res) =>res.sendFile(path.join(__dirname,"public","index.html")));
app.get("/signup", async (req, res) =>res.sendFile(path.join(__dirname,"public","signup.html")));
app.get("/waitlist", async (req, res) =>res.sendFile(path.join(__dirname,"public","waitlist.html")));
app.get("/apply/business", async (req, res) =>res.sendFile(path.join(__dirname,"public","apply_business.html")));
app.get("/apply/resident", async (req, res) =>res.sendFile(path.join(__dirname,"public","apply_resident.html")));
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
function isAdminUser(user){
  if(!user) return false;
  const email=(user.email||"").toString().trim().toLowerCase();
  const adminFlag = user.isAdmin ?? user.isadmin;
  if(adminFlag === true) return true;
  if(Number(adminFlag)===1) return true;
  if(email && ADMIN_EMAIL_ALLOWLIST.has(email)) return true;
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
    if(place?.ownerUserId) return Number(place.ownerUserId);
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

async function sendLoginEmail(toEmail, magicUrl){
  const token = (process.env.POSTMARK_SERVER_TOKEN || "").trim();
  const from = (process.env.EMAIL_FROM || "").trim();
  if(!token || !from){
    console.warn("Login email not configured");
    return { ok:false, skipped:true };
  }
  const payload = {
    From: from,
    To: toEmail,
    Subject: "Your Sebastian Digital Town login link",
    TextBody: `Here is your login link:\n${magicUrl}\n\nThis link expires soon.`
  };
  try{
    const resp = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "X-Postmark-Server-Token": token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if(!resp.ok){
      const errText = await resp.text().catch(()=> "");
      return { ok:false, error: errText || `Postmark error ${resp.status}` };
    }
    return { ok:true };
  }catch(err){
    return { ok:false, error: err.message || String(err) };
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
  if(!await hasPerm(user, perm, ctx)){
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
  if(!process.env.STRIPE_SUCCESS_URL || !process.env.STRIPE_CANCEL_URL){
    res.status(500).json({error:"Stripe URLs not configured"});
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
app.post("/auth/request-link", async (req, res) =>{
  const email=(req.body?.email||"").toLowerCase().trim();
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim();
  const rateKey = `${ip}|${email}`;
  const now = Date.now();
  const last = loginLinkRateLimit.get(rateKey) || 0;
  if(now - last < 30000){
    return res.json({ ok:true, message: "Check your email for your login link." });
  }
  loginLinkRateLimit.set(rateKey, now);

  const c=await data.createMagicLink(email);
  const base=(process.env.PUBLIC_BASE_URL || "").replace(/\/$/,"");
  const magicUrl = c?.token ? `${base}/auth/magic?token=${c.token}` : "";
  if(process.env.NODE_ENV === "production"){
    if(c?.token){
      sendLoginEmail(email, magicUrl)
        .catch((err)=>console.warn("Login email failed", err?.message || err));
    }
    return res.json({ ok:true, message: "Check your email for your login link." });
  }
  if(c.error) return res.status(400).json(c);
  if(process.env.NODE_ENV !== "production" || process.env.SHOW_MAGIC_LINK === "true"){
    return res.json({ok:true, magicUrl});
  }
  res.json({ ok:true, message: "Check your email for your login link." });
});
app.get("/auth/magic", async (req, res) =>{
  const c=await data.consumeMagicToken(req.query.token);
  if(c.error) return res.status(400).send(c.error);
  const s=await data.createSession(c.userId);
  setCookie(res,"sid",s.sid,{httpOnly:true,maxAge:60*60*24*30,secure:isHttpsRequest(req)});
  res.redirect("/ui");
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
    sender: await getTrustBadgeForUser(m.senderUserId)
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
    if(Number(place.ownerUserId)!==Number(u)) return res.status(403).json({error:"Only owner can host for place"});
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
  if(place && Number(place.ownerUserId)!==Number(room.hostUserId)){
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
    if(Number(place.ownerUserId)!==Number(u)) return res.status(403).json({error:"Only owner can host for place"});
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
    if(!ev.organizerUserId) return ev;
    const badge = await getTrustBadgeForUser(ev.organizerUserId);
    return { ...ev, organizerTrustTierLabel: badge?.trustTierLabel || null };
  }));
  res.json(rows);
});

// Local businesses (applications)
app.post("/api/localbiz/apply", async (req, res) =>{
  const access = await requirePerm(req,res,"VIEW_LOCALBIZ"); if(!access) return;
  const created=await data.addLocalBizApplication(req.body || {}, access.userId);
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
    const badge = await getTrustBadgeForUser(p.donorUserId);
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

app.get("/api/prize_awards/my", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
  const placeId = req.query.placeId ? Number(req.query.placeId) : null;
  if(placeId){
    const place = await data.getPlaceById(placeId);
    if(!place || Number(place.ownerUserId)!==Number(u)) return res.status(403).json({error:"Only owner"});
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
    const listing = listings.find(l=>Number(l.id)===Number(item.listingId));
    if(!listing) return res.status(400).json({error:"Listing not found"});
    if((listing.listingType||"item")!=="item") return res.status(400).json({error:"Only item listings can be purchased"});
    if((listing.status || "active")!=="active") return res.status(400).json({error:"Listing not active"});
    if(Number(listing.quantity || 0) < Number(item.quantity || 0)) return res.status(400).json({error:"Insufficient quantity"});
    if(placeId == null) placeId = listing.placeId;
    if(Number(placeId) !== Number(listing.placeId)) return res.status(400).json({error:"Checkout supports a single store per order"});
    const place = placeMap.get(Number(listing.placeId));
    if(place) sellerUserId = place.ownerUserId ?? null;
    const priceCents = Math.round(Number(listing.price || 0) * 100);
    subtotalCents += priceCents * Number(item.quantity || 0);
    items.push({
      listingId: listing.id,
      titleSnapshot: listing.title,
      priceCentsSnapshot: priceCents,
      quantity: Number(item.quantity || 0)
    });
  }
  const serviceGratuityCents = Math.ceil(subtotalCents * 0.05);
  const totalCents = subtotalCents + serviceGratuityCents;
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
    fulfillmentNotes: (req.body?.fulfillmentNotes || "").toString()
  }, items);
  await data.createPaymentForOrder(order.id, totalCents, "stripe");
  await data.clearCart(u);
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
      product_data: { name: item.titleSnapshot || `Item ${item.listingId}` },
        unit_amount: Math.max(0, parseInt(String(item.priceCentsSnapshot ?? "0"), 10) || 0)
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
  const successUrl = String(process.env.STRIPE_SUCCESS_URL || "").replace("{ORDER_ID}", String(order.id));
  const cancelUrl = String(process.env.STRIPE_CANCEL_URL || "").replace("{ORDER_ID}", String(order.id));
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
  try{
    const intent = paymentProvider.createPaymentIntent({
      amountCents,
      currency: "usd",
      metadata: { listingId, buyerUserId: u, placeId: place.id }
    });
    const pi = await Promise.resolve(intent);
    const order = await data.addOrder({
      listingId,
      buyerUserId: u,
      sellerUserId: place.ownerUserId ?? null,
      quantity,
      amountCents,
      status: "pending",
      paymentProvider: pi.provider,
      paymentIntentId: pi.paymentIntentId
    });
    res.status(201).json({order, payment: pi});
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
    await paymentProvider.capturePaymentIntent(order.paymentIntentId);
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
  res.json({ since, sessions: 0, counts: [] });
});
app.get("/api/admin/analytics/summary", async (req, res) =>{
  const admin=await requireAdmin(req,res); if(!admin) return;
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
  if(Number(place.ownerUserId)!==Number(u)) return res.status(403).json({error:"Owner only"});
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
  if(Number(place.ownerUserId)!==Number(u)) return res.status(403).json({error:"Owner only"});
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
  const admin=await requireAdminOrDev(req,res); if(!admin) return;
  const dayKey=(req.body?.dayKey || "").toString().trim() || null;
  const pulse=await data.generateDailyPulse(1, dayKey || undefined);
  res.json(pulse);
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
  const updated=await data.updateLocalBizDecision(req.params.id, "approved", admin.id, "");
  if(!updated) return res.status(404).json({error:"Not found"});
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
  const admin=await requireAdmin(req,res); if(!admin) return;
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
  if(status !== "approved" && status !== "rejected" && status !== "pending"){
    return res.status(400).json({error:"status must be approved, rejected, or pending"});
  }
  const updated = await data.updateWaitlistStatus(req.params.id, status);
  if(!updated) return res.status(404).json({error:"Not found"});
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
  if(status !== "approved" && status !== "rejected" && status !== "pending"){
    return res.status(400).json({error:"status must be approved, rejected, or pending"});
  }
  const updated = await data.updateBusinessApplicationStatus(req.params.id, status);
  if(!updated) return res.status(404).json({error:"Not found"});
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
  if(status !== "approved" && status !== "rejected" && status !== "pending"){
    return res.status(400).json({error:"status must be approved, rejected, or pending"});
  }
  const updated = await data.updateResidentApplicationStatus(req.params.id, status);
  if(!updated) return res.status(404).json({error:"Not found"});
  if(status === "approved"){
    const app = await data.getResidentApplicationById(req.params.id);
    if(app?.email){
      const user = await data.getUserByEmail(app.email);
      if(user) await data.setUserResidentVerified(user.id, true);
    }
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
    const reviewer = await getTrustBadgeForUser(r.reviewerUserId);
    const reviewee = await getTrustBadgeForUser(r.revieweeUserId);
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
    const reporter = await getTrustBadgeForUser(d.reporterUserId);
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
  const access = await requirePerm(req,res,"SWEEP_ENTER"); if(!access) return;
  const u=access.userId;
  const isSweepTestMode = process.env.SWEEP_TEST_MODE === "true" && isAdminUser(access.user);
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
  res.json(adminSweepRules);
});
app.post("/api/admin/sweep/rules", async (req, res) =>{
  const matchEventType = (req.body?.matchEventType || "").toString().trim();
  if(!matchEventType) return res.status(400).json({error:"matchEventType required"});
  const rule = {
    id: nextSweepRuleId++,
    matchEventType,
    enabled: !!req.body?.enabled,
    buyerAmount: Number(req.body?.buyerAmount) || 0,
    sellerAmount: Number(req.body?.sellerAmount) || 0,
    dailyCap: Number(req.body?.dailyCap) || 0,
    cooldownSeconds: Number(req.body?.cooldownSeconds) || 0
  };
  adminSweepRules.push(rule);
  res.status(201).json(rule);
});
app.patch("/api/admin/sweep/rules/:id", async (req, res) =>{
  const id = Number(req.params.id);
  const rule = adminSweepRules.find(r=>Number(r.id)===id);
  if(!rule) return res.status(404).json({error:"Rule not found"});
  rule.matchEventType = (req.body?.matchEventType || rule.matchEventType).toString().trim();
  rule.enabled = req.body?.enabled == null ? rule.enabled : !!req.body.enabled;
  rule.buyerAmount = Number.isFinite(Number(req.body?.buyerAmount)) ? Number(req.body.buyerAmount) : rule.buyerAmount;
  rule.sellerAmount = Number.isFinite(Number(req.body?.sellerAmount)) ? Number(req.body.sellerAmount) : rule.sellerAmount;
  rule.dailyCap = Number.isFinite(Number(req.body?.dailyCap)) ? Number(req.body.dailyCap) : rule.dailyCap;
  rule.cooldownSeconds = Number.isFinite(Number(req.body?.cooldownSeconds)) ? Number(req.body.cooldownSeconds) : rule.cooldownSeconds;
  res.json(rule);
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
  const places = (await data.getPlaces()).filter(p=>Number(p.districtId)===did);
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
    const p = placeById.get(Number(l.placeId));
    if(!p) continue;
    if(townId && Number(p.townId)!==Number(townId)) continue;
    const listingType = l.listingType || "item";
    const hasAuctionFields = !!(l.auctionStartAt || l.auctionEndAt || Number(l.startBidCents || 0) || Number(l.minIncrementCents || 0) || Number(l.reserveCents || 0));
    const hasAuctionId = !!l.auctionId;
    if(listingType === "auction" || hasAuctionFields || hasAuctionId) continue;
    const joined = {
      id: l.id,
      placeId: l.placeId,
      title: l.title,
      description: l.description,
      price: l.price,
      listingType,
      auctionEndAt: l.auctionEndAt || "",
      startBidCents: l.startBidCents || 0,
      placeName: p.name || "Store",
      placeCategory: p.category || "",
      districtId: p.districtId
    };
    if((l.listingType||"item")==="auction"){
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
  const isPublic=Number(channel.isPublic)===1;
  if(!isPublic){
    const u=access.userId;
    if(!await data.isChannelMember(channel.id,u)) return res.status(403).json({error:"Not a member"});
  }
  const messages = await data.getChannelMessages(channel.id, 200);
  const msgs = await Promise.all(messages.map(async (m)=>({
    ...m,
    user: await getTrustBadgeForUser(m.userId)
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
  const isPublic=Number(channel.isPublic)===1;
  if(!isPublic && !await data.isChannelMember(channel.id,u)) return res.status(403).json({error:"Not a member"});
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
  res.status(201).json({ok:true, id: created.id, threadId});
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
  const access = await requirePerm(req,res,"SELL_LISTINGS"); if(!access) return;
  const u=access.userId;
  const payload = req.body || {};
  const created = await data.addPlace({
    ...payload,
    ownerUserId: u,
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
  if(Number(place.ownerUserId)!==Number(u)) return res.status(403).json({error:"Only owner can edit"});
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
  res.json(listings.filter(l=>Number(l.placeId)===pid));
});
app.post("/places/:id/listings", async (req, res) =>{
  const u=await requireLogin(req,res); if(!u) return;
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
    if(Number(place.ownerUserId)!==Number(u)) return res.status(403).json({error:"Only store owner can post offers/requests"});
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
  if(!isAdminUser(user) && Number(place.ownerUserId)!==Number(u)){
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
    sellerUserId: place.ownerUserId ?? null,
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
    sellerUserId: place.ownerUserId ?? null,
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

const PORT = Number(process.env.PORT || 3000);
async function start(){
  await data.initDb();
  app.listen(PORT, "0.0.0.0", () => console.log(`Server running on http://localhost:${PORT}`));
}
start().catch((err)=>{
  console.error("Failed to start server:", err);
  process.exit(1);
});
