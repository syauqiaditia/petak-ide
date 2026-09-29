<script lang="ts">
  import { mirrorStore } from './mirrorStore.svelte';

  let fps = $derived(mirrorStore.fps);
  let latency = $derived(mirrorStore.latencyMs);

  let fpsColor = $derived(
    fps >= 45 ? '#7fc98f' : fps >= 20 ? '#e8b45a' : '#f07a74'
  );
</script>

<div class="screen-hud-pill">
  <span style:color={fpsColor}>{fps} FPS</span>
  <span class="latency">
    {latency !== null ? `${latency} ms` : '— ms'}
  </span>
</div>

<style>
  .screen-hud-pill {
    position: absolute;
    top: 28px;
    right: 12px;
    height: 22px;
    padding: 0 8px;
    border-radius: 11px;
    background: rgba(17, 18, 21, 0.85);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    border: 1px solid rgba(44, 46, 52, 0.8);
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    z-index: 15;
    user-select: none;
    -webkit-user-select: none;
    pointer-events: none;
  }
  .latency {
    color: #8b8f98;
  }
</style>
