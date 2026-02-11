const $ = (id) => document.getElementById(id);
const tc = window.__TOWN_CONFIG__ || {};

function togglePulseSection() {
  const section = document.getElementById('pulseSection');
  const toggle = document.getElementById('pulseToggle');
  if(section.style.display === 'none') {
    section.style.display = 'flex';
    toggle.textContent = '▼';
  } else {
    section.style.display = 'none';
    toggle.textContent = '▶';
  }
}

function loadPulseDashboards() {
  const fishTarget = document.getElementById('pulseFishingDash');
  const safetyTarget = document.getElementById('pulseSafetyDash');

  // Load fishing dashboard directly into pulse view
  if(fishTarget && !fishTarget.innerHTML.trim()) {
    // Temporarily swap the target
    const realFishDash = document.getElementById('fishingDashboard');
    const originalId = realFishDash ? realFishDash.id : null;

    if(realFishDash) {
      fishTarget.id = 'fishingDashboard';
      realFishDash.id = 'fishingDashboard_backup';
    }

    loadFishingConditions();

    // Restore IDs after a delay
    setTimeout(() => {
      if(realFishDash) {
        fishTarget.id = 'pulseFishingDash';
        realFishDash.id = 'fishingDashboard';
      }
    }, 2000);
  }

  // Load safety dashboard directly into pulse view
  if(safetyTarget && !safetyTarget.innerHTML.trim()) {
    const realSafetyDash = document.getElementById('safetyDashboard');

    if(realSafetyDash) {
      safetyTarget.id = 'safetyDashboard';
      realSafetyDash.id = 'safetyDashboard_backup';
    }

    loadSafetyPulse();

    setTimeout(() => {
      if(realSafetyDash) {
        safetyTarget.id = 'pulseSafetyDash';
        realSafetyDash.id = 'safetyDashboard';
      }
    }, 100);
  }
}

function selectChannelByName(name) {
  const channel = channels.list.find(c => c.name === name);
  if(channel) {
    selectChannel(channel.id);
  }
}

let state = { districtId:null, placeId:null, place:null, conversationId:null, viewer:"buyer", trustTier:0, trustTierLabel:"Visitor" };
let market = { listings:[], auctions:[], categories:[], districts:[], selectedCategory:null };
let channels = { list:[], messages:[], selectedId:null, replyToId:null, pendingImageUrl:"" };
let eventsState = { list:[], selectedId:null, range:"month", bound:false, calYear:0, calMonth:0, selectedDay:null, selectedCategory:null };
let localBizState = { list:[], bound:false };
let scheduledState = { list:[], selectedId:null, thumbnailUrl:"" };
let pulseState = { latest:null };
let access = { loggedIn:false, eligible:false, email:null, reason:null, isAdmin:false };
window.access = access;
window.state = state;
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
  if(!routeEl) return;
  const navBtn=document.querySelector('.navItem[data-view="'+view+'"]');
  const label=navBtn?navBtn.textContent.trim():view;
  routeEl.textContent=label;
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
    { name: (tc.channels?.[0]?.name || "Sebastian Neighbors & Friends"), first: (tc.channels?.[0]?.firstPost || "First post: Welcome neighbors! Introduce yourself and your street.") },
    { name: (tc.channels?.[1]?.name || "Sebastian Community Chat"), first: (tc.channels?.[1]?.firstPost || "First post: What's your favorite local spot this week?") },
    { name: (tc.channels?.[2]?.name || "Fun Activities & Events"), first: (tc.channels?.[2]?.firstPost || "First post: Share upcoming events and weekend ideas.") },
    { name: (tc.channels?.[3]?.name || "Sebastian Lifestyle & Wellness"), first: (tc.channels?.[3]?.firstPost || "First post: Morning walks, yoga, and wellness tips here.") },
    { name: (tc.channels?.[4]?.name || "Local Meetups & Walking Groups"), first: (tc.channels?.[4]?.firstPost || "First post: Who wants to start a sunrise walk group?") },
    { name: (tc.channels?.[5]?.name || "Sebastian Culture & Memories"), first: (tc.channels?.[5]?.firstPost || "First post: Post old photos or stories from Sebastian's past.") },
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
    const stackEl = $("channelsStack");
    const gridEl = $("channelsGrid");
    const hasChannels = channels.list.length > 0;
    if(gridEl) gridEl.style.display = hasChannels ? "grid" : "none";
    if(stackEl) stackEl.style.display = hasChannels ? "none" : "block";
    loadActivityFeed();
  }catch{}
}

async function initScheduledShows(){
  renderScheduledShows();
}

async function loadScheduledShows(){
  scheduledState.list = await api("/api/live/scheduled");
}

function renderScheduledShows(){
  const list = $("scheduledShowList");
  if(!list) return;
  // Live Shows feature coming soon
  list.innerHTML = `
    <div style="max-width:640px;margin:0 auto;padding:24px 0;">
      <div style="text-align:center;margin-bottom:28px;">
        <div style="width:64px;height:64px;margin:0 auto 14px;border-radius:16px;background:rgba(20,184,166,.12);display:flex;align-items:center;justify-content:center;font-size:32px;">📡</div>
        <div style="font-size:22px;font-weight:700;color:#f0f0f0;">Live Shows &mdash; Coming Soon</div>
        <div style="margin-top:6px;font-size:14px;line-height:1.5;color:#8899a6;">A new way to connect with your community in real time</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px;">
        <div style="background:rgba(30,42,54,.3);border:1px solid #2a3a4a;border-radius:16px;padding:18px;">
          <div style="width:40px;height:40px;border-radius:10px;background:rgba(20,184,166,.15);display:flex;align-items:center;justify-content:center;font-size:20px;margin-bottom:10px;">🛍️</div>
          <div style="font-weight:600;color:#f0f0f0;margin-bottom:4px;">Live Sales</div>
          <div style="font-size:13px;line-height:1.5;color:#8899a6;">Local businesses can showcase and sell products in real-time to the community</div>
        </div>
        <div style="background:rgba(30,42,54,.3);border:1px solid #2a3a4a;border-radius:16px;padding:18px;">
          <div style="width:40px;height:40px;border-radius:10px;background:rgba(245,158,11,.15);display:flex;align-items:center;justify-content:center;font-size:20px;margin-bottom:10px;">🎥</div>
          <div style="font-weight:600;color:#f0f0f0;margin-bottom:4px;">Live Events</div>
          <div style="font-size:13px;line-height:1.5;color:#8899a6;">Stream community events, town halls, and meetups for everyone to join remotely</div>
        </div>
        <div style="background:rgba(30,42,54,.3);border:1px solid #2a3a4a;border-radius:16px;padding:18px;">
          <div style="width:40px;height:40px;border-radius:10px;background:rgba(34,211,238,.15);display:flex;align-items:center;justify-content:center;font-size:20px;margin-bottom:10px;">💬</div>
          <div style="font-weight:600;color:#f0f0f0;margin-bottom:4px;">Live Interaction</div>
          <div style="font-size:13px;line-height:1.5;color:#8899a6;">Chat, ask questions, and engage directly with hosts during broadcasts</div>
        </div>
        <div style="background:rgba(30,42,54,.3);border:1px solid #2a3a4a;border-radius:16px;padding:18px;">
          <div style="width:40px;height:40px;border-radius:10px;background:rgba(139,92,246,.15);display:flex;align-items:center;justify-content:center;font-size:20px;margin-bottom:10px;">📢</div>
          <div style="font-weight:600;color:#f0f0f0;margin-bottom:4px;">Business Engagement</div>
          <div style="font-size:13px;line-height:1.5;color:#8899a6;">Businesses connect with their customer base through live demonstrations and Q&amp;A sessions</div>
        </div>
      </div>
      <div style="text-align:center;margin-top:24px;padding:16px;background:rgba(20,184,166,.08);border:1px solid rgba(20,184,166,.25);border-radius:16px;">
        <div style="font-size:14px;color:#14b8a6;font-weight:600;">Stay Tuned</div>
        <div style="font-size:13px;margin-top:4px;color:#8899a6;">We're building something great. Live shows will be available soon.</div>
      </div>
    </div>`;
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
      if(btn.dataset.view === 'pulse') setTimeout(loadPulseDashboards, 50);
    };
  });
  window.addEventListener("hashchange",()=>setView(getRouteView()));
  setView(getRouteView());
}

async function loadChannels(){
  channels.list=await api("/channels");
}
function channelColorClass(name){
  var n=(name||"").toLowerCase();
  if(n.indexOf("announce")!==-1||n.indexOf("news")!==-1) return "channel-card--amber";
  if(n.indexOf("market")!==-1||n.indexOf("shop")!==-1||n.indexOf("store")!==-1) return "channel-card--emerald";
  if(n.indexOf("event")!==-1||n.indexOf("meetup")!==-1||n.indexOf("activit")!==-1) return "channel-card--cyan";
  return "channel-card--sky";
}
function channelIcon(name){
  var n=(name||"").toLowerCase();
  if(n.indexOf("neighbor")!==-1||n.indexOf("friend")!==-1) return "\u{1F3D8}\u{FE0F}";
  if(n.indexOf("community")!==-1||n.indexOf("chat")!==-1) return "\u{1F4AC}";
  if(n.indexOf("fun")!==-1||n.indexOf("activit")!==-1) return "\u{1F389}";
  if(n.indexOf("lifestyle")!==-1||n.indexOf("wellness")!==-1) return "\u{1F33F}";
  if(n.indexOf("walk")!==-1||n.indexOf("meetup")!==-1) return "\u{1F6B6}";
  if(n.indexOf("culture")!==-1||n.indexOf("memor")!==-1) return "\u{1F4F8}";
  if(n.indexOf("county")!==-1||n.indexOf("happen")!==-1) return "\u{1F4F0}";
  if(n.indexOf("ladies")!==-1||n.indexOf("social")!==-1) return "\u2728";
  if(n.indexOf("river")!==-1||n.indexOf("reflect")!==-1) return "\u{1F30A}";
  if(n.indexOf("market")!==-1) return "\u{1F6CD}\u{FE0F}";
  if(n.indexOf("announce")!==-1) return "\u{1F4E2}";
  return "\u{1F4FA}";
}
function renderChannelsList(){
  var grid=$("channelsGrid");
  if(!grid) return;
  grid.innerHTML="";
  channels.list.forEach(function(c){
    var color=channelColorClass(c.name);
    var icon=channelIcon(c.name);
    var isActive=channels.selectedId==c.id;
    var card=document.createElement("div");
    card.className="channel-card "+color+(isActive?" active":"");
    card.setAttribute("data-channel-id",c.id);
    card.innerHTML=
      '<div class="channel-icon">'+icon+'</div>'+
      '<div class="channel-card-info">'+
        '<div class="channel-card-name">#'+c.name+'</div>'+
        '<div class="channel-card-meta">'+(c.description||"")+'</div>'+
      '</div>';
    card.onclick=function(){
      var all=grid.querySelectorAll(".channel-card");
      for(var i=0;i<all.length;i++) all[i].classList.remove("active");
      card.classList.add("active");
      selectChannel(c.id);
    };
    grid.appendChild(card);
  });
  var statEl=$("statChannels");
  if(statEl) statEl.textContent=channels.list.length;
}
async function selectChannel(id){
  channels.selectedId=id;
  channels.replyToId=null;
  $("replyToBar").style.display="none";
  const c=channels.list.find(x=>x.id==id);
  $("channelTitle").textContent=c ? `#${c.name}` : "Channel";
  $("channelMeta").textContent=c?.description || "";
  const fishDash = document.getElementById("fishingDashboard");
  if(fishDash) {
    if(c && c.name === "fishing-report") {
      fishDash.style.display = "block";
      loadFishingConditions();
    } else {
      fishDash.style.display = "none";
    }
  }
  const safetyDash = document.getElementById("safetyDashboard");
  if(safetyDash) {
    if(c && c.name === "safety") {
      safetyDash.style.display = "block";
      loadSafetyPulse();
    } else {
      safetyDash.style.display = "none";
    }
  }
  await loadChannelMessages(id);
}
async function loadChannelMessages(id){
  channels.messages=await api(`/channels/${id}/messages`);
  renderChannelMessages();
  loadActivityFeed();
}
function userInitials(name){
  if(!name) return "?";
  var parts=name.trim().split(/\s+/);
  if(parts.length>=2) return (parts[0][0]+parts[1][0]).toUpperCase();
  return name.slice(0,2).toUpperCase();
}
function formatMsgTime(raw){
  if(!raw) return "";
  try{
    var d=new Date(raw);
    if(isNaN(d.getTime())) return String(raw);
    var mon=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
    var day=d.getDate();
    var h=d.getHours(); var ap=h>=12?"pm":"am"; h=h%12||12;
    var min=("0"+d.getMinutes()).slice(-2);
    return mon+" "+day+", "+h+":"+min+ap;
  }catch(e){ return String(raw); }
}
function renderChannelMessages(){
  var el=$("channelMessages");
  el.innerHTML="";
  if(!channels.messages.length){
    el.innerHTML='<div class="channel-empty"><div class="channel-empty-icon">\u{1F4AC}</div><div class="channel-empty-text">No messages yet. Start the conversation!</div></div>';
    return;
  }
  var byId=new Map(channels.messages.map(function(m){ return [m.id,m]; }));
  channels.messages.forEach(function(m){
    var div=document.createElement("div");
    div.className="activity-item";
    var name=(m.user&&m.user.displayName)?m.user.displayName:"User "+m.userId;
    var initials=userInitials(name);
    var time=formatMsgTime(m.createdAt);
    var tier=(m.user&&m.user.trustTierLabel)?'<span class="channel-card-badge">'+m.user.trustTierLabel+'</span>':"";
    var parent=m.replyToId?byId.get(m.replyToId):null;
    var replyCtx=parent?'<div class="channel-thread-indicator">\u21B3 '+parent.text.slice(0,60)+'</div>':"";
    var imageHtml=m.imageUrl?'<a href="'+m.imageUrl+'" target="_blank" rel="noopener"><img class="activity-image" src="'+m.imageUrl+'" alt="" /></a>':"";
    var canDelete=access.isAdmin||Number(m.userId)===Number(currentUser.id);
    var deleteHtml=canDelete?'<button class="activity-reply-btn" data-delete="'+m.id+'" style="color:#f87171;">Delete</button>':"";
    div.innerHTML=
      '<div class="activity-avatar">'+initials+'</div>'+
      '<div class="activity-body">'+
        '<div class="activity-header">'+
          '<span class="activity-author">'+name+'</span>'+
          tier+
          '<span class="activity-time">'+time+'</span>'+
        '</div>'+
        replyCtx+
        '<div class="activity-text">'+m.text+'</div>'+
        imageHtml+
        '<div class="activity-reply-bar">'+
          '<button class="activity-reply-btn" data-reply="'+m.id+'">Reply</button>'+
          deleteHtml+
        '</div>'+
      '</div>';
    div.querySelector("button[data-reply]").onclick=function(){
      channels.replyToId=m.id;
      $("replyToText").textContent="Replying to: "+m.text.slice(0,80);
      $("replyToBar").style.display="block";
    };
    var delBtn=div.querySelector("button[data-delete]");
    if(delBtn) delBtn.onclick=function(){ deleteChannelMessage(m.id); };
    el.appendChild(div);
  });
  var statEl=$("statMessages");
  if(statEl) statEl.textContent=channels.messages.length;
}
async function loadActivityFeed(){
  try{
    var msgs=await api("/channels/recent-activity");
    renderActivityFeed(msgs);
  }catch(e){}
}
function renderActivityFeed(msgs){
  var el=$("activityFeed");
  if(!el) return;
  if(!msgs||!msgs.length){
    el.innerHTML='<div class="channel-empty"><div class="channel-empty-icon">\u{1F4AC}</div><div class="channel-empty-text">No recent activity</div></div>';
    return;
  }
  el.innerHTML="";
  msgs.forEach(function(m){
    var div=document.createElement("div");
    div.className="activity-item";
    var name=(m.user&&m.user.displayName)?m.user.displayName:"User "+m.userId;
    var initials=userInitials(name);
    var time=formatMsgTime(m.createdAt);
    var chTag=m.channelName?'<span class="channel-card-badge">#'+m.channelName+'</span>':"";
    var text=(m.text||"");
    if(text.length>80) text=text.slice(0,80)+"\u2026";
    div.innerHTML=
      '<div class="activity-avatar">'+initials+'</div>'+
      '<div class="activity-body">'+
        '<div class="activity-header">'+
          '<span class="activity-author">'+name+'</span>'+
          chTag+
          '<span class="activity-time">'+time+'</span>'+
        '</div>'+
        '<div class="activity-text">'+text+'</div>'+
      '</div>';
    if(m.channelId){
      div.style.cursor="pointer";
      div.onclick=function(){ selectChannel(m.channelId); };
    }
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
  var msgInput=$("channelMessageInput");
  if(msgInput) msgInput.addEventListener("keydown",function(e){
    if(e.key==="Enter"&&!e.shiftKey){
      e.preventDefault();
      sendChannelMessage().catch(function(err){ alert(err.message); });
    }
  });
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
  eventsState.range = range || "month";
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
var EVT_MONTHS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function evtMonthAbbr(m){ return EVT_MONTHS[m]||""; }
function evtTimeStr(iso){
  if(!iso) return "";
  var d=new Date(iso); var h=d.getHours(); var m=d.getMinutes();
  var ap=h>=12?"pm":"am"; h=h%12||12;
  return h+":"+(m<10?"0":"")+m+ap;
}
function evtCatIcon(cat){
  var c=(cat||"").toLowerCase();
  if(c==="community") return "\u{1F3D8}";
  if(c==="market") return "\u{1F6CD}";
  if(c==="music") return "\u{1F3B5}";
  if(c==="outdoors") return "\u{1F332}";
  if(c==="education") return "\u{1F4DA}";
  if(c==="charity") return "\u{1F49D}";
  if(c==="sports") return "\u26BD";
  if(c==="kids") return "\u{1F388}";
  return "\u{1F4CC}";
}

function renderFeaturedEvent(){
  var all=eventsState.list||[];
  var featEl=$("featuredEvent");
  if(!featEl) return;
  var feat=eventsState.selectedId
    ? all.find(function(e){ return e.id===eventsState.selectedId; })
    : null;
  if(!feat) feat=all[0];
  if(!feat){ featEl.innerHTML=''; return; }
  var fd=new Date(feat.startAt||Date.now());
  var fCat=(feat.category||"other").toLowerCase();
  var fImg=feat.imageUrl
    ? '<img class="event-featured-img" src="'+feat.imageUrl+'" alt="" />'
    : '<div class="event-featured-img-placeholder event-cat--'+fCat+'">'+evtCatIcon(fCat)+'</div>';
  var fLoc=feat.locationName ? '<span>\u{1F4CD} '+feat.locationName+'</span>' : '';
  var fEnd=feat.endAt ? ' \u2013 '+evtTimeStr(feat.endAt) : '';
  var fDesc=feat.description||'';
  if(!eventsState.selectedId && fDesc.length>140) fDesc=fDesc.slice(0,140)+'\u2026';
  var fRsvp=typeof feat.rsvpCount==='number' ? '<span>\u{1F465} '+feat.rsvpCount+' going</span>' : '';
  var fOrg=feat.organizerName ? '<span>\u{1F464} '+feat.organizerName+'</span>' : '';
  featEl.innerHTML=
    '<div class="event-featured">'+fImg+
    '<div class="event-featured-body">'+
      '<div class="event-featured-badge">'+(feat.category||"event")+'</div>'+
      '<div class="event-featured-title">'+(feat.title||"Event")+'</div>'+
      (fDesc ? '<div style="font-size:13px;color:var(--ev-text);margin-bottom:8px;line-height:1.5;">'+fDesc+'</div>' : '')+
      '<div class="event-featured-meta">'+
        '<span>\u{1F4C5} '+evtMonthAbbr(fd.getMonth())+' '+fd.getDate()+', '+evtTimeStr(feat.startAt)+fEnd+'</span>'+
        fLoc+fRsvp+fOrg+
      '</div>'+
    '</div></div>';
}

function renderEventsList(){
  var all=eventsState.list||[];
  var filtered=all;
  if(eventsState.selectedDay){
    filtered=filtered.filter(function(ev){ return (ev.startAt||"").slice(0,10)===eventsState.selectedDay; });
  }
  if(eventsState.selectedCategory){
    filtered=filtered.filter(function(ev){ return (ev.category||"").toLowerCase()===eventsState.selectedCategory; });
  }

  renderFeaturedEvent();

  /* ── Category chips ── */
  var chipsEl=$("eventChips");
  if(chipsEl){
    var cats={};
    all.forEach(function(ev){ var c=(ev.category||"other").toLowerCase(); cats[c]=(cats[c]||0)+1; });
    var ch='<div class="event-chip'+(!eventsState.selectedCategory?' active':'')+'" data-cat-filter="">All <span class="event-chip-count">'+all.length+'</span></div>';
    Object.keys(cats).forEach(function(c){
      var act=eventsState.selectedCategory===c?' active':'';
      ch+='<div class="event-chip event-cat--'+c+act+'" data-cat="'+c+'" data-cat-filter="'+c+'">'+evtCatIcon(c)+' '+c+' <span class="event-chip-count">'+cats[c]+'</span></div>';
    });
    chipsEl.innerHTML=ch;
    chipsEl.querySelectorAll(".event-chip").forEach(function(chip){
      chip.onclick=function(){
        eventsState.selectedCategory=chip.getAttribute("data-cat-filter")||null;
        renderEventsList();
      };
    });
  }

  /* ── Event card list ── */
  var el=$("eventsList");
  el.innerHTML="";
  if(!filtered.length){
    el.innerHTML='<div class="event-empty"><div class="event-empty-icon">\u{1F4C5}</div><div class="event-empty-text">'+(eventsState.selectedDay||eventsState.selectedCategory?'No events match this filter':'No upcoming events')+'</div></div>';
  } else {
    filtered.forEach(function(ev){
      var d=new Date(ev.startAt||Date.now());
      var loc=ev.locationName ? '<span>\u{1F4CD} '+ev.locationName+'</span>' : '';
      var card=document.createElement("div");
      card.className="event-card event-cat--"+(ev.category||"other").toLowerCase();
      if(eventsState.selectedId===ev.id) card.classList.add("active");
      var endStr=ev.endAt ? ' \u2013 '+evtTimeStr(ev.endAt) : '';
      var addr=ev.address ? ' \u00B7 '+ev.address : '';
      var desc=ev.description||'';
      var org=ev.organizerName ? '<span>\u{1F464} '+ev.organizerName+'</span>' : '';
      var web=ev.website ? '<span><a href="'+ev.website+'" target="_blank" rel="noopener" style="color:var(--ev-accent);">Website \u2197</a></span>' : '';
      card.innerHTML=
        '<div class="event-card-date">'+
          '<div class="event-card-date-month">'+evtMonthAbbr(d.getMonth())+'</div>'+
          '<div class="event-card-date-day">'+d.getDate()+'</div>'+
        '</div>'+
        '<div class="event-card-info">'+
          '<div class="event-card-title">'+(ev.title||"Event")+'</div>'+
          '<div class="event-card-meta">'+
            '<span>\u{1F551} '+evtTimeStr(ev.startAt)+endStr+'</span>'+
            loc+
          '</div>'+
          '<div class="event-card-category" data-cat="'+(ev.category||"other").toLowerCase()+'">'+(ev.category||"other")+'</div>'+
        '</div>'+
        '<div class="event-card-actions"></div>'+
        '<div class="event-card-expand"><div class="event-card-expand-inner">'+
          (desc ? '<div class="event-card-desc">'+desc+'</div>' : '')+
          '<div class="event-card-expand-meta">'+
            '<span>\u{1F4C5} '+evtMonthAbbr(d.getMonth())+' '+d.getDate()+', '+evtTimeStr(ev.startAt)+endStr+'</span>'+
            (ev.locationName ? '<span>\u{1F4CD} '+ev.locationName+addr+'</span>' : '')+
            '<span>\u{1F3F7} '+(ev.category||'other')+'</span>'+
            org+web+
          '</div>'+
        '</div></div>';
      card.onclick=function(){
        var wasActive=card.classList.contains("active");
        el.querySelectorAll(".event-card.active").forEach(function(c){ c.classList.remove("active"); });
        if(wasActive){
          eventsState.selectedId=null;
        } else {
          card.classList.add("active");
          eventsState.selectedId=ev.id;
        }
        renderFeaturedEvent();
      };
      el.appendChild(card);
    });
  }

  /* ── Upcoming sidebar ── */
  var upEl=$("upcomingEventsList");
  if(upEl){
    var upcoming=all.slice(0,5);
    if(!upcoming.length){
      upEl.innerHTML='<div class="muted" style="font-size:12px;">No upcoming events</div>';
    } else {
      upEl.innerHTML="";
      upcoming.forEach(function(ev){
        var d=new Date(ev.startAt||Date.now());
        var item=document.createElement("div");
        item.className="event-upcoming-item";
        item.innerHTML=
          '<div class="event-upcoming-dot event-cat--'+(ev.category||"other").toLowerCase()+'" data-cat="'+(ev.category||"other").toLowerCase()+'"></div>'+
          '<div class="event-upcoming-info">'+
            '<div class="event-upcoming-title">'+(ev.title||"Event")+'</div>'+
            '<div class="event-upcoming-time">'+evtMonthAbbr(d.getMonth())+' '+d.getDate()+' \u00B7 '+evtTimeStr(ev.startAt)+'</div>'+
          '</div>';
        upEl.appendChild(item);
      });
    }
  }

  /* ── Stats (client-side fallback) ── */
  var catSet={}; all.forEach(function(ev){ catSet[(ev.category||"other").toLowerCase()]=1; });
  var sCat=$("statCategories"); if(sCat) sCat.textContent=Object.keys(catSet).length;
}

function loadEventStats(){
  api("/api/events/stats").then(function(s){
    if(!s) return;
    var sTot=$("statTotalEvents"); if(sTot) sTot.textContent=s.totalThisMonth||0;
    var sWk=$("statThisWeek"); if(sWk) sWk.textContent=s.newThisWeek||0;
    var sRsvp=$("statRsvps"); if(sRsvp) sRsvp.textContent=s.totalRsvps||0;
  }).catch(function(){});
}

function renderEventsCalendar(){
  var now=new Date();
  if(!eventsState.calYear){ eventsState.calYear=now.getFullYear(); eventsState.calMonth=now.getMonth(); }
  var year=eventsState.calYear;
  var month=eventsState.calMonth;

  var titleEl=$("calTitle");
  if(titleEl) titleEl.textContent=evtMonthAbbr(month)+" "+year;

  var gridEl=$("calDays");
  if(!gridEl) return;
  gridEl.innerHTML="";

  var dows=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  dows.forEach(function(d){
    var cell=document.createElement("div");
    cell.className="event-calendar-dow";
    cell.textContent=d;
    gridEl.appendChild(cell);
  });

  var firstDow=new Date(year,month,1).getDay();
  var daysInMonth=new Date(year,month+1,0).getDate();
  var todayISO=now.toISOString().slice(0,10);

  var evDays={};
  (eventsState.list||[]).forEach(function(ev){
    var iso=(ev.startAt||"").slice(0,10);
    if(iso){
      if(!evDays[iso]) evDays[iso]=(ev.category||"other").toLowerCase();
    }
  });

  var prevLast=new Date(year,month,0).getDate();
  for(var p=0;p<firstDow;p++){
    var pad=document.createElement("div");
    pad.className="event-calendar-day other-month";
    pad.textContent=prevLast-firstDow+1+p;
    gridEl.appendChild(pad);
  }

  for(var d=1;d<=daysInMonth;d++){
    var iso=year+"-"+String(month+1).padStart(2,"0")+"-"+String(d).padStart(2,"0");
    var cls="event-calendar-day";
    if(iso===todayISO) cls+=" today";
    if(iso===eventsState.selectedDay) cls+=" selected";
    if(evDays[iso]) cls+=" has-events event-cat--"+evDays[iso];
    var cell=document.createElement("div");
    cell.className=cls;
    cell.textContent=d;
    cell.setAttribute("data-iso",iso);
    cell.onclick=function(){
      var clicked=this.getAttribute("data-iso");
      eventsState.selectedDay=(eventsState.selectedDay===clicked)?null:clicked;
      renderEventsCalendar();
      renderEventsList();
    };
    gridEl.appendChild(cell);
  }

  var totalCells=firstDow+daysInMonth;
  var rem=totalCells%7===0?0:7-(totalCells%7);
  for(var r=1;r<=rem;r++){
    var pad=document.createElement("div");
    pad.className="event-calendar-day other-month";
    pad.textContent=r;
    gridEl.appendChild(pad);
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
    var calPrevBtn=$("calPrev");
    var calNextBtn=$("calNext");
    if(calPrevBtn) calPrevBtn.onclick=function(){
      eventsState.calMonth--;
      if(eventsState.calMonth<0){ eventsState.calMonth=11; eventsState.calYear--; }
      renderEventsCalendar();
    };
    if(calNextBtn) calNextBtn.onclick=function(){
      eventsState.calMonth++;
      if(eventsState.calMonth>11){ eventsState.calMonth=0; eventsState.calYear++; }
      renderEventsCalendar();
    };
    eventsState.bound=true;
  }
  await loadEvents(eventsState.range || "month");
  renderEventsList();
  renderEventsCalendar();
  loadEventStats();
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
          confirmLocalBusiness: $("localBizConfirm").checked ? 1 : 0
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
          $("localBizCity").value=tc.address?.city || "Sebastian";
          $("localBizState").value=tc.state || "FL";
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

const MARKET_PAGE_SIZE = 24;
let marketFilter = null; // null = show category cards, string = show listings for that category
let marketVisible = MARKET_PAGE_SIZE;

async function loadMarketplaceData(){
  const districts=getDistrictOptions();
  market.districts=districts;
  const listings=await api("/market/listings?townId="+(tc.id||1));
  market.listings=listings;
  const cats=new Set();
  listings.forEach(l=>{
    const c = l.offerCategory || "";
    if(c) cats.add(c);
  });
  market.categories=[...cats].sort();
}

async function loadAuctionData(){
  const listings=await api("/market/auctions?townId="+(tc.id||1));
  market.auctions=listings;
}

function getCategoryThumb(cat){
  const match = market.listings.find(l=>(l.offerCategory||"")===cat && (l.photoUrls||l.photourls||[]).length);
  if(!match) return "";
  return (match.photoUrls || match.photourls || [])[0] || "";
}

function getCategoryCount(cat){
  return market.listings.filter(l=>(l.offerCategory||"")===cat).length;
}

function renderCategoryCards(){
  const items=$("marketItems");
  const empty=$("marketEmpty");
  const backBar=$("marketBackBar");
  const showMoreWrap=$("marketShowMore");
  if(!items) return;
  items.innerHTML="";
  if(backBar) backBar.style.display="none";
  if(showMoreWrap) showMoreWrap.style.display="none";
  if(!market.categories.length){
    if(empty) empty.style.display="block";
    return;
  }
  if(empty) empty.style.display="none";
  market.categories.forEach(cat=>{
    const thumb=getCategoryThumb(cat);
    const count=getCategoryCount(cat);
    const card=document.createElement("div");
    card.className="marketCatCard";
    card.innerHTML=`
      ${thumb ? `<img src="${thumb}" alt="">` : `<div style="width:100%;height:140px;background:rgba(255,255,255,0.06);"></div>`}
      <div class="catInfo">
        <div class="catName">${cat}</div>
        <div class="catCount">${count} product${count!==1?"s":""}</div>
      </div>
    `;
    card.onclick=()=>{ marketFilter=cat; marketVisible=MARKET_PAGE_SIZE; renderMarketplace(); };
    items.appendChild(card);
  });
}

function renderListingCard(l){
  const div=document.createElement("div");
  div.className="item";
  const price = Number.isFinite(Number(l.price)) ? `$${Number(l.price).toFixed(2)}` : "—";
  const photos = l.photoUrls || l.photourls || [];
  const firstPhoto = photos[0] || "";
  const sType = l.storeType || l.storetype || "peer";
  const isClean = (sType === "managed" || sType === "promoted");

  if(isClean){
    const cat = l.offerCategory || l.offercategory || "";
    const catTag = cat ? `<span style="display:inline-block;font-size:11px;padding:2px 8px;border-radius:6px;background:rgba(255,255,255,.08);color:#94a3b8;margin-bottom:6px;">${cat}</span>` : "";
    const imgBlock = firstPhoto ? `<img src="${firstPhoto}" alt="" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;border:1px solid rgba(255,255,255,.08);" />` : "";
    div.style.cssText = "cursor:pointer;";
    div.onclick = () => { window.location.href = "/store/" + (l.placeId || l.placeid) + "?listing=" + l.id; };
    div.innerHTML = `
      ${imgBlock}
      <div style="padding:8px 0;">
        ${catTag}
        <div style="font-weight:600;font-size:14px;color:#e2e8f0;">${l.title || "Listing"}</div>
        <div style="font-size:13px;color:#94a3b8;margin-top:2px;">${l.placeName || "Store"} &middot; ${price}</div>
      </div>
    `;
  } else {
    const desc = (l.description || "").toString().trim();
    const shortDesc = desc.length > 80 ? `${desc.slice(0,77)}...` : desc;
    const imgHtml = firstPhoto ? `<img src="${firstPhoto}" alt="" style="width:80px;height:80px;object-fit:cover;border-radius:10px;border:1px solid rgba(255,255,255,.12);margin-right:12px;" />` : "";
    div.innerHTML=`
      <div style="display:flex;">
        ${imgHtml}
        <div style="flex:1;">
          <div><strong>${l.title || "Listing"}</strong></div>
          <div class="muted">${shortDesc || "No description"}</div>
          <div class="muted">${l.placeName || "Store"} • ${price}</div>
          <div class="row" style="margin-top:8px;gap:8px;">
            <a class="btn" href="/store/${l.placeId}?listing=${l.id}">Add to Cart</a>
            <a class="btn btn-outline" href="/store/${l.placeId}">Open Store</a>
          </div>
        </div>
      </div>
    `;
  }
  return div;
}

function renderMarketplace(){
  // If no filter selected, show category cards
  if(marketFilter===null){ renderCategoryCards(); return; }
  const items=$("marketItems");
  const empty=$("marketEmpty");
  const backBar=$("marketBackBar");
  const showMoreWrap=$("marketShowMore");
  if(!items) return;
  items.innerHTML="";
  // Show back button
  if(backBar){
    backBar.style.display="block";
    const backBtn=$("marketBackBtn");
    if(backBtn) backBtn.onclick=()=>{ marketFilter=null; renderMarketplace(); };
  }
  const filtered=market.listings.filter(l=>(l.offerCategory||"")===marketFilter);
  if(!filtered.length){
    if(empty) empty.style.display="block";
    if(showMoreWrap) showMoreWrap.style.display="none";
    return;
  }
  if(empty) empty.style.display="none";
  const visible=filtered.slice(0, marketVisible);
  visible.forEach(l=>items.appendChild(renderListingCard(l)));
  if(showMoreWrap){
    if(marketVisible < filtered.length){
      showMoreWrap.style.display="block";
      const btn=$("marketShowMoreBtn");
      if(btn) btn.onclick=()=>{ marketVisible+=MARKET_PAGE_SIZE; renderMarketplace(); };
    } else {
      showMoreWrap.style.display="none";
    }
  }
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
  const photos = l.photoUrls || l.photourls || [];
  const firstPhoto = photos[0] || "";
  const imgHtml = firstPhoto ? `<img src="${firstPhoto}" style="width:100%;max-height:150px;object-fit:cover;border-radius:8px;margin-bottom:8px;">` : "";
  div.innerHTML=`
    ${imgHtml}
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

function loadSafetyPulse() {
  const safetyDash = document.getElementById("safetyDashboard");
  if(!safetyDash) return;

  safetyDash.innerHTML = `
    <div style="background:#1e293b; border:1px solid var(--border); border-radius:16px; overflow:hidden; margin-bottom:12px;">

      <!-- Header -->
      <div style="padding:20px 20px 16px; display:flex; justify-content:space-between; align-items:flex-start;">
        <div>
          <h4 style="margin:0; color:#ef4444; font-size:1.25rem; font-weight:700; display:flex; align-items:center; gap:8px;">🛡️ Safety Pulse</h4>
          <div style="font-size:0.85rem; color:#94a3b8; margin-top:6px;">${tc.safety?.headerLabel || "Sebastian, FL • Community Safety"}</div>
        </div>
      </div>

      <!-- Safety Grade -->
      <div style="padding:20px; background:linear-gradient(135deg, rgba(108,196,161,0.15), rgba(30,41,59,0.95)); border-top:1px solid var(--border); border-bottom:1px solid var(--border);">
        <div style="display:flex; align-items:center; gap:20px;">
          <div style="background:rgba(108,196,161,0.2); border:2px solid #6cc4a1; border-radius:50%; width:80px; height:80px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
            <span style="font-size:2.5rem; font-weight:700; color:#6cc4a1;">A</span>
          </div>
          <div>
            <div style="font-size:1.1rem; font-weight:600; color:#6cc4a1;">Safety Grade: Excellent</div>
            <div style="font-size:0.85rem; color:#94a3b8; margin-top:4px;">${tc.safety?.countyStatText || "Indian River County is safer than 99% of US counties"}</div>
            <div style="font-size:0.75rem; color:#64748b; margin-top:4px;">Source: CrimeGrade.org 2025</div>
          </div>
        </div>
      </div>

      <!-- Emergency Contacts -->
      <div style="padding:20px;">
        <div style="font-size:0.7rem; text-transform:uppercase; letter-spacing:1px; color:#94a3b8; margin-bottom:14px; font-weight:600;">Emergency Contacts</div>
        <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:12px;">
          <a href="tel:911" style="text-decoration:none; color:inherit; display:block; background:#273449; border:1px solid var(--border); border-radius:12px; padding:14px; cursor:pointer;">
            <div style="font-size:0.75rem; color:#94a3b8; margin-bottom:8px; display:flex; align-items:center; gap:8px;">
              <span style="font-size:1.1rem;">🚨</span> Emergency
            </div>
            <div style="font-size:1.5rem; font-weight:700; color:#ef4444;">911</div>
            <div style="font-size:0.8rem; color:#94a3b8; margin-top:4px;">Police, Fire, Medical</div>
          </a>
          <a href="tel:7725696700" style="text-decoration:none; color:inherit; display:block; background:#273449; border:1px solid var(--border); border-radius:12px; padding:14px; cursor:pointer;">
            <div style="font-size:0.75rem; color:#94a3b8; margin-bottom:8px; display:flex; align-items:center; gap:8px;">
              <span style="font-size:1.1rem;">🏛️</span> Non-Emergency
            </div>
            <div style="font-size:1.25rem; font-weight:700; color:#e2e8f0;">${tc.contact?.nonEmergencyPhone || "(772) 569-6700"}</div>
            <div style="font-size:0.8rem; color:#94a3b8; margin-top:4px;">${tc.contact?.nonEmergencyLabel || "IRC Sheriff's Office"}</div>
          </a>
          <a href="tel:8884043922" style="text-decoration:none; color:inherit; display:block; background:#273449; border:1px solid var(--border); border-radius:12px; padding:14px; cursor:pointer;">
            <div style="font-size:0.75rem; color:#94a3b8; margin-bottom:8px; display:flex; align-items:center; gap:8px;">
              <span style="font-size:1.1rem;">🐊</span> Wildlife
            </div>
            <div style="font-size:1.25rem; font-weight:700; color:#e2e8f0;">(888) 404-3922</div>
            <div style="font-size:0.8rem; color:#94a3b8; margin-top:4px;">FWC • Gator/Snake</div>
          </a>
          <a href="tel:8002271922" style="text-decoration:none; color:inherit; display:block; background:#273449; border:1px solid var(--border); border-radius:12px; padding:14px; cursor:pointer;">
            <div style="font-size:0.75rem; color:#94a3b8; margin-bottom:8px; display:flex; align-items:center; gap:8px;">
              <span style="font-size:1.1rem;">⚡</span> Power Outage
            </div>
            <div style="font-size:1.25rem; font-weight:700; color:#e2e8f0;">(800) 227-1922</div>
            <div style="font-size:0.8rem; color:#94a3b8; margin-top:4px;">FPL Outage Line</div>
          </a>
        </div>
      </div>

      <!-- Current Status -->
      <div style="padding:0 20px 20px;">
        <div style="font-size:0.7rem; text-transform:uppercase; letter-spacing:1px; color:#94a3b8; margin-bottom:14px; font-weight:600;">Current Status</div>
        <div style="display:flex; flex-direction:column; gap:8px;">
          <div style="background:#273449; border-radius:10px; padding:12px 14px; display:flex; align-items:center; justify-content:space-between;">
            <div style="display:flex; align-items:center; gap:10px;">
              <span style="font-size:1.1rem;">🌀</span>
              <span style="font-size:0.9rem; color:#e2e8f0;">Hurricane Watch</span>
            </div>
            <span style="background:rgba(108,196,161,0.2); color:#6cc4a1; padding:4px 10px; border-radius:20px; font-size:0.75rem; font-weight:500;">None Active</span>
          </div>
          <div style="background:#273449; border-radius:10px; padding:12px 14px; display:flex; align-items:center; justify-content:space-between;">
            <div style="display:flex; align-items:center; gap:10px;">
              <span style="font-size:1.1rem;">⚡</span>
              <span style="font-size:0.9rem; color:#e2e8f0;">Power Outages</span>
            </div>
            <span style="background:rgba(108,196,161,0.2); color:#6cc4a1; padding:4px 10px; border-radius:20px; font-size:0.75rem; font-weight:500;">All Clear</span>
          </div>
          <div style="background:#273449; border-radius:10px; padding:12px 14px; display:flex; align-items:center; justify-content:space-between;">
            <div style="display:flex; align-items:center; gap:10px;">
              <span style="font-size:1.1rem;">🚧</span>
              <span style="font-size:0.9rem; color:#e2e8f0;">Road Closures</span>
            </div>
            <span style="background:rgba(108,196,161,0.2); color:#6cc4a1; padding:4px 10px; border-radius:20px; font-size:0.75rem; font-weight:500;">None</span>
          </div>
          <div style="background:#273449; border-radius:10px; padding:12px 14px; display:flex; align-items:center; justify-content:space-between;">
            <div style="display:flex; align-items:center; gap:10px;">
              <span style="font-size:1.1rem;">🏖️</span>
              <span style="font-size:0.9rem; color:#e2e8f0;">Beach Status</span>
            </div>
            <span style="background:rgba(108,196,161,0.2); color:#6cc4a1; padding:4px 10px; border-radius:20px; font-size:0.75rem; font-weight:500;">Open</span>
          </div>
        </div>
      </div>

      <!-- Stats -->
      <div style="padding:0 20px 20px;">
        <div style="font-size:0.7rem; text-transform:uppercase; letter-spacing:1px; color:#94a3b8; margin-bottom:14px; font-weight:600;">${tc.safety?.areaLabel || "Sebastian Area • Last 30 Days"}</div>
        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:12px;">
          <div style="background:#273449; border-radius:10px; padding:14px; text-align:center;">
            <div style="font-size:1.5rem; font-weight:700; color:#e2e8f0;">12</div>
            <div style="font-size:0.7rem; color:#94a3b8; text-transform:uppercase; letter-spacing:0.5px; margin-top:4px;">Incidents</div>
            <div style="font-size:0.75rem; color:#6cc4a1; margin-top:6px;">↓ 8% vs last month</div>
          </div>
          <div style="background:#273449; border-radius:10px; padding:14px; text-align:center;">
            <div style="font-size:1.5rem; font-weight:700; color:#e2e8f0;">0</div>
            <div style="font-size:0.7rem; color:#94a3b8; text-transform:uppercase; letter-spacing:0.5px; margin-top:4px;">Violent</div>
            <div style="font-size:0.75rem; color:#6cc4a1; margin-top:6px;">Same</div>
          </div>
          <div style="background:#273449; border-radius:10px; padding:14px; text-align:center;">
            <div style="font-size:1.5rem; font-weight:700; color:#e2e8f0;">4</div>
            <div style="font-size:0.7rem; color:#94a3b8; text-transform:uppercase; letter-spacing:0.5px; margin-top:4px;">Theft</div>
            <div style="font-size:0.75rem; color:#6cc4a1; margin-top:6px;">↓ 2</div>
          </div>
        </div>
      </div>

      <!-- Crime Map -->
      <div style="padding:0 20px 20px;">
        <div style="font-size:0.7rem; text-transform:uppercase; letter-spacing:1px; color:#94a3b8; margin-bottom:14px; font-weight:600;">Crime Map</div>
        <div style="background:#273449; border:1px dashed var(--border); border-radius:12px; padding:24px; text-align:center;">
          <div style="font-size:2rem; margin-bottom:12px;">🗺️</div>
          <div style="font-size:0.9rem; color:#e2e8f0; margin-bottom:4px;">${tc.safety?.incidentsLabel || "View recent incidents in Indian River County"}</div>
          <div style="font-size:0.8rem; color:#94a3b8; margin-bottom:16px;">Data from CrimeMapping.com</div>
          <a href="https://www.crimemapping.com/map/fl/indianrivercounty" target="_blank" style="display:inline-block; background:#2fa4b9; color:white; border:none; padding:12px 24px; border-radius:8px; font-size:0.9rem; font-weight:500; cursor:pointer; text-decoration:none;">Open Crime Map →</a>
        </div>
      </div>

      <!-- Resources -->
      <div style="padding:0 20px 20px;">
        <div style="font-size:0.7rem; text-transform:uppercase; letter-spacing:1px; color:#94a3b8; margin-bottom:14px; font-weight:600;">Resources</div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div style="background:#273449; border:1px solid var(--border); border-radius:12px; padding:16px;">
            <div style="font-size:0.9rem; font-weight:600; color:#e2e8f0; margin-bottom:12px; display:flex; align-items:center; gap:8px;">🌀 Hurricane Prep</div>
            <div style="display:flex; flex-direction:column; gap:8px;">
              <a href="https://www.ircgov.com/EmergencyServices/EmergencyManagement/" target="_blank" style="display:block; font-size:0.85rem; color:#2fa4b9; cursor:pointer; text-decoration:none;">IRC Emergency Management →</a>
              <a href="https://www.weather.gov/mlb/" target="_blank" style="display:block; font-size:0.85rem; color:#2fa4b9; cursor:pointer; text-decoration:none;">NWS Melbourne Forecast →</a>
              <a href="https://www.ircgov.com/EmergencyServices/EmergencyManagement/Shelters.htm" target="_blank" style="display:block; font-size:0.85rem; color:#2fa4b9; cursor:pointer; text-decoration:none;">Shelter Locations →</a>
            </div>
          </div>
          <div style="background:#273449; border:1px solid var(--border); border-radius:12px; padding:16px;">
            <div style="font-size:0.9rem; font-weight:600; color:#e2e8f0; margin-bottom:12px; display:flex; align-items:center; gap:8px;">🏥 Health & Support</div>
            <div style="display:flex; flex-direction:column; gap:8px;">
              <a href="tel:988" style="display:block; font-size:0.85rem; color:#2fa4b9; cursor:pointer; text-decoration:none;">988 Suicide & Crisis Lifeline →</a>
              <a href="https://www.211palmbeach.org/" target="_blank" style="display:block; font-size:0.85rem; color:#2fa4b9; cursor:pointer; text-decoration:none;">211 Community Resources →</a>
              <a href="tel:8002221222" style="display:block; font-size:0.85rem; color:#2fa4b9; cursor:pointer; text-decoration:none;">Poison Control (800) 222-1222 →</a>
            </div>
          </div>
        </div>
      </div>

      <!-- Local Safety Tips -->
      <div style="padding:0 20px 20px;">
        <div style="font-size:0.7rem; text-transform:uppercase; letter-spacing:1px; color:#94a3b8; margin-bottom:14px; font-weight:600;">Local Safety Tips</div>
        <div style="display:flex; flex-direction:column; gap:8px;">
          <div style="background:#273449; border-radius:10px; padding:12px 14px; display:flex; align-items:center; gap:12px;">
            <span style="font-size:1.2rem;">🐊</span>
            <div style="font-size:0.85rem; color:#e2e8f0;">Stay 15+ feet from water edges at dusk — gators are most active at twilight.</div>
          </div>
          <div style="background:#273449; border-radius:10px; padding:12px 14px; display:flex; align-items:center; gap:12px;">
            <span style="font-size:1.2rem;">🌊</span>
            <div style="font-size:0.85rem; color:#e2e8f0;">Check rip current conditions before swimming at the inlet or beach.</div>
          </div>
          <div style="background:#273449; border-radius:10px; padding:12px 14px; display:flex; align-items:center; gap:12px;">
            <span style="font-size:1.2rem;">🐍</span>
            <div style="font-size:0.85rem; color:#e2e8f0;">Watch for Eastern Diamondbacks on trails — give snakes space, don't approach.</div>
          </div>
          <div style="background:#273449; border-radius:10px; padding:12px 14px; display:flex; align-items:center; gap:12px;">
            <span style="font-size:1.2rem;">⛈️</span>
            <div style="font-size:0.85rem; color:#e2e8f0;">Lightning capital of the US — get inside when you hear thunder.</div>
          </div>
        </div>
      </div>

      <!-- Recent Alerts -->
      <div style="padding:0 20px 20px;">
        <div style="font-size:0.7rem; text-transform:uppercase; letter-spacing:1px; color:#94a3b8; margin-bottom:14px; font-weight:600;">Recent Updates • IRCSO</div>
        <div style="display:flex; flex-direction:column; gap:10px;">
          <div style="background:#273449; border-radius:10px; padding:14px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span style="display:flex; align-items:center; gap:6px; font-size:0.75rem; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; color:#6cc4a1;">✓ Resolved</span>
              <span style="font-size:0.7rem; color:#64748b;">2 days ago</span>
            </div>
            <div style="font-size:0.85rem; color:#e2e8f0; line-height:1.4;">Missing person from Vero Lake Estates located safely.</div>
            <div style="font-size:0.75rem; color:#64748b; margin-top:8px;">Source: IRCSO Facebook</div>
          </div>
          <div style="background:#273449; border-radius:10px; padding:14px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span style="display:flex; align-items:center; gap:6px; font-size:0.75rem; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; color:#2fa4b9;">🚔 Arrest</span>
              <span style="font-size:0.7rem; color:#64748b;">3 days ago</span>
            </div>
            <div style="font-size:0.85rem; color:#e2e8f0; line-height:1.4;">Suspect arrested in connection with vehicle burglaries in ${tc.name || "Sebastian"} area.</div>
            <div style="font-size:0.75rem; color:#64748b; margin-top:8px;">Source: IRCSO Press Release</div>
          </div>
          <div style="background:#273449; border-radius:10px; padding:14px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span style="display:flex; align-items:center; gap:6px; font-size:0.75rem; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; color:#eab308;">⚠️ Advisory</span>
              <span style="font-size:0.7rem; color:#64748b;">1 week ago</span>
            </div>
            <div style="font-size:0.85rem; color:#e2e8f0; line-height:1.4;">Reminder: Lock vehicles and remove valuables. Recent uptick in car break-ins countywide.</div>
            <div style="font-size:0.75rem; color:#64748b; margin-top:8px;">Source: IRCSO Community Alert</div>
          </div>
        </div>
      </div>

    </div>
  `;
}

async function loadFishingConditions() {
  const fishDash = document.getElementById("fishingDashboard");
  if(!fishDash) return;

  // Show loading state
  fishDash.innerHTML = `
    <div style="background:var(--card); border:1px solid var(--border); border-radius:12px; padding:16px;">
      <h4 style="margin:0 0 12px 0; color:var(--accent); font-size:1rem;">🎣 Water Conditions</h4>
      <div style="color:#94a3b8;">Loading NOAA data...</div>
    </div>
  `;

  try {
    const stationId = "8721604";
    const baseUrl = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";

    // Calculate time range for trend data (last 3 hours)
    const now = new Date();
    const threeHoursAgoDate = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const pad = n => n.toString().padStart(2, '0');
    const nowStr = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const threeHoursAgo = `${threeHoursAgoDate.getFullYear()}${pad(threeHoursAgoDate.getMonth()+1)}${pad(threeHoursAgoDate.getDate())} ${pad(threeHoursAgoDate.getHours())}:${pad(threeHoursAgoDate.getMinutes())}`;

    // Fetch multiple products in parallel
    const [tideRes, waterTempRes, airTempRes, windRes, pressureRes, waterLevelRes] = await Promise.all([
      fetch(`${baseUrl}?date=today&station=${stationId}&product=predictions&datum=MLLW&time_zone=lst_ldt&units=english&interval=hilo&format=json`),
      fetch(`${baseUrl}?date=latest&station=${stationId}&product=water_temperature&units=english&time_zone=lst_ldt&format=json`),
      fetch(`${baseUrl}?date=latest&station=${stationId}&product=air_temperature&units=english&time_zone=lst_ldt&format=json`),
      fetch(`${baseUrl}?date=latest&station=${stationId}&product=wind&units=english&time_zone=lst_ldt&format=json`),
      fetch(`${baseUrl}?begin_date=${threeHoursAgo}&end_date=${nowStr}&station=${stationId}&product=air_pressure&units=english&time_zone=lst_ldt&format=json`),
      fetch(`${baseUrl}?begin_date=${threeHoursAgo}&end_date=${nowStr}&station=${stationId}&product=water_level&datum=MLLW&units=english&time_zone=lst_ldt&format=json`)
    ]);

    const [tideData, waterTempData, airTempData, windData, pressureData, waterLevelData] = await Promise.all([
      tideRes.json(),
      waterTempRes.json(),
      airTempRes.json(),
      windRes.json(),
      pressureRes.json(),
      waterLevelRes.json()
    ]);

    // Extract values (with fallbacks)
    const waterTemp = waterTempData?.data?.[0]?.v || "N/A";
    const airTemp = airTempData?.data?.[0]?.v || "N/A";
    const windSpeed = windData?.data?.[0]?.s || "N/A";
    const windDir = windData?.data?.[0]?.dr || "";
    const windGust = windData?.data?.[0]?.g || "";
    // Calculate pressure with trend
    let pressure = "N/A";
    let pressureTrend = "";
    if(pressureData?.data?.length > 1) {
      const oldest = parseFloat(pressureData.data[0].v);
      const latest = parseFloat(pressureData.data[pressureData.data.length - 1].v);
      pressure = latest.toFixed(1);
      const diff = latest - oldest;
      if(diff < -0.02) pressureTrend = "falling";
      else if(diff > 0.02) pressureTrend = "rising";
      else pressureTrend = "steady";
    } else if(pressureData?.data?.[0]?.v) {
      pressure = parseFloat(pressureData.data[0].v).toFixed(1);
    }

    // Calculate water level with trend
    let waterLevel = "N/A";
    let waterLevelTrend = "";
    if(waterLevelData?.data?.length > 1) {
      const oldest = parseFloat(waterLevelData.data[0].v);
      const latest = parseFloat(waterLevelData.data[waterLevelData.data.length - 1].v);
      waterLevel = latest.toFixed(2);
      const diff = latest - oldest;
      if(diff > 0.1) waterLevelTrend = "rising";
      else if(diff < -0.1) waterLevelTrend = "falling";
      else waterLevelTrend = "slack";
    } else if(waterLevelData?.data?.[0]?.v) {
      waterLevel = parseFloat(waterLevelData.data[0].v).toFixed(2);
    }

    // Calculate fishing score (0-100)
    let fishingScore = 50; // base score
    let scoreReasons = [];

    // Pressure trend
    if(pressureTrend === 'falling') { fishingScore += 15; scoreReasons.push('Falling pressure'); }
    else if(pressureTrend === 'rising') { fishingScore -= 5; }

    // Tide movement
    if(waterLevelTrend === 'rising' || waterLevelTrend === 'falling') { fishingScore += 10; scoreReasons.push(waterLevelTrend === 'rising' ? 'Rising tide' : 'Falling tide'); }

    // Water temp (ideal: 65-78°F for most species)
    const waterTempNum = parseFloat(waterTemp);
    if(waterTempNum >= 65 && waterTempNum <= 78) { fishingScore += 10; scoreReasons.push('Good water temp'); }
    else if(waterTempNum < 60 || waterTempNum > 85) { fishingScore -= 10; }

    // Wind (calm is better)
    const windSpeedNum = parseFloat(windSpeed);
    if(windSpeedNum < 10) { fishingScore += 10; scoreReasons.push('Light wind'); }
    else if(windSpeedNum > 20) { fishingScore -= 15; scoreReasons.push('High wind'); }
    else if(windSpeedNum > 15) { fishingScore -= 5; }

    // Clamp score
    fishingScore = Math.max(0, Math.min(100, fishingScore));

    // Determine verdict
    let fishingVerdict = 'Poor';
    if(fishingScore >= 80) fishingVerdict = 'Excellent';
    else if(fishingScore >= 65) fishingVerdict = 'Good';
    else if(fishingScore >= 45) fishingVerdict = 'Fair';

    // Format tides
    let tidesHtml = "";
    if(tideData.predictions && tideData.predictions.length > 0) {
      tidesHtml = tideData.predictions.slice(0, 4).map(p => {
        const time = new Date(p.t).toLocaleTimeString("en-US", {hour: "numeric", minute: "2-digit"});
        const type = p.type === "H" ? "High" : "Low";
        const heightNum = parseFloat(p.v);
        const heightStr = (heightNum >= 0 ? "+" : "") + heightNum.toFixed(2) + " ft";
        return `<div style="display:flex; align-items:center; justify-content:space-between; padding:12px 14px; background:#273449; border-radius:10px;">
          <span style="width:50px; font-size:0.85rem; color:#94a3b8; font-weight:500;">${type}</span>
          <span style="flex:1; text-align:center; font-weight:600; color:#e2e8f0; font-size:1rem;">${time}</span>
          <span style="width:75px; text-align:right; font-size:0.9rem; font-weight:500; color:${heightNum >= 0 ? '#6cc4a1' : '#94a3b8'};">${heightStr}</span>
        </div>`;
      }).join("");
    }

    // Calculate next tide
    let nextTideText = "";
    if(tideData.predictions) {
      for(const p of tideData.predictions) {
        const tideTime = new Date(p.t);
        if(tideTime > now) {
          const diffMs = tideTime - now;
          const diffHrs = Math.floor(diffMs / 3600000);
          const diffMins = Math.floor((diffMs % 3600000) / 60000);
          const type = p.type === "H" ? "High" : "Low";
          nextTideText = `Next: <strong>${type} tide</strong> in <strong style="color:var(--accent);">${diffHrs}h ${diffMins}m</strong>`;
          break;
        }
      }
    }

    // Build the dashboard HTML
    fishDash.innerHTML = `
      <div style="background:#1e293b; border:1px solid var(--border); border-radius:16px; overflow:hidden; margin-bottom:12px;">

        <!-- Header -->
        <div style="padding:20px 20px 16px; display:flex; justify-content:space-between; align-items:flex-start;">
          <div>
            <h4 style="margin:0; color:var(--accent); font-size:1.25rem; font-weight:700; display:flex; align-items:center; gap:8px;">🎣 Water Conditions</h4>
            <div style="font-size:0.85rem; color:#94a3b8; margin-top:6px;">${tc.safety?.marineLabel || "Sebastian Inlet • Port Canaveral"}</div>
          </div>
          <button onclick="loadFishingConditions()" style="background:transparent; border:1px solid var(--border); color:#94a3b8; padding:8px; border-radius:8px; cursor:pointer; font-size:1rem;">🔄</button>
        </div>

        <!-- Fishing Score - Centered -->
        <div style="padding:24px 20px; background:linear-gradient(135deg, rgba(47,164,185,0.15), rgba(30,41,59,0.95)); border-top:1px solid var(--border); border-bottom:1px solid var(--border);">
          <div style="display:flex; flex-direction:column; align-items:center; text-align:center;">
            <div style="position:relative; width:120px; height:120px;">
              <svg width="120" height="120" viewBox="0 0 120 120" style="transform:rotate(-90deg);">
                <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="10"/>
                <circle cx="60" cy="60" r="52" fill="none" stroke="${fishingScore >= 80 ? '#6cc4a1' : fishingScore >= 65 ? '#2fa4b9' : fishingScore >= 45 ? '#eab308' : '#ef4444'}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${2 * Math.PI * 52}" stroke-dashoffset="${2 * Math.PI * 52 * (1 - fishingScore / 100)}" style="transition:stroke-dashoffset 0.5s ease;"/>
              </svg>
              <div style="position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center;">
                <span style="font-size:2.5rem; font-weight:700; color:${fishingScore >= 80 ? '#6cc4a1' : fishingScore >= 65 ? '#2fa4b9' : fishingScore >= 45 ? '#eab308' : '#ef4444'};">${fishingScore}</span>
                <span style="font-size:0.75rem; color:#94a3b8;">/ 100</span>
              </div>
            </div>
            <div style="margin-top:16px;">
              <div style="font-size:1.25rem; font-weight:600; color:${fishingScore >= 80 ? '#6cc4a1' : fishingScore >= 65 ? '#2fa4b9' : fishingScore >= 45 ? '#eab308' : '#ef4444'};">${fishingVerdict} Conditions</div>
              <div style="font-size:0.85rem; color:#94a3b8; margin-top:6px;">${scoreReasons.length > 0 ? scoreReasons.join(', ') : 'Average conditions'}</div>
            </div>
          </div>
        </div>

        <!-- Conditions Grid -->
        <div style="padding:20px;">
          <div style="font-size:0.7rem; text-transform:uppercase; letter-spacing:1px; color:#94a3b8; margin-bottom:14px; font-weight:600;">Current Conditions</div>
          <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:12px;">

            <!-- Water Temp -->
            <div style="background:#273449; border:1px solid var(--border); border-radius:12px; padding:14px;">
              <div style="font-size:0.75rem; color:#94a3b8; margin-bottom:10px; display:flex; align-items:center; gap:8px;">
                <span style="font-size:1.1rem;">🌡️</span> Water Temp
              </div>
              <div style="font-size:1.75rem; font-weight:700; color:#e2e8f0;">${waterTemp}<span style="font-size:0.9rem; color:#94a3b8; font-weight:400; margin-left:2px;">°F</span></div>
              ${airTemp !== "N/A" ? `<div style="font-size:0.8rem; color:#94a3b8; margin-top:6px;">Air: ${airTemp}°F</div>` : ''}
            </div>

            <!-- Wind -->
            <div style="background:#273449; border:1px solid var(--border); border-radius:12px; padding:14px;">
              <div style="font-size:0.75rem; color:#94a3b8; margin-bottom:10px; display:flex; align-items:center; gap:8px;">
                <span style="font-size:1.1rem;">💨</span> Wind
              </div>
              <div style="font-size:1.75rem; font-weight:700; color:#e2e8f0;">${windSpeed}<span style="font-size:0.9rem; color:#94a3b8; font-weight:400; margin-left:2px;">mph</span></div>
              ${windDir ? `<div style="font-size:0.8rem; color:#94a3b8; margin-top:6px;">${windDir}${windGust ? ' • Gusts ' + windGust + ' mph' : ''}</div>` : ''}
            </div>

            <!-- Pressure -->
            <div style="background:${pressureTrend === 'falling' ? 'rgba(47,164,185,0.15)' : 'rgba(255,255,255,0.04)'}; border:1px solid ${pressureTrend === 'falling' ? 'rgba(47,164,185,0.4)' : 'var(--border)'}; border-radius:12px; padding:14px;">
              <div style="font-size:0.75rem; color:#94a3b8; margin-bottom:10px; display:flex; align-items:center; justify-content:space-between;">
                <span style="display:flex; align-items:center; gap:8px;"><span style="font-size:1.1rem;">📊</span> Pressure</span>
                ${pressureTrend ? `<span style="font-size:1rem; color:${pressureTrend === 'falling' ? 'var(--accent)' : '#94a3b8'};">${pressureTrend === 'falling' ? '↓' : pressureTrend === 'rising' ? '↑' : '→'}</span>` : ''}
              </div>
              <div style="font-size:1.75rem; font-weight:700; color:#e2e8f0;">${pressure}<span style="font-size:0.9rem; color:#94a3b8; font-weight:400; margin-left:2px;">mb</span></div>
              ${pressureTrend === 'falling' ? `<div style="font-size:0.8rem; color:var(--accent); margin-top:6px;">Falling ↓ Good for fishing!</div>` : ''}
            </div>

            <!-- Water Level -->
            <div style="background:#273449; border:1px solid var(--border); border-radius:12px; padding:14px;">
              <div style="font-size:0.75rem; color:#94a3b8; margin-bottom:10px; display:flex; align-items:center; justify-content:space-between;">
                <span style="display:flex; align-items:center; gap:8px;"><span style="font-size:1.1rem;">🌊</span> Water Level</span>
                ${waterLevelTrend ? `<span style="font-size:1rem; color:${waterLevelTrend === 'rising' ? '#6cc4a1' : waterLevelTrend === 'falling' ? 'var(--accent)' : '#94a3b8'};">${waterLevelTrend === 'rising' ? '↑' : waterLevelTrend === 'falling' ? '↓' : '→'}</span>` : ''}
              </div>
              <div style="font-size:1.75rem; font-weight:700; color:#e2e8f0;">${waterLevel}<span style="font-size:0.9rem; color:#94a3b8; font-weight:400; margin-left:2px;">ft</span></div>
              ${waterLevelTrend ? `<div style="font-size:0.8rem; color:#94a3b8; margin-top:6px;">${waterLevelTrend === 'rising' ? 'Rising tide' : waterLevelTrend === 'falling' ? 'Falling tide' : 'Slack tide'}</div>` : ''}
            </div>

          </div>
        </div>

        <!-- Tides Section -->
        <div style="padding:0 20px 20px;">
          <div style="font-size:0.7rem; text-transform:uppercase; letter-spacing:1px; color:#94a3b8; margin-bottom:14px; font-weight:600;">Today's Tides</div>
          <div style="display:flex; flex-direction:column; gap:8px;">
            ${tidesHtml}
          </div>
          ${nextTideText ? `<div style="display:flex; align-items:center; justify-content:center; gap:10px; padding:14px; background:rgba(47,164,185,0.2); border:1px solid rgba(47,164,185,0.3); border-radius:10px; margin-top:14px; font-size:0.95rem; color:#e2e8f0;">⏱️ ${nextTideText}</div>` : ''}
        </div>

        <!-- Community Section - Two Columns -->
        <div style="padding:0 20px 20px; display:grid; grid-template-columns:1fr 1fr; gap:12px;">

          <!-- Hot Right Now -->
          <div style="background:#273449; border:1px solid var(--border); border-radius:12px; padding:16px;">
            <div style="font-size:0.9rem; font-weight:600; color:#e2e8f0; margin-bottom:14px; display:flex; align-items:center; gap:8px;">📈 Hot Right Now</div>

            <div style="font-size:0.7rem; text-transform:uppercase; letter-spacing:0.5px; color:#94a3b8; margin-bottom:8px;">Top Species</div>
            <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:14px;">
              <span style="background:rgba(47,164,185,0.3); color:var(--accent); padding:5px 10px; border-radius:20px; font-size:0.8rem; font-weight:500;">Redfish</span>
              <span style="background:rgba(47,164,185,0.3); color:var(--accent); padding:5px 10px; border-radius:20px; font-size:0.8rem; font-weight:500;">Snook</span>
              <span style="background:rgba(47,164,185,0.3); color:var(--accent); padding:5px 10px; border-radius:20px; font-size:0.8rem; font-weight:500;">Flounder</span>
            </div>

            <div style="display:flex; gap:16px;">
              <div style="flex:1;">
                <div style="font-size:0.7rem; text-transform:uppercase; letter-spacing:0.5px; color:#94a3b8;">Best Bait</div>
                <div style="font-weight:500; color:#e2e8f0; margin-top:4px;">Live shrimp</div>
              </div>
              <div style="flex:1;">
                <div style="font-size:0.7rem; text-transform:uppercase; letter-spacing:0.5px; color:#94a3b8;">Water Clarity</div>
                <div style="font-weight:500; color:#6cc4a1; margin-top:4px;">Clear</div>
              </div>
            </div>
          </div>

          <!-- Recent Catches -->
          <div style="background:#273449; border:1px solid var(--border); border-radius:12px; padding:16px;">
            <div style="font-size:0.9rem; font-weight:600; color:#e2e8f0; margin-bottom:14px; display:flex; align-items:center; gap:8px;">📍 Recent Catches</div>

            <div style="display:flex; flex-direction:column; gap:10px;">
              <div style="display:flex; align-items:center; justify-content:space-between;">
                <div style="display:flex; align-items:center; gap:10px;">
                  <div style="width:36px; height:36px; background:rgba(47,164,185,0.3); border-radius:50%; display:flex; align-items:center; justify-content:center;">🐟</div>
                  <div>
                    <div style="font-weight:500; color:#e2e8f0; font-size:0.9rem;">3x Redfish</div>
                    <div style="font-size:0.75rem; color:#94a3b8;">Inlet • MikeAtTheInlet</div>
                  </div>
                </div>
                <span style="font-size:0.7rem; color:#94a3b8;">2h ago</span>
              </div>

              <div style="display:flex; align-items:center; justify-content:space-between;">
                <div style="display:flex; align-items:center; gap:10px;">
                  <div style="width:36px; height:36px; background:rgba(47,164,185,0.3); border-radius:50%; display:flex; align-items:center; justify-content:center;">🐟</div>
                  <div>
                    <div style="font-weight:500; color:#e2e8f0; font-size:0.9rem;">1x Snook</div>
                    <div style="font-size:0.75rem; color:#94a3b8;">North Jetty • CaptDave</div>
                  </div>
                </div>
                <span style="font-size:0.7rem; color:#94a3b8;">4h ago</span>
              </div>

              <div style="display:flex; align-items:center; justify-content:space-between;">
                <div style="display:flex; align-items:center; gap:10px;">
                  <div style="width:36px; height:36px; background:rgba(47,164,185,0.3); border-radius:50%; display:flex; align-items:center; justify-content:center;">🐟</div>
                  <div>
                    <div style="font-weight:500; color:#e2e8f0; font-size:0.9rem;">2x Flounder</div>
                    <div style="font-size:0.75rem; color:#94a3b8;">South Side • ReelDeal</div>
                  </div>
                </div>
                <span style="font-size:0.7rem; color:#94a3b8;">5h ago</span>
              </div>
            </div>

            <button style="width:100%; background:transparent; border:none; color:var(--accent); padding:12px; font-size:0.85rem; cursor:pointer; margin-top:12px; border-radius:8px;" onmouseover="this.style.background='rgba(47,164,185,0.1)'" onmouseout="this.style.background='transparent'">See all reports →</button>
          </div>

        </div>

      </div>
    `;
  } catch(err) {
    console.error("Failed to load fishing conditions:", err);
    fishDash.innerHTML = `
      <div style="background:#1e293b; border:1px solid var(--border); border-radius:12px; padding:16px;">
        <h4 style="margin:0 0 12px 0; color:var(--accent); font-size:1rem;">🎣 Water Conditions</h4>
        <div style="color:#94a3b8;">Unable to load conditions</div>
      </div>
    `;
  }
}

// Show subscription prompt modal
function showSubscriptionPrompt(message) {
  const msg = message || "Create a free account to buy, sell, and enter giveaways.";
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
    scheduled: true
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
  if(sweepPanel) sweepPanel.style.display = "";
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
    if(hint) hint.textContent=tc.verification?.residentLabel || "Sebastian Resident+ required to submit prizes.";
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
    console.warn(tc.verification?.residentLabel || "Sebastian Resident+ required for prize offers");
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
  const dashLink = $("navDashboardLink");
  if(dashLink) dashLink.style.display = (access.loggedIn && access.hasStore) ? "inline-flex" : "none";
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
    window.state = state;
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
  const hasStore = !!me.user.hasStore;
  access = { loggedIn:true, eligible: status==="eligible", email, reason, isAdmin, hasStore };
  window.access = access;
  window.state = state;
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
  const center=[tc.location?.lat || 27.816, tc.location?.lng || -80.470];
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

  // Welcome banner for anonymous visitors
  (function() {
    var banner = document.getElementById('welcomeBanner');
    if (banner && !access.loggedIn) {
      banner.style.display = 'block';
    }
  })();

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
