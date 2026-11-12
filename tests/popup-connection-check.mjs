// Offline popup first-run check: server down, automatic pairing, key validation. No external network calls.
import { chromium } from 'playwright-core';
import { chromePath } from './chrome-path.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = process.cwd(); const extensionPath = path.join(root, 'extension');
const profile = await mkdtemp(path.join(tmpdir(), 'ut-popup-connection-'));
const token = 'popup-connection-token-'.repeat(3); let context; let server; let closed;
try {
  context = await chromium.launchPersistentContext(profile, { executablePath: chromePath(), headless: true, args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  const popup = `chrome-extension://${new URL(worker.url()).host}/popup.html`;
  const page = await context.newPage(); await page.goto(popup);
  await page.getByText('The local server is not running.').waitFor();
  server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, LOCAL_API_TOKEN: token, ENABLE_PARALLEL: '0', ENABLE_PARALLEL_SEARCH: '0', ENABLE_DREX: '0', OPENROUTER_API_KEY: '', CACHE_ENCRYPTION_KEY: '', PAYPAL_SANDBOX_CLIENT_ID: '', PAYPAL_SANDBOX_CLIENT_SECRET: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  closed = once(server, 'close'); server.stderr.resume();
  await new Promise((resolve, reject) => { server.stdout.on('data', chunk => { if (String(chunk).includes('local backend:')) resolve(); }); server.once('exit', code => reject(new Error(`Server exited ${code}`))); });
  await page.reload(); await page.getByText('Connected. Add your OpenRouter key below to finish setup.').waitFor(); // paired automatically
  await page.locator('#orkey').fill('not-a-key'); await page.locator('#orsave').click();
  await page.getByText('That does not look like an OpenRouter key').waitFor();
  await page.locator('#connection-details').evaluate(d => { d.open = true; });
  await page.locator('#token').fill('x'.repeat(40)); await page.locator('#save').click();
  await page.getByText('Pairing token saved and accepted by the server.').waitFor(); // a wrong manual token is replaced by automatic pairing
  await page.getByText('Not set up: the server has no PayPal sandbox credentials.').waitFor();
  await page.screenshot({ path: path.join(root, 'output', 'playwright', 'popup-connected.png') });
  console.log('PASS: popup reports server-down, pairs automatically, rejects a malformed OpenRouter key and shows the unconfigured sandbox.');
} finally {
  await context?.close(); if (server && server.exitCode === null) server.kill(); await closed; await rm(profile, { recursive: true, force: true });
}
