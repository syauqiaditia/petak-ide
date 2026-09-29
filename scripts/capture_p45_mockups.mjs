import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const worktreeDir = '/mnt/storage/uqi-projects/petak-wt/t_d5cfcdd8';
const htmlFile = path.join(worktreeDir, 'docs/phase4/design/DevicePanel.html');
const screensDir = path.join(worktreeDir, 'docs/phase4/screens');
fs.mkdirSync(screensDir, { recursive: true });

const chromeBin = '/mnt/storage/uqi-cache/ms-playwright/chromium-1243/chrome-linux64/chrome';

const server = http.createServer((req, res) => {
  try {
    const data = fs.readFileSync(htmlFile);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  } catch (err) {
    res.writeHead(500);
    res.end(String(err));
  }
});

const PORT = 41890;
const DEBUG_PORT = 9245;

server.listen(PORT, '127.0.0.1', async () => {
  console.log(`Preview server running on port ${PORT}`);

  const userDataDir = `/tmp/chrome-p45-mockup-${Date.now()}`;
  fs.mkdirSync(userDataDir, { recursive: true });

  const chromeProc = spawn(chromeBin, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=1600,2400',
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

  await sendCdp('Page.enable');
  await sendCdp('Runtime.enable');
  await sendCdp('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });

  // Wait for web fonts and layout
  await new Promise((r) => setTimeout(r, 2000));

  const captureElement = async (selector, filename) => {
    const res = await sendCdp('Runtime.evaluate', {
      expression: `
        (() => {
          const el = document.querySelector('${selector}');
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          return {
            x: rect.x + window.scrollX,
            y: rect.y + window.scrollY,
            width: rect.width,
            height: rect.height
          };
        })()
      `,
      returnByValue: true,
    });

    const box = res.result?.value;
    if (!box) {
      console.error(`Element not found for selector: ${selector}`);
      return;
    }

    const clip = {
      x: Math.max(0, Math.round(box.x)),
      y: Math.max(0, Math.round(box.y)),
      width: Math.round(box.width),
      height: Math.round(box.height),
      scale: 1,
    };

    const outPath = path.join(screensDir, filename);
    const shot = await sendCdp('Page.captureScreenshot', {
      format: 'png',
      clip,
      captureBeyondViewport: true,
    });
    fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
    console.log(`Saved screenshot: ${filename} (${fs.statSync(outPath).size} bytes)`);
  };

  try {
    await captureElement('#mockup-main-live', 'design-p45-mirror-live.png');
    await captureElement('#mockup-agent-slot', 'design-p45-mirror-with-agent-slot.png');
    await captureElement('#mockup-states-grid', 'design-p45-states-all.png');
    await captureElement('#state-empty', 'design-p45-state-empty.png');
    await captureElement('#state-connecting', 'design-p45-state-connecting.png');
    await captureElement('#state-live', 'design-p45-state-live.png');
    await captureElement('#state-disconnected', 'design-p45-state-disconnected.png');
    await captureElement('#state-error', 'design-p45-state-error.png');
    await captureElement('#state-viewonly', 'design-p45-state-view-only.png');
    console.log('All mockups captured successfully!');
  } catch (err) {
    console.error('Error during capture:', err);
  } finally {
    ws.close();
    chromeProc.kill();
    server.close();
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch (_) {}
    process.exit(0);
  }
});
