// Sweepstake Wheel v2 - Modern UI
(function() {
  const WHEEL_COLORS = [
    "#FF6B6B", "#4ECDC4", "#FFE66D", "#95E1D3", "#F38181", "#AA96DA",
    "#FCBAD3", "#A8D8EA", "#FF9F43", "#6C5CE7", "#00CEC9", "#FD79A8"
  ];

  // Create and inject CSS
  const style = document.createElement('style');
  style.textContent = `
    .sweep-wheel-overlay {
      position: fixed;
      inset: 0;
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.85);
      backdrop-filter: blur(8px);
    }
    .sweep-wheel-modal {
      position: relative;
      width: 100%;
      max-width: 420px;
      padding: 24px;
      border-radius: 24px;
      background: linear-gradient(to bottom, #0f172a, #1e293b, #0f172a);
      box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
      border: 1px solid rgba(255,255,255,0.1);
    }
    .sweep-wheel-glow {
      position: absolute;
      inset: -4px;
      border-radius: 28px;
      background: linear-gradient(to right, rgba(245,158,11,0.2), rgba(244,114,182,0.2), rgba(139,92,246,0.2));
      filter: blur(20px);
      pointer-events: none;
    }
    .sweep-wheel-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 20px;
    }
    .sweep-wheel-title {
      font-size: 20px;
      font-weight: 700;
      color: white;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .sweep-wheel-subtitle {
      font-size: 14px;
      color: #94a3b8;
      margin-top: 4px;
    }
    .sweep-wheel-subtitle span { color: #fbbf24; font-weight: 600; }
    .sweep-wheel-close {
      background: transparent;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      padding: 8px;
      border-radius: 8px;
      transition: all 0.2s;
    }
    .sweep-wheel-close:hover { background: #334155; color: white; }
    .sweep-wheel-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      position: relative;
    }
    .sweep-wheel-pointer {
      position: absolute;
      top: -8px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 20;
    }
    .sweep-wheel-pointer-triangle {
      width: 0;
      height: 0;
      border-left: 16px solid transparent;
      border-right: 16px solid transparent;
      border-top: 28px solid #fbbf24;
      filter: drop-shadow(0 4px 6px rgba(0,0,0,0.3));
    }
    .sweep-wheel-pointer-dot {
      position: absolute;
      top: -4px;
      left: 50%;
      transform: translateX(-50%);
      width: 12px;
      height: 12px;
      background: #fbbf24;
      border-radius: 50%;
      box-shadow: 0 0 20px rgba(251,191,36,0.5);
    }
    .sweep-wheel-svg-container {
      position: relative;
    }
    .sweep-wheel-outer-glow {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      background: linear-gradient(to right, #f59e0b, #ec4899, #8b5cf6);
      opacity: 0.5;
      filter: blur(12px);
    }
    .sweep-wheel-svg {
      position: relative;
      z-index: 10;
      filter: drop-shadow(0 25px 25px rgba(0,0,0,0.3));
    }
    .sweep-wheel-winner {
      margin-top: 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      padding: 12px 24px;
      border-radius: 12px;
      background: linear-gradient(to right, rgba(245,158,11,0.2), rgba(244,114,182,0.2));
      border: 1px solid rgba(251,191,36,0.3);
    }
    .sweep-wheel-winner-name {
      font-size: 18px;
      font-weight: 700;
      color: white;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .sweep-wheel-winner-stats {
      font-size: 12px;
      color: #94a3b8;
    }
    .sweep-wheel-controls {
      margin-top: 20px;
      display: flex;
      gap: 12px;
      justify-content: center;
    }
    .sweep-wheel-btn-spin {
      padding: 12px 32px;
      font-size: 16px;
      font-weight: 700;
      color: white;
      background: linear-gradient(to right, #f59e0b, #ec4899);
      border: none;
      border-radius: 12px;
      cursor: pointer;
      box-shadow: 0 10px 40px -10px rgba(245,158,11,0.5);
      transition: all 0.2s;
    }
    .sweep-wheel-btn-spin:hover:not(:disabled) {
      box-shadow: 0 20px 40px -10px rgba(245,158,11,0.6);
      transform: translateY(-2px);
    }
    .sweep-wheel-btn-spin:disabled {
      background: #475569;
      color: #94a3b8;
      cursor: not-allowed;
      box-shadow: none;
    }
    .sweep-wheel-btn-replay {
      padding: 12px 20px;
      font-size: 14px;
      font-weight: 600;
      color: #cbd5e1;
      background: #1e293b;
      border: 1px solid #475569;
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .sweep-wheel-btn-replay:hover:not(:disabled) {
      background: #334155;
      color: white;
    }
    .sweep-wheel-btn-replay:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .sweep-wheel-no-entries {
      margin-top: 16px;
      font-size: 14px;
      color: #64748b;
    }
    .sweep-wheel-confetti {
      position: absolute;
      inset: 0;
      overflow: hidden;
      pointer-events: none;
    }
    .sweep-wheel-confetti-piece {
      position: absolute;
      width: 8px;
      height: 12px;
      border-radius: 2px;
      animation: confetti-fall linear forwards;
    }
    @keyframes confetti-fall {
      0% { transform: translateY(0) rotate(0deg); opacity: 1; }
      100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
    }
    @keyframes spin-wheel {
      0% { transform: rotate(var(--start-rotation)); }
      100% { transform: rotate(var(--end-rotation)); }
    }
  `;
  document.head.appendChild(style);

  class SweepstakeWheelV2 {
    constructor() {
      this.overlay = null;
      this.entries = [];
      this.rotation = 0;
      this.isSpinning = false;
      this.winner = null;
      this.onWinnerCallback = null;
    }

    open(entries, onWinner) {
      this.entries = entries || [];
      this.onWinnerCallback = onWinner;
      this.winner = null;
      this.render();
    }

    close() {
      if (this.overlay) {
        this.overlay.remove();
        this.overlay = null;
      }
    }

    get totalEntries() {
      return this.entries.reduce((sum, e) => sum + (e.entries || 1), 0);
    }

    spin() {
      if (this.isSpinning || this.entries.length === 0) return;

      this.isSpinning = true;
      this.winner = null;
      this.updateControls();

      const spins = 5 + Math.random() * 5;
      const extraDegrees = Math.random() * 360;
      const totalRotation = spins * 360 + extraDegrees;

      const wheel = this.overlay.querySelector('.sweep-wheel-svg');
      this.rotation += totalRotation;
      wheel.style.transition = 'transform 5s cubic-bezier(0.17, 0.67, 0.12, 0.99)';
      wheel.style.transform = `rotate(${this.rotation}deg)`;

      setTimeout(() => {
        // Pick winner based on weighted probability
        const randomValue = Math.random() * this.totalEntries;
        let cumulative = 0;
        let selectedWinner = this.entries[0];

        for (const entry of this.entries) {
          cumulative += (entry.entries || 1);
          if (randomValue <= cumulative) {
            selectedWinner = entry;
            break;
          }
        }

        this.winner = selectedWinner;
        this.isSpinning = false;
        this.showConfetti();
        this.updateWinnerDisplay();
        this.updateControls();

        if (this.onWinnerCallback) {
          this.onWinnerCallback(selectedWinner);
        }
      }, 5000);
    }

    replay() {
      this.rotation = 0;
      this.winner = null;
      const wheel = this.overlay.querySelector('.sweep-wheel-svg');
      wheel.style.transition = 'none';
      wheel.style.transform = 'rotate(0deg)';
      this.updateWinnerDisplay();
    }

    showConfetti() {
      const container = this.overlay.querySelector('.sweep-wheel-confetti');
      container.innerHTML = '';

      for (let i = 0; i < 50; i++) {
        const piece = document.createElement('div');
        piece.className = 'sweep-wheel-confetti-piece';
        piece.style.left = `${Math.random() * 100}%`;
        piece.style.top = '-20px';
        piece.style.backgroundColor = WHEEL_COLORS[Math.floor(Math.random() * WHEEL_COLORS.length)];
        piece.style.animationDelay = `${Math.random() * 2}s`;
        piece.style.animationDuration = `${2 + Math.random() * 2}s`;
        piece.style.transform = `rotate(${Math.random() * 360}deg)`;
        container.appendChild(piece);
      }

      setTimeout(() => {
        container.innerHTML = '';
      }, 4000);
    }

    updateControls() {
      const spinBtn = this.overlay.querySelector('.sweep-wheel-btn-spin');
      const replayBtn = this.overlay.querySelector('.sweep-wheel-btn-replay');

      spinBtn.disabled = this.isSpinning || this.entries.length === 0;
      replayBtn.disabled = this.isSpinning;

      spinBtn.innerHTML = this.isSpinning
        ? '<span style="display:flex;align-items:center;gap:8px"><span style="width:16px;height:16px;border:2px solid white;border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite"></span>Spinning...</span>'
        : 'Spin';
    }

    updateWinnerDisplay() {
      const winnerEl = this.overlay.querySelector('.sweep-wheel-winner');
      if (this.winner) {
        const pct = ((this.winner.entries || 1) / this.totalEntries * 100).toFixed(1);
        winnerEl.innerHTML = `
          <div class="sweep-wheel-winner-name">\u{1F3C6} ${this.winner.name}</div>
          <div class="sweep-wheel-winner-stats">${(this.winner.entries || 1).toLocaleString()} entries (${pct}% chance)</div>
        `;
        winnerEl.style.display = 'flex';
      } else {
        winnerEl.style.display = 'none';
      }
    }

    renderWheel() {
      if (this.entries.length === 0) {
        return `<text x="160" y="160" text-anchor="middle" dominant-baseline="middle" fill="#94a3b8" font-size="16" font-weight="500">No entries yet</text>`;
      }

      const radius = 145;
      const centerX = 160;
      const centerY = 160;
      let currentAngle = -90;
      let segments = '';

      this.entries.forEach((entry, index) => {
        const segmentAngle = ((entry.entries || 1) / this.totalEntries) * 360;
        const startAngle = currentAngle;
        const endAngle = startAngle + segmentAngle;
        currentAngle = endAngle;

        const startRad = (startAngle * Math.PI) / 180;
        const endRad = (endAngle * Math.PI) / 180;

        const x1 = centerX + radius * Math.cos(startRad);
        const y1 = centerY + radius * Math.sin(startRad);
        const x2 = centerX + radius * Math.cos(endRad);
        const y2 = centerY + radius * Math.sin(endRad);

        const largeArcFlag = segmentAngle > 180 ? 1 : 0;
        const color = WHEEL_COLORS[index % WHEEL_COLORS.length];

        const pathD = `M ${centerX} ${centerY} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2} Z`;

        // Text position
        const textAngle = startAngle + segmentAngle / 2;
        const textRad = (textAngle * Math.PI) / 180;
        const textRadius = radius * 0.65;
        const textX = centerX + textRadius * Math.cos(textRad);
        const textY = centerY + textRadius * Math.sin(textRad);

        const showText = segmentAngle >= 15;
        const name = entry.name || 'Unknown';
        const displayName = name.length > 10 ? name.slice(0, 9) + '\u2026' : name;

        segments += `
          <defs>
            <linearGradient id="grad-${index}" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="${color}" stop-opacity="1"/>
              <stop offset="100%" stop-color="${color}" stop-opacity="0.7"/>
            </linearGradient>
          </defs>
          <path d="${pathD}" fill="url(#grad-${index})" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
          ${showText ? `<text x="${textX}" y="${textY}" fill="white" font-size="9" font-weight="600" text-anchor="middle" dominant-baseline="middle" transform="rotate(${textAngle + 90}, ${textX}, ${textY})" style="text-shadow:0 1px 2px rgba(0,0,0,0.5)">${displayName}</text>` : ''}
        `;
      });

      return segments;
    }

    render() {
      this.close();

      const overlay = document.createElement('div');
      overlay.className = 'sweep-wheel-overlay';

      // Decorative dots
      let dots = '';
      for (let i = 0; i < 24; i++) {
        const angle = (i * 15 - 90) * (Math.PI / 180);
        const x = 160 + 152 * Math.cos(angle);
        const y = 160 + 152 * Math.sin(angle);
        const color = i % 2 === 0 ? '#fbbf24' : '#f472b6';
        dots += `<circle cx="${x}" cy="${y}" r="3" fill="${color}" opacity="0.8"/>`;
      }

      overlay.innerHTML = `
        <div class="sweep-wheel-confetti"></div>
        <div class="sweep-wheel-modal">
          <div class="sweep-wheel-glow"></div>
          <div style="position:relative">
            <div class="sweep-wheel-header">
              <div>
                <div class="sweep-wheel-title">\u2728 Sweepstake Wheel</div>
                <div class="sweep-wheel-subtitle">Total entries: <span>${this.totalEntries.toLocaleString()}</span> (${this.entries.length} participants)</div>
              </div>
              <button class="sweep-wheel-close">\u2715</button>
            </div>

            <div class="sweep-wheel-container">
              <div class="sweep-wheel-pointer">
                <div class="sweep-wheel-pointer-triangle"></div>
                <div class="sweep-wheel-pointer-dot"></div>
              </div>

              <div class="sweep-wheel-svg-container">
                <div class="sweep-wheel-outer-glow"></div>
                <svg class="sweep-wheel-svg" width="320" height="320" viewBox="0 0 320 320">
                  <defs>
                    <radialGradient id="wheelBg">
                      <stop offset="0%" stop-color="#1e293b"/>
                      <stop offset="100%" stop-color="#0f172a"/>
                    </radialGradient>
                    <linearGradient id="outerRing" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stop-color="#fbbf24"/>
                      <stop offset="50%" stop-color="#f472b6"/>
                      <stop offset="100%" stop-color="#a78bfa"/>
                    </linearGradient>
                    <radialGradient id="centerGrad">
                      <stop offset="0%" stop-color="#fef3c7"/>
                      <stop offset="50%" stop-color="#fbbf24"/>
                      <stop offset="100%" stop-color="#d97706"/>
                    </radialGradient>
                  </defs>
                  <circle cx="160" cy="160" r="155" fill="url(#wheelBg)" stroke="url(#outerRing)" stroke-width="4"/>
                  ${this.renderWheel()}
                  <circle cx="160" cy="160" r="28" fill="url(#centerGrad)" stroke="#fef3c7" stroke-width="3"/>
                  <circle cx="160" cy="160" r="18" fill="#fef3c7" opacity="0.3"/>
                  <circle cx="160" cy="160" r="8" fill="#fef3c7" opacity="0.5"/>
                  ${dots}
                </svg>
              </div>

              <div class="sweep-wheel-winner" style="display:none"></div>

              <div class="sweep-wheel-controls">
                <button class="sweep-wheel-btn-spin" ${this.entries.length === 0 ? 'disabled' : ''}>Spin</button>
                <button class="sweep-wheel-btn-replay">\u21BA Replay</button>
              </div>

              ${this.entries.length === 0 ? '<div class="sweep-wheel-no-entries">No active sweepstake.</div>' : ''}
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);
      this.overlay = overlay;

      // Event listeners
      overlay.querySelector('.sweep-wheel-close').addEventListener('click', () => this.close());
      overlay.querySelector('.sweep-wheel-btn-spin').addEventListener('click', () => this.spin());
      overlay.querySelector('.sweep-wheel-btn-replay').addEventListener('click', () => this.replay());
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) this.close();
      });

      // Add spin keyframe
      const spinStyle = document.createElement('style');
      spinStyle.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
      document.head.appendChild(spinStyle);
    }
  }

  // Export to global
  window.SweepstakeWheelV2 = SweepstakeWheelV2;
  window.sweepWheelV2 = new SweepstakeWheelV2();
})();
