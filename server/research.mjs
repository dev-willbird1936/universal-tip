import { createHash } from 'node:crypto';
import { fetchWithRetry, publicURL } from './net.mjs';
import { parse } from 'parse5';
import { parse as parseYAML } from 'yaml';

function parseResponse(text, service) { try { return JSON.parse(text); } catch { throw new Error(`${service} returned an invalid response`); } }
// A profile may list one section of a site (example.com/notes) and the site itself. One website is read, so prefer the
// home page of the first listed site when it is also listed: that is where people name their other accounts.
// A different site listed later (a personal site after a link-in-bio page, say) never displaces the first.
function preferHome(links) {
  const first = links[0]; if (!first) return undefined;
  const host = value => { try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
  return links.find(link => { try { return ['', '/'].includes(new URL(link).pathname) && host(link) === host(first); } catch { return false; } }) || first;
}
// Results built from fallbacks are not stored, so repeat clicks would re-download the same public files and ask Keybase
// again. Remember those specific downloads (answers and "not found") for ten minutes. Only plain, unauthenticated requests
// to these hosts are remembered; API calls and ordinary websites are always fetched afresh.
const memoHost = url => { try { const u = new URL(url); return u.hostname === 'raw.githubusercontent.com' || u.hostname === 'keybase.io' || (u.hostname === 'github.com' && u.pathname.startsWith('/sponsors/')); } catch { return false; } };
export function memoFetch(fetcher, { ttl = 10 * 60 * 1000, max = 300, now = () => Date.now() } = {}) {
  const seen = new Map();
  const memo = async (url, options = {}) => {
    if (!memoHost(url) || options.headers) return fetcher(url, options);
    const hit = seen.get(url);
    if (hit && now() - hit.at < ttl) { if (hit.error) throw new Error(hit.error); return hit.value; }
    const keep = entry => { if (seen.size >= max) seen.delete(seen.keys().next().value); seen.set(url, { at: now(), ...entry }); };
    try { const value = await fetcher(url, options); keep({ value }); return value; }
    catch (error) { const message = String(error?.message || ''); if (message === 'Remote source returned HTTP 404' || message === 'Redirects are not followed') keep({ error: message }); throw error; }
  };
  memo.clear = () => seen.clear();
  return memo;
}
export const sharedFetch = memoFetch(fetchWithRetry, /^\d{1,7}$/.test(process.env.FETCH_MEMO_MS || '') ? { ttl: Number(process.env.FETCH_MEMO_MS) } : {});
// When each platform's API last refused us for being over its allowance (a time until which it is assumed limited; 0 = fine).
// The extension asks for this so it loads a profile page in the browser only while the API cannot be used.
export const platformLimits = { github: 0, stackoverflow: 0, stackoverflowBackoff: 0 };
const githubReserved = new Set(['about','account','apps','collections','contact','customer-stories','enterprise','events','explore','features','issues','login','marketplace','new','notifications','orgs','organizations','pricing','pulls','search','settings','site','sponsors','topics','trending']);
export function canonicalProfile(input) {
  const url = publicURL(input);
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const parts = url.pathname.split('/').filter(Boolean);
  if (host === 'github.com' || host === 'gist.github.com') {
    const user = parts[0];
    if (!user || !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(user) || githubReserved.has(user.toLowerCase())) throw new Error('A GitHub user profile URL is required; repository owners are not necessarily authors');
    // A repository, gist, issue or file URL still names its owner; that is who we research.
    return { platform: 'github', username: user, profileUrl: `https://github.com/${user}` };
  }
  // GitHub Pages: only the account named in <name>.github.io can publish there, so the site's owner is that account.
  const pages = /^([a-z\d](?:[a-z\d-]{0,37}[a-z\d])?)\.github\.io$/i.exec(host);
  if (pages && !githubReserved.has(pages[1].toLowerCase())) return { platform: 'github', username: pages[1], profileUrl: `https://github.com/${pages[1]}` };
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    // Channel handles (youtube.com/@name); 3-30 letters, digits, dots, dashes or underscores.
    if (parts.length !== 1 || !/^@[a-z\d._-]{3,30}$/i.test(parts[0])) throw new Error('A YouTube channel URL such as youtube.com/@name is required');
    return { platform: 'youtube', username: parts[0].slice(1), profileUrl: `https://www.youtube.com/@${parts[0].slice(1)}` };
  }
  if (host === 'stackoverflow.com') {
    // /users/<numeric id>/<display-name slug>: the numeric ID is stable; the slug is not.
    if (parts[0]?.toLowerCase() !== 'users' || !/^\d{1,10}$/.test(parts[1] || '')) throw new Error('A Stack Overflow user profile URL is required');
    return { platform: 'stackoverflow', username: parts[1], profileUrl: `https://stackoverflow.com/users/${parts[1]}` };
  }
  if (host === 'reddit.com' || host === 'old.reddit.com') {
    if (parts.length !== 2 || !['user','u'].includes(parts[0]?.toLowerCase()) || !/^[a-z\d_-]{3,20}$/i.test(parts[1] || '')) throw new Error('A Reddit user profile URL is required');
    return { platform: 'reddit', username: parts[1], profileUrl: `https://www.reddit.com/user/${parts[1]}/` };
  }
  if (host === 'x.com' || host === 'twitter.com' || host === 'mobile.twitter.com') {
    if (parts.length !== 1 || !/^[a-z\d_]{1,15}$/i.test(parts[0]) || xReserved.has(parts[0].toLowerCase())) throw new Error('An X profile URL is required');
    return { platform: 'x', username: parts[0], profileUrl: `https://x.com/${parts[0]}` };
  }
  if (host === 'facebook.com' || host === 'm.facebook.com' || host === 'web.facebook.com') {
    if (parts.length !== 1 || !/^[a-z\d.]{5,50}$/i.test(parts[0]) || facebookReserved.has(parts[0].toLowerCase())) throw new Error('A Facebook profile URL is required');
    return { platform: 'facebook', username: parts[0], profileUrl: `https://www.facebook.com/${parts[0]}` };
  }
  return { platform: 'web', username: null, profileUrl: url.href };
}
const xReserved = new Set(['home','explore','notifications','messages','settings','search','compose','login','signup','logout','hashtag','intent','share','jobs','premium','privacy','about','download','account','communities','lists','bookmarks']);
const facebookReserved = new Set(['watch','marketplace','groups','gaming','events','pages','friends','messages','notifications','settings','login','stories','photo','photos','videos','bookmarks','memories','saved','business','policies','privacy','hashtag','profile.php','people','public','search','recover','share','sharer','dialog','plugins','reels','fundraisers']);
// Support platforms where the account name is part of a plain profile URL.
const supportHosts = { 'ko-fi.com': /^\/([a-z\d_]{2,60})\/?$/i, 'patreon.com': /^\/(?:c\/)?([a-z\d_]{2,60})\/?$/i, 'buymeacoffee.com': /^\/([a-z\d_.-]{2,60})\/?$/i, 'opencollective.com': /^\/([a-z\d_-]{2,60})\/?$/i, 'liberapay.com': /^\/([a-z\d_.-]{2,60})\/?$/i, 'cash.app': /^\/(\$[a-z\d_-]{1,20})\/?$/i, 'venmo.com': /^\/(?:u\/)?([a-z\d_-]{3,30})\/?$/i };
const supportReserved = new Set(['home','about','login','signup','explore','pricing','features','blog','help','search','discover','posts','creators','policy','terms','privacy','legal','download','apps','s','gold','shop','commissions','account','settings']);
export function supportURL(href, baseUrl) {
  if (typeof href !== 'string' || href.length > 2048) return null;
  try {
    const url = new URL(href, baseUrl); const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const sponsors = host === 'github.com' && url.pathname.match(/^\/sponsors\/([a-z\d](?:[a-z\d-]{0,37}[a-z\d])?)\/?$/i);
    if (sponsors) return `https://github.com/sponsors/${sponsors[1]}`;
    const match = supportHosts[host] && url.pathname.match(supportHosts[host]);
    if (match && !supportReserved.has(match[1].toLowerCase())) return `https://${host}/${match[1]}`;
  } catch { /* Ignore malformed links. */ }
  return null;
}
// Profile fields the extension read from X's public embed page in the user's own browser. Untrusted input: keep only bounded, well-formed fields.
// Pages render links as several lines ("https://" / "site.com"); rejoin them so links and excerpts read correctly.
const tidyBio = text => String(text).replace(/(https?:\/\/)\s+/gi, '$1').replace(/\s*\n\s*/g, ' ').replace(/ {2,}/g, ' ').trim();
export function validXProfile(value, username) {
  if (!value || typeof value !== 'object' || typeof value.id_str !== 'string' || !(/^\d{1,25}$/.test(value.id_str) || value.id_str === `handle:${String(username).toLowerCase()}`) || typeof value.screen_name !== 'string' || value.screen_name.toLowerCase() !== String(username).toLowerCase()) return null;
  const urls = list => (Array.isArray(list) ? list : []).slice(0, 8).map(item => ({ expanded_url: typeof item?.expanded_url === 'string' ? item.expanded_url.slice(0, 2048) : '' }));
  return { id_str: value.id_str, screen_name: value.screen_name, name: typeof value.name === 'string' ? value.name.slice(0, 120) : '', description: typeof value.description === 'string' ? tidyBio(value.description.slice(0, 1000)) : '',
    entities: { url: { urls: urls(value.entities?.url?.urls) }, description: { urls: urls(value.entities?.description?.urls) } } };
}
// Reddit profile text the extension read from the page the user was viewing. Untrusted input: bounded fields only.
export function validPageProfile(value, username) {
  if (!value || typeof value !== 'object' || typeof value.screen_name !== 'string' || value.screen_name.toLowerCase() !== String(username).toLowerCase()) return null;
  return { description: typeof value.description === 'string' ? tidyBio(value.description.slice(0, 1000)) : '', links: (Array.isArray(value.links) ? value.links : []).slice(0, 8).filter(item => typeof item === 'string' && item.length <= 2048),
    name: typeof value.name === 'string' ? value.name.trim().slice(0, 120) : '', website: typeof value.website === 'string' && /^https:\/\//i.test(value.website) && value.website.length <= 2048 ? value.website : '', repos: (Array.isArray(value.repos) ? value.repos : []).slice(0, 3).filter(item => typeof item === 'string' && /^[\w.-]{1,100}$/.test(item) && item !== '.github') };
}
function xProfile(text, username) {
  const raw = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(text)?.[1];
  const entries = raw && parseResponse(raw, 'X')?.props?.pageProps?.timeline?.entries;
  if (!Array.isArray(entries)) return null;
  for (const entry of entries.slice(0, 40)) {
    const user = entry?.content?.tweet?.user;
    if (user && typeof user.screen_name === 'string' && user.screen_name.toLowerCase() === username.toLowerCase() && typeof user.id_str === 'string' && /^\d{1,25}$/.test(user.id_str)) return user;
  }
  return null;
}

// Bios and pages often write tip links as plain text ("ko-fi.com/name", "cash.app/$name"); PayPal plus the known support platforms.
const supportTextHosts = /(?:^|[\s([{<"':])((?:https:\/\/)?(?:www\.)?(?:ko-fi\.com|patreon\.com|buymeacoffee\.com|opencollective\.com|liberapay\.com|cash\.app|venmo\.com|github\.com\/sponsors)\/[^\s)\]}>"'<,;!?]{1,80})/gi;
export const tipTextPattern = /paypal|ko-fi|patreon|buymeacoffee|opencollective|liberapay|cash\.app|venmo|github\.com\/sponsors/i;
export function textPaymentLinks(text) {
  const support = Array.from(String(text).slice(0, 100000).matchAll(supportTextHosts), match => { const link = match[1].replace(/[.,;:!?]+$/, ''); return supportURL(/^https:\/\//i.test(link) ? link : `https://${link}`); }).filter(Boolean);
  return [...new Set([...paypalLinks(text), ...support])].slice(0, 21);
}
export function paypalLinks(text) {
  const matches = String(text).replaceAll('&amp;', '&').matchAll(/(?:^|[\s([{<"':])((?:https:\/\/)?(?:www\.)?(?:paypal\.me\/[a-z\d._-]+(?:\/\d{1,6}(?:\.\d{1,2})?(?:[a-z]{3})?)?\/?|paypal\.com\/paypalme\/[a-z\d._-]+(?:\/\d{1,6}(?:\.\d{1,2})?(?:[a-z]{3})?)?\/?|paypal\.com\/donate\/?\?hosted_button_id=[a-z\d]{8,32}(?:&[^\s)\]}>"']*)?))(?=$|[\s)\]}>"'.,;:!?&#])/gi);
  // Bios often write the link as plain text ("paypal.me/alice"); add the scheme before validating.
  return [...new Set(Array.from(matches, match => { const link = match[1].replace(/[.,;:!?]+$/, ''); return safePayPalURL(/^https:\/\//i.test(link) ? link : `https://${link}`); }).filter(Boolean))].slice(0, 21);
}
function safePayPalURL(href, baseUrl) {
  if (typeof href !== 'string' || href.length > 2048) return null;
  try {
    const url = new URL(href, baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const me = url.pathname.match(/^\/([a-z\d._-]{1,128})(?:\/\d{1,6}(?:\.\d{1,2})?(?:[a-z]{3})?)?\/?$/i);
    if (/^(www\.)?paypal\.me$/i.test(url.hostname) && me) return `${url.origin}/${me[1]}`;
    const paypalMe = url.pathname.match(/^\/paypalme\/([a-z\d._-]{1,128})(?:\/\d{1,6}(?:\.\d{1,2})?(?:[a-z]{3})?)?\/?$/i);
    if (/^(www\.)?paypal\.com$/i.test(url.hostname) && paypalMe) return `${url.origin}/paypalme/${paypalMe[1]}`;
    const ids = url.searchParams.getAll('hosted_button_id');
    if (/^(www\.)?paypal\.com$/i.test(url.hostname) && /^\/donate\/?$/i.test(url.pathname) && ids.length === 1 && /^[a-z\d]{8,32}$/i.test(ids[0])) return `https://www.paypal.com/donate/?hosted_button_id=${ids[0]}`;
  } catch { /* Ignore malformed links. */ }
  return null;
}
function schemaPersonLinks(text, baseUrl) {
  if (text.length > 32768) return [];
  let root; try { root = JSON.parse(text); } catch { return []; }
  const links = new Set(); const pending = [[root, 0]]; let visited = 0;
  while (pending.length && visited++ < 300 && links.size < 10) {
    const [value, depth] = pending.pop(); if (!value || typeof value !== 'object' || depth > 8) continue;
    if (Array.isArray(value)) { for (const item of value.slice(0, 50)) pending.push([item, depth + 1]); continue; }
    const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
    if (types.some(type => typeof type === 'string' && /^(?:https?:\/\/schema\.org\/)?Person$/i.test(type))) {
      const sameAs = Array.isArray(value.sameAs) ? value.sameAs.slice(0, 10) : [value.sameAs];
      for (const item of sameAs) if (typeof item === 'string') try {
        const url = publicURL(new URL(item, baseUrl).href).href; if (url !== baseUrl) links.add(url);
      } catch { /* A structured-data declaration is still untrusted. */ }
    }
    for (const key of ['@graph', 'author', 'creator', 'mainEntity']) if (value[key]) pending.push([value[key], depth + 1]);
  }
  return [...links];
}
function maskContactHref(href) {
  if (typeof href !== 'string' || href.length > 512) return null;
  try {
    const url = new URL(href); const value = decodeURIComponent(url.pathname);
    if (url.protocol === 'mailto:' && value.length <= 254 && /^[^\s@,;?]{1,64}@[a-z\d.-]+\.[a-z]{2,}$/i.test(value)) {
      const [local, domain] = value.split('@'); return { type: 'email', value: `${local[0]}***@${domain}` };
    }
    if (url.protocol === 'tel:' && /^\+?\d[\d ()-]{6,24}\d$/.test(value)) {
      const digits = value.replace(/\D/g, ''); if (digits.length >= 8 && digits.length <= 15) return { type: 'phone', value: `•••${digits.slice(-2)}` };
    }
  } catch { /* Ignore malformed or ambiguous contact identifiers. */ }
  return null;
}
function hasCaution(text) {
  const words = String(text || '').slice(0, 2000).replace(/https?:\/\/\S+/gi, ' ').replace(/[a-z\d._%+-]{1,64}@[a-z\d.-]{1,253}\.[a-z]{2,63}/gi, ' ').replace(/\b(?:[a-z\d-]+\.)+[a-z]{2,}(?:\/\S*)?/gi, ' ');
  return /\b(?:do not|don['’]t|never|avoid|scam|fraud|fake|example|not (?:my|mine|me|a payment))\b/i.test(words);
}
// Caution for a link listed in a bio. Short bios are judged whole; in long ones (YouTube "about" text) only the line naming
// the link and the line before it count, so "never giving up" elsewhere does not flag every link.
function bioCaution(text, link) {
  const bio = String(text || '').slice(0, 4000);
  if (bio.length <= 300) return hasCaution(bio);
  let key = ''; try { key = new URL(link).pathname.split('/').filter(Boolean).pop()?.toLowerCase() || ''; } catch { /* No key. */ }
  if (!key) return false;
  // Bios may arrive with line breaks flattened to spaces, so sentence endings also separate segments.
  const lines = bio.split(/\n+|(?<=[.!?])\s+/);
  return lines.some((line, index) => {
    const at = line.toLowerCase().indexOf(key); if (at < 0) return false;
    // The link's own label: text after the previous link up to this one; if the link stands alone, the segment before it.
    const pieces = line.slice(0, at + key.length).split(/https?:\/\/\S+|\b(?:[a-z\d-]+\.)+[a-z]{2,}\/\S+/i);
    const label = pieces.slice(-2).join(' ').trim();
    return hasCaution(label.length >= 3 ? label : `${lines[index - 1] || ''} ${label}`);
  });
}
function inExampleBlock(node) {
  for (let parent = node.parentNode, depth = 0; parent && depth++ < 30; parent = parent.parentNode) if (['pre', 'code', 'kbd', 'samp'].includes(parent.tagName)) return true;
  return false;
}
function nearbyText(node) {
  const parent = ['p', 'li', 'div', 'span'].includes(node.parentNode?.tagName) ? node.parentNode : node;
  const pending = [parent]; let text = '', visited = 0;
  while (pending.length && visited++ < 100 && text.length < 1200) {
    const item = pending.pop(); if (['script', 'style'].includes(item.tagName)) continue;
    if (item.nodeName === '#text') text += ` ${String(item.value || '').slice(0, 400)}`;
    if (item.tagName === 'img') text += ` ${item.attrs?.find(attr => attr.name === 'alt')?.value || ''}`;
    if (item.childNodes) for (let i = item.childNodes.length - 1; i >= 0; i--) pending.push(item.childNodes[i]);
  }
  return text.slice(0, 1200);
}
function extractHtmlEvidence(html, baseUrl) {
  const payments = new Set(), cautionedPayments = new Set(), authors = new Set(), identities = new Set(), githubProfiles = new Set(), schemaIdentities = new Set(), contacts = new Set(), publicContacts = new Map(); const pending = [parse(html)]; let schemaScripts = 0; let authorName = '';
  const baseOrigin = new URL(baseUrl).origin;
  while (pending.length) {
    const node = pending.pop();
    if (['a', 'area', 'link'].includes(node.tagName)) {
      const attr = name => node.attrs?.find(item => item.name === name)?.value || '';
      const href = attr('href'); const rel = attr('rel').toLowerCase().split(/\s+/); const prop = attr('itemprop').toLowerCase().split(/\s+/);
      if (href && ['a', 'area'].includes(node.tagName) && !inExampleBlock(node)) {
        const link = safePayPalURL(href, baseUrl) || supportURL(href, baseUrl);
        if (link && (payments.has(link) || payments.size < 21)) { payments.add(link); if (hasCaution(nearbyText(node))) cautionedPayments.add(link); }
      }
      if (href && authors.size < 5 && ['a', 'link'].includes(node.tagName) && (rel.includes('author') || prop.includes('author'))) {
        try { const url = publicURL(new URL(href, baseUrl).href).href; if (url !== baseUrl) authors.add(url); } catch { /* Skip unsafe declarations. */ }
      }
      // Every GitHub account page this document links to, so a caller can tell "links to exactly one" from "links to several".
      if (href && node.tagName === 'a' && githubProfiles.size < 30) { const login = /^https:\/\/(?:www\.)?github\.com\/([a-z\d](?:[a-z\d-]{0,37}[a-z\d])?)\/?$/i.exec(href.trim())?.[1]; if (login) githubProfiles.add(login.toLowerCase()); }
      if (href && identities.size < 10 && ['a', 'link'].includes(node.tagName) && (rel.includes('me') || prop.includes('sameas'))) {
        try { const url = publicURL(new URL(href, baseUrl).href).href; if (url !== baseUrl) identities.add(url); } catch { /* Skip unsafe declarations. */ }
      }
      if (href && publicContacts.size < 4 && node.tagName === 'a') {
        const contact = maskContactHref(href); if (contact) publicContacts.set(`${contact.type}|${contact.value}`, contact);
      }
      if (href && contacts.size < 3 && node.tagName === 'a') {
        const text = (node.childNodes || []).filter(child => child.nodeName === '#text').map(child => child.value || '').join(' ').trim();
        if (rel.includes('contact') || /^contact(?:\s+(?:me|us))?$/i.test(text)) {
          try { const url = publicURL(new URL(href, baseUrl).href); if (url.origin === baseOrigin) contacts.add(url.href); } catch { /* Skip unsafe declarations. */ }
        }
      }
    }
    // Many link-in-bio and commission pages (Carrd, for example) write "paypal.me/name" as plain text instead of a link.
    if (node.nodeName === '#text' && payments.size < 21 && tipTextPattern.test(node.value || '') && !['script', 'style', 'noscript', 'textarea', 'title'].includes(node.parentNode?.tagName) && !inExampleBlock(node)) {
      for (const link of textPaymentLinks(String(node.value).slice(0, 2000))) { payments.add(link); if (hasCaution(nearbyText(node))) cautionedPayments.add(link); }
    }
    if (node.tagName === 'meta') {
      // Credits a page declares in its head: the author's name and the X account of its creator.
      const attr = name => node.attrs?.find(item => item.name === name)?.value || ''; const key = (attr('name') || attr('property')).toLowerCase(); const content = attr('content').trim();
      if (key === 'author' && content && !authorName) authorName = content.slice(0, 120);
      const handle = key === 'twitter:creator' && /^@?([a-z\d_]{1,15})$/i.exec(content);
      if (handle && authors.size < 5) authors.add(`https://x.com/${handle[1]}`);
      // Open Graph article credit: a profile URL, or sometimes just a name.
      if (key === 'article:author' && content) {
        if (/^https:\/\//i.test(content)) { try { if (authors.size < 5) authors.add(publicURL(content).href); } catch { /* Skip unsafe declarations. */ } }
        else if (!authorName) authorName = content.slice(0, 120);
      }
    }
    if (node.tagName === 'script' && schemaScripts < 3 && node.attrs?.some(attr => attr.name === 'type' && attr.value.toLowerCase().split(';')[0].trim() === 'application/ld+json')) {
      schemaScripts++;
      const text = (node.childNodes || []).filter(child => child.nodeName === '#text').map(child => child.value || '').join('');
      for (const url of schemaPersonLinks(text, baseUrl)) if (schemaIdentities.size < 10) schemaIdentities.add(url);
    }
    if (node.childNodes) for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push(node.childNodes[i]);
  }
  return { payments: [...payments], cautionedPayments, authorName, authors: [...authors], identities: [...identities], githubProfiles: [...githubProfiles], schemaIdentities: [...schemaIdentities], contacts: [...contacts], publicContacts: [...publicContacts.values()] };
}
export function htmlPaymentLinks(html, baseUrl) { return extractHtmlEvidence(html, baseUrl).payments; }
export function declaredIdentityLinks(html, baseUrl) { return extractHtmlEvidence(html, baseUrl).identities; }
export function declaredContactLinks(html, baseUrl) { return extractHtmlEvidence(html, baseUrl).contacts; }
function evidenceHash(text) { return `sha256:${createHash('sha256').update(text).digest('hex')}`; }
function contactCandidate(link, sourceUrl, target, platformUserId, now, sourceHash, association = 'unverified_page') {
  return { platform: target.platform, platform_user_id: platformUserId, profile_url: target.profileUrl, candidate_type: 'contact_url', candidate_value: link,
    source_url: sourceUrl, retrieval_url: sourceUrl, evidence_type: 'public_contact_link', evidence_excerpt_or_hash: sourceHash,
    evidence_excerpt: `Extracted same-origin contact link (normalized): ${link}`, observed_at: now, checked_at: now,
    identity_association_status: association, contact_reliability_status: 'not_independently_verified', payment_authorization_status: 'not_authorized', verification_method: 'public HTML inspection', decision: 'potential_contact',
    reason: 'The page links to this contact page. Its association with the person, account ownership and permission to pay are not independently verified.' };
}
function maskedContactCandidate(contact, sourceUrl, target, platformUserId, now, sourceHash) {
  return { platform: target.platform, platform_user_id: platformUserId, profile_url: target.profileUrl, candidate_type: contact.type, candidate_value: contact.value,
    source_url: sourceUrl, retrieval_url: sourceUrl, evidence_type: 'public_contact_link', evidence_excerpt_or_hash: sourceHash,
    evidence_excerpt: `The public page contains an explicit ${contact.type === 'email' ? 'mailto' : 'telephone'} link; the identifier is masked.`, observed_at: now, checked_at: now,
    identity_association_status: 'unverified_page', contact_reliability_status: 'not_independently_verified', payment_authorization_status: 'not_authorized', verification_method: 'public HTML inspection', decision: 'potential_contact',
    reason: 'This public contact is not independently linked to the person, verified as reachable, or proof of a PayPal account or permission to pay.' };
}
function safeExcerpt(text) {
  const source = String(text || '');
  const redacted = source.slice(0, 1200)
    .replace(/\bhttps?:\/\/[^\s<>"']+/gi, match => { try { const url = new URL(match); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.href; } catch { return '[URL omitted]'; } })
    .replace(/([?&][a-z\d._~-]{1,64}=)[^\s&#)]+/gi, '$1[redacted]')
    .replace(/#[^\s<>"']+/g, '#[redacted]')
    .replace(/[a-z\d._%+-]{1,64}@[a-z\d.-]{1,253}\.[a-z]{2,63}/gi, '[email redacted]')
    .replace(/(?<![\w/])\+?\d[\d ()-]{7,30}\d(?!\w)/g, '[number redacted]');
  return redacted.length > 400 || source.length > 1200 ? `${redacted.slice(0, 399)}…` : redacted;
}
function candidate(link, sourceUrl, platform, platformUserId, profileUrl, now, association, sourceHash, type = link.includes('/donate/') || !/^https:\/\/(?:www\.)?paypal\./i.test(link) ? 'other_payment_link' : 'paypal_me', retrievalUrl = sourceUrl, extracted = `Extracted link: ${link}`) {
  return { platform, platform_user_id: platformUserId, profile_url: profileUrl, candidate_type: type, candidate_value: link,
    source_url: sourceUrl, retrieval_url: retrievalUrl, evidence_type: 'creator_published_link', evidence_excerpt_or_hash: sourceHash, evidence_excerpt: safeExcerpt(extracted),
    observed_at: now, checked_at: now, identity_association_status: association, contact_reliability_status: 'not_independently_verified',
    payment_authorization_status: 'not_authorized', verification_method: 'public-source inspection only',
    decision: ['direct_profile', 'linked_creator_site', 'keybase_linked_account', 'mutual_link_account', 'listed_account'].includes(association) ? 'published_payment_link' : 'potential_contact',
    reason: association === 'direct_profile' ? 'The public profile or its funding file lists this link; account ownership has not been independently verified.' : association === 'linked_creator_site' ? 'A website linked from the public profile lists this link; its ownership and payment account ownership have not been independently verified.' : 'The page lists this link, but the identity association has not been independently verified.' };
}

// funding.json (fundingjson.org): a site owner's own machine-readable list of funding channels at /funding.json.
// Accepted only if its entity web page is on this same site; bank, cheque and cash details are never collected.
export function fundingManifest(text, siteUrl) {
  let data; try { data = JSON.parse(String(text).slice(0, 200000)); } catch { return null; }
  const host = new URL(siteUrl).hostname.toLowerCase().replace(/^www\./, '');
  const entity = data?.entity; let entityHost = '';
  try { entityHost = new URL(entity?.webpageUrl?.url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
  if (!Array.isArray(data?.funding?.channels)) return null;
  if (host === 'github.com') {
    // On GitHub the site is shared, so the entity page must be this same account: github.com/<login>/... or <login>.github.io.
    const login = new URL(siteUrl).pathname.split('/')[1]?.toLowerCase();
    const named = entityHost === 'github.com' ? new URL(entity.webpageUrl.url).pathname.split('/')[1]?.toLowerCase() : /^([a-z\d-]+)\.github\.io$/.exec(entityHost)?.[1];
    if (!login || named !== login) return null;
  } else if (entityHost !== host) return null;
  const links = data.funding.channels.slice(0, 20).filter(c => ['payment-provider', 'other'].includes(c?.type) && typeof c.address === 'string' && c.address.length <= 250)
    .flatMap(c => paypalLinks(c.address).length ? paypalLinks(c.address).slice(0, 1) : [supportURL(c.address.trim())].filter(Boolean));
  return { name: typeof entity.name === 'string' ? entity.name.trim().slice(0, 100) : '', links: [...new Set(links)].slice(0, 8) };
}

function cautionCandidate(item) { return { ...item, decision: 'potential_contact', reason: `${item.reason} Nearby source text contains cautionary or example language; do not assume this link is an endorsed destination.` }; }
function applyContextCaution(item, extracted) { return extracted.cautionedPayments.has(item.candidate_value) ? cautionCandidate(item) : item; }

export async function resolvePlatformId(target, options = {}) {
  const fetchSource = options.fetcher || sharedFetch;
  const fetcher = (url, fetchOptions = {}) => fetchSource(url, { ...fetchOptions, shouldContinue: options.shouldContinue });
  if (['reddit', 'facebook', 'youtube'].includes(target.platform) && options.pageProfile) return `handle:${target.username.toLowerCase()}`;
  if (target.platform === 'x') {
    if (options.xProfile) return options.xProfile.id_str;
    const user = xProfile((await fetcher(`https://syndication.twitter.com/srv/timeline-profile/screen-name/${encodeURIComponent(target.username)}`)).text, target.username);
    if (!user) throw new Error('X returned an invalid identity');
    return user.id_str;
  }
  if (target.platform === 'github') {
    const headers = { accept: 'application/vnd.github+json', ...(options.githubToken ? { authorization: `Bearer ${options.githubToken}` } : {}) };
    const result = parseResponse((await fetcher(`https://api.github.com/users/${encodeURIComponent(target.username)}`, { headers })).text, 'GitHub');
    if (!result || !Number.isSafeInteger(result.id) || result.id < 1 || typeof result.login !== 'string' || result.login.toLowerCase() !== target.username.toLowerCase()) throw new Error('GitHub returned an invalid identity');
    return String(result.id);
  }
  // A Stack Overflow profile URL is its numeric account ID, so there is nothing to recheck (and no API request to spend).
  if (target.platform === 'stackoverflow') return target.username;
  if (target.platform === 'reddit') {
    const host = options.redditAccessToken ? 'oauth.reddit.com' : 'www.reddit.com';
    const headers = { accept: 'application/json', ...(options.redditAccessToken ? { authorization: `Bearer ${options.redditAccessToken}` } : {}) };
    const result = parseResponse((await fetcher(`https://${host}/user/${encodeURIComponent(target.username)}/about.json`, { headers })).text, 'Reddit')?.data;
    if (typeof result?.id !== 'string' || !/^[a-z\d]{1,32}$/i.test(result.id) || typeof result.name !== 'string' || result.name.toLowerCase() !== target.username.toLowerCase()) throw new Error('Reddit returned an invalid identity');
    return result.id;
  }
  return null;
}
export function staleCacheResult(value) {
  return { ...value, status: value.candidates.length ? 'Potential contact — unverified' : 'No safe match', identityLinks: [], researchLeads: [], assessments: [],
    candidates: value.candidates.map(c => ({ ...c, identity_association_status: 'stale_profile_link', decision: 'potential_contact', reason: `${c.reason} The current profile ID could not be rechecked; this cached association may be stale.` })),
    warnings: [...value.warnings, 'The current profile ID could not be rechecked. This cached result may refer to an outdated or reassigned username.'] };
}

export async function research(input, options = {}) {
  const target = canonicalProfile(input); const now = new Date().toISOString();
  const ensureActive = () => { if (options.shouldContinue && !options.shouldContinue()) throw new Error('Cache was cleared while this lookup was running; try again.'); };
  const fetchSource = options.fetcher || sharedFetch;
  const fetcher = async (url, fetchOptions = {}) => { ensureActive(); const response = await fetchSource(url, { ...fetchOptions, shouldContinue: options.shouldContinue }); ensureActive(); return response; };
  const reportProgress = options.onProgress || (() => {}); const progress = message => { ensureActive(); reportProgress(message); };
  const candidates = []; const sources = []; const warnings = []; const identityLinks = []; let pageGithub = [];
  let platformUserId = null; let displayName = target.username || new URL(target.profileUrl).hostname; let githubLimited = '';
  const needsContact = () => !candidates.some(candidate => candidate.decision === 'published_payment_link' || ['email', 'phone'].includes(candidate.candidate_type));
  const hasPublishedPayPal = () => candidates.some(item => item.decision === 'published_payment_link' && (item.candidate_type === 'paypal_me' || (item.candidate_type === 'other_payment_link' && /^https:\/\/(?:www\.)?paypal\.com\//i.test(item.candidate_value))));
  const inspectContactPage = async (url, association) => {
    try {
      progress('Checking the explicitly linked contact page…');
      const page = await fetcher(url, { followRedirects: 3 }); if (!page.contentType?.includes('text/html')) throw new Error('Not HTML');
      sources.push(url); const hash = evidenceHash(page.text); const extracted = extractHtmlEvidence(page.text, url);
      for (const contact of extracted.publicContacts) candidates.push(maskedContactCandidate(contact, url, target, platformUserId, now, hash));
      for (const link of extracted.payments) candidates.push(applyContextCaution(candidate(link, url, target.platform, platformUserId, target.profileUrl, now, association, hash, undefined, url, `Extracted contact-page HTML anchor href (normalized): ${link}`), extracted));
    } catch { warnings.push('The explicitly linked contact page could not be safely checked.'); }
  };
  let refused = null;
  try {
  if (target.platform === 'github') {
    const apiUrl = `https://api.github.com/users/${encodeURIComponent(target.username)}`;
    const headers = { accept: 'application/vnd.github+json', ...(options.githubToken ? { authorization: `Bearer ${options.githubToken}` } : {}) };
    progress('Checking the public GitHub profile…');
    let response; let limited = '';
    try { response = await fetcher(apiUrl, { headers }); }
    catch (error) { if (/HTTP 4(?:03|29)/.test(error?.message || '')) {
        const wait = /resets in (\d+) min/.exec(error.message);
        limited = wait ? `GitHub's hourly request limit for this computer is used up (it resets in about ${wait[1]} minute${wait[1] === '1' ? '' : 's'}; a GitHub token raises the limit)` : 'GitHub denied or rate-limited this request';
        platformLimits.github = Date.now() + (wait ? Number(wait[1]) : 10) * 60000;
      } else { if (/HTTP 401/.test(error?.message || '') && options.githubToken) throw new Error('GitHub rejected the configured token; check its validity and access.'); throw error; } }
    // Fallback when the API allowance is used up: what the profile page in the user's browser shows (if supplied), plus the
    // account's public README and funding files, which are plain file downloads and do not use that allowance.
    const page = limited ? options.pageProfile : null; githubLimited = limited; if (!limited) platformLimits.github = 0;
    const user = limited ? { id: 0, login: target.username, name: page?.name || '', bio: page?.description || '', links: page?.links || [], repos: page?.repos || [],
      blog: (page?.links || []).find(link => !safePayPalURL(link) && !supportURL(link) && !/^https?:\/\/(?:[\w-]+\.)*github\.com\//i.test(link)) || '' } : parseResponse(response.text, 'GitHub');
    const profileHash = evidenceHash(limited ? JSON.stringify(user) : response.text); target.etag = limited ? '' : response.etag || '';
    if (limited) warnings.push(page ? `${limited}, so this profile was read from the page in your browser and from its public files; the account ID was not confirmed.` : `${limited}, so only this account's public files and Sponsors page were checked. Click the icon again to include the bio and website from their profile page.`);
    if (!limited && (!user || !Number.isSafeInteger(user.id) || user.id < 1 || typeof user.login !== 'string' || !/^[a-z\d-]{1,39}$/i.test(user.login) || user.login.toLowerCase() !== target.username.toLowerCase())) throw new Error('GitHub returned an invalid user record');
    platformUserId = limited ? `handle:${user.login.toLowerCase()}` : String(user.id); displayName = String(user.name || user.login).slice(0, 120);
    target.username = user.login; target.profileUrl = `https://github.com/${user.login}`;
    sources.push(target.profileUrl);
    for (const link of textPaymentLinks(`${user.bio || ''}\n${user.blog || ''}\n${(user.links || []).join('\n')}`)) {
      const item = candidate(link, target.profileUrl, target.platform, platformUserId, target.profileUrl, now, 'direct_profile', profileHash, undefined, apiUrl, `GitHub profile bio: ${user.bio || ''}; profile website: ${user.blog || ''}`);
      candidates.push(bioCaution(user.bio, link) ? cautionCandidate(item) : item);
    }
    if (typeof user.email === 'string' && user.email.length <= 254 && /^[^\s@]{1,64}@[a-z\d.-]+\.[a-z]{2,}$/i.test(user.email)) {
      const [local, domain] = user.email.split('@');
      candidates.push({ platform: target.platform, platform_user_id: platformUserId, profile_url: target.profileUrl, candidate_type: 'email', candidate_value: `${local[0]}***@${domain}`, source_url: target.profileUrl, retrieval_url: apiUrl, evidence_type: 'public_profile_contact', evidence_excerpt_or_hash: profileHash, observed_at: now, checked_at: now, identity_association_status: 'direct_profile', contact_reliability_status: 'not_independently_verified', payment_authorization_status: 'not_authorized', verification_method: 'public GitHub user API', decision: 'potential_contact', reason: 'This is a publicly listed contact, not proof of a PayPal account or permission to pay. The address is masked.' });
    }
    // GitHub renders this README on the user's profile only when owner and repository names match.
    const readmeApi = `https://api.github.com/repos/${encodeURIComponent(user.login)}/${encodeURIComponent(user.login)}/readme`;
    // The README is first read as a plain file download, which costs none of GitHub's hourly API allowance. The API is asked
    // only when that file is absent (a README under another name or format), and never while the allowance is used up.
    let readmeRead = false;
    {
      try {
        progress('Checking the profile README file…');
        const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(user.login)}/${encodeURIComponent(user.login)}/HEAD/README.md`;
        const readme = await fetcher(rawUrl); const readmeUrl = `https://github.com/${encodeURIComponent(user.login)}/${encodeURIComponent(user.login)}#readme`;
        // Markdown source rather than rendered HTML: drop code samples, then read the links it names.
        const text = readme.text.slice(0, 100000).replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
        sources.push(readmeUrl); readmeRead = true;
        for (const link of textPaymentLinks(text)) { const item = candidate(link, readmeUrl, target.platform, platformUserId, target.profileUrl, now, 'direct_profile', evidenceHash(readme.text), undefined, rawUrl, `Profile README lists: ${link}`); candidates.push(bioCaution(text, link) ? cautionCandidate(item) : item); }
      } catch { /* No profile README; most accounts have none. */ }
    }
    if (!limited && !readmeRead) try {
      progress('Checking the profile README…');
      const readme = await fetcher(readmeApi, { headers: { ...headers, accept: 'application/vnd.github.html+json' } });
      if (!readme.contentType?.includes('text/html') && !readme.contentType?.includes('application/vnd.github.html+json')) throw new Error('README was not returned as HTML');
      const readmeUrl = `https://github.com/${encodeURIComponent(user.login)}/${encodeURIComponent(user.login)}#readme`; const readmeHash = evidenceHash(readme.text);
      sources.push(readmeUrl);
      const extracted = extractHtmlEvidence(readme.text, readmeUrl);
      for (const link of extracted.payments) candidates.push(applyContextCaution(candidate(link, readmeUrl, target.platform, platformUserId, target.profileUrl, now, 'direct_profile', readmeHash, undefined, readmeApi, `Extracted README HTML anchor href (normalized): ${link}`), extracted));
    } catch { warnings.push('The profile README could not be checked or does not exist.'); }
    // Funding files the profile owner controls: their .github repository, then (only if that
    // listed nothing) their own most-starred non-fork repository.
    const readFunding = async (fundingUrl, displayUrl) => {
      const funding = await fetcher(fundingUrl);
      if (Buffer.byteLength(funding.text, 'utf8') > 16384) throw new Error('Funding file exceeds size limit');
      sources.push(displayUrl);
      const data = parseYAML(funding.text, { schema: 'failsafe', maxAliasCount: 0, mapAsMap: true, logLevel: 'error' }); const fundingHash = evidenceHash(funding.text);
      if (!(data instanceof Map)) throw new Error('Invalid funding document');
      const values = value => Array.isArray(value) ? value.slice(0, 4) : [value];
      const add = (link, type, excerpt) => candidates.push(candidate(link, displayUrl, target.platform, platformUserId, target.profileUrl, now, 'direct_profile', fundingHash, type, fundingUrl, excerpt));
      for (const value of values(data.get('custom'))) {
        const link = typeof value === 'string' && safePayPalURL(value);
        if (link) add(link, undefined, `Parsed FUNDING.yml custom entry: ${value}`);
      }
      // Other funding platforms GitHub documents for FUNDING.yml; each needs a plain account name.
      const platforms = { ko_fi: 'https://ko-fi.com/', patreon: 'https://www.patreon.com/', open_collective: 'https://opencollective.com/', buy_me_a_coffee: 'https://buymeacoffee.com/', liberapay: 'https://liberapay.com/' };
      for (const [key, base] of Object.entries(platforms)) for (const value of values(data.get(key))) {
        if (typeof value === 'string' && /^[a-z\d][a-z\d_-]{0,59}$/i.test(value)) add(`${base}${value}`, 'other_payment_link', `Parsed FUNDING.yml ${key} entry: ${value}`);
      }
      // Only recognize GitHub Sponsors entries naming this same profile.
      if (values(data.get('github')).some(value => typeof value === 'string' && value.toLowerCase() === user.login.toLowerCase())) add(`https://github.com/sponsors/${user.login}`, 'other_payment_link', `Parsed FUNDING.yml github entry: ${user.login}`);
    };
    const login = encodeURIComponent(user.login);
    try {
      progress('Checking the public funding file…');
      await readFunding(`https://raw.githubusercontent.com/${login}/.github/HEAD/FUNDING.yml`, `https://github.com/${login}/.github/blob/HEAD/FUNDING.yml`);
    } catch { warnings.push('The public profile funding file could not be checked or does not exist.'); }
    // funding.json (fundingjson.org) in the same places; only accepted when it names this same GitHub account.
    const readFundingJson = async (rawUrl, displayUrl) => {
      const manifest = fundingManifest((await fetcher(rawUrl)).text, target.profileUrl);
      if (!manifest?.links.length) return;
      sources.push(displayUrl);
      for (const link of manifest.links) candidates.push(candidate(link, displayUrl, target.platform, platformUserId, target.profileUrl, now, 'direct_profile', evidenceHash(link), undefined, rawUrl, `funding.json channel: ${link}`));
    };
    // npm's package.json has a "funding" field (a URL, { url }, or a list of either). In a repository this account owns,
    // that is the owner's own statement. Only recognised payment and support links are taken, and a link naming another
    // GitHub Sponsors account is ignored.
    const readPackageFunding = async (rawUrl, displayUrl) => {
      const file = await fetcher(rawUrl); if (Buffer.byteLength(file.text, 'utf8') > 200000) return;
      let funding; try { funding = JSON.parse(file.text)?.funding; } catch { return; }
      const found = [];
      for (const entry of (Array.isArray(funding) ? funding : [funding]).slice(0, 6)) {
        const value = typeof entry === 'string' ? entry : entry && typeof entry.url === 'string' ? entry.url : '';
        const link = value && (safePayPalURL(value) || supportURL(value));
        if (!link || found.includes(link)) continue;
        const other = /^https:\/\/github\.com\/sponsors\/([^/]+)$/i.exec(link); if (other && other[1].toLowerCase() !== login.toLowerCase()) continue;
        found.push(link);
      }
      if (!found.length) return;
      sources.push(displayUrl);
      for (const link of found) candidates.push(candidate(link, displayUrl, target.platform, platformUserId, target.profileUrl, now, 'direct_profile', evidenceHash(file.text), undefined, rawUrl, `package.json funding entry: ${link}`));
    };
    if (!candidates.some(item => item.decision === 'published_payment_link')) {
      try { await readFundingJson(`https://raw.githubusercontent.com/${login}/.github/HEAD/funding.json`, `https://github.com/${login}/.github/blob/HEAD/funding.json`); } catch { /* Most accounts have none. */ }
    }
    if (!candidates.some(item => item.decision === 'published_payment_link')) {
      try {
        progress('Checking the funding file of their most-starred repository…');
        const search = await fetcher(`https://api.github.com/search/repositories?q=${encodeURIComponent(`user:${user.login} fork:false`)}&sort=stars&order=desc&per_page=1`, { headers, keepQuery: true });
        const repo = parseResponse(search.text, 'GitHub')?.items?.[0];
        if (repo && repo.fork === false && (limited ? String(repo.owner?.login || '').toLowerCase() === user.login.toLowerCase() : repo.owner?.id === user.id) && typeof repo.name === 'string' && /^[\w.-]{1,100}$/.test(repo.name) && repo.name !== '.github') {
          const name = encodeURIComponent(repo.name);
          try { await readFunding(`https://raw.githubusercontent.com/${login}/${name}/HEAD/.github/FUNDING.yml`, `https://github.com/${login}/${name}/blob/HEAD/.github/FUNDING.yml`); } catch { /* Try funding.json below. */ }
          for (const file of ['.github/funding.json', 'funding.json']) {
            if (candidates.some(item => item.decision === 'published_payment_link')) break;
            try { await readFundingJson(`https://raw.githubusercontent.com/${login}/${name}/HEAD/${file}`, `https://github.com/${login}/${name}/blob/HEAD/${file}`); } catch { /* Not present. */ }
          }
          if (!candidates.some(item => item.decision === 'published_payment_link')) { try { await readPackageFunding(`https://raw.githubusercontent.com/${login}/${name}/HEAD/package.json`, `https://github.com/${login}/${name}/blob/HEAD/package.json`); } catch { /* Not an npm project. */ } }
        }
      } catch { /* Most repositories have no funding file; absence is not worth a warning. */ }
    }
    // Without the API there may be no repository search; try the repositories pinned on the profile page instead.
    if (limited) for (const repoName of user.repos) {
      if (candidates.some(item => item.decision === 'published_payment_link')) break;
      const name = encodeURIComponent(repoName);
      try { await readFunding(`https://raw.githubusercontent.com/${login}/${name}/HEAD/.github/FUNDING.yml`, `https://github.com/${login}/${name}/blob/HEAD/.github/FUNDING.yml`); } catch { /* Try funding.json. */ }
      for (const file of ['.github/funding.json', 'funding.json']) {
        if (candidates.some(item => item.decision === 'published_payment_link')) break;
        try { await readFundingJson(`https://raw.githubusercontent.com/${login}/${name}/HEAD/${file}`, `https://github.com/${login}/${name}/blob/HEAD/${file}`); } catch { /* Not present. */ }
      }
      if (!candidates.some(item => item.decision === 'published_payment_link')) { try { await readPackageFunding(`https://raw.githubusercontent.com/${login}/${name}/HEAD/package.json`, `https://github.com/${login}/${name}/blob/HEAD/package.json`); } catch { /* Not an npm project. */ } }
    }
    // GitHub Sponsors: github.com/sponsors/<login> is that same account's own page. It exists only if they enabled Sponsors
    // (otherwise GitHub redirects to the profile, which is not followed). One ordinary page request; no API allowance used.
    const sponsorsUrl = `https://github.com/sponsors/${user.login}`;
    if (!candidates.some(item => item.candidate_value.toLowerCase() === sponsorsUrl.toLowerCase())) {
      try {
        progress('Checking for a GitHub Sponsors page…');
        const sponsors = await fetcher(sponsorsUrl);
        const title = /<title>([^<]{0,200})<\/title>/i.exec(sponsors.text.slice(0, 20000))?.[1] || '';
        if (new RegExp(`^Sponsor @${user.login.replace(/[^a-z\d-]/gi, '')} on GitHub Sponsors`, 'i').test(title.trim())) {
          sources.push(sponsorsUrl);
          candidates.push({ ...candidate(sponsorsUrl, sponsorsUrl, target.platform, platformUserId, target.profileUrl, now, 'direct_profile', evidenceHash(title), 'other_payment_link', sponsorsUrl, `GitHub page title: ${title.trim()}`), reason: 'This account has its own GitHub Sponsors page; payouts go to whoever controls the account.' });
        }
      } catch { /* No Sponsors page (GitHub redirects to the profile) or it could not be read. */ }
    }
    if (typeof user.blog === 'string' && user.blog.trim()) {
      try {
        const blog = user.blog.trim().match(/^https?:\/\//i) ? user.blog.trim() : `https://${user.blog.trim()}`;
        const directPayment = safePayPalURL(blog); const site = publicURL(blog);
        if (directPayment) {
          const item = candidate(directPayment, target.profileUrl, target.platform, platformUserId, target.profileUrl, now, 'direct_profile', profileHash, undefined, apiUrl, `GitHub profile website: ${user.blog}`);
          candidates.push(bioCaution(user.bio, directPayment) ? cautionCandidate(item) : item);
        } else {
          identityLinks.push({ url: site.href, source_url: target.profileUrl, relation: 'website listed on GitHub profile' });
          if (!hasPublishedPayPal()) {
            progress('Checking the profile-linked website…');
            const page = await fetcher(site.href, { followRedirects: 3 });
            if (!page.contentType?.includes('text/html')) throw new Error('Not HTML');
            sources.push(site.href); const siteHash = evidenceHash(page.text); const extracted = extractHtmlEvidence(page.text, site.href);
            for (const url of extracted.identities) identityLinks.push({ url, source_url: site.href, relation: 'rel=me or Schema.org sameAs link declared by linked website' });
            for (const url of extracted.schemaIdentities) identityLinks.push({ url, source_url: site.href, relation: 'Schema.org Person sameAs on linked website; association not established' });
            for (const link of extracted.contacts) candidates.push(contactCandidate(link, site.href, target, platformUserId, now, siteHash, 'linked_creator_site'));
            for (const contact of extracted.publicContacts) candidates.push(maskedContactCandidate(contact, site.href, target, platformUserId, now, siteHash));
            for (const link of extracted.payments) candidates.push(applyContextCaution(candidate(link, site.href, target.platform, platformUserId, target.profileUrl, now, 'linked_creator_site', siteHash, undefined, site.href, `Extracted linked-site HTML anchor href (normalized): ${link}`), extracted));
            const contactUrl = extracted.contacts.find(link => link !== site.href);
            if (contactUrl && needsContact()) await inspectContactPage(contactUrl, 'linked_creator_site');
          }
        }
      } catch { warnings.push('The website linked from the profile could not be safely checked.'); }
    }
  } else if (target.platform === 'stackoverflow') {
    // Official Stack Exchange API (no key; 300 requests a day per address). The filter adds the profile's "about me" HTML.
    const api = `https://api.stackexchange.com/2.3/users/${encodeURIComponent(target.username)}?site=stackoverflow&filter=!SyjNqbwGU2NWZ1y5pj`;
    progress('Checking the public Stack Overflow profile…');
    let response; let fromPage = null;
    try {
      // The API said to stay away for a while (its "backoff" field, or a daily quota of zero): do not call it until then.
      if (platformLimits.stackoverflowBackoff > Date.now()) throw new Error('Remote source returned HTTP 429');
      response = await fetcher(api, { keepQuery: true });
      const body = parseResponse(response.text, 'Stack Overflow');
      if (Number.isFinite(body?.backoff) && body.backoff > 0) platformLimits.stackoverflowBackoff = Date.now() + Math.min(body.backoff, 3600) * 1000;
      // The daily quota refills at midnight UTC.
      if (body?.quota_remaining === 0) platformLimits.stackoverflowBackoff = Math.max(platformLimits.stackoverflowBackoff, new Date().setUTCHours(24, 0, 0, 0));
    }
    catch (error) {
      // Fallback when the API is over its daily allowance or unavailable: what the profile page in the user's browser shows.
      platformLimits.stackoverflow = Date.now() + 10 * 60000;
      if (options.pageProfile) fromPage = options.pageProfile;
      else throw new Error(/HTTP 4(?:00|29)|HTTP 502/.test(error?.message || '') ? 'Stack Overflow is limiting public API requests from this computer. Click the icon again to read their profile page in your browser instead, or try again later.' : 'Stack Overflow did not return this public profile.'); }
    const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const user = fromPage ? { user_id: target.username, display_name: fromPage.name || target.username, website_url: fromPage.website || '',
      about_me: `<p>${escapeHtml(fromPage.description)}</p>${fromPage.links.map(link => `<a href="${escapeHtml(link)}">${escapeHtml(link)}</a>`).join(' ')}` } : parseResponse(response.text, 'Stack Overflow')?.items?.[0];
    if (!fromPage) platformLimits.stackoverflow = 0;
    if (fromPage) warnings.push('Stack Overflow\'s public API was unavailable or over its daily allowance, so this profile was read from the page in your browser; its account ID was not confirmed.');
    if (!user || String(user.user_id) !== target.username) throw new Error('Stack Overflow returned no public profile for this user ID.');
    platformUserId = fromPage ? `handle:${target.username}` : String(user.user_id); displayName = String(user.display_name || target.username).replace(/&#39;/g, "'").replace(/&amp;/g, '&').slice(0, 120);
    sources.push(target.profileUrl);
    const about = typeof user.about_me === 'string' ? user.about_me.slice(0, 20000) : '';
    const site = typeof user.website_url === 'string' && user.website_url.length <= 2048 ? user.website_url.trim().replace(/^http:\/\//i, 'https://') : '';
    const profileHash = evidenceHash(`${about}\n${site}`);
    const extracted = extractHtmlEvidence(about, target.profileUrl);
    const listed = new Set([...extracted.payments, ...textPaymentLinks(site), ...(supportURL(site) ? [supportURL(site)] : [])]);
    for (const link of listed) candidates.push(applyContextCaution(candidate(link, target.profileUrl, target.platform, platformUserId, target.profileUrl, now, 'direct_profile', profileHash, undefined, api, `Stack Overflow profile "about me" or website field: ${link}`), extracted));
    for (const url of extracted.identities) identityLinks.push({ url, source_url: target.profileUrl, relation: 'rel=me link in Stack Overflow profile' });
    if (site && !safePayPalURL(site) && !supportURL(site)) {
      try {
        const linked = publicURL(site);
        identityLinks.push({ url: linked.href, source_url: target.profileUrl, relation: 'website listed on Stack Overflow profile' });
        if (!hasPublishedPayPal()) {
          progress('Checking the profile-linked website…');
          const page = await fetcher(linked.href, { followRedirects: 3 });
          if (!page.contentType?.includes('text/html')) throw new Error('Not HTML');
          sources.push(linked.href); const siteHash = evidenceHash(page.text); const fromSite = extractHtmlEvidence(page.text, linked.href);
          for (const url of fromSite.identities) identityLinks.push({ url, source_url: linked.href, relation: 'rel=me or Schema.org sameAs link declared by linked website' });
          for (const link of fromSite.contacts) candidates.push(contactCandidate(link, linked.href, target, platformUserId, now, siteHash, 'linked_creator_site'));
          for (const contact of fromSite.publicContacts) candidates.push(maskedContactCandidate(contact, linked.href, target, platformUserId, now, siteHash));
          for (const link of fromSite.payments) candidates.push(applyContextCaution(candidate(link, linked.href, target.platform, platformUserId, target.profileUrl, now, 'linked_creator_site', siteHash, undefined, linked.href, `Extracted linked-site HTML anchor href (normalized): ${link}`), fromSite));
        }
      } catch { warnings.push('The website linked from the profile could not be safely checked.'); }
    }
  } else if (target.platform === 'x') {
    // X's public embed endpoint: the same profile data any embedded timeline shows, no login.
    const api = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${encodeURIComponent(target.username)}`;
    progress('Checking the public X profile…');
    let user = options.xProfile;
    if (!user) {
      let response;
      try { response = await fetcher(api); }
      catch (error) { throw new Error(/HTTP 429/.test(error?.message || '') ? 'X is rate-limiting public profile requests from this computer. Try again in a few minutes.' : 'X did not return this public profile; it may be protected, suspended or missing.'); }
      user = xProfile(response.text, target.username);
    }
    if (!user) throw new Error('X returned no public posts for this profile, so its bio could not be read without signing in.');
    platformUserId = user.id_str; displayName = String(user.name || user.screen_name).slice(0, 120);
    if (user.id_str.startsWith('handle:')) warnings.push('This X profile was read from the page you were viewing; its account ID was not confirmed.');
    target.username = user.screen_name; target.profileUrl = `https://x.com/${user.screen_name}`; sources.push(target.profileUrl);
    const profileHash = evidenceHash(JSON.stringify({ id: user.id_str, description: user.description, entities: user.entities }));
    const bio = typeof user.description === 'string' ? user.description.slice(0, 1000) : '';
    const expanded = [...(user.entities?.url?.urls || []), ...(user.entities?.description?.urls || [])].slice(0, 8).map(item => item?.expanded_url).filter(item => typeof item === 'string' && item.length <= 2048).map(item => item.replace(/^http:\/\//i, 'https://'));
    const listed = new Set([...textPaymentLinks(`${bio}\n${expanded.join('\n')}`), ...expanded.map(link => supportURL(link)).filter(Boolean)]);
    for (const link of listed) {
      const item = candidate(link, target.profileUrl, target.platform, platformUserId, target.profileUrl, now, 'direct_profile', profileHash, undefined, api, `X profile bio: ${bio}; profile links: ${expanded.join(' ')}`);
      candidates.push(bioCaution(bio, link) ? cautionCandidate(item) : item);
    }
    // One website is read. A site's home page is preferred over a deeper page (a bio link to one section, say), since the home page is where people name their other accounts.
    const websites = expanded.filter(link => !safePayPalURL(link) && !supportURL(link));
    const website = preferHome(websites);
    if (website) {
      try {
        const site = publicURL(website);
        identityLinks.push({ url: site.href, source_url: target.profileUrl, relation: 'website listed on X profile' });
        if (!hasPublishedPayPal()) {
          progress('Checking the profile-linked website…');
          const page = await fetcher(site.href, { followRedirects: 3 });
          if (!page.contentType?.includes('text/html')) throw new Error('Not HTML');
          sources.push(site.href); const siteHash = evidenceHash(page.text); const extracted = extractHtmlEvidence(page.text, site.href);
          for (const url of extracted.identities) identityLinks.push({ url, source_url: site.href, relation: 'rel=me or Schema.org sameAs link declared by linked website' });
          for (const link of extracted.contacts) candidates.push(contactCandidate(link, site.href, target, platformUserId, now, siteHash, 'linked_creator_site'));
          for (const contact of extracted.publicContacts) candidates.push(maskedContactCandidate(contact, site.href, target, platformUserId, now, siteHash));
          for (const link of extracted.payments) candidates.push(applyContextCaution(candidate(link, site.href, target.platform, platformUserId, target.profileUrl, now, 'linked_creator_site', siteHash, undefined, site.href, `Extracted linked-site HTML anchor href (normalized): ${link}`), extracted));
        }
      } catch { warnings.push('The website linked from the profile could not be safely checked.'); }
    }
  } else if (target.platform === 'youtube' && !options.pageProfile) {
    // YouTube answers outside requests with a cookie-consent page; the channel is read in the user's own browser instead.
    throw new Error('YouTube channels are read from your browser: hover the channel name and click Tip, or open the channel and use Use current page.');
  } else if (['reddit', 'facebook', 'youtube'].includes(target.platform) && options.pageProfile) {
    const site = { reddit: 'Reddit', facebook: 'Facebook', youtube: 'YouTube' }[target.platform];
    progress(`Reading the ${site} profile you were viewing…`);
    const { description, links } = options.pageProfile; platformUserId = `handle:${target.username.toLowerCase()}`; sources.push(target.profileUrl);
    const profileHash = evidenceHash(JSON.stringify(options.pageProfile));
    const listed = new Set([...textPaymentLinks(`${description}\n${links.join('\n')}`), ...links.map(link => supportURL(link)).filter(Boolean)]);
    for (const link of listed) {
      const item = candidate(link, target.profileUrl, target.platform, platformUserId, target.profileUrl, now, 'direct_profile', profileHash, undefined, target.profileUrl, `${site} profile description: ${description}; profile links: ${links.join(' ')}`);
      candidates.push(bioCaution(description, link) ? cautionCandidate(item) : item);
    }
    // Like X: follow one website the bio lists (often a link page such as Linktree) when the bio itself names no payment link.
    const website = preferHome(links.filter(link => { try { const host = new URL(link).hostname; return !safePayPalURL(link) && !supportURL(link) && !/(^|\.)(reddit\.com|facebook\.com|fb\.com|youtube\.com|youtu\.be|twitter\.com|x\.com|instagram\.com|tiktok\.com|twitch\.tv|discord\.gg|discord\.com|t\.me|threads\.net|linkedin\.com)$/i.test(host); } catch { return false; } }));
    if (website) {
      try {
        const linked = publicURL(website);
        identityLinks.push({ url: linked.href, source_url: target.profileUrl, relation: `website listed on ${site} profile` });
        if (!hasPublishedPayPal()) {
          progress('Checking the profile-linked website…');
          const page = await fetcher(linked.href, { followRedirects: 3 });
          if (!page.contentType?.includes('text/html')) throw new Error('Not HTML');
          sources.push(linked.href); const siteHash = evidenceHash(page.text); const extracted = extractHtmlEvidence(page.text, linked.href);
          for (const url of extracted.identities) identityLinks.push({ url, source_url: linked.href, relation: 'rel=me or Schema.org sameAs link declared by linked website' });
          for (const link of extracted.contacts) candidates.push(contactCandidate(link, linked.href, target, platformUserId, now, siteHash, 'linked_creator_site'));
          for (const contact of extracted.publicContacts) candidates.push(maskedContactCandidate(contact, linked.href, target, platformUserId, now, siteHash));
          for (const link of extracted.payments) candidates.push(applyContextCaution(candidate(link, linked.href, target.platform, platformUserId, target.profileUrl, now, 'linked_creator_site', siteHash, undefined, linked.href, `Extracted linked-site HTML anchor href (normalized): ${link}`), extracted));
        }
      } catch { warnings.push('The website linked from the profile could not be safely checked.'); }
    }
    warnings.push(`This ${site} profile was read from the page you were viewing; its account ID was not confirmed.`);
  } else if (target.platform === 'reddit') {
    const apiHost = options.redditAccessToken ? 'oauth.reddit.com' : 'www.reddit.com';
    const api = `https://${apiHost}/user/${encodeURIComponent(target.username)}/about.json`;
    progress('Checking the public Reddit profile…');
    let response;
    try { response = await fetcher(api, { headers: { accept: 'application/json', ...(options.redditAccessToken ? { authorization: `Bearer ${options.redditAccessToken}` } : {}) } }); }
    catch (error) { if (/HTTP 403/.test(error?.message || '')) throw new Error('Reddit denied this request. Approved Reddit OAuth access may be required; do not bypass restrictions.'); if (/HTTP 401/.test(error?.message || '') && options.redditAccessToken) throw new Error('Reddit rejected the configured OAuth token; check its expiry and approved access.'); throw error; }
    const data = parseResponse(response.text, 'Reddit')?.data;
    if (!data || typeof data.name !== 'string' || data.name.toLowerCase() !== target.username.toLowerCase() || typeof data.id !== 'string' || !/^[a-z\d]{1,32}$/i.test(data.id)) throw new Error('Reddit returned an invalid profile');
    platformUserId = data.id; displayName = data.name; sources.push(target.profileUrl); const profileHash = evidenceHash(response.text);
    for (const link of textPaymentLinks(data.subreddit?.public_description || '')) {
      const item = candidate(link, target.profileUrl, target.platform, platformUserId, target.profileUrl, now, 'direct_profile', profileHash, undefined, api, `Reddit public profile description: ${data.subreddit?.public_description || ''}`);
      candidates.push(bioCaution(data.subreddit?.public_description, link) ? cautionCandidate(item) : item);
    }
  } else {
    progress('Checking the submitted public page…');
    const response = await fetcher(target.profileUrl, { followRedirects: 3 });
    sources.push(target.profileUrl);
    // A supplied page is not proof that its publisher is the person named on it.
    if (!response.contentType?.includes('text/html')) throw new Error('The supplied page is not HTML');
    const pageHash = evidenceHash(response.text); const extracted = extractHtmlEvidence(response.text, target.profileUrl); pageGithub = extracted.githubProfiles;
    // Credits: who the page itself names as its author. Shown as a lead to research next, never fetched automatically.
    if (extracted.authorName) displayName = `${extracted.authorName} (author named by ${new URL(target.profileUrl).hostname})`.slice(0, 160);
    for (const url of extracted.authors) identityLinks.push({ url, source_url: target.profileUrl, relation: 'author link declared by this page' });
    for (const url of extracted.identities) identityLinks.push({ url, source_url: target.profileUrl, relation: 'rel=me or Schema.org sameAs link declared by this page' });
    for (const url of extracted.schemaIdentities) identityLinks.push({ url, source_url: target.profileUrl, relation: 'Schema.org Person sameAs on page; association not established' });
    for (const link of extracted.contacts) candidates.push(contactCandidate(link, target.profileUrl, target, null, now, pageHash));
    for (const contact of extracted.publicContacts) candidates.push(maskedContactCandidate(contact, target.profileUrl, target, null, now, pageHash));
    for (const link of extracted.payments) candidates.push(applyContextCaution(candidate(link, target.profileUrl, target.platform, null, target.profileUrl, now, 'unverified_page', pageHash, undefined, target.profileUrl, `Extracted page HTML anchor href (normalized): ${link}`), extracted));
    try {
      const site = new URL(target.profileUrl); const manifestUrl = `${site.origin}/funding.json`;
      const manifest = fundingManifest((await fetcher(manifestUrl)).text, target.profileUrl);
      if (manifest?.links.length) {
        progress('Reading the site owner’s funding.json…'); sources.push(manifestUrl);
        // At the site root the owner is the subject; on a deeper page the author may be someone else (for example a blog host).
        const rootPage = site.pathname === '/' || site.pathname === '';
        for (const link of manifest.links) { const item = candidate(link, manifestUrl, target.platform, null, target.profileUrl, now, rootPage ? 'direct_profile' : 'unverified_page', evidenceHash(link), undefined, manifestUrl, `funding.json channel published by ${manifest.name || site.hostname}: ${link}`); candidates.push({ ...item, reason: rootPage ? `The site's own funding.json (${manifest.name || site.hostname}) lists this channel; payment account ownership has not been independently verified.` : `This site's owner (${manifest.name || site.hostname}) lists this channel in funding.json; the author of this particular page may be someone else.` }); }
        if (!extracted.authorName && manifest.name) displayName = `${manifest.name} (owner of ${site.hostname}, from funding.json)`.slice(0, 160);
      }
    } catch { /* No funding.json; most sites have none. */ }
    const contactUrl = extracted.contacts.find(link => link !== target.profileUrl);
    if (contactUrl && needsContact()) await inspectContactPage(contactUrl, 'unverified_page');
    warnings.push(target.platform === 'facebook' ? 'Facebook shows very little of a profile to visitors who are not signed in, so links on it are usually not visible to this check.' : 'The relationship between this page and the named person has not been verified.');
  }
  } catch (error) {
    // X and Reddit often refuse outside lookups. Keep the refusal, try the Keybase fallback below, and report the refusal only if that finds nothing.
    if (!['x', 'reddit'].includes(target.platform) || /Cache was cleared/.test(error?.message || '')) throw error;
    refused = error; platformUserId = `handle:${target.username.toLowerCase()}`; if (!sources.includes(target.profileUrl)) sources.push(target.profileUrl);
  }
  ensureActive();
  // Fallback for X and Reddit when the profile itself lists no payment link: a Keybase proof. Keybase publishes cryptographic
  // proofs, posted by the person on each account, that one person controls several accounts. If this handle is proven to share
  // an owner with a GitHub account, read that account's funding file and Sponsors page (plain downloads; no API allowance).
  // For a website: the same check by domain. A person who has proven they control this domain and one GitHub account is its owner.
  const webHost = target.platform === 'web' ? new URL(target.profileUrl).hostname.toLowerCase().replace(/^www\./, '') : '';
  const deepPage = target.platform === 'web' && !['', '/'].includes(new URL(target.profileUrl).pathname);
  // For a website, a cheaper and stronger check first: the page names exactly one GitHub account as its own (rel=me or sameAs),
  // and that account names this site as its website. Links in both directions mean each side vouches for the other.
  // The same applies to the one website a Reddit, X, Facebook, YouTube or Stack Overflow profile lists (its home page only).
  // A profile that lists the person's own GitHub account: read that account's funding files directly (plain downloads, no API
  // allowance) in place of whatever a scrape of the GitHub profile page happened to find.
  const listedUrl = ['github', 'web'].includes(target.platform) ? '' : identityLinks.find(item => item.source_url === target.profileUrl && /^website listed on .+ profile$/.test(item.relation))?.url || '';
  const listedLogin = /^https:\/\/github\.com\/([a-z\d](?:[a-z\d-]{0,37}[a-z\d])?)\/?$/i.exec(listedUrl)?.[1] || '';
  if (listedLogin) for (let index = candidates.length - 1; index >= 0; index--) if (candidates[index].source_url === listedUrl) candidates.splice(index, 1);
  let mutualLogin = ''; let mutualHost = webHost;
  const rootHost = value => { try { const u = new URL(value); return ['', '/'].includes(u.pathname) ? u.hostname.toLowerCase().replace(/^www\./, '') : ''; } catch { return ''; } };
  const declaring = webHost ? identityLinks.filter(item => item.source_url === target.profileUrl && item.relation.includes('declared by this page') && !item.relation.startsWith('author'))
    : ['github', 'web'].includes(target.platform) ? [] : identityLinks.filter(item => item.relation.includes('declared by linked website') && rootHost(item.source_url));
  if (!webHost) { const hosts = [...new Set(declaring.map(item => rootHost(item.source_url)))]; mutualHost = hosts.length === 1 ? hosts[0] : ''; }
  if (mutualHost && !listedLogin && !candidates.some(item => item.decision === 'published_payment_link')) {
    let named = [...new Set(declaring
      .map(item => /^https:\/\/github\.com\/([a-z\d](?:[a-z\d-]{0,37}[a-z\d])?)\/?$/i.exec(item.url)?.[1]?.toLowerCase()).filter(Boolean))];
    // No rel=me claim: an ordinary link also counts, but only on the site's home page, only when it is the one GitHub account
    // the page links to, and (as always) only when that personal account names this site back.
    let plainLink = false;
    if (!named.length && webHost && !deepPage && pageGithub.length === 1) { named = pageGithub; plainLink = true; }
    if (named.length === 1 && platformLimits.github > Date.now() && !options.githubToken) warnings.push(`${webHost ? 'This site' : `The website this profile lists (${mutualHost})`} names the GitHub account ${named[0]} as its own, but GitHub's hourly allowance is used up, so whether that account names the site back could not be checked. Try again later, or add a GitHub token.`);
    else if (named.length === 1) try {
      progress(`Checking whether the GitHub account ${webHost ? 'this site' : 'their website'} names links back to it…`);
      const headers = { accept: 'application/vnd.github+json', ...(options.githubToken ? { authorization: `Bearer ${options.githubToken}` } : {}) };
      const profile = parseResponse((await fetcher(`https://api.github.com/users/${named[0]}`, { headers })).text, 'GitHub');
      const blog = typeof profile?.blog === 'string' ? new URL(/^https?:\/\//i.test(profile.blog.trim()) ? profile.blog.trim() : `https://${profile.blog.trim()}`) : null;
      if (blog && ['', '/'].includes(blog.pathname) && blog.hostname.toLowerCase().replace(/^www\./, '') === mutualHost && typeof profile.login === 'string' && profile.login.toLowerCase() === named[0] && profile.type === 'User') mutualLogin = profile.login;
    } catch { /* No account, no website on it, or GitHub unavailable: fall through to Keybase. */ }
  }
  if (listedLogin || ((mutualLogin || (['x', 'reddit', 'github'].includes(target.platform) ? target.username : /^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,24}$/.test(webHost))) && !candidates.some(item => item.decision === 'published_payment_link'))) {
    try {
      progress(target.platform === 'github' ? 'Checking for a Keybase proof of a website this person controls…' : 'Checking for a Keybase proof linking this account to GitHub…');
      const kind = target.platform === 'x' ? 'twitter' : target.platform === 'web' ? 'domain' : target.platform;
      const lookup = mutualLogin || listedLogin ? { text: '{"them":[]}' } : await fetcher(`https://keybase.io/_/api/1.0/user/lookup.json?${kind}=${encodeURIComponent(webHost || target.username)}&fields=basics,proofs_summary`, { keepQuery: true });
      const people = (parseResponse(lookup.text, 'Keybase')?.them || []).filter(person => person && typeof person.basics?.username === 'string' && /^[a-z\d_]{1,16}$/i.test(person.basics.username));
      const proven = (person, type) => (Array.isArray(person.proofs_summary?.all) ? person.proofs_summary.all : []).filter(proof => proof?.proof_type === type && proof.state === 1 && typeof proof.nametag === 'string').map(proof => proof.nametag);
      const owners = people.filter(person => (webHost ? [...proven(person, 'generic_web_site'), ...proven(person, 'dns')].map(name => name.toLowerCase().replace(/^www\./, '')) : proven(person, kind).map(name => name.toLowerCase())).includes(webHost || target.username.toLowerCase()));
      // For a GitHub account: a website the same person has proven they control (by a file on the site or a DNS record).
      const domains = target.platform === 'github' && owners.length === 1 ? [...proven(owners[0], 'generic_web_site'), ...proven(owners[0], 'dns')].map(name => name.toLowerCase()).filter(name => /^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,24}$/.test(name)) : [];
      const domain = domains.find(name => !sources.some(source => { try { return new URL(source).hostname.replace(/^www\./, '') === name.replace(/^www\./, ''); } catch { return false; } }));
      if (domain) {
        const keybaseUrl = `https://keybase.io/${owners[0].basics.username}`; const site = publicURL(`https://${domain}/`);
        sources.push(keybaseUrl); identityLinks.push({ url: site.href, source_url: keybaseUrl, relation: 'Keybase proof: the same person controls this website' });
        const page = await fetcher(site.href, { followRedirects: 3 });
        if (page.contentType?.includes('text/html')) {
          sources.push(site.href); const siteHash = evidenceHash(page.text); const fromSite = extractHtmlEvidence(page.text, site.href);
          for (const link of fromSite.payments) candidates.push(applyContextCaution({ ...candidate(link, site.href, target.platform, platformUserId, target.profileUrl, now, 'linked_creator_site', siteHash, undefined, site.href, `Extracted linked-site HTML anchor href (normalized): ${link}`),
            reason: `A website (${domain}) that a public Keybase proof ties to this account lists this link; payment account ownership has not been independently verified.` }, fromSite));
          for (const link of fromSite.contacts) candidates.push(contactCandidate(link, site.href, target, platformUserId, now, siteHash, 'linked_creator_site'));
        }
      }
      const logins = listedLogin ? [listedLogin] : mutualLogin ? [mutualLogin] : target.platform !== 'github' && owners.length === 1 ? proven(owners[0], 'github').filter(name => /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(name)) : [];
      if (logins.length === 1) {
        const login = logins[0]; const githubUrl = `https://github.com/${login}`; const proof = listedLogin ? 'the profile itself, which lists that account' : mutualLogin ? (webHost ? 'links in both directions (the site names the account and the account names the site)' : `the website they list (${mutualHost}): the site and the account each name the other`) : 'a public Keybase proof';
        // A profile may list an organisation or project it works on rather than a personal account; that is not the person's own
        // payment target, so its links stay unconfirmed. GitHub marks personal account pages as a schema.org Person.
        let shared = false;
        if (listedLogin) { try { shared = !/itemtype="https?:\/\/schema\.org\/Person"/i.test((await fetcher(listedUrl)).text); } catch { shared = true; } }
        if (listedLogin) { /* Already recorded as the link the profile lists. */ }
        else if (mutualLogin) identityLinks.push({ url: githubUrl, source_url: webHost ? target.profileUrl : `https://${mutualHost}/`, relation: 'This site names the GitHub account as its own, and the account lists this site as its website' });
        else { const keybaseUrl = `https://keybase.io/${owners[0].basics.username}`; sources.push(keybaseUrl); identityLinks.push({ url: githubUrl, source_url: keybaseUrl, relation: 'Keybase proof: the same person controls this GitHub account' }); }
        const add = (link, sourceUrl, retrievalUrl, text, excerpt) => candidates.push({ ...candidate(link, sourceUrl, target.platform, platformUserId, target.profileUrl, now, listedLogin ? 'listed_account' : mutualLogin ? 'mutual_link_account' : 'keybase_linked_account', evidenceHash(text), undefined, retrievalUrl, excerpt),
          // On a deeper page of a site (a post on a blog host, say) the author may not be the site's owner, so the link stays unconfirmed.
          ...(deepPage || shared ? { decision: 'potential_contact' } : {}),
          reason: shared ? `The GitHub account this profile lists (${login}) lists this link, but it is an organisation or could not be confirmed as a personal account, so it may not be this person's own.` : deepPage ? `The owner of this site (GitHub account ${login}, per ${proof}) lists this link; the author of this particular page may be someone else.`
            : `Their GitHub account (${login}), tied to this ${webHost ? 'website' : 'profile'} by ${proof}, lists this link; payment account ownership has not been independently verified.` });
        try {
          const rawUrl = `https://raw.githubusercontent.com/${login}/.github/HEAD/FUNDING.yml`; const funding = await fetcher(rawUrl);
          if (Buffer.byteLength(funding.text, 'utf8') <= 16384) {
            const data = parseYAML(funding.text, { schema: 'failsafe', maxAliasCount: 0, mapAsMap: true, logLevel: 'error' }); const displayUrl = `${githubUrl}/.github/blob/HEAD/FUNDING.yml`;
            const values = value => (Array.isArray(value) ? value.slice(0, 4) : [value]).filter(item => typeof item === 'string');
            if (data instanceof Map) {
              sources.push(displayUrl);
              for (const value of values(data.get('custom'))) { const link = safePayPalURL(value) || supportURL(value); if (link) add(link, displayUrl, rawUrl, funding.text, `FUNDING.yml custom entry: ${value}`); }
              for (const [key, base] of Object.entries({ ko_fi: 'https://ko-fi.com/', patreon: 'https://www.patreon.com/', open_collective: 'https://opencollective.com/', buy_me_a_coffee: 'https://buymeacoffee.com/', liberapay: 'https://liberapay.com/' }))
                for (const value of values(data.get(key))) if (/^[a-z\d][a-z\d_-]{0,59}$/i.test(value)) add(`${base}${value}`, displayUrl, rawUrl, funding.text, `FUNDING.yml ${key} entry: ${value}`);
            }
          }
        } catch { /* No funding file. */ }
        try {
          // Their profile README (markdown source; code samples dropped), where many people list tip links.
          const rawUrl = `https://raw.githubusercontent.com/${login}/${login}/HEAD/README.md`; const readme = await fetcher(rawUrl);
          const text = readme.text.slice(0, 100000).replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' '); const readmeUrl = `${githubUrl}/${login}#readme`;
          const found = textPaymentLinks(text).filter(link => !bioCaution(text, link));
          if (found.length) sources.push(readmeUrl);
          for (const link of found) add(link, readmeUrl, rawUrl, readme.text, `Profile README lists: ${link}`);
        } catch { /* No profile README. */ }
        try {
          const sponsorsUrl = `https://github.com/sponsors/${login}`; const page = await fetcher(sponsorsUrl);
          const title = (/<title>([^<]{0,200})<\/title>/i.exec(page.text.slice(0, 20000))?.[1] || '').trim();
          if (new RegExp(`^Sponsor @${login} on GitHub Sponsors`, 'i').test(title)) { sources.push(sponsorsUrl); add(sponsorsUrl, sponsorsUrl, sponsorsUrl, title, `GitHub page title: ${title}`); }
        } catch { /* No Sponsors page. */ }
        // The owner of this site is now confirmed. A payment link on the home page itself that carries the same handle as their
        // GitHub account is theirs too; links with any other handle (a charity, a friend) stay unconfirmed.
        if (webHost && !deepPage && !shared && candidates.some(item => item.decision === 'published_payment_link' && ['mutual_link_account', 'keybase_linked_account'].includes(item.identity_association_status))) {
          for (const item of candidates) {
            if (item.identity_association_status !== 'unverified_page' || item.source_url !== target.profileUrl || item.decision !== 'potential_contact' || !['paypal_me', 'other_payment_link'].includes(item.candidate_type) || /cautionary or example language/.test(item.reason)) continue;
            let handle = ''; try { handle = new URL(item.candidate_value).pathname.split('/').filter(Boolean).pop() || ''; } catch { /* Not a link. */ }
            if (handle.replace(/^@/, '').toLowerCase() !== login.toLowerCase()) continue;
            // Already confirmed through the account: the unconfirmed copy is dropped later, so one entry remains.
            if (candidates.some(other => other !== item && other.decision === 'published_payment_link' && other.candidate_value.toLowerCase() === item.candidate_value.toLowerCase())) continue;
            item.decision = 'published_payment_link'; item.identity_association_status = 'confirmed_owner_site'; item.reason = `This site's home page lists this link, the site's owner is confirmed (GitHub account ${login}, per ${proof}), and the link carries the same name; payment account ownership has not been independently verified.`;
          }
        }
      }
    } catch { /* Keybase unavailable or no proof; the result stands as it is. */ }
  }
  if (refused) {
    ensureActive();
    if (!candidates.some(item => item.decision === 'published_payment_link')) throw refused;
    warnings.push(`This profile could not be read directly, so the links shown come from the GitHub account that a public Keybase proof ties to it. The site's answer was: ${refused.message}`);
  }
  // A blocked lookup must not look like "no match": with no page data and nothing in the public files, report the limit itself.
  if (githubLimited && !options.pageProfile && !candidates.some(item => item.decision === 'published_payment_link')) throw new Error(`${githubLimited}. Click the icon again to read their profile page in your browser instead, or try again later.`);
  // The same link found twice, once confirmed and once not, is shown once, as confirmed.
  const confirmed = new Set(candidates.filter(c => c.decision === 'published_payment_link').map(c => c.candidate_value));
  // Once the site's owner is confirmed (links in both directions, or a Keybase proof), the "not verified" caution no longer applies.
  if (target.platform === 'web' && candidates.some(c => c.decision === 'published_payment_link' && ['mutual_link_account', 'keybase_linked_account'].includes(c.identity_association_status))) {
    const stale = warnings.indexOf('The relationship between this page and the named person has not been verified.'); if (stale >= 0) warnings.splice(stale, 1);
  }
  const allUnique = [...new Map(candidates.filter(c => c.decision === 'published_payment_link' || !confirmed.has(c.candidate_value)).map(c => [`${c.candidate_value}|${c.source_url}`, c])).values()];
  const unique = allUnique.slice(0, 20);
  if (allUnique.length > unique.length) warnings.push('Only the first 20 distinct candidates are shown.');
  const status = unique.some(c => c.decision === 'published_payment_link') ? 'Published payment link (not independently account-verified)' : unique.length ? 'Potential contact — unverified' : 'No safe match';
  const checkedAt = new Date().toISOString(); for (const candidate of unique) candidate.checked_at = checkedAt;
  // twitter.com and x.com addresses name the same account, so a lead given both ways is listed once (the first one found).
  const sameAccount = url => url.replace(/^https:\/\/(?:www\.|mobile\.)?twitter\.com\//i, 'https://x.com/').replace(/\/$/, '').toLowerCase();
  const uniqueIdentities = [...identityLinks.reduce((found, item) => { const key = `${sameAccount(item.url)}|${item.source_url}`; if (!found.has(key)) found.set(key, item); return found; }, new Map()).values()].slice(0, 10);
  const { etag: _etag, ...publicTarget } = target;
  const result = { target: { ...publicTarget, platformUserId, displayName }, status, checkedAt, candidates: unique, sources, identityLinks: uniqueIdentities, warnings, assessments: [] };
  const profileApi = `https://api.github.com/users/${encodeURIComponent(target.username || '')}`;
  if (target.platform === 'github' && !String(platformUserId).startsWith('handle:') && (result.identityLinks.some(item => item.source_url !== target.profileUrl) || unique.some(item => typeof item.retrieval_url !== 'string' || item.retrieval_url.toLowerCase() !== profileApi.toLowerCase()))) {
    progress('Rechecking the GitHub identity after gathering evidence…');
    let currentId; let recheckError = null;
    try {
      // Ask GitHub only whether the profile record changed since it was read; unchanged means the same account ID.
      const unchanged = target.etag ? await fetcher(profileApi, { headers: { accept: 'application/vnd.github+json', ...(options.githubToken ? { authorization: `Bearer ${options.githubToken}` } : {}), 'if-none-match': target.etag } }).catch(error => { recheckError = error; return null; }) : null;
      currentId = unchanged?.notModified ? platformUserId : await resolvePlatformId(target, { ...options, fetcher });
    }
    catch (error) {
      ensureActive();
      // The hourly allowance ran out between the first request and this last one. That says nothing about the account, so the
      // links stand; the result is handled like any other limit fallback (account ID unconfirmed, not stored).
      // Only GitHub's own "allowance used up" answer counts; any other refusal keeps the cautious result below.
      const refused = value => /HTTP 4(?:03|29).*rate limit resets in \d+ min/.test(value?.message || '');
      if (!options.githubToken && refused(error) && (!recheckError || refused(recheckError))) {
        const wait = /resets in (\d+) min/.exec(error.message); platformLimits.github = Date.now() + (wait ? Number(wait[1]) : 10) * 60000;
        return { ...result, target: { ...result.target, platformUserId: `handle:${String(target.username).toLowerCase()}` },
          warnings: [...warnings, "GitHub's hourly request limit ran out during this lookup, so the final check that the account did not change was skipped."] };
      }
      return { ...result, identityRecheckFailed: true, status: unique.length ? 'Potential contact — unverified' : 'No safe match', identityLinks: [],
        candidates: unique.map(item => ({ ...item, identity_association_status: 'unverified_profile_id', decision: 'potential_contact', reason: `${item.reason} The profile ID could not be rechecked after gathering evidence.` })),
        warnings: [...warnings, 'The GitHub profile ID could not be rechecked after gathering evidence; associations remain unverified.'] };
    }
    if (currentId !== platformUserId) throw new Error('GitHub profile identity changed during this lookup; try again.');
  }
  ensureActive(); return result;
}
