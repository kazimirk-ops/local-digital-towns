const $ = (id) => document.getElementById(id);

function debug(msg){ $("debug").textContent = msg || ""; }

async function api(path, opts) {
  const res = await fetch(path, { credentials: "include", ...(opts||{}) });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

function getPlaceIdFromPath(){
  const parts = window.location.pathname.split("/").filter(Boolean);
  return Number(parts[1]);
}

function escapeHtml(s){
  return (s||"")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function safeMoney(n){
  const x = Number(n);
  if(!Number.isFinite(x)) return "0";
  return x.toFixed(2).replace(/\.00$/, "");
}

let PLACE_ID = null;
let LISTINGS = [];
let TAB = "item";
let SEARCH = "";

function setTab(next){
  TAB = next;
  ["tabItems","tabOffers","tabRequests"].forEach(id=>$(id).classList.remove("active"));
  if(next==="item") $("tabItems").classList.add("active");
  if(next==="offer") $("tabOffers").classList.add("active");
  if(next==="request") $("tabRequests").classList.add("active");
  render();
}

function matches(l){
  if((l.listingType||"item") !== TAB) return false;
  const q = SEARCH.trim().toLowerCase();
  if(!q) return true;
  const t = `${l.title||""} ${l.description||""}`.toLowerCase();
  return t.includes(q);
}

function cardLabel(l){
  const lt = (l.listingType||"item").toUpperCase();
  const ex = (l.exchangeType||"money").toUpperCase();
  const w = (l.startAt || l.endAt) ? ` • ${l.startAt||"?"} → ${l.endAt||"?"}` : "";
  return `${lt} • ${ex}${w}`;
}

function render(){
  const grid = $("listingGrid");
  grid.innerHTML = "";

  const filtered = LISTINGS.filter(matches);
  $("countLbl").textContent = String(filtered.length);

  if(filtered.length === 0){
    grid.innerHTML = `<div class="item"><div style="font-weight:900;">No ${TAB}s found</div><div class="muted">Try a different search or create one.</div></div>`;
    return;
  }

  for(const l of filtered){
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="muted">${escapeHtml(cardLabel(l))}</div>
      <div style="font-weight:900; margin-top:6px;">${escapeHtml(l.title||"")}</div>
      <div class="muted" style="margin-top:6px;">${escapeHtml(l.description||"")}</div>
      <div class="price">$${safeMoney(l.price)}</div>
      <div class="muted">qty ${Number(l.quantity||0)} • status ${escapeHtml((l.status||"").toUpperCase())} • id=${l.id}</div>
    `;
    grid.appendChild(div);
  }
}

function toggleCreateBox(){
  const el = $("createBox");
  el.style.display = (el.style.display === "none" || !el.style.display) ? "block" : "none";
}

async function publish(){
  const payload = {
    listingType: $("newType").value,
    exchangeType: $("newExchange").value,
    title: $("newTitle").value.trim(),
    description: $("newDesc").value,
    startAt: $("newStartAt").value,
    endAt: $("newEndAt").value,
    price: Number($("newPrice").value),
    quantity: Number($("newQty").value),
    status: "active",
    photoUrls: [],
  };

  if(!payload.title) return alert("Title required.");

  try{
    const created = await api(`/places/${PLACE_ID}/listings`, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(payload),
    });

    LISTINGS = [created, ...LISTINGS];
    debug(`✅ Published ${created.listingType} (#${created.id}).`);
    setTab(created.listingType);

    $("newTitle").value = "";
    $("newDesc").value = "";
    $("newStartAt").value = "";
    $("newEndAt").value = "";
    $("newPrice").value = "0";
    $("newQty").value = "1";
  } catch(e){
    alert(e.message);
    debug(`❌ Publish error: ${e.message}`);
  }
}

async function main(){
  PLACE_ID = getPlaceIdFromPath();
  if(!PLACE_ID) return debug("Invalid store URL.");

  // Prove JS is running immediately:
  $("storeName").textContent = `Store ${PLACE_ID}`;
  $("storeMeta").textContent = `Items / Offers / Requests • placeId=${PLACE_ID}`;
  $("ownerName").textContent = "(owner info not wired yet)";

  // Wire UI
  $("tabItems").onclick = ()=>setTab("item");
  $("tabOffers").onclick = ()=>setTab("offer");
  $("tabRequests").onclick = ()=>setTab("request");

  $("searchBox").addEventListener("input", (e)=>{
    SEARCH = e.target.value || "";
    render();
  });

  $("createToggleBtn").disabled = false;
  $("createToggleBtn").onclick = toggleCreateBox;
  $("publishBtn").onclick = publish;

  // Load sweep (optional)
  try{
    const s = await api("/sweep/balance");
    $("sweepBal").textContent = s.balance ?? 0;
  } catch {}

  // Load listings (required)
  try{
    LISTINGS = await api(`/places/${PLACE_ID}/listings`);
    LISTINGS = LISTINGS.slice().sort((a,b)=>Number(b.id)-Number(a.id));
    debug("✅ Store loaded.");
  } catch(e){
    debug(`❌ Could not load listings: ${e.message}`);
    LISTINGS = [];
  }

  setTab("item");
}

main().catch(e=>debug(`BOOT ERROR: ${e.message}`));
