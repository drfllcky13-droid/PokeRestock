import { miles, carries, shopifyJson, timing, DAY, WEEKDAYS } from './restock.js';

// Your GitHub repo as "owner/name". Blank works it out from an owner.github.io/name address;
// set it if the site runs on a custom domain.
const REPO = '';
const COUNTRY = 'us';    // where ZIP codes are looked up
const STALE_HOURS = 72;  // older reports are greyed out

const LABEL = { restocked: 'Restocked', in_stock: 'In stock', low: 'Low', out: 'Out', none: 'No reports' };

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const repo = REPO || (location.hostname.endsWith('.github.io')
  ? `${location.hostname.split('.')[0]}/${location.pathname.split('/')[1] || location.hostname}` : '');

let state = { radius: 25, selected: [], here: null };
try { Object.assign(state, JSON.parse(localStorage.getItem('restock') || '{}')); } catch {}
const save = () => { try { localStorage.setItem('restock', JSON.stringify(state)); } catch {} };

const load = name => fetch(`data/${name}.json`, { cache: 'no-cache' }).then(async r => {
  if (!r.ok) throw new Error(`data/${name}.json: HTTP ${r.status}`);
  try { return await r.json(); } catch (e) { throw new Error(`data/${name}.json is not valid JSON (${e.message})`); }
});

let products, stores, reports, drops;
try {
  [products, stores, reports, drops] = await Promise.all([
    ...['products', 'stores', 'reports'].map(load), load('drops').catch(() => [])]);
} catch (e) {
  $('#results').innerHTML = `<p class="error">Couldn't load the data: ${esc(e.message)}</p>`;
  throw e;
}
reports.sort((a, b) => (a.at > b.at) - (a.at < b.at));

// --- where ---------------------------------------------------------------

const say = text => { $('#where-status').textContent = text; };
const sayWhere = () => say(state.here
  ? `Showing stores within ${state.radius} mi of ${state.here.label}.`
  : 'Set a ZIP code or use your location to sort stores by distance.');

function setHere(here) {
  state.here = here;
  save();
  sayWhere();
  render();
}

$('#where').addEventListener('submit', async e => {
  e.preventDefault();
  const zip = $('#zip').value.trim();
  say(`Looking up ${zip}…`);
  try {
    const q = new URLSearchParams({ format: 'jsonv2', limit: 1, countrycodes: COUNTRY, postalcode: zip });
    const r = await fetch(`https://nominatim.openstreetmap.org/search?${q}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const [hit] = await r.json();
    if (!hit) throw new Error('no such ZIP code');
    setHere({ lat: +hit.lat, lng: +hit.lon, label: zip });
  } catch (err) {
    say(`Couldn't look up ${zip}: ${err.message}.`);
  }
});

$('#gps').addEventListener('click', () => {
  if (!navigator.geolocation) return say('This browser cannot share its location.');
  say('Locating…');
  navigator.geolocation.getCurrentPosition(
    p => setHere({ lat: p.coords.latitude, lng: p.coords.longitude, label: 'your location' }),
    err => say(`Location unavailable: ${err.message}.`),
    { maximumAge: 6e5, timeout: 15e3 });
});

$('#radius').addEventListener('change', e => {
  state.radius = +e.target.value;
  save();
  sayWhere();
  render();
});

// --- products ------------------------------------------------------------

const bySet = new Map();
for (const p of products) {
  if (!bySet.has(p.set)) bySet.set(p.set, []);
  bySet.get(p.set).push(p);
}
$('#picker').innerHTML = [...bySet].map(([set, ps]) => `<fieldset><legend>${esc(set)}</legend><div class="opts">${
  ps.map(p => `<label><input type="checkbox" value="${esc(p.id)}"${state.selected.includes(p.id) ? ' checked' : ''}> ${esc(p.type)}</label>`).join('')
}</div></fieldset>`).join('');

$('#picker').addEventListener('change', () => {
  state.selected = [...document.querySelectorAll('#picker input:checked')].map(i => i.value);
  save();
  render();
});

// --- drops ---------------------------------------------------------------
// Online drops and drawings from data/drops.json. pages.yml turns the same file into drops.ics,
// a calendar feed with alerts, because a static page can't notify anyone by itself.

const at = iso => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const ends = d => Date.parse(d.closes || d.opens) + (d.closes ? 0 : 36e5);
const feed = `${location.host}${location.pathname.replace(/[^/]*$/, '')}drops.ics`;
// A weekly drop's next time, stepped in local time so daylight saving doesn't shift it.
function nextTime(d) {
  if (d.repeat !== 'weekly') return d;
  const o = new Date(d.opens), len = d.closes ? Date.parse(d.closes) - o : 36e5;
  while (o.getTime() + len <= Date.now()) o.setDate(o.getDate() + 7);
  return { ...d, opens: o.toISOString(), closes: d.closes && new Date(o.getTime() + len).toISOString() };
}
const upcoming = drops.map(nextTime).filter(d => ends(d) > Date.now()).sort((a, b) => Date.parse(a.opens) - Date.parse(b.opens));
$('#drops').innerHTML = (upcoming.length ? `<ul class="drops">${upcoming.map(d => `<li>
    <span class="prod">${esc(d.retailer)} · ${esc(d.title)}</span>
    <span class="links">${/^https?:\/\//.test(d.url) ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">Go to drop</a>` : ''}</span>
    <span class="when">${Date.parse(d.opens) > Date.now() ? `opens ${esc(at(d.opens))}` : 'open now'}${d.closes ? ` · closes ${esc(at(d.closes))}` : ''}${d.repeat === 'weekly' ? ' · every week' : ''}</span>
    ${d.notes ? `<span class="note">${esc(d.notes)}</span>` : ''}
  </li>`).join('')}</ul>` : '<p class="empty">No upcoming drops listed.</p>') +
  `<p class="hint">Alerts: add the feed <code>https://${esc(feed)}</code> to your calendar once for an alert 15 minutes before each drop opens and an hour before it closes.
   iPhone: <a href="webcal://${esc(feed)}">tap to subscribe</a>, or if that does nothing, Settings → Apps → Calendar → Calendar Accounts → Add Account → Other → Add Subscribed Calendar, paste the feed, and switch Remove Alerts off.
   Google Calendar: on a computer, calendar.google.com → Other calendars (+) → From URL.
   It stays empty until a drop is listed here.</p>`;

// --- results -------------------------------------------------------------

const day = t => new Date(t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
function ago(iso) {
  const m = (Date.parse(iso) - Date.now()) / 6e4;
  return Math.abs(m) < 60 ? rtf.format(Math.round(m), 'minute')
    : Math.abs(m) < 1440 ? rtf.format(Math.round(m / 60), 'hour')
    : rtf.format(Math.round(m / 1440), 'day');
}

function timingText(t) {
  const bits = [];
  if (t.last) bits.push(`last restock ${day(t.last)}`);
  if (t.said) bits.push(`next ${day(Date.parse(t.said + 'T12:00'))} (staff)`);
  else if (t.usual) bits.push(`next ${day(t.usual)} (usual day)`);
  else if (t.next) {
    const n = Math.round(t.every / DAY);
    bits.push(t.next < Date.now() ? `overdue (about every ${n} days)` : `next ~${day(t.next)} (about every ${n} days)`);
  }
  if (t.weekday != null) bits.push(`usually ${WEEKDAYS[t.weekday]}`);
  return bits.join(' · ');
}

function logLink(store, pids, text) {
  if (!repo) return '';
  const q = new URLSearchParams({ template: 'stock-report.yml', title: `Stock: ${store.name}`, store: store.id, products: pids.join(', ') });
  return `<a class="log" href="https://github.com/${esc(repo)}/issues/new?${esc(q)}" target="_blank" rel="noopener">${text}</a>`;
}

const badge = (status, extra = '') => `<span class="badge ${esc(status)}${extra}">${LABEL[status] || esc(status)}</span>`;

// Shopify's product JSON allows cross-origin reads, so the page also asks for the answer right now,
// once per product per page view. The hourly check keeps the history that restock timing needs.
const liveAnswers = new Map();
function goLive() {
  for (const el of document.querySelectorAll('[data-live]')) {
    const url = el.dataset.live;
    if (!liveAnswers.has(url)) {
      liveAnswers.set(url, fetch(url).then(r => (r.ok ? r.json() : {}))
        .then(p => (p.available === true ? 'in_stock' : p.available === false ? 'out' : null))
        .catch(() => null));
    }
    liveAnswers.get(url).then(status => { if (status) el.innerHTML = `${badge(status)} <span class="seen">live</span>`; });
  }
}

function row(store, product, mine) {
  const stream = mine.filter(r => r.product === product.id), last = stream.at(-1);
  const stale = last && (Date.now() - Date.parse(last.at)) / 36e5 > STALE_HOURS;
  const url = store.items?.[product.id];
  const live = store.check === 'shopify' && shopifyJson(url);
  const when = timingText(timing(stream));
  return `<li>
    <span class="prod">${esc(product.set)} · ${esc(product.type)}</span>
    <span class="status"${live ? ` data-live="${esc(live)}"` : ''}>${last
      ? `${badge(last.status, stale ? ' stale' : '')} <span class="seen">${esc(ago(last.at))} · ${esc(last.source === 'manual' ? last.by || 'manual' : last.source)}</span>`
      : badge('none')}</span>
    <span class="links">${/^https?:\/\//.test(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener">View</a>` : ''}${logLink(store, [product.id], 'Log')}</span>
    ${when ? `<span class="when">${esc(when)}</span>` : ''}
    ${last?.note ? `<span class="note">“${esc(last.note)}”</span>` : ''}
  </li>`;
}

function card({ store, dist, picked }) {
  const mine = reports.filter(r => r.store === store.id);
  const when = timingText(timing(mine, Date.now(), store.restockDays));
  const hasXY = Number.isFinite(store.lat) && Number.isFinite(store.lng);
  return `<article class="store">
    <h3>${/^https?:\/\//.test(store.url) ? `<a href="${esc(store.url)}" target="_blank" rel="noopener">${esc(store.name)}</a>` : esc(store.name)}${dist != null ? ` <span class="dist">${dist.toFixed(1)} mi</span>` : ''}</h3>
    <p class="meta">${esc([store.chain, store.address].filter(Boolean).join(' · '))}${hasXY
      ? ` · <a href="https://www.google.com/maps/dir/?api=1&amp;destination=${store.lat},${store.lng}" target="_blank" rel="noopener">Directions</a>` : ''}</p>
    ${store.notes ? `<p class="notes">${esc(store.notes)}</p>` : ''}
    ${when ? `<p class="when">Whole store: ${esc(when)}</p>` : ''}
    <ul>${picked.map(p => row(store, p, mine)).join('')}</ul>
    ${picked.length > 1 ? `<p class="all">${logLink(store, picked.map(p => p.id), 'Log all of these')}</p>` : ''}
  </article>`;
}

function render() {
  const picked = products.filter(p => state.selected.includes(p.id));
  $('#count').textContent = picked.length ? `(${picked.length} picked)` : '';
  const show = html => { $('#results').innerHTML = html + (repo ? '' : '<p class="hint">Log links are off: set REPO in app.js.</p>'); };
  if (!stores.length) return show('<p class="empty">No stores yet. Add yours to <code>data/stores.json</code> (see the README).</p>');
  if (!picked.length) return show('<p class="empty">Pick one or more products.</p>');
  const here = state.here;
  const cards = stores
    .map(store => ({
      store,
      dist: here && Number.isFinite(store.lat) ? miles(here, store) : null,
      picked: picked.filter(p => carries(store, p, reports.some(r => r.store === store.id && r.product === p.id))),
    }))
    .filter(c => c.picked.length && (c.dist == null || c.dist <= state.radius))
    .sort((a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity) || a.store.name.localeCompare(b.store.name));
  show(cards.length ? cards.map(card).join('')
    : `<p class="empty">No tracked store${here ? ` within ${state.radius} mi` : ''} carries ${picked.length > 1 ? 'those products' : 'that product'}.</p>`);
  goLive();
}

$('#zip').value = /^\d{5}$/.test(state.here?.label) ? state.here.label : '';
$('#radius').value = state.radius;
if (products.some(p => state.selected.includes(p.id))) $('details').open = false; // returning visitors go straight to results
sayWhere();
render();
$('#stats').innerHTML = `${reports.length} reports${reports.length ? `, newest ${esc(ago(reports.at(-1).at))}` : ''}.${
  repo ? ` <a href="https://github.com/${esc(repo)}">Source and data on GitHub</a>.` : ''}`;
