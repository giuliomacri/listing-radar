import { BUILD, DEFAULT_INTERVAL_MIN, IS_SAFARI, MAX_NOTIFS_PER_QUERY_PER_POLL, MIN_INTERVAL_MIN, PER_PAGE } from "./config.js";
import { buildApiUrl, normalizeItem, permissionPattern, pickNewItems } from "./lib/vinted.js";
import { sendListing, sendText } from "./lib/telegram.js";
import { alarmPeriod, dueQueries } from "./lib/schedule.js";

// Firefox exposes the promise-based `browser` namespace; Chromium only has `chrome`.
const chrome = globalThis.browser ?? globalThis.chrome;

const ALARM = "poll";
let polling = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getState() {
  const s = await chrome.storage.local.get({
    queries: [],                                   // [{id, name, url, active}]
    marks: {},                                     // {queryId: lastSeenItemId}  (background-owned)
    settings: { intervalMin: DEFAULT_INTERVAL_MIN },
  });
  return s;
}

async function ensureAlarm() {
  const { settings, queries } = await getState();
  const period = alarmPeriod(queries, Number(settings.intervalMin) || DEFAULT_INTERVAL_MIN, MIN_INTERVAL_MIN);
  const existing = await chrome.alarms.get(ALARM);
  if (!existing || existing.periodInMinutes !== period) {
    await chrome.alarms.create(ALARM, { periodInMinutes: period, delayInMinutes: Math.min(period, MIN_INTERVAL_MIN) });
  }
}

async function fetchItems(siteUrl) {
  const origin = new URL(siteUrl).origin;
  // Safari grants site access in its own settings, and permissions.contains is not reliable there.
  if (!IS_SAFARI && !(await chrome.permissions.contains({ origins: [permissionPattern(siteUrl)] }))) {
    throw new Error("Site permission missing for " + new URL(origin).host + ". Open the popup and press Check now to grant it.");
  }
  const apiUrl = buildApiUrl(siteUrl, PER_PAGE, 1);
  const apiHostName = new URL(apiUrl).host;
  const doFetch = async () => {
    try {
      return await fetch(apiUrl, {
        credentials: "include",
        redirect: "manual", // a redirect here usually means a bot-check page
        headers: { Accept: "application/json, text/plain, */*" },
      });
    } catch (e) {
      throw new Error(`Network error reaching ${apiHostName} (${e.message}). ` +
        "Check the site permission, ad/privacy blockers, or VPN/proxy.");
    }
  };

  let res = await doFetch();
  if ([401, 403, 404].includes(res.status) || res.type === "opaqueredirect") {
    // Prime / refresh the web session cookie by loading the homepage, then retry once.
    try { await (await fetch(origin + "/", { credentials: "include" })).text(); } catch { /* ignore */ }
    res = await doFetch();
  }
  if (res.type === "opaqueredirect") {
    throw new Error(`${apiHostName} redirected to a bot-check page. Open ${new URL(origin).host} in a normal tab, solve any check, then retry.`);
  }
  if (res.status === 403) {
    throw new Error("Blocked by Vinted (403). Open Vinted once in a normal tab, then retry.");
  }
  if (!res.ok) throw new Error("HTTP " + res.status + " from " + apiHostName);
  const json = await res.json();
  return (json.items || []).map((i) => normalizeItem(i, origin));
}

const FALLBACK_ICON = "icons/icon128.png";

// chrome.notifications can't reliably load remote icons ("Unable to download all specified images"),
// so fetch the photo ourselves and pass it as a data URL. Any failure -> local icon.
async function photoDataUrl(url) {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const blob = await r.blob();
    if (!blob.type.startsWith("image/") || blob.size > 400000) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${blob.type};base64,${btoa(bin)}`;
  } catch { return null; }
}

async function notify(item, queryName) {
  if (!chrome.notifications || !chrome.notifications.create) return; // e.g. Safari: popup list + badge only
  const price = item.price !== "" ? `${item.price} ${item.currency}`.trim() : "";
  const opts = {
    type: "basic",
    iconUrl: (await photoDataUrl(item.photo)) || FALLBACK_ICON,
    title: [price, item.title].filter(Boolean).join(" · ") || "New listing",
    message: [item.brand, queryName].filter(Boolean).join(" — ") || "New listing",
    priority: 2,
  };
  const id = "item|" + item.url;
  try {
    await chrome.notifications.create(id, opts);
  } catch {
    await chrome.notifications.create(id, { ...opts, iconUrl: FALLBACK_ICON }); // last resort
  }
}

// Keep the latest finds so the popup can list them (the only alert channel where notifications are unavailable).
async function recordRecent(fresh, queryName) {
  if (!fresh.length) return;
  const { recent, unread } = await chrome.storage.local.get({ recent: [], unread: 0 });
  const added = fresh.map((i) => ({
    id: i.id, title: i.title, brand: i.brand, price: i.price, currency: i.currency, photo: i.photo, url: i.url,
    query: queryName, at: Date.now(),
  })).reverse(); // newest first
  await chrome.storage.local.set({ recent: [...added, ...recent].slice(0, 30), unread: unread + fresh.length });
}

// Optional Telegram forwarding (configured in the popup). Failures never block local alerts.
async function forwardTelegram(items, queryName, overflow) {
  const { telegram } = await chrome.storage.local.get({ telegram: null });
  if (!telegram || !telegram.enabled || !telegram.token || !telegram.chatId) return;
  const f = (...a) => fetch(...a);
  for (const item of items) {
    await sendListing(f, telegram, item, queryName);
    await sleep(1100); // Telegram allows roughly one message per second per chat
  }
  if (overflow > 0) await sendText(f, telegram, `${queryName}: +${overflow} more new listings`);
}

async function setBadge(text, color) {
  try { // the toolbar badge does not exist on Firefox for Android
    if (color) await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text });
  } catch { /* ignore */ }
}

// force: check every active search now; only: check just that search id (used right after adding one).
async function pollOnce({ force = false, only = null } = {}) {
  if (polling) return;
  polling = true;
  let error = "";
  try {
    const { queries, settings } = await getState();
    const globalMin = Number(settings.intervalMin) || DEFAULT_INTERVAL_MIN;
    const { checked, qstats } = await chrome.storage.local.get({ checked: {}, qstats: {} });
    let todo = dueQueries(queries, globalMin, MIN_INTERVAL_MIN, checked, Date.now(), force || !!only);
    if (only) todo = todo.filter((x) => x.id === only);
    for (const q of todo) {
      checked[q.id] = Date.now();
      await chrome.storage.local.set({ checked });
      try {
        const items = await fetchItems(q.url);
        const { marks } = await chrome.storage.local.get({ marks: {} });
        const { fresh, maxId } = pickNewItems(items, marks[q.id] ?? null);
        marks[q.id] = maxId;
        qstats[q.id] = { at: Date.now(), fetched: items.length, fresh: fresh.length, maxId };
        await chrome.storage.local.set({ qstats });
        await chrome.storage.local.set({ marks });
        await recordRecent(fresh, q.name);
        for (const item of fresh.slice(-MAX_NOTIFS_PER_QUERY_PER_POLL)) {
          try { await notify(item, q.name); } catch (e) { error = "Notification failed: " + e.message; }
        }
        const shown = fresh.slice(-MAX_NOTIFS_PER_QUERY_PER_POLL);
        try { await forwardTelegram(shown, q.name, fresh.length - shown.length); }
        catch (e) { error = "Telegram failed: " + e.message; }
        if (fresh.length > MAX_NOTIFS_PER_QUERY_PER_POLL) {
          if (chrome.notifications && chrome.notifications.create) {
            await chrome.notifications.create("more|" + q.id, {
              type: "basic", iconUrl: "icons/icon128.png", title: q.name || "Listing Radar",
              message: `+${fresh.length - MAX_NOTIFS_PER_QUERY_PER_POLL} more new listings`,
            });
          }
        }
      } catch (e) {
        error = `${q.name || q.url}: ${e.message}`;
        qstats[q.id] = { at: Date.now(), error: e.message };
        await chrome.storage.local.set({ qstats });
      }
      await sleep(400 + Math.random() * 800); // be gentle, avoid bursts
    }
  } finally {
    polling = false;
    await chrome.storage.local.set({ status: { lastRun: Date.now(), error, build: BUILD } });
    const { unread } = await chrome.storage.local.get({ unread: 0 });
    await setBadge(error ? "!" : unread ? String(unread) : "", "#c0392b");
  }
}

// Tell the popup which version of this file is actually running.
chrome.storage.local.get({ status: null }).then(({ status }) => {
  if (!status || status.build !== BUILD) return chrome.storage.local.set({ status: { ...(status || {}), build: BUILD } });
});

chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);
chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) pollOnce(); });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.settings || changes.queries)) ensureAlarm();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "testNotify") {
    notify({ id: 0, title: "Test listing", brand: "Listing Radar", price: "10", currency: "EUR", photo: "", url: "https://www.vinted.it/" }, "Test")
      .then(() => (chrome.notifications.getPermissionLevel ? chrome.notifications.getPermissionLevel() : "n/a (not exposed by this browser)"))
      .then((level) => sendResponse({ ok: true, level }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg && msg.type === "pollNow") {
    pollOnce({ force: true, only: msg.queryId || null }).then(() => sendResponse({ ok: true }));
    return true; // async response
  }
});

chrome.notifications.onClicked.addListener((id) => {
  if (id.startsWith("item|")) chrome.tabs.create({ url: id.slice(5) });
  chrome.notifications.clear(id);
});
