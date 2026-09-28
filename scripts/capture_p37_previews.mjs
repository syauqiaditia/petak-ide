import http from 'http';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const distDir = '/mnt/storage/uqi-projects/petak/dist';
const screensDir = '/mnt/storage/uqi-projects/petak/docs/phase3/screens';
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

server.listen(41739, '127.0.0.1', async () => {
  console.log('Static preview server running on port 41739');

  const targets = [
    {
      name: 'preview-p37-git.png',
      url: 'http://127.0.0.1:41739/?git&sub=log&menu',
    },
    {
      name: 'preview-p37-rebase.png',
      url: 'http://127.0.0.1:41739/?git&sub=log&rebase',
    },
    {
      name: 'preview-p37-conflict.png',
      url: 'http://127.0.0.1:41739/?git&conflict',
    },
  ];

  for (const t of targets) {
    const outPng = path.join(screensDir, t.name);
    console.log(`Capturing ${t.name} from ${t.url}...`);
    try {
      execSync(
        `${chromeBin} --headless=new --no-sandbox --disable-gpu --disable-background-networking --hide-scrollbars --window-size=1440,900 --screenshot=${outPng} "${t.url}"`,
        { stdio: 'inherit', timeout: 15000 }
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
