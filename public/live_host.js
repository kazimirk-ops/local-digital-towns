const $ = (id) => document.getElementById(id);
let roomId = null;
let userId = null;
let userEmail = "";

async function api(url, opts){
  const res = await fetch(url, opts);
  const text = await res.text();
  let data; try{ data = JSON.parse(text); }catch{ data = text; }
  if(!res.ok) throw new Error(`${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

async function loadMe(){
  const me = await api("/me");
  userId = me.user?.id || null;
  userEmail = me.user?.email || "";
  const ctx = await api("/town/context");
  $("hostTier").textContent = `Tier ${ctx.trustTier || 0}: ${ctx.tierName || "Visitor"}`;
  if((ctx.trustTier || 0) < 4){
    $("createMsg").textContent = "Hosting requires tier 4+.";
    $("createRoomBtn").disabled = true;
  }
}

async function loadStores(){
  if(!userId) return;
  const districts = [1,2,3,4,5];
  const all = [];
  await Promise.all(districts.map(async d=>{
    try{ all.push(...await api(`/districts/${d}/places`)); }catch{}
  }));
  const owned = all.filter(p=>Number(p.ownerUserId)===Number(userId));
  const hostSel = $("hostPlace");
  const pinStore = $("pinStore");
  const schedPlace = $("schedHostPlace");
  hostSel.innerHTML = `<option value="">No store</option>`;
  pinStore.innerHTML = `<option value="">Select store</option>`;
  if(schedPlace) schedPlace.innerHTML = `<option value="">Select store</option>`;
  owned.forEach(p=>{
    const opt = document.createElement("option");
    opt.value = p.id; opt.textContent = p.name;
    hostSel.appendChild(opt);
    const opt2 = document.createElement("option");
    opt2.value = p.id; opt2.textContent = p.name;
    pinStore.appendChild(opt2);
    if(schedPlace){
      const opt3 = document.createElement("option");
      opt3.value = p.id; opt3.textContent = p.name;
      schedPlace.appendChild(opt3);
    }
  });
}

async function loadEvents(){
  const sel = $("hostEvent");
  const sched = $("schedHostEvent");
  if(!sel) return;
  sel.innerHTML = "";
  if(sched) sched.innerHTML = "";
  const now = new Date();
  const from = new Date(now.getTime() - 365*24*60*60*1000).toISOString();
  const to = new Date(now.getTime() + 365*24*60*60*1000).toISOString();
  const events = await api(`/api/events?status=approved&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  events.forEach(ev=>{
    const opt = document.createElement("option");
    opt.value = ev.id;
    opt.textContent = `${ev.title} (${ev.startAt?.slice(0,10) || ""})`;
    sel.appendChild(opt);
    if(sched){
      const opt2 = document.createElement("option");
      opt2.value = ev.id;
      opt2.textContent = opt.textContent;
      sched.appendChild(opt2);
    }
  });
}

function applyHostTypeUI(){
  const type = $("hostType").value;
  $("hostPlaceWrap").style.display = type === "place" ? "block" : "none";
  $("hostEventWrap").style.display = type === "event" ? "block" : "none";
}

function applySchedTypeUI(){
  const type = $("schedHostType").value;
  $("schedPlaceWrap").style.display = type === "place" ? "block" : "none";
  $("schedEventWrap").style.display = type === "event" ? "block" : "none";
}

async function loadListingsForPlace(placeId){
  const list = $("pinListing");
  list.innerHTML = "";
  if(!placeId) return;
  const items = await api(`/places/${placeId}/listings`);
  items.forEach(l=>{
    const opt = document.createElement("option");
    opt.value = l.id;
    opt.textContent = `${l.title} (#${l.id})`;
    list.appendChild(opt);
  });
}

async function createRoom(){
  const hostType = $("hostType").value;
  const payload = {
    title: $("liveTitle").value.trim(),
    description: $("liveDesc").value.trim(),
    hostType,
    hostPlaceId: hostType === "place" ? $("hostPlace").value || null : null,
    hostEventId: hostType === "event" ? $("hostEvent").value || null : null
  };
  const res = await api("/api/live/rooms/create", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(payload)
  });
  roomId = res.roomId;
  $("createMsg").textContent = res.mock ? `Room created (mock mode).` : "Room created.";
  $("openRoomLink").href = res.joinUrl;
  $("openRoomLink").style.display = "inline-flex";
}

async function startRoom(){
  if(!roomId) return alert("Create a room first.");
  await api(`/api/live/rooms/${roomId}/start`, { method:"POST" });
  $("broadcastNote").textContent = "Room is live. SDK publishing is placeholder unless Calls SDK is loaded.";
  await startPreview();
}

async function endRoom(){
  if(!roomId) return alert("Create a room first.");
  await api(`/api/live/rooms/${roomId}/end`, { method:"POST" });
  $("broadcastNote").textContent = "Room ended.";
}

async function startPreview(){
  try{
    const stream = await navigator.mediaDevices.getUserMedia({ video:true, audio:true });
    $("previewVideo").srcObject = stream;
  }catch(e){
    $("broadcastNote").textContent = `Camera error: ${e.message}`;
  }
}

async function pinListing(){
  if(!roomId) return alert("Create a room first.");
  const listingId = Number($("pinListing").value || 0);
  if(!listingId) return alert("Select a listing.");
  await api(`/api/live/rooms/${roomId}/pin`, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ listingId })
  });
  $("pinMsg").textContent = `Pinned listing #${listingId}.`;
}

(async()=>{
  await loadMe();
  await loadStores();
  await loadEvents();
  $("hostType")?.addEventListener("change", applyHostTypeUI);
  applyHostTypeUI();
  $("schedHostType")?.addEventListener("change", applySchedTypeUI);
  applySchedTypeUI();
  $("createRoomBtn")?.addEventListener("click", () => createRoom().catch(e=>console.error(e.message)));
  $("startRoomBtn")?.addEventListener("click", () => startRoom().catch(e=>console.error(e.message)));
  $("endRoomBtn")?.addEventListener("click", () => endRoom().catch(e=>console.error(e.message)));
  $("pinStore")?.addEventListener("change", (e)=> loadListingsForPlace(e.target.value).catch(()=>{}));
  $("pinListingBtn")?.addEventListener("click", () => pinListing().catch(e=>console.error(e.message)));
  $("schedThumbUploadBtn")?.addEventListener("click", () => $("schedThumbInput")?.click());
  $("schedThumbInput")?.addEventListener("change", async ()=>{
    const file = $("schedThumbInput").files?.[0];
    if(!file) return;
    if(!["image/png","image/jpeg","image/webp"].includes(file.type)) {
      $("schedThumbMsg").textContent = "PNG/JPG/WebP images only.";
      return;
    }
    if(file.size > 5 * 1024 * 1024) {
      $("schedThumbMsg").textContent = "Image too large (max 5MB).";
      return;
    }
    const form = new FormData();
    form.append("file", file);
    form.append("kind", "live_thumbnail");
    try {
      const res = await api("/api/uploads", { method:"POST", body: form });
      if (res.url) {
        $("schedThumbMsg").textContent = "Thumbnail uploaded.";
        $("schedThumbMsg").dataset.url = res.url;
      } else {
        $("schedThumbMsg").textContent = "Upload failed - no URL returned.";
      }
    } catch (e) {
      $("schedThumbMsg").textContent = "Upload failed: " + e.message;
      console.error("Thumbnail upload error:", e);
    }
  });
  $("schedCreateBtn").onclick = async ()=>{
    const hostType = $("schedHostType").value;
    const payload = {
      title: $("schedTitle").value.trim(),
      description: $("schedDesc").value.trim(),
      startAt: $("schedStartAt").value,
      hostType,
      hostPlaceId: hostType === "place" ? $("schedHostPlace").value || null : null,
      hostEventId: hostType === "event" ? $("schedHostEvent").value || null : null,
      thumbnailUrl: $("schedThumbMsg").dataset.url || ""
    };
    const created = await api("/api/live/scheduled", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(payload)
    });
    $("schedCreateMsg").textContent = `Scheduled #${created.id}`;
  };
})();
