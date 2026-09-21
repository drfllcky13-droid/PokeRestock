// Pure logic shared by app.js and tests/restock.test.mjs. No DOM in here.

export const DAY = 864e5;

// Great-circle distance in miles between two {lat, lng} points.
export function miles(a, b) {
  const r = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * r / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lng - a.lng) * r / 2) ** 2;
  return 7917.5 * Math.asin(Math.sqrt(h)); // 7917.5 = Earth's diameter in miles
}

// A store is shown for a product unless its "carries" list (product types or ids) leaves it out.
// An item link for the product, or any report of it (`seen`), always counts.
export function carries(store, product, seen = false) {
  const c = store.carries;
  return !c || c.includes(product.type) || c.includes(product.id) ||
    product.id in (store.items || {}) || seen;
}

// A Shopify product page URL -> its public product JSON (same rule as scripts/restock.py).
export function shopifyJson(url) {
  const m = /^(https?:\/\/[^/]+)\/(?:[^?#]*\/)?products\/([^/?#]+)/.exec(url || '');
  return m ? `${m[1]}/products/${m[2]}.js` : null;
}

// When restocks happened, from reports sorted oldest first (any mix of products):
// a "restocked" report, or a product's first in-stock report after it was "out".
// Restocks under a day apart count once (several people reporting the same delivery).
export function restocks(reports) {
  const wasOut = {}, times = [];
  for (const r of reports) {
    if (r.status === 'restocked' || (wasOut[r.product] && r.status !== 'out')) times.push(Date.parse(r.at));
    wasOut[r.product] = r.status === 'out';
  }
  const kept = [];
  for (const t of times.sort((a, b) => a - b)) if (!kept.length || t - kept.at(-1) >= DAY) kept.push(t);
  return kept;
}

// Last restock and the next one. A date staff gave ("expected") beats the estimate, which is
// the last restock plus the median gap between past restocks. `weekday` (0 = Sunday) is set
// once at least 3 restocks are known and half or more fell on the same day.
// ponytail: median gap is a naive forecast; weight recent gaps if stores change schedules often.
export function timing(reports, now = Date.now()) {
  const times = restocks(reports);
  const said = reports.filter(r => r.expected && Date.parse(r.expected + 'T23:59') >= now).at(-1);
  const every = median(times.slice(1).map((t, i) => t - times[i]));
  const count = Array(7).fill(0);
  for (const t of times) count[new Date(t).getDay()]++;
  const top = count.indexOf(Math.max(...count));
  return {
    last: times.at(-1) ?? null,
    said: said ? said.expected : null,
    next: every ? times.at(-1) + every : null,
    every,
    weekday: times.length >= 3 && count[top] >= times.length / 2 ? top : null,
  };
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
