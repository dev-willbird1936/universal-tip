(() => {
  const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const message = el<HTMLParagraphElement>('message');
  // The message line sits at the bottom of the popup; bring it into view whenever it changes so results are not missed.
  new MutationObserver(() => { if (message.textContent) message.scrollIntoView({ block: 'nearest' }); }).observe(message, { childList: true, characterData: true, subtree: true });
  const url = el<HTMLInputElement>('url'); const token = el<HTMLInputElement>('token');
  const connection = el<HTMLParagraphElement>('connection'); const details = el<HTMLDetailsElement>('connection-details');
  // Tell a first-time user exactly what is missing: the server, the token, or nothing.
  async function checkConnection() {
    const stored = await chrome.storage.local.get('token'); let state = 'connected'; let info: any = null;
    try {
      // First run: no token yet, so pair straight away instead of sending a request that is bound to be refused.
      if (!stored.token) { const first = await fetch('http://127.0.0.1:4318/pair', { method: 'POST', signal: AbortSignal.timeout(4000) }).catch(() => null);
        if (first?.ok) { stored.token = (await first.json()).token; await chrome.storage.local.set({ token: stored.token }); token.value = stored.token; } }
      let response = await fetch('http://127.0.0.1:4318/status?limits=1', { headers: { 'x-local-token': stored.token || '' }, signal: AbortSignal.timeout(4000) });
      if (response.status === 401) {
        // Pair automatically: the local server hands its token only to browser extensions.
        const pair = await fetch('http://127.0.0.1:4318/pair', { method: 'POST', signal: AbortSignal.timeout(4000) });
        if (pair.ok) { const paired = (await pair.json()).token; await chrome.storage.local.set({ token: paired }); token.value = paired; response = await fetch('http://127.0.0.1:4318/status', { headers: { 'x-local-token': paired }, signal: AbortSignal.timeout(4000) }); }
      }
      if (response.status === 401) state = stored.token ? 'wrong-token' : 'no-token';
      else if (!response.ok) state = 'offline'; else info = await response.json();
    } catch { state = 'offline'; }
    connection.classList.toggle('error', state !== 'connected'); details.open = state === 'wrong-token' || state === 'no-token';
    connection.textContent = state === 'connected' ? (info?.openRouterConfigured ? 'Ready. Hover a username and click the tip button.' : 'Connected. Add your OpenRouter key below to finish setup.')
      : state === 'offline' ? 'The local server is not running. Start it with start.bat (or npm start) in the project folder, then reopen this popup.'
      : state === 'no-token' ? 'Almost ready: paste the pairing token printed by the server below.'
      : 'The saved pairing token was not accepted. Paste the token printed by the server below.';
    // Say so when a site's request allowance is used up and lookups are running on their fallbacks.
    if (state === 'connected' && info?.limited) {
      const mins = (n: unknown) => typeof n === 'number' && n > 0 ? ` for about ${n} more minute${n === 1 ? '' : 's'}` : '';
      const notes = [info.limited.github ? `GitHub's hourly allowance is used up${mins(info.limitResetMinutes?.github)}, so GitHub lookups use public files and the profile page meanwhile${info.githubTokenConfigured ? '' : '; a GitHub token (below) removes the limit'}.` : '',
        info.limited.stackoverflow ? `Stack Overflow's API is unavailable${mins(info.limitResetMinutes?.stackoverflow)}, so those lookups read the profile page meanwhile.` : ''].filter(Boolean);
      if (notes.length) connection.textContent += ` ${notes.join(' ')}`;
    }
    if (info) el<HTMLParagraphElement>('sandbox-hint').textContent = info.sandboxConfigured ? 'Separate from creator discovery. No real money.' : 'Not set up: the server has no PayPal sandbox credentials. Separate from creator discovery; no real money.';
    if (info) { el<HTMLParagraphElement>('gh-hint').textContent = info.githubTokenConfigured ? 'A GitHub token is saved on the local server. Save an empty field to remove it.' : 'Without one, GitHub allows about 20 lookups an hour. A token with no permissions ticked is enough.'; el<HTMLParagraphElement>('key-hint').textContent = info.openRouterConfigured ? 'A key is saved on the local server. Enter a new one to replace it.' : 'The only setup step. The key is sent to the local server on this computer, which uses it to have a decision model judge the evidence.'; el<HTMLInputElement>('orkey').placeholder = info.openRouterConfigured ? 'Key saved' : 'sk-or-...'; }
    return state;
  }
  chrome.storage.local.get('token').then((data: any) => { token.value = data.token || ''; }); checkConnection();
  function open(value: string, page?: unknown) {
    try {
      if (value.length > 8192) throw new Error();
      const target = new URL(value); if (target.protocol !== 'https:' || target.username || target.password) throw new Error();
      if (target.hostname === 'github.com' && /^\/[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?\/[\w.-]+/i.test(target.pathname) && !/^\/(?:orgs|settings|sponsors|marketplace|features|topics|collections|search|notifications|issues|pulls|explore|login|apps|enterprise|about)\//i.test(target.pathname)) target.pathname = `/${target.pathname.split('/')[1]}`; // a repository link means its owner
      target.search = ''; target.hash = ''; if (target.href.length > 2048) throw new Error();
      const extra = page ? JSON.stringify(page) : '';
      const panelUrl = chrome.runtime.getURL(`panel.html?url=${encodeURIComponent(target.href)}${extra && extra.length < 3000 ? `&xp=${encodeURIComponent(extra)}` : ''}`);
      chrome.windows.create({ url: panelUrl, type: 'popup', width: 480, height: 760 }).catch(() => chrome.tabs.create({ url: panelUrl }));
    } catch { message.textContent = 'Enter a valid public HTTPS URL.'; }
  }
  async function currentTab() { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); return tab; }
  async function api(path: string, method: string) {
    const stored = await chrome.storage.local.get('token');
    const response = await fetch(`http://127.0.0.1:4318${path}`, { method, headers: { 'x-local-token': stored.token || '' } });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Local backend request failed'); return data;
  }
  el<HTMLFormElement>('lookup-form').addEventListener('submit', event => { event.preventDefault(); open(url.value.trim()); });
  // On an X or Reddit profile page, ask the extension's script in that tab for the bio and links already shown; those sites refuse outside lookups.
  el<HTMLButtonElement>('current').addEventListener('click', async () => {
    const tab = await currentTab(); let page: unknown; let url = tab?.url || '';
    try {
      const here = new URL(url); const parts = here.pathname.split('/').filter(Boolean);
      if (/(^|\.)reddit\.com$/.test(here.hostname) && parts.length >= 2 && /^(user|u)$/i.test(parts[0])) url = `https://www.reddit.com/user/${parts[1]}/`;
      if (/(^|\.)reddit\.com$/.test(here.hostname) && tab?.id && /\/r\/[^/]+\/comments\//i.test(here.pathname)) {
        const kind = /\/comment\/\w+/i.test(here.pathname) ? 'read-comment-author' : 'read-post-author';
        const author = await chrome.tabs.sendMessage(tab.id, { type: kind, url: here.href }).catch(() => null);
        if (typeof author === 'string' && /^https:\/\/www\.reddit\.com\/user\/[\w-]{3,20}\/$/.test(author)) url = author;
      }
      // On a GitHub repository (or any page inside it), research the repository's owner.
      if (here.hostname === 'github.com' && parts.length >= 2 && /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(parts[0]) && !/^(?:orgs|settings|sponsors|marketplace|features|topics|collections|search|notifications|issues|pulls|explore|login|apps|enterprise|about)$/i.test(parts[0])) url = `https://github.com/${parts[0]}`;
      // Stack Overflow: a /users/<name> profile or a question page; the page supplies the numeric user ID.
      if (tab?.id && here.hostname === 'stackoverflow.com' && (/^\/users\/[^/]*[^\d/][^/]*\/?$/.test(here.pathname) || /^\/questions\/\d+/.test(here.pathname))) {
        const user = await chrome.tabs.sendMessage(tab.id, { type: 'read-so-user' }).catch(() => null);
        if (typeof user === 'string' && /^https:\/\/stackoverflow\.com\/users\/\d{1,10}$/.test(user)) url = user;
      }
      // On a GitHub issue or pull request, research its author rather than the repository owner.
      if (tab?.id && here.hostname === 'github.com' && /^\/[^/]+\/[^/]+\/(?:issues|pull)\/\d+/.test(here.pathname)) {
        const author = await chrome.tabs.sendMessage(tab.id, { type: 'read-issue-author' }).catch(() => null);
        if (typeof author === 'string' && /^https:\/\/github\.com\/[a-z\d-]{1,39}$/i.test(author)) url = author;
      }
      if (tab?.id && /(^|\.)(x\.com|twitter\.com)$/.test(here.hostname) && /\/status\/\d+/.test(here.pathname)) {
        const author = await chrome.tabs.sendMessage(tab.id, { type: 'read-post-author' }).catch(() => null);
        if (typeof author === 'string' && /^https:\/\/x\.com\/[A-Za-z\d_]{1,15}$/.test(author)) url = author;
      }
      if (tab?.id && /(^|\.)(x\.com|twitter\.com|reddit\.com|facebook\.com)$/.test(here.hostname)) page = (await chrome.tabs.sendMessage(tab.id, { type: 'read-profile' })) || undefined;
      // GitHub: pass along what the profile page shows, so the server has a fallback when GitHub's hourly API allowance is used up.
      if (tab?.id && here.hostname === 'github.com' && /^https:\/\/github\.com\/[a-z\d-]{1,39}$/i.test(url)) page = (await chrome.tabs.sendMessage(tab.id, { type: 'read-profile', url }).catch(() => null)) || undefined;
      // Stack Overflow: the same fallback, for when its API is over the daily allowance.
      if (tab?.id && here.hostname === 'stackoverflow.com' && /^https:\/\/stackoverflow\.com\/users\/\d{1,10}$/.test(url)) page = (await chrome.tabs.sendMessage(tab.id, { type: 'read-profile', url }).catch(() => null)) || undefined;
      // YouTube: a channel page (any tab of it) means that channel; a video page means the channel that published it.
      if (tab?.id && /(^|\.)youtube\.com$/.test(here.hostname)) {
        const handle = /^\/(@[a-z\d._-]{3,30})(?:\/|$)/i.exec(here.pathname)?.[1];
        if (handle) url = `https://www.youtube.com/${handle}`;
        else if (here.pathname === '/watch') { const owner = await chrome.tabs.sendMessage(tab.id, { type: 'read-post-author' }).catch(() => null); if (typeof owner === 'string' && /^https:\/\/www\.youtube\.com\/@[a-z\d._-]{3,30}$/i.test(owner)) url = owner; }
        if (/^https:\/\/www\.youtube\.com\/@/.test(url)) page = (await chrome.tabs.sendMessage(tab.id, { type: 'read-profile', url }).catch(() => null)) || undefined;
      }
      // On a website you have already granted, if the page names one author with a profile URL, research that person.
      else if (tab?.id && ['https:', 'http:'].includes(here.protocol) && !/(^|\.)(github\.com|gist\.github\.com|facebook\.com)$/.test(here.hostname) && !/^[a-z\d-]+\.github\.io$/i.test(here.hostname) /* the Pages account owns it; the server researches that owner */ && await chrome.permissions.contains({ origins: [`${here.protocol}//${here.host}/*`] })) {
        const injected = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
          const attr = (name: string) => document.querySelector<HTMLMetaElement>(`meta[name="${name}"], meta[property="${name}"]`)?.content?.trim() || '';
          const handles = [attr('twitter:creator'), attr('twitter:site')].map(value => /^@?([a-z\d_]{1,15})$/i.exec(value)?.[1]).filter((value): value is string => Boolean(value));
          const authors = [...document.querySelectorAll<HTMLAnchorElement>('a[rel~="author"], [itemprop="author"] a[href], a[itemprop="author"][href]')].map(a => a.href);
          const article = attr('article:author');
          const urls = [...handles.map(handle => `https://x.com/${handle}`), ...authors, ...(article.startsWith('https://') ? [article] : [])]
            .flatMap(value => { try { const next = new URL(value, location.href); if (next.protocol !== 'https:' || next.username || next.password) return []; next.search = ''; next.hash = ''; return [next.href]; } catch { return []; } });
          const unique = [...new Set(urls)].slice(0, 3);
          return unique.length === 1 ? unique[0] : null;
        } });
        const credit = injected[0]?.result; if (typeof credit === 'string' && credit.startsWith('https://')) url = credit;
      }
    } catch { /* Research the URL alone. */ }
    open(url, page);
  });
  el<HTMLButtonElement>('save').addEventListener('click', async () => {
    try {
      await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
      await chrome.storage.local.set({ token: token.value.trim() });
      const state = await checkConnection();
      message.textContent = state === 'connected' ? 'Pairing token saved and accepted by the server.' : state === 'offline' ? 'Token saved, but the server is not running so it could not be checked.' : 'Token saved, but the server did not accept it. Check that it matches the one the server printed.';
    } catch { message.textContent = 'Could not secure local extension storage; the token was not saved.'; }
  });
  el<HTMLButtonElement>('ghsave').addEventListener('click', async () => {
    try {
      const stored = await chrome.storage.local.get('token');
      const response = await fetch('http://127.0.0.1:4318/settings', { method: 'POST', headers: { 'content-type': 'application/json', 'x-local-token': stored.token || '' }, body: JSON.stringify({ githubToken: el<HTMLInputElement>('ghtoken').value.trim() }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'The token could not be saved.');
      el<HTMLInputElement>('ghtoken').value = ''; message.textContent = data.keyCheck === 'accepted' ? 'GitHub accepted the token; it is saved on the local server.' : data.keyCheck === 'removed' ? 'GitHub token removed.' : 'Token saved, but GitHub could not be reached to check it.'; await checkConnection();
    } catch (error) { message.textContent = (error as Error).name === 'TypeError' ? 'The local server is not running, so the token was not saved.' : String((error as Error).message); }
  });
  el<HTMLButtonElement>('orsave').addEventListener('click', async () => {
    try {
      const stored = await chrome.storage.local.get('token');
      const response = await fetch('http://127.0.0.1:4318/settings', { method: 'POST', headers: { 'content-type': 'application/json', 'x-local-token': stored.token || '' }, body: JSON.stringify({ openrouterKey: el<HTMLInputElement>('orkey').value.trim() }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'The key could not be saved.');
      el<HTMLInputElement>('orkey').value = ''; message.textContent = data.keyCheck === 'accepted' ? 'OpenRouter accepted the key; it is saved on the local server.' : data.keyCheck === 'removed' ? 'OpenRouter key removed.' : 'Key saved, but OpenRouter could not be reached to check it. Lookups will report if it is rejected.'; await checkConnection();
    } catch (error) { message.textContent = (error as Error).name === 'TypeError' ? 'The local server is not running, so the key was not saved.' : String((error as Error).message); }
  });
  el<HTMLButtonElement>('judgetest').addEventListener('click', async () => {
    message.textContent = 'Asking the decision model about a made-up example…';
    try {
      const data = await api('/judge-test', 'POST');
      const pct = (value: unknown) => typeof value === 'number' ? `${Math.round(value * 100)}%` : value === 'refused' ? 'declined' : 'no answer';
      message.textContent = `${data.model} answered. Made-up profile that lists its own PayPal.Me: relevant ${pct(data.answers.relevance)}, linked to the profile ${pct(data.answers.identity_link)}, contradiction ${pct(data.answers.contradiction)}. Lookups will now be judged.`;
    } catch (error) { message.textContent = (error as Error).name === 'TypeError' ? 'The local server is not running.' : String((error as Error).message); }
  });
  el<HTMLButtonElement>('clear').addEventListener('click', async () => { try { await api('/cache', 'DELETE'); message.textContent = 'Research cache cleared.'; } catch (error) { message.textContent = String((error as Error).message); } });
  el<HTMLButtonElement>('enable').addEventListener('click', async () => {
    try {
      const tab = await currentTab(); const page = new URL(tab?.url || '');
      if (!['https:', 'http:'].includes(page.protocol) || !tab?.id) throw new Error('Open an ordinary website first.');
      const origin = `${page.protocol}//${page.host}/*`;
      if (!await chrome.permissions.request({ origins: [origin] })) throw new Error('Site permission was not granted.');
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['dist/content.js'] });
      message.textContent = 'Icons enabled for attributable author links on this page. Re-enable after navigating.';
    } catch (error) { message.textContent = String((error as Error).message || 'Unable to enable this site.'); }
  });
  const sandboxButton = el<HTMLButtonElement>('sandbox');
  sandboxButton.addEventListener('click', async () => {
    if (!confirm('Open an isolated $1.00 USD PayPal sandbox checkout? This uses a sandbox buyer and merchant, not a discovered creator. No real money.')) return;
    sandboxButton.disabled = true;
    try {
      const result = await api('/sandbox/order', 'POST'); const approval = new URL(result.approvalUrl);
      if (approval.protocol !== 'https:' || approval.hostname !== 'www.sandbox.paypal.com' || approval.username || approval.password || approval.port) throw new Error('Unexpected sandbox approval URL.');
      await chrome.tabs.create({ url: approval.href }); message.textContent = 'Sandbox approval opened in a new tab.';
    } catch (error) { message.textContent = String((error as Error).message || 'Sandbox unavailable.'); }
    finally { sandboxButton.disabled = false; }
  });
})();
