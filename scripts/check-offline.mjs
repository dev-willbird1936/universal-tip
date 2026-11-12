// Runs the build, the unit tests and every offline browser check in turn, and prints one line each.
// These checks bind port 4318, so stop the local server (close the start.bat window) first. No live site is contacted.
import { spawnSync } from 'node:child_process';
import net from 'node:net';
const busy = await new Promise(resolve => { const probe = net.createServer().once('error', () => resolve(true)).once('listening', () => probe.close(() => resolve(false))).listen(4318, '127.0.0.1'); });
if (busy) { console.error('Port 4318 is in use. Close the Universal Tip server window (start.bat), then run this again.'); process.exit(2); }
const checks = ['panel-fixture-check', 'content-fixture-check', 'hover-fixture-check', 'popup-connection-check', 'popup-repo-check', 'credit-fixture-check',
  'reddit-post-author-check', 'reddit-comment-author-check', 'reddit-profile-read-check', 'x-post-author-check', 'x-profile-read-check',
  'github-issue-author-check', 'github-page-read-check', 'github-commit-author-check', 'stackoverflow-icons-check', 'youtube-check', 'sandbox-http-fixture-check'];
const steps = [['build', process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'extension/tsconfig.json']], ['unit tests', process.execPath, ['--test', 'tests/*.test.mjs']],
  ...checks.map(name => [name, process.execPath, [`tests/${name}.mjs`]])];
let failed = 0;
for (const [name, command, args] of steps) {
  const run = spawnSync(command, args, { encoding: 'utf8', timeout: 180000 });
  const ok = run.status === 0; if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(String(run.stdout + run.stderr).split('\n').filter(line => line.trim() && !/^\s+at /.test(line)).slice(-12).join('\n'));
}
console.log(failed ? `\n${failed} of ${steps.length} failed.` : `\nAll ${steps.length} passed.`);
process.exit(failed ? 1 : 0);
