// Offline: on a GitHub commit list the author's name links to "commits by this person", not to their profile. It still gets
// an icon, which targets the account named in GitHub's own user hovercard. Other non-profile links get none.
import { chromium } from 'playwright-core';
import { chromePath } from './chrome-path.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const profile = await mkdtemp(path.join(tmpdir(), 'ut-gh-commit-')); let context;
const timer = setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 40000);
const body = `<!doctype html><meta charset="utf-8"><title>Commits</title><main>
<a data-hovercard-type="user" data-hovercard-url="/users/carol-dev/hovercard" href="/owner/repo/commits?author=carol-dev" aria-label="commits by carol-dev">carol-dev</a>
<a data-hovercard-type="user" data-hovercard-url="/users/carol-dev/hovercard" href="/carol-dev"><img alt="avatar"></a>
<a data-hovercard-type="repository" data-hovercard-url="/users/mallory/hovercard" href="/owner/repo/commits?author=mallory">not marked as a user</a>
<a data-hovercard-type="user" data-hovercard-url="/orgs/bigco/hovercard" href="/owner/repo/commits?author=x">no user hovercard</a>
<a href="/owner/repo/commit/abc123">Fix a bug</a></main>`;
try {
  const extension = path.resolve('extension');
  context = await chromium.launchPersistentContext(profile, { executablePath: chromePath(), headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  await (context.serviceWorkers()[0] || context.waitForEvent('serviceworker', { timeout: 15000 }));
  const page = await context.newPage();
  await page.route('https://github.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body }));
  await page.goto('https://github.com/owner/repo/commits/main/');
  await page.waitForTimeout(900);
  const beside = await page.evaluate(() => [...document.querySelectorAll('[data-universal-tip="true"]')].map(host => host.previousElementSibling?.textContent));
  assert.deepEqual(beside, ['carol-dev'], JSON.stringify(beside));
  const opened = context.waitForEvent('page'); await page.locator('[data-universal-tip]').first().click();
  assert.equal(new URL((await opened).url()).searchParams.get('url'), 'https://github.com/carol-dev');
  const plain = '<!doctype html><meta charset="utf-8"><title>Contributors</title><main><a class="prc-Link-Link-9ZwDx" href="/dave-dev">dave-dev</a> <a class="prc-Link-Link-9ZwDx" href="/features">Learn more</a> <a class="Truncate-text Truncate-text--primary" href="/erin-dev">erin-dev</a> <a class="prc-Link-Link-9ZwDx" href="/owner/repo/commits?author=dave-dev">12 commits</a></main>';
  await page.unroute('https://github.com/**'); await page.route('https://github.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: plain }));
  const names = async url => { await page.goto(url); await page.waitForTimeout(900); return page.evaluate(() => [...document.querySelectorAll('[data-universal-tip="true"]')].map(host => host.previousElementSibling?.textContent)); };
  assert.deepEqual(await names('https://github.com/owner/repo/graphs/contributors'), ['dave-dev', 'erin-dev'], 'Contributor names get an icon on the contributors page');
  assert.deepEqual(await names('https://github.com/owner/repo/discussions'), ['dave-dev', 'erin-dev'], 'and on the Discussions list');
  assert.deepEqual(await names('https://github.com/owner/repo/pulse'), [], 'The same plain links get none on any other page');
  console.log('PASS: a GitHub commit-list author link gets one icon that targets the account in its user hovercard; other non-profile links get none. Plain contributor names get an icon on the contributors page only.');
} finally { clearTimeout(timer); await context?.close(); await rm(profile, { recursive: true, force: true }); }
