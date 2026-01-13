const $ = (id) => document.getElementById(id);

let state = {
  districtId: null,
  placeId: null,
  conversationId: 1,
  viewer: "buyer",
};

function debug(msg) {
  $("debug").textContent = msg || "";
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}

function renderList(el, items, renderer) {
  el.innerHTML = "";
  items.forEach((item) => el.appendChild(renderer(item)));
}

function mkItem(title, subtitle) {
  const div = document.createElement("div");
  div.className = "item";
  div.innerHTML = `<div><strong>${title}</strong></div><div class="muted">${subtitle || ""}</div>`;
  return div;
}

async function loadStatus() {
  try {
    const s = await api("/health");
    $("apiStatus").textContent = `API: ${s.status}`;
  } catch (e) {
    $("apiStatus").textContent = "API: down";
  }
}

async function loadDistricts() {
  const districts = await api("/districts");
  renderList($("districts"), districts, (d) => {
    const div = mkItem(d.name, `${d.type} • id=${d.id}`);
    div.onclick = async () => {
      state.districtId = d.id;
      $("placesHint").textContent = `District: ${d.name}`;
      await loadPlaces(d.id);
    };
    return div;
  });
}

async function loadPlaces(districtId) {
  const places = await api(`/districts/${districtId}/places`);
  renderList($("places"), places, (p) => {
    const div = mkItem(p.name, `${p.category} • ${p.status} • id=${p.id}`);
    div.onclick = async () => {
      state.placeId = p.id;
      $("placeTitle").textContent = `Place: ${p.name} (id=${p.id})`;
      await loadListings(p.id);
      await loadPlaceConversations(p.id);
    };
    return div;
  });
}

async function loadListings(placeId) {
  const listings = await api(`/places/${placeId}/listings`);
  if (listings.length === 0) {
    $("listings").innerHTML = `<div class="muted">No listings yet.</div>`;
    return;
  }
  renderList($("listings"), listings, (l) => {
    const div = mkItem(l.title, `$${l.price} • qty ${l.quantity} • ${l.status} • id=${l.id}`);
    return div;
  });
}

function setViewer(viewer) {
  state.viewer = viewer;
  $("viewerLabel").textContent = `Viewer is: ${viewer} (affects unreadCount)`;
}

async function loadPlaceConversations(placeId) {
  const convos = await api(`/places/${placeId}/conversations?viewer=${state.viewer}`);
  if (convos.length === 0) {
    $("conversations").innerHTML = `<div class="muted">No conversations yet.</div>`;
    return;
  }
  renderList($("conversations"), convos, (c) => {
    const div = mkItem(
      `Conversation ${c.id}`,
      `placeId=${c.placeId} • unread=${c.unreadCount}`
    );
    div.onclick = async () => {
      state.conversationId = c.id;
      await loadMessages(c.id);
    };
    return div;
  });

  // auto-select first conversation if none selected
  if (!state.conversationId && convos[0]) {
    state.conversationId = convos[0].id;
  }
  if (state.conversationId) await loadMessages(state.conversationId);
}

async function loadMessages(conversationId) {
  const msgs = await api(`/conversations/${conversationId}/messages`);
  if (msgs.length === 0) {
    $("messages").innerHTML = `<div class="muted">No messages.</div>`;
    return;
  }
  renderList($("messages"), msgs, (m) => {
    const rb = Array.isArray(m.readBy) ? m.readBy.join(",") : "";
    const div = mkItem(`${m.sender}: ${m.text}`, `${m.createdAt} • readBy [${rb}]`);
    return div;
  });
}

async function sendMessage() {
  const cid = state.conversationId;
  if (!cid) return debug("Pick a conversation first.");
  const sender = $("sender").value.trim() || "buyer";
  const text = $("msgText").value.trim();
  if (!text) return debug("Type a message first.");

  await api(`/conversations/${cid}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sender, text }),
  });

  $("msgText").value = "";
  debug("");
  if (state.placeId) await loadPlaceConversations(state.placeId);
  await loadMessages(cid);
}

async function markRead() {
  const cid = state.conversationId;
  if (!cid) return debug("Pick a conversation first.");
  await api(`/conversations/${cid}/read?viewer=${state.viewer}`, { method: "PATCH" });
  debug(`Marked conversation ${cid} read as ${state.viewer}`);
  if (state.placeId) await loadPlaceConversations(state.placeId);
  await loadMessages(cid);
}

async function main() {
  setViewer("buyer");
  $("viewerBuyer").onclick = async () => {
    setViewer("buyer");
    if (state.placeId) await loadPlaceConversations(state.placeId);
  };
  $("viewerSeller").onclick = async () => {
    setViewer("seller");
    if (state.placeId) await loadPlaceConversations(state.placeId);
  };
  $("sendMsg").onclick = sendMessage;
  $("markReadBtn").onclick = markRead;

  await loadStatus();
  await loadDistricts();
}

main().catch((e) => debug(e.message));



