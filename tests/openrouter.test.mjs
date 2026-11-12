import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openRouterJudge } from '../server/openrouter.mjs';
import { judgeQuestions } from '../server/providers.mjs';

const key = `sk-or-v1-${'a'.repeat(40)}`;
const input = () => ({ target: { profileUrl: 'https://github.com/alice', username: 'alice', platform: 'github' }, status: 'Published payment link (not independently account-verified)', warnings: [], assessments: [], identityLinks: [],
  candidates: [{ candidate_type: 'paypal_me', candidate_value: 'https://paypal.me/alice', source_url: 'https://github.com/alice', identity_association_status: 'direct_profile', decision: 'published_payment_link', payment_authorization_status: 'not_authorized', reason: 'Listed.' }] });

test('OpenRouter judge scores evidence, downgrades on a weak identity link and never authorizes payment', async () => {
  const originalFetch = globalThis.fetch, oldDir = process.env.PROVIDER_BUDGET_DIR;
  const dir = await mkdtemp(path.join(tmpdir(), 'ut-openrouter-')); process.env.PROVIDER_BUDGET_DIR = dir; const calls = [];
  let reply = { contradiction: 0.05, relevance: 0.9, identity_link: 0.9, verification_needed: 1 };
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return url.endsWith('/alpha/decisions') ? Response.json({ model: 'nace-ai/drex-max', answers: Object.fromEntries(Object.entries(reply).map(([name, noul]) => [name, { type: 'noul', noul }])) }) : Response.json({ choices: [{ message: { content: JSON.stringify(reply) } }] }); };
  try {
    const { assess } = await import('../server/providers.mjs?openrouter-test');
    const ok = await assess(input(), { OPENROUTER_API_KEY: key });
    assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://openrouter.ai/api/alpha/decisions'); assert.equal(Object.keys(JSON.parse(calls[0].options.body).questions).length, 4);
    // Matches OpenRouter's documented DecisionsNoulQuestion: type 'noul', optional string instructions, optional criteria { true, false }; no other fields.
    const sent = JSON.parse(calls[0].options.body); assert.equal(sent.model, 'nace-ai/drex-max');
    assert.ok(sent.state.evidence.every(item => typeof item.how_linked === 'string' && typeof item.association === 'string'), 'Each piece of evidence says how the link is tied to the profile');
    for (const question of Object.values(sent.questions)) {
      assert.deepEqual(Object.keys(question).sort(), ['criteria', 'instructions', 'type']); assert.equal(question.type, 'noul');
      assert.equal(typeof question.instructions, 'string'); assert.deepEqual(Object.keys(question.criteria).sort(), ['false', 'true']);
    }
    assert.equal(calls[0].options.headers.authorization, `Bearer ${key}`); assert.equal(JSON.parse(calls[0].options.body).model, 'nace-ai/drex-max');
    assert.equal(ok.assessments.length, 4); assert.equal(ok.status.startsWith('Published payment link'), true);
    assert.notEqual(ok.status, 'Verified payment destination');
    assert.equal(ok.candidates[0].payment_authorization_status, 'not_authorized');
    reply = { contradiction: 0.05, relevance: 0.9, identity_link: 0.1, verification_needed: 1 };
    const weak = await assess(input(), { OPENROUTER_API_KEY: key });
    assert.equal(weak.status, 'Potential contact — unverified'); assert.equal(weak.candidates[0].decision, 'potential_contact');
    assert.equal((await assess(input(), { OPENROUTER_API_KEY: 'not-a-key' })).assessments.length, 0);
    assert.equal(calls.length, 2, 'An invalid key makes no request');
    const chat = await assess(input(), { OPENROUTER_API_KEY: key, OPENROUTER_MODEL: 'anthropic/claude-opus-5.5' });
    assert.equal(calls[2].url, 'https://openrouter.ai/api/v1/chat/completions'); assert.equal(chat.status, 'Potential contact — unverified');
  } finally { globalThis.fetch = originalFetch; if (oldDir === undefined) delete process.env.PROVIDER_BUDGET_DIR; else process.env.PROVIDER_BUDGET_DIR = oldDir; await rm(dir, { recursive: true, force: true }); }
});
test('saving an OpenRouter key checks it with OpenRouter first and never stores a rejected key', async () => {
  const { checkOpenRouterKey } = await import('../server/settings.mjs');
  const seen = [];
  const fake = status => async (url, options) => { seen.push([url, options.headers.authorization]); return new Response('{}', { status }); };
  assert.equal(await checkOpenRouterKey('sk-or-v1-abcdefghijklmnopqrstuvwxyz', fake(200)), 'accepted');
  assert.deepEqual(seen[0], ['https://openrouter.ai/api/v1/key', 'Bearer sk-or-v1-abcdefghijklmnopqrstuvwxyz']);
  assert.equal(await checkOpenRouterKey('sk-or-v1-abcdefghijklmnopqrstuvwxyz', fake(401)), 'rejected');
  assert.equal(await checkOpenRouterKey('sk-or-v1-abcdefghijklmnopqrstuvwxyz', fake(503)), 'unchecked');
  assert.equal(await checkOpenRouterKey('sk-or-v1-abcdefghijklmnopqrstuvwxyz', async () => { throw new TypeError('offline'); }), 'unchecked');
});
test('saving a GitHub token checks it with GitHub first', async () => {
  const { checkGithubToken } = await import('../server/settings.mjs');
  const fake = status => async url => { assert.equal(url, 'https://api.github.com/rate_limit'); return new Response('{}', { status }); };
  assert.equal(await checkGithubToken('ghp_abcdefghijklmnopqrstuvwxyz0123', fake(200)), 'accepted');
  assert.equal(await checkGithubToken('ghp_abcdefghijklmnopqrstuvwxyz0123', fake(401)), 'rejected');
  assert.equal(await checkGithubToken('ghp_abcdefghijklmnopqrstuvwxyz0123', fake(503)), 'unchecked');
});
test('the popup decision-model check judges a fixed made-up example and reports refusals and errors plainly', async () => {
  const oldDir = process.env.PROVIDER_BUDGET_DIR; const dir = await mkdtemp(path.join(tmpdir(), 'ut-judge-test-')); process.env.PROVIDER_BUDGET_DIR = dir;
  try {
    const { sampleJudgement } = await import('../server/providers.mjs?judge-sample-test');
    const env = { OPENROUTER_API_KEY: 'sk-or-v1-abcdefghijklmnopqrstuvwxyz' }; const sent = [];
    const ok = async (url, headers, body) => { sent.push({ url, body }); return { answers: { relevance: { type: 'noul', noul: 0.934 }, identity_link: { type: 'noul', noul: 0.8 }, contradiction: { type: 'refusal' }, verification_needed: { type: 'noul', noul: 7 } } }; };
    const result = await sampleJudgement(env, ok);
    assert.equal(sent[0].url, 'https://openrouter.ai/api/alpha/decisions'); assert.equal(sent[0].body.model, 'nace-ai/drex-max');
    assert.match(sent[0].body.state.profile_url, /example-maker/, 'Only the made-up example is sent');
    assert.deepEqual(Object.keys(sent[0].body.state.evidence[0]).sort(), ['association', 'extracted_evidence', 'how_linked', 'link', 'source'], 'Same evidence shape as a real lookup');
    assert.deepEqual(result.answers, { contradiction: 'refused', relevance: 0.93, identity_link: 0.8, verification_needed: null });
    await assert.rejects(sampleJudgement(env, async () => { throw new Error('Provider returned HTTP 401'); }), /rejected access or credentials/);
    await assert.rejects(sampleJudgement({}, ok), /Add your OpenRouter key first/);
  } finally { if (oldDir === undefined) delete process.env.PROVIDER_BUDGET_DIR; else process.env.PROVIDER_BUDGET_DIR = oldDir; await rm(dir, { recursive: true, force: true }); }
});
test('the Decisions request uses only fields in OpenRouter\'s published schema (openapi.json, read 2026-11-12)', async () => {
  // DecisionsRequest: assets, model, provider, questions, session_id, state, trace, user (model, state, questions required).
  // DecisionsNoulQuestion: type (required, "noul"), instructions, criteria { true, false }.
  let body; await openRouterJudge('sk-or-test', 'nace-ai/drex-max', { profile_url: 'https://example.test/a', evidence: [] }, judgeQuestions, async (url, headers, sent) => { assert.equal(url, 'https://openrouter.ai/api/alpha/decisions'); body = sent; return { answers: {} }; });
  assert.deepEqual(Object.keys(body).sort(), ['model', 'questions', 'state']);
  for (const [name, question] of Object.entries(body.questions)) {
    assert.equal(question.type, 'noul', name); assert.ok(Object.keys(question).every(key => ['type', 'instructions', 'criteria'].includes(key)), name);
    assert.deepEqual(Object.keys(question.criteria).sort(), ['false', 'true'], name);
  }
});
