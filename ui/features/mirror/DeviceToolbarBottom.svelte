<script lang="ts">
  import { mirrorStore } from './mirrorStore.svelte';

  let isViewOnly = $derived(mirrorStore.isViewOnly);
</script>

<div class="device-toolbar-bottom">
  {#if isViewOnly}
    <!-- Native iOS home indicator indicator line -->
    <div class="ios-home-indicator"></div>
  {:else}
    <button
      class="nav-btn"
      title="Back (Android Back key)"
      aria-label="Android Back button"
      onclick={() => mirrorStore.sendNav('back')}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M15 18l-6-6 6-6"></path>
      </svg>
    </button>

    <button
      class="nav-btn"
      title="Home (Android Home key)"
      aria-label="Android Home button"
      onclick={() => mirrorStore.sendNav('home')}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="7"></circle>
      </svg>
    </button>

    <button
      class="nav-btn"
      title="Recents / Overview (Android Recents key)"
      aria-label="Android Recents button"
      onclick={() => mirrorStore.sendNav('recents')}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="6" y="6" width="12" height="12" rx="2"></rect>
      </svg>
    </button>

    <div class="v-divider"></div>

    <button
      class="nav-btn"
      title="Volume Down"
      aria-label="Volume Down button"
      onclick={() => mirrorStore.sendNav('voldown')}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
      </svg>
    </button>

    <button
      class="nav-btn"
      title="Volume Up"
      aria-label="Volume Up button"
      onclick={() => mirrorStore.sendNav('volup')}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
      </svg>
    </button>

    <button
      class="nav-btn"
      title="Power"
      aria-label="Power button"
      onclick={() => mirrorStore.sendNav('power')}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10"></path>
      </svg>
    </button>
  {/if}
</div>

<style>
  .device-toolbar-bottom {
    height: 40px;
    flex-shrink: 0;
    background: #141518;
    border-top: 1px solid #26282d;
    display: flex;
    align-items: center;
    justify-content: space-around;
    padding: 0 16px;
    user-select: none;
    -webkit-user-select: none;
  }
  .nav-btn {
    width: 32px;
    height: 32px;
    border-radius: 6px;
    color: #8b8f98;
    background: transparent;
    border: none;
    cursor: pointer;
    display: grid;
    place-items: center;
    transition: background 0.1s, color 0.1s;
  }
  .nav-btn:hover {
    background: #23252b;
    color: #e6e7ea;
  }
  .v-divider {
    width: 1px;
    height: 16px;
    background: #2c2e34;
  }
  .ios-home-indicator {
    width: 120px;
    height: 4px;
    background: #3a3c42;
    border-radius: 2px;
    margin: 0 auto;
  }
</style>
