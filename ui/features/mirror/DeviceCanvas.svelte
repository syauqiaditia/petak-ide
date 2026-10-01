<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { mirrorStore } from './mirrorStore.svelte';
  import { parseFramePacket, translateCanvasToDevice, splitNals, parseH264Config, nalsToAvcc } from './logic';
  import { drawCanvasMockApp } from './canvasMock';

  let canvasEl: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let decoder: VideoDecoder | null = null;
  let isDecoderConfigured = false;
  let hasDecodedKeyframe = false;
  let pendingFrame: VideoFrame | null = null;
  let rafId = 0;

  // Touch reticle state
  let reticleVisible = $state(false);
  let reticleX = $state(0);
  let reticleY = $state(0);
  let isPointerDown = false;
  let lastMoveTime = 0;

  let isFocused = $derived(mirrorStore.isFocused);
  let deviceWidth = $derived(mirrorStore.deviceWidth);
  let deviceHeight = $derived(mirrorStore.deviceHeight);
  let isViewOnly = $derived(mirrorStore.isViewOnly);

  function initDecoder() {
    isDecoderConfigured = false;
    hasDecodedKeyframe = false;
    if (typeof VideoDecoder === 'undefined') {
      console.warn('[DeviceCanvas] VideoDecoder is not supported in this environment');
      return;
    }

    try {
      decoder = new VideoDecoder({
        output: (frame: VideoFrame) => {
          if (pendingFrame) {
            pendingFrame.close();
          }
          pendingFrame = frame;

          if (!rafId) {
            rafId = requestAnimationFrame(() => {
              rafId = 0;
              const frame = pendingFrame;
              if (!frame) return;
              pendingFrame = null;
              if (!canvasEl || !ctx) {
                frame.close();
                return;
              }
              const w = frame.displayWidth || frame.codedWidth || canvasEl.width;
              const h = frame.displayHeight || frame.codedHeight || canvasEl.height;
              if (canvasEl.width !== w || canvasEl.height !== h) {
                canvasEl.width = w;
                canvasEl.height = h;
              }
              ctx.drawImage(frame, 0, 0, canvasEl.width, canvasEl.height);
              frame.close();
              mirrorStore.recordFrameRendered();
            });
          }
        },
        error: (err: Error) => {
          console.error('[DeviceCanvas] VideoDecoder error:', err);
          mirrorStore.errorMessage = `VideoDecoder error: ${err.message}`;
        },
      });
    } catch (e: any) {
      console.warn('[DeviceCanvas] Failed to create VideoDecoder:', e);
    }
  }

  async function handlePacket(buf: ArrayBuffer) {
    try {
      const { kind, ptsUs, payload } = parseFramePacket(buf);

      if (kind === 0) {
        // Config packet (SPS/PPS)
        if (typeof VideoDecoder !== 'undefined') {
          if (!decoder || decoder.state === 'closed') {
            initDecoder();
          }

          const nals = splitNals(payload);
          const { codec, description } = parseH264Config(nals);

          const config: VideoDecoderConfig = {
            codec,
            optimizeForLatency: true,
            hardwareAcceleration: 'prefer-hardware',
            description: description.buffer,
          };

          try {
            let configToUse = config;
            try {
              const res = await VideoDecoder.isConfigSupported(config);
              if (!res.supported) {
                configToUse = {
                  codec,
                  optimizeForLatency: true,
                  hardwareAcceleration: 'prefer-hardware',
                };
              }
            } catch (_) {
              configToUse = {
                codec,
                optimizeForLatency: true,
                hardwareAcceleration: 'prefer-hardware',
              };
            }

            if (decoder && decoder.state !== 'closed') {
              decoder.configure(configToUse);
              isDecoderConfigured = true;
            }
          } catch (cfgErr) {
            console.warn('[DeviceCanvas] isConfigSupported failed:', cfgErr);
          }
        }
      } else if (kind === 1 || kind === 2) {
        // Frame packet (1 = Keyframe, 2 = Delta)
        if (!isDecoderConfigured && mirrorStore.lastConfigPacket) {
          await handlePacket(mirrorStore.lastConfigPacket);
        }
        if (kind === 2 && !hasDecodedKeyframe && mirrorStore.lastKeyPacket) {
          await handlePacket(mirrorStore.lastKeyPacket);
        }
        if (decoder && decoder.state === 'configured' && isDecoderConfigured) {
          try {
            const avccData = nalsToAvcc(payload);
            const chunk = new EncodedVideoChunk({
              type: kind === 1 ? 'key' : 'delta',
              timestamp: Number(ptsUs),
              data: avccData,
            });
            decoder.decode(chunk);
            if (kind === 1) {
              hasDecodedKeyframe = true;
            }
          } catch (decodeErr) {
            console.warn('[DeviceCanvas] decode error:', decodeErr);
          }
        }
      }
    } catch (e) {
      console.warn('[DeviceCanvas] handlePacket parse error:', e);
    }
  }

  function handlePointerDown(e: PointerEvent) {
    if (isViewOnly) return;
    mirrorStore.isFocused = true;
    isPointerDown = true;
    canvasEl.setPointerCapture?.(e.pointerId);

    const rect = canvasEl.getBoundingClientRect();
    reticleX = e.clientX - rect.left;
    reticleY = e.clientY - rect.top;
    reticleVisible = true;

    const coords = translateCanvasToDevice(e.clientX, e.clientY, rect, deviceWidth, deviceHeight);
    mirrorStore.sendInput({
      t: 'touch',
      action: 'down',
      x: coords.x,
      y: coords.y,
      w: coords.w,
      h: coords.h,
    });
  }

  function handlePointerMove(e: PointerEvent) {
    if (!isPointerDown || isViewOnly) return;

    const rect = canvasEl.getBoundingClientRect();
    reticleX = e.clientX - rect.left;
    reticleY = e.clientY - rect.top;

    const now = performance.now();
    if (now - lastMoveTime < 16) {
      return; // Throttle IPC to 60Hz max
    }
    lastMoveTime = now;

    const coords = translateCanvasToDevice(e.clientX, e.clientY, rect, deviceWidth, deviceHeight);
    mirrorStore.sendInput({
      t: 'touch',
      action: 'move',
      x: coords.x,
      y: coords.y,
      w: coords.w,
      h: coords.h,
    });
  }

  function handlePointerUp(e: PointerEvent) {
    if (!isPointerDown || isViewOnly) return;
    isPointerDown = false;
    reticleVisible = false;
    try {
      canvasEl.releasePointerCapture?.(e.pointerId);
    } catch (_) {}

    const rect = canvasEl.getBoundingClientRect();
    const coords = translateCanvasToDevice(e.clientX, e.clientY, rect, deviceWidth, deviceHeight);
    mirrorStore.sendInput({
      t: 'touch',
      action: 'up',
      x: coords.x,
      y: coords.y,
      w: coords.w,
      h: coords.h,
    });
  }

  function handleWheel(e: WheelEvent) {
    if (isViewOnly) return;
    e.preventDefault();
    const rect = canvasEl.getBoundingClientRect();
    const coords = translateCanvasToDevice(e.clientX, e.clientY, rect, deviceWidth, deviceHeight);
    mirrorStore.sendInput({
      t: 'scroll',
      x: coords.x,
      y: coords.y,
      w: coords.w,
      h: coords.h,
      dx: Math.round(e.deltaX),
      dy: Math.round(e.deltaY),
    });
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (!mirrorStore.isFocused || isViewOnly) return;

    // Shift+Escape or Escape releases focus back to editor
    if (e.key === 'Escape') {
      mirrorStore.isFocused = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // Text forwarding for regular printable characters
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      mirrorStore.sendInput({ t: 'text', text: e.key });
      return;
    }

    // Control keys forwarding
    const specialKeycodes: Record<string, number> = {
      Backspace: 67, // KEYCODE_DEL
      Enter: 66,     // KEYCODE_ENTER
      Tab: 61,       // KEYCODE_TAB
      ArrowLeft: 21, // KEYCODE_DPAD_LEFT
      ArrowRight: 22,// KEYCODE_DPAD_RIGHT
      ArrowUp: 19,   // KEYCODE_DPAD_UP
      ArrowDown: 20, // KEYCODE_DPAD_DOWN
    };

    if (specialKeycodes[e.key]) {
      e.preventDefault();
      const code = specialKeycodes[e.key];
      mirrorStore.sendInput({ t: 'key', keycode: code, action: 'down' });
      setTimeout(() => {
        mirrorStore.sendInput({ t: 'key', keycode: code, action: 'up' });
      }, 30);
    }
  }

  onMount(() => {
    ctx = canvasEl.getContext('2d');
    initDecoder();
    mirrorStore.registerFrameCallback(handlePacket);
    window.addEventListener('keydown', handleKeyDown);

    // Initial canvas render
    if (canvasEl && ctx) {
      canvasEl.width = deviceWidth || 1080;
      canvasEl.height = deviceHeight || 2400;

      const isPreviewEnv =
        typeof window !== 'undefined' &&
        (window.location.search.includes('preview') || !(window as any).__TAURI_INTERNALS__);

      const isInteracted =
        typeof window !== 'undefined' &&
        (window.location.search.includes('interact=after') || window.location.search.includes('after'));

      if (isPreviewEnv) {
        drawCanvasMockApp(ctx, canvasEl.width, canvasEl.height, isViewOnly, isInteracted);
      } else {
        ctx.fillStyle = '#0a0a0c';
        ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
      }
    }
  });

  onDestroy(() => {
    mirrorStore.unregisterFrameCallback();
    window.removeEventListener('keydown', handleKeyDown);
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (pendingFrame) {
      pendingFrame.close();
      pendingFrame = null;
    }
    if (decoder && decoder.state !== 'closed') {
      try {
        decoder.close();
      } catch (_) {}
    }
    decoder = null;
  });
</script>

<div
  class="device-canvas-container"
  class:view-only={isViewOnly}
  role="region"
  aria-label="Device screen display"
>
  <canvas
    bind:this={canvasEl}
    class="device-screen-canvas"
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    onpointercancel={handlePointerUp}
    onwheel={handleWheel}
  ></canvas>

  {#if reticleVisible}
    <div
      class="touch-reticle"
      style:left="{reticleX}px"
      style:top="{reticleY}px"
    ></div>
  {/if}

  {#if isFocused}
    <div class="focus-helper-banner">
      Keys forwarded to device · ⇧Esc to release
    </div>
  {/if}
</div>

<style>
  .device-canvas-container {
    width: 100%;
    height: 100%;
    position: relative;
    overflow: hidden;
    background: #000000;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: default;
    border-radius: 20px;
  }
  .device-canvas-container:not(.view-only) {
    cursor: crosshair;
  }
  .device-canvas-container.view-only {
    cursor: default;
  }
  .device-screen-canvas {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
  }
  .touch-reticle {
    position: absolute;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid rgba(110, 168, 255, 0.9);
    background: rgba(110, 168, 255, 0.25);
    box-shadow: 0 0 12px rgba(110, 168, 255, 0.4);
    transform: translate(-50%, -50%);
    pointer-events: none;
    z-index: 25;
    animation: pulseReticle 0.15s ease-out;
  }
  @keyframes pulseReticle {
    from {
      transform: translate(-50%, -50%) scale(0.6);
      opacity: 0.5;
    }
    to {
      transform: translate(-50%, -50%) scale(1);
      opacity: 1;
    }
  }
  .focus-helper-banner {
    position: absolute;
    bottom: 8px;
    left: 50%;
    transform: translateX(-50%);
    padding: 3px 10px;
    border-radius: 10px;
    background: rgba(17, 18, 21, 0.9);
    border: 1px solid #3a4f75;
    font-size: 10px;
    color: #9cc3ff;
    white-space: nowrap;
    user-select: none;
    -webkit-user-select: none;
    pointer-events: none;
    z-index: 25;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
  }
</style>
