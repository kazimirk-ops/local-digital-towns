const $ = (id) => document.getElementById(id);

function formatNumber(value) {
  if (value == null) return "—";
  return Number(value).toLocaleString();
}
function formatCurrencyCents(value) {
  if (value == null) return "—";
  return `$${(Number(value) / 100).toFixed(2)}`;
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadHealth() {
  try {
    const data = await fetchJSON("/health");
    $("apiHealth").textContent = `API: ${data.status || "ok"}`;
  } catch {
    $("apiHealth").textContent = "API: error";
  }
}

async function loadSummary() {
  const range = $("rangeSelect").value || "7d";
  const data = await fetchJSON(`/api/admin/analytics/summary?range=${encodeURIComponent(range)}`);

  $("usersTotal").textContent = formatNumber(data.users?.total);
  $("usersNew").textContent = formatNumber(data.users?.new);

  $("placesTotal").textContent = formatNumber(data.places?.total);
  $("placesPending").textContent = formatNumber(data.places?.pending);
  $("trustPending").textContent = formatNumber(data.approvals?.trustPending);
  $("residentPending").textContent = formatNumber(data.approvals?.residentPending);
  $("businessPending").textContent = formatNumber(data.approvals?.businessPending);

  $("buyNowCount").textContent = formatNumber(data.listings?.buyNowActive);
  $("auctionsActive").textContent = formatNumber(data.listings?.auctionsActive);
  $("auctionsEnded").textContent = formatNumber(data.listings?.auctionsEnded);

  $("ordersTotal").textContent = formatNumber(data.orders?.total);
  $("ordersRange").textContent = formatNumber(data.orders?.rangeOrders);
  $("revenueTotal").textContent = formatCurrencyCents(data.orders?.totalRevenueCents);
  $("revenueRange").textContent = formatCurrencyCents(data.orders?.rangeRevenueCents);

  $("liveActive").textContent = formatNumber(data.live?.activeRooms);
  $("liveScheduled").textContent = formatNumber(data.live?.scheduledShows);

  $("sweepStatus").textContent = data.sweep?.status ? String(data.sweep.status).toUpperCase() : "—";
  $("sweepEntries").textContent = formatNumber(data.sweep?.totalEntries);

  // TODO: Add sweep balances aggregation when a summary endpoint exists.
}

$("rangeSelect").addEventListener("change", () => {
  loadSummary().catch(() => {});
});

loadHealth();
loadSummary().catch(() => {});
