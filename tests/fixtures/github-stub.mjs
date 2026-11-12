// Preloaded into a test server (node --import): replaces DNS and HTTPS with a tiny fake GitHub so the server's cache and
// rate-limit paths can be tested offline. A flag file switches the fake API to "hourly limit used up"; if the flag file
// contains "all", the public files disappear too.
import dns from 'node:dns/promises';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';

const flag = process.env.UT_STUB_LIMIT_FLAG || '';
dns.lookup = async () => [{ address: '8.8.8.8', family: 4 }];
https.request = (url, options, callback) => {
  const req = new EventEmitter(); req.destroy = error => { if (error) req.emit('error', error); req.emit('close'); };
  req.end = () => setImmediate(() => {
    const limited = flag && existsSync(flag); const noFiles = limited && readFileSync(flag, 'utf8').trim() === 'all';
    let status = 404, body = ''; const headers = { 'content-type': 'text/plain' };
    if (url.hostname === 'api.github.com') {
      if (limited) { status = 403; headers['x-ratelimit-remaining'] = '0'; headers['x-ratelimit-reset'] = String(Math.floor(Date.now() / 1000) + 600); }
      else if (url.pathname === '/users/alice') { status = 200; body = JSON.stringify({ id: 99, login: 'alice', bio: 'Tips: paypal.me/alicebio' }); headers['content-type'] = 'application/json'; }
      else if (url.pathname.startsWith('/search/')) { status = 200; body = '{"items":[]}'; }
    } else if (!noFiles && url.href === 'https://raw.githubusercontent.com/alice/.github/HEAD/FUNDING.yml') { status = 200; body = 'custom: https://paypal.me/alicefund'; }
    const res = new EventEmitter(); res.statusCode = status; res.headers = headers; res.resume = () => {};
    callback(res);
    if (status === 200) { res.emit('data', Buffer.from(body)); res.emit('end'); }
    req.emit('close');
  });
  return req;
};
