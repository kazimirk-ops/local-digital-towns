const $ = (id) => document.getElementById(id);

let currentPlaceId = null;
let myStores = [];
let selectedImageFile = null;

async function api(url, opts = {}) {
  const res = await fetch(url, { credentials: 'include', ...opts });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(typeof data === 'string' ? data : (data.error || JSON.stringify(data)));
  return data;
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
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
}

async function loadMyStores() {
  try {
    const me = await api('/api/me');
    if (!me || !me.user) {
      window.location.href = '/auth/login?redirect=/giveaway-offer';
      return;
    }

    // Get places owned by this user
    const places = await api('/places');
    myStores = places.filter(p =>
      Number(p.ownerUserId || p.owneruserid) === Number(me.user.id) &&
      p.status === 'approved'
    );

    $('loadingState').style.display = 'none';

    if (myStores.length === 0) {
      showError('You need an approved store to submit giveaway offers. Please apply for a business account first.');
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
    await loadMyOffers();
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

  await loadMyOffers();
}

function handleImageSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  // Validate file
  if (!file.type.startsWith('image/')) {
    showError('Please select an image file');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showError('Image must be less than 5MB');
    return;
  }

  selectedImageFile = file;

  // Show preview
  const reader = new FileReader();
  reader.onload = function(e) {
    const previewWrap = $('imagePreviewWrap');
    previewWrap.innerHTML = `
      <img src="${e.target.result}" class="image-preview" alt="Preview">
      <div class="muted">Click to change image</div>
    `;
    $('imageUpload').classList.add('has-image');
  };
  reader.readAsDataURL(file);
}

async function uploadImage() {
  if (!selectedImageFile) return null;

  const formData = new FormData();
  formData.append('file', selectedImageFile);
  formData.append('kind', 'giveaway_offer');

  try {
    const result = await api('/api/uploads', {
      method: 'POST',
      body: formData
    });
    return result.url || null;
  } catch (e) {
    console.error('Image upload failed:', e);
    return null;
  }
}

async function handleSubmit(event) {
  event.preventDefault();

  if (!currentPlaceId) {
    showError('Please select a store first');
    return;
  }

  const title = $('title').value.trim();
  const description = $('description').value.trim();
  const estimatedValue = parseFloat($('estimatedValue').value) || 0;

  if (!title || !description) {
    showError('Please fill in all required fields');
    return;
  }

  if (estimatedValue < 1) {
    showError('Please enter an estimated value of at least $1');
    return;
  }

  const btn = $('submitBtn');
  btn.disabled = true;
  btn.textContent = 'Submitting...';

  try {
    // Upload image if selected
    let imageUrl = null;
    if (selectedImageFile) {
      btn.textContent = 'Uploading image...';
      imageUrl = await uploadImage();
    }

    btn.textContent = 'Submitting offer...';

    // Submit offer
    const result = await api('/api/giveaway/offer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        placeId: currentPlaceId,
        title,
        description,
        estimatedValue: Math.round(estimatedValue * 100), // Convert to cents
        imageUrl: imageUrl || ''
      })
    });

    showSuccess('Offer submitted successfully! We\'ll review it and notify you when approved.');

    // Reset form
    $('offerForm').reset();
    selectedImageFile = null;
    $('imagePreviewWrap').innerHTML = `
      <div class="image-upload-icon">📷</div>
      <div>Click to upload an image of the prize</div>
      <div class="form-hint">JPG, PNG up to 5MB</div>
    `;
    $('imageUpload').classList.remove('has-image');

    // Reload offers list
    await loadMyOffers();

    btn.disabled = false;
    btn.textContent = 'Submit Another Offer';
  } catch (e) {
    showError(e.message);
    btn.disabled = false;
    btn.textContent = 'Submit Giveaway Offer';
  }
}

async function loadMyOffers() {
  if (!currentPlaceId) return;

  $('offersLoading').style.display = 'block';
  $('offersList').style.display = 'none';
  $('noOffers').style.display = 'none';

  try {
    const offers = await api(`/api/giveaway/offers/place/${currentPlaceId}`);

    $('offersLoading').style.display = 'none';

    if (!offers || offers.length === 0) {
      $('noOffers').style.display = 'block';
      return;
    }

    $('offersList').style.display = 'block';
    $('offersList').innerHTML = offers.map(offer => `
      <div class="offer-item">
        <div class="offer-info">
          <h4>${escapeHtml(offer.title)}</h4>
          <p>$${((offer.estimatedValue || 0) / 100).toFixed(2)} value • Submitted ${formatDate(offer.createdAt)}</p>
        </div>
        ${displayOfferStatus(offer.status)}
      </div>
    `).join('');
  } catch (e) {
    $('offersLoading').style.display = 'none';
    $('noOffers').style.display = 'block';
    $('noOffers').textContent = 'No offers found for this store.';
  }
}

function displayOfferStatus(status) {
  const statusLower = (status || 'pending').toLowerCase();
  let pillClass = 'pill-pending';
  let label = 'Pending Review';

  if (statusLower === 'approved') {
    pillClass = 'pill-approved';
    label = 'Approved';
  } else if (statusLower === 'rejected') {
    pillClass = 'pill-rejected';
    label = 'Not Approved';
  }

  return `<span class="pill ${pillClass}">${label}</span>`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize
loadMyStores();
