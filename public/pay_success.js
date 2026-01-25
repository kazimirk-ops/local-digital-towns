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
    const subtotalCents = order.subtotalCents || 0;
    const depositCents = order.serviceGratuityCents || order.buyerDepositCents || 0;
    $("paySuccessSubtotal").textContent = `Item Total: ${fmtCents(subtotalCents)}`;
    $("paySuccessGratuity").textContent = `Deposit Paid: ${fmtCents(depositCents)}`;
    $("paySuccessTotal").textContent = `Order Total: ${fmtCents(order.totalCents)}`;
    // Show remaining amount to pay seller
    const remainingEl = $("remainingAmountText");
    if(remainingEl){
      remainingEl.innerHTML = `<strong>${fmtCents(subtotalCents)}</strong> - Pay this amount to the seller when you pick up your order.`;
    }
    // Prompt to share purchase after a short delay
    if(order.status === "paid" && window.ShareModal){
      setTimeout(() => ShareModal.promptPurchaseShare(order.id), 1500);
    }
  }catch(e){
    statusEl.textContent = `ERROR: ${e.message}`;
  }
}
main();
