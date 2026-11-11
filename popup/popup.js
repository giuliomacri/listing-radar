const chrome = globalThis.browser ?? globalThis.chrome;
import { BUILD, DONATE_URL, SOURCE_URL, INTERVAL_CHOICES_MIN, DEFAULT_INTERVAL_MIN } from "../config.js";
import { MAX_INTERVAL_MIN, formatInterval } from "../lib/schedule.js";
import { IMAGE_HOST_PATTERN, IS_FIREFOX, IS_SAFARI, MIN_INTERVAL_MIN, TELEGRAM_HOST_PATTERN } from "../config.js";
import { extractToken, findChatId, getBotName, sendText, validateTelegramConfig } from "../lib/telegram.js";
import { describeQuery, isVintedCatalogUrl, normalizeQueryUrl, permissionPattern } from "../lib/vinted.js";

const $ = (id) => document.getElementById(id);
$("donate").href = DONATE_URL;
$("source").href = SOURCE_URL;

async function load() {
  return chrome.storage.local.get({
    queries: [], settings: { intervalMin: DEFAULT_INTERVAL_MIN }, status: null, recent: [], qstats: {},
  });
}

// Text with clickable links. parts: strings and [text, url] pairs. chrome:// pages can't be opened by a plain
// link from an extension, so those go through tabs.create.
function rich(el, ...parts) {
  el.textContent = "";
  for (const p of parts) {
    if (typeof p === "string") { el.appendChild(document.createTextNode(p)); continue; }
    const [text, url] = p;
    const a = document.createElement("a");
    a.textContent = text; a.href = url; a.target = "_blank"; a.rel = "noopener";
    if (!/^https?:/.test(url)) a.onclick = (e) => { e.preventDefault(); chrome.tabs.create({ url }); };
    el.appendChild(a);
  }
}

// Interval picker: presets plus "Custom…", which shows a number box and a unit menu (seconds / minutes / hours).
// `defaultLabel` (per-search pickers) adds a "Default (…)" entry that stores null.
const UNIT_MIN = { s: 1 / 60, min: 1, h: 60 };
function makeIntervalPicker({ value, defaultLabel, onSave }) {
  const wrap = document.createElement("span");
  wrap.className = "ipicker";
  const presets = INTERVAL_CHOICES_MIN.filter((x) => x >= MIN_INTERVAL_MIN);

  function showSelect() {
    wrap.innerHTML = "";
    const sel = document.createElement("select");
    sel.title = "How often to check";
    const add = (v, text) => { const o = document.createElement("option"); o.value = v; o.textContent = text; sel.appendChild(o); };
    if (defaultLabel) add("", defaultLabel);
    for (const m of presets) add(String(m), formatInterval(m));
    const num = Number(value);
    if (num > 0 && !presets.includes(num)) add(String(num), `Custom: ${formatInterval(num)}`);
    add("__custom", "Custom\u2026");
    sel.value = num > 0 ? String(num) : "";
    sel.onchange = () => (sel.value === "__custom" ? showCustom() : onSave(sel.value ? Number(sel.value) : null));
    wrap.appendChild(sel);
  }
  function showCustom() {
    wrap.innerHTML = "";
    const num = Number(value) > 0 ? Number(value) : Math.max(MIN_INTERVAL_MIN, 1);
    const startUnit = num < 1 ? "s" : num % 60 === 0 ? "h" : "min";
    const inp = document.createElement("input");
    inp.type = "number"; inp.min = "1"; inp.step = "1";
    inp.value = String(Math.round(num / UNIT_MIN[startUnit]));
    const unit = document.createElement("select");
    for (const [v, t] of [["s", "seconds"], ["min", "minutes"], ["h", "hours"]]) {
      if (v === "s" && MIN_INTERVAL_MIN >= 1) continue; // Firefox/Safari: nothing below 1 minute
      const o = document.createElement("option"); o.value = v; o.textContent = t; unit.appendChild(o);
    }
    unit.value = [...unit.options].some((o) => o.value === startUnit) ? startUnit : "min";
    const ok = document.createElement("button"); ok.textContent = "Set"; ok.className = "primary";
    const cancel = document.createElement("button"); cancel.textContent = "\u2715"; cancel.title = "Cancel";
    const range = `${formatInterval(MIN_INTERVAL_MIN)} \u2013 24 h`;
    ok.title = `Allowed: ${range}`;
    const commit = () => {
      const min = Number(inp.value) * UNIT_MIN[unit.value];
      if (!(Number(inp.value) > 0) || min < MIN_INTERVAL_MIN - 1e-9 || min > MAX_INTERVAL_MIN) {
        hint.classList.add("err"); inp.classList.add("bad"); inp.title = `Allowed: ${range}`; ok.title = `Not allowed. Allowed: ${range}`; return;
      }
      onSave(Math.round(min * 60) / 60);
    };
    ok.onclick = commit; cancel.onclick = showSelect;
    inp.onkeydown = (e) => { if (e.key === "Enter") commit(); else if (e.key === "Escape") showSelect(); };
    inp.oninput = () => inp.classList.remove("bad");
    const hint = document.createElement("span");
    hint.className = "muted small ihint"; hint.textContent = `Allowed: ${range} (minimum for ${IS_FIREFOX ? "Firefox" : IS_SAFARI ? "Safari" : "Chrome"}: ${formatInterval(MIN_INTERVAL_MIN)})`;
    wrap.append(inp, unit, ok, cancel, hint);
    inp.focus(); inp.select();
  }
  showSelect();
  return wrap;
}

// Firefox only accepts permissions.request() when it is called synchronously from the click (no await before it),
// so the saved searches are kept here for the click handlers.
let knownQueries = [];

function ago(t) {
  const m = Math.round((Date.now() - (t || 0)) / 60000);
  if (!t || m < 0) return "";
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

// Tabs
const TABS = ["Finds", "Searches", "Settings"];
function showTab(name) {
  for (const t of TABS) {
    $("p" + t).hidden = t !== name;
    $("tab" + t).classList.toggle("on", t === name);
    $("tab" + t).setAttribute("aria-selected", String(t === name));
  }
}
for (const t of TABS) $("tab" + t).onclick = () => showTab(t);
let tabChosen = false;

async function render() {
  const { queries, settings, status, recent, qstats } = await load();
  knownQueries = queries;
  if (!tabChosen) {
    tabChosen = true;
    showTab(recent.length ? "Finds" : "Searches");
    $("addBox").open = queries.length === 0;
  }

  const st = $("status");
  if (status && status.build !== BUILD) {
    const where = IS_SAFARI ? "in Safari > Settings > Extensions (or restart Safari)"
      : IS_FIREFOX ? "from about:debugging (or restart Firefox)"
      : ["chrome://extensions", "chrome://extensions"];
    rich(st, "The extension was updated, but its background part is still the old version. Reload it ", ...(Array.isArray(where) ? ["on ", where] : [where]), ", then press Check now.");
    st.className = "status err";
  }
  else if (!status || !status.lastRun) { st.textContent = "Waiting for first check…"; st.className = "status"; }
  else if (status.error) { st.textContent = status.error; st.className = "status err"; }
  else { st.textContent = "Last check: " + new Date(status.lastRun).toLocaleTimeString(); st.className = "status ok"; }

  const rl = $("recent");
  rl.innerHTML = "";
  $("noRecent").hidden = recent.length > 0;
  for (const r of recent.slice(0, 10)) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = r.url; a.target = "_blank"; a.rel = "noopener"; a.className = "find";
    if (r.photo) {
      const img = document.createElement("img");
      img.className = "thumb"; img.src = r.photo; img.alt = ""; img.loading = "lazy"; img.referrerPolicy = "no-referrer";
      img.onerror = () => img.remove();
      a.appendChild(img);
    }
    const body = document.createElement("div");
    body.className = "body";
    const price = document.createElement("div");
    price.className = "price"; price.textContent = r.price !== "" && r.price != null ? `${r.price} ${r.currency}`.trim() : "Price n/a";
    const ttl = document.createElement("div");
    ttl.className = "ttl"; ttl.textContent = r.title || "Listing";
    const meta = document.createElement("div");
    meta.className = "host"; meta.textContent = [r.query, ago(r.at)].filter(Boolean).join(" \u00b7 ");
    body.append(price, ttl, meta);
    a.appendChild(body);
    li.appendChild(a);
    rl.appendChild(li);
  }

  const list = $("list");
  list.innerHTML = "";
  $("empty").hidden = queries.length > 0;
  const globalMin = Number(settings.intervalMin) || DEFAULT_INTERVAL_MIN;
  const choices = INTERVAL_CHOICES_MIN.filter((x) => x >= MIN_INTERVAL_MIN);
  for (const q of queries) {
    const li = document.createElement("li");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = q.active; cb.title = "Enabled";
    li.classList.toggle("off", !q.active);
    cb.onchange = async () => {
      li.classList.toggle("off", !cb.checked);
      const { queries } = await load();
      const t = queries.find((x) => x.id === q.id); if (t) t.active = cb.checked;
      await chrome.storage.local.set({ queries });
    };

    const label = document.createElement("div");
    label.className = "label";
    const name = document.createElement("a");
    name.className = "qname"; name.href = q.url; name.target = "_blank"; name.rel = "noopener";
    name.textContent = q.name; name.title = "Open this search\n" + q.url;
    const desc = document.createElement("div");
    desc.className = "host"; desc.textContent = describeQuery(q.url); desc.title = q.url;
    const meta = document.createElement("div");
    meta.className = "host";
    const s = qstats[q.id];
    meta.textContent = !s ? "not checked yet"
      : s.error ? "\u26a0 " + s.error
      : `checked ${new Date(s.at).toLocaleTimeString()} \u00b7 ${s.fetched} fetched, ${s.fresh} new`;
    meta.title = meta.textContent;
    label.append(name, desc, meta);

    const per = makeIntervalPicker({
      value: q.intervalMin,
      defaultLabel: `Default (${formatInterval(globalMin)})`,
      onSave: async (v) => {
        const { queries } = await load();
        const t = queries.find((x) => x.id === q.id);
        if (t) t.intervalMin = v;
        await chrome.storage.local.set({ queries });
        render();
      },
    });

    const del = document.createElement("button");
    del.textContent = "\u2715"; del.title = "Remove";
    del.onclick = async () => {
      const st = await chrome.storage.local.get({ queries: [], marks: {}, checked: {}, qstats: {} });
      delete st.marks[q.id]; delete st.checked[q.id]; delete st.qstats[q.id];
      await chrome.storage.local.set({ queries: st.queries.filter((x) => x.id !== q.id), marks: st.marks, checked: st.checked, qstats: st.qstats });
      render();
    };
    li.append(cb, label, per, del);
    list.appendChild(li);
  }

  const box = $("intervalBox");
  box.innerHTML = "";
  box.appendChild(makeIntervalPicker({
    value: globalMin,
    defaultLabel: null,
    onSave: async (v) => {
      const { settings } = await load();
      await chrome.storage.local.set({ settings: { ...settings, intervalMin: v } });
      render(); // refresh the "Default (\u2026)" labels
    },
  }));
  $("intervalHelp").textContent = `Pick a preset, or "Custom\u2026" to choose any value. Shortest allowed here: ${formatInterval(MIN_INTERVAL_MIN)}. Each saved search can override this with its own menu.`;
}

// Ask for the site permission (essential) plus the image CDN (nice-to-have: photos in notifications).
// Falls back to the site pattern alone if the combined request is rejected.
async function requestPerms(sitePattern) {
  // Safari grants site access in its own settings (Settings > Extensions > Website access).
  if (IS_SAFARI || !chrome.permissions || !chrome.permissions.request) return true;
  try {
    return await chrome.permissions.request({ origins: [sitePattern, IMAGE_HOST_PATTERN] });
  } catch {
    return await chrome.permissions.request({ origins: [sitePattern] });
  }
}

$("add").onclick = async () => {
  const msg = $("addMsg");
  msg.textContent = "";
  try {
    const raw = $("url").value.trim();
    if (!isVintedCatalogUrl(raw)) { msg.textContent = "That doesn't look like a marketplace search URL (…/catalog?…)."; return; }
    const url = normalizeQueryUrl(raw);
    // Ask for the permission right away, inside the click (Firefox requirement); the rest runs meanwhile.
    const grantedP = requestPerms(permissionPattern(url)).catch((e) => { throw new Error("Permission request failed: " + e.message); });
    const { queries } = await load();
    if (queries.some((q) => q.url === url)) { msg.textContent = "Already added."; return; }
    const sp = new URL(url).searchParams;
    const name = $("name").value.trim() || sp.get("search_text") || "Search " + (queries.length + 1);

    // Save first: the permission prompt can close this popup, and the search must survive that.
    const newId = crypto.randomUUID();
    queries.push({ id: newId, name, url, active: true, intervalMin: null });
    await chrome.storage.local.set({ queries });
    $("url").value = ""; $("name").value = "";
    msg.textContent = "Added. Accept the permission prompt if one appears.";
    render();

    const granted = await grantedP;
    msg.textContent = !granted ? "Added, but permission was not granted. Press Check now to grant it."
      : IS_SAFARI ? "Added. In Safari also allow this site: Settings > Extensions > Listing Radar > Website access."
      : "Added.";
    chrome.runtime.sendMessage({ type: "pollNow", queryId: newId }); // sets the baseline immediately
  } catch (e) {
    msg.textContent = "Error: " + e.message;
  }
};

$("checkNow").onclick = async () => {
  // Searches added before the permission fix only hold the www.* grant; re-request the wildcard.
  // The request must be the first thing in this click handler (Firefox), hence knownQueries.
  let permErr = "";
  if (knownQueries.length && !IS_SAFARI && chrome.permissions && chrome.permissions.request) {
    const origins = [...new Set([...knownQueries.map((q) => permissionPattern(q.url)), IMAGE_HOST_PATTERN])];
    try { await chrome.permissions.request({ origins }); } catch (e) { permErr = e.message; }
  }
  $("checkNow").disabled = true;
  $("status").classList.add("busy");
  await chrome.runtime.sendMessage({ type: "pollNow" });
  $("checkNow").disabled = false;
  await render();
  if (permErr) $("status").textContent += ` (permission request failed: ${permErr})`;
};

(async () => {
  const { status } = await load();
  await chrome.storage.local.set({ unread: 0 });
  try { await chrome.action.setBadgeText({ text: status && status.error ? "!" : "" }); } catch { /* no badge (e.g. Firefox Android) */ }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  // tab.url is only visible if we have host permission; otherwise it's undefined and the button stays hidden.
  if (tab && tab.url && isVintedCatalogUrl(tab.url)) {
    $("useTab").hidden = false;
    $("useTab").onclick = () => { $("url").value = tab.url; };
  }
  render();
})();

$("testNotif").onclick = async () => {
  const r = await chrome.runtime.sendMessage({ type: "testNotify" });
  $("addMsg").textContent = r && r.ok
    ? `Test sent. Chrome notification level: ${r.level}. If you saw nothing, check macOS notification settings for your browser.`
    : "Test failed: " + (r && r.error);
};

// ---- Telegram forwarding (optional)
const TOKEN_RE = /^\d{5,}:[A-Za-z0-9_-]{20,}$/;
const tgFetch = (...a) => fetch(...a);
let tgChat = { id: "", name: "" };   // found automatically; never typed by the user
let savedToken = "";

async function askTelegramPermission() {
  if (IS_SAFARI || !chrome.permissions || !chrome.permissions.request) return true;
  try { return await chrome.permissions.request({ origins: [TELEGRAM_HOST_PATTERN] }); } catch { return false; }
}
// "Save" turns into a disabled "Saved ✓" while what is on screen equals what was saved.
let savedKey = null;
const tgKey = () => { const c = readTg(); return JSON.stringify([c.enabled, c.token, c.chatId]); };
function refreshSaveBtn() {
  const clean = savedKey !== null && savedKey === tgKey();
  const b = $("tgSave");
  b.textContent = clean ? "Saved \u2713" : "Save";
  b.disabled = clean;
  b.classList.toggle("primary", !clean);
}
function updateChatInfo() {
  $("tgChatInfo").textContent = tgChat.id
    ? `Chat: ${tgChat.name || "your chat"} ✓`
    : "Chat: not found yet. It is found automatically when you press Save, after you have sent your bot a message.";
  $("tgReset").hidden = !tgChat.id;
  refreshSaveBtn();
}
function readTg() {
  return { enabled: $("tgEnabled").checked, token: extractToken($("tgToken").value), chatId: tgChat.id, chatName: tgChat.name };
}
(async () => {
  const { telegram } = await chrome.storage.local.get({ telegram: null });
  if (telegram) {
    $("tgEnabled").checked = !!telegram.enabled;
    $("tgToken").value = telegram.token || "";
    savedToken = telegram.token || "";
    tgChat = { id: telegram.chatId || "", name: telegram.chatName || "" };
    if (telegram.enabled) $("tgBox").open = true;
  }
  if (telegram && telegram.token && telegram.chatId) savedKey = tgKey();
  updateChatInfo();
})();

// Remember what was typed right away: the popup closes as soon as the user clicks elsewhere
// (for example to copy the token from Telegram), and unsaved input would be lost.
async function persistTg() {
  const cfg = readTg();
  savedToken = cfg.token;
  await chrome.storage.local.set({ telegram: cfg });
}

// Look the chat up from the bot's recent messages. Returns true if found; otherwise shows what to do.
async function detectChat(token, msg) {
  msg.textContent = "Looking for your chat…";
  await askTelegramPermission();
  let found;
  try { found = await findChatId(tgFetch, token); }
  catch (e) {
    if (!e.conflict) throw e;
    // Shared bot: sending still works, only the automatic lookup is impossible. Ask for the chat id instead.
    $("tgChatManual").hidden = false;
    rich(msg, e.message + " Sharing the bot is fine: type your chat id in the box below (in the Python app it is the \"Chat ID\" field on its Config page at ", ["localhost:8000", "http://localhost:8000"], "), then press the button again.");
    return false;
  }
  if (!found) {
    const bot = await getBotName(tgFetch, token);
    rich(msg, "Open your bot (", [`t.me/${bot}`, `https://t.me/${bot}`], ') in Telegram, press Start and send it a message like "hi", then press this button again.');
    return false;
  }
  tgChat = { id: found.chatId, name: found.name };
  updateChatInfo();
  await persistTg();
  return true;
}
async function withChat(msg) {
  const token = extractToken($("tgToken").value);
  if (!TOKEN_RE.test(token)) { msg.textContent = validateTelegramConfig({ token, chatId: "0" }); return null; }
  const manual = $("tgChatManual").value.trim();
  if (!$("tgChatManual").hidden && manual) { tgChat = { id: manual, name: `chat ${manual}` }; updateChatInfo(); }
  if (!tgChat.id && !(await detectChat(token, msg))) return null;
  const cfg = readTg();
  const bad = validateTelegramConfig(cfg);
  if (bad) { msg.textContent = bad; return null; }
  return cfg;
}

$("tgSave").onclick = async () => {
  const msg = $("tgMsg");
  try {
    let cfg = readTg();
    if (cfg.enabled) {
      cfg = await withChat(msg);
      if (!cfg) return;
      msg.textContent = (await askTelegramPermission())
        ? (cfg.enabled ? "Saved. Alerts will be forwarded to Telegram. Press Send test to check." : "Saved.")
        : "Saved, but permission to reach Telegram was not granted.";
    } else msg.textContent = "Saved (disabled).";
    savedToken = cfg.token;
    await chrome.storage.local.set({ telegram: cfg });
    savedKey = tgKey(); refreshSaveBtn();
  } catch (e) { msg.textContent = e.message; }
};
$("tgTest").onclick = async () => {
  const msg = $("tgMsg");
  try {
    const cfg = await withChat(msg);
    if (!cfg) return;
    await askTelegramPermission();
    await sendText(tgFetch, cfg, "Listing Radar: test message ✅");
    msg.textContent = "Test sent. Check your Telegram chat.";
    await persistTg(); // it works, so keep it
    savedKey = tgKey(); refreshSaveBtn();
  } catch (e) { msg.textContent = "Test failed: " + e.message; }
};
// Switch to whichever chat wrote to the bot most recently (e.g. a group instead of your private chat).
$("tgReset").onclick = async () => {
  const msg = $("tgMsg");
  const token = extractToken($("tgToken").value);
  if (!TOKEN_RE.test(token)) { msg.textContent = validateTelegramConfig({ token, chatId: "0" }); return; }
  try {
    if (await detectChat(token, msg)) msg.textContent = `Now using: ${tgChat.name}. Press Save.`;
  } catch (e) { msg.textContent = e.message; }
};
// First time in: open the guide when Telegram has not been set up yet.
chrome.storage.local.get({ telegram: null }).then(({ telegram }) => { if (!telegram) $("tgGuide").open = true; });

// If the whole BotFather message was pasted, keep only the token. A different token means a different bot, so forget the old chat.
$("tgToken").addEventListener("input", () => {
  const t = extractToken($("tgToken").value);
  if (t !== $("tgToken").value.trim()) $("tgToken").value = t;
  if (t !== savedToken && tgChat.id) { tgChat = { id: "", name: "" }; updateChatInfo(); }
  persistTg(); refreshSaveBtn();
});
$("tgEnabled").addEventListener("change", () => { persistTg(); refreshSaveBtn(); });
$("tgChatManual").addEventListener("input", () => {
  const v = $("tgChatManual").value.trim();
  tgChat = v ? { id: v, name: `chat ${v}` } : { id: "", name: "" };
  updateChatInfo();
  persistTg();
});
// A chat id that was typed by hand last time: show the box again, filled in.
chrome.storage.local.get({ telegram: null }).then(({ telegram }) => {
  if (telegram && telegram.chatId && /^chat /.test(telegram.chatName || "")) {
    $("tgChatManual").hidden = false;
    $("tgChatManual").value = telegram.chatId;
  }
});
