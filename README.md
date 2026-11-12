# Universal Tip

Discover a creator's publicly listed support links without guessing who owns a payment account. Universal Tip is a Chrome/Edge Manifest V3 extension with a loopback-only research service. It researches a profile **only after you click**; it does not send payments to discovered identities.

**Prototype, not production:** what has been seen working against live sites, in a real browser: GitHub (owners, authors, repository credits, gists, issue and pull request authors, commit authors, contributors, and the fallbacks used when GitHub's hourly allowance is used up), Reddit and X (profiles, posts, comments and replies, read from the page you are viewing because both sites refuse outside lookups; a Keybase proof as a fallback), Stack Overflow (icons, API lookups and the profile-page fallback), YouTube (channels and video publishers), and website owners and credits (author tags, `funding.json`, GitHub Pages, Keybase-proven domains). Facebook only partly seen live: signed out, the extension read a public profile's name and description (facebook.com/zuck), but Facebook showed no outside links as links, so finding a payment link there needs a signed-in session. Not yet seen live: a successful Drex judgement (needs your OpenRouter key), a real right-click menu click, a real Stack Overflow back-off, keyed Parallel, and the PayPal sandbox (needs credentials). The sandbox demo may not meet the hackathon's requirement that PayPal be central; see the hackathon's official rules. Do not represent this as an eligible or submitted entry without further verification.

## For judges

- **Try it in five minutes:** follow Quick start below, then open `https://github.com/zudsniper` and click the small icon beside the name. The panel should list a PayPal.Me link with $3, $5 and $10 buttons, plus Ko-fi and GitHub Sponsors, each with its source. [DEMO.md](DEMO.md) has an example for each site.
- **AI without a key:** start the server with `ENABLE_PARALLEL=1`, `PARALLEL_DECISIONS_TRANSPORT=free_mcp` and `PARALLEL_FREE_MCP_DAILY_CALL_LIMIT=20` to have Parallel's free decision model rate the evidence. With an OpenRouter key pasted in the popup, the Drex Max decision model is used instead.
- **PayPal sandbox checkout:** set `PAYPAL_SANDBOX_CLIENT_ID` and `PAYPAL_SANDBOX_CLIENT_SECRET` (a sandbox REST app from developer.paypal.com), restart, and use **Open $1 sandbox demo** in the panel. It pays your own sandbox merchant, never a discovered person.
- **Held tips:** when a person has no confirmed payment link, the window offers **Hold a $1 tip**. It runs a PayPal Orders checkout (sandbox by default) into the operator's account and records the tip against that username in `data/held-tips.json` until they claim it. Run once in the sandbox: order `COMPLETED` and recorded. The claim flow is not built yet.
- **Live money:** `PAYPAL_ENV=live` with `PAYPAL_LIVE_CLIENT_ID` and `PAYPAL_LIVE_CLIENT_SECRET` switches the checkout to PayPal's live API. This has not been run by the author. Holding real money for other people has legal requirements; only enable it if you meet them.
- **Privacy:** no data about you is stored. The only record kept is the held-tip ledger (platform, username, amount, PayPal order ID, time).
- **Check the build:** close the server window and run `npm run check:offline` (build, unit tests and 17 offline browser checks).
- **Honest limits:** the sandbox checkout was run end to end once with real sandbox credentials (order created, approved by a sandbox buyer, captured: `COMPLETED`). The Drex model is built and tested against a stand-in but has not been run with a real key by the author. Facebook needs a signed-in session.

## Quick start

1. Run `start.bat` (Windows) or `npm ci && npm run build && npm start`, and keep it open.
2. Load the `extension` folder as an unpacked extension in Chrome or Edge. Every automated check here passes in Chromium and in Microsoft Edge; Google Chrome itself has not been driven by the automated checks.
3. Open the toolbar popup and paste your OpenRouter API key. Pairing with the local server is automatic. The server asks OpenRouter whether the key is accepted (`GET /api/v1/key`, no credits used) and refuses to save a rejected key.

Then hover a username on X, Facebook or YouTube and click **↗ Tip**, click the icon beside an author on GitHub, Reddit or Stack Overflow, or use the popup on any page. `npm run doctor` says whether a key is saved.

| Site | Where the button appears | What is researched |
|---|---|---|
| GitHub | Icon beside authors (issues, pull requests, discussions, commit lists), the repository owner and names on a repository's contributors page; a pasted or right-clicked repository link means its owner; **Use current page** on an issue or pull request means its author | Profile, README, funding files (`FUNDING.yml`, and `funding.json` when it names that same account), whether the account has its own GitHub Sponsors page, linked website |
| Reddit | Icon beside usernames in posts and comments; **Use current page** on a post or comment permalink means its author | The description and links on that person's profile page, plus one website those links point to (for example a Linktree page). From a comment or post, your browser loads that profile page once, after you click |
| YouTube | Hover button on channel names (videos, comments, channel pages); **Use current page** on a channel means that channel, on a video its publisher | The channel's own description and header link, read in your browser after you click (YouTube shows outside requests a cookie-consent page), plus one website they point to. Sponsor links in video descriptions are ignored |
| Stack Overflow | Icon beside names on questions, answers, comments, question lists and the name on a profile page; **Use current page** on a profile means that person, on a question its asker | The profile's "about me" and website through the official Stack Exchange API (no key; about 300 requests a day), plus that website |
| X | Hover button on names in posts, replies and profiles; **Use current page** on a post or reply means its author | On that person's profile page: the bio and links shown there, read from the page. Elsewhere: X's public embed page, which is tightly rate-limited. Then the linked website |
| Facebook | Hover button on profile names; right-click a profile link; **Use current page** on a profile | On that person's own profile page (signed in): the outside links it shows, plus one website they point to. Elsewhere Facebook shows almost nothing, so open their profile first |
| Other websites | Popup, right-click, or enabled `rel=author` links. A GitHub Pages site (`name.github.io`) is researched as the GitHub account `name`, since only that account can publish there. Pages are read for PayPal.Me links whether written as links or as plain text (Carrd pages often do the latter). Beacons pages refuse automated requests (HTTP 403), so they cannot be checked. Any website lookup also reads the site's own [`funding.json`](https://fundingjson.org/) if it publishes one (accepted only when it describes that same site; bank, cheque and cash details are ignored). After **Enable icons on this site**, **Use current page** researches a uniquely credited author (`rel=author`, `twitter:creator`, `article:author`) | Payment and support links on the page (unverified); a unique credited profile is researched instead of the article |

With an OpenRouter key saved, the Drex Max decision model (`nace-ai/drex-max`, through OpenRouter's alpha Decisions endpoint; override with `OPENROUTER_MODEL`) judges whether the evidence actually links the destination to the profile. It can downgrade a result but never authorizes a payment. Calls are capped at 50 per UTC day (`OPENROUTER_DAILY_CALL_LIMIT`); what you are charged depends on the model and your OpenRouter account.

Without a GitHub token, GitHub allows roughly 20 lookups an hour from one computer. When that allowance is used up, lookups keep working in a reduced form: the server reads their public README, funding files and Sponsors page, which do not use the allowance, and the extension also reads the person's GitHub profile page in your browser (name, bio, website and social links, pinned repositories). That background page load happens only while the allowance is used up; in normal use a click sends nothing extra to GitHub. Those results say the account ID was not confirmed and are not cached. A result checked in the last ten minutes is reused without any new request, so repeat clicks on the same person cost nothing. If the allowance runs out partway through a lookup, the links already found are kept and the result says the final account recheck was skipped. If the funding files of their top or pinned repository list nothing, the `funding` field of that repository's `package.json` is read too (also a plain file download). The profile README is read as a plain file download, which costs none of the allowance; the API is asked for it only when that file is absent. Fallback results are not stored, but the public funding files, Sponsors pages and Keybase answers behind them are remembered for ten minutes, so a repeat click only repeats the one request the site itself must answer. If a stored result is older than that and the platform refuses the account-ID recheck, the server researches afresh through those fallbacks, and shows the stored result (marked as possibly outdated, never as published) only if nothing can be read at all. For X and Reddit, when the profile lists no payment link or the site refuses the lookup, the server asks Keybase's public API whether a verified proof ties that exact handle to one GitHub account, and if so reads that account's funding file and Sponsors page; such links are labelled as coming through a Keybase proof. For a GitHub account with no payment link, the same check looks for a website the person has proven they control and reads that. For a website with no payment link of its own, it first checks for links in both directions: the page names exactly one GitHub account as its own (`rel="me"` or `sameAs`) and that account lists this site as its website. On a site's home page an ordinary link also counts, if it is the only GitHub account the page links to and that account lists the site back. Once a site's owner is confirmed this way, a payment link on the home page itself is treated as theirs only when it carries the same name as that GitHub account. If so it reads that account's funding links. The same two-way check applies to the one website a Reddit, X, Facebook, YouTube or Stack Overflow profile lists. If the link such a profile lists is the person's own GitHub account, that account's funding file, profile README and Sponsors page are read directly. Otherwise it asks whether someone has proven they control that domain and one GitHub account, and reads that account's funding links (shown as unconfirmed on anything but the site's home page, where the page's author may not be the owner). The server also obeys the Stack Exchange API's own signals: when an answer asks clients to back off, or the daily quota reaches zero, it stops calling the API until that time passes. Stack Overflow has the same fallback for its daily API allowance: the profile page read in your browser ("about me" links and the website the person marked as theirs). To raise that, paste a token (no permissions needed) into the optional **GitHub token** field under **Local connection & privacy** in the popup, or set `GITHUB_TOKEN` on the server.

Fingerprint (fingerprint.to) is a manual hand-off only: the result panel copies the username and opens their username search for you to run yourself. Its terms prohibit automated access beyond plan limits and its API is still marked coming soon, so nothing queries it automatically or works around its limits. Also not built: lookups of private emails or phone numbers. Only details a person published themselves are shown, and public emails and phones stay masked.

## Five checks only you can run

If you use Google Chrome, loading the extension there is itself a check: the automated checks run in Chromium and Microsoft Edge, because Chrome will not load an unpacked extension in an automated run.

1. **Drex judge:** paste your OpenRouter key in the popup and click **Check the decision model**: it sends Drex one made-up example (no real person; one of the 50 daily calls) and shows its answers. Then research `https://github.com/Borewit`. The panel should show a decision-model assessment instead of "No decision model checked this evidence". At most 50 judge calls a day (`OPENROUTER_DAILY_CALL_LIMIT`).
2. **Facebook (signed in):** hover a person's name and click **↗ Tip**; then open their profile and use **Use current page**.
3. **Right-click:** on X or Reddit, right-click a username link and choose **Research this creator with Universal Tip**.
4. **Use current page on a website:** open `https://simonwillison.net/`, click the toolbar icon, choose **Use current page** and allow the permission Chrome asks for. The panel should show a GitHub Sponsors link (the site and the GitHub account each name the other). Facebook's hover button was tried signed out: Facebook's sign-in dialog covers the page, so no name can be hovered there.
5. **Signed in on X and Reddit:** hover a reply author's name and a reposted person's name on X, and click an icon on `old.reddit.com`. Signed out, X shows neither replies nor other people's names in a timeline, and old Reddit shows only a sign-in page.

## Optional: web-search leads

`POST /leads` with `{ "username": "..." }` asks a search service you configure (only if `WEB_SEARCH_URL` and `WEB_SEARCH_HEADERS` are set) for pages that mention the username beside a support service. It is a separate endpoint on purpose: its rows are leads to read, never payment candidates, and they are not sent to the decision model or the PayPal flow. A search result often pairs a username with someone else's payment link (a project they contributed to), so nothing from it is treated as theirs. Each search costs about $0.0004 to $0.015. Fingerprint is not queried automatically; the panel offers a manual hand-off.

## How it works

- GitHub and Reddit author links can receive a small icon. GitHub detection uses explicit author/profile markers; Reddit includes visible links in open shadow roots. Select the icon to research the linked profile. Complex or closed-shadow layouts may be missed.
- The toolbar popup accepts a public HTTPS profile URL or the current page. A right-click menu accepts a link, a selected HTTPS URL, or a selected GitHub/Reddit username; ambiguous selections are ignored rather than treated as another person. On other sites, click **Enable icons on this site** and grant that site's permission; only explicit `rel=author` or Schema.org `itemprop=author` links receive icons. Re-enable after navigating. The extension never sends the full page to the backend.
- For GitHub, the service fetches the official public user API, the profile README, the profile owner's public `.github/FUNDING.yml` (and, only if that lists nothing, the funding file of their own most-starred non-fork repository), at most one website explicitly linked by the profile, and, only when no payment link or public email/phone was found, one explicitly linked same-origin contact page. It recognizes PayPal.Me links, PayPal hosted Donate links, a GitHub Sponsors entry for the same login, and plain account names listed in the funding file for Ko-fi, Patreon, Open Collective, Buy Me a Coffee and Liberapay. Recognized PayPal.Me amounts are stripped from the displayed link; the source remains available for inspection. When a PayPal.Me link is listed on the person's own profile, the panel offers $3, $5 and $10 buttons that open PayPal.Me with that amount filled in; the payer reviews and confirms on PayPal, and unconfirmed links get no amount buttons. Explicit `rel=me`, `itemprop=sameAs`, and bounded Schema.org JSON-LD Person `sameAs` declarations on the linked website are shown as unverified page declarations, not fetched automatically or treated as proof that the accounts belong to the target. Explicit public `mailto:` and `tel:` links on checked pages, and public GitHub email, are returned **masked** as a contact candidate, and explicit same-origin contact-page links may be shown as unverified leads; neither is a verified PayPal account. Links in code examples are ignored, and obvious cautionary or example language beside a link downgrades it. That heuristic can miss misleading context; inspect the source. A PayPal URL in the profile website field is recorded as evidence but is not fetched as a checkout page. If a creator-published PayPal link was already found, the separate website is not fetched. When evidence came from additional sources, the service rechecks the GitHub platform ID before presenting it; a changed ID fails the lookup and an unavailable recheck downgrades the result. GitHub API failures are shown as errors, not empty results.
- Reddit uses the public profile `about.json` endpoint, which may require access or block requests. If you have an approved Reddit OAuth bearer token, set `REDDIT_ACCESS_TOKEN` on the server to use `oauth.reddit.com`; obtain and refresh it through your approved integration. An arbitrary HTTPS author page can be fetched, but its payment link is only an **unverified potential contact** because the page alone does not prove identity.
- The result panel streams actual research-stage updates, then includes the source, candidate type, time checked, identity association and payment-authorization status. Expand **Evidence details** for the retrieval URL and SHA-256 hash of the decoded response captured at lookup time; a hash is not independent proof of ownership. A public link is **not** independent account verification and may open a live payment service rather than the sandbox; Universal Tip does not send a payment. AI can flag or downgrade evidence; it cannot approve a recipient. No live payment, creator claim or payout is implemented.

## Requirements

- Node.js 22 or newer and npm. Local verification used Node 24; the Node 22 CI job has not yet run.
- Chrome or Edge 120 or newer with developer-mode extensions enabled.
- Internet access to the public sources you choose to look up. GitHub's unauthenticated API has a shared IP-based rate limit; optionally set a least-privilege `GITHUB_TOKEN` in the backend environment for approved API access. It is sent only to the official GitHub API, not to linked websites or the extension.
- Optional: [Parallel Decisions](https://docs.parallel.ai/decisions/decisions-quickstart) supports an explicitly enabled, rate-limited free MCP mode without a key, or a keyed paid API mode. [Drex Max v1.1](https://console.nace.ai/docs/drex/api-reference/systemone) and the optional Parallel Search API require credentials and may charge. All are disabled by default.
- Optional: a PayPal developer application and separate sandbox buyer/merchant accounts for the isolated checkout demonstration.

## Install and run

```sh
npm ci
npm run build
npm run doctor  # local configuration checks only; no network calls
npm start
```

`npm run doctor` reports missing or malformed optional configuration without printing secrets or contacting providers; it does not validate credentials, access, pricing or an existing encrypted file. On Windows, `start.bat` does all of this: it installs dependencies and builds the extension on first run, then starts the server. Keep its terminal open. A Startup shortcut named **Universal Tip local server** starts it minimized when you log in; delete that shortcut to stop it. It listens only on **127.0.0.1:4318** and prints a local pairing token. The token is generated once, saved in the git-ignored `data/local-token` file and reused on later starts, so the extension stays paired; delete that file to rotate it, or set `LOCAL_API_TOKEN` to your own secret of at least 32 characters. Anyone who can read that file can use the local service. Do not share this token or expose the service on a network.

1. Open `chrome://extensions` (or `edge://extensions`) and enable **Developer mode**.
2. Select **Load unpacked** and choose this repository's `extension` directory.
3. Open the Universal Tip toolbar popup. Its top line says whether the server is running. Pairing is automatic; paste your OpenRouter key and select **Save key**. (A manual pairing-token field remains under **Local connection & privacy** in case automatic pairing fails.)
4. Paste `https://github.com/feross` and choose **Research profile**, or click an inline icon. Results vary with live public sources and API availability. The feross public funding file listed GitHub Sponsors in the observed test; this does not verify any PayPal account.
5. Use **Report wrong match and hide this profile** to suppress that profile in this browser and attempt to clear the backend cache (GitHub and Reddit profile URL variants are normalized; other pages use their URL). This is a local report, not a message to the creator or an external moderation service. If the backend is unavailable, suppression still works but cache removal must be retried. Undo the report on the resulting screen.

After source changes, run `npm run build`, then reload the unpacked extension. Close the server terminal to stop the service.

## Optional encrypted registry

By default, the six-hour result cache is **memory-only** and disappears when the server stops. GitHub and Reddit cache hits recheck the current platform user ID before reuse. If that check fails, the result is explicitly downgraded and marked potentially stale; if the ID changed, fresh research is required. To persist it as an AES-256-GCM-encrypted local registry, set `CACHE_ENCRYPTION_KEY` to a stable, random 32-byte value encoded as 64 hexadecimal characters before starting the server. Generate one locally, store it securely outside the repository, and keep it between starts. Never publish the key. Example generation:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Encrypted data is stored in `data/evidence-cache.enc`; entries are inaccessible after their six-hour TTL. While running, expired entries are pruned hourly; after shutdown they remain encrypted on disk until the next startup or an explicit cache clear. Clearing the cache writes an encrypted empty registry. A wrong key or damaged file stops startup instead of silently replacing the file. If an encrypted registry exists but the key is omitted, the server warns and refuses to claim a complete cache clear until the key is configured. Oversized results are not cached. Keep a secure backup if the registry matters. The cache is not a multi-user vault or an authenticated production database.

## Optional AI evidence checks

Set environment variables **before** starting the server. `.env.example` documents the names; the server does not load `.env` files automatically.

### Free Parallel Decisions (no key)

Parallel documents its [unauthenticated MCP `web_decisions` tool](https://docs.parallel.ai/integrations/mcp/quickstart.md) as free with lower rate limits. This is opt-in because it sends the selected public profile and compact evidence to Parallel. Check the provider's current terms and privacy policy. In PowerShell:

```powershell
$env:ENABLE_PARALLEL = '1'
$env:PARALLEL_DECISIONS_TRANSPORT = 'free_mcp'
$env:PARALLEL_FREE_MCP_DAILY_CALL_LIMIT = '3'
$env:ENABLE_PARALLEL_SEARCH = '0' # the keyed Search API is separate
$env:ENABLE_DREX = '0'            # Drex is separate and may charge
npm run doctor
npm start
```

The free transport always connects without authentication and never sends `PARALLEL_API_KEY`, even if one is present. Its explicit UTC-day call limit defaults to zero, has a maximum of 100, and persists across normal restarts in `data/parallel-free-call-budget.json`. The provider's own rate limits still apply. A real public-profile lookup and free MCP decision were exercised through the local streaming API; a positive score is not payment authorization and citations still need human review.

### Keyed paid providers

For example, in PowerShell:

```powershell
$env:PARALLEL_API_KEY = '<your key>'
$env:ENABLE_PARALLEL = '1'
$env:PARALLEL_DECISIONS_TRANSPORT = 'api'
# Optional web search when deterministic research finds no payment link:
$env:ENABLE_PARALLEL_SEARCH = '1'
$env:DREX_API_KEY = '<your key>'
$env:ENABLE_DREX = '1'
$env:PROVIDER_DAILY_CALL_LIMIT = '10'
$env:PROVIDER_DAILY_BUDGET_CENTS = '<daily reservation cap in whole USD cents>'
$env:PARALLEL_DECISION_MAX_CENTS = '<conservative per-call upper bound in cents>'
$env:PARALLEL_SEARCH_MAX_CENTS = '<conservative per-call upper bound in cents>'
$env:DREX_MAX_CENTS = '<conservative per-call upper bound in cents>'
npm start
```

Use your own access and check provider pricing and terms first. Each explicitly enabled **paid** provider call reserves one unit of the shared UTC-day call limit and its configured per-call maximum in whole USD cents before the request. Calls are refused unless the daily call cap, daily reservation cap and relevant per-call estimate are all positive; the call cap is limited to 1,000 and each monetary setting to 1,000,000 cents. The counter and reserved cents persist across normal restarts in `data/provider-call-budget.json`; failed calls still consume reservations and unreadable or incompatible same-day budget storage fails closed. Set the values using current provider pricing and a conservative upper bound, not a guess. **This is a cap on configured estimates, not a guarantee of actual provider charges**: token usage, price changes or incorrect estimates can exceed it. Configure provider-side billing limits too; this local counter is not a production billing control. Decision providers are called only after an on-demand lookup finds payment-link evidence; contact-page candidates are not sent to them. Optional Parallel Search is called when no such link was found; it returns unverified leads only and cannot upgrade a result. The service sends a compact packet of the public profile URL, support links, cited source URLs and bounded, contact-redacted evidence excerpts, up to ten public identity-link declarations to Drex, or the public profile and search terms for search; it does not send full page content or masked email contacts. Redaction is best-effort, not a guarantee that free-form public text contains no personal data. Both Parallel transports return a typed probability/refusal and call-level citations; Drex assesses relevance, contradictions, identity-link strength and the need for independent verification using the supplied evidence; it does not browse. Provider responses are advisory and may be wrong. Refusal, contradiction, missing citations or citations that do not match the supplied profile/source paths downgrade the result to a potential contact. A matching path is only a screening check, not proof that the citation supports the claim. Failures show warnings and do not create verification.

No Fingerprint.to integration is enabled: its [public site](https://fingerprint.to/) labels its API **coming soon**, and its [terms](https://fingerprint.to/terms) restrict scraping and automated access. Approved API access, a stable contract and permissible use must be established before an adapter can be implemented; the website is not scraped.

For a judge-oriented walkthrough and its prerequisites, see [DEMO.md](DEMO.md).

## PayPal sandbox demo — separate from discovery

This demo uses the fixed sandbox merchant associated with your sandbox REST app, a fixed USD 1.00 amount, and a separately approved sandbox buyer. It does **not** take a discovered name, email, link, merchant ID or recipient as input. It uses only `https://api-m.sandbox.paypal.com`; there is no production mode. The buyer approves on PayPal's sandbox page before the server attempts capture on the return URL. The request specifies `NO_SHIPPING` for this digital demo; PayPal account settings can override experience preferences.

1. Create or select a sandbox REST application and sandbox buyer/seller accounts in the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/).
2. Set `PAYPAL_SANDBOX_CLIENT_ID` and `PAYPAL_SANDBOX_CLIENT_SECRET` in the server's environment. Use sandbox credentials only; do not put secrets in the extension or repository. Optionally run `npm run check:sandbox` in that environment: it calls only PayPal's sandbox OAuth token endpoint, does not print credentials or tokens, and creates no order. Success does not validate buyer approval or capture.
3. Restart and pair the extension. In the popup or result panel choose **PayPal sandbox demo**, confirm the warning, and use a sandbox buyer to approve. On return, the local page reports the sandbox capture status. Check the sandbox dashboard if the return fails or is ambiguous.

This path is implemented against PayPal's Orders v2 API and was exercised once with sandbox credentials on 12 November 2026: the order was created, approved by a sandbox personal account and captured with status `COMPLETED`. A successful sandbox capture is not proof that a discovered creator is a valid payee. PayPal product eligibility and acceptable identifier types vary by product and account; a PayPal.Me URL, merchant ID, public email or phone is not, by itself, permission or proof that a specific payout API can use it. Real PayPal checkout may reveal recipient information to the payer.

## Security and privacy

See [PRIVACY.md](PRIVACY.md) for data flows, retention and local removal details.

- The local backend requires a pairing token for lookup, settings, cache deletion and sandbox-order creation (it hands that token to any browser-extension origin, so other extensions in the same browser could use it), rejects non-extension browser origins except PayPal's sandbox origin on the sandbox return/cancel routes, rate-limits requests and uses an in-memory FIFO queue (four active jobs, up to sixteen waiting). Clearing the cache cancels queued work and prevents subsequent source and paid-provider calls from starting in canceled jobs; an already-running external call may still finish. It emits minimal event/outcome audit records to the server console without profile URLs or candidate data; these records are not durable. It is designed only for a trusted single-user computer, not for Internet deployment. Other local processes with the token can use it.
- The public fetcher accepts HTTPS only, rejects literal IPs, private/reserved IPv4 and nonstandard ports, resolves and pins a public IPv4 address, enforces response-size (2 MB) and request-time limits, and refuses redirects, except that web-page fetches follow up to three redirects that stay on the same site (path or `www.` changes), each validated again and sent without the original headers. It retries a transient DNS failure or HTTP 5xx once; it does not retry rate limits or paid provider calls. IPv6-only sites and sites requiring redirects will fail safely. DNS and external service availability can still affect results. The public-source fetcher contacts the requested page, official platform and funding/README endpoints, one profile-linked site and, when needed, one explicitly linked same-origin contact page. Page content is untrusted evidence, not instructions.
- An extension icon does not trigger background bulk lookups. The browser sends the selected public URL, not the whole browsing page. Query strings and fragments are stripped before lookup to avoid leaking tracking parameters or secrets; pages that require them may not work. No third-party provider keys are bundled in the extension. Result links and public source metadata are visible in the panel and may appear in browser history. Do not use this tool to discover private information, bypass access controls, or contact/pay people without authorization.
- Optional encrypted cache retention is described above. Local report/suppression URLs remain in extension storage until undone or the extension is removed. The prototype has no public opt-out portal or external report receiver.
- The persisted AI call and estimated-spend reservation limits do not guarantee actual provider charges and do not protect against local tampering. The local backend is not suitable for production, shared hosting or untrusted networks without authentication, durable quotas, stronger auditing, privacy review and further security work.

## Testing

```sh
# Everything offline in one go (build, unit tests and all 17 offline browser checks). Close the server window first: these use port 4318.
npm run check:offline
# The same set in another browser, for example Microsoft Edge (all 19 passed in Edge 157):
# CHROME_PATH="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" npm run check:offline
# Or one at a time:
npm test
npm run build
# Optional isolated source-and-lockfile installation check:
node tests/clean-install-check.mjs
# Optional: npx playwright-core install chromium, or set CHROME_PATH to a compatible Chromium build
node tests/browser-check.mjs
# Offline extension UI and dynamic-author fixtures (no live providers):
node tests/panel-fixture-check.mjs
node tests/content-fixture-check.mjs
node tests/sandbox-http-fixture-check.mjs  # stubs PayPal; no live checkout
node tests/popup-connection-check.mjs      # popup server-down, automatic pairing, key validation
node tests/hover-fixture-check.mjs         # X and Facebook hover button on fixtures
node tests/credit-fixture-check.mjs        # uniquely credited website author after a granted origin
node tests/popup-repo-check.mjs            # popup Use current page on a GitHub repository researches the owner
node tests/reddit-post-author-check.mjs    # Reddit post page reports its unique author
node tests/x-post-author-check.mjs         # X status page reports the post author, ignoring mentions
node tests/reddit-comment-author-check.mjs # Reddit comment permalink reports the comment author
node tests/github-issue-author-check.mjs   # GitHub issue/PR reports its human author, not assignees or bots
node tests/github-page-read-check.mjs      # GitHub profile page read used as the rate-limit fallback
node tests/github-commit-author-check.mjs  # GitHub commit list: author links that point at "commits by", not a profile
node tests/x-profile-read-check.mjs        # X profile: full bio link despite X's shortened display
node tests/reddit-profile-read-check.mjs   # Reddit profile: bio, details links and social links
node tests/stackoverflow-icons-check.mjs   # Stack Overflow icons keyed by numeric user ID
node tests/youtube-check.mjs               # YouTube hover button, video publisher and channel read
```

The repository includes a GitHub Actions Node 22/24 Windows/Linux build-and-unit-test workflow; it has not been run here. The browser check launches an isolated temporary profile and local test server, loads the unpacked extension, tests real GitHub research, fixture-based GitHub/Reddit/generic author detection, dynamic feed recycling, drag cancellation, keyboard activation, report/undo and the missing-sandbox-credentials state, and saves a screenshot under `output/playwright/`. `node tests/live-github-check.mjs` separately checks visible author icons and an inline click on GitHub's live issue list. It does not test a live Reddit lookup, paid AI service or PayPal checkout. `node tests/live-free-decision-check.mjs` and `node tests/live-free-decision-browser-check.mjs` are separate, explicitly invoked live public-profile lookups and unauthenticated free Parallel decisions; each sends public evidence to Parallel and consumes its free rate limit. `PREGRANT=1 node tests/generic-permission-check.mjs` exercises optional-site injection with a pre-granted test-only manifest. A separate headed interactive test displayed and approved the actual Chrome permission prompt for an isolated fixture profile; behavior may differ across browser versions. `CHROME_PATH` must point to a Chromium build that permits loading unpacked extensions via command-line flags; recent branded Chrome releases may not. Without `CHROME_PATH`, the checks use Playwright's expected Chromium, or the newest Playwright Chromium installed if another project's Playwright update removed it (`tests/chrome-path.mjs`).

## Known limitations

- Inline coverage is conservative, not universal; only selected GitHub/Reddit author selectors and opt-in generic author markup are supported. Closed shadow roots and changed site markup may be missed.
- Reddit's unauthenticated endpoint returned HTTP 403 and an isolated browser saw a human-verification challenge during testing. An approved OAuth bearer token can be configured, but obtaining, refreshing and live-testing one remain external setup; no access or challenge bypass is implemented. Generic page matches are always unverified.
- GitHub research does not yet follow social graph links or repository-specific funding files; optional Parallel web search returns unverified leads only. Only explicit funding-file entries (GitHub Sponsors, Ko-fi, Patreon, Open Collective, Buy Me a Coffee, Liberapay), PayPal.Me links and PayPal hosted Donate links are recognized as payment-link candidates. Public `tel:` links on checked pages are masked contact candidates, not verified phone ownership.
- The free Parallel MCP decision path has been verified live; PayPal sandbox approval and capture were verified once with sandbox credentials; keyed Parallel and Drex have not been verified. No verified-payment status, creator claiming, live tipping, pledge queue, browser-wide mobile support, public correction portal or deployment is provided.
- A result is an evidence report, not identity, account-ownership or payment authorization advice.

## License

The project's own code is offered under the [MIT License](LICENSE). Dependencies have their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and review complete notices before redistribution.
