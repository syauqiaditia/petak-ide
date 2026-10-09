<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { mirrorStore } from './mirrorStore.svelte';
  import { api } from '../../lib/api';
  import { parseFramePacket, translateCanvasToDevice, splitNals, parseH264Config, nalsToAvcc } from './logic';
  import { drawCanvasMockApp } from './canvasMock';

  let canvasEl: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let decoder: VideoDecoder | null = null;
  let isDecoderConfigured = false;
  let lastConfigSignature = '';
  let hasDecodedKeyframe = false;
  let pendingFrame: VideoFrame | null = null;
  let rafId = 0;

  // Touch state
  let isPointerDown = false;
  let lastMoveTime = 0;

  let isFocused = $derived(mirrorStore.isFocused);
  let deviceWidth = $derived(mirrorStore.deviceWidth);
  let deviceHeight = $derived(mirrorStore.deviceHeight);
  let isViewOnly = $derived(mirrorStore.isViewOnly);

  function initDecoder() {
    isDecoderConfigured = false;
    lastConfigSignature = '';
    hasDecodedKeyframe = false;
    if (typeof VideoDecoder === 'undefined') {
      console.warn('[DeviceCanvas] VideoDecoder is not supported in this environment');
      return;
    }

    try {
      decoder = new VideoDecoder({
        output: (frame: VideoFrame) => {
          if (!canvasEl || !ctx) {
            frame.close();
            return;
          }
          const rawW = frame.displayWidth || frame.codedWidth || canvasEl.width;
          const rawH = frame.displayHeight || frame.codedHeight || canvasEl.height;

          // Detect iOS Simulator window capture that includes macOS window titlebar & outer bezel
          const isIosSim =
            !mirrorStore.isViewOnly &&
            (mirrorStore.selectedDevice?.platform === 'ios' ||
             mirrorStore.selectedDevice?.kind === 'emulator' ||
             mirrorStore.serial?.includes('-') ||
             (rawW === 456 && rawH === 972) ||
             (rawW >= 350 && rawH >= 700 && rawH > rawW * 1.8 && rawW <= 550));

          let sx = 0, sy = 0, sw = rawW, sh = rawH;
          let targetW = rawW, targetH = rawH;

          if (isIosSim) {
            // Cut out macOS titlebar (54pt) + top bezel (25pt) = 79pt
            // Cut out bottom bezel (19pt)
            // Cut out left & right bezels (27pt each)
            const leftInset = 27;
            const topInset = 79;
            const rightInset = 27;
            const bottomInset = 19;

            sx = leftInset;
            sy = topInset;
            sw = Math.max(10, rawW - (leftInset + rightInset));
            sh = Math.max(10, rawH - (topInset + bottomInset));

            targetW = sw;
            targetH = sh;
          }

          if (canvasEl.width !== targetW || canvasEl.height !== targetH) {
            canvasEl.width = targetW;
            canvasEl.height = targetH;
            mirrorStore.deviceWidth = targetW;
            mirrorStore.deviceHeight = targetH;
          }

          ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, targetW, targetH);
          frame.close();
          mirrorStore.recordFrameRendered();
        },
        error: (err: Error) => {
          console.error('[DeviceCanvas] VideoDecoder error:', err);
          api.mirrorLog('UI-DECODER-ERR', err.message);
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

          const configSig = `${codec}:${Array.from(description).join(',')}`;
          if (isDecoderConfigured && decoder && decoder.state === 'configured' && lastConfigSignature === configSig) {
            return;
          }

          const config: VideoDecoderConfig = {
            codec,
            optimizeForLatency: true,
            hardwareAcceleration: 'prefer-hardware',
            description: description.buffer,
          };

          try {
            decoder.configure(config);
            isDecoderConfigured = true;
            lastConfigSignature = configSig;
            api.mirrorLog('UI-CONFIG-OK', `Configured with ${codec}`);
          } catch (e: any) {
            try {
              decoder.configure({
                codec,
                optimizeForLatency: true,
                hardwareAcceleration: 'prefer-hardware',
              });
              isDecoderConfigured = true;
              lastConfigSignature = configSig;
              api.mirrorLog('UI-CONFIG-FALLBACK', `Fallback configured with ${codec}`);
            } catch (err2: any) {
              console.warn('[DeviceCanvas] decoder.configure failed:', err2);
              api.mirrorLog('UI-CONFIG-ERR', err2.message);
            }
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

  function handleMouseDown(e: MouseEvent) {
    api.mirrorLog('UI-MOUSE-DOWN', `target=${(e.target as HTMLElement)?.tagName} isViewOnly=${isViewOnly} client=(${e.clientX},${e.clientY})`);
    if (isViewOnly) return;
    mirrorStore.isFocused = true;
    isPointerDown = true;

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    const rect = canvasEl.getBoundingClientRect();

    const vWidth = canvasEl.width || deviceWidth || 800;
    const vHeight = canvasEl.height || deviceHeight || 800;
    const coords = translateCanvasToDevice(e.clientX, e.clientY, rect, vWidth, vHeight);
    api.mirrorLog('UI-TOUCH', `Down client=(${e.clientX},${e.clientY}) coords=(${coords.x},${coords.y}) vSize=${vWidth}x${vHeight}`);
    mirrorStore.sendInput({
      t: 'touch',
      action: 'down',
      x: coords.x,
      y: coords.y,
      w: coords.w,
      h: coords.h,
    });
  }

  function handleMouseMove(e: MouseEvent) {
    if (!isPointerDown || isViewOnly) return;

    const rect = canvasEl.getBoundingClientRect();

    const now = performance.now();
    if (now - lastMoveTime < 8) {
      return; // Throttle IPC to 120Hz polling
    }
    lastMoveTime = now;

    const vWidth = canvasEl.width || deviceWidth || 800;
    const vHeight = canvasEl.height || deviceHeight || 800;
    const coords = translateCanvasToDevice(e.clientX, e.clientY, rect, vWidth, vHeight);
    api.mirrorLog('UI-TOUCH', `Move client=(${e.clientX},${e.clientY}) coords=(${coords.x},${coords.y}) vSize=${vWidth}x${vHeight}`);
    mirrorStore.sendInput({
      t: 'touch',
      action: 'move',
      x: coords.x,
      y: coords.y,
      w: coords.w,
      h: coords.h,
    });
  }

  function handleMouseUp(e: MouseEvent) {
    if (!isPointerDown || isViewOnly) return;
    isPointerDown = false;

    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);

    const rect = canvasEl.getBoundingClientRect();
    const vWidth = canvasEl.width || deviceWidth || 800;
    const vHeight = canvasEl.height || deviceHeight || 800;
    const coords = translateCanvasToDevice(e.clientX, e.clientY, rect, vWidth, vHeight);
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
    const vWidth = canvasEl.width || deviceWidth || 800;
    const vHeight = canvasEl.height || deviceHeight || 800;
    const coords = translateCanvasToDevice(e.clientX, e.clientY, rect, vWidth, vHeight);

    // Invert delta for natural Android scroll direction and clamp to [-16, 16]
    const dx = Math.max(-16, Math.min(16, -e.deltaX / 10));
    const dy = Math.max(-16, Math.min(16, -e.deltaY / 10));

    mirrorStore.sendInput({
      t: 'scroll',
      x: coords.x,
      y: coords.y,
      w: coords.w,
      h: coords.h,
      dx,
      dy,
    });
  }

  function handleGlobalMouseDown(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    if (!target?.closest('.phone-bezel')) {
      mirrorStore.isFocused = false;
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    const activeEl = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target?.isContentEditable ||
      target?.closest('.cm-editor') ||
      target?.closest('.search-palette') ||
      target?.closest('.modal-backdrop') ||
      target?.closest('.terminal-container') ||
      target?.closest('.run-output-panel') ||
      activeEl instanceof HTMLInputElement ||
      activeEl instanceof HTMLTextAreaElement ||
      activeEl?.isContentEditable ||
      activeEl?.closest('.cm-editor') ||
      activeEl?.closest('.search-palette') ||
      activeEl?.closest('.modal-backdrop') ||
      activeEl?.closest('.terminal-container') ||
      activeEl?.closest('.run-output-panel')
    ) {
      mirrorStore.isFocused = false;
      return;
    }

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
    ctx = canvasEl.getContext('2d', { alpha: false, desynchronized: true });
    initDecoder();
    mirrorStore.registerFrameCallback(handlePacket);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handleGlobalMouseDown, true);

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
    window.removeEventListener('mousedown', handleGlobalMouseDown, true);
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
    if (decoder && decoder.state !== 'closed') {
      try {
        decoder.close();
      } catch (_) {}
    }
    decoder = null;
    isDecoderConfigured = false;
    lastConfigSignature = '';
  });
</script>

<div
  class="device-canvas-container"
  class:view-only={isViewOnly}
  role="region"
  aria-label="Device screen display"
  onmousedown={handleMouseDown}
  onwheel={handleWheel}
  oncontextmenu={(e) => e.preventDefault()}
>
  <canvas
    bind:this={canvasEl}
    class="device-screen-canvas"
  ></canvas>


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

</style>
