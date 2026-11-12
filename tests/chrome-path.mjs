// Browser for the extension checks: CHROME_PATH if set, else Playwright's expected Chromium, else the newest
// Playwright Chromium installed (another project's Playwright update can remove the expected build).
import { chromium } from 'playwright-core';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const expected = chromium.executablePath();
  if (existsSync(expected)) return expected;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || (process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || '', 'ms-playwright') : process.platform === 'darwin' ? path.join(homedir(), 'Library', 'Caches', 'ms-playwright') : path.join(homedir(), '.cache', 'ms-playwright'));
  const relative = process.platform === 'win32' ? ['chrome-win64', 'chrome.exe'] : process.platform === 'darwin' ? ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'] : ['chrome-linux', 'chrome'];
  let builds = [];
  try { builds = readdirSync(root).filter(name => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])); } catch { /* No Playwright browsers installed. */ }
  for (const build of builds) { const candidate = path.join(root, build, ...relative); if (existsSync(candidate)) return candidate; }
  return expected; // Playwright then reports the missing browser and how to install it.
}
