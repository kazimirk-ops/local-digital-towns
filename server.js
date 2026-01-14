const express = require("express");
const path = require("path");
const app = express();
const data = require("./data");

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// Health
app.get("/health",(req,res)=>res.json({status:"ok"}));

// Pages
app.get("/ui",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.get("/signup",(req,res)=>res.sendFile(path.join(__dirname,"public","signup.html")));
app.get("/store/:id",(req,res)=>res.sendFile(path.join(__dirname,"public","store.html")));

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
app.post("/auth/logout",(req,res)=>{
  const sid=parseCookies(req).sid;
  if(sid) data.deleteSession(sid);
  setCookie(res,"sid","",{httpOnly:true,maxAge:0});
  res.json({ok:true});
});
app.get("/me",(req,res)=>{
  const sid=parseCookies(req).sid;
  if(!sid) return res.json({user:null});
  const r=data.getUserBySession(sid);
  if(!r) return res.json({user:null});
  data.ensureTownMembership(1,r.user.id);
  res.json(r);
});

app.post("/api/signup",(req,res)=>{
  const r=data.addSignup(req.body||{});
  if(r?.error) return res.status(400).json(r);
  res.json(r);
});

// Events (boot)
app.post("/events",(req,res)=>{
  res.json({ok:true});
});

// Sweep
app.get("/sweep/balance",(req,res)=>{
  const u=getUserId(req);
  if(!u) return res.json({loggedIn:false,balance:0});
  res.json({loggedIn:true,balance:data.getSweepBalance(u)});
});

// Place meta
app.get("/places/:id",(req,res)=>{
  const p=data.getPlaceById(req.params.id);
  if(!p) return res.status(404).json({error:"not found"});
  res.json(p);
});
app.get("/places/:id/owner",(req,res)=>{
  res.json({owner:data.getPlaceOwnerPublic(req.params.id)});
});

// Listings
app.get("/places/:id/listings",(req,res)=>{
  const pid=Number(req.params.id);
  res.json(data.getListings().filter(l=>Number(l.placeId)===pid));
});
app.post("/places/:id/listings",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const pid=Number(req.params.id);
  if(!req.body?.title) return res.status(400).json({error:"title required"});
  const created=data.addListing({...req.body,placeId:pid});
  res.status(201).json(created);
});

// ✅ Apply / Message → creates conversation
app.post("/listings/:id/apply",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
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
// =====================
// ADMIN VERIFY (TEMP)
// =====================
app.post("/admin/verify/buyer", (req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const id = Number(req.body?.userId);
  if(!id) return res.status(400).json({error:"userId required"});
  const r = data.verifyBuyer(id, "verified", "admin");
  res.json(r);
});

app.post("/admin/verify/store", (req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const id = Number(req.body?.placeId);
  if(!id) return res.status(400).json({error:"placeId required"});
  const r = data.verifyStore(id);
  if(r?.error) return res.status(400).json(r);
  res.json(r);
});

const PORT=3000;
app.listen(PORT,()=>console.log(`Server running on http://localhost:${PORT}`));
