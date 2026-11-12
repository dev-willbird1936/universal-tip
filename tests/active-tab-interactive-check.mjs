// Experimental, not passed: production still requests `tabs`; this explores a temporary activeTab-only manifest.
// Headed permissions smoke test. Open Universal Tip from Chrome's real Extensions menu,
// choose Enable icons on this site, and approve only the isolated creator.example fixture.
import { chromium } from 'playwright-core';
import { chromePath } from './chrome-path.mjs';
import { mkdtemp, rm, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const profile = await mkdtemp(path.join(tmpdir(), 'ut-active-tab-profile-'));
const extension = await mkdtemp(path.join(tmpdir(), 'ut-active-tab-extension-')); let context;
try {
  await cp(path.resolve('extension'), extension, { recursive: true });
  const manifestPath = path.join(extension, 'manifest.json'); const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.permissions = manifest.permissions.filter(value => value !== 'tabs');
  if (!manifest.permissions.includes('activeTab')) manifest.permissions.push('activeTab');
  await writeFile(manifestPath, JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, { executablePath: chromePath(), headless: false, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--window-size=1000,800'] });
  const website = await context.newPage();
  await website.route('https://creator.example/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Universal Tip activeTab Fixture</title><a rel="author" href="https://creator.example/profile">Author</a>' }));
  await website.goto('https://creator.example/article'); await website.bringToFront();
  console.log('READY: open Universal Tip using the real toolbar menu, enable fixture-site icons and approve the isolated permission prompt.');
  await website.locator('[data-universal-tip]').waitFor({ timeout: 120000 });
  assert.equal(await website.locator('[data-universal-tip]').count(), 1);
  console.log('PASS: activeTab (without tabs permission), actual toolbar invocation, site approval and icon injection.');
} finally { if (context) await context.close(); await rm(profile, { recursive: true, force: true }); await rm(extension, { recursive: true, force: true }); }
