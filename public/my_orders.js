function $(id) {
  return document.getElementById(id);
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function formatCurrencyCents(value) {
  if (value == null) return "—";
  return `$${(Number(value) / 100).toFixed(2)}`;
}

function statusClass(status) {
  const s = String(status || "").toLowerCase();
  if (["paid", "completed", "fulfilled"].includes(s)) return "paid";
  if (["pending", "pending_payment", "requires_payment"].includes(s)) return "pending";
  if (["cancelled", "canceled", "failed"].includes(s)) return "cancelled";
  return "other";
}

async function fetchJSON(url) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function loadOrders() {
  const body = $("ordersBody");
  const empty = $("ordersEmpty");
  const error = $("ordersError");
  body.innerHTML = "";
  empty.style.display = "none";
  error.style.display = "none";

  let orders;
  try {
    orders = await fetchJSON("/api/orders");
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      error.textContent = "Login required. Visit /signup to log in.";
    } else {
      error.textContent = "Unable to load orders right now.";
    }
    error.style.display = "block";
    return;
  }

  if (!Array.isArray(orders) || orders.length === 0) {
    empty.style.display = "block";
    return;
  }

  const placeIds = Array.from(
    new Set(orders.map((o) => Number(o.sellerPlaceId || 0)).filter((id) => id))
  );
  const placeMap = new Map();
  await Promise.all(
    placeIds.map(async (id) => {
      try {
        const place = await fetchJSON(`/places/${id}`);
        placeMap.set(id, place?.name || "Store");
      } catch {
        placeMap.set(id, "Store");
      }
    })
  );

  orders.forEach((order) => {
    const status = order.status || "—";
    const totalCents =
      Number.isFinite(Number(order.totalCents)) && Number(order.totalCents) > 0
        ? Number(order.totalCents)
        : Number(order.amountCents || 0);
    const row = document.createElement("div");
    row.className = "table-row";
    row.innerHTML = `
      <div data-label="Order"><a class="link" href="/orders/${order.id}">#${order.id}</a></div>
      <div data-label="Date">${formatDate(order.createdAt)}</div>
      <div data-label="Status"><span class="badge ${statusClass(status)}">${status}</span></div>
      <div data-label="Total">${formatCurrencyCents(totalCents)}</div>
      <div data-label="Items">${order.quantity || "—"}</div>
      <div data-label="Store">${placeMap.get(Number(order.sellerPlaceId || 0)) || "—"}</div>
    `;
    body.appendChild(row);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  loadOrders();
});
