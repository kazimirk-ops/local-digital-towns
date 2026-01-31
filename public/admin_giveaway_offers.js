const $ = (id) => document.getElementById(id);

let allOffers = [];
let currentFilter = 'all';
let selectedOffer = null;
let reviewAction = null;

async function api(url, opts = {}) {
  const res = await fetch(url, { credentials: 'include', ...opts });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(typeof data === 'string' ? data : (data.error || JSON.stringify(data)));
  return data;
}

function formatDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function formatValue(cents) {
  if (!cents) return '$0.00';
  return '$' + (cents / 100).toFixed(2);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

function getStatusPill(status) {
  const s = (status || 'pending').toLowerCase();
  let pillClass = 'pill-pending';
  let label = 'Pending';

  if (s === 'approved') {
    pillClass = 'pill-approved';
    label = 'Approved';
  } else if (s === 'rejected') {
    pillClass = 'pill-rejected';
    label = 'Rejected';
  }

  return `<span class="pill ${pillClass}">${label}</span>`;
}

async function loadOffers() {
  $('offersLoading').style.display = 'block';
  $('offersEmpty').style.display = 'none';
  $('offersGrid').style.display = 'none';

  try {
    // Load all offers (the API supports status filter, but we'll load all and filter client-side for stats)
    allOffers = await api('/api/admin/giveaway/offers');

    updateStats();
    renderOffers();
  } catch (e) {
    console.error('Failed to load offers:', e);
    $('offersLoading').textContent = 'Error: ' + e.message;
  }
}

function updateStats() {
  const pending = allOffers.filter(o => (o.status || 'pending').toLowerCase() === 'pending').length;
  const approved = allOffers.filter(o => (o.status || '').toLowerCase() === 'approved').length;
  const rejected = allOffers.filter(o => (o.status || '').toLowerCase() === 'rejected').length;

  $('statPending').textContent = pending;
  $('statApproved').textContent = approved;
  $('statRejected').textContent = rejected;
  $('statTotal').textContent = allOffers.length;
}

function renderOffers() {
  $('offersLoading').style.display = 'none';

  let filtered = allOffers;
  if (currentFilter !== 'all') {
    filtered = allOffers.filter(o => (o.status || 'pending').toLowerCase() === currentFilter);
  }

  if (filtered.length === 0) {
    $('offersEmpty').style.display = 'block';
    $('offersGrid').style.display = 'none';
    return;
  }

  $('offersEmpty').style.display = 'none';
  $('offersGrid').style.display = 'grid';

  $('offersGrid').innerHTML = filtered.map(offer => {
    const isPending = (offer.status || 'pending').toLowerCase() === 'pending';
    const placeName = offer.place?.name || offer.placeName || offer.placename || 'Unknown Store';
    const placeId = offer.placeId || offer.placeid;
    const imageUrl = offer.imageUrl || offer.imageurl || '';
    const estimatedValue = offer.estimatedValue || offer.estimatedvalue || 0;
    const reviewedAt = offer.reviewedAt || offer.reviewedat;
    const adminNotes = offer.adminNotes || offer.adminnotes || '';

    return `
      <div class="offer-card" data-id="${offer.id}">
        <img class="offer-thumb" src="${escapeHtml(imageUrl) || '/placeholder.png'}" alt="" data-fallback="/placeholder.png">
        <div class="offer-info">
          <h4 class="offer-title">${escapeHtml(offer.title)}</h4>
          <p class="offer-desc">${escapeHtml(offer.description)}</p>
          <div class="offer-meta">
            <span><strong>Store:</strong> <a href="/store?id=${placeId}" class="store-link" target="_blank">${escapeHtml(placeName)}</a></span>
            <span><strong>Value:</strong> ${formatValue(estimatedValue)}</span>
            <span><strong>Submitted:</strong> ${formatDate(offer.createdAt || offer.createdat)}</span>
            ${getStatusPill(offer.status)}
          </div>
          ${reviewedAt ? `<div class="muted" style="margin-top:8px;">Reviewed: ${formatDate(reviewedAt)}${adminNotes ? ' - ' + escapeHtml(adminNotes) : ''}</div>` : ''}
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

function openReviewModal(offerId, action) {
  selectedOffer = allOffers.find(o => o.id === offerId);
  reviewAction = action;

  if (!selectedOffer) return;

  const placeName = selectedOffer.place?.name || selectedOffer.placeName || selectedOffer.placename || 'Unknown Store';
  const placeId = selectedOffer.placeId || selectedOffer.placeid;
  const estimatedValue = selectedOffer.estimatedValue || selectedOffer.estimatedvalue || 0;
  const imageUrl = selectedOffer.imageUrl || selectedOffer.imageurl || '';
  const isPending = (selectedOffer.status || 'pending').toLowerCase() === 'pending';

  $('modalTitle').textContent = action === 'view' ? 'Offer Details' : (action === 'approve' ? 'Approve Offer' : 'Reject Offer');

  $('modalOfferInfo').innerHTML = `
    <div style="margin-bottom:16px;">
      ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" style="width:100%; max-height:200px; object-fit:cover; border-radius:10px; margin-bottom:12px;" data-hide-on-error="true">` : ''}
      <h4 style="margin:0 0 8px 0;">${escapeHtml(selectedOffer.title)}</h4>
      <p class="muted" style="margin:0 0 12px 0;">${escapeHtml(selectedOffer.description)}</p>
      <div class="offer-meta">
        <span><strong>Store:</strong> <a href="/store?id=${placeId}" class="store-link" target="_blank">${escapeHtml(placeName)}</a></span>
        <span><strong>Value:</strong> ${formatValue(estimatedValue)}</span>
      </div>
      <div class="offer-meta" style="margin-top:8px;">
        <span><strong>Submitted:</strong> ${formatDate(selectedOffer.createdAt || selectedOffer.createdat)}</span>
        ${getStatusPill(selectedOffer.status)}
      </div>
    </div>
  `;

  $('modalNotes').value = '';
  $('modalStartsAt').value = '';
  $('modalEndsAt').value = '';

  // Show dates input only for approval action
  const datesGroup = $('modalDatesGroup');
  if (datesGroup) {
    datesGroup.style.display = (action === 'approve' && isPending) ? 'block' : 'none';
    // Set default dates: start now, end in 30 days
    if (action === 'approve' && isPending) {
      const now = new Date();
      const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      $('modalStartsAt').value = now.toISOString().slice(0, 16);
      $('modalEndsAt').value = end.toISOString().slice(0, 16);
    }
  }

  // Show/hide buttons based on action
  if (action === 'view' || !isPending) {
    $('modalApproveBtn').style.display = 'none';
    $('modalRejectBtn').style.display = 'none';
  } else if (action === 'approve') {
    $('modalApproveBtn').style.display = 'inline-flex';
    $('modalRejectBtn').style.display = 'none';
  } else {
    $('modalApproveBtn').style.display = 'none';
    $('modalRejectBtn').style.display = 'inline-flex';
  }

  $('reviewModal').classList.add('active');
}

function closeModal() {
  $('reviewModal').classList.remove('active');
  selectedOffer = null;
  reviewAction = null;
}

async function submitReview(status) {
  if (!selectedOffer) return;

  const notes = $('modalNotes').value.trim();
  const startsAt = $('modalStartsAt')?.value || null;
  const endsAt = $('modalEndsAt')?.value || null;
  const btn = status === 'approved' ? $('modalApproveBtn') : $('modalRejectBtn');

  btn.disabled = true;
  btn.textContent = 'Processing...';

  try {
    const payload = { status, notes };
    if (status === 'approved' && startsAt) payload.startsAt = new Date(startsAt).toISOString();
    if (status === 'approved' && endsAt) payload.endsAt = new Date(endsAt).toISOString();

    await api(`/api/admin/giveaway/offer/${selectedOffer.id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    closeModal();
    await loadOffers();
  } catch (e) {
    alert('Error: ' + e.message);
    btn.disabled = false;
    btn.textContent = status === 'approved' ? 'Approve' : 'Reject';
  }
}

// Tab filtering
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.status;
    renderOffers();
  });
});

// Close modal on overlay click
$('reviewModal').addEventListener('click', (e) => {
  if (e.target === $('reviewModal')) {
    closeModal();
  }
});

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('reviewModal').classList.contains('active')) {
    closeModal();
  }
});

// Modal button listeners
$('modalCancelBtn').addEventListener('click', closeModal);
$('modalRejectBtn').addEventListener('click', () => submitReview('rejected'));
$('modalApproveBtn').addEventListener('click', () => submitReview('approved'));

// Event delegation for offer action buttons
$('offersGrid').addEventListener('click', function(e) {
  const btn = e.target.closest('[data-offer-id]');
  if (btn) {
    const offerId = parseInt(btn.dataset.offerId);
    const action = btn.dataset.action;
    openReviewModal(offerId, action);
  }
});

// Handle image fallbacks without inline handlers
document.addEventListener('error', function(e) {
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

// Initialize
loadOffers();
