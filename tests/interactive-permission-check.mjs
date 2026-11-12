// Manual/headful smoke test: the operator must accept the Chrome extension prompt.
// Uses an isolated temporary profile and a routed fixture, never the user's browser profile.
import { chromium } from 'playwright-core';
import { chromePath } from './chrome-path.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const profile = await mkdtemp(path.join(tmpdir(), 'ut-interactive-permission-')); let context;
try {
  const extension = path.resolve('extension');
  context = await chromium.launchPersistentContext(profile, { executablePath: chromePath(), headless: false, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--window-size=1000,800'] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'); const id = new URL(worker.url()).host;
  const website = await context.newPage();
  await website.route('https://creator.example/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Universal Tip Permission Fixture</title><a rel="author" href="https://creator.example/profile">Author</a>' }));
  await website.goto('https://creator.example/article');
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
  await website.bringToFront();
  await popup.locator('#enable').click();
  console.log('PROMPT: inspect and accept only the temporary fixture site permission in this isolated test browser.');
  await popup.waitForFunction(() => document.querySelector('#message')?.textContent?.length > 0, null, { timeout: 90000 });
  const message = await popup.locator('#message').textContent(); console.log('Enable-site result:', message);
  assert.match(message, /Icons enabled/); await website.locator('[data-universal-tip]').waitFor({ timeout: 10000 });
  console.log('PASS: actual optional-host permission prompt and generic icon injection.');
} finally { if (context) await context.close(); await rm(profile, { recursive: true, force: true }); }
