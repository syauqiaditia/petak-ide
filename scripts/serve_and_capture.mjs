import http from 'http';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';

const distDir = '/mnt/storage/uqi-projects/petak/dist';
const tmpDir = '/tmp';

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

function runCommand(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 25000 }, (error, stdout, stderr) => {
      if (error) {
        console.error(`Exec error: ${error.message}`);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

server.listen(41745, '127.0.0.1', async () => {
  console.log('Async preview server running on port 41745');

  const targets = [
    {
      name: 'preview-git.png',
      url: 'http://127.0.0.1:41745/?git&sub=log&menu',
    },
    {
      name: 'preview-rebase.png',
      url: 'http://127.0.0.1:41745/?git&sub=log&rebase',
    },
    {
      name: 'preview-diff.png',
      url: 'http://127.0.0.1:41745/?git',
    },
    {
      name: 'preview-conflict.png',
      url: 'http://127.0.0.1:41745/?git&conflict',
    },
  ];

  for (const t of targets) {
    const outPng = path.join(tmpDir, t.name);
    console.log(`Capturing ${t.name} from ${t.url}...`);
    const cmd = `${chromeBin} --headless=new --no-sandbox --disable-gpu --disable-background-networking --hide-scrollbars --window-size=1440,900 --virtual-time-budget=2000 --screenshot=${outPng} "${t.url}"`;
    const ok = await runCommand(cmd);
    if (ok) {
      console.log(`Saved: ${outPng} (${fs.statSync(outPng).size} bytes)`);
    }
  }

  server.close(() => {
    console.log('All previews captured successfully!');
    process.exit(0);
  });
});
