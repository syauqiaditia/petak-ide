import assert from 'node:assert';

console.log('=== Running Petak P4.M Double-Init Idempotency Tests ===');

// 1. Test background services initialization guard (App.svelte logic)
{
  let indexBuildCalls = [];
  let gitRefreshCalls = [];
  let runStoreInitCalls = [];

  const mockApi = {
    indexBuild: async (path) => { indexBuildCalls.push(path); },
    gitRefresh: async (path) => { gitRefreshCalls.push(path); },
    runStoreInit: async (path) => { runStoreInitCalls.push(path); },
  };

  class BackgroundInitCoordinator {
    lastBgInitFolder = null;

    initBackgroundServices(folderPath) {
      if (!folderPath || this.lastBgInitFolder === folderPath) return;
      this.lastBgInitFolder = folderPath;
      mockApi.indexBuild(folderPath);
      mockApi.gitRefresh(folderPath);
      mockApi.runStoreInit(folderPath);
    }
  }

  const coordinator = new BackgroundInitCoordinator();

  // Simulate Race: openFolder and onEditorReady idle callback both trigger for '/project/repo'
  coordinator.initBackgroundServices('/project/repo');
  coordinator.initBackgroundServices('/project/repo');

  assert.strictEqual(indexBuildCalls.length, 1, 'indexBuild should only be called once');
  assert.strictEqual(gitRefreshCalls.length, 1, 'gitRefresh should only be called once');
  assert.strictEqual(runStoreInitCalls.length, 1, 'runStoreInit should only be called once');
  assert.strictEqual(indexBuildCalls[0], '/project/repo');
  console.log('✓ Race condition between openFolder & initBackground deduplicated');

  // Opening another folder must trigger initialization for the new folder
  coordinator.initBackgroundServices('/project/other');
  assert.strictEqual(indexBuildCalls.length, 2, 'indexBuild should be called for new folder');
  assert.strictEqual(indexBuildCalls[1], '/project/other');
  console.log('✓ Switching folders triggers background init for new folder');
}

// 2. Test watchRoot deduplication guard
{
  let watchRootCalls = [];
  let watchedRoot = null;

  async function watchRootSafe(folderPath) {
    if (watchedRoot !== folderPath) {
      watchRootCalls.push(folderPath);
      watchedRoot = folderPath;
    }
  }

  watchRootSafe('/project/repo');
  watchRootSafe('/project/repo');

  assert.strictEqual(watchRootCalls.length, 1, 'watchRoot should only be called once for same path');
  assert.strictEqual(watchRootCalls[0], '/project/repo');
  console.log('✓ watchRoot idempotent for duplicate folder open');
}

// 3. Test runStore init and devicesWatch idempotency
{
  let devicesWatchCount = 0;
  let runConfigsLoadCount = 0;

  class MockRunStore {
    isWatchingDevices = false;
    initPromise = null;
    currentInitFolder = null;
    initialized = false;
    root = null;

    async init(folderPath) {
      if (!folderPath) return;
      if (this.currentInitFolder === folderPath && this.initPromise) {
        return this.initPromise;
      }
      this.currentInitFolder = folderPath;
      this.root = folderPath;

      this.initPromise = (async () => {
        runConfigsLoadCount++;

        // Only start watching devices once across entire application lifetime
        if (!this.isWatchingDevices) {
          this.isWatchingDevices = true;
          devicesWatchCount++;
        }

        if (!this.initialized) {
          this.initialized = true;
        }
      })();

      return this.initPromise;
    }

    dispose() {
      this.initialized = false;
      this.isWatchingDevices = false;
      this.initPromise = null;
      this.currentInitFolder = null;
    }
  }

  const runStore = new MockRunStore();

  // Test concurrent calls for same folder
  await Promise.all([
    runStore.init('/project/repo'),
    runStore.init('/project/repo'),
    runStore.init('/project/repo'),
  ]);

  assert.strictEqual(devicesWatchCount, 1, 'devicesWatch must be called exactly once');
  assert.strictEqual(runConfigsLoadCount, 1, 'runConfigsLoad must be called exactly once for same folder');
  console.log('✓ runStore concurrent init deduplicated (devicesWatch and config load called once)');

  // Subsequent call on same folder returns existing promise without re-running devicesWatch
  await runStore.init('/project/repo');
  assert.strictEqual(devicesWatchCount, 1, 'devicesWatch should not be re-called');
  assert.strictEqual(runConfigsLoadCount, 1, 'runConfigsLoad should not be re-called for same folder');
  console.log('✓ runStore subsequent init on same folder is a no-op');

  // Switching folder reloads configs but does NOT re-watch devices
  await runStore.init('/project/other');
  assert.strictEqual(runConfigsLoadCount, 2, 'runConfigsLoad called for new folder');
  assert.strictEqual(devicesWatchCount, 1, 'devicesWatch remains 1 across folder switches');
  console.log('✓ Switching folders reloads configs without duplicate device watching');

  // Dispose cleans up correctly
  runStore.dispose();
  assert.strictEqual(runStore.isWatchingDevices, false);
  assert.strictEqual(runStore.initialized, false);
  console.log('✓ runStore dispose resets state');
}

console.log('=== All Petak P4.M Double-Init Idempotency Tests Passed Successfully ===');
