import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';

const outDir = path.resolve(process.cwd(), 'docs/redesign/screens');
const chromeBin = '/mnt/storage/uqi-cache/ms-playwright/chromium-1243/chrome-linux64/chrome';

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

function runCommand(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 35000 }, (error, stdout, stderr) => {
      if (error) {
        console.error(`Exec error: ${error.message}`);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

const targets = [
  {
    name: 'settings-ai-agents-teams.png',
    url: 'http://127.0.0.1:8090/comprehensive-design-system.html?screen=settings&cat=agents',
  },
  {
    name: 'git-vcs-full.png',
    url: 'http://127.0.0.1:8090/comprehensive-design-system.html?screen=git',
  },
  {
    name: 'terminal-run-logcat.png',
    url: 'http://127.0.0.1:8090/comprehensive-design-system.html?screen=workspace&dock=logcat',
  },
  {
    name: 'ai-team-switcher.png',
    url: 'http://127.0.0.1:8090/comprehensive-design-system.html?screen=workspace&bot=senior',
  },
];

async function main() {
  console.log('Capturing 4 high-res screenshots for Petak Redesign V2...');

  for (const t of targets) {
    const outPng = path.join(outDir, t.name);
    console.log(`Capturing ${t.name} from ${t.url}...`);
    const cmd = `${chromeBin} --headless=new --no-sandbox --disable-gpu --disable-background-networking --hide-scrollbars --window-size=1440,900 --virtual-time-budget=2500 --screenshot=${outPng} "${t.url}"`;
    const ok = await runCommand(cmd);
    if (ok && fs.existsSync(outPng)) {
      const stats = fs.statSync(outPng);
      console.log(`Saved: ${outPng} (${stats.size} bytes)`);
    } else {
      console.error(`Failed to capture ${t.name}`);
    }
  }

  console.log('Finished capturing all 4 target screens!');
}

main();
