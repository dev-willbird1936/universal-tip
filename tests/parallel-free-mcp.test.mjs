import test from 'node:test';
import assert from 'node:assert/strict';
import { freeParallelDecision } from '../server/parallel-free-mcp.mjs';

function streamReply(id, result) {
  const data = new TextEncoder().encode(`event: message\r\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result })}\r\n\r\n`);
  return new Response(new ReadableStream({ start(controller) { const cut = Math.floor(data.length / 2); controller.enqueue(data.slice(0, cut)); controller.enqueue(data.slice(cut)); controller.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream', 'mcp-session-id': 'test-session' } });
}

test('free Parallel MCP initializes, calls only web_decisions without credentials, and closes the session', async () => {
  const calls = []; const state = { profile_url: 'https://github.com/example' }; const questions = { endorsement: { type: 'noul', instructions: 'Is this link listed?' } };
  const fetchImpl = async (url, options) => {
    calls.push({ url, options }); assert.equal(url, 'https://mcp.parallel.ai/mcp'); assert.equal(options.redirect, 'error');
    assert.equal(Object.keys(options.headers).some(key => /authorization|api-key/i.test(key)), false);
    if (options.method === 'DELETE') return new Response(null, { status: 204 });
    const rpc = JSON.parse(options.body);
    if (rpc.method === 'initialize') return streamReply(rpc.id, { protocolVersion: '2025-03-26', capabilities: {} });
    assert.equal(options.headers['mcp-session-id'], 'test-session');
    if (rpc.method === 'notifications/initialized') return new Response(null, { status: 202 });
    assert.equal(rpc.method, 'tools/call'); assert.equal(rpc.params.name, 'web_decisions'); assert.deepEqual(rpc.params.arguments, { state, questions });
    return streamReply(rpc.id, { isError: false, structuredContent: { answers: { endorsement: { type: 'noul', noul: 0.8 } }, citations: [{ url: 'https://github.com/example' }] } });
  };
  const result = await freeParallelDecision(state, questions, { fetchImpl });
  assert.equal(result.answers.endorsement.noul, 0.8); assert.equal(calls.length, 4); assert.equal(calls.at(-1).options.method, 'DELETE');
});

test('free MCP rejects oversized responses and never uses a redirected host', async () => {
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls++; assert.equal(url, 'https://mcp.parallel.ai/mcp'); assert.equal(options.redirect, 'error');
    return new Response('x'.repeat(500001), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  await assert.rejects(freeParallelDecision({}, {}, { fetchImpl }), /size limit/); assert.equal(calls, 1);
});

test('free MCP fails closed on cancellation and unexpected protocol or tool errors', async () => {
  let active = true, calls = [];
  const fetchImpl = async (url, options) => {
    if (options.method === 'DELETE') { calls.push('close'); return new Response(null, { status: 204 }); }
    const rpc = JSON.parse(options.body); calls.push(rpc.method);
    if (rpc.method === 'initialize') { active = false; return streamReply(rpc.id, { protocolVersion: '2025-03-26' }); }
    throw new Error('No later call is allowed');
  };
  await assert.rejects(freeParallelDecision({}, {}, { fetchImpl, shouldContinue: () => active }), /Cache was cleared/);
  assert.deepEqual(calls, ['initialize', 'close']);
  await assert.rejects(freeParallelDecision({}, {}, { fetchImpl: async () => streamReply(1, { protocolVersion: '2099-01-01' }) }), /unsupported/);
});
