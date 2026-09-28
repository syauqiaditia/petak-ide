#!/usr/bin/env bash
set -euo pipefail

DEST="${1:-/mnt/storage/uqi-cache/tmp/petak-git10k}"

echo "Generating 10k+ dummy git repository at: $DEST"
rm -rf "$DEST"
mkdir -p "$DEST"
cd "$DEST"

git init -b main
git config --local user.name "Bench Bot"
git config --local user.email "bench@petak.local"

node -e '
import { spawn } from "node:child_process";
import fs from "node:fs";

const p = spawn("git", ["fast-import", "--quiet"], { stdio: ["pipe", "inherit", "inherit"] });
const out = p.stdin;

let mark = 1;
let ts = 1700000000;

function commit(branch, msg, fromMark, mergeMark, fileContent) {
  const currentMark = mark++;
  let header = `commit refs/heads/${branch}\nmark :${currentMark}\ncommitter Bench Bot <bench@petak.local> ${ts++} +0000\n`;
  header += `data ${Buffer.byteLength(msg)}\n${msg}\n`;
  if (fromMark) {
    header += `from :${fromMark}\n`;
  }
  if (mergeMark) {
    header += `merge :${mergeMark}\n`;
  }
  const content = fileContent || `content for ${currentMark}\n`;
  header += `M 644 inline file.txt\ndata ${Buffer.byteLength(content)}\n${content}\n`;
  out.write(header);
  return currentMark;
}

// 1. Initial 5000 commits on main
let mainMark = commit("main", "initial commit", null, null, "initial\n");
for (let i = 2; i <= 5000; i++) {
  mainMark = commit("main", `commit on main ${i}`, mainMark);
}

// 2. Feature-1 branch branching from commit 5000
let feat1Mark = commit("feature-1", "feature-1 commit 1", mainMark);
for (let i = 2; i <= 50; i++) {
  feat1Mark = commit("feature-1", `feature-1 commit ${i}`, feat1Mark);
}

// 3. Merge feature-1 back into main
mainMark = commit("main", "Merge branch feature-1 into main", mainMark, feat1Mark);

// 4. Commits 5002 to 8000 on main
for (let i = 5002; i <= 8000; i++) {
  mainMark = commit("main", `commit on main ${i}`, mainMark);
}

// 5. Feature-2 branch branching from commit 8000
let feat2Mark = commit("feature-2", "feature-2 commit 1", mainMark);
for (let i = 2; i <= 50; i++) {
  feat2Mark = commit("feature-2", `feature-2 commit ${i}`, feat2Mark);
}

// 6. Merge feature-2 back into main
mainMark = commit("main", "Merge branch feature-2 into main", mainMark, feat2Mark);

// 7. Commits 8002 to 10000 on main
for (let i = 8002; i <= 10000; i++) {
  mainMark = commit("main", `commit on main ${i}`, mainMark);
}

// Tag commit 5000 as v1.0.0
out.write(`tag v1.0.0\nfrom :5000\ntagger Bench Bot <bench@petak.local> 1700005000 +0000\ndata 6\nv1.0.0\n`);

out.end();
p.on("close", (code) => {
  if (code !== 0) {
    process.exit(code);
  }
});
'

git checkout -f main
COUNT=$(git rev-list --count --all)
echo "Done! Total commits in dummy repo: $COUNT"
