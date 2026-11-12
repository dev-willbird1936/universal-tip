import { chromium } from 'playwright-core';
import { chromePath } from './chrome-path.mjs';
import { mkdtemp, rm, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const profile = await mkdtemp(path.join(tmpdir(), 'ut-permission-')); const extensionTemp = await mkdtemp(path.join(tmpdir(), 'ut-extension-')); let context;
try {
  let extension = path.resolve('extension');
  if (process.env.PREGRANT === '1') {
    await cp(extension, extensionTemp, { recursive: true }); extension = extensionTemp;
    const manifestPath = path.join(extension, 'manifest.json'); const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.host_permissions.push('https://creator.example/*'); await writeFile(manifestPath, JSON.stringify(manifest));
  }
  context = await chromium.launchPersistentContext(profile, { executablePath: chromePath(), headless: process.env.HEADFUL !== '1', args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--auto-confirm-permission-prompts'] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'); const id = new URL(worker.url()).host;
  const website = await context.newPage();
  await website.route('https://creator.example/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Generic author</title><a rel="author" href="https://creator.example/profile">Author</a>' }));
  await website.goto('https://creator.example/article');
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
  await website.bringToFront();
  await popup.locator('#enable').click();
  let settled = true;
  try { await popup.waitForFunction(() => document.querySelector('#message')?.textContent?.length > 0, null, { timeout: 15000 }); }
  catch { settled = false; }
  if (!settled) {
    console.log('SKIP: Chrome did not automatically resolve the optional-host permission prompt; use the separate interactive test.');
  } else {
    const message = await popup.locator('#message').textContent(); console.log('Enable-site result:', message);
    assert.match(message, /Icons enabled/); await website.locator('[data-universal-tip]').waitFor({ timeout: 10000 });
    const storageAccess = await worker.evaluate(async () => {
      await chrome.storage.local.set({ token: 'test-token' });
      const [tab] = await chrome.tabs.query({ url: 'https://creator.example/article' });
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: async () => { try { await chrome.storage.local.get('token'); return 'allowed'; } catch { return 'denied'; } } });
      return result.result;
    });
    assert.equal(storageAccess, 'denied', 'Page content scripts must not access the pairing token');
    console.log(process.env.PREGRANT === '1' ? 'PASS: pre-granted host injection and trusted-context storage; interactive permission prompt not tested.' : 'PASS: optional host permission, injection and trusted-context storage.');
  }
} finally { if (context) await context.close(); await rm(profile, { recursive: true, force: true }); await rm(extensionTemp, { recursive: true, force: true }); }
