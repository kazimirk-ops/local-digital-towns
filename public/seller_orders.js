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

function statusFilter(status, filter) {
  const s = String(status || "").toLowerCase();
  if (filter === "pending") return ["pending", "pending_payment", "requires_payment"].includes(s);
  if (filter === "paid") return ["paid", "completed", "fulfilled"].includes(s);
  return true;
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

async function loadOrders(filter) {
  const body = $("ordersBody");
  const empty = $("ordersEmpty");
  const error = $("ordersError");
  body.innerHTML = "";
  empty.style.display = "none";
  error.style.display = "none";

  let orders;
  try {
    orders = await fetchJSON("/api/seller/orders");
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

  const filtered = orders.filter((order) => statusFilter(order.status, filter));
  if (!filtered.length) {
    empty.style.display = "block";
    return;
  }

  filtered.forEach((order) => {
    const status = order.status || "—";
    const totalCents =
      Number.isFinite(Number(order.totalCents)) && Number(order.totalCents) > 0
        ? Number(order.totalCents)
        : Number(order.amountCents || 0);
    const buyerLabel = order.buyerDisplayName || (order.buyerUserId ? `User #${order.buyerUserId}` : "—");

    // Check order status for button display
    const isPendingPayment = ["pending", "pending_payment", "requires_payment"].includes(String(status).toLowerCase());
    const isCompleted = String(status).toLowerCase() === "completed";
    const createdAt = new Date(order.createdAt || order.createdat);
    const hoursSince = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
    const canReportGhost = isPendingPayment && hoursSince >= 48;

    // Build action buttons
    let actionBtns = '';
    if (isPendingPayment) {
      actionBtns += `<button class="confirm-payment-btn" data-order="${order.id}" style="margin-left:8px; padding:4px 8px; font-size:11px; background:#166534; border:1px solid #15803d; border-radius:6px; color:#86efac; cursor:pointer;">Confirm Payment Received</button>`;
      if (canReportGhost) {
        actionBtns += `<button class="report-ghost-btn" data-order="${order.id}" style="margin-left:8px; padding:4px 8px; font-size:11px; background:#7f1d1d; border:1px solid #991b1b; border-radius:6px; color:#fca5a5; cursor:pointer;">Report Ghosted</button>`;
      }
    }
    if (isCompleted) {
      actionBtns += `<button class="leave-review-btn" data-order="${order.id}" data-buyer="${order.buyerUserId || ''}" style="margin-left:8px; padding:4px 8px; font-size:11px; background:#1e3a5f; border:1px solid #2563eb; border-radius:6px; color:#93c5fd; cursor:pointer;">Leave Review</button>`;
    }

    const row = document.createElement("div");
    row.className = "table-row";
    row.innerHTML = `
      <div data-label="Order"><a class="link" href="/orders/${order.id}">#${order.id}</a></div>
      <div data-label="Buyer">${buyerLabel}</div>
      <div data-label="Store">${placeMap.get(Number(order.sellerPlaceId || 0)) || "—"}</div>
      <div data-label="Status"><span class="badge ${statusClass(status)}">${status}</span></div>
      <div data-label="Total">${formatCurrencyCents(totalCents)}</div>
      <div data-label="Date">${formatDate(order.createdAt)}${actionBtns}</div>
    `;
    body.appendChild(row);
  });

  // Add event listeners for ghost report buttons
  body.querySelectorAll('.report-ghost-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const orderId = btn.dataset.order;
      if (!confirm('Report this buyer for non-payment? This will affect their buyer reliability score.')) return;

      btn.disabled = true;
      btn.textContent = 'Reporting...';

      try {
        const res = await fetch(`/api/orders/${orderId}/report-ghost`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'Non-payment after 48 hours' })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to report');

        btn.textContent = 'Reported';
        btn.style.background = '#166534';
        btn.style.borderColor = '#15803d';
        btn.style.color = '#86efac';
      } catch (err) {
        alert('Error: ' + err.message);
        btn.disabled = false;
        btn.textContent = 'Report Ghosted';
      }
    });
  });

  // Add event listeners for confirm payment buttons
  body.querySelectorAll('.confirm-payment-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const orderId = btn.dataset.order;
      if (!confirm('Confirm payment was received for this order?')) return;

      btn.disabled = true;
      btn.textContent = 'Confirming...';

      try {
        const res = await fetch(`/orders/${orderId}/complete`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to confirm');

        const statusBadge = btn.closest('.table-row').querySelector('.badge');
        if (statusBadge) {
          statusBadge.textContent = 'completed';
          statusBadge.className = 'badge paid';
        }
        // Remove all action buttons in this row
        btn.closest('.table-row').querySelectorAll('button').forEach(b => b.remove());
      } catch (err) {
        alert('Error: ' + err.message);
        btn.disabled = false;
        btn.textContent = 'Confirm Payment Received';
      }
    });
  });

  // Add event listeners for leave review buttons
  body.querySelectorAll('.leave-review-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const orderId = btn.dataset.order;
      $('reviewOrderId').value = orderId;
      $('reviewRating').value = '5';
      $('reviewText').value = '';
      $('reviewModal').style.display = 'flex';
    });
  });
}

// Review modal handlers
document.addEventListener('DOMContentLoaded', () => {
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
    } catch (err) {
      alert('Error: ' + err.message);
    }
    $('submitReviewBtn').disabled = false;
    $('submitReviewBtn').textContent = 'Submit Review';
  });
});

function setActiveTab(filter) {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.filter === filter);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  let currentFilter = "all";
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentFilter = btn.dataset.filter || "all";
      setActiveTab(currentFilter);
      loadOrders(currentFilter);
    });
  });
  setActiveTab(currentFilter);
  loadOrders(currentFilter);
});
