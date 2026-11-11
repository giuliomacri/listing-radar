// Pure logic, no chrome.* calls, so it can be unit-tested with node.
// Ported from pyVintedVN/items/items.py and item.py (same endpoint and param mapping).

export function apiHost(websiteHost) {
  if (websiteHost.endsWith("vinted.com")) return "api.www.vinted.com";
  const domain = websiteHost.startsWith("www.") ? websiteHost.slice(4) : websiteHost;
  return "api." + domain;
}

// Host-permission pattern covering both www.<domain> and api.<domain>.
// (Requesting only the page's own origin would leave the API host blocked by CORS.)
export function permissionPattern(siteUrl) {
  const host = new URL(siteUrl).hostname;
  const domain = host.startsWith("www.") ? host.slice(4) : host;
  return `https://*.${domain}/*`;
}

export function isVintedCatalogUrl(raw) {
  try {
    const u = new URL(raw);
    return /(^|\.)vinted\.[a-z.]+$/.test(u.hostname) && u.pathname.startsWith("/catalog") ||
           /(^|\.)vinted\.[a-z.]+$/.test(u.hostname) && u.pathname.startsWith("/brand/");
  } catch { return false; }
}

// Normalise a pasted URL: brand pages -> /catalog?brand_ids[]=, force newest_first,
// drop volatile params. Mirrors core.process_query.
export function normalizeQueryUrl(raw) {
  const u = new URL(raw);
  const parts = u.pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length >= 2 && parts[0] === "brand") {
    const brandId = parts[1].split("-")[0];
    u.pathname = "/catalog";
    u.search = "";
    u.searchParams.append("brand_ids[]", brandId);
  }
  u.searchParams.set("order", "newest_first");
  for (const k of ["time", "search_id", "disabled_personalization", "page"]) u.searchParams.delete(k);
  u.hash = "";
  return u.toString();
}

const LIST_PARAMS = {
  video_game_platform_ids: "video_game_platform_ids[]",
  catalog_ids: "catalog[]",
  color_ids: "color_ids[]",
  brand_ids: "brand_ids[]",
  size_ids: "size_ids[]",
  material_ids: "material_ids[]",
  status_ids: "status_ids[]",
  country_ids: "country_ids[]",
  city_ids: "city_ids[]",
};

// Website search URL -> catalogue API params. Empty values are dropped
// (the svc-catalogue endpoint returns 400 on empty params).
export function buildApiParams(siteUrl, perPage = 20, page = 1) {
  const sp = new URL(siteUrl).searchParams;
  const p = {};
  const text = sp.getAll("search_text");
  if (text.length) p.search_text = text.join("+");
  for (const [apiKey, siteKey] of Object.entries(LIST_PARAMS)) {
    const vals = sp.getAll(siteKey);
    if (vals.length) p[apiKey] = vals.join(",");
  }
  if (sp.getAll("disposal[]").length) p.is_for_swap = sp.getAll("disposal[]").map(() => 1).join(",");
  for (const k of ["currency", "price_to", "price_from", "order"]) {
    const vals = sp.getAll(k);
    if (vals.length) p[k] = vals.join(",");
  }
  p.page = page;
  p.per_page = perPage;
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== "" && v != null));
}

export function buildApiUrl(siteUrl, perPage, page) {
  const host = new URL(siteUrl).host;
  const params = new URLSearchParams(buildApiParams(siteUrl, perPage, page));
  return `https://${apiHost(host)}/svc-catalogue/items?${params}`;
}

// Raw API item -> the small shape we keep and display.
export function normalizeItem(raw, siteOrigin) {
  const box = raw.item_box || {};
  const price = raw.price || {};
  const rel = raw.url || "";
  const url = rel.startsWith("http") ? rel : rel ? siteOrigin.replace(/\/$/, "") + rel
                                                 : `${siteOrigin.replace(/\/$/, "")}/items/${raw.id}`;
  return {
    id: Number(raw.id),
    title: raw.title || "",
    brand: raw.brand_title || box.first_line || "",
    price: price.amount ?? "",
    currency: price.currency_code || "",
    photo: (raw.photo && raw.photo.url) || "",
    url,
  };
}

// Item ids increase over time, so the max id seen is the per-query watermark.
// First run (lastId == null) only sets the baseline and notifies nothing.
export function pickNewItems(items, lastId) {
  const maxId = items.reduce((m, i) => Math.max(m, i.id), lastId ?? 0);
  if (lastId == null) return { fresh: [], maxId };
  const fresh = items.filter((i) => i.id > lastId).sort((a, b) => a.id - b.id);
  return { fresh, maxId };
}

// Human-readable summary of a search URL, e.g. `vinted.it · “pokemon” · max 80 EUR · brand #12775`.
// (Brand/category/size names are not in the URL, only ids, so those are shown as ids or counts.)
export function describeQuery(siteUrl) {
  let u;
  try { u = new URL(siteUrl); } catch { return String(siteUrl); }
  const sp = u.searchParams;
  const parts = [];
  const text = sp.getAll("search_text").join(" ").trim();
  if (text) parts.push(`\u201c${text}\u201d`);
  const from = sp.get("price_from"), to = sp.get("price_to"), cur = sp.get("currency") || "";
  if (from && to) parts.push(`${from}\u2013${to} ${cur}`.trim());
  else if (to) parts.push(`max ${to} ${cur}`.trim());
  else if (from) parts.push(`min ${from} ${cur}`.trim());
  const brands = sp.getAll("brand_ids[]");
  if (brands.length) parts.push(brands.length === 1 ? `brand #${brands[0]}` : `${brands.length} brands`);
  for (const [key, one, many] of [["catalog[]", "category", "categories"], ["size_ids[]", "size", "sizes"],
    ["status_ids[]", "condition", "conditions"], ["color_ids[]", "color", "colors"], ["material_ids[]", "material", "materials"],
    ["country_ids[]", "country", "countries"], ["city_ids[]", "city", "cities"]]) {
    const n = sp.getAll(key).length;
    if (n) parts.push(`${n} ${n === 1 ? one : many}`);
  }
  if (sp.getAll("disposal[]").length) parts.push("swap");
  return [u.hostname.replace(/^www\./, ""), ...(parts.length ? parts : ["all items"])].join(" \u00b7 ");
}
