const express = require("express");
const path = require("path");
const app = express();
const data = require("./data");

app.use(express.static(path.join(__dirname, "public")));

// Pages
app.get("/ui", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/signup", (req, res) => res.sendFile(path.join(__dirname, "public", "signup.html")));
app.get("/admin/sweep", (req, res) => res.sendFile(path.join(__dirname, "public", "admin_sweep.html")));
app.get("/sweepstake", (req, res) => res.sendFile(path.join(__dirname, "public", "sweepstake.html")));
app.get("/raffle", (req, res) => res.redirect("/sweepstake"));

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
  const magicUrl=`http://localhost:3000/auth/magic?token=${created.token}`;
  res.json({ok:true, magicUrl, expiresAt:created.expiresAt});
});
app.get("/auth/magic",(req,res)=>{
  const token=(req.query.token||"").toString();
  if(!token) return res.status(400).send("Missing token");
  const consumed=data.consumeMagicToken(token);
  if(consumed.error) return res.status(400).send(consumed.error);
  const sess=data.createSession(consumed.userId);
  setCookie(res,"sid",sess.sid,{httpOnly:true,maxAge:60*60*24*30});
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
  res.json(result);
});

// Health
app.get("/health",(req,res)=>res.json({status:"ok"}));

// Signup
app.post("/api/signup", express.json(), (req,res)=>{
  const result=data.addSignup(req.body||{});
  if(result?.error) return res.status(400).json(result);
  res.status(201).json(result);
});

// Sweep balance
app.get("/sweep/balance",(req,res)=>{
  const uid=getUserId(req);
  if(!uid) return res.json({loggedIn:false,balance:0});
  res.json({loggedIn:true,balance:data.getSweepBalance(uid)});
});

// Sweepstake endpoints
app.get("/sweepstake/active",(req,res)=>{
  const s=data.getActiveSweepstake();
  if(!s) return res.json({sweepstake:null,stats:null});
  res.json({sweepstake:s,stats:data.sweepstakeStats(s.id)});
});

// ✅ TRUSTED: server emits sweepstake_enter and rewards
app.post("/sweepstake/enter",(req,res)=>{
  const uid=requireLogin(req,res);
  if(!uid) return;

  const result=data.enterActiveSweepstake(uid);
  if(result.error) return res.status(400).json(result);

  // Trusted event + reward (actor is buyer/entrant)
  const eventId = data.logEvent({
    eventType: "sweepstake_enter",
    townId: 1,
    districtId: null,
    placeId: null,
    listingId: null,
    conversationId: null,
    userId: uid,
    clientSessionId: "server",
    meta: { actorRole: "buyer", sweepstakeId: result.sweepstake?.id ?? null }
  });

  const reward = data.applySweepRewardForEvent({
    eventType: "sweepstake_enter",
    userId: uid,
    eventId,
    meta: { actorRole: "buyer" }
  });

  res.json({ ...result, trustedReward: reward || null });
});

// Admin sweep rules
app.get("/api/admin/sweep/rules",(req,res)=>{
  const uid=requireLogin(req,res);
  if(!uid) return;
  res.json(data.listSweepRulesV2());
});
app.post("/api/admin/sweep/rules", express.json(), (req,res)=>{
  const uid=requireLogin(req,res);
  if(!uid) return;
  const created=data.createSweepRuleV2(req.body||{});
  if(created.error) return res.status(400).json(created);
  res.status(201).json(created);
});
app.patch("/api/admin/sweep/rules/:id", express.json(), (req,res)=>{
  const uid=requireLogin(req,res);
  if(!uid) return;
  const updated=data.updateSweepRuleV2(req.params.id, req.body||{});
  if(updated.error) return res.status(400).json(updated);
  res.json(updated);
});

// Admin create sweepstake
app.post("/api/admin/sweep/sweepstake", express.json(), (req,res)=>{
  const uid=requireLogin(req,res);
  if(!uid) return;
  const p=req.body||{};
  const required=["status","title","prize","entryCost","startAt","endAt","drawAt","maxEntriesPerUserPerDay"];
  for(const k of required){
    if(p[k]===undefined||p[k]===null||p[k]==="") return res.status(400).json({error:`Missing ${k}`});
  }
  const created=data.upsertSweepstake({
    status:String(p.status),
    title:String(p.title),
    prize:String(p.prize),
    entryCost:Number(p.entryCost),
    startAt:String(p.startAt),
    endAt:String(p.endAt),
    drawAt:String(p.drawAt),
    maxEntriesPerUserPerDay:Number(p.maxEntriesPerUserPerDay),
  });
  res.status(201).json(created);
});

// ✅ Events logging (client events). We BLOCK rewards for trusted eventTypes here.
const TRUSTED_ONLY = new Set(["listing_mark_sold", "sweepstake_enter"]);

app.post("/events", express.json(), (req,res)=>{
  const payload=req.body||{};
  const clientSessionId=(payload.clientSessionId||"").toString().trim();
  const eventTypeRaw=(payload.eventType ?? payload.type ?? "").toString().trim();
  if(!clientSessionId) return res.status(400).json({error:"clientSessionId required"});
  if(!eventTypeRaw) return res.status(400).json({error:"eventType required"});

  const userId=getUserId(req);

  const eventId=data.logEvent({
    eventType:eventTypeRaw,
    townId:1,
    districtId:payload.districtId??null,
    placeId:payload.placeId??null,
    listingId:payload.listingId??null,
    conversationId:payload.conversationId??null,
    userId,
    clientSessionId,
    meta: payload.meta||{}
  });

  // Do not reward trusted-only events via client endpoint
  if (TRUSTED_ONLY.has(eventTypeRaw)) {
    return res.json({ ok:true, reward:null, note:"trusted_only_no_reward" });
  }

  const reward=data.applySweepRewardForEvent({eventType:eventTypeRaw,userId,eventId,meta:payload.meta||{}});
  res.json({ok:true,reward:reward||null});
});

// Places
app.get("/districts/:id/places",(req,res)=>{
  const districtId=Number(req.params.id);
  res.json(data.places.filter(p=>p.districtId===districtId));
});
app.patch("/places/:id/settings", express.json(), (req,res)=>{
  const uid=requireLogin(req,res);
  if(!uid) return;
  const updated=data.updatePlaceSettings(req.params.id, req.body||{});
  if(updated?.error) return res.status(404).json(updated);
  res.json(updated);
});

// Listings
app.get("/places/:id/listings",(req,res)=>{
  const placeId=Number(req.params.id);
  res.json(data.getListings().filter(l=>l.placeId===placeId));
});
app.post("/places/:id/listings", express.json(), (req,res)=>{
  const uid=requireLogin(req,res);
  if(!uid) return;
  const placeId=Number(req.params.id);
  const {title,description,quantity,price}=req.body||{};
  if(!title||typeof title!=="string") return res.status(400).json({error:"title is required"});
  const listing=data.addListing({placeId,title,description,quantity,price,status:"active"});
  res.status(201).json(listing);
});

// ✅ TRUSTED: server emits listing_mark_sold and rewards
app.patch("/listings/:id/sold",(req,res)=>{
  const uid=requireLogin(req,res);
  if(!uid) return;

  const updated=data.markListingSold(req.params.id);
  if(!updated) return res.status(404).json({error:"Listing not found"});

  const eventId = data.logEvent({
    eventType: "listing_mark_sold",
    townId: 1,
    districtId: null,
    placeId: updated.placeId ?? null,
    listingId: updated.id ?? null,
    conversationId: null,
    userId: uid,
    clientSessionId: "server",
    meta: { actorRole: "seller", listingId: updated.id, placeId: updated.placeId }
  });

  const reward = data.applySweepRewardForEvent({
    eventType: "listing_mark_sold",
    userId: uid,
    eventId,
    meta: { actorRole: "seller" }
  });

  res.json({ ...updated, trustedReward: reward || null });
});

// Messaging
app.get("/places/:id/conversations",(req,res)=>{
  const placeId=Number(req.params.id);
  const viewer=(req.query.viewer||"buyer").toString();
  const convos=data.getConversationsForPlace(placeId).map(c=>({...c, unreadCount:data.getUnreadCount(c.id,viewer)}));
  res.json(convos);
});
app.get("/conversations/:id/messages",(req,res)=>{
  const conversationId=Number(req.params.id);
  res.json(data.getMessages().filter(m=>m.conversationId===conversationId));
});
app.post("/conversations/:id/messages", express.json(), (req,res)=>{
  const uid=requireLogin(req,res);
  if(!uid) return;
  const conversationId=Number(req.params.id);
  const {sender,text}=req.body||{};
  if(!text) return res.status(400).json({error:"text required"});
  const msg=data.addMessage({conversationId,sender:sender||"buyer",text});
  res.status(201).json(msg);
});
app.patch("/conversations/:id/read",(req,res)=>{
  const uid=requireLogin(req,res);
  if(!uid) return;
  const conversationId=Number(req.params.id);
  const viewer=(req.query.viewer||"buyer").toString();
  data.markConversationRead(conversationId,viewer);
  res.json({ok:true});
});

const PORT=3000;
app.listen(PORT,()=>console.log(`Server running on http://localhost:${PORT}`));

