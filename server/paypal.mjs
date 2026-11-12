import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
// Sandbox by default. PAYPAL_ENV=live switches to PayPal's live API with PAYPAL_LIVE_CLIENT_ID / PAYPAL_LIVE_CLIENT_SECRET (real money; not exercised by the author).
export const paypalLive = () => process.env.PAYPAL_ENV === 'live';
const api = () => paypalLive() ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
const approvalHost = () => paypalLive() ? 'www.paypal.com' : 'www.sandbox.paypal.com';
// Held tips: a tip for a username with no confirmed payment link is paid to the operator's PayPal account and recorded
// against that username in this local ledger until the person claims it. Only platform, username, amount, order ID and time are kept.
const LEDGER = new URL('../data/held-tips.json', import.meta.url);
async function ledger() { try { const rows = JSON.parse(await readFile(LEDGER, 'utf8')); return Array.isArray(rows) ? rows : []; } catch { return []; } }
export function validHeldFor(value) { return value && typeof value === 'object' && ['github', 'reddit', 'x', 'youtube', 'facebook', 'stackoverflow'].includes(value.platform) && typeof value.username === 'string' && /^[\w.@-]{1,60}$/.test(value.username) ? { platform: value.platform, username: value.username.toLowerCase() } : null; }
export async function heldTotal(heldFor) { const who = validHeldFor(heldFor); if (!who) return { count: 0, totalUsd: '0.00' }; const rows = (await ledger()).filter(r => r.platform === who.platform && r.username === who.username && r.live === paypalLive()); return { count: rows.length, totalUsd: rows.reduce((sum, r) => sum + Number(r.amountUsd), 0).toFixed(2) }; }
const pending = new Map(); let creating = 0;
async function request(path, options) {
  const response = await fetch(api() + path, { ...options, signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (!response.ok) throw new Error(`PayPal sandbox returned HTTP ${response.status}`);
  const reader = response.body?.getReader(); if (!reader) throw new Error('PayPal sandbox returned no response body');
  const chunks = []; let size = 0;
  while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 524288) { await reader.cancel(); throw new Error('PayPal sandbox response exceeded size limit'); } chunks.push(value); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('PayPal sandbox returned an invalid response'); }
}
async function token() {
  const id = paypalLive() ? process.env.PAYPAL_LIVE_CLIENT_ID : process.env.PAYPAL_SANDBOX_CLIENT_ID; const secret = paypalLive() ? process.env.PAYPAL_LIVE_CLIENT_SECRET : process.env.PAYPAL_SANDBOX_CLIENT_SECRET;
  if (!id || !secret) throw new Error('PayPal sandbox credentials are not configured');
  const result = await request('/v1/oauth2/token', { method: 'POST', headers: { authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  if (typeof result.access_token !== 'string' || !result.access_token.length || result.access_token.length > 8192 || /[\r\n]/.test(result.access_token)) throw new Error('Invalid PayPal sandbox token response');
  return result.access_token;
}
export async function verifySandboxCredentials() { await token(); return true; }
export async function createSandboxOrder(heldFor = null) {
  const who = validHeldFor(heldFor);
  for (const [state, entry] of pending) if (entry.expires < Date.now()) pending.delete(state);
  if (pending.size + creating >= 100) throw new Error('Too many pending sandbox orders; try again later');
  creating++;
  try {
    const access = await token();
    const state = randomBytes(24).toString('hex');
    const data = await request('/v2/checkout/orders', { method: 'POST', headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json', prefer: 'return=representation', 'paypal-request-id': randomBytes(16).toString('hex') }, body: JSON.stringify({
      intent: 'CAPTURE', purchase_units: [{ description: who ? `Universal Tip: tip held for ${who.platform}:${who.username}`.slice(0, 120) : 'Universal Tip isolated sandbox demonstration', amount: { currency_code: 'USD', value: '1.00' } }],
      payment_source: { paypal: { experience_context: { return_url: `http://127.0.0.1:4318/sandbox/return?state=${state}`, cancel_url: 'http://127.0.0.1:4318/sandbox/cancel', user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING' } } }
    }) });
    if (typeof data.id !== 'string' || !/^[A-Z0-9]{5,40}$/i.test(data.id)) throw new Error('Invalid sandbox order ID');
    const approval = Array.isArray(data.links) ? data.links.find(link => link && typeof link.href === 'string' && ['payer-action', 'approve'].includes(link.rel)) : null;
    const url = new URL(approval?.href || '');
    if (url.protocol !== 'https:' || url.hostname !== approvalHost() || url.username || url.password || url.port) throw new Error('PayPal returned an unexpected approval URL');
    pending.set(state, { id: data.id, who, expires: Date.now() + 15 * 60 * 1000 });
    return { approvalUrl: url.href };
  } finally { creating--; }
}
export async function captureSandboxOrder(state, orderId) {
  const entry = pending.get(state); pending.delete(state);
  if (!entry || entry.expires < Date.now() || entry.id !== orderId) throw new Error('Unknown, expired or mismatched sandbox approval');
  const access = await token();
  const data = await request(`/v2/checkout/orders/${encodeURIComponent(entry.id)}/capture`, { method: 'POST', headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json', 'paypal-request-id': randomBytes(16).toString('hex') }, body: '{}' });
  if (data.status === 'COMPLETED' && entry.who) { const rows = await ledger(); rows.push({ ...entry.who, amountUsd: '1.00', orderId: entry.id, live: paypalLive(), at: new Date().toISOString() }); await mkdir(new URL('.', LEDGER), { recursive: true }); await writeFile(LEDGER, JSON.stringify(rows, null, 1)); return `COMPLETED. $1.00 is now held for ${entry.who.platform}:${entry.who.username}`; }
  return data.status;
}
