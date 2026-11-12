// Offline: the popup's "Use current page" on a GitHub repository researches the owner.
import { chromium } from 'playwright-core';
import { chromePath } from './chrome-path.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const profile = await mkdtemp(path.join(tmpdir(), 'ut-popup-repo-')); let context;
const timer = setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 40000);
try {
  const extension = path.resolve('extension');
  context = await chromium.launchPersistentContext(profile, { executablePath: chromePath(), headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(worker.url()).host;
  const repo = await context.newPage();
  await repo.route('https://github.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Repo</title><h1>tool</h1>' }));
  await repo.goto('https://github.com/alice/tool');
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://github.com/alice/tool' });
    chrome.tabs.query = async () => [tab];
  });
  const opened = context.waitForEvent('page');
  await popup.locator('#current').click();
  const panel = await opened;
  assert.equal(new URL(panel.url()).searchParams.get('url'), 'https://github.com/alice');
  console.log('PASS: Use current page on a GitHub repository researches the owner.');
} finally {
  clearTimeout(timer);
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
