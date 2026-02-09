async function api(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

function esc(s){ return (s ?? "").toString().replaceAll("<","&lt;").replaceAll(">","&gt;"); }

function storeRow(store) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>${esc(store.name)} <span style="opacity:.6">(#${store.id})</span></td>
    <td>${esc(store.sellerType || "individual")}</td>
    <td>${store.ownerUserId ?? "-"}</td>
    <td><span class="pill">${esc(store.status || "pending")}</span></td>
    <td>
      <button data-action="approve">Approve</button>
      <button data-action="reject">Reject</button>
    </td>
  `;
  tr.querySelector('[data-action="approve"]').onclick = () => updateStoreStatus(store.id, "approved");
  tr.querySelector('[data-action="reject"]').onclick = () => updateStoreStatus(store.id, "rejected");
  return tr;
}

async function loadStoreApplications() {
  const stores = await api("/api/admin/stores?status=pending");
  const body = document.getElementById("storeRows");
  body.innerHTML = "";
  if (!stores.length) {
    body.innerHTML = `<tr><td colspan="5">(no pending applications)</td></tr>`;
    return;
  }
  stores.forEach((s) => body.appendChild(storeRow(s)));
}

async function updateStoreStatus(id, status) {
  try {
    await api(`/api/admin/stores/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    document.getElementById("storeMsg").textContent = `Updated store #${id} → ${status}`;
    await loadStoreApplications();
  } catch (e) {
    document.getElementById("storeMsg").textContent = `ERROR: ${e.message}`;
  }
}

function eventRow(ev){
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>${esc(ev.title)} <span style="opacity:.6">(#${ev.id})</span></td>
    <td>${esc(ev.startAt)} → ${esc(ev.endAt)}</td>
    <td>${esc(ev.organizerName)}<div class="muted">${esc(ev.organizerEmail)}</div></td>
    <td><span class="pill">${esc(ev.status)}</span></td>
    <td><input data-role="reason" placeholder="Reason (deny)" /></td>
    <td>
      <button data-action="approve">Approve</button>
      <button data-action="deny">Deny</button>
    </td>
  `;
  tr.querySelector('[data-action="approve"]').onclick = () => updateEventStatus(ev.id, "approve");
  tr.querySelector('[data-action="deny"]').onclick = () => {
    const reason = tr.querySelector('[data-role="reason"]').value.trim();
    updateEventStatus(ev.id, "deny", reason);
  };
  return tr;
}

async function loadEventSubmissions(){
  const events = await api("/api/admin/events?status=pending");
  const body = document.getElementById("eventRows");
  body.innerHTML = "";
  if(!events.length){
    body.innerHTML = `<tr><td colspan="6">(no pending events)</td></tr>`;
    return;
  }
  events.forEach((ev)=>body.appendChild(eventRow(ev)));
}

async function updateEventStatus(id, action, reason=""){
  const msg = document.getElementById("eventMsg");
  try{
    if(action === "deny" && !reason) throw new Error("Decision reason required.");
    const url = action === "approve"
      ? `/api/admin/events/${id}/approve`
      : `/api/admin/events/${id}/deny`;
    const opts = { method:"POST", headers:{ "Content-Type":"application/json" } };
    if(action === "deny") opts.body = JSON.stringify({ decisionReason: reason });
    await api(url, opts);
    msg.textContent = `Updated event #${id} → ${action === "approve" ? "approved" : "denied"}`;
    await loadEventSubmissions();
  }catch(e){
    msg.textContent = `ERROR: ${e.message}`;
  }
}

function localBizRow(app){
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>${esc(app.businessName)} <span style="opacity:.6">(#${app.id})</span></td>
    <td>${esc(app.ownerName)}<div class="muted">${esc(app.email)}</div></td>
    <td>${esc(app.category)}</td>
    <td><span class="pill">${esc(app.status)}</span></td>
    <td><input data-role="reason" placeholder="Reason (deny)" /></td>
    <td>
      <button data-action="approve">Approve</button>
      <button data-action="deny">Deny</button>
    </td>
  `;
  tr.querySelector('[data-action="approve"]').onclick = () => updateLocalBizStatus(app.id, "approve");
  tr.querySelector('[data-action="deny"]').onclick = () => {
    const reason = tr.querySelector('[data-role="reason"]').value.trim();
    updateLocalBizStatus(app.id, "deny", reason);
  };
  return tr;
}

async function loadLocalBizApplications(){
  const apps = await api("/api/admin/localbiz?status=pending");
  const body = document.getElementById("localBizRows");
  body.innerHTML = "";
  if(!apps.length){
    body.innerHTML = `<tr><td colspan="6">(no pending applications)</td></tr>`;
    return;
  }
  apps.forEach((app)=>body.appendChild(localBizRow(app)));
}

async function updateLocalBizStatus(id, action, reason=""){
  const msg = document.getElementById("localBizMsg");
  try{
    if(action === "deny" && !reason) throw new Error("Decision reason required.");
    const url = action === "approve"
      ? `/api/admin/localbiz/${id}/approve`
      : `/api/admin/localbiz/${id}/deny`;
    const opts = { method:"POST", headers:{ "Content-Type":"application/json" } };
    if(action === "deny") opts.body = JSON.stringify({ reason });
    await api(url, opts);
    msg.textContent = `Updated application #${id} → ${action === "approve" ? "approved" : "denied"}`;
    await loadLocalBizApplications();
  }catch(e){
    msg.textContent = `ERROR: ${e.message}`;
  }
}

function supportRow(req){
  const tr = document.createElement("tr");
  const date = req.createdAt || req.createdat;
  const formattedDate = date ? new Date(date).toLocaleDateString() : "-";
  tr.innerHTML = `
    <td><span class="pill">${esc(req.type)}</span></td>
    <td>${esc(req.subject)}</td>
    <td>${esc(req.name || "-")}<div class="muted">${esc(req.email || "-")}</div></td>
    <td><span class="pill">${esc(req.status)}</span></td>
    <td>${formattedDate}</td>
    <td>
      <button data-action="view">View</button>
      <button data-action="resolve">Resolve</button>
      <button data-action="close">Close</button>
    </td>
  `;
  tr.querySelector('[data-action="view"]').onclick = () => {
    alert(`Subject: ${req.subject}\n\nDetails:\n${req.details}\n\nPage: ${req.page || "-"}\nDevice: ${req.device || "-"}\nUser Agent: ${req.userAgent || "-"}`);
  };
  tr.querySelector('[data-action="resolve"]').onclick = () => updateSupportStatus(req.id, "resolved");
  tr.querySelector('[data-action="close"]').onclick = () => updateSupportStatus(req.id, "closed");
  return tr;
}

async function loadSupportRequests(){
  try{
    const requests = await api("/api/admin/support");
    const body = document.getElementById("supportRows");
    body.innerHTML = "";
    if(!requests.length){
      body.innerHTML = `<tr><td colspan="6">(no support requests)</td></tr>`;
      return;
    }
    requests.forEach((req) => body.appendChild(supportRow(req)));
  }catch(e){
    document.getElementById("supportMsg").textContent = `ERROR: ${e.message}`;
  }
}

async function updateSupportStatus(id, status){
  const msg = document.getElementById("supportMsg");
  try{
    await api(`/api/admin/support/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    msg.textContent = `Updated request #${id} → ${status}`;
    await loadSupportRequests();
  }catch(e){
    msg.textContent = `ERROR: ${e.message}`;
  }
}

async function loadPrizeOffers(){
  try{
    const rows = await api("/api/admin/prizes?status=pending");
    const body = document.getElementById("prizeRows");
    body.innerHTML = "";
    if(!rows.length){
      body.innerHTML = `<tr><td colspan="5">(no pending prize offers)</td></tr>`;
      return;
    }
    rows.forEach((p)=>{
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${esc(p.title)} <span style="opacity:.6">(#${p.id})</span></td>
        <td>${esc(p.donorDisplayName)}</td>
        <td><span class="pill">${esc(p.status)}</span></td>
        <td><input data-winner="${p.id}" placeholder="winner userId" style="max-width:120px;" /></td>
        <td>
          <button data-approve="${p.id}">Approve</button>
          <button data-reject="${p.id}">Reject</button>
          <button data-award="${p.id}">Award</button>
        </td>
      `;
      body.appendChild(tr);
    });
    body.querySelectorAll("button[data-approve]").forEach(btn=>{
      btn.onclick=async ()=>{
        try{
          await api(`/api/admin/prizes/${btn.dataset.approve}/approve`, { method:"POST" });
          await loadPrizeOffers();
        }catch(e){
          document.getElementById("prizeMsg").textContent = `ERROR: ${e.message}`;
        }
      };
    });
    body.querySelectorAll("button[data-reject]").forEach(btn=>{
      btn.onclick=async ()=>{
        const reason = prompt("Reject reason?");
        if(!reason) return;
        try{
          await api(`/api/admin/prizes/${btn.dataset.reject}/reject`, {
            method:"POST",
            headers:{ "Content-Type":"application/json" },
            body: JSON.stringify({ reason })
          });
          await loadPrizeOffers();
        }catch(e){
          document.getElementById("prizeMsg").textContent = `ERROR: ${e.message}`;
        }
      };
    });
    body.querySelectorAll("button[data-award]").forEach(btn=>{
      btn.onclick=async ()=>{
        const input = body.querySelector(`input[data-winner="${btn.dataset.award}"]`);
        const winnerUserId = Number(input?.value || 0);
        if(!winnerUserId) return alert("Enter winner userId");
        try{
          await api(`/api/admin/prizes/${btn.dataset.award}/award`, {
            method:"POST",
            headers:{ "Content-Type":"application/json" },
            body: JSON.stringify({ winnerUserId })
          });
          await loadPrizeOffers();
        }catch(e){
          document.getElementById("prizeMsg").textContent = `ERROR: ${e.message}`;
        }
      };
    });
  }catch(e){
    document.getElementById("prizeMsg").textContent = `ERROR: ${e.message}`;
  }
}

async function loadAdminChannels(){
  try{
    const channels = await api("/api/admin/channels");
    const body = document.getElementById("channelRows");
    body.innerHTML = "";
    if(!channels.length){
      body.innerHTML = `<tr><td colspan="5">(no channels)</td></tr>`;
      return;
    }
    channels.forEach(function(c){
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>#${esc(c.name)}</strong> <span style="opacity:.6">(#${c.id})</span></td>
        <td>${esc(c.description)}</td>
        <td>${c.messageCount || 0}</td>
        <td>${Number(c.isPublic) === 1 ? "Yes" : "No"}</td>
        <td><button data-delete="${c.id}" style="color:#f87171;">Delete</button></td>
      `;
      tr.querySelector("[data-delete]").onclick = function(){ deleteAdminChannel(c.id, c.name); };
      body.appendChild(tr);
    });
  }catch(e){
    document.getElementById("channelMsg").textContent = "ERROR: " + e.message;
  }
}

async function createAdminChannel(){
  const msg = document.getElementById("channelMsg");
  try{
    const name = document.getElementById("newChannelName").value.trim();
    const description = document.getElementById("newChannelDesc").value.trim();
    if(!name){ msg.textContent = "Channel name required."; return; }
    await api("/api/admin/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description })
    });
    document.getElementById("newChannelName").value = "";
    document.getElementById("newChannelDesc").value = "";
    msg.textContent = "Channel created.";
    await loadAdminChannels();
  }catch(e){
    msg.textContent = "ERROR: " + e.message;
  }
}

async function deleteAdminChannel(id, name){
  if(!confirm("Delete channel #" + name + " and all its messages? This cannot be undone.")) return;
  const msg = document.getElementById("channelMsg");
  try{
    await api("/api/admin/channels/" + id, { method: "DELETE" });
    msg.textContent = "Channel deleted.";
    await loadAdminChannels();
  }catch(e){
    msg.textContent = "ERROR: " + e.message;
  }
}

async function loadChannelRequests(){
  try{
    const requests = await api("/api/admin/channel-requests?status=pending");
    const body = document.getElementById("channelRequestRows");
    body.innerHTML = "";
    if(!requests.length){
      body.innerHTML = `<tr><td colspan="5">(no pending requests)</td></tr>`;
      return;
    }
    requests.forEach(function(r){
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${esc(r.name)}</strong></td>
        <td>${esc(r.description || "")}</td>
        <td>User #${r.userId || r.userid}</td>
        <td>${esc(r.reason || "")}</td>
        <td>
          <button data-action="approve">Approve</button>
          <button data-action="deny">Deny</button>
        </td>
      `;
      tr.querySelector('[data-action="approve"]').onclick = function(){ approveChannelRequest(r.id); };
      tr.querySelector('[data-action="deny"]').onclick = function(){ denyChannelRequest(r.id); };
      body.appendChild(tr);
    });
  }catch(e){
    document.getElementById("channelRequestMsg").textContent = "ERROR: " + e.message;
  }
}

async function approveChannelRequest(id){
  const msg = document.getElementById("channelRequestMsg");
  try{
    await api("/api/admin/channel-requests/" + id + "/approve", { method: "POST" });
    msg.textContent = "Request #" + id + " approved — channel created.";
    await loadChannelRequests();
    await loadAdminChannels();
  }catch(e){
    msg.textContent = "ERROR: " + e.message;
  }
}

async function denyChannelRequest(id){
  const msg = document.getElementById("channelRequestMsg");
  try{
    await api("/api/admin/channel-requests/" + id + "/deny", { method: "POST" });
    msg.textContent = "Request #" + id + " denied.";
    await loadChannelRequests();
  }catch(e){
    msg.textContent = "ERROR: " + e.message;
  }
}

async function main() {
  const pulse = await api("/api/admin/pulse?hours=24");
  document.getElementById("pulseMeta").textContent = `Since: ${pulse.since}`;
  document.getElementById("pulseSessions").textContent = `Sessions: ${pulse.sessions}`;

  const countsHtml = pulse.counts.map((r) => `<span style="display:inline-block;margin:4px;padding:6px 10px;border:1px solid rgba(255,255,255,.12);border-radius:999px;background:rgba(255,255,255,.06);font-size:12px;">${esc(r.eventType)}: <strong>${r.c}</strong></span>`).join("");
  document.getElementById("pulseCounts").innerHTML = countsHtml || "(no events yet)";
  const pulseBtn = document.getElementById("pulseGenerateBtn");
  if(pulseBtn){
    pulseBtn.onclick = async ()=>{
      pulseBtn.disabled = true;
      const original = pulseBtn.textContent;
      pulseBtn.textContent = "Generating...";
      try{
        const created = await api("/api/admin/pulse/generate",{
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({})
        });
        document.getElementById("pulseMeta").textContent = `Generated: ${created.dayKey}`;
      }catch(e){
        alert(`Pulse generate failed: ${e.message}`);
      }finally{
        pulseBtn.disabled = false;
        pulseBtn.textContent = original;
      }
    };
  }

  const places = await api("/api/admin/places?hours=24");
  const rows = places.map((p) => `<tr>
    <td>${esc(p.placeName)} <span style="opacity:.6">(#${p.placeId})</span></td>
    <td>${p.views}</td>
    <td>${p.messages}</td>
    <td>${p.listingCreates}</td>
    <td>${p.events}</td>
  </tr>`).join("");
  document.getElementById("placeRows").innerHTML = rows || `<tr><td colspan="5">(no place events yet)</td></tr>`;

  try {
    const events = await api("/api/admin/events?status=approved");
    document.getElementById("recentEvents").textContent = JSON.stringify(events, null, 2);
  } catch(e) { console.warn("admin: load approved events failed:", e.message); }

  const sectionLoaders = [
    loadStoreApplications,
    loadEventSubmissions,
    loadLocalBizApplications,
    loadPrizeOffers,
    loadSupportRequests,
    loadAdminChannels,
    loadChannelRequests,
  ];
  for (const loader of sectionLoaders) {
    try { await loader(); } catch(e) { console.warn("admin: " + loader.name + " failed:", e.message); }
  }

  // Hook up refresh button for support requests
  const refreshSupportBtn = document.getElementById("refreshSupportBtn");
  if(refreshSupportBtn){
    refreshSupportBtn.onclick = loadSupportRequests;
  }
  // Hook up channel management buttons
  const createChannelBtn = document.getElementById("createChannelBtn");
  if(createChannelBtn) createChannelBtn.onclick = createAdminChannel;
  const refreshChannelsBtn = document.getElementById("refreshChannelsBtn");
  if(refreshChannelsBtn) refreshChannelsBtn.onclick = loadAdminChannels;
}

main().catch((e) => {
  document.getElementById("recentEvents").textContent = "ERROR: " + e.message + "\n\n(You must be logged in. Go to /signup, log in, then refresh.)";
});
