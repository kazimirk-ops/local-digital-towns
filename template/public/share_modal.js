// Reusable Share Modal Component
// Usage: ShareModal.show({ type, title, shareText, shareUrl, imageUrl })

window.ShareModal = (function() {
  const tc = window.__TOWN_CONFIG__ || {};
  const MODAL_ID = 'share-modal-overlay';

  function injectStyles() {
    if (document.getElementById('share-modal-styles')) return;

    const style = document.createElement('style');
    style.id = 'share-modal-styles';
    style.textContent = `
      .share-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        padding: 20px;
        animation: shareModalFadeIn 0.2s ease;
      }
      @keyframes shareModalFadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .share-modal {
        background: var(--panel, #0d1424);
        border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
        border-radius: 16px;
        padding: 24px;
        max-width: 420px;
        width: 100%;
        position: relative;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        animation: shareModalSlideUp 0.3s ease;
        color: var(--text, #e2e8f0);
      }
      @keyframes shareModalSlideUp {
        from { transform: translateY(20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      .share-modal-close {
        position: absolute;
        top: 12px;
        right: 12px;
        background: var(--panel2, rgba(255, 255, 255, 0.06));
        border: none;
        font-size: 20px;
        cursor: pointer;
        color: var(--muted, #94a3b8);
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        transition: background 0.2s;
      }
      .share-modal-close:hover {
        background: var(--panel2, rgba(255, 255, 255, 0.1));
        color: var(--text, #fff);
      }
      .share-modal-title {
        margin: 0 0 16px 0;
        font-size: 20px;
        font-weight: 700;
        color: var(--text, #fff);
        padding-right: 32px;
      }
      .share-modal-preview {
        background: var(--panel2, rgba(255, 255, 255, 0.04));
        border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
        padding: 14px;
        border-radius: 12px;
        margin-bottom: 20px;
        font-size: 14px;
        color: var(--text, #e2e8f0);
        line-height: 1.5;
      }
      .share-modal-image {
        width: 100%;
        max-height: 160px;
        object-fit: cover;
        border-radius: 10px;
        margin-bottom: 16px;
        border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
      }
      .share-modal-buttons {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .share-modal-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 14px 18px;
        border: none;
        border-radius: 10px;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        transition: opacity 0.2s, transform 0.1s;
      }
      .share-modal-btn:hover {
        opacity: 0.9;
      }
      .share-modal-btn:active {
        transform: scale(0.98);
      }
      .share-modal-btn-facebook {
        background: #1877f2;
        color: white;
      }
      .share-modal-btn-twitter {
        background: #000;
        color: white;
      }
      .share-modal-btn-copy {
        background: var(--panel2, rgba(255, 255, 255, 0.06));
        border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
        color: var(--text, #e2e8f0);
      }
      .share-modal-btn-icon {
        font-weight: bold;
        font-size: 16px;
        width: 20px;
        text-align: center;
      }
      .share-modal-dismiss {
        width: 100%;
        margin-top: 12px;
        padding: 12px;
        background: none;
        border: none;
        color: var(--muted, #94a3b8);
        font-size: 14px;
        cursor: pointer;
        transition: color 0.2s;
      }
      .share-modal-dismiss:hover {
        color: var(--text, #fff);
      }
      .share-modal-success {
        background: rgba(34, 197, 94, 0.15);
        color: #22c55e;
        padding: 10px 14px;
        border-radius: 8px;
        margin-top: 12px;
        text-align: center;
        font-size: 14px;
        display: none;
      }
      .share-modal-success.visible {
        display: block;
        animation: shareModalFadeIn 0.2s ease;
      }
    `;
    document.head.appendChild(style);
  }

  function shareToFacebook(text, url) {
    const shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(text)}`;
    window.open(shareUrl, 'facebook-share', 'width=600,height=400,menubar=no,toolbar=no');
  }

  function shareToTwitter(text, url) {
    const shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    window.open(shareUrl, 'twitter-share', 'width=600,height=400,menubar=no,toolbar=no');
  }

  async function copyToClipboard(url) {
    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      return true;
    }
  }

  function logShare(shareType, itemType, itemId, platform) {
    fetch('/api/share/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ shareType, itemType, itemId, platform })
    }).catch(() => {});
  }

  function close() {
    const modal = document.getElementById(MODAL_ID);
    if (modal) modal.remove();
  }

  function handleShare(platform, options) {
    const { type, shareText, shareUrl, itemId } = options;

    if (platform === 'facebook') {
      shareToFacebook(shareText, shareUrl);
      logShare(type, type, itemId || 0, 'facebook');
    } else if (platform === 'twitter') {
      shareToTwitter(shareText, shareUrl);
      logShare(type, type, itemId || 0, 'twitter');
    } else if (platform === 'copy') {
      copyToClipboard(shareUrl).then(() => {
        const successEl = document.querySelector('.share-modal-success');
        if (successEl) {
          successEl.classList.add('visible');
          setTimeout(() => successEl.classList.remove('visible'), 2500);
        }
        const copyBtn = document.querySelector('.share-modal-btn-copy');
        if (copyBtn) {
          const original = copyBtn.innerHTML;
          copyBtn.innerHTML = '<span class="share-modal-btn-icon">✓</span> Copied!';
          setTimeout(() => { copyBtn.innerHTML = original; }, 2000);
        }
      });
      logShare(type, type, itemId || 0, 'clipboard');
    }
  }

  /**
   * Show share modal
   * @param {Object} options
   * @param {string} options.type - 'purchase' | 'giveaway_win' | 'review' | 'verified'
   * @param {string} options.title - Headline text for the modal
   * @param {string} options.shareText - Pre-filled share text
   * @param {string} options.shareUrl - Link to share
   * @param {string} [options.imageUrl] - Optional image URL
   * @param {number|string} [options.itemId] - Optional item ID for logging
   */
  function show(options) {
    injectStyles();
    close(); // Remove any existing modal

    const {
      type = 'share',
      title = 'Share with friends!',
      shareText = '',
      shareUrl = window.location.href,
      imageUrl = '',
      itemId = 0
    } = options;

    // Store options for button handlers
    const optionsJson = JSON.stringify({ type, shareText, shareUrl, itemId }).replace(/"/g, '&quot;');

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'share-modal-overlay';
    modal.innerHTML = `
      <div class="share-modal">
        <button class="share-modal-close" aria-label="Close">&times;</button>
        <h3 class="share-modal-title">${escapeHtml(title)}</h3>
        ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" class="share-modal-image">` : ''}
        <div class="share-modal-preview">${escapeHtml(shareText)}</div>
        <div class="share-modal-buttons">
          <button class="share-modal-btn share-modal-btn-facebook" data-platform="facebook">
            <span class="share-modal-btn-icon">f</span> Share to Facebook
          </button>
          <button class="share-modal-btn share-modal-btn-twitter" data-platform="twitter">
            <span class="share-modal-btn-icon">X</span> Share to X
          </button>
          <button class="share-modal-btn share-modal-btn-copy" data-platform="copy">
            <span class="share-modal-btn-icon">🔗</span> Copy Link
          </button>
        </div>
        <div class="share-modal-success">Link copied to clipboard!</div>
        <button class="share-modal-dismiss">Maybe Later</button>
      </div>
    `;

    // Add click handlers for share buttons
    modal.querySelectorAll('.share-modal-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        handleShare(btn.dataset.platform, options);
      });
    });

    // Add close button handler
    modal.querySelector('.share-modal-close')?.addEventListener('click', close);
    modal.querySelector('.share-modal-dismiss')?.addEventListener('click', close);

    // Handle image error
    const img = modal.querySelector('.share-modal-image');
    if (img) img.addEventListener('error', () => { img.style.display = 'none'; });

    // Close on overlay click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) close();
    });

    // Close on Escape key
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        close();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    document.body.appendChild(modal);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  // Convenience methods for specific share types

  async function promptPurchaseShare(orderId) {
    try {
      const resp = await fetch(`/api/share/purchase/${orderId}`, { credentials: 'include' });
      if (!resp.ok) return;
      const data = await resp.json();
      show({
        type: 'purchase',
        title: 'Share your purchase and support local!',
        shareText: data.text || (tc.shareText?.purchaseModal || `Just made a purchase in Sebastian! 🛍️`),
        shareUrl: data.url || window.location.origin,
        imageUrl: data.imageUrl || '',
        itemId: orderId
      });
    } catch (err) {
      console.error('Failed to load purchase share data:', err);
    }
  }

  async function promptGiveawayWinShare(drawId) {
    try {
      const resp = await fetch(`/api/share/sweep-win/${encodeURIComponent(drawId)}`, { credentials: 'include' });
      if (!resp.ok) return;
      const data = await resp.json();
      show({
        type: 'giveaway_win',
        title: 'Tell your friends about your win!',
        shareText: data.text || (tc.shareText?.giveawayWinModal || `🏆 I just won in the Sebastian Town Giveaway!`),
        shareUrl: data.url || window.location.origin,
        imageUrl: data.imageUrl || '',
        itemId: drawId
      });
    } catch (err) {
      console.error('Failed to load giveaway share data:', err);
    }
  }

  async function promptReviewShare(reviewId) {
    try {
      const resp = await fetch(`/api/share/review/${reviewId}`, { credentials: 'include' });
      if (!resp.ok) return;
      const data = await resp.json();
      show({
        type: 'review',
        title: 'Share your review!',
        shareText: data.text || (tc.shareText?.reviewModal || `Just left a review on Sebastian Digital Town!`),
        shareUrl: data.url || window.location.origin,
        imageUrl: data.imageUrl || '',
        itemId: reviewId
      });
    } catch (err) {
      console.error('Failed to load review share data:', err);
    }
  }

  function promptVerificationShare(tierName) {
    const baseUrl = window.location.origin;
    show({
      type: 'verified',
      title: tc.shareText?.verificationModal || "You're officially a verified Sebastian local! 🏠",
      shareText: tc.shareText?.verification || `I just got verified as a ${tierName || 'Sebastian resident'} on Digital Sebastian! Join our local community and support Sebastian businesses.`,
      shareUrl: `${baseUrl}/apply/resident`,
      imageUrl: ''
    });
  }

  return {
    show,
    close,
    promptPurchaseShare,
    promptGiveawayWinShare,
    promptReviewShare,
    promptVerificationShare,
    // Expose utilities
    shareToFacebook,
    shareToTwitter,
    copyToClipboard,
    logShare
  };
})();
