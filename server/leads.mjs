// Optional web-search leads for a username, through a search service the operator configures.
// Kept apart from everything else on purpose: nothing here becomes a confirmed payment link, reaches the decision model,
// or touches the PayPal flow. A search result that mentions a username next to a payment link very often
// belongs to someone else (a project they contributed to, say), so every row is a lead to read, never a destination.
// Off unless WEB_SEARCH_URL and WEB_SEARCH_HEADERS are set. A small daily cap is kept here.
const SUPPORT_HOSTS = /(^|\.)(paypal\.me|paypal\.com|ko-fi\.com|buymeacoffee\.com|patreon\.com|opencollective\.com|liberapay\.com|github\.com)$/i;
const DAY = 24 * 60 * 60 * 1000; let windowStart = 0; let used = 0;
function searchConfig(env) { try { const url = new URL(env.WEB_SEARCH_URL || ''); const headers = JSON.parse(env.WEB_SEARCH_HEADERS || '');
    if (url.protocol !== 'https:' || url.username || url.password || !headers || typeof headers !== 'object' || Array.isArray(headers)) return null;
    const clean = {}; for (const [name, value] of Object.entries(headers)) { if (!/^[\w-]{1,60}$/.test(name) || typeof value !== 'string' || !value || value.length > 400 || /[\r\n]/.test(value)) return null; clean[name.toLowerCase()] = value; }
    return Object.keys(clean).length ? { url: url.href, headers: clean } : null; } catch { return null; } }
export function leadsEnabled(env = process.env) { return Boolean(searchConfig(env)); }
// The handle must appear in the result's own address as a whole path segment for the row to be marked "names this handle".
function namesHandle(url, handle) { try { return new URL(url).pathname.split('/').filter(Boolean).some(part => part.replace(/^@/, '').toLowerCase() === handle.toLowerCase()); } catch { return false; } }
export async function searchLeads(username, env = process.env, fetcher = fetch, now = Date.now) {
  const config = searchConfig(env); if (!config) throw new Error('Web-search leads are off: set WEB_SEARCH_URL and WEB_SEARCH_HEADERS on the local server to enable them.');
  if (typeof username !== 'string' || !/^[a-z\d][\w.-]{1,38}$/i.test(username)) throw new Error('Leads need a plain username (2 to 39 letters, digits, dots, dashes or underscores).');
  const limit = /^\d{1,3}$/.test(env.LEADS_DAILY_LIMIT || '') ? Number(env.LEADS_DAILY_LIMIT) : 25;
  if (now() - windowStart > DAY) { windowStart = now(); used = 0; }
  if (used >= limit) throw new Error(`Daily web-search limit reached (${limit}).`);
  used++;
  const q = `"${username}" (paypal.me OR ko-fi.com OR buymeacoffee.com OR patreon.com OR opencollective.com OR "github.com/sponsors")`;
  const response = await fetcher(config.url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
    headers: { ...config.headers, 'content-type': 'application/json' }, body: JSON.stringify({ q, limit: 10 }) });
  if (!response.ok) throw new Error(response.status === 402 ? 'The search service balance is too low for a search.' : response.status === 401 ? 'The search service rejected the configured credentials.' : `Search provider returned HTTP ${response.status}`);
  const text = await response.text(); if (text.length > 500000) throw new Error('Search response too large');
  const rows = JSON.parse(text)?.output?.results; const leads = [];
  for (const row of Array.isArray(rows) ? rows.slice(0, 10) : []) {
    const href = typeof row?.url === 'string' ? row.url : typeof row?.link === 'string' ? row.link : ''; let url;
    try { url = new URL(href); } catch { continue; }
    if (url.protocol !== 'https:' || url.username || url.password || href.length > 2048) continue;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    leads.push({ url: url.href, title: String(row.title || '').slice(0, 160), snippet: String(row.snippet || row.description || '').slice(0, 300),
      kind: SUPPORT_HOSTS.test(host) && host !== 'github.com' && namesHandle(url.href, username) ? 'support_page_naming_this_handle' : 'mention',
      note: 'A search result, not evidence of ownership. Payment links in the snippet may belong to someone else.' });
  }
  const cost = Number(response.headers?.get?.(env.WEB_SEARCH_COST_MICRO_HEADER || 'x-cost-micro'));
  return { username, query: q, leads, costUsd: Number.isFinite(cost) ? cost / 1e6 : null, usedToday: used, dailyLimit: limit };
}
export function resetLeadsForTests() { windowStart = 0; used = 0; }

// Optional profile lookup: forwards one username to a separate service the operator runs (PROFILE_LOOKUP_URL) and
// returns the platform names it reports. This project holds no lookup logic of its own; like search leads, the rows
// are leads to read, never payment candidates, and never reach the decision model or the PayPal sandbox flow.
function lookupBase(env) { try { const url = new URL(env.PROFILE_LOOKUP_URL || ''); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url : null; } catch { return null; } }
export function profileLookupEnabled(env = process.env) { return Boolean(lookupBase(env)); }
export async function profileLeads(username, env = process.env, fetcher = fetch) {
  const base = lookupBase(env); if (!base) throw new Error('Profile lookup is off: set PROFILE_LOOKUP_URL on the local server to enable it.');
  if (typeof username !== 'string' || !/^[a-z\d][\w.-]{1,38}$/i.test(username)) throw new Error('Profile lookup needs a plain username (2 to 39 letters, digits, dots, dashes or underscores).');
  const url = new URL(base); url.searchParams.set('target', username); url.searchParams.set('type', 'username'); url.searchParams.set('compact', '1'); url.searchParams.set('limit', '300');
  const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(300000) });
  const text = await response.text(); if (text.length > 500000) throw new Error('Profile lookup response too large');
  let data; try { data = JSON.parse(text); } catch { throw new Error('Profile lookup returned an unreadable answer.'); }
  if (!response.ok || data?.ok !== true) throw new Error(response.status === 503 ? 'The profile lookup service has no allowance left right now.' : `Profile lookup did not complete (HTTP ${response.status}).`);
  const seen = new Set(); const profiles = [];
  for (const row of Array.isArray(data.results) ? data.results.slice(0, 300) : []) {
    const platform = String(row?.platform || '').replace(/[^\w .&+'-]/g, '').slice(0, 40); if (!platform || seen.has(platform.toLowerCase())) continue; seen.add(platform.toLowerCase());
    profiles.push({ platform, note: 'An account with this username exists here. The same name on another site can be a different person.' });
  }
  return { username, profiles, total: Number.isInteger(data.hits) ? data.hits + (Number.isInteger(data.dropped) ? data.dropped : 0) : profiles.length };
}

// Username OSINT for the main lookup: ask the profile-lookup service and the web search (whichever are configured)
// where else this username appears, and add support pages under that name as UNCONFIRMED leads. A matching username
// is not proof of the same person, so these never become published links and never get amount buttons.
const SUPPORT_PLATFORMS = { paypalme: ['paypal_me', u => `https://paypal.me/${u}`], buymeacoffee: ['other_payment_link', u => `https://buymeacoffee.com/${u}`], kofi: ['other_payment_link', u => `https://ko-fi.com/${u}`],
  patreon: ['other_payment_link', u => `https://www.patreon.com/${u}`], opencollective: ['other_payment_link', u => `https://opencollective.com/${u}`] };
const sameLink = value => String(value || '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');
export async function enrich(result, env = process.env, publish = () => {}, fetcher = fetch) {
  const target = result?.target; const username = target?.username;
  if (!target || !Array.isArray(result.candidates) || !['github', 'reddit', 'x', 'youtube', 'facebook'].includes(target.platform) || typeof username !== 'string' || !/^[a-z\d][\w.-]{1,38}$/i.test(username)) return result;
  const useProfiles = profileLookupEnabled(env); const useSearch = leadsEnabled(env); if (!useProfiles && !useSearch) return result;
  publish?.('Searching other platforms and the web for this username (about a minute)…');
  const [profiles, search] = await Promise.allSettled([useProfiles ? profileLeads(username, env, fetcher) : null, useSearch ? searchLeads(username, env, fetcher) : null]);
  const candidates = [...result.candidates]; const warnings = [...(result.warnings || [])]; const have = new Set(candidates.map(c => sameLink(c.candidate_value))); const now = new Date().toISOString(); const added = new Map();
  const add = (url, type, source, excerpt) => { const key = sameLink(url); if (have.has(key)) return; const earlier = added.get(key);
    if (earlier) { earlier.evidence_excerpt += ` Also: ${excerpt}`; earlier.reason = 'Both the cross-platform search and a web search found a page under this username. That is still not proof it belongs to the same person.'; return; }
    const candidate = { platform: target.platform, platform_user_id: target.platformUserId, profile_url: target.profileUrl, candidate_type: type, candidate_value: url, source_url: source, retrieval_url: source,
      evidence_type: 'username_match', evidence_excerpt_or_hash: 'not hashed (username search lead)', evidence_excerpt: excerpt, observed_at: now, checked_at: now, identity_association_status: 'username_match',
      contact_reliability_status: 'not_independently_verified', payment_authorization_status: 'not_authorized', verification_method: 'username search', decision: 'potential_contact',
      reason: 'A page under the same username exists on this platform. The same name on another site can be a different person, so it is not confirmed as theirs.' };
    added.set(key, candidate); candidates.push(candidate); };
  const osint = { platforms: [], platformsTotal: 0, searchResults: 0 };
  if (profiles.status === 'fulfilled' && profiles.value) { osint.platforms = profiles.value.profiles.map(p => p.platform); osint.platformsTotal = profiles.value.total;
    for (const p of profiles.value.profiles) { const known = SUPPORT_PLATFORMS[p.platform.toLowerCase().replace(/[^a-z]/g, '')]; if (known) { const url = known[1](username); add(url, known[0], url, `The cross-platform search reports the username "${username}" on ${p.platform}.`); } } }
  else if (useProfiles) warnings.push('The cross-platform username search did not complete.');
  if (search.status === 'fulfilled' && search.value) { osint.searchResults = search.value.leads.length;
    for (const lead of search.value.leads) { const at = new URL(lead.url); const parts = at.pathname.split('/').filter(Boolean); if (lead.kind !== 'support_page_naming_this_handle' || parts.length !== 1 || parts[0].replace(/^@/, '').toLowerCase() !== username.toLowerCase()) continue; const page = at.origin + '/' + parts[0];
      add(page, /(^|\.)paypal\.(me|com)$/i.test(at.hostname) ? 'paypal_me' : 'other_payment_link', page, `A web search for "${username}" returned this page: ${lead.title}`.slice(0, 240)); } }
  else if (useSearch) warnings.push('The web search for this username did not complete.');
  const status = candidates.some(c => c.decision === 'published_payment_link') ? result.status : candidates.length ? 'Potential contact — unverified' : result.status;
  return { ...result, candidates, warnings, status, osint };
}
