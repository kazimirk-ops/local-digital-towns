const express = require("express");
const path = require("path");
const app = express();
const data = require("./data");

app.use(express.static(path.join(__dirname, "public")));

// ✅ Health
app.get("/health", (req, res) => res.json({ status: "ok" }));

// ✅ Pages
app.get("/ui", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/signup", (req, res) => res.sendFile(path.join(__dirname, "public", "signup.html")));
app.get("/store/:id", (req, res) => res.sendFile(path.join(__dirname, "public", "store.html")));

// Cookies
function parseCookies(req){
  const header=req.headers.cookie||"";
  const parts=header.split(";").map(p=>p.trim()).filter(Boolean);
  const out={};
  for(const p of parts){
    const idx=p.indexOf("=");
    if(idx===-1) continue;
    out[p.slice(0,idx)]=decodeURIComponent(p.slice(idx+1));
  }
  return out;
}
function setCookie(res,name,value,opts={}){
  const parts=[`${name}=${encodeURIComponent(value)}`];
  if(opts.httpOnly) parts.push("HttpOnly");
  parts.push("Path=/");
  parts.push("SameSite=Lax");
  if(opts.maxAge!==undefined) parts.push(`Max-Age=${opts.maxAge}`);
  res.setHeader("Set-Cookie", parts.join("; "));
}
function getUserId(req){
  const sid=parseCookies(req).sid;
  if(!sid) return null;
  const result=data.getUserBySession(sid);
  return result?.user?.id ?? null;
}
function requireLogin(req,res){
  const uid=getUserId(req);
  if(!uid){ res.status(401).json({error:"Login required"}); return null; }
  return uid;
}

// Auth
app.post("/auth/request-link", express.json(), (req,res)=>{
  const email=(req.body?.email||"").toString().trim().toLowerCase();
  if(!email) return res.status(400).json({error:"email required"});
  const created=data.createMagicLink(email);
  if(created.error) return res.status(400).json(created);
  const base = `${req.protocol}://${req.get("host")}`;
  res.json({ok:true, magicUrl:`${base}/auth/magic?token=${created.token}`, expiresAt:created.expiresAt});
});
app.get("/auth/magic",(req,res)=>{
  const token=(req.query.token||"").toString();
  if(!token) return res.status(400).send("Missing token");
  const consumed=data.consumeMagicToken(token);
  if(consumed.error) return res.status(400).send(consumed.error);
  const sess=data.createSession(consumed.userId);
  setCookie(res,"sid",sess.sid,{httpOnly:true,maxAge:60*60*24*60});
  res.redirect("/ui");
});
app.post("/auth/logout",(req,res)=>{
  const sid=parseCookies(req).sid;
  if(sid) data.deleteSession(sid);
  setCookie(res,"sid","",{httpOnly:true,maxAge:0});
  res.json({ok:true});
});
app.get("/me",(req,res)=>{
  const sid=parseCookies(req).sid;
  if(!sid) return res.json({user:null,signup:null});
  const result=data.getUserBySession(sid);
  if(!result) return res.json({user:null,signup:null});
  // ensure trust membership exists (if your data.js has it)
  if (typeof data.ensureTownMembership === "function") data.ensureTownMembership(1, result.user.id);
  res.json(result);
});

// ✅ Events (UI boot depends on this)
app.post("/events", express.json(), (req,res)=>{
  const payload=req.body||{};
  const clientSessionId=(payload.clientSessionId||"").toString().trim();
  const eventTypeRaw=(payload.eventType ?? payload.type ?? "").toString().trim();
  if(!clientSessionId) return res.status(400).json({error:"clientSessionId required"});
  if(!eventTypeRaw) return res.status(400).json({error:"eventType required"});

  let eventId = null;
  if(typeof data.logEvent === "function"){
    try{
      eventId = data.logEvent({
        eventType:eventTypeRaw,
        townId:1,
        districtId:payload.districtId??null,
        placeId:payload.placeId??null,
        listingId:payload.listingId??null,
        conversationId:payload.conversationId??null,
        userId:getUserId(req),
        clientSessionId,
        meta: payload.meta||{}
      });
    } catch {}
  }

  res.json({ ok:true, eventId, reward:null });
});

// ✅ Sweep (UI boot depends on this)
app.get("/sweep/balance",(req,res)=>{
  const uid=getUserId(req);
  if(!uid) return res.json({loggedIn:false,balance:0});
  res.json({loggedIn:true,balance:data.getSweepBalance(uid)});
});

// ✅ Listings read (store UI uses this)
app.get("/places/:id/listings",(req,res)=>{
  const placeId=Number(req.params.id);
  res.json(data.getListings().filter(l=>Number(l.placeId)===placeId));
});

// ✅ Listings create (works for items/offers/requests; server gating can be added next)
app.post("/places/:id/listings", express.json(), (req,res)=>{
  const uid=requireLogin(req,res);
  if(!uid) return;

  const placeId=Number(req.params.id);
  const p=req.body||{};
  const title=(p.title||"").toString().trim();
  if(!title) return res.status(400).json({error:"title is required"});

  const created = data.addListing({
    placeId,
    title,
    description: (p.description||"").toString(),
    quantity: Number.isFinite(Number(p.quantity)) ? Number(p.quantity) : 1,
    price: Number.isFinite(Number(p.price)) ? Number(p.price) : 0,
    status: (p.status||"active").toString(),
    listingType: p.listingType || "item",
    exchangeType: p.exchangeType || "money",
    startAt: p.startAt || "",
    endAt: p.endAt || "",
    photoUrls: p.photoUrls || []
  });

  res.status(201).json(created);
});

const PORT=3000;
app.listen(PORT,()=>console.log(`Server running on http://localhost:${PORT}`));
