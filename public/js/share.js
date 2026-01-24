// Social Sharing Helper Functions

window.SocialShare = (function() {
  function shareToFacebook(text, url) {
    const shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(text)}`;
    window.open(shareUrl, 'facebook-share', 'width=580,height=400,menubar=no,toolbar=no');
  }

  function shareToTwitter(text, url) {
    const shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    window.open(shareUrl, 'twitter-share', 'width=580,height=400,menubar=no,toolbar=no');
  }

  async function copyShareLink(url) {
    try {
      await navigator.clipboard.writeText(url);
      return { ok: true };
    } catch (err) {
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      return { ok: true };
    }
  }

  function logShare(shareType, itemType, itemId, platform) {
    fetch('/api/share/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shareType, itemType, itemId, platform })
    }).catch(() => {});
  }

  function createShareModal(type, data) {
    const existingModal = document.getElementById('share-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'share-modal';
    modal.className = 'share-modal-overlay';
    modal.innerHTML = `
      <div class="share-modal">
        <button class="share-modal-close">&times;</button>
        <h3>Share Your ${type === 'purchase' ? 'Purchase' : type === 'giveaway' ? 'Win' : type === 'review' ? 'Review' : 'Achievement'}!</h3>
        <p class="share-preview-text">${data.text || ''}</p>
        ${data.imageUrl ? `<img src="${data.imageUrl}" alt="Share preview" class="share-preview-image">` : ''}
        <div class="share-buttons">
          <button class="share-btn share-btn-facebook" data-platform="facebook">
            <span class="share-icon">f</span> Share on Facebook
          </button>
          <button class="share-btn share-btn-twitter" data-platform="twitter">
            <span class="share-icon">X</span> Share on X
          </button>
          <button class="share-btn share-btn-copy" data-platform="copy">
            <span class="share-icon">🔗</span> Copy Link
          </button>
        </div>
        <button class="share-btn-skip">Maybe Later</button>
      </div>
    `;

    // Add CSP-compliant event listeners
    modal.querySelector('.share-modal-close')?.addEventListener('click', closeModal);
    modal.querySelector('.share-btn-skip')?.addEventListener('click', closeModal);
    modal.querySelectorAll('.share-btn').forEach(btn => {
      btn.addEventListener('click', () => doShare(btn.dataset.platform, type, data));
    });
    const img = modal.querySelector('.share-preview-image');
    if (img) img.addEventListener('error', () => { img.style.display = 'none'; });

    document.body.appendChild(modal);
    modal.addEventListener('click', function(e) {
      if (e.target === modal) closeModal();
    });
  }

  function closeModal() {
    const modal = document.getElementById('share-modal');
    if (modal) modal.remove();
  }

  function doShare(platform, type, data) {
    const itemType = type;
    const itemId = data.orderId || data.awardId || data.reviewId || 0;

    if (platform === 'facebook') {
      shareToFacebook(data.text, data.url);
      logShare(type, itemType, itemId, 'facebook');
    } else if (platform === 'twitter') {
      shareToTwitter(data.text, data.url);
      logShare(type, itemType, itemId, 'twitter');
    } else if (platform === 'copy') {
      copyShareLink(data.url).then(() => {
        const copyBtn = document.querySelector('.share-btn-copy');
        if (copyBtn) {
          copyBtn.innerHTML = '<span class="share-icon">✓</span> Copied!';
          setTimeout(() => {
            copyBtn.innerHTML = '<span class="share-icon">🔗</span> Copy Link';
          }, 2000);
        }
      });
      logShare(type, itemType, itemId, 'clipboard');
    }
  }

  async function showShareModal(type, data) {
    createShareModal(type, data);
  }

  async function promptPurchaseShare(orderId) {
    try {
      const resp = await fetch(`/api/share/purchase/${orderId}`);
      if (!resp.ok) return;
      const data = await resp.json();
      showShareModal('purchase', data);
    } catch (err) {
      console.error('Failed to load share data:', err);
    }
  }

  async function promptGiveawayShare(awardId) {
    try {
      const resp = await fetch(`/api/share/giveaway-win/${awardId}`);
      if (!resp.ok) return;
      const data = await resp.json();
      showShareModal('giveaway', data);
    } catch (err) {
      console.error('Failed to load share data:', err);
    }
  }

  async function promptReviewShare(reviewId) {
    try {
      const resp = await fetch(`/api/share/review/${reviewId}`);
      if (!resp.ok) return;
      const data = await resp.json();
      showShareModal('review', data);
    } catch (err) {
      console.error('Failed to load share data:', err);
    }
  }

  function promptVerificationShare() {
    const baseUrl = window.location.origin;
    const data = {
      text: "I just got verified as a Sebastian resident on Digital Sebastian! Join our local community and support Sebastian businesses.",
      url: `${baseUrl}/apply/resident`,
      imageUrl: `${baseUrl}/images/verified-share.png`
    };
    showShareModal('verification', data);
  }

  // Inject styles
  if (!document.getElementById('share-modal-styles')) {
    const style = document.createElement('style');
    style.id = 'share-modal-styles';
    style.textContent = `
      .share-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        animation: fadeIn 0.2s ease;
      }
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .share-modal {
        background: white;
        border-radius: 12px;
        padding: 24px;
        max-width: 400px;
        width: 90%;
        position: relative;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
        animation: slideUp 0.3s ease;
      }
      @keyframes slideUp {
        from { transform: translateY(20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      .share-modal-close {
        position: absolute;
        top: 12px;
        right: 12px;
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
        color: #666;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
      }
      .share-modal-close:hover {
        background: #f0f0f0;
      }
      .share-modal h3 {
        margin: 0 0 16px 0;
        font-size: 20px;
        color: #333;
      }
      .share-preview-text {
        background: #f8f9fa;
        padding: 12px;
        border-radius: 8px;
        margin-bottom: 16px;
        font-size: 14px;
        color: #555;
        line-height: 1.4;
      }
      .share-preview-image {
        width: 100%;
        max-height: 150px;
        object-fit: cover;
        border-radius: 8px;
        margin-bottom: 16px;
      }
      .share-buttons {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .share-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 12px 16px;
        border: none;
        border-radius: 8px;
        font-size: 15px;
        font-weight: 500;
        cursor: pointer;
        transition: opacity 0.2s, transform 0.1s;
      }
      .share-btn:hover {
        opacity: 0.9;
      }
      .share-btn:active {
        transform: scale(0.98);
      }
      .share-btn-facebook {
        background: #1877f2;
        color: white;
      }
      .share-btn-twitter {
        background: #000;
        color: white;
      }
      .share-btn-copy {
        background: #f0f0f0;
        color: #333;
      }
      .share-icon {
        font-weight: bold;
        font-size: 16px;
      }
      .share-btn-skip {
        width: 100%;
        margin-top: 12px;
        padding: 10px;
        background: none;
        border: none;
        color: #888;
        font-size: 14px;
        cursor: pointer;
      }
      .share-btn-skip:hover {
        color: #555;
      }
    `;
    document.head.appendChild(style);
  }

  return {
    shareToFacebook,
    shareToTwitter,
    copyShareLink,
    showShareModal,
    closeModal,
    doShare,
    logShare,
    promptPurchaseShare,
    promptGiveawayShare,
    promptReviewShare,
    promptVerificationShare
  };
})();
