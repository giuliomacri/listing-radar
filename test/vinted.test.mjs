import assert from "node:assert/strict";
import { isSafariUserAgent } from "../config.js";
import { permissionPattern, apiHost, buildApiParams, buildApiUrl, normalizeQueryUrl, isVintedCatalogUrl, normalizeItem, pickNewItems } from "../lib/vinted.js";

// Host mapping (matches Python _api_host)
assert.equal(apiHost("www.vinted.it"), "api.vinted.it");
assert.equal(apiHost("vinted.fr"), "api.vinted.fr");
assert.equal(apiHost("www.vinted.com"), "api.www.vinted.com");
assert.equal(apiHost("www.vinted.co.uk"), "api.vinted.co.uk");

// Permission must cover the api. host, not just the page origin
assert.equal(permissionPattern("https://www.vinted.it/catalog?x=1"), "https://*.vinted.it/*");
assert.equal(permissionPattern("https://www.vinted.co.uk/catalog"), "https://*.vinted.co.uk/*");
assert.equal(permissionPattern("https://www.vinted.com/catalog"), "https://*.vinted.com/*");

// Real queries from the user's logs
const q1 = "https://www.vinted.it/catalog?search_text=Persol&price_to=80&currency=EUR&brand_ids%5B%5D=12775&order=newest_first";
assert.deepEqual(buildApiParams(q1), {
  search_text: "Persol", brand_ids: "12775", currency: "EUR", price_to: "80", order: "newest_first", page: 1, per_page: 20,
});
const q2 = "https://www.vinted.it/catalog?search_text=Persol+Steve+McQueen&order=newest_first";
assert.equal(buildApiParams(q2).search_text, "Persol Steve McQueen"); // URLSearchParams decodes '+' to space, then URL-encodes again
assert.ok(buildApiUrl(q2, 20, 1).startsWith("https://api.vinted.it/svc-catalogue/items?"));
assert.ok(!buildApiUrl("https://www.vinted.it/catalog?search_text=x&price_from=", 20, 1).includes("price_from"));

// Multi-value ids
const q3 = "https://www.vinted.fr/catalog?catalog[]=1&catalog[]=2&size_ids[]=3&size_ids[]=4";
const p3 = buildApiParams(q3);
assert.equal(p3.catalog_ids, "1,2"); assert.equal(p3.size_ids, "3,4");

// Normalisation
const n1 = new URL(normalizeQueryUrl("https://www.vinted.it/catalog?search_text=a&page=3&time=1&search_id=9&order=relevance"));
assert.equal(n1.searchParams.get("order"), "newest_first");
assert.equal(n1.searchParams.get("page"), null); assert.equal(n1.searchParams.get("search_id"), null);
const n2 = new URL(normalizeQueryUrl("https://www.vinted.it/brand/12775-persol"));
assert.equal(n2.pathname, "/catalog"); assert.equal(n2.searchParams.get("brand_ids[]"), "12775");
assert.ok(isVintedCatalogUrl(q1)); assert.ok(isVintedCatalogUrl("https://www.vinted.co.uk/catalog?x=1"));
assert.ok(!isVintedCatalogUrl("https://example.com/catalog?x=1")); assert.ok(!isVintedCatalogUrl("nope"));

// Item parsing (schema per pyVintedVN/items/item.py)
const it = normalizeItem({ id: "5", title: "Glasses", url: "/items/5-glasses", price: { amount: "40.0", currency_code: "EUR" },
  photo: { url: "https://img/x.jpg" }, item_box: { first_line: "Persol" } }, "https://www.vinted.it");
assert.deepEqual(it, { id: 5, title: "Glasses", brand: "Persol", price: "40.0", currency: "EUR", photo: "https://img/x.jpg", url: "https://www.vinted.it/items/5-glasses" });
assert.equal(normalizeItem({ id: 7 }, "https://www.vinted.it").url, "https://www.vinted.it/items/7");

// Watermark logic
const mk = (...ids) => ids.map((id) => ({ id }));
assert.deepEqual(pickNewItems(mk(10, 9, 8), null), { fresh: [], maxId: 10 });          // baseline: no notifications
assert.deepEqual(pickNewItems(mk(12, 11, 10, 9), 10), { fresh: mk(11, 12), maxId: 12 }); // oldest first
assert.deepEqual(pickNewItems(mk(10, 9), 10), { fresh: [], maxId: 10 });
assert.deepEqual(pickNewItems([], 10), { fresh: [], maxId: 10 });
// Safari vs Chromium user agents
assert.ok(isSafariUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"));
assert.ok(!isSafariUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"));
assert.ok(!isSafariUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0"));
console.log("all tests passed");
