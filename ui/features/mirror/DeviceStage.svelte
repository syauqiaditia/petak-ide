<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { mirrorStore } from './mirrorStore.svelte';
  import { calculateViewportFit } from './logic';
  import DeviceCanvas from './DeviceCanvas.svelte';
  import DeviceHud from './DeviceHud.svelte';
  import StateEmpty from './states/StateEmpty.svelte';
  import StateConnecting from './states/StateConnecting.svelte';
  import StateDisconnected from './states/StateDisconnected.svelte';
  import StateError from './states/StateError.svelte';
  import DevicePickerView from './DevicePickerView.svelte';

  let {
    onSelectDevice,
    onOpenLogcat,
  }: {
    onSelectDevice?: () => void;
    onOpenLogcat?: () => void;
  } = $props();

  let stageEl: HTMLDivElement;
  let stageWidth = $state(380);
  let stageHeight = $state(746);

  let status = $derived(mirrorStore.status);
  let isFocused = $derived(mirrorStore.isFocused);
  let deviceWidth = $derived(mirrorStore.deviceWidth || 1080);
  let deviceHeight = $derived(mirrorStore.deviceHeight || 2400);

  let fit = $derived(
    calculateViewportFit(stageWidth, stageHeight, deviceWidth, deviceHeight)
  );

  let resizeObserver: ResizeObserver | null = null;

  onMount(() => {
    if (stageEl) {
      stageWidth = stageEl.clientWidth || 380;
      stageHeight = stageEl.clientHeight || 746;

      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.contentRect) {
            stageWidth = entry.contentRect.width;
            stageHeight = entry.contentRect.height;
          }
        }
      });
      resizeObserver.observe(stageEl);
    }
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
    resizeObserver = null;
  });
</script>

<div class="device-stage" bind:this={stageEl}>
  {#if status === 'empty' || status === 'picker'}
    <DevicePickerView />
  {:else if status === 'connecting'}
    <StateConnecting />
  {:else if status === 'error'}
    <StateError {onOpenLogcat} />
  {:else}
    <!-- Status is live, view-only, or disconnected -->
    {#if status === 'disconnected'}
      <StateDisconnected />
    {/if}

    {#if status === 'view-only'}
      <div class="viewonly-notice" role="status">
        Interactive touch and keyboard forwarding are restricted on iOS. Stream is display-only.
      </div>
    {/if}

    <div
      class="phone-bezel"
      class:focused={isFocused}
      class:dimmed={status === 'disconnected'}
      style:width="{fit.bezelWidth}px"
      style:height="{fit.bezelHeight}px"
    >
      <div class="camera-punch"></div>

      <div class="phone-screen" style:width="{fit.screenWidth}px" style:height="{fit.screenHeight}px">
        <DeviceHud />
        <DeviceCanvas />
      </div>
    </div>
  {/if}
</div>

<style>
  .device-stage {
    flex: 1;
    min-height: 0;
    background: #16171a;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 16px;
    position: relative;
    overflow: hidden;
  }
  .phone-bezel {
    background: #111215;
    border: 1px solid #2c2e34;
    border-radius: 28px;
    padding: 10px 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    position: relative;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.65);
    transition: border-color 0.15s, box-shadow 0.15s, filter 0.2s, opacity 0.2s;
  }
  .phone-bezel.focused {
    border-color: #3a4f75;
    box-shadow: 0 0 0 1px #3a4f75, 0 16px 40px rgba(0, 0, 0, 0.75);
  }
  .phone-bezel.dimmed {
    opacity: 0.35;
    filter: grayscale(80%);
    pointer-events: none;
  }
  .camera-punch {
    position: absolute;
    top: 14px;
    left: 50%;
    transform: translateX(-50%);
    width: 8px;
    height: 8px;
    background: #1a1b1f;
    border-radius: 50%;
    z-index: 20;
    pointer-events: none;
  }
  .phone-screen {
    background: #000000;
    border-radius: 20px;
    overflow: hidden;
    position: relative;
    display: flex;
    flex-direction: column;
  }
  .viewonly-notice {
    position: absolute;
    top: 8px;
    left: 12px;
    right: 12px;
    padding: 6px 10px;
    border-radius: 6px;
    background: #2e2717;
    border: 1px solid #4a3d22;
    color: #e8b45a;
    font-size: 11px;
    line-height: 15px;
    text-align: center;
    z-index: 25;
  }
</style>
