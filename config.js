// Central place for things you will want to change before publishing.
export const DONATE_URL = "https://www.paypal.com/donate/?hosted_button_id=VJRCVRKBU9GXC";
export const SOURCE_URL = "https://github.com/giuliomacri/listing-radar"; // AGPL: must point at the public source of THIS extension
export const DEFAULT_INTERVAL_MIN = 2;      // alarms allow >= 0.5 min in Chrome 120+
export const INTERVAL_CHOICES_MIN = [0.5, 1, 2, 5, 10, 15, 30, 60];
export const MAX_NOTIFS_PER_QUERY_PER_POLL = 5;
export const PER_PAGE = 20;
export const IMAGE_HOST_PATTERN = "https://*.vinted.net/*"; // listing photos (images1.vinted.net)

// Safari differs: no reliable notifications API, host access is granted in Safari's own settings,
// and sub-minute alarms are not dependable.
export const isSafariUserAgent = (ua) => /^((?!chrome|chromium|android).)*safari/i.test(ua || "");
export const IS_SAFARI = typeof navigator !== "undefined" && isSafariUserAgent(navigator.userAgent);
export const IS_FIREFOX = typeof navigator !== "undefined" && /firefox/i.test(navigator.userAgent);
// Sub-minute alarms are only relied on in Chromium.
export const MIN_INTERVAL_MIN = IS_SAFARI || IS_FIREFOX ? 1 : 0.5;
export const TELEGRAM_HOST_PATTERN = "https://api.telegram.org/*";

// Bump on every change. The background part only updates when the extension is reloaded, so the popup
// compares this with what the running background reports and warns when they differ.
export const BUILD = "0.1.0+8";
