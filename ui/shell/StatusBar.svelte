<script lang="ts">
  let {
    branchName = '',
    statusText = 'Ready',
    isBench = false,
    fileType = 'Kotlin',
    cursorInfo = 'Ln 1, Col 1',
  } = $props<{
    branchName?: string | null;
    statusText?: string;
    isBench?: boolean;
    fileType?: string;
    cursorInfo?: string;
  }>();
</script>

<div class="status-bar">
  {#if branchName}
    <span class="branch-tag">{branchName}</span>
  {/if}
  <span class="status-indicator">
    <span class="dot"></span>
    {statusText}
  </span>
  {#if isBench}
    <span class="bench-badge">⚡ BENCH RUNNING</span>
  {/if}

  <div class="spacer"></div>

  <span>{cursorInfo}</span>
  <span>UTF-8</span>
  <span class="vim-tag">VIM</span>
  <span>{fileType}</span>
</div>

<style>
  .status-bar {
    height: 26px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 0 14px;
    background: #111215;
    border-top: 1px solid #26282d;
    font-size: 12px;
    color: #8b8f98;
    user-select: none;
    -webkit-user-select: none;
  }
  .branch-tag {
    color: #b9bcc3;
  }
  .status-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #7fc98f;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 3px;
    background: #7fc98f;
  }
  .bench-badge {
    background: #3a2e1a;
    color: #e8b45a;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
  }
  .spacer {
    flex-grow: 1;
  }
  .vim-tag {
    background: #23252b;
    color: #9cc3ff;
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 600;
  }
</style>
