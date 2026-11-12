# Demonstration guide

This is a reproducible **local prototype walkthrough**, not a claim of a completed hackathon submission. Research and sandbox checkout are intentionally separate: nothing discovered on the web becomes a PayPal recipient.

## Prerequisites

1. Install Node.js 22+ and Chrome or Edge. Run `start.bat` (Windows) or `npm ci && npm run build && npm start`, and keep it open.
2. Load the unpacked `extension` directory in `chrome://extensions` or `edge://extensions` (Developer mode). Pairing with the local server is automatic.
3. Open the toolbar popup and paste your OpenRouter key. The popup says whether OpenRouter accepted it. Click **Check the decision model** to see Drex Max answer one made-up example. Do not show the key in a recording.
4. Optional: paste a GitHub token (no permissions needed) under **Local connection & privacy** to lift GitHub's hourly limit. Without one, lookups fall back to public files and the profile page when the limit is used up, and the popup says so.
5. To demonstrate PayPal, configure a **sandbox** REST app and distinct sandbox buyer/merchant accounts as described in the README. Do not use live credentials. Buyer approval and capture have not yet been verified in this environment.

## Discovery and evidence

Research starts only when you click. Prefer profiles you own or have permission to feature in a public recording.

| Site | What to do |
|---|---|
| GitHub | Open an issue list or a profile and click the small icon beside a name. Try `github.com/zudsniper` (PayPal.Me, Ko-fi and GitHub Sponsors). |
| Reddit | Click the icon beside a username in a post or comment. Try the profile `reddit.com/user/SrGrafo` (Patreon and Ko-fi). |
| X, Facebook, YouTube | Hover a name or channel and click **↗ Tip**. Try `x.com/antfu7` (Open Collective and GitHub Sponsors, from the website the profile lists) and the channel `youtube.com/@rob-so-far-so-good` (PayPal.Me, Buy Me a Coffee and Ko-fi). Facebook needs a signed-in session: signed out, its sign-in dialog covers the page. |
| Stack Overflow | Click the icon beside a name on a question. Try the profile of user 157882 (PayPal.Me). |
| Any website | Open the popup and choose **Use current page**, or right-click a link and choose **Research this creator with Universal Tip**. Try `sindresorhus.com` (owner found through a Keybase proof). |

1. Watch the panel's live stage messages. Inspect the candidate type, original source link, checked time and **Evidence details**. A PayPal.Me or other funding link is marked as published, not as independently account-verified; a public email or phone is masked and is only a contact candidate.
2. For a PayPal.Me link listed on the person's own profile, the panel offers $3, $5 and $10 buttons that open PayPal with the amount filled in. You confirm on PayPal; Universal Tip never moves money. In a recording, stop before confirming.
3. With an OpenRouter key saved, show the decision model's advisory questions, estimates or refusals. No score authorizes a payment. Outputs depend on real sources and provider responses and must not be staged as fixtures.
4. Optionally test **Report wrong match and hide this profile**, then undo it. This correction stays local; it does not contact the creator.

Unsupported or ambiguous layouts may not show an icon; use the popup or the right-click menu instead.

## Isolated PayPal sandbox checkout

1. In the popup or research panel, choose the separately labeled **$1 sandbox demo** and accept the warning. This opens a test checkout for the merchant associated with your sandbox REST app, **not** the discovered creator.
2. Sign in only with a sandbox buyer, review the test checkout, and approve it. The local return page reports the capture status; if it is ambiguous, check your sandbox merchant dashboard rather than retrying blindly.
3. Explain on screen that no real money was sent and that a discovered contact or link does not prove recipient ownership or authorize payout.

The official competition requires a functional demo with central PayPal integration. Whether this intentionally isolated sandbox flow meets that judging requirement is unresolved. A valid entry also requires the other items in the hackathon's official rules, including a public open-source repository and a public YouTube video under three minutes. No repository publication, video upload or submission has been performed.

## Offline checks without credentials

Run `npm test`, `node tests/content-fixture-check.mjs`, and `node tests/panel-fixture-check.mjs` after building and installing a compatible Playwright Chromium. The latter two use local fixtures and make no live AI or PayPal calls. Fixture results demonstrate behavior and safe rendering only; they are not proof of real provider integration or a successful sandbox capture. See .planning/VERIFICATION.md for observed checks and remaining gaps.
