async function api(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

let currentUserId = null;
let approvedStores = [];
let auctionPhotos = [];
let listingPhotos = [];
let storeConversationId = null;
let townCtx = { trustTier:0, tierName:"Visitor", permissions:{} };
let listingApprovalOk = false;
let salesRange = "7d";

function setMsg(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function formatCents(c){
  const n = Number(c || 0);
  return `$${(n / 100).toFixed(2)}`;
}
function dayKey(d){
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,"0");
  const day=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function rangeToDates(range){
  const now=new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if(range==="today") return { from: dayKey(today), to: dayKey(today) };
  if(range==="7d"){
    const start = new Date(today.getTime() - 6*86400000);
    return { from: dayKey(start), to: dayKey(today) };
  }
  const start = new Date(today.getTime() - 29*86400000);
  return { from: dayKey(start), to: dayKey(today) };
}

async function loadSales(placeId){
  if(!placeId) return;
  const { from, to } = rangeToDates(salesRange);
  const label = document.getElementById("salesRangeLabel");
  if(label) label.textContent = `${salesRange.toUpperCase()} (${from} → ${to})`;
  const summary = await api(`/api/seller/sales/summary?placeId=${placeId}&range=${salesRange}`);
  document.getElementById("salesRevenue").textContent = formatCents(summary.totals.revenueCents);
  document.getElementById("salesOrders").textContent = summary.totals.orderCount;
  document.getElementById("salesAvg").textContent = formatCents(summary.totals.avgOrderValueCents);

  const daily = document.getElementById("salesDaily");
  daily.innerHTML = summary.daily.length
    ? summary.daily.map(d=>`<div class="item">${d.dayKey} • ${formatCents(d.revenueCents)} • ${d.orderCount} orders</div>`).join("")
    : `<div class="muted">No sales in range.</div>`;

  const top = document.getElementById("salesTopItems");
  top.innerHTML = summary.topItems.length
    ? summary.topItems.map(i=>`<div class="item">${i.title} • ${i.qty} sold • ${formatCents(i.revenueCents)}</div>`).join("")
    : `<div class="muted">No items.</div>`;

  const recent = document.getElementById("salesRecent");
  recent.innerHTML = summary.recentOrders.length
    ? summary.recentOrders.map(o=>`<div class="item">#${o.orderId} • ${o.status} • ${formatCents(o.totalCents)} • ${o.createdAt}</div>`).join("")
    : `<div class="muted">No recent orders.</div>`;

  const exportLink = document.getElementById("salesExportLink");
  exportLink.href = `/api/seller/sales/export.csv?placeId=${placeId}&from=${from}&to=${to}`;
}

async function loadSellerOrders(placeId){
  if(!placeId) return;
  const list = document.getElementById("sellerOrdersList");
  const msg = document.getElementById("sellerOrdersMsg");
  msg.textContent = "";
  try{
    const orders = await api("/api/seller/orders");
    const filtered = orders.filter(o=>Number(o.sellerPlaceId)===Number(placeId));
    if(!filtered.length){
      list.innerHTML = `<div class="muted">No orders yet.</div>`;
      return;
    }
    list.innerHTML = filtered.slice(0,15).map(o=>{
      const total = formatCents(o.totalCents || 0);
      return `<div class="item">#${o.id} • ${o.status} • ${total} • ${o.createdAt}</div>`;
    }).join("");
  }catch(e){
    msg.textContent = `ERROR: ${e.message}`;
  }
}

async function loadMe() {
  try {
    const profile = await api("/api/me/profile");
    currentUserId = profile.id;
  } catch (e) {
    document.getElementById("storeLoginNote").textContent = "Login required to manage stores.";
  }
}

async function loadTownContext(){
  try {
    townCtx = await api("/town/context");
  } catch {
    townCtx = { trustTier:0, tierName:"Visitor", permissions:{} };
  }
  const badge = document.getElementById("trustBadge");
  if(badge) badge.textContent = `Tier ${townCtx.trustTier || 0}: ${townCtx.tierName || townCtx.trustTierLabel || "Visitor"}`;
  applyStorePermissions();
}

function applyStorePermissions(){
  const perms = townCtx.permissions || {};
  const canList = !!perms.listingCreate;
  const canAuction = canList && !!perms.auctionHost;
  const listingBtn = document.getElementById("createListingBtn");
  const listingSelect = document.getElementById("listingStore");
  const auctionBtn = document.getElementById("auctionPublishBtn");
  const inboxBtn = document.getElementById("storeInboxSendBtn");
  const inboxInput = document.getElementById("storeInboxInput");
  if(listingBtn) listingBtn.disabled = !canList;
  if(listingSelect) listingSelect.disabled = !canList;
  if(auctionBtn) auctionBtn.disabled = !canAuction;
  if(inboxBtn) inboxBtn.disabled = !(perms.dm);
  if(inboxInput) inboxInput.disabled = !(perms.dm);
  if(!perms.listingCreate){
    setMsg("listingMsg", "Tier 1+ required to create listings.");
  }
  const type = document.getElementById("listingType")?.value;
  if(type === "auction" && !canAuction){
    setMsg("listingMsg", "Tier 1+ required to list auction items.");
  }
}

async function createStore() {
  try {
    const payload = {
      sellerType: document.getElementById("storeType")?.value || "individual",
      districtId: Number(document.getElementById("storeDistrict")?.value || 1),
      name: document.getElementById("storeName").value.trim(),
      category: document.getElementById("storeCategory").value.trim(),
      description: document.getElementById("storeDescription").value.trim(),
      addressPrivate: document.getElementById("storeAddress").value.trim(),
      website: document.getElementById("storeWebsite").value.trim(),
      yearsInTown: document.getElementById("storeYears").value.trim()
    };
    const created = await api("/places", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setMsg("storeMsg", `Application submitted (#${created.id})`);
    await loadOwnedStores();
  } catch (e) {
    setMsg("storeMsg", `ERROR: ${e.message}`);
  }
}

async function loadOwnedStores() {
  if (!currentUserId) return;
  let owned = [];
  try {
    owned = await api('/api/places/mine');
  } catch (e) {
    console.error('Failed to load owned stores:', e);
  }
  const list = document.getElementById("ownedStores");
  const select = document.getElementById("listingStore");
  const storefrontSelect = document.getElementById("storefrontStore");
  const inboxSelect = document.getElementById("storeInboxStore");
  const salesSelect = document.getElementById("salesStore");
  const ordersSelect = document.getElementById("sellerOrdersStore");
  if(list) list.innerHTML = "";
  if(select) select.innerHTML = "";
  if(storefrontSelect) storefrontSelect.innerHTML = "";
  if(inboxSelect) inboxSelect.innerHTML = "";
  if(salesSelect) salesSelect.innerHTML = "";
  if(ordersSelect) ordersSelect.innerHTML = "";
  if (!owned.length) {
    list.innerHTML = `<div class="muted">No owned stores yet.</div>`;
    return;
  }
  owned.forEach((p) => {
    const div = document.createElement("div");
    div.textContent = `${p.name} (#${p.id}) • ${p.status || "pending"}`;
    if(list) list.appendChild(div);
    const inboxOpt = document.createElement("option");
    inboxOpt.value = p.id;
    inboxOpt.textContent = p.name;
    if(inboxSelect) inboxSelect.appendChild(inboxOpt);
    const storefrontOpt = document.createElement("option");
    storefrontOpt.value = p.id;
    storefrontOpt.textContent = p.name;
    if(storefrontSelect) storefrontSelect.appendChild(storefrontOpt);
  });
  approvedStores = owned.filter(p => (p.status || "").toLowerCase() === "approved");
  approvedStores.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    if(select) select.appendChild(opt);
    if(salesSelect){
      const opt3 = document.createElement("option");
      opt3.value = p.id;
      opt3.textContent = p.name;
      salesSelect.appendChild(opt3);
    }
    if(ordersSelect){
      const opt4 = document.createElement("option");
      opt4.value = p.id;
      opt4.textContent = p.name;
      ordersSelect.appendChild(opt4);
    }
  });
  const storefrontCard = document.getElementById("storefrontCard");
  if (storefrontCard) storefrontCard.style.display = "block";
  const salesCard = document.getElementById("salesCard");
  if (salesCard) salesCard.style.display = approvedStores.length ? "block" : "none";
  const ordersCard = document.getElementById("sellerOrdersCard");
  if (ordersCard) ordersCard.style.display = approvedStores.length ? "block" : "none";
  listingApprovalOk = approvedStores.length > 0;
  applyStorePermissions();
  if (approvedStores[0]) {
    await loadStorefront(approvedStores[0].id);
    await loadMyListings();
    if(salesSelect) await loadSales(approvedStores[0].id);
    if(ordersSelect) await loadSellerOrders(approvedStores[0].id);
  }
  if (owned[0]) {
    inboxSelect.value = owned[0].id;
    await loadStoreInbox(owned[0].id);
    await loadPrizeClaims(owned[0].id);
  }
}

async function loadStorefront(placeId) {
  const place = await api(`/places/${placeId}`);
  document.getElementById("storefrontName").value = place.name || "";
  document.getElementById("storefrontCategory").value = place.category || "";
  document.getElementById("storefrontDescription").value = place.description || "";
  document.getElementById("storefrontBannerUrl").value = place.bannerUrl || "";
  document.getElementById("storefrontAvatarUrl").value = place.avatarUrl || "";
  document.getElementById("storefrontVisibility").value = place.visibilityLevel || "town_only";
  document.getElementById("storefrontPickup").value = place.pickupZone || "";
  document.getElementById("storefrontMeetup").value = place.meetupInstructions || "";
  document.getElementById("storefrontHours").value = place.hours || "";
}

async function loadMyListings() {
  const list = document.getElementById("myListingsList");
  if (!list) return;

  const storeId = document.getElementById("storefrontStore")?.value;
  if (!storeId) {
    list.innerHTML = '<p class="muted">Select a store to see listings.</p>';
    return;
  }

  try {
    const listings = await api(`/places/${storeId}/listings?all=true`);
    if (!listings || !listings.length) {
      list.innerHTML = '<p class="muted">No listings yet.</p>';
      return;
    }

    list.innerHTML = listings.map(l => `
      <div class="listing-item" data-id="${l.id}">
        <div class="listing-info">
          <strong>${l.title || 'Untitled'}</strong>
          <p class="muted">$${((l.priceCents || l.price*100 || 0) / 100).toFixed(2)} • Qty: ${l.quantity || 0} • ${l.status || 'active'}</p>
        </div>
        <div class="listing-actions">
          <button class="btn-sm edit-btn" data-id="${l.id}">Edit</button>
          <button class="btn-sm btn-danger delete-btn" data-id="${l.id}">Delete</button>
        </div>
      </div>
    `).join('');

    // Add event listeners
    list.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', () => editListing(btn.dataset.id));
    });
    list.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', () => deleteListing(btn.dataset.id));
    });
  } catch (e) {
    list.innerHTML = `<p class="error">Error: ${e.message}</p>`;
  }
}

async function editListing(id) {
  try {
    const listings = await api(`/places/${document.getElementById("storefrontStore")?.value}/listings?all=true`);
    const listing = listings.find(l => l.id == id);
    if (!listing) return alert("Listing not found");

    const newTitle = prompt("Title:", listing.title || "");
    if (newTitle === null) return;

    const newDesc = prompt("Description:", listing.description || "");
    if (newDesc === null) return;

    const newPrice = prompt("Price (dollars):", ((listing.priceCents || 0) / 100).toFixed(2));
    if (newPrice === null) return;

    const newQty = prompt("Quantity:", listing.quantity || 1);
    if (newQty === null) return;

    const updates = {
      title: newTitle,
      description: newDesc,
      priceCents: Math.round(parseFloat(newPrice) * 100),
      quantity: parseInt(newQty)
    };

    await api(`/listings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates)
    });
    loadMyListings();
    alert("Listing updated!");
  } catch (e) {
    alert("Error: " + e.message);
  }
}

async function deleteListing(id) {
  if (!confirm("Delete this listing?")) return;
  try {
    await api(`/listings/${id}`, { method: "DELETE" });
    loadMyListings();
  } catch (e) { alert("Error: " + e.message); }
}

window.editListing = editListing;
window.deleteListing = deleteListing;

async function saveStorefront() {
  try {
    const storeId = document.getElementById("storefrontStore").value;
    if (!storeId) return setMsg("storefrontMsg", "Select a store.");
    const payload = {
      name: document.getElementById("storefrontName").value.trim(),
      category: document.getElementById("storefrontCategory").value.trim(),
      description: document.getElementById("storefrontDescription").value.trim(),
      bannerUrl: document.getElementById("storefrontBannerUrl").value.trim(),
      avatarUrl: document.getElementById("storefrontAvatarUrl").value.trim(),
      visibilityLevel: document.getElementById("storefrontVisibility").value,
      pickupZone: document.getElementById("storefrontPickup").value.trim(),
      meetupInstructions: document.getElementById("storefrontMeetup").value.trim(),
      hours: document.getElementById("storefrontHours").value.trim()
    };
    const updated = await api(`/places/${storeId}/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    document.getElementById("storefrontBannerUrl").value = updated.bannerUrl || updated.bannerurl || "";
    document.getElementById("storefrontAvatarUrl").value = updated.avatarUrl || updated.avatarurl || "";
    setMsg("storefrontMsg", "Storefront saved.");
  } catch (e) {
    setMsg("storefrontMsg", `ERROR: ${e.message}`);
  }
}

async function uploadStoreImage(fileInputId, targetInputId, msgId) {
  const fileInput = document.getElementById(fileInputId);
  const target = document.getElementById(targetInputId);
  if(!fileInput?.files?.length) return setMsg(msgId, "Select an image first.");
  const file = fileInput.files[0];
  const form = new FormData();
  form.append("file", file);
  const placeId = document.getElementById("storefrontStore").value || null;
  const kind = (targetInputId === "storefrontBannerUrl") ? "store_banner" : "store_avatar";
  form.append("kind", kind);
  if(placeId) form.append("placeId", placeId);
  try{
    const res = await api("/api/uploads", {
      method: "POST",
      body: form
    });
    target.value = res.url;
    await saveStorefront();
    setMsg(msgId, "Uploaded and saved.");
  }catch(e){
    setMsg(msgId, `ERROR: ${e.message}`);
  }
}

function getUploadUrl(payload) {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return "";
  return payload.url || payload.avatarUrl || payload.publicUrl || "";
}

function syncListingPhotoField() {
  const field = document.getElementById("listingPhotoUrls");
  if (field) field.value = JSON.stringify(listingPhotos);
}

function renderListingPhotos() {
  const preview = document.getElementById("listingPhotoPreview");
  if (!preview) return;
  preview.innerHTML = "";
  listingPhotos.forEach((url) => {
    const img = document.createElement("img");
    img.src = `${url}?v=${Date.now()}`;
    img.alt = "Listing photo";
    preview.appendChild(img);
  });
}

async function uploadListingPhoto() {
  const input = document.getElementById("listingPhotoInput");
  if (!input?.files?.length) return;
  const file = input.files[0];
  if (!file.type.startsWith("image/")) {
    setMsg("listingMsg", "Images only.");
    input.value = "";
    return;
  }
  try {
    const placeId = document.getElementById("listingStore")?.value || document.getElementById("storefrontStore")?.value || null;
    const form = new FormData();
    form.append("file", file);
    form.append("kind", "listing_photo");
    if (placeId) form.append("placeId", placeId);
    const res = await api("/api/uploads", {
      method: "POST",
      body: form
    });
    const url = getUploadUrl(res);
    if (!url) throw new Error("Upload did not return a URL");
    listingPhotos.push(url);
    syncListingPhotoField();
    renderListingPhotos();
  } catch (e) {
    setMsg("listingMsg", `ERROR: ${e.message}`);
  } finally {
    input.value = "";
  }
}

async function createListing() {
  try {
    const placeId = document.getElementById("listingStore")?.value || document.getElementById("storefrontStore")?.value;
    if (!placeId) return setMsg("listingMsg", "Select a store first.");
    if (document.getElementById("listingType").value === "auction") {
      return setMsg("listingMsg", "Use Publish Auction for auction listings.");
    }
    const payload = {
      listingType: document.getElementById("listingType").value,
      title: document.getElementById("listingTitle").value.trim(),
      description: document.getElementById("listingDesc").value.trim(),
      quantity: Number(document.getElementById("listingQty").value || 1),
      price: Number(document.getElementById("listingPrice").value || 0),
      photoUrls: listingPhotos
    };
    const created = await api(`/places/${placeId}/listings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setMsg("listingMsg", `Created listing #${created.id}`);
    listingPhotos = [];
    syncListingPhotoField();
    renderListingPhotos();
  } catch (e) {
    setMsg("listingMsg", `ERROR: ${e.message}`);
  }
}

function toLocalInputValue(date) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
function formatLocalDate(date) {
  try { return new Date(date).toLocaleString(); } catch { return ""; }
}
function updateAuctionEndDisplay() {
  const startVal = document.getElementById("auctionStartLocal").value;
  const durationVal = Number(document.getElementById("auctionDuration").value || 0);
  const display = document.getElementById("auctionEndDisplay");
  if (!startVal || !durationVal) return display.textContent = "—";
  const start = new Date(startVal);
  const end = new Date(start.getTime() + durationVal * 60 * 60 * 1000);
  display.textContent = formatLocalDate(end);
}
function setListingTypeUI() {
  const type = document.getElementById("listingType").value;
  const auctionPanel = document.getElementById("auctionPanel");
  const createBtn = document.getElementById("createListingBtn");
  if (type === "auction") {
    auctionPanel.style.display = "block";
    createBtn.disabled = true;
    document.getElementById("auctionStartLocal").value = toLocalInputValue(new Date());
    if (!document.getElementById("auctionDuration").value) {
      document.getElementById("auctionDuration").value = "24";
    }
    updateAuctionEndDisplay();
  } else {
    auctionPanel.style.display = "none";
    createBtn.disabled = false;
  }
  applyStorePermissions();
}
function renderAuctionPhotos() {
  const list = document.getElementById("auctionPhotoList");
  list.innerHTML = "";
  auctionPhotos.forEach((url, idx) => {
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.alignItems = "center";
    wrap.style.gap = "6px";
    wrap.style.marginRight = "8px";
    wrap.innerHTML = `
      <img src="${url}" alt="" style="width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid rgba(255,255,255,.12);" />
      <button data-remove="${idx}" style="font-size:12px;">Remove</button>
    `;
    wrap.querySelector("button").onclick = () => {
      auctionPhotos.splice(idx, 1);
      renderAuctionPhotos();
    };
    list.appendChild(wrap);
  });
}
async function handleAuctionPhotoInput() {
  const input = document.getElementById("auctionPhotosInput");
  const files = Array.from(input.files || []);
  if (!files.length) return;
  setMsg("listingMsg", "Uploading photos...");
  let uploadedCount = 0;
  for (const file of files) {
    if (auctionPhotos.length >= 5) {
      setMsg("listingMsg", "Max 5 photos per listing.");
      break;
    }
    if (!file.type.startsWith("image/")) {
      setMsg("listingMsg", "Images only.");
      continue;
    }
    if (file.size > 2 * 1024 * 1024) {
      setMsg("listingMsg", "Image too large (max 2MB).");
      continue;
    }
    try {
      const placeId = document.getElementById("listingStore")?.value || document.getElementById("storefrontStore")?.value || null;
      const form = new FormData();
      form.append("file", file);
      form.append("kind", "listing_photo");
      if(placeId) form.append("placeId", placeId);
      const res = await api("/api/uploads", {
        method: "POST",
        body: form
      });
      if (res.url) {
        auctionPhotos.push(res.url);
        uploadedCount++;
        renderAuctionPhotos();
      } else {
        setMsg("listingMsg", "Upload failed - no URL returned");
      }
    } catch (e) {
      setMsg("listingMsg", `Upload failed: ${e.message}`);
      console.error("Photo upload error:", e);
    }
  }
  input.value = "";
  if (uploadedCount > 0) {
    setMsg("listingMsg", `${uploadedCount} photo(s) uploaded successfully.`);
  }
}
function resetAuctionFields() {
  auctionPhotos = [];
  renderAuctionPhotos();
  document.getElementById("auctionStartLocal").value = toLocalInputValue(new Date());
  document.getElementById("auctionDuration").value = "24";
  document.getElementById("auctionStartBid").value = "1.00";
  document.getElementById("auctionMinIncrement").value = "0.50";
  document.getElementById("auctionEndDisplay").textContent = "—";
}
async function createAuctionListing() {
  try {
    const placeId = document.getElementById("listingStore")?.value || document.getElementById("storefrontStore")?.value;
    if (!placeId) return setMsg("listingMsg", "Select a store first.");
    const title = document.getElementById("listingTitle").value.trim();
    if (!title) return setMsg("listingMsg", "Title required.");
    const startLocal = document.getElementById("auctionStartLocal").value;
    const durationVal = Number(document.getElementById("auctionDuration").value || 0);
    if (!startLocal) return setMsg("listingMsg", "Start time required.");
    if (![24, 48, 72].includes(durationVal)) return setMsg("listingMsg", "Duration required.");
    const startAt = new Date(startLocal);
    const endAt = new Date(startAt.getTime() + durationVal * 60 * 60 * 1000);
    const startBidCents = Math.round(Number(document.getElementById("auctionStartBid").value || 0) * 100);
    const minIncrementCents = Math.round(Number(document.getElementById("auctionMinIncrement").value || 0) * 100);
    if (auctionPhotos.length === 0) {
      setMsg("listingMsg", "Warning: No photos uploaded. Continue anyway?");
      // Allow to proceed, but user has been warned
    }
    const payload = {
      listingType: "auction",
      title,
      description: document.getElementById("listingDesc").value.trim(),
      quantity: Number(document.getElementById("listingQty").value || 1),
      price: Number(document.getElementById("listingPrice").value || 0),
      auctionStartAt: startAt.toISOString(),
      auctionEndAt: endAt.toISOString(),
      startBidCents,
      minIncrementCents,
      photoUrls: auctionPhotos
    };
    setMsg("listingMsg", "Publishing auction...");
    const created = await api(`/places/${placeId}/listings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setMsg("listingMsg", `Auction created (#${created.id}).`);
    const link = document.getElementById("listingLink");
    if (link) {
      link.href = `/store/${placeId}`;
      link.style.display = "inline-flex";
      link.textContent = "View Auction";
    }
    resetAuctionFields();
  } catch (e) {
    setMsg("listingMsg", `ERROR: ${e.message}`);
    console.error("Create auction error:", e);
  }
}

async function loadStoreInbox(placeId){
  storeConversationId = null;
  const list = document.getElementById("storeInboxList");
  const msgs = document.getElementById("storeInboxMessages");
  list.innerHTML = "";
  msgs.innerHTML = "";
  if(!placeId) return;
  const convos = await api(`/places/${placeId}/conversations?viewer=seller`);
  if(!convos.length){
    list.innerHTML = `<div class="muted">No conversations yet.</div>`;
    return;
  }
  convos.forEach((c)=>{
    const div = document.createElement("div");
    div.textContent = `Conversation #${c.id}`;
    div.onclick = () => openStoreConversation(c.id);
    list.appendChild(div);
  });
}

async function loadPrizeClaims(placeId){
  const list = document.getElementById("storePrizeClaims");
  if(!list) return;
  list.innerHTML = "";
  const rows = await api(`/api/prize_awards/my?placeId=${placeId}`);
  if(!rows.length){
    list.innerHTML = `<div class="muted">No prize claims.</div>`;
    return;
  }
  rows.forEach((r)=>{
    const div = document.createElement("div");
    const convoLink = r.convoId ? `/me/profile#dm=${r.convoId}` : "#";
    div.innerHTML = `<div><strong>${r.title}</strong> • ${r.status}</div>
      <div class="muted">Winner ${r.winnerUserId} • Due ${r.dueBy || "—"}</div>
      <div><a class="pill" href="${convoLink}">Open Conversation</a></div>`;
    list.appendChild(div);
  });
}
async function openStoreConversation(id){
  storeConversationId = id;
  const msgs = await api(`/conversations/${id}/messages`);
  const list = document.getElementById("storeInboxMessages");
  list.innerHTML = "";
  msgs.forEach((m)=>{
    const div = document.createElement("div");
    div.textContent = `${m.sender}: ${m.text}`;
    list.appendChild(div);
  });
}
async function sendStoreMessage(){
  if(!storeConversationId) return setMsg("storeInboxMsg", "Select a conversation.");
  const text = document.getElementById("storeInboxInput").value.trim();
  if(!text) return;
  await api(`/conversations/${storeConversationId}/messages`, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ sender:"seller", text })
  });
  document.getElementById("storeInboxInput").value = "";
  await openStoreConversation(storeConversationId);
}

// CSP-compliant event listener setup
function setupEventListeners() {
  document.getElementById("createListingBtn")?.addEventListener("click", createListing);
  document.getElementById("auctionPublishBtn")?.addEventListener("click", createAuctionListing);
  document.getElementById("createStoreBtn")?.addEventListener("click", createStore);
  document.getElementById("saveStorefrontBtn")?.addEventListener("click", saveStorefront);
  document.getElementById("listingType")?.addEventListener("change", setListingTypeUI);
  document.getElementById("auctionPhotosInput")?.addEventListener("change", handleAuctionPhotoInput);
  document.getElementById("auctionStartLocal")?.addEventListener("change", updateAuctionEndDisplay);
  document.getElementById("auctionDuration")?.addEventListener("change", updateAuctionEndDisplay);
  document.getElementById("storefrontStore")?.addEventListener("change", (e) => { loadStorefront(e.target.value); loadMyListings(); });

  const salesStoreEl = document.getElementById("salesStore");
  if(salesStoreEl) salesStoreEl.addEventListener("change", (e) => loadSales(e.target.value));

  const salesTodayBtn = document.getElementById("salesRangeToday");
  if(salesTodayBtn) salesTodayBtn.addEventListener("click", async () => { salesRange="today"; await loadSales(document.getElementById("salesStore").value); });

  const sales7dBtn = document.getElementById("salesRange7d");
  if(sales7dBtn) sales7dBtn.addEventListener("click", async () => { salesRange="7d"; await loadSales(document.getElementById("salesStore").value); });

  const sales30dBtn = document.getElementById("salesRange30d");
  if(sales30dBtn) sales30dBtn.addEventListener("click", async () => { salesRange="30d"; await loadSales(document.getElementById("salesStore").value); });

  const ordersStoreEl = document.getElementById("sellerOrdersStore");
  if(ordersStoreEl) ordersStoreEl.addEventListener("change", (e) => loadSellerOrders(e.target.value));

  document.getElementById("storeInboxStore")?.addEventListener("change", async (e) => {
    await loadStoreInbox(e.target.value);
    await loadPrizeClaims(e.target.value);
  });

  document.getElementById("storeInboxSendBtn")?.addEventListener("click", sendStoreMessage);
  document.getElementById("uploadBannerBtn")?.addEventListener("click", () => uploadStoreImage("storefrontBannerFile", "storefrontBannerUrl", "storefrontMsg"));
  document.getElementById("uploadAvatarBtn")?.addEventListener("click", () => uploadStoreImage("storefrontAvatarFile", "storefrontAvatarUrl", "storefrontMsg"));
  document.getElementById("listingPhotoUploadBtn")?.addEventListener("click", () => document.getElementById("listingPhotoInput")?.click());
  document.getElementById("listingPhotoInput")?.addEventListener("change", uploadListingPhoto);
}

setupEventListeners();
syncListingPhotoField();

// Subscription status for store owners
async function loadSubscriptionStatus() {
  const card = document.getElementById("subscriptionCard");
  const badge = document.getElementById("subscriptionBadge");
  const message = document.getElementById("subscriptionMessage");
  const icon = document.getElementById("subscriptionIcon");
  const btn = document.getElementById("subscriptionBtn");

  if (!card || !approvedStores.length) {
    if (card) card.style.display = "none";
    return;
  }

  // Show card for store owners
  card.style.display = "block";

  // Use first approved store for subscription check
  const placeId = approvedStores[0].id;
  btn.href = `/business-subscription?placeId=${placeId}`;

  try {
    const result = await api(`/api/business/subscription/${placeId}`);
    const sub = result.subscription;
    const isActive = result.isActive;

    // Remove all status classes
    badge.classList.remove("active", "trial", "expired", "none");

    if (!sub) {
      // No subscription
      badge.classList.add("none");
      badge.textContent = "No Subscription";
      icon.textContent = "📋";
      message.textContent = "Get your store listed on Digital Sebastian";
      btn.textContent = "Start Free Trial";
      btn.classList.add("secondary");
      return;
    }

    btn.classList.remove("secondary");
    const plan = sub.plan || "free_trial";

    if (isActive && plan === "free_trial") {
      // Trial active
      const trialEnd = new Date(sub.trialEndsAt);
      const now = new Date();
      const daysLeft = Math.max(0, Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24)));
      badge.classList.add("trial");
      badge.textContent = "Free Trial";
      icon.textContent = "🎯";
      message.textContent = `${daysLeft} days remaining in your trial`;
      btn.textContent = "Manage Subscription";
    } else if (isActive) {
      // Paid/active subscription
      badge.classList.add("active");
      badge.textContent = "Active";
      icon.textContent = "✅";
      message.textContent = "Your subscription is active";
      btn.textContent = "Manage Subscription";
    } else {
      // Expired
      badge.classList.add("expired");
      badge.textContent = "Expired";
      icon.textContent = "⚠️";
      message.textContent = "Your subscription has expired - features are limited";
      btn.textContent = "Reactivate Subscription";
    }
  } catch (e) {
    // No subscription found
    badge.classList.remove("active", "trial", "expired", "none");
    badge.classList.add("none");
    badge.textContent = "No Subscription";
    icon.textContent = "📋";
    message.textContent = "Get your store listed on Digital Sebastian";
    btn.textContent = "Start Free Trial";
    btn.classList.add("secondary");
  }
}

// Wrap loadOwnedStores to also load subscription status
const originalLoadOwnedStores = loadOwnedStores;
loadOwnedStores = async function() {
  await originalLoadOwnedStores();
  await loadSubscriptionStatus();
};

loadTownContext().then(() => loadMe().then(loadOwnedStores)).catch(() => {});
