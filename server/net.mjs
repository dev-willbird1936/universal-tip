import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';

// Connect only to a pinned public IPv4 address; reject special-purpose IPv4 answers and redirects.
export function isPublicIPv4(address) {
  if (net.isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}

export function publicURL(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Public URL exceeds the size limit');
  const url = new URL(value);
  if (url.href.length > 2048) throw new Error('Public URL exceeds the size limit');
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || net.isIP(url.hostname.replace(/^\[|\]$/g, '')) || url.hostname === 'localhost' || url.hostname.endsWith('.local')) throw new Error('Only public HTTPS URLs on port 443 are supported');
  url.hash = ''; url.search = '';
  return url;
}

export async function fetchWithRetry(value, options = {}, fetcher = fetchPublic) {
  try { return await fetcher(value, options); }
  catch (error) {
    if (!/^Remote source returned HTTP 5\d\d$/.test(error?.message || '') && error?.code !== 'EAI_AGAIN') throw error;
    if (options.shouldContinue && !options.shouldContinue()) throw new Error('Cache was cleared while this lookup was running; try again.');
    await delay(150);
    if (options.shouldContinue && !options.shouldContinue()) throw new Error('Cache was cleared while this lookup was running; try again.');
    return fetcher(value, options);
  }
}

export function enforceDeadline(request, timeout) {
  const timer = setTimeout(() => request.destroy(new Error('Source timed out')), timeout);
  timer.unref(); request.once('close', () => clearTimeout(timer));
}

export async function fetchPublic(value, { headers = {}, maxBytes = 2097152, timeout = 7000, keepQuery = false, followRedirects = 0 } = {}) {
  const url = publicURL(value);
  // Query strings are stripped from user-supplied URLs; only URLs this server builds itself may keep one.
  if (keepQuery) url.search = new URL(value).search;
  let timer;
  const addresses = await Promise.race([
    dns.lookup(url.hostname, { all: true, verbatim: true }),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('DNS lookup timed out')), Math.min(timeout, 3000)); timer.unref(); })
  ]).finally(() => clearTimeout(timer));
  const ipv4 = addresses.filter(({ family }) => family === 4);
  if (!ipv4.length || ipv4.some(({ address }) => !isPublicIPv4(address))) throw new Error('Destination has a non-public or unsupported address');
  const chosen = ipv4[0];
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET', family: 4, autoSelectFamily: false, headers: { 'user-agent': 'UniversalTip/0.1 (+public evidence research)', accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.1', ...headers },
      lookup: (_host, _opts, cb) => cb(null, chosen.address, 4), timeout
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && !(res.statusCode === 304 && headers['if-none-match'])) {
        res.resume();
        // Opt-in for web pages only: follow a few redirects that stay on the same site (path or www. changes). Every hop
        // is validated and DNS-pinned again, and request headers are never carried along.
        try {
          const next = followRedirects > 0 && typeof res.headers.location === 'string' && res.headers.location.length <= 2048 ? new URL(res.headers.location, url) : null;
          const bare = host => host.toLowerCase().replace(/^www\./, '');
          if (next && next.protocol === 'https:' && bare(next.hostname) === bare(url.hostname)) { resolve(fetchPublic(next.origin + next.pathname, { maxBytes, timeout, followRedirects: followRedirects - 1 })); return; }
        } catch { /* Fall through to the refusal. */ }
        reject(new Error('Redirects are not followed')); return;
      }
      // An unchanged resource (conditional request) is a valid answer; GitHub does not count it against the hourly limit.
      if (res.statusCode === 304 && headers['if-none-match']) { res.resume(); resolve({ notModified: true, text: '', contentType: '' }); return; }
      if (res.statusCode !== 200) {
        res.resume(); const reset = Number(res.headers['x-ratelimit-reset']);
        // GitHub reports an exhausted quota with these headers; say when it resets instead of a bare 403.
        const wait = res.headers['x-ratelimit-remaining'] === '0' && Number.isFinite(reset) ? `; rate limit resets in ${Math.min(120, Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60000)))} min` : '';
        reject(new Error(`Remote source returned HTTP ${res.statusCode}${wait}`)); return;
      }
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > maxBytes) req.destroy(new Error('Source exceeds size limit')); else chunks.push(chunk); });
      res.on('end', () => {
        // Some APIs (Stack Exchange) compress every response even unasked; unpack it within the same size limit.
        let body = Buffer.concat(chunks); const encoding = String(res.headers['content-encoding'] || '').toLowerCase();
        try { if (encoding === 'gzip') body = zlib.gunzipSync(body, { maxOutputLength: maxBytes }); else if (encoding === 'deflate') body = zlib.inflateSync(body, { maxOutputLength: maxBytes }); else if (encoding === 'br') body = zlib.brotliDecompressSync(body, { maxOutputLength: maxBytes }); }
        catch { reject(new Error('Source exceeds size limit or is not validly compressed')); return; }
        resolve({ text: body.toString('utf8'), contentType: String(res.headers['content-type'] || ''), etag: typeof res.headers.etag === 'string' && res.headers.etag.length <= 200 ? res.headers.etag : '' });
      });
      res.on('error', reject);
    });
    enforceDeadline(req, timeout);
    req.on('timeout', () => req.destroy(new Error('Source timed out')));
    req.on('error', reject); req.end();
  });
}
