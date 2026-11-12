import test from 'node:test';
import assert from 'node:assert/strict';
import { enrich, leadsEnabled, profileLeads, profileLookupEnabled, resetLeadsForTests, searchLeads } from '../server/leads.mjs';
const env = { WEB_SEARCH_URL: 'https://search.example/call', WEB_SEARCH_HEADERS: JSON.stringify({ 'x-api-token': 'tk_test_0123456789abcdef', 'x-max-cost': '0.02' }) };
const answer = rows => async (url, options) => ({ ok: true, status: 200, headers: new Map([['x-cost-micro', '380']]), text: async () => JSON.stringify({ output: { results: rows } }), sent: { url, options } });
test('leads are off without a configured search service and never guess', async () => {
  assert.equal(leadsEnabled({}), false); await assert.rejects(searchLeads('alice', {}), /set WEB_SEARCH_URL/);
});
test('search results come back as leads only, with a cost and a cap', async () => {
  resetLeadsForTests(); let sent;
  const fetcher = async (url, options) => { sent = { url, options }; return answer([
    { url: 'https://github.com/someone/project', title: 'someone/project', snippet: 'https://paypal.me/someoneelse · @alice' },
    { url: 'https://ko-fi.com/alice', title: 'Alice on Ko-fi', snippet: 'Support Alice' },
    { url: 'https://ko-fi.com/alicewonder', title: 'Other', snippet: '' },
    { url: 'javascript:alert(1)', title: 'bad' }, { url: 'http://insecure.example/alice', title: 'http' }])(url, options); };
  const found = await searchLeads('alice', env, fetcher);
  assert.equal(sent.url, 'https://search.example/call'); assert.equal(sent.options.headers['x-max-cost'], '0.02'); assert.equal(leadsEnabled({ WEB_SEARCH_URL: 'http://search.example/', WEB_SEARCH_HEADERS: '{"a":"b"}' }), false);
  assert.match(JSON.parse(sent.options.body).q, /^"alice" \(paypal\.me OR/);
  assert.deepEqual(found.leads.map(lead => [lead.url, lead.kind]), [['https://github.com/someone/project', 'mention'], ['https://ko-fi.com/alice', 'support_page_naming_this_handle'], ['https://ko-fi.com/alicewonder', 'mention']]);
  assert.ok(found.leads.every(lead => /not evidence of ownership/.test(lead.note))); assert.equal(found.costUsd, 0.00038);
  assert.ok(!('candidates' in found), 'Nothing here is shaped like a payment candidate');
  await assert.rejects(searchLeads('not a handle!', env, fetcher), /plain username/);
});
test('the daily cap stops further paid searches', async () => {
  resetLeadsForTests(); let calls = 0; const fetcher = async (...args) => { calls++; return answer([])(...args); };
  const capped = { ...env, LEADS_DAILY_LIMIT: '2' };
  await searchLeads('alice', capped, fetcher); await searchLeads('alice', capped, fetcher);
  await assert.rejects(searchLeads('alice', capped, fetcher), /Daily web-search limit reached \(2\)/); assert.equal(calls, 2);
});
test('provider refusals are reported plainly', async () => {
  resetLeadsForTests(); const refuse = status => async () => ({ ok: false, status });
  await assert.rejects(searchLeads('alice', env, refuse(402)), /balance is too low/); await assert.rejects(searchLeads('alice', env, refuse(401)), /rejected the configured credentials/);
});

test('profile lookup is off without an address and forwards only the username when on', async () => {
  assert.equal(profileLookupEnabled({}), false); await assert.rejects(profileLeads('alice', {}), /set PROFILE_LOOKUP_URL/);
  const env = { PROFILE_LOOKUP_URL: 'http://127.0.0.1:8791/search' }; assert.equal(profileLookupEnabled(env), true);
  await assert.rejects(profileLeads('not a handle!', env, async () => { throw new Error('must not be called'); }), /plain username/);
  let asked;
  const found = await profileLeads('alice', env, async url => { asked = String(url); return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, hits: 3, dropped: 2, results: [{ platform: 'GitLab', profileUrl: 'https://gitlab.com', extras: { email: 'x@example.com' } }, { platform: 'gitlab' }, { platform: 'Imgur<script>' }] }) }; });
  assert.equal(asked, 'http://127.0.0.1:8791/search?target=alice&type=username&compact=1&limit=300');
  assert.deepEqual(found.profiles.map(p => p.platform), ['GitLab', 'Imgurscript']); assert.equal(found.total, 5);
  assert.ok(!JSON.stringify(found).includes('example.com'));
  await assert.rejects(profileLeads('alice', env, async () => ({ ok: false, status: 503, text: async () => '{"ok":false}' })), /no allowance/);
});

test('username OSINT adds support pages as unconfirmed leads only, and never duplicates a published link', async () => {
  const base = { target: { platform: 'github', username: 'alice', profileUrl: 'https://github.com/alice', platformUserId: '1' }, status: 'Published payment link (not independently account-verified)', warnings: [],
    candidates: [{ candidate_type: 'paypal_me', candidate_value: 'https://paypal.me/alice', decision: 'published_payment_link' }] };
  assert.equal(await enrich(base, {}), base);
  resetLeadsForTests(); const env = { PROFILE_LOOKUP_URL: 'http://127.0.0.1:8791/search', WEB_SEARCH_URL: 'https://search.example/call', WEB_SEARCH_HEADERS: '{"x-api-token":"abc"}' };
  const fetcher = async url => String(url).startsWith('http://127.0.0.1:8791') ? { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, hits: 3, results: [{ platform: 'PaypalMe' }, { platform: 'BuyMeACoffee' }, { platform: 'Chess' }] }) }
    : { ok: true, status: 200, headers: { get: () => '380' }, text: async () => JSON.stringify({ output: { results: [{ url: 'https://buymeacoffee.com/alice', title: 'alice' }, { url: 'https://ko-fi.com/bob', title: 'bob mentions alice' }] } }) };
  const out = await enrich(base, env, () => {}, fetcher);
  assert.deepEqual(out.candidates.map(c => [c.candidate_value, c.decision]), [['https://paypal.me/alice', 'published_payment_link'], ['https://buymeacoffee.com/alice', 'potential_contact']]);
  assert.match(out.candidates[1].reason, /Both the cross-platform search and a web search/); assert.equal(out.candidates[1].payment_authorization_status, 'not_authorized');
  assert.equal(out.status, base.status); assert.deepEqual(out.osint.platforms, ['PaypalMe', 'BuyMeACoffee', 'Chess']);
  const none = await enrich({ ...base, candidates: [], status: 'No safe match' }, env, () => {}, async () => { throw new Error('down'); });
  assert.equal(none.status, 'No safe match'); assert.equal(none.warnings.length, 2);
  assert.equal((await enrich({ ...base, target: { ...base.target, platform: 'web' } }, env, () => {}, fetcher)).osint, undefined);
});
