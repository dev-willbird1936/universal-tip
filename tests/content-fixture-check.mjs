// Offline author-icon behavior in the real unpacked extension. No backend or provider is started.
import { chromium } from 'playwright-core';
import { chromePath } from './chrome-path.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const profile = await mkdtemp(path.join(tmpdir(), 'ut-content-fixture-')); let context;
try {
  const extension = path.resolve('extension');
  context = await chromium.launchPersistentContext(profile, { executablePath: chromePath(), headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const page = await context.newPage(); let localRequests = 0;
  context.on('request', request => { if (request.url().startsWith('http://127.0.0.1:4318/')) localRequests++; });
  await page.route('https://github.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Fixture</title><main><a data-hovercard-type="user" href="/alice">alice</a></main>' }));
  await page.goto('https://github.com/example'); await page.locator('[data-universal-tip]').waitFor();
  await page.evaluate(() => { const root = document.querySelector('main'); for (let i = 0; i < 140; i++) { const row = document.createElement('div'); row.className = 'row'; const a = document.createElement('a'); a.href = `/person${i}`; a.setAttribute('data-hovercard-type', 'user'); a.textContent = `person${i}`; row.append(a); root.append(row); } });
  await page.waitForFunction(() => document.querySelectorAll('[data-universal-tip]').length === 120);
  await page.evaluate(() => { [...document.querySelectorAll('.row')].slice(0, 40).forEach(row => row.remove()); });
  await page.waitForFunction(() => document.querySelectorAll('[data-universal-tip]').length === 101);
  assert.equal(localRequests, 0, 'Rendering and DOM updates must not start research');
  const author = page.locator('a[data-hovercard-type="user"]').first();
  await author.evaluate(node => { node.href = 'https://github.com/bob'; node.textContent = 'bob'; });
  const opened = context.waitForEvent('page'); await page.locator('[data-universal-tip]').first().click(); const panel = await opened;
  assert.equal(new URL(panel.url()).searchParams.get('url'), 'https://github.com/bob', 'A recycled author must use its current identity'); await panel.close();
  const icon = page.locator('[data-universal-tip]').first(); const box = await icon.boundingBox(); const pages = context.pages().length;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await author.evaluate(node => { node.href = 'https://github.com/alice'; node.textContent = 'alice'; });
  await page.mouse.up(); await page.waitForTimeout(100); assert.equal(context.pages().length, pages, 'Changing identity during a click must cancel it');
  await author.evaluate(node => { node.href = 'https://github.com/settings'; node.textContent = 'settings'; });
  await page.waitForFunction(() => document.querySelectorAll('[data-universal-tip]').length === 100);
  await author.evaluate(node => { node.href = 'https://github.com/alice'; node.textContent = 'alice'; });
  await page.waitForFunction(() => document.querySelectorAll('[data-universal-tip]').length === 101);
  console.log('PASS: offline author detection, feed cap/recycling, in-place identity changes and click cancellation.');
} finally { if (context) await context.close(); await rm(profile, { recursive: true, force: true }); }
