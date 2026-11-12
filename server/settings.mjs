import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Settings entered in the extension popup, kept in the git-ignored data directory (plain text, this computer only).
const file = path.resolve('data', 'settings.json');
let saved = {};
try { const parsed = JSON.parse(await readFile(file, 'utf8')); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) saved = parsed; } catch { /* No saved settings yet. */ }
const validKey = value => typeof value === 'string' && /^sk-or-[\w-]{20,200}$/.test(value);
// An explicitly empty OPENROUTER_API_KEY disables the saved key (tests use this); a custom env object never reads it.
export function openRouterKey(env = process.env) { return validKey(env.OPENROUTER_API_KEY) ? env.OPENROUTER_API_KEY : env === process.env && env.OPENROUTER_API_KEY !== '' && validKey(saved.openrouterKey) ? saved.openrouterKey : ''; }
const validGithub = value => typeof value === 'string' && /^(?:gh[pousr]_|github_pat_)\w{20,255}$/.test(value);
// Optional: raises GitHub's hourly lookup limit. A token with no scopes is enough for public data.
export function githubToken(env = process.env) { return env.GITHUB_TOKEN || (env === process.env && env.GITHUB_TOKEN !== '' && validGithub(saved.githubToken) ? saved.githubToken : ''); }
// A rejected token makes every GitHub lookup fail, so check it first (GET /rate_limit does not use the hourly allowance).
export async function checkGithubToken(value, fetcher = fetch) {
  try {
    const response = await fetcher('https://api.github.com/rate_limit', { headers: { authorization: `Bearer ${value}`, accept: 'application/vnd.github+json', 'user-agent': 'Universal-Tip' }, redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (response.status === 401) return 'rejected';
    return response.ok ? 'accepted' : 'unchecked';
  } catch { return 'unchecked'; }
}
export async function saveGithubToken(value, fetcher = fetch) {
  if (value !== '' && !validGithub(value)) throw new Error('That does not look like a GitHub token (it should start with ghp_ or github_pat_).');
  const check = value === '' ? 'removed' : await checkGithubToken(value, fetcher);
  if (check === 'rejected') throw new Error('GitHub rejected this token, so it was not saved. Check it was copied fully and has not expired.');
  saved = { ...saved, githubToken: value };
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 }); await writeFile(file, JSON.stringify(saved), { mode: 0o600 });
  return check;
}
// Ask OpenRouter whether the key is accepted (GET /api/v1/key costs no credits). A rejected key is not saved;
// if OpenRouter cannot be reached, the key is saved and the caller is told it was not checked.
export async function checkOpenRouterKey(value, fetcher = fetch) {
  try {
    const response = await fetcher('https://openrouter.ai/api/v1/key', { headers: { authorization: `Bearer ${value}` }, redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (response.status === 401 || response.status === 403) return 'rejected';
    return response.ok ? 'accepted' : 'unchecked';
  } catch { return 'unchecked'; }
}
export async function saveOpenRouterKey(value, fetcher = fetch) {
  if (value !== '' && !validKey(value)) throw new Error('That does not look like an OpenRouter key (it should start with sk-or-).');
  const check = value === '' ? 'removed' : await checkOpenRouterKey(value, fetcher);
  if (check === 'rejected') throw new Error('OpenRouter rejected this key. Copy it again from openrouter.ai/settings/keys; it was not saved.');
  saved = { ...saved, openrouterKey: value };
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 }); await writeFile(file, JSON.stringify(saved), { mode: 0o600 });
  return check;
}
