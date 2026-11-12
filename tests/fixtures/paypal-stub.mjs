// Isolated child-process PayPal transport fixture. Never contacts PayPal or any other host.
import { appendFile } from 'node:fs/promises';
const BASE = 'https://api-m.sandbox.paypal.com'; let order = 0;
globalThis.fetch = async (input, options = {}) => {
  const url = String(input); if (!url.startsWith(`${BASE}/`)) throw new Error('Fixture refused external network access');
  const endpoint = new URL(url).pathname;
  await appendFile(process.env.PAYPAL_FIXTURE_LOG, `${endpoint}\n`, 'utf8');
  if (endpoint === '/v1/oauth2/token') return Response.json({ access_token: 'fixture-only-token' });
  if (endpoint === '/v2/checkout/orders') {
    const payload = JSON.parse(options.body); const state = new URL(payload.payment_source.paypal.experience_context.return_url).searchParams.get('state');
    const id = `FIXTUREORDER${++order}`;
    return Response.json({ id, links: [{ rel: 'payer-action', href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}&fixture_state=${state}` }] });
  }
  if (/^\/v2\/checkout\/orders\/FIXTUREORDER\d+\/capture$/.test(endpoint)) return Response.json({ status: 'COMPLETED' });
  throw new Error('Unexpected fixture endpoint');
};
