// Sweepstake Section v2 - Modern UI
(function() {
  const style = document.createElement('style');
  style.textContent = `
    .sweep-v2-container {
      background: linear-gradient(to bottom, #0f172a, #1a2744);
      border-radius: 16px;
      padding: 20px;
      color: #e2e8f0;
      font-family: system-ui, -apple-system, sans-serif;
    }
    .sweep-v2-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 16px;
    }
    .sweep-v2-title {
      font-size: 24px;
      font-weight: 700;
      color: #fff;
      margin: 0;
    }
    .sweep-v2-subtitle {
      font-size: 14px;
      color: #94a3b8;
      margin-top: 4px;
    }
    .sweep-v2-status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
    }
    .sweep-v2-status.active {
      background: rgba(16, 185, 129, 0.2);
      color: #10b981;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .sweep-v2-status.inactive {
      background: rgba(100, 116, 139, 0.2);
      color: #94a3b8;
      border: 1px solid rgba(100, 116, 139, 0.3);
    }
    .sweep-v2-status.drawn {
      background: rgba(245, 158, 11, 0.2);
      color: #f59e0b;
      border: 1px solid rgba(245, 158, 11, 0.3);
    }
    .sweep-v2-status.upcoming {
      background: rgba(99, 102, 241, 0.2);
      color: #818cf8;
      border: 1px solid rgba(99, 102, 241, 0.3);
    }
    .sweep-v2-status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: currentColor;
    }
    .sweep-v2-status.active .sweep-v2-status-dot {
      animation: sweep-v2-pulse 2s infinite;
    }
    @keyframes sweep-v2-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .sweep-v2-stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-bottom: 16px;
    }
    .sweep-v2-stat-card {
      background: #1e293b;
      border-radius: 12px;
      padding: 14px;
      border: 1px solid #334155;
    }
    .sweep-v2-stat-card-inner {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .sweep-v2-stat-icon {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
    }
    .sweep-v2-stat-icon.entries { background: rgba(34, 211, 238, 0.2); }
    .sweep-v2-stat-icon.user { background: rgba(244, 114, 182, 0.2); }
    .sweep-v2-stat-icon.balance { background: rgba(251, 191, 36, 0.2); }
    .sweep-v2-stat-value {
      font-size: 24px;
      font-weight: 700;
      color: #fff;
    }
    .sweep-v2-stat-label {
      font-size: 12px;
      color: #94a3b8;
    }
    .sweep-v2-prize-card {
      background: #1e293b;
      border-radius: 16px;
      overflow: hidden;
      border: 1px solid #334155;
      margin-bottom: 16px;
    }
    .sweep-v2-prize-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
    }
    @media (max-width: 600px) {
      .sweep-v2-prize-grid { grid-template-columns: 1fr; }
      .sweep-v2-stats { grid-template-columns: 1fr; }
    }
    .sweep-v2-prize-image-section {
      background: rgba(30, 41, 59, 0.5);
      padding: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 250px;
      position: relative;
    }
    .sweep-v2-prize-badges {
      position: absolute;
      top: 12px;
      left: 12px;
      right: 12px;
      display: flex;
      justify-content: space-between;
    }
    .sweep-v2-badge {
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .sweep-v2-badge.featured {
      background: rgba(34, 211, 238, 0.9);
      color: #0f172a;
    }
    .sweep-v2-badge.time {
      background: rgba(15, 23, 42, 0.8);
      color: #e2e8f0;
      border: 1px solid #334155;
      backdrop-filter: blur(4px);
    }
    .sweep-v2-prize-image {
      width: 100%;
      max-width: 200px;
      aspect-ratio: 3/4;
      border-radius: 12px;
      background: linear-gradient(135deg, rgba(34,211,238,0.2), rgba(244,114,182,0.2), rgba(251,191,36,0.2));
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid #334155;
      overflow: hidden;
    }
    .sweep-v2-prize-image img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .sweep-v2-prize-details {
      padding: 20px;
      display: flex;
      flex-direction: column;
    }
    .sweep-v2-prize-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 12px;
    }
    .sweep-v2-category {
      background: #334155;
      color: #e2e8f0;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 500;
    }
    .sweep-v2-value {
      font-size: 20px;
      font-weight: 700;
      color: #22d3ee;
    }
    .sweep-v2-value span {
      font-size: 12px;
      font-weight: 400;
      color: #94a3b8;
      margin-left: 4px;
    }
    .sweep-v2-prize-title {
      font-size: 20px;
      font-weight: 700;
      color: #fff;
      margin: 0 0 8px 0;
    }
    .sweep-v2-prize-desc {
      font-size: 14px;
      color: #94a3b8;
      line-height: 1.5;
      margin-bottom: 16px;
    }
    .sweep-v2-donor {
      background: rgba(51, 65, 85, 0.5);
      border-radius: 12px;
      padding: 14px;
      border: 1px solid #334155;
      margin-bottom: 16px;
    }
    .sweep-v2-donor-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #64748b;
      margin-bottom: 10px;
    }
    .sweep-v2-donor-info {
      display: flex;
      gap: 12px;
    }
    .sweep-v2-donor-avatar {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: rgba(34, 211, 238, 0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      color: #22d3ee;
      border: 2px solid rgba(34, 211, 238, 0.3);
      overflow: hidden;
    }
    .sweep-v2-donor-avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .sweep-v2-donor-text {
      flex: 1;
      min-width: 0;
    }
    .sweep-v2-donor-name {
      font-weight: 600;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .sweep-v2-donor-name a {
      color: #22d3ee;
      text-decoration: none;
    }
    .sweep-v2-donor-name a:hover {
      color: #67e8f9;
    }
    .sweep-v2-donor-desc {
      font-size: 13px;
      color: #94a3b8;
      margin-top: 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .sweep-v2-entry-section {
      border-top: 1px solid #334155;
      padding-top: 16px;
      margin-top: auto;
    }
    .sweep-v2-entry-row {
      display: flex;
      gap: 10px;
    }
    .sweep-v2-entry-input {
      width: 80px;
      padding: 12px;
      border-radius: 10px;
      border: 1px solid #334155;
      background: #0f172a;
      color: #fff;
      font-size: 16px;
      text-align: center;
    }
    .sweep-v2-entry-input:focus {
      outline: none;
      border-color: #22d3ee;
    }
    .sweep-v2-entry-btn {
      flex: 1;
      padding: 12px 20px;
      border-radius: 10px;
      border: none;
      background: linear-gradient(to right, #22d3ee, #06b6d4);
      color: #0f172a;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: all 0.2s;
    }
    .sweep-v2-entry-btn:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 10px 30px -10px rgba(34, 211, 238, 0.4);
    }
    .sweep-v2-entry-btn:disabled {
      background: #475569;
      color: #94a3b8;
      cursor: not-allowed;
    }
    .sweep-v2-entry-note {
      font-size: 11px;
      color: #64748b;
      text-align: center;
      margin-top: 10px;
    }
    .sweep-v2-winner {
      background: linear-gradient(to right, rgba(251, 191, 36, 0.2), rgba(34, 211, 238, 0.2));
      border: 1px solid rgba(251, 191, 36, 0.3);
      border-radius: 12px;
      padding: 14px;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .sweep-v2-winner-icon {
      font-size: 24px;
    }
    .sweep-v2-winner-label {
      font-size: 12px;
      color: #94a3b8;
    }
    .sweep-v2-winner-name {
      font-weight: 700;
      color: #fbbf24;
    }
    .sweep-v2-actions {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
    }
    .sweep-v2-action-btn {
      padding: 12px 16px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: all 0.2s;
    }
    .sweep-v2-action-btn.share {
      background: transparent;
      border: 1px solid #22d3ee;
      color: #22d3ee;
    }
    .sweep-v2-action-btn.share:hover {
      background: rgba(34, 211, 238, 0.1);
    }
    .sweep-v2-action-btn.offer {
      background: transparent;
      border: 1px solid #f472b6;
      color: #f472b6;
    }
    .sweep-v2-action-btn.offer:hover {
      background: rgba(244, 114, 182, 0.1);
    }
    .sweep-v2-action-btn.wheel {
      background: #334155;
      border: 1px solid #475569;
      color: #e2e8f0;
    }
    .sweep-v2-action-btn.wheel:hover {
      background: #475569;
    }
    .sweep-v2-note {
      text-align: center;
      font-size: 11px;
      color: #64748b;
      margin-top: 12px;
    }
    .sweep-v2-no-sweep {
      text-align: center;
      padding: 40px 20px;
      color: #64748b;
    }
    .sweep-v2-no-sweep-title {
      font-size: 18px;
      color: #94a3b8;
      margin-bottom: 8px;
    }
    .sweep-v2-others-heading {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #64748b;
      margin: 16px 0 10px;
    }
    .sweep-v2-others-row {
      display: flex;
      gap: 12px;
      overflow-x: auto;
      padding-bottom: 8px;
      -webkit-overflow-scrolling: touch;
    }
    .sweep-v2-others-row::-webkit-scrollbar { height: 4px; }
    .sweep-v2-others-row::-webkit-scrollbar-thumb { background: #334155; border-radius: 2px; }
    .sweep-v2-thumb {
      flex: 0 0 200px;
      background: rgba(30, 41, 59, 0.8);
      border: 1px solid rgba(100, 116, 139, 0.2);
      border-radius: 10px;
      padding: 12px;
      cursor: pointer;
      transition: border-color 0.2s;
    }
    .sweep-v2-thumb:hover {
      border-color: rgba(99, 102, 241, 0.5);
    }
    .sweep-v2-thumb-img {
      width: 100%;
      height: 80px;
      object-fit: cover;
      border-radius: 6px;
      background: #1e293b;
      margin-bottom: 8px;
    }
    .sweep-v2-thumb-title {
      font-size: 13px;
      font-weight: 600;
      color: #e2e8f0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 4px;
    }
    .sweep-v2-thumb-date {
      font-size: 11px;
      color: #64748b;
      margin-bottom: 6px;
    }
    .sweep-v2-thumb-badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 10px;
    }
    .sweep-v2-thumb-badge.active {
      background: rgba(16, 185, 129, 0.2);
      color: #10b981;
    }
    .sweep-v2-thumb-badge.upcoming {
      background: rgba(99, 102, 241, 0.2);
      color: #818cf8;
    }
    .sweep-v2-thumb-badge.drawn {
      background: rgba(245, 158, 11, 0.2);
      color: #f59e0b;
    }
  `;
  document.head.appendChild(style);

  class SweepSectionV2 {
    constructor(containerId) {
      this.containerId = containerId;
      this.container = null;
      this.data = null;
      this.otherSweepstakes = [];
    }

    init(containerId) {
      this.containerId = containerId || this.containerId;
      this.container = document.getElementById(this.containerId);
      if (!this.container) {
        console.error('Sweep container not found:', this.containerId);
        return;
      }
      this.render();
    }

    async update(data) {
      this.data = data;
      // Load rules when there's an active sweepstake
      if (data?.sweepstake?.id) {
        await this.loadRules();
      }
      this.render();
    }

    async loadAll() {
      if (!this.container) this.init(this.containerId);
      try {
        var resp = await fetch('/api/sweepstakes/active', { credentials: 'include' });
        var json = await resp.json();
        var list = json.sweepstakes || [];
        var balance = json.balance || 0;
        if (!list.length) {
          this.otherSweepstakes = [];
          this.data = { sweepstake: {}, user: { entries: 0, balance: balance }, prize: {}, donor: {}, winner: null };
          this.render();
          return;
        }
        // Primary = first item (query orders: winner > active > upcoming)
        var primary = list[0];
        this.otherSweepstakes = list.slice(1);
        this.data = {
          sweepstake: primary.sweepstake,
          totals: primary.totals,
          user: { entries: primary.userEntries || 0, balance: balance },
          prize: primary.prize || {},
          donor: primary.donor || {},
          winner: primary.winner,
          participants: primary.participants,
          isUpcoming: primary.isUpcoming || false
        };
        if (this.data.sweepstake?.id) {
          await this.loadRules();
        }
        this.render();
      } catch (e) {
        console.error('Failed to load sweepstakes:', e);
      }
    }

    switchToPrimary(item) {
      // Swap clicked thumbnail into primary view
      var oldPrimary = {
        sweepstake: this.data?.sweepstake,
        totals: this.data?.totals,
        prize: this.data?.prize,
        donor: this.data?.donor,
        winner: this.data?.winner,
        participants: this.data?.participants,
        userEntries: this.data?.user?.entries || 0,
        isUpcoming: this.data?.isUpcoming || false,
        hasWinner: !!this.data?.winner
      };
      var balance = this.data?.user?.balance || 0;
      // Replace others list: remove clicked, add old primary
      this.otherSweepstakes = this.otherSweepstakes.filter(function(o) {
        return o.sweepstake?.id !== item.sweepstake?.id;
      });
      if (oldPrimary.sweepstake?.id) this.otherSweepstakes.unshift(oldPrimary);
      this.data = {
        sweepstake: item.sweepstake,
        totals: item.totals,
        user: { entries: item.userEntries || 0, balance: balance },
        prize: item.prize || {},
        donor: item.donor || {},
        winner: item.winner,
        participants: item.participants,
        isUpcoming: item.isUpcoming || false
      };
      this.rules = [];
      var self = this;
      if (this.data.sweepstake?.id) {
        this.loadRules().then(function() { self.render(); });
      } else {
        this.render();
      }
    }

    getEndDateString() {
      const sweep = this.data?.sweepstake;
      return sweep?.endDate || sweep?.endAt || sweep?.endat || '';
    }

    getDaysRemaining() {
      const endStr = this.getEndDateString();
      if (!endStr) return 0;
      const end = new Date(endStr);
      const now = new Date();
      return Math.max(0, Math.ceil((end - now) / (1000 * 60 * 60 * 24)));
    }

    handleShare() {
      var sweep = this.data?.sweepstake;
      var shareUrl, shareText, shareTitle, imageUrl;
      if (sweep?.id) {
        shareUrl = window.location.origin + '/sweep/' + sweep.id;
        var _prize = this.data?.prize || {};
        var _title = _prize.title || sweep.prize || sweep.title || 'Town Sweepstake';
        var _val = _prize.valueCents ? '$' + (Number(_prize.valueCents) / 100).toFixed(0) : (sweep.estimatedValue || '');
        shareText = 'Check out this sweepstake: ' + _title + (_val ? ' - Worth ' + _val + '!' : '');
        shareTitle = _title;
        imageUrl = _prize.imageUrl || '';
      } else {
        shareUrl = window.location.origin + '/giveaway-offer';
        shareText = 'Local businesses: Donate prizes to our community sweepstakes and get featured to local customers!';
        shareTitle = 'Town Sweepstake';
        imageUrl = '';
      }

      if (window.ShareModal) {
        ShareModal.show({
          type: 'sweepstake',
          title: 'Share this giveaway!',
          shareText: shareText,
          shareUrl: shareUrl,
          imageUrl: imageUrl,
          itemId: sweep?.id || 0
        });
      } else {
        // Fallback if share_modal.js not loaded
        window.open('https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(shareUrl) + '&quote=' + encodeURIComponent(shareText), 'facebook-share', 'width=600,height=400');
      }
    }

    async logShare(platform) {
      // Only log shares when there's an active sweepstake
      const sweepId = this.data?.sweepstake?.id;
      if (!sweepId) return;

      try {
        const resp = await fetch('/api/share/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            shareType: 'sweepstake',
            itemType: 'sweepstake',
            itemId: this.data?.sweepstake?.id,
            platform: platform
          })
        });
        const result = await resp.json();
        if (result.tokensAwarded) {
          alert(`+${result.tokensAwarded} bonus entries for sharing!`);
          // Refresh data to show updated balance
          if (window.loadSweepstakeData) window.loadSweepstakeData();
        }
      } catch (err) {
        console.error('Failed to log share:', err);
      }
    }

    async handleEnter(amount) {
      // This will call the existing enter endpoint
      if (window.enterSweepstake) {
        await window.enterSweepstake(amount);
      }
    }

    async loadRules() {
      try {
        const sweepId = this.data?.sweepstake?.id;
        const url = sweepId
          ? '/api/sweepstake/rules?sweepstakeId=' + sweepId
          : '/api/sweepstake/rules';
        const resp = await fetch(url, { credentials: 'include' });
        const data = await resp.json();
        this.rules = data.rules || [];
      } catch (err) {
        console.error('Failed to load sweep rules:', err);
        this.rules = [];
      }
    }

    formatRuleDescription(rule) {
      const labels = {
        'message_send': 'Send a message',
        'listing_create': 'Create a listing',
        'purchase': 'Make a local purchase',
        'review_left': 'Leave a review',
        'listing_mark_sold': 'Mark a listing as sold',
        'social_share': 'Share on social media'
      };
      const label = labels[rule.eventType] || rule.eventType;
      const amount = rule.buyerAmount || rule.sellerAmount || rule.amount || 0;
      let desc = `${label}: +${amount} entries`;
      if (rule.dailyCap > 0) desc += ` (max ${rule.dailyCap}/day)`;
      return desc;
    }

    render() {
      if (!this.container) return;

      const d = this.data || {};
      const sweep = d.sweepstake || {};
      const prize = d.prize || {};
      const totals = d.totals || {};
      const user = d.user || {};
      const donor = d.donor || sweep.donor || {};
      const prizeTitle = prize.title || sweep.prize || sweep.title || 'Untitled Prize';
      const prizeDesc = prize.description || sweep.description || '';
      const prizeImage = prize.imageUrl || sweep.imageUrl || '';
      const prizeValue = prize.valueCents ? '$' + (Number(prize.valueCents) / 100).toFixed(0) : (sweep.estimatedValue || '');
      const hasWinner = !!d.winner;
      const sweepStart = sweep.startAt || sweep.startat || '';
      const isUpcoming = !hasWinner && sweepStart && new Date(sweepStart) > new Date();
      const isActive = !!sweep.id && sweep.status === 'active' && !hasWinner && !isUpcoming;
      const daysLeft = this.getDaysRemaining();
      const endStr = this.getEndDateString();
      const endDateFormatted = endStr ? new Date(endStr).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
      const ruleLabels = {
        'message_send': true, 'listing_create': true, 'purchase': true,
        'review_left': true, 'listing_mark_sold': true, 'social_share': true
      };
      const displayRules = (this.rules || []).filter(function(r) { return r.eventType && ruleLabels[r.eventType]; });

      if (!sweep.id) {
        this.container.innerHTML = `
          <div class="sweep-v2-container">
            <div class="sweep-v2-header">
              <div>
                <h2 class="sweep-v2-title">Town Sweepstake</h2>
                <p class="sweep-v2-subtitle">Win amazing prizes from our community</p>
              </div>
              <div class="sweep-v2-status inactive">
                <span class="sweep-v2-status-dot"></span>
                Inactive
              </div>
            </div>
            <div class="sweep-v2-no-sweep">
              <div class="sweep-v2-no-sweep-title">No Active Sweepstake</div>
              <p>Check back soon for exciting prizes!</p>
              <p style="margin-top:12px;font-size:13px;">Want to donate a prize? Local businesses can submit items for community giveaways.</p>
            </div>
            <div class="sweep-v2-actions">
              <button class="sweep-v2-action-btn share" id="sweepV2ShareBtn">
                \uD83D\uDCE4 Invite Business
              </button>
              <button class="sweep-v2-action-btn offer" id="sweepV2OfferBtn">
                \uD83C\uDF81 Submit Prize
              </button>
              <button class="sweep-v2-action-btn wheel" id="sweepV2WheelBtn" disabled style="opacity:0.5">
                \u2728 Open Wheel
              </button>
            </div>
            <div class="sweep-v2-note">Preferred donor tier members get priority placement</div>
            ${this.renderOtherSweepstakes()}
          </div>
        `;
        this.bindEvents();
        return;
      }

      this.container.innerHTML = `
        <div class="sweep-v2-container">
          <!-- Header -->
          <div class="sweep-v2-header">
            <div>
              <h2 class="sweep-v2-title">Town Sweepstake</h2>
              <p class="sweep-v2-subtitle">Win amazing prizes from our community</p>
            </div>
            <div class="sweep-v2-status ${hasWinner ? 'drawn' : (isUpcoming ? 'upcoming' : (isActive ? 'active' : 'inactive'))}">
              <span class="sweep-v2-status-dot"></span>
              ${hasWinner ? 'Winner Drawn' : (isUpcoming ? 'Coming Soon' : (isActive ? 'Active' : 'Inactive'))}
            </div>
          </div>

          <!-- Stats -->
          <div class="sweep-v2-stats">
            ${!hasWinner ? `<div class="sweep-v2-stat-card">
              <div class="sweep-v2-stat-card-inner">
                <div class="sweep-v2-stat-icon entries">\uD83D\uDC65</div>
                <div>
                  <div class="sweep-v2-stat-value">${(totals.totalEntries || 0).toLocaleString()}</div>
                  <div class="sweep-v2-stat-label">Total Entries</div>
                </div>
              </div>
            </div>
            <div class="sweep-v2-stat-card">
              <div class="sweep-v2-stat-card-inner">
                <div class="sweep-v2-stat-icon user">\uD83C\uDF9F\uFE0F</div>
                <div>
                  <div class="sweep-v2-stat-value">${(user.entries || 0).toLocaleString()}</div>
                  <div class="sweep-v2-stat-label">Your Entries</div>
                </div>
              </div>
            </div>` : ''}
            <div class="sweep-v2-stat-card">
              <div class="sweep-v2-stat-card-inner">
                <div class="sweep-v2-stat-icon balance">\uD83D\uDCB0</div>
                <div>
                  <div class="sweep-v2-stat-value">${(user.balance || 0).toLocaleString()}</div>
                  <div class="sweep-v2-stat-label">Your Balance</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Prize Card -->
          <div class="sweep-v2-prize-card">
            <div class="sweep-v2-prize-grid">
              <div class="sweep-v2-prize-image-section">
                <div class="sweep-v2-prize-badges">
                  <div class="sweep-v2-badge featured">\uD83C\uDFC6 Featured Prize</div>
                  <div class="sweep-v2-badge time">\u23F0 ${endDateFormatted ? 'Ends ' + endDateFormatted : (daysLeft > 0 ? daysLeft + ' days left' : 'Ending soon')}</div>
                </div>
                <div class="sweep-v2-prize-image">
                  ${prizeImage ? `<img src="${prizeImage}" alt="${prizeTitle}">` : '\u2728'}
                </div>
              </div>
              <div class="sweep-v2-prize-details">
                <div class="sweep-v2-prize-header">
                  <div class="sweep-v2-category">${sweep.category || 'Prize'}</div>
                  <div class="sweep-v2-value">${prizeValue}<span>value</span></div>
                </div>
                <h3 class="sweep-v2-prize-title">${prizeTitle}</h3>
                <p class="sweep-v2-prize-desc">${prizeDesc}</p>

                ${donor.businessName ? `
                <div class="sweep-v2-donor">
                  <div class="sweep-v2-donor-label">Prize Donated By</div>
                  <div class="sweep-v2-donor-info">
                    <div class="sweep-v2-donor-avatar">
                      ${donor.avatarUrl ? `<img src="${donor.avatarUrl}" alt="${donor.name}">` : (donor.name || 'D').charAt(0)}
                    </div>
                    <div class="sweep-v2-donor-text">
                      <div class="sweep-v2-donor-name">
                        ${donor.businessName}
                        ${donor.website ? `<a href="${donor.website}" target="_blank">\uD83D\uDD17</a>` : ''}
                      </div>
                      <div class="sweep-v2-donor-desc">${donor.description || ''}</div>
                    </div>
                  </div>
                </div>
                ` : ''}

                ${displayRules.length ? `
                <div style="margin-bottom:12px;">
                  <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#64748b;margin-bottom:8px;">Ways to Earn Entries</div>
                  ${displayRules.map(r => `<div style="font-size:13px;color:#94a3b8;padding:4px 0;">${this.formatRuleDescription(r)}</div>`).join('')}
                </div>
                ` : ''}

                ${!d.winner ? `
                <div class="sweep-v2-entry-section">
                  <div class="sweep-v2-entry-row">
                    <input type="number" class="sweep-v2-entry-input" value="1" min="1" id="sweepV2EntryAmount">
                    <button class="sweep-v2-entry-btn" id="sweepV2EnterBtn" ${!isActive ? 'disabled' : ''}>
                      \uD83C\uDF9F\uFE0F Enter Sweepstake
                    </button>
                  </div>
                  <div class="sweep-v2-entry-note">Each entry costs 1 token from your balance</div>
                </div>
                ` : ''}
              </div>
            </div>
          </div>

          ${d.winner ? `
          <div class="sweep-v2-winner">
            <div class="sweep-v2-winner-icon">\uD83C\uDFC6</div>
            <div>
              <div class="sweep-v2-winner-label">Winner</div>
              <div class="sweep-v2-winner-name">${d.winner.displayName || d.winner.name}</div>
            </div>
          </div>
          ` : ''}

          <!-- Action Buttons -->
          <div class="sweep-v2-actions">
            <button class="sweep-v2-action-btn share" id="sweepV2ShareBtn">
              \uD83D\uDCE4 Share
            </button>
            <button class="sweep-v2-action-btn offer" id="sweepV2OfferBtn">
              \uD83C\uDF81 Submit Prize
            </button>
            <button class="sweep-v2-action-btn wheel" id="sweepV2WheelBtn">
              \u2728 Open Wheel
            </button>
          </div>

          <div class="sweep-v2-note">Share for bonus entries \u2022 Preferred donors get priority placement</div>

          ${this.renderOtherSweepstakes()}
        </div>
      `;

      // Bind events
      this.bindEvents();
    }

    renderOtherSweepstakes() {
      var others = this.otherSweepstakes || [];
      if (!others.length) return '';
      var self = this;
      var cards = others.map(function(item, idx) {
        var s = item.sweepstake || {};
        var p = item.prize || {};
        var title = p.title || s.prize || s.title || 'Prize';
        var img = p.imageUrl || '';
        var hasWinner = item.hasWinner || !!item.winner;
        var startDate = s.startAt || s.startat || '';
        var endDate = s.endAt || s.endat || '';
        var isUpcoming = !hasWinner && startDate && new Date(startDate) > new Date();
        var badgeClass = hasWinner ? 'drawn' : (isUpcoming ? 'upcoming' : 'active');
        var badgeText = hasWinner ? 'Winner Drawn' : (isUpcoming ? 'Coming Soon' : 'Active');
        var dateFmt = { month: 'short', day: 'numeric' };
        var dateStr = '';
        if (startDate && endDate) {
          dateStr = new Date(startDate).toLocaleString('en-US', dateFmt) + ' \u2013 ' + new Date(endDate).toLocaleString('en-US', dateFmt);
        } else if (isUpcoming && startDate) {
          dateStr = 'Starts ' + new Date(startDate).toLocaleString('en-US', dateFmt);
        } else if (endDate) {
          dateStr = 'Ends ' + new Date(endDate).toLocaleString('en-US', dateFmt);
        }
        return '<div class="sweep-v2-thumb" data-sweep-idx="' + idx + '">' +
          (img ? '<img class="sweep-v2-thumb-img" src="' + img + '" alt="' + title + '">' : '<div class="sweep-v2-thumb-img" style="display:flex;align-items:center;justify-content:center;font-size:28px;">\u2728</div>') +
          '<div class="sweep-v2-thumb-title">' + title + '</div>' +
          '<div class="sweep-v2-thumb-date">' + dateStr + '</div>' +
          '<span class="sweep-v2-thumb-badge ' + badgeClass + '">' + badgeText + '</span>' +
          '</div>';
      }).join('');
      return '<div class="sweep-v2-others-heading">More Giveaways</div>' +
        '<div class="sweep-v2-others-row">' + cards + '</div>';
    }

    bindEvents() {
      const shareBtn = document.getElementById('sweepV2ShareBtn');
      const enterBtn = document.getElementById('sweepV2EnterBtn');
      const wheelBtn = document.getElementById('sweepV2WheelBtn');
      const offerBtn = document.getElementById('sweepV2OfferBtn');
      const entryInput = document.getElementById('sweepV2EntryAmount');

      if (shareBtn) {
        shareBtn.addEventListener('click', () => this.handleShare());
      }

      if (enterBtn && entryInput) {
        enterBtn.addEventListener('click', () => {
          const amount = parseInt(entryInput.value) || 1;
          this.handleEnter(amount);
        });
      }

      if (wheelBtn) {
        wheelBtn.addEventListener('click', async () => {
          try {
            const resp = await fetch('/api/sweepstake/active', { credentials: 'include' });
            const data = await resp.json();
            if (!data.sweepstake) {
              window.sweepWheelV2?.open([], null);
              return;
            }
            const entries = (data.participants || []).map(p => ({
              id: p.userId,
              name: p.displayName || p.email || 'Unknown',
              entries: p.entries || 1
            }));
            const isAdmin = !!(window.access && window.access.isAdmin);
            const winnerId = data.winner ? (data.winner.userId || data.winner.id || null) : null;
            window.sweepWheelV2?.open(entries, null, {
              isAdmin: isAdmin,
              sweepstakeId: data.sweepstake.id,
              winnerId: winnerId
            });
          } catch (err) {
            console.error('Failed to load sweep data:', err);
            window.sweepWheelV2?.open([], null);
          }
        });
      }

      if (offerBtn) {
        offerBtn.addEventListener('click', () => {
          // Navigate to prize offer form
          window.location.href = '/giveaway-offer';
        });
      }

      // Thumbnail card click handlers
      var self = this;
      var thumbs = document.querySelectorAll('.sweep-v2-thumb');
      thumbs.forEach(function(el) {
        el.addEventListener('click', function() {
          var idx = parseInt(el.getAttribute('data-sweep-idx'));
          var item = self.otherSweepstakes[idx];
          if (item) self.switchToPrimary(item);
        });
      });
    }
  }

  // Export
  window.SweepSectionV2 = SweepSectionV2;
  window.sweepSectionV2 = new SweepSectionV2();
})();
