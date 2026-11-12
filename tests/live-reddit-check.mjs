import { chromium } from 'playwright-core';
import { chromePath } from './chrome-path.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const profile = await mkdtemp(path.join(tmpdir(), 'ut-live-reddit-')); let context;
try {
  const extension = path.resolve('extension');
  context = await chromium.launchPersistentContext(profile, { executablePath: chromePath(), headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const page = await context.newPage(); const response = await page.goto('https://www.reddit.com/r/programming/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  const status = response?.status(); console.log('Reddit page HTTP status:', status);
  if (status !== 200) throw new Error('Reddit did not serve the public page to this isolated browser');
  try { await page.locator('[data-universal-tip]').first().waitFor({ timeout: 15000 }); }
  catch {
    const evidence = await page.evaluate(() => {
      const roots = [document]; const links = []; const posts = [];
      for (let i = 0; i < roots.length && roots.length < 300; i++) for (const element of roots[i].querySelectorAll('*')) {
        if (element.shadowRoot) roots.push(element.shadowRoot);
        if (element.tagName.toLowerCase() === 'shreddit-post' && posts.length < 3) posts.push(element.outerHTML.slice(0, 1500));
        if (element instanceof HTMLAnchorElement && /\/(user|u)\//.test(element.href) && links.length < 8) links.push(element.outerHTML.slice(0, 800));
      }
      return { title: document.title, body: document.body.innerText.slice(0, 700), openRoots: roots.length, posts, links };
    });
    console.log(JSON.stringify(evidence, null, 2)); throw new Error('No inline icons on live Reddit page');
  }
  console.log('Live Reddit author icons found:', await page.locator('[data-universal-tip]').count());
} finally { if (context) await context.close(); await rm(profile, { recursive: true, force: true }); }
