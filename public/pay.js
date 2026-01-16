const $ = (id) => document.getElementById(id);

async function api(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

function orderIdFromPath() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  return parts[1];
}

function fmtCents(cents) {
  const v = Number(cents || 0);
  return `$${(v / 100).toFixed(2)}`;
}

function formatCountdown(dueAt) {
  if (!dueAt) return "—";
  const t = Date.parse(dueAt);
  if (Number.isNaN(t)) return "—";
  let ms = t - Date.now();
  if (ms <= 0) return "Expired";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const ss = s % 60;
  return `${h}h ${mm}m ${ss}s`;
}

async function loadOrder() {
  const id = orderIdFromPath();
  if (!id) return;
  const data = await api(`/api/orders/${id}`);
  const order = data.order;
  const listing = data.listing;

  $("orderId").textContent = `#${order.id}`;
  $("orderListing").textContent = listing ? `Listing: ${listing.title || "Auction item"}` : "Listing: —";
  $("orderSubtotal").textContent = `Subtotal: ${fmtCents(order.subtotalCents || order.amountCents)}`;
  $("orderGratuity").textContent = `Gratuity: ${fmtCents(order.serviceGratuityCents || 0)}`;
  $("orderTotal").textContent = `Total: ${fmtCents(order.totalCents || order.amountCents)}`;
  $("paymentDue").textContent = listing?.paymentDueAt ? new Date(listing.paymentDueAt).toLocaleString() : "—";
  $("paymentCountdown").textContent = formatCountdown(listing?.paymentDueAt);
  $("payStatus").textContent = order.status === "paid" ? "Paid." : "Payment required.";

  const isDev = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  if (isDev && order.status !== "paid") {
    $("markPaidBtn").style.display = "inline-block";
  }
}

async function markPaid() {
  try {
    const id = orderIdFromPath();
    if (!id) return;
    await api(`/api/orders/${id}/pay`, { method: "POST" });
    $("payMsg").textContent = "Payment marked as paid.";
    await loadOrder();
  } catch (e) {
    $("payMsg").textContent = `ERROR: ${e.message}`;
  }
}

$("markPaidBtn").onclick = markPaid;
loadOrder().catch((e) => {
  $("payStatus").textContent = `ERROR: ${e.message}`;
});

setInterval(async () => {
  const id = orderIdFromPath();
  if (!id) return;
  try {
    const data = await api(`/api/orders/${id}`);
    const listing = data.listing;
    $("paymentCountdown").textContent = formatCountdown(listing?.paymentDueAt);
  } catch {}
}, 1000);
