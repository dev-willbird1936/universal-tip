// Offline: on a Reddit comment permalink fixture, the content script reports that comment's author.
import { chromium } from 'playwright-core';
import { chromePath } from './chrome-path.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const profile = await mkdtemp(path.join(tmpdir(), 'ut-reddit-comment-')); let context;
const timer = setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 40000);
try {
  const extension = path.resolve('extension');
  context = await chromium.launchPersistentContext(profile, { executablePath: chromePath(), headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.route('https://www.reddit.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Comment</title><shreddit-post><a href="/user/alice_r">u/alice_r</a></shreddit-post><shreddit-comment author="bob_c" thingid="t1_abc123" permalink="/r/programming/comments/xyz/comment/abc123/"><a href="/user/bob_c">u/bob_c</a></shreddit-comment>' }));
  await page.goto('https://www.reddit.com/r/programming/comments/xyz/title/comment/abc123/');
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
  const author = await popup.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://www.reddit.com/r/programming/comments/xyz/title/comment/abc123/' });
    return chrome.tabs.sendMessage(tab.id, { type: 'read-comment-author', url: tab.url });
  });
  assert.equal(author, 'https://www.reddit.com/user/bob_c/');
  console.log('PASS: a Reddit comment permalink fixture reports the comment author, not the post author.');
} finally {
  clearTimeout(timer);
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
