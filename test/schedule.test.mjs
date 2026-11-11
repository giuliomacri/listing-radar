import assert from "node:assert/strict";
import { alarmPeriod, dueQueries, effectiveInterval } from "../lib/schedule.js";
import { describeQuery } from "../lib/vinted.js";

const Q = (id, o = {}) => ({ id, active: true, intervalMin: null, ...o });
// effective interval: own value, else default, never below the browser minimum
assert.equal(effectiveInterval(Q("a"), 2, 0.5), 2);
assert.equal(effectiveInterval(Q("a", { intervalMin: 10 }), 2, 0.5), 10);
assert.equal(effectiveInterval(Q("a", { intervalMin: 0.5 }), 2, 1), 1);          // Firefox/Safari clamp
// alarm ticks at the fastest active search; inactive ones are ignored
assert.equal(alarmPeriod([Q("a"), Q("b", { intervalMin: 0.5 })], 2, 0.5), 0.5);
assert.equal(alarmPeriod([Q("a"), Q("b", { intervalMin: 0.5, active: false })], 2, 0.5), 2);
assert.equal(alarmPeriod([], 5, 0.5), 5);
// due logic
const T = 1_000_000_000;
const qs = [Q("fast", { intervalMin: 1 }), Q("slow", { intervalMin: 10 }), Q("dflt"), Q("off", { active: false })];
assert.deepEqual(dueQueries(qs, 2, 0.5, {}, T).map((q) => q.id), ["fast", "slow", "dflt"]);          // never checked -> all active
const checked = { fast: T, slow: T, dflt: T, off: T };
assert.deepEqual(dueQueries(qs, 2, 0.5, checked, T + 30_000).map((q) => q.id), []);
assert.deepEqual(dueQueries(qs, 2, 0.5, checked, T + 60_000).map((q) => q.id), ["fast"]);
assert.deepEqual(dueQueries(qs, 2, 0.5, checked, T + 55_000).map((q) => q.id), ["fast"]);           // 5 s of slack
assert.deepEqual(dueQueries(qs, 2, 0.5, checked, T + 120_000).map((q) => q.id), ["fast", "dflt"]);
assert.deepEqual(dueQueries(qs, 2, 0.5, checked, T + 600_000).map((q) => q.id), ["fast", "slow", "dflt"]);
assert.deepEqual(dueQueries(qs, 2, 0.5, checked, T + 1, true).map((q) => q.id), ["fast", "slow", "dflt"]); // force
assert.deepEqual(dueQueries(qs, 2, 0.5, checked, T + 590_000).map((q) => q.id).includes("slow"), true);   // slack never exceeds 10 s

// readable summaries (real searches from the user's logs)
assert.equal(describeQuery("https://www.vinted.it/catalog?search_text=Persol&price_to=80&currency=EUR&brand_ids%5B%5D=12775&order=newest_first"),
  "vinted.it · “Persol” · max 80 EUR · brand #12775");
assert.equal(describeQuery("https://www.vinted.it/catalog?search_text=Persol+Steve+McQueen&order=newest_first"), "vinted.it · “Persol Steve McQueen”");
assert.equal(describeQuery("https://www.vinted.fr/catalog?catalog[]=1&catalog[]=2&size_ids[]=3&price_from=10&price_to=50&currency=EUR&disposal[]=1"),
  "vinted.fr · 10–50 EUR · 2 categories · 1 size · swap");
assert.equal(describeQuery("https://www.vinted.it/catalog?order=newest_first"), "vinted.it · all items");
assert.equal(describeQuery("not a url"), "not a url");
console.log("schedule + describe tests passed");

// ---- parseInterval / formatInterval
{
  const { parseInterval, formatInterval, MAX_INTERVAL_MIN } = await import("../lib/schedule.js");
  const eq = (a, b, m) => { if (a !== b) { console.error("FAIL", m, a, b); process.exit(1); } };
  eq(parseInterval("45s"), 0.75, "45s");
  eq(parseInterval("3m"), 3, "3m");
  eq(parseInterval("1h"), 60, "1h");
  eq(parseInterval("5"), 5, "bare = minutes");
  eq(parseInterval("1,5 min"), 1.5, "comma decimal");
  eq(parseInterval("abc"), null, "garbage");
  eq(parseInterval(""), null, "empty");
  eq(formatInterval(0.5), "30 s", "fmt 30 s");
  eq(formatInterval(5), "5 min", "fmt 5 min");
  eq(formatInterval(60), "1 h", "fmt 1 h");
  eq(MAX_INTERVAL_MIN, 1440, "max");
  console.log("interval parse/format ok");
}
