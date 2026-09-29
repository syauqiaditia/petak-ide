import http from 'http';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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

const PORT = 41748;

server.listen(PORT, '127.0.0.1', async () => {
  console.log(`Static preview server running on port ${PORT}`);

  const targets = [
    {
      name: 'preview-p45-idle.png',
      url: `http://127.0.0.1:${PORT}/?preview&idle`,
    },
    {
      name: 'preview-p45-running.png',
      url: `http://127.0.0.1:${PORT}/?preview&running`,
    },
    {
      name: 'preview-p45-devices.png',
      url: `http://127.0.0.1:${PORT}/?preview&tab=devices`,
    },
    {
      name: 'preview-p45-run-tab.png',
      url: `http://127.0.0.1:${PORT}/?preview&running&tab=run`,
    },
    {
      name: 'preview-p45-build-tab.png',
      url: `http://127.0.0.1:${PORT}/?preview&build-error&tab=build`,
    },
  ];

  for (const t of targets) {
    const outPng = path.join(screensDir, t.name);
    console.log(`Capturing ${t.name} from ${t.url}...`);
    try {
      await execAsync(
        `${chromeBin} --headless=new --no-sandbox --disable-gpu --disable-background-networking --hide-scrollbars --window-size=1440,900 --screenshot=${outPng} "${t.url}"`
      );
      console.log(`Saved: ${outPng}`);
    } catch (e) {
      console.error(`Error capturing ${t.name}:`, e.message);
    }
  }

  server.close(() => {
    console.log('Preview capture completed!');
    process.exit(0);
  });
});
