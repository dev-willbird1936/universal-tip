(() => {
  if ((globalThis as any).__universalTipActive) return;
  (globalThis as any).__universalTipActive = true;
  // X and Facebook rebuild their pages constantly, so nothing is inserted into them: one floating
  // button follows the pointer to whichever profile link is hovered or focused.
  const siteHost = location.hostname.toLowerCase().replace(/^www\./, '');
  const hoverSite = siteHost === 'x.com' || /(^|\.)twitter\.com$/.test(siteHost) ? 'x' : /(^|\.)facebook\.com$/.test(siteHost) ? 'facebook' : siteHost === 'youtube.com' || siteHost === 'm.youtube.com' ? 'youtube' : '';
  if (hoverSite) {
    const xReserved = /^(?:home|explore|notifications|messages|settings|search|compose|login|signup|logout|hashtag|intent|share|jobs|premium|privacy|about|download|account|communities|lists|bookmarks|i|tos)$/i;
    const fbReserved = /^(?:watch|marketplace|groups|gaming|events|pages|friends|messages|notifications|settings|login|stories|photo|photos|videos|bookmarks|memories|saved|business|policies|privacy|hashtag|profile\.php|people|public|search|recover|share|sharer|dialog|plugins|reels|reel|fundraisers|help|me|ads|games|live|notes|permalink\.php|story\.php|l\.php)$/i;
    const profileOf = (el: Element): string | null => {
      if (!(el instanceof HTMLAnchorElement) || el.href.length > 8192 || el.closest('nav, [role="navigation"], [role="banner"]')) return null;
      let url: URL; try { url = new URL(el.href, location.href); } catch { return null; }
      if (url.protocol !== 'https:' || url.username || url.password) return null;
      const linkHost = url.hostname.toLowerCase().replace(/^(?:www|m|web|mobile)\./, ''); const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length !== 1) return null;
      if (hoverSite === 'x') return (linkHost === 'x.com' || linkHost === 'twitter.com') && /^[a-z\d_]{1,15}$/i.test(parts[0]) && !xReserved.test(parts[0]) ? `https://x.com/${parts[0]}` : null;
      if (hoverSite === 'youtube') return linkHost === 'youtube.com' && /^@[a-z\d._-]{3,30}$/i.test(parts[0]) && el.textContent?.trim() ? `https://www.youtube.com/${parts[0]}` : null;
      return linkHost === 'facebook.com' && /^[a-z\d.]{5,50}$/i.test(parts[0]) && !fbReserved.test(parts[0]) && el.textContent?.trim() ? `https://www.facebook.com/${parts[0]}` : null;
    };
    const tip = document.createElement('span'); tip.dataset.universalTip = 'true';
    tip.style.cssText = 'position:fixed;z-index:2147483647;display:none;left:0;top:0';
    const root = tip.attachShadow({ mode: 'closed' }); const style = document.createElement('style');
    style.textContent = 'button{border:1px solid #006b6d;border-radius:999px;height:24px;padding:0 9px;background:#fff;color:#006b6d;font:700 12px system-ui;cursor:pointer;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.25)}button:hover{background:#dff5f2}button:focus-visible{outline:3px solid #006b6d;outline-offset:2px}';
    const button = document.createElement('button'); button.type = 'button'; button.textContent = '↗ Tip'; root.append(style, button);
    let current = ''; let hideTimer = 0;
    const hide = () => { tip.style.display = 'none'; current = ''; };
    const cancelHide = () => { clearTimeout(hideTimer); hideTimer = 0; };
    const scheduleHide = () => { if (hideTimer) return; hideTimer = setTimeout(() => { hideTimer = 0; hide(); }, 700); };
    const showFor = (event: Event) => {
      // Some pages (Facebook's signed-out wall, X overlays) cover links with another layer, so also look beneath the pointer.
      const under = event instanceof MouseEvent ? document.elementsFromPoint(event.clientX, event.clientY).slice(0, 8).map(el => el.closest('a') || el) : [];
      for (const node of [...event.composedPath().slice(0, 8), ...under]) {
        if (node === tip) { cancelHide(); return; }
        const url = node instanceof Element ? profileOf(node) : null; if (!url) continue;
        const rect = (node as Element).getBoundingClientRect(); if (!rect.width || !rect.height) return;
        cancelHide(); current = url; button.setAttribute('aria-label', `Find how to tip ${new URL(url).pathname.slice(1)}`); button.title = 'Find how to support this person';
        if (!tip.isConnected) document.documentElement.append(tip);
        tip.style.display = 'block';
        tip.style.left = `${Math.max(4, Math.min(window.innerWidth - 70, rect.right + 4))}px`; tip.style.top = `${Math.max(4, Math.min(window.innerHeight - 28, rect.top + rect.height / 2 - 12))}px`;
        return;
      }
      if (current) scheduleHide();
    };
    document.addEventListener('mouseover', showFor, true); document.addEventListener('focusin', showFor, true);
    let lastMove = 0; document.addEventListener('mousemove', event => { if (Date.now() - lastMove > 80) { lastMove = Date.now(); showFor(event); } }, true);
    document.addEventListener('scroll', () => { if (current) hide(); }, true);
    tip.addEventListener('mouseenter', () => cancelHide()); tip.addEventListener('mouseleave', scheduleHide);
    button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); if (event.isTrusted && current) {
      const url = current; const page = pageProfile(url) || seen.get(url); hide();
      if (hoverSite === 'youtube') youtubePage(url).catch(() => undefined).then(xPage => chrome.runtime.sendMessage({ type: 'open-result', url, xPage }));
      else chrome.runtime.sendMessage({ type: 'open-result', url, xPage: page });
    } });
    // YouTube answers outside requests with a cookie-consent page, so read the channel's own metadata block (title, description,
    // handle) from one ordinary same-site page load made only after the click. Video and sponsor links elsewhere on the page are ignored.
    async function youtubePage(url: string) {
      const handle = /^\/@([a-z\d._-]{3,30})\/?$/i.exec(new URL(url).pathname)?.[1]; if (hoverSite !== 'youtube' || !handle) return undefined;
      const response = await fetch(`/@${encodeURIComponent(handle)}`, { credentials: 'same-origin', signal: AbortSignal.timeout(10000) });
      const html = response.ok ? await response.text() : ''; if (!html || html.length > 8000000) return undefined;
      const at = html.indexOf('"channelMetadataRenderer":{'); if (at < 0) return undefined;
      const block = html.slice(at, at + 20000);
      const field = (name: string) => { const match = new RegExp(`"${name}":("(?:[^"\\\\]|\\\\.)*")`).exec(block); try { return match ? String(JSON.parse(match[1])) : ''; } catch { return ''; } };
      // The page must be this channel (YouTube can redirect a handle elsewhere).
      if (!field('vanityChannelUrl').toLowerCase().endsWith(`/@${handle.toLowerCase()}`)) return undefined;
      const description = field('description').slice(0, 1000);
      // The channel header's own link is tagged event=channel_header (video-description and sponsor links carry other events).
      const header = Array.from(html.matchAll(/redirect\?event=channel_header[^"]{0,600}?(?:\\u0026|&)q=([^"\\&]{1,600})/g), match => { try { return decodeURIComponent(match[1]); } catch { return ''; } });
      const links = [...new Set([...header, ...(description.match(/https?:\/\/[^\s<>"')]+/g) || [])].map(link => link.replace(/^http:\/\//i, 'https://')))].filter(link => !/^https?:\/\/(?:[\w-]+\.)*(?:youtube\.com|youtu\.be)\//i.test(link) && link.length <= 300).slice(0, 8);
      return { screen_name: handle, name: field('title').slice(0, 120), description, links };
    }
    (globalThis as any).chrome?.runtime?.onMessage?.addListener((message: any, sender: any, respond: (value: unknown) => void) => {
      if (sender.id !== chrome.runtime.id) return;
      if (message?.type === 'read-post-author' && hoverSite === 'x') {
        // Prefer the handle in /user/status/id (covers replies). Fall back to the first User-Name in the main article.
        const fromUrl = location.pathname.match(/^\/([A-Za-z\d_]{1,15})\/status\/\d+/);
        if (fromUrl && !/status|photo|analytics/i.test(fromUrl[1])) { respond(`https://x.com/${fromUrl[1]}`); return; }
        const named = document.querySelector('article [data-testid="User-Name"] a[href]');
        let author = '';
        try {
          const next = named ? new URL((named as HTMLAnchorElement).href, location.href) : null;
          const parts = next ? next.pathname.split('/').filter(Boolean) : [];
          if (parts.length === 1 && /^[A-Za-z\d_]{1,15}$/.test(parts[0])) author = `https://x.com/${parts[0]}`;
        } catch { /* Leave author empty. */ }
        respond(author || null); return;
      }
      if (message?.type === 'read-post-author' && hoverSite === 'youtube') {
        // A video page: the channel that published it (not commenters or recommended videos).
        // The avatar link comes first but has no text, so take the first owner link that names the channel, then the page's author metadata.
        const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('ytd-watch-metadata ytd-video-owner-renderer a[href*="/@"], #owner ytd-channel-name a[href*="/@"]'));
        const meta = document.querySelector('span[itemprop="author"] link[itemprop="url"]')?.getAttribute('href') || '';
        const fromMeta = /^https?:\/\/www\.youtube\.com\/(@[a-z\d._-]{3,30})$/i.exec(meta)?.[1];
        respond(links.map(link => profileOf(link)).find(Boolean) || (fromMeta ? `https://www.youtube.com/${fromMeta}` : null)); return;
      }
      if (message?.type !== 'read-profile') return;
      const handle = location.pathname.split('/').filter(Boolean); const asked = typeof message.url === 'string' ? profileOf(Object.assign(document.createElement('a'), { href: message.url, textContent: 'x' })) : null;
      if (hoverSite === 'youtube') {
        const channel = asked || (handle.length >= 1 && /^@[a-z\d._-]{3,30}$/i.test(handle[0]) ? `https://www.youtube.com/${handle[0]}` : null);
        if (!channel) { respond(null); return; }
        youtubePage(channel).then(value => respond(value || null), () => respond(null)); return true;
      }
      // A right-clicked link names a specific person: answer only if this page is theirs (pageProfile checks), never with the page owner's bio.
      respond(hoverSite === 'facebook' ? (typeof message.url === 'string' ? (asked ? pageProfile(asked) || null : null) : handle.length === 1 ? pageProfile(`https://www.facebook.com/${handle[0]}`) || null : null) : hoverSite !== 'x' ? null : asked ? pageProfile(asked) || seen.get(asked) || null : handle.length === 1 ? pageProfile(`https://x.com/${handle[0]}`) || null : null);
    });
    // X's preview card can close as the pointer travels to the button, so remember what it showed.
    const seen = new Map<string, unknown>();
    document.addEventListener('mouseover', () => { if (!current) return; const profile = pageProfile(current); if (profile) { if (seen.size > 50) seen.clear(); seen.set(current, profile); } }, true);
    // On that person's own X profile page the bio and links are already on screen, so no extra request to X is needed.
    function pageProfile(url: string) {
      const handle = new URL(url).pathname.slice(1);
      if (hoverSite === 'facebook') {
        // On that person's own Facebook profile (visible when signed in), collect the outside links the page shows.
        if (location.pathname.split('/')[1]?.toLowerCase() !== handle.toLowerCase()) return undefined;
        const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('[role="main"] a[href]')).map(a => { try { const url = new URL(a.href); const out = /(^|\.)facebook\.com$/.test(url.hostname) && url.pathname === '/l.php' ? url.searchParams.get('u') || '' : a.href; return /^https:\/\//.test(out) && !/^https:\/\/(?:[\w-]+\.)*(?:facebook\.com|fb\.com|fbcdn\.net|instagram\.com|meta\.com)\//i.test(out) ? out.split('?')[0].slice(0, 300) : ''; } catch { return ''; } }).filter(Boolean);
        return { screen_name: handle, description: (document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content || '').slice(0, 600), links: [...new Set(links)].slice(0, 8) };
      }
      if (hoverSite !== 'x') return undefined;
      if (location.pathname.split('/')[1]?.toLowerCase() !== handle.toLowerCase()) {
        // In feeds, X's own hover card for this person shows their bio; read it while it is on screen.
        const card = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="HoverCard"]')).find(item => Array.from(item.querySelectorAll('a')).some(a => (a.getAttribute('href') || '').toLowerCase() === `/${handle.toLowerCase()}`));
        if (!card) return undefined;
        const lines = card.innerText.split('\n').map(line => line.trim()).filter(Boolean); const at = lines.findIndex(line => line.toLowerCase() === `@${handle.toLowerCase()}`); const end = lines.findIndex((line, index) => index > at && /^[\d.,]+[KMB]?\s+Following$/i.test(line));
        if (at < 1) return undefined;
        const description = lines.slice(at + 1, end > at ? end : at + 4).join(' ').slice(0, 600);
        const links = (description.match(/(?:https?:\/\/)?[\w-]+(?:\.[\w-]+)+\/[\w$./-]+/g) || []).slice(0, 8).map(text => `https://${text.replace(/^https?:\/\//i, '')}`);
        return { screen_name: handle, name: lines[at - 1].slice(0, 120), description, links };
      }
      const bio = document.querySelector<HTMLElement>('[data-testid="UserDescription"]'); const site = document.querySelector<HTMLElement>('[data-testid="UserUrl"]');
      const links = [...(bio ? Array.from(bio.querySelectorAll('a')) : []), ...(site ? [site] : [])].map(a => (a.textContent || '').trim().replace(/…$/, '').replace(/^https?:\/\//i, '')).filter(text => /^[\w-]+(?:\.[\w-]+)+(?:\/[\w$./-]*)?$/.test(text)).slice(0, 8).map(text => `https://${text}`);
      return { screen_name: handle, name: (document.querySelector<HTMLElement>('[data-testid="UserName"]')?.innerText || '').split('\n')[0].slice(0, 120), description: (bio?.innerText || '').slice(0, 600), links };
    }
    return;
  }
  type Scope = Document | ShadowRoot | Element;
  const seen = new WeakSet<Element>(); const observed = new WeakSet<Node>(); const hosts = new Map<HTMLElement, HTMLElement>(); const buttons = new WeakMap<HTMLElement, HTMLButtonElement>(); const shadowRoots = new Set<ShadowRoot>();
  const pending = new Set<Scope>([document]); let scheduled = false; let dirty = false;
  let lastUrl = ''; let lastOpen = 0;
  function open(url: string) {
    if (lastUrl === url && Date.now() - lastOpen < 800) return;
    lastUrl = url; lastOpen = Date.now();
    (github ? githubPage(url) : stack ? stackPage(url) : redditPage(url)).catch(() => undefined).then(xPage => chrome.runtime.sendMessage({ type: 'open-result', url, xPage }));
  }
  // GitHub's API allows few lookups an hour without a token. As a fallback for the server, read what the person's profile page
  // shows (name, bio, website and social links, pinned repositories): the page on screen, or one ordinary page load after the click.
  // Stack Overflow's public API has a daily allowance. As the server's fallback, read the person's profile page: its "about me"
  // text and links, and the website they marked as their own. The page's search box ("user:<id>") confirms whose page it is.
  // Loading someone's profile page in the background is itself a request to the site, so it is done only while the local
  // server reports that site's API allowance as used up. Reading the page already on screen costs nothing and is always allowed.
  const limitedNow = (site: 'github' | 'stackoverflow') => new Promise<boolean>(resolve => {
    const timer = setTimeout(() => resolve(false), 2500);
    try { chrome.runtime.sendMessage({ type: 'limits' }, (reply: any) => { void chrome.runtime.lastError; clearTimeout(timer); resolve(Boolean(reply?.[site])); }); } catch { clearTimeout(timer); resolve(false); }
  });
  async function stackPage(url: string) {
    const id = /^\/users\/(\d{1,10})\/?$/.exec(new URL(url).pathname)?.[1];
    if (location.hostname !== 'stackoverflow.com' || !id) return undefined;
    const scopedId = (doc: Document) => /^user:(\d{1,10})$/.exec(doc.querySelector('input[name="q"]')?.getAttribute('value') || '')?.[1];
    let page: Document = document;
    if (!location.pathname.startsWith('/users/') || scopedId(document) !== id) {
      if (!await limitedNow('stackoverflow')) return undefined;
      const response = await fetch(`/users/${id}`, { credentials: 'same-origin', signal: AbortSignal.timeout(5000) });
      const html = response.ok ? await response.text() : ''; if (!html || html.length > 3000000) return undefined;
      page = new DOMParser().parseFromString(html, 'text/html');
    }
    if (scopedId(page) !== id) return undefined;
    const outside = (href: string) => /^https?:\/\//i.test(href) && href.length <= 300 && !/^https?:\/\/(?:[\w-]+\.)*(?:stackoverflow\.com|stackexchange\.com|stackapps\.com|askubuntu\.com|superuser\.com|serverfault\.com)\//i.test(href);
    const about = page.querySelector('.js-about-me-content');
    const website = Array.from(page.querySelectorAll('a[rel~="me"][href]')).map(a => (a.getAttribute('href') || '').replace(/^http:\/\//i, 'https://')).find(outside) || '';
    const links = Array.from(about?.querySelectorAll('a[href]') || []).map(a => (a.getAttribute('href') || '').replace(/^http:\/\//i, 'https://')).filter(outside).filter((link, index, all) => all.indexOf(link) === index).slice(0, 8);
    return { screen_name: id, name: (page.querySelector('.fs-headline2')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120), description: (about?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 600), links, website };
  }
  async function githubPage(url: string) {
    const login = /^\/([a-z\d](?:[a-z\d-]{0,37}[a-z\d])?)\/?$/i.exec(new URL(url).pathname)?.[1];
    if (location.hostname !== 'github.com' || !login) return undefined;
    const here = location.pathname.split('/').filter(Boolean); let page: Document = document;
    if (here.length !== 1 || here[0].toLowerCase() !== login.toLowerCase() || location.search.includes('tab=')) {
      if (!await limitedNow('github')) return undefined;
      const response = await fetch(`/${encodeURIComponent(login)}`, { credentials: 'same-origin', signal: AbortSignal.timeout(5000) });
      const html = response.ok ? await response.text() : ''; if (!html || html.length > 3000000) return undefined;
      page = new DOMParser().parseFromString(html, 'text/html');
    }
    const text = (selector: string) => (page.querySelector(selector)?.textContent || '').replace(/\s+/g, ' ').trim();
    // Only a personal profile page for this exact account counts (organization pages are laid out differently).
    if (text('.vcard-names .vcard-username').split(' ')[0].toLowerCase() !== login.toLowerCase()) return undefined;
    const links = Array.from(page.querySelectorAll('.vcard-details [itemprop="url"] a[href], .vcard-details [itemprop="social"] a[href]')).map(a => a.getAttribute('href') || '')
      .filter(href => /^https?:\/\//i.test(href) && href.length <= 300).map(href => href.replace(/^http:\/\//i, 'https://')).slice(0, 8);
    const repos = Array.from(page.querySelectorAll('.pinned-item-list-item a[href]')).map(a => (a.getAttribute('href') || '').split('/').filter(Boolean))
      .filter(parts => parts.length === 2 && parts[0].toLowerCase() === login.toLowerCase()).map(parts => parts[1]).filter((name, index, all) => all.indexOf(name) === index).slice(0, 3);
    return { screen_name: login, name: text('.vcard-fullname').slice(0, 120), description: (page.querySelector('.user-profile-bio')?.getAttribute('data-bio-text') || text('.user-profile-bio')).slice(0, 600), links, repos };
  }
  // Reddit refuses lookups from outside, so read the description and links from the profile page itself: the one on
  // screen, or, from a comment or post, one ordinary same-site page load made only after the click.
  async function redditPage(url: string) {
    const name = /\/(?:user|u)\/([\w-]{3,20})\/?$/i.exec(new URL(url).pathname)?.[1]; const here = /^\/(?:user|u)\/([\w-]{3,20})(?:\/|$)/i.exec(location.pathname)?.[1];
    if (!/(^|\.)reddit\.com$/.test(location.hostname) || !name) return undefined;
    let page: Document = document;
    if (!here || name.toLowerCase() !== here.toLowerCase()) {
      const response = await fetch(`/user/${encodeURIComponent(name)}/`, { credentials: 'same-origin', signal: AbortSignal.timeout(8000) });
      const html = response.ok ? await response.text() : ''; if (!html || html.length > 3000000) return undefined;
      page = new DOMParser().parseFromString(html, 'text/html');
    }
    const details = page.querySelector('[data-testid="profile-details-content-wrapper"]'); if (!details) return undefined;
    // Reddit lists a profile's social links in their own block, outside the details block, so read both.
    const links = Array.from(new Set([...Array.from(details.querySelectorAll('a[href^="https://"]')), ...Array.from(page.querySelectorAll('faceplate-tracker[noun="social_link"] a[href^="https://"]'))].map(a => a.getAttribute('href') || '').filter(href => !/^https:\/\/(?:[\w-]+\.)*(?:reddit\.com|redd\.it|reddithelp\.com|redditinc\.com)\//i.test(href) && href.length <= 300))).slice(0, 8);
    return { screen_name: name, description: (page.querySelector('[data-testid="profile-description"]')?.textContent || '').trim().slice(0, 600), links };
  }
  (globalThis as any).chrome?.runtime?.onMessage?.addListener((message: any, sender: any, respond: (value: unknown) => void) => {
    if (message?.type !== 'read-profile' || sender.id !== chrome.runtime.id) return;
    if (github) {
      const owner = (typeof message.url === 'string' ? new URL(message.url, location.href).pathname : location.pathname).split('/').filter(Boolean)[0];
      if (!owner) { respond(null); return; }
      githubPage(`https://github.com/${owner}`).then(value => respond(value || null), () => respond(null)); return true;
    }
    if (stack) {
      const id = /^\/users\/(\d{1,10})(?:\/|$)/.exec(typeof message.url === 'string' ? new URL(message.url, location.href).pathname : '')?.[1];
      if (!id) { respond(null); return; }
      stackPage(`https://stackoverflow.com/users/${id}`).then(value => respond(value || null), () => respond(null)); return true;
    }
    const here = /^\/(?:user|u)\/([\w-]{3,20})(?:\/|$)/i.exec(typeof message.url === 'string' ? new URL(message.url, location.href).pathname : location.pathname)?.[1];
    if (!here) { respond(null); return; }
    redditPage(`https://www.reddit.com/user/${here}/`).then(value => respond(value || null), () => respond(null)); return true;
  });
  const observer = new MutationObserver(records => {
    let overflow = false;
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof Element) pending.add(record.target);
      if (record.type === 'characterData' && record.target.parentElement) pending.add(record.target.parentElement);
      for (const node of record.addedNodes) {
        if (node instanceof Element) pending.add(node);
        else if (node.nodeType === Node.TEXT_NODE && record.target instanceof Element) pending.add(record.target);
        if (pending.size > 1000) { overflow = true; break; }
      }
      if (overflow || pending.size > 1000) { overflow = true; break; }
    }
    if (overflow) { pending.clear(); pending.add(document); }
    // Frameworks may replace a hovered author and our adjacent icon before the click.
    // Restore removed icons in the mutation microtask; other feed changes stay throttled.
    if ([...hosts.keys()].some(host => !host.isConnected)) { scan(); return; }
    if (!scheduled) { scheduled = true; setTimeout(scan, 400); }
  });
  function observe(root: Node) { if (!observed.has(root)) { observed.add(root); observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'data-hovercard-url', 'data-hovercard-type', 'rel', 'itemprop'] }); } }
  const MAX_ICONS = 120;
  const github = location.hostname === 'github.com' || location.hostname === 'gist.github.com';
  const reddit = /(^|\.)reddit\.com$/.test(location.hostname);
  const stack = location.hostname === 'stackoverflow.com';
  const selector = github ? 'a[data-hovercard-type="user"], button[data-hovercard-type="user"][data-hovercard-url], a.author, a[rel~="author"], [itemprop="author"] a[href], a[data-component="Breadcrumbs.Item"], .vcard-names .vcard-username, main a[class*="prc-Link-Link"], main a.Truncate-text' : reddit ? 'a[href*="/user/"],a[href*="/u/"]' : stack ? '.user-details a[href*="/users/"], a.comment-user[href*="/users/"], .s-user-card--link a[href*="/users/"], .s-user-card--time a[href*="/users/"], div.fs-headline2' : 'a[rel~="author"], [itemprop="author"] a[href], a[itemprop="author"][href]';
  function target(anchor: HTMLElement): string | null {
    let url: URL;
    try {
      if (anchor instanceof HTMLAnchorElement) { if (anchor.href.length > 8192) return null; url = new URL(anchor.href, location.href);
        // A commit list names each author with a link to "commits by this person", not to their profile. GitHub still marks
        // the link as a user and gives the account in its hovercard address.
        const card = github && anchor.getAttribute('data-hovercard-type') === 'user' && !/^\/[^/]+\/?$/.test(url.pathname) ? /^\/users\/([a-z\d](?:[a-z\d-]{0,37}[a-z\d])?)\/hovercard$/i.exec(anchor.getAttribute('data-hovercard-url') || '') : null;
        if (card) url = new URL(`https://github.com/${card[1]}`);
        // A plain link carries no user marker. It counts only on a repository's contributors page, and only when its text
        // is the account name its address points to.
        if (github && anchor.matches('main a[class*="prc-Link-Link"], main a.Truncate-text') && !anchor.matches('a[data-hovercard-type="user"], a[data-component="Breadcrumbs.Item"], a.author, a[rel~="author"]')
          && !(/\/(?:graphs\/contributors|discussions)\/?$/.test(location.pathname) && url.pathname.slice(1).replace(/\/$/, '').toLowerCase() === (anchor.textContent || '').trim().toLowerCase())) return null;
      }
      else if (github && anchor.matches('.vcard-username')) {
        // The username under the avatar on a GitHub profile page: plain text, valid only for the profile being viewed.
        const name = (anchor.textContent || '').trim().split(/\s/)[0];
        if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(name) || location.pathname.split('/')[1]?.toLowerCase() !== name.toLowerCase()) return null;
        url = new URL(`https://github.com/${name}`);
      } else if (stack && anchor.matches('div.fs-headline2')) {
        // The name heading on a Stack Overflow profile page: plain text, valid only for the profile being viewed.
        const id = /^\/users\/(\d{1,10})(?:\/|$)/.exec(location.pathname)?.[1];
        if (!id || anchor.children.length || document.querySelector('div.fs-headline2') !== anchor) return null;
        url = new URL(`https://stackoverflow.com/users/${id}`);
      } else {
        const hovercard = anchor.getAttribute('data-hovercard-url') || '';
        const match = hovercard.match(/^\/users\/([a-z\d](?:[a-z\d-]{0,37}[a-z\d])?)\/hovercard$/i);
        if (!github || !match) return null;
        url = new URL(`https://github.com/${match[1]}`);
      }
    } catch { return null; }
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (github) {
      if (url.hostname === 'gist.github.com') url.hostname = 'github.com'; // a gist author link names the same GitHub account
      if (url.hostname !== 'github.com' || !/^\/[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?\/?$/i.test(url.pathname)) return null;
      if (/^\/(?:login|signup|features|marketplace|explore|topics|trending|sponsors|settings|notifications|issues|pulls|search|orgs|new)\/?$/i.test(url.pathname)) return null;
    } else if (reddit) {
      if (!/(^|\.)reddit\.com$/.test(url.hostname) || !/^\/(?:user|u)\/[a-z\d_-]{3,20}\/?$/i.test(url.pathname)) return null;
    } else if (stack) {
      // Name links carry the stable numeric ID (data-user-id); comment links use /users/<id>/<name>.
      const id = anchor.getAttribute('data-user-id') || /^\/users\/(\d{1,10})(?:\/|$)/.exec(url.pathname)?.[1] || '';
      if (url.hostname !== 'stackoverflow.com' || !url.pathname.startsWith('/users/') || !/^\d{1,10}$/.test(id)) return null;
      url = new URL(`https://stackoverflow.com/users/${id}`);
    }
    if (!anchor.textContent?.trim() || anchor.closest('[data-universal-tip]')) return null;
    url.search = ''; url.hash = ''; return url.href.length <= 2048 ? url.href : null;
  }
  function scan() {
    scheduled = false;
    for (const [host, author] of hosts) {
      const url = author.isConnected && author.matches(selector) ? target(author) : null;
      if (!host.isConnected || !url || host.previousElementSibling !== author) {
        if (host.isConnected) host.remove();
        hosts.delete(host); seen.delete(author);
        if (author.isConnected) { author.removeAttribute('data-universal-tip-processed'); pending.add(author); }
        continue;
      }
      buttons.get(host)?.setAttribute('aria-label', `Research support links for ${github ? new URL(url).pathname.slice(1) : author.textContent!.trim().slice(0, 80)}`);
    }
    for (const root of shadowRoots) if (!root.host.isConnected) shadowRoots.delete(root);
    if (hosts.size >= MAX_ICONS) { dirty = true; pending.clear(); return; }
    if (dirty) { pending.add(document); dirty = false; }
    const roots = [...pending]; pending.clear();
    for (let i = 0; i < roots.length; i++) {
      const root = roots[i]; if (root !== document && !root.isConnected) continue;
      if (reddit && shadowRoots.size < 40) {
        const addShadow = (element: Element) => { if (element.shadowRoot && !shadowRoots.has(element.shadowRoot) && shadowRoots.size < 40) { roots.push(element.shadowRoot); observe(element.shadowRoot); shadowRoots.add(element.shadowRoot); } };
        if (root instanceof Element) addShadow(root);
        for (const element of root.querySelectorAll('*')) { if (shadowRoots.size >= 40) break; addShadow(element); }
      }
      const anchors: HTMLElement[] = [];
      if (root instanceof HTMLElement && root.matches(selector)) anchors.push(root);
      for (const anchor of root.querySelectorAll<HTMLElement>(selector)) anchors.push(anchor);
      for (const node of anchors) {
      if (hosts.size >= MAX_ICONS) { dirty = true; break; }
      if (seen.has(node) || node.hasAttribute('data-universal-tip-processed')) continue;
      const url = target(node); if (!url) continue;
      seen.add(node); node.setAttribute('data-universal-tip-processed', '');
      const host = document.createElement('span'); host.dataset.universalTip = 'true';
      const shadow = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = ':host{display:inline-block;vertical-align:middle;margin-inline:3px;opacity:.35;transition:opacity .12s}:host(:hover),:host(:focus-within),:host([data-near]){opacity:1}button{border:1px solid #006b6d;border-radius:50%;width:24px;height:24px;padding:0;background:#fff;color:#006b6d;font:700 13px system-ui;cursor:pointer;line-height:22px}button:hover{background:#dff5f2}button:focus-visible{outline:3px solid #006b6d;outline-offset:2px}';
      const button = document.createElement('button'); button.type = 'button'; button.textContent = '↗'; button.title = 'Research creator support links'; button.setAttribute('aria-label', `Research support links for ${github ? new URL(url).pathname.slice(1) : node.textContent.trim().slice(0, 80)}`); buttons.set(host, button);
      const openCurrent = () => { if (!host.isConnected || host.previousElementSibling !== node || !node.matches(selector)) return; const current = target(node); if (current) open(current); };
      const hitMatches = (url: string, x: number, y: number) => {
        const hitHost = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-universal-tip]');
        const author = hitHost?.previousElementSibling;
        return author instanceof HTMLElement && author.matches(selector) && target(author) === url;
      };
      button.addEventListener('pointerdown', event => {
        if (!event.isTrusted || event.button !== 0 || !event.isPrimary || host.previousElementSibling !== node || !node.matches(selector)) return;
        const startUrl = target(node); if (!startUrl || (!host.isConnected && !hitMatches(startUrl, event.clientX, event.clientY))) return;
        event.stopPropagation();
        const x = event.clientX, y = event.clientY, id = event.pointerId; const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        document.addEventListener('pointerup', up => {
          if (up.isTrusted && up.pointerId === id && up.button === 0 && Math.abs(up.clientX - x) <= 12 && Math.abs(up.clientY - y) <= 12) {
            const originalMatches = node.isConnected && node.matches(selector) && target(node) === startUrl;
            if (originalMatches || hitMatches(startUrl, up.clientX, up.clientY)) { up.stopPropagation(); open(startUrl); }
          }
          clearTimeout(timer); controller.abort();
        }, { capture: true, signal: controller.signal });
        document.addEventListener('pointercancel', () => { clearTimeout(timer); controller.abort(); }, { capture: true, signal: controller.signal, once: true });
      });
      button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); if (event.isTrusted && event.detail === 0) openCurrent(); });
      // Stay faint until the pointer is on the name or the icon, so pages are not cluttered.
      node.addEventListener('mouseenter', () => host.setAttribute('data-near', '')); node.addEventListener('mouseleave', () => host.removeAttribute('data-near'));
      shadow.append(style, button); node.insertAdjacentElement('afterend', host); hosts.set(host, node);
      }
    }
  }
  (globalThis as any).chrome?.runtime?.onMessage?.addListener((message: any, sender: any, respond: (value: unknown) => void) => {
    if (message?.type !== 'read-credit' || sender.id !== chrome.runtime.id) return;
    const attr = (name: string) => document.querySelector<HTMLMetaElement>(`meta[name="${name}"], meta[property="${name}"]`)?.content?.trim() || '';
    const handles = [attr('twitter:creator'), attr('twitter:site')].map(value => /^@?([a-z\d_]{1,15})$/i.exec(value)?.[1]).filter((value): value is string => Boolean(value));
    const authors = [...document.querySelectorAll<HTMLAnchorElement>('a[rel~="author"], [itemprop="author"] a[href], a[itemprop="author"][href]')].map(a => a.href);
    const article = attr('article:author');
    const urls = [...handles.map(handle => `https://x.com/${handle}`), ...authors, ...(article.startsWith('https://') ? [article] : [])]
      .flatMap(value => { try { const next = new URL(value, location.href); if (next.protocol !== 'https:' || next.username || next.password) return []; next.search = ''; next.hash = ''; return [next.href]; } catch { return []; } });
    const unique = [...new Set(urls)].slice(0, 3);
    respond(unique.length === 1 ? unique[0] : null);
  });
  (globalThis as any).chrome?.runtime?.onMessage?.addListener((message: any, sender: any, respond: (value: unknown) => void) => {
    if (message?.type === 'read-so-user' && sender.id === chrome.runtime.id && location.hostname === 'stackoverflow.com') {
      // Profile pages (/users/<name>) no longer show the numeric ID in the URL, but the page's own search box is scoped to "user:<id>".
      // On a question page, the asker is the user card marked as the question's owner.
      const scoped = /^user:(\d{1,10})$/.exec(document.querySelector<HTMLInputElement>('input[name="q"]')?.value || '')?.[1];
      const asker = document.querySelector('#question .post-signature.owner .user-details a[data-user-id]')?.getAttribute('data-user-id');
      const id = location.pathname.startsWith('/users/') ? scoped : location.pathname.startsWith('/questions/') ? asker : null;
      respond(id && /^\d{1,10}$/.test(id) ? `https://stackoverflow.com/users/${id}` : null); return;
    }
    if (message?.type === 'read-issue-author' && sender.id === chrome.runtime.id) {
      // GitHub issue or pull request: the login link in the title section is its author (assignees and participants are not).
      // Newer issue pages mark the author explicitly; older issue and pull request pages list the opener as the first a.author.
      const link = document.querySelector<HTMLAnchorElement>('[class*="authorLoginLink"]') || document.querySelector<HTMLAnchorElement>('a.author');
      let author = '';
      try { const parts = link ? new URL(link.href, location.href).pathname.split('/').filter(Boolean) : []; if (parts.length === 1 && /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(parts[0])) author = `https://github.com/${parts[0]}`; } catch { /* Leave empty. */ }
      respond(author || null); return;
    }
    if (message?.type === 'read-comment-author' && sender.id === chrome.runtime.id) {
      const path = typeof message.url === 'string' ? new URL(message.url, location.href).pathname : location.pathname;
      const id = /\/comment\/(\w+)/i.exec(path)?.[1];
      const comment = id ? document.querySelector(`shreddit-comment[thingid="t1_${id}"], shreddit-comment[permalink*="/comment/${id}"]`) : document.querySelector('shreddit-comment');
      const name = comment?.getAttribute('author') || '';
      respond(/^[\w-]{3,20}$/.test(name) ? `https://www.reddit.com/user/${name}/` : null); return;
    }
    if (message?.type !== 'read-post-author' || sender.id !== chrome.runtime.id) return;
    const authors = [...new Set([...document.querySelectorAll<HTMLAnchorElement>('shreddit-post a[href*="/user/"], shreddit-post a[href*="/u/"], [data-testid="post_author_link"]')]
      .map(a => { try { const next = new URL(a.href, location.href); const parts = next.pathname.split('/').filter(Boolean); if (!/(^|\.)reddit\.com$/.test(next.hostname) || parts.length < 2 || !/^(user|u)$/i.test(parts[0]) || !/^[\w-]{3,20}$/.test(parts[1]) ) return ''; return `https://www.reddit.com/user/${parts[1]}/`; } catch { return ''; } })
      .filter(Boolean))];
    respond(authors.length === 1 ? authors[0] : null);
  });
  observe(document.documentElement); scan();
  // Floating button for GitHub/Reddit profile links that the icon scanner skipped (plain name links, nav, etc.).
  const float = document.createElement('span'); float.dataset.universalTip = 'float';
  float.style.cssText = 'position:fixed;z-index:2147483647;display:none;left:0;top:0';
  const floatRoot = float.attachShadow({ mode: 'closed' }); const floatStyle = document.createElement('style');
  floatStyle.textContent = 'button{border:1px solid #006b6d;border-radius:999px;height:24px;padding:0 9px;background:#fff;color:#006b6d;font:700 12px system-ui;cursor:pointer;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.25)}button:hover{background:#dff5f2}';
  const floatButton = document.createElement('button'); floatButton.type = 'button'; floatButton.textContent = '↗ Tip'; floatRoot.append(floatStyle, floatButton);
  let floatUrl = ''; let floatHide = 0;
  const hideFloat = () => { float.style.display = 'none'; floatUrl = ''; };
  const profileLink = (el: Element): string | null => {
    if (!(el instanceof HTMLAnchorElement) || el.closest('[data-universal-tip]') || el.closest('nav, [role="navigation"], [role="banner"]')) return null;
    // The floating button is only a fallback: a name that already has its own icon does not get a second button.
    if (el.nextElementSibling instanceof HTMLElement && hosts.has(el.nextElementSibling)) return null;
    return target(el);
  };
  const showFloat = (event: Event) => {
    const under = event instanceof MouseEvent ? document.elementsFromPoint(event.clientX, event.clientY).slice(0, 8).map(el => el.closest('a') || el) : [];
    for (const node of [...event.composedPath().slice(0, 8), ...under]) {
      if (node === float) { clearTimeout(floatHide); return; }
      const url = node instanceof Element ? profileLink(node) : null; if (!url) continue;
      const rect = (node as Element).getBoundingClientRect(); if (!rect.width || !rect.height) return;
      clearTimeout(floatHide); floatUrl = url; floatButton.setAttribute('aria-label', `Find how to tip ${new URL(url).pathname.replace(/^\/(?:user|u)\//, '').slice(0, 40)}`);
      if (!float.isConnected) document.documentElement.append(float);
      float.style.display = 'block';
      float.style.left = `${Math.max(4, Math.min(window.innerWidth - 70, rect.right + 4))}px`; float.style.top = `${Math.max(4, Math.min(window.innerHeight - 28, rect.top + rect.height / 2 - 12))}px`;
      return;
    }
    if (floatUrl && !floatHide) floatHide = setTimeout(() => { floatHide = 0; hideFloat(); }, 700);
  };
  document.addEventListener('mouseover', showFloat, true);
  float.addEventListener('mouseenter', () => { clearTimeout(floatHide); floatHide = 0; });
  float.addEventListener('mouseleave', () => { floatHide = setTimeout(() => { floatHide = 0; hideFloat(); }, 400); });
  floatButton.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); if (event.isTrusted && floatUrl) { open(floatUrl); hideFloat(); } });
})();
