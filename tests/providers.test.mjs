import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
process.env.PROVIDER_DAILY_BUDGET_CENTS = '100';

test('enabled providers with missing keys report configuration warnings', async () => {
  const { assess } = await import('../server/providers.mjs?missing-keys-test');
  const data = { target: { profileUrl: 'https://github.com/example' }, status: 'No safe match', candidates: [], warnings: [], assessments: [] };
  const result = await assess(data, { ENABLE_PARALLEL: '1', ENABLE_DREX: '1' });
  assert.ok(result.warnings.some(warning => warning.includes('Parallel is enabled')));
  assert.ok(result.warnings.some(warning => warning.includes('Drex is enabled')));
});

test('missing per-call cost estimate prevents an otherwise enabled provider call', async () => {
  const originalFetch = globalThis.fetch, oldLimit = process.env.PROVIDER_DAILY_CALL_LIMIT, oldDir = process.env.PROVIDER_BUDGET_DIR;
  const dir = await mkdtemp(path.join(tmpdir(), 'ut-budget-missing-cost-')); process.env.PROVIDER_BUDGET_DIR = dir; process.env.PROVIDER_DAILY_CALL_LIMIT = '2';
  let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('Should not call provider'); };
  try {
    const { assess } = await import('../server/providers.mjs?missing-cost-test');
    const data = { target: { profileUrl: 'https://github.com/example' }, status: 'Published payment link', candidates: [{ candidate_type: 'paypal_me', candidate_value: 'https://paypal.me/example', source_url: 'https://github.com/example', identity_association_status: 'direct_profile', payment_authorization_status: 'not_authorized', reason: 'Public profile.' }], warnings: [], assessments: [] };
    const result = await assess(data, { ENABLE_DREX: '1', DREX_API_KEY: 'test' });
    assert.equal(calls, 0); assert.ok(result.warnings.some(warning => warning.includes('per-call estimate')));
  } finally { globalThis.fetch = originalFetch; if (oldLimit === undefined) delete process.env.PROVIDER_DAILY_CALL_LIMIT; else process.env.PROVIDER_DAILY_CALL_LIMIT = oldLimit; if (oldDir === undefined) delete process.env.PROVIDER_BUDGET_DIR; else process.env.PROVIDER_BUDGET_DIR = oldDir; await rm(dir, { recursive: true, force: true }); }
});

test('optional web search returns unverified leads without upgrading status', async () => {
  const originalFetch = globalThis.fetch, oldLimit = process.env.PROVIDER_DAILY_CALL_LIMIT, oldDir = process.env.PROVIDER_BUDGET_DIR;
  const dir = await mkdtemp(path.join(tmpdir(), 'ut-budget-search-')); process.env.PROVIDER_BUDGET_DIR = dir; process.env.PROVIDER_DAILY_CALL_LIMIT = '1';
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.parallel.ai/v1/search'); const payload = JSON.parse(options.body);
    assert.equal(payload.search_queries.length, 2); assert.equal(payload.advanced_settings.max_results, 5);
    return Response.json({ results: [{ title: 'Potential page', url: 'https://example.com/profile?token=secret#fragment' }, { title: 'Unsafe', url: 'javascript:alert(1)' }] });
  };
  try {
    const { assess } = await import('../server/providers.mjs?search-test');
    const result = await assess({ target: { profileUrl: 'https://github.com/example', username: 'example', platform: 'github' }, status: 'No safe match', candidates: [], warnings: [], assessments: [] }, { ENABLE_PARALLEL_SEARCH: '1', PARALLEL_API_KEY: 'test', PARALLEL_SEARCH_MAX_CENTS: '10' });
    assert.equal(result.status, 'No safe match'); assert.equal(result.researchLeads.length, 1); assert.equal(result.candidates.length, 0);
    assert.equal(result.researchLeads[0].url, 'https://example.com/profile'); assert.doesNotMatch(JSON.stringify(result), /token=secret|#fragment/);
  } finally { globalThis.fetch = originalFetch; if (oldLimit === undefined) delete process.env.PROVIDER_DAILY_CALL_LIMIT; else process.env.PROVIDER_DAILY_CALL_LIMIT = oldLimit; if (oldDir === undefined) delete process.env.PROVIDER_BUDGET_DIR; else process.env.PROVIDER_BUDGET_DIR = oldDir; await rm(dir, { recursive: true, force: true }); }
});

test('an uncited positive Parallel answer cannot promote or corroborate a destination', async () => {
  const originalFetch = globalThis.fetch, oldLimit = process.env.PROVIDER_DAILY_CALL_LIMIT, oldDir = process.env.PROVIDER_BUDGET_DIR;
  const dir = await mkdtemp(path.join(tmpdir(), 'ut-budget-no-citation-')); process.env.PROVIDER_BUDGET_DIR = dir; process.env.PROVIDER_DAILY_CALL_LIMIT = '1';
  globalThis.fetch = async () => Response.json({ answers: { endorsement: { type: 'noul', noul: 0.999 } }, citations: [] });
  try {
    const { assess } = await import('../server/providers.mjs?uncited-test');
    const data = { target: { profileUrl: 'https://github.com/example' }, status: 'Published payment link', candidates: [{ candidate_type: 'paypal_me', candidate_value: 'https://paypal.me/example', source_url: 'https://github.com/example', identity_association_status: 'direct_profile', payment_authorization_status: 'not_authorized', reason: 'Public profile.' }], warnings: [], assessments: [] };
    const result = await assess(data, { ENABLE_PARALLEL: '1', PARALLEL_API_KEY: 'test', PARALLEL_DECISION_MAX_CENTS: '10' });
    assert.equal(result.status, 'Potential contact — unverified'); assert.equal(result.candidates[0].payment_authorization_status, 'not_authorized');
    assert.ok(result.warnings.some(warning => warning.includes('no usable citations')));
  } finally { globalThis.fetch = originalFetch; if (oldLimit === undefined) delete process.env.PROVIDER_DAILY_CALL_LIMIT; else process.env.PROVIDER_DAILY_CALL_LIMIT = oldLimit; if (oldDir === undefined) delete process.env.PROVIDER_BUDGET_DIR; else process.env.PROVIDER_BUDGET_DIR = oldDir; await rm(dir, { recursive: true, force: true }); }
});

test('provider access errors are actionable without exposing response bodies or keys', async () => {
  const originalFetch = globalThis.fetch, oldLimit = process.env.PROVIDER_DAILY_CALL_LIMIT, oldDir = process.env.PROVIDER_BUDGET_DIR;
  const dir = await mkdtemp(path.join(tmpdir(), 'ut-budget-provider-error-')); process.env.PROVIDER_BUDGET_DIR = dir; process.env.PROVIDER_DAILY_CALL_LIMIT = '1';
  globalThis.fetch = async () => new Response('private-provider-error-body', { status: 402 });
  try {
    const { assess } = await import('../server/providers.mjs?provider-error-test');
    const data = { target: { profileUrl: 'https://github.com/example' }, status: 'Published payment link', candidates: [{ candidate_type: 'paypal_me', candidate_value: 'https://paypal.me/example', source_url: 'https://github.com/example', identity_association_status: 'direct_profile', payment_authorization_status: 'not_authorized', reason: 'Public profile.' }], warnings: [], assessments: [] };
    const result = await assess(data, { ENABLE_DREX: '1', DREX_API_KEY: 'private-test-key', DREX_MAX_CENTS: '10' });
    assert.ok(result.warnings.some(warning => warning.includes('credit or billing access')));
    assert.doesNotMatch(JSON.stringify(result), /private-provider-error-body|private-test-key/);
  } finally { globalThis.fetch = originalFetch; if (oldLimit === undefined) delete process.env.PROVIDER_DAILY_CALL_LIMIT; else process.env.PROVIDER_DAILY_CALL_LIMIT = oldLimit; if (oldDir === undefined) delete process.env.PROVIDER_BUDGET_DIR; else process.env.PROVIDER_BUDGET_DIR = oldDir; await rm(dir, { recursive: true, force: true }); }
});

test('free Parallel MCP is explicit, unauthenticated, quota-limited and never authorizes a recipient', async () => {
  const originalFetch = globalThis.fetch, oldFree = process.env.PARALLEL_FREE_MCP_DAILY_CALL_LIMIT, oldDir = process.env.PROVIDER_BUDGET_DIR;
  const dir = await mkdtemp(path.join(tmpdir(), 'ut-budget-free-mcp-')); process.env.PROVIDER_BUDGET_DIR = dir; process.env.PARALLEL_FREE_MCP_DAILY_CALL_LIMIT = '1';
  let calls = 0; globalThis.fetch = async (url, options) => {
    calls++; assert.equal(url, 'https://mcp.parallel.ai/mcp'); assert.equal(Object.keys(options.headers).some(key => /authorization|api-key/i.test(key)), false);
    if (options.method === 'DELETE') return new Response(null, { status: 204 });
    const rpc = JSON.parse(options.body);
    if (rpc.method === 'notifications/initialized') return new Response(null, { status: 202 });
    const result = rpc.method === 'initialize' ? { protocolVersion: '2025-03-26' } : { structuredContent: { answers: { endorsement: { type: 'noul', noul: 0.85 } }, citations: [{ url: 'https://github.com/example' }] } };
    return Response.json({ jsonrpc: '2.0', id: rpc.id, result }, { headers: { 'mcp-session-id': 'fixture-session' } });
  };
  try {
    const { assess } = await import('../server/providers.mjs?free-mcp-test');
    const data = () => ({ target: { profileUrl: 'https://github.com/example' }, status: 'Published payment link', candidates: [{ candidate_type: 'paypal_me', candidate_value: 'https://paypal.me/example', source_url: 'https://github.com/example', identity_association_status: 'direct_profile', payment_authorization_status: 'not_authorized', reason: 'Public profile.' }], warnings: [], assessments: [] });
    const env = { ENABLE_PARALLEL: '1', PARALLEL_DECISIONS_TRANSPORT: 'free_mcp', PARALLEL_API_KEY: 'must-not-be-sent' };
    const result = await assess(data(), env); assert.equal(result.assessments[0].provider, 'Parallel Decisions (free MCP)');
    assert.equal(result.candidates[0].payment_authorization_status, 'not_authorized'); assert.equal(calls, 4);
    const second = await assess(data(), env); assert.equal(calls, 4); assert.ok(second.warnings.some(warning => warning.includes('daily call limit')));
  } finally { globalThis.fetch = originalFetch; if (oldFree === undefined) delete process.env.PARALLEL_FREE_MCP_DAILY_CALL_LIMIT; else process.env.PARALLEL_FREE_MCP_DAILY_CALL_LIMIT = oldFree; if (oldDir === undefined) delete process.env.PROVIDER_BUDGET_DIR; else process.env.PROVIDER_BUDGET_DIR = oldDir; await rm(dir, { recursive: true, force: true }); }
});

test('a positive Parallel answer with unrelated citations does not corroborate a profile', async () => {
  const originalFetch = globalThis.fetch, oldLimit = process.env.PROVIDER_DAILY_CALL_LIMIT, oldDir = process.env.PROVIDER_BUDGET_DIR;
  const dir = await mkdtemp(path.join(tmpdir(), 'ut-budget-wrong-citation-')); process.env.PROVIDER_BUDGET_DIR = dir; process.env.PROVIDER_DAILY_CALL_LIMIT = '1';
  globalThis.fetch = async () => Response.json({ answers: { endorsement: { type: 'noul', noul: 0.99 } }, citations: [{ url: 'https://github.com/example-impersonator' }] });
  try {
    const { assess } = await import('../server/providers.mjs?wrong-citation-test');
    const data = { target: { profileUrl: 'https://github.com/example' }, status: 'Published payment link', candidates: [{ candidate_type: 'paypal_me', candidate_value: 'https://paypal.me/example', source_url: 'https://github.com/example', identity_association_status: 'direct_profile', payment_authorization_status: 'not_authorized', reason: 'Public profile.' }], warnings: [], assessments: [] };
    const result = await assess(data, { ENABLE_PARALLEL: '1', PARALLEL_API_KEY: 'test', PARALLEL_DECISION_MAX_CENTS: '10' });
    assert.equal(result.status, 'Potential contact — unverified'); assert.equal(result.candidates[0].payment_authorization_status, 'not_authorized');
    assert.ok(result.warnings.some(warning => warning.includes('did not match'))); assert.match(result.assessments[0].explanation, /cannot corroborate/);
  } finally { globalThis.fetch = originalFetch; if (oldLimit === undefined) delete process.env.PROVIDER_DAILY_CALL_LIMIT; else process.env.PROVIDER_DAILY_CALL_LIMIT = oldLimit; if (oldDir === undefined) delete process.env.PROVIDER_BUDGET_DIR; else process.env.PROVIDER_BUDGET_DIR = oldDir; await rm(dir, { recursive: true, force: true }); }
});

test('even an optimistic Drex verification score cannot authorize a recipient', async () => {
  const originalFetch = globalThis.fetch, oldLimit = process.env.PROVIDER_DAILY_CALL_LIMIT, oldDir = process.env.PROVIDER_BUDGET_DIR;
  const dir = await mkdtemp(path.join(tmpdir(), 'ut-budget-drex-optimistic-')); process.env.PROVIDER_BUDGET_DIR = dir; process.env.PROVIDER_DAILY_CALL_LIMIT = '1';
  globalThis.fetch = async () => Response.json({ answers: { contradiction: { type: 'noul', noul: 0.01 }, relevance: { type: 'noul', noul: 0.99 }, identity_link: { type: 'noul', noul: 0.99 }, verification_needed: { type: 'noul', noul: 0.01 } } });
  try {
    const { assess } = await import('../server/providers.mjs?drex-optimistic-test');
    const data = { target: { profileUrl: 'https://github.com/example' }, status: 'Published payment link', candidates: [{ candidate_type: 'paypal_me', candidate_value: 'https://paypal.me/example', source_url: 'https://github.com/example', identity_association_status: 'direct_profile', payment_authorization_status: 'not_authorized', reason: 'Public profile.' }], warnings: [], assessments: [] };
    const result = await assess(data, { ENABLE_DREX: '1', DREX_API_KEY: 'test', DREX_MAX_CENTS: '10' });
    assert.equal(result.candidates[0].payment_authorization_status, 'not_authorized'); assert.notEqual(result.status, 'Verified payment destination');
    assert.match(result.assessments.find(item => item.question.includes('verification')).explanation, /remains necessary regardless/);
  } finally { globalThis.fetch = originalFetch; if (oldLimit === undefined) delete process.env.PROVIDER_DAILY_CALL_LIMIT; else process.env.PROVIDER_DAILY_CALL_LIMIT = oldLimit; if (oldDir === undefined) delete process.env.PROVIDER_BUDGET_DIR; else process.env.PROVIDER_BUDGET_DIR = oldDir; await rm(dir, { recursive: true, force: true }); }
});

test('a Drex refusal is surfaced and downgrades, never authorizes, payment evidence', async () => {
  const originalFetch = globalThis.fetch, oldLimit = process.env.PROVIDER_DAILY_CALL_LIMIT, oldDir = process.env.PROVIDER_BUDGET_DIR;
  const dir = await mkdtemp(path.join(tmpdir(), 'ut-budget-drex-refusal-')); process.env.PROVIDER_BUDGET_DIR = dir; process.env.PROVIDER_DAILY_CALL_LIMIT = '1';
  globalThis.fetch = async () => Response.json({ answers: { contradiction: { type: 'refusal' } } });
  try {
    const { assess } = await import('../server/providers.mjs?drex-refusal-test');
    const data = { target: { profileUrl: 'https://github.com/example' }, status: 'Published payment link', candidates: [{ candidate_type: 'paypal_me', candidate_value: 'https://paypal.me/example', source_url: 'https://github.com/example', identity_association_status: 'direct_profile', payment_authorization_status: 'not_authorized', reason: 'Public profile.' }], warnings: [], assessments: [] };
    const result = await assess(data, { ENABLE_DREX: '1', DREX_API_KEY: 'test', DREX_MAX_CENTS: '10' });
    assert.equal(result.assessments[0].answer, 'refused'); assert.equal(result.status, 'Potential contact — unverified');
    assert.equal(result.candidates[0].payment_authorization_status, 'not_authorized'); assert.ok(result.warnings.some(w => w.includes('Drex refused')));
  } finally { globalThis.fetch = originalFetch; if (oldLimit === undefined) delete process.env.PROVIDER_DAILY_CALL_LIMIT; else process.env.PROVIDER_DAILY_CALL_LIMIT = oldLimit; if (oldDir === undefined) delete process.env.PROVIDER_BUDGET_DIR; else process.env.PROVIDER_BUDGET_DIR = oldDir; await rm(dir, { recursive: true, force: true }); }
});

test('clearing the cache stops later provider calls in the same lookup', async () => {
  const originalFetch = globalThis.fetch, oldLimit = process.env.PROVIDER_DAILY_CALL_LIMIT, oldDir = process.env.PROVIDER_BUDGET_DIR;
  const dir = await mkdtemp(path.join(tmpdir(), 'ut-budget-cancel-')); process.env.PROVIDER_BUDGET_DIR = dir; process.env.PROVIDER_DAILY_CALL_LIMIT = '2';
  let active = true, calls = 0;
  globalThis.fetch = async () => { calls++; active = false; return Response.json({ answers: { endorsement: { type: 'noul', noul: 0.99 } }, citations: [] }); };
  try {
    const { assess } = await import('../server/providers.mjs?cancel-test');
    const data = { target: { profileUrl: 'https://github.com/example' }, status: 'Published payment link', candidates: [{ candidate_type: 'paypal_me', candidate_value: 'https://paypal.me/example', source_url: 'https://github.com/example', identity_association_status: 'direct_profile', payment_authorization_status: 'not_authorized', reason: 'Public profile.' }], warnings: [], assessments: [] };
    await assert.rejects(assess(data, { ENABLE_PARALLEL: '1', PARALLEL_API_KEY: 'test', PARALLEL_DECISION_MAX_CENTS: '10', ENABLE_DREX: '1', DREX_API_KEY: 'test', DREX_MAX_CENTS: '10' }, () => {}, () => active), /Cache was cleared/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; if (oldLimit === undefined) delete process.env.PROVIDER_DAILY_CALL_LIMIT; else process.env.PROVIDER_DAILY_CALL_LIMIT = oldLimit; if (oldDir === undefined) delete process.env.PROVIDER_BUDGET_DIR; else process.env.PROVIDER_BUDGET_DIR = oldDir; await rm(dir, { recursive: true, force: true }); }
});

test('both decision providers use typed requests, capture citations, respect cap and never authorize', async () => {
  const originalFetch = globalThis.fetch, oldLimit = process.env.PROVIDER_DAILY_CALL_LIMIT, oldDir = process.env.PROVIDER_BUDGET_DIR;
  const dir = await mkdtemp(path.join(tmpdir(), 'ut-budget-decisions-')); process.env.PROVIDER_BUDGET_DIR = dir; process.env.PROVIDER_DAILY_CALL_LIMIT = '2';
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const payload = JSON.parse(options.body); calls.push({ url, payload, headers: options.headers });
    if (url === 'https://api.parallel.ai/v1/decisions') return Response.json({ answers: { endorsement: { type: 'noul', noul: 0.99 } }, citations: [{ url: 'https://github.com/example', title: 'Profile' }, { url: 'javascript:alert(1)' }] });
    if (url === 'https://console.nace.ai/v1/systemone') return Response.json({ answers: { contradiction: { type: 'noul', noul: 0.91 }, relevance: { type: 'noul', noul: 0.95 }, identity_link: { type: 'noul', noul: 0.9 }, verification_needed: { type: 'noul', noul: 0.99 } } });
    throw new Error('Unexpected provider');
  };
  try {
    const { assess } = await import('../server/providers.mjs?integration-test');
    const env = { ENABLE_PARALLEL: '1', ENABLE_DREX: '1', PARALLEL_API_KEY: 'test-parallel', DREX_API_KEY: 'test-drex', PARALLEL_DECISION_MAX_CENTS: '10', DREX_MAX_CENTS: '10' };
    const base = () => ({ target: { profileUrl: 'https://github.com/example' }, status: 'Published payment link (not independently account-verified)', candidates: [{ candidate_type: 'paypal_me', candidate_value: 'https://paypal.me/example', source_url: 'https://github.com/example', identity_association_status: 'direct_profile', evidence_excerpt: 'Profile bio lists https://paypal.me/example', payment_authorization_status: 'not_authorized', decision: 'published_payment_link', reason: 'Public profile.' }, { candidate_type: 'contact_url', candidate_value: 'https://example.com/contact', source_url: 'https://example.com/', identity_association_status: 'unverified_page', payment_authorization_status: 'not_authorized', decision: 'potential_contact', reason: 'Unverified contact.' }], warnings: [], assessments: [] });
    const result = await assess(base(), env);
    assert.equal(calls.length, 2); assert.equal(calls[0].payload.questions.endorsement.type, 'noul');
    assert.equal(calls[1].payload.model, 'drex-max-v1.1'); assert.deepEqual(Object.keys(calls[1].payload.questions), ['contradiction', 'relevance', 'identity_link', 'verification_needed']);
    assert.ok(Object.values(calls[1].payload.questions).every(question => question.type === 'noul')); assert.equal(result.assessments.length, 5);
    assert.ok(result.assessments.every(assessment => assessment.explanation));
    assert.match(calls[1].payload.state.evidence[0].extracted_evidence, /Profile bio lists/);
    assert.equal(result.assessments[0].citations.length, 1); assert.equal(result.status, 'Potential contact — unverified');
    assert.equal(result.candidates[0].payment_authorization_status, 'not_authorized');
    assert.equal(result.candidates[1].reason, 'Unverified contact.'); assert.equal(calls[1].payload.state.evidence.length, 1);
    const next = await assess(base(), env); assert.equal(calls.length, 2); assert.ok(next.warnings.some(w => w.includes('reservation limits')));
  } finally { globalThis.fetch = originalFetch; if (oldLimit === undefined) delete process.env.PROVIDER_DAILY_CALL_LIMIT; else process.env.PROVIDER_DAILY_CALL_LIMIT = oldLimit; if (oldDir === undefined) delete process.env.PROVIDER_BUDGET_DIR; else process.env.PROVIDER_BUDGET_DIR = oldDir; await rm(dir, { recursive: true, force: true }); }
});
