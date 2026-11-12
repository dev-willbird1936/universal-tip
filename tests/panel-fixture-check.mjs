// Offline extension-panel smoke test. The loopback server below is a test fixture, not a research provider.
import { chromium } from 'playwright-core';
import { chromePath } from './chrome-path.mjs';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const token = 'fixture-token-123456789012345678901234567890';
const fixture = {
  target: { platform: 'web', profileUrl: 'https://example.test/author', displayName: '<img src=x onerror="window.injected=1">' },
  status: 'Potential contact — unverified', checkedAt: new Date().toISOString(), cached: false,
  candidates: [{ candidate_type: 'paypal_me', candidate_value: 'javascript:alert(1)', source_url: 'javascript:alert(2)', retrieval_url: 'https://example.test/author', identity_association_status: 'unverified_page', contact_reliability_status: 'not_independently_verified', payment_authorization_status: 'not_authorized', reason: '<script>window.injected=2</script>', evidence_excerpt_or_hash: 'sha256:test' },
    { candidate_type: 'paypal_me', candidate_value: 'https://paypal.me/fixtureuser', source_url: 'https://example.test/author', identity_association_status: 'direct_profile', decision: 'published_payment_link', payment_authorization_status: 'not_authorized', reason: 'Listed.', evidence_excerpt_or_hash: 'sha256:test2' },
    { candidate_type: 'paypal_me', candidate_value: 'https://paypal.me/unconfirmed', source_url: 'https://example.test/author', identity_association_status: 'unverified_page', decision: 'potential_contact', payment_authorization_status: 'not_authorized', reason: 'Unconfirmed.', evidence_excerpt_or_hash: 'sha256:test3' },
    { candidate_type: 'paypal_me', candidate_value: 'https://paypal.me/FixtureUser', source_url: 'https://example.test/site', identity_association_status: 'linked_creator_site', decision: 'published_payment_link', payment_authorization_status: 'not_authorized', reason: 'Listed again with different capitals.', evidence_excerpt_or_hash: 'sha256:test4' }],
  sources: [], warnings: ['Untrusted content is displayed as text.'],
  assessments: [{ provider: 'Parallel fixture', question: 'Is verification needed?', answer: 0.99, citations: [{ url: 'https://example.test/source', title: 'Fixture citation' }], explanation: '<img src=x onerror="window.injected=3">' }, { provider: 'OpenRouter (nace-ai/drex-max)', question: 'Is the evidence relevant?', answer: 'refused', citations: [], explanation: 'The model refused this check; inspect the evidence manually.' }]
};
let requestCount = 0, sandboxCount = 0, streamMode = 'normal'; let approvalUrl = 'https://www.sandbox.paypal.com.evil.example/checkout';
const server = http.createServer((req, res) => {
  const origin = req.headers.origin || ''; const cors = /^chrome-extension:\/\/[a-p]{32}$/.test(origin) ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {};
  if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type, x-local-token' }); return res.end(); }
  if (req.method === 'POST' && req.url === '/sandbox/order' && req.headers['x-local-token'] === token) {
    sandboxCount++; req.resume(); res.writeHead(200, { ...cors, 'content-type': 'application/json' }); return res.end(JSON.stringify({ approvalUrl }));
  }
  if (req.method !== 'POST' || req.url !== '/lookup/stream' || req.headers['x-local-token'] !== token) { res.writeHead(404, cors); return res.end(); }
  requestCount++; req.resume(); res.writeHead(200, { ...cors, 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' });
  if (streamMode === 'result-then-error') return res.end(`${JSON.stringify({ type: 'result', value: fixture })}\n${JSON.stringify({ type: 'error', error: 'fixture failed after result' })}\n`);
  res.write(`${JSON.stringify({ type: 'progress', message: 'Checking fixture stage…' })}\n`);
  setTimeout(() => res.end(`${JSON.stringify({ type: 'result', value: fixture })}\n`), 750);
});
const profile = await mkdtemp(path.join(tmpdir(), 'ut-panel-fixture-')); let context;
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4318, '127.0.0.1', resolve); });
  const extension = path.resolve('extension');
  context = await chromium.launchPersistentContext(profile, { executablePath: chromePath(), headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'); const id = new URL(worker.url()).host;
  await worker.evaluate(value => chrome.storage.local.set({ token: value }), token);
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.locator('#url').fill(`https://example.test/${'a'.repeat(2050)}`); const beforeOversized = context.pages().length;
  await popup.locator('button[type=submit]').click(); await popup.getByText('Enter a valid public HTTPS URL.').waitFor();
  assert.equal(context.pages().length, beforeOversized, 'An oversized target must not open a research panel');
  const panel = await context.newPage(); await panel.setViewportSize({ width: 320, height: 720 });
  await panel.goto(`chrome-extension://${id}/panel.html?url=${encodeURIComponent(`https://example.test/${'a'.repeat(1000)}`)}`);
  await panel.getByText('Checking fixture stage…').waitFor({ timeout: 10000 });
  await panel.getByText('Potential contact — unverified').waitFor({ timeout: 10000 });
  await panel.locator('#more').evaluate(el => { el.open = true; }); // the simple view folds the evidence away
  await panel.getByText('Evidence details').first().click();
  assert.match(await panel.locator('#result').innerText(), /Payment authorization: not authorized/);
  assert.match(await panel.locator('#result').innerText(), /may open a live payment service, not the sandbox demo/);
  assert.match(await panel.locator('#result').innerText(), /Estimated probability 99%/);
  assert.match(await panel.locator('#result').innerText(), /OpenRouter \(nace-ai\/drex-max\): Is the evidence relevant\? The model declined to answer; check the evidence yourself/);
  await panel.getByText('Review citations (1)').click(); assert.equal(await panel.getByRole('link', { name: 'Fixture citation' }).getAttribute('href'), 'https://example.test/source');
  assert.equal(await panel.locator('#result img, #result script').count(), 0, 'Untrusted strings must not become DOM nodes');
  assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Long targets must not overflow a narrow panel');
  assert.equal(await panel.evaluate(() => window.injected), undefined);
  assert.ok(await panel.getByText('Invalid source link').count() >= 2, 'Unsafe URLs must not become clickable links');
  assert.deepEqual(await panel.evaluate(() => [...document.querySelectorAll('#result p.source')].filter(p => p.textContent.startsWith('Also listed at')).map(p => p.textContent)), ['Also listed at: https://example.test/site'], 'A second source for the same destination is added to the first entry');
  const chips = await panel.evaluate(() => [...document.querySelectorAll('a.chip')].map(a => a.href));
  assert.deepEqual(chips, ['https://paypal.me/fixtureuser/3USD', 'https://paypal.me/fixtureuser/5USD', 'https://paypal.me/fixtureuser/10USD'], 'Amount buttons appear only for a confirmed PayPal.Me link, once per destination whatever its capital letters');
  assert.match(await panel.locator('#result').innerText(), /You review and confirm the payment on PayPal/);
  await panel.locator('#result > section').filter({ has: panel.locator('a.chip') }).first().screenshot({ path: 'output/playwright/panel-chips.png' });
  assert.equal(requestCount, 1);
  const pagesBefore = context.pages().length; panel.once('dialog', dialog => dialog.accept());
  await panel.getByRole('button', { name: 'Open $1 sandbox demo' }).click();
  await panel.getByText('Sandbox unavailable: Unexpected sandbox approval URL').waitFor();
  assert.equal(context.pages().length, pagesBefore, 'A lookalike PayPal host must not be opened');
  approvalUrl = 'https://www.sandbox.paypal.com/checkoutnow?token=fixture';
  await context.route('https://www.sandbox.paypal.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Offline sandbox fixture</title>' }));
  panel.once('dialog', dialog => dialog.accept()); const checkoutPage = context.waitForEvent('page');
  await panel.getByRole('button', { name: 'Open $1 sandbox demo' }).click(); const checkout = await checkoutPage;
  await checkout.waitForLoadState(); assert.equal(new URL(checkout.url()).hostname, 'www.sandbox.paypal.com'); assert.equal(sandboxCount, 2);
  streamMode = 'result-then-error'; const failedPanel = await context.newPage();
  await failedPanel.goto(`chrome-extension://${id}/panel.html?url=${encodeURIComponent('https://example.test/author')}`);
  await failedPanel.getByText('Research unavailable: fixture failed after result').waitFor();
  assert.equal(await failedPanel.locator('#result').innerText(), '', 'A failed stream must not leave stale evidence visible');
  assert.equal(await failedPanel.getByRole('button', { name: 'Try again' }).isVisible(), true);
  assert.equal(await failedPanel.locator('#proofnote').isVisible(), false, 'The note about published links is hidden when nothing was found');
  assert.equal(await panel.locator('#proofnote').isVisible(), true, 'and shown beside real evidence');
  assert.equal(await panel.getByRole('heading', { name: 'Published evidence' }).count(), 1); assert.equal(await panel.getByRole('heading', { name: 'Unconfirmed leads' }).count(), 0);
  assert.equal(await panel.getByText('Look for the site owner').count(), 0, 'No home-page suggestion when a link is already confirmed');
  const refused = await context.newPage(); await refused.goto(`chrome-extension://${id}/panel.html?url=${encodeURIComponent('https://x.com/fixture_user')}`);
  await refused.getByText(/^Research unavailable/).waitFor();
  assert.equal(await refused.locator('#result a.cta').getAttribute('href'), 'https://x.com/fixture_user', 'A refused X lookup offers the profile page as the main button');
  console.log('PASS: fixture progress, amount buttons only for a confirmed PayPal.Me link, evidence labels, advisory assessment, hostile text/link rendering and isolated sandbox URL handling. No live provider was called.');
} finally {
  if (context) await context.close();
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
