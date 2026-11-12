// Offline: after a site is already granted, "Use current page" researches a uniquely credited author.
import { chromium } from 'playwright-core';
import { chromePath } from './chrome-path.mjs';
import { mkdtemp, rm, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const profile = await mkdtemp(path.join(tmpdir(), 'ut-credit-fixture-'));
const extensionTemp = await mkdtemp(path.join(tmpdir(), 'ut-credit-ext-'));
let context;
const timer = setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 45000);
try {
  await cp(path.resolve('extension'), extensionTemp, { recursive: true });
  const manifestPath = path.join(extensionTemp, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.host_permissions.push('https://blog.example/*', 'https://news.example/*');
  await writeFile(manifestPath, JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, { executablePath: chromePath(), headless: true, args: [`--disable-extensions-except=${extensionTemp}`, `--load-extension=${extensionTemp}`] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(worker.url()).host;
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
  const page = await context.newPage();
  await page.route('https://blog.example/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Post</title><meta name="twitter:creator" content="@alice_dev"><p>Hello</p>' }));
  await page.goto('https://blog.example/post');
  const credit = await popup.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://blog.example/post' });
    const injected = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
      const attr = name => document.querySelector(`meta[name="${name}"], meta[property="${name}"]`)?.content?.trim() || '';
      const handles = [attr('twitter:creator'), attr('twitter:site')].map(v => /^@?([a-z\d_]{1,15})$/i.exec(v)?.[1]).filter(Boolean);
      const authors = [...document.querySelectorAll('a[rel~="author"], [itemprop="author"] a[href], a[itemprop="author"][href]')].map(a => a.href);
      const article = attr('article:author');
      const urls = [...handles.map(h => `https://x.com/${h}`), ...authors, ...(article.startsWith('https://') ? [article] : [])].flatMap(v => { try { const n = new URL(v); if (n.protocol !== 'https:') return []; n.search = ''; n.hash = ''; return [n.href]; } catch { return []; } });
      const unique = [...new Set(urls)].slice(0, 3); return unique.length === 1 ? unique[0] : null;
    } });
    return injected[0]?.result;
  });
  assert.equal(credit, 'https://x.com/alice_dev');
  const news = await context.newPage();
  await news.route('https://news.example/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>News</title><meta name="twitter:creator" content="@alice_dev"><a rel="author" href="https://github.com/bob">Bob</a>' }));
  await news.goto('https://news.example/story');
  const mixed = await popup.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://news.example/story' });
    const injected = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
      const attr = name => document.querySelector(`meta[name="${name}"], meta[property="${name}"]`)?.content?.trim() || '';
      const handles = [attr('twitter:creator'), attr('twitter:site')].map(v => /^@?([a-z\d_]{1,15})$/i.exec(v)?.[1]).filter(Boolean);
      const authors = [...document.querySelectorAll('a[rel~="author"], [itemprop="author"] a[href], a[itemprop="author"][href]')].map(a => a.href);
      const article = attr('article:author');
      const urls = [...handles.map(h => `https://x.com/${h}`), ...authors, ...(article.startsWith('https://') ? [article] : [])].flatMap(v => { try { const n = new URL(v); if (n.protocol !== 'https:') return []; n.search = ''; n.hash = ''; return [n.href]; } catch { return []; } });
      const unique = [...new Set(urls)].slice(0, 3); return unique.length === 1 ? unique[0] : null;
    } });
    return injected[0]?.result;
  });
  assert.equal(mixed, null, 'Several credited people must not pick one at random');
  console.log('PASS: a uniquely credited author is returned; mixed credits are left alone.');
} finally {
  clearTimeout(timer);
  await context?.close();
  await rm(profile, { recursive: true, force: true });
  await rm(extensionTemp, { recursive: true, force: true });
}
