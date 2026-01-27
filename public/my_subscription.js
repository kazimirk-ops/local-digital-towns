const $ = (id) => document.getElementById(id);

let currentUser = null;
let currentSubscription = null;
let selectedPlan = 'individual';

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

function getDaysRemaining(iso) {
  if (!iso) return 0;
  const end = new Date(iso);
  const now = new Date();
  const diff = end - now;
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
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

async function loadUserStatus() {
  try {
    const me = await api('/api/me');
    if (!me || !me.user) {
      window.location.href = '/auth/login?redirect=/my-subscription';
      return;
    }

    currentUser = me.user;

    // Try to load individual subscription
    try {
      const subResult = await api('/api/subscription/status');
      currentSubscription = subResult.subscription;
    } catch (e) {
      currentSubscription = null;
    }

    $('loadingState').style.display = 'none';
    $('mainContent').style.display = 'block';

    renderStatus();
  } catch (e) {
    $('loadingState').textContent = 'Error: ' + e.message;
    console.error('Failed to load user status:', e);
  }
}

function renderStatus() {
  const tier = currentUser.trustTier || 0;
  const isBuyerVerified = Number(currentUser.isBuyerVerified) === 1;

  // Hide all sections first
  $('upgradeSection').style.display = 'none';
  $('activeSection').style.display = 'none';
  $('upgradeToBusinessSection').style.display = 'none';
  $('expiredSection').style.display = 'none';

  const statusIcon = $('statusIcon');
  const statusBadge = $('statusBadge');
  const statusTitle = $('statusTitle');
  const statusSubtitle = $('statusSubtitle');
  const statusDetails = $('statusDetails');

  // Reset badge classes
  statusBadge.className = 'status-badge';

  if (tier === 0) {
    // Free tier
    statusIcon.textContent = '👤';
    statusBadge.classList.add('free');
    statusBadge.textContent = isBuyerVerified ? 'Verified Buyer' : 'Free Account';
    statusTitle.textContent = 'Free Buyer Account';
    statusSubtitle.textContent = isBuyerVerified
      ? 'You can browse and buy from local businesses'
      : 'Complete verification to start buying';

    statusDetails.style.display = 'block';
    $('detailMemberSince').textContent = formatDate(currentUser.createdAt);
    $('trialEndsRow').style.display = 'none';
    $('renewsRow').style.display = 'none';

    // Show upgrade options
    $('upgradeSection').style.display = 'block';

    // Check if trial was already used
    if (currentUser.trialUsedAt) {
      $('startTrialBtn').textContent = 'Subscribe Now - $5/month';
      const trialNote = document.querySelector('#upgradeSection .muted:last-child');
      if (trialNote) trialNote.textContent = 'Your free trial has already been used.';
    }

  } else if (tier === 1) {
    // Individual tier
    renderIndividualStatus();

  } else if (tier >= 3) {
    // Business tier - redirect to business subscription page
    statusIcon.textContent = '🏪';
    statusBadge.classList.add('active');
    statusBadge.textContent = 'Business Account';
    statusTitle.textContent = 'Business Subscription';
    statusSubtitle.textContent = 'Manage your business subscription';

    statusDetails.style.display = 'block';
    $('detailMemberSince').textContent = formatDate(currentUser.createdAt);

    // Show link to business subscription
    const activeSection = $('activeSection');
    activeSection.style.display = 'block';
    activeSection.innerHTML = `
      <h3 class="card-title">Business Account</h3>
      <p class="muted">You have a business account. Manage your stores and subscriptions on the business page.</p>
      <div class="btn-group">
        <a href="/business-subscription" class="btn btn-primary">Manage Business Subscription</a>
        <a href="/me/store" class="btn btn-secondary">Store Dashboard</a>
      </div>
    `;
  }
}

function renderIndividualStatus() {
  const statusIcon = $('statusIcon');
  const statusBadge = $('statusBadge');
  const statusTitle = $('statusTitle');
  const statusSubtitle = $('statusSubtitle');
  const statusDetails = $('statusDetails');

  if (!currentSubscription) {
    // Individual tier but no active subscription (expired?)
    statusIcon.textContent = '⚠️';
    statusBadge.classList.add('expired');
    statusBadge.textContent = 'Expired';
    statusTitle.textContent = 'Subscription Expired';
    statusSubtitle.textContent = 'Reactivate to continue using all features';

    statusDetails.style.display = 'block';
    $('detailMemberSince').textContent = formatDate(currentUser.createdAt);
    $('expiredSection').style.display = 'block';
    return;
  }

  const plan = currentSubscription.plan || 'individual';
  const status = (currentSubscription.status || 'active').toLowerCase();
  const isTrial = plan === 'free_trial' || plan === 'trial';
  const isActive = status === 'active' || status === 'trialing';

  if (!isActive) {
    // Expired
    statusIcon.textContent = '⚠️';
    statusBadge.classList.add('expired');
    statusBadge.textContent = 'Expired';
    statusTitle.textContent = 'Subscription Expired';
    statusSubtitle.textContent = 'Reactivate to continue using all features';

    statusDetails.style.display = 'block';
    $('detailMemberSince').textContent = formatDate(currentUser.createdAt);
    $('expiredSection').style.display = 'block';
    return;
  }

  if (isTrial) {
    // Trial active
    const daysLeft = getDaysRemaining(currentSubscription.trialEndsAt || currentSubscription.currentPeriodEnd);
    statusIcon.textContent = '🎯';
    statusBadge.classList.add('trial');
    statusBadge.textContent = 'Free Trial';
    statusTitle.textContent = `${daysLeft} Days Remaining`;
    statusSubtitle.textContent = 'Your free trial is active';

    statusDetails.style.display = 'block';
    $('detailMemberSince').textContent = formatDate(currentUser.createdAt);
    $('trialEndsRow').style.display = 'flex';
    $('detailTrialEnds').textContent = formatDate(currentSubscription.trialEndsAt || currentSubscription.currentPeriodEnd);
    $('renewsRow').style.display = 'none';

    $('activeSection').style.display = 'block';
    $('upgradeToBusinessSection').style.display = 'block';

  } else {
    // Paid active
    statusIcon.textContent = '✅';
    statusBadge.classList.add('active');
    statusBadge.textContent = 'Active';
    statusTitle.textContent = 'Individual Plan';
    statusSubtitle.textContent = 'All features unlocked';

    statusDetails.style.display = 'block';
    $('detailMemberSince').textContent = formatDate(currentUser.createdAt);
    $('trialEndsRow').style.display = 'none';
    $('renewsRow').style.display = 'flex';
    $('detailRenews').textContent = currentSubscription.canceledAt
      ? `Ends ${formatDate(currentSubscription.currentPeriodEnd)}`
      : formatDate(currentSubscription.currentPeriodEnd);

    $('activeSection').style.display = 'block';
    $('upgradeToBusinessSection').style.display = 'block';

    // Update tier info
    $('tierName').textContent = 'Individual Plan';
    $('tierPrice').textContent = currentSubscription.canceledAt ? 'Canceled - access until period end' : '$5/month';
  }
}

function selectPlan(plan) {
  selectedPlan = plan;

  document.querySelectorAll('.plan-option').forEach(el => {
    el.classList.remove('selected');
  });

  const selected = document.querySelector(`[data-plan="${plan}"]`);
  if (selected) selected.classList.add('selected');

  // Update features list based on plan
  const featuresList = $('featuresList');
  if (plan === 'business') {
    featuresList.innerHTML = `
      <li>Everything in Individual plan</li>
      <li>Featured storefront listing</li>
      <li>Post events to community calendar</li>
      <li>Business analytics dashboard</li>
      <li>7-day free trial</li>
    `;
    $('startTrialBtn').textContent = currentUser?.trialUsedAt
      ? 'Subscribe Now - $10/month'
      : 'Start 7-Day Free Trial';
  } else {
    featuresList.innerHTML = `
      <li>Sell on marketplace and auctions</li>
      <li>Enter town giveaways</li>
      <li>Direct messaging with buyers</li>
      <li>7-day free trial</li>
    `;
    $('startTrialBtn').textContent = currentUser?.trialUsedAt
      ? 'Subscribe Now - $5/month'
      : 'Start 7-Day Free Trial';
  }
}

async function startTrial() {
  const btn = $('startTrialBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Processing...';

  try {
    // If business plan selected, redirect to business flow
    if (selectedPlan === 'business') {
      window.location.href = '/apply/business';
      return;
    }

    // Start individual subscription
    const result = await api('/api/subscription/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: selectedPlan })
    });

    if (result.url) {
      // Redirect to Stripe checkout
      window.location.href = result.url;
      return;
    }

    // Trial started successfully
    showSuccess('Your subscription is now active!');
    currentSubscription = result.subscription;
    if (result.user) currentUser = result.user;
    renderStatus();

  } catch (e) {
    showError(e.message);
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

async function upgradeToBusiness() {
  const btn = $('upgradeToBusinessBtn');
  btn.disabled = true;
  btn.textContent = 'Processing...';

  try {
    const result = await api('/api/subscription/upgrade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'business' })
    });

    if (result.url) {
      window.location.href = result.url;
      return;
    }

    showSuccess('Upgraded to Business plan!');
    setTimeout(() => {
      window.location.href = '/business-subscription';
    }, 1500);

  } catch (e) {
    showError(e.message);
    btn.disabled = false;
    btn.textContent = 'Upgrade to Business';
  }
}

async function manageSubscription() {
  const btn = $('manageBtn');
  btn.disabled = true;
  btn.textContent = 'Loading...';

  try {
    const result = await api('/api/subscription/portal', {
      method: 'POST'
    });

    if (result.url) {
      window.location.href = result.url;
      return;
    }

    showError('Unable to open billing portal');
    btn.disabled = false;
    btn.textContent = 'Manage Payment Method';

  } catch (e) {
    showError(e.message);
    btn.disabled = false;
    btn.textContent = 'Manage Payment Method';
  }
}

function confirmCancel() {
  $('cancelModal').style.display = 'flex';
}

function closeCancelModal() {
  $('cancelModal').style.display = 'none';
}

async function cancelSubscription() {
  const btn = $('confirmCancelBtn');
  btn.disabled = true;
  btn.textContent = 'Canceling...';

  try {
    await api('/api/subscription/cancel', {
      method: 'POST'
    });

    closeCancelModal();
    showSuccess('Subscription canceled. You will have access until the end of your billing period.');
    await loadUserStatus();

  } catch (e) {
    showError(e.message);
    btn.disabled = false;
    btn.textContent = 'Yes, Cancel';
  }
}

async function reactivateSubscription() {
  const btn = $('reactivateBtn');
  btn.disabled = true;
  btn.textContent = 'Processing...';

  try {
    const result = await api('/api/subscription/reactivate', {
      method: 'POST'
    });

    if (result.url) {
      window.location.href = result.url;
      return;
    }

    showSuccess('Subscription reactivated!');
    await loadUserStatus();

  } catch (e) {
    showError(e.message);
    btn.disabled = false;
    btn.textContent = 'Reactivate Subscription';
  }
}

// Close modal on overlay click
$('cancelModal')?.addEventListener('click', (e) => {
  if (e.target === $('cancelModal')) closeCancelModal();
});

// Close modal on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('cancelModal')?.style.display !== 'none') {
    closeCancelModal();
  }
});

// Check for success/cancel from Stripe redirect
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('success') === 'true') {
  setTimeout(() => showSuccess('Payment successful! Your subscription is now active.'), 500);
  const url = new URL(window.location);
  url.searchParams.delete('success');
  url.searchParams.delete('session_id');
  window.history.replaceState({}, '', url);
}
if (urlParams.get('canceled') === 'true') {
  setTimeout(() => showError('Checkout was canceled.'), 500);
  const url = new URL(window.location);
  url.searchParams.delete('canceled');
  window.history.replaceState({}, '', url);
}

// Setup event listeners
function setupEventListeners() {
  // Plan selection
  document.querySelectorAll('.plan-option').forEach(el => {
    el.addEventListener('click', () => selectPlan(el.dataset.plan));
  });

  $('startTrialBtn')?.addEventListener('click', startTrial);
  $('upgradeToBusinessBtn')?.addEventListener('click', upgradeToBusiness);
  $('manageBtn')?.addEventListener('click', manageSubscription);
  $('reactivateBtn')?.addEventListener('click', reactivateSubscription);
  $('cancelLink')?.addEventListener('click', (e) => { e.preventDefault(); confirmCancel(); });
  $('keepSubBtn')?.addEventListener('click', closeCancelModal);
  $('confirmCancelBtn')?.addEventListener('click', cancelSubscription);
}

// Initialize
setupEventListeners();
loadUserStatus();
