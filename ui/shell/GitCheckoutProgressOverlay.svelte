<script lang="ts">
  import { gitStore } from '../features/git/git.svelte';
</script>

{#if gitStore.checkoutProgress}
  <div class="checkout-overlay-backdrop" role="dialog" aria-modal="true">
    <div class="checkout-hud-card">
      <!-- Terminal Subtitle / Status Display Box (Top Box) -->
      <div class="terminal-box">
        <div class="terminal-bar">
          <div class="term-dots">
            <span class="dot d-red"></span>
            <span class="dot d-yellow"></span>
            <span class="dot d-green"></span>
          </div>
          <span class="term-title">git &bull; checkout</span>
        </div>
        <div class="term-body">
          <div class="term-line cmd">
            <span class="prompt">$</span>
            <span class="cmd-text">{gitStore.checkoutProgress.command}</span>
          </div>
          <div class="term-line status">
            <span class="step-icon">⚡</span>
            <span class="step-text">{gitStore.checkoutProgress.step}</span>
            <span class="cursor">_</span>
          </div>
        </div>
      </div>

      <!-- Animated Lottie / Glowing Circular Spinner (Middle Circle) -->
      <div class="spinner-wrapper">
        <div class="spinner-glow-ring"></div>
        <div class="spinner-track-ring"></div>
        <div class="spinner-orbit"></div>
        <div class="spinner-center-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="6" cy="5" r="2.5"></circle>
            <circle cx="6" cy="19" r="2.5"></circle>
            <circle cx="18" cy="7" r="2.5"></circle>
            <path d="M6 7.5v9M18 9.5c0 4.5-5 4-12 7.5"></path>
          </svg>
        </div>
      </div>

      <!-- Bottom Headline -->
      <div class="hud-info">
        <h3 class="hud-title">Mengalihkan Cabang Proyek…</h3>
        <p class="hud-desc">
          Berpindah ke <span class="branch-pill">{gitStore.checkoutProgress.target}</span>
        </p>
      </div>
    </div>
  </div>
{/if}

<style>
  .checkout-overlay-backdrop {
    position: fixed;
    inset: 0;
    z-index: 99999;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(10, 11, 15, 0.65);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    user-select: none;
    -webkit-user-select: none;
    animation: overlayFadeIn 0.18s ease-out;
  }

  @keyframes overlayFadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .checkout-hud-card {
    width: 440px;
    max-width: calc(100vw - 32px);
    background: #15171d;
    border: 1px solid #282c35;
    border-radius: 12px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05);
    padding: 22px 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    animation: cardPopIn 0.22s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes cardPopIn {
    from {
      transform: scale(0.95) translateY(8px);
      opacity: 0;
    }
    to {
      transform: scale(1) translateY(0);
      opacity: 1;
    }
  }

  /* Terminal Subtitle Box */
  .terminal-box {
    width: 100%;
    background: #0d0e12;
    border: 1px solid #1e222b;
    border-radius: 8px;
    overflow: hidden;
  }

  .terminal-bar {
    height: 26px;
    background: #16181f;
    border-bottom: 1px solid #1f232c;
    padding: 0 10px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .term-dots {
    display: flex;
    gap: 5px;
  }

  .dot {
    width: 8.5px;
    height: 8.5px;
    border-radius: 50%;
  }
  .d-red { background: #ff5f56; }
  .d-yellow { background: #ffbd2e; }
  .d-green { background: #27c93f; }

  .term-title {
    font-size: 10.5px;
    font-family: 'JetBrains Mono', monospace;
    color: #64748b;
    margin-left: auto;
  }

  .term-body {
    padding: 10px 12px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11.5px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .term-line.cmd {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #94a3b8;
  }

  .prompt {
    color: #3b82f6;
    font-weight: 700;
  }

  .cmd-text {
    color: #cbd5e1;
  }

  .term-line.status {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #38bdf8;
    background: rgba(56, 189, 248, 0.08);
    padding: 4px 8px;
    border-radius: 4px;
    border-left: 2px solid #38bdf8;
  }

  .step-icon {
    font-size: 11px;
    animation: iconPulse 1s infinite alternate;
  }

  @keyframes iconPulse {
    from { opacity: 0.6; transform: scale(0.9); }
    to { opacity: 1; transform: scale(1.1); }
  }

  .step-text {
    font-size: 11px;
    color: #bae6fd;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cursor {
    animation: blink 0.9s infinite;
    color: #38bdf8;
    font-weight: 700;
  }

  @keyframes blink {
    0%, 50% { opacity: 1; }
    51%, 100% { opacity: 0; }
  }

  /* Animated Circular Spinner */
  .spinner-wrapper {
    position: relative;
    width: 84px;
    height: 84px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 4px 0;
  }

  .spinner-glow-ring {
    position: absolute;
    inset: -6px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(59, 130, 246, 0.35) 0%, rgba(59, 130, 246, 0) 70%);
    animation: glowPulse 2s infinite ease-in-out;
  }

  @keyframes glowPulse {
    0%, 100% { transform: scale(0.95); opacity: 0.5; }
    50% { transform: scale(1.15); opacity: 0.9; }
  }

  .spinner-track-ring {
    position: absolute;
    inset: 4px;
    border-radius: 50%;
    border: 3px solid rgba(255, 255, 255, 0.06);
  }

  .spinner-orbit {
    position: absolute;
    inset: 4px;
    border-radius: 50%;
    border: 3px solid transparent;
    border-top-color: #3b82f6;
    border-right-color: #60a5fa;
    animation: orbitSpin 1s infinite linear;
  }

  @keyframes orbitSpin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .spinner-center-icon {
    position: relative;
    z-index: 2;
    color: #60a5fa;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* Bottom Details */
  .hud-info {
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .hud-title {
    margin: 0;
    font-size: 14.5px;
    font-weight: 600;
    color: #f1f5f9;
  }

  .hud-desc {
    margin: 0;
    font-size: 12px;
    color: #94a3b8;
  }

  .branch-pill {
    display: inline-block;
    padding: 1px 7px;
    border-radius: 4px;
    background: #1e293b;
    border: 1px solid #334155;
    color: #93c5fd;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    font-weight: 600;
  }
</style>
