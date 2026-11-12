import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { platformLimits, sharedFetch, canonicalProfile, research, resolvePlatformId, staleCacheResult, validPageProfile, validXProfile } from './research.mjs';
import { fetchPublic } from './net.mjs';
import { assess, sampleJudgement } from './providers.mjs';
import { createSandboxOrder, captureSandboxOrder, heldTotal, paypalLive } from './paypal.mjs';
import { EvidenceCache } from './cache.mjs';
import { WorkQueue } from './queue.mjs';
import { enrich, leadsEnabled, profileLeads, profileLookupEnabled, searchLeads } from './leads.mjs';
import { githubToken, openRouterKey, saveGithubToken, saveOpenRouterKey } from './settings.mjs';

const PORT = 4318;
// Without LOCAL_API_TOKEN, reuse one generated token across restarts so the extension stays paired.
async function pairingToken() {
  if (process.env.LOCAL_API_TOKEN) return process.env.LOCAL_API_TOKEN;
  const file = path.resolve('data', 'local-token');
  try { const saved = (await readFile(file, 'utf8')).trim(); if (/^[a-f\d]{64}$/.test(saved)) return saved; } catch { /* First start or unreadable file: generate below. */ }
  const fresh = randomBytes(32).toString('hex');
  try { await mkdir(path.dirname(file), { recursive: true, mode: 0o700 }); await writeFile(file, `${fresh}\n`, { mode: 0o600 }); }
  catch { console.warn('Could not save the pairing token; it will change on the next start.'); }
  return fresh;
}
const token = await pairingToken();
if (token.length < 32) throw new Error('LOCAL_API_TOKEN must have at least 32 characters');
const cache = new EvidenceCache({ key: process.env.CACHE_ENCRYPTION_KEY }); await cache.load(); const lockedRegistry = await cache.hasLockedRegistry();
const aliases = new Map(); const inFlight = new Map(); const identityChecks = new Map(); const recent = []; const queue = new WorkQueue();
setInterval(() => { cache.prune().catch(() => console.error('Encrypted cache cleanup failed.')); }, 60 * 60 * 1000).unref();
const TTL = 6 * 60 * 60 * 1000; const RECHECK_AFTER = /^\d{1,7}$/.test(process.env.IDENTITY_RECHECK_AFTER_MS || '') ? Number(process.env.IDENTITY_RECHECK_AFTER_MS) : 10 * 60 * 1000; let cacheGeneration = 0;
function profileKey(target) { return target.platform === 'web' ? target.profileUrl : target.profileUrl.toLowerCase(); }
for (const [key, item] of cache.records) if (item.value?.target) aliases.set(profileKey(item.value.target), key);
function equal(a, b) { if (typeof a !== 'string') return false; const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
function audit(event, outcome) { console.log(JSON.stringify({ at: new Date().toISOString(), event, outcome })); }
function reply(res, status, data, origin) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (origin) { headers['access-control-allow-origin'] = origin; headers.vary = 'Origin'; }
  res.writeHead(status, headers); res.end(JSON.stringify(data));
}
function beginEvents(res, origin) {
  const headers = { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (origin) { headers['access-control-allow-origin'] = origin; headers.vary = 'Origin'; }
  res.writeHead(200, headers);
  return event => { try { if (!res.destroyed && !res.writableEnded) res.write(`${JSON.stringify(event)}\n`); } catch { /* A disconnected panel must not affect a shared job. */ } };
}
function body(req) { return new Promise((resolve, reject) => {
  let size = 0, chunks = [], rejected = false;
  req.on('data', chunk => {
    if (rejected) return;
    size += chunk.length;
    if (size > 8192) { rejected = true; chunks = []; reject(new Error('Request body exceeds 8192 bytes')); }
    else chunks.push(chunk);
  });
  req.on('end', () => { if (!rejected) try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('Invalid JSON')); } });
  req.on('aborted', () => reject(new Error('Request was interrupted'))); req.on('error', reject);
}); }
function limit() { const now = Date.now(); while (recent.length && recent[0] < now - 60000) recent.shift(); if (recent.length >= 20) return false; recent.push(now); return true; }
function page(res, message) {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" });
  res.end(`SANDBOX — NO REAL MONEY\n\n${message}\n\nYou may close this tab.`);
}
// GitHub's rate_limit endpoint reports the remaining hourly allowance without using it. Asked at most once a minute,
// and never allowed to delay the answer by more than about a second.
let githubLimitChecked = 0;
async function refreshGithubLimit() {
  if (Date.now() - githubLimitChecked < 60000) return;
  githubLimitChecked = Date.now();
  try {
    const token = githubToken();
    const response = await fetchPublic('https://api.github.com/rate_limit', { timeout: 1000, headers: { accept: 'application/vnd.github+json', ...(token ? { authorization: `Bearer ${token}` } : {}) } });
    const core = JSON.parse(response.text)?.resources?.core;
    if (Number.isFinite(core?.remaining) && Number.isFinite(core?.reset)) platformLimits.github = core.remaining === 0 ? core.reset * 1000 : 0;
  } catch { /* Unknown; keep what lookups have observed. */ }
}
http.createServer(async (req, res) => {
  const origin = req.headers.origin || ''; const extensionOrigin = /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
  let url;
  try { url = new URL(req.url || '/', 'http://127.0.0.1'); } catch { return reply(res, 400, { error: 'Invalid request URL' }); }
  const sandboxReturn = req.method === 'GET' && ['/sandbox/return', '/sandbox/cancel'].includes(url.pathname);
  if (origin && !extensionOrigin && !(sandboxReturn && origin === 'https://www.sandbox.paypal.com')) return reply(res, 403, { error: 'Origin not allowed' });
  const corsOrigin = extensionOrigin ? origin : undefined;
  if (req.method === 'OPTIONS') {
    if (!extensionOrigin) return reply(res, 403, { error: 'Extension origin required' });
    res.writeHead(204, { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS', 'access-control-allow-headers': 'content-type, x-local-token', 'access-control-max-age': '600', vary: 'Origin' }); return res.end();
  }
  if (req.method === 'GET' && url.pathname === '/sandbox/cancel') return page(res, 'Sandbox checkout cancelled.');
  if (req.method === 'GET' && url.pathname === '/sandbox/return') {
    try { const status = await captureSandboxOrder(url.searchParams.get('state'), url.searchParams.get('token')); audit('sandbox_capture', 'response_received'); return page(res, `Sandbox order status: ${String(status || 'unknown')}.`); }
    catch { audit('sandbox_capture', 'failed'); return page(res, 'Sandbox approval could not be captured. Nothing is known to have completed; check the sandbox merchant account.'); }
  }
  // Frictionless pairing: only a browser-extension origin (which web pages cannot forge) may fetch the token.
  if (req.method === 'POST' && url.pathname === '/pair') return extensionOrigin ? reply(res, 200, { token }, corsOrigin) : reply(res, 403, { error: 'Extension origin required' });
  if (!equal(req.headers['x-local-token'], token)) return reply(res, 401, { error: 'Enter the local API token shown by the server.' }, corsOrigin);
  // Booleans only: lets the popup confirm pairing and show which optional features are set up.
  // The extension's limit question (?limits=1): refresh GitHub's state first, so the answer is right even before any lookup has failed.
  if (req.method === 'GET' && url.pathname === '/status' && url.searchParams.get('limits') === '1') await refreshGithubLimit();
  if (req.method === 'GET' && url.pathname === '/status') return reply(res, 200, { ok: true, paypalLive: paypalLive(), leadsEnabled: leadsEnabled(), profileLookupEnabled: profileLookupEnabled(), sandboxConfigured: Boolean(process.env.PAYPAL_SANDBOX_CLIENT_ID && process.env.PAYPAL_SANDBOX_CLIENT_SECRET), aiChecksEnabled: process.env.ENABLE_PARALLEL === '1' || process.env.ENABLE_DREX === '1' || Boolean(openRouterKey()), openRouterConfigured: Boolean(openRouterKey()), githubTokenConfigured: Boolean(githubToken()), limitResetMinutes: { github: Math.max(0, Math.ceil((platformLimits.github - Date.now()) / 60000)), stackoverflow: Math.max(0, Math.ceil((Math.max(platformLimits.stackoverflow, platformLimits.stackoverflowBackoff) - Date.now()) / 60000)) }, limited: { github: platformLimits.github > Date.now(), stackoverflow: platformLimits.stackoverflow > Date.now() || platformLimits.stackoverflowBackoff > Date.now() }, persistentRegistry: Boolean(process.env.CACHE_ENCRYPTION_KEY) }, corsOrigin);
  if (!limit()) return reply(res, 429, { error: 'Too many requests. Try again shortly.' }, corsOrigin);
  let emit = null;
  try {
    if (req.method === 'POST' && ['/lookup', '/lookup/stream'].includes(url.pathname)) {
      const input = await body(req); if (!input || typeof input.url !== 'string' || input.url.length > 2048) throw new Error('Enter a public HTTPS profile URL');
      const target = canonicalProfile(input.url); const key = profileKey(target); const requestGeneration = cacheGeneration;
      if (url.pathname === '/lookup/stream') emit = beginEvents(res, corsOrigin);
      const progress = message => emit?.({ type: 'progress', message });
      const finish = value => { if (!emit) return reply(res, 200, value, corsOrigin); emit({ type: 'result', value }); res.end(); };
      const fail = (status, error) => { if (!emit) return reply(res, status, { error }, corsOrigin); emit({ type: 'error', error }); res.end(); };
      progress('Starting public-source research…');
      const options = { githubToken: githubToken(), redditAccessToken: process.env.REDDIT_ACCESS_TOKEN, shouldContinue: () => requestGeneration === cacheGeneration, xProfile: target.platform === 'x' ? validXProfile(input.xProfile, target.username) : null, pageProfile: ['reddit', 'facebook', 'youtube', 'github', 'stackoverflow'].includes(target.platform) ? validPageProfile(input.pageProfile, target.username) : null };
      let cached = cache.get(aliases.get(key) || key); let stale = null;
      // A result checked within the last ten minutes is served as is: repeat clicks on the same person then cost no platform
      // request. Older cached results still have the account ID rechecked, in case the username changed hands.
      if (cached && target.platform !== 'web' && cached.target.platformUserId && !(Date.now() - Date.parse(cached.checkedAt) < RECHECK_AFTER)) {
        progress('Rechecking the cached profile identity…');
        try {
          if (!identityChecks.has(key)) {
            const check = queue.run(() => resolvePlatformId(target, options), () => progress('Waiting for an available research slot…'));
            identityChecks.set(key, check.finally(() => identityChecks.delete(key)));
          }
          const currentId = await identityChecks.get(key);
          if (currentId !== cached.target.platformUserId) { aliases.delete(key); cached = null; }
        } catch {
          // The platform refused the recheck (often a rate limit). Research afresh, since lookups have their own fallbacks;
          // the old result, marked as possibly outdated, is served only if that fails too.
          stale = staleCacheResult(cached); cached = null;
        }
        if (requestGeneration !== cacheGeneration) return fail(409, 'Cache was cleared while this lookup was running; try again.');
      }
      if (cached) { audit('lookup', 'cache_hit'); return finish({ ...cached, cached: true }); }
      if (!inFlight.has(key)) {
        const generation = cacheGeneration; const entry = { listeners: new Set(), stage: 'Starting public-source research…', promise: null };
        const publish = message => { entry.stage = message; for (const listener of entry.listeners) listener(message); };
        entry.promise = queue.run(() => {
          if (generation !== cacheGeneration) throw new Error('Cache was cleared while this lookup was waiting; try again.');
          audit('research', 'started');
          return research(target.profileUrl, { ...options, onProgress: publish, shouldContinue: () => generation === cacheGeneration }).then(value => enrich(value, process.env, publish)).then(value => assess(value, process.env, publish, () => generation === cacheGeneration));
        }, () => publish('Waiting for an available research slot…')).then(async value => {
          if (generation !== cacheGeneration) throw new Error('Cache was cleared while this lookup was running; try again.');
          const stableKey = value.target.platformUserId ? `${value.target.platform}:${value.target.platformUserId}` : key;
          // A result weakened only because the identity recheck was refused (e.g. rate limit) is not kept for six hours.
          if (value.identityRecheckFailed) return value;
          // Results built from what a page showed are not kept either: a feed preview holds less than the profile page, and the next click should read the page afresh.
          if (String(value.target.platformUserId || '').startsWith('handle:')) return value;
          // Point this profile at the stored result only once one is stored, so an uncached fallback result does not orphan an earlier good one.
          aliases.set(key, stableKey); aliases.set(profileKey(value.target), stableKey);
          try { await cache.set(stableKey, value, Date.now() + TTL); } catch { value.warnings.push('The result could not be safely cached or persisted; it may remain only in memory.'); }
          if (generation !== cacheGeneration) throw new Error('Cache was cleared while this lookup was running; try again.');
          return value;
        }).finally(() => inFlight.delete(key));
        inFlight.set(key, entry);
      }
      const entry = inFlight.get(key); if (emit) { entry.listeners.add(progress); progress(entry.stage); res.once('close', () => entry.listeners.delete(progress)); }
      let value; try { value = await entry.promise; }
      catch (error) { if (!stale) throw error; audit('lookup', 'stale_cache'); return finish({ ...stale, cached: true }); }
      finally { entry.listeners.delete(progress); }
      audit('lookup', 'completed'); return finish({ ...value, cached: false });
    }
    if (req.method === 'POST' && url.pathname === '/settings') { const input = await body(req); let keyCheck; if (typeof input?.githubToken === 'string') keyCheck = await saveGithubToken(input.githubToken.trim()); else keyCheck = await saveOpenRouterKey(typeof input?.openrouterKey === 'string' ? input.openrouterKey.trim() : null); audit('settings', 'saved');
      // Results cached before this change were judged (or not) and fetched with the old credentials; start fresh so the new key is used.
      cacheGeneration++; queue.cancelPending(); aliases.clear(); sharedFetch.clear(); await cache.clear(); return reply(res, 200, { openRouterConfigured: Boolean(openRouterKey()), githubTokenConfigured: Boolean(githubToken()), ...(keyCheck ? { keyCheck } : {}) }, corsOrigin); }
    // Separate from /lookup: search-engine leads only; never merged into candidates, the judge or the sandbox flow.
    if (req.method === 'POST' && url.pathname === '/leads') { const input = await body(req); const found = await searchLeads(input?.username); audit('leads', 'ok'); return reply(res, 200, found, corsOrigin); }
    if (req.method === 'POST' && url.pathname === '/held') { const input = await body(req); return reply(res, 200, await heldTotal(input?.heldFor), corsOrigin); }
    if (req.method === 'POST' && url.pathname === '/profiles') { const input = await body(req); const found = await profileLeads(input?.username); audit('profiles', 'ok'); return reply(res, 200, found, corsOrigin); }
    if (req.method === 'POST' && url.pathname === '/judge-test') { const sample = await sampleJudgement(); audit('judge_test', 'ok'); return reply(res, 200, sample, corsOrigin); }
    if (req.method === 'DELETE' && url.pathname === '/cache') { cacheGeneration++; queue.cancelPending(); aliases.clear(); sharedFetch.clear(); await cache.clear(); audit('cache', 'cleared'); return reply(res, 200, { cleared: true }, corsOrigin); }
    if (req.method === 'POST' && url.pathname === '/sandbox/order') { let input = null; try { input = await body(req); } catch { /* No body: the plain demo order. */ } const order = await createSandboxOrder(input?.heldFor); audit('sandbox_order', 'created'); return reply(res, 200, order, corsOrigin); }
    return reply(res, 404, { error: 'Not found' }, corsOrigin);
  } catch (error) {
    audit(url.pathname.startsWith('/lookup') ? 'lookup' : 'request', 'failed');
    const message = String(error?.message || 'Lookup failed').slice(0, 200);
    if (emit) { emit({ type: 'error', error: message }); return res.end(); }
    return reply(res, error?.code === 'QUEUE_FULL' ? 429 : 400, { error: message }, corsOrigin);
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Universal Tip local backend: http://127.0.0.1:${PORT}`);
  console.log(openRouterKey() ? 'The extension pairs automatically. An OpenRouter key is saved, so the decision model judges each lookup.' : 'The extension pairs automatically. Next: open the Universal Tip popup and paste your OpenRouter key.');
  console.log('Keep this window open while you use the extension. Research uses public pages only; checkout is sandbox-only.');
  if (lockedRegistry) console.warn('An encrypted registry exists but is locked; configure its key before clearing it.');
});
