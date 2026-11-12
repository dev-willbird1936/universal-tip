// Offline: on an X status fixture, the content script reports the post author from User-Name, ignoring mentions.
import { chromium } from 'playwright-core';
import { chromePath } from './chrome-path.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const profile = await mkdtemp(path.join(tmpdir(), 'ut-x-post-')); let context;
const timer = setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 40000);
try {
  const extension = path.resolve('extension');
  context = await chromium.launchPersistentContext(profile, { executablePath: chromePath(), headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.route('https://x.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Post</title><article><div data-testid="User-Name"><a href="/alice_dev">@alice_dev</a></div><div data-testid="tweetText"><a href="/mentioned">@mentioned</a></div></article>' }));
  await page.goto('https://x.com/alice_dev/status/1');
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
  const author = await popup.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://x.com/alice_dev/status/1' });
    return chrome.tabs.sendMessage(tab.id, { type: 'read-post-author' });
  });
  assert.equal(author, 'https://x.com/alice_dev');
  await page.goto('https://x.com/bob_reply/status/2');
  const reply = await popup.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://x.com/bob_reply/status/2' });
    return chrome.tabs.sendMessage(tab.id, { type: 'read-post-author' });
  });
  assert.equal(reply, 'https://x.com/bob_reply');
  console.log('PASS: an X status fixture reports the post author and a reply permalink reports the reply author.');
} finally {
  clearTimeout(timer);
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
