import { chromium } from 'playwright-core';
import { chromePath } from './chrome-path.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const executablePath = chromePath();
const root = process.cwd(); const extensionPath = path.join(root, 'extension');
const profile = await mkdtemp(path.join(tmpdir(), 'universal-tip-browser-'));
const token = 'test-token-only-'.repeat(4); let context; let serverOutput = '';
const startedLookups = () => serverOutput.split('\n').filter(line => line.startsWith('{') && line.endsWith('}')).map(line => JSON.parse(line)).filter(event => event.event === 'research' && event.outcome === 'started').length;
const server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, LOCAL_API_TOKEN: token, ENABLE_PARALLEL: '0', ENABLE_PARALLEL_SEARCH: '0', ENABLE_DREX: '0', OPENROUTER_API_KEY: '', CACHE_ENCRYPTION_KEY: '', PAYPAL_SANDBOX_CLIENT_ID: '', PAYPAL_SANDBOX_CLIENT_SECRET: '', GITHUB_TOKEN: '', REDDIT_ACCESS_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
const serverClosed = once(server, 'close'); server.stderr.resume();
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Local server did not start')), 10000);
    server.stdout.on('data', chunk => { serverOutput += String(chunk); if (serverOutput.includes('local backend:')) { clearTimeout(timer); resolve(); } });
    server.on('exit', code => { clearTimeout(timer); reject(new Error(`Local server exited ${code}`)); });
  });
  context = await chromium.launchPersistentContext(profile, { executablePath, headless: true, args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(worker.url()).host;
  const page = await context.newPage(); await page.goto(`chrome-extension://${id}/popup.html`);
  await page.getByText('Connected. Add your OpenRouter key').waitFor(); // pairing is automatic
  await page.locator('#url').fill('https://github.com/feross');
  const panelPromise = context.waitForEvent('page'); await page.locator('button[type=submit]').click();
  const panel = await panelPromise; await panel.waitForLoadState();
  try { await panel.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('Published payment link'), null, { timeout: 30000 }); }
  catch (error) { console.log('Popup result diagnostic:', JSON.stringify({ url: panel.url(), status: await panel.locator('#status').textContent(), details: (await panel.locator('#result').innerText()).slice(0, 800) })); throw error; }
  assert.match(await panel.locator('#result').innerText(), /GitHub|github/);
  await page.locator('#url').fill('https://github.com/zudsniper');
  const paypalEvidencePage = context.waitForEvent('page'); await page.locator('button[type=submit]').click();
  const paypalEvidence = await paypalEvidencePage; await paypalEvidence.waitForLoadState();
  await paypalEvidence.getByRole('link', { name: 'https://paypal.me/zudsniper', exact: true }).waitFor({ timeout: 45000 });
  assert.match(await paypalEvidence.locator('#status').innerText(), /not independently account-verified/);
  await paypalEvidence.locator('#more').evaluate(el => { el.open = true; }); // the simple view folds the evidence away
  const paypalSection = paypalEvidence.locator('#more > section').filter({ has: paypalEvidence.getByRole('link', { name: 'https://paypal.me/zudsniper', exact: true }) });
  await paypalSection.getByText('Evidence details').click();
  assert.match(await paypalSection.innerText(), /Payment authorization: not authorized/);
  await paypalEvidence.close();
  await mkdir(path.join(root, 'output', 'playwright'), { recursive: true });
  await panel.setViewportSize({ width: 400, height: 760 }); await panel.screenshot({ path: path.join(root, 'output', 'playwright', 'evidence-panel-narrow.png') });
  assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Narrow panel should not overflow horizontally');
  await panel.setViewportSize({ width: 720, height: 900 }); await panel.screenshot({ path: path.join(root, 'output', 'playwright', 'evidence-panel.png') });
  panel.once('dialog', dialog => dialog.accept()); await panel.getByRole('button', { name: 'Open $1 sandbox demo' }).click();
  await panel.getByText('Sandbox unavailable: PayPal sandbox credentials are not configured').waitFor();
  const beforeFeed = startedLookups();
  const fixture = await context.newPage();
  await fixture.route('https://github.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Fixture</title><main><a data-hovercard-type="user" href="/feross">feross</a></main>' }));
  await fixture.goto('https://github.com/fixture');
  await fixture.locator('[data-universal-tip]').waitFor();
  await fixture.evaluate(() => { for (let i = 0; i < 5; i++) document.body.append(document.createElement('div')); });
  await fixture.waitForTimeout(700);
  assert.equal(await fixture.locator('[data-universal-tip]').count(), 1);
  await fixture.evaluate(() => { const anchor = document.createElement('a'); anchor.setAttribute('data-hovercard-type', 'user'); anchor.href = '/octocat'; anchor.textContent = 'octocat'; document.querySelector('main').append(anchor); });
  await fixture.waitForFunction(() => document.querySelectorAll('[data-universal-tip]').length === 2);
  await fixture.evaluate(() => { const main = document.querySelector('main'); for (let i = 0; i < 130; i++) { const row = document.createElement('div'); row.className = 'feed-item'; const a = document.createElement('a'); a.setAttribute('data-hovercard-type', 'user'); a.href = `/person${i}`; a.textContent = `person${i}`; row.append(a); main.append(row); } });
  await fixture.waitForFunction(() => document.querySelectorAll('[data-universal-tip]').length === 120);
  await fixture.evaluate(() => { [...document.querySelectorAll('.feed-item')].slice(0, 40).forEach(row => row.remove()); });
  await fixture.waitForFunction(() => document.querySelectorAll('[data-universal-tip]').length === 92);
  assert.equal(startedLookups(), beforeFeed, 'Rendering authors or updating a feed must not start research');
  const recycledAuthor = fixture.locator('a[data-hovercard-type="user"]').first();
  await recycledAuthor.evaluate(node => { node.href = 'https://github.com/octocat'; node.textContent = 'octocat'; });
  const recycledPage = context.waitForEvent('page'); await fixture.locator('[data-universal-tip]').first().click();
  const recycledPanel = await recycledPage; await recycledPanel.waitForLoadState();
  assert.equal(new URL(recycledPanel.url()).searchParams.get('url'), 'https://github.com/octocat', 'A reused author node must never retain its previous identity'); await recycledPanel.close();
  await recycledAuthor.evaluate(node => { node.href = 'https://github.com/settings'; node.textContent = 'settings'; });
  await fixture.waitForFunction(() => document.querySelectorAll('[data-universal-tip]').length === 91);
  await recycledAuthor.evaluate(node => { node.href = 'https://github.com/feross'; node.textContent = 'feross'; });
  await fixture.waitForFunction(() => document.querySelectorAll('[data-universal-tip]').length === 92);
  const initialPages = context.pages().length; const icon = fixture.locator('[data-universal-tip]').first(); const iconBox = await icon.boundingBox();
  await fixture.mouse.move(iconBox.x + iconBox.width / 2, iconBox.y + iconBox.height / 2); await fixture.mouse.down();
  await recycledAuthor.evaluate(node => { node.href = 'https://github.com/octocat'; node.textContent = 'octocat'; });
  await fixture.mouse.up(); await fixture.waitForTimeout(100);
  assert.equal(context.pages().length, initialPages, 'An identity change during a click must cancel the lookup');
  await recycledAuthor.evaluate(node => { node.href = 'https://github.com/feross'; node.textContent = 'feross'; });
  await fixture.mouse.move(iconBox.x + iconBox.width / 2, iconBox.y + iconBox.height / 2); await fixture.mouse.down(); await fixture.mouse.move(iconBox.x + 80, iconBox.y + 80); await fixture.mouse.up();
  await fixture.waitForTimeout(100); assert.equal(context.pages().length, initialPages, 'A cancelled drag must not start research');
  const clicked = context.waitForEvent('page'); await icon.click();
  const fromIcon = await clicked; await fromIcon.waitForLoadState(); assert.equal(context.pages().length, initialPages + 1, 'One click must open only one panel');
  try { await fromIcon.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('Published payment link'), null, { timeout: 30000 }); }
  catch (error) { console.log('Inline result diagnostic:', JSON.stringify({ url: fromIcon.url(), status: await fromIcon.locator('#status').textContent(), details: (await fromIcon.locator('#result').innerText()).slice(0, 800) })); throw error; }
  await worker.evaluate(() => chrome.storage.local.set({ token: 'invalid-token' }));
  await fromIcon.getByRole('button', { name: 'Report wrong match and hide this profile' }).click();
  await fromIcon.getByText('Reported locally — this profile is hidden').waitFor();
  await fromIcon.getByText('The local cache could not be cleared', { exact: false }).waitFor();
  await worker.evaluate(value => chrome.storage.local.set({ token: value }), token);
  await fromIcon.getByRole('button', { name: 'Undo report and allow research' }).click();
  await fromIcon.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('Published payment link'), null, { timeout: 60000 });
  await fromIcon.getByRole('button', { name: 'Report wrong match and hide this profile' }).click();
  await fromIcon.getByText('The local research cache was cleared.', { exact: false }).waitFor();
  await fromIcon.getByRole('button', { name: 'Undo report and allow research' }).click();
  await fromIcon.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('Published payment link'), null, { timeout: 60000 });
  await fixture.bringToFront(); await fixture.waitForTimeout(850);
  await fixture.locator('a[data-hovercard-type="user"]').first().focus(); await fixture.keyboard.press('Tab');
  assert.equal(await fixture.evaluate(() => document.activeElement?.hasAttribute('data-universal-tip')), true, 'Inline icon should be keyboard focusable');
  const keyboardPanel = context.waitForEvent('page'); await fixture.keyboard.press('Enter'); const openedByKeyboard = await keyboardPanel; await openedByKeyboard.waitForLoadState();
  assert.match(openedByKeyboard.url(), /panel\.html\?url=/);
  const reddit = await context.newPage();
  await reddit.route('https://www.reddit.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Reddit fixture</title><article><a href="/user/example_user/">example_user</a></article><div id="shadow-host"></div><script>document.querySelector("#shadow-host").attachShadow({mode:"open"}).innerHTML = \'<a href="/user/second_user/">second_user</a>\'</script>' }));
  await reddit.goto('https://www.reddit.com/fixture'); await reddit.locator('[data-universal-tip]').first().waitFor();
  await reddit.waitForFunction(() => document.querySelector('#shadow-host')?.shadowRoot?.querySelector('[data-universal-tip]'));
  await reddit.evaluate(() => { for (let i = 0; i < 45; i++) { const node = document.createElement('div'); node.className = 'shadow-feed'; node.attachShadow({ mode: 'open' }).innerHTML = `<a href="/user/person_${i}/">person_${i}</a>`; document.body.append(node); } });
  await reddit.waitForFunction(() => document.querySelector('.shadow-feed')?.shadowRoot?.querySelector('[data-universal-tip]'));
  await reddit.evaluate(() => { [...document.querySelectorAll('.shadow-feed')].slice(0, 10).forEach(node => node.remove()); });
  await reddit.evaluate(() => { const node = document.createElement('div'); node.id = 'new-shadow-author'; node.attachShadow({ mode: 'open' }).innerHTML = '<a href="/user/fresh_author/">fresh_author</a>'; document.body.append(node); });
  await reddit.waitForFunction(() => document.querySelector('#new-shadow-author')?.shadowRoot?.querySelector('[data-universal-tip]'));
  const generic = await context.newPage();
  await generic.route('https://creator.example/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Author fixture</title><a rel="author" href="https://creator.example/profile">Author</a><a href="https://creator.example/other">Other</a>' }));
  await generic.goto('https://creator.example/article'); await generic.addScriptTag({ path: path.join(extensionPath, 'dist', 'content.js') });
  await generic.locator('[data-universal-tip]').waitFor(); await generic.addScriptTag({ path: path.join(extensionPath, 'dist', 'content.js') }); assert.equal(await generic.locator('[data-universal-tip]').count(), 1);
  console.log('PASS: unpacked MV3 extension, pairing, live GitHub lookup, popup, inline click, keyboard/drag, feed recycling, local report/undo, sandbox missing-credentials state, Reddit and generic DOM fixtures.');
  console.log('Screenshot: output/playwright/evidence-panel.png');
} finally {
  if (context) await context.close(); if (server.exitCode === null) server.kill(); await serverClosed; await rm(profile, { recursive: true, force: true });
}
