const $ = (id) => document.getElementById(id);

let state = {
  districtId: null,
  placeId: null,
  placeName: null,
  conversationId: null,
  viewer: "buyer",
};

let access = {
  loggedIn: false,
  eligible: false,
  email: null,
  reason: null,
};

let map;
let markersLayer;
let boundaryLayer;

function debug(msg) {
  $("debug").textContent = msg || "";
  console.log("[DEBUG]", msg);
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

function setViewer(viewer) {
  state.viewer = viewer;
  $("viewerLabel").textContent = `Viewer: ${viewer} (affects unreadCount)`;
}

function setControlsEnabled() {
  const canWrite = access.loggedIn && access.eligible;

  $("createListingBtn").disabled = !canWrite;
  $("newTitle").disabled = !canWrite;
  $("newDesc").disabled = !canWrite;
  $("newQty").disabled = !canWrite;
  $("newPrice").disabled = !canWrite;

  $("sendMsg").disabled = !(access.loggedIn); // allow waitlist to message? choose NO for now:
  $("msgText").disabled = !(access.loggedIn);

  if (!access.loggedIn) {
    $("authTitle").textContent = "Not logged in";
    $("authTag").innerHTML = `Go to <a href="/signup" style="color:#cfe3ff;">/signup</a> to log in.`;
  } else if (access.eligible) {
    $("authTitle").textContent = `Logged in: ${access.email}`;
    $("authTag").innerHTML = `<span class="eligible">✅ Eligible</span> • ${access.reason || "Pilot access granted"}`;
  } else {
    $("authTitle").textContent = `Logged in: ${access.email}`;
    $("authTag").innerHTML = `<span class="waitlist">🟡 Waitlist</span> • ${access.reason || "Limited access"}`;
  }
}

async function loadMe() {
  const me = await api("/me");
  if (!me.user) {
    access = { loggedIn:false, eligible:false, email:null, reason:null };
    setControlsEnabled();
    return;
  }

  const email = me.user.email;
  const status = me.signup?.status || "waitlist";
  const reason = me.signup?.reason || "No signup record yet. Submit signup to be evaluated.";
  const eligible = status === "eligible";

  access = { loggedIn:true, eligible, email, reason };
  setControlsEnabled();
}

async function logout() {
  await api("/auth/logout", { method: "POST" });
  window.location.href = "/signup";
}

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
  div.innerHTML = `<div><strong>${title}</strong></div><div class="muted">${subtitle || ""}</div>`;
  return div;
}

function renderList(el, items, renderer) {
  el.innerHTML = "";
  items.forEach((i) => el.appendChild(renderer(i)));
}

async function loadPlacesForDistrict(districtId) {
  state.districtId = districtId;
  state.placeId = null;
  state.placeName = null;
  state.conversationId = null;

  document.querySelectorAll(".dBtn").forEach((b) => b.classList.remove("active"));
  const btn = document.querySelector(`.dBtn[data-district="${districtId}"]`);
  if (btn) btn.classList.add("active");

  $("places").innerHTML = "";
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
}

async function selectPlace(p) {
  state.placeId = p.id;
  state.placeName = p.name;
  debug(`Place selected: ${p.name} (id=${p.id})`);
  await loadListings(p.id);
  await loadPlaceConversations(p.id);
}

async function loadListings(placeId) {
  const listings = await api(`/places/${placeId}/listings`);
  if (!Array.isArray(listings) || listings.length === 0) {
    $("listings").innerHTML = `<div class="muted">No listings yet.</div>`;
    return;
  }

  $("listings").innerHTML = "";
  for (const l of listings) {
    const div = document.createElement("div");
    div.className = "item";
    const subtitle = `$${l.price} • qty ${l.quantity} • ${l.status} • id=${l.id}`;
    div.innerHTML = `
      <div class="row" style="justify-content:space-between;">
        <div>
          <div><strong>${l.title}</strong></div>
          <div class="muted">${subtitle}</div>
        </div>
        <div>
          ${l.status === "active" && access.eligible ? `<button data-sold="${l.id}">Mark Sold</button>` : `<span class="pill">${l.status.toUpperCase()}</span>`}
        </div>
      </div>
    `;
    $("listings").appendChild(div);
  }

  document.querySelectorAll("button[data-sold]").forEach((btn) => {
    btn.onclick = () => markSold(btn.getAttribute("data-sold"));
  });
}

async function createListing() {
  try {
    if (!access.loggedIn) return alert("Login required.");
    if (!access.eligible) return alert("Waitlist users cannot create listings yet.");

    if (!state.placeId) return alert("Select a place first.");

    const title = $("newTitle").value.trim();
    const description = $("newDesc").value.trim();
    const quantity = Number($("newQty").value);
    const price = Number($("newPrice").value);

    if (!title) return alert("Title is required.");

    const created = await api(`/places/${state.placeId}/listings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description,
        quantity: Number.isFinite(quantity) ? quantity : 1,
        price: Number.isFinite(price) ? price : 0,
      }),
    });

    debug(`Listing created: ${created.title} (id=${created.id}).`);
    $("newTitle").value = "";
    $("newDesc").value = "";

    await loadListings(state.placeId);
    await loadTownMetrics();
  } catch (e) {
    debug(`ERROR: ${e.message}`);
    alert(e.message);
  }
}

async function markSold(listingId) {
  if (!access.eligible) return alert("Waitlist users cannot mark sold yet.");
  await api(`/listings/${listingId}/sold`, { method: "PATCH" });
  debug(`Listing ${listingId} marked SOLD.`);
  if (state.placeId) await loadListings(state.placeId);
  await loadTownMetrics();
}

async function loadPlaceConversations(placeId) {
  const convos = await api(`/places/${placeId}/conversations?viewer=${state.viewer}`);
  if (!Array.isArray(convos) || convos.length === 0) {
    $("conversations").innerHTML = `<div class="muted">No conversations yet.</div>`;
    $("messages").innerHTML = `<div class="muted">No messages.</div>`;
    state.conversationId = null;
    return;
  }

  renderList($("conversations"), convos, (c) => {
    const div = mkItem(`Conversation ${c.id}`, `unread=${c.unreadCount}`);
    div.onclick = async () => {
      state.conversationId = c.id;
      await loadMessages(c.id);
    };
    return div;
  });

  if (!state.conversationId) state.conversationId = convos[0].id;
  await loadMessages(state.conversationId);
}

async function loadMessages(conversationId) {
  const msgs = await api(`/conversations/${conversationId}/messages`);
  if (!Array.isArray(msgs) || msgs.length === 0) {
    $("messages").innerHTML = `<div class="muted">No messages.</div>`;
    return;
  }
  renderList($("messages"), msgs, (m) => {
    const rb = Array.isArray(m.readBy) ? m.readBy.join(",") : "";
    return mkItem(`${m.sender}: ${m.text}`, `${m.createdAt} • readBy [${rb}]`);
  });
}

async function sendMessage() {
  try {
    if (!access.loggedIn) return alert("Login required.");
    if (!state.conversationId) return;

    const sender = $("sender").value.trim() || "buyer";
    const text = $("msgText").value.trim();
    if (!text) return;

    await api(`/conversations/${state.conversationId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sender, text }),
    });

    $("msgText").value = "";
    debug("Message sent.");
    if (state.placeId) await loadPlaceConversations(state.placeId);
    await loadTownMetrics();
  } catch (e) {
    debug(`ERROR: ${e.message}`);
    alert(e.message);
  }
}

async function markRead() {
  if (!access.loggedIn) return alert("Login required.");
  if (!state.conversationId) return;
  await api(`/conversations/${state.conversationId}/read?viewer=${state.viewer}`, { method: "PATCH" });
  if (state.placeId) await loadPlaceConversations(state.placeId);
}

// Leaflet setup (keep your current map logic minimal)
function initMap() {
  const center = [27.816, -80.470];
  map = L.map("map", { zoomControl: true }).setView(center, 13);

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
  boundaryLayer = L.polygon(approxBoundary, {
    color: "#00ffae",
    weight: 3,
    opacity: 0.85,
    fillColor: "#00ffae",
    fillOpacity: 0.08,
  }).addTo(map);
  map.fitBounds(boundaryLayer.getBounds(), { padding: [20, 20] });
}

function setPlaceMarkers(places) {
  if (!markersLayer || !boundaryLayer) return;
  markersLayer.clearLayers();

  const center = boundaryLayer.getBounds().getCenter();
  places.forEach((p, idx) => {
    const lat = center.lat + (idx * 0.002) - 0.006;
    const lng = center.lng + (idx * 0.002) - 0.006;
    const marker = L.circleMarker([lat, lng], {
      radius: 8,
      color: "#2e93ff",
      weight: 2,
      fillColor: "#0f1722",
      fillOpacity: 0.85,
    }).addTo(markersLayer);

    marker.bindPopup(`${p.name} (id=${p.id})`);
    marker.on("click", () => selectPlace(p));
  });
}

function bindDistrictButtons() {
  document.querySelectorAll(".dBtn").forEach((btn) => {
    btn.onclick = async () => {
      const did = Number(btn.getAttribute("data-district"));
      await loadPlacesForDistrict(did);
    };
  });
}

async function main() {
  $("logoutBtn").onclick = logout;

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

  debug("Login status loaded. Waitlist is read-only.");
}

main().catch((e) => debug(`BOOT ERROR: ${e.message}`));

