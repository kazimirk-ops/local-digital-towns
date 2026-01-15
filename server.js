const express = require("express");
const path = require("path");
const app = express();
const data = require("./data");
const { TRUST } = require("./town_config");
const { TOWN_DIRECTORY } = require("./town_directory");
const { StubPaymentProvider } = require("./payment_provider");
const paymentProvider = new StubPaymentProvider();

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// Health
app.get("/health",(req,res)=>res.json({status:"ok"}));

// Pages
app.get("/ui",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.get("/signup",(req,res)=>res.sendFile(path.join(__dirname,"public","signup.html")));
app.get("/store/:id",(req,res)=>res.sendFile(path.join(__dirname,"public","store.html")));
app.get("/admin/sweep",(req,res)=>res.sendFile(path.join(__dirname,"public","admin_sweep.html")));
app.get("/admin/trust",(req,res)=>res.sendFile(path.join(__dirname,"public","admin_trust.html")));

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

// Events (boot + calendar)
app.get("/events",(req,res)=>{
  const range = (req.query.range || "week").toString();
  const safeRange = (range === "month") ? "month" : "week";
  res.json(data.getCalendarEvents(safeRange));
});
app.post("/events",(req,res)=>{
  if(req.body?.eventType || req.body?.clientSessionId){
    data.logEvent(req.body || {});
    return res.json({ok:true});
  }
  const u=requireLogin(req,res); if(!u) return;
  const ctx=data.getTownContext(1, u);
  const trust=ctx.trustLevel;
  const canOrganize=[TRUST.MEMBER, TRUST.TRUSTED].includes(trust);
  if(!canOrganize) return res.status(403).json({error:"Organizer requires member"});
  if(!req.body?.title || !req.body?.startsAt) return res.status(400).json({error:"title and startsAt required"});
  const created=data.addCalendarEvent(req.body, u);
  res.status(201).json(created);
});
app.post("/events/:id/rsvp",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const ev=data.getCalendarEventById(req.params.id);
  if(!ev) return res.status(404).json({error:"Event not found"});
  data.addEventRsvp(ev.id, u, req.body?.status || "going");
  res.json({ok:true});
});

// Orders (payment scaffolding)
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
app.get("/api/admin/trust/reviews",(req,res)=>{
  res.json(data.listReviews(200));
});
app.get("/api/admin/trust/disputes",(req,res)=>{
  res.json(data.listDisputes(200));
});

// Sweep
app.get("/sweep/balance",(req,res)=>{
  const u=getUserId(req);
  if(!u) return res.json({loggedIn:false,balance:0});
  res.json({loggedIn:true,balance:data.getSweepBalance(u)});
});

// Districts
app.get("/districts/:id/places",(req,res)=>{
  const did=Number(req.params.id);
  const places=(data.getPlaces ? data.getPlaces() : data.places || []).filter(p=>Number(p.districtId)===did);
  res.json(places);
});

// Channels
app.get("/channels",(req,res)=>{
  const u=getUserId(req);
  const channels=data.getChannels();
  if(!u) return res.json(channels.filter(c=>Number(c.isPublic)===1));
  res.json(channels);
});
app.get("/channels/:id/messages",(req,res)=>{
  const channel=data.getChannelById(req.params.id);
  if(!channel) return res.status(404).json({error:"Channel not found"});
  const isPublic=Number(channel.isPublic)===1;
  if(!isPublic){
    const u=getUserId(req);
    if(!u) return res.status(401).json({error:"Login required"});
    if(!data.isChannelMember(channel.id,u)) return res.status(403).json({error:"Not a member"});
  }
  res.json(data.getChannelMessages(channel.id, 200));
});
app.post("/channels/:id/messages",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
  const channel=data.getChannelById(req.params.id);
  if(!channel) return res.status(404).json({error:"Channel not found"});
  const isPublic=Number(channel.isPublic)===1;
  if(!isPublic && !data.isChannelMember(channel.id,u)) return res.status(403).json({error:"Not a member"});
  const text=(req.body?.text||"").toString().trim();
  if(!text) return res.status(400).json({error:"text required"});
  const ctx=data.getTownContext(1, u);
  const trust=ctx.trustLevel;
  const canPost=[TRUST.VERIFIED_VISITOR, TRUST.MEMBER, TRUST.TRUSTED].includes(trust);
  const canCreateThread=[TRUST.MEMBER, TRUST.TRUSTED].includes(trust);
  const replyToId=req.body?.replyToId ? Number(req.body.replyToId) : null;
  let threadId=null;
  if(replyToId){
    if(!canPost) return res.status(403).json({error:"Posting requires verified visitor"});
    const parent=data.getChannelMessageById(replyToId);
    if(!parent || Number(parent.channelId)!==Number(channel.id)) return res.status(400).json({error:"Invalid replyToId"});
    threadId=parent.threadId;
  }else{
    if(!canCreateThread) return res.status(403).json({error:"Thread creation requires member"});
    threadId=data.createChannelThread(channel.id, u);
  }
  const created=data.addChannelMessage(channel.id, u, text, replyToId, threadId);
  res.status(201).json({ok:true, id: created.id, threadId});
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
  const listingType=(req.body?.listingType||"item").toString();
  const exchangeType=(req.body?.exchangeType||"money").toString();
  const offerCategory=(req.body?.offerCategory||"").toString().trim().toLowerCase();
  if(listingType==="offer" || listingType==="request"){
    const placeList = (data.getPlaces ? data.getPlaces() : data.places || []);
    const place = placeList.find(p=>Number(p.id)===pid);
    if(!place) return res.status(404).json({error:"Place not found"});
    if(Number(place.ownerUserId)!==Number(u)) return res.status(403).json({error:"Only store owner can post offers/requests"});
    const ctx=data.getTownContext(1, u);
    const trust=ctx.trustLevel;
    if(trust===TRUST.VISITOR) return res.status(403).json({error:"Verified visitor required"});
    if(trust===TRUST.VERIFIED_VISITOR && (exchangeType==="barter" || offerCategory==="lodging")) {
      return res.status(403).json({error:"Member required for lodging/barter"});
    }
  }
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

// Auctions
app.get("/listings/:id/auction",(req,res)=>{
  const listing = data.getListingById(req.params.id);
  if(!listing) return res.status(404).json({error:"Listing not found"});
  if((listing.listingType||"item")!=="auction") return res.status(400).json({error:"Not an auction"});
  const summary = data.getAuctionSummary(listing.id);
  res.json({
    listingId: listing.id,
    auctionStartAt: listing.auctionStartAt || "",
    auctionEndAt: listing.auctionEndAt || "",
    startBidCents: listing.startBidCents || 0,
    minIncrementCents: listing.minIncrementCents || 0,
    reserveCents: listing.reserveCents ?? null,
    buyNowCents: listing.buyNowCents ?? null,
    highestBidCents: summary.highestBidCents,
    bidCount: summary.bidCount
  });
});
app.post("/listings/:id/bid",(req,res)=>{
  const u=requireLogin(req,res); if(!u) return;
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
