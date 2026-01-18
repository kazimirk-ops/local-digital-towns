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
function getTrustBadgeForUser(userId){
  const user = data.getUserById(userId);
  if(!user) return null;
  const ctx = data.getTownContext(1, userId);
  const tier = trust.resolveTier(user, ctx);
  return {
    userId: user.id,
    displayName: data.getDisplayNameForUser(user),
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

app.use(express.static(path.join(__dirname, "public")));
const jsonParser = express.json({ limit: "5mb" });
app.use((req,res,next)=>{
  if(req.path === "/api/stripe/webhook") return next();
  return jsonParser(req,res,next);
});
const LOCKDOWN = (process.env.LOCKDOWN_MODE || "").toLowerCase() === "true";
app.use((req,res,next)=>{
  if(!LOCKDOWN) return next();
  const pathName = req.path || "";
  const isGet = req.method === "GET";
  if(isGet && pathName === "/health") return next();
  if(isGet && (pathName === "/waitlist" || pathName === "/apply/business" || pathName === "/apply/resident")) return next();
  if(req.method === "POST"){
    if(pathName === "/api/public/waitlist") return next();
    if(pathName === "/api/public/apply/business") return next();
    if(pathName === "/api/public/apply/resident") return next();
  }
  if(pathName.startsWith("/admin/login")) return next();
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
  const userId = getUserId(req);
  const user = userId ? data.getUserById(userId) : null;
  if(isAdminUser(user)) return next();
  if(pathName.startsWith("/api")){
    return res.status(403).json({ error: "coming soon" });
  }
  setCookie(res, "lockdown_logged_in", userId ? "1" : "0", { maxAge: 300 });
  return res.status(200).sendFile(path.join(__dirname,"public","coming_soon.html"));
});
app.use("/admin",(req,res,next)=>{
  if(req.path === "/login") return next();
  const userId = getUserId(req);
  const user = userId ? data.getUserById(userId) : null;
  if(isAdminUser(user)) return next();
  if(req.method === "GET" || req.method === "HEAD"){
    return res.redirect("/ui");
  }
  return res.status(403).json({ error: "Admin access required" });
});
app.use("/api/admin",(req,res,next)=>{
  const userId = getUserId(req);
  const user = userId ? data.getUserById(userId) : null;
  if(isAdminUser(user)) return next();
  return res.status(403).json({ error: "Admin access required" });
});

// Health
app.get("/health",(req,res)=>res.json({status:"ok"}));
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), (req,res)=>{
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
      const order = data.getOrderById(orderId);
      if(order && order.status !== "paid"){
        data.updateOrderPayment(order.id, "stripe", session.id || "");
        const existingPayment = data.getPaymentForOrder(order.id);
        if(!existingPayment) data.createPaymentForOrder(order.id, Number(order.totalCents || 0), "stripe");
        finalizeOrderPayment(order);
      }
    }
  }
  if(event.type === "payment_intent.succeeded"){
    const intent = event.data?.object;
    const orderId = Number(intent?.metadata?.orderId || 0);
    if(orderId){
      const order = data.getOrderById(orderId);
      if(order && order.status !== "paid"){
        data.updateOrderPayment(order.id, "stripe", intent.id || "");
        const existingPayment = data.getPaymentForOrder(order.id);
        if(!existingPayment) data.createPaymentForOrder(order.id, Number(order.totalCents || 0), "stripe");
        finalizeOrderPayment(order);
      }
    }
  }
  res.json({ received:true });
});
app.get("/debug/routes",(req,res)=>{
  const admin=requireAdminOrDev(req,res); if(!admin) return;
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
app.get("/ui",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.get("/signup",(req,res)=>res.sendFile(path.join(__dirname,"public","signup.html")));
app.get("/waitlist",(req,res)=>res.sendFile(path.join(__dirname,"public","waitlist.html")));
app.get("/apply/business",(req,res)=>res.sendFile(path.join(__dirname,"public","apply_business.html")));
app.get("/apply/resident",(req,res)=>res.sendFile(path.join(__dirname,"public","apply_resident.html")));
app.get("/u/:id",(req,res)=>res.sendFile(path.join(__dirname,"public","profile.html")));
app.get("/me/store",(req,res)=>res.sendFile(path.join(__dirname,"public","store_profile.html")));
app.get("/me/profile",(req,res)=>res.sendFile(path.join(__dirname,"public","my_profile.html")));
app.get("/me/orders",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  res.sendFile(path.join(__dirname,"public","my_orders.html"));
});
app.get("/me/seller/orders",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  res.sendFile(path.join(__dirname,"public","seller_orders.html"));
});
app.get("/me/hub",(req,res)=>res.redirect("/me/store"));
app.get("/pay/:id",(req,res)=>res.sendFile(path.join(__dirname,"public","pay.html")));
app.get("/pay/success",(req,res)=>res.sendFile(path.join(__dirname,"public","pay_success.html")));
app.get("/pay/cancel",(req,res)=>res.sendFile(path.join(__dirname,"public","pay_cancel.html")));
app.get("/debug/context",(req,res)=>{
  const admin=requireAdminOrDev(req,res); if(!admin) return;
  const u = getUserId(req);
  const user = u ? data.getUserById(u) : null;
  const ctx = data.getTownContext(1, u);
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
app.get("/debug/context/ui",(req,res)=>res.sendFile(path.join(__dirname,"public","debug_context.html")));
app.get("/live/:id",(req,res)=>res.sendFile(path.join(__dirname,"public","live.html")));
app.get("/me/live",(req,res)=>res.sendFile(path.join(__dirname,"public","live_host.html")));
function requireAdminPage(req,res){
  const uid = getUserId(req);
  if(!uid){ res.redirect("/admin/login"); return null; }
  const user = data.getUserById(uid);
  if(!isAdminUser(user)){
    res.status(403).sendFile(path.join(__dirname,"public","admin_login.html"));
    return null;
  }
  return user;
}
app.get("/admin/login",(req,res)=>res.sendFile(path.join(__dirname,"public","admin_login.html")));
app.get("/admin",(req,res)=>{
  const admin=requireAdminPage(req,res); if(!admin) return;
  res.sendFile(path.join(__dirname,"public","admin.html"));
});
app.get("/admin/analytics",(req,res)=>{
  const admin=requireAdminPage(req,res); if(!admin) return;
  res.sendFile(path.join(__dirname,"public","admin_analytics.html"));
});
app.get("/admin/media",(req,res)=>{
  const admin=requireAdminPage(req,res); if(!admin) return;
  res.sendFile(path.join(__dirname,"public","admin_media.html"));
});
app.get("/store/:id",(req,res)=>res.sendFile(path.join(__dirname,"public","store.html")));
app.get("/admin/sweep",(req,res)=>{
  const admin=requireAdminPage(req,res); if(!admin) return;
  res.sendFile(path.join(__dirname,"public","admin_sweep.html"));
});
app.get("/admin/trust",(req,res)=>{
  const admin=requireAdminPage(req,res); if(!admin) return;
  res.sendFile(path.join(__dirname,"public","admin_trust.html"));
});
app.get("/admin/applications",(req,res)=>{
  const admin=requireAdminPage(req,res); if(!admin) return;
  res.sendFile(path.join(__dirname,"public","admin_applications.html"));
});
app.get("/admin/waitlist",(req,res)=>{
  const admin=requireAdminPage(req,res); if(!admin) return;
  res.sendFile(path.join(__dirname,"public","admin_applications.html"));
});

// Neighbor towns (directory only; no identity sharing)
app.get("/towns/neighbor",(req,res)=>res.json({towns:TOWN_DIRECTORY}));

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
function setCookie(res,n,v,o={}){
  const p=[`${n}=${encodeURIComponent(v)}`,"Path=/","SameSite=Lax"];
  if(o.httpOnly) p.push("HttpOnly");
  if(o.maxAge!=null) p.push(`Max-Age=${o.maxAge}`);
  res.setHeader("Set-Cookie",p.join("; "));
}
function getUserId(req){
  const sid=parseCookies(req).sid;
  if(!sid) return null;
  const r=data.getUserBySession(sid);
  return r?.user?.id ?? null;
}
function requireLogin(req,res){
  const u=getUserId(req);
  if(!u){res.status(401).json({error:"Login required"});return null;}
  return u;
}
function isAdminUser(user){
  if(!user) return false;
  const email=(user.email||"").toString().trim().toLowerCase();
  if(user.isAdmin === true) return true;
  if(Number(user.isAdmin)===1) return true;
  if(email && ADMIN_EMAIL_ALLOWLIST.has(email)) return true;
  return false;
}
function requireAdmin(req,res,options={}){
  const u=requireLogin(req,res); if(!u) return null;
  const user=data.getUserById(u);
  if(!isAdminUser(user)){
    const message = (options.message || "Admin required").toString();
    res.status(403).json({error: message});
    return null;
  }
  return user;
}
function requireAdminOrDev(req,res){
  if(process.env.NODE_ENV !== "production"){
    const u=requireLogin(req,res); if(!u) return null;
    return data.getUserById(u);
  }
  return requireAdmin(req,res);
}

function getAdminReviewLink(){
  const base = (process.env.PUBLIC_BASE_URL || process.env.SITE_URL || process.env.APP_URL || "").toString().trim();
  if(!base) return "/admin/applications";
  return `${base.replace(/\/$/,"")}/admin/applications`;
}

function getUserTier(req){
  const userId = getUserId(req);
  const user = userId ? data.getUserById(userId) : null;
  const ctx = data.getTownContext(1, userId);
  const tier = trust.resolveTier(user, ctx);
  return { userId, user, ctx, tier };
}
function hasPerm(user, perm, ctx){
  if(!user) return false;
  const context = ctx || data.getTownContext(1, user.id);
  return trust.hasPerm(user, context, perm);
}
function requirePerm(req,res,perm){
  const userId = requireLogin(req,res); if(!userId) return null;
  const user = data.getUserById(userId);
  const ctx = data.getTownContext(1, userId);
  if(!hasPerm(user, perm, ctx)){
    res.status(403).json({error:`Requires ${perm}`});
    return null;
  }
  return { userId, user, ctx };
}

function requireBuyerTier(req,res){
  const access = requirePerm(req,res,"BUY_MARKET");
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
function finalizeOrderPayment(order){
  if(!order) return { ok:false, error:"Order not found" };
  if(order.status === "paid") return { ok:true, alreadyPaid:true, order };
  const items = data.getOrderItems(order.id);
  const listingId = items[0]?.listingId || order.listingId;
  const listing = listingId ? data.getListingById(listingId) : null;
  const updated = data.markOrderPaid(order.id);
  data.markPaymentPaid(order.id);
  if(listing && (listing.listingType||"item")==="auction"){
    data.updateListingAuctionState(listing.id, {
      auctionStatus: "paid",
      paymentStatus: "paid",
      winningBidId: listing.winningBidId,
      winnerUserId: listing.winnerUserId,
      paymentDueAt: listing.paymentDueAt || ""
    });
  }else if(items.length){
    items.forEach((i)=>data.decrementListingQuantity(i.listingId, i.quantity));
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
app.post("/auth/request-link",(req,res)=>{
  const email=(req.body?.email||"").toLowerCase().trim();
  const c=data.createMagicLink(email);
  if(c.error) return res.status(400).json(c);
  const base=`${req.protocol}://${req.get("host")}`;
  res.json({ok:true,magicUrl:`${base}/auth/magic?token=${c.token}`});
});
app.get("/auth/magic",(req,res)=>{
  const c=data.consumeMagicToken(req.query.token);
  if(c.error) return res.status(400).send(c.error);
  const s=data.createSession(c.userId);
  setCookie(res,"sid",s.sid,{httpOnly:true,maxAge:60*60*24*30});
  res.redirect("/ui");
});
app.get("/auth/logout",(req,res)=>{
  const sid=parseCookies(req).sid;
  if(sid) data.deleteSession(sid);
  setCookie(res,"sid","",{httpOnly:true,maxAge:0});
  res.redirect("/ui");
});
app.post("/auth/logout",(req,res)=>{
  const sid=parseCookies(req).sid;
  if(sid) data.deleteSession(sid);
  setCookie(res,"sid","",{httpOnly:true,maxAge:0});
  res.json({ok:true});
});

app.post("/api/public/waitlist",(req,res)=>{
  const result = data.addWaitlistSignup(req.body || {});
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

app.post("/api/public/apply/business",(req,res)=>{
  const result = data.addBusinessApplication(req.body || {});
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

app.post("/api/public/apply/resident",(req,res)=>{
  const result = data.addResidentApplication(req.body || {});
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
  const u=requireLogin(req,res); if(!u) return;
  const ctx=data.getTownContext(1, u);
  const user=data.getUserById(u);
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
    const media = data.addMediaObject({
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
app.get("/me",(req,res)=>{
  const sid=parseCookies(req).sid;
  if(!sid) return res.json({user:null});
  const r=data.getUserBySession(sid);
  if(!r) return res.json({user:null});
  data.ensureTownMembership(1,r.user.id);
  res.json(r);
});
app.get("/api/users/:id",(req,res)=>{
  const profile = data.getUserProfilePublic(req.params.id);
  if(!profile) return res.status(404).json({error:"User not found"});
  const user = data.getUserById(profile.id);
  const ctx = data.getTownContext(1, profile.id);
  const tier = trust.resolveTier(user, ctx);
  res.json({ ...profile, trustTier: tier, trustTierLabel: TRUST_TIER_LABELS[tier] || "Visitor" });
});
app.get("/api/me/profile",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const profile = data.getUserProfilePrivate(u);
  if(!profile) return res.status(404).json({error:"User not found"});
  res.json(profile);
});
app.patch("/api/me/profile",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
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
  const updated = data.updateUserProfile(u, {
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

app.get("/dm",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const convos = data.listDirectConversationsForUser(u).map((c)=>{
    const other = c.otherUser?.id ? getTrustBadgeForUser(c.otherUser.id) : null;
    return { ...c, otherUser: other || c.otherUser };
  });
  res.json(convos);
});
app.post("/dm/start",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const otherUserId = Number(req.body?.otherUserId);
  if(!otherUserId) return res.status(400).json({error:"otherUserId required"});
  if(Number(otherUserId)===Number(u)) return res.status(400).json({error:"Cannot message self"});
  const other = data.getUserById(otherUserId);
  if(!other) return res.status(404).json({error:"User not found"});
  const convo = data.addDirectConversation(u, otherUserId);
  res.status(201).json({ id: convo.id, otherUserId });
});
app.get("/dm/:id/messages",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  if(!data.isDirectConversationMember(req.params.id, u)) return res.status(403).json({error:"Forbidden"});
  const msgs = data.getDirectMessages(req.params.id).map((m)=>({
    ...m,
    sender: getTrustBadgeForUser(m.senderUserId)
  }));
  res.json(msgs);
});
app.post("/dm/:id/messages",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const ctx=data.getTownContext(1, u);
  const user=data.getUserById(u);
  const gate = trust.can(user, ctx, "chat_text");
  if(!gate.ok) return res.status(403).json({error:"Chat requires verified access"});
  if(!data.isDirectConversationMember(req.params.id, u)) return res.status(403).json({error:"Forbidden"});
  const text = (req.body?.text || "").toString().trim();
  if(!text) return res.status(400).json({error:"text required"});
  const msg = data.addDirectMessage(req.params.id, u, text);
  res.status(201).json({ ok:true, id: msg.id });
});
app.get("/town/context",(req,res)=>{
  const u=getUserId(req);
  const ctx = data.getTownContext(1, u);
  const user = u ? data.getUserById(u) : null;
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

app.post("/api/presence/verify",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  const accuracyMeters = Number(req.body?.accuracyMeters);
  const check = isInsideSebastian(lat, lng, accuracyMeters);
  if(!check.ok) return res.status(400).json({ ok:false, inside:false, error: check.error });
  const updated = data.updateUserPresence(u, { lat, lng, accuracyMeters });
  res.json({ ok:true, inside:true, presenceVerifiedAt: updated.presenceVerifiedAt });
});

app.post("/api/verify/location",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  const check = isInsideSebastianBox(lat, lng);
  if(!check.ok) return res.status(400).json({ ok:false, inside:false, error: check.error });
  data.setUserLocationVerifiedSebastian(u, true);
  res.json({ ok:true, inside:true });
});

app.post("/api/verify/resident",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const created = data.addResidentVerificationRequest(req.body || {}, u);
  if(created?.error) return res.status(400).json(created);
  res.status(201).json(created);
});

app.post("/api/admin/verify/resident/approve",(req,res)=>{
  const admin=requireAdmin(req,res); if(!admin) return;
  const userId = Number(req.body?.userId);
  if(!userId) return res.status(400).json({error:"userId required"});
  const approved = data.approveResidentVerification(userId, admin.id);
  if(approved?.error) return res.status(400).json(approved);
  const updated = data.setUserTrustTier(1, userId, 2);
  if(updated?.error) return res.status(400).json(updated);
  res.json({ ok:true });
});

app.post("/api/admin/verify/business/approve",(req,res)=>{
  const admin=requireAdmin(req,res); if(!admin) return;
  const userId = Number(req.body?.userId);
  if(!userId) return res.status(400).json({error:"userId required"});
  const updated = data.setUserTrustTier(1, userId, 3);
  if(updated?.error) return res.status(400).json(updated);
  res.json({ ok:true });
});

app.post("/api/trust/apply",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
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
  const user = data.getUserById(u);
  if(requestedTier === 1){
    if(Number(user?.locationVerifiedSebastian || 0) !== 1){
      return res.status(400).json({error:"Location verified in Sebastian required."});
    }
  }
  if(requestedTier === 2){
    const reqRow = data.addResidentVerificationRequest({
      addressLine1: payload.address1,
      city: payload.city,
      state: payload.state,
      zip: payload.zip
    }, u);
    if(reqRow?.error) return res.status(400).json(reqRow);
  }
  data.updateUserContact(u, {
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
  const appRow = data.addTrustApplication({
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

app.get("/api/trust/my",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const ctx = data.getTownContext(1, u);
  const user = data.getUserById(u);
  const tier = trust.resolveTier(user, ctx);
  const apps = data.getTrustApplicationsByUser(u);
  res.json({ trustTier: tier, tierName: TRUST_TIER_LABELS[tier] || "Visitor", applications: apps });
});

app.get("/api/admin/trust/apps",(req,res)=>{
  const admin=requireAdmin(req,res); if(!admin) return;
  const status = (req.query?.status || "pending").toString();
  res.json(data.getTrustApplicationsByStatus(status));
});
app.post("/api/admin/trust/apps/:id/approve",(req,res)=>{
  const admin=requireAdmin(req,res); if(!admin) return;
  const appRow = data.getTrustApplicationsByStatus("pending").find(a=>a.id==req.params.id);
  if(!appRow) return res.status(404).json({error:"Application not found"});
  data.updateTrustApplicationStatus(appRow.id, "approved", admin.id, "");
  data.setUserTrustTier(1, appRow.userId, appRow.requestedTier);
  res.json({ ok:true });
});
app.post("/api/admin/trust/apps/:id/reject",(req,res)=>{
  const admin=requireAdmin(req,res); if(!admin) return;
  const reason = (req.body?.reason || "").toString().trim();
  if(!reason) return res.status(400).json({error:"reason required"});
  data.updateTrustApplicationStatus(Number(req.params.id), "rejected", admin.id, reason);
  res.json({ ok:true });
});

app.post("/api/live/rooms/create", async (req,res)=>{
  const access = requirePerm(req,res,"LIVE_HOST"); if(!access) return;
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
    const place = data.getPlaceById(hostPlaceId);
    if(!place) return res.status(404).json({error:"Place not found"});
    if(Number(place.ownerUserId)!==Number(u)) return res.status(403).json({error:"Only owner can host for place"});
  }
  if(hostType === "event"){
    const ev = data.getEventById(hostEventId);
    if(!ev) return res.status(404).json({error:"Event not found"});
    const isOrganizer = (ev.organizerEmail || "").toLowerCase() === (user.email || "").toLowerCase();
    if(!isOrganizer && !isAdminUser(user)) return res.status(403).json({error:"Only organizer or admin can host"});
  }
  const calls = await createCallsRoom();
  const channelName = `live-${Date.now()}-${Math.random().toString(16).slice(2,6)}`;
  const channel = data.createChannel(channelName, `Live room: ${title || "Untitled"}`, 1);
  const room = data.createLiveRoom({
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

app.post("/api/live/rooms/:id/start",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const room = data.getLiveRoomById(req.params.id);
  if(!room) return res.status(404).json({error:"Room not found"});
  if(Number(room.hostUserId)!==Number(u) && !isAdminUser(data.getUserById(u))){
    return res.status(403).json({error:"Only host or admin can start"});
  }
  const updated = data.updateLiveRoom(room.id, { status:"live", startedAt: new Date().toISOString() });
  res.json(updated);
});

app.post("/api/live/rooms/:id/end",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const room = data.getLiveRoomById(req.params.id);
  if(!room) return res.status(404).json({error:"Room not found"});
  if(Number(room.hostUserId)!==Number(u) && !isAdminUser(data.getUserById(u))){
    return res.status(403).json({error:"Only host or admin can end"});
  }
  const updated = data.updateLiveRoom(room.id, { status:"ended", endedAt: new Date().toISOString() });
  res.json(updated);
});

app.post("/api/live/rooms/:id/pin",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const room = data.getLiveRoomById(req.params.id);
  if(!room) return res.status(404).json({error:"Room not found"});
  if(Number(room.hostUserId)!==Number(u) && !isAdminUser(data.getUserById(u))){
    return res.status(403).json({error:"Only host or admin can pin"});
  }
  const listingId = Number(req.body?.listingId);
  if(!listingId) return res.status(400).json({error:"listingId required"});
  const listing = data.getListingById(listingId);
  if(!listing) return res.status(404).json({error:"Listing not found"});
  const place = data.getPlaceById(listing.placeId);
  if(room.hostPlaceId && Number(listing.placeId)!==Number(room.hostPlaceId)){
    return res.status(403).json({error:"Listing must belong to host store"});
  }
  if(place && Number(place.ownerUserId)!==Number(room.hostUserId)){
    return res.status(403).json({error:"Only host listings can be pinned"});
  }
  const updated = data.updateLiveRoom(room.id, { pinnedListingId: listing.id });
  res.json(updated);
});

app.get("/api/live/rooms/active",(req,res)=>{
  const access = requirePerm(req,res,"VIEW_SCHEDULED"); if(!access) return;
  const rooms = data.listActiveLiveRooms(1).map(r=>({ id:r.id, title:r.title, hostType:r.hostType || "individual", joinUrl:`/live/${r.id}` }));
  res.json(rooms);
});

app.get("/api/live/rooms/:id",(req,res)=>{
  const access = requirePerm(req,res,"VIEW_SCHEDULED"); if(!access) return;
  const room = data.getLiveRoomById(req.params.id);
  if(!room) return res.status(404).json({error:"Room not found"});
  const hostUser = data.getUserById(room.hostUserId);
  const hostPlace = room.hostPlaceId ? data.getPlaceById(room.hostPlaceId) : null;
  const hostEvent = room.hostEventId ? data.getEventById(room.hostEventId) : null;
  const pinned = room.pinnedListingId ? data.getListingById(room.pinnedListingId) : null;
  const pinnedPlace = pinned ? data.getPlaceById(pinned.placeId) : null;
  res.json({
    ...room,
    joinUrl: `/live/${room.id}`,
    host: {
      type: room.hostType || "individual",
      displayName: data.getDisplayNameForUser(hostUser),
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

app.get("/api/live/scheduled",(req,res)=>{
  const access = requirePerm(req,res,"VIEW_SCHEDULED"); if(!access) return;
  const from = req.query.from;
  const to = req.query.to;
  const shows = data.listScheduledLiveShows({ from, to });
  const u = access.userId;
  let bookmarks = new Set();
  if(u){
    const rows = data.getLiveShowBookmarksForUser(u);
    bookmarks = new Set(rows.map(r=>Number(r.showId)));
  }
  const activeRooms = data.listActiveLiveRooms(1);
  const matchKey = (r)=>`${r.hostType || "individual"}:${r.hostUserId}:${r.hostPlaceId || ""}:${r.hostEventId || ""}`;
  const activeMap = new Map(activeRooms.map(r=>[matchKey(r), r]));
  const out = shows.map(s=>{
    const hostUser = data.getUserById(s.hostUserId);
    const place = s.hostPlaceId ? data.getPlaceById(s.hostPlaceId) : null;
    const ev = s.hostEventId ? data.getEventById(s.hostEventId) : null;
    const active = activeMap.get(`${s.hostType || "individual"}:${s.hostUserId}:${s.hostPlaceId || ""}:${s.hostEventId || ""}`);
    const hostName = data.getDisplayNameForUser(hostUser);
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
  });
  res.json(out);
});

app.post("/api/live/scheduled",(req,res)=>{
  const access = requirePerm(req,res,"LIVE_SCHEDULE"); if(!access) return;
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
    const place = data.getPlaceById(hostPlaceId);
    if(!place) return res.status(404).json({error:"Place not found"});
    if(Number(place.ownerUserId)!==Number(u)) return res.status(403).json({error:"Only owner can host for place"});
  }
  if(hostType === "event"){
    const ev = data.getEventById(hostEventId);
    if(!ev) return res.status(404).json({error:"Event not found"});
    const isOrganizer = (ev.organizerEmail || "").toLowerCase() === (user.email || "").toLowerCase();
    if(!isOrganizer && !isAdminUser(user)) return res.status(403).json({error:"Only organizer or admin can host"});
  }
  const created = data.addScheduledLiveShow({
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

app.get("/api/live/scheduled/:id/bookmark",(req,res)=>{
  const access = requirePerm(req,res,"VIEW_SCHEDULED"); if(!access) return;
  const u=access.userId;
  const showId = Number(req.params.id);
  const rows = data.getLiveShowBookmarksForUser(u);
  const bookmarked = rows.some(r=>Number(r.showId)===showId);
  res.json({ bookmarked });
});
app.post("/api/live/scheduled/:id/bookmark",(req,res)=>{
  const access = requirePerm(req,res,"VIEW_SCHEDULED"); if(!access) return;
  const u=access.userId;
  const showId = Number(req.params.id);
  const toggled = data.toggleLiveShowBookmark(u, showId);
  res.json(toggled);
});

app.post("/api/signup",(req,res)=>{
  const r=data.addSignup(req.body||{});
  if(r?.error) return res.status(400).json(r);
  res.json(r);
});

// Events v1 (submission + approvals)
app.post("/api/events/submit",(req,res)=>{
  const access = requirePerm(req,res,"CREATE_EVENTS"); if(!access) return;
  const created=data.addEventSubmission(req.body || {});
  if(created?.error) return res.status(400).json(created);
  res.status(201).json(created);
});
app.get("/api/events",(req,res)=>{
  const access = requirePerm(req,res,"VIEW_EVENTS"); if(!access) return;
  const status=(req.query.status || "approved").toString().trim().toLowerCase();
  if(status && status !== "approved") return res.status(400).json({error:"Only approved events can be listed"});
  const from=req.query.from;
  const to=req.query.to;
  const events = data.listApprovedEvents({ from, to }).map((ev)=>{
    if(!ev.organizerUserId) return ev;
    const badge = getTrustBadgeForUser(ev.organizerUserId);
    return { ...ev, organizerTrustTierLabel: badge?.trustTierLabel || null };
  });
  res.json(events);
});

// Local businesses (applications)
app.post("/api/localbiz/apply",(req,res)=>{
  const access = requirePerm(req,res,"VIEW_LOCALBIZ"); if(!access) return;
  const created=data.addLocalBizApplication(req.body || {}, access.userId);
  if(created?.error) return res.status(400).json(created);
  res.status(201).json(created);
});
app.get("/api/localbiz/my",(req,res)=>{
  const access = requirePerm(req,res,"VIEW_LOCALBIZ"); if(!access) return;
  res.json(data.listLocalBizApplicationsByUser(access.userId));
});

// Prize offers
app.post("/api/prizes/submit",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const ctx=data.getTownContext(1, u);
  const user=data.getUserById(u);
  const gate = trust.can(user, ctx, "prize_submit");
  if(!gate.ok) return res.status(403).json({error:"Prize offers require resident trust"});
  const created=data.addPrizeOffer(req.body || {}, u);
  if(created?.error) return res.status(400).json(created);
  res.status(201).json(created);
});
app.get("/api/prizes/active",(req,res)=>{
  const rows = data.listActivePrizeOffers().map(p=>{
    const badge = getTrustBadgeForUser(p.donorUserId);
    return { ...p, donorTrustTierLabel: badge?.trustTierLabel || null };
  });
  res.json(rows);
});

// Archive
app.get("/api/archive",(req,res)=>{
  const access = requirePerm(req,res,"VIEW_ARCHIVE"); if(!access) return;
  res.json(data.listArchiveEntries());
});
app.get("/api/archive/:slug",(req,res)=>{
  const access = requirePerm(req,res,"VIEW_ARCHIVE"); if(!access) return;
  const entry=data.getArchiveEntryBySlug(req.params.slug);
  if(!entry) return res.status(404).json({error:"Not found"});
  res.json(entry);
});

app.get("/api/prize_awards/my",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const placeId = req.query.placeId ? Number(req.query.placeId) : null;
  if(placeId){
    const place = data.getPlaceById(placeId);
    if(!place || Number(place.ownerUserId)!==Number(u)) return res.status(403).json({error:"Only owner"});
  }
  res.json(data.listPrizeAwardsForUser(u, placeId));
});
app.post("/api/prize_awards/:id/claim",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const award = data.getPrizeAwardById(req.params.id);
  if(!award) return res.status(404).json({error:"Not found"});
  if(Number(award.winnerUserId)!==Number(u)) return res.status(403).json({error:"Winner only"});
  const updated = data.updatePrizeAwardStatus(award.id, "claimed", {});
  res.json(updated);
});
app.post("/api/prize_awards/:id/scheduled",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const award = data.getPrizeAwardById(req.params.id);
  if(!award) return res.status(404).json({error:"Not found"});
  if(Number(award.donorUserId)!==Number(u)) return res.status(403).json({error:"Donor only"});
  const updated = data.updatePrizeAwardStatus(award.id, "scheduled", {});
  res.json(updated);
});
app.post("/api/prize_awards/:id/fulfilled",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const award = data.getPrizeAwardById(req.params.id);
  if(!award) return res.status(404).json({error:"Not found"});
  if(Number(award.donorUserId)!==Number(u)) return res.status(403).json({error:"Donor only"});
  const proofUrl = (req.body?.proofUrl || "").toString().trim();
  const updated = data.updatePrizeAwardStatus(award.id, "fulfilled", { proofUrl });
  res.json(updated);
});
app.post("/api/prize_awards/:id/confirm_received",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const award = data.getPrizeAwardById(req.params.id);
  if(!award) return res.status(404).json({error:"Not found"});
  if(Number(award.winnerUserId)!==Number(u)) return res.status(403).json({error:"Winner only"});
  const updated = data.updatePrizeAwardStatus(award.id, "fulfilled", {});
  res.json(updated);
});
app.post("/api/prize_awards/:id/report_issue",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const award = data.getPrizeAwardById(req.params.id);
  if(!award) return res.status(404).json({error:"Not found"});
  if(Number(award.winnerUserId)!==Number(u)) return res.status(403).json({error:"Winner only"});
  const updated = data.updatePrizeAwardStatus(award.id, "disputed", {});
  res.json(updated);
});

// Events (boot + calendar)
app.get("/events",(req,res)=>{
  const access = requirePerm(req,res,"VIEW_EVENTS"); if(!access) return;
  const range = (req.query.range || "week").toString();
  const safeRange = (range === "month") ? "month" : "week";
  res.json(data.getCalendarEvents(safeRange));
});
app.post("/events",(req,res)=>{
  if(req.body?.eventType || req.body?.clientSessionId){
    data.logEvent(req.body || {});
    return res.json({ok:true});
  }
  const access = requirePerm(req,res,"CREATE_EVENTS"); if(!access) return;
  const u=access.userId;
  if(!req.body?.title || !req.body?.startsAt) return res.status(400).json({error:"title and startsAt required"});
  const created=data.addCalendarEvent(req.body, u);
  res.status(201).json(created);
});
app.post("/events/:id/rsvp",(req,res)=>{
  const access = requirePerm(req,res,"RSVP_EVENTS"); if(!access) return;
  const u=access.userId;
  const ev=data.getCalendarEventById(req.params.id);
  if(!ev) return res.status(404).json({error:"Event not found"});
  data.addEventRsvp(ev.id, u, req.body?.status || "going");
  res.json({ok:true});
});

// Orders (payment scaffolding)
app.get("/api/cart",(req,res)=>{
  const access = requirePerm(req,res,"BUY_MARKET"); if(!access) return;
  const u=access.userId;
  const items = data.getCartItemsByUser(u);
  const listings = data.getListings();
  const placeMap = new Map((data.getPlaces ? data.getPlaces() : data.places || []).map(p=>[Number(p.id), p]));
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
app.post("/api/cart/add",(req,res)=>{
  const u=requireBuyerTier(req,res); if(!u) return;
  const listingId = Number(req.body?.listingId || 0);
  const quantity = Number(req.body?.quantity || 1);
  if(!listingId || !Number.isFinite(quantity) || quantity === 0) return res.status(400).json({error:"listingId and quantity required"});
  const listing = data.getListingById(listingId);
  if(!listing) return res.status(404).json({error:"Listing not found"});
  if((listing.listingType||"item")!=="item") return res.status(400).json({error:"Only item listings can be added to cart"});
  if((listing.status || "active")!=="active") return res.status(400).json({error:"Listing not active"});
  if(quantity > 0){
    const existing = data.getCartItem(u, listingId);
    const existingQty = Number(existing?.quantity || 0);
    if(Number(listing.quantity || 0) < (existingQty + quantity)) return res.status(400).json({error:"Insufficient quantity"});
  }
  const created = data.addCartItem(u, listingId, quantity);
  res.json({ ok:true, item: created });
});
app.post("/api/cart/remove",(req,res)=>{
  const access = requirePerm(req,res,"BUY_MARKET"); if(!access) return;
  const u=access.userId;
  const listingId = Number(req.body?.listingId || 0);
  if(!listingId) return res.status(400).json({error:"listingId required"});
  data.removeCartItem(u, listingId);
  res.json({ ok:true });
});
app.post("/api/cart/clear",(req,res)=>{
  const access = requirePerm(req,res,"BUY_MARKET"); if(!access) return;
  const u=access.userId;
  data.clearCart(u);
  res.json({ ok:true });
});

app.post("/api/checkout/create",(req,res)=>{
  const u=requireBuyerTier(req,res); if(!u) return;
  const cart = data.getCartItemsByUser(u);
  if(!cart.length) return res.status(400).json({error:"Cart is empty"});
  const listings = data.getListings();
  const placeMap = new Map((data.getPlaces ? data.getPlaces() : data.places || []).map(p=>[Number(p.id), p]));
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
  const order = data.createOrderFromCart({
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
  data.createPaymentForOrder(order.id, totalCents, "stripe");
  data.clearCart(u);
  res.json({ orderId: order.id, paymentStatus: "requires_payment", totals: { subtotalCents, serviceGratuityCents, totalCents } });
});
app.post("/api/checkout/stripe", async (req,res)=>{
  const u=requireBuyerTier(req,res); if(!u) return;
  const s = requireStripeConfig(res); if(!s) return;
  const orderId = Number(req.body?.orderId || 0);
  if(!orderId) return res.status(400).json({error:"orderId required"});
  const order = data.getOrderById(orderId);
  if(!order) return res.status(404).json({error:"Order not found"});
  if(Number(order.buyerUserId)!==Number(u)) return res.status(403).json({error:"Buyer only"});
  if(!["pending_payment","requires_payment"].includes(String(order.status||""))) return res.status(400).json({error:"Order not payable"});
  const items = data.getOrderItems(order.id);
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
    data.updateOrderPayment(order.id, "stripe", session.id || "");
    const existingPayment = data.getPaymentForOrder(order.id);
    if(!existingPayment) data.createPaymentForOrder(order.id, Number(order.totalCents || 0), "stripe");
    res.json({ checkoutUrl: session.url });
  }catch(e){
    res.status(500).json({error:"Stripe checkout failed"});
  }
});

app.get("/api/orders",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  res.json(data.getOrdersForBuyer(u));
});
app.get("/api/seller/orders",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const places = (data.getPlaces ? data.getPlaces() : data.places || []).filter(p=>Number(p.ownerUserId)===Number(u));
  const placeIds = places.map(p=>Number(p.id));
  const orders = data.getOrdersForSellerPlaces(placeIds);
  res.json(orders);
});

app.post("/orders",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const listingId=Number(req.body?.listingId);
  const qtyRaw=req.body?.quantity;
  const quantity=Number.isFinite(Number(qtyRaw)) ? Number(qtyRaw) : 1;
  if(!listingId) return res.status(400).json({error:"listingId required"});
  const listing=data.getListingById(listingId);
  if(!listing) return res.status(404).json({error:"Listing not found"});
  if(quantity < 1) return res.status(400).json({error:"quantity must be >= 1"});
  const amountCents=Math.round(Number(listing.price || 0) * 100) * quantity;
  const placeList = (data.getPlaces ? data.getPlaces() : data.places || []);
  const place = placeList.find(p=>Number(p.id)===Number(listing.placeId));
  if(!place) return res.status(404).json({error:"Place not found"});
  const intent = paymentProvider.createPaymentIntent({
    amountCents,
    currency: "usd",
    metadata: { listingId, buyerUserId: u, placeId: place.id }
  });
  Promise.resolve(intent).then((pi)=>{
    const order=data.addOrder({
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
  }).catch((e)=>res.status(500).json({error:e.message}));
});
app.get("/api/orders/:id",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const order=data.getOrderById(req.params.id);
  if(!order) return res.status(404).json({error:"Order not found"});
  if(Number(order.buyerUserId)!==Number(u) && Number(order.sellerUserId)!==Number(u)){
    return res.status(403).json({error:"Forbidden"});
  }
  const items = data.getOrderItems(order.id);
  const listingId = items[0]?.listingId || order.listingId;
  const listing = listingId ? data.getListingById(listingId) : null;
  res.json({ order, items, listing });
});
app.post("/api/orders/:id/pay",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  if(process.env.NODE_ENV === "production") return res.status(403).json({error:"Dev-only endpoint"});
  const order=data.getOrderById(req.params.id);
  if(!order) return res.status(404).json({error:"Order not found"});
  if(Number(order.buyerUserId)!==Number(u)) return res.status(403).json({error:"Buyer only"});
  if(order.status === "paid") return res.status(400).json({error:"Already paid"});
  const items = data.getOrderItems(order.id);
  const listingId = items[0]?.listingId || order.listingId;
  const listing = listingId ? data.getListingById(listingId) : null;
  if(listing?.paymentDueAt){
    const dueAt = Date.parse(listing.paymentDueAt);
    if(Number.isFinite(dueAt) && Date.now() > dueAt) return res.status(400).json({error:"Payment overdue"});
  }
  const existingPayment = data.getPaymentForOrder(order.id);
  if(existingPayment && existingPayment.status === "paid") return res.status(400).json({error:"Already paid"});
  if(!existingPayment){
    data.createPaymentForOrder(order.id, Number(order.totalCents || 0), "stub");
  }
  const result = finalizeOrderPayment(order);
  if(!result.ok) return res.status(400).json({error: result.error || "Payment failed"});
  res.json({ok:true, order: result.order || order});
});
app.get("/orders/:id",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const order=data.getOrderById(req.params.id);
  if(!order) return res.status(404).json({error:"Order not found"});
  if(Number(order.buyerUserId)!==Number(u) && Number(order.sellerUserId)!==Number(u)){
    return res.status(403).json({error:"Forbidden"});
  }
  res.json(order);
});
app.post("/orders/:id/complete",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const order=data.getOrderById(req.params.id);
  if(!order) return res.status(404).json({error:"Order not found"});
  if(Number(order.buyerUserId)!==Number(u) && Number(order.sellerUserId)!==Number(u)){
    return res.status(403).json({error:"Forbidden"});
  }
  Promise.resolve(paymentProvider.capturePaymentIntent(order.paymentIntentId)).then(()=>{
    const updated=data.completeOrder(order.id);
    res.json(updated);
  }).catch((e)=>res.status(500).json({error:e.message}));
});

// Trust: reviews + disputes
app.post("/orders/:id/review",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const order=data.getOrderById(req.params.id);
  if(!order) return res.status(404).json({error:"Order not found"});
  if(order.status!=="completed") return res.status(400).json({error:"Order must be completed"});
  if(Number(order.buyerUserId)!==Number(u) && Number(order.sellerUserId)!==Number(u)){
    return res.status(403).json({error:"Forbidden"});
  }
  if(data.getReviewForOrder(order.id, u)) return res.status(400).json({error:"Review already submitted"});
  const rating=Number(req.body?.rating);
  const text=(req.body?.text||"").toString().trim();
  if(!Number.isFinite(rating) || rating<1 || rating>5) return res.status(400).json({error:"rating 1-5 required"});
  const reviewerIsBuyer = Number(order.buyerUserId)===Number(u);
  const revieweeUserId = reviewerIsBuyer ? order.sellerUserId : order.buyerUserId;
  const role = reviewerIsBuyer ? "buyer" : "seller";
  const created=data.addReview({orderId:order.id, reviewerUserId:u, revieweeUserId, role, rating, text});
  data.addTrustEvent({orderId:order.id, userId:revieweeUserId, eventType:"review_received", meta:{rating, role}});
  res.status(201).json(created);
});
app.post("/orders/:id/dispute",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const order=data.getOrderById(req.params.id);
  if(!order) return res.status(404).json({error:"Order not found"});
  if(Number(order.buyerUserId)!==Number(u) && Number(order.sellerUserId)!==Number(u)){
    return res.status(403).json({error:"Forbidden"});
  }
  const reason=(req.body?.reason||"").toString().trim();
  if(!reason) return res.status(400).json({error:"reason required"});
  const created=data.addDispute({orderId:order.id, reporterUserId:u, reason, status:"open"});
  data.addTrustEvent({orderId:order.id, userId:u, eventType:"dispute_opened", meta:{reason}});
  res.status(201).json(created);
});

// Admin moderation (basic)
app.get("/api/admin/pulse",(req,res)=>{
  const hours = Number(req.query.hours || 24);
  const since = new Date(Date.now() - (Number.isFinite(hours) ? hours : 24) * 60 * 60 * 1000).toISOString();
  res.json({ since, sessions: 0, counts: [] });
});
app.get("/api/admin/analytics/summary",(req,res)=>{
  const admin=requireAdmin(req,res); if(!admin) return;
  const { from, to, range } = rangeToBounds(req.query?.range);
  const listings = data.getListings();
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

  const places = (data.getPlaces ? data.getPlaces() : data.places || []);
  const pendingPlaces = data.listPlacesByStatus ? data.listPlacesByStatus("pending") : places.filter(p=>String(p.status||"").toLowerCase()==="pending");
  const trustPending = data.getTrustApplicationsByStatus("pending").length;
  const residentPending = data.listResidentVerificationRequestsByStatus("pending").length;
  const businessPending = data.listLocalBizApplicationsByStatus("pending").length;

  const usersTotal = data.countUsers();
  const usersNew = data.countUsersSince(from);
  const ordersTotal = data.countOrders();
  const ordersRange = data.countOrdersSince(from);
  const revenueTotalCents = data.sumOrderRevenue();
  const revenueRangeCents = data.sumOrderRevenueSince(from);

  const liveActive = data.listActiveLiveRooms(1).length;
  const liveScheduled = data.listScheduledLiveShows({}).length;

  const sweep = data.getActiveSweepstake();
  let sweepStatus = "inactive";
  let sweepEntries = 0;
  if(sweep){
    sweepStatus = String(sweep.status || "active");
    const totals = data.getSweepstakeEntryTotals(sweep.id);
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
app.get("/api/seller/sales/summary",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const placeId = Number(req.query.placeId || 0);
  if(!placeId) return res.status(400).json({error:"placeId required"});
  const place = data.getPlaceById(placeId);
  if(!place) return res.status(404).json({error:"Place not found"});
  if(Number(place.ownerUserId)!==Number(u)) return res.status(403).json({error:"Owner only"});
  const range = (req.query.range || "7d").toString();
  const { fromIso, toIso, label } = parseRange(range, req.query.from, req.query.to);
  const summary = data.getSellerSalesSummary(placeId, fromIso, toIso);
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
app.get("/api/seller/sales/export.csv",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const placeId = Number(req.query.placeId || 0);
  if(!placeId) return res.status(400).json({error:"placeId required"});
  const place = data.getPlaceById(placeId);
  if(!place) return res.status(404).json({error:"Place not found"});
  if(Number(place.ownerUserId)!==Number(u)) return res.status(403).json({error:"Owner only"});
  const { fromIso, toIso } = parseRange("custom", req.query.from, req.query.to);
  const rows = data.getSellerSalesExport(placeId, fromIso, toIso);
  const header = "orderId,createdAt,status,totalCents,subtotalCents,serviceGratuityCents,listingId,titleSnapshot,quantity,priceCentsSnapshot";
  const csv = rows.map(r=>[
    r.orderId, r.createdAt, r.status, r.totalCents, r.subtotalCents, r.serviceGratuityCents,
    r.listingId, JSON.stringify(r.titleSnapshot || ""), r.quantity, r.priceCentsSnapshot
  ].join(","));
  res.setHeader("Content-Type","text/csv");
  res.send([header, ...csv].join("\n"));
});
app.post("/api/admin/pulse/generate",(req,res)=>{
  const admin=requireAdminOrDev(req,res); if(!admin) return;
  const dayKey=(req.body?.dayKey || "").toString().trim() || null;
  const pulse=data.generateDailyPulse(1, dayKey || undefined);
  res.json(pulse);
});
app.get("/api/pulse/latest",(req,res)=>{
  const pulse=data.getLatestPulse(1);
  if(!pulse) return res.status(404).json({error:"No pulse found"});
  res.json(pulse);
});
app.get("/api/pulse/:dayKey",(req,res)=>{
  const dayKey=(req.params.dayKey || "").toString().trim();
  if(!dayKey) return res.status(400).json({error:"dayKey required"});
  const pulse=data.getPulseByDayKey(dayKey, 1);
  if(!pulse) return res.status(404).json({error:"Pulse not found"});
  res.json(pulse);
});
app.get("/api/admin/places",(req,res)=>{
  res.json([]);
});
app.get("/api/admin/events",(req,res)=>{
  const admin=requireAdmin(req,res); if(!admin) return;
  const status=(req.query.status || "pending").toString().trim().toLowerCase();
  res.json(data.listEventsByStatus(status));
});
app.post("/api/admin/events/:id/approve",(req,res)=>{
  const admin=requireAdmin(req,res); if(!admin) return;
  const updated=data.updateEventDecision(req.params.id, "approved", admin.id, "");
  if(!updated) return res.status(404).json({error:"Not found"});
  res.json(updated);
});
app.post("/api/admin/events/:id/deny",(req,res)=>{
  const admin=requireAdmin(req,res); if(!admin) return;
  const reason=(req.body?.decisionReason || "").toString().trim();
  if(!reason) return res.status(400).json({error:"decisionReason required"});
  const updated=data.updateEventDecision(req.params.id, "denied", admin.id, reason);
  if(!updated) return res.status(404).json({error:"Not found"});
  res.json(updated);
});

app.get("/api/admin/localbiz",(req,res)=>{
  const admin=requireAdmin(req,res); if(!admin) return;
  const status=(req.query.status || "pending").toString().trim().toLowerCase();
  res.json(data.listLocalBizApplicationsByStatus(status));
});
app.post("/api/admin/localbiz/:id/approve",(req,res)=>{
  const admin=requireAdmin(req,res); if(!admin) return;
  const updated=data.updateLocalBizDecision(req.params.id, "approved", admin.id, "");
  if(!updated) return res.status(404).json({error:"Not found"});
  res.json(updated);
});
app.post("/api/admin/localbiz/:id/deny",(req,res)=>{
  const admin=requireAdmin(req,res); if(!admin) return;
  const reason=(req.body?.reason || "").toString().trim();
  if(!reason) return res.status(400).json({error:"reason required"});
  const updated=data.updateLocalBizDecision(req.params.id, "denied", admin.id, reason);
  if(!updated) return res.status(404).json({error:"Not found"});
  res.json(updated);
});

app.get("/api/admin/waitlist",(req,res)=>{
  const admin=requireAdmin(req,res); if(!admin) return;
  const status=(req.query.status || "pending").toString().trim().toLowerCase();
  res.json(data.listWaitlistSignupsByStatus(status));
});
app.post("/api/admin/waitlist/:id/status",(req,res)=>{
  const admin=requireAdmin(req,res); if(!admin) return;
  const status=(req.body?.status || "").toString().trim().toLowerCase();
  if(status !== "approved" && status !== "rejected" && status !== "pending"){
    return res.status(400).json({error:"status must be approved, rejected, or pending"});
  }
  const updated = data.updateWaitlistStatus(req.params.id, status);
  if(!updated) return res.status(404).json({error:"Not found"});
  res.json(updated);
});

app.get("/api/admin/applications/business",(req,res)=>{
  const admin=requireAdmin(req,res); if(!admin) return;
  const status=(req.query.status || "pending").toString().trim().toLowerCase();
  res.json(data.listBusinessApplicationsByStatus(status));
});
app.post("/api/admin/applications/business/:id/status",(req,res)=>{
  const admin=requireAdmin(req,res); if(!admin) return;
  const status=(req.body?.status || "").toString().trim().toLowerCase();
  if(status !== "approved" && status !== "rejected" && status !== "pending"){
    return res.status(400).json({error:"status must be approved, rejected, or pending"});
  }
  const updated = data.updateBusinessApplicationStatus(req.params.id, status);
  if(!updated) return res.status(404).json({error:"Not found"});
  res.json(updated);
});

app.get("/api/admin/applications/resident",(req,res)=>{
  const admin=requireAdmin(req,res); if(!admin) return;
  const status=(req.query.status || "pending").toString().trim().toLowerCase();
  res.json(data.listResidentApplicationsByStatus(status));
});
app.post("/api/admin/applications/resident/:id/status",(req,res)=>{
  const admin=requireAdmin(req,res); if(!admin) return;
  const status=(req.body?.status || "").toString().trim().toLowerCase();
  if(status !== "approved" && status !== "rejected" && status !== "pending"){
    return res.status(400).json({error:"status must be approved, rejected, or pending"});
  }
  const updated = data.updateResidentApplicationStatus(req.params.id, status);
  if(!updated) return res.status(404).json({error:"Not found"});
  if(status === "approved"){
    const app = data.getResidentApplicationById(req.params.id);
    if(app?.email){
      const user = data.getUserByEmail(app.email);
      if(user) data.setUserResidentVerified(user.id, true);
    }
  }
  res.json(updated);
});

app.get("/api/admin/prizes",(req,res)=>{
  const admin=requireAdmin(req,res); if(!admin) return;
  const status=(req.query.status || "pending").toString().trim().toLowerCase();
  res.json(data.listPrizeOffersByStatus(status));
});
app.post("/api/admin/prizes/:id/approve",(req,res)=>{
  const admin=requireAdmin(req,res); if(!admin) return;
  const updated=data.updatePrizeOfferDecision(req.params.id, "approved", admin.id, "");
  if(!updated) return res.status(404).json({error:"Not found"});
  res.json(updated);
});
app.post("/api/admin/prizes/:id/reject",(req,res)=>{
  const admin=requireAdmin(req,res); if(!admin) return;
  const reason=(req.body?.reason || "").toString().trim();
  if(!reason) return res.status(400).json({error:"reason required"});
  const updated=data.updatePrizeOfferDecision(req.params.id, "rejected", admin.id, reason);
  if(!updated) return res.status(404).json({error:"Not found"});
  res.json(updated);
});
app.post("/api/admin/prizes/:id/award",(req,res)=>{
  const admin=requireAdmin(req,res); if(!admin) return;
  const winnerUserId = Number(req.body?.winnerUserId);
  if(!winnerUserId) return res.status(400).json({error:"winnerUserId required"});
  const offer = data.getPrizeOfferById(req.params.id);
  if(!offer) return res.status(404).json({error:"Not found"});
  const convo = data.addDirectConversation(offer.donorUserId, winnerUserId);
  const dueBy = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const award = data.addPrizeAward({
    prizeOfferId: offer.id,
    winnerUserId,
    donorUserId: offer.donorUserId,
    donorPlaceId: offer.donorPlaceId,
    status: "notified",
    dueBy,
    convoId: convo.id,
    proofUrl: ""
  });
  data.updatePrizeOfferDecision(offer.id, "awarded", admin.id, "");
  res.json({ ok:true, award });
});

app.get("/api/admin/media",(req,res)=>{
  const admin=requireAdmin(req,res); if(!admin) return;
  const townId = Number(req.query.townId || 1);
  const kind = (req.query.kind || "").toString().trim();
  const limit = Number(req.query.limit || 200);
  res.json(data.listMediaObjects({ townId, kind, limit: Number.isFinite(limit) ? limit : 200 }));
});
app.get("/api/admin/media/orphans",(req,res)=>{
  const admin=requireAdmin(req,res); if(!admin) return;
  const townId = Number(req.query.townId || 1);
  const limit = Number(req.query.limit || 200);
  const orphans = data.listMediaOrphans(townId, Number.isFinite(limit) ? limit : 200);
  const missingLocal = data.listMissingLocalMedia(townId, Number.isFinite(limit) ? limit : 200);
  res.json({ orphans, missingLocal });
});
app.get("/api/admin/trust/reviews",(req,res)=>{
  const rows = data.listReviews(200).map((r)=>{
    const reviewer = getTrustBadgeForUser(r.reviewerUserId);
    const reviewee = getTrustBadgeForUser(r.revieweeUserId);
    return {
      ...r,
      reviewerTrustTierLabel: reviewer?.trustTierLabel || null,
      revieweeTrustTierLabel: reviewee?.trustTierLabel || null
    };
  });
  res.json(rows);
});
app.get("/api/admin/trust/disputes",(req,res)=>{
  const rows = data.listDisputes(200).map((d)=>{
    const reporter = getTrustBadgeForUser(d.reporterUserId);
    return { ...d, reporterTrustTierLabel: reporter?.trustTierLabel || null };
  });
  res.json(rows);
});
app.get("/api/admin/stores",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const status = (req.query.status || "").toString().trim();
  res.json(data.listPlacesByStatus(status));
});
app.patch("/api/admin/stores/:id",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const status = (req.body?.status || "").toString().trim().toLowerCase();
  if(!["pending","approved","rejected"].includes(status)) return res.status(400).json({error:"Invalid status"});
  const updated = data.updatePlaceStatus(req.params.id, status);
  if(!updated) return res.status(404).json({error:"not found"});
  res.json(updated);
});

// Sweep
app.get("/sweep/balance",(req,res)=>{
  const u=getUserId(req);
  if(!u) return res.json({loggedIn:false,balance:0});
  res.json({loggedIn:true,balance:data.getSweepBalance(u)});
});
app.get("/sweepstake/active",(req,res)=>{
  let sweep = data.getActiveSweepstake();
  if(!sweep) return res.json({sweepstake:null});
  const drawAt = Date.parse(sweep.drawAt || "");
  if(Number.isFinite(drawAt) && Date.now() >= drawAt && !sweep.winnerUserId){
    sweep = data.drawSweepstakeWinner(sweep.id);
  }
  const totals = data.getSweepstakeEntryTotals(sweep.id);
  const winnerProfile = sweep.winnerUserId ? data.getUserProfilePublic(sweep.winnerUserId) : null;
  const u = getUserId(req);
  const userEntries = u ? data.getUserEntriesForSweepstake(sweep.id, u) : 0;
  const balance = u ? data.getSweepBalance(u) : 0;
  res.json({ sweepstake: sweep, totals, winner: winnerProfile, userEntries, balance });
});
app.post("/sweepstake/enter",(req,res)=>{
  const access = requirePerm(req,res,"SWEEP_ENTER"); if(!access) return;
  const u=access.userId;
  const sweepId = Number(req.body?.sweepstakeId);
  const entries = Number(req.body?.entries);
  if(!Number.isFinite(entries) || entries <= 0) return res.status(400).json({error:"entries must be > 0"});
  const sweep = data.getSweepstakeById(sweepId);
  if(!sweep) return res.status(404).json({error:"Sweepstake not found"});
  if(String(sweep.status) !== "active") return res.status(400).json({error:"Sweepstake not active"});
  const now = Date.now();
  const startAt = Date.parse(sweep.startAt || "");
  const endAt = Date.parse(sweep.endAt || "");
  if(Number.isFinite(startAt) && now < startAt) return res.status(400).json({error:"Sweepstake not started"});
  if(Number.isFinite(endAt) && now > endAt) return res.status(400).json({error:"Sweepstake ended"});
  const cost = Number(sweep.entryCost || 1) * entries;
  const balance = data.getSweepBalance(u);
  if(balance < cost) return res.status(400).json({error:"Insufficient sweep balance"});
  data.addSweepLedgerEntry({ userId: u, amount: -cost, reason: "sweepstake_entry", meta: { sweepstakeId: sweep.id, entries } });
  data.addSweepstakeEntry(sweep.id, u, entries);
  const totals = data.getSweepstakeEntryTotals(sweep.id);
  const userEntries = data.getUserEntriesForSweepstake(sweep.id, u);
  res.json({ ok:true, balance: balance - cost, totals, userEntries });
});
app.get("/api/admin/sweep/rules",(req,res)=>{
  res.json(adminSweepRules);
});
app.post("/api/admin/sweep/rules",(req,res)=>{
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
app.patch("/api/admin/sweep/rules/:id",(req,res)=>{
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
app.post("/api/admin/sweep/sweepstake",(req,res)=>{
  const created = data.createSweepstake({
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
app.get("/districts/:id/places",(req,res)=>{
  const did=Number(req.params.id);
  const places=(data.getPlaces ? data.getPlaces() : data.places || []).filter(p=>Number(p.districtId)===did);
  res.json(places);
});

app.get("/market/listings",(req,res)=>{
  const access = requirePerm(req,res,"VIEW_MARKET"); if(!access) return;
  const townId = Number(req.query.townId || 1);
  const places = (data.getPlaces ? data.getPlaces() : data.places || []);
  const placeById = new Map(places.map(p=>[Number(p.id), p]));
  const out = [];
  data.getListings().forEach((l)=>{
    const p = placeById.get(Number(l.placeId));
    if(!p) return;
    if(townId && Number(p.townId)!==Number(townId)) return;
    const listingType = l.listingType || "item";
    const hasAuctionFields = !!(l.auctionStartAt || l.auctionEndAt || Number(l.startBidCents || 0) || Number(l.minIncrementCents || 0) || Number(l.reserveCents || 0));
    const hasAuctionId = !!l.auctionId;
    if(listingType === "auction" || hasAuctionFields || hasAuctionId) return;
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
      const summary = data.getAuctionSummary(l.id);
      joined.highestBidCents = summary.highestBidCents || 0;
    }
    out.push(joined);
  });
  res.json(out);
});

app.get("/market/auctions",(req,res)=>{
  const access = requirePerm(req,res,"VIEW_AUCTIONS"); if(!access) return;
  const townId = Number(req.query.townId || 1);
  const places = (data.getPlaces ? data.getPlaces() : data.places || []);
  const placeById = new Map(places.map(p=>[Number(p.id), p]));
  const out = [];
  data.getListings().forEach((l)=>{
    const p = placeById.get(Number(l.placeId));
    if(!p) return;
    if(townId && Number(p.townId)!==Number(townId)) return;
    const listingType = l.listingType || "item";
    const hasAuctionId = !!l.auctionId;
    if(listingType !== "auction" && !hasAuctionId) return;
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
    const summary = data.getAuctionSummary(l.id);
    joined.highestBidCents = summary.highestBidCents || 0;
    out.push(joined);
  });
  res.json(out);
});

// Channels
app.get("/channels",(req,res)=>{
  const access = requirePerm(req,res,"VIEW_CHANNELS"); if(!access) return;
  const u=access.userId;
  const channels=data.getChannels();
  if(!u) return res.json(channels.filter(c=>Number(c.isPublic)===1));
  res.json(channels);
});
app.get("/channels/:id/messages",(req,res)=>{
  const access = requirePerm(req,res,"VIEW_CHANNELS"); if(!access) return;
  const channel=data.getChannelById(req.params.id);
  if(!channel) return res.status(404).json({error:"Channel not found"});
  const isPublic=Number(channel.isPublic)===1;
  if(!isPublic){
    const u=access.userId;
    if(!data.isChannelMember(channel.id,u)) return res.status(403).json({error:"Not a member"});
  }
  const msgs = data.getChannelMessages(channel.id, 200).map((m)=>({
    ...m,
    user: getTrustBadgeForUser(m.userId)
  }));
  res.json(msgs);
});
app.post("/channels/:id/messages",(req,res)=>{
  const access = requirePerm(req,res,"COMMENT_CHANNELS"); if(!access) return;
  const u=access.userId;
  const ctx=access.ctx;
  const user=access.user;
  const gate = trust.can(user, ctx, "chat_text");
  if(!gate.ok) return res.status(403).json({error:"Chat requires verified access"});
  const channel=data.getChannelById(req.params.id);
  if(!channel) return res.status(404).json({error:"Channel not found"});
  const isPublic=Number(channel.isPublic)===1;
  if(!isPublic && !data.isChannelMember(channel.id,u)) return res.status(403).json({error:"Not a member"});
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
    const parent=data.getChannelMessageById(replyToId);
    if(!parent || Number(parent.channelId)!==Number(channel.id)) return res.status(400).json({error:"Invalid replyToId"});
    threadId=parent.threadId;
  }else{
    if(!canCreateThread) return res.status(403).json({error:"Thread creation requires tier 1+"});
    threadId=data.createChannelThread(channel.id, u);
  }
  const created=data.addChannelMessage(channel.id, u, text, imageUrl, replyToId, threadId);
  res.status(201).json({ok:true, id: created.id, threadId});
});

// Place meta
app.get("/places/:id",(req,res)=>{
  const p=data.getPlaceById(req.params.id);
  if(!p) return res.status(404).json({error:"not found"});
  const u = getUserId(req);
  const followCount = data.getStoreFollowCount(p.id);
  const isFollowing = u ? data.isFollowingStore(u, p.id) : false;
  const reviewSummary = p.ownerUserId ? data.getReviewSummaryForUserDetailed(p.ownerUserId) : { count:0, average:0, buyerCount:0, sellerCount:0 };
  const owner = p.ownerUserId ? getTrustBadgeForUser(p.ownerUserId) : null;
  res.json({ ...p, followCount, isFollowing, reviewSummary, owner });
});
app.post("/places",(req,res)=>{
  const access = requirePerm(req,res,"SELL_LISTINGS"); if(!access) return;
  const u=access.userId;
  const payload = req.body || {};
  const created = data.addPlace({
    ...payload,
    ownerUserId: u,
    townId: 1
  });
  if(created?.error) return res.status(400).json(created);
  res.status(201).json(created);
});
app.get("/places/:id/owner",(req,res)=>{
  const owner = data.getPlaceOwnerPublic(req.params.id);
  if(!owner) return res.json({owner:null});
  const trustBadge = getTrustBadgeForUser(owner.id);
  res.json({owner: { ...owner, trustTier: trustBadge?.trustTier, trustTierLabel: trustBadge?.trustTierLabel }});
});
app.patch("/places/:id/settings",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const updated = data.updatePlaceSettings(req.params.id, req.body || {});
  if(!updated) return res.status(404).json({error:"not found"});
  res.json(updated);
});
app.patch("/places/:id/profile",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const place = data.getPlaceById(req.params.id);
  if(!place) return res.status(404).json({error:"not found"});
  if(Number(place.ownerUserId)!==Number(u)) return res.status(403).json({error:"Only owner can edit"});
  if((place.status || "").toLowerCase() !== "approved") return res.status(403).json({error:"Store not approved"});
  const updated = data.updatePlaceProfile(place.id, req.body || {});
  res.json(updated);
});
app.post("/places/:id/follow",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const place = data.getPlaceById(req.params.id);
  if(!place) return res.status(404).json({error:"not found"});
  data.followStore(u, place.id);
  res.json({ ok:true });
});
app.delete("/places/:id/follow",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  data.unfollowStore(u, req.params.id);
  res.json({ ok:true });
});
app.get("/places/:id/conversations",(req,res)=>{
  const viewer = (req.query.viewer || "").toString();
  res.json(data.getConversationsForPlace(req.params.id, viewer));
});
app.get("/conversations/:id/messages",(req,res)=>{
  const convo = data.getConversationById(req.params.id);
  if(!convo) return res.status(404).json({error:"Conversation not found"});
  res.json(data.getConversationMessages(convo.id));
});
app.post("/conversations/:id/messages",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const ctx=data.getTownContext(1, u);
  const user=data.getUserById(u);
  const gate = trust.can(user, ctx, "chat_text");
  if(!gate.ok) return res.status(403).json({error:"Chat requires verified access"});
  const convo = data.getConversationById(req.params.id);
  if(!convo) return res.status(404).json({error:"Conversation not found"});
  const sender = (req.body?.sender || "buyer").toString().trim() || "buyer";
  const text = (req.body?.text || "").toString().trim();
  if(!text) return res.status(400).json({error:"text required"});
  const msg = data.addMessage({ conversationId: convo.id, sender, text });
  res.status(201).json({ ok:true, id: msg.id });
});
app.patch("/conversations/:id/read",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const convo = data.getConversationById(req.params.id);
  if(!convo) return res.status(404).json({error:"Conversation not found"});
  const viewer = (req.query.viewer || "").toString();
  const result = data.markConversationRead(convo.id, viewer);
  res.json(result);
});

// Listings
app.get("/places/:id/listings",(req,res)=>{
  const pid=Number(req.params.id);
  res.json(data.getListings().filter(l=>Number(l.placeId)===pid));
});
app.post("/places/:id/listings",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const ctx=data.getTownContext(1, u);
  const user=data.getUserById(u);
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
    const placeList = (data.getPlaces ? data.getPlaces() : data.places || []);
    const place = placeList.find(p=>Number(p.id)===pid);
    if(!place) return res.status(404).json({error:"Place not found"});
    if(Number(place.ownerUserId)!==Number(u)) return res.status(403).json({error:"Only store owner can post offers/requests"});
    const tier = trust.resolveTier(user, ctx);
    if(tier < 2) return res.status(403).json({error:"Sebastian Resident required for offers/requests"});
  }
  if(!req.body?.title) return res.status(400).json({error:"title required"});
  const created=data.addListing({...req.body,placeId:pid});
  res.status(201).json(created);
});
app.patch("/listings/:id/sold",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const listing = data.getListingById(req.params.id);
  if(!listing) return res.status(404).json({error:"Listing not found"});
  const updated = data.updateListingStatus(listing.id, "sold");
  res.json(updated);
});

// ✅ Apply / Message → creates conversation
app.post("/listings/:id/apply",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const ctx=data.getTownContext(1, u);
  const user=data.getUserById(u);
  const gate = trust.can(user, ctx, "chat_text");
  if(!gate.ok) return res.status(403).json({error:"Chat requires verified access"});
  const listing=data.getListings().find(l=>l.id==req.params.id);
  if(!listing) return res.status(404).json({error:"Listing not found"});
  const convo=data.addConversation({placeId:listing.placeId,participant:"buyer"});
  data.addMessage({
    conversationId:convo.id,
    sender:"buyer",
    text:req.body?.message||"Interested in this offer."
  });
  res.json({ok:true,conversationId:convo.id});
});

// Auctions
app.get("/listings/:id/auction",(req,res)=>{
  const access = requirePerm(req,res,"VIEW_AUCTIONS"); if(!access) return;
  const listing = data.getListingById(req.params.id);
  if(!listing) return res.status(404).json({error:"Listing not found"});
  if((listing.listingType||"item")!=="auction") return res.status(400).json({error:"Not an auction"});
  const summary = data.getAuctionSummary(listing.id);
  const order = listing.winnerUserId ? data.getLatestOrderForListingAndBuyer(listing.id, listing.winnerUserId) : null;
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
app.post("/listings/:id/bid",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const ctx=data.getTownContext(1, u);
  const user=data.getUserById(u);
  const gate = trust.can(user, ctx, "auction_bid");
  if(!gate.ok) return res.status(403).json({error:"Auction bidding requires verified access"});
  const listing = data.getListingById(req.params.id);
  if(!listing) return res.status(404).json({error:"Listing not found"});
  if((listing.listingType||"item")!=="auction") return res.status(400).json({error:"Not an auction"});
  const endAt = Date.parse(listing.auctionEndAt || "");
  if(listing.auctionEndAt && Number.isNaN(endAt)) return res.status(400).json({error:"Invalid auctionEndAt"});
  if(endAt && Date.now() > endAt) return res.status(400).json({error:"Auction ended"});
  const amountCents = Number(req.body?.amountCents);
  if(!Number.isFinite(amountCents) || amountCents<=0) return res.status(400).json({error:"amountCents required"});
  const last = data.getLastBidForUser(listing.id, u);
  if(last?.createdAt){
    const lastTs = Date.parse(last.createdAt);
    if(!Number.isNaN(lastTs) && (Date.now()-lastTs) < 2000) return res.status(429).json({error:"Rate limit: one bid per 2s"});
  }
  const highest = data.getHighestBidForListing(listing.id);
  const minBid = highest ? (highest.amountCents + (listing.minIncrementCents||0)) : (listing.startBidCents||0);
  if(amountCents < minBid) return res.status(400).json({error:`Bid too low. Minimum ${minBid}`});
  const bid = data.addBid(listing.id, u, amountCents);
  const summary = data.getAuctionSummary(listing.id);
  res.json({ok:true, bidId: bid.id, highestBidCents: summary.highestBidCents, bidCount: summary.bidCount});
});

app.post("/api/auctions/:listingId/close",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const listing = data.getListingById(req.params.listingId);
  if(!listing) return res.status(404).json({error:"Listing not found"});
  if((listing.listingType||"item")!=="auction") return res.status(400).json({error:"Not an auction"});
  const endAt = Date.parse(listing.auctionEndAt || "");
  if(!listing.auctionEndAt || Number.isNaN(endAt)) return res.status(400).json({error:"Invalid auctionEndAt"});
  if(Date.now() < endAt) return res.status(400).json({error:"Auction not ended yet"});
  const place = data.getPlaceById(listing.placeId);
  if(!place) return res.status(404).json({error:"Place not found"});
  const user = data.getUserById(u);
  if(!isAdminUser(user) && Number(place.ownerUserId)!==Number(u)){
    return res.status(403).json({error:"Only owner or admin can close"});
  }
  const highest = data.getHighestBidForListing(listing.id);
  if(!highest){
    data.updateListingAuctionState(listing.id, {
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
  const order = data.createOrderWithItems({
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
  data.updateListingAuctionState(listing.id, {
    auctionStatus: "pending_payment",
    paymentStatus: "required",
    winningBidId: highest.id,
    winnerUserId: highest.userId,
    paymentDueAt
  });
  res.json({ok:true, winnerUserId: highest.userId, orderId: order.id, payUrl: `/pay/${order.id}`});
});

app.post("/api/auctions/:listingId/expire_winner",(req,res)=>{
  const admin=requireAdminOrDev(req,res); if(!admin) return;
  const listing = data.getListingById(req.params.listingId);
  if(!listing) return res.status(404).json({error:"Listing not found"});
  if((listing.listingType||"item")!=="auction") return res.status(400).json({error:"Not an auction"});
  const dueAt = Date.parse(listing.paymentDueAt || "");
  if(!listing.paymentDueAt || Number.isNaN(dueAt)) return res.status(400).json({error:"paymentDueAt missing"});
  if(Date.now() < dueAt) return res.status(400).json({error:"Payment not overdue"});
  if(listing.paymentStatus === "paid") return res.status(400).json({error:"Already paid"});
  const previousWinner = listing.winnerUserId;
  const nextBid = data.getNextHighestBidForListing(listing.id, previousWinner);
  if(!nextBid){
    data.updateListingAuctionState(listing.id, {
      auctionStatus: "failed",
      paymentStatus: "failed",
      winningBidId: null,
      winnerUserId: null,
      paymentDueAt: ""
    });
    return res.json({ok:true, winnerUserId:null, orderId:null, payUrl:null});
  }
  const place = data.getPlaceById(listing.placeId);
  if(!place) return res.status(404).json({error:"Place not found"});
  const subtotalCents = Number(nextBid.amountCents || 0);
  const serviceGratuityCents = Math.ceil(subtotalCents * 0.05);
  const totalCents = subtotalCents + serviceGratuityCents;
  const order = data.createOrderWithItems({
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
  data.updateListingAuctionState(listing.id, {
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
app.post("/admin/verify/buyer", (req,res)=>{
  const admin=requireAdmin(req,res,{ message: "Admin access required" }); if(!admin) return;
  const id = Number(req.body?.userId);
  if(!id) return res.status(400).json({error:"userId required"});
  const r = data.verifyBuyer(id, "verified", "admin");
  res.json(r);
});

app.post("/admin/verify/store", (req,res)=>{
  const admin=requireAdmin(req,res,{ message: "Admin access required" }); if(!admin) return;
  const id = Number(req.body?.placeId);
  if(!id) return res.status(400).json({error:"placeId required"});
  const r = data.verifyStore(id);
  if(r?.error) return res.status(400).json(r);
  res.json(r);
});

app.post("/api/admin/trust/tiers",(req,res)=>{
  const admin=requireAdmin(req,res); if(!admin) return;
  const userId = Number(req.body?.userId);
  const trustTier = Number(req.body?.trustTier);
  if(!userId || !Number.isFinite(trustTier)) return res.status(400).json({error:"userId and trustTier required"});
  if(trustTier < 0 || trustTier > 3) return res.status(400).json({error:"trustTier must be 0-3 (0 resets to automatic)"});
  const updated = data.setUserTrustTier(1, userId, trustTier);
  if(updated?.error) return res.status(400).json(updated);
  res.json({ ok:true, membership: updated });
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, "0.0.0.0", () => console.log(`Server running on http://localhost:${PORT}`));
