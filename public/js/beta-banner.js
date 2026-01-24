// Beta Banner Component
// Creates a dismissible banner that persists across pages via localStorage

(function() {
  const STORAGE_KEY = 'dt_beta_banner_dismissed';
  const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  function shouldShowBanner() {
    const dismissed = localStorage.getItem(STORAGE_KEY);
    if (!dismissed) return true;
    const dismissedAt = parseInt(dismissed, 10);
    if (isNaN(dismissedAt)) return true;
    return Date.now() - dismissedAt > DISMISS_DURATION_MS;
  }

  function dismissBanner() {
    localStorage.setItem(STORAGE_KEY, Date.now().toString());
    const banner = document.getElementById('beta-banner');
    if (banner) {
      banner.style.transform = 'translateY(-100%)';
      setTimeout(() => banner.remove(), 300);
    }
  }

  function createBanner() {
    if (!shouldShowBanner()) return;

    const banner = document.createElement('div');
    banner.id = 'beta-banner';
    banner.innerHTML = `
      <div class="beta-banner-content">
        <span class="beta-banner-text">
          <span class="beta-banner-icon">🚧</span>
          <strong>BETA</strong> - You're an early adopter! Report issues to
          <a href="mailto:support@sebastian-florida.com">support@sebastian-florida.com</a>
        </span>
        <button class="beta-banner-close" aria-label="Dismiss">&times;</button>
      </div>
    `;

    // Add styles if not already present
    if (!document.getElementById('beta-banner-styles')) {
      const style = document.createElement('style');
      style.id = 'beta-banner-styles';
      style.textContent = `
        #beta-banner {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 99999;
          background: linear-gradient(90deg, #f59e0b, #d97706);
          color: #1c1917;
          font-size: 13px;
          font-family: system-ui, -apple-system, sans-serif;
          transition: transform 0.3s ease;
        }
        .beta-banner-content {
          max-width: 1200px;
          margin: 0 auto;
          padding: 8px 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .beta-banner-text {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .beta-banner-icon {
          font-size: 16px;
        }
        .beta-banner-text a {
          color: #1c1917;
          text-decoration: underline;
          font-weight: 600;
        }
        .beta-banner-text a:hover {
          color: #000;
        }
        .beta-banner-close {
          background: rgba(0,0,0,0.1);
          border: none;
          color: #1c1917;
          font-size: 20px;
          line-height: 1;
          padding: 4px 8px;
          border-radius: 4px;
          cursor: pointer;
          flex-shrink: 0;
        }
        .beta-banner-close:hover {
          background: rgba(0,0,0,0.2);
        }
        /* Adjust body padding when banner is visible */
        body.has-beta-banner {
          padding-top: 40px;
        }
        @media (max-width: 600px) {
          .beta-banner-content {
            padding: 6px 12px;
            font-size: 12px;
          }
          .beta-banner-text {
            gap: 6px;
          }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.insertBefore(banner, document.body.firstChild);
    document.body.classList.add('has-beta-banner');

    // Add event listener for close button
    banner.querySelector('.beta-banner-close').addEventListener('click', dismissBanner);
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createBanner);
  } else {
    createBanner();
  }

  // Expose dismiss function globally
  window.dismissBetaBanner = dismissBanner;
})();
