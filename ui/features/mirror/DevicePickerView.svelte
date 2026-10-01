<script lang="ts">
  import { runStore } from '../run/runStore.svelte';
  import { mirrorStore } from './mirrorStore.svelte';
  import { settingsStore } from '../settings/settingsStore.svelte';
  import { dedupeAndCategorizeDevices, type MirrorDeviceCard } from './pickerLogic';

  let autoMirrorNext = $state(
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('petak.mirror.auto_single') === 'true'
      : false
  );

  function toggleAutoMirror(val: boolean) {
    autoMirrorNext = val;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('petak.mirror.auto_single', String(val));
    }
  }

  let cards = $derived<MirrorDeviceCard[]>(
    dedupeAndCategorizeDevices(runStore.devices, runStore.emulators)
  );

  function handleSelect(card: MirrorDeviceCard) {
    if (!card.canMirror) return;
    mirrorStore.start(card.id);
  }
</script>

<div class="picker-container">
  <div class="picker-header">
    <div class="title-wrap">
      <span class="picker-title">PILIH DEVICE UNTUK MIRROR</span>
      <span class="picker-sub">Pilih perangkat target yang ingin dimirror</span>
    </div>
  </div>

  <div class="cards-list">
    {#if cards.length === 0}
      <div class="empty-state">
        <div class="empty-icon">📱</div>
        <div class="empty-text">Tidak ada device atau simulator terdeteksi</div>
        <button class="btn-refresh" onclick={() => runStore.refreshDevices()}>
          Pindai Ulang Device
        </button>
      </div>
    {:else}
      {#each cards as card (card.id)}
        <div
          class="device-card"
          class:disabled={!card.canMirror}
          onclick={() => handleSelect(card)}
          role="button"
          tabindex={card.canMirror ? 0 : -1}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleSelect(card);
            }
          }}
        >
          <div class="card-left">
            <div class="device-info-row">
              <span class="device-icon">
                {#if card.category === 'android-emulator'}
                  🤖
                {:else if card.category === 'android-usb'}
                  📱
                {:else if card.category === 'ios-simulator'}
                  🍎
                {:else}
                  🍏
                {/if}
              </span>
              <span class="device-name" title={card.name}>{card.name}</span>
            </div>

            <div class="badges-row">
              <span class="badge transport" class:usb={card.isUsb} class:wifi={!card.isUsb && card.transportBadge === 'Wi-Fi'}>
                {card.transportBadge}
              </span>
              <span class="badge status" class:ready={card.canMirror} class:not-ready={!card.canMirror}>
                {card.statusText}
              </span>
            </div>

            {#if card.disabledReason}
              <div class="reason-text">{card.disabledReason}</div>
            {/if}
          </div>

          <div class="card-right">
            <button
              class="btn-mirror"
              disabled={!card.canMirror}
              onclick={(e) => {
                e.stopPropagation();
                handleSelect(card);
              }}
              title={card.canMirror ? `Mulai mirror ${card.name}` : card.disabledReason}
            >
              Mirror
            </button>
          </div>
        </div>
      {/each}
    {/if}
  </div>

  <div class="picker-footer">
    <label class="auto-mirror-toggle">
      <input
        type="checkbox"
        checked={autoMirrorNext}
        onchange={(e) => toggleAutoMirror((e.target as HTMLInputElement).checked)}
      />
      <span>Mirror otomatis berikutnya jika hanya 1 device</span>
    </label>
  </div>
</div>

<style>
  .picker-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    background: #121316;
    color: #e0e2e8;
    overflow-y: auto;
  }
  .picker-header {
    padding: 16px;
    border-bottom: 1px solid #202227;
    background: #16171b;
  }
  .picker-title {
    font-size: 11px;
    font-weight: 700;
    color: #8b8f98;
    letter-spacing: 0.05em;
    display: block;
  }
  .picker-sub {
    font-size: 12px;
    color: #5c606b;
    margin-top: 3px;
    display: block;
  }
  .cards-list {
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    flex: 1;
  }
  .device-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
    background: #18191d;
    border: 1px solid #252830;
    border-radius: 8px;
    transition: all 0.15s ease;
  }
  .device-card:hover:not(.disabled) {
    border-color: #3b5998;
    background: #1c1e24;
  }
  .device-card.disabled {
    opacity: 0.55;
    background: #151619;
    border-color: #202227;
  }
  .card-left {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
    min-width: 0;
  }
  .device-info-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .device-icon {
    font-size: 16px;
  }
  .device-name {
    font-size: 13px;
    font-weight: 600;
    color: #e6e7ec;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .badges-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .badge {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: 600;
  }
  .badge.transport.usb {
    background: #1f3325;
    color: #7fc98f;
    border: 1px solid #2d4f37;
  }
  .badge.transport.wifi {
    background: #2a2c35;
    color: #9da1ab;
    border: 1px solid #3d414d;
  }
  .badge.status.ready {
    background: #18283f;
    color: #6ea8ff;
    border: 1px solid #26426d;
  }
  .badge.status.not-ready {
    background: #281d1e;
    color: #f07a74;
    border: 1px solid #482c2e;
  }
  .reason-text {
    font-size: 11px;
    color: #8b8f98;
    font-style: italic;
  }
  .card-right {
    margin-left: 12px;
  }
  .btn-mirror {
    padding: 6px 14px;
    border-radius: 6px;
    background: #284c8a;
    border: 1px solid #3c6dbd;
    color: #ffffff;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }
  .btn-mirror:hover:not(:disabled) {
    background: #335da8;
  }
  .btn-mirror:disabled {
    background: #202228;
    border-color: #2b2e37;
    color: #555861;
    cursor: not-allowed;
  }
  .picker-footer {
    padding: 12px 16px;
    border-top: 1px solid #202227;
    background: #16171b;
  }
  .auto-mirror-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11.5px;
    color: #8b8f98;
    cursor: pointer;
    user-select: none;
  }
  .auto-mirror-toggle input {
    accent-color: #4370ba;
  }
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 16px;
    text-align: center;
    gap: 10px;
  }
  .empty-icon {
    font-size: 32px;
  }
  .empty-text {
    font-size: 12px;
    color: #727680;
  }
  .btn-refresh {
    background: #20232b;
    border: 1px solid #2c313d;
    padding: 6px 12px;
    border-radius: 6px;
    color: #8ea8db;
    font-size: 11px;
    cursor: pointer;
  }
</style>
