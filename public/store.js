const $=id=>document.getElementById(id);
function debug(m){$("debug").textContent=m||"";}

let PLACE=null;
let CURRENT_USER_ID=null;

async function api(u,o){
  const r=await fetch(u,{credentials:"include",headers:{"Content-Type":"application/json"},...(o||{})});
  const t=await r.text(); let j;
  try{j=JSON.parse(t)}catch{j=t}
  if(!r.ok) throw new Error(j.error||t);
  return j;
}
function pid(){return Number(location.pathname.split("/")[2]);}

let LIST=[],TAB="item",AUCTIONS={};
let LIVE_SHOW=null;
let CART={ items:[] };
let CART_ORDER_ID=null;

function fmtCents(c){
  if(!Number.isFinite(Number(c))) return "—";
  return `$${(Number(c)/100).toFixed(2)}`;
}
function openCartModal(){
  const modal = $("cartModal");
  if(modal) modal.style.display = "block";
}
function setCartMsg(msg, isError){
  const el = $("cartMsg");
  if(!el) return;
  el.textContent = "";
  if(!msg) return;
  if(isError && msg === "login_required"){
    el.innerHTML = `Login required. <a href="/signup">Join / Login</a>`;
    return;
  }
  if(isError && msg === "tier_required"){
    el.textContent = "Buying requires verified access (Tier 1+).";
    return;
  }
  el.textContent = msg;
}

function updateCartCount(){
  const count = CART.items.reduce((sum,i)=>sum + Number(i.quantity||0), 0);
  const el = $("cartCount");
  if(el) el.textContent = String(count);
}
async function loadCart(){
  try{
    const res = await api("/api/cart");
    CART.items = res.items || [];
  }catch(e){
    CART.items = [];
  }
  updateCartCount();
  renderCart();
}
function renderCart(){
  const list = $("cartList");
  const totals = $("cartTotals");
  if(!list || !totals) return;
  list.innerHTML = "";
  if(!CART.items.length){
    list.innerHTML = `<div class="muted">Cart is empty.</div>`;
    totals.textContent = "";
    return;
  }
  let subtotal = 0;
  CART.items.forEach((item)=>{
    subtotal += Number(item.priceCents || 0) * Number(item.quantity || 0);
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `
      <div style="font-weight:700;">${item.title || "Item"}</div>
      <div class="muted">${item.placeName || ""}</div>
      <div class="row" style="margin-top:6px;">
        <button data-dec="${item.listingId}">-</button>
        <span>${item.quantity}</span>
        <button data-inc="${item.listingId}">+</button>
        <button data-remove="${item.listingId}">Remove</button>
      </div>
    `;
    list.appendChild(row);
  });
  const gratuity = Math.ceil(subtotal * 0.05);
  const total = subtotal + gratuity;
  totals.textContent = `Subtotal: ${fmtCents(subtotal)} • Gratuity: ${fmtCents(gratuity)} • Total: ${fmtCents(total)}`;
  list.querySelectorAll("button[data-inc]").forEach((btn)=>{
    btn.onclick = async ()=>{
      try{
        await api("/api/cart/add",{method:"POST",body:JSON.stringify({listingId:Number(btn.dataset.inc), quantity:1})});
        await loadCart();
      }catch(e){
        setCartMsg(`ERROR: ${e.message}`, true);
      }
    };
  });
  list.querySelectorAll("button[data-dec]").forEach((btn)=>{
    btn.onclick = async ()=>{
      try{
        await api("/api/cart/add",{method:"POST",body:JSON.stringify({listingId:Number(btn.dataset.dec), quantity:-1})});
        await loadCart();
      }catch(e){
        setCartMsg(`ERROR: ${e.message}`, true);
      }
    };
  });
  list.querySelectorAll("button[data-remove]").forEach((btn)=>{
    btn.onclick = async ()=>{
      try{
        await api("/api/cart/remove",{method:"POST",body:JSON.stringify({listingId:Number(btn.dataset.remove)})});
        await loadCart();
      }catch(e){
        setCartMsg(`ERROR: ${e.message}`, true);
      }
    };
  });
}
async function addToCart(listingId){
  openCartModal();
  try{
    await api("/api/cart/add",{method:"POST",body:JSON.stringify({listingId, quantity:1})});
    await loadCart();
    setCartMsg("Added to cart.");
  }catch(e){
    if(String(e.message || "").includes("Login required")) return setCartMsg("login_required", true);
    if(String(e.message || "").includes("verified access")) return setCartMsg("tier_required", true);
    setCartMsg(`ERROR: ${e.message}`, true);
  }
}
async function checkoutCart(){
  try{
    const res = await api("/api/checkout/create",{method:"POST",body:JSON.stringify({})});
    CART_ORDER_ID = res.orderId;
    setCartMsg("Checkout created. Continue to payment.");
    $("cartPayBtn").style.display = "inline-block";
    await loadCart();
  }catch(e){
    setCartMsg(`ERROR: ${e.message}`, true);
  }
}
async function payCartOrder(){
  if(!CART_ORDER_ID) return;
  try{
    const res = await api("/api/checkout/stripe",{method:"POST",body:JSON.stringify({orderId:CART_ORDER_ID})});
    if(res.checkoutUrl){
      window.location.href = res.checkoutUrl;
      return;
    }
    setCartMsg("ERROR: Missing checkout URL.", true);
  }catch(e){
    setCartMsg(`ERROR: ${e.message}`, true);
  }
}
function formatCountdown(endAt){
  if(!endAt) return "No end time";
  const t = Date.parse(endAt);
  if(Number.isNaN(t)) return "Invalid end time";
  let ms = t - Date.now();
  if(ms <= 0) return "Ended";
  const s = Math.floor(ms/1000);
  const h = Math.floor(s/3600);
  const m = Math.floor((s%3600)/60);
  const sec = s%60;
  return `${h}h ${m}m ${sec}s`;
}
function renderAuctionText(id){
  const el = document.getElementById(`auction-${id}`);
  const payLink = document.getElementById(`auction-pay-${id}`);
  const a = AUCTIONS[id];
  if(!el || !a) return;
  const current = a.highestBidCents || a.startBidCents || 0;
  el.textContent = `Ends in: ${formatCountdown(a.auctionEndAt)} | Current bid: ${fmtCents(current)} | Bids: ${a.bidCount}`;
  if(payLink){
    if(a.paymentStatus === "required" && a.winnerUserId && Number(a.winnerUserId) === Number(CURRENT_USER_ID) && a.orderId){
      payLink.href = `/pay/${a.orderId}`;
      payLink.style.display = "inline-flex";
      payLink.textContent = "Pay Now";
    }else{
      payLink.style.display = "none";
    }
  }
}
async function loadAuction(id){
  try{ AUCTIONS[id]=await api(`/listings/${id}/auction`); renderAuctionText(id); }
  catch(e){ const el=document.getElementById(`auction-${id}`); if(el) el.textContent=`Auction error: ${e.message}`; }
}
async function startDm(){
  if(!PLACE?.ownerUserId) return alert("Owner not available.");
  try{
    const convo = await api("/dm/start",{method:"POST",body:JSON.stringify({otherUserId: PLACE.ownerUserId})});
    window.location.href = `/me/profile#dm=${convo.id}`;
  }catch(e){ alert(e.message); }
}
async function toggleFollow(){
  try{
    if(!PLACE?.id) return;
    if(PLACE.isFollowing){
      await api(`/places/${PLACE.id}/follow`,{method:"DELETE"});
      PLACE.isFollowing = false;
    }else{
      await api(`/places/${PLACE.id}/follow`,{method:"POST"});
      PLACE.isFollowing = true;
    }
    const place = await api(`/places/${PLACE.id}`);
    PLACE.followCount = place.followCount || PLACE.followCount;
    updateFollowUi();
  }catch(e){ alert(e.message); }
}

async function loadLiveShow(){
  try{
    const shows = await api("/api/live/scheduled");
    const show = shows.find(s=>s.hostType === "place" && Number(s.hostPlaceId)===Number(PLACE?.id));
    const box = $("storeLiveShows");
    if(!show){
      if(box) box.style.display = "none";
      return;
    }
    LIVE_SHOW = show;
    if(box) box.style.display = "block";
    $("storeLiveShowMeta").textContent = show.startAt ? new Date(show.startAt).toLocaleString() : "";
    $("storeLiveShowDesc").textContent = show.description || "";
    const join = $("storeLiveShowJoin");
    if(show.joinUrl){
      join.href = show.joinUrl;
      join.style.display = "inline-flex";
    }else{
      join.style.display = "none";
    }
  }catch(e){}
}
function updateFollowUi(){
  const btn = $("followBtn");
  if(!btn) return;
  btn.textContent = PLACE?.isFollowing ? "Following" : "Follow";
  $("storeFollowers").textContent = `${PLACE?.followCount || 0} Followers`;
}
async function placeBid(id){
  try{
    const raw = document.getElementById(`bid-${id}`)?.value;
    const amountDollars = Number(raw);
    const amountCents = Math.round(amountDollars * 100);
    if(!Number.isFinite(amountDollars) || amountDollars<=0) return alert("Enter bid amount in dollars.");
    await api(`/listings/${id}/bid`,{method:"POST",body:JSON.stringify({amountCents})});
    await loadAuction(id);
  }catch(e){alert(e.message)}
}

async function createTestAuction(){
  try{
    const id=pid();
    const now=Date.now();
    const payload={
      listingType:"auction",
      exchangeType:"money",
      title:"Test Auction",
      description:"Testing auctions",
      quantity:1,
      price:0,
      auctionStartAt:new Date(now-60*1000).toISOString(),
      auctionEndAt:new Date(now+30*60*1000).toISOString(),
      startBidCents:100,
      minIncrementCents:50
    };
    await api(`/places/${id}/listings`,{method:"POST",body:JSON.stringify(payload)});
    LIST=await api(`/places/${id}/listings`);
    setTab("item");
  }catch(e){alert(e.message)}
}

function setTab(t){
  TAB=t;
  ["tabItems","tabOffers","tabRequests"].forEach(x=>$(x).classList.remove("active"));
  if(t==="item")$("tabItems").classList.add("active");
  if(t==="offer")$("tabOffers").classList.add("active");
  if(t==="request")$("tabRequests").classList.add("active");
  render();
}

function render(){
  const g=$("listingGrid"); g.innerHTML="";
  LIST.filter(l=>{
    const type = (l.listingType||"item");
    if(TAB==="item") return type==="item" || type==="auction";
    return type===TAB;
  }).forEach(l=>{
    const d=document.createElement("div");
    d.className="item";
    let photoUrls = l.photoUrls;
    if((!photoUrls || !photoUrls.length) && l.photoUrlsJson){
      try{ photoUrls = JSON.parse(l.photoUrlsJson); }catch{ photoUrls = []; }
    }
    const img = (photoUrls && photoUrls[0]) ? `<img class="productImg" src="${photoUrls[0]}" alt="">` : "";
    const type = (l.listingType||"item");
    const offerMeta = (type==="offer" || type==="request") ? `
      <div class="muted">Category: ${l.offerCategory || "—"}</div>
      <div class="muted">Availability: ${l.availabilityWindow || "—"}</div>
      <div class="muted">Compensation: ${l.compensationType || l.exchangeType || "—"}</div>
    ` : "";
    const qtyMeta = type==="item" ? `<div class="muted">Qty available: ${Number.isFinite(Number(l.quantity)) ? Number(l.quantity) : "—"}</div>` : "";
    const isOwner = PLACE && CURRENT_USER_ID && Number(PLACE.ownerUserId) === Number(CURRENT_USER_ID);
    const auctionEnded = l.auctionEndAt ? (Date.parse(l.auctionEndAt) <= Date.now()) : false;
    const closeBtn = (type==="auction" && isOwner && auctionEnded)
      ? `<button data-close="${l.id}">Close Auction</button>`
      : "";
    const auctionBlock = type==="auction" ? `
      <div class="mono" id="auction-${l.id}">Loading auction…</div>
      <div class="row" style="margin-top:8px;">
        <input id="bid-${l.id}" placeholder="Bid ($)" style="max-width:160px;" />
        <button data-bid="${l.id}">Place Bid</button>
        <a class="pill" id="auction-pay-${l.id}" style="display:none;">Pay Now</a>
        ${closeBtn}
      </div>
    ` : "";
    const baseMeta = `ID: ${l.id} • Type: ${type}`;
    const auctionMeta = type==="auction"
      ? `Auction ID: ${l.id}${l.auctionStatus ? ` • Status: ${l.auctionStatus}` : ""}`
      : "";
    d.innerHTML=`
      ${img}
      <div class="muted">${baseMeta}</div>
      ${type==="auction" ? `<div class="muted">${auctionMeta}</div>` : ""}
      <div style="font-weight:900">${l.title}</div>
      <div class="muted">${l.description}</div>
      ${qtyMeta}
      ${offerMeta}
      ${type==="auction" ? auctionBlock : (type!=="item" ? `<button data-id="${l.id}">Apply / Message</button>` : `<button data-cart="${l.id}">Add to Cart</button>`)}
    `;
    const b=d.querySelector("button[data-id]");
    if(b) b.onclick=()=>apply(l.id);
    const cartBtn=d.querySelector("button[data-cart]");
    if(cartBtn) cartBtn.onclick=()=>addToCart(l.id);
    const bidBtn=d.querySelector("button[data-bid]");
    if(bidBtn) bidBtn.onclick=()=>placeBid(l.id);
    const closeBtnEl = d.querySelector("button[data-close]");
    if(closeBtnEl) closeBtnEl.onclick=async()=>{
      if(!confirm("Close this auction and notify the winner?")) return;
      try{
        await api(`/api/auctions/${l.id}/close`,{method:"POST"});
        await loadAuction(l.id);
        renderAuctionText(l.id);
      }catch(e){ alert(e.message); }
    };
    d.onclick=(e)=>{
      const tag = e.target?.tagName?.toLowerCase();
      if(tag === "button" || tag === "input" || tag === "a") return;
      openListingModal(l, photoUrls || []);
    };
    g.appendChild(d);
    if(type==="auction"){
      if(!AUCTIONS[l.id]) loadAuction(l.id);
      renderAuctionText(l.id);
    }
  });
}

function openListingModal(l, photos){
  const modal = $("listingModal");
  const panel = $("listingModalPanel");
  if(!modal || !panel) return;
  $("listingModalTitle").textContent = l.title || "Listing";
  $("listingModalMeta").textContent = `ID: ${l.id} • ${(l.listingType||"item").toUpperCase()} • ${(l.exchangeType || "money")}`;
  $("listingModalDesc").textContent = l.description || "";
  $("listingModalDetails").textContent = l.listingType === "auction"
    ? `Start bid: $${((l.startBidCents||0)/100).toFixed(2)} • Min increment: $${((l.minIncrementCents||0)/100).toFixed(2)}`
    : "";
  const main = $("listingModalMainImg");
  const thumbs = $("listingModalThumbs");
  const urls = (photos && photos.length) ? photos : [];
  if(main){
    main.src = urls[0] || "";
    main.style.display = urls[0] ? "block" : "none";
  }
  thumbs.innerHTML = "";
  urls.forEach((url)=>{
    const img = document.createElement("img");
    img.src = url;
    img.style.width = "64px";
    img.style.height = "64px";
    img.style.objectFit = "cover";
    img.style.borderRadius = "8px";
    img.style.border = "1px solid rgba(255,255,255,.12)";
    img.onclick = () => { if(main) main.src = url; };
    thumbs.appendChild(img);
  });
  modal.style.display = "block";
}

async function apply(id){
  try{
    await api(`/listings/${id}/apply`,{method:"POST",body:JSON.stringify({message:"Interested"})});
    alert("Conversation started.");
  }catch(e){alert(e.message)}
}

async function main(){
  const id=pid();
  $("tabItems").onclick=()=>setTab("item");
  $("tabOffers").onclick=()=>setTab("offer");
  $("tabRequests").onclick=()=>setTab("request");
  $("messageBtn").onclick=startDm;
  $("followBtn").onclick=toggleFollow;
  $("cartBtn").onclick=async()=>{ $("cartModal").style.display="block"; await loadCart(); };
  $("cartClose").onclick=()=>{ $("cartModal").style.display="none"; };
  $("cartModal").onclick=(e)=>{ if(e.target?.id==="cartModal") $("cartModal").style.display="none"; };
  $("cartCheckoutBtn").onclick=checkoutCart;
  $("cartPayBtn").onclick=payCartOrder;
  $("listingModalClose").onclick=()=>{ $("listingModal").style.display="none"; };
  $("listingModal").onclick=(e)=>{ if(e.target?.id==="listingModal") $("listingModal").style.display="none"; };

  try{
    let me=null;
    try{ me=await api("/me"); }catch{}
    CURRENT_USER_ID = me?.user?.id || null;
    let place=null;
    try{
      place=await api(`/places/${id}`);
    }catch(e){
      $("storeName").textContent = "Store unavailable";
      $("storeMeta").textContent = e.message || "Unable to load store.";
      debug(e.message);
      return;
    }
      PLACE = place;
      $("storeName").textContent = place.name || `Store ${place.id}`;
      $("storeMeta").textContent = `${place.category || "store"} • ${place.status || "active"} • id=${place.id}`;
      $("storeDesc").textContent = place.description || "No description yet.";
      $("storeFollowers").textContent = `${place.followCount || 0} Followers`;
      const ownerTrust = $("storeOwnerTrust");
      if(ownerTrust){
        ownerTrust.textContent = place.owner?.trustTierLabel ? `Owner Trust: ${place.owner.trustTierLabel}` : "";
      }
      if(place.bannerUrl){
        $("storeBanner").style.backgroundImage = `url("${place.bannerUrl}")`;
      }
      if(place.avatarUrl){
        $("storeAvatar").src = place.avatarUrl;
      }
      const reviews = place.reviewSummary || { count:0, average:0, buyerCount:0, sellerCount:0 };
      $("storeRating").textContent = `★ ${reviews.average.toFixed(1)} (${reviews.count} Reviews)`;
      $("storeReviewRoles").textContent = `Buyer reviews: ${reviews.buyerCount} • Seller reviews: ${reviews.sellerCount}`;
      updateFollowUi();
      await loadLiveShow();
      if(me?.user && place?.ownerUserId && Number(place.ownerUserId)===Number(me.user.id)){
        const btn=$("testAuctionBtn");
        if(btn){
          btn.style.display="inline-block";
          btn.onclick=()=>createTestAuction();
        }
      }
    LIST=await api(`/places/${id}/listings`);
    setTab("item");
    await loadCart();
    debug("Ready.");
  }catch(e){debug(e.message)}
}
main();
setInterval(()=>Object.keys(AUCTIONS).forEach(id=>renderAuctionText(id)), 1000);
