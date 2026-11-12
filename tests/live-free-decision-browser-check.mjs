// Explicit live browser smoke test: public GitHub research and one documented free Parallel MCP decision.
// No paid-provider key or PayPal credentials are used. The selected public evidence is sent to Parallel.
import { chromium } from 'playwright-core';
import { chromePath } from './chrome-path.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const directory = await mkdtemp(path.join(tmpdir(), 'ut-free-browser-budget-'));
const profile = await mkdtemp(path.join(tmpdir(), 'ut-free-browser-profile-'));
const token = 'free-browser-fixture-token-1234567890123456789'; let context, output = '';
const server = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, LOCAL_API_TOKEN: token, ENABLE_PARALLEL: '1', PARALLEL_DECISIONS_TRANSPORT: 'free_mcp', PARALLEL_FREE_MCP_DAILY_CALL_LIMIT: '1', PROVIDER_BUDGET_DIR: directory, PARALLEL_API_KEY: '', ENABLE_PARALLEL_SEARCH: '0', ENABLE_DREX: '0', OPENROUTER_API_KEY: '', CACHE_ENCRYPTION_KEY: '', GITHUB_TOKEN: '', REDDIT_ACCESS_TOKEN: '', PAYPAL_SANDBOX_CLIENT_ID: '', PAYPAL_SANDBOX_CLIENT_SECRET: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
const closed = once(server, 'close'); server.stderr.resume();
try {
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Local server did not start')), 10000); server.stdout.on('data', chunk => { output += String(chunk); if (output.includes('local backend:')) { clearTimeout(timer); resolve(); } }); server.once('exit', code => { clearTimeout(timer); reject(new Error(`Server failed: ${code}`)); }); });
  const extension = path.resolve('extension');
  context = await chromium.launchPersistentContext(profile, { executablePath: chromePath(), headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'); const id = new URL(worker.url()).host;
  await worker.evaluate(value => chrome.storage.local.set({ token: value }), token);
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.locator('#url').fill('https://github.com/zudsniper'); const next = context.waitForEvent('page');
  await popup.locator('button[type=submit]').click(); const panel = await next; await panel.waitForLoadState();
  try { await panel.getByText('Parallel Decisions (free MCP):', { exact: false }).waitFor({ timeout: 90000 }); }
  catch (error) { console.log('Live decision diagnostic:', JSON.stringify({ status: await panel.locator('#status').textContent(), details: (await panel.locator('#result').innerText()).slice(0, 1200) })); throw error; }
  assert.doesNotMatch(await panel.locator('#status').innerText(), /Verified payment destination/);
  assert.match(await panel.locator('#result').innerText(), /Advisory only; not proof or payment authorization/);
  await mkdir(path.resolve('output/playwright'), { recursive: true }); await panel.setViewportSize({ width: 720, height: 900 });
  await panel.screenshot({ path: path.resolve('output/playwright/free-ai-panel.png'), fullPage: true });
  console.log('PASS: live free Parallel decision displayed by the real extension after an explicit popup lookup; no payment was authorized.');
} finally { if (context) await context.close(); if (server.exitCode === null) server.kill(); await closed; await rm(profile, { recursive: true, force: true }); await rm(directory, { recursive: true, force: true }); }
