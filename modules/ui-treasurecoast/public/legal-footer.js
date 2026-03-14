(function() {
  document.addEventListener('DOMContentLoaded', function() {
    var el = document.createElement('div');
    el.innerHTML =
      '<div id="legalFloat" style="position:fixed;bottom:16px;right:16px;z-index:9998;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;">' +
        '<button id="legalBtn" aria-label="Legal" style="width:36px;height:36px;border-radius:50%;border:1px solid rgba(255,255,255,0.08);background:rgba(13,20,36,0.92);color:#64748b;font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);transition:all 0.2s;box-shadow:0 2px 8px rgba(0,0,0,0.3);">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>' +
        '</button>' +
        '<div id="legalMenu" style="display:none;position:absolute;bottom:44px;right:0;background:#111827;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:8px 0;min-width:180px;box-shadow:0 8px 24px rgba(0,0,0,0.4);backdrop-filter:blur(12px);">' +
          '<a href="/privacy" style="display:block;padding:8px 16px;color:#94a3b8;font-size:13px;text-decoration:none;transition:all 0.15s;">Privacy Policy</a>' +
          '<a href="/terms" style="display:block;padding:8px 16px;color:#94a3b8;font-size:13px;text-decoration:none;transition:all 0.15s;">Terms of Service</a>' +
          '<a href="/data-deletion" style="display:block;padding:8px 16px;color:#94a3b8;font-size:13px;text-decoration:none;transition:all 0.15s;">Data Deletion</a>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el.firstChild);

    var btn = document.getElementById('legalBtn');
    var menu = document.getElementById('legalMenu');

    btn.addEventListener('mouseenter', function() {
      btn.style.color = '#22d3ee';
      btn.style.borderColor = 'rgba(34,211,238,0.3)';
    });
    btn.addEventListener('mouseleave', function() {
      if (menu.style.display === 'none') {
        btn.style.color = '#64748b';
        btn.style.borderColor = 'rgba(255,255,255,0.08)';
      }
    });

    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var open = menu.style.display !== 'none';
      menu.style.display = open ? 'none' : 'block';
      btn.style.color = open ? '#64748b' : '#22d3ee';
      btn.style.borderColor = open ? 'rgba(255,255,255,0.08)' : 'rgba(34,211,238,0.3)';
    });

    menu.querySelectorAll('a').forEach(function(a) {
      a.addEventListener('mouseenter', function() { a.style.color = '#22d3ee'; a.style.background = 'rgba(255,255,255,0.04)'; });
      a.addEventListener('mouseleave', function() { a.style.color = '#94a3b8'; a.style.background = 'none'; });
    });

    document.addEventListener('click', function() {
      menu.style.display = 'none';
      btn.style.color = '#64748b';
      btn.style.borderColor = 'rgba(255,255,255,0.08)';
    });
  });
})();
