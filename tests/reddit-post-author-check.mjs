// Offline: on a Reddit post fixture, the content script reports the unique post author.
import { chromium } from 'playwright-core';
import { chromePath } from './chrome-path.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const profile = await mkdtemp(path.join(tmpdir(), 'ut-reddit-post-')); let context;
const timer = setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 40000);
try {
  const extension = path.resolve('extension');
  context = await chromium.launchPersistentContext(profile, { executablePath: chromePath(), headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.route('https://www.reddit.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Post</title><shreddit-post><a href="/user/alice_r">u/alice_r</a></shreddit-post><shreddit-comment><a href="/user/bob">u/bob</a></shreddit-comment>' }));
  await page.goto('https://www.reddit.com/r/programming/comments/abc/title/');
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
  const author = await popup.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://www.reddit.com/r/programming/comments/abc/title/' });
    return chrome.tabs.sendMessage(tab.id, { type: 'read-post-author' });
  });
  assert.equal(author, 'https://www.reddit.com/user/alice_r/');
  console.log('PASS: a Reddit post fixture reports its unique author and ignores commenters.');
} finally {
  clearTimeout(timer);
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
