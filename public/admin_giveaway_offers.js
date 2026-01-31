const $ = (id) => document.getElementById(id);
let allOffers = [], currentFilter = 'all', selectedOffer = null, reviewAction = null;

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"})[m]);
}
function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleString('en-US', { year:'numeric', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
}
function formatMoney(v) { return parseFloat(v || 0).toFixed(2); }

async function loadOffers() {
  $('offersLoading').style.display = 'block';
  $('offersGrid').style.display = 'none';
  $('offersEmpty').style.display = 'none';
  try {
    const resp = await fetch('/api/admin/giveaway/offers', { credentials: 'include' });
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
  $('statPending').textContent = allOffers.filter(o => o.status === 'pending').length;
  $('statApproved').textContent = allOffers.filter(o => o.status === 'approved').length;
  $('statRejected').textContent = allOffers.filter(o => o.status === 'rejected').length;
  $('statTotal').textContent = allOffers.length;
}

function renderOffers() {
  const filtered = currentFilter === 'all' ? allOffers : allOffers.filter(o => o.status === currentFilter);
  if (filtered.length === 0) { $('offersGrid').style.display = 'none'; $('offersEmpty').style.display = 'block'; return; }
  $('offersEmpty').style.display = 'none';
  $('offersGrid').style.display = 'grid';
  $('offersGrid').innerHTML = filtered.map(offer => {
    const isPending = offer.status === 'pending';
    const placeName = offer.place?.name || offer.placeName || offer.placename || 'Unknown Store';
    const placeId = offer.placeId || offer.place_id;
    const imageUrl = offer.imageUrl || offer.image_url || '';
    const sc = offer.status === 'approved' ? 'pill-approved' : offer.status === 'rejected' ? 'pill-rejected' : 'pill-pending';
    return '<div class="offer-card" data-id="' + offer.id + '">' +
      '<img class="offer-thumb" src="' + (escapeHtml(imageUrl) || '/placeholder.png') + '" alt="" data-fallback="/placeholder.png">' +
      '<div class="offer-info">' +
        '<h4 class="offer-title">' + escapeHtml(offer.title) + '</h4>' +
        '<p class="offer-desc">' + escapeHtml(offer.description) + '</p>' +
        '<div class="offer-meta">' +
          '<span><strong>Store:</strong> <a href="/store?id=' + placeId + '" class="store-link" target="_blank">' + escapeHtml(placeName) + '</a></span>' +
          '<span><strong>Value:</strong> ' + formatMoney(offer.estimatedValue || offer.estimated_value) + '</span>' +
          '<span><strong>Submitted:</strong> ' + formatDate(offer.createdAt || offer.created_at) + '</span>' +
          '<span class="pill ' + sc + '">' + offer.status.charAt(0).toUpperCase() + offer.status.slice(1) + '</span>' +
        '</div>' +
        (offer.adminNotes ? '<div class="muted" style="margin-top:8px;"><strong>Notes:</strong> ' + escapeHtml(offer.adminNotes) + '</div>' : '') +
      '</div>' +
      '<div class="offer-actions">' +
        (isPending
          ? '<button class="btn btn-approve" data-offer-id="' + offer.id + '" data-action="approve">Approve</button>' +
            '<button class="btn btn-reject" data-offer-id="' + offer.id + '" data-action="reject">Reject</button>'
          : '<button class="btn btn-secondary" data-offer-id="' + offer.id + '" data-action="view">View Details</button>') +
      '</div>' +
    '</div>';
  }).join('');
}

function openReviewModal(offerId, action) {
  selectedOffer = allOffers.find(o => Number(o.id) === Number(offerId));
  if (!selectedOffer) return;
  reviewAction = action;
  const isPending = selectedOffer.status === 'pending';
  const imageUrl = selectedOffer.imageUrl || selectedOffer.image_url || '';
  const placeName = selectedOffer.place?.name || selectedOffer.placeName || selectedOffer.placename || 'Unknown Store';
  const placeId = selectedOffer.placeId || selectedOffer.place_id;
  const sc = selectedOffer.status === 'approved' ? 'pill-approved' : selectedOffer.status === 'rejected' ? 'pill-rejected' : 'pill-pending';
  $('modalTitle').textContent = action === 'approve' ? 'Approve Offer' : action === 'reject' ? 'Reject Offer' : 'Offer Details';
  $('modalOfferInfo').innerHTML = '<div style="margin-bottom:16px;">' +
    (imageUrl ? '<img src="' + escapeHtml(imageUrl) + '" style="width:100%;max-height:200px;object-fit:cover;border-radius:10px;margin-bottom:12px;" data-hide-on-error="true">' : '') +
    '<h4 style="margin:0 0 8px 0;">' + escapeHtml(selectedOffer.title) + '</h4>' +
    '<p class="muted" style="margin:0 0 12px 0;">' + escapeHtml(selectedOffer.description) + '</p>' +
    '<div class="offer-meta"><span><strong>Store:</strong> ' + escapeHtml(placeName) + '</span><span><strong>Value:</strong> ' + formatMoney(selectedOffer.estimatedValue || selectedOffer.estimated_value) + '</span></div>' +
    '<div class="offer-meta" style="margin-top:8px;"><span><strong>Submitted:</strong> ' + formatDate(selectedOffer.createdAt || selectedOffer.created_at) + '</span>' +
    '<span class="pill ' + sc + '">' + selectedOffer.status.charAt(0).toUpperCase() + selectedOffer.status.slice(1) + '</span></div></div>';
  var dg = $('modalDatesGroup'), ab = $('modalApproveBtn'), rb = $('modalRejectBtn');
  if (action === 'approve' && isPending) {
    dg.style.display = 'block'; ab.style.display = 'inline-flex'; rb.style.display = 'none';
    var now = new Date(), end = new Date(now.getTime() + 30*24*60*60*1000);
    $('modalStartsAt').value = now.toISOString().slice(0,16);
    $('modalEndsAt').value = end.toISOString().slice(0,16);
  } else if (action === 'reject' && isPending) {
    dg.style.display = 'none'; ab.style.display = 'none'; rb.style.display = 'inline-flex';
  } else {
    dg.style.display = 'none'; ab.style.display = 'none'; rb.style.display = 'none';
  }
  $('modalNotes').value = '';
  $('reviewModal').classList.add('active');
}

function closeModal() { $('reviewModal').classList.remove('active'); selectedOffer = null; reviewAction = null; }

async function submitReview(status) {
  if (!selectedOffer) return;
  var btn = status === 'approved' ? $('modalApproveBtn') : $('modalRejectBtn');
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    var payload = { status: status, notes: $('modalNotes').value || '' };
    if (status === 'approved') {
      var s = $('modalStartsAt').value, e = $('modalEndsAt').value;
      if (s) payload.startsAt = new Date(s).toISOString();
      if (e) payload.endsAt = new Date(e).toISOString();
    }
    var resp = await fetch('/api/admin/giveaway/offer/' + selectedOffer.id + '/review', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload)
    });
    if (!resp.ok) { var err = await resp.json().catch(function() { return {}; }); throw new Error(err.error || 'Review failed'); }
    closeModal(); await loadOffers();
  } catch (err) {
    console.error('Review error:', err);
    alert('Error: ' + err.message);
  } finally { btn.disabled = false; btn.textContent = status === 'approved' ? 'Approve' : 'Reject'; }
}

// Helper: check if click coordinates are inside an element
function isClickInside(el, x, y) {
  if (!el || el.style.display === 'none') return false;
  var r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

// MODAL CLICK HANDLER - uses coordinates because CSS overlay blocks direct button clicks
$('reviewModal').addEventListener('click', function(e) {
  // Check buttons first (most specific)
  if (isClickInside($('modalApproveBtn'), e.clientX, e.clientY)) { submitReview('approved'); return; }
  if (isClickInside($('modalRejectBtn'), e.clientX, e.clientY)) { submitReview('rejected'); return; }
  if (isClickInside($('modalCancelBtn'), e.clientX, e.clientY)) { closeModal(); return; }
  // Click outside the modal box = close
  var box = document.querySelector('#reviewModal .modal');
  if (box) {
    var r = box.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
      closeModal();
    }
  }
});

document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeModal(); });

// Tab filtering
document.querySelectorAll('.tab-btn').forEach(function(b) {
  b.addEventListener('click', function() {
    document.querySelectorAll('.tab-btn').forEach(function(x) { x.classList.remove('active'); });
    b.classList.add('active'); currentFilter = b.dataset.status; renderOffers();
  });
});

// Offer card buttons (event delegation)
$('offersGrid').addEventListener('click', function(e) {
  var btn = e.target.closest('[data-offer-id]');
  if (btn) openReviewModal(parseInt(btn.dataset.offerId), btn.dataset.action);
});

// Image fallbacks
document.addEventListener('error', function(e) {
  if (e.target.tagName === 'IMG') {
    if (e.target.dataset.fallback) { e.target.src = e.target.dataset.fallback; e.target.removeAttribute('data-fallback'); }
    if (e.target.dataset.hideOnError) { e.target.style.display = 'none'; }
  }
}, true);

loadOffers();
