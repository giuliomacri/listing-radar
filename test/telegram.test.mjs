import assert from "node:assert/strict";
import { openButton, extractToken, buildCaption, escapeHtml, findChatId, getBotName, sendListing, sendText, validateTelegramConfig } from "../lib/telegram.js";

const item = { id: 1, title: "Card <b>&\"x\"", brand: "Poké", price: "5", currency: "EUR", photo: "https://img/x.jpg", url: "https://www.vinted.it/items/1-x?a=1&b=2" };
const cap = buildCaption(item, "pokemon");
assert.ok(cap.includes("&lt;b&gt;&amp;&quot;x&quot;"));            // title escaped
assert.ok(!cap.includes("href"));                                   // the link is now a button
assert.deepEqual(JSON.parse(openButton(item.url)), { inline_keyboard: [[{ text: "Open Vinted", url: item.url }]] });
assert.equal(escapeHtml(null), "");

assert.equal(validateTelegramConfig({ token: "123456:ABCdefGhIJKlmNoPQRsTUVwxyZ123456789", chatId: "-1001234" }), "");
assert.ok(validateTelegramConfig({ token: "nope", chatId: "1" }));
assert.ok(validateTelegramConfig({ token: "123456:ABCdefGhIJKlmNoPQRsTUVwxyZ123456789", chatId: "abc" }));

const cfg = { token: "123456:ABCdefGhIJKlmNoPQRsTUVwxyZ123456789", chatId: "42" };
const mkFetch = (handler) => { const calls = []; const f = async (url, opts) => { calls.push({ url, body: Object.fromEntries(opts.body) }); return handler(url); }; f.calls = calls; return f; };
const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
const fail = (d, s = 400) => new Response(JSON.stringify({ ok: false, description: d }), { status: s });

// photo path
let f = mkFetch(ok); await sendListing(f, cfg, item, "pokemon");
assert.equal(f.calls.length, 1); assert.ok(f.calls[0].url.endsWith("/sendPhoto")); assert.equal(f.calls[0].body.chat_id, "42"); assert.equal(f.calls[0].body.parse_mode, "HTML"); assert.ok(JSON.parse(f.calls[0].body.reply_markup).inline_keyboard[0][0].url === item.url);
// photo rejected -> text fallback
f = mkFetch((u) => (u.endsWith("/sendPhoto") ? fail("wrong file identifier") : ok()));
await sendListing(f, cfg, item, "pokemon");
assert.deepEqual(f.calls.map((c) => c.url.split("/").pop()), ["sendPhoto", "sendMessage"]);
// no photo -> text only
f = mkFetch(ok); await sendListing(f, cfg, { ...item, photo: "" }, "q"); assert.ok(f.calls[0].url.endsWith("/sendMessage"));
// API error surfaces Telegram's description, never the token
f = mkFetch(() => fail("Unauthorized", 401));
await assert.rejects(() => sendText(f, cfg, "hi"), (e) => e.message === "Unauthorized" && !e.message.includes(cfg.token));
// network failure message does not include the token
await assert.rejects(() => sendText(async () => { throw new TypeError("Failed to fetch"); }, cfg, "hi"), (e) => !e.message.includes(cfg.token));
// chat id detection
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s });
f = mkFetch(() => json({ ok: true, result: [] })); assert.equal(await findChatId(f, cfg.token), null);
f = mkFetch(() => json({ ok: true, result: [{ update_id: 1, message: { chat: { id: 7, first_name: "Old" } } }, { update_id: 2, message: { chat: { id: 99, first_name: "Giulio", last_name: "M" } } }] }));
assert.deepEqual(await findChatId(f, cfg.token), { chatId: "99", name: "Giulio M" });
assert.equal(f.calls[0].body.offset, undefined);                                         // must not consume updates
f = mkFetch(() => json({ ok: true, result: [{ update_id: 3, channel_post: { chat: { id: -100123, title: "My channel" } } }] }));
assert.deepEqual(await findChatId(f, cfg.token), { chatId: "-100123", name: "My channel" });
f = mkFetch(() => json({ ok: false, description: "Conflict: terminated by other getUpdates request" }, 409));
await assert.rejects(() => findChatId(f, cfg.token), (e) => /another program/i.test(e.message) && e.conflict === true);
f = mkFetch(() => json({ ok: false, description: "Unauthorized" }, 401));
await assert.rejects(() => getBotName(f, cfg.token), /rejected the Token API/);
f = mkFetch(() => json({ ok: true, result: { username: "my_radar_bot" } })); assert.equal(await getBotName(f, cfg.token), "my_radar_bot");
// token extraction from a pasted BotFather message (fake token)
const fakeTok = "1234567890:AAFakeFakeFakeFakeFakeFakeFakeFake12";
assert.equal(extractToken(`Done! Congratulations.\nUse this token to access the HTTP API:\n${fakeTok}\nKeep your token secure`), fakeTok);
assert.equal(extractToken("  " + fakeTok + " "), fakeTok);
assert.equal(extractToken("garbage"), "garbage");
console.log("telegram tests passed");
