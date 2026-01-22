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
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

function showSuccess(msg) {
  const el = $('successMsg');
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

async function loadMyStores() {
  try {
    const me = await api('/api/me');
    if (!me || !me.user) {
      window.location.href = '/auth/login?redirect=/business-subscription';
      return;
    }

    // Get places owned by this user
    const places = await api('/places');
    myStores = places.filter(p =>
      Number(p.ownerUserId || p.owneruserid) === Number(me.user.id) &&
      (p.status === 'approved' || p.status === 'pending')
    );

    $('loadingState').style.display = 'none';

    if (myStores.length === 0) {
      $('noStoresState').style.display = 'block';
      return;
    }

    // Populate store selector
    const select = $('storeSelect');
    myStores.forEach(store => {
      const opt = document.createElement('option');
      opt.value = store.id;
      opt.textContent = store.name;
      select.appendChild(opt);
    });

    // Check URL for placeId or use first store
    const urlParams = new URLSearchParams(window.location.search);
    const urlPlaceId = urlParams.get('placeId');

    if (urlPlaceId && myStores.find(s => String(s.id) === urlPlaceId)) {
      select.value = urlPlaceId;
      currentPlaceId = Number(urlPlaceId);
    } else {
      select.value = myStores[0].id;
      currentPlaceId = myStores[0].id;
    }

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

  // Update URL
  const url = new URL(window.location);
  url.searchParams.set('placeId', currentPlaceId);
  window.history.replaceState({}, '', url);

  await fetchSubscriptionStatus();
}

async function fetchSubscriptionStatus() {
  if (!currentPlaceId) return;

  try {
    const result = await api(`/api/business/subscription/${currentPlaceId}`);
    currentSubscription = result.subscription;
    displaySubscriptionCard(result.subscription, result.isActive);
    updateGiveawayLink();
  } catch (e) {
    // No subscription exists
    currentSubscription = null;
    displaySubscriptionCard(null, false);
    updateGiveawayLink();
  }
}

function displaySubscriptionCard(sub, isActive) {
  const statusCard = $('statusCard');
  const statusBadge = $('statusBadge');
  const statusTitle = $('statusTitle');
  const statusDetail = $('statusDetail');

  // Remove all status classes
  statusCard.classList.remove('active', 'trial', 'expired', 'none');
  statusBadge.classList.remove('active', 'trial', 'expired', 'none');

  // Hide all action sections
  $('noSubActions').style.display = 'none';
  $('activeSubActions').style.display = 'none';
  $('expiredSubActions').style.display = 'none';

  if (!sub) {
    // No subscription
    statusCard.classList.add('none');
    statusBadge.classList.add('none');
    statusBadge.textContent = 'No Subscription';
    statusTitle.textContent = 'Start Your Free Trial';
    statusDetail.textContent = 'Get 30 days free to try all features';
    $('noSubActions').style.display = 'block';
    return;
  }

  const plan = sub.plan || 'free_trial';
  const status = sub.status || 'active';

  if (isActive && plan === 'free_trial') {
    // Active trial
    const daysLeft = getDaysRemaining(sub.trialEndsAt);
    statusCard.classList.add('trial');
    statusBadge.classList.add('trial');
    statusBadge.textContent = 'Free Trial';
    statusTitle.textContent = `${daysLeft} Days Remaining`;
    statusDetail.textContent = `Trial ends ${formatDate(sub.trialEndsAt)}`;
    $('activeSubActions').style.display = 'block';
  } else if (isActive) {
    // Active paid subscription
    statusCard.classList.add('active');
    statusBadge.classList.add('active');
    statusBadge.textContent = 'Active';
    statusTitle.textContent = 'Subscription Active';
    statusDetail.textContent = `Renews ${formatDate(sub.currentPeriodEnd)}`;
    $('activeSubActions').style.display = 'block';
  } else {
    // Expired
    statusCard.classList.add('expired');
    statusBadge.classList.add('expired');
    statusBadge.textContent = 'Expired';
    statusTitle.textContent = 'Subscription Expired';
    statusDetail.textContent = `Ended ${formatDate(sub.currentPeriodEnd || sub.trialEndsAt)}`;
    $('expiredSubActions').style.display = 'block';
  }
}

function updateGiveawayLink() {
  const link = $('giveawayOfferLink');
  if (currentPlaceId) {
    link.href = `/giveaway-offer?placeId=${currentPlaceId}`;
  }
}

async function startFreeTrial() {
  if (!currentPlaceId) {
    showError('Please select a store first');
    return;
  }

  const btn = $('startTrialBtn');
  btn.disabled = true;
  btn.textContent = 'Starting...';

  try {
    const result = await api('/api/business/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ placeId: currentPlaceId })
    });

    showSuccess('Free trial started! Enjoy 30 days of full access.');
    currentSubscription = result.subscription;
    displaySubscriptionCard(result.subscription, true);
  } catch (e) {
    showError(e.message);
    btn.disabled = false;
    btn.textContent = 'Start Free Trial';
  }
}

async function handleUpgrade() {
  if (!currentPlaceId) {
    showError('Please select a store first');
    return;
  }

  // For now, show a message about Stripe integration
  // In production, this would redirect to Stripe checkout
  const upgradeBtn = $('upgradeBtn') || $('reactivateBtn');
  if (upgradeBtn) {
    upgradeBtn.disabled = true;
    upgradeBtn.textContent = 'Redirecting...';
  }

  try {
    // Check if Stripe is configured
    const response = await fetch('/api/business/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ placeId: currentPlaceId })
    });

    if (response.ok) {
      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
        return;
      }
    }

    // Fallback if checkout not implemented
    showError('Paid subscriptions coming soon! For now, enjoy your free trial or submit a giveaway offer for a free month.');
    if (upgradeBtn) {
      upgradeBtn.disabled = false;
      upgradeBtn.textContent = upgradeBtn.id === 'reactivateBtn' ? 'Reactivate Subscription' : 'Upgrade to Paid Plan';
    }
  } catch (e) {
    showError('Paid subscriptions coming soon! Submit a giveaway offer to earn a free month.');
    if (upgradeBtn) {
      upgradeBtn.disabled = false;
      upgradeBtn.textContent = upgradeBtn.id === 'reactivateBtn' ? 'Reactivate Subscription' : 'Upgrade to Paid Plan';
    }
  }
}

// Initialize
loadMyStores();
