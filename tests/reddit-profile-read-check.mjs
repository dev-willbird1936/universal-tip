// Offline: Use current page on a Reddit profile fixture reads the bio, links inside the details block, and the profile's
// social links, which Reddit lists in their own block outside it. Links in posts and Reddit's own links are not taken.
import { chromium } from 'playwright-core';
import { chromePath } from './chrome-path.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const profile = await mkdtemp(path.join(tmpdir(), 'ut-reddit-profile-')); let context;
const timer = setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 40000);
const body = `<!doctype html><meta charset="utf-8"><title>alice_maker</title><main>
<article><a href="https://post.example/not-theirs">a link in a post</a></article>
<aside><div data-testid="profile-details-content-wrapper"><p data-testid="profile-description">Artist and Writer</p>
<a href="https://ko-fi.com/alicemaker">tip jar</a><a href="https://www.reddit.com/r/art">r/art</a></div>
<faceplate-tracker noun="social_link"><a href="https://alice.example">Personal Website</a></faceplate-tracker>
<faceplate-tracker noun="social_link"><a href="https://ko-fi.com/alicemaker">Ko-fi</a></faceplate-tracker>
<faceplate-tracker noun="share"><a href="https://share.example/x">Share</a></faceplate-tracker></aside></main>`;
try {
  const extension = path.resolve('extension');
  context = await chromium.launchPersistentContext(profile, { executablePath: chromePath(), headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  const page = await context.newPage();
  await page.route('https://www.reddit.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body }));
  await page.goto('https://www.reddit.com/user/alice_maker/');
  await page.waitForTimeout(800);
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  const read = await popup.evaluate(async () => { const [tab] = await chrome.tabs.query({ url: 'https://www.reddit.com/user/alice_maker/' }); return chrome.tabs.sendMessage(tab.id, { type: 'read-profile' }); });
  assert.equal(read?.screen_name, 'alice_maker'); assert.equal(read.description, 'Artist and Writer');
  assert.deepEqual(read.links, ['https://ko-fi.com/alicemaker', 'https://alice.example', 'https://ko-fi.com/alicemaker'].filter((link, index, all) => all.indexOf(link) === index), JSON.stringify(read));
  console.log('PASS: a Reddit profile fixture yields its bio, its details links and its social links; post links and Reddit links are left out.');
} finally { clearTimeout(timer); await context?.close(); await rm(profile, { recursive: true, force: true }); }
