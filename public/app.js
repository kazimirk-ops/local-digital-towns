const $ = (id) => document.getElementById(id);

let state = {
  districtId: null,
  placeId: null,
  place: null,
  conversationId: null,
  viewer: "buyer",
};

let access = { loggedIn:false, eligible:false, email:null, reason:null };
let map, markersLayer, boundaryLayer;

// Anonymous client session id (persistent)
function getClientSessionId() {
  const key = "mct_session_id";
  let v = localStorage.getItem(key);
  if (!v) {
    v = (crypto?.randomUUID?.() || (Date.now().toString(16) + Math.random().toString(16).slice(2)));
    localStorage.setItem(key, v);
  }
  return v;
}
const clientSessionId = getClientSessionId();

function debug(msg) { $("debug").textContent = msg || ""; }

async function api(path, opts) {
  const res = await fetch(path, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

// ✅ Event logger (fire-and-forget)
async function logEvent(eventType, fields = {}, meta = {}) {
  try {
    await fetch("/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientSessionId,
        eventType,
        townId: 1,
        districtId: fields.districtId ?? null,
        placeId: fields.placeId ?? null,
        listingId: fields.listingId ?? null,
        conversationId: fields.conversationId ?? null,
        meta,
      }),
    });
  } catch {}
}

function setViewer(viewer) {
  state.viewer = viewer;
  $("viewerLabel").textContent = `Viewer: ${viewer}`;
}

function setControlsEnabled() {
  const canWrite = access.loggedIn && access.eligible;

  $("createListingBtn").disabled = !canWrite;
  $("newTitle").disabled = !canWrite;
  $("newDesc").disabled = !canWrite;
  $("newQty").disabled = !canWrite;
  $("newPrice").disabled = !canWrite;

  $("sendMsg").disabled = !access.loggedIn;
  $("msgText").disabled = !access.loggedIn;

  $("savePlaceSettings").disabled = !access.loggedIn;
  ["sellerType","visibilityLevel","pickupZone","addressPublic","meetupInstructions","hours"]
    .forEach((id)=> $(id).disabled = !access.loggedIn);

  if (!access.loggedIn) {
    $("authTitle").textContent = "Not logged in";
    $("authTag").innerHTML = `Go to <a href="/signup" style="color:#cfe3ff;">/signup</a> to log in.`;
  } else if (access.eligible) {
    $("authTitle").textContent = `Logged in: ${access.email}`;
    $("authTag").innerHTML = `<span style="color:#00ffae;">✅ Eligible</span> • ${access.reason || ""}`;
  } else {
    $("authTitle").textContent = `Logged in: ${access.email}`;
    $("authTag").innerHTML = `<span style="color:#ffcc00;">🟡 Waitlist</span> • ${access.reason || ""}`;
  }
}

async function loadMe() {
  const me = await api("/me");
  if (!me.user) { access = { loggedIn:false, eligible:false, email:null, reason:null }; setControlsEnabled(); return; }
  const email = me.user.email;
  const status = me.signup?.status || "waitlist";
  const reason = me.signup?.reason || "No signup record yet. Submit signup to be evaluated.";
  access = { loggedIn:true, eligible: status==="eligible", email, reason };
  setControlsEnabled();
}

async function logout() { await api("/auth/logout", { method:"POST" }); window.location.href="/signup"; }

async function loadStatus() {
  const s = await api("/health");
  $("apiStatus").textContent = `API: ${s.status}`;
}
async function loadTownMetrics() {
  const m = await api("/metrics/town");
  $("healthIndexInline").textContent = m.healthIndex;
  $("metricsTime").textContent = `Updated: ${m.updatedAt}`;
}

function mkItem(title, subtitle) {
  const div = document.createElement("div");
  div.className = "item";
  div.innerHTML = `<div><strong>${title}</strong></div><div class="muted">${subtitle||""}</div>`;
  return div;
}
function renderList(el, items, renderer) {
  el.innerHTML = "";
  items.forEach((i) => el.appendChild(renderer(i)));
}

async function loadPlacesForDistrict(districtId) {
  state.districtId = districtId;
  state.placeId = null;
  state.place = null;
  state.conversationId = null;

  document.querySelectorAll(".dBtn").forEach((b)=>b.classList.remove("active"));
  const btn = document.querySelector(`.dBtn[data-district="${districtId}"]`);
  if (btn) btn.classList.add("active");

  await logEvent("district_enter", { districtId }, { path: location.pathname });

  const places = await api(`/districts/${districtId}/places`);
  renderList($("places"), places, (p) => {
    const div = mkItem(p.name, `${p.category} • ${p.status} • id=${p.id}`);
    div.onclick = async () => selectPlace(p);
    return div;
  });

  setPlaceMarkers(places);
  $("listings").innerHTML = `<div class="muted">Select a place to load listings.</div>`;
  $("conversations").innerHTML = `<div class="muted">Select a place to load conversations.</div>`;
  $("messages").innerHTML = `<div class="muted">Select a conversation.</div>`;
  clearPlaceSettingsForm();
}

function clearPlaceSettingsForm() {
  $("sellerType").value = "individual";
  $("visibilityLevel").value = "town_only";
  $("pickupZone").value = "";
  $("addressPublic").value = "";
  $("meetupInstructions").value = "";
  $("hours").value = "";
}

function loadPlaceSettingsIntoForm(place) {
  $("sellerType").value = place.sellerType || "individual";
  $("visibilityLevel").value = place.visibilityLevel || "town_only";
  $("pickupZone").value = place.pickupZone || "";
  $("addressPublic").value = place.addressPublic || "";
  $("meetupInstructions").value = place.meetupInstructions || "";
  $("hours").value = place.hours || "";
}

async function selectPlace(p) {
  state.placeId = p.id;
  state.place = p;
  debug(`Place selected: ${p.name} (id=${p.id})`);
  loadPlaceSettingsIntoForm(p);

  await logEvent("place_view", { districtId: p.districtId, placeId: p.id }, { placeName: p.name });

  await loadListings(p.id);
  await loadPlaceConversations(p.id);
}

async function savePlaceSettings() {
  try {
    if (!access.loggedIn) return alert("Login required");
    if (!state.placeId) return alert("Select a place first");

    const payload = {
      sellerType: $("sellerType").value,
      visibilityLevel: $("visibilityLevel").value,
      pickupZone: $("pickupZone").value,
      addressPublic: $("addressPublic").value,
      meetupInstructions: $("meetupInstructions").value,
      hours: $("hours").value,
    };

    const updated = await api(`/places/${state.placeId}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    state.place = updated;
    debug("Place settings saved.");

    await logEvent("place_settings_update", { placeId: state.placeId, districtId: state.districtId }, payload);

    if (state.districtId) await loadPlacesForDistrict(state.districtId);
  } catch (e) {
    debug(`ERROR: ${e.message}`);
    alert(e.message);
  }
}

async function loadListings(placeId) {
  const listings = await api(`/places/${placeId}/listings`);
  if (!listings.length) { $("listings").innerHTML = `<div class="muted">No listings yet.</div>`; return; }

  $("listings").innerHTML = "";
  for (const l of listings) {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="row" style="justify-content:space-between;">
        <div>
          <div><strong>${l.title}</strong></div>
          <div class="muted">$${l.price} • qty ${l.quantity} • ${l.status} • id=${l.id}</div>
        </div>
        <div>
          ${l.status === "active" && access.eligible ? `<button data-sold="${l.id}">Mark Sold</button>` : `<span class="pill">${l.status.toUpperCase()}</span>`}
        </div>
      </div>
    `;
    $("listings").appendChild(div);
  }
  document.querySelectorAll("button[data-sold]").forEach((btn)=> {
    btn.onclick = () => markSold(btn.getAttribute("data-sold"));
  });
}

async function createListing() {
  if (!access.loggedIn) return alert("Login required");
  if (!access.eligible) return alert("Waitlist users cannot create listings yet.");
  if (!state.placeId) return alert("Select a place first");

  const title = $("newTitle").value.trim();
  const description = $("newDesc").value.trim();
  const quantity = Number($("newQty").value);
  const price = Number($("newPrice").value);
  if (!title) return alert("Title required");

  const created = await api(`/places/${state.placeId}/listings`, {
    method:"POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ title, description, quantity, price }),
  });

  await logEvent("listing_create", { placeId: state.placeId, districtId: state.districtId, listingId: created.id }, { title });

  $("newTitle").value=""; $("newDesc").value="";
  await loadListings(state.placeId);
  await loadTownMetrics();
}

async function markSold(listingId) {
  if (!access.eligible) return alert("Waitlist users cannot mark sold yet.");
  await api(`/listings/${listingId}/sold`, { method:"PATCH" });

  await logEvent("listing_mark_sold", { placeId: state.placeId, districtId: state.districtId, listingId: Number(listingId) }, {});

  await loadListings(state.placeId);
  await loadTownMetrics();
}

async function loadPlaceConversations(placeId) {
  const convos = await api(`/places/${placeId}/conversations?viewer=${state.viewer}`);
  renderList($("conversations"), convos, (c) => {
    const div = mkItem(`Conversation ${c.id}`, `unread=${c.unreadCount}`);
    div.onclick = async () => {
      state.conversationId = c.id;
      await logEvent("conversation_open", { placeId: placeId, conversationId: c.id }, {});
      await loadMessages(c.id);
    };
    return div;
  });
  if (!state.conversationId && convos[0]) state.conversationId = convos[0].id;
  if (state.conversationId) await loadMessages(state.conversationId);
}

async function loadMessages(conversationId) {
  const msgs = await api(`/conversations/${conversationId}/messages`);
  renderList($("messages"), msgs, (m) => mkItem(`${m.sender}: ${m.text}`, `${m.createdAt}`));
}

async function sendMessage() {
  if (!access.loggedIn) return alert("Login required");
  if (!state.conversationId) return;
  const sender = $("sender").value.trim() || "buyer";
  const text = $("msgText").value.trim();
  if (!text) return;

  await api(`/conversations/${state.conversationId}/messages`, {
    method:"POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ sender, text }),
  });

  await logEvent("message_send", { placeId: state.placeId, districtId: state.districtId, conversationId: state.conversationId }, { sender });

  $("msgText").value="";
  if (state.placeId) await loadPlaceConversations(state.placeId);
}

async function markRead() {
  if (!access.loggedIn) return alert("Login required");
  if (!state.conversationId) return;
  await api(`/conversations/${state.conversationId}/read?viewer=${state.viewer}`, { method:"PATCH" });
  await logEvent("mark_read", { placeId: state.placeId, districtId: state.districtId, conversationId: state.conversationId }, { viewer: state.viewer });
  if (state.placeId) await loadPlaceConversations(state.placeId);
}

// Map
function initMap() {
  const center = [27.816, -80.470];
  map = L.map("map").setView(center, 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);

  const approxBoundary = [
    [27.872, -80.555],
    [27.865, -80.472],
    [27.845, -80.430],
    [27.812, -80.430],
    [27.780, -80.450],
    [27.765, -80.500],
    [27.785, -80.545],
    [27.840, -80.560],
  ];
  boundaryLayer = L.polygon(approxBoundary, { color:"#00ffae", weight:3, fillOpacity:0.08 }).addTo(map);
  map.fitBounds(boundaryLayer.getBounds(), { padding: [20,20] });
}

function setPlaceMarkers(places) {
  if (!markersLayer || !boundaryLayer) return;
  markersLayer.clearLayers();
  const c = boundaryLayer.getBounds().getCenter();
  places.forEach((p, idx) => {
    const lat = c.lat + (idx*0.002) - 0.006;
    const lng = c.lng + (idx*0.002) - 0.006;
    const marker = L.circleMarker([lat, lng], { radius:8, color:"#2e93ff", weight:2, fillOpacity:0.85 }).addTo(markersLayer);
    marker.bindPopup(`${p.name}`);
    marker.on("click", ()=> selectPlace(p));
  });
}

function bindDistrictButtons() {
  document.querySelectorAll(".dBtn").forEach((btn)=> {
    btn.onclick = async ()=> {
      const did = Number(btn.getAttribute("data-district"));
      await loadPlacesForDistrict(did);
    };
  });
}

async function main() {
  $("logoutBtn").onclick = logout;
  $("savePlaceSettings").onclick = savePlaceSettings;

  $("viewerBuyer").onclick = () => setViewer("buyer");
  $("viewerSeller").onclick = () => setViewer("seller");
  $("createListingBtn").onclick = createListing;
  $("sendMsg").onclick = sendMessage;
  $("markReadBtn").onclick = markRead;

  await loadStatus();
  await loadTownMetrics();
  await loadMe();

  initMap();
  bindDistrictButtons();

  await logEvent("town_view", { townId: 1 }, { path: location.pathname });

  debug("Shadow analytics running. Check /admin after interactions.");
}

main().catch((e)=> debug(`BOOT ERROR: ${e.message}`));

