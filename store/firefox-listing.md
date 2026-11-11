# Firefox Add-ons (AMO) submission kit

## Before you submit
1. Create the public GitHub repo `giuliomacri/listing-radar` and push this folder to it (the AGPL requires the source to be available, and the popup's "Source" link points there).
2. Publish PRIVACY.md at a public URL (the GitHub page for the file is enough) and paste it in the listing.
3. Take 2–3 real screenshots of the popup in Firefox (Finds, Searches, Settings). Real ones are better than mock-ups.

## Upload
Go to https://addons.mozilla.org/developers/ -> Submit a New Add-on -> On this site (listed) -> upload `listing-radar-firefox-0.1.0.zip`.
If asked about source code: there is no build step, the zip is the source, so answer "No".

## Listing fields
**Name:** Listing Radar

**Summary (max 250 characters):**
Instant alerts for new Vinted listings that match your saved searches. Desktop notifications with photo and price, optional Telegram forwarding, checks as often as every minute. Unofficial, not affiliated with Vinted.

**Description:**
Listing Radar watches the searches you choose and tells you the moment a new listing appears, so you can be first to the good ones.

How it works
- Set your filters on the marketplace (brand, price, size, anything), then paste the page URL into Listing Radar.
- It checks in the background from your own browser and sends a notification with the photo and price for each new listing. Click it to open the listing.
- The first check only records what is already there, so you are not flooded with old items.

Features
- Any number of saved searches, each with its own check interval (from 1 minute to 24 hours)
- Desktop notifications with photo and price, plus a "Recent finds" list in the popup
- Optional forwarding to Telegram with an "Open Vinted" button
- Works with the Vinted sites for France, Germany, Italy, Spain, the Netherlands, Poland and other countries
- No account, no tracking, no data leaves your browser except the requests to the marketplace and, if you turn it on, Telegram
- Free and open source (AGPL-3.0)

Good to know
- Unofficial: not affiliated with or endorsed by Vinted. Automated checking may be contrary to the site's terms, so use sensible intervals.
- The extension asks for access to a marketplace site only when you add a search for it.

**Categories:** Shopping. **Tags:** vinted, notifications, alerts, second-hand, resale, listings
**License:** GNU Affero General Public License v3.0
**Support site / homepage:** https://github.com/giuliomacri/listing-radar
**Support email:** (your address, optional)

## Notes to reviewer (paste into "Notes for reviewers")
No build step: the uploaded files are the source. To test: open the popup, paste a search URL such as https://www.vinted.it/catalog?search_text=pokemon&order=newest_first into "Add a search" and accept the site-access prompt. The first check records a baseline; new listings after that trigger notifications. Site permissions are optional (requested per site) because the user chooses which marketplace to watch. api.telegram.org access is optional and only requested if the user enables Telegram forwarding. The extension collects no data (data_collection_permissions: none).

## After approval
Listed add-ons are usually reviewed within hours to a few days. Updates: bump "version" in manifest.json, rebuild with ./build-firefox.sh and upload the new zip as a new version.
