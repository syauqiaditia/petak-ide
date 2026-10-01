<script lang="ts">
  import { mirrorStore } from './mirrorStore.svelte';
  import DeviceToolbarTop from './DeviceToolbarTop.svelte';
  import DeviceStage from './DeviceStage.svelte';
  import DeviceToolbarBottom from './DeviceToolbarBottom.svelte';

  let {
    onSelectDevice,
    onOpenLogcat,
  }: {
    onSelectDevice?: () => void;
    onOpenLogcat?: () => void;
  } = $props();

  let panelWidth = $derived(mirrorStore.width);
  let toastMsg = $derived(mirrorStore.screenshotToast);

  let isDragging = $state(false);
  let startX = 0;
  let startW = 0;

  function handleResizeStart(e: MouseEvent) {
    e.preventDefault();
    isDragging = true;
    startX = e.clientX;
    startW = mirrorStore.width;

    function handleMouseMove(ev: MouseEvent) {
      const deltaX = startX - ev.clientX; // Dragging left increases width
      let newW = startW + deltaX;

      // Shift-snap: snap to standard widths
      if (ev.shiftKey) {
        if (Math.abs(newW - 380) < 25) newW = 380;
        else if (Math.abs(newW - 320) < 25) newW = 320;
        else if (Math.abs(newW - 480) < 25) newW = 480;
      }

      mirrorStore.setWidth(newW);
    }

    function handleMouseUp() {
      isDragging = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }
</script>

<aside
  class="device-mirror-panel"
  style:width="{panelWidth}px"
  aria-label="Device Mirror Panel"
>
  <!-- Resize Handle on Left Edge -->
  <button
    type="button"
    class="resize-handle-left"
    class:active={isDragging}
    onmousedown={handleResizeStart}
    aria-label="Resize Device Mirror Panel"
    onkeydown={(e) => {
      if (e.key === 'ArrowLeft') {
        mirrorStore.setWidth(panelWidth + 10);
      } else if (e.key === 'ArrowRight') {
        mirrorStore.setWidth(panelWidth - 10);
      }
    }}
  ></button>

  <!-- Drag overlay to prevent event hijacking during drag -->
  {#if isDragging}
    <div class="drag-shield"></div>
  {/if}

  <!-- Top Toolbar (Only when NOT in picker or empty mode) -->
  {#if mirrorStore.status !== 'picker' && mirrorStore.status !== 'empty'}
    <DeviceToolbarTop />
  {/if}

  <!-- Center Stage (Bezel + Screen / States) -->
  <DeviceStage {onSelectDevice} {onOpenLogcat} />

  <!-- Bottom Toolbar (Android Nav / iOS Home bar - only when live, view-only, or active stream) -->
  {#if mirrorStore.status === 'live' || mirrorStore.status === 'view-only' || mirrorStore.status === 'disconnected'}
    <DeviceToolbarBottom />
  {/if}

  <!-- Screenshot / Action Toast -->
  {#if toastMsg}
    <div class="toast-popup" role="status">
      {toastMsg}
    </div>
  {/if}
</aside>

<style>
  .device-mirror-panel {
    height: 100%;
    flex-shrink: 0;
    background: #141518;
    border-left: 1px solid #26282d;
    display: flex;
    flex-direction: column;
    position: relative;
    user-select: none;
    -webkit-user-select: none;
    overflow: hidden;
    z-index: 5;
  }
  .resize-handle-left {
    position: absolute;
    top: 0;
    left: -2px;
    width: 6px;
    height: 100%;
    cursor: col-resize;
    z-index: 20;
    transition: background 0.15s;
    background: transparent;
  }
  .resize-handle-left:hover,
  .resize-handle-left.active {
    background: #6ea8ff;
  }
  .drag-shield {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    cursor: col-resize;
    z-index: 9999;
  }
  .toast-popup {
    position: absolute;
    bottom: 48px;
    left: 50%;
    transform: translateX(-50%);
    padding: 6px 14px;
    border-radius: 8px;
    background: #1f2a3d;
    border: 1px solid #3a4f75;
    color: #e6efff;
    font-size: 11px;
    font-weight: 500;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6);
    pointer-events: none;
    z-index: 50;
    white-space: nowrap;
    animation: fadeInToast 0.2s ease-out;
  }
  @keyframes fadeInToast {
    from {
      opacity: 0;
      transform: translate(-50%, 6px);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }
</style>
