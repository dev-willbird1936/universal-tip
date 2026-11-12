// Offline: on a GitHub issue fixture, the content script reports the issue author, not assignees or participants.
import { chromium } from 'playwright-core';
import { chromePath } from './chrome-path.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const profile = await mkdtemp(path.join(tmpdir(), 'ut-gh-issue-')); let context;
const timer = setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 40000);
try {
  const extension = path.resolve('extension');
  context = await chromium.launchPersistentContext(profile, { executablePath: chromePath(), headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.route('https://github.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Issue</title><div class="assignee"><a href="/maintainer">Maintainer</a></div><div class="titleSection"><a class="authorLoginLink__x" href="https://github.com/reporter">Reporter (reporter)</a></div><div class="participants"><a href="/someone">someone</a></div>' }));
  await page.goto('https://github.com/acme/tool/issues/7');
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
  const author = await popup.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://github.com/acme/tool/issues/7' });
    return chrome.tabs.sendMessage(tab.id, { type: 'read-issue-author' });
  });
  assert.equal(author, 'https://github.com/reporter');
  await page.unroute('https://github.com/**');
  await page.route('https://github.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>PR</title><div class="TimelineItem"><a class="author" href="/opener">opener</a></div><div><a class="author" href="/reviewer">reviewer</a></div>' }));
  await page.goto('https://github.com/acme/tool/pull/8');
  const pr = await popup.evaluate(async () => { const [tab] = await chrome.tabs.query({ url: 'https://github.com/acme/tool/pull/8' }); return chrome.tabs.sendMessage(tab.id, { type: 'read-issue-author' }); });
  assert.equal(pr, 'https://github.com/opener');
  await page.unroute('https://github.com/**');
  await page.route('https://github.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>PR</title><a class="author" href="/apps/dependabot">dependabot</a>' }));
  await page.goto('https://github.com/acme/tool/pull/9');
  const bot = await popup.evaluate(async () => { const [tab] = await chrome.tabs.query({ url: 'https://github.com/acme/tool/pull/9' }); return chrome.tabs.sendMessage(tab.id, { type: 'read-issue-author' }); });
  assert.equal(bot, null, 'A bot app is not a person to tip');
  console.log('PASS: GitHub issue and pull request fixtures report the human author; assignees, reviewers and bot apps are ignored.');
} finally {
  clearTimeout(timer);
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
