// Smoke test for the published build output.
//
// The unit tests run against `src`, so they can't catch packaging mistakes
// (broken exports maps, missing dist files, ESM/CJS interop). This loads the
// actual built `dist/index.js` (import) and `dist/index.cjs` (require) for
// every package and asserts each exposes at least one export.

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const packages = ['core', 'telephony', 'tts', 'mcp-client', 'stt'];

let failed = false;

for (const pkg of packages) {
  const base = resolve(root, 'packages', pkg, 'dist');
  const esm = resolve(base, 'index.js');
  const cjs = resolve(base, 'index.cjs');
  const dts = resolve(base, 'index.d.ts');

  for (const file of [esm, cjs, dts]) {
    if (!existsSync(file)) {
      console.error(`✗ ${pkg}: missing ${file.replace(`${root}/`, '')}`);
      failed = true;
    }
  }
  if (failed) continue;

  try {
    const esmMod = await import(pathToFileURL(esm).href);
    if (Object.keys(esmMod).length === 0) {
      throw new Error('ESM entry has no exports');
    }
    const cjsMod = require(cjs);
    if (!cjsMod || Object.keys(cjsMod).length === 0) {
      throw new Error('CJS entry has no exports');
    }
    console.log(`✓ ${pkg}: ESM + CJS load OK (${Object.keys(esmMod).length} exports)`);
  } catch (err) {
    console.error(`✗ ${pkg}: ${err.message}`);
    failed = true;
  }
}

if (failed) {
  console.error('\nDist smoke test failed.');
  process.exit(1);
}
console.log('\nAll packages load from dist.');
