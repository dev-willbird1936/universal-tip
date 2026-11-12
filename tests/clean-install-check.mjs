import { mkdtemp, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Copy only source and lockfile into a fresh, owned temporary directory.
const root = process.cwd(); const temp = await mkdtemp(path.join(tmpdir(), 'universal-tip-clean-'));
try {
  for (const name of ['package.json', 'package-lock.json', 'server', 'scripts', 'tests', 'extension']) {
    await cp(path.join(root, name), path.join(temp, name), { recursive: true, filter: source => !source.split(/[\\/]/).includes('dist') });
  }
  for (const command of ['npm ci --ignore-scripts --no-audit --no-fund', 'npm run build', 'npm test']) {
    const result = spawnSync(command, { cwd: temp, shell: true, stdio: 'inherit', env: { ...process.env, ENABLE_PARALLEL: '0', ENABLE_PARALLEL_SEARCH: '0', ENABLE_DREX: '0', OPENROUTER_API_KEY: '', CACHE_ENCRYPTION_KEY: '', PAYPAL_SANDBOX_CLIENT_ID: '', PAYPAL_SANDBOX_CLIENT_SECRET: '', GITHUB_TOKEN: '', REDDIT_ACCESS_TOKEN: '' } });
    if (result.status !== 0) throw new Error(`Clean-install check failed: ${command}`);
  }
  console.log('PASS: clean npm install, extension build and unit suite in an isolated temporary directory.');
} finally { await rm(temp, { recursive: true, force: true }); }
