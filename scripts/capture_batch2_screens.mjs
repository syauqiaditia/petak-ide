import http from 'http';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const currentDir = process.cwd();
const distDir = path.join(currentDir, 'dist');
const screensDir = path.join(currentDir, 'docs/batch2/screens');
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

const PORT = 41755;

server.listen(PORT, '127.0.0.1', async () => {
  console.log(`Static preview server running on port ${PORT}`);

  const targets = [
    {
      name: '01-mirror-android-interactive-before.png',
      url: `http://127.0.0.1:${PORT}/?preview&mirror&mirror-state=live`,
      windowSize: '1280,820',
    },
    {
      name: '01-mirror-android-interactive-after.png',
      url: `http://127.0.0.1:${PORT}/?preview&mirror&mirror-state=live&interact=after`,
      windowSize: '1280,820',
    },
    {
      name: '02-mirror-ios-viewonly.png',
      url: `http://127.0.0.1:${PORT}/?preview&mirror&mirror-state=view-only`,
      windowSize: '1280,820',
    },
    {
      name: '03-mirror-screenrec-permission.png',
      url: `http://127.0.0.1:${PORT}/?preview&mirror&mirror-state=error&screenrec`,
      windowSize: '1280,820',
    },
    {
      name: '04-device-picker-groups.png',
      url: `http://127.0.0.1:${PORT}/?preview&picker-open`,
      windowSize: '1280,820',
    },
    {
      name: '05-devices-panel.png',
      url: `http://127.0.0.1:${PORT}/?preview&tab=devices`,
      windowSize: '1280,820',
    },
    {
      name: '06-toolchains-kotlin-ls.png',
      url: `http://127.0.0.1:${PORT}/?preview&tab=toolchains`,
      windowSize: '1280,820',
    },
    {
      name: '07-filetree-git-submenu.png',
      url: `http://127.0.0.1:${PORT}/?preview&menu-git`,
      windowSize: '1280,820',
    },
    {
      name: '08-git-log-tree-and-header.png',
      url: `http://127.0.0.1:${PORT}/?preview&tab=git`,
      windowSize: '1280,820',
    },
    {
      name: '09-branch-switcher-titlebar.png',
      url: `http://127.0.0.1:${PORT}/?preview&branch-open`,
      windowSize: '1280,820',
    },
  ];

  for (const t of targets) {
    const outPng = path.join(screensDir, t.name);
    console.log(`Capturing ${t.name}...`);
    const cmd = `${chromeBin} --headless=new --no-sandbox --disable-gpu --disable-background-networking --hide-scrollbars --window-size=${t.windowSize || '1280,800'} --virtual-time-budget=2000 --screenshot=${outPng} "${t.url}"`;
    try {
      await execAsync(cmd, { timeout: 25000 });
      if (fs.existsSync(outPng)) {
        console.log(`Saved: ${t.name} (${fs.statSync(outPng).size} bytes)`);
      }
    } catch (e) {
      console.error(`Failed to capture ${t.name}:`, e.message);
    }
  }

  server.close(() => {
    console.log('All screens captured!');
    process.exit(0);
  });
});
