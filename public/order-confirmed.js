const $ = (id)=>document.getElementById(id);

function fmtCents(c){
  if(!Number.isFinite(Number(c))) return "—";
  return `$${(Number(c)/100).toFixed(2)}`;
}

async function api(u){
  const r = await fetch(u,{credentials:"include"});
  const t = await r.text();
  let j; try{ j=JSON.parse(t);}catch{ j=t; }
  if(!r.ok) throw new Error(j.error || t);
  return j;
}

async function main(){
  const statusEl = $("orderStatus");
  const orderId = new URLSearchParams(location.search).get("orderId");
  if(!orderId){
    statusEl.textContent = "Missing orderId.";
    return;
  }
  try{
    const res = await api(`/api/orders/${orderId}`);
    const order = res.order || res;
    const items = res.items || [];

    statusEl.textContent = `Status: ${order.status || "pending"}`;
    $("orderId").textContent = `#${order.id}`;
    $("orderItems").textContent = items.map(i=>i.titleSnapshot || i.titlesnapshot).filter(Boolean).join(", ") || "—";

    const totalCents = order.totalCents ?? order.totalcents ?? order.amountCents ?? order.amountcents ?? 0;
    $("orderTotal").textContent = `Total: ${fmtCents(totalCents)}`;

    // Get seller info
    const sellerPlaceId = order.sellerPlaceId ?? order.sellerplaceid;
    if(sellerPlaceId){
      try{
        const place = await api(`/places/${sellerPlaceId}`);
        $("sellerInfo").innerHTML = `
          <strong>${place.name || "Store"}</strong><br>
          <a href="/store/${sellerPlaceId}">View Store</a> •
          <a href="#" onclick="startDm(${place.ownerUserId || place.owneruserid});return false;">Message Seller</a>
        `;
      }catch(e){
        $("sellerInfo").textContent = "Contact seller through the store page.";
      }
    }else{
      $("sellerInfo").textContent = "Contact seller through the store page.";
    }
  }catch(e){
    statusEl.textContent = `ERROR: ${e.message}`;
  }
}

async function startDm(ownerUserId){
  if(!ownerUserId) return alert("Seller not available.");
  try{
    const convo = await api("/dm/start",{method:"POST",body:JSON.stringify({otherUserId: ownerUserId})});
    window.location.href = `/me/profile#dm=${convo.id}`;
  }catch(e){ alert(e.message); }
}

main();
