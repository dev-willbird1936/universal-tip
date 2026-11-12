import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectConfig } from '../scripts/check-config.mjs';

test('local configuration check never includes secret values or makes network requests', () => {
  const env = { LOCAL_API_TOKEN: 'SECRET_MARKER_TOKEN_12345678901234567890', CACHE_ENCRYPTION_KEY: 'a'.repeat(64), GITHUB_TOKEN: 'SECRET_MARKER_GITHUB', REDDIT_ACCESS_TOKEN: 'SECRET_MARKER_REDDIT', ENABLE_PARALLEL: '1', PARALLEL_API_KEY: 'SECRET_MARKER_PARALLEL', PROVIDER_DAILY_CALL_LIMIT: '3', PROVIDER_DAILY_BUDGET_CENTS: '100', PARALLEL_DECISION_MAX_CENTS: '10', PAYPAL_SANDBOX_CLIENT_ID: 'SECRET_MARKER_ID', PAYPAL_SANDBOX_CLIENT_SECRET: 'SECRET_MARKER_SECRET' };
  const checks = inspectConfig(env); assert.equal(checks.some(item => item.level === 'error'), false);
  assert.doesNotMatch(JSON.stringify(checks), /SECRET_MARKER|aaaaaaaaaaaaaaaa/);
  assert.ok(checks.some(item => item.message.includes('No network requests')));
  assert.ok(checks.some(item => item.message.includes('credentials are present but were not validated')));
});
test('free Parallel MCP configuration requires only its own positive daily call limit', () => {
  const configured = inspectConfig({ ENABLE_PARALLEL: '1', PARALLEL_DECISIONS_TRANSPORT: 'free_mcp', PARALLEL_FREE_MCP_DAILY_CALL_LIMIT: '2' });
  assert.equal(configured.some(item => item.level === 'error'), false);
  assert.ok(configured.some(item => item.message.includes('unauthenticated mode configured')));
  assert.ok(inspectConfig({ ENABLE_PARALLEL: '1', PARALLEL_DECISIONS_TRANSPORT: 'free_mcp' }).some(item => item.level === 'error'));
  assert.ok(inspectConfig({ ENABLE_PARALLEL: '1', PARALLEL_DECISIONS_TRANSPORT: 'unknown' }).some(item => item.level === 'error'));
});

test('configuration check flags partial credentials and malformed provider limits', () => {
  const checks = inspectConfig({ LOCAL_API_TOKEN: 'short', CACHE_ENCRYPTION_KEY: 'bad', ENABLE_DREX: '1', DREX_API_KEY: 'fake', PROVIDER_DAILY_CALL_LIMIT: '1oops', PROVIDER_DAILY_BUDGET_CENTS: '100', DREX_MAX_CENTS: '10', PAYPAL_SANDBOX_CLIENT_ID: 'fake' });
  assert.equal(checks.filter(item => item.level === 'error').length, 4);
  assert.equal(inspectConfig({}).some(item => item.level === 'error'), false);
});
test('doctor reports the OpenRouter key and GitHub token saved through the popup, without their values', () => {
  const line = (env, saved, start) => inspectConfig(env, saved).find(check => check.message.startsWith(start));
  assert.equal(line({}, {}, 'Decision model').level, 'info'); assert.match(line({}, {}, 'Decision model').message, /no OpenRouter key yet/);
  assert.equal(line({}, { openrouterKey: true }, 'Decision model').level, 'ok'); assert.match(line({}, { openrouterKey: true }, 'Decision model').message, /saved \(pasted in the popup/);
  assert.match(line({ OPENROUTER_API_KEY: 'sk-or-secret-value' }, {}, 'Decision model').message, /set in the environment/);
  assert.match(line({}, { githubToken: true }, 'GitHub').message, /a token is saved/);
  assert.ok(!JSON.stringify(inspectConfig({ OPENROUTER_API_KEY: 'sk-or-secret-value', GITHUB_TOKEN: 'ghp_secretvalue' }, {})).includes('secret'), 'Values are never printed');
});
