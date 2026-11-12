(() => {
  const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const target = new URL(location.href).searchParams.get('url') || '';
  const status = byId<HTMLDivElement>('status'); const result = byId<HTMLElement>('result'); const retry = byId<HTMLButtonElement>('retry');
  byId<HTMLElement>('target').textContent = target; if (window.innerWidth < 700) document.body.classList.add('compact');
  function reportKey(value: string) {
    try {
      const url = new URL(value); const host = url.hostname.toLowerCase().replace(/^www\./, '');
      const parts = url.pathname.split('/').filter(Boolean);
      if (host === 'github.com' && parts.length === 1) return `github:${parts[0].toLowerCase()}`;
      if ((host === 'reddit.com' || host === 'old.reddit.com') && parts.length === 2 && ['u', 'user'].includes(parts[0].toLowerCase())) return `reddit:${parts[1].toLowerCase()}`;
      url.hash = ''; return url.href;
    } catch { return value; }
  }
  function element(tag: string, text: string, className?: string) { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; }
  function link(value: string, label: string) {
    try { const parsed = new URL(value); if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error();
      const a = document.createElement('a'); a.href = parsed.href; a.textContent = label; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
    } catch { return element('span', 'Invalid source link'); }
  }
  const TYPE_LABELS: Record<string, string> = { paypal_me: 'PayPal.Me link', paypal_id: 'PayPal donate link', other_payment_link: 'Support link', contact_url: 'Contact page', email: 'Public email (masked)', phone: 'Public phone (masked)' };
  const ASSOCIATION_LABELS: Record<string, string> = { direct_profile: 'listed on their own profile', unverified_page: 'found on a page not confirmed as theirs', linked_creator_site: 'found on a website their profile links to', listed_account: 'listed on the GitHub account their profile names', confirmed_owner_site: 'listed on this site, whose owner is confirmed', mutual_link_account: 'listed on their GitHub account; the site and the account each name the other', keybase_linked_account: 'listed on their GitHub account, tied to this profile or site by a Keybase proof', username_match: 'same username on another platform; not confirmed as the same person', stale_profile_link: 'may be out of date', unverified_profile_id: 'profile could not be rechecked' };
  const plain = (value: string) => String(value || '').replaceAll('_', ' ');
  function show(data: any) {
    result.replaceChildren(); status.textContent = data.status; status.classList.remove('error'); const note = document.getElementById('proofnote'); if (note) note.hidden = !data.candidates?.length;
    result.append(element('h2', data.target.displayName || 'Profile'), link(data.target.profileUrl, data.target.profileUrl));
    result.append(element('p', `Platform: ${data.target.platform} · Checked: ${new Date(data.checkedAt).toLocaleString()}${data.cached ? ' · cached' : ''}`, 'hint'));
    if (data.candidates?.length) {
      result.append(element('h2', data.candidates.some((c: any) => c.decision === 'published_payment_link') ? 'Published evidence' : 'Unconfirmed leads'));
      const offered = new Set<string>();
      const shown = new Map<string, HTMLElement>();
      for (const c of data.candidates) {
        // The same destination with the same standing, listed by a second source: add that source to the first entry instead of repeating it.
        const same = `${String(c.candidate_value).toLowerCase()}|${c.decision}`; const first = shown.get(same);
        if (first && ['paypal_me', 'paypal_id', 'other_payment_link'].includes(c.candidate_type)) { const also = element('p', 'Also listed at: ', 'source'); also.append(link(c.source_url, c.source_url)); first.after(also); shown.set(same, also); continue; }
        const block = document.createElement('section'); block.append(element('p', `${TYPE_LABELS[c.candidate_type] || plain(c.candidate_type)} · ${ASSOCIATION_LABELS[c.identity_association_status] || plain(c.identity_association_status)}`, 'badge'));
        if (['paypal_me', 'paypal_id', 'other_payment_link'].includes(c.candidate_type)) block.append(element('p', c.decision === 'published_payment_link' ? 'Opens their real payment page with real money, not the sandbox demo.' : 'This public link may open a live payment service, not the sandbox demo. Universal Tip does not send a payment.', 'hint'));
        block.append(['email', 'phone'].includes(c.candidate_type) ? element('span', c.candidate_value) : link(c.candidate_value, c.candidate_value), element('p', c.reason));
        if (['paypal_me', 'paypal_id', 'other_payment_link'].includes(c.candidate_type) && !offered.has(String(c.candidate_value).toLowerCase())) {
          offered.add(String(c.candidate_value).toLowerCase()); // one button per destination, even when several sources list it
          // The donate step: open the page that was found. Universal Tip never moves money. An unconfirmed link gets a quieter, clearly labelled button.
          let site = 'their support page'; try { const where = new URL(c.candidate_value); site = where.hostname === 'github.com' && where.pathname.startsWith('/sponsors/') ? 'GitHub Sponsors' : where.hostname.replace(/^www\./, ''); } catch { /* Keep the generic label. */ }
          const confirmed = c.decision === 'published_payment_link';
          const cta = link(c.candidate_value, confirmed ? `Open ${site} to support them` : `Open ${site} (not confirmed as theirs)`);
          if (cta instanceof HTMLAnchorElement) { cta.className = confirmed ? 'cta' : 'cta quiet'; block.append(cta); }
          // PayPal.Me accepts an amount in the path; offer a few, opened on PayPal where the payer still confirms.
          const me = confirmed && c.candidate_type === 'paypal_me' ? /^https:\/\/(?:www\.)?(?:paypal\.me\/|paypal\.com\/paypalme\/)[a-z\d._-]{1,128}$/i.exec(c.candidate_value) : null;
          if (me) {
            const row = document.createElement('p'); row.className = 'amounts'; row.append(element('span', 'Tip an amount: ', 'hint'));
            for (const amount of [3, 5, 10]) { const chip = link(`${c.candidate_value}/${amount}USD`, `$${amount}`); if (chip instanceof HTMLAnchorElement) { chip.className = 'chip'; row.append(chip); } }
            block.append(row, element('p', 'Opens PayPal with the amount filled in. You review and confirm the payment on PayPal; Universal Tip never moves money.', 'hint'));
          }
        }
        const source = element('p', 'Source: ', 'source'); source.append(link(c.source_url, c.source_url)); block.append(source); shown.set(same, source);
        const details = document.createElement('details'); details.append(element('summary', 'Evidence details'));
        details.append(element('p', `Identity association: ${c.identity_association_status.replaceAll('_', ' ')}. Contact reliability: ${(c.contact_reliability_status || 'not_independently_verified').replaceAll('_', ' ')}. Payment authorization: ${c.payment_authorization_status.replaceAll('_', ' ')}.`));
        const retrieved = element('p', 'Retrieved from: ', 'source'); retrieved.append(link(c.retrieval_url || c.source_url, c.retrieval_url || c.source_url)); details.append(retrieved);
        if (c.evidence_excerpt) details.append(element('p', `Extracted source data (untrusted; redacted or normalized): ${c.evidence_excerpt}`, 'hint'));
        details.append(element('p', `SHA-256 of decoded response: ${c.evidence_excerpt_or_hash}`, 'hint')); block.append(details); result.append(block);
      }
    } else result.append(element('p', 'No supported payment link was found in the sources checked. This is not proof that none exists.'));
    if (data.sources?.length) {
      result.append(element('h2', 'Sources checked')); const list = document.createElement('ul');
      for (const source of data.sources) { const item = document.createElement('li'); item.append(link(source, source)); list.append(item); }
      result.append(list);
    }
    if (data.identityLinks?.length) {
      result.append(element('h2', 'Declared identity links'), element('p', 'These links were published by the cited source. They do not independently prove that the accounts belong to the same person.'));
      const list = document.createElement('ul');
      for (const item of data.identityLinks) { const row = document.createElement('li'); row.append(link(item.url, item.url), element('span', ` — ${item.relation}. Source: `), link(item.source_url, item.source_url));
        // One click to research a person the page credits; nothing is looked up until then.
        try { const next = new URL(item.url); if (next.protocol === 'https:') { const go = document.createElement('a'); go.href = chrome.runtime.getURL(`panel.html?url=${encodeURIComponent(next.origin + next.pathname)}`); go.textContent = ' Research this'; row.append(go); } } catch { /* Not researchable. */ }
        list.append(row); }
      result.append(list);
    }
    if (data.researchLeads?.length) {
      result.append(element('h2', 'Unverified search leads'), element('p', 'These are search results, not proof that a page belongs to this person.'));
      const list = document.createElement('ul'); for (const lead of data.researchLeads) { const item = document.createElement('li'); item.append(link(lead.url, lead.title || lead.url)); list.append(item); } result.append(list);
    }
    if (data.assessments?.length) {
      result.append(element('h2', 'Decision checks'));
      for (const assessment of data.assessments) {
        result.append(element('p', `${assessment.provider}: ${assessment.question} ${typeof assessment.answer === 'number' ? `Estimated probability ${Math.round(assessment.answer * 100)}%` : assessment.answer === 'refused' ? 'The model declined to answer; check the evidence yourself' : assessment.answer}. Advisory only; not proof or payment authorization.`));
        if (typeof assessment.explanation === 'string') result.append(element('p', assessment.explanation, 'hint'));
        if (assessment.citations?.length) {
          const citations = document.createElement('details'); citations.append(element('summary', `Review citations (${assessment.citations.length})`));
          const list = document.createElement('ul');
          for (const citation of assessment.citations) { const item = document.createElement('li'); item.append(link(citation.url, citation.title || citation.url)); list.append(item); }
          citations.append(list); result.append(citations);
        }
      }
    }
    if (data.warnings?.length) { result.append(element('h2', 'Limitations')); const list = document.createElement('ul'); for (const warning of data.warnings) list.append(element('li', warning)); result.append(list); }
    if (typeof data.target.username === 'string' && /^[\w.-]{1,50}$/.test(data.target.username)) {
      // Manual hand-off only: Fingerprint's terms bar automated access beyond its limits, and its API is not released.
      result.append(element('h2', 'Look further yourself'), element('p', `Fingerprint searches many platforms for a username. This copies "${data.target.username}" and opens their site for you to run the search; results there are leads, not proof.`, 'hint'));
      const more = link('https://fingerprint.to/username-search', 'Copy username and open Fingerprint');
      more.addEventListener('click', () => { navigator.clipboard.writeText(data.target.username).catch(() => { /* The username is shown above to type instead. */ }); });
      result.append(more);
      // Optional: the local server can forward the username to a profile-lookup service its operator runs. Leads only.
      const holder = document.createElement('div'); result.append(holder);
      void (async () => {
      const stored = await chrome.storage.local.get('token');
      const status = await fetch('http://127.0.0.1:4318/status', { headers: { 'x-local-token': stored.token || '' }, signal: AbortSignal.timeout(4000) }).then(r => r.ok ? r.json() : null).catch(() => null);
      if (status?.profileLookupEnabled) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.id = 'profile-lookup'; button.textContent = 'Search other platforms for this username'; const out = element('div', ''); out.id = 'profile-lookup-result';
        button.addEventListener('click', async () => {
          button.disabled = true; out.replaceChildren(element('p', 'Searching several hundred platforms. This takes about a minute.', 'hint'));
          try {
            const response = await fetch('http://127.0.0.1:4318/profiles', { method: 'POST', headers: { 'content-type': 'application/json', 'x-local-token': stored.token || '' }, body: JSON.stringify({ username: data.target.username }) });
            const found = await response.json(); if (!response.ok) throw new Error(found.error || 'Lookup failed');
            out.replaceChildren(element('p', found.profiles.length ? `An account named "${found.username}" exists on ${found.total} platforms, including: ${found.profiles.map((p: any) => p.platform).join(', ')}.` : `No account named "${found.username}" was found on other platforms.`), element('p', 'These are leads, not proof: the same username on another site can be a different person. Nothing here becomes a payment link.', 'hint'));
          } catch (error) { out.replaceChildren(element('p', `Could not search: ${error instanceof Error ? error.message : 'unknown error'}`, 'hint')); }
          finally { button.disabled = false; }
        });
        holder.append(button, out);
      }
      })();
    }
    // An inner page of a website: the owner check only applies to a site's home page, so offer that lookup when nothing is confirmed here.
    try { const here = new URL(data.target.profileUrl);
      if (data.target.platform === 'web' && here.pathname !== '/' && !(data.candidates || []).some((c: any) => c.decision === 'published_payment_link')) {
        const home = document.createElement('a'); home.className = 'cta quiet'; home.href = chrome.runtime.getURL(`panel.html?url=${encodeURIComponent(here.origin + '/')}`); home.textContent = `Research the home page of ${here.hostname}`;
        result.append(element('h2', 'Look for the site owner'), element('p', 'This is an inner page, and its author may not be the site’s owner. The home page is where a site’s owner can be confirmed.'), home);
      } } catch { /* Not a web address. */ }
    const report = document.createElement('button'); report.type = 'button'; report.className = 'secondary'; report.textContent = 'Report wrong match and hide this profile';
    report.addEventListener('click', async () => {
      try {
        const stored = await chrome.storage.local.get(['token', 'reportedProfiles']);
        const reported = Array.isArray(stored.reportedProfiles) ? stored.reportedProfiles : [];
        await chrome.storage.local.set({ reportedProfiles: [...new Set([...reported, reportKey(target)])] });
        try {
          const response = await fetch('http://127.0.0.1:4318/cache', { method: 'DELETE', headers: { 'x-local-token': stored.token || '' } });
          if (response.ok) showReported(true);
          else { const data = await response.json(); showReported(false, String(data.error || 'Backend refused the request.')); }
        } catch { showReported(false, 'The backend is unavailable.'); }
      } catch { status.textContent = 'Could not save the local report.'; status.classList.add('error'); }
    }); result.append(report);
    tidy(data);
  }
  // The simple view: who this is, a one-line answer and the buttons, with all the evidence folded underneath.
  // In a wide tab the evidence starts open; in the small window the Tip button opens it starts closed.
  function tidy(data: any) {
    const confirmed = (data.candidates || []).filter((c: any) => c.decision === 'published_payment_link' && ['paypal_me', 'paypal_id', 'other_payment_link'].includes(c.candidate_type));
    const leads = (data.candidates || []).length - confirmed.length; const name = data.target.displayName || data.target.username || 'this person';
    const places: Record<string, string> = { github: 'GitHub', reddit: 'Reddit', x: 'X', facebook: 'Facebook', youtube: 'YouTube', stackoverflow: 'Stack Overflow', web: 'the web' };
    const card = document.createElement('section'); card.className = 'card';
    const who = element('p', name, 'who'); who.append(element('span', ` on ${places[data.target.platform] || data.target.platform}`)); card.append(who);
    const ways = new Set(confirmed.map((c: any) => String(c.candidate_value).toLowerCase())).size;
    card.append(confirmed.length ? element('p', ways === 1 ? 'They published one way to support them.' : `They published ${ways} ways to support them.`, 'verdict ok')
      : leads ? element('p', 'Possible links found, but none confirmed as theirs.', 'verdict lead') : element('p', 'No support link found for this person.', 'verdict none'));
    for (const cta of [...result.querySelectorAll<HTMLAnchorElement>('a.cta')]) {
      const way = document.createElement('div'); way.className = 'way'; const badge = cta.parentElement?.querySelector('p.badge'); const amounts = cta.nextElementSibling;
      if (badge?.textContent) way.append(element('p', badge.textContent, 'hint'));
      way.append(cta); if (amounts instanceof HTMLElement && amounts.classList.contains('amounts')) way.append(amounts); card.append(way);
    }
    if (confirmed.length) card.append(element('p', 'You pay on their own page and confirm it there. Universal Tip never moves money.', 'hint'));
    // No confirmed way to pay them: offer to hold a tip against the username until they claim it.
    if (!confirmed.length && data.target.username && data.target.platform !== 'web') {
      const heldFor = { platform: data.target.platform, username: data.target.username }; const way = document.createElement('div'); way.className = 'way';
      const hold = document.createElement('button'); hold.type = 'button'; hold.id = 'hold-tip'; hold.textContent = `Hold a $1 tip for ${name}`; const note = element('p', '', 'hint'); note.id = 'hold-note';
      way.append(element('p', 'No confirmed way to pay them yet', 'hint'), hold, element('p', 'You pay through PayPal into the Universal Tip holding account. The tip is recorded against this username and waits there until they claim it. Sandbox mode: no real money.', 'hint'), note); card.append(way);
      void (async () => { const stored = await chrome.storage.local.get('token'); const headers = { 'content-type': 'application/json', 'x-local-token': stored.token || '' };
        const refresh = async () => { try { const held = await (await fetch('http://127.0.0.1:4318/held', { method: 'POST', headers, body: JSON.stringify({ heldFor }) })).json(); if (held.count) note.textContent = `Already held for this username: $${held.totalUsd} from ${held.count} tip${held.count === 1 ? '' : 's'}.`; } catch { /* Shown only when available. */ } };
        void refresh(); window.addEventListener('focus', () => { void refresh(); });
        hold.addEventListener('click', async () => {
          if (!confirm(`Open PayPal to hold a $1.00 tip for ${heldFor.platform}:${heldFor.username}? It is paid to the holding account, not to them, until they claim it.`)) return;
          hold.disabled = true;
          try { const response = await fetch('http://127.0.0.1:4318/sandbox/order', { method: 'POST', headers, body: JSON.stringify({ heldFor }) }); const order = await response.json(); if (!response.ok) throw new Error(order.error || 'PayPal is not set up on the local server.');
            const approval = new URL(order.approvalUrl); if (approval.protocol !== 'https:' || !['www.sandbox.paypal.com', 'www.paypal.com'].includes(approval.hostname) || approval.username || approval.password || approval.port) throw new Error('Unexpected approval URL');
            await chrome.tabs.create({ url: approval.href }); note.textContent = 'PayPal opened in a new tab. Approve there to hold the tip.';
          } catch (error) { note.textContent = `Could not start: ${error instanceof Error ? error.message : 'unknown error'}`; }
          finally { hold.disabled = false; }
        });
      })();
    }
    // What the username search found, even when none of it is a support page.
    if (data.osint && Array.isArray(data.osint.platforms) && data.osint.platforms.length) {
      const found = document.createElement('details'); found.className = 'osint'; found.append(element('summary', `The username "${data.target.username}" also exists on ${data.osint.platformsTotal || data.osint.platforms.length} other platforms`));
      found.append(element('p', data.osint.platforms.slice(0, 80).join(', ') + '.', 'hint'), element('p', 'A matching username can be a different person. None of these is treated as theirs.', 'hint')); card.append(found);
    } else if (data.osint) card.append(element('p', `The username search found "${data.target.username}" on no other platform.`, 'hint'));
    const more = document.createElement('details'); more.id = 'more'; more.open = window.innerWidth >= 700; more.append(element('summary', 'Evidence and details'));
    more.append(...result.childNodes); result.append(card, more);
  }
  function showReported(cleared?: boolean, failure?: string) {
    status.classList.remove('error'); status.textContent = 'Reported locally — this profile is hidden';
    const cacheMessage = cleared === true ? 'The local research cache was cleared.' : cleared === false ? `The local cache could not be cleared: ${failure || 'retry from the popup.'}` : 'Use Clear research cache in the popup if cached evidence still needs removal.';
    result.replaceChildren(element('p', `${cacheMessage} This report stays in this browser; it was not sent to an external service.`));
    const restore = document.createElement('button'); restore.type = 'button'; restore.className = 'secondary'; restore.textContent = 'Undo report and allow research';
    restore.addEventListener('click', async () => { const stored = await chrome.storage.local.get('reportedProfiles'); await chrome.storage.local.set({ reportedProfiles: (stored.reportedProfiles || []).filter((value: string) => value !== reportKey(target)) }); run(); }); result.append(restore);
  }
  async function run() {
    retry.hidden = true; status.classList.remove('error'); status.textContent = 'Checking public sources…'; result.replaceChildren();
    try {
      const stored = await chrome.storage.local.get(['token', 'reportedProfiles']);
      if (Array.isArray(stored.reportedProfiles) && stored.reportedProfiles.includes(reportKey(target))) { showReported(); return; }
      const pair = async () => { try { const response = await fetch('http://127.0.0.1:4318/pair', { method: 'POST', signal: AbortSignal.timeout(4000) }); if (response.ok) { stored.token = (await response.json()).token; await chrome.storage.local.set({ token: stored.token }); } } catch { /* Reported below as a server or token problem. */ } };
      if (!stored.token) await pair();
      if (!stored.token) throw new Error('the local server is not running. Start it with start.bat (or npm start) in the project folder, then try again.');
      let response: Response;
      // X throttles server-side clients, so this browser reads the public embed page and passes on only the profile fields.
      let xProfile: any;
      const handle = /^https:\/\/(?:x|twitter)\.com\/([a-z\d_]{1,15})\/?$/i.exec(target)?.[1];
      try {
        const page = handle ? JSON.parse(new URL(location.href).searchParams.get('xp') || 'null') : null;
        if (page && typeof page.screen_name === 'string' && page.screen_name.toLowerCase() === handle!.toLowerCase()) xProfile = { id_str: `handle:${handle!.toLowerCase()}`, screen_name: page.screen_name, name: String(page.name || '').slice(0, 120), description: String(page.description || '').slice(0, 600), entities: { url: { urls: [] }, description: { urls: (Array.isArray(page.links) ? page.links : []).slice(0, 8).map((item: unknown) => ({ expanded_url: String(item).slice(0, 300) })) } } };
      } catch { /* Fall back to the public embed page. */ }
      let pageProfile: any;
      const redditName = (/^https:\/\/(?:www\.|old\.)?reddit\.com\/(?:user|u)\/([\w-]{3,20})\/?$/i.exec(target) || /^https:\/\/www\.facebook\.com\/([a-z\d.]{5,50})\/?$/i.exec(target) || /^https:\/\/www\.youtube\.com\/@([a-z\d._-]{3,30})$/i.exec(target) || /^https:\/\/github\.com\/([a-z\d-]{1,39})\/?$/i.exec(target) || /^https:\/\/stackoverflow\.com\/users\/(\d{1,10})$/.exec(target))?.[1]; // Reddit, Facebook, YouTube or GitHub name, or Stack Overflow ID
      try {
        const page = redditName ? JSON.parse(new URL(location.href).searchParams.get('xp') || 'null') : null;
        if (page && typeof page.screen_name === 'string' && page.screen_name.toLowerCase() === redditName!.toLowerCase()) pageProfile = { screen_name: page.screen_name, name: String(page.name || '').slice(0, 120), website: String(page.website || '').slice(0, 300), repos: (Array.isArray(page.repos) ? page.repos : []).slice(0, 3).map((item: unknown) => String(item).slice(0, 100)), description: String(page.description || '').slice(0, 1000), links: (Array.isArray(page.links) ? page.links : []).slice(0, 8).map((item: unknown) => String(item).slice(0, 300)) };
      } catch { /* The server falls back to Reddit's public endpoint. */ }
      if (handle && !xProfile) try {
        status.textContent = 'Reading the public X profile…';
        const embed = await fetch(`https://syndication.twitter.com/srv/timeline-profile/screen-name/${handle}`, { credentials: 'omit', signal: AbortSignal.timeout(15000) });
        const html = embed.ok ? await embed.text() : ''; const raw = html.length < 2000000 ? /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html)?.[1] : '';
        const entries = raw ? JSON.parse(raw)?.props?.pageProps?.timeline?.entries : null;
        const user = (Array.isArray(entries) ? entries : []).map((entry: any) => entry?.content?.tweet?.user).find((item: any) => typeof item?.screen_name === 'string' && item.screen_name.toLowerCase() === handle.toLowerCase());
        const urls = (list: any) => (Array.isArray(list) ? list : []).slice(0, 8).map((item: any) => ({ expanded_url: String(item?.expanded_url || '').slice(0, 300) }));
        if (user) xProfile = { id_str: String(user.id_str), screen_name: String(user.screen_name), name: String(user.name || '').slice(0, 120), description: String(user.description || '').slice(0, 600), entities: { url: { urls: urls(user.entities?.url?.urls) }, description: { urls: urls(user.entities?.description?.urls) } } };
      } catch { /* The server reports that the profile could not be read. */ }
      const request = () => fetch('http://127.0.0.1:4318/lookup/stream', { method: 'POST', headers: { 'content-type': 'application/json', 'x-local-token': stored.token }, body: JSON.stringify({ url: target, xProfile, pageProfile }), signal: AbortSignal.timeout(120000) });
      try { response = await request(); if (response.status === 401) { await pair(); response = await request(); } }
      catch (error) { throw new Error((error as Error).name === 'TimeoutError' ? 'the research took too long and was stopped.' : 'the local server is not running. Start it with start.bat (or npm start) in the project folder, then try again.'); }
      if (response.status === 401) throw new Error('the saved pairing token was not accepted. Paste the current token from the server into the toolbar popup.');
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || 'Research failed.'); }
      if (!response.body || !response.headers.get('content-type')?.includes('application/x-ndjson')) throw new Error('The backend returned an unexpected response.');
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let completed = false;
      while (true) {
        const chunk = await reader.read(); buffer += decoder.decode(chunk.value, { stream: !chunk.done });
        if (buffer.length > 1000000) throw new Error('Research response exceeded the size limit.');
        let boundary: number;
        while ((boundary = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 1); if (!line) continue;
          const event = JSON.parse(line);
          if (event.type === 'progress' && typeof event.message === 'string') status.textContent = event.message;
          else if (event.type === 'error') throw new Error(String(event.error || 'Research failed.'));
          else if (event.type === 'result') { show(event.value); completed = true; }
        }
        if (chunk.done) break;
      }
      if (!completed) throw new Error('Research ended without a result.');
    } catch (error) { result.replaceChildren(); status.textContent = `Research unavailable: ${(error as Error).message || 'check the local backend'}`; status.classList.add('error'); retry.hidden = false; { const note = document.getElementById('proofnote'); if (note) note.hidden = true; }
      // X and Reddit refuse most outside lookups, but their own profile pages show the bio; point the user there.
      if (/^https:\/\/(?:x\.com|(?:www\.|old\.)?reddit\.com)\//i.test(target) && !new URL(location.href).searchParams.get('xp')) result.append(element('p', 'This site limits lookups from outside. Open their profile page and use the tip button there; it reads the bio and links already shown on that page.'), Object.assign(link(target, 'Open their profile page'), { className: 'cta' }));
    }
  }
  const sandboxButton = byId<HTMLButtonElement>('sandbox-demo');
  sandboxButton.addEventListener('click', async () => {
    if (!confirm('Open a $1.00 USD PayPal sandbox checkout for the configured sandbox merchant? This is not a payment to the discovered creator.')) return;
    sandboxButton.disabled = true; const notice = byId<HTMLElement>('sandbox-status');
    try {
      const stored = await chrome.storage.local.get('token');
      const response = await fetch('http://127.0.0.1:4318/sandbox/order', { method: 'POST', headers: { 'x-local-token': stored.token || '' } });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Sandbox unavailable');
      const approval = new URL(data.approvalUrl); if (approval.protocol !== 'https:' || approval.hostname !== 'www.sandbox.paypal.com' || approval.username || approval.password || approval.port) throw new Error('Unexpected sandbox approval URL');
      await chrome.tabs.create({ url: approval.href }); notice.textContent = 'Sandbox approval opened in a new tab.';
    } catch (error) { notice.textContent = `Sandbox unavailable: ${(error as Error).message}`; }
    finally { sandboxButton.disabled = false; }
  });
  retry.addEventListener('click', run); run();
})();
