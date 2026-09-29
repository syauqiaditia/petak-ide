import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const distDir = '/mnt/storage/uqi-projects/petak-p4m/dist';
const screensDir = '/mnt/storage/uqi-projects/petak-p4m/docs/phase4/screens';
fs.mkdirSync(screensDir, { recursive: true });

const chromeBin = '/mnt/storage/uqi-cache/ms-playwright/chromium-1243/chrome-linux64/chrome';

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

const PORT = 41756;
const DEBUG_PORT = 9227;

server.listen(PORT, '127.0.0.1', async () => {
  console.log(`Server running on port ${PORT}`);

  const userDataDir = `/tmp/chrome-test-modals-${Date.now()}`;
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

  let targetWsUrl = null;
  for (let i = 0; i < 30; i++) {
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
    console.error('Failed to connect to Chrome CDP');
    chromeProc.kill();
    server.close();
    process.exit(1);
  }

  const ws = new WebSocket(targetWsUrl);
  let msgId = 1;
  const pendingRequests = new Map();

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.id && pendingRequests.has(data.id)) {
        const { resolve, reject } = pendingRequests.get(data.id);
        pendingRequests.delete(data.id);
        if (data.error) reject(new Error(JSON.stringify(data.error)));
        else resolve(data.result);
      }
    } catch (e) {
      console.error('Error parsing CDP message:', e);
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

  const previewUrl = `http://127.0.0.1:${PORT}/?preview`;
  await sendCdp('Page.enable');
  await sendCdp('Runtime.enable');
  await sendCdp('Page.navigate', { url: previewUrl });
  await new Promise((r) => setTimeout(r, 2000));

  // Install custom mock handlers
  await sendCdp('Runtime.evaluate', {
    expression: `
      (() => {
        const oldInvoke = window.__TAURI_INTERNALS__.invoke;
        window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
          if (cmd === 'git_blame') {
            return [
              { line: 1, sha: '5e44a0b123', author: 'Dimas', timeUnix: Math.floor(Date.now()/1000) - 172800, summary: 'feat: transfer cubit setup' },
              { line: 2, sha: '5e44a0b123', author: 'Dimas', timeUnix: Math.floor(Date.now()/1000) - 172800, summary: 'feat: transfer cubit setup' },
              { line: 3, sha: '1c7be90456', author: 'UQi', timeUnix: Math.floor(Date.now()/1000) - 3600, summary: 'fix: validate daily limit' },
              { line: 4, sha: '1c7be90456', author: 'UQi', timeUnix: Math.floor(Date.now()/1000) - 3600, summary: 'fix: validate daily limit' },
              { line: 5, sha: '5e44a0b123', author: 'Dimas', timeUnix: Math.floor(Date.now()/1000) - 172800, summary: 'feat: transfer cubit setup' },
            ];
          }
          if (cmd === 'git_path_history') {
            return [
              { sha: '5e44a0b1234567890abcdef', shortSha: '5e44a0b', parents: [], authorName: 'Dimas', authorEmail: 'dimas@ist.id', authorTime: Math.floor(Date.now()/1000) - 7200, summary: 'fix: typo in voucher label', subject: 'fix: typo in voucher label' },
              { sha: '1c7be904567890abcdef123', shortSha: '1c7be90', parents: [], authorName: 'UQi', authorEmail: 'syauqi@ist.id', authorTime: Math.floor(Date.now()/1000) - 86400, summary: 'feat(checkout): voucher input field', subject: 'feat(checkout): voucher input field' },
              { sha: '8d02e117890abcdef123456', shortSha: '8d02e11', parents: [], authorName: 'Rina', authorEmail: 'rina@ist.id', authorTime: Math.floor(Date.now()/1000) - 172800, summary: 'feat(cart): swipe to remove item', subject: 'feat(cart): swipe to remove item' },
            ];
          }
          if (cmd === 'lh_list') {
            return [
              { id: 'sha-9f3a1b4c', path: args.rel, ts_ms: Date.now() - 600000, blob: 'class TransferCubit extends Cubit<TransferState> {\\n  final TransferRepository repo;\\n}', kind: 'user_save', label: null },
              { id: 'sha-8d2b4e6f', path: args.rel, ts_ms: Date.now() - 3600000, blob: 'class TransferCubit extends Cubit<TransferState> {\\n  // external change\\n}', kind: 'external_change', label: null },
              { id: 'sha-7c1a8d9e', path: args.rel, ts_ms: Date.now() - 7200000, blob: 'class TransferCubit {\\n  // before refactor\\n}', kind: 'user_save', label: 'before refactor' },
              { id: 'sha-6b0e9f2a', path: args.rel, ts_ms: Date.now() - 14400000, blob: 'class OldTransferCubit {\\n}', kind: 'before_rollback', label: null },
            ];
          }
          if (cmd === 'lh_read') {
            return 'class TransferCubit extends Cubit<TransferState> {\\n  final TransferRepository repo;\\n  // snapshot version content\\n}';
          }
          if (cmd === 'git_diff_path') {
            return [
              {
                oldPath: args.rel,
                newPath: args.rel,
                status: 'modified',
                binary: false,
                hunks: [
                  {
                    oldStart: 1, oldLines: 3, newStart: 1, newLines: 4, header: '@@ -1,3 +1,4 @@',
                    lines: [
                      { kind: 'context', text: 'class TransferCubit {', oldNo: 1, newNo: 1 },
                      { kind: 'del', text: '  final Repo _repo;', oldNo: 2, newNo: null },
                      { kind: 'add', text: '  final TransferRepository repo;', oldNo: null, newNo: 2 },
                      { kind: 'add', text: '  final LimitService limitService;', oldNo: null, newNo: 3 },
                      { kind: 'context', text: '}', oldNo: 3, newNo: 4 },
                    ]
                  }
                ]
              }
            ];
          }
          return oldInvoke(cmd, args);
        };
      })()
    `,
  });

  const takeScreenshot = async (name) => {
    const outPng = path.join(screensDir, name);
    console.log(`Capturing ${name}...`);
    const shot = await sendCdp('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(outPng, Buffer.from(shot.data, 'base64'));
    console.log(`Saved: ${outPng} (${fs.statSync(outPng).size} bytes)`);
  };

  // 1. Trigger inline rename via right-click -> "Rename…"
  console.log('1. Triggering inline rename...');
  await sendCdp('Runtime.evaluate', {
    expression: `
      (() => {
        const item = document.querySelector('.item.file-item');
        if (item) {
          const rect = item.getBoundingClientRect();
          item.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true, clientX: rect.left + 50, clientY: rect.top + 10
          }));
        }
      })()
    `,
  });
  await new Promise((r) => setTimeout(r, 400));
  await sendCdp('Runtime.evaluate', {
    expression: `
      (() => {
        const items = Array.from(document.querySelectorAll('.menu-item'));
        const renameBtn = items.find(it => it.textContent.includes('Rename…'));
        if (renameBtn) renameBtn.click();
      })()
    `,
  });
  await new Promise((r) => setTimeout(r, 400));
  await takeScreenshot('preview-p4m-tree-inline-rename.png');

  // Also trigger rename validation error (e.g. type invalid characters or duplicate name)
  console.log('1b. Triggering inline rename validation error tooltip...');
  await sendCdp('Runtime.evaluate', {
    expression: `
      (() => {
        const input = document.querySelector('.rename-input');
        if (input) {
          input.value = 'invalid/name';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          // trigger validation
          const evt = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true });
          input.dispatchEvent(evt);
        }
      })()
    `,
  });
  await new Promise((r) => setTimeout(r, 400));
  await takeScreenshot('preview-p4m-tree-inline-rename-error.png');

  // Cancel rename
  await sendCdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape' });
  await sendCdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
  await new Promise((r) => setTimeout(r, 400));

  // 2. Open NewItemModal
  console.log('2. Opening NewItemModal...');
  await sendCdp('Runtime.evaluate', {
    expression: `
      (() => {
        const item = document.querySelector('.item.file-item');
        if (item) {
          const rect = item.getBoundingClientRect();
          item.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true, clientX: rect.left + 50, clientY: rect.top + 10
          }));
        }
      })()
    `,
  });
  await new Promise((r) => setTimeout(r, 400));
  await sendCdp('Runtime.evaluate', {
    expression: `
      (() => {
        const items = Array.from(document.querySelectorAll('.menu-item'));
        const newBtn = items.find(it => it.textContent.includes('New'));
        if (newBtn) newBtn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      })()
    `,
  });
  await new Promise((r) => setTimeout(r, 300));
  await sendCdp('Runtime.evaluate', {
    expression: `
      (() => {
        const subItems = Array.from(document.querySelectorAll('.submenu-cascading .menu-item'));
        const fileBtn = subItems.find(it => it.textContent.trim() === 'File');
        if (fileBtn) fileBtn.click();
      })()
    `,
  });
  await new Promise((r) => setTimeout(r, 600));
  await takeScreenshot('preview-p4m-modal-new-item.png');

  // Close NewItemModal
  await sendCdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape' });
  await sendCdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
  await new Promise((r) => setTimeout(r, 400));

  // 3. Open ComparePickerModal
  console.log('3. Opening ComparePickerModal...');
  await sendCdp('Runtime.evaluate', {
    expression: `
      (() => {
        const item = document.querySelector('.item.file-item');
        if (item) {
          const rect = item.getBoundingClientRect();
          item.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true, clientX: rect.left + 50, clientY: rect.top + 10
          }));
        }
      })()
    `,
  });
  await new Promise((r) => setTimeout(r, 400));
  await sendCdp('Runtime.evaluate', {
    expression: `
      (() => {
        const items = Array.from(document.querySelectorAll('.menu-item'));
        const cmpBtn = items.find(it => it.textContent.includes('Compare With…'));
        if (cmpBtn) cmpBtn.click();
      })()
    `,
  });
  await new Promise((r) => setTimeout(r, 600));
  await takeScreenshot('preview-p4m-modal-compare.png');

  // Switch to Revisions tab in ComparePickerModal
  console.log('3b. Switching to Revisions tab in ComparePickerModal...');
  await sendCdp('Runtime.evaluate', {
    expression: `
      (() => {
        const tabBtns = Array.from(document.querySelectorAll('.tab-btn'));
        const revBtn = tabBtns.find(it => it.textContent.includes('Revisions'));
        if (revBtn) revBtn.click();
      })()
    `,
  });
  await new Promise((r) => setTimeout(r, 400));
  await takeScreenshot('preview-p4m-modal-compare-revisions.png');

  // Close ComparePickerModal
  await sendCdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape' });
  await sendCdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
  await new Promise((r) => setTimeout(r, 400));

  // 4. Open LocalHistoryModal
  console.log('4. Opening LocalHistoryModal...');
  await sendCdp('Runtime.evaluate', {
    expression: `
      (() => {
        const item = document.querySelector('.item.file-item');
        if (item) {
          const rect = item.getBoundingClientRect();
          item.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true, clientX: rect.left + 50, clientY: rect.top + 10
          }));
        }
      })()
    `,
  });
  await new Promise((r) => setTimeout(r, 400));
  await sendCdp('Runtime.evaluate', {
    expression: `
      (() => {
        const items = Array.from(document.querySelectorAll('.menu-item'));
        const lhBtn = items.find(it => it.textContent.includes('Local History'));
        if (lhBtn) lhBtn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      })()
    `,
  });
  await new Promise((r) => setTimeout(r, 300));
  await sendCdp('Runtime.evaluate', {
    expression: `
      (() => {
        const subItems = Array.from(document.querySelectorAll('.submenu-cascading .menu-item'));
        const showBtn = subItems.find(it => it.textContent.includes('Show History'));
        if (showBtn) showBtn.click();
      })()
    `,
  });
  await new Promise((r) => setTimeout(r, 1000));
  await takeScreenshot('preview-p4m-modal-local-history.png');

  // Open "Put Label…" submodal inside LocalHistoryModal
  console.log('4b. Opening Put Label submodal in LocalHistoryModal...');
  await sendCdp('Runtime.evaluate', {
    expression: `
      (() => {
        const btns = Array.from(document.querySelectorAll('.modal-footer .btn'));
        const labelBtn = btns.find(b => b.textContent.includes('Put Label'));
        if (labelBtn) labelBtn.click();
      })()
    `,
  });
  await new Promise((r) => setTimeout(r, 400));
  await takeScreenshot('preview-p4m-modal-local-history-label.png');

  // Close submodal and modal
  await sendCdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape' });
  await sendCdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
  await new Promise((r) => setTimeout(r, 300));
  await sendCdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape' });
  await sendCdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
  await new Promise((r) => setTimeout(r, 400));

  // 5. Open RollbackConfirmModal
  console.log('5. Opening RollbackConfirmModal...');
  await sendCdp('Runtime.evaluate', {
    expression: `
      (() => {
        const item = document.querySelector('.item.file-item');
        if (item) {
          const rect = item.getBoundingClientRect();
          item.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true, clientX: rect.left + 50, clientY: rect.top + 10
          }));
        }
      })()
    `,
  });
  await new Promise((r) => setTimeout(r, 400));
  await sendCdp('Runtime.evaluate', {
    expression: `
      (() => {
        const items = Array.from(document.querySelectorAll('.menu-item'));
        const gitBtn = items.find(it => it.textContent.includes('Git'));
        if (gitBtn) gitBtn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      })()
    `,
  });
  await new Promise((r) => setTimeout(r, 300));
  await sendCdp('Runtime.evaluate', {
    expression: `
      (() => {
        const subItems = Array.from(document.querySelectorAll('.submenu-cascading .menu-item'));
        const rbBtn = subItems.find(it => it.textContent.includes('Rollback Changes'));
        if (rbBtn) rbBtn.click();
      })()
    `,
  });
  await new Promise((r) => setTimeout(r, 600));
  await takeScreenshot('preview-p4m-modal-rollback.png');

  // Close RollbackConfirmModal
  await sendCdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape' });
  await sendCdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
  await new Promise((r) => setTimeout(r, 400));

  // 6. Gutter Blame (Annotate)
  console.log('6. Toggling Gutter Blame in Editor...');
  await sendCdp('Runtime.evaluate', {
    expression: `
      (() => {
        // Open file in editor
        const item = document.querySelector('.item.file-item');
        if (item) item.click();
      })()
    `,
  });
  await new Promise((r) => setTimeout(r, 500));
  await sendCdp('Runtime.evaluate', {
    expression: `
      (() => {
        // Tab context menu -> Git -> Annotate / Blame
        const tab = document.querySelector('.tab');
        if (tab) {
          const rect = tab.getBoundingClientRect();
          tab.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true, clientX: rect.left + 30, clientY: rect.top + 15
          }));
        }
      })()
    `,
  });
  await new Promise((r) => setTimeout(r, 400));
  await sendCdp('Runtime.evaluate', {
    expression: `
      (() => {
        const items = Array.from(document.querySelectorAll('.menu-item'));
        const gitBtn = items.find(it => it.textContent.includes('Git'));
        if (gitBtn) gitBtn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      })()
    `,
  });
  await new Promise((r) => setTimeout(r, 300));
  await sendCdp('Runtime.evaluate', {
    expression: `
      (() => {
        const subItems = Array.from(document.querySelectorAll('.submenu-cascading .menu-item'));
        const blameBtn = subItems.find(it => it.textContent.includes('Annotate / Blame'));
        if (blameBtn) blameBtn.click();
      })()
    `,
  });
  await new Promise((r) => setTimeout(r, 800));
  await takeScreenshot('preview-p4m-gutter-blame.png');

  // 6b. Blame Gutter Context Menu
  console.log('6b. Triggering Blame Gutter Context Menu...');
  await sendCdp('Runtime.evaluate', {
    expression: `
      (() => {
        const blameCell = document.querySelector('.cm-blame-cell');
        if (blameCell) {
          const rect = blameCell.getBoundingClientRect();
          blameCell.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true, clientX: rect.left + 30, clientY: rect.top + 10
          }));
        }
      })()
    `,
  });
  await new Promise((r) => setTimeout(r, 500));
  await takeScreenshot('preview-p4m-gutter-blame-menu.png');

  // Clean up
  ws.close();
  chromeProc.kill();
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch (_) {}

  server.close(() => {
    console.log('All modal previews captured successfully!');
    process.exit(0);
  });
});
