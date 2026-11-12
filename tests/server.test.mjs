import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

test('loopback API rejects unauthenticated and hostile-origin requests', { timeout: 20000 }, async () => {
  const localToken = 'local-integration-test-token-123456789';
  const server = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, LOCAL_API_TOKEN: localToken, ENABLE_PARALLEL: '0', ENABLE_PARALLEL_SEARCH: '0', ENABLE_DREX: '0', OPENROUTER_API_KEY: '', CACHE_ENCRYPTION_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = once(server, 'close'); server.stderr.resume();
  try {
    await new Promise((resolve, reject) => {
      server.stdout.on('data', chunk => { if (String(chunk).includes('local backend:')) resolve(); });
      server.once('exit', code => reject(new Error(`Server failed to start: ${code}`)));
      server.once('error', reject);
    });
    const malformed = await new Promise((resolve, reject) => {
      const socket = net.connect(4318, '127.0.0.1', () => socket.write('GET http://[ HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n'));
      let data = ''; socket.on('data', chunk => { data += chunk; }); socket.on('end', () => resolve(data)); socket.on('error', reject);
    });
    assert.match(malformed, /^HTTP\/1\.1 400/);
    const endpoint = 'http://127.0.0.1:4318/lookup';
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { origin: 'https://evil.example', 'x-local-token': localToken, 'content-type': 'application/json' }, body: '{}' })).status, 403);
    const cancel = await fetch('http://127.0.0.1:4318/sandbox/cancel', { headers: { origin: 'https://www.sandbox.paypal.com' } });
    assert.equal(cancel.status, 200); assert.equal(cancel.headers.get('access-control-allow-origin'), null);
    assert.equal((await fetch('http://127.0.0.1:4318/sandbox/cancel', { headers: { origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { origin: 'https://www.sandbox.paypal.com', 'x-local-token': localToken, 'content-type': 'application/json' }, body: '{}' })).status, 403);
    const extensionOrigin = `chrome-extension://${'a'.repeat(32)}`;
    assert.equal((await fetch('http://127.0.0.1:4318/status', { headers: { origin: extensionOrigin } })).status, 401);
    const status = await fetch('http://127.0.0.1:4318/status', { headers: { origin: extensionOrigin, 'x-local-token': localToken } });
    assert.equal(status.status, 200); assert.equal((await status.json()).ok, true);
    assert.equal((await fetch('http://127.0.0.1:4318/pair', { method: 'POST' })).status, 403);
    assert.equal((await fetch('http://127.0.0.1:4318/pair', { method: 'POST', headers: { origin: 'https://evil.example' } })).status, 403);
    const pair = await fetch('http://127.0.0.1:4318/pair', { method: 'POST', headers: { origin: extensionOrigin } }); assert.equal((await pair.json()).token, localToken);
    const badKey = await fetch('http://127.0.0.1:4318/settings', { method: 'POST', headers: { origin: extensionOrigin, 'x-local-token': localToken, 'content-type': 'application/json' }, body: JSON.stringify({ openrouterKey: 'nope' }) });
    assert.equal(badKey.status, 400); assert.match((await badKey.json()).error, /OpenRouter key/);
    const badGh = await fetch('http://127.0.0.1:4318/settings', { method: 'POST', headers: { origin: extensionOrigin, 'x-local-token': localToken, 'content-type': 'application/json' }, body: JSON.stringify({ githubToken: 'nope' }) });
    assert.equal(badGh.status, 400); assert.match((await badGh.json()).error, /GitHub token/);
    const invalid = await fetch(endpoint, { method: 'POST', headers: { origin: extensionOrigin, 'x-local-token': localToken, 'content-type': 'application/json' }, body: JSON.stringify({ url: 'http://127.0.0.1' }) });
    assert.equal(invalid.status, 400); assert.equal(invalid.headers.get('access-control-allow-origin'), extensionOrigin);
    const headers = { 'x-local-token': localToken, 'content-type': 'application/json' };
    const nullBody = await fetch(endpoint, { method: 'POST', headers, body: 'null' }); assert.equal(nullBody.status, 400); assert.match((await nullBody.json()).error, /public HTTPS profile URL/);
    const oversized = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ url: 'x'.repeat(9000) }) }); assert.equal(oversized.status, 400); assert.match((await oversized.json()).error, /8192 bytes/);
    const stream = await fetch('http://127.0.0.1:4318/lookup/stream', { method: 'POST', headers: { origin: extensionOrigin, 'x-local-token': localToken, 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://example.invalid/' }) });
    assert.equal(stream.status, 200); assert.match(stream.headers.get('content-type'), /application\/x-ndjson/);
    const events = (await stream.text()).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(events[0].type, 'progress'); assert.equal(events.at(-1).type, 'error'); assert.equal(events.some(event => event.type === 'result'), false);
    const page = { id_str: 'handle:zz_cache_zz', screen_name: 'zz_cache_zz', description: 'Tips: https://paypal.me/first' };
    const first = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ url: 'https://x.com/zz_cache_zz', xProfile: page }) });
    assert.equal(first.status, 200); assert.equal((await first.json()).cached, false);
    const second = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ url: 'https://x.com/zz_cache_zz', xProfile: { ...page, description: 'no links now' } }) });
    const secondBody = await second.json(); assert.equal(secondBody.cached, false); assert.equal(secondBody.status, 'No safe match');
    assert.equal((await fetch('http://127.0.0.1:4318/cache', { method: 'DELETE', headers: { 'x-local-token': localToken } })).status, 200);
  } finally { if (server.exitCode === null) server.kill(); await closed; }
});
test('a cached result survives a used-up rate limit: fresh fallback first, the outdated copy only as a last resort', { timeout: 30000 }, async () => {
  const token = 'cache-limit-test-token-1234567890abcdef'; const dir = await mkdtemp(path.join(tmpdir(), 'ut-cache-limit-')); const flag = path.join(dir, 'limited');
  const server = spawn(process.execPath, ['--import', './tests/fixtures/github-stub.mjs', 'server/index.mjs'], { env: { ...process.env, LOCAL_API_TOKEN: token, GITHUB_TOKEN: '', IDENTITY_RECHECK_AFTER_MS: '300', FETCH_MEMO_MS: '0', UT_STUB_LIMIT_FLAG: flag, ENABLE_PARALLEL: '0', ENABLE_PARALLEL_SEARCH: '0', ENABLE_DREX: '0', OPENROUTER_API_KEY: '', CACHE_ENCRYPTION_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = once(server, 'close'); server.stderr.resume();
  try {
    await new Promise((resolve, reject) => { server.stdout.on('data', chunk => { if (String(chunk).includes('local backend')) resolve(); }); server.once('close', () => reject(new Error('Server exited before listening'))); });
    const lookup = async () => { const response = await fetch('http://127.0.0.1:4318/lookup', { method: 'POST', headers: { 'content-type': 'application/json', 'x-local-token': token }, body: JSON.stringify({ url: 'https://github.com/alice' }) }); return response.json(); };
    const published = result => result.candidates.filter(c => c.decision === 'published_payment_link').map(c => c.candidate_value).sort();

    const first = await lookup();
    assert.equal(first.cached, false); assert.equal(first.target.platformUserId, '99');
    assert.deepEqual(published(first), ['https://paypal.me/alicebio', 'https://paypal.me/alicefund']);
    const repeat = await lookup();
    assert.equal(repeat.cached, true, 'A result just checked is reused without contacting the platform');

    // The hourly limit runs out; the cached result is now old enough to need an identity recheck, which is refused.
    await writeFile(flag, 'api'); await delay(400);
    const limited = await lookup();
    assert.equal(limited.cached, false, 'A fresh fallback lookup replaces the unverifiable cached copy');
    assert.equal(limited.target.platformUserId, 'handle:alice');
    assert.deepEqual(published(limited), ['https://paypal.me/alicefund'], 'Links from public files stay published');
    assert.match(limited.warnings.join(' '), /hourly request limit/);

    // Nothing at all can be read: serve the earlier result, clearly marked as possibly outdated.
    await writeFile(flag, 'all');
    const outdated = await lookup();
    assert.equal(outdated.cached, true); assert.equal(outdated.target.platformUserId, '99');
    assert.deepEqual(published(outdated), [], 'An unverifiable cached result is never shown as published');
    assert.equal(outdated.candidates.length, 2); assert.match(outdated.warnings.join(' '), /could not be rechecked/);

    // The limit resets: normal service, and the stored result is still reachable.
    await rm(flag); const recovered = await lookup();
    assert.equal(recovered.cached, true); assert.deepEqual(published(recovered), ['https://paypal.me/alicebio', 'https://paypal.me/alicefund']);
  } finally { server.kill(); await closed; await rm(dir, { recursive: true, force: true }); }
});
