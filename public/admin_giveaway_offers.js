var $ = function(id) { return document.getElementById(id); };
var allOffers = [], currentFilter = 'all';

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, function(m) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[m];
  });
}
function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleString('en-US', { year:'numeric', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
}
function formatMoney(v) { return parseFloat(v || 0).toFixed(2); }

function loadOffers() {
  $('offersLoading').style.display = 'block';
  $('offersGrid').style.display = 'none';
  $('offersEmpty').style.display = 'none';
  fetch('/api/admin/giveaway/offers', { credentials: 'include' })
    .then(function(resp) {
      if (!resp.ok) throw new Error('Failed to load');
      return resp.json();
    })
    .then(function(data) {
      allOffers = Array.isArray(data) ? data : (data.offers || []);
      updateStats();
      renderOffers();
      $('offersLoading').style.display = 'none';
    })
    .catch(function(err) {
      console.error('Load error:', err);
      $('offersGrid').innerHTML = '<div class="empty">Error loading offers</div>';
      $('offersGrid').style.display = 'block';
      $('offersLoading').style.display = 'none';
    });
}

function updateStats() {
  $('statPending').textContent = allOffers.filter(function(o) { return o.status === 'pending'; }).length;
  $('statApproved').textContent = allOffers.filter(function(o) { return o.status === 'approved'; }).length;
  $('statRejected').textContent = allOffers.filter(function(o) { return o.status === 'rejected'; }).length;
  $('statTotal').textContent = allOffers.length;
}

function renderOffers() {
  var filtered = currentFilter === 'all' ? allOffers : allOffers.filter(function(o) { return o.status === currentFilter; });
  if (filtered.length === 0) { $('offersGrid').style.display = 'none'; $('offersEmpty').style.display = 'block'; return; }
  $('offersEmpty').style.display = 'none';
  $('offersGrid').style.display = 'grid';
  var html = '';
  for (var i = 0; i < filtered.length; i++) {
    var offer = filtered[i];
    var isPending = offer.status === 'pending';
    var placeName = (offer.place && offer.place.name) || offer.placeName || offer.placename || 'Unknown Store';
    var placeId = offer.placeId || offer.place_id;
    var imageUrl = offer.imageUrl || offer.image_url || '';
    var sc = offer.status === 'approved' ? 'pill-approved' : offer.status === 'rejected' ? 'pill-rejected' : 'pill-pending';
    var statusLabel = offer.status.charAt(0).toUpperCase() + offer.status.slice(1);
    html += '<div class="offer-card" data-id="' + offer.id + '">' +
      '<img class="offer-thumb" src="' + (escapeHtml(imageUrl) || '/placeholder.png') + '" alt="" data-fallback="/placeholder.png">' +
      '<div class="offer-info">' +
        '<h4 class="offer-title">' + escapeHtml(offer.title) + '</h4>' +
        '<p class="offer-desc">' + escapeHtml(offer.description) + '</p>' +
        '<div class="offer-meta">' +
          '<span><strong>Store:</strong> ' + escapeHtml(placeName) + '</span>' +
          '<span><strong>Value:</strong> ' + formatMoney(offer.estimatedValue || offer.estimated_value) + '</span>' +
          '<span><strong>Submitted:</strong> ' + formatDate(offer.createdAt || offer.created_at) + '</span>' +
          '<span class="pill ' + sc + '">' + statusLabel + '</span>' +
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
  }
  $('offersGrid').innerHTML = html;
}

function findOffer(offerId) {
  for (var i = 0; i < allOffers.length; i++) {
    if (Number(allOffers[i].id) === Number(offerId)) return allOffers[i];
  }
  return null;
}

function toLocalDatetime(d) {
  var dt = new Date(d);
  dt.setMinutes(dt.getMinutes() - dt.getTimezoneOffset());
  return dt.toISOString().slice(0, 16);
}

var pendingApprovalOfferId = null;

function openApproveModal(offer) {
  var placeName = (offer.place && offer.place.name) || offer.placeName || offer.placename || 'Unknown Store';
  $('modalTitle').textContent = 'Approve Offer';
  $('modalOfferInfo').innerHTML =
    '<div style="margin-bottom:12px;">' +
      '<strong>' + escapeHtml(offer.title) + '</strong><br>' +
      '<span class="muted">Store: ' + escapeHtml(placeName) + '</span><br>' +
      '<span class="muted">Value: $' + formatMoney(offer.estimatedValue || offer.estimated_value) + '</span>' +
    '</div>';
  var now = new Date();
  var end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  $('modalStartsAt').value = toLocalDatetime(now);
  $('modalEndsAt').value = toLocalDatetime(end);
  $('modalNotes').value = '';
  pendingApprovalOfferId = offer.id;
  $('modalApproveBtn').disabled = false;
  $('modalApproveBtn').textContent = 'Approve';
  $('reviewModal').classList.add('active');
}

function closeModal() {
  $('reviewModal').classList.remove('active');
  pendingApprovalOfferId = null;
}

function submitApproval() {
  var offer = findOffer(pendingApprovalOfferId);
  if (!offer) { alert('Offer not found'); closeModal(); return; }
  var startsAt = $('modalStartsAt').value ? new Date($('modalStartsAt').value).toISOString() : new Date().toISOString();
  var endsAt = $('modalEndsAt').value ? new Date($('modalEndsAt').value).toISOString() : new Date(Date.now() + 30*24*60*60*1000).toISOString();
  var notes = ($('modalNotes').value || '').trim();
  var payload = { status: 'approved', notes: notes, startsAt: startsAt, endsAt: endsAt };
  $('modalApproveBtn').disabled = true;
  $('modalApproveBtn').textContent = 'Saving...';
  fetch('/api/admin/giveaway/offer/' + offer.id + '/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload)
  })
  .then(function(resp) {
    if (!resp.ok) return resp.json().then(function(d) { throw new Error(d.error || 'Failed'); });
    return resp.json();
  })
  .then(function() {
    closeModal();
    loadOffers();
  })
  .catch(function(err) {
    console.error('Approve error:', err);
    alert('Error: ' + err.message);
    $('modalApproveBtn').disabled = false;
    $('modalApproveBtn').textContent = 'Approve';
  });
}

function submitReject(offerId) {
  var offer = findOffer(offerId);
  if (!offer) { alert('Offer not found'); return; }
  var placeName = (offer.place && offer.place.name) || offer.placeName || offer.placename || 'Unknown Store';
  if (!confirm('REJECT this offer?\n\n"' + offer.title + '"\nfrom ' + placeName)) return;
  var notes = prompt('Rejection reason (optional):', '') || '';
  var btn = document.querySelector('[data-offer-id="' + offerId + '"][data-action="reject"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  fetch('/api/admin/giveaway/offer/' + offer.id + '/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ status: 'rejected', notes: notes })
  })
  .then(function(resp) {
    if (!resp.ok) return resp.json().then(function(d) { throw new Error(d.error || 'Failed'); });
    return resp.json();
  })
  .then(function() {
    loadOffers();
  })
  .catch(function(err) {
    console.error('Reject error:', err);
    alert('Error: ' + err.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Reject'; }
  });
}

function handleAction(offerId, action) {
  var offer = findOffer(offerId);
  if (!offer) { alert('Offer not found'); return; }
  if (action === 'view') {
    var placeName = (offer.place && offer.place.name) || offer.placeName || offer.placename || 'Unknown Store';
    alert('Offer: ' + offer.title + '\nStore: ' + placeName + '\nValue: $' + formatMoney(offer.estimatedValue || offer.estimated_value) + '\nStatus: ' + offer.status + '\nSubmitted: ' + formatDate(offer.createdAt || offer.created_at) + (offer.adminNotes ? '\nNotes: ' + offer.adminNotes : ''));
    return;
  }
  if (action === 'approve') { openApproveModal(offer); return; }
  if (action === 'reject') { submitReject(offerId); return; }
}

// Tab filtering
document.querySelectorAll('.tab-btn').forEach(function(b) {
  b.addEventListener('click', function() {
    document.querySelectorAll('.tab-btn').forEach(function(x) { x.classList.remove('active'); });
    b.classList.add('active');
    currentFilter = b.dataset.status;
    renderOffers();
  });
});

// Offer card buttons - event delegation
$('offersGrid').addEventListener('click', function(e) {
  var btn = e.target.closest('[data-offer-id]');
  if (btn) handleAction(parseInt(btn.dataset.offerId), btn.dataset.action);
});

// Modal buttons
$('modalApproveBtn').addEventListener('click', submitApproval);
$('modalCancelBtn').addEventListener('click', closeModal);

// Close modal on overlay click (background area)
$('reviewModal').addEventListener('click', function(e) {
  if (e.target === $('reviewModal')) closeModal();
});

// Image fallbacks
document.addEventListener('error', function(e) {
  if (e.target.tagName === 'IMG') {
    if (e.target.dataset.fallback) { e.target.src = e.target.dataset.fallback; e.target.removeAttribute('data-fallback'); }
    if (e.target.dataset.hideOnError) { e.target.style.display = 'none'; }
  }
}, true);

loadOffers();
