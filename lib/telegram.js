// Optional Telegram forwarding. Pure functions + an injected fetch so it is testable with node.
// Never put the bot token in an error message or log line.

export const escapeHtml = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildCaption(item, queryName) {
  const price = item.price !== "" && item.price != null ? `${item.price} ${item.currency}`.trim() : "";
  const head = [price, item.title].filter(Boolean).join(" · ") || "New listing";
  const sub = [item.brand, queryName].filter(Boolean).join(" — ");
  const lines = [`<b>${escapeHtml(head)}</b>`];
  if (sub) lines.push(escapeHtml(sub));
  return lines.join("\n");
}

export function validateTelegramConfig({ token, chatId }) {
  if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token || "")) return "That doesn't look like a Token API (it looks like 123456:ABC…).";
  if (!/^(-?\d+|@[A-Za-z0-9_]{4,})$/.test(chatId || "")) return "Chat id should be a number (or @channelname).";
  return "";
}

async function call(fetchFn, token, method, params) {
  // Form-encoded body keeps this a "simple" request (no CORS preflight).
  const res = await fetchFn(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    body: new URLSearchParams(params),
  });
  let json = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  if (!res.ok || !json || !json.ok) {
    throw new Error(json && json.description ? json.description : `HTTP ${res.status}`);
  }
  return json;
}

export async function sendText(fetchFn, cfg, text) {
  await call(fetchFn, cfg.token, "sendMessage", { chat_id: cfg.chatId, text });
}

// Inline button under the message, like the Python version's "Open Vinted".
export const openButton = (url) => JSON.stringify({ inline_keyboard: [[{ text: "Open Vinted", url }]] });

export async function sendListing(fetchFn, cfg, item, queryName) {
  const caption = buildCaption(item, queryName);
  const reply_markup = openButton(item.url);
  if (item.photo) {
    try {
      // Telegram downloads the photo from its URL itself.
      await call(fetchFn, cfg.token, "sendPhoto", { chat_id: cfg.chatId, photo: item.photo, caption, parse_mode: "HTML", reply_markup });
      return;
    } catch { /* photo rejected -> fall back to a text message below */ }
  }
  await call(fetchFn, cfg.token, "sendMessage", { chat_id: cfg.chatId, text: caption, parse_mode: "HTML", reply_markup });
}

function friendly(e) {
  const m = e && e.message ? e.message : String(e);
  if (/unauthorized|not found/i.test(m)) return new Error("Telegram rejected the Token API. Copy it again from BotFather (step 3).");
  if (/conflict/i.test(m)) {
    // Telegram lets only one program read a bot's incoming messages at a time. Sending is not affected.
    const err = new Error("Another program (probably your Python bot) is already reading this bot's messages, so the chat can't be looked up automatically.");
    err.conflict = true;
    return err;
  }
  return e instanceof Error ? e : new Error(m);
}

export async function getBotName(fetchFn, token) {
  try { return (await call(fetchFn, token, "getMe", {})).result.username; } catch (e) { throw friendly(e); }
}

// Looks at the bot's recent messages and returns the most recent chat, or null if nobody has written to it yet.
// getUpdates without an offset does not consume the updates.
export async function findChatId(fetchFn, token) {
  let json;
  try { json = await call(fetchFn, token, "getUpdates", { limit: "20" }); } catch (e) { throw friendly(e); }
  for (const u of [...(json.result || [])].reverse()) {
    const m = u.message || u.edited_message || u.channel_post;
    if (m && m.chat && m.chat.id != null) {
      const c = m.chat;
      return { chatId: String(c.id), name: c.title || [c.first_name, c.last_name].filter(Boolean).join(" ") || c.username || "your chat" };
    }
  }
  return null;
}

// Accepts the whole BotFather message (or just the token) and returns the token, or the trimmed input if none is found.
export function extractToken(text) {
  const m = String(text || "").match(/\d{5,}:[A-Za-z0-9_-]{30,}/);
  return m ? m[0] : String(text || "").trim();
}
