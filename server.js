const express = require("express");
const path = require("path");
const app = express();
const data = require("./data");

app.use(express.static(path.join(__dirname, "public")));

// Pages
app.get("/ui", (req,res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/signup", (req,res) => res.sendFile(path.join(__dirname, "public", "signup.html")));
app.get("/store/:id", (req,res) => res.sendFile(path.join(__dirname, "public", "store.html")));

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

// Store data
app.get("/places/:id",(req,res)=>{
  const id = Number(req.params.id);
  const place = data.places.find(p=>p.id===id);
  if(!place) return res.status(404).json({error:"Place not found"});
  res.json(place);
});
app.get("/places/:id/owner",(req,res)=>{
  const owner = data.getPlaceOwner(req.params.id);
  res.json({ owner: owner ? { id:owner.id, displayName:owner.displayName, bio:owner.bio, avatarUrl:owner.avatarUrl } : null });
});
app.get("/places/:id/listings",(req,res)=>{
  const placeId=Number(req.params.id);
  res.json(data.getListings().filter(l=>l.placeId===placeId));
});
app.get("/places/:id/followers",(req,res)=>{
  const placeId = Number(req.params.id);
  const count = data.storeFollowersCount(placeId);
  const uid = getUserId(req);
  const following = uid ? data.isFollowingStore(uid, placeId) : false;
  res.json({ count, following });
});
app.post("/places/:id/follow",(req,res)=>{
  const uid=requireLogin(req,res);
  if(!uid) return;
  const placeId = Number(req.params.id);
  const r = data.followStore(uid, placeId);
  if(r.error) return res.status(400).json(r);
  res.json({ok:true});
});
app.delete("/places/:id/follow",(req,res)=>{
  const uid=requireLogin(req,res);
  if(!uid) return;
  const placeId = Number(req.params.id);
  data.unfollowStore(uid, placeId);
  res.json({ok:true});
});

const PORT=3000;
app.listen(PORT,()=>console.log(`Server running on http://localhost:${PORT}`));
