import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
const token = 'live-stream-test-token-1234567890123456789';
let serverOutput = '';
const server = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, LOCAL_API_TOKEN: token, ENABLE_PARALLEL: '0', ENABLE_PARALLEL_SEARCH: '0', ENABLE_DREX: '0', OPENROUTER_API_KEY: '', CACHE_ENCRYPTION_KEY: '', GITHUB_TOKEN: '', REDDIT_ACCESS_TOKEN: '', PAYPAL_SANDBOX_CLIENT_ID: '', PAYPAL_SANDBOX_CLIENT_SECRET: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
const closed = once(server, 'close'); server.stderr.resume();
try {
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Local server did not start')), 10000); server.stdout.on('data', chunk => { serverOutput += String(chunk); if (serverOutput.includes('local backend:')) { clearTimeout(timer); resolve(); } }); server.once('exit', code => { clearTimeout(timer); reject(new Error(`Server failed: ${code}`)); }); });
  async function lookup() {
    const response = await fetch('http://127.0.0.1:4318/lookup/stream', { method: 'POST', headers: { 'x-local-token': token, 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://github.com/feross' }) });
    assert.equal(response.status, 200); const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
    assert.ok(events.some(event => event.type === 'progress' && /GitHub|funding|README|Rechecking/.test(event.message)));
    const result = events.find(event => event.type === 'result')?.value; assert.ok(result, `Expected a real public lookup result; stream errors: ${JSON.stringify(events.filter(event => event.type === 'error'))}`);
    assert.equal(result.target.platform, 'github'); assert.ok(result.target.platformUserId);
    assert.ok(result.candidates.every(candidate => candidate.payment_authorization_status === 'not_authorized'));
    return { id: result.target.platformUserId, cached: result.cached, stages: events.filter(event => event.type === 'progress').map(event => event.message) };
  }
  const [first, second] = await Promise.all([lookup(), lookup()]); assert.equal(first.id, second.id);
  const cached = await lookup(); assert.equal(cached.cached, true); assert.equal(cached.id, first.id); assert.ok(cached.stages.some(stage => stage.includes('Rechecking')));
  const starts = serverOutput.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line)).filter(event => event.event === 'research' && event.outcome === 'started');
  assert.equal(starts.length, 1, 'Concurrent requests should share one underlying research job');
  console.log(`PASS: two live lookup streams shared one research job (${first.stages.length}/${second.stages.length} progress events); a later cache hit rechecked the stable ID.`);
} finally { if (server.exitCode === null) server.kill(); await closed; }
