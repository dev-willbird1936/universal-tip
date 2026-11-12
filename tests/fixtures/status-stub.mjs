// A stand-in for the local server's /status on port 4318, for browser fixtures that need to control whether a site's API
// allowance is reported as used up. `limited` can be changed while the stub runs.
import http from 'node:http';

export async function startStatusStub(limited = {}) {
  const state = { limited };
  const server = http.createServer((req, res) => {
    const headers = { 'access-control-allow-origin': req.headers.origin || '*', 'access-control-allow-headers': 'x-local-token, content-type', 'content-type': 'application/json' };
    if (req.method === 'OPTIONS') { res.writeHead(204, headers); res.end(); return; }
    res.writeHead(200, headers); res.end(JSON.stringify({ ok: true, limited: state.limited, limitResetMinutes: { github: state.limited.github ? 12 : 0, stackoverflow: 0 } }));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4318, '127.0.0.1', resolve); });
  return { state, close: () => new Promise(resolve => server.close(resolve)) };
}
