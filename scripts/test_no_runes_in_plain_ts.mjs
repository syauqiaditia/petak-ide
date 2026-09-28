// Guard: Svelte 5 runes only compile inside .svelte / .svelte.ts / .svelte.js.
// In a plain .ts file they crash the prod bundle at load ("$state is not defined").
import fs from 'node:fs';
import path from 'node:path';

const bad = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|js)$/.test(e.name) && !/\.svelte\.(ts|js)$/.test(e.name)) {
      if (/\$(state|derived|effect|props)\s*[(<.]/.test(fs.readFileSync(p, 'utf-8'))) bad.push(p);
    }
  }
})('ui');

if (bad.length) {
  console.error('FAIL runes in plain .ts:\n  ' + bad.join('\n  '));
  process.exit(1);
}
console.log('PASS no runes in plain .ts/.js');
