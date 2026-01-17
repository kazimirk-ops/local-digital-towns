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
  const canList = listingApprovalOk && !!perms.listingCreate;
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
  if(!listingApprovalOk){
    setMsg("listingMsg", "Store approval required to create listings.");
  }else if(!perms.listingCreate){
    setMsg("listingMsg", "Tier 3+ required to create listings.");
  }
  const type = document.getElementById("listingType")?.value;
  if(type === "auction" && !canAuction){
    setMsg("listingMsg", "Tier 4+ required to host auctions.");
  }
}

async function createStore() {
  try {
    const payload = {
      sellerType: document.getElementById("storeType").value,
      districtId: Number(document.getElementById("storeDistrict").value || 1),
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
  const districts = [1,2,3,4,5];
  const all = [];
  await Promise.all(districts.map(async (d) => {
    try {
      const places = await api(`/districts/${d}/places`);
      all.push(...places);
    } catch {}
  }));
  const owned = all.filter(p => Number(p.ownerUserId) === Number(currentUserId));
  const list = document.getElementById("ownedStores");
  const select = document.getElementById("listingStore");
  const storefrontSelect = document.getElementById("storefrontStore");
  const inboxSelect = document.getElementById("storeInboxStore");
  const salesSelect = document.getElementById("salesStore");
  const ordersSelect = document.getElementById("sellerOrdersStore");
  list.innerHTML = "";
  select.innerHTML = "";
  storefrontSelect.innerHTML = "";
  inboxSelect.innerHTML = "";
  if(salesSelect) salesSelect.innerHTML = "";
  if(ordersSelect) ordersSelect.innerHTML = "";
  if (!owned.length) {
    list.innerHTML = `<div class="muted">No owned stores yet.</div>`;
    return;
  }
  owned.forEach((p) => {
    const div = document.createElement("div");
    div.textContent = `${p.name} (#${p.id}) • ${p.status || "pending"}`;
    list.appendChild(div);
    const inboxOpt = document.createElement("option");
    inboxOpt.value = p.id;
    inboxOpt.textContent = p.name;
    inboxSelect.appendChild(inboxOpt);
  });
  approvedStores = owned.filter(p => (p.status || "").toLowerCase() === "approved");
  approvedStores.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    select.appendChild(opt);
    const opt2 = document.createElement("option");
    opt2.value = p.id;
    opt2.textContent = p.name;
    storefrontSelect.appendChild(opt2);
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
  if (storefrontCard) storefrontCard.style.display = approvedStores.length ? "block" : "none";
  const salesCard = document.getElementById("salesCard");
  if (salesCard) salesCard.style.display = approvedStores.length ? "block" : "none";
  const ordersCard = document.getElementById("sellerOrdersCard");
  if (ordersCard) ordersCard.style.display = approvedStores.length ? "block" : "none";
  listingApprovalOk = approvedStores.length > 0;
  applyStorePermissions();
  if (approvedStores[0]) {
    await loadStorefront(approvedStores[0].id);
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
    document.getElementById("storefrontBannerUrl").value = updated.bannerUrl || "";
    document.getElementById("storefrontAvatarUrl").value = updated.avatarUrl || "";
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
    const placeId = document.getElementById("listingStore").value || null;
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
    const placeId = document.getElementById("listingStore").value;
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
      const placeId = document.getElementById("listingStore").value || null;
      const form = new FormData();
      form.append("file", file);
      form.append("kind", "listing_photo");
      if(placeId) form.append("placeId", placeId);
      const res = await api("/api/uploads", {
        method: "POST",
        body: form
      });
      auctionPhotos.push(res.url);
      renderAuctionPhotos();
    } catch (e) {
      setMsg("listingMsg", `ERROR: ${e.message}`);
    }
  }
  input.value = "";
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
    const placeId = document.getElementById("listingStore").value;
    if (!placeId) return setMsg("listingMsg", "Select a store first.");
    const startLocal = document.getElementById("auctionStartLocal").value;
    const durationVal = Number(document.getElementById("auctionDuration").value || 0);
    if (!startLocal) return setMsg("listingMsg", "Start time required.");
    if (![24, 48, 72].includes(durationVal)) return setMsg("listingMsg", "Duration required.");
    const startAt = new Date(startLocal);
    const endAt = new Date(startAt.getTime() + durationVal * 60 * 60 * 1000);
    const startBidCents = Math.round(Number(document.getElementById("auctionStartBid").value || 0) * 100);
    const minIncrementCents = Math.round(Number(document.getElementById("auctionMinIncrement").value || 0) * 100);
    const payload = {
      listingType: "auction",
      title: document.getElementById("listingTitle").value.trim(),
      description: document.getElementById("listingDesc").value.trim(),
      quantity: Number(document.getElementById("listingQty").value || 1),
      price: Number(document.getElementById("listingPrice").value || 0),
      auctionStartAt: startAt.toISOString(),
      auctionEndAt: endAt.toISOString(),
      startBidCents,
      minIncrementCents,
      photoUrls: auctionPhotos
    };
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

document.getElementById("createListingBtn").onclick = createListing;
document.getElementById("auctionPublishBtn").onclick = createAuctionListing;
document.getElementById("createStoreBtn").onclick = createStore;
document.getElementById("saveStorefrontBtn").onclick = saveStorefront;
document.getElementById("listingType").onchange = setListingTypeUI;
document.getElementById("auctionPhotosInput").onchange = handleAuctionPhotoInput;
document.getElementById("auctionStartLocal").onchange = updateAuctionEndDisplay;
document.getElementById("auctionDuration").onchange = updateAuctionEndDisplay;
document.getElementById("storefrontStore").onchange = (e) => loadStorefront(e.target.value);
const salesStoreEl = document.getElementById("salesStore");
if(salesStoreEl) salesStoreEl.onchange = (e) => loadSales(e.target.value);
const salesTodayBtn = document.getElementById("salesRangeToday");
if(salesTodayBtn) salesTodayBtn.onclick = async () => { salesRange="today"; await loadSales(document.getElementById("salesStore").value); };
const sales7dBtn = document.getElementById("salesRange7d");
if(sales7dBtn) sales7dBtn.onclick = async () => { salesRange="7d"; await loadSales(document.getElementById("salesStore").value); };
const sales30dBtn = document.getElementById("salesRange30d");
if(sales30dBtn) sales30dBtn.onclick = async () => { salesRange="30d"; await loadSales(document.getElementById("salesStore").value); };
const ordersStoreEl = document.getElementById("sellerOrdersStore");
if(ordersStoreEl) ordersStoreEl.onchange = (e) => loadSellerOrders(e.target.value);
document.getElementById("storeInboxStore").onchange = async (e) => {
  await loadStoreInbox(e.target.value);
  await loadPrizeClaims(e.target.value);
};
document.getElementById("storeInboxSendBtn").onclick = sendStoreMessage;
document.getElementById("uploadBannerBtn").onclick = () => uploadStoreImage("storefrontBannerFile", "storefrontBannerUrl", "storefrontMsg");
document.getElementById("uploadAvatarBtn").onclick = () => uploadStoreImage("storefrontAvatarFile", "storefrontAvatarUrl", "storefrontMsg");
document.getElementById("listingPhotoUploadBtn").onclick = () => document.getElementById("listingPhotoInput").click();
document.getElementById("listingPhotoInput").onchange = uploadListingPhoto;
syncListingPhotoField();

loadTownContext().then(() => loadMe().then(loadOwnedStores)).catch(() => {});
