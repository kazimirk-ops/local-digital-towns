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
    const isCompleted = String(status).toLowerCase() === "completed";
    const reviewBtn = isCompleted ? `<button class="leave-review-btn" data-order="${order.id}" style="margin-left:8px; padding:4px 8px; font-size:11px; background:#1e3a5f; border:1px solid #2563eb; border-radius:6px; color:#93c5fd; cursor:pointer;">Leave Review</button>` : '';

    const row = document.createElement("div");
    row.className = "table-row";
    row.innerHTML = `
      <div data-label="Order"><a class="link" href="/orders/${order.id}">#${order.id}</a></div>
      <div data-label="Date">${formatDate(order.createdAt)}</div>
      <div data-label="Status"><span class="badge ${statusClass(status)}">${status}</span>${reviewBtn}</div>
      <div data-label="Total">${formatCurrencyCents(totalCents)}</div>
      <div data-label="Items">${order.quantity || "—"}</div>
      <div data-label="Store">${placeMap.get(Number(order.sellerPlaceId || 0)) || "—"}</div>
    `;
    body.appendChild(row);
  });

  // Add event listeners for leave review buttons
  body.querySelectorAll('.leave-review-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      $('reviewOrderId').value = btn.dataset.order;
      $('reviewRating').value = '5';
      $('reviewText').value = '';
      $('reviewModal').style.display = 'flex';
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  loadOrders();

  $('cancelReviewBtn')?.addEventListener('click', () => {
    $('reviewModal').style.display = 'none';
  });

  $('submitReviewBtn')?.addEventListener('click', async () => {
    const orderId = $('reviewOrderId').value;
    const rating = $('reviewRating').value;
    const text = $('reviewText').value;
    $('submitReviewBtn').disabled = true;
    $('submitReviewBtn').textContent = 'Submitting...';
    try {
      const res = await fetch(`/orders/${orderId}/review`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: Number(rating), text })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit');
      $('reviewModal').style.display = 'none';
      alert('Review submitted!');
      document.querySelector(`.leave-review-btn[data-order="${orderId}"]`)?.remove();
      // Prompt to share the review
      if (window.ShareModal && data.reviewId) {
        setTimeout(() => ShareModal.promptReviewShare(data.reviewId), 500);
      }
    } catch (err) {
      alert('Error: ' + err.message);
    }
    $('submitReviewBtn').disabled = false;
    $('submitReviewBtn').textContent = 'Submit Review';
  });
});
