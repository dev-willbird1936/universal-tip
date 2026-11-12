import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EvidenceCache } from '../server/cache.mjs';

test('encrypted cache survives restart, hides contents, rejects wrong key and clears', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'universal-tip-test-'));
  try {
    const options = { directory: dir, key: '11'.repeat(32) }; const cache = new EvidenceCache(options); await cache.load();
    await cache.set('github:42', { publicLink: 'https://paypal.me/private-test-marker' }, Date.now() + 60000);
    const ciphertext = await readFile(path.join(dir, 'evidence-cache.enc'));
    assert.equal(ciphertext.includes(Buffer.from('private-test-marker')), false);
    const restored = new EvidenceCache(options); await restored.load();
    assert.equal(restored.get('github:42').publicLink, 'https://paypal.me/private-test-marker');
    const locked = new EvidenceCache({ directory: dir }); await locked.set('temp', { value: 1 }, Date.now() + 60000);
    assert.equal(await locked.hasLockedRegistry(), true); await assert.rejects(locked.clear(), /registry is locked/);
    assert.deepEqual(await readFile(path.join(dir, 'evidence-cache.enc')), ciphertext, 'Clearing without the key must not overwrite encrypted data');
    assert.equal(locked.get('temp'), null, 'In-memory records are still cleared');
    await assert.rejects(() => new EvidenceCache({ ...options, key: '22'.repeat(32) }).load(), /could not be opened/);
    await restored.clear(); const cleared = new EvidenceCache(options); await cleared.load(); assert.equal(cleared.get('github:42'), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('oversized records are refused rather than creating an unreadable registry', async () => {
  const cache = new EvidenceCache();
  await assert.rejects(cache.set('oversized', { text: 'x'.repeat(40000) }, Date.now() + 60000), /record size/);
  assert.equal(cache.get('oversized'), null);
});
test('expired cache entries are never returned', async () => {
  const cache = new EvidenceCache(); await cache.set('old', { value: 1 }, Date.now() - 1); assert.equal(cache.get('old'), null);
});
