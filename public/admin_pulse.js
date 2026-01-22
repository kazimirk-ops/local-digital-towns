const $ = (id) => document.getElementById(id);

let currentPulseData = null;
let currentPostText = '';

async function api(url, opts = {}) {
  const res = await fetch(url, { credentials: 'include', ...opts });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(typeof data === 'string' ? data : (data.error || JSON.stringify(data)));
  return data;
}

function formatDate(iso) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function formatRelativeTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
}

async function loadPulse() {
  try {
    // Load Facebook-formatted pulse
    const result = await api('/api/pulse/export/facebook');
    currentPulseData = result.pulse;
    currentPostText = result.text;

    // Update preview
    $('postPreview').textContent = result.text;

    // Update stats
    const p = result.pulse;
    $('statListings').textContent = p.newListingsCount || 0;
    $('statOrders').textContent = p.newOrdersCount || 0;
    $('statEvents').textContent = p.upcomingEventsCount || 0;
    $('statReviews').textContent = p.newReviewsCount || 0;
    $('statWinners').textContent = p.giveawayWinnersCount || 0;
    $('statStores').textContent = p.activeStoresCount || 0;

    // Show winner section if there's a recent winner
    if (p.recentWinner) {
      $('winnerSection').style.display = 'block';
      $('winnerName').textContent = p.recentWinner.name;
      $('winnerPrize').textContent = p.recentWinner.prize;
    } else {
      $('winnerSection').style.display = 'none';
    }
  } catch (e) {
    $('postPreview').textContent = 'Error loading pulse: ' + e.message;
    console.error('Failed to load pulse:', e);
  }
}

async function loadHistory() {
  try {
    const result = await api('/api/admin/pulse/history');
    const exports = result.exports || [];
    const lastExport = result.lastExport;

    // Update last export pill
    if (lastExport) {
      $('lastExportPill').textContent = 'Last export: ' + formatRelativeTime(lastExport.exportedAt);
      $('lastExportPill').classList.add('pill-success');
    }

    // Render history list
    $('historyLoading').style.display = 'none';

    if (exports.length === 0) {
      $('historyEmpty').style.display = 'block';
      $('historyList').style.display = 'none';
    } else {
      $('historyEmpty').style.display = 'none';
      $('historyList').style.display = 'block';
      $('historyList').innerHTML = exports.map(exp => `
        <li class="history-item">
          <div>
            <div class="history-date">${formatDate(exp.exportedAt)}</div>
            <div class="history-user">by ${exp.exportedByName || exp.exportedByEmail || 'Unknown'}</div>
          </div>
          <span class="pill">${exp.exportType || 'facebook'}</span>
        </li>
      `).join('');
    }
  } catch (e) {
    $('historyLoading').textContent = 'Error loading history: ' + e.message;
    console.error('Failed to load history:', e);
  }
}

async function copyToClipboard() {
  try {
    await navigator.clipboard.writeText(currentPostText);
    showSuccess('copySuccess');
  } catch (e) {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = currentPostText;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showSuccess('copySuccess');
  }
}

function openFacebook() {
  // Open Facebook in a new tab - user can paste the copied text
  window.open('https://www.facebook.com/groups/', '_blank');
}

async function logExport() {
  try {
    $('logExportBtn').disabled = true;
    $('logExportBtn').textContent = 'Logging...';

    await api('/api/admin/pulse/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        townId: 1,
        exportType: 'facebook'
      })
    });

    showSuccess('exportSuccess');
    $('logExportBtn').textContent = '✓ Marked as Exported';

    // Refresh history
    await loadHistory();
  } catch (e) {
    alert('Error logging export: ' + e.message);
    $('logExportBtn').disabled = false;
    $('logExportBtn').textContent = '✓ Mark as Exported';
  }
}

function showSuccess(elementId) {
  const el = $(elementId);
  el.style.display = 'block';
  setTimeout(() => {
    el.style.display = 'none';
  }, 3000);
}

// Initialize
async function init() {
  await Promise.all([
    loadPulse(),
    loadHistory()
  ]);
}

init();
