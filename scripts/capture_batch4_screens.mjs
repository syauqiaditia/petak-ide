import http from 'http';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';

const distDir = path.resolve(process.cwd(), 'dist');
const outDir = path.resolve(process.cwd(), 'docs/batch4/screens');
const chromeBin = '/mnt/storage/uqi-cache/ms-playwright/chromium-1243/chrome-linux64/chrome';

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
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

function runCommand(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 35000 }, (error) => {
      if (error) {
        console.error(`Exec error: ${error.message}`);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

server.listen(41747, '127.0.0.1', async () => {
  console.log('Batch 4 preview server running on port 41747');
  await new Promise((r) => setTimeout(r, 600));

  const targets = [
    {
      name: '01-device-picker-connected-paired.png',
      url: 'http://127.0.0.1:41747/?picker-open',
    },
    {
      name: '02-manage-devices-panel.png',
      url: 'http://127.0.0.1:41747/?b3-devices',
    },
    {
      name: '03-recent-projects-dropdown.png',
      url: 'http://127.0.0.1:41747/?project-open',
    },
    {
      name: '04-mirror-screen-recording-error.png',
      url: 'http://127.0.0.1:41747/?b3-mirror',
    },
    {
      name: '05-format-on-save-settings.png',
      url: 'http://127.0.0.1:41747/?tab=toolchains',
    },
  ];

  for (const t of targets) {
    const outPng = path.join(outDir, t.name);
    console.log(`Capturing ${t.name} from ${t.url}...`);
    const cmd = `${chromeBin} --headless=new --no-sandbox --disable-gpu --disable-background-networking --hide-scrollbars --window-size=1440,900 --virtual-time-budget=2000 --screenshot=${outPng} "${t.url}"`;
    const ok = await runCommand(cmd);
    if (ok && fs.existsSync(outPng)) {
      console.log(`Saved: ${outPng} (${fs.statSync(outPng).size} bytes)`);
    } else {
      console.error(`Failed to capture ${t.name}`);
    }
  }

  server.close(() => {
    console.log('All Batch 4 preview screenshots captured successfully!');
    process.exit(0);
  });
});
