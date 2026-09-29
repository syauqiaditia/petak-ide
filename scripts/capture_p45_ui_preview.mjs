import http from 'http';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const PORT = 41930;
const WORKTREE_DIR = '/mnt/storage/uqi-projects/petak-wt/t_eb501da4';
const DIST_DIR = path.join(WORKTREE_DIR, 'dist');
const SCREENS_DIR = path.join(WORKTREE_DIR, 'docs/phase4/screens');
const CHROME_BIN = '/mnt/storage/uqi-cache/ms-playwright/chromium-1243/chrome-linux64/chrome';

fs.mkdirSync(SCREENS_DIR, { recursive: true });

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
  let filePath = path.join(DIST_DIR, reqPath);

  if (!fs.existsSync(filePath)) {
    filePath = path.join(DIST_DIR, 'index.html');
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

server.listen(PORT, '127.0.0.1', async () => {
  console.log(`Static preview server running on port ${PORT}`);

  const baseUrl = `http://127.0.0.1:${PORT}`;

  const fullTargets = [
    {
      name: 'preview-p45-mirror-live.png',
      url: `${baseUrl}/?preview&mirror&mirror-state=live&preview-mirror`,
    },
    {
      name: 'preview-p45-mirror-with-agent-slot.png',
      url: `${baseUrl}/?preview&mirror&mirror-state=live&agent=true&preview-agent`,
    },
    {
      name: 'preview-p45-mirror-view-only.png',
      url: `${baseUrl}/?preview&mirror&mirror-state=view-only&preview-mirror`,
    },
  ];

  for (const t of fullTargets) {
    const outPng = path.join(SCREENS_DIR, t.name);
    console.log(`Capturing ${t.name}...`);
    try {
      await execAsync(
        `${CHROME_BIN} --headless=new --no-sandbox --disable-gpu --disable-background-networking --hide-scrollbars --window-size=1440,900 --run-all-compositor-stages-before-draw --screenshot=${outPng} "${t.url}"`
      );
      console.log(`Saved: ${outPng} (${fs.statSync(outPng).size} bytes)`);
    } catch (e) {
      console.error(`Error capturing ${t.name}:`, e.message);
    }
  }

  // Individual states
  const states = ['empty', 'connecting', 'live', 'disconnected', 'error', 'view-only'];

  for (const s of states) {
    const stateUrl = `${baseUrl}/?preview&mirror&mirror-state=${s}`;
    const tmpFull = path.join('/tmp', `petak-state-${s}.png`);
    const outCard = path.join(SCREENS_DIR, `preview-p45-state-${s}.png`);

    try {
      await execAsync(
        `${CHROME_BIN} --headless=new --no-sandbox --disable-gpu --disable-background-networking --hide-scrollbars --window-size=1440,900 --run-all-compositor-stages-before-draw --screenshot=${tmpFull} "${stateUrl}"`
      );
    } catch (e) {
      console.error(`Error capturing state ${s}:`, e.message);
    }
  }

  server.close(async () => {
    console.log('Finished capturing chrome previews. Now processing crops...');

    // Run Python cropping script
    const pyCrop = `
import os
from PIL import Image

screens_dir = "${SCREENS_DIR}"
states = ['empty', 'connecting', 'live', 'disconnected', 'error', 'view-only']
cropped = {}

for s in states:
    tmp_path = f"/tmp/petak-state-{s}.png"
    if not os.path.exists(tmp_path):
        continue
    img = Image.open(tmp_path)
    # Panel is at right 380px: x: 1060..1440, y: 46..874
    panel = img.crop((1060, 46, 1440, 874))
    
    # Create 496x520 card
    card = Image.new("RGB", (496, 520), "#141518")
    w_crop, h_crop = panel.size
    target_h = 500
    target_w = int(w_crop * (target_h / h_crop))
    scaled = panel.resize((target_w, target_h), Image.Resampling.LANCZOS)
    offset_x = (496 - target_w) // 2
    offset_y = (520 - target_h) // 2
    card.paste(scaled, (offset_x, offset_y))
    
    out_path = os.path.join(screens_dir, f"preview-p45-state-{s}.png")
    card.save(out_path)
    cropped[s] = card
    print(f"Saved card: preview-p45-state-{s}.png")

# Composite grid 1536x1064
grid = Image.new("RGB", (1536, 1064), "#101114")
row1 = ["empty", "connecting", "live"]
row2 = ["disconnected", "error", "view-only"]

for col_idx, s in enumerate(row1):
    if s in cropped:
        grid.paste(cropped[s], (16 + col_idx * (496 + 8), 12))

for col_idx, s in enumerate(row2):
    if s in cropped:
        grid.paste(cropped[s], (16 + col_idx * (496 + 8), 12 + 520 + 8))

grid.save(os.path.join(screens_dir, "preview-p45-states-all.png"))
print("Saved preview-p45-states-all.png")
`;
    fs.writeFileSync('/tmp/process_crops.py', pyCrop);
    await execAsync('python3 /tmp/process_crops.py');
    console.log('All screenshots and composite grid successfully generated!');
    process.exit(0);
  });
});
