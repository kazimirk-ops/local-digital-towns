(function() {
  var UB = {};

  // ── Auth ──
  UB.currentUser = null;

  UB.getMe = async function() {
    try {
      var r = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (!r.ok) return null;
      var user = await r.json();
      UB.currentUser = user;
      return user;
    } catch(e) { return null; }
  };

  UB.requireAuth = async function() {
    var user = await UB.getMe();
    if (!user) {
      window.location.href = '/town/login';
      return null;
    }
    return user;
  };

  UB.logout = function() {
    fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' })
      .catch(function(){})
      .then(function() { window.location.href = '/town/login'; });
  };

  // ── Feature Flags ──
  UB.flags = null;

  UB.getFlags = async function() {
    if (UB.flags) return UB.flags;
    try {
      var r = await fetch('/api/feature-flags', { credentials: 'same-origin' });
      UB.flags = await r.json();
      return UB.flags;
    } catch(e) { return {}; }
  };

  UB.hasFlag = function(flags, flag) {
    return !!(flags && flags[flag]);
  };

  // ── API Helper ──
  UB.api = async function(path, opts) {
    opts = opts || {};
    opts.credentials = 'same-origin';
    if (!opts.headers) opts.headers = {};
    if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    try {
      var r = await fetch(path, opts);
      if (r.status === 401) {
        window.location.href = '/town/login';
        return { error: 'Login required' };
      }
      return await r.json();
    } catch(e) {
      return { error: e.message };
    }
  };

  // ── Client-side tier check (mirrors lib/module-access.js) ──
  function canAccess(flags, moduleId, userTier) {
    if (!flags[moduleId]) return false;
    var minTier = flags[moduleId + '.tier'];
    if (minTier === undefined || minTier === null) minTier = 0;
    return userTier >= minTier;
  }

  // ── Nav Categories ──
  var NAV_CATEGORIES = [
    { id: 'community', icon: '\u{1F3D8}', label: 'Community', items: [
      { flag: 'pulse',      label: 'Pulse',           href: '/town/pulse' },
      { flag: 'channels',   label: 'Channels',        href: '/town/channels' },
      { flag: 'bst-groups', label: 'BST Groups',      href: '/town/bst' },
      { flag: 'businesses', label: 'Businesses',      href: '/town/businesses' },
      { flag: 'gigs',       label: 'Gigs & Services', href: '/town/gigs' }
    ]},
    { id: 'commerce', icon: '\u{1F6D2}', label: 'Commerce', items: [
      { flag: 'listings',   label: 'Marketplace',  href: '/town/marketplace' },
      { flag: 'listings',   label: 'Auctions',     href: '/town/auctions' },
      { flag: 'orders',     label: 'Orders',       href: '/town/orders' },
      { flag: 'payments',   label: 'Payments',     href: '/town/payments' },
      { flag: 'shipping',   label: 'Shipping',     href: '/town/shipping' },
      { flag: 'live-shows', label: 'Live Shows',   href: '/town/live' }
    ]},
    { id: 'earn', icon: '\u{26A1}', label: 'Earn & Play', items: [
      { flag: 'sweepstakes',  label: 'Sweepstakes',  href: '/town/sweep' },
      { flag: 'achievements', label: 'Leaderboard',  href: '/town/leaderboard' },
      { flag: 'achievements', label: 'Achievements', href: '/town/achievements' },
      { flag: 'referrals',    label: 'Referrals',    href: '/town/referrals' }
    ]},
    { id: 'account', icon: '\u{1F464}', label: 'Account', items: [
      { flag: null,            label: 'Profile',       href: '/town/profile' },
      { flag: 'trust',         label: 'Trust',         href: '/town/trust' },
      { flag: 'notifications', label: 'Notifications', href: '/town/notifications' },
      { flag: 'disputes',      label: 'Disputes',      href: '/town/disputes' }
    ]}
  ];

  UB.buildNav = function(flags, currentPage) {
    var sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    var userTier = (UB.currentUser && UB.currentUser.trust_tier) || 0;
    var isLoggedIn = !!UB.currentUser;
    var currentPath = currentPage || window.location.pathname;

    var html = '<div class="sidebar-logo">Digital Towns</div>';
    // Home link
    var homeActive = currentPath === '/town' ? ' active' : '';
    html += '<nav class="nav-section">';
    html += '<a class="nav-item nav-home' + homeActive + '" href="/town">'
      + '<span class="nav-icon">\u{1F3E0}</span><span>Home</span></a>';

    NAV_CATEGORIES.forEach(function(cat) {
      // Filter visible items
      var visibleItems = cat.items.filter(function(item) {
        if (item.flag === null) return isLoggedIn;
        return canAccess(flags, item.flag, userTier);
      });
      if (!visibleItems.length) return;

      // Check if any item in this category is active
      var catHasActive = visibleItems.some(function(item) {
        return currentPath === item.href;
      });

      var collapsed = catHasActive ? '' : '';
      var catId = 'cat-' + cat.id;

      html += '<div class="nav-category" id="' + catId + '">';
      html += '<div class="nav-category-header" onclick="UB.toggleCat(\'' + catId + '\')">';
      html += '<span class="cat-icon">' + cat.icon + '</span>';
      html += '<span>' + cat.label + '</span>';
      html += '<span class="cat-chevron">\u25BE</span>';
      html += '</div>';
      html += '<div class="nav-category-items">';

      visibleItems.forEach(function(item) {
        var active = currentPath === item.href ? ' active' : '';
        html += '<a class="nav-item' + active + '" href="' + item.href + '">'
          + '<span>' + item.label + '</span></a>';
      });

      html += '</div></div>';
    });

    // Logout / Login at bottom
    html += '</nav><div style="margin-top:auto;padding:12px 0;border-top:1px solid var(--border);">';
    if (isLoggedIn) {
      html += '<a class="nav-item" href="#" onclick="UB.logout();return false;">'
        + '<span class="nav-icon">\u{1F6AA}</span><span>Logout</span></a>';
    } else {
      html += '<a class="nav-item" href="/town/login">'
        + '<span class="nav-icon">\u{1F511}</span><span>Login</span></a>';
    }
    html += '</div>';
    sidebar.innerHTML = html;
  };

  UB.toggleCat = function(catId) {
    var cat = document.getElementById(catId);
    if (!cat) return;
    // Don't collapse if category has active item
    var items = cat.querySelector('.nav-category-items');
    if (items && items.querySelector('.nav-item.active')) return;
    var header = cat.querySelector('.nav-category-header');
    if (header) header.classList.toggle('collapsed');
    if (items) items.classList.toggle('collapsed');
  };

  // ── Topbar ──
  UB.buildTopbar = function(title) {
    var topbar = document.getElementById('topbar');
    if (!topbar) return;
    var userHtml = '';
    if (UB.currentUser) {
      var initial = (UB.currentUser.display_name || UB.currentUser.email || 'U')[0].toUpperCase();
      userHtml = '<div class="topbar-user">'
        + '<span style="color:var(--muted);font-size:13px;">' + UB.esc(UB.currentUser.display_name || UB.currentUser.email || '') + '</span>'
        + '<div style="width:32px;height:32px;border-radius:50%;background:var(--border);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:var(--accent);">' + initial + '</div>'
        + '</div>';
    }
    topbar.innerHTML = '<div class="topbar-title">' + UB.esc(title) + '</div>' + userHtml;
  };

  // ── Init: load flags + user, build nav + topbar ──
  UB.init = async function(pagePath, pageTitle) {
    var flags = await UB.getFlags();
    await UB.getMe();
    UB.buildNav(flags, pagePath);
    UB.buildTopbar(pageTitle || 'Digital Towns');
    return flags;
  };

  // ── Toast ──
  UB.toast = function(msg, type) {
    type = type || 'info';
    var container = document.getElementById('toasts');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toasts';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    var t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    container.appendChild(t);
    setTimeout(function() { t.remove(); }, 3000);
  };

  // ── Utilities ──
  UB.esc = function(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  };

  UB.timeAgo = function(date) {
    if (!date) return '';
    var now = Date.now();
    var d = new Date(date).getTime();
    var diff = Math.floor((now - d) / 1000);
    if (diff < 60) return 'now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return new Date(date).toLocaleDateString();
  };

  UB.formatPrice = function(cents) {
    if (cents == null) return '$0.00';
    return '$' + (cents / 100).toFixed(2);
  };

  UB.showDisabled = function(name) {
    var main = document.getElementById('pageContent');
    if (!main) main = document.querySelector('.content');
    if (!main) return;
    main.innerHTML = '<div class="module-disabled">'
      + '<h2>' + UB.esc(name || 'Module') + ' is not installed</h2>'
      + '<p>This feature is not enabled for this community. Contact your admin to enable it.</p>'
      + '</div>';
  };

  window.UB = UB;
})();
