const $=id=>document.getElementById(id);
function debug(m){$("debug").textContent=m||"";}

let PLACE=null;
let CURRENT_USER_ID=null;

function showSubscriptionPrompt(message) {
  const msg = message || "Create a free account to buy, sell, and enter giveaways.";
  const choice = confirm(`${msg}\n\nClick OK to create a free account, or Cancel to go back.`);
  if(choice){
    window.location.href = "/verify";
  }
}

async function api(u,o){
  const r=await fetch(u,{credentials:"include",headers:{"Content-Type":"application/json"},...(o||{})});
  const t=await r.text(); let j;
  try{j=JSON.parse(t)}catch{j=t}
  if(!r.ok) {
    if(j && j.subscriptionRequired){
      showSubscriptionPrompt(j.message);
      throw new Error("Subscription required");
    }
    throw new Error(j.error||t);
  }
  return j;
}
function pid(){return Number(location.pathname.split("/")[2]);}

let LIST=[],TAB="item",AUCTIONS={},CAT_FILTER="All";
let LIVE_SHOW=null;
let CART={ items:[] };
let CART_ORDER_ID=null;
let DELIVERY_QUOTE = null;

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
  if(isError && msg === "Subscription required"){
    el.innerHTML = `<a href="/verify">Create a free account</a> to buy items, or <a href="/subscribe">subscribe</a> to also sell.`;
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
  const isManaged = PLACE && (PLACE.storeType === 'managed' || PLACE.storetype === 'managed');
  const deliverySection = document.getElementById('cartDeliverySection');
  if (deliverySection) deliverySection.style.display = isManaged ? 'block' : 'none';
  // Update cart messaging based on store type
  const msgEl = document.querySelector("#cartPanel > div:nth-child(4) .muted");
  if(msgEl){
    msgEl.innerHTML = isManaged
      ? `<strong>Delivery Info:</strong> Orders close Thursday midnight. Your items ship Friday and deliver to your door the following week. Free delivery in Sebastian.`
      : `<strong>How it works:</strong> Place your order, then contact the seller to arrange pickup and payment (cash, Venmo, etc.).`;
  }
  const checkoutBtn = $("cartCheckoutBtn");
  if(checkoutBtn) checkoutBtn.textContent = isManaged ? "Proceed to Checkout" : "Place Order";
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
  totals.innerHTML = `
    <div style="margin-bottom:8px;">
      <div style="font-size:18px;font-weight:700;">Total: ${fmtCents(subtotal)}</div>
    </div>
  `;
  list.querySelectorAll("button[data-inc]").forEach((btn)=>{
    btn.addEventListener("click", async ()=>{
      try{
        await api("/api/cart/add",{method:"POST",body:JSON.stringify({listingId:Number(btn.dataset.inc), quantity:1})});
        await loadCart();
      }catch(e){
        setCartMsg(`ERROR: ${e.message}`, true);
      }
    });
  });
  list.querySelectorAll("button[data-dec]").forEach((btn)=>{
    btn.addEventListener("click", async ()=>{
      try{
        await api("/api/cart/add",{method:"POST",body:JSON.stringify({listingId:Number(btn.dataset.dec), quantity:-1})});
        await loadCart();
      }catch(e){
        setCartMsg(`ERROR: ${e.message}`, true);
      }
    });
  });
  list.querySelectorAll("button[data-remove]").forEach((btn)=>{
    btn.addEventListener("click", async ()=>{
      try{
        await api("/api/cart/remove",{method:"POST",body:JSON.stringify({listingId:Number(btn.dataset.remove)})});
        await loadCart();
      }catch(e){
        setCartMsg(`ERROR: ${e.message}`, true);
      }
    });
  });
}
async function getDeliveryQuote() {
  const street = document.getElementById('deliveryStreetInput').value.trim();
  const city = document.getElementById('deliveryCityInput').value.trim();
  const state = document.getElementById('deliveryStateInput').value.trim();
  const zip = document.getElementById('deliveryZipInput').value.trim();
  if (!street || !zip) return alert('Please enter your street address and zip code');
  const addr = street + ', ' + city + ', ' + state + ' ' + zip;
  const btn = document.getElementById('getDeliveryQuoteBtn');
  btn.textContent = 'Getting quote...';
  btn.disabled = true;
  try {
    const res = await api('/api/delivery/quote', {
      method: 'POST',
      body: JSON.stringify({ placeId: PLACE.id, dropoffAddress: addr })
    });
    DELIVERY_QUOTE = res;
    document.getElementById('deliveryFeeDisplay').textContent = '$' + (res.feeCents / 100).toFixed(2);
    document.getElementById('deliveryEtaDisplay').textContent = res.estimatedMinutes + ' min';
    document.getElementById('deliveryQuoteResult').style.display = 'block';
    const subtotal = CART.items.reduce((s, i) => s + i.priceCents * i.quantity, 0);
    document.getElementById('cartTotals').innerHTML = '<div style="display:flex;justify-content:space-between;"><span>Subtotal:</span><span>$' + (subtotal/100).toFixed(2) + '</span></div><div style="display:flex;justify-content:space-between;"><span>Delivery:</span><span>$' + (res.feeCents/100).toFixed(2) + '</span></div><div style="display:flex;justify-content:space-between;font-weight:700;border-top:1px solid #ccc;padding-top:6px;margin-top:6px;"><span>Total:</span><span>$' + ((subtotal+res.feeCents)/100).toFixed(2) + '</span></div>';
  } catch (err) {
    alert('Could not get delivery quote: ' + (err.message || 'Try again'));
  } finally {
    btn.textContent = 'Get Delivery Quote';
    btn.disabled = false;
  }
}
async function addToCart(listingId, qty=1){
  openCartModal();
  try{
    await api("/api/cart/add",{method:"POST",body:JSON.stringify({listingId, quantity:qty})});
    await loadCart();
    setCartMsg(qty > 1 ? `Added ${qty} items to cart.` : "Added to cart.");
  }catch(e){
    if(String(e.message || "").includes("Login required")) return setCartMsg("login_required", true);
    if(String(e.message || "").includes("verified access")) return setCartMsg("tier_required", true);
    setCartMsg(`ERROR: ${e.message}`, true);
  }
}
async function checkoutCart(){
  const isManaged = PLACE && (PLACE.storeType === 'managed' || PLACE.storetype === 'managed');
  let body = {};
  if (isManaged && DELIVERY_QUOTE) {
    const street = document.getElementById('deliveryStreetInput').value.trim();
    const city = document.getElementById('deliveryCityInput').value.trim();
    const state = document.getElementById('deliveryStateInput').value.trim();
    const zip = document.getElementById('deliveryZipInput').value.trim();
    const addr = street + ', ' + city + ', ' + state + ' ' + zip;
    const name = document.getElementById('deliveryNameInput').value.trim();
    const phone = document.getElementById('deliveryPhoneInput').value.trim();
    if (!addr) return alert('Please enter your delivery address and get a quote first');
    body = {
      deliveryAddress: { street: addr, name: name, phone: phone },
      deliveryFeeCents: DELIVERY_QUOTE.feeCents,
      uberQuoteId: DELIVERY_QUOTE.quoteId,
      fulfillmentType: 'delivery'
    };
  }
  const res = await api("/api/checkout/create", {method:"POST", body:JSON.stringify(body)});
  CART_ORDER_ID = res.orderId;
  if(isManaged){
    const stripeRes = await api("/api/checkout/stripe", {method:"POST", body:JSON.stringify({orderId: res.orderId})});
    window.location.href = stripeRes.checkoutUrl;
  } else {
    window.location.href = `/order-confirmed?orderId=${res.orderId}`;
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
  CAT_FILTER="All";
  ["tabItems","tabOffers","tabRequests"].forEach(x=>$(x).classList.remove("active"));
  if(t==="item")$("tabItems").classList.add("active");
  if(t==="offer")$("tabOffers").classList.add("active");
  if(t==="request")$("tabRequests").classList.add("active");
  renderCategoryFilters();
  render();
}

function renderCategoryFilters(){
  const container = $("categoryFilters");
  if(!container) return;
  // Hide filters when not on Shop tab
  if(TAB !== "item"){
    container.style.display = "none";
    return;
  }
  container.style.display = "flex";
  // Get unique categories from item listings
  const cats = [...new Set(LIST.filter(l => (l.listingType||"item")==="item" || (l.listingType||"item")==="auction")
    .map(l => l.offerCategory || l.offercategory || "")
    .filter(c => c))];
  cats.sort();
  container.innerHTML = "";
  // "All" button
  const allBtn = document.createElement("button");
  allBtn.className = "catBtn" + (CAT_FILTER === "All" ? " active" : "");
  allBtn.textContent = "All";
  allBtn.onclick = () => { CAT_FILTER = "All"; renderCategoryFilters(); render(); };
  container.appendChild(allBtn);
  // Category buttons
  cats.forEach(cat => {
    const btn = document.createElement("button");
    btn.className = "catBtn" + (CAT_FILTER === cat ? " active" : "");
    btn.textContent = cat;
    btn.onclick = () => { CAT_FILTER = cat; renderCategoryFilters(); render(); };
    container.appendChild(btn);
  });
}

function render(){
  const g=$("listingGrid"); g.innerHTML="";
  LIST.filter(l=>{
    const type = (l.listingType||"item");
    if(TAB==="item"){
      if(type!=="item" && type!=="auction") return false;
      if(CAT_FILTER !== "All"){
        const cat = l.offerCategory || l.offercategory || "";
        if(cat !== CAT_FILTER) return false;
      }
      return true;
    }
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
    const baseMeta = l.offerCategory || l.offercategory || "";
    const auctionMeta = type==="auction"
      ? `Auction ID: ${l.id}${l.auctionStatus ? ` • Status: ${l.auctionStatus}` : ""}`
      : "";
    const priceDisplay = (l.price && Number(l.price) > 0) ? `<div style="font-weight:700; color:#22c55e; font-size:1.1em;">$${Number(l.price).toFixed(2)}</div>` : "";
    const isManaged = PLACE && (PLACE.storeType === 'managed' || PLACE.storetype === 'managed');
    const cartBlock = type==="item" ? (isManaged
      ? `<div class="row" style="gap:6px; align-items:center; margin-top:8px;">
           <button data-qty-dec="${l.id}" style="width:28px;height:28px;padding:0;">−</button>
           <span data-qty-val="${l.id}" style="min-width:24px;text-align:center;">1</span>
           <button data-qty-inc="${l.id}" style="width:28px;height:28px;padding:0;">+</button>
           <button data-cart="${l.id}" style="flex:1;">Add to Cart</button>
         </div>`
      : `<button data-cart="${l.id}">Add to Cart</button>`) : "";
    d.innerHTML=`
      ${img}
      <div class="muted">${baseMeta}</div>
      ${type==="auction" ? `<div class="muted">${auctionMeta}</div>` : ""}
      <div style="font-weight:900">${l.title}</div>
      ${priceDisplay}
      <div class="muted">${l.description}</div>
      ${qtyMeta}
      ${offerMeta}
      ${type==="auction" ? auctionBlock : (type!=="item" ? `<button data-id="${l.id}">Apply / Message</button>` : cartBlock)}
    `;
    const b=d.querySelector("button[data-id]");
    if(b) b.addEventListener("click", ()=>apply(l.id));
    // Quantity controls for managed stores
    const qtyDecBtn = d.querySelector(`button[data-qty-dec="${l.id}"]`);
    const qtyIncBtn = d.querySelector(`button[data-qty-inc="${l.id}"]`);
    const qtyValEl = d.querySelector(`span[data-qty-val="${l.id}"]`);
    if(qtyDecBtn && qtyIncBtn && qtyValEl){
      qtyDecBtn.addEventListener("click", (e)=>{ e.stopPropagation(); let v=Number(qtyValEl.textContent)||1; if(v>1) qtyValEl.textContent=v-1; });
      qtyIncBtn.addEventListener("click", (e)=>{ e.stopPropagation(); let v=Number(qtyValEl.textContent)||1; if(v<50) qtyValEl.textContent=v+1; });
    }
    const cartBtn=d.querySelector("button[data-cart]");
    if(cartBtn) cartBtn.addEventListener("click", (e)=>{ e.stopPropagation(); const qty=qtyValEl?Number(qtyValEl.textContent)||1:1; addToCart(l.id, qty); });
    const bidBtn=d.querySelector("button[data-bid]");
    if(bidBtn) bidBtn.addEventListener("click", ()=>placeBid(l.id));
    const closeBtnEl = d.querySelector("button[data-close]");
    if(closeBtnEl) closeBtnEl.addEventListener("click", async()=>{
      if(!confirm("Close this auction and notify the winner?")) return;
      try{
        await api(`/api/auctions/${l.id}/close`,{method:"POST"});
        await loadAuction(l.id);
        renderAuctionText(l.id);
      }catch(e){ console.error(e.message); }
    });
    d.addEventListener("click", (e)=>{
      const tag = e.target?.tagName?.toLowerCase();
      if(tag === "button" || tag === "input" || tag === "a") return;
      openListingModal(l, photoUrls || []);
    });
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
  const isManaged = PLACE && (PLACE.storeType === 'managed' || PLACE.storetype === 'managed');
  $("listingModalTitle").textContent = l.title || "Listing";
  // For managed stores, show category; for peer stores, show legacy meta
  const category = l.offerCategory || l.offercategory || "";
  $("listingModalMeta").textContent = isManaged ? category : `ID: ${l.id} • ${(l.listingType||"item").toUpperCase()} • ${(l.exchangeType || "money")}`;
  $("listingModalDesc").textContent = l.description || "";
  // Extract size/weight from title (e.g., "1 lb", "5 lb", "1/4 lb")
  const sizeMatch = (l.title || "").match(/(\d+\/?\d*\s*lb|\d+\.\d+\s*lb)/i);
  const sizeText = sizeMatch ? sizeMatch[0] : "";
  const detailsEl = $("listingModalDetails");
  if(l.listingType === "auction"){
    detailsEl.innerHTML = `Start bid: $${((l.startBidCents||0)/100).toFixed(2)} • Min increment: $${((l.minIncrementCents||0)/100).toFixed(2)}`;
  } else if(isManaged && l.listingType === "item"){
    const price = (l.price && Number(l.price) > 0) ? `$${Number(l.price).toFixed(2)}` : "";
    detailsEl.innerHTML = `
      ${price ? `<div style="font-size:1.5em; font-weight:700; color:#22c55e; margin:12px 0;">${price}</div>` : ""}
      ${sizeText ? `<div class="muted" style="margin-bottom:12px;">Size: ${sizeText}</div>` : ""}
      <div class="row" style="gap:8px; align-items:center; margin-top:12px;">
        <button id="modalQtyDec" style="width:32px;height:32px;padding:0;font-size:18px;">−</button>
        <span id="modalQtyVal" style="min-width:32px;text-align:center;font-size:16px;font-weight:600;">1</span>
        <button id="modalQtyInc" style="width:32px;height:32px;padding:0;font-size:18px;">+</button>
        <button id="modalAddCart" style="flex:1;padding:10px 16px;">Add to Cart</button>
      </div>
    `;
    $("modalQtyDec")?.addEventListener("click", ()=>{ let v=Number($("modalQtyVal").textContent)||1; if(v>1) $("modalQtyVal").textContent=v-1; });
    $("modalQtyInc")?.addEventListener("click", ()=>{ let v=Number($("modalQtyVal").textContent)||1; if(v<50) $("modalQtyVal").textContent=v+1; });
    $("modalAddCart")?.addEventListener("click", ()=>{ const qty=Number($("modalQtyVal").textContent)||1; addToCart(l.id, qty); modal.style.display="none"; });
  } else {
    detailsEl.textContent = "";
  }
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
    img.addEventListener("click", () => { if(main) main.src = url; });
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
  // CSP-compliant event listeners
  $("tabItems")?.addEventListener("click", ()=>setTab("item"));
  $("tabOffers")?.addEventListener("click", ()=>setTab("offer"));
  $("tabRequests")?.addEventListener("click", ()=>setTab("request"));
  $("messageBtn")?.addEventListener("click", startDm);
  $("followBtn")?.addEventListener("click", toggleFollow);
  $("cartBtn")?.addEventListener("click", async()=>{ $("cartModal").style.display="block"; await loadCart(); });
  $("cartClose")?.addEventListener("click", ()=>{ $("cartModal").style.display="none"; });
  $("cartModal")?.addEventListener("click", (e)=>{ if(e.target?.id==="cartModal") $("cartModal").style.display="none"; });
  $("cartCheckoutBtn")?.addEventListener("click", checkoutCart);
  $("cartClearBtn")?.addEventListener("click", async ()=>{
    try{ await api("/api/cart/clear",{method:"POST"}); await loadCart(); setCartMsg("Cart cleared."); }
    catch(e){ setCartMsg("ERROR: "+e.message, true); }
  });
  $("listingModalClose")?.addEventListener("click", ()=>{ $("listingModal").style.display="none"; });
  $("listingModal")?.addEventListener("click", (e)=>{ if(e.target?.id==="listingModal") $("listingModal").style.display="none"; });

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
      if(place.bannerUrl || place.bannerurl){
        $("storeBanner").style.backgroundImage = `url("${place.bannerUrl || place.bannerurl}")`;
      }
      if(place.avatarUrl || place.avatarurl){
        $("storeAvatar").src = place.avatarUrl || place.avatarurl;
      }
      const reviews = place.reviewSummary || { count:0, average:0, buyerCount:0, sellerCount:0 };
      $("storeRating").textContent = `★ ${reviews.average.toFixed(1)} (${reviews.count} Reviews)`;
      $("storeReviewRoles").textContent = `Buyer reviews: ${reviews.buyerCount} • Seller reviews: ${reviews.sellerCount}`;
      // Share button handler
      const shareBtn = $("shareStoreBtn");
      if(shareBtn && window.ShareModal){
        shareBtn.onclick = () => {
          ShareModal.show({
            type: 'store',
            title: `Share ${place.name || 'this store'}`,
            shareText: `Check out ${place.name || 'this store'} on Digital Sebastian! ${place.description || ''}`.slice(0, 200),
            shareUrl: window.location.href,
            imageUrl: place.avatarUrl || place.avatarurl || ''
          });
        };
      }
      updateFollowUi();
      await loadLiveShow();
      if(me?.user && place?.ownerUserId && Number(place.ownerUserId)===Number(me.user.id)){
        const btn=$("testAuctionBtn");
        if(btn){
          btn.style.display="inline-block";
          btn.addEventListener("click", ()=>createTestAuction());
        }
        // Show owner controls
        const ownerControls = $("ownerControls");
        if(ownerControls){
          ownerControls.style.display = "block";
          // Update links with placeId
          const subLink = $("subscriptionLink");
          if(subLink) subLink.href = `/business-subscription?placeId=${place.id}`;
          const giveawayLink = $("giveawayOfferLink");
          if(giveawayLink) giveawayLink.href = `/giveaway-offer?placeId=${place.id}`;
          // Load subscription status
          loadSubscriptionStatus(place.id);
        }
      }
    LIST=await api(`/places/${id}/listings`);
    setTab("item");
    await loadCart();
    debug("Ready.");
  }catch(e){debug(e.message)}
}

async function loadSubscriptionStatus(placeId){
  const statusEl = $("subscriptionStatus");
  if(!statusEl) return;
  try {
    const result = await api(`/api/business/subscription/${placeId}`);
    if(!result.subscription){
      statusEl.innerHTML = '<span style="color:#eab308;">No subscription</span> - <a href="/business-subscription?placeId='+placeId+'">Start free trial</a>';
      return;
    }
    const sub = result.subscription;
    const isActive = result.isActive;
    if(isActive && sub.plan === 'free_trial'){
      const trialEnd = new Date(sub.trialEndsAt);
      const now = new Date();
      const daysLeft = Math.max(0, Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24)));
      statusEl.innerHTML = '<span style="color:#3b82f6;">Free Trial</span> - ' + daysLeft + ' days remaining';
    } else if(isActive){
      statusEl.innerHTML = '<span style="color:#22c55e;">Active Subscription</span>';
    } else {
      statusEl.innerHTML = '<span style="color:#ef4444;">Subscription Expired</span> - <a href="/business-subscription?placeId='+placeId+'">Renew</a>';
    }
  } catch(e) {
    statusEl.innerHTML = '<span style="color:#eab308;">No subscription</span> - <a href="/business-subscription?placeId='+placeId+'">Start free trial</a>';
  }
}

main();
setInterval(()=>Object.keys(AUCTIONS).forEach(id=>renderAuctionText(id)), 1000);
