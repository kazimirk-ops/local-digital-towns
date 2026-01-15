const $=id=>document.getElementById(id);
function debug(m){$("debug").textContent=m||"";}

async function api(u,o){
  const r=await fetch(u,{credentials:"include",headers:{"Content-Type":"application/json"},...(o||{})});
  const t=await r.text(); let j;
  try{j=JSON.parse(t)}catch{j=t}
  if(!r.ok) throw new Error(j.error||t);
  return j;
}
function pid(){return Number(location.pathname.split("/")[2]);}

let LIST=[],TAB="item",AUCTIONS={};

function fmtCents(c){
  if(!Number.isFinite(Number(c))) return "—";
  return `$${(Number(c)/100).toFixed(2)}`;
}
function formatCountdown(endAt){
  if(!endAt) return "No end time";
  const t = Date.parse(endAt);
  if(Number.isNaN(t)) return "Invalid end time";
  let ms = t - Date.now();
  if(ms <= 0) return "Ended";
  const s = Math.floor(ms/1000);
  const h = Math.floor(s/3600);
  const m = Math.floor((s%3600)/60);
  const sec = s%60;
  return `${h}h ${m}m ${sec}s`;
}
function renderAuctionText(id){
  const el = document.getElementById(`auction-${id}`);
  const a = AUCTIONS[id];
  if(!el || !a) return;
  const current = a.highestBidCents || a.startBidCents || 0;
  el.textContent = `Ends in: ${formatCountdown(a.auctionEndAt)} | Current bid: ${fmtCents(current)} | Bids: ${a.bidCount}`;
}
async function loadAuction(id){
  try{ AUCTIONS[id]=await api(`/listings/${id}/auction`); renderAuctionText(id); }
  catch(e){ const el=document.getElementById(`auction-${id}`); if(el) el.textContent=`Auction error: ${e.message}`; }
}
async function placeBid(id){
  try{
    const raw = document.getElementById(`bid-${id}`)?.value;
    const amountCents = Number(raw);
    if(!Number.isFinite(amountCents) || amountCents<=0) return alert("Enter bid amount in cents.");
    await api(`/listings/${id}/bid`,{method:"POST",body:JSON.stringify({amountCents})});
    await loadAuction(id);
  }catch(e){alert(e.message)}
}

async function createTestAuction(){
  try{
    const id=pid();
    const now=Date.now();
    const payload={
      listingType:"auction",
      exchangeType:"money",
      title:"Test Auction",
      description:"Testing auctions",
      quantity:1,
      price:0,
      auctionStartAt:new Date(now-60*1000).toISOString(),
      auctionEndAt:new Date(now+30*60*1000).toISOString(),
      startBidCents:100,
      minIncrementCents:50
    };
    await api(`/places/${id}/listings`,{method:"POST",body:JSON.stringify(payload)});
    LIST=await api(`/places/${id}/listings`);
    setTab("item");
  }catch(e){alert(e.message)}
}

function setTab(t){
  TAB=t;
  ["tabItems","tabOffers","tabRequests"].forEach(x=>$(x).classList.remove("active"));
  if(t==="item")$("tabItems").classList.add("active");
  if(t==="offer")$("tabOffers").classList.add("active");
  if(t==="request")$("tabRequests").classList.add("active");
  render();
}

function render(){
  const g=$("listingGrid"); g.innerHTML="";
  LIST.filter(l=>{
    const type = (l.listingType||"item");
    if(TAB==="item") return type==="item" || type==="auction";
    return type===TAB;
  }).forEach(l=>{
    const d=document.createElement("div");
    d.className="item";
    const type = (l.listingType||"item");
    const offerMeta = (type==="offer" || type==="request") ? `
      <div class="muted">Category: ${l.offerCategory || "—"}</div>
      <div class="muted">Availability: ${l.availabilityWindow || "—"}</div>
      <div class="muted">Compensation: ${l.compensationType || l.exchangeType || "—"}</div>
    ` : "";
    const auctionBlock = type==="auction" ? `
      <div class="mono" id="auction-${l.id}">Loading auction…</div>
      <div class="row" style="margin-top:8px;">
        <input id="bid-${l.id}" placeholder="Bid (cents)" style="max-width:160px;" />
        <button data-bid="${l.id}">Place Bid</button>
      </div>
    ` : "";
    d.innerHTML=`
      <div class="muted">${type.toUpperCase()} • ${l.exchangeType}</div>
      <div style="font-weight:900">${l.title}</div>
      <div class="muted">${l.description}</div>
      ${offerMeta}
      ${type==="auction" ? auctionBlock : (type!=="item" ? `<button data-id="${l.id}">Apply / Message</button>` : "")}
    `;
    const b=d.querySelector("button[data-id]");
    if(b) b.onclick=()=>apply(l.id);
    const bidBtn=d.querySelector("button[data-bid]");
    if(bidBtn) bidBtn.onclick=()=>placeBid(l.id);
    g.appendChild(d);
    if(type==="auction"){
      if(!AUCTIONS[l.id]) loadAuction(l.id);
      renderAuctionText(l.id);
    }
  });
}

async function apply(id){
  try{
    await api(`/listings/${id}/apply`,{method:"POST",body:JSON.stringify({message:"Interested"})});
    alert("Conversation started.");
  }catch(e){alert(e.message)}
}

async function main(){
  const id=pid();
  $("tabItems").onclick=()=>setTab("item");
  $("tabOffers").onclick=()=>setTab("offer");
  $("tabRequests").onclick=()=>setTab("request");

  try{
    try{
      const me=await api("/me");
      const place=await api(`/places/${id}`);
      if(me?.user && place?.ownerUserId && Number(place.ownerUserId)===Number(me.user.id)){
        const btn=$("testAuctionBtn");
        btn.style.display="inline-block";
        btn.onclick=()=>createTestAuction();
      }
    }catch{}
    LIST=await api(`/places/${id}/listings`);
    setTab("item");
    debug("Ready.");
  }catch(e){debug(e.message)}
}
main();
setInterval(()=>Object.keys(AUCTIONS).forEach(id=>renderAuctionText(id)), 1000);
