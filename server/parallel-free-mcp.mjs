// A deliberately narrow, unauthenticated MCP client for Parallel's documented free
// web_decisions tool. It never reads API keys, follows redirects, or calls other tools.
const ENDPOINT = 'https://mcp.parallel.ai/mcp';
const VERSION = '2025-03-26';
const MAX_BYTES = 500000;

async function responseMessage(response, id) {
  const reader = response.body?.getReader(); if (!reader) throw new Error('Parallel MCP returned no response body');
  const type = response.headers.get('content-type') || ''; const sse = type.includes('text/event-stream');
  if (!sse && !type.includes('application/json')) { await reader.cancel(); throw new Error('Parallel MCP returned an unexpected content type'); }
  const decoder = new TextDecoder(); let text = '', size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); size += chunk.value?.byteLength || 0;
      if (size > MAX_BYTES) throw new Error('Parallel MCP response exceeded size limit');
      text += decoder.decode(chunk.value, { stream: !chunk.done });
      if (sse) {
        let boundary;
        while ((boundary = text.search(/\r?\n\r?\n/)) >= 0) {
          const event = text.slice(0, boundary); const delimiter = text.slice(boundary).match(/^\r?\n\r?\n/)[0]; text = text.slice(boundary + delimiter.length);
          const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
          if (!data) continue;
          let message; try { message = JSON.parse(data); } catch { throw new Error('Parallel MCP returned malformed JSON'); }
          if (message.jsonrpc === '2.0' && message.id === id) return message;
        }
      }
      if (chunk.done) {
        if (sse) throw new Error('Parallel MCP stream ended without a response');
        let message; try { message = JSON.parse(text); } catch { throw new Error('Parallel MCP returned malformed JSON'); }
        if (message?.jsonrpc !== '2.0' || message.id !== id) throw new Error('Parallel MCP returned an unexpected response');
        return message;
      }
    }
  } finally { await reader.cancel().catch(() => {}); }
}

export async function freeParallelDecision(state, questions, { fetchImpl = globalThis.fetch, shouldContinue = () => true } = {}) {
  const signal = AbortSignal.timeout(60000); let session = '';
  const ensureActive = () => { if (!shouldContinue()) throw new Error('Cache was cleared while this lookup was running; try again.'); };
  async function send(message) {
    ensureActive();
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': VERSION, ...(session ? { 'mcp-session-id': session } : {}) };
    const response = await fetchImpl(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(message), signal, redirect: 'error' });
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error(`Parallel MCP returned HTTP ${response.status}`); }
    const receivedSession = response.headers.get('mcp-session-id');
    if (receivedSession) {
      if (!/^[\x21-\x7e]{1,256}$/.test(receivedSession) || (session && session !== receivedSession)) throw new Error('Parallel MCP returned an invalid session');
      session = receivedSession;
    }
    if (message.id === undefined) { await response.body?.cancel().catch(() => {}); return null; }
    const result = await responseMessage(response, message.id); if (result.error) throw new Error('Parallel MCP returned an RPC error');
    return result.result;
  }
  try {
    const initialized = await send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: VERSION, capabilities: {}, clientInfo: { name: 'universal-tip', version: '0.1.0' } } });
    if (initialized?.protocolVersion !== VERSION) throw new Error('Parallel MCP protocol version is unsupported');
    await send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const result = await send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'web_decisions', arguments: { state, questions } } });
    ensureActive(); if (!result || result.isError) throw new Error('Parallel MCP returned a tool error');
    if (result.structuredContent && typeof result.structuredContent === 'object' && !Array.isArray(result.structuredContent)) return result.structuredContent;
    const block = Array.isArray(result.content) ? result.content.find(item => item?.type === 'text' && typeof item.text === 'string') : null;
    if (!block) throw new Error('Parallel MCP returned no structured decision');
    let data; try { data = JSON.parse(block.text); } catch { throw new Error('Parallel MCP returned invalid decision data'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Parallel MCP returned invalid decision data');
    return data;
  } finally {
    if (session) await fetchImpl(ENDPOINT, { method: 'DELETE', headers: { 'mcp-session-id': session, 'mcp-protocol-version': VERSION }, signal: AbortSignal.timeout(3000), redirect: 'error' }).then(response => response.body?.cancel()).catch(() => {});
  }
}
