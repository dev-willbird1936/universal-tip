import { chromium } from 'playwright-core';
import { chromePath } from './chrome-path.mjs';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const profile = await mkdtemp(path.join(tmpdir(), 'ut-live-github-')); let context;
try {
  context = await chromium.launchPersistentContext(profile, { executablePath: chromePath(), headless: true, args: [`--disable-extensions-except=${path.resolve('extension')}`, `--load-extension=${path.resolve('extension')}`] });
  const page = await context.newPage(); await page.goto('https://github.com/facebook/react/issues', { waitUntil: 'domcontentloaded', timeout: 45000 });
  try { await page.locator('[data-universal-tip]').first().waitFor({ timeout: 15000 }); }
  catch {
    const evidence = await page.evaluate(() => ({ title: document.title, url: location.href, body: document.body.innerText.slice(0, 900), authors: [...document.querySelectorAll('button, a')].filter(a => /Filter by author/i.test(a.getAttribute('aria-label') || '') || /filter by author/i.test(a.textContent)).slice(0, 5).map(a => a.outerHTML.slice(0, 1400)) }));
    console.log(JSON.stringify(evidence, null, 2)); throw new Error('No visible inline icon on live GitHub issue list');
  }
  console.log(`Live GitHub author icons found: ${await page.locator('[data-universal-tip]').count()}`);
  await mkdir('output/playwright', { recursive: true }); await page.screenshot({ path: 'output/playwright/live-github.png' });
  const box = await page.locator('[data-universal-tip]').first().boundingBox();
  const hit = await page.evaluate(({x,y}) => document.elementFromPoint(x, y)?.outerHTML.slice(0, 500), { x: box.x + box.width / 2, y: box.y + box.height / 2 }); console.log('Icon hit test:', hit);
  const messages = []; page.on('console', msg => { if (msg.type() === 'error' || msg.text().startsWith('TIP_DEBUG')) messages.push(msg.text()); }); page.on('pageerror', error => messages.push(error.message));
  await page.evaluate(() => { for (const type of ['pointerdown', 'pointerup', 'click']) document.addEventListener(type, e => { const hit = document.elementFromPoint(e.clientX, e.clientY); const host = hit?.closest('[data-universal-tip]'); console.log('TIP_DEBUG', type, e.composedPath().slice(0, 5).map(n => n.tagName || n.nodeName).join('/'), 'hit=', hit?.outerHTML.slice(0, 200), 'author=', host?.previousElementSibling?.outerHTML.slice(0, 400)); }, true); });
  console.log('Extension service workers:', context.serviceWorkers().map(w => w.url()));
  const next = context.waitForEvent('page', { timeout: 10000 }); await page.locator('[data-universal-tip]').first().click();
  let panel;
  try { panel = await next; } catch (error) { console.log(JSON.stringify({ currentUrl: page.url(), pages: context.pages().map(p => p.url()), messages })); throw error; }
  await panel.waitForLoadState('domcontentloaded');
  const target = new URL(panel.url()).searchParams.get('url');
  if (!/^https:\/\/github\.com\/[a-z\d-]+$/i.test(target || '')) throw new Error('Inline click did not produce an attributable GitHub profile URL');
  console.log('Live GitHub icon opened an attributable profile in the extension panel.');
} finally { if (context) await context.close(); await rm(profile, { recursive: true, force: true }); }
