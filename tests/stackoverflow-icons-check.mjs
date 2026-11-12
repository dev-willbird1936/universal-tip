// Offline: Stack Overflow name links get an icon tied to the numeric user ID; avatars and ID-less links do not.
import { chromium } from 'playwright-core';
import { chromePath } from './chrome-path.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startStatusStub } from './fixtures/status-stub.mjs';
const profile = await mkdtemp(path.join(tmpdir(), 'ut-so-')); let context;
const timer = setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 40000);
const body = `<!doctype html><meta charset="utf-8"><title>Q</title>
<div class="user-info"><div class="user-gravatar32" data-user-id="224132"><a href="/users/peter-cordes"><img alt="avatar"></a></div>
<div class="user-details"><a href="/users/peter-cordes" data-user-id="224132">Peter Cordes</a></div></div>
<span class="comment-copy">nice</span> <a class="comment-user" href="/users/899213/raphael">Raphael</a>
<div class="user-details"><a href="/users/no-id-here">Nameless</a></div>
<div class="user-details"><a href="/users/157882">Wiki Answerer</a></div>
<div class="s-user-card"><a href="/users/342235/lister"><img alt="avatar"></a><div class="s-user-card--link"><a class="flex--item" href="/users/342235/lister">Lister</a></div><time class="s-user-card--time">asked <a href="/questions/9/x">a question</a></time></div>`;
const stub = await startStatusStub({ stackoverflow: true }); // the local server reports the API allowance as used up
try {
  const extension = path.resolve('extension');
  context = await chromium.launchPersistentContext(profile, { executablePath: chromePath(), headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const page = await context.newPage();
  await page.route('https://stackoverflow.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body }));
  await page.goto('https://stackoverflow.com/questions/1/example');
  await page.waitForFunction(() => document.querySelectorAll('[data-universal-tip]').length >= 2, null, { timeout: 10000 });
  await page.waitForTimeout(600);
  const owners = await page.evaluate(() => [...document.querySelectorAll('[data-universal-tip]')].filter(n => n.dataset.universalTip !== 'float').map(n => n.previousElementSibling?.textContent.trim()));
  assert.deepEqual(owners, ['Peter Cordes', 'Raphael', 'Wiki Answerer', 'Lister'], 'A name link without the ID marker still gets an icon when its address carries the numeric ID; one with no ID does not');
  const opened = context.waitForEvent('page'); await page.locator('[data-universal-tip]').first().click();
  const panel = await opened; assert.equal(new URL(panel.url()).searchParams.get('url'), 'https://stackoverflow.com/users/224132');
  await page.unroute('https://stackoverflow.com/**');
  await page.route('https://stackoverflow.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: route.request().url().includes('/users/') ? '<!doctype html><form><input name="q" value="user:224132"></form><div class="fs-headline2">Peter Cordes</div><a rel="me noreferrer" href="http://pc.example">site</a><div class="js-about-me-content"><p>Tips: <a href="https://ko-fi.com/pc">ko-fi.com/pc</a> and <a href="https://stackoverflow.com/questions/1">q</a></p></div>' : '<!doctype html><div id="question"><div class="post-signature"><div class="user-details"><a data-user-id="5" href="/users/editor">Editor</a></div></div><div class="post-signature owner"><div class="user-details"><a data-user-id="87234" href="/users/gman">GMan</a></div></div></div>' }));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  const ask = async url => { await page.goto(url); await page.waitForTimeout(500); return popup.evaluate(async u => { const [tab] = await chrome.tabs.query({ url: u }); return chrome.tabs.sendMessage(tab.id, { type: 'read-so-user' }); }, url); };
  assert.equal(await ask('https://stackoverflow.com/users/peter-cordes'), 'https://stackoverflow.com/users/224132');
  assert.equal(await ask('https://stackoverflow.com/questions/2/example'), 'https://stackoverflow.com/users/87234', 'The asker, not an editor');
  const read = await popup.evaluate(async () => { const [tab] = await chrome.tabs.query({ url: 'https://stackoverflow.com/questions/2/example' }); return chrome.tabs.sendMessage(tab.id, { type: 'read-profile', url: 'https://stackoverflow.com/users/224132' }); });
  assert.deepEqual(read, { screen_name: '224132', name: 'Peter Cordes', description: 'Tips: ko-fi.com/pc and q', links: ['https://ko-fi.com/pc'], website: 'https://pc.example' }, 'Profile page read used as the API fallback');
  const heading = async url => { await page.goto(url); await page.waitForTimeout(700); return page.evaluate(() => [...document.querySelectorAll('[data-universal-tip="true"]')].map(host => host.previousElementSibling?.className + ':' + host.previousElementSibling?.textContent)); };
  assert.deepEqual(await heading('https://stackoverflow.com/users/224132/peter-cordes'), ['fs-headline2:Peter Cordes'], 'The name on a profile page gets an icon');
  assert.deepEqual(await heading('https://stackoverflow.com/users/peter-cordes'), [], 'No icon when the profile address carries no numeric ID');
  console.log('PASS: Stack Overflow fixture: icons on name and comment links keyed by numeric user ID; avatars and ID-less links skipped; Use current page reads the ID on a name-style profile and the asker on a question.');
} finally { clearTimeout(timer); await stub.close(); await context?.close(); await rm(profile, { recursive: true, force: true }); }
