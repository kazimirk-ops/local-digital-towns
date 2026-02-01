const $ = (id) => document.getElementById(id);

let state = { districtId:null, placeId:null, place:null, conversationId:null, viewer:"buyer", trustTier:0, trustTierLabel:"Visitor" };
let market = { listings:[], auctions:[], categories:[], districts:[], selectedCategory:null };
let channels = { list:[], messages:[], selectedId:null, replyToId:null, pendingImageUrl:"" };
let eventsState = { list:[], selectedId:null, range:"week", bound:false };
let localBizState = { list:[], bound:false };
let scheduledState = { list:[], selectedId:null, thumbnailUrl:"" };
let pulseState = { latest:null };
let access = { loggedIn:false, eligible:false, email:null, reason:null, isAdmin:false };
window.access = access;
let currentUser = { id:null, displayName:"" };
let auctionsTabsBound = false;
let map, markersLayer, boundaryLayer;
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

async function loadFeaturedStores(){
  const panel = $("panelFeatured");
  const list = $("featuredStoresList");
  if(!panel || !list) return;
  try{
    const stores = await api("/api/featured-stores");
    if(!stores || !stores.length){
      panel.style.display = "none";
      return;
    }
    panel.style.display = "block";
    list.innerHTML = "";
    // Data is pre-grouped by server: { placeId, placeName, avatarUrl, giveawayCount, offers }
    stores.forEach(function(g){
      const div = document.createElement("div");
      div.className = "item";
      const avatar = g.avatarUrl ? `<img src="${g.avatarUrl}" alt="" style="width:48px;height:48px;border-radius:10px;object-fit:cover;margin-right:12px;" />` : "";
      const count = g.giveawayCount || g.offers?.length || 1;
      const badge = count > 1 ? ` <span class="pill" style="font-size:11px;">${count} giveaways</span>` : "";
      const latest = (g.offers && g.offers[0]) || {};
      const endsAt = latest.endsAt || "";
      const endsStr = endsAt ? new Date(endsAt).toLocaleDateString() : "";
      div.innerHTML = `
        <div style="display:flex;align-items:center;">
          ${avatar}
          <div style="flex:1;">
            <div><strong>${escapeHtml(g.placeName || "Store")}</strong>${badge}</div>
            <div class="muted">${escapeHtml(latest.title || "Active Giveaway")}</div>
            ${endsStr ? `<div class="muted">Ends: ${endsStr}</div>` : ""}
          </div>
          <a class="pill" href="/store/${g.placeId}">Visit Store</a>
        </div>
      `;
      list.appendChild(div);
    });
  }catch(e){
    panel.style.display = "none";
  }
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
  if(view==="auctions"){
    initAuctions().catch(()=>{});
  }
  if(view==="channels"){
    initChannels().catch(()=>{});
  }
  if(view==="events"){
    initEvents().catch(()=>{});
  }
  if(view==="scheduled"){
    initScheduledShows().catch(()=>{});
  }
  if(view==="archive"){
    initArchive().catch(()=>{});
  }
  if(view==="localbiz"){
    initLocalBiz().catch(()=>{});
  }
  if(view==="services"){
    initFeaturedBusinesses().catch(()=>{});
  }
  if(view==="map" && map){
    setTimeout(()=>map.invalidateSize(), 50);
  }
}

function initChannelsPlaceholder(){
  const map = [
    { name: "Sebastian Neighbors & Friends", first: "First post: Welcome neighbors! Introduce yourself and your street." },
    { name: "Sebastian Community Chat", first: "First post: What’s your favorite local spot this week?" },
    { name: "Fun Activities & Events", first: "First post: Share upcoming events and weekend ideas." },
    { name: "Sebastian Lifestyle & Wellness", first: "First post: Morning walks, yoga, and wellness tips here." },
    { name: "Local Meetups & Walking Groups", first: "First post: Who wants to start a sunrise walk group?" },
    { name: "Sebastian Culture & Memories", first: "First post: Post old photos or stories from Sebastian’s past." },
    { name: "County Events & Happenings", first: "First post: County fairs, markets, and regional updates." },
    { name: "Ladies Social Club", first: "First post: Ladies’ night ideas and meetups." },
    { name: "Reflections on the River", first: "First post: Best spots to watch the river at sunset?" }
  ];
  map.forEach((entry, idx)=>{
    const el = $(`channelsCard${idx+1}`);
    if(!el) return;
    el.onclick = () => {
      const match = channels.list.find(c => c.name === entry.name);
      if(match){
        selectChannel(match.id).catch(()=>{});
        return;
      }
      const wrap = $("channelsPlaceholder");
      if(wrap) wrap.style.display = "block";
      $("channelsPlaceholderTitle").textContent = `Welcome to ${entry.name}`;
      $("channelsPlaceholderBody").textContent = "Welcome to " + entry.name + " — posts load here.";
      $("channelsPlaceholderPost").textContent = entry.first;
    };
  });
}

async function initChannels(){
  initChannelsPlaceholder();
  try{
    await loadChannels();
    renderChannelsList();
    const listEl = $("channelsList");
    const stackEl = $("channelsStack");
    if(listEl) listEl.style.display = channels.list.length ? "block" : "none";
    if(stackEl) stackEl.style.display = channels.list.length ? "none" : "block";
  }catch{}
}

async function initScheduledShows(){
  await loadScheduledShows();
  renderScheduledShows();
}

async function loadScheduledShows(){
  scheduledState.list = await api("/api/live/scheduled");
}

function renderScheduledShows(){
  const list = $("scheduledShowList");
  if(!list) return;
  // Live Shows feature coming soon
  list.innerHTML = `<div class="muted" style="text-align:center;padding:20px;"><strong>Coming Soon</strong><br>Live streaming shows are currently in development.</div>`;
  return;
  // Original code below - uncomment when live shows are ready
  if(!scheduledState.list.length){
    list.innerHTML = `<div class="muted">No scheduled shows.</div>`;
    return;
  }
  list.innerHTML = "";
  scheduledState.list.forEach((s)=>{
    const div = document.createElement("div");
    div.className = "item";
    const hostLabel = s.hostType === "place" ? "Store" : (s.hostType === "event" ? "Event" : "Individual");
    const timeLabel = s.startAt ? new Date(s.startAt).toLocaleString() : "";
    const star = s.bookmarked ? "★" : "☆";
    const avatar = s.hostAvatarUrl ? `<img src="${s.hostAvatarUrl}" alt="" style="width:28px;height:28px;border-radius:999px;object-fit:cover;border:1px solid rgba(255,255,255,.12);" />` : "";
    const hostLine = s.hostType === "place"
      ? `${s.hostName || ""}${s.hostStoreName ? ` • ${s.hostStoreName}` : ""}`
      : s.hostType === "event"
        ? `${s.hostName || ""} • ${s.hostLabel || ""}`
        : `${s.hostName || ""}`;
    div.innerHTML = `
      <div class="row" style="justify-content:space-between;">
        <div style="display:flex; gap:10px;">
          <img src="${s.thumbnailUrl || ""}" alt="" style="width:72px;height:72px;object-fit:cover;border-radius:10px;border:1px solid rgba(255,255,255,.12);" />
          <div>
            <div><strong>${s.title}</strong></div>
            <div class="muted">${timeLabel}</div>
            <div class="row" style="gap:8px; align-items:center; margin-top:4px;">
              ${avatar}
              <div class="muted">${hostLabel}: ${hostLine}</div>
            </div>
            <div class="muted" style="margin-top:4px;">${s.description || ""}</div>
          </div>
        </div>
        <button data-star="${s.id}" style="font-size:18px;">${star}</button>
      </div>
    `;
    div.onclick = (e)=>{
      if(e.target?.dataset?.star) return;
      showScheduledDetail(s);
    };
    div.querySelector("button[data-star]").onclick = async (e)=>{
      e.stopPropagation();
      if(!access.loggedIn){
        alert("Login required to bookmark.");
        window.location.href = "/login";
        return;
      }
      try{
        await api(`/api/live/scheduled/${s.id}/bookmark`, { method:"POST" });
        await loadScheduledShows();
        renderScheduledShows();
      }catch(err){
        alert(err.message);
      }
    };
    list.appendChild(div);
  });
}

function showScheduledDetail(s){
  const detail = $("scheduledDetail");
  if(!detail) return;
  const timeLabel = s.startAt ? new Date(s.startAt).toLocaleString() : "";
  const join = s.joinUrl ? `<a class="pill" href="${s.joinUrl}">Join Live</a>` : "";
  const avatar = s.hostAvatarUrl ? `<img src="${s.hostAvatarUrl}" alt="" style="width:36px;height:36px;border-radius:999px;object-fit:cover;border:1px solid rgba(255,255,255,.12);" />` : "";
  const hostLine = s.hostType === "place"
    ? `${s.hostName || ""}${s.hostStoreName ? ` • ${s.hostStoreName}` : ""}`
    : s.hostType === "event"
      ? `${s.hostName || ""} • ${s.hostLabel || ""}`
      : `${s.hostName || ""}`;
  detail.style.display = "block";
  detail.innerHTML = `
    <div><strong>${s.title}</strong></div>
    <div class="muted">${timeLabel}</div>
    <div class="row" style="gap:10px; align-items:center; margin-top:8px;">
      ${avatar}
      <div class="muted">${hostLine}</div>
    </div>
    <div class="muted" style="margin-top:6px;">${s.description || ""}</div>
    <div class="row" style="margin-top:8px;">${join}</div>
  `;
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
    const imageHtml = m.imageUrl ? `<a href="${m.imageUrl}" target="_blank" rel="noopener"><img src="${m.imageUrl}" alt="" style="max-width:260px;border-radius:10px;border:1px solid rgba(255,255,255,.12);margin-top:6px;" /></a>` : "";
    const canDelete = access.isAdmin || Number(m.userId) === Number(currentUser.id);
    const deleteBtn = canDelete ? `<button data-delete="${m.id}" style="color:#f87171;">Delete</button>` : "";
    div.innerHTML=`
      <div class="muted">${prefix}</div>
      <div>${m.text}</div>
      ${imageHtml}
      <div class="muted">${m.user?.displayName || `User ${m.userId}`}${m.user?.trustTierLabel ? ` · ${m.user.trustTierLabel}` : ""} · ${m.createdAt}</div>
      <div class="row" style="margin-top:6px;">
        <button data-reply="${m.id}">Reply</button>
        ${deleteBtn}
      </div>
    `;
    div.querySelector("button[data-reply]").onclick=()=>{
      channels.replyToId=m.id;
      $("replyToText").textContent=`Replying to: ${m.text.slice(0,80)}`;
      $("replyToBar").style.display="block";
    };
    const delBtn = div.querySelector("button[data-delete]");
    if(delBtn) delBtn.onclick = () => deleteChannelMessage(m.id);
    el.appendChild(div);
  });
}
async function sendChannelMessage(){
  if(!channels.selectedId) return alert("Select a channel first");
  if(!access.loggedIn) return alert("Login required");
  const text=$("channelMessageInput").value.trim();
  const imageUrl = channels.pendingImageUrl || "";
  if(!text && !imageUrl) return;
  await api(`/channels/${channels.selectedId}/messages`,{
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ text, imageUrl, replyToId: channels.replyToId })
  });
  $("channelMessageInput").value="";
  channels.pendingImageUrl = "";
  const preview = $("channelsImagePreview");
  if(preview) preview.style.display="none";
  channels.replyToId=null;
  $("replyToBar").style.display="none";
  await loadChannelMessages(channels.selectedId);
}
async function deleteChannelMessage(messageId){
  if(!channels.selectedId) return;
  if(!confirm("Are you sure you want to delete this message?")) return;
  try {
    await api(`/channels/${channels.selectedId}/messages/${messageId}`, { method: "DELETE" });
    await loadChannelMessages(channels.selectedId);
  } catch(e) {
    alert("Failed to delete message: " + e.message);
  }
}
function bindChannels(){
  $("channelSendBtn").onclick=()=>sendChannelMessage().catch(e=>alert(e.message));
  $("clearReplyBtn").onclick=()=>{
    channels.replyToId=null;
    $("replyToBar").style.display="none";
  };
  const uploadBtn = $("channelsUploadBtn");
  const fileInput = $("channelsImageInput");
  const preview = $("channelsImagePreview");
  const thumb = $("channelsImageThumb");
  const clearBtn = $("channelsImageClear");
  if(uploadBtn && fileInput){
    uploadBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if(!file) return;
      if(!["image/png","image/jpeg","image/webp"].includes(file.type)) {
        console.warn("Invalid file type - PNG/JPG/WebP only");
        return;
      }
      if(file.size > 5 * 1024 * 1024) {
        console.warn("Image too large - max 5MB");
        return;
      }
      const form = new FormData();
      form.append("file", file);
      form.append("kind", "chat_image");
      try{
        const res = await api("/api/uploads", { method:"POST", body: form });
        if (res.url) {
          channels.pendingImageUrl = res.url;
          if(thumb) thumb.src = res.url;
          if(preview) preview.style.display="block";
        } else {
          console.error("Upload failed - no URL returned");
        }
      }catch(e){
        console.error("Upload failed:", e.message);
      }finally{
        fileInput.value = "";
      }
    });
  }
  if(clearBtn){
    clearBtn.addEventListener("click", () => {
      channels.pendingImageUrl = "";
      if(preview) preview.style.display="none";
      if(thumb) thumb.src = "";
    });
  }
}

async function loadEvents(range){
  eventsState.range = range || "week";
  const now = new Date();
  const days = eventsState.range === "month" ? 30 : 7;
  const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    status: "approved",
    from: now.toISOString(),
    to: end.toISOString()
  });
  eventsState.list = await api(`/api/events?${params.toString()}`);
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
    const tier = ev.organizerTrustTierLabel ? ` • ${ev.organizerTrustTierLabel}` : "";
    div.innerHTML=`<div><strong>${ev.title || "Event"}</strong></div><div class="muted">${ev.startAt || ""}${tier}</div>`;
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
    const count=eventsState.list.filter(ev=>ev.startAt?.slice(0,10)===iso).length;
    const cell=document.createElement("div");
    cell.className="calendarCell";
    cell.innerHTML=`<strong>${d.getMonth()+1}/${d.getDate()}</strong><div class="muted">${count} events</div>`;
    el.appendChild(cell);
  }
}
async function initEvents(){
  if(!eventsState.bound){
    const form=$("eventsSubmitWrap");
    const openBtn=$("eventsOpenSubmit");
    const closeBtn=$("eventsSubmitClose");
    const wrap=$("eventsSubmitWrap");
    if(openBtn && wrap){
      openBtn.onclick=()=>{
        wrap.style.display="block";
        wrap.scrollIntoView({ behavior:"smooth", block:"start" });
      };
    }
    if(closeBtn && wrap){
      closeBtn.onclick=()=>{ wrap.style.display="none"; };
    }
    if(form){
      form.onsubmit=async (e)=>{
        e.preventDefault();
        const msg=$("eventsSubmitMsg");
        msg.textContent="Submitting...";
        const startRaw=$("eventsStartAt").value;
        const endRaw=$("eventsEndAt").value;
        const payload={
          title:$("eventsTitle").value.trim(),
          category:$("eventsCategory").value,
          description:$("eventsDescription").value.trim(),
          startAt:startRaw ? new Date(startRaw).toISOString() : "",
          endAt:endRaw ? new Date(endRaw).toISOString() : "",
          locationName:$("eventsLocationName").value.trim(),
          address:$("eventsAddress").value.trim(),
          website:$("eventsWebsite").value.trim(),
          imageUrl:$("eventsImageUrl").value.trim(),
          organizerName:$("eventsOrganizerName").value.trim(),
          organizerEmail:$("eventsOrganizerEmail").value.trim(),
          organizerPhone:$("eventsOrganizerPhone").value.trim(),
          notesToAdmin:$("eventsNotesToAdmin").value.trim()
        };
        try{
          await api("/api/events/submit",{
            method:"POST",
            headers:{ "Content-Type":"application/json" },
            body: JSON.stringify(payload)
          });
          msg.textContent="Submitted for approval.";
          form.reset();
          if(wrap) wrap.style.display="none";
        }catch(e){
          msg.textContent=`ERROR: ${e.message}`;
        }
      };
    }
    eventsState.bound=true;
  }
  await loadEvents(eventsState.range || "week");
  renderEventsList();
  renderEventsCalendar();
}

function escapeHtml(s){
  return (s ?? "").toString()
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;");
}
function renderInline(text){
  let out = escapeHtml(text);
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*(.+?)\*/g, "<em>$1</em>");
  return out;
}
function renderMarkdown(md){
  const lines = (md || "").split(/\r?\n/);
  let html = "";
  let para = [];
  let list = null;
  const flushPara = ()=>{
    if(!para.length) return;
    html += `<p>${renderInline(para.join(" "))}</p>`;
    para = [];
  };
  const flushList = ()=>{
    if(!list || !list.length) return;
    html += `<ul>${list.map(item=>`<li>${renderInline(item)}</li>`).join("")}</ul>`;
    list = null;
  };
  for(const line of lines){
    const trimmed = line.trim();
    if(!trimmed){
      flushPara();
      flushList();
      continue;
    }
    if(trimmed.startsWith("# ")){
      flushPara();
      flushList();
      html += `<h1>${renderInline(trimmed.slice(2))}</h1>`;
      continue;
    }
    if(trimmed.startsWith("## ")){
      flushPara();
      flushList();
      html += `<h2>${renderInline(trimmed.slice(3))}</h2>`;
      continue;
    }
    if(trimmed.startsWith("### ")){
      flushPara();
      flushList();
      html += `<h3>${renderInline(trimmed.slice(4))}</h3>`;
      continue;
    }
    if(trimmed.startsWith("- ")){
      flushPara();
      list = list || [];
      list.push(trimmed.slice(2));
      continue;
    }
    if(list){
      flushList();
    }
    para.push(trimmed);
  }
  flushPara();
  flushList();
  return html;
}
function safeJsonArray(text){
  try{
    const arr = JSON.parse(text || "[]");
    return Array.isArray(arr) ? arr : [];
  }catch{
    return [];
  }
}
function renderArchiveEntries(entries){
  const pinnedEl = $("archivePinned");
  const listEl = $("archiveList");
  const emptyEl = $("archiveEmpty");
  if(!pinnedEl || !listEl || !emptyEl) return;
  pinnedEl.innerHTML = "";
  listEl.innerHTML = "";
  if(!entries.length){
    emptyEl.style.display = "block";
    return;
  }
  emptyEl.style.display = "none";
  const pinned = entries.filter(e=>Number(e.pinned)===1);
  const rest = entries.filter(e=>Number(e.pinned)!==1);
  const renderEntry = (entry)=>{
    const tags = safeJsonArray(entry.tagsJson || "[]");
    const tagHtml = tags.length ? `<div class="muted">Tags: ${tags.map(escapeHtml).join(", ")}</div>` : "";
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="contextTitle">${escapeHtml(entry.title || "")}</div>
      ${tagHtml}
      <div style="margin-top:8px;">${renderMarkdown(entry.bodyMarkdown || "")}</div>
    `;
    return div;
  };
  pinned.forEach(e=>pinnedEl.appendChild(renderEntry(e)));
  rest.forEach(e=>listEl.appendChild(renderEntry(e)));
}
async function initArchive(){
  const entries = await api("/api/archive");
  renderArchiveEntries(entries);
}

function renderPulseCard(pulse){
  const panel=$("panelPulse");
  const list=$("pulseHighlights");
  const empty=$("pulseEmpty");
  const day=$("pulseDay");
  if(!panel || !list || !empty || !day) return;
  if(!pulse){
    panel.style.display="none";
    return;
  }
  panel.style.display="block";
  day.textContent = pulse.dayKey || "—";
  list.innerHTML = "";
  const highlights = pulse.highlights || {};
  const items = [];
  if(highlights.topChannels?.length){
    items.push(`Top channels: ${highlights.topChannels.map(c=>`${c.name} (${c.c})`).join(", ")}`);
  }
  if(highlights.topStores?.length){
    items.push(`Most followed stores: ${highlights.topStores.map(s=>`${s.name} (${s.c})`).join(", ")}`);
  }
  if(highlights.topListings?.length){
    items.push(`New listings: ${highlights.topListings.map(l=>l.title).join(", ")}`);
  }
  if(!items.length && pulse.metrics){
    items.push(`Listings: ${pulse.metrics.listingTotal || 0} • Messages: ${pulse.metrics.messagesSentCount || 0}`);
  }
  if(!items.length){
    empty.style.display="block";
    return;
  }
  empty.style.display="none";
  items.slice(0,3).forEach(line=>{
    const div=document.createElement("div");
    div.className="item";
    div.textContent=line;
    list.appendChild(div);
  });
}
function renderArchivePulse(pulse){
  const body=$("archivePulseBody");
  const empty=$("archivePulseEmpty");
  if(!body || !empty) return;
  if(!pulse){
    body.innerHTML="";
    empty.style.display="block";
    return;
  }
  empty.style.display="none";
  body.innerHTML = `<div class="item">${renderMarkdown(pulse.markdownBody || "")}</div>`;
}
async function loadPulseLatest(){
  try{
    const pulse = await api("/api/pulse/latest");
    pulseState.latest = pulse;
    renderPulseCard(pulse);
    renderArchivePulse(pulse);
  }catch(e){
    const msg = (e.message || "").toLowerCase();
    if(msg.includes("404")){
      renderPulseCard(null);
      renderArchivePulse(null);
    }
  }
}

async function loadPulseHistory(){
  const listEl = $("pulseHistoryList");
  const emptyEl = $("pulseHistoryEmpty");
  if(!listEl || !emptyEl) return;
  try{
    const pulses = await api("/api/pulse/archive");
    if(!pulses || !pulses.length){
      listEl.innerHTML = "";
      emptyEl.style.display = "block";
      return;
    }
    emptyEl.style.display = "none";
    listEl.innerHTML = "";
    pulses.forEach(pulse=>{
      const div = document.createElement("div");
      div.className = "item";
      div.style.cursor = "pointer";
      const dayKey = pulse.dayKey || pulse.daykey || "Unknown";
      const metrics = pulse.metrics || (pulse.metricsJson ? JSON.parse(pulse.metricsJson) : {});
      const msgCount = metrics.messagesSentCount || metrics.messagessentcount || 0;
      const listingCount = metrics.listingTotal || metrics.listingtotal || 0;
      div.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <strong>${escapeHtml(dayKey)}</strong>
            <div class="muted">${listingCount} listings, ${msgCount} messages</div>
          </div>
          <span class="pill">View</span>
        </div>
      `;
      div.onclick = () => showPulseDetail(pulse);
      listEl.appendChild(div);
    });
  }catch(e){
    listEl.innerHTML = "";
    emptyEl.style.display = "block";
  }
}

function showPulseDetail(pulse){
  const panel = $("pulseDetailPanel");
  const body = $("pulseDetailBody");
  if(!panel || !body) return;

  const dayKey = pulse.dayKey || pulse.daykey || "Unknown";
  const metrics = pulse.metrics || (pulse.metricsJson ? JSON.parse(pulse.metricsJson) : {});
  const highlights = pulse.highlights || (pulse.highlightsJson ? JSON.parse(pulse.highlightsJson) : {});

  let html = `<div style="margin-bottom:12px;"><strong>Date:</strong> ${escapeHtml(dayKey)}</div>`;

  // Metrics
  html += `<div class="item"><strong>Metrics</strong><div class="muted" style="margin-top:6px;">`;
  if(metrics.listingTotal || metrics.listingtotal) html += `Listings: ${metrics.listingTotal || metrics.listingtotal}<br>`;
  if(metrics.messagesSentCount || metrics.messagessentcount) html += `Messages: ${metrics.messagesSentCount || metrics.messagessentcount}<br>`;
  if(metrics.userCount || metrics.usercount) html += `Users: ${metrics.userCount || metrics.usercount}<br>`;
  if(metrics.orderCount || metrics.ordercount) html += `Orders: ${metrics.orderCount || metrics.ordercount}<br>`;
  if(metrics.orderTotal || metrics.ordertotal) html += `Order Total: $${((metrics.orderTotal || metrics.ordertotal || 0) / 100).toFixed(2)}<br>`;
  html += `</div></div>`;

  // Highlights
  if(highlights.topChannels?.length){
    html += `<div class="item"><strong>Top Channels</strong><div class="muted" style="margin-top:6px;">`;
    highlights.topChannels.forEach(c => { html += `${escapeHtml(c.name)} (${c.c} messages)<br>`; });
    html += `</div></div>`;
  }
  if(highlights.topStores?.length){
    html += `<div class="item"><strong>Top Stores</strong><div class="muted" style="margin-top:6px;">`;
    highlights.topStores.forEach(s => { html += `${escapeHtml(s.name)} (${s.c} followers)<br>`; });
    html += `</div></div>`;
  }
  if(highlights.topListings?.length){
    html += `<div class="item"><strong>New Listings</strong><div class="muted" style="margin-top:6px;">`;
    highlights.topListings.forEach(l => { html += `${escapeHtml(l.title)}<br>`; });
    html += `</div></div>`;
  }

  // Markdown body if available
  if(pulse.markdownBody || pulse.markdownbody){
    html += `<div class="item" style="margin-top:12px;">${renderMarkdown(pulse.markdownBody || pulse.markdownbody)}</div>`;
  }

  body.innerHTML = html;
  panel.style.display = "block";
}

function closePulseDetail(){
  const panel = $("pulseDetailPanel");
  if(panel) panel.style.display = "none";
}

function renderLocalBizMy(apps){
  const list=$("localBizMyList");
  const loginMsg=$("localBizLoginMsg");
  if(!list || !loginMsg) return;
  if(!access.loggedIn){
    loginMsg.style.display="block";
    list.style.display="none";
    return;
  }
  loginMsg.style.display="none";
  list.style.display="flex";
  list.innerHTML = "";
  if(!apps.length){
    list.innerHTML = `<div class="muted">(no applications yet)</div>`;
    return;
  }
  apps.forEach(app=>{
    const div=document.createElement("div");
    div.className="item";
    div.innerHTML = `<div><strong>${app.businessName}</strong></div><div class="muted">Status: ${app.status}</div>`;
    list.appendChild(div);
  });
}

async function initLocalBiz(){
  if(!localBizState.bound){
    const form=$("localBizForm");
    if(form){
      form.onsubmit=async (e)=>{
        e.preventDefault();
        const msg=$("localBizSubmitMsg");
        const status=$("localBizStatus");
        msg.textContent="Submitting...";
        const payload={
          businessName: $("localBizName").value.trim(),
          ownerName: $("localBizOwner").value.trim(),
          email: $("localBizEmail").value.trim(),
          phone: $("localBizPhone").value.trim(),
          address: $("localBizAddress").value.trim(),
          city: $("localBizCity").value.trim(),
          state: $("localBizState").value.trim(),
          zip: $("localBizZip").value.trim(),
          category: $("localBizCategory").value,
          website: $("localBizWebsite").value.trim(),
          instagram: $("localBizInstagram").value.trim(),
          description: $("localBizDescription").value.trim(),
          sustainabilityNotes: $("localBizSustainability").value.trim(),
          confirmSebastian: $("localBizConfirm").checked ? 1 : 0
        };
        try{
          const created = await api("/api/localbiz/apply",{
            method:"POST",
            headers:{ "Content-Type":"application/json" },
            body: JSON.stringify(payload)
          });
          msg.textContent="Submitted for review.";
          status.textContent=`Status: ${created.status || "pending"}`;
          form.reset();
          $("localBizCity").value="Sebastian";
          $("localBizState").value="FL";
          if(access.loggedIn){
            const apps = await api("/api/localbiz/my");
            renderLocalBizMy(apps);
          }
        }catch(e){
          msg.textContent=`ERROR: ${e.message}`;
        }
      };
    }
    localBizState.bound=true;
  }
  if(access.loggedIn){
    const apps = await api("/api/localbiz/my");
    renderLocalBizMy(apps);
  }else{
    renderLocalBizMy([]);
  }
}

// Featured Local Businesses (Business tier subscribers only)
let featuredBusinessesLoaded = false;
async function initFeaturedBusinesses(){
  if(featuredBusinessesLoaded) return;
  featuredBusinessesLoaded = true;

  const container = $("featuredBusinessesList");
  const loading = $("featuredLoading");
  if(!container) return;

  try {
    const businesses = await api("/api/places/featured");

    if(!businesses || businesses.length === 0){
      container.innerHTML = `<div class="muted">No featured businesses yet. Business subscribers ($10/mo) will appear here.</div>`;
      return;
    }

    container.innerHTML = "";
    for(const biz of businesses){
      const div = document.createElement("div");
      div.className = "item";
      div.style.cursor = "pointer";
      div.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;">
          ${biz.avatarUrl ? `<img src="${biz.avatarUrl}" style="width:48px;height:48px;border-radius:12px;object-fit:cover;">` : `<div style="width:48px;height:48px;border-radius:12px;background:rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;">🏪</div>`}
          <div style="flex:1;">
            <div><strong>${biz.name || "Business"}</strong></div>
            <div class="muted">${biz.category || ""}</div>
          </div>
          <div style="color:#22d3ee;font-size:13px;">View Store →</div>
        </div>
      `;
      div.onclick = () => {
        window.location.href = `/store/${biz.id}`;
      };
      container.appendChild(div);
    }
  } catch(e) {
    console.error("Failed to load featured businesses:", e);
    container.innerHTML = `<div class="muted">Failed to load featured businesses.</div>`;
  }
}

// Support / Bug Report
function bindSupport(){
  const form = $("supportForm");
  if(!form) return;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const msg = $("supportSubmitMsg");
    const subject = $("supportSubject").value.trim();
    const details = $("supportDetails").value.trim();
    if(!subject || !details){
      msg.textContent = "Subject and details are required.";
      return;
    }
    msg.textContent = "Submitting...";
    const payload = {
      type: $("supportType").value,
      name: $("supportName").value.trim(),
      email: $("supportEmail").value.trim(),
      subject,
      details,
      page: $("supportPage").value.trim(),
      device: $("supportDevice").value.trim(),
      userAgent: navigator.userAgent
    };
    try {
      await api("/api/support/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      msg.textContent = "Thank you! Your report has been submitted.";
      form.reset();
      if(access.loggedIn) loadMySupportRequests();
    } catch(err) {
      msg.textContent = `Error: ${err.message}`;
    }
  };
}

async function loadMySupportRequests(){
  const list = $("supportMyList");
  const loginMsg = $("supportLoginMsg");
  if(!access.loggedIn){
    if(loginMsg) loginMsg.style.display = "";
    if(list) list.style.display = "none";
    return;
  }
  if(loginMsg) loginMsg.style.display = "none";
  if(list) list.style.display = "";
  try {
    const requests = await api("/api/support/my");
    list.innerHTML = "";
    if(!requests.length){
      list.innerHTML = `<div class="muted">No reports submitted yet.</div>`;
      return;
    }
    requests.forEach(r => {
      const div = document.createElement("div");
      div.className = "item";
      const statusClass = r.status === "resolved" ? "color:#34d399;" : r.status === "in_progress" ? "color:#fbbf24;" : "";
      div.innerHTML = `
        <div><strong>${r.subject || "No subject"}</strong></div>
        <div class="muted">${r.type || "bug"} • <span style="${statusClass}">${r.status || "pending"}</span> • ${r.createdAt || ""}</div>
        <div class="muted" style="margin-top:4px;">${(r.details || "").slice(0, 100)}${r.details?.length > 100 ? "..." : ""}</div>
      `;
      list.appendChild(div);
    });
  } catch(err) {
    list.innerHTML = `<div class="muted">Could not load reports.</div>`;
  }
}

function getDistrictOptions(){
  return [
    { id:1, name:"Market Square" },
    { id:2, name:"Service Row" },
    { id:3, name:"Retail Way" },
    { id:4, name:"Marina / Live Hall" },
    { id:5, name:"Town Hall" },
  ];
}

async function loadMarketplaceData(){
  const districts=getDistrictOptions();
  market.districts=districts;
  const listings=await api("/market/listings?townId=1");
  market.listings=listings;
  const cats=new Set();
  listings.forEach(l=>{
    const c = l.category || l.placeCategory || "";
    if(c) cats.add(c);
  });
  market.categories=[...cats].sort();
}

async function loadAuctionData(){
  const listings=await api("/market/auctions?townId=1");
  market.auctions=listings;
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

function renderListingCard(l){
  const div=document.createElement("div");
  div.className="item";
  const price = Number.isFinite(Number(l.price)) ? `$${Number(l.price).toFixed(2)}` : "—";
  const desc = (l.description || "").toString().trim();
  const shortDesc = desc.length > 80 ? `${desc.slice(0,77)}...` : desc;
  const photos = l.photoUrls || l.photourls || [];
  const firstPhoto = photos[0] || "";
  const imgHtml = firstPhoto ? `<img src="${firstPhoto}" alt="" style="width:80px;height:80px;object-fit:cover;border-radius:10px;border:1px solid rgba(255,255,255,.12);margin-right:12px;" />` : "";
  div.innerHTML=`
    <div style="display:flex;">
      ${imgHtml}
      <div style="flex:1;">
        <div><strong>${l.title || "Listing"}</strong></div>
        <div class="muted">${shortDesc || "No description"}</div>
        <div class="muted">${l.placeName || "Store"} • ${price}</div>
        <div class="row" style="margin-top:8px;">
          <a class="btn" href="/store/${l.placeId}">Open Store</a>
        </div>
      </div>
    </div>
  `;
  return div;
}

function renderMarketplace(){
  const items=$("marketItems");
  const empty=$("marketEmpty");
  if(!items) return;
  items.innerHTML="";
  if(!market.listings.length){
    if(empty) empty.style.display="block";
    return;
  }
  if(empty) empty.style.display="none";
  market.listings.forEach(l=>items.appendChild(renderListingCard(l)));
}

async function initMarketplace(){
  if(!market.listings.length){
    await loadMarketplaceData();
  }
  renderMarketplace();
}

function isAuctionEnded(l){
  const status = (l.auctionStatus || "").toString().toLowerCase();
  if(status && status !== "active") return true;
  const endAt = Date.parse(l.auctionEndAt || l.endsAt || "");
  return Number.isFinite(endAt) && endAt <= Date.now();
}

function renderAuctionCard(l, opts={}){
  const div=document.createElement("div");
  div.className="item";
  const current = Number.isFinite(Number(l.highestBidCents)) && Number(l.highestBidCents) > 0
    ? `$${(Number(l.highestBidCents)/100).toFixed(2)}`
    : `$${(Number(l.startBidCents||0)/100).toFixed(2)}`;
  const ends = l.auctionEndAt || l.endsAt || "—";
  const ended = !!opts.ended;
  const statusBadge = ended ? `<span class="pill badge-ended">Ended</span>` : "";
  div.innerHTML=`
    <div class="row" style="justify-content:space-between;">
      <strong>${l.title || "Auction"}</strong>
      ${statusBadge}
    </div>
    <div class="muted">Current bid: ${current}</div>
    <div class="muted">${ended ? "Ended" : "Ends"}: ${ends}</div>
    <div class="row" style="margin-top:8px;">
      <a class="btn" href="/store/${l.placeId}">Open Auction</a>
    </div>
  `;
  return div;
}

async function initAuctions(){
  bindAuctionTabs();
  if(!market.auctions.length){
    await loadAuctionData();
  }
  const grid=$("auctionGrid");
  const endedGrid=$("auctionGridEnded");
  const emptyActive=$("auctionEmptyActive");
  const emptyEnded=$("auctionEmptyEnded");
  const auctions=market.auctions.filter(l=>(l.listingType||"item")==="auction");
  const activeAuctions=auctions.filter(l=>!isAuctionEnded(l));
  const endedAuctions=auctions.filter(l=>isAuctionEnded(l));

  if(grid){
    grid.innerHTML="";
    activeAuctions.forEach(l=>grid.appendChild(renderAuctionCard(l)));
  }
  if(endedGrid){
    endedGrid.innerHTML="";
    endedAuctions.forEach(l=>endedGrid.appendChild(renderAuctionCard(l, { ended:true })));
  }
  if(emptyActive) emptyActive.style.display = activeAuctions.length ? "none" : "block";
  if(emptyEnded) emptyEnded.style.display = endedAuctions.length ? "none" : "block";
}

function bindAuctionTabs(){
  if(auctionsTabsBound) return;
  const activeBtn = $("auctionTabActive");
  const endedBtn = $("auctionTabEnded");
  const activePanel = $("auctionPanelActive");
  const endedPanel = $("auctionPanelEnded");
  if(!activeBtn || !endedBtn || !activePanel || !endedPanel) return;

  const setTab = (tab) => {
    activeBtn.classList.toggle("active", tab === "active");
    endedBtn.classList.toggle("active", tab === "ended");
    activePanel.classList.toggle("hidden", tab !== "active");
    endedPanel.classList.toggle("hidden", tab !== "ended");
  };

  activeBtn.addEventListener("click", () => setTab("active"));
  endedBtn.addEventListener("click", () => setTab("ended"));
  setTab("active");
  auctionsTabsBound = true;
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

// Show subscription prompt modal
function showSubscriptionPrompt(message) {
  const msg = message || "Create a free account to buy items, or subscribe for $5/month to also sell and enter giveaways.";
  const choice = confirm(`${msg}\n\nClick OK to create a free account, or Cancel to go back.`);
  if(choice){
    window.location.href = "/verify";
  }
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    // Check if subscription required error
    if(data && data.subscriptionRequired){
      showSubscriptionPrompt(data.message);
      throw new Error("Subscription required");
    }
    throw new Error(`${res.status} ${res.statusText}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }
  return data;
}

async function refreshSweep() {
  const s = await api("/sweep/balance");
  $("sweepBal").textContent = s.balance ?? 0;
}

function formatISO(iso){
  if(!iso) return "—";
  const t = Date.parse(iso);
  if(Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString();
}
async function loadTrustContext(){
  const ctx = await api("/town/context");
  window.TOWN_CTX = ctx;
  state.trustTier = Number(ctx.trustTier || 0);
  state.trustTierLabel = ctx.tierName || ctx.trustTierLabel || "Visitor";
  applyPermissions(ctx);
  updatePrizeOfferCta();
}

async function loadLiveNow(){
  const pill = $("liveNowPill");
  if(!pill) return;
  try{
    const res = await fetch("/api/live/rooms/active");
    if(res.status === 401 || res.status === 403){
      pill.style.display="none";
      return;
    }
    const rooms = await res.json();
    if(rooms.length){
      const r = rooms[0];
      const label = r.hostType === "place" ? "Live Sale" : (r.hostType === "event" ? "Live Class" : "Live");
      pill.textContent = label;
      pill.href = r.joinUrl;
      pill.style.display="inline-flex";
    }else{
      pill.style.display="none";
    }
  }catch{
    pill.style.display="none";
  }
}
function applyPermissions(ctx){
  const perms = ctx?.permissions || {};
  const tier = Number(ctx?.trustTier || 0);
  const tierName = ctx?.tierName || ctx?.trustTierLabel || "Visitor";
  const badge = $("trustBadge");
  if(badge) badge.textContent = `Tier ${tier}: ${tierName}`;
  const viewPerms = {
    marketplace: !!perms.marketplace,
    auctions: !!perms.auctions,
    channels: !!perms.channels,
    events: !!perms.events,
    archive: !!perms.archive,
    localbiz: !!perms.localbiz,
    services: !!perms.marketplace,
    scheduled: !!perms.scheduled
  };
  Object.keys(viewPerms).forEach((view)=>{
    const btn = document.querySelector(`.navItem[data-view="${view}"]`);
    if(!btn) return;
    const label = btn.querySelector("span:last-child");
    if(label && !btn.dataset.baseLabel) btn.dataset.baseLabel = label.textContent;
    // Allow all visitors to view - backend handles action permissions
    btn.disabled = false;
    btn.removeAttribute("aria-disabled");
    if(label && btn.dataset.baseLabel) label.textContent = btn.dataset.baseLabel;
    btn.style.display = viewPerms[view] ? "" : "none";
  });
  const sweepPanel = $("panelSweepstake");
  if(sweepPanel) sweepPanel.style.display = (ctx?.trustTier || 0) < 1 ? "none" : "";
  const current = getRouteView();
  if(current !== "map" && viewPerms[current] === false){
    location.hash = "map";
    setView("map");
  }
  const canPost = !!perms.chatPost;
  const input = $("channelMessageInput");
  const send = $("channelSendBtn");
  const uploadBtn = $("channelsUploadBtn");
  if(input){
    input.disabled = !canPost;
    if(!canPost) input.placeholder = "Posting requires Tier 1+.";
  }
  if(send) send.disabled = !canPost;
  if(uploadBtn) uploadBtn.disabled = !perms.chatImages;
  const storeLink = $("navStoreLink");
  if(storeLink) storeLink.style.display = perms.listingCreate ? "inline-flex" : "none";
  const liveLink = $("navLiveLink");
  if(liveLink) liveLink.style.display = perms.liveHost ? "inline-flex" : "none";
}
function updatePrizeOfferCta(){
  const btn=$("sweepPrizeSubmitBtn");
  const hint=$("sweepPrizeSubmitHint");
  if(!btn) return;
  if(state.trustTier >= 2){
    btn.style.display="inline-flex";
    if(state.trustTier >= 3){
      btn.style.borderColor="var(--accent)";
      if(hint) hint.textContent="Preferred donor tier";
    }else if(hint){
      hint.textContent="";
    }
  }else{
    btn.style.display="none";
    if(hint) hint.textContent="Sebastian Resident+ required to submit prizes.";
  }
}
async function loadPrizeOffers(){
  const list = $("sweepPrizesList");
  if(!list) return;
  const prizes = await api("/api/prizes/active");
  if(!prizes.length){
    list.innerHTML = `<div class="muted">No active prizes.</div>`;
    return;
  }
  list.innerHTML = "";
  prizes.forEach(p=>{
    const donorLink = p.donorPlaceId ? `/store/${p.donorPlaceId}` : `/u/${p.donorUserId}`;
    const div=document.createElement("div");
    div.className="item";
    div.innerHTML = `<div><strong>${p.title}</strong> • $${(p.valueCents/100).toFixed(2)}</div>
      <div class="muted">${p.description || ""}</div>
      <div class="muted">Donor: <a href="${donorLink}" style="color:#cfe3ff;">${p.donorDisplayName}</a>${p.donorTrustTierLabel ? ` • ${p.donorTrustTierLabel}` : ""}</div>`;
    list.appendChild(div);
  });
}
async function submitPrizeOffer(){
  if(state.trustTier < 2) {
    console.warn("Sebastian Resident+ required for prize offers");
    return;
  }
  const msg=$("prizeSubmitMsg");
  msg.textContent="Submitting...";
  let imageUrl="";
  const file=$("prizeImageFile")?.files?.[0];
  if(file){
    try {
      const form=new FormData();
      form.append("file", file);
      form.append("kind","event_prize");
      const up=await api("/api/uploads",{ method:"POST", body: form });
      imageUrl = up.url || "";
    } catch(e) {
      msg.textContent="Image upload failed: " + e.message;
      console.error("Prize image upload error:", e);
      return;
    }
  }
  const payload={
    title:$("prizeTitle").value.trim(),
    description:$("prizeDescription").value.trim(),
    valueCents: Math.round(Number($("prizeValue").value || 0) * 100),
    prizeType:$("prizeType").value,
    fulfillmentMethod:$("prizeFulfillment").value,
    fulfillmentNotes:$("prizeFulfillmentNotes").value.trim(),
    expiresAt:$("prizeExpiresAt").value ? new Date($("prizeExpiresAt").value).toISOString() : "",
    imageUrl
  };
  if(!$("prizeConfirm").checked) return msg.textContent="Please confirm fulfillment.";
  try {
    await api("/api/prizes/submit",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload) });
    msg.textContent="Submitted for approval.";
    $("prizeOfferModal").style.display="none";
    await loadPrizeOffers();
  } catch(e) {
    msg.textContent="Error: " + e.message;
    console.error("Prize submission error:", e);
  }
}
async function loadSweepstake(){
  const panel = $("panelSweepstake");
  if(!panel) return;
  // Init v2 section on first call
  if(window.sweepSectionV2 && !window.sweepSectionV2.container){
    window.sweepSectionV2.init("panelSweepstake");
  }
  // Use loadAll() to fetch all sweepstakes via plural endpoint
  if(window.sweepSectionV2 && window.sweepSectionV2.loadAll){
    try{
      await window.sweepSectionV2.loadAll();
    }catch(e){
      console.error("loadAll failed:", e);
    }
    return;
  }
}
async function enterSweepstake(amount){
  const msg = $("sweepEnterMsg");
  if(msg) msg.textContent = "";
  try{
    const data = await api("/api/sweepstake/active");
    if(!data.sweepstake) return;
    const entries = Number(amount) || Number($("sweepEntryAmount")?.value) || 0;
    if(!Number.isFinite(entries) || entries <= 0){
      if(msg) msg.textContent = "Enter a valid amount.";
      return;
    }
    const res = await api("/sweepstake/enter",{
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ sweepstakeId: data.sweepstake.id, entries })
    });
    var el;
    if((el=$("sweepUserEntries"))) el.textContent = res.userEntries ?? 0;
    if((el=$("sweepTotalEntries"))) el.textContent = res.totals?.totalEntries ?? 0;
    if((el=$("sweepUserBalance"))) el.textContent = res.balance ?? 0;
    if((el=$("sweepBal"))) el.textContent = res.balance ?? 0;
    if(msg) msg.textContent = "Entered.";
    // Refresh v2 section to show updated balances/entries
    if(window.loadSweepstakeData) window.loadSweepstakeData();
  }catch(e){
    if(msg) msg.textContent = e.message || "Error";
  }
}
window.enterSweepstake = enterSweepstake;
window.loadSweepstakeData = loadSweepstake;

function formatSweepWinnerText(winner, prize){
  if(!winner?.displayName) return "Winner: —";
  const prizeTitle = (prize?.title || "").toString().trim();
  const donorName = (prize?.donorName || "").toString().trim();
  let line = `Winner: ${winner.displayName}`;
  if(prizeTitle) line += ` • ${prizeTitle}`;
  if(donorName) line += ` • Donor: ${donorName}`;
  return line;
}

function initSweepWheel(){
  const hash = (window.location.hash || "").toLowerCase();
  if(hash.includes("sweepdraw")){
    try{
      const stored = localStorage.getItem("lastSweepDrawPayload");
      if(stored){
        const payload = JSON.parse(stored);
        const entries = (payload.participants || []).map(p => ({
          id: p.userId,
          name: p.displayName || 'Unknown',
          entries: p.entries || 1
        }));
        const winnerId = payload.winner ? (payload.winner.userId || null) : null;
        if(window.sweepWheelV2) window.sweepWheelV2.open(entries, null, {
          isAdmin: access.isAdmin,
          winnerId: winnerId,
          autoReplay: true
        });
      }
    }catch(_){}
  }
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

function firstNameFromDisplay(name, email){
  const n = (name || "").toString().trim();
  if(n) return n.split(" ")[0];
  const e = (email || "").toString().trim();
  if(!e) return "Member";
  return e.split("@")[0] || "Member";
}
function updateSidebarAuth(){
  const loginRow = $("navLoggedOut");
  const loggedInRow = $("navLoggedIn");
  if(loginRow) loginRow.style.display = access.loggedIn ? "none" : "flex";
  if(loggedInRow) loggedInRow.style.display = access.loggedIn ? "flex" : "none";
  const topJoin = $("topJoinLink");
  if(topJoin) topJoin.style.display = access.loggedIn ? "none" : "inline-flex";
  const topAuth = $("topAuthBtn");
  if(topAuth){
    topAuth.textContent = access.loggedIn ? "Logout" : "Login";
  }
  const nameEl = $("sidebarUserName");
  if(nameEl){
    if(access.loggedIn){
      const first = firstNameFromDisplay(currentUser.displayName, access.email);
      nameEl.textContent = `Hi, ${first}`;
      nameEl.style.display = "block";
    }else{
      nameEl.textContent = "";
      nameEl.style.display = "none";
    }
  }
  const storeLink = $("navStoreLink");
  if(storeLink) storeLink.href = "/me/store";
  const myProfileLink = $("navMyProfileLink");
  if(myProfileLink) myProfileLink.href = "/me/profile";
  const adminLink = $("topAdminLink");
  if(adminLink) adminLink.href = access.isAdmin ? "/admin" : "/admin/login";
  const welcome = $("welcomeCard");
  if(welcome) welcome.style.display = access.loggedIn ? "none" : "block";
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
    $("authTag").innerHTML = `Go to <a href="/login" style="color:#cfe3ff;">/login</a> to log in.`;
  } else if (access.eligible) {
    $("authTitle").textContent = `Logged in: ${access.email}`;
    $("authTag").innerHTML = `✅ Eligible • ${access.reason || ""}`;
  } else {
    $("authTitle").textContent = `Logged in: ${access.email}`;
    $("authTag").innerHTML = `🟡 Waitlist • ${access.reason || ""}`;
  }
  updateSidebarAuth();
}

async function loadMe() {
  const me = await api("/me");
  if (!me.user) {
    access = { loggedIn:false, eligible:false, email:null, reason:null, isAdmin:false };
    window.access = access;
    currentUser = { id:null, displayName:"" };
    setControlsEnabled();
    await refreshSweep();
    await loadTrustContext();
    if(getRouteView()==="localbiz") initLocalBiz().catch(()=>{});
    return;
  }
  const email = me.user.email;
  const displayName = (me.user.displayName || "").toString().trim();
  const status = me.signup?.status || "waitlist";
  const reason = me.signup?.reason || "No signup record yet.";
  const isAdmin = Number(me.user.isAdmin) === 1;
  access = { loggedIn:true, eligible: status==="eligible", email, reason, isAdmin };
  window.access = access;
  currentUser = { id: me.user.id, displayName };
  setControlsEnabled();
  await refreshSweep();
  await loadTrustContext();
  if(getRouteView()==="localbiz") initLocalBiz().catch(()=>{});
}

async function logout(){ await api("/auth/logout",{method:"POST"}); window.location.href="/login"; }

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
  map=L.map("map",{
    zoomControl:false,
    dragging:false,
    scrollWheelZoom:false,
    doubleClickZoom:false,
    touchZoom:false,
    boxZoom:false,
    keyboard:false,
    tap:false,
    attributionControl:false
  }).setView(center,13);
  markersLayer=null;
  boundaryLayer=null;
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
  if($("sweepEnterBtn")) $("sweepEnterBtn").onclick=enterSweepstake;
  if($("sweepPrizeSubmitBtn")) $("sweepPrizeSubmitBtn").onclick=()=>{ $("prizeOfferModal").style.display="block"; };
  if($("prizeCancelBtn")) $("prizeCancelBtn").onclick=()=>{ $("prizeOfferModal").style.display="none"; };
  if($("prizeSubmitBtn")) $("prizeSubmitBtn").onclick=()=>submitPrizeOffer().catch(e=>{ $("prizeSubmitMsg").textContent=e.message; });
  if($("topAuthBtn")) $("topAuthBtn").onclick=()=>access.loggedIn ? logout() : (window.location.href="/login");
  initSweepWheel();

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

  if(window.loadTownTheme) await window.loadTownTheme();

  // CSP-compliant button bindings
  $("closePulseDetailBtn")?.addEventListener("click", closePulseDetail);

  bindChannels();
  bindSupport();
  bindRouter();
  await loadStatus();
  await loadMe();
  await refreshSweep();
  await loadSweepstake();
  await loadPrizeOffers();
  await loadLiveNow();
  await loadPulseLatest();
  await loadPulseHistory();
  await loadFeaturedStores();

  initMap();
  bindDistrictButtons();
  await loadPlacesForDistrict(1);

  await logEvent("town_view", {}, {});
  debug("Trusted server events enabled for sweepstake_enter + listing_mark_sold.");
}

main().catch(e=>debug(`BOOT ERROR: ${e.message}`));
