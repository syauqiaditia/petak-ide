import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const distDir = '/mnt/storage/uqi-projects/petak/dist';
const screensDir = '/mnt/storage/uqi-projects/petak/docs/phase4/screens';
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

const PORT = 41750;
const DEBUG_PORT = 9225;

server.listen(PORT, '127.0.0.1', async () => {
  console.log(`Static preview server running on port ${PORT}`);

  const userDataDir = `/tmp/chrome-test-p46-${Date.now()}`;
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

  // Wait for Chrome CDP port to become active
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

  console.log(`Connected to Chrome CDP: ${targetWsUrl}`);
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

  const previewUrl = `http://127.0.0.1:${PORT}/?preview&running&tab=logcat&feed=synthetic`;
  console.log(`Navigating to ${previewUrl}...`);

  await sendCdp('Page.enable');
  await sendCdp('Runtime.enable');
  await sendCdp('Page.navigate', { url: previewUrl });

  // Wait for synthetic feed to stream (2,000 lines/second)
  console.log('Waiting 3.5s for synthetic feed (2,000 lines/sec) to exercise virtual list...');
  await new Promise((r) => setTimeout(r, 3500));

  // Retrieve frame metrics
  const evalRes = await sendCdp('Runtime.evaluate', {
    expression: 'window.__GET_PERF_METRICS__()',
    returnByValue: true,
  });

  const metrics = evalRes.result?.value || {};
  console.log('=== Real Chromium Frame Time Metrics (Under 2,000 lines/sec feed) ===');
  console.log(`Frames sampled: ${metrics.count}`);
  console.log(`Avg frame time: ${metrics.avg?.toFixed(2)} ms`);
  console.log(`Min frame time: ${metrics.min?.toFixed(2)} ms`);
  console.log(`P95 frame time: ${metrics.p95?.toFixed(2)} ms`);
  console.log(`Max frame time: ${metrics.max?.toFixed(2)} ms`);

  // Capture screenshot
  const outPng = path.join(screensDir, 'preview-p46-logcat.png');
  console.log(`Capturing screenshot to ${outPng}...`);
  const shotRes = await sendCdp('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(outPng, Buffer.from(shotRes.data, 'base64'));
  console.log(`Screenshot saved: ${outPng}`);

  // Clean up
  ws.close();
  chromeProc.kill();
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch (_) {}

  server.close(() => {
    console.log('Done!');
    process.exit(0);
  });
});
