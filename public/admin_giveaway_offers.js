const $ = (id) => document.getElementById(id);

let allOffers = [];
let currentFilter = 'all';
let selectedOffer = null;
let reviewAction = null;

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"
  })[m]);
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleString('en-US', {
    year:'numeric', month:'short', day:'numeric', hour:'numeric', minute:'2-digit'
  });
}

function formatMoney(v) {
  return parseFloat(v || 0).toFixed(2);
}

// ── Data Loading ──
async function loadOffers() {
  $('offersLoading').style.display = 'block';
  $('offersGrid').style.display = 'none';
  $('offersEmpty').style.display = 'none';
  try {
    const resp = await fetch('/api/admin/giveaway/offers?status=all', { credentials: 'include' });
    if (!resp.ok) throw new Error('Failed to load offers');
    const data = await resp.json();
    allOffers = Array.isArray(data) ? data : (data.offers || []);
    updateStats();
    renderOffers();
  } catch (err) {
    console.error('Error loading offers:', err);
    $('offersGrid').innerHTML = '<div class="empty">Error loading offers</div>';
    $('offersGrid').style.display = 'block';
  }
  $('offersLoading').style.display = 'none';
}

function updateStats() {
  const pending = allOffers.filter(o => o.status === 'pending').length;
  const approved = allOffers.filter(o => o.status === 'approved').length;
  const rejected = allOffers.filter(o => o.status === 'rejected').length;
  $('statPending').textContent = pending;
  $('statApproved').textContent = approved;
  $('statRejected').textContent = rejected;
  $('statTotal').textContent = allOffers.length;
}

// ── Rendering ──
function renderOffers() {
  const filtered = currentFilter === 'all'
    ? allOffers
    : allOffers.filter(o => o.status === currentFilter);

  if (filtered.length === 0) {
    $('offersGrid').style.display = 'none';
    $('offersEmpty').style.display = 'block';
    return;
  }

  $('offersEmpty').style.display = 'none';
  $('offersGrid').style.display = 'grid';

  $('offersGrid').innerHTML = filtered.map(offer => {
    const isPending = offer.status === 'pending';
    const placeName = offer.place?.name || offer.placeName || offer.placename || 'Unknown Store';
    const placeId = offer.placeId || offer.place_id;
    const imageUrl = offer.imageUrl || offer.image_url || '';
    const statusClass = offer.status === 'approved' ? 'pill-approved'
      : offer.status === 'rejected' ? 'pill-rejected' : 'pill-pending';

    return `
      <div class="offer-card" data-id="${offer.id}">
        <img class="offer-thumb" src="${escapeHtml(imageUrl) || '/placeholder.png'}" alt="" data-fallback="/placeholder.png">
        <div class="offer-info">
          <h4 class="offer-title">${escapeHtml(offer.title)}</h4>
          <p class="offer-desc">${escapeHtml(offer.description)}</p>
          <div class="offer-meta">
            <span><strong>Store:</strong> <a href="/store?id=${placeId}" class="store-link" target="_blank">${escapeHtml(placeName)}</a></span>
            <span><strong>Value:</strong> ${formatMoney(offer.estimatedValue || offer.estimated_value)}</span>
            <span><strong>Submitted:</strong> ${formatDate(offer.createdAt || offer.created_at)}</span>
            <span class="pill ${statusClass}">${offer.status.charAt(0).toUpperCase() + offer.status.slice(1)}</span>
          </div>
          ${offer.adminNotes ? `<div class="muted" style="margin-top:8px;"><strong>Notes:</strong> ${escapeHtml(offer.adminNotes)}</div>` : ''}
        </div>
        <div class="offer-actions">
          ${isPending ? `
            <button class="btn btn-approve" data-offer-id="${offer.id}" data-action="approve">Approve</button>
            <button class="btn btn-reject" data-offer-id="${offer.id}" data-action="reject">Reject</button>
          ` : `
            <button class="btn btn-secondary" data-offer-id="${offer.id}" data-action="view">View Details</button>
          `}
        </div>
      </div>
    `;
  }).join('');
}

// ── Modal ──
function openReviewModal(offerId, action) {
  selectedOffer = allOffers.find(o => o.id === offerId);
  if (!selectedOffer) return;
  reviewAction = action;

  const modal = $('reviewModal');
  const isPending = selectedOffer.status === 'pending';
  const imageUrl = selectedOffer.imageUrl || selectedOffer.image_url || '';
  const placeName = selectedOffer.place?.name || selectedOffer.placeName || selectedOffer.placename || 'Unknown Store';
  const placeId = selectedOffer.placeId || selectedOffer.place_id;
  const statusClass = selectedOffer.status === 'approved' ? 'pill-approved'
    : selectedOffer.status === 'rejected' ? 'pill-rejected' : 'pill-pending';

  // Set title
  $('modalTitle').textContent = action === 'approve' ? 'Approve Offer'
    : action === 'reject' ? 'Reject Offer' : 'Offer Details';

  // Build info section
  $('modalOfferInfo').innerHTML = `
    <div style="margin-bottom:16px;">
      ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" style="width:100%; max-height:200px; object-fit:cover; border-radius:10px; margin-bottom:12px;" data-hide-on-error="true">` : ''}
      <h4 style="margin:0 0 8px 0;">${escapeHtml(selectedOffer.title)}</h4>
      <p class="muted" style="margin:0 0 12px 0;">${escapeHtml(selectedOffer.description)}</p>
      <div class="offer-meta">
        <span><strong>Store:</strong> <a href="/store?id=${placeId}" class="store-link" target="_blank">${escapeHtml(placeName)}</a></span>
        <span><strong>Value:</strong> ${formatMoney(selectedOffer.estimatedValue || selectedOffer.estimated_value)}</span>
      </div>
      <div class="offer-meta" style="margin-top:8px;">
        <span><strong>Submitted:</strong> ${formatDate(selectedOffer.createdAt || selectedOffer.created_at)}</span>
        <span class="pill ${statusClass}">${selectedOffer.status.charAt(0).toUpperCase() + selectedOffer.status.slice(1)}</span>
      </div>
    </div>
  `;

  // Show/hide date group and buttons
  const datesGroup = $('modalDatesGroup');
  const approveBtn = $('modalApproveBtn');
  const rejectBtn = $('modalRejectBtn');

  if (action === 'approve' && isPending) {
    datesGroup.style.display = 'block';
    approveBtn.style.display = 'inline-flex';
    rejectBtn.style.display = 'none';
    // Default dates: now to +30 days
    const now = new Date();
    const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    $('modalStartsAt').value = now.toISOString().slice(0, 16);
    $('modalEndsAt').value = end.toISOString().slice(0, 16);
  } else if (action === 'reject' && isPending) {
    datesGroup.style.display = 'none';
    approveBtn.style.display = 'none';
    rejectBtn.style.display = 'inline-flex';
  } else {
    datesGroup.style.display = 'none';
    approveBtn.style.display = 'none';
    rejectBtn.style.display = 'none';
  }

  $('modalNotes').value = '';
  modal.classList.add('active');
}

function closeModal() {
  $('reviewModal').classList.remove('active');
  selectedOffer = null;
  reviewAction = null;
}

async function submitReview(status) {
  if (!selectedOffer) return;

  const btn = status === 'approved' ? $('modalApproveBtn') : $('modalRejectBtn');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const payload = {
      status: status,
      notes: $('modalNotes').value || ''
    };

    if (status === 'approved') {
      const startsAt = $('modalStartsAt').value;
      const endsAt = $('modalEndsAt').value;
      if (startsAt) payload.startsAt = new Date(startsAt).toISOString();
      if (endsAt) payload.endsAt = new Date(endsAt).toISOString();
    }

    const resp = await fetch(`/api/admin/giveaway/offer/${selectedOffer.id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || 'Review failed');
    }

    closeModal();
    await loadOffers();
  } catch (err) {
    console.error('Review error:', err);
    alert('Error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = status === 'approved' ? 'Approve' : 'Reject';
  }
}

// ── Event Listeners ──

// Tab filtering
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.status;
    renderOffers();
  });
});

// Modal overlay click to close
$('reviewModal').addEventListener('click', (e) => {
  if (e.target === $('reviewModal')) closeModal();
});

// Escape key to close
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

// Modal buttons
$('modalCancelBtn').addEventListener('click', () => closeModal());
$('modalRejectBtn').addEventListener('click', () => submitReview('rejected'));
$('modalApproveBtn').addEventListener('click', () => submitReview('approved'));

// Offer card action buttons (event delegation)
$('offersGrid').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-offer-id]');
  if (btn) {
    const offerId = parseInt(btn.dataset.offerId);
    const action = btn.dataset.action;
    openReviewModal(offerId, action);
  }
});

// Image error fallbacks (capture phase)
document.addEventListener('error', (e) => {
  if (e.target.tagName === 'IMG') {
    if (e.target.dataset.fallback) {
      e.target.src = e.target.dataset.fallback;
      e.target.removeAttribute('data-fallback');
    }
    if (e.target.dataset.hideOnError) {
      e.target.style.display = 'none';
    }
  }
}, true);

// Init
loadOffers();
