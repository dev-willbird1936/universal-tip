import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { canonicalProfile, memoFetch, platformLimits, textPaymentLinks, fundingManifest, paypalLinks, htmlPaymentLinks, declaredIdentityLinks, declaredContactLinks, research, resolvePlatformId, staleCacheResult } from '../server/research.mjs';
import { isPublicIPv4, publicURL, fetchWithRetry, enforceDeadline } from '../server/net.mjs';
import { assess } from '../server/providers.mjs';
process.env.PROVIDER_DAILY_BUDGET_CENTS = '100';

test('canonicalizes known platform profiles and rejects non-profile paths', () => {
  assert.equal(canonicalProfile('https://github.com/Alice/').profileUrl, 'https://github.com/Alice');
  assert.equal(canonicalProfile('https://github.com/Alice/repo/issues/1').profileUrl, 'https://github.com/Alice');
  assert.equal(canonicalProfile('https://gist.github.com/Alice/abc').profileUrl, 'https://github.com/Alice');
  assert.throws(() => canonicalProfile('https://github.com/settings/profile'));
  assert.equal(canonicalProfile('https://reddit.com/u/alice/').profileUrl, 'https://www.reddit.com/user/alice/');
  assert.throws(() => canonicalProfile('https://github.com/login'));
  assert.throws(() => canonicalProfile('https://reddit.com/r/programming/'));
});
test('rejects private and special network destinations', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '203.0.113.7', '::1']) assert.equal(isPublicIPv4(address), false, address);
  assert.equal(isPublicIPv4('8.8.8.8'), true);
  assert.equal(publicURL('https://example.com/profile?token=secret#fragment').href, 'https://example.com/profile');
  assert.throws(() => publicURL(`https://example.com/${'x'.repeat(2050)}`), /size limit/);
  for (const url of ['http://example.com', 'https://127.0.0.1', 'https://[::1]', 'https://[::ffff:7f00:1]', 'https://localhost', 'https://user:password@example.com', 'https://example.com:8443']) assert.throws(() => publicURL(url));
});
test('public-source deadline is absolute and clears after request closure', async () => {
  const stalled = new EventEmitter(); let failure; stalled.destroy = error => { failure = error; };
  enforceDeadline(stalled, 10); await delay(25); assert.match(failure.message, /timed out/);
  const closed = new EventEmitter(); let destroyed = false; closed.destroy = () => { destroyed = true; };
  enforceDeadline(closed, 10); closed.emit('close'); await delay(25); assert.equal(destroyed, false);
});
test('public-source retries are bounded and do not retry policy or rate-limit failures', async () => {
  let calls = 0;
  const response = await fetchWithRetry('https://example.com', {}, async () => { if (++calls === 1) throw new Error('Remote source returned HTTP 503'); return { text: 'ok' }; });
  assert.equal(response.text, 'ok'); assert.equal(calls, 2);
  calls = 0; await assert.rejects(fetchWithRetry('https://example.com', {}, async () => { calls++; throw new Error('Remote source returned HTTP 429'); }), /429/); assert.equal(calls, 1);
  calls = 0; await assert.rejects(fetchWithRetry('https://example.com', {}, async () => { calls++; throw new Error('Destination has a non-public or unsupported address'); }), /non-public/); assert.equal(calls, 1);
});
test('cache clear stops a lookup before subsequent public-source requests', async () => {
  let active = true, calls = 0;
  const fetcher = async () => { calls++; active = false; return { text: JSON.stringify({ id: 42, login: 'alice', blog: 'https://alice.example' }) }; };
  await assert.rejects(research('https://github.com/alice', { fetcher, shouldContinue: () => active }), /Cache was cleared/);
  assert.equal(calls, 1);
  calls = 0; active = true;
  await assert.rejects(fetchWithRetry('https://example.com', { shouldContinue: () => active }, async () => { calls++; active = false; throw new Error('Remote source returned HTTP 503'); }), /Cache was cleared/);
  assert.equal(calls, 1, 'A canceled lookup must not start a retry');
});

test('extracts only real PayPal links, not lookalikes or script text', () => {
  assert.deepEqual(paypalLinks('Support: https://paypal.me/alice. https://evil.test/https://paypal.me/bob'), ['https://paypal.me/alice']);
  const html = '<script>"https://paypal.me/fake"</script><a href="https://evil.test/?next=https://paypal.me/evil">bad</a><a href="https://paypal.me/real?x=1">good</a><a href="https://www.paypal.com/donate/?hosted_button_id=P2P6NCHSZ2E3C&amp;tracking=123">Donate</a>';
  assert.deepEqual(htmlPaymentLinks(html, 'https://example.com'), ['https://paypal.me/real', 'https://www.paypal.com/donate/?hosted_button_id=P2P6NCHSZ2E3C']);
  assert.deepEqual(paypalLinks('https://www.paypal.com/donate/?hosted_button_id=P2P6NCHSZ2E3C'), ['https://www.paypal.com/donate/?hosted_button_id=P2P6NCHSZ2E3C']);
  assert.deepEqual(paypalLinks('https://paypal.me/alice/not-an-amount'), []);
  assert.deepEqual(paypalLinks('https://paypal.me/alice/12.50USD'), ['https://paypal.me/alice']);
  assert.deepEqual(paypalLinks('https://www.paypal.com/donate/?hosted_button_id=P2P6NCHSZ2E3C&hosted_button_id=ANOTHER12'), []);
  assert.deepEqual(htmlPaymentLinks('<a href="https://paypal.com/donate/?hosted_button_id=P2P6NCHSZ2E3C&amp;hosted_button_id=ANOTHER12">bad</a>', 'https://example.com'), []);
  assert.deepEqual(htmlPaymentLinks(`<a href="https://paypal.me/${'a'.repeat(129)}">bad</a>`, 'https://example.com'), []);
  assert.deepEqual(htmlPaymentLinks('<pre><code><a href="https://paypal.me/example">Example</a></code></pre>', 'https://example.com'), []);
  assert.deepEqual(htmlPaymentLinks('<a href="https://paypal.me/alice/12.50USD">Support</a>', 'https://example.com'), ['https://paypal.me/alice']);
});
test('identity declarations are explicit, bounded and never establish ownership', () => {
  const html = '<a rel="me" href="https://social.example/alice?tracking=123">profile</a><link itemprop="sameAs" href="https://other.example/alice"><a rel="me" href="http://127.0.0.1/private">bad</a><a href="https://unrelated.example/">unrelated</a>';
  assert.deepEqual(declaredIdentityLinks(html, 'https://alice.example/'), ['https://social.example/alice', 'https://other.example/alice']);
});
test('Schema.org Person sameAs entries are shown only as unverified page declarations', async () => {
  const html = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Article', author: { '@type': 'Person', sameAs: ['https://social.example/alice?tracking=1', 'https://paypal.me/alice', 'http://127.0.0.1/private', 'javascript:alert(1)'] } })}</script><script type="application/ld+json">{broken</script>`;
  const result = await research('https://example.com/post', { fetcher: async () => ({ text: html, contentType: 'text/html' }) });
  assert.equal(result.status, 'No safe match'); assert.equal(result.candidates.length, 0);
  assert.deepEqual(result.identityLinks.map(item => item.url).sort(), ['https://paypal.me/alice', 'https://social.example/alice'].sort());
  assert.ok(result.identityLinks.every(item => item.relation.includes('association not established')));
  const duplicate = await research('https://example.com/post', { fetcher: async () => ({ text: `<a rel="me" href="https://social.example/alice">Me</a><script type="application/ld+json">${JSON.stringify({ '@type': 'Person', sameAs: 'https://social.example/alice' })}</script>`, contentType: 'text/html' }) });
  assert.equal(duplicate.identityLinks.length, 1, 'The same declaration from the same source should not appear twice');
});

test('public mailto and telephone links are masked and never imply attribution or payment permission', async () => {
  const html = '<a href="mailto:alice@example.com">Email</a><a href="tel:+1-212-555-0101">Call</a><a href="mailto:alice@example.com,bob@example.com">Ambiguous</a><a href="tel:123">Invalid</a>';
  const result = await research('https://example.com/about', { fetcher: async () => ({ text: html, contentType: 'text/html' }) });
  assert.equal(result.status, 'Potential contact — unverified');
  assert.deepEqual(result.candidates.map(candidate => [candidate.candidate_type, candidate.candidate_value]), [['email', 'a***@example.com'], ['phone', '•••01']]);
  assert.ok(result.candidates.every(candidate => candidate.identity_association_status === 'unverified_page' && candidate.contact_reliability_status === 'not_independently_verified' && candidate.payment_authorization_status === 'not_authorized'));
  assert.doesNotMatch(JSON.stringify(result), /alice@example\.com|212-555-0101|bob@example\.com/);
});

test('contact links are explicit, same-origin leads, not payment destinations', async () => {
  const html = '<a href="/contact?tracking=1">Contact me</a><a href="https://other.example/contact">Contact</a><a href="/terms">Terms</a>';
  assert.deepEqual(declaredContactLinks(html, 'https://alice.example/'), ['https://alice.example/contact']);
  const result = await research('https://alice.example/', { fetcher: async () => ({ text: html, contentType: 'text/html' }) });
  assert.equal(result.status, 'Potential contact — unverified'); assert.equal(result.candidates[0].candidate_type, 'contact_url');
  assert.equal(result.candidates[0].payment_authorization_status, 'not_authorized');
});
test('one explicit same-origin contact page is a bounded fallback, with masked contacts', async () => {
  const urls = [];
  const fetcher = async url => { urls.push(url); return { contentType: 'text/html', text: url.endsWith('/contact') ? '<a href="mailto:alice@example.com">Email</a><a rel="contact" href="/another">Contact</a>' : '<a rel="contact" href="/contact">Contact</a><a rel="contact" href="https://other.example/contact">Other</a>' }; };
  const result = await research('https://example.com/about', { fetcher });
  assert.deepEqual(urls, ['https://example.com/about', 'https://example.com/funding.json', 'https://example.com/contact', 'https://keybase.io/_/api/1.0/user/lookup.json?domain=example.com&fields=basics,proofs_summary']);
  const email = result.candidates.find(candidate => candidate.candidate_type === 'email');
  assert.equal(email.candidate_value, 'a***@example.com'); assert.equal(email.source_url, 'https://example.com/contact'); assert.equal(email.payment_authorization_status, 'not_authorized');
  assert.doesNotMatch(JSON.stringify(result), /alice@example\.com/);
  const sufficient = [];
  await research('https://example.com/about', { fetcher: async url => { sufficient.push(url); return { contentType: 'text/html', text: '<a href="https://paypal.me/example">Support</a><a href="/contact" rel="contact">Contact</a><a href="mailto:alice@example.com">Email</a>' }; } });
  assert.deepEqual(sufficient, ['https://example.com/about', 'https://example.com/funding.json', 'https://keybase.io/_/api/1.0/user/lookup.json?domain=example.com&fields=basics,proofs_summary'], 'Do not follow the contact page once an explicit contact is available');
});

test('GitHub evidence is attributed to owner-controlled sources; AI never authorizes', async () => {
  const fetcher = async url => {
    if (url.startsWith('https://api.github.com/')) return { text: JSON.stringify({ id: 42, login: 'alice', name: 'Alice', bio: 'Support: https://paypal.me/alice; email alice@example.com; phone +1 (555) 123-4567; https://user:password@example.com/path?token=secret#fragment; bare.example/path?api_key=hidden#hiddenfragment', blog: '' }) };
    throw new Error('404');
  };
  const progress = [];
  const result = await assess(await research('https://github.com/alice', { fetcher, onProgress: message => progress.push(message) }), {});
  assert.ok(progress.some(message => message.includes('GitHub profile'))); assert.ok(progress.some(message => message.includes('funding file')));
  assert.match(result.status, /^Published payment link/);
  assert.equal(result.target.platformUserId, '42');
  assert.equal(result.candidates[0].payment_authorization_status, 'not_authorized');
  assert.match(result.candidates[0].evidence_excerpt_or_hash, /^sha256:[a-f\d]{64}$/);
  assert.ok(result.candidates[0].evidence_excerpt.includes('[email redacted]')); assert.ok(result.candidates[0].evidence_excerpt.includes('[number redacted]'));
  assert.doesNotMatch(JSON.stringify(result), /password|token=secret|api_key=hidden|hiddenfragment/);
  assert.notEqual(result.status, 'Verified payment destination');
});
test('arbitrary pages cannot self-assert attribution', async () => {
  const result = await research('https://creator.example/about', { fetcher: async () => ({ text: '<a href="https://paypal.me/alice">tip</a>', contentType: 'text/html' }) });
  assert.equal(result.status, 'Potential contact — unverified');
  assert.equal(result.candidates[0].payment_authorization_status, 'not_authorized');
});
test('linked personal page is followed only from the GitHub profile', async () => {
  const urls = [];
  const fetcher = async url => { urls.push(url);
    if (url.startsWith('https://api.github.com/')) return { text: JSON.stringify({ id: 99, login: 'alice', blog: 'https://alice.example/' }) };
    if (url === 'https://alice.example/') return { text: '<a href="https://paypal.me/alice">Donate</a><a rel="me" href="https://social.example/alice">Social</a>', contentType: 'text/html' };
    throw new Error('not found');
  };
  const result = await research('https://github.com/alice', { fetcher });
  assert.equal(result.candidates[0].source_url, 'https://alice.example/');
  assert.equal(result.candidates[0].identity_association_status, 'linked_creator_site');
  assert.equal(result.identityLinks.length, 2); assert.equal(result.identityLinks[1].url, 'https://social.example/alice');
  assert.equal(urls.length, 9, 'Declared identity links are not automatically fetched; the extra requests are the raw profile README, the .github funding.json, the repository search, the Sponsors page and the profile ID recheck'); assert.ok(urls.includes('https://github.com/sponsors/alice')); assert.ok(urls.includes('https://raw.githubusercontent.com/alice/.github/HEAD/funding.json'));
});
test('an explicit profile PayPal link avoids unnecessary visits to the linked website', async () => {
  const urls = [];
  const result = await research('https://github.com/alice', { fetcher: async url => { urls.push(url); if (url.includes('/users/')) return { text: JSON.stringify({ id: 12, login: 'alice', bio: 'Support https://paypal.me/alice', blog: 'https://alice.example/' }) }; throw new Error('not found'); } });
  assert.match(result.status, /^Published payment link/); assert.ok(result.identityLinks.some(link => link.url === 'https://alice.example/'));
  assert.equal(urls.some(url => url.startsWith('https://alice.example/')), false, 'A sufficient first-party PayPal link should stop this fallback');
});

test('fresh multi-source GitHub evidence fails safely if the stable identity changes or cannot be rechecked', async () => {
  const run = async secondResponse => {
    let profiles = 0;
    const fetcher = async url => {
      if (url.includes('/users/')) { profiles++; if (profiles === 1) return { text: JSON.stringify({ id: 12, login: 'alice' }) }; return secondResponse(); }
      if (url.includes('/repos/')) return { contentType: 'text/html', text: '<a href="https://paypal.me/alice">Support</a>' };
      throw new Error('not found');
    };
    return research('https://github.com/alice', { fetcher });
  };
  await assert.rejects(run(() => ({ text: JSON.stringify({ id: 13, login: 'alice' }) })), /identity changed during this lookup/);
  const uncertain = await run(() => { throw new Error('HTTP 403'); });
  assert.equal(uncertain.status, 'Potential contact — unverified'); assert.equal(uncertain.identityRecheckFailed, true);
  assert.equal(uncertain.candidates[0].identity_association_status, 'unverified_profile_id'); assert.deepEqual(uncertain.identityLinks, []);
  const assessed = await assess(uncertain, { ENABLE_PARALLEL: '1', PARALLEL_API_KEY: 'fixture', ENABLE_DREX: '1', DREX_API_KEY: 'fixture' });
  assert.ok(assessed.warnings.some(warning => warning.includes('AI checks were skipped'))); assert.equal(assessed.assessments.length, 0);
});

test('a PayPal URL in the profile website field is evidence, never fetched as a page', async () => {
  const urls = [];
  const result = await research('https://github.com/alice', { fetcher: async url => { urls.push(url); if (url.includes('/users/')) return { text: JSON.stringify({ id: 12, login: 'alice', blog: 'paypal.me/alice' }) }; throw new Error('not found'); } });
  assert.equal(result.candidates[0].candidate_value, 'https://paypal.me/alice'); assert.match(result.status, /^Published payment link/);
  assert.equal(urls.some(url => url.includes('paypal.me')), false, 'Discovery must not open a payment destination');
});

test('FUNDING.yml considers only real custom URLs and same-owner sponsor entries', async () => {
  const fetcher = async url => {
    if (url.includes('/users/')) return { text: JSON.stringify({ id: 12, login: 'alice' }) };
    if (url.startsWith('https://raw.githubusercontent.com/') && !url.endsWith('/README.md')) return { text: '# https://paypal.me/not-a-funding-link\ncustom: ["https://paypal.me/alice"]\ngithub: [alice, other]\n' };
    throw new Error('not found');
  };
  const result = await research('https://github.com/alice', { fetcher });
  assert.deepEqual(result.candidates.map(c => c.candidate_value).sort(), ['https://github.com/sponsors/alice', 'https://paypal.me/alice']);
});
test('FUNDING.yml platform entries become support links only for plain account names', async () => {
  const fetcher = async url => {
    if (url.includes('/users/')) return { text: JSON.stringify({ id: 12, login: 'alice' }) };
    if (url.startsWith('https://raw.githubusercontent.com/')) return { text: 'ko_fi: alice\npatreon: "../evil?x=1"\nopen_collective: [alice-oc, "https://evil.example"]\ntidelift: npm/alice\n' };
    throw new Error('not found');
  };
  const result = await research('https://github.com/alice', { fetcher });
  assert.deepEqual(result.candidates.map(c => c.candidate_value).sort(), ['https://ko-fi.com/alice', 'https://opencollective.com/alice-oc']);
  assert.ok(result.candidates.every(c => c.candidate_type === 'other_payment_link' && c.payment_authorization_status === 'not_authorized'));
});
test('most-starred own repository funding file is a fallback only for a repository the profile owns', async () => {
  const run = async (repo, profileFunding) => {
    const urls = [];
    const fetcher = async url => { urls.push(url);
      if (url.includes('/search/repositories')) return { text: JSON.stringify({ items: [repo] }) };
      if (url.includes('/users/')) return { text: JSON.stringify({ id: 12, login: 'alice' }) };
      if (url === 'https://raw.githubusercontent.com/alice/.github/HEAD/FUNDING.yml' && profileFunding) return { text: profileFunding };
      if (url === 'https://raw.githubusercontent.com/alice/tool/HEAD/.github/FUNDING.yml') return { text: 'ko_fi: alice\n' };
      throw new Error('not found');
    };
    return { result: await research('https://github.com/alice', { fetcher }), urls };
  };
  const own = await run({ name: 'tool', fork: false, owner: { id: 12 } });
  assert.deepEqual(own.result.candidates.map(c => c.candidate_value), ['https://ko-fi.com/alice']);
  assert.equal(own.result.candidates[0].source_url, 'https://github.com/alice/tool/blob/HEAD/.github/FUNDING.yml');
  for (const repo of [{ name: 'tool', fork: true, owner: { id: 12 } }, { name: 'tool', fork: false, owner: { id: 99 } }, { name: '../x', fork: false, owner: { id: 12 } }]) assert.equal((await run(repo)).result.candidates.length, 0);
  const skipped = await run({ name: 'tool', fork: false, owner: { id: 12 } }, 'github: alice\n');
  assert.equal(skipped.urls.some(url => url.includes('/search/repositories')), false);
});
test('oversized funding files are not parsed or trusted', async () => {
  const fetcher = async url => {
    if (url.includes('/users/')) return { text: JSON.stringify({ id: 12, login: 'alice' }) };
    if (url.startsWith('https://raw.githubusercontent.com/') && !url.endsWith('/README.md')) return { text: `custom: https://paypal.me/alice\n#${'x'.repeat(17000)}` };
    throw new Error('not found');
  };
  const result = await research('https://github.com/alice', { fetcher });
  assert.equal(result.candidates.length, 0); assert.ok(result.warnings.some(warning => warning.includes('funding file')));
});

test('GitHub profile README is parsed for real rendered links, not code samples', async () => {
  const fetcher = async (url, options = {}) => {
    if (url.includes('/users/')) return { text: JSON.stringify({ id: 77, login: 'alice' }) };
    if (url.includes('/repos/')) { assert.equal(options.headers.accept, 'application/vnd.github.html+json'); return { contentType: 'application/vnd.github.html+json; charset=utf-8', text: '<code>https://paypal.me/fake</code><a href="https://paypal.me/alice">Support</a>' }; }
    throw new Error('not found');
  };
  const result = await research('https://github.com/alice', { fetcher });
  assert.equal(result.candidates.length, 1); assert.equal(result.candidates[0].candidate_value, 'https://paypal.me/alice');
  assert.match(result.candidates[0].source_url, /alice\/alice#readme/);
});
test('cautionary context beside a payment link prevents an endorsement claim', async () => {
  const fetcher = async (url, options = {}) => {
    if (url.includes('/users/')) return { text: JSON.stringify({ id: 77, login: 'alice' }) };
    if (url.includes('/repos/')) return { contentType: 'text/html', text: '<p>Warning: do not pay <a href="https://paypal.me/scammer">this account</a>.</p>' };
    throw new Error('not found');
  };
  const result = await research('https://github.com/alice', { fetcher });
  assert.equal(result.status, 'Potential contact — unverified'); assert.equal(result.candidates[0].decision, 'potential_contact');
  assert.match(result.candidates[0].reason, /cautionary or example language/); assert.equal(result.candidates[0].payment_authorization_status, 'not_authorized');
  const bio = await research('https://github.com/alice', { fetcher: async url => { if (url.includes('/users/')) return { text: JSON.stringify({ id: 77, login: 'alice', bio: 'Never pay https://paypal.me/scammer' }) }; throw new Error('not found'); } });
  assert.equal(bio.status, 'Potential contact — unverified'); assert.match(bio.candidates[0].reason, /cautionary/);
});

test('cached profile IDs are re-resolved and unavailable identity checks downgrade without mutation', async () => {
  const target = canonicalProfile('https://github.com/alice');
  const actual = await resolvePlatformId(target, { fetcher: async () => ({ text: JSON.stringify({ id: 123, login: 'alice' }) }) });
  assert.equal(actual, '123');
  await assert.rejects(resolvePlatformId(target, { fetcher: async () => ({ text: JSON.stringify({ id: -1 }) }) }), /invalid identity/);
  await assert.rejects(resolvePlatformId(target, { fetcher: async () => ({ text: JSON.stringify({ id: 123, login: 'someone-else' }) }) }), /invalid identity/);
  await assert.rejects(resolvePlatformId(target, { fetcher: async () => ({ text: 'private-test-marker not json' }) }), error => error.message === 'GitHub returned an invalid response');
  const original = { status: 'Published payment link (not independently account-verified)', candidates: [{ decision: 'published_payment_link', reason: 'Profile listed it.', payment_authorization_status: 'not_authorized' }], warnings: [] };
  const stale = staleCacheResult(original); assert.equal(stale.status, 'Potential contact — unverified'); assert.equal(stale.candidates[0].decision, 'potential_contact'); assert.equal(stale.candidates[0].identity_association_status, 'stale_profile_link'); assert.deepEqual(stale.assessments, []);
  assert.match(stale.warnings[0], /reassigned username/); assert.equal(original.candidates[0].decision, 'published_payment_link');
});
test('platform access denials are surfaced as actionable errors, not no-match results', async () => {
  const blocked = async () => { throw new Error('Remote source returned HTTP 403'); };
  await assert.rejects(research('https://github.com/alice', { fetcher: blocked }), /GitHub denied or rate-limited/);
  await assert.rejects(research('https://www.reddit.com/user/alice/', { fetcher: blocked }), /approved Reddit OAuth access may be required/i);
  const unauthorized = async () => { throw new Error('Remote source returned HTTP 401'); };
  await assert.rejects(research('https://github.com/alice', { fetcher: unauthorized, githubToken: 'fixture' }), /GitHub rejected the configured token/);
  await assert.rejects(research('https://www.reddit.com/user/alice/', { fetcher: unauthorized, redditAccessToken: 'fixture' }), /Reddit rejected the configured OAuth token/);
});
test('approved Reddit OAuth token is sent only to the Reddit OAuth API', async () => {
  const observed = [];
  const fetcher = async (url, options) => { observed.push({ url, headers: options.headers }); return { text: JSON.stringify({ data: { id: 'abc', name: 'example_user', subreddit: { public_description: 'https://paypal.me/example' } } }) }; };
  const result = await research('https://www.reddit.com/user/example_user/', { fetcher, redditAccessToken: 'test-bearer' });
  assert.equal(observed[0].url, 'https://oauth.reddit.com/user/example_user/about.json');
  assert.equal(observed[0].headers.authorization, 'Bearer test-bearer');
  assert.equal(result.target.platformUserId, 'abc'); assert.match(result.status, /^Published payment link/);
  assert.equal(result.candidates[0].payment_authorization_status, 'not_authorized');
});
test('GitHub public contact is masked and is not payment verification', async () => {
  const fetcher = async url => { if (url.startsWith('https://api.github.com/')) return { text: JSON.stringify({ id: 22, login: 'alice', email: 'alice@example.com' }) }; throw new Error('not found'); };
  const result = await research('https://github.com/alice', { fetcher });
  assert.equal(result.status, 'Potential contact — unverified'); assert.equal(result.candidates[0].candidate_value, 'a***@example.com');
  assert.equal(JSON.stringify(result).includes('alice@example.com'), false); assert.equal(result.candidates[0].payment_authorization_status, 'not_authorized');
});
test('provider refusal downgrades published evidence and never authorizes', async () => {
  const original = globalThis.fetch; const priorLimit = process.env.PROVIDER_DAILY_CALL_LIMIT, priorDir = process.env.PROVIDER_BUDGET_DIR;
  const dir = await mkdtemp(path.join(tmpdir(), 'ut-budget-refusal-')); process.env.PROVIDER_BUDGET_DIR = dir; process.env.PROVIDER_DAILY_CALL_LIMIT = '3';
  try {
    const { assess: withBudget } = await import('../server/providers.mjs?refusal-test');
    globalThis.fetch = async () => new Response(JSON.stringify({ answers: { endorsement: { type: 'refusal' } }, citations: [] }), { status: 200 });
    const result = await withBudget({ target: { profileUrl: 'https://github.com/alice' }, status: 'Published payment link (not independently account-verified)', candidates: [{ candidate_type: 'paypal_me', candidate_value: 'https://paypal.me/alice', source_url: 'https://github.com/alice', identity_association_status: 'direct_profile', decision: 'published_payment_link', reason: 'Public profile.', payment_authorization_status: 'not_authorized' }], warnings: [], assessments: [] }, { ENABLE_PARALLEL: '1', PARALLEL_API_KEY: 'test', PARALLEL_DECISION_MAX_CENTS: '10' });
    assert.equal(result.status, 'Potential contact — unverified');
    assert.equal(result.candidates[0].decision, 'potential_contact');
    assert.equal(result.candidates[0].payment_authorization_status, 'not_authorized');
    assert.equal(result.assessments[0].answer, 'refused');
  } finally { globalThis.fetch = original; if (priorLimit === undefined) delete process.env.PROVIDER_DAILY_CALL_LIMIT; else process.env.PROVIDER_DAILY_CALL_LIMIT = priorLimit; if (priorDir === undefined) delete process.env.PROVIDER_BUDGET_DIR; else process.env.PROVIDER_BUDGET_DIR = priorDir; await rm(dir, { recursive: true, force: true }); }
});

test('X profile research reads the public embed data and treats bio links as published by the profile', async () => {
  const { supportURL, canonicalProfile, resolvePlatformId } = await import('../server/research.mjs');
  const user = { id_str: '4242', name: 'Alice', screen_name: 'Alice_Dev', description: 'I build things. https://paypal.me/alicedev', entities: { url: { urls: [{ expanded_url: 'http://alice.example/' }] }, description: { urls: [{ expanded_url: 'https://ko-fi.com/alicedev' }] } } };
  const page = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { timeline: { entries: [{ content: { tweet: { user: { id_str: '1', screen_name: 'someone_else' } } } }, { content: { tweet: { user } } }] } } } })}</script></html>`;
  const urls = [];
  const fetcher = async url => { urls.push(url); if (url.startsWith('https://syndication.twitter.com/')) return { text: page, contentType: 'text/html' }; throw new Error('not found'); };
  const result = await research('https://twitter.com/alice_dev', { fetcher });
  assert.equal(result.target.platform, 'x'); assert.equal(result.target.profileUrl, 'https://x.com/Alice_Dev'); assert.equal(result.target.platformUserId, '4242');
  assert.deepEqual(result.candidates.map(c => c.candidate_value).sort(), ['https://ko-fi.com/alicedev', 'https://paypal.me/alicedev']);
  assert.ok(result.candidates.every(c => c.identity_association_status === 'direct_profile' && c.payment_authorization_status === 'not_authorized'));
  assert.equal(urls.some(url => url.includes('alice.example')), false, 'A published PayPal link means the website is not fetched');
  assert.equal(await resolvePlatformId({ platform: 'x', username: 'alice_dev' }, { fetcher }), '4242');
  await assert.rejects(research('https://x.com/nobody', { fetcher }), /no public posts/);
  assert.throws(() => canonicalProfile('https://x.com/home'), /X profile URL/);
  assert.equal(canonicalProfile('https://www.facebook.com/some.person').platform, 'facebook');
  assert.throws(() => canonicalProfile('https://www.facebook.com/marketplace'), /Facebook profile URL/);
  assert.equal(supportURL('https://www.patreon.com/alice'), 'https://patreon.com/alice'); assert.equal(supportURL('https://cash.app/$alice'), 'https://cash.app/$alice');
  for (const bad of ['https://ko-fi.com/about', 'http://ko-fi.com/alice', 'https://ko-fi.com.evil.example/alice', 'https://patreon.com/alice/posts', 'javascript:alert(1)']) assert.equal(supportURL(bad), null);
});
test('an X profile read from the viewed page is accepted only for the matching handle and is flagged', async () => {
  const { validXProfile } = await import('../server/research.mjs');
  const page = { id_str: 'handle:alice_dev', screen_name: 'Alice_Dev', name: 'Alice', description: 'tips welcome', entities: { description: { urls: [{ expanded_url: 'https://ko-fi.com/alicedev' }] } } };
  assert.equal(validXProfile(page, 'bob'), null); assert.equal(validXProfile({ ...page, id_str: 'handle:bob' }, 'alice_dev'), null);
  const result = await research('https://x.com/alice_dev', { xProfile: validXProfile(page, 'alice_dev'), fetcher: async () => { throw new Error('no network expected'); } });
  assert.deepEqual(result.candidates.map(c => c.candidate_value), ['https://ko-fi.com/alicedev']);
  assert.ok(result.warnings.some(warning => warning.includes('account ID was not confirmed')));
});
test('a Reddit profile read from the viewed page yields its listed support links without any network call', async () => {
  const { validPageProfile } = await import('../server/research.mjs');
  assert.equal(validPageProfile({ screen_name: 'bob', links: [] }, 'alice_r'), null);
  const pageProfile = validPageProfile({ screen_name: 'Alice_R', description: 'Tips: https://paypal.me/alicer', links: ['https://www.patreon.com/alicer', 'https://example.com/x'] }, 'alice_r');
  const result = await research('https://www.reddit.com/user/alice_r/', { pageProfile, fetcher: async () => { throw new Error('no network expected'); } });
  assert.deepEqual(result.candidates.map(c => c.candidate_value).sort(), ['https://patreon.com/alicer', 'https://paypal.me/alicer']);
  assert.ok(result.warnings.some(warning => warning.includes('account ID was not confirmed')));
});
test('a web page author link is reported as a credit lead and not fetched', async () => {
  const urls = [];
  const fetcher = async url => { urls.push(url); return { text: '<a rel="author" href="https://github.com/alice">Alice</a><a href="https://ko-fi.com/alice">Tip</a>', contentType: 'text/html' }; };
  const result = await research('https://blog.example/post', { fetcher });
  assert.deepEqual(urls, ['https://blog.example/post', 'https://blog.example/funding.json', 'https://keybase.io/_/api/1.0/user/lookup.json?domain=blog.example&fields=basics,proofs_summary'], 'Only the page, its own site funding.json and the Keybase domain check are fetched; the author link is not');
  assert.ok(result.identityLinks.some(item => item.url === 'https://github.com/alice' && item.relation.includes('author')));
  assert.equal(result.candidates[0].candidate_value, 'https://ko-fi.com/alice'); assert.equal(result.candidates[0].decision, 'potential_contact');
});
test('the GitHub identity recheck uses a conditional request and falls back when the record changed', async () => {
  const run = async conditional => {
    const calls = [];
    const fetcher = async (url, options = {}) => { calls.push(options.headers?.['if-none-match'] ? 'conditional' : url.includes('/users/') ? 'user' : 'other');
      if (options.headers?.['if-none-match']) { if (conditional === 'unchanged') return { notModified: true, text: '' }; return { text: JSON.stringify({ id: 12, login: 'alice' }), etag: '"b"' }; }
      if (url.includes('/users/')) return { text: JSON.stringify({ id: 12, login: 'alice' }), etag: '"a"' };
      if (url.startsWith('https://raw.githubusercontent.com/alice/.github/')) return { text: 'github: alice\n' };
      throw new Error('not found'); };
    const result = await research('https://github.com/alice', { fetcher }); return { calls, result };
  };
  const unchanged = await run('unchanged');
  assert.equal(unchanged.calls.filter(call => call === 'user').length, 1); assert.equal(unchanged.result.status.startsWith('Published payment link'), true);
  assert.equal('etag' in unchanged.result.target, false);
  const changed = await run('changed');
  assert.equal(changed.calls.filter(call => call === 'user').length, 2, 'A changed record triggers the full identity recheck');
});
test('page head credits (author name, twitter:creator) are reported as leads', async () => {
  const fetcher = async () => ({ text: '<head><meta name="author" content="Alice Example"><meta name="twitter:creator" content="@alice_dev"><meta name="twitter:creator" content="not a handle!"></head>', contentType: 'text/html' });
  const result = await research('https://blog.example/post', { fetcher });
  assert.match(result.target.displayName, /^Alice Example \(author named by blog\.example\)$/);
  assert.deepEqual(result.identityLinks.map(item => item.url), ['https://x.com/alice_dev']);
});
test('a Facebook profile read from the viewed page yields its listed support links without any network call', async () => {
  const { validPageProfile } = await import('../server/research.mjs');
  const pageProfile = validPageProfile({ screen_name: 'some.person', description: 'Artist', links: ['https://ko-fi.com/someperson', 'https://example.com/'] }, 'some.person');
  const result = await research('https://www.facebook.com/some.person', { pageProfile, fetcher: async () => { throw new Error('no network expected'); } });
  assert.deepEqual(result.candidates.map(c => c.candidate_value), ['https://ko-fi.com/someperson']);
  assert.ok(result.warnings.some(warning => warning.includes('Facebook profile was read from the page')));
});
test('a bio rendered across lines still yields its PayPal link', async () => {
  const { validXProfile } = await import('../server/research.mjs');
  const profile = validXProfile({ id_str: 'handle:alice_dev', screen_name: 'alice_dev', description: 'Maker.\nTips: \nhttps://\npaypal.me/alicedev\n thanks' }, 'alice_dev');
  assert.equal(profile.description, 'Maker. Tips: https://paypal.me/alicedev thanks');
  const result = await research('https://x.com/alice_dev', { xProfile: profile, fetcher: async () => { throw new Error('no network expected'); } });
  assert.deepEqual(result.candidates.map(c => c.candidate_value), ['https://paypal.me/alicedev']);
});
test('Open Graph article:author is reported as a credit lead (URL) or author name (text)', async () => {
  const page = html => research('https://news.example/story', { fetcher: async () => ({ text: html, contentType: 'text/html' }) });
  const linked = await page('<meta property="article:author" content="https://www.facebook.com/some.writer"><meta property="article:author" content="javascript:alert(1)">');
  assert.deepEqual(linked.identityLinks.map(item => item.url), ['https://www.facebook.com/some.writer']);
  assert.match((await page('<meta property="article:author" content="Some Writer">')).target.displayName, /^Some Writer \(author named by news\.example\)$/);
});
test('plain-text PayPal links in a bio are recognized without a scheme, but not inside other URLs or addresses', () => {
  assert.deepEqual(paypalLinks('Tips: paypal.me/alice thanks'), ['https://paypal.me/alice']);
  assert.deepEqual(paypalLinks('support (www.paypal.me/bob/5USD)'), ['https://www.paypal.me/bob']);
  assert.deepEqual(paypalLinks('PayPal:paypal.me/carol'), ['https://paypal.me/carol']);
  assert.deepEqual(paypalLinks('see https://evil.example/paypal.me/alice and user@paypal.me/x and notpaypal.me/y'), []);
});
test('a GitHub Pages site is owned by the account in its host name', () => {
  assert.deepEqual(canonicalProfile('https://alice-dev.github.io/blog/post'), { platform: 'github', username: 'alice-dev', profileUrl: 'https://github.com/alice-dev' });
  assert.equal(canonicalProfile('https://docs.alice.github.io/').platform, 'web', 'A deeper subdomain is not a Pages account host');
  assert.equal(canonicalProfile('https://github.io.evil.example/').platform, 'web');
});
test('funding.json is read only for the same site and never yields bank or cash details', () => {
  const manifest = entityUrl => JSON.stringify({ entity: { type: 'individual', role: 'owner', name: 'Ada Example', email: 'ada@example.org', webpageUrl: { url: entityUrl } }, funding: { channels: [
    { guid: 'pp', type: 'payment-provider', address: 'paypal.me/adaexample' },
    { guid: 'kofi', type: 'other', address: 'https://ko-fi.com/adaexample' },
    { guid: 'bank', type: 'bank', address: 'IBAN DE00 0000 0000 0000' },
    { guid: 'cash', type: 'cash', address: '1 Main St' }] } });
  assert.deepEqual(fundingManifest(manifest('https://www.example.org/about'), 'https://example.org/post/1'), { name: 'Ada Example', links: ['https://paypal.me/adaexample', 'https://ko-fi.com/adaexample'] });
  assert.equal(fundingManifest(manifest('https://other.example/'), 'https://example.org/'), null, 'A manifest about another site is not this site owner\'s');
  assert.equal(fundingManifest('not json', 'https://example.org/'), null);
});
test('a funding.json on GitHub counts only when it names that same account', () => {
  const manifest = url => JSON.stringify({ entity: { name: 'Ada', webpageUrl: { url } }, funding: { channels: [{ type: 'payment-provider', address: 'https://paypal.me/ada' }] } });
  assert.deepEqual(fundingManifest(manifest('https://github.com/Ada'), 'https://github.com/ada').links, ['https://paypal.me/ada']);
  assert.equal(fundingManifest(manifest('https://github.com/someone-else'), 'https://github.com/ada'), null);
  assert.deepEqual(fundingManifest(manifest('https://ada.github.io/'), 'https://github.com/ada').links, ['https://paypal.me/ada']);
  assert.equal(fundingManifest(manifest('https://eve.github.io/'), 'https://github.com/ada'), null);
});
test('a GitHub lookup finds payment links from funding.json alone, in .github or the top repository', async () => {
  const manifest = url => JSON.stringify({ entity: { name: 'Alice', webpageUrl: { url } }, funding: { channels: [{ type: 'payment-provider', address: 'https://paypal.me/alicefund' }, { type: 'bank', address: 'IBAN X' }] } });
  const run = files => research('https://github.com/alice', { fetcher: async url => {
    if (url.startsWith('https://api.github.com/search/')) return { text: JSON.stringify({ items: [{ name: 'tool', fork: false, owner: { id: 99 } }] }) };
    if (url.startsWith('https://api.github.com/')) return { text: JSON.stringify({ id: 99, login: 'alice' }) };
    if (files[url]) return { text: files[url] };
    throw new Error('not found');
  } });
  const fromDotGithub = await run({ 'https://raw.githubusercontent.com/alice/.github/HEAD/funding.json': manifest('https://github.com/alice') });
  const hit = fromDotGithub.candidates.find(c => c.candidate_value === 'https://paypal.me/alicefund');
  assert.equal(hit?.decision, 'published_payment_link'); assert.equal(hit.source_url, 'https://github.com/alice/.github/blob/HEAD/funding.json');
  assert.doesNotMatch(JSON.stringify(fromDotGithub.candidates), /IBAN/);
  const fromRepo = await run({ 'https://raw.githubusercontent.com/alice/tool/HEAD/.github/funding.json': manifest('https://alice.github.io/') });
  assert.equal(fromRepo.candidates.find(c => c.candidate_value === 'https://paypal.me/alicefund')?.source_url, 'https://github.com/alice/tool/blob/HEAD/.github/funding.json');
  const copied = await run({ 'https://raw.githubusercontent.com/alice/.github/HEAD/funding.json': manifest('https://github.com/mallory') });
  assert.equal(copied.candidates.some(c => c.candidate_value === 'https://paypal.me/alicefund'), false, 'A funding.json naming another account is ignored');
});
test('a Reddit or Facebook page-read bio follows one linked website, such as a link page', async () => {
  for (const [url, platform] of [['https://www.reddit.com/user/alice_r/', 'reddit'], ['https://www.facebook.com/alice.maker', 'facebook']]) {
    const fetched = [];
    const result = await research(url, { pageProfile: { screen_name: new URL(url).pathname.split('/').filter(Boolean).pop(), description: 'Artist', links: ['https://www.reddit.com/r/art', 'https://linktr.ee/alicemaker'] }, fetcher: async u => { fetched.push(u); return { contentType: 'text/html', text: '<a href="https://paypal.me/alicemaker">Tip me</a>' }; } });
    assert.deepEqual(fetched, ['https://linktr.ee/alicemaker'], `${platform}: only the linked site is fetched, never the platform itself`);
    const hit = result.candidates.find(c => c.candidate_value === 'https://paypal.me/alicemaker');
    assert.equal(hit?.identity_association_status, 'linked_creator_site'); assert.equal(hit.source_url, 'https://linktr.ee/alicemaker');
  }
});
test('plain-text paypal.me on a page counts, but not inside code samples, scripts or cautionary text', () => {
  assert.deepEqual(htmlPaymentLinks('<p>Payment via Paypal --&gt; paypal.me/LauLime</p>', 'https://laulime.carrd.co/'), ['https://paypal.me/LauLime']);
  assert.deepEqual(htmlPaymentLinks('<pre>paypal.me/example</pre><script>var x="paypal.me/tracker"</script><title>paypal.me/title</title>', 'https://site.example/'), []);
});
test('plain-text tip platform links are recognized in bios and pages, with the same reserved-path rules', () => {
  assert.deepEqual(textPaymentLinks('Tips: ko-fi.com/alice | cash.app/$alice1 · www.patreon.com/c/alice. paypal.me/alice'), ['https://paypal.me/alice', 'https://ko-fi.com/alice', 'https://cash.app/$alice1', 'https://patreon.com/alice']);
  assert.deepEqual(textPaymentLinks('see ko-fi.com/explore and evil.example/ko-fi.com/alice and notko-fi.com/bob'), []);
  assert.deepEqual(htmlPaymentLinks('<p>Support me at ko-fi.com/alice</p>', 'https://alice.example/'), ['https://ko-fi.com/alice']);
});
test('Stack Overflow profiles use the numeric user ID and read about-me links through the official API', async () => {
  assert.deepEqual(canonicalProfile('https://stackoverflow.com/users/22656/jon-skeet'), { platform: 'stackoverflow', username: '22656', profileUrl: 'https://stackoverflow.com/users/22656' });
  assert.throws(() => canonicalProfile('https://stackoverflow.com/questions/1/x'), /Stack Overflow user profile URL/);
  const fetched = [];
  const fetcher = async url => { fetched.push(url);
    if (url.startsWith('https://api.stackexchange.com/')) return { text: JSON.stringify({ items: [{ user_id: 42, display_name: 'Ada &amp; Co', website_url: 'http://ada.example', about_me: '<p>Tips: <a href="https://ko-fi.com/ada">Ko-fi</a></p><pre>paypal.me/example</pre>' }] }) };
    return { contentType: 'text/html', text: '<a href="https://paypal.me/adaexample">PayPal</a>' };
  };
  const result = await research('https://stackoverflow.com/users/42/ada', { fetcher });
  assert.equal(result.target.platformUserId, '42'); assert.equal(result.target.displayName, 'Ada & Co');
  assert.match(fetched[0], /^https:\/\/api\.stackexchange\.com\/2\.3\/users\/42\?site=stackoverflow&filter=/);
  const values = result.candidates.map(c => `${c.candidate_value}|${c.identity_association_status}`);
  assert.ok(values.includes('https://ko-fi.com/ada|direct_profile'));
  assert.ok(values.includes('https://paypal.me/adaexample|linked_creator_site'), 'The listed website is followed (upgraded to https)');
  assert.ok(!values.some(v => v.includes('paypal.me/example')), 'Code samples are not payment links');
  assert.equal(fetched[1], 'https://ada.example/');
  await assert.rejects(research('https://stackoverflow.com/users/42', { fetcher: async () => ({ text: JSON.stringify({ items: [{ user_id: 7 }] }) }) }), /no public profile/);
});
test('YouTube channels are researched only from the page data read in the browser', async () => {
  assert.deepEqual(canonicalProfile('https://www.youtube.com/@Alice_Makes'), { platform: 'youtube', username: 'Alice_Makes', profileUrl: 'https://www.youtube.com/@Alice_Makes' });
  assert.throws(() => canonicalProfile('https://www.youtube.com/watch?v=abc'), /youtube\.com\/@name/);
  await assert.rejects(research('https://www.youtube.com/@alice_makes', { fetcher: async () => { throw new Error('must not fetch YouTube'); } }), /read from your browser/);
  const fetched = [];
  const result = await research('https://www.youtube.com/@alice_makes', { pageProfile: { screen_name: 'alice_makes', description: 'Support the channel: patreon.com/alicemakes', links: ['https://www.youtube.com/@other', 'https://alice.example/'] },
    fetcher: async url => { fetched.push(url); return { contentType: 'text/html', text: '<a href="https://paypal.me/alicemakes">Tip</a>' }; } });
  const values = result.candidates.map(c => `${c.candidate_value}|${c.identity_association_status}`);
  assert.ok(values.includes('https://patreon.com/alicemakes|direct_profile'));
  assert.ok(values.includes('https://paypal.me/alicemakes|linked_creator_site'), 'No PayPal link in the bio, so the listed website is checked');
  assert.deepEqual(fetched, ['https://alice.example/'], 'Only the outside website is fetched; never YouTube itself');
  assert.match(result.warnings.join(' '), /This YouTube profile was read from the page you were viewing/);
});
test('in a long bio, caution words count only near the link they qualify', async () => {
  const long = `${'I make art and share stories about it every week. '.repeat(6)}I am never giving up.\n\nBuy me a coffee:\nhttps://ko-fi.com/robart\n\nExample only, do not use:\nhttps://ko-fi.com/notmine`;
  const result = await research('https://www.youtube.com/@robart', { pageProfile: { screen_name: 'robart', description: long, links: [] }, fetcher: async () => { throw new Error('no fetch'); } });
  const decision = value => result.candidates.find(c => c.candidate_value === value)?.decision;
  assert.equal(decision('https://ko-fi.com/robart'), 'published_payment_link', '"never giving up" elsewhere does not flag the link');
  assert.equal(decision('https://ko-fi.com/notmine'), 'potential_contact', 'A warning right next to a link still flags it');
  const flat = await research('https://www.youtube.com/@robart', { pageProfile: { screen_name: 'robart', description: long.replace(/\s*\n\s*/g, ' '), links: [] }, fetcher: async () => { throw new Error('no fetch'); } });
  assert.equal(flat.candidates.find(c => c.candidate_value === 'https://ko-fi.com/robart')?.decision, 'published_payment_link', 'Also when line breaks were flattened');
  const short = await research('https://www.youtube.com/@robart', { pageProfile: { screen_name: 'robart', description: 'Never send to ko-fi.com/robart, it is a scam', links: [] }, fetcher: async () => { throw new Error('no fetch'); } });
  assert.equal(short.candidates[0]?.decision, 'potential_contact', 'Short bios are still judged whole');
});
test('a GitHub profile whose website field is a PayPal.Me link is listed as a published link', async () => {
  const result = await research('https://github.com/alice', { fetcher: async url => {
    if (url.startsWith('https://api.github.com/search/')) return { text: JSON.stringify({ items: [] }) };
    if (url.startsWith('https://api.github.com/')) return { text: JSON.stringify({ id: 99, login: 'alice', blog: 'paypal.me/alicepays' }) };
    throw new Error('not found');
  } });
  assert.equal(result.candidates.find(c => c.candidate_value === 'https://paypal.me/alicepays')?.decision, 'published_payment_link');
});
test('when the GitHub API allowance is used up, research falls back to the page profile and public files', async () => {
  const files = {
    'https://raw.githubusercontent.com/alice/alice/HEAD/README.md': { text: '# Hi\nSupport: [Ko-fi](https://ko-fi.com/alicedev)\n```\npaypal.me/example\n```' },
    'https://raw.githubusercontent.com/alice/tool/HEAD/.github/FUNDING.yml': { text: 'custom: https://paypal.me/alicetool' },
    'https://raw.githubusercontent.com/alice/.github/HEAD/FUNDING.yml': { text: 'custom: https://paypal.me/alicefund' }
  };
  const run = (page, available) => { const fetched = []; return research('https://github.com/alice', { pageProfile: page, fetcher: async url => { fetched.push(url);
    if (url.startsWith('https://api.github.com/')) throw new Error('Remote source returned HTTP 403; rate limit resets in 12 min');
    if (available.includes(url)) return files[url];
    throw new Error('Remote source returned HTTP 404'); } }).then(result => ({ result, fetched })); };
  const published = result => result.candidates.filter(c => c.decision === 'published_payment_link').map(c => c.candidate_value);

  const withPage = await run({ name: 'Alice Dev', description: 'I build things. buymeacoffee.com/alicedev', links: [], repos: [] }, ['https://raw.githubusercontent.com/alice/alice/HEAD/README.md']);
  assert.deepEqual(published(withPage.result).sort(), ['https://buymeacoffee.com/alicedev', 'https://ko-fi.com/alicedev']);
  assert.equal(withPage.result.target.platformUserId, 'handle:alice'); assert.equal(withPage.result.target.displayName, 'Alice Dev');
  assert.match(withPage.result.warnings.join(' '), /resets in about 12 minutes.*read from the page in your browser/);
  assert.equal(withPage.result.identityRecheckFailed, undefined, 'No identity recheck is attempted against the exhausted API');
  assert.ok(!JSON.stringify(withPage.result.candidates).includes('paypal.me/example'), 'README code samples are ignored');

  const pinned = await run({ name: '', description: '', links: [], repos: ['tool'] }, ['https://raw.githubusercontent.com/alice/tool/HEAD/.github/FUNDING.yml']);
  assert.deepEqual(published(pinned.result), ['https://paypal.me/alicetool'], 'A repository pinned on the profile page stands in for the repository search');

  const filesOnly = await run(null, ['https://raw.githubusercontent.com/alice/.github/HEAD/FUNDING.yml']);
  assert.deepEqual(published(filesOnly.result), ['https://paypal.me/alicefund']);
  assert.match(filesOnly.result.warnings.join(' '), /only this account's public files and Sponsors page were checked/);

  await assert.rejects(run(null, []), /hourly request limit.*Click the icon again/, 'Nothing readable and no page data is an error, not a no-match');
});
test('when the Stack Overflow API is unavailable, research falls back to the profile page read in the browser', async () => {
  const fetched = [];
  const fetcher = async url => { fetched.push(url);
    if (url.startsWith('https://api.stackexchange.com/')) throw new Error('Remote source returned HTTP 400');
    return { contentType: 'text/html', text: '<a href="https://paypal.me/adasite">Tip</a>' };
  };
  await assert.rejects(research('https://stackoverflow.com/users/42', { fetcher }), /limiting public API requests.*Click the icon again/);
  const page = { name: 'Ada <b>', description: 'Tips welcome: ko-fi.com/ada "thanks"', links: ['https://github.com/sponsors/ada'], website: 'https://ada.example/', repos: [] };
  const result = await research('https://stackoverflow.com/users/42', { fetcher, pageProfile: page });
  const values = result.candidates.map(c => `${c.candidate_value}|${c.identity_association_status}`);
  assert.ok(values.includes('https://ko-fi.com/ada|direct_profile')); assert.ok(values.includes('https://github.com/sponsors/ada|direct_profile'));
  assert.ok(values.includes('https://paypal.me/adasite|linked_creator_site'), 'The website the person marked as theirs is followed');
  assert.equal(result.target.platformUserId, 'handle:42'); assert.equal(result.target.displayName, 'Ada <b>');
  assert.match(result.warnings.join(' '), /read from the page in your browser/);
  const noSite = await research('https://stackoverflow.com/users/42', { fetcher, pageProfile: { ...page, website: '' } });
  assert.ok(!noSite.candidates.some(c => c.candidate_value.includes('adasite')), 'Other about-me links are not treated as their website');
});
test('a GitHub Sponsors page counts only when GitHub serves it for that same account', async () => {
  const run = sponsors => research('https://github.com/alice', { fetcher: async url => {
    if (url.startsWith('https://api.github.com/search/')) return { text: JSON.stringify({ items: [] }) };
    if (url.startsWith('https://api.github.com/')) return { text: JSON.stringify({ id: 99, login: 'alice' }) };
    if (url === 'https://github.com/sponsors/alice') return sponsors();
    throw new Error('Remote source returned HTTP 404');
  } });
  const has = result => result.candidates.some(c => c.candidate_value === 'https://github.com/sponsors/alice' && c.decision === 'published_payment_link');
  assert.equal(has(await run(() => ({ contentType: 'text/html', text: '<title>Sponsor @Alice on GitHub Sponsors · GitHub</title>' }))), true);
  assert.equal(has(await run(() => { throw new Error('Redirects are not followed'); })), false, 'No Sponsors page: GitHub redirects to the profile');
  assert.equal(has(await run(() => ({ contentType: 'text/html', text: '<title>Sponsor @alice-other on GitHub Sponsors</title>' }))), false, 'A page about another account does not count');
  assert.equal(has(await run(() => ({ contentType: 'text/html', text: '<title>alice (Alice) · GitHub</title>' }))), false);
});
test('the limited flag is set when a platform refuses for being over its allowance and cleared by the next success', async () => {
  const github = ok => research('https://github.com/alice', { fetcher: async url => {
    if (url.startsWith('https://api.github.com/search/')) return { text: JSON.stringify({ items: [] }) };
    if (url.startsWith('https://api.github.com/')) { if (!ok) throw new Error('Remote source returned HTTP 403; rate limit resets in 12 min'); return { text: JSON.stringify({ id: 99, login: 'alice', bio: 'paypal.me/alicebio' }) }; }
    if (url === 'https://raw.githubusercontent.com/alice/.github/HEAD/FUNDING.yml') return { text: 'custom: https://paypal.me/alicefund' };
    throw new Error('Remote source returned HTTP 404');
  } });
  platformLimits.github = 0; await github(false);
  const minutes = (platformLimits.github - Date.now()) / 60000;
  assert.ok(minutes > 11 && minutes <= 12, `Limited until GitHub's stated reset (got ${minutes.toFixed(1)} min)`);
  await github(true); assert.equal(platformLimits.github, 0, 'A successful API answer clears the flag');

  const stack = ok => research('https://stackoverflow.com/users/42', { pageProfile: { name: 'Ada', description: 'ko-fi.com/ada', links: [], website: '', repos: [] }, fetcher: async url => {
    if (url.startsWith('https://api.stackexchange.com/')) { if (!ok) throw new Error('Remote source returned HTTP 400'); return { text: JSON.stringify({ items: [{ user_id: 42, display_name: 'Ada', about_me: '' }] }) }; }
    throw new Error('Remote source returned HTTP 404');
  } });
  platformLimits.stackoverflow = 0; await stack(false); assert.ok(platformLimits.stackoverflow > Date.now());
  await stack(true); assert.equal(platformLimits.stackoverflow, 0);
});
test('a Keybase proof is a fallback for X and Reddit: only an exact, verified, unambiguous proof links a GitHub account', async () => {
  const proofs = list => ({ contentType: 'application/json', text: JSON.stringify({ status: { name: 'OK' }, them: list }) });
  const person = (username, all) => ({ basics: { username }, proofs_summary: { all } });
  const ok = (proof_type, nametag, state = 1) => ({ proof_type, nametag, state });
  const run = (url, keybase, extra = {}) => { const fetched = []; return research(url, { ...extra, fetcher: async u => { fetched.push(u);
    if (u.startsWith('https://keybase.io/')) return keybase;
    if (u === 'https://raw.githubusercontent.com/alicedev/.github/HEAD/FUNDING.yml') return { text: 'ko_fi: alicedev\ncustom: https://paypal.me/alicedev' };
    if (u === 'https://github.com/sponsors/alicedev') return { contentType: 'text/html', text: '<title>Sponsor @alicedev on GitHub Sponsors · GitHub</title>' };
    if (u === 'https://raw.githubusercontent.com/alicedev/alicedev/HEAD/README.md' && extra.readme) return { text: extra.readme };
    throw new Error('Remote source returned HTTP 403'); } }).then(result => ({ result, fetched })); };
  const published = result => result.candidates.filter(c => c.decision === 'published_payment_link').map(c => `${c.candidate_value}|${c.identity_association_status}`).sort();
  const full = ['https://github.com/sponsors/alicedev|keybase_linked_account', 'https://ko-fi.com/alicedev|keybase_linked_account', 'https://paypal.me/alicedev|keybase_linked_account'];
  const good = proofs([person('alice', [ok('reddit', 'Alice_R'), ok('twitter', 'alice_x'), ok('github', 'alicedev')])]);

  // Reddit refuses the lookup and there is no page data: the Keybase route still finds the links.
  const refused = await run('https://www.reddit.com/user/alice_r/', good);
  assert.deepEqual(published(refused.result), full);
  assert.match(refused.fetched[1], /^https:\/\/keybase\.io\/_\/api\/1\.0\/user\/lookup\.json\?reddit=alice_r&fields=/);
  assert.equal(refused.result.target.platformUserId, 'handle:alice_r'); assert.match(refused.result.warnings.join(' '), /could not be read directly.*Keybase proof.*Reddit denied this request/);
  assert.ok(refused.result.identityLinks.some(item => item.url === 'https://github.com/alicedev' && /Keybase proof/.test(item.relation)));

  const withReadme = await run('https://www.reddit.com/user/alice_r/', good, { readme: '# Hi\nCoffee: buymeacoffee.com/alicedev\n```\npaypal.me/example\n```' });
  assert.ok(published(withReadme.result).includes('https://buymeacoffee.com/alicedev|keybase_linked_account')); assert.ok(!JSON.stringify(withReadme.result.candidates).includes('paypal.me/example'), 'README code samples are ignored');
  // A page-read X profile with no payment link of its own also uses it; one that already lists a link does not ask Keybase.
  const xPage = bio => ({ xProfile: { id_str: 'handle:alice_x', screen_name: 'alice_x', name: 'Alice', description: bio, entities: { url: { urls: [] }, description: { urls: [] } } } });
  assert.deepEqual(published((await run('https://x.com/alice_x', good, xPage('I draw'))).result), full);
  const own = await run('https://x.com/alice_x', good, xPage('Tips: paypal.me/alicex'));
  assert.deepEqual(published(own.result), ['https://paypal.me/alicex|direct_profile']); assert.ok(!own.fetched.some(u => u.startsWith('https://keybase.io/')));

  // Not accepted: unverified proof, a different handle, two Keybase users claiming it, two GitHub accounts, or no proof at all.
  for (const bad of [proofs([person('alice', [ok('reddit', 'alice_r', 0), ok('github', 'alicedev')])]), proofs([person('alice', [ok('reddit', 'alice_r2'), ok('github', 'alicedev')])]),
    proofs([person('a', [ok('reddit', 'alice_r'), ok('github', 'alicedev')]), person('b', [ok('reddit', 'alice_r'), ok('github', 'alicedev')])]),
    proofs([person('alice', [ok('reddit', 'alice_r'), ok('github', 'alicedev'), ok('github', 'other')])]), proofs([])])
    await assert.rejects(run('https://www.reddit.com/user/alice_r/', bad), /Reddit denied this request/, 'Without a valid proof the original refusal is reported');
});
test('for a GitHub account with no payment link, a Keybase-proven website is checked', async () => {
  const keybase = all => ({ text: JSON.stringify({ them: [{ basics: { username: 'alice' }, proofs_summary: { all } }] }) });
  const run = (proofs, limited = false) => { const fetched = []; return research('https://github.com/alice', { fetcher: async url => { fetched.push(url);
    if (url.startsWith('https://api.github.com/search/')) return { text: JSON.stringify({ items: [] }) };
    if (url.startsWith('https://api.github.com/')) { if (limited) throw new Error('Remote source returned HTTP 403; rate limit resets in 9 min'); return { text: JSON.stringify({ id: 99, login: 'alice' }) }; }
    if (url.startsWith('https://keybase.io/')) return keybase(proofs);
    if (url === 'https://alice.example/') return { contentType: 'text/html', text: '<a href="https://paypal.me/alicesite">Donate</a>' };
    throw new Error('Remote source returned HTTP 404'); } }).then(result => ({ result, fetched })); };
  const site = [{ proof_type: 'github', nametag: 'Alice', state: 1 }, { proof_type: 'generic_web_site', nametag: 'alice.example', state: 1 }];
  const found = await run(site);
  const hit = found.result.candidates.find(c => c.candidate_value === 'https://paypal.me/alicesite');
  assert.equal(hit?.decision, 'published_payment_link'); assert.match(hit.reason, /Keybase proof/);
  assert.ok(found.fetched.some(u => /keybase\.io\/_\/api\/1\.0\/user\/lookup\.json\?github=alice&/.test(u)));
  assert.ok(found.result.identityLinks.some(item => item.url === 'https://alice.example/' && /Keybase proof/.test(item.relation)));
  assert.equal((await run(site, true)).result.candidates.some(c => c.candidate_value === 'https://paypal.me/alicesite'), true, 'Also when the GitHub API allowance is used up and there is no page data');
  const unproven = await run([{ proof_type: 'github', nametag: 'alice', state: 1 }, { proof_type: 'generic_web_site', nametag: 'alice.example', state: 0 }]);
  assert.equal(unproven.result.candidates.length, 0); assert.ok(!unproven.fetched.includes('https://alice.example/'), 'An unverified website proof is not followed');
  const other = await run([{ proof_type: 'github', nametag: 'alice-other', state: 1 }, { proof_type: 'generic_web_site', nametag: 'alice.example', state: 1 }]);
  assert.ok(!other.fetched.includes('https://alice.example/'), 'A proof for a different GitHub account is not used');
});
test('Stack Overflow backoff and an empty daily quota are honoured: the API is not called again until they pass', async () => {
  const page = { name: 'Ada', description: 'ko-fi.com/ada', links: [], website: '', repos: [] };
  const run = (extra, pageProfile) => { let apiCalls = 0; return research('https://stackoverflow.com/users/42', { pageProfile, fetcher: async url => {
    if (url.startsWith('https://api.stackexchange.com/')) { apiCalls++; return { text: JSON.stringify({ items: [{ user_id: 42, display_name: 'Ada', about_me: '<a href="https://ko-fi.com/ada">k</a>' }], ...extra }) }; }
    throw new Error('Remote source returned HTTP 404'); } }).then(result => ({ result, apiCalls: () => apiCalls }), error => ({ error, apiCalls: () => apiCalls })); };
  try {
    platformLimits.stackoverflowBackoff = 0;
    const first = await run({ backoff: 30, quota_remaining: 120 });
    assert.equal(first.apiCalls(), 1); assert.equal(first.result.target.platformUserId, '42', 'The answer that carries the backoff is still used');
    const wait = (platformLimits.stackoverflowBackoff - Date.now()) / 1000; assert.ok(wait > 28 && wait <= 30, `Backoff of 30 s recorded (got ${wait.toFixed(1)})`);
    const second = await run({}, page);
    assert.equal(second.apiCalls(), 0, 'No API call during the backoff'); assert.equal(second.result.target.platformUserId, 'handle:42', 'The page read is used instead');
    const third = await run({}, null);
    assert.equal(third.apiCalls(), 0); assert.match(third.error.message, /limiting public API requests.*Click the icon again/);
    platformLimits.stackoverflowBackoff = Date.now() - 1;
    assert.equal((await run({}, null)).apiCalls(), 1, 'Called again once the backoff has passed');
    platformLimits.stackoverflowBackoff = 0; await run({ quota_remaining: 0 });
    const untilMidnight = platformLimits.stackoverflowBackoff - Date.now(); assert.ok(untilMidnight > 0 && untilMidnight <= 24 * 3600 * 1000, 'An empty daily quota blocks the API until midnight UTC');
    assert.equal(new Date(platformLimits.stackoverflowBackoff).getUTCHours(), 0);
  } finally { platformLimits.stackoverflowBackoff = 0; platformLimits.stackoverflow = 0; }
});
test('a website with no payment link falls back to its Keybase-proven owner and their GitHub funding', async () => {
  const run = (url, proofs) => { const fetched = []; return research(url, { fetcher: async u => { fetched.push(u);
    if (u.startsWith('https://keybase.io/')) return { text: JSON.stringify({ them: [{ basics: { username: 'alice' }, proofs_summary: { all: proofs } }] }) };
    if (u === 'https://raw.githubusercontent.com/alicedev/.github/HEAD/FUNDING.yml') return { text: 'custom: https://paypal.me/alicedev' };
    if (['https://alice.example/', 'https://www.alice.example/', 'https://alice.example/blog/guest-post'].includes(u)) return { contentType: 'text/html', text: '<h1>Alice</h1>' };
    throw new Error('Remote source returned HTTP 404'); } }).then(result => ({ result, fetched })); };
  const good = [{ proof_type: 'generic_web_site', nametag: 'alice.example', state: 1 }, { proof_type: 'github', nametag: 'alicedev', state: 1 }];
  const home = await run('https://www.alice.example/', good);
  assert.ok(home.fetched.some(u => u.includes('lookup.json?domain=alice.example&')));
  const hit = home.result.candidates.find(c => c.candidate_value === 'https://paypal.me/alicedev');
  assert.equal(hit?.decision, 'published_payment_link'); assert.match(hit.reason, /tied to this website by a public Keybase proof/);
  const post = await run('https://alice.example/blog/guest-post', good);
  const deep = post.result.candidates.find(c => c.candidate_value === 'https://paypal.me/alicedev');
  assert.equal(deep?.decision, 'potential_contact', 'On a deeper page the author may not be the site owner'); assert.match(deep.reason, /author of this particular page may be someone else/);
  const wrong = await run('https://alice.example/', [{ proof_type: 'generic_web_site', nametag: 'other.example', state: 1 }, { proof_type: 'github', nametag: 'alicedev', state: 1 }]);
  assert.equal(wrong.result.candidates.length, 0, 'A proof for a different domain is not used');
  const unverified = await run('https://alice.example/', [{ proof_type: 'dns', nametag: 'alice.example', state: 0 }, { proof_type: 'github', nametag: 'alicedev', state: 1 }]);
  assert.equal(unverified.result.candidates.length, 0);
});
test('public file, Sponsors and Keybase downloads are remembered briefly; APIs and ordinary sites are not', async () => {
  let clock = 1000; const calls = [];
  const fetcher = async url => { calls.push(url);
    if (url.endsWith('/missing.yml')) throw new Error('Remote source returned HTTP 404');
    if (url.endsWith('/flaky.yml')) throw new Error('Remote source returned HTTP 503');
    return { text: `body ${calls.length}` }; };
  const memo = memoFetch(fetcher, { ttl: 600000, max: 2, now: () => clock });
  const count = url => calls.filter(item => item === url).length;
  const raw = 'https://raw.githubusercontent.com/alice/.github/HEAD/FUNDING.yml';
  assert.equal((await memo(raw)).text, (await memo(raw)).text); assert.equal(count(raw), 1, 'Second read comes from memory');
  for (const url of ['https://keybase.io/_/api/1.0/user/lookup.json?github=alice', 'https://github.com/sponsors/alice']) { await memo(url); await memo(url); assert.equal(count(url), 1); }
  for (const url of ['https://api.github.com/users/alice', 'https://alice.example/', 'https://github.com/alice']) { await memo(url); await memo(url); assert.equal(count(url), 2, `${url} is always fetched afresh`); }
  await memo(raw, { headers: { authorization: 'Bearer x' } }); assert.equal(count(raw), 2, 'Requests with headers are not remembered');
  const missing = 'https://raw.githubusercontent.com/alice/x/HEAD/missing.yml';
  await assert.rejects(memo(missing), /HTTP 404/); await assert.rejects(memo(missing), /HTTP 404/); assert.equal(count(missing), 1, '"Not found" is remembered too');
  const flaky = 'https://raw.githubusercontent.com/alice/x/HEAD/flaky.yml';
  await assert.rejects(memo(flaky)); await assert.rejects(memo(flaky)); assert.equal(count(flaky), 2, 'Temporary failures are retried');
  clock += 600001; await memo(missing).catch(() => {}); assert.equal(count(missing), 2, 'Forgotten after ten minutes');
  memo.clear(); await memo(missing).catch(() => {}); assert.equal(count(missing), 3, 'Clearing the cache forgets them');
});
test('a website and a GitHub account that each name the other lead to that account\'s funding; a one-way link does not', async () => {
  const run = (url, blog, html = '<a rel="me" href="https://github.com/bobdev">GitHub</a>') => { const fetched = []; return research(url, { fetcher: async u => { fetched.push(u);
    if (u === 'https://api.github.com/users/bobdev') return { text: JSON.stringify({ login: 'BobDev', id: 7, type: 'User', blog }) };
    if (u === 'https://raw.githubusercontent.com/BobDev/.github/HEAD/FUNDING.yml') return { text: 'ko_fi: bobdev' };
    if (u.startsWith('https://keybase.io/')) return { text: '{"them":[]}' };
    if (['https://bob.example/', 'https://bob.example/posts/1'].includes(u)) return { contentType: 'text/html', text: html };
    throw new Error('Remote source returned HTTP 404'); } }).then(result => ({ result, fetched })); };
  const kofi = found => found.result.candidates.find(c => c.candidate_value === 'https://ko-fi.com/bobdev');
  platformLimits.github = 0;
  const home = await run('https://bob.example/', 'bob.example');
  assert.equal(kofi(home)?.decision, 'published_payment_link'); assert.equal(kofi(home).identity_association_status, 'mutual_link_account');
  assert.match(kofi(home).reason, /links in both directions/); assert.ok(!home.result.warnings.some(w => /has not been verified\.$/.test(w) && /relationship/.test(w)), 'A confirmed owner drops the unverified-page caution'); assert.ok(!home.fetched.some(u => u.startsWith('https://keybase.io/')), 'Keybase is not asked once the links agree');
  assert.equal(kofi(await run('https://bob.example/', 'https://www.bob.example/'))?.decision, 'published_payment_link', 'Scheme and www. do not matter');
  const deepPost = await run('https://bob.example/posts/1', 'bob.example'); assert.equal(kofi(deepPost)?.decision, 'potential_contact', 'A deeper page stays unconfirmed'); assert.ok(deepPost.result.warnings.some(w => /relationship between this page/.test(w)), 'and keeps the caution');
  for (const blog of ['', 'other.example', 'https://bob.example/~carol', null]) assert.equal(kofi(await run('https://bob.example/', blog)), undefined, `Account website ${JSON.stringify(blog)} does not confirm the site`);
  const two = await run('https://bob.example/', 'bob.example', '<a rel="me" href="https://github.com/bobdev">a</a><a rel="me" href="https://github.com/someoneelse">b</a>');
  assert.equal(kofi(two), undefined, 'Two named accounts are ambiguous');
  assert.equal(kofi(await run('https://bob.example/', 'other.example', '<a href="https://github.com/bobdev">plain link</a>')), undefined, 'A plain link alone is not a claim of ownership');
  const both = await run('https://bob.example/', 'bob.example', '<a rel="me" href="https://github.com/bobdev">GitHub</a> <a href="https://ko-fi.com/bobdev">tip</a>');
  assert.deepEqual(both.result.candidates.filter(c => c.candidate_value === 'https://ko-fi.com/bobdev').map(c => c.decision), ['published_payment_link'], 'A link found both ways is shown once, as confirmed');
  platformLimits.github = Date.now() + 60000;
  try { const limited = await run('https://bob.example/', 'bob.example');
    assert.equal(kofi(limited), undefined); assert.ok(!limited.fetched.some(u => u.startsWith('https://api.github.com/')), 'No request is spent while GitHub is limited');
    assert.ok(limited.result.warnings.some(w => /names the GitHub account bobdev .*could not be checked/.test(w)));
  } finally { platformLimits.github = 0; }
});
test('a profile\'s listed website and a GitHub account that each name the other lead to that account\'s funding', async () => {
  platformLimits.github = 0;
  const run = (blog, site = 'https://carol.example/', html = '<a rel="me" href="https://github.com/caroldev">GitHub</a>') => { const fetched = []; return research('https://www.reddit.com/user/carol_r/', {
    pageProfile: { screen_name: 'carol_r', description: 'Maker', links: [site] }, fetcher: async u => { fetched.push(u);
      if (u === 'https://api.github.com/users/caroldev') return { text: JSON.stringify({ login: 'caroldev', id: 9, type: 'User', blog }) };
      if (u === 'https://raw.githubusercontent.com/caroldev/.github/HEAD/FUNDING.yml') return { text: 'ko_fi: caroldev' };
      if (u.startsWith('https://keybase.io/')) return { text: '{"them":[]}' };
      if (u === site) return { contentType: 'text/html', text: html };
      throw new Error('Remote source returned HTTP 404'); } }).then(result => ({ result, fetched })); };
  const kofi = found => found.result.candidates.find(c => c.candidate_value === 'https://ko-fi.com/caroldev');
  const good = await run('https://carol.example');
  assert.equal(kofi(good)?.decision, 'published_payment_link'); assert.equal(kofi(good).identity_association_status, 'mutual_link_account');
  assert.match(kofi(good).reason, /the website they list \(carol\.example\)/);
  assert.ok(good.result.identityLinks.some(item => item.url === 'https://github.com/caroldev' && item.source_url === 'https://carol.example/'));
  assert.equal(kofi(await run('other.example')), undefined, 'The account must name the same site back');
  assert.equal(kofi(await run('carol.example', 'https://carol.example/people/dave')), undefined, 'Only the home page of the listed site counts');
});
test('an X profile listing a section link and a home page reads the home page', async () => {
  platformLimits.github = 0; const fetched = [];
  const result = await research('https://x.com/dana_x', { xProfile: { id_str: 'handle:dana_x', screen_name: 'dana_x', name: 'Dana', description: 'notes at dana.example/notes', entities: { url: { urls: [] }, description: { urls: [{ expanded_url: 'https://dana.example/notes' }, { expanded_url: 'https://dana.example' }] } } },
    fetcher: async u => { fetched.push(u);
      if (u === 'https://dana.example/') return { contentType: 'text/html', text: '<a rel="me" href="https://github.com/danadev">GitHub</a>' };
      if (u === 'https://api.github.com/users/danadev') return { text: JSON.stringify({ login: 'danadev', id: 5, type: 'User', blog: 'https://dana.example' }) };
      if (u === 'https://raw.githubusercontent.com/danadev/.github/HEAD/FUNDING.yml') return { text: 'ko_fi: danadev' };
      throw new Error('Remote source returned HTTP 404'); } });
  assert.ok(fetched.includes('https://dana.example/') && !fetched.includes('https://dana.example/notes'), 'Only the home page is read');
  assert.equal(result.candidates.find(c => c.candidate_value === 'https://ko-fi.com/danadev')?.decision, 'published_payment_link');
});
test('the one website read from a profile: the home page of the first listed site, never a different later site', async () => {
  const read = async links => { const fetched = []; await research('https://www.reddit.com/user/erin_r/', { pageProfile: { screen_name: 'erin_r', description: 'hi', links },
    fetcher: async u => { fetched.push(u); if (u.startsWith('https://keybase.io/')) return { text: '{"them":[]}' }; return { contentType: 'text/html', text: '<p>hello</p>' }; } }); return fetched.filter(u => !u.startsWith('https://keybase.io/')); };
  assert.deepEqual(await read(['https://erin.example/notes', 'https://www.erin.example/']), ['https://www.erin.example/']);
  assert.deepEqual(await read(['https://linktr.ee/erin', 'https://erin.example/']), ['https://linktr.ee/erin'], 'A link-in-bio page listed first is still the one read');
  assert.deepEqual(await read(['https://erin.example/notes']), ['https://erin.example/notes']);
  assert.deepEqual(await read(['https://twitter.com/erin', 'https://www.instagram.com/erin', 'https://erin.example/']), ['https://erin.example/'], 'Social network links are not the website');
});
test('a profile that lists its own GitHub account reads that account\'s funding files, not a scrape of the GitHub page', async () => {
  const fetched = [];
  const result = await research('https://www.reddit.com/user/finn_r/', { pageProfile: { screen_name: 'finn_r', description: 'dev', links: ['https://github.com/finndev'] }, fetcher: async u => { fetched.push(u);
    if (u === 'https://github.com/finndev') return { contentType: 'text/html', text: '<div itemscope itemtype="http://schema.org/Person"></div><a href="https://paypal.me/someoneelse">in a pinned repo description</a>' };
    if (u === 'https://raw.githubusercontent.com/finndev/.github/HEAD/FUNDING.yml') return { text: 'buy_me_a_coffee: finndev' };
    throw new Error('Remote source returned HTTP 404'); } });
  assert.deepEqual(result.candidates.map(c => [c.candidate_value, c.identity_association_status, c.decision]), [['https://buymeacoffee.com/finndev', 'listed_account', 'published_payment_link']]);
  assert.match(result.candidates[0].reason, /tied to this profile by the profile itself, which lists that account/);
  assert.ok(!fetched.some(u => u.startsWith('https://keybase.io/') || u.startsWith('https://api.github.com/')), 'No Keybase or API request is needed');
});
test('a profile that lists a GitHub organisation gets its funding links only as unconfirmed', async () => {
  const result = await research('https://www.reddit.com/user/gina_r/', { pageProfile: { screen_name: 'gina_r', description: 'dev', links: ['https://github.com/bigproject'] }, fetcher: async u => {
    if (u === 'https://github.com/bigproject') return { contentType: 'text/html', text: '<div itemscope itemtype="http://schema.org/Organization"></div>' };
    if (u === 'https://raw.githubusercontent.com/bigproject/.github/HEAD/FUNDING.yml') return { text: 'open_collective: bigproject' };
    throw new Error('Remote source returned HTTP 404'); } });
  assert.deepEqual(result.candidates.map(c => [c.candidate_value, c.decision]), [['https://opencollective.com/bigproject', 'potential_contact']]);
  assert.match(result.candidates[0].reason, /organisation or could not be confirmed as a personal account/);
});
test('the GitHub profile README is read as a free file download; the API is asked only when that file is absent', async () => {
  platformLimits.github = 0;
  const run = async raw => { const urls = []; const result = await research('https://github.com/hana', { fetcher: async url => { urls.push(url);
    if (url === 'https://api.github.com/users/hana') return { text: JSON.stringify({ id: 31, login: 'hana' }) };
    if (url === 'https://raw.githubusercontent.com/hana/hana/HEAD/README.md' && raw) return { text: 'Tips: https://ko-fi.com/hana\n```\nhttps://paypal.me/in-a-code-sample\n```' };
    if (url === 'https://api.github.com/repos/hana/hana/readme') return { contentType: 'text/html', text: '<a href="https://ko-fi.com/hana">tip</a>' };
    throw new Error('Remote source returned HTTP 404'); } }); return { urls, values: result.candidates.map(c => c.candidate_value) }; };
  const free = await run(true);
  assert.deepEqual(free.values, ['https://ko-fi.com/hana']); assert.ok(!free.urls.includes('https://api.github.com/repos/hana/hana/readme'), 'No API request is spent on the README');
  const other = await run(false);
  assert.deepEqual(other.values, ['https://ko-fi.com/hana']); assert.ok(other.urls.includes('https://api.github.com/repos/hana/hana/readme'), 'A README under another name is still found through the API');
});
test('a home page with an ordinary link to exactly one GitHub account counts only when that account names the site back', async () => {
  platformLimits.github = 0;
  const run = (url, blog, html) => research(url, { fetcher: async u => {
    if (u === 'https://api.github.com/users/ivydev') return { text: JSON.stringify({ login: 'ivydev', id: 8, type: 'User', blog }) };
    if (u === 'https://raw.githubusercontent.com/ivydev/.github/HEAD/FUNDING.yml') return { text: 'ko_fi: ivydev' };
    if (u.startsWith('https://keybase.io/')) return { text: '{"them":[]}' };
    if (u.startsWith('https://ivy.example/') && !u.endsWith('funding.json')) return { contentType: 'text/html', text: html };
    throw new Error('Remote source returned HTTP 404'); } });
  const kofi = result => result.candidates.find(c => c.candidate_value === 'https://ko-fi.com/ivydev')?.decision;
  const one = '<a href="https://github.com/ivydev">GitHub</a> <a href="https://github.com/ivydev/">again</a> <a href="https://github.com/ivydev/project">a repository</a>';
  assert.equal(kofi(await run('https://ivy.example/', 'https://ivy.example', one)), 'published_payment_link');
  assert.equal(kofi(await run('https://ivy.example/', 'https://elsewhere.example', one)), undefined, 'The account must name the site back');
  assert.equal(kofi(await run('https://ivy.example/', 'https://ivy.example', one + '<a href="https://github.com/friend">a friend</a>')), undefined, 'Links to two accounts are ambiguous');
  assert.equal(kofi(await run('https://ivy.example/posts/1', 'https://ivy.example', one)), undefined, 'Only the home page counts for an ordinary link');
});
test('once a site owner is confirmed, a home-page payment link with the same handle is confirmed; other handles are not', async () => {
  platformLimits.github = 0;
  const html = '<a rel="me" href="https://github.com/junodev">GitHub</a> <a href="https://opencollective.com/JunoDev">support me</a> <a href="https://ko-fi.com/somecharity">a cause I like</a>';
  const result = await research('https://juno.example/', { fetcher: async u => {
    if (u === 'https://api.github.com/users/junodev') return { text: JSON.stringify({ login: 'junodev', id: 4, type: 'User', blog: 'juno.example' }) };
    if (u === 'https://github.com/sponsors/junodev') return { text: '<title>Sponsor @junodev on GitHub Sponsors</title>' };
    if (u === 'https://juno.example/') return { contentType: 'text/html', text: html };
    throw new Error('Remote source returned HTTP 404'); } });
  const decision = value => result.candidates.find(c => c.candidate_value.toLowerCase() === value)?.decision;
  assert.equal(decision('https://opencollective.com/junodev'), 'published_payment_link'); assert.equal(result.candidates.find(c => c.candidate_value.toLowerCase() === 'https://opencollective.com/junodev').identity_association_status, 'confirmed_owner_site');
  assert.equal(decision('https://ko-fi.com/somecharity'), 'potential_contact', 'A link with another handle stays unconfirmed');
});
test('GitHub allowance running out before the final account recheck keeps the links; any other refusal stays cautious', async () => {
  platformLimits.github = 0;
  const run = message => { let profiles = 0; return research('https://github.com/kimdev', { fetcher: async url => {
    if (url === 'https://api.github.com/users/kimdev') { if (++profiles === 1) return { text: JSON.stringify({ id: 21, login: 'kimdev' }) }; throw new Error(message); }
    if (url === 'https://raw.githubusercontent.com/kimdev/kimdev/HEAD/README.md') return { text: 'Tips: https://ko-fi.com/kimdev' };
    throw new Error('Remote source returned HTTP 404'); } }); };
  try {
    const limited = await run('Remote source returned HTTP 403; rate limit resets in 17 min');
    assert.match(limited.status, /^Published payment link/); assert.equal(limited.identityRecheckFailed, undefined);
    assert.equal(limited.target.platformUserId, 'handle:kimdev', 'Handled like a limit fallback: account ID unconfirmed, so not stored');
    assert.ok(limited.warnings.some(w => /limit ran out during this lookup/.test(w))); assert.ok(platformLimits.github > Date.now(), 'The limit is remembered');
  } finally { platformLimits.github = 0; }
  const other = await run('Remote source returned HTTP 403');
  assert.equal(other.status, 'Potential contact — unverified'); assert.equal(other.identityRecheckFailed, true);
});
test('a lead given as both x.com and twitter.com is listed once', async () => {
  const result = await research('https://blog.example/post', { fetcher: async u => { if (u === 'https://blog.example/post') return { contentType: 'text/html', text: '<a rel="author" href="https://x.com/lee_w">Lee</a><a rel="me" href="https://twitter.com/Lee_W/">Twitter</a><a rel="me" href="https://mastodon.example/@lee">Mastodon</a>' }; if (u.startsWith('https://keybase.io/')) return { text: '{"them":[]}' }; throw new Error('Remote source returned HTTP 404'); } });
  assert.deepEqual(result.identityLinks.map(item => item.url), ['https://x.com/lee_w', 'https://mastodon.example/@lee']);
});
test('the funding field of package.json in the account\'s own top repository is read; other accounts\' Sponsors links are not', async () => {
  platformLimits.github = 0;
  const run = async funding => { const result = await research('https://github.com/noradev', { fetcher: async url => {
    if (url === 'https://api.github.com/users/noradev') return { text: JSON.stringify({ id: 77, login: 'noradev' }) };
    if (url.includes('/search/repositories')) return { text: JSON.stringify({ items: [{ name: 'tool', fork: false, owner: { id: 77, login: 'noradev' } }] }) };
    if (url === 'https://raw.githubusercontent.com/noradev/tool/HEAD/package.json') return { text: JSON.stringify({ name: 'tool', funding }) };
    throw new Error('Remote source returned HTTP 404'); } }); return result.candidates.map(c => [c.candidate_value, c.decision, c.source_url]); };
  const src = 'https://github.com/noradev/tool/blob/HEAD/package.json';
  assert.deepEqual(await run('https://ko-fi.com/noradev'), [['https://ko-fi.com/noradev', 'published_payment_link', src]]);
  assert.deepEqual(await run([{ type: 'patreon', url: 'https://www.patreon.com/noradev' }, 'https://github.com/sponsors/noradev', 'https://github.com/sponsors/someoneelse', 'https://example.com/donate', 42]),
    [['https://patreon.com/noradev', 'published_payment_link', src], ['https://github.com/sponsors/noradev', 'published_payment_link', src]]);
  assert.deepEqual(await run(undefined), []); assert.deepEqual(await run({ url: 'javascript:alert(1)' }), []);
});
