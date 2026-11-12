// Offline HTTP integration smoke test. PayPal's token/order/capture APIs are transport fixtures.
// No real PayPal service, buyer approval or payment is involved.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir = await mkdtemp(path.join(tmpdir(), 'ut-sandbox-http-')); const log = path.join(dir, 'calls.log');
const token = 'sandbox-http-fixture-token-1234567890123456789'; let output = '';
const server = spawn(process.execPath, ['--import', './tests/fixtures/paypal-stub.mjs', 'server/index.mjs'], { env: { ...process.env, LOCAL_API_TOKEN: token, PAYPAL_SANDBOX_CLIENT_ID: 'fixture-id', PAYPAL_SANDBOX_CLIENT_SECRET: 'fixture-secret', PAYPAL_FIXTURE_LOG: log, ENABLE_PARALLEL: '0', ENABLE_PARALLEL_SEARCH: '0', ENABLE_DREX: '0', OPENROUTER_API_KEY: '', CACHE_ENCRYPTION_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
const closed = once(server, 'close'); server.stderr.resume();
try {
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Local server did not start')), 10000); server.stdout.on('data', chunk => { output += String(chunk); if (output.includes('local backend:')) { clearTimeout(timer); resolve(); } }); server.once('exit', code => { clearTimeout(timer); reject(new Error(`Server failed: ${code}`)); }); });
  const orderResponse = await fetch('http://127.0.0.1:4318/sandbox/order', { method: 'POST', headers: { 'x-local-token': token } });
  assert.equal(orderResponse.status, 200); const order = await orderResponse.json(); const approval = new URL(order.approvalUrl);
  assert.equal(approval.hostname, 'www.sandbox.paypal.com'); const state = approval.searchParams.get('fixture_state'); const orderId = approval.searchParams.get('token');
  const callback = `http://127.0.0.1:4318/sandbox/return?state=${encodeURIComponent(state)}&token=${encodeURIComponent(orderId)}`;
  const response = await fetch(callback); assert.match(await response.text(), /SANDBOX — NO REAL MONEY[\s\S]*COMPLETED/);
  const replay = await fetch(callback); assert.match(await replay.text(), /could not be captured/);
  const invalid = await fetch('http://127.0.0.1:4318/sandbox/return?state=bad&token=bad'); assert.match(await invalid.text(), /could not be captured/);
  const calls = (await readFile(log, 'utf8')).trim().split('\n'); assert.equal(calls.filter(url => url.endsWith('/capture')).length, 1);
  assert.equal(calls.filter(url => url.endsWith('/v2/checkout/orders')).length, 1);
  console.log('PASS: offline sandbox HTTP order, callback, one-time capture and replay rejection; PayPal responses were fixtures.');
} finally { if (server.exitCode === null) server.kill(); await closed; await rm(dir, { recursive: true, force: true }); }
