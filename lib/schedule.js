// Per-search check intervals. Pure functions so they can be unit-tested with node.
// A search may set `intervalMin` (minutes); otherwise the global default applies. Nothing goes below `minMin`.

export function effectiveInterval(q, globalMin, minMin) {
  const own = Number(q.intervalMin);
  return Math.max(minMin, own > 0 ? own : globalMin);
}

// The alarm must tick as often as the fastest active search needs.
export function alarmPeriod(queries, globalMin, minMin) {
  const active = queries.filter((q) => q.active);
  if (!active.length) return Math.max(minMin, globalMin);
  return Math.min(...active.map((q) => effectiveInterval(q, globalMin, minMin)));
}

// Which searches are due at `now`. `checked` maps query id -> time its last check started.
// A little slack absorbs alarm jitter and the pauses between searches, so a tick is not skipped by a second.
export function dueQueries(queries, globalMin, minMin, checked, now, force = false) {
  return queries.filter((q) => {
    if (!q.active) return false;
    if (force || !checked[q.id]) return true;
    const ms = effectiveInterval(q, globalMin, minMin) * 60000;
    return now - checked[q.id] >= ms - Math.min(10000, ms * 0.2);
  });
}

export const MAX_INTERVAL_MIN = 1440; // 24 h

// "45s", "3m", "90", "1h", "1,5 m" -> minutes (number without a unit = minutes). null when not understood.
export function parseInterval(text) {
  const m = String(text ?? "").trim().toLowerCase()
    .match(/^(\d+(?:[.,]\d+)?)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)?$/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  const unit = (m[2] || "m")[0];
  const minutes = unit === "s" ? n / 60 : unit === "h" ? n * 60 : n;
  if (!(minutes > 0)) return null;
  return Math.round(minutes * 60) / 60; // whole seconds
}

export function formatInterval(min) {
  const s = Math.round(min * 60);
  if (s < 60) return `${s} s`;
  if (s % 3600 === 0) return `${s / 3600} h`;
  if (s % 60 === 0) return `${s / 60} min`;
  return `${s} s`;
}
