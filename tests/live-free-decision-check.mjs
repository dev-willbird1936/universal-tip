// Explicit live smoke test: one unauthenticated, provider-documented free Parallel decision.
// It sends a public GitHub profile and public support-link evidence to Parallel; no API key or paid mode is used.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const directory = await mkdtemp(path.join(tmpdir(), 'ut-free-decision-live-'));
const token = 'live-free-decision-test-token-123456789012345'; let output = '';
const server = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, LOCAL_API_TOKEN: token, ENABLE_PARALLEL: '1', PARALLEL_DECISIONS_TRANSPORT: 'free_mcp', PARALLEL_FREE_MCP_DAILY_CALL_LIMIT: '1', PROVIDER_BUDGET_DIR: directory, PARALLEL_API_KEY: '', ENABLE_PARALLEL_SEARCH: '0', ENABLE_DREX: '0', OPENROUTER_API_KEY: '', CACHE_ENCRYPTION_KEY: '', GITHUB_TOKEN: '', REDDIT_ACCESS_TOKEN: '', PAYPAL_SANDBOX_CLIENT_ID: '', PAYPAL_SANDBOX_CLIENT_SECRET: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
const closed = once(server, 'close'); server.stderr.resume();
try {
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Local server did not start')), 10000); server.stdout.on('data', chunk => { output += String(chunk); if (output.includes('local backend:')) { clearTimeout(timer); resolve(); } }); server.once('exit', code => { clearTimeout(timer); reject(new Error(`Server failed: ${code}`)); }); });
  const response = await fetch('http://127.0.0.1:4318/lookup/stream', { method: 'POST', headers: { 'x-local-token': token, 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://github.com/zudsniper' }), signal: AbortSignal.timeout(120000) });
  assert.equal(response.status, 200); const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
  const result = events.find(event => event.type === 'result')?.value;
  assert.ok(result, `Live research failed: ${JSON.stringify(events.filter(event => event.type === 'error'))}`);
  assert.ok(events.some(event => event.type === 'progress' && event.message.includes('Parallel free MCP')));
  const decision = result.assessments.find(item => item.provider === 'Parallel Decisions (free MCP)');
  assert.ok(decision, `Live free decision unavailable: ${JSON.stringify(result.warnings)}`);
  assert.ok(decision.answer === 'refused' || (typeof decision.answer === 'number' && decision.answer >= 0 && decision.answer <= 1));
  assert.ok(result.candidates.every(candidate => candidate.payment_authorization_status === 'not_authorized'));
  console.log(`PASS: live public GitHub research and free Parallel MCP decision through the local streaming API; answer=${decision.answer}, citations=${decision.citations.length}, status=${result.status}. No payment was authorized.`);
} finally { if (server.exitCode === null) server.kill(); await closed; await rm(directory, { recursive: true, force: true }); }
