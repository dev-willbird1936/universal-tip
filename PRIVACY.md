# Privacy and data use

Universal Tip is a single-user local prototype. It is not an identity-verification service, a bulk profiling tool, or a production recipient database.

## What triggers research

Browsing and rendering an icon do not initiate a lookup. A lookup starts when the user activates an icon, submits a public URL in the extension, or uses the context-menu action. The extension sends the selected public URL to the local service; query strings and fragments are removed. It does not upload the entire browsing page. Generic inline icons require separate site permission. The prototype requests Chrome's `tabs` permission to identify the active page for toolbar actions; that permission can expose tab URL metadata to the extension even though the code does not automatically send browsing history to the backend.

## Sources and data

The service queries the explicitly selected public profile or page and, depending on platform, the official GitHub, Reddit or Stack Exchange endpoint, an owner-named GitHub funding/README source (including the `funding` field of `package.json` in that account's own repository) and that account's GitHub Sponsors page address, for a website the same site's `/funding.json` (payment-provider links only; bank, cash and email details are not collected), at most one website linked from the profile (plus, when nothing was found, one website a public Keybase proof ties to the same person), and, when needed, one explicitly linked same-origin contact page. For a website (the one looked up, or the one a profile lists) that names one GitHub account as its own, or whose home page links to exactly one GitHub account, it asks GitHub for that account's public profile to see whether the account names the site back. When the link a Reddit, X, Facebook, YouTube or Stack Overflow profile lists is a GitHub account, it loads that account's public GitHub page (to tell a personal account from an organisation) and its public funding file, profile README and Sponsors page address. To know whether GitHub's hourly allowance is used up, it also asks GitHub's rate-limit endpoint, which names no profile. Public funding files, Sponsors pages and Keybase answers are kept in memory for ten minutes and are dropped when the research cache is cleared. It may extract public PayPal and contact links, declared identity links, masked public email addresses or phone numbers, source URLs, and a hash of the decoded source response. It does not use breached data, guessed email addresses, account-recovery endpoints, or non-public browser cookies. A website listed on a profile is not independently verified as belonging to the same person.

If the user separately enables Parallel (including its unauthenticated free MCP mode) or Drex, the service sends the public profile URL, payment-link candidates, their source URLs and small contact-redacted excerpts, up to ten public identity-link declarations for Drex, or public search terms for Parallel Search. Redaction is best-effort. Provider privacy policies and retention practices apply independently; the local app cannot control provider-side retention. Paid-provider calls are disabled by default.

## Storage and retention

- The local pairing token and exact or normalized reported-profile suppression entries are stored in the browser extension's local storage. The extension requests trusted-context-only access so its content scripts cannot read that storage; failure to apply that restriction is logged in the extension service worker. When `LOCAL_API_TOKEN` is unset, the server also keeps its generated pairing token in the git-ignored `data/local-token` file so pairing survives restarts; delete the file to rotate it.
- The lookup cache is memory-only by default and disappears when the server stops. If the operator sets `CACHE_ENCRYPTION_KEY`, the service stores an AES-256-GCM-encrypted cache in `data/evidence-cache.enc`. Cache entries are inaccessible after six hours. While running, expired entries are physically pruned hourly; after shutdown, encrypted expired entries remain on disk until restart or explicit clearing.
- The optional paid-provider budget stores a UTC date, call count and estimated reserved USD cents, without profile details, in `data/provider-call-budget.json`. The separately enabled free Parallel MCP mode stores its UTC date, call count and zero reserved cents in `data/parallel-free-call-budget.json`. Both persist across normal restarts. The configured paid-call estimates are not a guarantee of actual provider charges.
- The server prints its pairing token on startup and emits minimal timestamped event/outcome records to its console. It does not intentionally log profile URLs, contact candidates, provider keys, or source page content. Terminal logging and backups are controlled by the operator.

## Removal and corrections

The extension's **Report wrong match and hide this profile** action suppresses the selected profile in that browser and attempts to clear the local research cache. If the backend is unavailable or an existing encrypted registry is locked because its key was omitted, suppression still works, but complete cache clearing must be retried with the correct key. Clearing cancels queued work and blocks subsequent public-source and paid-provider calls from canceled jobs; an external request already in flight may still finish and is subject to the provider's retention policy. The user can undo the suppression from its panel. **Clear research cache** in the popup also clears the local cache. Removing the extension deletes its local extension storage subject to browser behavior; stop the server and remove or securely manage the operator-owned `data/` directory separately if needed. Removing a local budget file resets its local count and reservations; use provider-side billing controls as well and respect the free service's limits.

This is a local correction mechanism: it does not notify the person, update an external site, delete provider-held data, or create a public opt-out record. There is no creator-facing correction/opt-out portal in this prototype. To request deletion from a provider or source website, use that service's own process.

## Boundaries

The service binds to loopback and is intended for a trusted single-user computer. The pairing token is not an Internet-facing authentication system. A public contact, a matching username, a linked website, an AI decision or a published payment link does not independently verify PayPal ownership or authorize payment. The only checkout code targets the configured PayPal **sandbox merchant**, is separate from discovery, and cannot send real money.

## OpenRouter key, automatic pairing and X lookups

- The OpenRouter key you enter in the popup is sent to the local server and stored unencrypted in the git-ignored `data/settings.json` on this computer. It is sent only to `openrouter.ai`: once when you save it, to check that OpenRouter accepts it (no evidence is sent and no credits are used), when you click **Check the decision model** (with a fixed made-up example only), and otherwise together with a compact evidence packet (profile URL, support links, source URLs, short redacted excerpts), when a lookup finds payment-link evidence.
- Pairing is automatic: the local server gives its token to any request carrying a browser-extension origin. Web pages cannot forge that origin, but another extension installed in the same browser, or any program on this computer, could obtain the token.
- For an X profile, your browser requests X's public embed page (`syndication.twitter.com`) without cookies when you click, and passes only the profile's ID, name, bio and listed links to the local server.
- The hover button on X, Facebook and YouTube reads the link under the pointer in the page; nothing is sent anywhere until you click it.
- On GitHub, after you click an icon, your browser reads that person's profile page (the one on screen; or, only while the local server reports GitHub's API allowance as used up, one ordinary same-site page load) and sends only their name, bio, listed links and pinned repository names to the local server, which uses them when GitHub's hourly API allowance is used up.
- On Stack Overflow, after you click an icon, your browser likewise reads that person's profile page (loading it once only while the Stack Exchange API is reported as unavailable) and sends only their name, "about me" text and links to the local server, for use when the Stack Exchange API is unavailable.
- For an X, Reddit, GitHub or website lookup that finds no payment link, the local server sends that public handle or the site's domain name (nothing else) to `keybase.io` to ask whether a public proof links it to a GitHub account or a website.
- On YouTube, after you click, your browser loads that channel's page once (an ordinary same-site request using your existing YouTube session) and sends only the channel's name, description and listed links to the local server. The server never contacts YouTube.
- On Reddit, clicking the icon beside a username in a comment or post makes your browser load that user's public profile page once, with your normal Reddit session, to read the description and links shown on it. Nothing is loaded before the click.
- An optional GitHub token entered in the popup is stored unencrypted in `data/settings.json` on this computer and sent only to GitHub's official API.
- A Windows Startup shortcut named Universal Tip local server starts the local loopback server when you log in. It does not send data anywhere by itself; delete the shortcut from the Windows Startup folder to stop it.

## Optional web-search leads

Off by default. With `WEB_SEARCH_URL` and `WEB_SEARCH_HEADERS` set, `POST /leads` and the username search send one search query containing the public username to the search service the operator configured. Nothing else is sent, results are not stored, and they are never used as payment evidence.

## Optional profile lookup

Off by default. With `PROFILE_LOOKUP_URL` set, `POST /profiles` forwards one public username to a lookup service the operator runs and shows the platform names it reports. Only platform names are kept from the answer; any other fields are discarded. The rows are leads: they never become payment links and never reach the decision model or the PayPal sandbox flow.

## Held tips

When you hold a tip for a username, the local server keeps one ledger row in `data/held-tips.json`: platform, username, amount, PayPal order ID and time. Nothing about you is stored; PayPal handles the payer's details. The file stays on the operator's computer.
