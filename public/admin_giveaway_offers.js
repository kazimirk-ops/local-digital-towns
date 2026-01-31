const $ = (id) => document.getElementById(id);

let allOffers = [];
let currentFilter = 'all';
let selectedOffer = null;
let reviewAction = null;

console.log('[ADMIN-OFFERS] Script loaded v4');

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
  console.log('[ADMIN-OFFERS] loadOffers called');
  $('offersLoading').style.display = 'block';
  $('offersGrid').style.display = 'none';
  $('offersEmpty').style.display = 'none';
  try {
    const resp = await fetch('/api/admin/giveaway/offers', { credentials: 'include' });
    console.log('[ADMIN-OFFERS] API status:', resp.status);
    if (!resp.ok) throw new Error('Failed to load offers');
    const data = await resp.json();
    allOffers = Array.isArray(data) ? data : (data.offers || []);
    console.log('[ADMIN-OFFERS] Loaded', allOffers.length, 'offers');
    updateStats();
    renderOffers();
  } catch (err) {
    console.error('[ADMIN-OFFERS] Load error:', err);
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
    const statusClass = offer.status === 'approved' ? 'pill-approved' : offer.status === 'rejected' ? 'pill-rejected' : 'pill-pending';
    return `<div class="offer-card" data-id="${offer.id}">
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
    </div>`;
  }).join('');
}

function openReviewModal(offerId, action) {
  console.log('[ADMIN-OFFERS] openReviewModal - offerId:', offerId, typeof offerId, 'action:', action);
  selectedOffer = allOffers.find(o => Number(o.id) === Number(offerId));
  if (!selectedOffer) { console.error('[ADMIN-OFFERS] Offer not found! IDs:', allOffers.map(o => o.id)); return; }
  reviewAction = action;
  const isPending = selectedOffer.status === 'pending';
  const imageUrl = selectedOffer.imageUrl || selectedOffer.image_url || '';
  const placeName = selectedOffer.place?.name || selectedOffer.placeName || selectedOffer.placename || 'Unknown Store';
  const placeId = selectedOffer.placeId || selectedOffer.place_id;
  const statusClass = selectedOffer.status === 'approved' ? 'pill-approved' : selectedOffer.status === 'rejected' ? 'pill-rejected' : 'pill-pending';
  $('modalTitle').textContent = action === 'approve' ? 'Approve Offer' : action === 'reject' ? 'Reject Offer' : 'Offer Details';
  $('modalOfferInfo').innerHTML = `<div style="margin-bottom:16px;">
    ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" style="width:100%;max-height:200px;object-fit:cover;border-radius:10px;margin-bottom:12px;" data-hide-on-error="true">` : ''}
    <h4 style="margin:0 0 8px 0;">${escapeHtml(selectedOffer.title)}</h4>
    <p class="muted" style="margin:0 0 12px 0;">${escapeHtml(selectedOffer.description)}</p>
    <div class="offer-meta"><span><strong>Store:</strong> ${escapeHtml(placeName)}</span><span><strong>Value:</strong> ${formatMoney(selectedOffer.estimatedValue || selectedOffer.estimated_value)}</span></div>
    <div class="offer-meta" style="margin-top:8px;"><span><strong>Submitted:</strong> ${formatDate(selectedOffer.createdAt || selectedOffer.created_at)}</span>
    <span class="pill ${statusClass}">${selectedOffer.status.charAt(0).toUpperCase() + selectedOffer.status.slice(1)}</span></div>
  </div>`;
  const datesGroup = $('modalDatesGroup'), approveBtn = $('modalApproveBtn'), rejectBtn = $('modalRejectBtn');
  if (action === 'approve' && isPending) {
    datesGroup.style.display = 'block'; approveBtn.style.display = 'inline-flex'; rejectBtn.style.display = 'none';
    const now = new Date(), end = new Date(now.getTime() + 30*24*60*60*1000);
    $('modalStartsAt').value = now.toISOString().slice(0,16);
    $('modalEndsAt').value = end.toISOString().slice(0,16);
  } else if (action === 'reject' && isPending) {
    datesGroup.style.display = 'none'; approveBtn.style.display = 'none'; rejectBtn.style.display = 'inline-flex';
  } else {
    datesGroup.style.display = 'none'; approveBtn.style.display = 'none'; rejectBtn.style.display = 'none';
  }
  $('modalNotes').value = '';
  $('reviewModal').classList.add('active');
  console.log('[ADMIN-OFFERS] Modal opened. selectedOffer.id:', selectedOffer.id);
}

function closeModal() { console.log('[ADMIN-OFFERS] closeModal'); $('reviewModal').classList.remove('active'); selectedOffer = null; reviewAction = null; }

async function submitReview(status) {
  console.log('[ADMIN-OFFERS] submitReview called:', status, 'selectedOffer:', selectedOffer?.id);
  if (!selectedOffer) { console.error('[ADMIN-OFFERS] NO SELECTED OFFER!'); return; }
  const btn = status === 'approved' ? $('modalApproveBtn') : $('modalRejectBtn');
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    const payload = { status, notes: $('modalNotes').value || '' };
    if (status === 'approved') {
      const s = $('modalStartsAt').value, e = $('modalEndsAt').value;
      if (s) payload.startsAt = new Date(s).toISOString();
      if (e) payload.endsAt = new Date(e).toISOString();
    }
    console.log('[ADMIN-OFFERS] POST', '/api/admin/giveaway/offer/' + selectedOffer.id + '/review', JSON.stringify(payload));
    const resp = await fetch('/api/admin/giveaway/offer/' + selectedOffer.id + '/review', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload)
    });
    const txt = await resp.text();
    console.log('[ADMIN-OFFERS] Response:', resp.status, txt);
    if (!resp.ok) throw new Error(txt || 'Review failed');
    closeModal(); await loadOffers();
  } catch (err) {
    console.error('[ADMIN-OFFERS] ERROR:', err);
    alert('Error: ' + err.message);
  } finally { btn.disabled = false; btn.textContent = status === 'approved' ? 'Approve' : 'Reject'; }
}

// ── Event Listeners ──
console.log('[ADMIN-OFFERS] Registering listeners. Buttons:', $('modalCancelBtn'), $('modalRejectBtn'), $('modalApproveBtn'));

document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.tab-btn').forEach(x => x.classList.remove('active'));
  b.classList.add('active'); currentFilter = b.dataset.status; renderOffers();
}));

$('reviewModal').addEventListener('click', e => { if (e.target === $('reviewModal')) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
$('modalCancelBtn').addEventListener('click', () => { console.log('[ADMIN-OFFERS] CANCEL CLICKED'); closeModal(); });
$('modalRejectBtn').addEventListener('click', () => { console.log('[ADMIN-OFFERS] REJECT CLICKED'); submitReview('rejected'); });
$('modalApproveBtn').addEventListener('click', () => { console.log('[ADMIN-OFFERS] APPROVE CLICKED'); submitReview('approved'); });

$('offersGrid').addEventListener('click', e => {
  const btn = e.target.closest('[data-offer-id]');
  if (btn) { console.log('[ADMIN-OFFERS] Card button clicked:', btn.dataset); openReviewModal(parseInt(btn.dataset.offerId), btn.dataset.action); }
});

document.addEventListener('error', e => {
  if (e.target.tagName === 'IMG') {
    if (e.target.dataset.fallback) { e.target.src = e.target.dataset.fallback; e.target.removeAttribute('data-fallback'); }
    if (e.target.dataset.hideOnError) { e.target.style.display = 'none'; }
  }
}, true);

console.log('[ADMIN-OFFERS] Init complete, calling loadOffers');
loadOffers();
