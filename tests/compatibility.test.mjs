import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Exact release support is intentional: future prereleases require a new
// native contract smoke, not a broad engine range or a risk exemption.
test('declares the verified current DSH release without an open-ended compatibility bypass', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.name, '@local/dsh-chatgpt-oauth');
  assert.equal(manifest.engines.dsh, '0.2.2-rc.1');
  assert.equal(manifest.version, '0.1.1');
  assert.equal(manifest.dependencies, undefined);
});
