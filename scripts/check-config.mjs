import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Local presence/shape check only: never prints values and never contacts a provider.
// `saved` says only whether keys saved through the extension popup exist (data/settings.json); never their values.
export function inspectConfig(env = process.env, saved = {}) {
  const checks = [];
  const add = (level, message) => checks.push({ level, message });
  const boundedPositive = (value, max) => /^\d+$/.test(String(value || '')) && Number.isSafeInteger(Number(value)) && Number(value) > 0 && Number(value) <= max;
  if (!env.LOCAL_API_TOKEN) add('info', 'Pairing: a random local token is generated once and reused from data/local-token.');
  else if (env.LOCAL_API_TOKEN.length < 32) add('error', 'Pairing: the configured local token must be at least 32 characters.');
  else add('ok', 'Pairing: a stable local token is configured; its strength was not assessed.');
  if (!env.CACHE_ENCRYPTION_KEY) add('info', 'Registry: memory-only unless a previously encrypted registry is present and locked.');
  else if (!/^[a-f\d]{64}$/i.test(env.CACHE_ENCRYPTION_KEY)) add('error', 'Registry: the encryption key must be 64 hexadecimal characters.');
  else add('ok', 'Registry: an encryption key is configured; the existing file and key were not tested.');
  add(env.OPENROUTER_API_KEY || saved.openrouterKey ? 'ok' : 'info', env.OPENROUTER_API_KEY ? 'Decision model: an OpenRouter key is set in the environment; it was not validated here.' : saved.openrouterKey ? 'Decision model: an OpenRouter key is saved (pasted in the popup, checked with OpenRouter when it was saved).' : 'Decision model: no OpenRouter key yet. Paste one in the Universal Tip popup; it is the only setup step.');
  add('info', env.GITHUB_TOKEN ? 'GitHub: a token is configured but was not validated.' : saved.githubToken ? 'GitHub: a token is saved (pasted in the popup, checked with GitHub when it was saved).' : 'GitHub: no token configured; unauthenticated IP rate limits apply.');
  add('info', env.REDDIT_ACCESS_TOKEN ? 'Reddit: an OAuth token is configured but was not validated.' : 'Reddit: no OAuth token configured; public access may be denied.');
  const commonBudget = boundedPositive(env.PROVIDER_DAILY_CALL_LIMIT, 1000) && boundedPositive(env.PROVIDER_DAILY_BUDGET_CENTS, 1000000);
  const parallelTransport = env.PARALLEL_DECISIONS_TRANSPORT || 'api';
  if (env.ENABLE_PARALLEL !== '1') add('info', 'Parallel Decisions: disabled.');
  else if (!['api', 'free_mcp'].includes(parallelTransport)) add('error', 'Parallel Decisions: unrecognized transport.');
  else if (parallelTransport === 'free_mcp') {
    if (!boundedPositive(env.PARALLEL_FREE_MCP_DAILY_CALL_LIMIT, 100)) add('error', 'Parallel Decisions free MCP: a positive daily call limit is required.');
    else add('ok', 'Parallel Decisions free MCP: unauthenticated mode configured; service access was not validated.');
  } else if (!env.PARALLEL_API_KEY || !commonBudget || !boundedPositive(env.PARALLEL_DECISION_MAX_CENTS, 1000000)) add('error', 'Parallel Decisions: enabled but missing a key, positive daily caps, or a positive per-call reservation.');
  else add('ok', 'Parallel Decisions: configuration is present but credentials, estimates and provider access were not validated.');
  for (const [label, enabled, key, cost] of [
    ['Parallel Search', env.ENABLE_PARALLEL_SEARCH, env.PARALLEL_API_KEY, env.PARALLEL_SEARCH_MAX_CENTS],
    ['Drex direct connection (optional; not needed with an OpenRouter key)', env.ENABLE_DREX, env.DREX_API_KEY, env.DREX_MAX_CENTS]
  ]) {
    if (enabled !== '1') add('info', `${label}: disabled.`);
    else if (!key || !commonBudget || !boundedPositive(cost, 1000000)) add('error', `${label}: enabled but missing a key, positive daily caps, or a positive per-call reservation.`);
    else add('ok', `${label}: configuration is present but credentials, estimates and provider access were not validated.`);
  }
  if (!env.PAYPAL_SANDBOX_CLIENT_ID && !env.PAYPAL_SANDBOX_CLIENT_SECRET) add('info', 'PayPal sandbox: not configured.');
  else if (!env.PAYPAL_SANDBOX_CLIENT_ID || !env.PAYPAL_SANDBOX_CLIENT_SECRET) add('error', 'PayPal sandbox: both sandbox client ID and secret are required.');
  else add('ok', 'PayPal sandbox: credentials are present but were not validated or used.');
  add('info', 'No network requests were made. Estimated-spend reservations do not guarantee actual charges; use provider-side limits.');
  return checks;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let saved = {}; try { const file = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'settings.json'), 'utf8')); saved = { openrouterKey: Boolean(file.openrouterKey), githubToken: Boolean(file.githubToken) }; } catch { /* No saved settings yet. */ }
  const checks = inspectConfig(process.env, saved); for (const check of checks) console.log(`[${check.level.toUpperCase()}] ${check.message}`);
  if (checks.some(check => check.level === 'error')) process.exitCode = 1;
}
