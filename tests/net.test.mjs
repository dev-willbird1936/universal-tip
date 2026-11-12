import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { fetchPublic } from '../server/net.mjs';

test('public fetch rejects mixed private DNS answers, pins a public address, and never follows redirects', async () => {
  const originalLookup = dns.lookup, originalRequest = https.request; let requests = 0, status = 200, body = 'public fixture';
  try {
    dns.lookup = async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }];
    https.request = () => { requests++; throw new Error('Request must not start'); };
    await assert.rejects(fetchPublic('https://example.com/profile'), /non-public/); assert.equal(requests, 0);
    dns.lookup = async () => [{ address: '::1', family: 6 }];
    await assert.rejects(fetchPublic('https://example.com/profile'), /unsupported/); assert.equal(requests, 0);
    dns.lookup = async () => [{ address: '8.8.8.8', family: 4 }];
    https.request = (url, options, callback) => {
      requests++; assert.equal(url.hostname, 'example.com'); assert.equal(options.family, 4); assert.equal(options.autoSelectFamily, false);
      options.lookup('example.com', {}, (error, address, family) => { assert.equal(error, null); assert.equal(address, '8.8.8.8'); assert.equal(family, 4); });
      const req = new EventEmitter(); req.destroy = error => { req.failed = true; if (error) req.emit('error', error); req.emit('close'); };
      req.end = () => setImmediate(() => {
        const response = new EventEmitter(); response.statusCode = status; response.headers = { 'content-type': 'text/html' }; response.resume = () => req.emit('close');
        callback(response);
        if (status === 200) { response.emit('data', Buffer.from(body)); if (!req.failed) { response.emit('end'); req.emit('close'); } }
      });
      return req;
    };
    const result = await fetchPublic('https://example.com/profile'); assert.equal(result.text, 'public fixture'); assert.equal(requests, 1);
    status = 302; await assert.rejects(fetchPublic('https://example.com/profile'), /Redirects are not followed/); assert.equal(requests, 2, 'Redirect must not create a second request');
    // Opt-in: only same-site redirects are followed, each as a fresh validated request without the original headers.
    const baseRequest = https.request; const seen = []; let location = 'https://example.com/home?x=1';
    https.request = (url, options, callback) => {
      seen.push({ href: url.href, auth: options.headers.authorization }); status = seen.length === 1 ? 302 : 200;
      return baseRequest(url, options, response => { if (response.statusCode === 302) response.headers.location = location; callback(response); });
    };
    body = 'landed';
    const followed = await fetchPublic('https://example.com/profile', { followRedirects: 3, headers: { authorization: 'Bearer secret' } });
    assert.equal(followed.text, 'landed'); assert.equal(seen.length, 2); assert.equal(seen[0].auth, 'Bearer secret');
    assert.equal(seen[1].href, 'https://example.com/home'); assert.equal(seen[1].auth, undefined);
    seen.length = 0; location = 'https://evil.example/';
    await assert.rejects(fetchPublic('https://example.com/profile', { followRedirects: 3 }), /Redirects are not followed/); assert.equal(seen.length, 1);
    https.request = baseRequest;
    status = 200; body = 'x'.repeat(20); await assert.rejects(fetchPublic('https://example.com/profile', { maxBytes: 10 }), /size limit/);
  } finally { dns.lookup = originalLookup; https.request = originalRequest; }
});
test('compressed responses are unpacked within the size limit', async () => {
  const zlib = await import('node:zlib');
  const originalLookup = dns.lookup, originalRequest = https.request; let payload;
  try {
    dns.lookup = async () => [{ address: '8.8.8.8', family: 4 }];
    https.request = (url, options, callback) => {
      const req = new EventEmitter(); req.destroy = error => { if (error) req.emit('error', error); };
      req.end = () => setImmediate(() => { const res = new EventEmitter(); res.statusCode = 200; res.headers = { 'content-type': 'application/json', 'content-encoding': 'gzip' }; res.resume = () => {}; callback(res); res.emit('data', payload); res.emit('end'); });
      return req;
    };
    payload = zlib.gzipSync('{"ok":true}');
    assert.equal((await fetchPublic('https://api.example.com/x')).text, '{"ok":true}');
    payload = zlib.gzipSync(Buffer.alloc(5000, 97));
    await assert.rejects(fetchPublic('https://api.example.com/x', { maxBytes: 1000 }), /size limit/, 'A small compressed body must not expand past the limit');
  } finally { dns.lookup = originalLookup; https.request = originalRequest; }
});
