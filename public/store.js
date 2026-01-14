const $ = (id) => document.getElementById(id);

function debug(msg){ $("debug").textContent = msg || ""; }

async function api(path, opts) {
  const res = await fetch(path, { credentials: "include", ...(opts||{}) });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

function getPlaceIdFromPath(){
  const parts = window.location.pathname.split("/").filter(Boolean);
  return Number(parts[1]);
}

function escapeHtml(s){
  return (s||"")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function safeMoney(n){
  const x = Number(n);
  if(!Number.isFinite(x)) return "0";
  return x.toFixed(2).replace(/\.00$/, "");
}

function renderThumbs(urls){
  const u = Array.isArray(urls) ? urls : [];
  if(!u.length) return `<div class="muted" style="margin-top:8px;">No photos yet.</div>`;
  const imgs = u.slice(0,5).map(src=>`<img class="thumb" src="${escapeHtml(src)}" />`).join("");
  return `<div class="thumbRow">${imgs}</div>`;
}

let PLACE = null;
let LISTINGS = [];
let ME = null;
let LOGGED_IN = false;
let FOLLOWING = false;

let IS_OWNER = false;
let SELECTED = null;

function renderListings(listings, q){
  const grid = $("listingGrid");
  grid.innerHTML = "";

  const query = (q || "").trim().toLowerCase();
  const filtered = !query ? listings : listings.filter(l=>{
    const t = `${l.title||""} ${l.description||""}`.toLowerCase();
    return t.includes(query);
  });

  $("countLbl").textContent = String(filtered.length);

  if(filtered.length === 0){
    grid.innerHTML = `<div class="item"><div style="font-weight:900;">No matches</div><div class="muted">Try another search.</div></div>`;
    return;
  }

  for(const l of filtered){
    const div = document.createElement("div");
    div.className = "item";
    div.style.cursor = "pointer";
    div.onclick = ()=>selectListing(l.id);

    div.innerHTML = `
      <div style="display:flex; justify-content:space-between; gap:10px;">
        <div style="flex:1;">
          <div style="font-weight:900;">${escapeHtml(l.title || "")}</div>
          <div class="muted" style="margin-top:6px;">${escapeHtml(l.description || "")}</div>
          ${renderThumbs(l.photoUrls)}
        </div>
        <div style="text-align:right;">
          <div class="price">$${safeMoney(l.price)}</div>
          <div class="muted">qty ${Number(l.quantity||0)}</div>
          <div class="muted">${escapeHtml((l.status||"").toUpperCase())}</div>
          <div class="muted" style="margin-top:6px;">id=${l.id}</div>
        </div>
      </div>
    `;
    grid.appendChild(div);
  }
}

async function refreshSweep(){
  try{
    const s = await api("/sweep/balance");
    $("sweepBal").textContent = s.balance ?? 0;
  } catch {}
}

async function refreshFollowUI(){
  const r = await api(`/places/${PLACE.id}/followers`);
  $("followersCount").textContent = String(r.count ?? 0);
  FOLLOWING = !!r.following;

  const btn = $("followBtn");
  btn.disabled = false;
  btn.textContent = FOLLOWING ? "Unfollow" : "Follow";
}

async function toggleFollow(){
  if(!LOGGED_IN){
    window.location.href = "/signup";
    return;
  }
  if(!PLACE) return;

  if(FOLLOWING){
    await api(`/places/${PLACE.id}/follow`, { method:"DELETE" });
  } else {
    await api(`/places/${PLACE.id}/follow`, { method:"POST" });
  }
  await refreshFollowUI();
}

async function openChat(){
  if(!LOGGED_IN){
    window.location.href = "/signup";
    return;
  }
  // keep existing chat system minimal here; you already validated chat works
  alert("Chat is available from the current store version; we can merge chat UI into this seller-tools layout next if you want.");
}

function showSellerTools(show){
  $("sellerTools").style.display = show ? "block" : "none";
}

function setSellerButtonsEnabled(enabled){
  $("saveListingBtn").disabled = !enabled;
  $("toggleActiveBtn").disabled = !enabled;
  $("markSoldBtn").disabled = !enabled;
  $("savePhotosBtn").disabled = !enabled;
}

function fillSellerForm(l){
  $("selListing").textContent = String(l.id);
  $("selStatus").textContent = (l.status || "").toUpperCase();
  $("editTitle").value = l.title || "";
  $("editDesc").value = l.description || "";
  $("editPrice").value = String(l.price ?? "");
  $("editQty").value = String(l.quantity ?? "");
  $("photoUrlsBox").value = (l.photoUrls || []).join("\n");

  // button label
  $("toggleActiveBtn").textContent = (l.status === "inactive") ? "Activate" : "Deactivate";
}

function selectListing(listingId){
  const l = LISTINGS.find(x=>Number(x.id)===Number(listingId));
  if(!l) return;
  SELECTED = l;

  debug(`Selected listing ${l.id}`);
  if(IS_OWNER){
    showSellerTools(true);
    fillSellerForm(l);
    setSellerButtonsEnabled(true);
  }
}

async function saveListing(){
  if(!IS_OWNER || !SELECTED) return;

  const payload = {
    title: $("editTitle").value.trim(),
    description: $("editDesc").value,
    price: Number($("editPrice").value),
    quantity: Number($("editQty").value),
  };

  const updated = await api(`/listings/${SELECTED.id}`, {
    method: "PATCH",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify(payload),
  });

  LISTINGS = LISTINGS.map(x => x.id === updated.id ? updated : x);
  SELECTED = updated;

  renderListings(LISTINGS, $("searchBox").value);
  fillSellerForm(updated);
  debug(`Saved listing ${updated.id}`);
}

async function toggleActive(){
  if(!IS_OWNER || !SELECTED) return;

  const next = (SELECTED.status === "inactive") ? "active" : "inactive";
  const updated = await api(`/listings/${SELECTED.id}/status`, {
    method: "PATCH",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ status: next }),
  });

  LISTINGS = LISTINGS.map(x => x.id === updated.id ? updated : x);
  SELECTED = updated;

  renderListings(LISTINGS, $("searchBox").value);
  fillSellerForm(updated);
  debug(`Set status ${next} for listing ${updated.id}`);
}

async function markSold(){
  if(!IS_OWNER || !SELECTED) return;

  const updated = await api(`/listings/${SELECTED.id}/status`, {
    method: "PATCH",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ status: "sold" }),
  });

  LISTINGS = LISTINGS.map(x => x.id === updated.id ? updated : x);
  SELECTED = updated;

  renderListings(LISTINGS, $("searchBox").value);
  fillSellerForm(updated);
  debug(`Marked sold listing ${updated.id}`);
}

async function savePhotos(){
  if(!IS_OWNER || !SELECTED) return;

  const urls = $("photoUrlsBox").value.split("\n").map(s=>s.trim()).filter(Boolean);

  const updated = await api(`/listings/${SELECTED.id}/photos`, {
    method: "PATCH",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ photoUrls: urls }),
  });

  LISTINGS = LISTINGS.map(x => x.id === updated.id ? updated : x);
  SELECTED = updated;

  renderListings(LISTINGS, $("searchBox").value);
  fillSellerForm(updated);
  debug(`Saved photos for listing ${updated.id}`);
}

async function main(){
  const placeId = getPlaceIdFromPath();
  if(!placeId){
    debug("Invalid store URL. Expected /store/:placeId");
    return;
  }

  await refreshSweep();

  // Login state
  try{
    const meWrap = await api("/me");
    ME = meWrap.user || null;
    LOGGED_IN = !!ME;
  } catch {
    ME = null;
    LOGGED_IN = false;
  }

  PLACE = await api(`/places/${placeId}`);
  const ownerWrap = await api(`/places/${placeId}/owner`);
  LISTINGS = await api(`/places/${placeId}/listings`);

  $("storeName").textContent = PLACE.name || `Store ${PLACE.id}`;
  $("storeMeta").textContent = `${PLACE.category} • ${PLACE.status} • district ${PLACE.districtId} • placeId=${PLACE.id}`;

  const verified = PLACE.verifiedStatus === "verified" ? "✅ Verified" : (PLACE.verifiedStatus || "unverified");
  $("verifiedTag").textContent = verified;
  $("claimedTag").textContent = PLACE.ownerUserId ? "claimed" : "unclaimed";

  if(ownerWrap.owner){
    $("ownerName").textContent = ownerWrap.owner.displayName || `User ${ownerWrap.owner.id}`;
    $("ownerBio").textContent = ownerWrap.owner.bio || "";
  } else {
    $("ownerName").textContent = "—";
    $("ownerBio").textContent = "";
  }

  // Owner logic
  IS_OWNER = LOGGED_IN && Number(PLACE.ownerUserId || 0) === Number(ME.id || 0);
  showSellerTools(false);
  setSellerButtonsEnabled(false);

  $("saveListingBtn").onclick = saveListing;
  $("toggleActiveBtn").onclick = toggleActive;
  $("markSoldBtn").onclick = markSold;
  $("savePhotosBtn").onclick = savePhotos;

  // Follow
  $("followBtn").onclick = toggleFollow;
  await refreshFollowUI();

  // Message
  $("messageBtn").disabled = false;
  $("messageBtn").onclick = openChat;

  $("searchBox").addEventListener("input", (e)=>{
    renderListings(LISTINGS, e.target.value);
  });

  renderListings(LISTINGS, "");
  debug(IS_OWNER ? "Owner mode enabled. Select a listing to edit." : (LOGGED_IN ? "Viewing store." : "Login to follow/message."));
}

main().catch(e=>debug(`ERROR: ${e.message}`));
