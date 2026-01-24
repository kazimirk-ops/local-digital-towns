const $ = (id) => document.getElementById(id);

let currentPlaceId = null;
let currentSubscription = null;
let myStores = [];

async function api(url, opts = {}) {
  const res = await fetch(url, { credentials: 'include', ...opts });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(typeof data === 'string' ? data : (data.error || JSON.stringify(data)));
  return data;
}

function formatDate(iso) {
  if (!iso) return 'N/A';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function formatCurrency(cents) {
  if (!cents && cents !== 0) return '$0.00';
  return '$' + (cents / 100).toFixed(2);
}

function getDaysRemaining(iso) {
  if (!iso) return 0;
  const end = new Date(iso);
  const now = new Date();
  const diff = end - now;
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function getPlanName(plan) {
  const plans = {
    'free_trial': 'Free Trial',
    'monthly': 'Monthly Plan',
    'annual': 'Annual Plan',
    'free_month': 'Free Month (Giveaway)'
  };
  return plans[plan] || plan || 'Unknown';
}

function showError(msg) {
  const el = $('errorMsg');
  el.textContent = msg;
  el.style.display = 'block';
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => { el.style.display = 'none'; }, 6000);
}

function showSuccess(msg) {
  const el = $('successMsg');
  el.textContent = msg;
  el.style.display = 'block';
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => { el.style.display = 'none'; }, 6000);
}

async function loadMyStores() {
  try {
    const me = await api('/api/me');
    if (!me || !me.user) {
      window.location.href = '/auth/login?redirect=/business-subscription';
      return;
    }

    const places = await api('/api/places/mine');
    myStores = places.filter(p =>
      (p.status === 'approved' || p.status === 'pending')
    );

    $('loadingState').style.display = 'none';

    if (myStores.length === 0) {
      $('noStoresState').style.display = 'block';
      return;
    }

    const select = $('storeSelect');
    myStores.forEach(store => {
      const opt = document.createElement('option');
      opt.value = store.id;
      opt.textContent = store.name;
      select.appendChild(opt);
    });

    const urlParams = new URLSearchParams(window.location.search);
    const urlPlaceId = urlParams.get('placeId');

    if (urlPlaceId && myStores.find(s => String(s.id) === urlPlaceId)) {
      select.value = urlPlaceId;
      currentPlaceId = Number(urlPlaceId);
    } else {
      select.value = myStores[0].id;
      currentPlaceId = myStores[0].id;
    }

    updateStoreLinks();
    $('mainContent').style.display = 'block';
    await fetchSubscriptionStatus();
  } catch (e) {
    $('loadingState').textContent = 'Error: ' + e.message;
    console.error('Failed to load stores:', e);
  }
}

async function handleStoreChange() {
  const select = $('storeSelect');
  if (!select.value) return;
  currentPlaceId = Number(select.value);

  const url = new URL(window.location);
  url.searchParams.set('placeId', currentPlaceId);
  window.history.replaceState({}, '', url);

  updateStoreLinks();
  await fetchSubscriptionStatus();
}

function updateStoreLinks() {
  if (currentPlaceId) {
    $('viewStoreLink').href = `/store?id=${currentPlaceId}`;
    $('viewStoreLink').style.display = 'inline-flex';
    const settingsLink = $('storeSettingsLink');
    if (settingsLink) settingsLink.href = `/store/settings?placeId=${currentPlaceId}`;
  }
}

async function fetchSubscriptionStatus() {
  if (!currentPlaceId) return;

  try {
    const result = await api(`/api/business/subscription/${currentPlaceId}`);
    currentSubscription = result.subscription;
    renderStatusCard(result.subscription, result.isActive);
    renderBenefits(result.isActive);
    renderActionButtons(result.subscription, result.isActive);
    await loadPaymentHistory();
  } catch (e) {
    currentSubscription = null;
    renderStatusCard(null, false);
    renderBenefits(false);
    renderActionButtons(null, false);
    $('paymentHistoryCard').style.display = 'none';
  }
}

function renderStatusCard(sub, isActive) {
  const statusCard = $('statusCard');
  const statusBadge = $('statusBadge');
  const planBadge = $('planBadge');
  const statusIcon = $('statusIcon');
  const statusTitle = $('statusTitle');
  const statusSubtitle = $('statusSubtitle');
  const statusDetails = $('statusDetails');

  statusCard.classList.remove('active', 'trial', 'expired', 'none');
  statusBadge.classList.remove('active', 'trial', 'expired', 'none');

  if (!sub) {
    statusCard.classList.add('none');
    statusBadge.classList.add('none');
    statusBadge.textContent = 'No Subscription';
    planBadge.textContent = '';
    statusIcon.textContent = '📋';
    statusTitle.textContent = 'Start Your Free Trial';
    statusSubtitle.textContent = 'Get 30 days free to try all features';
    statusDetails.style.display = 'none';
    return;
  }

  const plan = sub.plan || 'free_trial';
  const status = (sub.status || 'active').toLowerCase();
  const isTrial = plan === 'free_trial';
  const endDate = sub.trialEndsAt || sub.currentPeriodEnd;
  const daysLeft = getDaysRemaining(endDate);

  planBadge.textContent = getPlanName(plan);
  statusDetails.style.display = 'block';

  $('detailPlan').textContent = getPlanName(plan);
  $('detailStartDate').textContent = formatDate(sub.createdAt || sub.currentPeriodStart);

  if (isActive && isTrial) {
    statusCard.classList.add('trial');
    statusBadge.classList.add('trial');
    statusBadge.textContent = 'Free Trial';
    statusIcon.textContent = '🎯';
    statusTitle.textContent = `${daysLeft} Days Remaining`;
    statusSubtitle.textContent = 'Your free trial is active';
    $('detailStatus').textContent = 'Active (Trial)';
    $('endDateLabel').textContent = 'Trial Ends';
    $('detailEndDate').textContent = formatDate(sub.trialEndsAt);
    $('detailDaysRemaining').textContent = daysLeft;
    $('daysRemainingRow').style.display = 'flex';
  } else if (isActive) {
    statusCard.classList.add('active');
    statusBadge.classList.add('active');
    statusBadge.textContent = 'Active';
    statusIcon.textContent = '✅';
    statusTitle.textContent = 'Subscription Active';
    statusSubtitle.textContent = 'All features unlocked';
    $('detailStatus').textContent = sub.canceledAt ? 'Canceled (Active until period end)' : 'Active';
    $('endDateLabel').textContent = sub.canceledAt ? 'Access Until' : 'Renews';
    $('detailEndDate').textContent = formatDate(sub.currentPeriodEnd);
    $('detailDaysRemaining').textContent = daysLeft;
    $('daysRemainingRow').style.display = 'flex';
  } else {
    statusCard.classList.add('expired');
    statusBadge.classList.add('expired');
    statusBadge.textContent = 'Expired';
    statusIcon.textContent = '⚠️';
    statusTitle.textContent = 'Subscription Expired';
    statusSubtitle.textContent = 'Reactivate to continue using all features';
    $('detailStatus').textContent = 'Expired';
    $('endDateLabel').textContent = 'Ended';
    $('detailEndDate').textContent = formatDate(endDate);
    $('daysRemainingRow').style.display = 'none';
  }
}

function renderBenefits(isActive) {
  const benefits = document.querySelectorAll('.benefit-item');
  benefits.forEach(benefit => {
    if (isActive) {
      benefit.classList.remove('locked');
    } else {
      benefit.classList.add('locked');
    }
  });
}

function renderActionButtons(sub, isActive) {
  $('noSubActions').style.display = 'none';
  $('trialActiveActions').style.display = 'none';
  $('paidActiveActions').style.display = 'none';
  $('expiredActions').style.display = 'none';

  if (!sub) {
    $('noSubActions').style.display = 'block';
    return;
  }

  const plan = sub.plan || 'free_trial';
  const isTrial = plan === 'free_trial';

  if (isActive && isTrial) {
    $('trialActiveActions').style.display = 'block';
  } else if (isActive) {
    $('paidActiveActions').style.display = 'block';
  } else {
    $('expiredActions').style.display = 'block';
  }
}

async function startFreeTrial() {
  if (!currentPlaceId) {
    showError('Please select a store first');
    return;
  }

  const btn = $('startTrialBtn');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-icon">⏳</span> Starting...';

  try {
    const result = await api('/api/business/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ placeId: currentPlaceId })
    });

    showSuccess('Free trial started! Enjoy 30 days of full access.');
    currentSubscription = result.subscription;
    renderStatusCard(result.subscription, true);
    renderBenefits(true);
    renderActionButtons(result.subscription, true);
  } catch (e) {
    showError(e.message);
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

async function upgradeToPaid(event) {
  const clickedBtn = event?.target?.closest('button');

  if (!currentPlaceId) {
    showError('Please select a store first');
    return;
  }

  const btn = clickedBtn || $('upgradeBtn') || $('reactivateBtn');

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-icon">⏳</span> Redirecting to checkout...';
  }

  try {
    const response = await api('/api/business/subscribe/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ placeId: currentPlaceId })
    });

    if (response.url) {
      window.location.href = response.url;
      return;
    }

    showError('Unable to create checkout session. Please try again.');
    resetUpgradeButton(btn);
  } catch (e) {
    if (e.message.includes('not configured') || e.message.includes('coming soon')) {
      showError('Paid subscriptions are coming soon! For now, enjoy your free trial or submit a giveaway offer for a free month.');
    } else {
      showError(e.message);
    }
    resetUpgradeButton(btn);
  }
}

function resetUpgradeButton(btn) {
  if (!btn) return;
  btn.disabled = false;
  if (btn.id === 'reactivateBtn') {
    btn.innerHTML = '<span class="btn-icon">🔄</span> Reactivate — $9.99/month';
  } else {
    btn.innerHTML = '<span class="btn-icon">⬆️</span> Upgrade to Paid — $9.99/month';
  }
}

async function manageSubscription() {
  if (!currentPlaceId) {
    showError('Please select a store first');
    return;
  }

  const btn = $('manageBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-icon">⏳</span> Loading...';
  }

  try {
    const response = await api('/api/business/subscribe/portal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ placeId: currentPlaceId })
    });

    if (response.url) {
      window.location.href = response.url;
      return;
    }

    showError('Unable to open subscription portal.');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span class="btn-icon">⚙️</span> Manage Subscription';
    }
  } catch (e) {
    showError(e.message || 'Subscription portal not available.');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span class="btn-icon">⚙️</span> Manage Subscription';
    }
  }
}

function confirmCancel() {
  $('cancelModal').style.display = 'flex';
}

function closeCancelModal() {
  $('cancelModal').style.display = 'none';
}

async function cancelSubscription() {
  if (!currentPlaceId) {
    showError('Please select a store first');
    closeCancelModal();
    return;
  }

  const btn = $('confirmCancelBtn');
  btn.disabled = true;
  btn.textContent = 'Canceling...';

  try {
    await api('/api/business/subscribe/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ placeId: currentPlaceId })
    });

    closeCancelModal();
    showSuccess('Subscription canceled. You will have access until the end of your billing period.');
    await fetchSubscriptionStatus();
  } catch (e) {
    showError(e.message);
    btn.disabled = false;
    btn.textContent = 'Yes, Cancel';
  }
}

async function loadPaymentHistory() {
  if (!currentPlaceId) return;

  const card = $('paymentHistoryCard');
  const loading = $('paymentHistoryLoading');
  const empty = $('paymentHistoryEmpty');
  const table = $('paymentHistoryTable');
  const tbody = $('paymentHistoryBody');

  card.style.display = 'block';
  loading.style.display = 'block';
  empty.style.display = 'none';
  table.style.display = 'none';

  try {
    const history = await api(`/api/business/subscribe/history/${currentPlaceId}`);

    loading.style.display = 'none';

    if (!history || !history.payments || history.payments.length === 0) {
      empty.style.display = 'block';
      return;
    }

    table.style.display = 'table';
    tbody.innerHTML = history.payments.map(payment => `
      <tr>
        <td>${formatDate(payment.createdAt || payment.date)}</td>
        <td>${escapeHtml(payment.description || 'Subscription payment')}</td>
        <td>${formatCurrency(payment.amount)}</td>
        <td><span class="payment-status ${payment.status}">${payment.status}</span></td>
      </tr>
    `).join('');
  } catch (e) {
    loading.style.display = 'none';
    empty.style.display = 'block';
    empty.textContent = 'No payment history yet.';
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

// Close modal on overlay click
$('cancelModal')?.addEventListener('click', (e) => {
  if (e.target === $('cancelModal')) closeCancelModal();
});

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('cancelModal').style.display !== 'none') {
    closeCancelModal();
  }
});

// Check for success/cancel from Stripe redirect
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('success') === 'true') {
  setTimeout(() => {
    showSuccess('Payment successful! Your subscription is now active.');
  }, 500);
  // Clean up URL
  const url = new URL(window.location);
  url.searchParams.delete('success');
  url.searchParams.delete('session_id');
  window.history.replaceState({}, '', url);
}
if (urlParams.get('canceled') === 'true') {
  setTimeout(() => {
    showError('Checkout was canceled. Your subscription was not changed.');
  }, 500);
  const url = new URL(window.location);
  url.searchParams.delete('canceled');
  window.history.replaceState({}, '', url);
}

// Setup event listeners (CSP-compliant)
function setupEventListeners() {
  $('storeSelect')?.addEventListener('change', handleStoreChange);
  $('startTrialBtn')?.addEventListener('click', startFreeTrial);
  $('upgradeBtn')?.addEventListener('click', upgradeToPaid);
  $('reactivateBtn')?.addEventListener('click', upgradeToPaid);
  $('manageBtn')?.addEventListener('click', manageSubscription);
  $('cancelLink')?.addEventListener('click', (e) => { e.preventDefault(); confirmCancel(); });
  $('keepSubBtn')?.addEventListener('click', closeCancelModal);
  $('confirmCancelBtn')?.addEventListener('click', cancelSubscription);
}

// Initialize
setupEventListeners();
loadMyStores();
