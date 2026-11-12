// Explicit opt-in sandbox authentication check. Never creates or captures an order.
import { verifySandboxCredentials } from '../server/paypal.mjs';
try {
  await verifySandboxCredentials();
  console.log('Sandbox OAuth credentials were accepted. No order was created; buyer approval and capture remain untested.');
} catch (error) {
  console.error(`Sandbox authentication could not be verified: ${String(error?.message || 'unknown error')}`);
  process.exitCode = 1;
}
