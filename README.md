# Listing Radar (working name) — browser extension

Standalone Manifest V3 extension (Chrome / Edge / Brave, Chrome ≥ 120). No Python backend:
it polls the marketplace catalogue API from the user's own browser and shows desktop notifications.
Logic is ported from `pyVintedVN/` (same endpoint, same parameter mapping, same id-watermark).

## Try it
1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select this `extension/` folder.
2. Click the toolbar icon, paste a search URL from the marketplace, press **Add** and accept the site permission.
3. The first check only records a baseline; notifications start with listings that appear after that.

Unit tests (logic only): `node test/vinted.test.mjs`

## Not yet verified
The fetch runs from the extension's service worker with the user's cookies. The Python version works, but that
this specific path gets past Vinted's bot protection (DataDome) has to be confirmed in a real browser.
If you see a red **!** badge with "Blocked (403)", open the site once in a normal tab and press **Check now**.
If it keeps happening, the fallback is to run the fetch from a content script inside an open marketplace tab.

## Before you publish
- **Name / trademark:** don't put "Vinted" in the name, icon or screenshots. "Listing Radar" is a placeholder.
- **License:** the logic is ported from an AGPL-3.0 project, so ship the extension under AGPL-3.0 too and keep
  `SOURCE_URL` in `config.js` pointing at public source. AGPL allows charging money; it does not allow closing the source.
- **Terms of service:** automated access may conflict with Vinted's terms. The extension keeps this low-impact
  (user's own browser, ≥30 s interval, jitter between queries) but the risk is not zero, for you or for users.
- **Store listing:** Chrome Web Store needs a one-time developer fee, a single-purpose description, a privacy
  statement (the extension stores searches locally and sends nothing to you) and justification for host permissions.
- **Payments:** the Chrome Web Store has no built-in payments. Donations: keep the PayPal/Ko-fi link in `config.js`.
  Paid tier: a license service such as ExtensionPay (Stripe) is the lowest-effort route.

## Realistic money
Donation-only extensions usually earn very little (coffee money). A free tier plus a small paid tier
(e.g. more saved searches, 30 s checks, Telegram/Discord forwarding) converts far better. Free limits are
not implemented yet; add them in `popup.js` / `background.js` once you pick a license provider.

## Check intervals
The popup has a default interval plus a per-search override (menu next to each saved search: Default, presets from 30 s to 1 h, or "Custom…" for any value such as `45s`, `3m`, `1h`, up to 24 h).
The floor is 30 s in Chrome/Edge/Brave (limit of the `alarms` API for packed extensions) and 1 min in Firefox/Safari. Going lower is deliberately not offered: it needs keep-alive hacks and makes Vinted's bot protection likely to block you.
After updating the extension, reload it on `chrome://extensions`; the popup warns if the background part is still the old build.
The background alarm ticks at the fastest active search and each search is only fetched when it is due.
Chrome/Edge/Brave allow 30 s; Firefox and Safari are limited to 1 minute. Faster polling raises the chance of being rate-limited.

## Safari (macOS)
Needs a Mac with the full Xcode app (not just Command Line Tools). Then:

    ./build-safari.sh com.yourname.listingradar

This writes a Safari-adjusted copy to `safari-build/` (host permissions declared directly, Chrome-only keys removed)
and runs Apple's `safari-web-extension-converter`, producing `safari-xcode/`. Open it in Xcode, Build and Run, then
enable the extension in Safari → Settings → Extensions and allow it on the Vinted sites ("Website access").
To try it without a paid account use Safari → Develop → Allow Unsigned Extensions (resets when Safari quits).
Distributing through the App Store needs the Apple Developer Program (US$99/year).

Safari differences handled in code: no reliable notifications API (new finds appear in the popup list and the toolbar
badge instead), site access granted in Safari's settings, minimum check interval 1 minute.
Not verified: the fetch path on Safari, and whether `chrome.notifications` works on your macOS version
(the "Send test notification" button tells you). If it doesn't, the next step is a small Swift bridge in the app
that posts native macOS notifications.

## Firefox (desktop and Android)
    ./build-firefox.sh listing-radar@yourdomain.com
Writes `firefox-build/` (background declared as an event page, `browser_specific_settings` added) plus a zip.
Try it: `about:debugging` → This Firefox → Load Temporary Add-on → `firefox-build/manifest.json`.
Validated with `web-ext lint` (0 errors). Not yet run in a live Firefox. Check intervals are limited to ≥ 1 minute.
Replace the placeholder gecko id with your own before submitting to addons.mozilla.org, and re-check the
`data_collection_permissions` declaration there (Telegram forwarding only sends listing details to the user's own chat).

## Telegram forwarding (optional)
Popup → "Telegram forwarding" has a built-in step-by-step guide (opens automatically the first time). In short: create a bot with BotFather, paste the token, send the bot a message, press **Detect my chat id**, tick Enabled, Save, Send test.
Each new listing is sent as a photo + caption (falls back to text). Max 5 per search per check, then a "+N more" line.
The token is stored unencrypted in this browser profile's extension storage and is never logged or synced.
If you reuse the token of the Python bot, sending works, but Telegram lets only one program read a bot's messages, so the chat id cannot be looked up automatically: the popup then asks you to type it (Python app: Config page → Chat ID). If both the app and the extension send to the same chat, you will get each alert twice.
