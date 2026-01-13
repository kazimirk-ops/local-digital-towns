const $ = (id) => document.getElementById(id);

let state = {
  districtId: null,
  placeId: null,
  placeName: null,
  conversationId: null,
  viewer: "buyer",
};

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

function clearActiveDistrict() {
  ["d-market","d-service","d-retail","d-live","d-civic"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.remove("active");
  });
}

function setActiveDistrictById(did) {
  const map = { 1:"d-market", 2:"d-service", 3:"d-retail", 4:"d-live", 5:"d-civic" };
  clearActiveDistrict();
  const elId = map[did];
  if (elId) document.getElementById(elId).classList.add("active");
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
  $("metricsTime").textContent = `Updated: ${m.updatedAt}`;

  const pct = Math.max(0, Math.min(100, Number(m.healthIndex)));
  $("healthBar").style.width = `${pct}%`;
}

async function loadDistrictBadges() {
  const marketPlaces = await api("/districts/1/places");
  const servicePlaces = await api("/districts/2/places");
  const retailPlaces = await api("/districts/3/places");

  $("badge-market-places").textContent = `Places: ${marketPlaces.length}`;
  $("badge-service-places").textContent = `Places: ${servicePlaces.length}`;
  $("badge-retail-places").textContent = `Places: ${retailPlaces.length}`;

  let listingCount = 0;
  for (const p of marketPlaces) {
    const ls = await api(`/places/${p.id}/listings`);
    listingCount += ls.length;
  }
  $("badge-market-listings").textContent = `Listings: ${listingCount}`;
}

async function loadPlacesForDistrict(districtId) {
  state.districtId = districtId;
  state.placeId = null;
  state.placeName = null;
  state.conversationId = null;

  setActiveDistrictById(districtId);
  $("rightHint").textContent = "Pick a place.";

  const places = await api(`/districts/${districtId}/places`);
  renderList($("places"), places, (p) => {
    const div = mkItem(p.name, `${p.category} • ${p.status} • id=${p.id}`);
    div.onclick = async () => {
      state.placeId = p.id;
      state.placeName = p.name;
      debug(`Place selected: ${p.name} (id=${p.id})`);
      await loadListings(p.id);
      await loadPlaceConversations(p.id);
    };
    return div;
  });

  $("listings").innerHTML = `<div class="muted">Select a place to load listings.</div>`;
  $("conversations").innerHTML = `<div class="muted">Select a place to load conversations.</div>`;
  $("messages").innerHTML = `<div class="muted">Select a conversation.</div>`;
}

async function markSold(listingId) {
  try {
    debug(`Marking listing ${listingId} as SOLD...`);
    await api(`/listings/${listingId}/sold`, { method: "PATCH" });
    debug(`Listing ${listingId} marked SOLD.`);
    if (state.placeId) await loadListings(state.placeId);
    await loadTownMetrics();
  } catch (e) {
    debug(`ERROR: ${e.message}`);
    alert(e.message);
  }
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

  // Wire buttons
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

    debug(`Creating listing for placeId=${state.placeId}…`);
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
    await loadDistrictBadges();
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
      debug(`Conversation selected: ${c.id}`);
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

function bindMapClicks() {
  document.querySelectorAll(".district").forEach((el) => {
    el.onclick = async () => {
      const did = Number(el.getAttribute("data-district"));
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

  bindMapClicks();

  await loadStatus();
  await loadDistrictBadges();
  await loadTownMetrics();

  debug("Click a district → click a place → mark items sold.");
}

main().catch((e) => debug(`BOOT ERROR: ${e.message}`));

