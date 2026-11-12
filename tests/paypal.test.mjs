import test from 'node:test';
import assert from 'node:assert/strict';
import { createSandboxOrder, captureSandboxOrder, verifySandboxCredentials } from '../server/paypal.mjs';

test('sandbox order uses fixed merchant, sandbox host, approval state, and one-time capture', async () => {
  const original = globalThis.fetch; const oldId = process.env.PAYPAL_SANDBOX_CLIENT_ID; const oldSecret = process.env.PAYPAL_SANDBOX_CLIENT_SECRET;
  process.env.PAYPAL_SANDBOX_CLIENT_ID = 'sandbox-test-id'; process.env.PAYPAL_SANDBOX_CLIENT_SECRET = 'sandbox-test-secret';
  const calls = []; let state;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options }); assert.ok(String(url).startsWith('https://api-m.sandbox.paypal.com/'));
    if (url.endsWith('/oauth2/token')) return Response.json({ access_token: 'sandbox-access' });
    if (url.endsWith('/v2/checkout/orders')) {
      const payload = JSON.parse(options.body); assert.equal(payload.purchase_units[0].amount.value, '1.00');
      assert.equal(payload.purchase_units[0].payee, undefined);
      assert.equal(payload.payment_source.paypal.experience_context.shipping_preference, 'NO_SHIPPING');
      const callback = new URL(payload.payment_source.paypal.experience_context.return_url); state = callback.searchParams.get('state');
      return Response.json({ id: 'SANDBOXORDER123', links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=SANDBOXORDER123' }] });
    }
    if (url.endsWith('/capture')) return Response.json({ status: 'COMPLETED' });
    throw new Error('Unexpected endpoint');
  };
  try {
    const order = await createSandboxOrder(); assert.match(order.approvalUrl, /^https:\/\/www\.sandbox\.paypal\.com\//); assert.equal(state.length, 48);
    await assert.rejects(() => captureSandboxOrder('wrong-state', 'SANDBOXORDER123'), /Unknown/);
    assert.equal(await captureSandboxOrder(state, 'SANDBOXORDER123'), 'COMPLETED');
    await assert.rejects(() => captureSandboxOrder(state, 'SANDBOXORDER123'), /Unknown/);
    assert.equal(calls.filter(call => call.url.endsWith('/capture')).length, 1);
    const createId = calls.find(call => call.url.endsWith('/v2/checkout/orders')).options.headers['paypal-request-id'];
    const captureId = calls.find(call => call.url.endsWith('/capture')).options.headers['paypal-request-id'];
    assert.match(createId, /^[a-f\d]{32}$/); assert.match(captureId, /^[a-f\d]{32}$/); assert.notEqual(createId, captureId);
  } finally {
    globalThis.fetch = original;
    if (oldId === undefined) delete process.env.PAYPAL_SANDBOX_CLIENT_ID; else process.env.PAYPAL_SANDBOX_CLIENT_ID = oldId;
    if (oldSecret === undefined) delete process.env.PAYPAL_SANDBOX_CLIENT_SECRET; else process.env.PAYPAL_SANDBOX_CLIENT_SECRET = oldSecret;
  }
});
test('sandbox rejects forged approval hosts and credential-bearing URLs', async () => {
  const original = globalThis.fetch, oldId = process.env.PAYPAL_SANDBOX_CLIENT_ID, oldSecret = process.env.PAYPAL_SANDBOX_CLIENT_SECRET;
  process.env.PAYPAL_SANDBOX_CLIENT_ID = 'id'; process.env.PAYPAL_SANDBOX_CLIENT_SECRET = 'secret';
  let href = 'https://www.sandbox.paypal.com.evil.example/checkout';
  globalThis.fetch = async url => url.endsWith('/oauth2/token') ? Response.json({ access_token: 'test' }) : Response.json({ id: 'SANDBOXORDER123', links: [{ rel: 'payer-action', href }] });
  try {
    await assert.rejects(createSandboxOrder(), /unexpected approval URL/);
    href = 'https://attacker@www.sandbox.paypal.com/checkout';
    await assert.rejects(createSandboxOrder(), /unexpected approval URL/);
  } finally { globalThis.fetch = original; if (oldId === undefined) delete process.env.PAYPAL_SANDBOX_CLIENT_ID; else process.env.PAYPAL_SANDBOX_CLIENT_ID = oldId; if (oldSecret === undefined) delete process.env.PAYPAL_SANDBOX_CLIENT_SECRET; else process.env.PAYPAL_SANDBOX_CLIENT_SECRET = oldSecret; }
});
test('sandbox credential check contacts only OAuth and never creates an order', async () => {
  const original = globalThis.fetch, oldId = process.env.PAYPAL_SANDBOX_CLIENT_ID, oldSecret = process.env.PAYPAL_SANDBOX_CLIENT_SECRET;
  process.env.PAYPAL_SANDBOX_CLIENT_ID = 'fixture-id'; process.env.PAYPAL_SANDBOX_CLIENT_SECRET = 'fixture-secret'; const calls = [];
  globalThis.fetch = async url => { calls.push(url); return Response.json({ access_token: 'fixture-access' }); };
  try {
    assert.equal(await verifySandboxCredentials(), true); assert.deepEqual(calls, ['https://api-m.sandbox.paypal.com/v1/oauth2/token']);
    globalThis.fetch = async () => Response.json({ access_token: '' }); await assert.rejects(verifySandboxCredentials(), /Invalid PayPal sandbox token response/);
  }
  finally { globalThis.fetch = original; if (oldId === undefined) delete process.env.PAYPAL_SANDBOX_CLIENT_ID; else process.env.PAYPAL_SANDBOX_CLIENT_ID = oldId; if (oldSecret === undefined) delete process.env.PAYPAL_SANDBOX_CLIENT_SECRET; else process.env.PAYPAL_SANDBOX_CLIENT_SECRET = oldSecret; }
});

test('sandbox is unavailable without both credentials', async () => {
  const oldId = process.env.PAYPAL_SANDBOX_CLIENT_ID, oldSecret = process.env.PAYPAL_SANDBOX_CLIENT_SECRET;
  delete process.env.PAYPAL_SANDBOX_CLIENT_ID; delete process.env.PAYPAL_SANDBOX_CLIENT_SECRET;
  try { await assert.rejects(createSandboxOrder(), /not configured/); }
  finally { if (oldId !== undefined) process.env.PAYPAL_SANDBOX_CLIENT_ID = oldId; if (oldSecret !== undefined) process.env.PAYPAL_SANDBOX_CLIENT_SECRET = oldSecret; }
});
