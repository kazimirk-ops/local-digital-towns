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
  const statusEl = $("paySuccessStatus");
  const orderId = new URLSearchParams(location.search).get("orderId");
  if(!orderId){
    statusEl.textContent = "Missing orderId.";
    return;
  }
  try{
    const res = await api(`/api/orders/${orderId}`);
    const order = res.order || res;
    const items = res.items || [];
    statusEl.textContent = order.status === "paid" ? "Payment confirmed." : `Status: ${order.status}`;
    $("paySuccessOrderId").textContent = `#${order.id}`;
    $("paySuccessListing").textContent = items.map(i=>i.titleSnapshot).filter(Boolean).join(", ") || "";
    $("paySuccessSubtotal").textContent = `Subtotal: ${fmtCents(order.subtotalCents)}`;
    $("paySuccessGratuity").textContent = `Gratuity: ${fmtCents(order.serviceGratuityCents)}`;
    $("paySuccessTotal").textContent = `Total: ${fmtCents(order.totalCents)}`;
  }catch(e){
    statusEl.textContent = `ERROR: ${e.message}`;
  }
}
main();
