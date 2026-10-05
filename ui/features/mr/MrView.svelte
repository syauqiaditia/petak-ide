<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { mrStore } from './mr.svelte';
  import MrList from './MrList.svelte';
  import MrDetail from './MrDetail.svelte';
  import MrCreateModal from './MrCreateModal.svelte';

  let { folderPath = '' } = $props<{ folderPath?: string }>();
  let isCreateModalOpen = $state(false);

  onMount(() => {
    if (folderPath) {
      mrStore.init(folderPath);
    }
  });

  onDestroy(() => {
    mrStore.destroy();
  });

  $effect(() => {
    if (folderPath && folderPath !== mrStore.currentFolderPath) {
      mrStore.init(folderPath);
    }
  });
</script>

<div class="mr-view-root">
  <!-- Left Column: List -->
  <MrList
    mergeRequests={mrStore.filteredList}
    activeFilter={mrStore.activeFilter}
    selectedIid={mrStore.selectedIid}
    searchQuery={mrStore.searchQuery}
    isLoading={mrStore.isLoadingList}
    tokenScope={mrStore.tokenScope}
    isDemoMode={mrStore.isDemoMode}
    onSelectFilter={(f) => (mrStore.activeFilter = f)}
    onSelectMr={(iid) => mrStore.selectMr(iid)}
    onSearchChange={(q) => (mrStore.searchQuery = q)}
    onRefresh={() => mrStore.loadList(true)}
    onEnableDemoMode={() => mrStore.enableDemoMode()}
    onCreateMr={() => (isCreateModalOpen = true)}
  />

  <!-- Right Column: Detail -->
  <div class="mr-detail-wrapper">
    {#if mrStore.selectedMrDetail}
      <MrDetail
        mrDetail={mrStore.selectedMrDetail}
        diffFiles={mrStore.diffFiles}
        discussions={mrStore.discussions}
        pipelines={mrStore.pipelines}
        approvals={mrStore.approvals}
        tokenScope={mrStore.tokenScope}
        isMerging={mrStore.isMerging}
        onCheckoutBranch={(iid) => mrStore.checkoutMr(iid)}
        onRefresh={() => mrStore.selectedIid && mrStore.selectMr(mrStore.selectedIid)}
        onAddNote={(discId, body) => mrStore.selectedIid ? mrStore.replyDiscussion(mrStore.selectedIid, discId, body) : Promise.resolve()}
        onResolveDiscussion={(discId, res) => mrStore.selectedIid ? mrStore.resolveDiscussion(mrStore.selectedIid, discId, res) : Promise.resolve()}
        onCreateNewThread={(body) => mrStore.selectedIid ? mrStore.createNote(mrStore.selectedIid, body) : Promise.resolve()}
        onApprove={() => mrStore.selectedIid ? mrStore.approve(mrStore.selectedIid) : Promise.resolve()}
        onUnapprove={() => mrStore.selectedIid ? mrStore.unapprove(mrStore.selectedIid) : Promise.resolve()}
        onExecuteMerge={(params) => mrStore.selectedIid ? mrStore.merge(mrStore.selectedIid, params) : Promise.resolve()}
        onRebase={() => mrStore.selectedIid ? mrStore.rebase(mrStore.selectedIid) : Promise.resolve()}
      />
    {:else}
      <div class="no-mr-selected">
        <div class="placeholder-icon">🔀</div>
        <div class="placeholder-title">Pilih Merge Request</div>
        <div class="placeholder-desc">
          Pilih salah satu Merge Request dari daftar di sebelah kiri untuk melihat deskripsi, perubahan berkas, dan diskusi ulasan.
        </div>
      </div>
    {/if}
  </div>
</div>

<MrCreateModal
  open={isCreateModalOpen}
  currentBranch="feat/phase4-run"
  onClose={() => (isCreateModalOpen = false)}
  onSubmit={async (params) => {
    await mrStore.createMr(params);
  }}
/>

<style>
  .mr-view-root {
    display: flex;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #16171a;
  }

  .mr-detail-wrapper {
    flex: 1;
    height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: #16171a;
  }

  .no-mr-selected {
    margin: auto;
    text-align: center;
    padding: 40px;
    max-width: 360px;
    color: #8b949e;
  }

  .placeholder-icon {
    font-size: 36px;
    margin-bottom: 12px;
  }

  .placeholder-title {
    font-size: 15px;
    font-weight: 600;
    color: #c9cdd4;
    margin-bottom: 6px;
  }

  .placeholder-desc {
    font-size: 12px;
    line-height: 1.5;
  }
</style>
