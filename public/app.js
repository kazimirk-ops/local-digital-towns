const $ = (id) => document.getElementById(id);

let state = {
  districtId: null,
  placeId: null,
  placeName: null,
  conversationId: null,
  viewer: "buyer",
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
  debug(`Viewer set to: ${viewer}`);
}

async function loadStatus() {
  const s = await api("/health");
  $("apiStatus").textContent = `API: ${s.status}`;
}

// Town metrics
async function loadTownMetrics() {
  const m = await api("/metrics/town");

  $("mPlaces").textContent = m.placesCount;
  $("mTotalListings").textContent = m.totalListings;
  $("mActiveListings").textContent = m.activeListings;
  $("mSoldListings").textContent = m.soldListings;
  $("mConversations").textContent = m.conversationsCount;
  $("mMessages").textContent = m.messagesCount;

  $("healthIndex").textContent = m.healthIndex;
  $("healthIndexInline").textContent = m.healthIndex;
  $("metricsTime").textContent = `Updated: ${m.updatedAt}`;

  const pct = Math.max(0, Math.min(100, Number(m.healthIndex)));
  $("healthBar").style.width = `${pct}%`;
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

  $("rightHint").textContent = `District ${districtId} selected. Pick a place.`;

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
          ${l.status === "active" ? `<button data-sold="${l.id}">Mark Sold</button>` : `<span class="pill">SOLD</span>`}
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
    if (!state.placeId) {
      debug("ERROR: Select a place first.");
      alert("Select a place first (click a Place).");
      return;
    }
    const title = $("newTitle").value.trim();
    const description = $("newDesc").value.trim();
    const quantity = Number($("newQty").value);
    const price = Number($("newPrice").value);

    if (!title) {
      debug("ERROR: Title is required.");
      alert("Title is required.");
      return;
    }

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
  try {
    await api(`/listings/${listingId}/sold`, { method: "PATCH" });
    debug(`Listing ${listingId} marked SOLD.`);
    if (state.placeId) await loadListings(state.placeId);
    await loadTownMetrics();
  } catch (e) {
    debug(`ERROR: ${e.message}`);
    alert(e.message);
  }
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
  try {
    if (!state.conversationId) return;
    await api(`/conversations/${state.conversationId}/read?viewer=${state.viewer}`, { method: "PATCH" });
    debug(`Marked read for ${state.viewer}.`);
    if (state.placeId) await loadPlaceConversations(state.placeId);
    await loadTownMetrics();
  } catch (e) {
    debug(`ERROR: ${e.message}`);
    alert(e.message);
  }
}

// ------- Leaflet map setup -------
function initMap() {
  // Center on Sebastian, FL (approx)
  const sebastian = [27.816, -80.470];
  map = L.map("map", { zoomControl: true }).setView(sebastian, 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);

  // Approx boundary polygon (starter, not legal)
  // You will replace this later with a real city-limit GeoJSON.
    // Approx boundary polygon (starter, "locals consider Sebastian")
  // Based loosely on ZIP 32958 center and area, expanded to feel local. :contentReference[oaicite:1]{index=1}
    // Approx boundary polygon (starter, "locals consider Sebastian")
  // Natural-ish shape: lagoon/riverfront corridor + broader Sebastian area.
  // NOT legal city limits (placeholder for later official GeoJSON).
  const approxBoundary = [
    [27.872, -80.555], // NW
    [27.872, -80.505], // north-west interior
    [27.865, -80.472], // north near US-1
    [27.860, -80.445], // north-east (near barrier direction)
    [27.845, -80.430], // NE
    [27.828, -80.425], // east edge
    [27.812, -80.430], // southeast turn
    [27.795, -80.440], // SE
    [27.780, -80.450], // south-east interior
    [27.770, -80.470], // south near lagoon bend
    [27.765, -80.500], // south-west interior
    [27.770, -80.525], // SW
    [27.785, -80.545], // west return
    [27.810, -80.555], // west mid
    [27.840, -80.560], // west-north
    [27.860, -80.560], // back toward NW
  ];

  boundaryLayer = L.polygon(approxBoundary, {
    color: "#00ffae",
    weight: 3,
    opacity: 0.85,
    fillColor: "#00ffae",
    fillOpacity: 0.08,
  }).addTo(map);

  boundaryLayer.bindPopup("Sebastian Starter Boundary (approx)");

  // Zoom to boundary
  map.fitBounds(boundaryLayer.getBounds(), { padding: [20, 20] });

  // Add a label marker at center
  const center = boundaryLayer.getBounds().getCenter();
  L.marker([center.lat, center.lng]).addTo(map).bindPopup("Sebastian, FL (approx boundary center)");
}

function setPlaceMarkers(places) {
  if (!markersLayer) return;
  markersLayer.clearLayers();

  // For now, scatter around polygon center (placeholder)
  const center = boundaryLayer ? boundaryLayer.getBounds().getCenter() : { lat: 27.816, lng: -80.470 };

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
      debug(`Entering district ${did}…`);
      await loadPlacesForDistrict(did);
    };
  });
}

async function main() {
  setViewer("buyer");

  $("viewerBuyer").onclick = async () => { setViewer("buyer"); if (state.placeId) await loadPlaceConversations(state.placeId); };
  $("viewerSeller").onclick = async () => { setViewer("seller"); if (state.placeId) await loadPlaceConversations(state.placeId); };

  $("createListingBtn").onclick = createListing;
  $("sendMsg").onclick = sendMessage;
  $("markReadBtn").onclick = markRead;

  await loadStatus();
  await loadTownMetrics();

  initMap();
  bindDistrictButtons();

  debug("Approx boundary drawn. We'll enforce signup by address for now.");
}

main().catch((e) => debug(`BOOT ERROR: ${e.message}`));

