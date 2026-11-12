// Offline: on YouTube, hovering a channel link shows the Tip button; the channel read uses only the channel's own
// metadata block and header link (not sponsor links); a video page reports its publishing channel.
import { chromium } from 'playwright-core';
import { chromePath } from './chrome-path.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const profile = await mkdtemp(path.join(tmpdir(), 'ut-yt-')); let context;
const timer = setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 50000);
const channelHtml = `<!doctype html><meta charset="utf-8"><title>Alice</title><script>var ytInitialData = {"channelMetadataRenderer":{"title":"Alice Makes","description":"Woodworking. Tips: ko-fi.com/alicemakes\\nSite: http://alice.example","vanityChannelUrl":"http://www.youtube.com/@alicemakes"},
"header":{"url":"https://www.youtube.com/redirect?event=channel_header\\u0026redir_token=x\\u0026q=https%3A%2F%2Flinktr.ee%2Falicemakes"},
"video":{"url":"https://www.youtube.com/redirect?event=video_description\\u0026q=https%3A%2F%2Fsponsor.example%2Fdeal"}};</script><main>Channel</main>`;
const watchHtml = `<!doctype html><meta charset="utf-8"><title>Video</title><ytd-watch-metadata><div id="owner"><ytd-video-owner-renderer><a href="/@alicemakes"><img alt=""></a><ytd-channel-name><a href="/@alicemakes">Alice Makes</a></ytd-channel-name></ytd-video-owner-renderer></div></ytd-watch-metadata>
<div id="comments"><a href="/@commenter1">@commenter1</a></div>`;
try {
  const extension = path.resolve('extension');
  context = await chromium.launchPersistentContext(profile, { executablePath: chromePath(), headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  const page = await context.newPage();
  await page.route('https://www.youtube.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: route.request().url().includes('/watch') ? watchHtml : channelHtml }));
  await page.goto('https://www.youtube.com/watch?v=abc123');
  await page.waitForTimeout(600);
  await page.locator('#comments a').hover(); await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('[data-universal-tip]')].some(n => n.style.display === 'block')), true, 'Hovering a channel link shows the Tip button');
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  const ask = (url, message) => popup.evaluate(async ([u, m]) => { const [tab] = await chrome.tabs.query({ url: u }); return chrome.tabs.sendMessage(tab.id, m); }, [url, message]);
  assert.equal(await ask('https://www.youtube.com/watch?v=abc123', { type: 'read-post-author' }), 'https://www.youtube.com/@alicemakes', 'The publisher, not a commenter');
  await page.goto('https://www.youtube.com/@alicemakes'); await page.waitForTimeout(500);
  const read = await ask('https://www.youtube.com/@alicemakes', { type: 'read-profile' });
  assert.equal(read?.screen_name, 'alicemakes'); assert.equal(read.name, 'Alice Makes');
  assert.deepEqual(read.links, ['https://linktr.ee/alicemakes', 'https://alice.example'], 'Header link plus description links; sponsor links from videos are ignored');
  assert.match(read.description, /ko-fi\.com\/alicemakes/);
  console.log('PASS: YouTube fixture: hover button on channel links, video publisher (not commenters), and channel read from its own metadata and header link only.');
} finally { clearTimeout(timer); await context?.close(); await rm(profile, { recursive: true, force: true }); }
