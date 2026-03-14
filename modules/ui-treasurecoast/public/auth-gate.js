// ── Auth Gate — Facebook Login Modal ──────────────────────────
// Include this script on any page that has gated actions.
// Provides: window.requireAuth(callback), window.showAuthModal(), window.showAuthGate(title, subtitle, returnUrl), fbtoken pickup

(function() {
  // ── 1. Pick up fbtoken from URL after Facebook redirect ──
  var params = new URLSearchParams(window.location.search);
  var fbtoken = params.get('fbtoken');
  if (fbtoken) {
    localStorage.setItem('tc_token', fbtoken);
    params.delete('fbtoken');
    var clean = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (clean ? '?' + clean : ''));

    // Check if profile needs completing
    fetch('/api/auth/me', {
      headers: { 'Authorization': 'Bearer ' + fbtoken }
    })
    .then(function(r) { return r.json(); })
    .then(function(user) {
      if (user && !user.profile_complete) {
        window.location.href = '/profile-complete';
      }
    })
    .catch(function() {});
  }

  // ── 2. Inject modal HTML ──
  var modalHTML = '<div id="fbAuthModal" style="display:none;position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.85);backdrop-filter:blur(6px);align-items:center;justify-content:center;font-family:-apple-system,system-ui,sans-serif;">'
    + '<div style="background:#0d1b2e;border:1px solid #0ea5e9;border-radius:20px;padding:40px 32px;max-width:380px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.6);">'
    + '<div style="font-size:40px;margin-bottom:16px;">&#127965;</div>'
    + '<h2 id="gateTitle" style="color:#fff;font-size:22px;font-weight:800;margin:0 0 8px;">Join Treasure Coast &mdash; It\'s Free</h2>'
    + '<p id="gateSubtitle" style="color:#94a3b8;font-size:14px;margin:0 0 28px;line-height:1.5;">See full listings, place bids, and connect with local sellers. Florida\'s first digital town.</p>'
    + '<a id="fbAuthBtn" href="/api/auth/facebook/start" style="display:flex;align-items:center;justify-content:center;gap:10px;background:#1877f2;color:#fff;text-decoration:none;padding:14px 24px;border-radius:12px;font-weight:700;font-size:15px;margin-bottom:12px;transition:background 0.2s;" onmouseover="this.style.background=\'#1464d8\'" onmouseout="this.style.background=\'#1877f2\'">'
    + '<svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>'
    + 'Continue with Facebook</a>'
    + '<a id="googleAuthBtn" href="/api/auth/google" style="display:flex;align-items:center;justify-content:center;gap:10px;background:#fff;color:#1a1a1a;text-decoration:none;padding:14px 24px;border-radius:12px;font-weight:700;font-size:15px;margin-bottom:12px;transition:background 0.2s;box-sizing:border-box;" onmouseover="this.style.background=\'#f0f0f0\'" onmouseout="this.style.background=\'#fff\'">'
    + '<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/><path fill="none" d="M0 0h48v48H0z"/></svg>'
    + 'Continue with Google</a>'
    + '<p style="color:#334155;font-size:11px;margin:12px 0 0;">Free to join &middot; No credit card required</p>'
    + '</div></div>';

  document.addEventListener('DOMContentLoaded', function() {
    var container = document.createElement('div');
    container.innerHTML = modalHTML;
    document.body.appendChild(container.firstChild);

    // Fetch dynamic town name
    var townName = 'Treasure Coast Digital';
    fetch('/api/town-info')
      .then(function(r) { return r.json(); })
      .then(function(d) {
        townName = d.name || townName;
        var el = document.getElementById('gateTitle');
        if (el && el.textContent.indexOf('Join Treasure Coast') === 0) {
          el.textContent = 'Join ' + townName + ' \u2014 It\u2019s Free';
        }
      })
      .catch(function() {});

    // ── Timed conversion gate — fire after 12s for unauthenticated users ──
    setTimeout(function() {
      var token = localStorage.getItem('tc_token');
      if (token) return;
      // Suppress for 24hrs after last dismiss
      var dismissed = localStorage.getItem('gate_dismissed');
      if (dismissed) {
        var hours = (Date.now() - Number(dismissed)) / (1000 * 60 * 60);
        if (hours < 24) return;
      }
      var m = document.getElementById('fbAuthModal');
      if (!m) return;
      if (m.style.display === 'flex') return;
      window.showAuthGate(
        'You\u2019re on ' + townName,
        'Join free to bid on auctions, buy local listings, and become part of your local digital town.',
        window.location.href
      );
    }, 12000);
  });

  // ── 3. Show/hide modal ──
  window.showAuthModal = function() {
    window.showAuthGate();
  };

  window.showAuthGate = function(title, subtitle, returnUrl) {
    // Temporarily disabled — let visitors browse freely
    return;
    var modal = document.getElementById('fbAuthModal');
    if (!modal) return;
    var returnPath = returnUrl || window.location.pathname + window.location.search;
    // Set custom title/subtitle if provided
    var titleEl = document.getElementById('gateTitle');
    var subEl = document.getElementById('gateSubtitle');
    if (title && titleEl) titleEl.textContent = title;
    if (subtitle && subEl) subEl.textContent = subtitle;
    // Set login URLs with return redirect
    var btn = document.getElementById('fbAuthBtn');
    if (btn) btn.href = '/api/auth/facebook/start?redirect=' + encodeURIComponent(returnPath);
    var gBtn = document.getElementById('googleAuthBtn');
    if (gBtn) gBtn.href = '/api/auth/google?redirect=' + encodeURIComponent(returnPath);
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  };

  window.hideAuthModal = function() {
    var modal = document.getElementById('fbAuthModal');
    if (modal) {
      modal.style.display = 'none';
      document.body.style.overflow = '';
      localStorage.setItem('gate_dismissed', Date.now().toString());
    }
  };

  // ── 4. requireAuth(callback) ──
  window.requireAuth = function(callback) {
    var token = localStorage.getItem('tc_token');
    if (token) {
      callback();
    } else {
      window.showAuthModal();
    }
  };

  // ── 5. Fetch interceptor for expired tokens ──
  var _origFetch = window.fetch;
  window.fetch = function() {
    return _origFetch.apply(this, arguments).then(function(response) {
      if (response.status === 401) {
        var cloned = response.clone();
        cloned.json().then(function(data) {
          if (data && data.error === 'login_required') {
            localStorage.removeItem('tc_token');
            window.showAuthModal();
          }
        }).catch(function() {});
      }
      return response;
    });
  };
})();
