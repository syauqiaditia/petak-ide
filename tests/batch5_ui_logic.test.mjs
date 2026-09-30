import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { api } from '../ui/lib/api.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

function collectFiles(dir, exts = ['.ts', '.svelte']) {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(collectFiles(fullPath, exts));
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

test('api consistency: all api.<name>( calls across ui/ must be defined in api.ts', () => {
  const files = collectFiles(uiRoot);
  const apiCallRegex = /\bapi\.([a-zA-Z0-9_]+)\s*\(/g;
  const missingMethods = new Map();

  for (const file of files) {
    if (file.endsWith(path.join('ui', 'lib', 'api.ts'))) {
      continue;
    }
    const content = fs.readFileSync(file, 'utf-8');
    let match;
    while ((match = apiCallRegex.exec(content)) !== null) {
      const methodName = match[1];
      // Check if methodName exists as a function or property on api
      if (typeof api[methodName] !== 'function') {
        const relPath = path.relative(uiRoot, file);
        if (!missingMethods.has(methodName)) {
          missingMethods.set(methodName, []);
        }
        missingMethods.get(methodName).push(relPath);
      }
    }
  }

  if (missingMethods.size > 0) {
    const details = Array.from(missingMethods.entries())
      .map(([m, callSites]) => `  - api.${m} called in: ${callSites.join(', ')}`)
      .join('\n');
    assert.fail(`Found missing api methods in ui/lib/api.ts:\n${details}`);
  }
});
