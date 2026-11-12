// Offline: Use current page on an X profile fixture reads the full bio link even when X shows it shortened with an ellipsis.
import { chromium } from 'playwright-core';
import { chromePath } from './chrome-path.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const profile = await mkdtemp(path.join(tmpdir(), 'ut-x-profile-')); let context;
const timer = setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 40000);
const hidden = '<span style="position:absolute;opacity:0;width:0;overflow:hidden">';
const body = `<!doctype html><meta charset="utf-8"><title>Alice</title><main><div data-testid="UserName"><span>Alice Example</span></div>
<div data-testid="UserDescription">Tips: <a href="https://t.co/abc">${hidden}https://</span>paypal.me/averylongtipn${hidden}ame</span><span aria-hidden="true">…</span></a></div>
<a data-testid="UserUrl" href="https://t.co/def">ko-fi.com/alice</a></main>`;
try {
  const extension = path.resolve('extension');
  context = await chromium.launchPersistentContext(profile, { executablePath: chromePath(), headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  const page = await context.newPage();
  await page.route('https://x.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body }));
  await page.goto('https://x.com/alice_example');
  await page.waitForTimeout(800);
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  const read = await popup.evaluate(async () => { const [tab] = await chrome.tabs.query({ url: 'https://x.com/alice_example' }); return chrome.tabs.sendMessage(tab.id, { type: 'read-profile' }); });
  assert.deepEqual(read?.links, ['https://paypal.me/averylongtipname', 'https://ko-fi.com/alice'], JSON.stringify(read));
  console.log('PASS: an X profile fixture yields the full bio link despite X\'s shortened display, plus the website field.');
} finally { clearTimeout(timer); await context?.close(); await rm(profile, { recursive: true, force: true }); }
