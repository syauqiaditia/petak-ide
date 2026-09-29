import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import assert from 'node:assert/strict';

const dummyDir = '/tmp/petak-git-test-repo';
if (fs.existsSync(dummyDir)) {
  fs.rmSync(dummyDir, { recursive: true, force: true });
}
fs.mkdirSync(dummyDir, { recursive: true });

function sh(cmd) {
  return execSync(cmd, { cwd: dummyDir, encoding: 'utf8' }).trim();
}

console.log('1. Setting up dummy repo at', dummyDir);
sh('git init -b main');
sh('git config user.name "Petak Tester"');
sh('git config user.email "tester@petak.local"');

fs.writeFileSync(path.join(dummyDir, 'file1.txt'), 'Initial commit content\n');
sh('git add file1.txt');
sh('git commit -m "feat: initial commit"');

console.log('2. Creating branch hierarchy (prefix folding test)');
sh('git branch canary/dev/1.9.0');
sh('git branch canary/prod/1.9.0');
sh('git branch fix/login');
sh('git branch fix/crash');

const branchOutput = sh('git for-each-ref --format="%(refname:short)" refs/heads/');
const branchList = branchOutput.split('\n');
console.log('Branches in dummy repo:', branchList);

assert.ok(branchList.includes('canary/dev/1.9.0'));
assert.ok(branchList.includes('canary/prod/1.9.0'));
assert.ok(branchList.includes('fix/login'));
assert.ok(branchList.includes('main'));

console.log('3. Testing dirty checkout with auto-stash push & pop');
// Make uncommitted dirty change
fs.writeFileSync(path.join(dummyDir, 'file1.txt'), 'Modified dirty uncommitted line\n');
assert.ok(sh('git status --porcelain').includes('file1.txt'));

// Auto-stash push
sh('git stash push -u -m "petak-auto-stash"');
assert.equal(sh('git status --porcelain'), '');

// Checkout other branch
sh('git checkout canary/dev/1.9.0');
assert.equal(sh('git rev-parse --abbrev-ref HEAD'), 'canary/dev/1.9.0');

// Stash pop
sh('git stash pop');
const restoredContent = fs.readFileSync(path.join(dummyDir, 'file1.txt'), 'utf8');
assert.equal(restoredContent, 'Modified dirty uncommitted line\n');

console.log('4. Auto-stash roundtrip verified successfully!');

// Clean up dummy
fs.rmSync(dummyDir, { recursive: true, force: true });
console.log('Dummy repo cleaned up. All git dummy checks PASSED!');
