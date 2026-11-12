// Offline: on GitHub the content script reads a person's profile page (name, bio, website/social links, pinned repositories)
// as the server's fallback when GitHub's hourly API allowance is used up. Organization-style pages yield nothing.
import { chromium } from 'playwright-core';
import { chromePath } from './chrome-path.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startStatusStub } from './fixtures/status-stub.mjs';
const profile = await mkdtemp(path.join(tmpdir(), 'ut-ghpage-')); let context;
const timer = setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 70000);
const profileHtml = `<!doctype html><meta charset="utf-8"><title>alice</title>
<h1 class="vcard-names"><span class="p-name vcard-fullname" itemprop="name"> Alice Dev </span><span class="p-nickname vcard-username" itemprop="additionalName"> alice · she/her </span></h1>
<div class="p-note user-profile-bio" data-bio-text="Maker. Tips: ko-fi.com/alicedev"><div>Maker. Tips: ko-fi.com/alicedev</div></div>
<ul class="vcard-details"><li itemprop="url"><a rel="nofollow me" href="http://alice.example">alice.example</a></li><li itemprop="social"><a href="https://mastodon.social/@alice">@alice</a></li><li itemprop="email"><a href="mailto:alice@example.com">mail</a></li></ul>
<ol><li class="pinned-item-list-item"><a href="/alice/tool">tool</a></li><li class="pinned-item-list-item"><a href="/someone-else/lib">lib</a></li><li class="pinned-item-list-item"><a href="/alice/tool">tool</a></li></ol>`;
const orgHtml = '<!doctype html><title>org</title><h1>Acme Org</h1><a href="https://paypal.me/notaperson">x</a>';
const issueHtml = '<!doctype html><title>Issues</title><main><a data-hovercard-type="user" href="/alice">alice</a></main>';
const stub = await startStatusStub({ github: true }); // the local server reports GitHub's allowance as used up
try {
  const extension = path.resolve('extension');
  context = await chromium.launchPersistentContext(profile, { executablePath: chromePath(), headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  const page = await context.newPage(); let profileLoads = 0;
  await page.route('https://github.com/**', route => { const p = new URL(route.request().url()).pathname; if (p === '/alice') profileLoads++; return route.fulfill({ status: 200, contentType: 'text/html', body: p === '/alice' ? profileHtml : p === '/acme' ? orgHtml : issueHtml }); });
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  // The popup says when a site's allowance is used up and what happens meanwhile.
  await popup.waitForFunction(() => /hourly allowance is used up/.test(document.querySelector('#connection')?.textContent || ''), null, { timeout: 8000 });
  assert.match(await popup.locator('#connection').textContent(), /GitHub's hourly allowance is used up for about 12 more minutes, so GitHub lookups use public files and the profile page meanwhile; a GitHub token \(below\) removes the limit\./);
  const ask = (tabUrl, message) => popup.evaluate(async ([u, m]) => { const [tab] = await chrome.tabs.query({ url: u }); return chrome.tabs.sendMessage(tab.id, m); }, [tabUrl, message]);
  const expected = { screen_name: 'alice', name: 'Alice Dev', description: 'Maker. Tips: ko-fi.com/alicedev', links: ['https://alice.example', 'https://mastodon.social/@alice'], repos: ['tool'] };

  await page.goto('https://github.com/alice'); await page.waitForTimeout(500); profileLoads = 0;
  assert.deepEqual(await ask('https://github.com/alice', { type: 'read-profile' }), expected, 'On the profile page itself, read what is on screen');
  assert.equal(profileLoads, 0, 'No extra page load when already on the profile');

  await page.goto('https://github.com/acme/tool/issues'); await page.waitForTimeout(500); profileLoads = 0;
  assert.deepEqual(await ask('https://github.com/acme/tool/issues', { type: 'read-profile', url: 'https://github.com/alice' }), expected, 'From another page: one page load');
  assert.equal(profileLoads, 1);
  assert.equal(await ask('https://github.com/acme/tool/issues', { type: 'read-profile', url: 'https://github.com/acme' }), null, 'A page that is not this person\'s profile yields nothing');

  // Clicking an icon passes the page data to the panel.
  const opened = context.waitForEvent('page'); await page.locator('[data-universal-tip]').first().click();
  const panel = await opened; const sent = JSON.parse(new URL(panel.url()).searchParams.get('xp') || 'null');
  assert.equal(sent?.screen_name, 'alice'); assert.deepEqual(sent.repos, ['tool']);
  // When the allowance is not used up, no profile page is loaded in the background; the page on screen can still be read.
  stub.state.limited = { github: false }; await page.waitForTimeout(5500); profileLoads = 0;
  assert.equal(await ask('https://github.com/acme/tool/issues', { type: 'read-profile', url: 'https://github.com/alice' }), null);
  assert.equal(profileLoads, 0, 'No background page load while the API can be used');
  await page.goto('https://github.com/alice'); await page.waitForTimeout(500);
  assert.deepEqual(await ask('https://github.com/alice', { type: 'read-profile' }), expected, 'The profile on screen is always readable');
  console.log('PASS: GitHub profile page read (on-screen and one page load), organization pages skipped, the icon click passes it to the panel, and no background page load happens unless the API allowance is used up.');
} finally { clearTimeout(timer); await stub.close(); await context?.close(); await rm(profile, { recursive: true, force: true }); }
