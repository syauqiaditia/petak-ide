<script lang="ts">
  import { api } from '../../lib/api';
  import {
    getImageFormat,
    getImageMimeType,
    formatFileSize,
    calculateZoom,
  } from './imageUtils';

  let { filePath = '' }: { filePath: string } = $props();

  let zoom = $state<number>(1);
  let isFitToScreen = $state<boolean>(true);

  let naturalWidth = $state<number>(0);
  let naturalHeight = $state<number>(0);
  let fileSizeBytes = $state<number>(0);
  let imageFormat = $state<string>('');
  let imgSrc = $state<string>('');
  let loading = $state<boolean>(true);
  let error = $state<string | null>(null);

  let zoomPercent = $derived(
    isFitToScreen ? 'Fit' : `${Math.round(zoom * 100)}%`
  );

  async function loadImage(path: string) {
    if (!path) return;
    loading = true;
    error = null;
    imageFormat = getImageFormat(path);

    try {
      let b64 = '';
      try {
        b64 = await api.readFileBase64(path);
      } catch (err) {
        // Fallback for svg/mock/test environments
        if (path.toLowerCase().endsWith('.svg')) {
          const raw = await api.readFile(path);
          b64 = typeof btoa !== 'undefined' ? btoa(raw) : Buffer.from(raw).toString('base64');
        } else {
          throw err;
        }
      }

      if (b64) {
        const mime = getImageMimeType(path);
        imgSrc = `data:${mime};base64,${b64}`;
        // Calculate byte length from base64
        const padding = (b64.match(/=+$/) || [''])[0].length;
        fileSizeBytes = Math.max(0, Math.floor((b64.length * 3) / 4 - padding));
      }
    } catch (e: any) {
      error = String(e?.message || e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (filePath) {
      loadImage(filePath);
    }
  });

  function handleImageLoad(e: Event) {
    const img = e.currentTarget as HTMLImageElement;
    naturalWidth = img.naturalWidth;
    naturalHeight = img.naturalHeight;
  }

  function handleZoomIn() {
    isFitToScreen = false;
    zoom = calculateZoom(zoom, 'in');
  }

  function handleZoomOut() {
    isFitToScreen = false;
    zoom = calculateZoom(zoom, 'out');
  }

  function handleZoomReset() {
    isFitToScreen = false;
    zoom = 1;
  }

  function handleFitToScreen() {
    isFitToScreen = true;
    zoom = 1;
  }

  function handleWheel(e: WheelEvent) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (e.deltaY < 0) {
        handleZoomIn();
      } else {
        handleZoomOut();
      }
    }
  }
</script>

<div class="image-preview-container" onwheel={handleWheel} role="region" aria-label="Image Preview">
  <!-- Mini Toolbar -->
  <div class="preview-toolbar">
    <div class="toolbar-left">
      <span class="file-badge">{imageFormat}</span>
      <span class="zoom-display">{zoomPercent}</span>
    </div>
    <div class="toolbar-actions">
      <button
        type="button"
        class="tb-btn"
        title="Zoom In (+)"
        onclick={handleZoomIn}
        aria-label="Zoom In"
      >
        +
      </button>
      <button
        type="button"
        class="tb-btn"
        title="Zoom Out (-)"
        onclick={handleZoomOut}
        aria-label="Zoom Out"
      >
        −
      </button>
      <button
        type="button"
        class="tb-btn text-btn"
        class:active={!isFitToScreen && zoom === 1}
        title="100% (1:1)"
        onclick={handleZoomReset}
      >
        1:1
      </button>
      <button
        type="button"
        class="tb-btn text-btn"
        class:active={isFitToScreen}
        title="Fit to Screen"
        onclick={handleFitToScreen}
      >
        Fit
      </button>
    </div>
  </div>

  <!-- Main Viewport with Checkerboard Background -->
  <div class="preview-viewport checkerboard">
    {#if loading}
      <div class="preview-state">
        <span class="spinner"></span>
        <span>Memuat gambar…</span>
      </div>
    {:else if error}
      <div class="preview-state error">
        <span class="error-icon">⚠</span>
        <span>Gagal memuat gambar: {error}</span>
      </div>
    {:else if imgSrc}
      <div
        class="image-wrapper"
        class:fit-mode={isFitToScreen}
      >
        <img
          src={imgSrc}
          alt={filePath.split('/').pop()}
          class="preview-img"
          class:fit-img={isFitToScreen}
          style:transform={!isFitToScreen ? `scale(${zoom})` : undefined}
          onload={handleImageLoad}
        />
      </div>
    {/if}
  </div>

  <!-- Status Bar Info at Bottom -->
  <div class="preview-statusbar">
    <div class="sb-item">
      <span class="sb-label">Dimensi:</span>
      <span class="sb-val">
        {naturalWidth > 0 ? `${naturalWidth} × ${naturalHeight} px` : '—'}
      </span>
    </div>
    <span class="sb-sep">•</span>
    <div class="sb-item">
      <span class="sb-label">Ukuran:</span>
      <span class="sb-val">{formatFileSize(fileSizeBytes)}</span>
    </div>
    <span class="sb-sep">•</span>
    <div class="sb-item">
      <span class="sb-label">Format:</span>
      <span class="sb-val">{imageFormat}</span>
    </div>
    <span class="sb-sep">•</span>
    <div class="sb-item file-path-item" title={filePath}>
      <span class="sb-val mono">{filePath}</span>
    </div>
  </div>
</div>

<style>
  .image-preview-container {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    background: #16171a;
    overflow: hidden;
    position: relative;
    user-select: none;
  }

  /* Mini Toolbar */
  .preview-toolbar {
    height: 36px;
    background: #1a1b1f;
    border-bottom: 1px solid #282a30;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    z-index: 10;
  }

  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .file-badge {
    background: #2b2d35;
    color: #6ea8ff;
    font-size: 11px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 4px;
    letter-spacing: 0.5px;
  }

  .zoom-display {
    font-size: 12px;
    color: #8b8f98;
    font-family: 'JetBrains Mono', monospace;
  }

  .toolbar-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .tb-btn {
    background: #22242a;
    color: #bcbec4;
    border: 1px solid #32353d;
    border-radius: 4px;
    width: 28px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.1s ease;
  }

  .tb-btn:hover {
    background: #2e313a;
    color: #ffffff;
    border-color: #434752;
  }

  .tb-btn.text-btn {
    width: auto;
    padding: 0 8px;
    font-size: 11px;
    font-weight: 600;
  }

  .tb-btn.active {
    background: #1e293b;
    color: #6ea8ff;
    border-color: #3b82f6;
  }

  /* Main Viewport & Checkerboard Pattern */
  .preview-viewport {
    flex: 1;
    overflow: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    padding: 16px;
  }

  .checkerboard {
    background-color: #121316;
    background-image:
      linear-gradient(45deg, #1c1d22 25%, transparent 25%),
      linear-gradient(-45deg, #1c1d22 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #1c1d22 75%),
      linear-gradient(-45deg, transparent 75%, #1c1d22 75%);
    background-size: 20px 20px;
    background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
  }

  .image-wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.1s ease-out;
  }

  .image-wrapper.fit-mode {
    max-width: 100%;
    max-height: 100%;
  }

  .preview-img {
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
    border-radius: 2px;
    transform-origin: center center;
    transition: transform 0.1s ease-out;
  }

  .preview-img.fit-img {
    max-width: 100%;
    max-height: calc(100vh - 160px);
    object-fit: contain;
  }

  .preview-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    color: #8b8f98;
    font-size: 13px;
  }

  .preview-state.error {
    color: #f07a74;
  }

  .error-icon {
    font-size: 24px;
  }

  .spinner {
    width: 24px;
    height: 24px;
    border: 2px solid #282a30;
    border-top-color: #6ea8ff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Status Bar Info at Bottom */
  .preview-statusbar {
    height: 28px;
    background: #141518;
    border-top: 1px solid #22242a;
    display: flex;
    align-items: center;
    padding: 0 12px;
    gap: 8px;
    font-size: 11px;
    color: #7a7e85;
    z-index: 10;
  }

  .sb-item {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .sb-label {
    color: #5c6068;
  }

  .sb-val {
    color: #bcbec4;
    font-weight: 500;
  }

  .sb-val.mono {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
  }

  .sb-sep {
    color: #363940;
  }

  .file-path-item {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 320px;
  }
</style>
