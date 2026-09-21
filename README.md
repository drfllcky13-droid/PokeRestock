# Pokémon TCG Restocks

A static site plus two GitHub Actions. Pick the Pokémon TCG products you want and your ZIP code (or
your location), and it lists the stores you track within a radius: the latest stock report for each
product, when the store last restocked, and when the next restock is expected.

There is no official API for in-store stock or restock schedules, so the data comes from:

- **Reports you log.** Each product row on the site has a **Log** link that opens a pre-filled
  GitHub issue form. An Action files the answer into `data/reports.json` and closes the issue.
- **Optional checks** of local game stores that sell online through Shopify, using the public
  product JSON every Shopify store serves: live in the page when you open it, and hourly from an
  Action so there is a history to time restocks from.

No server, no database, no API keys. Why it's built this way, and what was ruled out (scraping
Target/Walmart/GameStop, community trackers, Discord): see `DESIGN.txt`.

## What you have to supply

| What | Where | Notes |
|---|---|---|
| Your stores | `data/stores.json` | Ships empty. Names, coordinates, what each carries. |
| Product page URLs | `items` in each store | Optional. Needed only for "View" links and Shopify checks. |
| Your products | `data/products.json` | Seeded with English sets; check it and add what you hunt (tins, collections…). |
| Your location | typed into the site | Stays in your browser. The ZIP is looked up once via OpenStreetMap Nominatim. |

## Set up (about 10 minutes)

1. Create a new repository on GitHub, e.g. `PokeRestock`. Make it **public**: GitHub Pages is free
   only for public repos (read [Privacy](#privacy) first).
2. Push this folder to it, from inside the folder:

   ```bash
   git init -b main
   ```
   ```bash
   git add . && git commit -m "Restock tracker"
   ```
   ```bash
   git remote add origin https://github.com/YOUR-USERNAME/PokeRestock.git
   ```
   ```bash
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. **Actions → Deploy site → Run workflow**. (The run your push started failed because Pages
   wasn't on yet.) The site appears at `https://YOUR-USERNAME.github.io/PokeRestock/`, and from
   now on every push redeploys it.
5. Add your stores (next section) and commit.
6. Open the site, set your ZIP, tick products.

The site finds its own repo from the `github.io` address. On a custom domain, set `REPO` at the
top of `app.js`.

## Adding and updating stores

Edit `data/stores.json`, on GitHub (open the file → pencil icon → **Commit changes**) or locally.
It is a JSON list with one object per store:

| Field | Required | What it is |
|---|---|---|
| `id` | yes | Short unique slug: lowercase, no spaces. Reports refer to it, so don't rename it once reports exist. |
| `name` | yes | Shown on the site. |
| `lat`, `lng` | yes, except online stores | Decimal degrees. In Google Maps, right-click the store and click the coordinates to copy them. Leave them out for an online store (e.g. Pokémon Center): it then always shows, whatever the radius. |
| `url` | no | The store's own page. Makes the store name a link. |
| `chain` | no | "Target", "Walmart", "Local game store"… |
| `address` | no | Shown on the site. |
| `carries` | no | Product **types** or product ids the store stocks. Leave it out and every product is listed. Big-box stores rarely sell booster boxes, so `["Elite Trainer Box", "Booster Bundle"]` fits them. A product someone has reported always shows. |
| `notes` | no | Restock habits you've learned, e.g. who restocks and which mornings. |
| `restockDays` | no | The store's regular restock day(s), if staff told you: `["Wed"]` or `["Tue", "Fri"]` (Sun Mon Tue Wed Thu Fri Sat). The store then shows its next restock date straight away. |
| `items` | no | Product id → that product's page at this store. Gives a **View** link; for `"check": "shopify"` stores it is what gets checked. |
| `check` | no | `"shopify"` to check every `items` URL live in the page and hourly in the background. |

A made-up example of the shape (replace every value; 0, 0 is in the Atlantic):

```json
[
  {
    "id": "example-games",
    "name": "Example Games (replace me)",
    "chain": "Local game store",
    "address": "Street, town",
    "lat": 0,
    "lng": 0,
    "notes": "Restocks on release day; preorders open two weeks before",
    "check": "shopify",
    "items": {
      "phantasmal-flames-booster-box": "https://example-games.example/products/phantasmal-flames-booster-box"
    }
  }
]
```

To remove a store, delete its object. Its old reports stay in `data/reports.json` but are no
longer shown.

## Logging a report

On the site, **Log** (one product) or **Log all of these** (every listed product at that store)
opens a GitHub issue form with the store and products filled in. Pick the status (GitHub can't
pre-fill dropdowns), optionally add a date staff gave you for the next restock, and submit. About a
minute later the *Log stock report* Action adds it to `data/reports.json`, replies on the issue,
closes it and starts *Deploy site*; the site shows it a minute after that.

- You need to be signed in to GitHub (the mobile browser is fine).
- Your reports, and your collaborators', go in automatically. Anyone else's stay open until you add
  the label **`approved`** to the issue; create that label once under **Issues → Labels** if you
  let friends report.
- A report the Action can't read (unknown store id, bad date) gets a reply saying why and is closed.
- **Restocked** means you saw fresh stock go out. It counts as a restock even without an earlier
  "Out". Logging **Out of stock** matters too: that is what makes the next in-stock report a restock.
- To undo a report, delete its line from `data/reports.json`.

## How restock timing is worked out

- **Last restock**: the latest "Restocked" report, or the first in-stock or low report after an
  "Out". Reports less than a day apart count as one restock.
- **Next**: a date staff gave you, until it passes. Otherwise the store's next `restockDays` day,
  if you've set one. Otherwise last restock plus the median gap between restocks, which needs at
  least two restocks. "usually Thu" appears once three or more
  restocks mostly fall on one weekday.
- **Whole store** pools every product at the store, since vendors usually restock everything at once.
- Reports older than three days are greyed out.

## Drops (Walmart drawings and other online drops)

The **Drops** section lists what's in `data/drops.json`: Walmart's Collectibles Drawings, Walmart+
early-access drops, Pokémon Center preorders and so on. Every deploy also turns that file into a
calendar feed, `drops.ics`.

- **Alerts:** on your phone, tap **Subscribe in your calendar** once. On iPhone, leave alerts on if
  it offers to remove them. Each drop then alerts you 15 minutes before it opens, and an hour
  before it closes if it has a closing time. Drops added later reach your calendar on its next
  refresh, usually within an hour or so.
- **Adding a drop:** one object per drop in `data/drops.json`:

  | Field | What it is |
  |---|---|
  | `id` | Unique slug, e.g. `walmart-2026-09-24-etb`. |
  | `retailer` | "Walmart", "Pokémon Center"… |
  | `title` | What's dropping. |
  | `opens` | Time with offset, e.g. `2026-09-24T10:00:00-04:00`. |
  | `closes` | Optional. The end of a drawing's entry window. |
  | `url` | The page to enter or buy. |
  | `notes` | Optional: Walmart+ only, limits, one entry per account… |

- Nothing watches Walmart for new drops automatically: Walmart's terms forbid it and its bot
  protection blocks it. Drops get added by hand when they're announced; send the link.
- Entering is yours to do, signed in to your own Walmart account. Nothing here signs in or enters.

## Automated checks (optional)

Only for stores that sell online through **Shopify**, which many local game stores do. Their product
pages end in `/products/<name>`, and adding `.js` to that URL in your browser shows JSON with
`"available": true` or `false`. For each such store set `"check": "shopify"` and put the product page
URLs in `items`.

Two things then happen:

- **In the page**, each of those rows asks the store directly when you open the site and shows
  "In stock · live" or "Out · live". If the store doesn't answer, the row keeps its last report.
- **Hourly**, the *Check stock* workflow asks too and records a report whenever a product's answer
  changes. That history is what gives these stores a last restock and a forecast. It does nothing
  until a store has `check` set, and you can start it from **Actions → Check stock → Run workflow**.
  A URL that fails is skipped and named in the run log, never recorded as out of stock. GitHub
  starts scheduled runs late (up to 2–3 hours on busy days), and some stores behind Cloudflare
  refuse GitHub's servers; the live check in the page isn't affected by either.

This is online stock: usually the same shelf at a small store, but not always. A preorder listing
counts as in stock. Keep it to the handful of products you actually hunt; see `DESIGN.txt` on
store terms.

## Products

`data/products.json` is a list of `{"id", "set", "type"}`. The site groups products by `set`, in
file order, so newest first reads best. `type` is what a store's `carries` matches, so reuse the
existing type names. Add a new set by copying lines and changing the ids; keep old ids unchanged
once reports use them.

## Checking changes locally

```bash
py tests/test_restock.py
```
```bash
node tests/restock.test.mjs
```

To preview, run `py -m http.server 8000` in this folder and open http://localhost:8000. Log links
stay off locally unless `REPO` is set in `app.js`.

## Privacy

Everything in a public repo is public: your store list, and every report with who logged it and
when. Over time that is a record of where you shop and at what times. If that matters, keep the repo
private and host it where private repos are free (Cloudflare Pages connects to a private GitHub
repo), or log dates without times. Your ZIP and location never leave your browser apart from the
one ZIP lookup.

## Upkeep

- GitHub pauses scheduled workflows in a public repo after 60 days with no activity. *Check stock*
  re-enables itself on every run to reset that clock; if it gets paused anyway, GitHub emails you
  and **Actions → Check stock → Enable workflow** turns it back on.
- Add new sets to `data/products.json` as they release.
- If a store's checks keep failing (see the *Check stock* run log), remove its `check` field and
  log it by hand.
