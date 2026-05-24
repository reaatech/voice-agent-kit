// Smoke test for the published build output.
//
// The unit tests run against `src`, so they can't catch packaging mistakes
// (broken exports maps, missing dist files, ESM/CJS interop). This loads the
// actual built dist entry points for every published package and asserts they
// expose exports. Bin-only packages are checked for an executable shebang.

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// `dual` = ESM + CJS + .d.ts library entry.
// `bin`  = ESM-only executable; assert the entry exists with a shebang.
const packages = [
  { name: 'core', kind: 'dual' },
  { name: 'telephony', kind: 'dual' },
  { name: 'tts', kind: 'dual' },
  { name: 'mcp-client', kind: 'dual' },
  { name: 'stt', kind: 'dual' },
  { name: 'webrtc', kind: 'dual' },
  { name: 'simulator', kind: 'dual' },
  { name: 'create-voice-agent', kind: 'bin', entry: 'cli.js' },
];

let failed = false;
const rel = (file) => file.replace(`${root}/`, '');

for (const pkg of packages) {
  const base = resolve(root, 'packages', pkg.name, 'dist');

  if (pkg.kind === 'bin') {
    const entry = resolve(base, pkg.entry);
    if (!existsSync(entry)) {
      console.error(`✗ ${pkg.name}: missing ${rel(entry)}`);
      failed = true;
      continue;
    }
    if (!readFileSync(entry, 'utf8').startsWith('#!')) {
      console.error(`✗ ${pkg.name}: ${pkg.entry} is missing a shebang`);
      failed = true;
      continue;
    }
    console.log(`✓ ${pkg.name}: bin entry OK (shebang present)`);
    continue;
  }

  const esm = resolve(base, 'index.js');
  const cjs = resolve(base, 'index.cjs');
  const dts = resolve(base, 'index.d.ts');

  let missing = false;
  for (const file of [esm, cjs, dts]) {
    if (!existsSync(file)) {
      console.error(`✗ ${pkg.name}: missing ${rel(file)}`);
      failed = true;
      missing = true;
    }
  }
  if (missing) continue;

  try {
    const esmMod = await import(pathToFileURL(esm).href);
    if (Object.keys(esmMod).length === 0) {
      throw new Error('ESM entry has no exports');
    }
    const cjsMod = require(cjs);
    if (!cjsMod || Object.keys(cjsMod).length === 0) {
      throw new Error('CJS entry has no exports');
    }
    console.log(`✓ ${pkg.name}: ESM + CJS load OK (${Object.keys(esmMod).length} exports)`);
  } catch (err) {
    console.error(`✗ ${pkg.name}: ${err.message}`);
    failed = true;
  }
}

if (failed) {
  console.error('\nDist smoke test failed.');
  process.exit(1);
}
console.log('\nAll packages load from dist.');
