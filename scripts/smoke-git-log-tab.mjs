import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const distDir = path.resolve('dist');
const chromeBin = '/mnt/storage/uqi-cache/ms-playwright/chromium-1243/chrome-linux64/chrome';

if (!fs.existsSync(distDir)) {
  console.error('dist directory does not exist! Please run npm run build first.');
  process.exit(1);
}

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/' || !reqPath) reqPath = '/index.html';
  let filePath = path.join(distDir, reqPath);

  if (!fs.existsSync(filePath)) {
    filePath = path.join(distDir, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  } catch (err) {
    res.writeHead(404);
    res.end('Not found');
  }
});

const PORT = 41822;
const DEBUG_PORT = 9233;

server.listen(PORT, '127.0.0.1', async () => {
  console.log(`[smoke] Preview server listening on http://127.0.0.1:${PORT}`);

  const userDataDir = `/tmp/chrome-smoke-git-${Date.now()}`;
  fs.mkdirSync(userDataDir, { recursive: true });

  const chromeProc = spawn(chromeBin, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=1440,900',
    'about:blank',
  ]);

  const cleanup = () => {
    try {
      chromeProc.kill('SIGKILL');
    } catch (_) {}
    try {
      server.close();
    } catch (_) {}
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch (_) {}
  };

  process.on('SIGINT', () => { cleanup(); process.exit(1); });
  process.on('SIGTERM', () => { cleanup(); process.exit(1); });

  // Connect to Chrome CDP
  let targetWsUrl = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 150));
    try {
      const resp = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`);
      if (resp.ok) {
        const list = await resp.json();
        const page = list.find((p) => p.type === 'page');
        if (page && page.webSocketDebuggerUrl) {
          targetWsUrl = page.webSocketDebuggerUrl;
          break;
        }
      }
    } catch (_) {}
  }

  if (!targetWsUrl) {
    console.error('[smoke] Failed to connect to Chrome CDP');
    cleanup();
    process.exit(1);
  }

  console.log(`[smoke] Connected to Chrome CDP: ${targetWsUrl}`);
  const ws = new WebSocket(targetWsUrl);

  let msgId = 1;
  const pendingRequests = new Map();
  const consoleErrors = [];

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.id && pendingRequests.has(data.id)) {
        const { resolve, reject } = pendingRequests.get(data.id);
        pendingRequests.delete(data.id);
        if (data.error) reject(new Error(JSON.stringify(data.error)));
        else resolve(data.result);
      }
      if (data.method === 'Runtime.exceptionThrown') {
        const desc = data.params?.exceptionDetails?.exception?.description ||
                     data.params?.exceptionDetails?.text || 'Unknown exception';
        consoleErrors.push(`[PAGE_ERROR] ${desc}`);
      }
      if (data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') {
        const args = (data.params.args || []).map((a) => a.value || a.description || JSON.stringify(a)).join(' ');
        consoleErrors.push(`[CONSOLE_ERROR] ${args}`);
      }
    } catch (e) {
      console.error('[smoke] Error parsing CDP message:', e);
    }
  };

  const sendCdp = (method, params = {}) => {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      pendingRequests.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  await new Promise((resolve) => {
    if (ws.readyState === WebSocket.OPEN) resolve(null);
    else ws.onopen = () => resolve(null);
  });

  await sendCdp('Runtime.enable');
  await sendCdp('Page.enable');

  const evalInPage = async (expr) => {
    const res = await sendCdp('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval error: ${res.exceptionDetails.text}`);
    }
    return res.result?.value;
  };

  try {
    const targetUrl = `http://127.0.0.1:${PORT}/?git`;
    console.log(`[smoke] Navigating to ${targetUrl}...`);
    await sendCdp('Page.navigate', { url: targetUrl });

    // Wait for GitView to mount
    let mounted = false;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const res = await evalInPage(`
        (() => {
          const gv = document.querySelector('.git-view');
          const commitLayout = document.querySelector('.commit-layout');
          const tabs = Array.from(document.querySelectorAll('.tabs-group .tab-btn')).map(b => b.textContent.trim());
          const badge = document.querySelector('.preview-badge')?.textContent?.trim() || null;
          return { hasGv: !!gv, hasCommitLayout: !!commitLayout, tabs, badge };
        })()
      `);
      if (res && res.hasGv && res.hasCommitLayout) {
        console.log(`[smoke] GitView loaded: tabs=[${res.tabs.join(', ')}], previewBadge="${res.badge}"`);
        mounted = true;
        break;
      }
    }

    if (!mounted) {
      throw new Error('Timeout waiting for .git-view and .commit-layout to mount');
    }

    // Step 1: Initial state check
    const initialState = await evalInPage(`
      (() => {
        const commitBtn = Array.from(document.querySelectorAll('.tabs-group .tab-btn')).find(b => b.textContent.includes('Commit'));
        const logBtn = Array.from(document.querySelectorAll('.tabs-group .tab-btn')).find(b => b.textContent.includes('Log'));
        const commitLayout = document.querySelector('.commit-layout');
        const logLayout = document.querySelector('.log-layout');
        return {
          commitActive: commitBtn?.classList.contains('active'),
          logActive: logBtn?.classList.contains('active'),
          hasCommitLayout: !!commitLayout,
          hasLogLayout: !!logLayout,
        };
      })()
    `);
    console.log('[smoke] Initial state:', JSON.stringify(initialState));
    if (!initialState.commitActive || !initialState.hasCommitLayout) {
      throw new Error('Initial state assertion failed: Commit tab should be active');
    }

    // Step 2: Click "Log" tab
    console.log('[smoke] Clicking "Log" tab...');
    await evalInPage(`
      (() => {
        const logBtn = Array.from(document.querySelectorAll('.tabs-group .tab-btn')).find(b => b.textContent.includes('Log'));
        if (!logBtn) throw new Error('Log tab button not found');
        logBtn.click();
      })()
    `);

    // Allow effects/reactivity to settle
    await new Promise((r) => setTimeout(r, 300));

    // Check state after clicking Log
    const afterLogClick = await evalInPage(`
      (() => {
        const commitBtn = Array.from(document.querySelectorAll('.tabs-group .tab-btn')).find(b => b.textContent.includes('Commit'));
        const logBtn = Array.from(document.querySelectorAll('.tabs-group .tab-btn')).find(b => b.textContent.includes('Log'));
        const commitLayout = document.querySelector('.commit-layout');
        const logLayout = document.querySelector('.log-layout');
        return {
          commitActive: commitBtn?.classList.contains('active'),
          logActive: logBtn?.classList.contains('active'),
          hasCommitLayout: !!commitLayout,
          hasLogLayout: !!logLayout,
        };
      })()
    `);
    console.log('[smoke] State after clicking Log:', JSON.stringify(afterLogClick));

    if (!afterLogClick.logActive || !afterLogClick.hasLogLayout) {
      throw new Error(
        `Assertion failed: Clicking "Log" failed to switch tab! logActive=${afterLogClick.logActive}, hasLogLayout=${afterLogClick.hasLogLayout}, hasCommitLayout=${afterLogClick.hasCommitLayout}`
      );
    }
    console.log('[smoke] Log tab successfully active and .log-layout rendered ✓');

    // Step 3: Select a commit in LogView
    const commitSelection = await evalInPage(`
      (() => {
        const rows = document.querySelectorAll('.log-row');
        const detail = document.querySelector('.commit-detail');
        if (rows.length > 0) {
          rows[0].click();
          return { foundRows: rows.length, clicked: true, detailExists: !!detail };
        }
        return { foundRows: 0, clicked: false, detailExists: !!detail };
      })()
    `);
    await new Promise((r) => setTimeout(r, 200));
    console.log('[smoke] Commit selection in LogView:', JSON.stringify(commitSelection));

    // Verify commit detail updated
    const detailState = await evalInPage(`
      (() => {
        const detail = document.querySelector('.commit-detail');
        const emptyState = document.querySelector('.commit-detail .empty-state');
        return {
          hasDetail: !!detail,
          hasEmptyState: !!emptyState,
          summary: document.querySelector('.commit-summary, .commit-detail')?.textContent?.slice(0, 100) || '',
        };
      })()
    `);
    console.log('[smoke] Detail state after commit click:', JSON.stringify(detailState));
    if (!detailState.hasDetail || detailState.hasEmptyState) {
      throw new Error('Assertion failed: CommitDetail did not show selected commit');
    }
    console.log('[smoke] Commit detail successfully rendered for selected commit ✓');

    // Step 4: Click "Commit" tab to return
    console.log('[smoke] Clicking "Commit" tab...');
    await evalInPage(`
      (() => {
        const commitBtn = Array.from(document.querySelectorAll('.tabs-group .tab-btn')).find(b => b.textContent.includes('Commit'));
        if (!commitBtn) throw new Error('Commit tab button not found');
        commitBtn.click();
      })()
    `);

    await new Promise((r) => setTimeout(r, 300));

    const afterCommitReturn = await evalInPage(`
      (() => {
        const commitBtn = Array.from(document.querySelectorAll('.tabs-group .tab-btn')).find(b => b.textContent.includes('Commit'));
        const logBtn = Array.from(document.querySelectorAll('.tabs-group .tab-btn')).find(b => b.textContent.includes('Log'));
        const commitLayout = document.querySelector('.commit-layout');
        const logLayout = document.querySelector('.log-layout');
        return {
          commitActive: commitBtn?.classList.contains('active'),
          logActive: logBtn?.classList.contains('active'),
          hasCommitLayout: !!commitLayout,
          hasLogLayout: !!logLayout,
        };
      })()
    `);
    console.log('[smoke] State after returning to Commit:', JSON.stringify(afterCommitReturn));

    if (!afterCommitReturn.commitActive || !afterCommitReturn.hasCommitLayout) {
      throw new Error(
        `Assertion failed: Returning to "Commit" failed! commitActive=${afterCommitReturn.commitActive}, hasCommitLayout=${afterCommitReturn.hasCommitLayout}`
      );
    }
    console.log('[smoke] Commit tab successfully active and .commit-layout rendered ✓');

    // Step 5: Test query string ?git&log
    console.log('[smoke] Testing query string navigation: ?git&log...');
    await sendCdp('Page.navigate', { url: `http://127.0.0.1:${PORT}/?git&log` });
    await new Promise((r) => setTimeout(r, 400));
    const logUrlState = await evalInPage(`
      (() => {
        const logBtn = Array.from(document.querySelectorAll('.tabs-group .tab-btn')).find(b => b.textContent.includes('Log'));
        const logLayout = document.querySelector('.log-layout');
        return {
          logActive: logBtn?.classList.contains('active'),
          hasLogLayout: !!logLayout,
        };
      })()
    `);
    console.log('[smoke] State with ?git&log:', JSON.stringify(logUrlState));
    if (!logUrlState.logActive || !logUrlState.hasLogLayout) {
      throw new Error('Assertion failed: ?git&log query parameter did not activate Log tab');
    }
    console.log('[smoke] ?git&log query parameter verified ✓');

    // Step 6: Test query string ?git&conflict
    console.log('[smoke] Testing query string navigation: ?git&conflict...');
    await sendCdp('Page.navigate', { url: `http://127.0.0.1:${PORT}/?git&conflict` });
    await new Promise((r) => setTimeout(r, 400));
    const conflictUrlState = await evalInPage(`
      (() => {
        const conflictBtn = Array.from(document.querySelectorAll('.tabs-group .tab-btn')).find(b => b.textContent.includes('Conflict'));
        const conflictView = document.querySelector('.conflict-view, .conflict-file-list, .conflict-container');
        return {
          conflictActive: conflictBtn?.classList.contains('active'),
          hasConflictView: !!conflictView,
        };
      })()
    `);
    console.log('[smoke] State with ?git&conflict:', JSON.stringify(conflictUrlState));
    if (!conflictUrlState.conflictActive && !conflictUrlState.hasConflictView) {
      throw new Error('Assertion failed: ?git&conflict query parameter did not activate Conflict tab');
    }
    console.log('[smoke] ?git&conflict query parameter verified ✓');

    // Step 7: Check console errors
    if (consoleErrors.length > 0) {
      console.warn('[smoke] Console errors detected during test:');
      consoleErrors.forEach((e) => console.warn('  ' + e));
      // If there are real page errors, fail
      const fatalErrors = consoleErrors.filter(e => e.includes('[PAGE_ERROR]'));
      if (fatalErrors.length > 0) {
        throw new Error(`Fatal page errors: ${fatalErrors.join('; ')}`);
      }
    } else {
      console.log('[smoke] 0 console errors / page errors detected ✓');
    }

    console.log('\n========================================');
    console.log('  ALL SMOKE CHECKS PASSED SUCCESSFULLY  ');
    console.log('========================================');
    cleanup();
    process.exit(0);
  } catch (err) {
    console.error('\n[smoke] SMOKE TEST FAILED:');
    console.error(err.message);
    cleanup();
    process.exit(1);
  }
});
