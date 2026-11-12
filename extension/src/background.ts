(() => {
  if (chrome.storage.local.setAccessLevel) chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => console.warn('Could not restrict extension storage to trusted contexts.'));
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({ id: 'universal-tip', title: 'Research this creator with Universal Tip', contexts: ['link', 'selection', 'page'] });
  });
  function open(url: string, xPage?: unknown) {
    try {
      if (typeof url !== 'string' || url.length > 8192) return;
      const parsed = new URL(url); if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return;
      if (parsed.hostname === 'github.com' && /^\/[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?\/[\w.-]+/i.test(parsed.pathname) && !/^\/(?:orgs|settings|sponsors|marketplace|features|topics|collections|search|notifications|issues|pulls|explore|login|apps|enterprise|about)\//i.test(parsed.pathname)) parsed.pathname = `/${parsed.pathname.split('/')[1]}`; // a repository link means its owner
      parsed.search = ''; parsed.hash = ''; if (parsed.href.length > 2048) return;
      const extra = xPage && typeof xPage === 'object' ? JSON.stringify(xPage) : '';
      const panelUrl = chrome.runtime.getURL(`panel.html?url=${encodeURIComponent(parsed.href)}${extra && extra.length < 3000 ? `&xp=${encodeURIComponent(extra)}` : ''}`);
      chrome.windows.create({ url: panelUrl, type: 'popup', width: 480, height: 760 }).catch(() => chrome.tabs.create({ url: panelUrl }));
    } catch { /* Invalid selection; use the popup paste fallback. */ }
  }
  chrome.contextMenus.onClicked.addListener(async (info: any, tab: any) => {
    const rawSelection = typeof info.selectionText === 'string' ? info.selectionText : '';
    if (rawSelection.length > 8192) return;
    const selection = rawSelection.trim().replace(/^@/, '');
    if (info.linkUrl) {
      // On X, Reddit and Facebook, ask the page's own script for the bio it can already see; those sites refuse outside lookups.
      let page: unknown;
      try { if (tab?.id && /^https:\/\/(?:[\w-]+\.)?(?:x\.com|twitter\.com|reddit\.com|facebook\.com|youtube\.com|github\.com|stackoverflow\.com)\//.test(info.pageUrl || '')) page = await chrome.tabs.sendMessage(tab.id, { type: 'read-profile', url: info.linkUrl }); } catch { /* Research the link alone. */ }
      return open(info.linkUrl, page || undefined);
    }
    if (/^https:\/\//i.test(selection)) return open(selection);
    try {
      const page = new URL(info.pageUrl || '');
      if (page.hostname === 'github.com' && /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(selection)) return open(`https://github.com/${selection}`);
      if (/(^|\.)reddit\.com$/.test(page.hostname) && /^[a-z\d_-]{3,20}$/i.test(selection)) return open(`https://www.reddit.com/user/${selection}/`);
      if (/^(?:x|twitter)\.com$/.test(page.hostname.replace(/^(?:www|mobile)\./, '')) && /^\w{1,15}$/.test(selection)) return open(`https://x.com/${selection}`);
    } catch { /* A page URL is required for username interpretation. */ }
    if (!selection) open(info.pageUrl || '');
  });
  // Content scripts ask whether a site's API allowance is currently used up (the local server knows); only then do they
  // load a profile page in the browser as a fallback. Remembered briefly so a burst of clicks asks once.
  let limits: { at: number; value: Record<string, boolean> } = { at: 0, value: {} };
  chrome.runtime.onMessage.addListener((message: any, sender: any, respond: (value: unknown) => void) => {
    if (message?.type !== 'limits' || sender.id !== chrome.runtime.id) return;
    if (Date.now() - limits.at < 5000) { respond(limits.value); return; }
    (async () => {
      try {
        const stored = await chrome.storage.local.get('token');
        const response = await fetch('http://127.0.0.1:4318/status?limits=1', { headers: { 'x-local-token': stored.token || '' }, signal: AbortSignal.timeout(2200) });
        const data = response.ok ? await response.json() : null;
        limits = { at: Date.now(), value: { github: Boolean(data?.limited?.github), stackoverflow: Boolean(data?.limited?.stackoverflow) } };
      } catch { limits = { at: Date.now(), value: {} }; }
      respond(limits.value);
    })();
    return true;
  });
  chrome.runtime.onMessage.addListener((message: any, sender: any) => {
    if (message?.type === 'open-result' && sender.id === chrome.runtime.id && sender.tab && typeof message.url === 'string') open(message.url, message.xPage);
  });
})();
