async function api(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

let currentUserId = null;
let currentConversationId = null;
let approvedStores = [];
let auctionPhotos = [];

function setMsg(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

async function loadProfile() {
  try {
    const profile = await api("/api/me/profile");
    currentUserId = profile.id;
    document.getElementById("displayName").value = profile.displayName || "";
    document.getElementById("bio").value = profile.bio || "";
    document.getElementById("avatarUrl").value = profile.avatarUrl || "";
    document.getElementById("interests").value = (profile.interests || []).join(", ");
    document.getElementById("ageRange").value = profile.ageRange || "";
    document.getElementById("showAvatar").checked = !!profile.showAvatar;
    document.getElementById("showBio").checked = !!profile.showBio;
    document.getElementById("showInterests").checked = !!profile.showInterests;
    document.getElementById("showAgeRange").checked = !!profile.showAgeRange;
  } catch (e) {
    document.getElementById("hubLoginNote").textContent = "Login required to use the hub.";
  }
}

async function saveProfile() {
  try {
    const payload = {
      displayName: document.getElementById("displayName").value.trim(),
      bio: document.getElementById("bio").value.trim(),
      avatarUrl: document.getElementById("avatarUrl").value.trim(),
      interests: document.getElementById("interests").value.split(",").map(s=>s.trim()).filter(Boolean),
      ageRange: document.getElementById("ageRange").value.trim(),
      showAvatar: document.getElementById("showAvatar").checked,
      showBio: document.getElementById("showBio").checked,
      showInterests: document.getElementById("showInterests").checked,
      showAgeRange: document.getElementById("showAgeRange").checked
    };
    await api("/api/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setMsg("profileMsg", "Saved.");
  } catch (e) {
    setMsg("profileMsg", `ERROR: ${e.message}`);
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
  list.innerHTML = "";
  select.innerHTML = "";
  storefrontSelect.innerHTML = "";
  if (!owned.length) {
    list.innerHTML = `<div class="muted">No owned stores yet.</div>`;
    return;
  }
  owned.forEach((p) => {
    const div = document.createElement("div");
    div.textContent = `${p.name} (#${p.id}) • ${p.status || "pending"}`;
    list.appendChild(div);
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
  });
  const storefrontCard = document.getElementById("storefrontCard");
  if (storefrontCard) storefrontCard.style.display = approvedStores.length ? "block" : "none";
  if (!approvedStores.length) {
    setMsg("listingMsg", "Store approval required to create listings.");
    document.getElementById("createListingBtn").disabled = true;
    const auctionBtn = document.getElementById("auctionPublishBtn");
    if (auctionBtn) auctionBtn.disabled = true;
    select.disabled = true;
  } else {
    document.getElementById("createListingBtn").disabled = false;
    const auctionBtn = document.getElementById("auctionPublishBtn");
    if (auctionBtn) auctionBtn.disabled = false;
    select.disabled = false;
  }
  if (approvedStores[0]) {
    await loadStorefront(approvedStores[0].id);
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
      price: Number(document.getElementById("listingPrice").value || 0)
    };
    const created = await api(`/places/${placeId}/listings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setMsg("listingMsg", `Created listing #${created.id}`);
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
  try {
    return new Date(date).toLocaleString();
  } catch {
    return "";
  }
}

function updateAuctionEndDisplay() {
  const startVal = document.getElementById("auctionStartLocal").value;
  const durationVal = Number(document.getElementById("auctionDuration").value || 0);
  const display = document.getElementById("auctionEndDisplay");
  if (!startVal || !durationVal) {
    display.textContent = "—";
    return;
  }
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
  const msg = document.getElementById(msgId);
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

async function loadDmList() {
  try {
    const convos = await api("/dm");
    const list = document.getElementById("dmList");
    list.innerHTML = "";
    convos.forEach((c) => {
      const div = document.createElement("div");
      const name = c.otherUser ? c.otherUser.displayName : `Conversation ${c.id}`;
      const tier = c.otherUser?.trustTierLabel ? ` • ${c.otherUser.trustTierLabel}` : "";
      div.textContent = `${name}${tier}`;
      div.onclick = () => openConversation(c.id);
      list.appendChild(div);
    });
    const hash = window.location.hash || "";
    if (hash.startsWith("#dm=")) {
      const id = hash.slice(4);
      if (id) openConversation(id);
    }
  } catch (e) {
    setMsg("dmMsg", `ERROR: ${e.message}`);
  }
}

async function openConversation(id) {
  currentConversationId = id;
  const msgs = await api(`/dm/${id}/messages`);
  const list = document.getElementById("dmMessages");
  list.innerHTML = "";
  msgs.forEach((m) => {
    const div = document.createElement("div");
    const name = m.sender?.displayName || `User ${m.senderUserId}`;
    const tier = m.sender?.trustTierLabel ? ` • ${m.sender.trustTierLabel}` : "";
    div.textContent = `${name}${tier}: ${m.text}`;
    list.appendChild(div);
  });
}

async function sendDm() {
  if (!currentConversationId) return setMsg("dmMsg", "Select a conversation.");
  const text = document.getElementById("dmInput").value.trim();
  if (!text) return;
  await api(`/dm/${currentConversationId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });
  document.getElementById("dmInput").value = "";
  await openConversation(currentConversationId);
}

document.getElementById("saveProfileBtn").onclick = saveProfile;
document.getElementById("createListingBtn").onclick = createListing;
document.getElementById("auctionPublishBtn").onclick = createAuctionListing;
document.getElementById("createStoreBtn").onclick = createStore;
document.getElementById("saveStorefrontBtn").onclick = saveStorefront;
document.getElementById("dmSendBtn").onclick = sendDm;
document.getElementById("storefrontStore").onchange = (e) => loadStorefront(e.target.value);
document.getElementById("uploadBannerBtn").onclick = () => uploadStoreImage("storefrontBannerFile", "storefrontBannerUrl", "storefrontMsg");
document.getElementById("uploadAvatarBtn").onclick = () => uploadStoreImage("storefrontAvatarFile", "storefrontAvatarUrl", "storefrontMsg");
document.getElementById("listingType").onchange = setListingTypeUI;
document.getElementById("auctionPhotosInput").onchange = handleAuctionPhotoInput;
document.getElementById("auctionStartLocal").onchange = updateAuctionEndDisplay;
document.getElementById("auctionDuration").onchange = updateAuctionEndDisplay;

loadProfile().then(loadOwnedStores).then(loadDmList).then(() => {
  setListingTypeUI();
  resetAuctionFields();
}).catch(() => {});
