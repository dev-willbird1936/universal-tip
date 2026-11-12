// Offline hover-button behavior on X and Facebook fixtures in the real unpacked extension. No backend or provider is started.
import { chromium } from 'playwright-core';
import { chromePath } from './chrome-path.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const profile = await mkdtemp(path.join(tmpdir(), 'ut-hover-fixture-')); let context;
const body = links => `<!doctype html><title>Fixture</title><nav><a id="nav" href="/alice_dev">nav</a></nav><main style="margin:80px">${links}</main>`;
const visible = page => page.evaluate(() => document.querySelector('[data-universal-tip]')?.style.display === 'block');
try {
  const extension = path.resolve('extension');
  context = await chromium.launchPersistentContext(profile, { executablePath: chromePath(), headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const cases = [
    ['https://x.com/home', '<p><a id="good" href="/Alice_Dev"><span>@Alice_Dev</span></a></p><p><a id="post" href="/Alice_Dev/status/1">post</a></p><p><a id="reserved" href="/explore">explore</a></p>', 'https://x.com/Alice_Dev'],
    ['https://www.facebook.com/home', '<p><a id="good" href="/some.person?__cft__=x">Some Person</a></p><p><a id="post" href="/some.person/posts/1">post</a></p><p><a id="reserved" href="/marketplace">Marketplace</a></p>', 'https://www.facebook.com/some.person']
  ];
  for (const [url, links, expected] of cases) {
    const page = await context.newPage();
    await page.route(`${new URL(url).origin}/**`, route => route.fulfill({ status: 200, contentType: 'text/html', body: body(links) }));
    await page.goto(url); await page.waitForTimeout(500);
    for (const id of ['nav', 'post', 'reserved']) { await page.hover(`#${id}`); await page.waitForTimeout(150); assert.equal(await visible(page), false, `${url}: #${id} must not show the button`); }
    await page.hover('#good'); await page.waitForFunction(() => document.querySelector('[data-universal-tip]')?.style.display === 'block');
    const tip = await page.evaluate(() => { const t = document.querySelector('[data-universal-tip]'); return { x: parseFloat(t.style.left) + 20, y: parseFloat(t.style.top) + 12 }; });
    const opened = context.waitForEvent('page'); await page.mouse.move(tip.x, tip.y, { steps: 4 }); await page.mouse.click(tip.x, tip.y); const panel = await opened;
    assert.equal(new URL(panel.url()).searchParams.get('url'), expected); await panel.close();
    await page.hover('#good'); await page.waitForFunction(() => document.querySelector('[data-universal-tip]')?.style.display === 'block');
    await page.mouse.move(5, 300); await page.waitForFunction(() => document.querySelector('[data-universal-tip]')?.style.display === 'none', null, { timeout: 3000 });
    await page.close();
  }
  // On the person's own Facebook profile page, outside links shown there travel with the click (redirect links decoded).
  const own = await context.newPage();
  await own.route('https://www.facebook.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>Fixture</title><meta name="description" content="Artist and maker"><div role="main" style="margin:80px"><h1><a id="good" href="/some.person">Some Person</a></h1><a href="https://www.facebook.com/l.php?u=${encodeURIComponent('https://ko-fi.com/someperson?ref=fb')}&h=x">ko-fi.com/someperson</a><a href="https://www.instagram.com/someperson">Instagram</a><a href="/other.person">Friend</a></div>` }));
  await own.goto('https://www.facebook.com/some.person'); await own.waitForTimeout(500);
  await own.hover('#good'); await own.waitForFunction(() => document.querySelector('[data-universal-tip]')?.style.display === 'block');
  const spot = await own.evaluate(() => { const t = document.querySelector('[data-universal-tip]'); return { x: parseFloat(t.style.left) + 20, y: parseFloat(t.style.top) + 12 }; });
  const ownOpened = context.waitForEvent('page'); await own.mouse.move(spot.x, spot.y, { steps: 4 }); await own.mouse.click(spot.x, spot.y); const ownPanel = await ownOpened;
  const read = JSON.parse(new URL(ownPanel.url()).searchParams.get('xp'));
  assert.deepEqual(read, { screen_name: 'some.person', description: 'Artist and maker', links: ['https://ko-fi.com/someperson'] });
  // GitHub: a plain profile link with no author markers still gets the floating tip button.
  const gh = await context.newPage();
  await gh.route('https://github.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Fixture</title><nav><a id="nav" href="/alice">nav</a></nav><main style="margin:80px"><p><a id="good" href="/alice">alice</a></p><p><a id="reserved" href="/features">features</a></p></main>' }));
  await gh.goto('https://github.com/example');
  await gh.hover('#reserved'); await gh.waitForTimeout(200);
  assert.equal(await gh.evaluate(() => document.querySelector('[data-universal-tip="float"]')?.style.display === 'block'), false);
  await gh.hover('#good'); await gh.waitForFunction(() => document.querySelector('[data-universal-tip="float"]')?.style.display === 'block');
  const ghTip = await gh.evaluate(() => { const t = document.querySelector('[data-universal-tip="float"]'); return { x: parseFloat(t.style.left) + 20, y: parseFloat(t.style.top) + 12 }; });
  const ghOpened = context.waitForEvent('page'); await gh.mouse.move(ghTip.x, ghTip.y, { steps: 4 }); await gh.mouse.click(ghTip.x, ghTip.y); const ghPanel = await ghOpened;
  assert.equal(new URL(ghPanel.url()).searchParams.get('url'), 'https://github.com/alice');
  // Reddit: a plain /user/ link still gets the floating tip button when no icon was inserted yet.
  const rd = await context.newPage();
  await rd.route('https://www.reddit.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Fixture</title><nav><a id="nav" href="/user/alice_r">nav</a></nav><main style="margin:80px"><p><a id="good" href="/user/alice_r">u/alice_r</a></p><p><a id="reserved" href="/r/programming">subreddit</a></p></main>' }));
  await rd.goto('https://www.reddit.com/r/programming/comments/abc/post/');
  await rd.hover('#reserved'); await rd.waitForTimeout(200);
  assert.equal(await rd.evaluate(() => document.querySelector('[data-universal-tip="float"]')?.style.display === 'block'), false);
  await rd.hover('#good');
  await rd.waitForFunction(() => document.querySelector('[data-universal-tip]') || document.querySelector('[data-universal-tip="float"]')?.style.display === 'block');
  const iconCount = await rd.locator('[data-universal-tip]').count();
  const floatShown = await rd.evaluate(() => document.querySelector('[data-universal-tip="float"]')?.style.display === 'block');
  assert.ok(iconCount >= 1 || floatShown, 'Reddit username should get an icon or a floating button');
  if (floatShown) {
    const tip = await rd.evaluate(() => { const t = document.querySelector('[data-universal-tip="float"]'); return { x: parseFloat(t.style.left) + 20, y: parseFloat(t.style.top) + 12 }; });
    const opened = context.waitForEvent('page');
    await rd.mouse.move(tip.x, tip.y, { steps: 4 }); await rd.mouse.click(tip.x, tip.y);
    const panel = await opened;
    assert.match(new URL(panel.url()).searchParams.get('url') || '', /reddit\.com\/user\/alice_r/);
    await panel.close();
  }
  const popup = await context.newPage();
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  const fromPopup = await popup.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://www.facebook.com/some.person' });
    return chrome.tabs.sendMessage(tab.id, { type: 'read-profile' });
  });
  assert.deepEqual(fromPopup, { screen_name: 'some.person', description: 'Artist and maker', links: ['https://ko-fi.com/someperson'] });
  const [fbOwn, fbOther] = await popup.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://www.facebook.com/some.person' });
    return [await chrome.tabs.sendMessage(tab.id, { type: 'read-profile', url: 'https://www.facebook.com/some.person' }), await chrome.tabs.sendMessage(tab.id, { type: 'read-profile', url: 'https://www.facebook.com/someone.else' })];
  });
  assert.equal(fbOwn?.screen_name, "some.person");
  assert.equal(fbOther, null, 'A right-clicked link to someone else must not get the page owner\'s bio');
  console.log('PASS: hover button appears only on profile links on X and Facebook fixtures, opens the right profile, hides again, reads outside links from a Facebook profile page, floats on a plain GitHub name, and Use current page can read a Facebook profile.');
} finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
