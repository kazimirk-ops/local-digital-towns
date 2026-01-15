const $ = (id) => document.getElementById(id);

let state = { districtId:null, placeId:null, place:null, conversationId:null, viewer:"buyer" };
let market = { places:[], listingsByPlace:{}, categories:[], districts:[] };
let channels = { list:[], messages:[], selectedId:null, replyToId:null };
let eventsState = { list:[], selectedId:null, range:"week" };
let access = { loggedIn:false, eligible:false, email:null, reason:null };
let map, markersLayer, boundaryLayer;

function applyTheme(cfg){
  if(!cfg) return;
  const root=document.documentElement;
  const colors=cfg.colors||{};
  const fonts=cfg.fonts||{};
  if(colors.bg) root.style.setProperty("--bg", colors.bg);
  if(colors.panel) root.style.setProperty("--panel", colors.panel);
  if(colors.panel2) root.style.setProperty("--panel-2", colors.panel2);
  if(colors.text) root.style.setProperty("--text", colors.text);
  if(colors.muted) root.style.setProperty("--muted", colors.muted);
  if(colors.accent) root.style.setProperty("--accent", colors.accent);
  if(colors.accent2) root.style.setProperty("--accent-2", colors.accent2);
  if(colors.border) root.style.setProperty("--border", colors.border);
  if(colors.card) root.style.setProperty("--card", colors.card);
  if(colors.sidebar) root.style.setProperty("--sidebar", colors.sidebar);
  if(colors.rail) root.style.setProperty("--rail", colors.rail);
  if(fonts.body) root.style.setProperty("--font-sans", `"${fonts.body}", ui-sans-serif, system-ui`);
  if(fonts.display) root.style.setProperty("--font-display", `"${fonts.display}", ui-sans-serif, system-ui`);
  if(cfg.name) document.title = `${cfg.name} Digital Town`;
}
async function loadTheme(){
  const town=(document.body?.dataset?.town||"sebastian").toLowerCase();
  try{
    const res=await fetch(`/themes/${town}.json`);
    if(res.ok){
      const theme=await res.json();
      applyTheme(theme);
    }
  }catch{}
}

async function loadNeighborTowns(){
  try{
    const res=await api("/towns/neighbor");
    const towns=res.towns || [];
    const list1=$("neighborTowns");
    const list2=$("neighborTownsRail");
    const render=(el)=>{
      if(!el) return;
      el.innerHTML=towns.map(t=>`<a class="pill" href="${t.url}" target="_blank" rel="noopener">${t.name}</a>`).join("");
    };
    render(list1);
    render(list2);
  }catch{}
}
function setRouteViewLabel(view){
  const routeEl=$("routeView");
  if(routeEl) routeEl.textContent=`/ui#${view}`;
}
function setView(view){
  const views=document.querySelectorAll(".view");
  views.forEach(v=>{
    v.classList.toggle("active", v.getAttribute("data-view")===view);
  });
  document.querySelectorAll(".navItem").forEach(btn=>{
    btn.classList.toggle("active", btn.getAttribute("data-view")===view);
  });
  setRouteViewLabel(view);
  if(view==="marketplace"){
    initMarketplace().catch(()=>{});
  }
  if(view==="channels"){
    initChannels().catch(()=>{});
  }
  if(view==="events"){
    initEvents().catch(()=>{});
  }
  if(view==="map" && map){
    setTimeout(()=>map.invalidateSize(), 50);
  }
}

async function initChannels(){
  if(!channels.list.length){
    await loadChannels();
    renderChannelsList();
  }
  bindChannels();
}
function getRouteView(){
  const hash=(location.hash||"").replace(/^#/,"");
  return hash || "map";
}
function bindRouter(){
  document.querySelectorAll(".navItem").forEach(btn=>{
    btn.onclick=()=>{
      const view=btn.getAttribute("data-view")||"map";
      location.hash=view;
      setView(view);
    };
  });
  window.addEventListener("hashchange",()=>setView(getRouteView()));
  setView(getRouteView());
}

async function loadChannels(){
  channels.list=await api("/channels");
}
function renderChannelsList(){
  const el=$("channelsList");
  el.innerHTML="";
  if(!channels.list.length){
    el.innerHTML=`<div class="muted">No channels.</div>`;
    return;
  }
  channels.list.forEach(c=>{
    const div=document.createElement("div");
    div.className="item";
    div.innerHTML=`<div><strong>#${c.name}</strong></div><div class="muted">${c.description||""}</div>`;
    div.onclick=()=>selectChannel(c.id);
    el.appendChild(div);
  });
}
async function selectChannel(id){
  channels.selectedId=id;
  channels.replyToId=null;
  $("replyToBar").style.display="none";
  const c=channels.list.find(x=>x.id==id);
  $("channelTitle").textContent=c ? `#${c.name}` : "Channel";
  $("channelMeta").textContent=c?.description || "";
  await loadChannelMessages(id);
}
async function loadChannelMessages(id){
  channels.messages=await api(`/channels/${id}/messages`);
  renderChannelMessages();
}
function renderChannelMessages(){
  const el=$("channelMessages");
  el.innerHTML="";
  if(!channels.messages.length){
    el.innerHTML=`<div class="muted">No messages yet.</div>`;
    return;
  }
  const byId=new Map(channels.messages.map(m=>[m.id,m]));
  channels.messages.forEach(m=>{
    const div=document.createElement("div");
    div.className="item";
    const parent=m.replyToId ? byId.get(m.replyToId) : null;
    const prefix=parent ? `↳ ${parent.text.slice(0,60)}` : "";
    div.innerHTML=`
      <div class="muted">${prefix}</div>
      <div>${m.text}</div>
      <div class="muted">User ${m.userId} · ${m.createdAt}</div>
      <div class="row" style="margin-top:6px;">
        <button data-reply="${m.id}">Reply</button>
      </div>
    `;
    div.querySelector("button[data-reply]").onclick=()=>{
      channels.replyToId=m.id;
      $("replyToText").textContent=`Replying to: ${m.text.slice(0,80)}`;
      $("replyToBar").style.display="block";
    };
    el.appendChild(div);
  });
}
async function sendChannelMessage(){
  if(!channels.selectedId) return alert("Select a channel first");
  if(!access.loggedIn) return alert("Login required");
  const text=$("channelMessageInput").value.trim();
  if(!text) return;
  await api(`/channels/${channels.selectedId}/messages`,{
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ text, replyToId: channels.replyToId })
  });
  $("channelMessageInput").value="";
  channels.replyToId=null;
  $("replyToBar").style.display="none";
  await loadChannelMessages(channels.selectedId);
}
function bindChannels(){
  $("channelSendBtn").onclick=()=>sendChannelMessage().catch(e=>alert(e.message));
  $("clearReplyBtn").onclick=()=>{
    channels.replyToId=null;
    $("replyToBar").style.display="none";
  };
}

async function loadEvents(range){
  eventsState.range = range || "week";
  eventsState.list = await api(`/events?range=${eventsState.range}`);
}
function renderEventsList(){
  const el=$("eventsList");
  el.innerHTML="";
  if(!eventsState.list.length){
    el.innerHTML=`<div class="muted">No upcoming events.</div>`;
    return;
  }
  eventsState.list.forEach(ev=>{
    const div=document.createElement("div");
    div.className="item";
    div.innerHTML=`<div><strong>${ev.title}</strong></div><div class="muted">${ev.startsAt}</div>`;
    div.onclick=()=>selectEvent(ev.id);
    el.appendChild(div);
  });
}
function renderEventsCalendar(){
  const el=$("eventsCalendar");
  el.innerHTML="";
  const days = eventsState.range==="month" ? 30 : 7;
  const now = new Date();
  for(let i=0;i<days;i++){
    const d=new Date(now.getTime()+i*24*60*60*1000);
    const iso=d.toISOString().slice(0,10);
    const count=eventsState.list.filter(ev=>ev.startsAt?.slice(0,10)===iso).length;
    const cell=document.createElement("div");
    cell.className="calendarCell";
    cell.innerHTML=`<strong>${d.getMonth()+1}/${d.getDate()}</strong><div class="muted">${count} events</div>`;
    el.appendChild(cell);
  }
}
function updateEventDetails(ev){
  const title=$("eventDetailTitle");
  const meta=$("eventDetailMeta");
  const showBtn=$("eventShowMapBtn");
  const rsvpBtn=$("eventRsvpBtn");
  if(!ev){
    title.textContent="No event selected";
    meta.textContent="Select an event to see details.";
    showBtn.disabled=true;
    rsvpBtn.disabled=true;
    return;
  }
  title.textContent=ev.title || "Event";
  meta.textContent=`${ev.startsAt || ""}${ev.endsAt ? " → " + ev.endsAt : ""}${ev.locationName ? " • " + ev.locationName : ""}`;
  showBtn.disabled = !ev.placeId;
  rsvpBtn.disabled = false;
  showBtn.onclick=async ()=>{
    if(!ev.placeId) return;
    location.hash="map";
    setView("map");
    try{
      const place=await api(`/places/${ev.placeId}`);
      await loadPlacesForDistrict(place.districtId);
      selectPlace(place);
    }catch(e){ alert(e.message); }
  };
  rsvpBtn.onclick=async ()=>{
    try{
      await api(`/events/${ev.id}/rsvp`,{method:"POST",headers:{ "Content-Type":"application/json" },body:JSON.stringify({status:"going"})});
      alert("RSVP saved.");
    }catch(e){ alert(e.message); }
  };
}
async function selectEvent(id){
  eventsState.selectedId=id;
  const ev=eventsState.list.find(e=>e.id==id);
  updateEventDetails(ev);
}
async function initEvents(){
  await loadEvents(eventsState.range || "week");
  renderEventsList();
  renderEventsCalendar();
}

function getDistrictOptions(){
  const buttons=[...document.querySelectorAll(".dBtn")];
  const list=buttons.map(b=>({
    id:Number(b.getAttribute("data-district")),
    name:b.textContent.trim()
  }));
  return list;
}

async function loadMarketplaceData(){
  const districts=getDistrictOptions();
  market.districts=districts;
  const allPlaces=[];
  for(const d of districts){
    const places=await api(`/districts/${d.id}/places`);
    places.forEach(p=>allPlaces.push({...p, districtName:d.name}));
  }
  market.places=allPlaces;
  market.listingsByPlace={};
  for(const p of allPlaces){
    try{
      const listings=await api(`/places/${p.id}/listings`);
      market.listingsByPlace[p.id]=listings;
    }catch{
      market.listingsByPlace[p.id]=[];
    }
  }
  const cats=new Set();
  allPlaces.forEach(p=>{ if(p.category) cats.add(p.category); });
  market.categories=[...cats].sort();
}

function setMarketplaceFilters(){
  const districtSel=$("marketDistrict");
  const categorySel=$("marketCategory");
  districtSel.innerHTML=`<option value="all">all</option>` + market.districts.map(d=>`<option value="${d.id}">${d.name}</option>`).join("");
  categorySel.innerHTML=`<option value="all">all</option>` + market.categories.map(c=>`<option value="${c}">${c}</option>`).join("");
}

function renderMarketplaceCategories(){
  const wrap=$("marketCategories");
  wrap.innerHTML="";
  market.categories.slice(0,6).forEach(c=>{
    const btn=document.createElement("button");
    btn.className="pill";
    btn.textContent=c;
    btn.onclick=()=>{ $("marketCategory").value=c; renderMarketplace(); };
    wrap.appendChild(btn);
  });
}

function listingTypeSetForPlace(placeId){
  const listings=market.listingsByPlace[placeId] || [];
  const set=new Set(listings.map(l=>l.listingType||"item"));
  return set;
}

function filterPlaces(){
  const q=($("marketSearch").value||"").toLowerCase().trim();
  const district=$("marketDistrict").value;
  const category=$("marketCategory").value;
  const listingType=$("marketListingType").value;
  return market.places.filter(p=>{
    if(q && !(p.name||"").toLowerCase().includes(q)) return false;
    if(district!=="all" && String(p.districtId)!==String(district)) return false;
    if(category!=="all" && String(p.category)!==String(category)) return false;
    if(listingType!=="all"){
      const set=listingTypeSetForPlace(p.id);
      if(!set.has(listingType)) return false;
    }
    return true;
  });
}

function renderStoreCard(p, compact=false){
  const div=document.createElement("div");
  div.className="item";
  const listings=market.listingsByPlace[p.id] || [];
  const types=[...new Set(listings.map(l=>l.listingType||"item"))];
  div.innerHTML=`
    <div><strong>${p.name || "Store"}</strong></div>
    <div class="muted">${p.category || "category"} • ${p.districtName || ""} • id=${p.id}</div>
    <div class="muted">${types.length ? `Listings: ${types.join(", ")}` : "No listings yet"}</div>
    <div class="row" style="margin-top:8px;">
      <a class="btn" href="/store/${p.id}">Open Store</a>
      <button data-open-map="${p.id}">Open on Map</button>
    </div>
  `;
  div.querySelector("button[data-open-map]").onclick=async ()=>{
    location.hash="map";
    setView("map");
    await loadPlacesForDistrict(p.districtId);
    selectPlace(p);
  };
  div.onclick=(e)=>{
    if(e.target.tagName.toLowerCase()==="button" || e.target.tagName.toLowerCase()==="a") return;
    updateContextPanel(p);
  };
  if(compact){
    div.style.padding="8px";
  }
  return div;
}

function renderMarketplace(){
  const featured=$("marketFeatured");
  const grid=$("marketGrid");
  const filtered=filterPlaces();
  featured.innerHTML="";
  grid.innerHTML="";
  filtered.slice(0,3).forEach(p=>featured.appendChild(renderStoreCard(p, true)));
  filtered.forEach(p=>grid.appendChild(renderStoreCard(p)));
}

async function initMarketplace(){
  if(!market.places.length){
    await loadMarketplaceData();
    setMarketplaceFilters();
    renderMarketplaceCategories();
  }
  ["marketSearch","marketDistrict","marketCategory","marketListingType"].forEach(id=>{
    const el=$(id);
    el.oninput=renderMarketplace;
    el.onchange=renderMarketplace;
  });
  renderMarketplace();
}

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

function debug(msg){ $("debug").textContent = msg || ""; }

async function api(path, opts) {
  const res = await fetch(path, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

async function refreshSweep() {
  const s = await api("/sweep/balance");
  $("sweepBal").textContent = s.balance ?? 0;
}

async function logEvent(eventType, fields = {}, meta = {}) {
  const res = await api("/events", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({
      clientSessionId,
      eventType,
      districtId: fields.districtId ?? null,
      placeId: fields.placeId ?? null,
      listingId: fields.listingId ?? null,
      conversationId: fields.conversationId ?? null,
      meta,
    })
  });

  if (res.reward && res.reward.credited) {
    const total = res.reward.credited.reduce((a,x)=>a + (x.amount||0), 0);
    debug(`+${total} SWEEP • ${res.reward.matchEventType}`);
    await refreshSweep();
  }
}

function setViewer(viewer){ state.viewer = viewer; $("viewerLabel").textContent = `Viewer: ${viewer}`; }

function updateContextPanel(place){
  const name=$("contextPlaceName");
  const meta=$("contextPlaceMeta");
  const storeBtn=$("contextStoreBtn");
  if(!place){
    name.textContent="No place selected";
    meta.textContent="Select a place on the map to see details.";
    storeBtn.setAttribute("aria-disabled","true");
    storeBtn.href="#";
    return;
  }
  name.textContent=place.name || `Place ${place.id}`;
  meta.textContent=`${place.category || "place"} • ${place.status || "active"} • id=${place.id}`;
  storeBtn.removeAttribute("aria-disabled");
  storeBtn.href=`/store/${place.id}`;
}

function setControlsEnabled() {
  const canWrite = access.loggedIn && access.eligible;

  $("createListingBtn").disabled = !canWrite;
  ["newTitle","newDesc","newQty","newPrice"].forEach(id => $(id).disabled = !canWrite);

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
    $("authTag").innerHTML = `✅ Eligible • ${access.reason || ""}`;
  } else {
    $("authTitle").textContent = `Logged in: ${access.email}`;
    $("authTag").innerHTML = `🟡 Waitlist • ${access.reason || ""}`;
  }
}

async function loadMe() {
  const me = await api("/me");
  if (!me.user) { access = { loggedIn:false, eligible:false, email:null, reason:null }; setControlsEnabled(); await refreshSweep(); return; }
  const email = me.user.email;
  const status = me.signup?.status || "waitlist";
  const reason = me.signup?.reason || "No signup record yet.";
  access = { loggedIn:true, eligible: status==="eligible", email, reason };
  setControlsEnabled();
  await refreshSweep();
}

async function logout(){ await api("/auth/logout",{method:"POST"}); window.location.href="/signup"; }

async function loadStatus() {
  const s = await api("/health");
  $("apiStatus").textContent = `API: ${s.status}`;
}

function mkItem(title, subtitle){
  const div=document.createElement("div");
  div.className="item";
  div.innerHTML=`<div><strong>${title}</strong></div><div class="muted">${subtitle||""}</div>`;
  return div;
}
function renderList(el, items, renderer){ el.innerHTML=""; items.forEach(i=>el.appendChild(renderer(i))); }

async function loadPlacesForDistrict(districtId){
  state.districtId=districtId;
  state.placeId=null;
  state.place=null;
  state.conversationId=null;
  updateContextPanel(null);

  document.querySelectorAll(".dBtn").forEach(b=>b.classList.remove("active"));
  const btn=document.querySelector(`.dBtn[data-district="${districtId}"]`);
  if(btn) btn.classList.add("active");

  await logEvent("district_enter", { districtId }, {});

  const places=await api(`/districts/${districtId}/places`);
  renderList($("places"), places, (p)=>{
    const div=mkItem(p.name, `${p.category} • ${p.status} • id=${p.id}`);
    div.onclick=()=>selectPlace(p);
    return div;
  });

  setPlaceMarkers(places);
  clearPlaceSettingsForm();
}

function clearPlaceSettingsForm(){
  $("sellerType").value="individual";
  $("visibilityLevel").value="town_only";
  $("pickupZone").value="";
  $("addressPublic").value="";
  $("meetupInstructions").value="";
  $("hours").value="";
}
function loadPlaceSettingsIntoForm(p){
  $("sellerType").value=p.sellerType||"individual";
  $("visibilityLevel").value=p.visibilityLevel||"town_only";
  $("pickupZone").value=p.pickupZone||"";
  $("addressPublic").value=p.addressPublic||"";
  $("meetupInstructions").value=p.meetupInstructions||"";
  $("hours").value=p.hours||"";
}

async function selectPlace(p){
  state.placeId=p.id;
  state.place=p;
  loadPlaceSettingsIntoForm(p);
  updateContextPanel(p);

  await logEvent("place_view", { districtId: p.districtId, placeId: p.id }, { placeName: p.name });

  await loadListings(p.id);
  await loadPlaceConversations(p.id);
}

async function savePlaceSettings(){
  if(!access.loggedIn) return alert("Login required");
  if(!state.placeId) return alert("Select a place first");

  const payload={
    sellerType: $("sellerType").value,
    visibilityLevel: $("visibilityLevel").value,
    pickupZone: $("pickupZone").value,
    addressPublic: $("addressPublic").value,
    meetupInstructions: $("meetupInstructions").value,
    hours: $("hours").value
  };

  await api(`/places/${state.placeId}/settings`,{
    method:"PATCH",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(payload)
  });

  debug("Place settings saved.");
  await logEvent("place_settings_update", { placeId: state.placeId, districtId: state.districtId }, {});
}

async function loadListings(placeId){
  const listings=await api(`/places/${placeId}/listings`);
  if(!listings.length){ $("listings").innerHTML=`<div class="muted">No listings.</div>`; return; }

  $("listings").innerHTML="";
  for(const l of listings){
    const div=document.createElement("div");
    div.className="item";
    div.innerHTML=`
      <div class="row" style="justify-content:space-between;">
        <div>
          <div><strong>${l.title}</strong></div>
          <div class="muted">$${l.price} • qty ${l.quantity} • ${l.status} • id=${l.id}</div>
        </div>
        <div>
          ${l.status==="active" && access.eligible ? `<button data-sold="${l.id}">Mark Sold</button>` : `<span class="pill">${l.status.toUpperCase()}</span>`}
        </div>
      </div>`;
    $("listings").appendChild(div);
  }

  document.querySelectorAll("button[data-sold]").forEach(btn=>{
    btn.onclick=()=>markSold(btn.getAttribute("data-sold"));
  });
}

async function createListing(){
  if(!access.loggedIn) return alert("Login required");
  if(!access.eligible) return alert("Waitlist cannot create listings yet.");
  if(!state.placeId) return alert("Select a place first");

  const title=$("newTitle").value.trim();
  const description=$("newDesc").value.trim();
  const quantity=Number($("newQty").value);
  const price=Number($("newPrice").value);
  if(!title) return alert("Title required");

  const created=await api(`/places/${state.placeId}/listings`,{
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ title, description, quantity, price })
  });

  await logEvent("listing_create", { districtId: state.districtId, placeId: state.placeId, listingId: created.id }, { actorRole: "seller" });
  await refreshSweep();
  $("newTitle").value=""; $("newDesc").value="";
  await loadListings(state.placeId);
}

async function markSold(listingId){
  if(!access.loggedIn) return alert("Login required");
  if(!access.eligible) return alert("Waitlist cannot mark sold yet.");
  // ✅ trusted server event + reward happens inside this endpoint now
  await api(`/listings/${listingId}/sold`,{ method:"PATCH" });
  await refreshSweep();
  await loadListings(state.placeId);
}

async function loadPlaceConversations(placeId){
  const convos=await api(`/places/${placeId}/conversations?viewer=${state.viewer}`);
  renderList($("conversations"), convos, (c)=>{
    const div=mkItem(`Conversation ${c.id}`, `unread=${c.unreadCount}`);
    div.onclick=async ()=>{
      state.conversationId=c.id;
      await logEvent("conversation_open", { placeId: placeId, districtId: state.districtId, conversationId: c.id }, {});
      await loadMessages(c.id);
    };
    return div;
  });
  if(!state.conversationId && convos[0]) state.conversationId=convos[0].id;
  if(state.conversationId) await loadMessages(state.conversationId);
}

async function loadMessages(conversationId){
  const msgs=await api(`/conversations/${conversationId}/messages`);
  renderList($("messages"), msgs, (m)=>mkItem(`${m.sender}: ${m.text}`, `${m.createdAt}`));
}

async function sendMessage(){
  if(!access.loggedIn) return alert("Login required");
  if(!state.conversationId) return;
  const sender=$("sender").value.trim()||"buyer";
  const text=$("msgText").value.trim();
  if(!text) return;

  await api(`/conversations/${state.conversationId}/messages`,{
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ sender, text })
  });

  await logEvent("message_send", { placeId: state.placeId, districtId: state.districtId, conversationId: state.conversationId }, { actorRole: "buyer" });
  await refreshSweep();
  $("msgText").value="";
}

async function markRead(){
  if(!access.loggedIn) return alert("Login required");
  if(!state.conversationId) return;
  await api(`/conversations/${state.conversationId}/read?viewer=${state.viewer}`,{ method:"PATCH" });
  await logEvent("mark_read", { placeId: state.placeId, districtId: state.districtId, conversationId: state.conversationId }, {});
}

function initMap(){
  const accent=getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#00ffae";
  const accent2=getComputedStyle(document.documentElement).getPropertyValue("--accent-2").trim() || "#2e93ff";
  const center=[27.816,-80.470];
  map=L.map("map").setView(center,13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{ maxZoom:19, attribution:"&copy; OpenStreetMap contributors" }).addTo(map);
  markersLayer=L.layerGroup().addTo(map);

  const approxBoundary=[
    [27.872,-80.555],[27.865,-80.472],[27.845,-80.430],[27.812,-80.430],
    [27.780,-80.450],[27.765,-80.500],[27.785,-80.545],[27.840,-80.560]
  ];
  boundaryLayer=L.polygon(approxBoundary,{ color:accent, weight:3, fillOpacity:0.08 }).addTo(map);
  map.fitBounds(boundaryLayer.getBounds(),{ padding:[20,20] });
}

function setPlaceMarkers(places){
  if(!markersLayer||!boundaryLayer) return;
  markersLayer.clearLayers();
  const c=boundaryLayer.getBounds().getCenter();
  places.forEach((p,idx)=>{
    const lat=c.lat+(idx*0.002)-0.006;
    const lng=c.lng+(idx*0.002)-0.006;
    const accent2=getComputedStyle(document.documentElement).getPropertyValue("--accent-2").trim() || "#2e93ff";
    const marker=L.circleMarker([lat,lng],{ radius:8, color:accent2, weight:2, fillOpacity:0.85 }).addTo(markersLayer);
    marker.bindPopup(p.name);
    marker.on("click",()=>selectPlace(p));
  });
}

function bindDistrictButtons(){
  document.querySelectorAll(".dBtn").forEach(btn=>{
    btn.onclick=()=>loadPlacesForDistrict(Number(btn.getAttribute("data-district")));
  });
}

async function main(){
  $("logoutBtn").onclick=logout;
  $("savePlaceSettings").onclick=savePlaceSettings;

  $("viewerBuyer").onclick=()=>setViewer("buyer");
  $("viewerSeller").onclick=()=>setViewer("seller");
  $("createListingBtn").onclick=createListing;
  $("sendMsg").onclick=sendMessage;
  $("markReadBtn").onclick=markRead;
  $("eventsWeekBtn").onclick=async ()=>{
    await loadEvents("week");
    renderEventsList();
    renderEventsCalendar();
  };
  $("eventsMonthBtn").onclick=async ()=>{
    await loadEvents("month");
    renderEventsList();
    renderEventsCalendar();
  };

  await loadTheme();
  bindRouter();
  await loadStatus();
  await loadMe();
  await refreshSweep();

  initMap();
  bindDistrictButtons();

  await logEvent("town_view", {}, {});
  debug("Trusted server events enabled for sweepstake_enter + listing_mark_sold.");
}

main().catch(e=>debug(`BOOT ERROR: ${e.message}`));
