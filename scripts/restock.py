"""Data jobs for the restock tracker. Standard library only, so the Actions install nothing.

  python3 scripts/restock.py ingest EVENT.json REPLY.md   a "Stock report" issue -> data/reports.json
  python3 scripts/restock.py check                        automated stock checks -> data/reports.json

Prints one word last: ingest -> logged | invalid | skip, check -> changed | same.
"""
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / 'data'

# Dropdown text in .github/ISSUE_TEMPLATE/stock-report.yml -> stored status.
STATUSES = {
    'In stock': 'in_stock',
    'Low (only a few left)': 'low',
    'Out of stock': 'out',
    'Restocked (fresh stock just put out)': 'restocked',
}
# Reports from anyone else wait until a maintainer adds the "approved" label.
TRUSTED = {'OWNER', 'MEMBER', 'COLLABORATOR'}


def load(name):
    return json.loads((DATA / f'{name}.json').read_text(encoding='utf-8'))


def save_reports(reports):
    reports.sort(key=lambda r: r['at'])
    lines = ',\n'.join(json.dumps(r, ensure_ascii=False) for r in reports)  # one report per line: clean diffs
    (DATA / 'reports.json').write_text(f'[\n{lines}\n]\n', encoding='utf-8')


def utc(t):
    return t.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def parse_form(body):
    """Issue forms render every field as '### Label', a blank line, then the answer."""
    fields = {}
    for block in re.split(r'^### ', body or '', flags=re.M)[1:]:
        label, _, value = block.partition('\n')
        value = value.strip()
        fields[label.strip()] = '' if value == '_No response_' else value
    return fields


def parse_when(text, created_at, now):
    """Blank -> when the issue was opened. A bare date -> noon UTC, the same day in every US time zone."""
    if not text:
        return created_at
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', text):
        text += 'T12:00:00+00:00'
    try:
        t = datetime.fromisoformat(text)
    except ValueError:
        return None
    if t.tzinfo is None or t > now + timedelta(days=1):
        return None
    return utc(t)


def ingest(event, stores, products, reports, now):
    """Turn one issue event into reports (appended in place). Returns (result, reply for the issue)."""
    issue = event['issue']
    form = parse_form(issue.get('body'))
    if 'Store' not in form:
        return 'skip', ''  # not a stock report
    if event.get('action') == 'labeled':
        if event.get('label', {}).get('name') != 'approved':
            return 'skip', ''
    elif issue.get('author_association') not in TRUSTED:
        return 'skip', ''
    ref = f"#{issue['number']}"
    if any(r.get('ref') == ref for r in reports):
        return 'skip', ''  # already logged

    def show(s):  # echo user text inside a code span without letting it break out
        return '`' + s.replace('`', '') + '`'

    errors = []
    store = form['Store'].strip()
    if store not in {s['id'] for s in stores}:
        errors.append(f'Unknown store {show(store)}: it has to match an `id` in data/stores.json.')
    known = {p['id'] for p in products}
    pids = list(dict.fromkeys(p for p in re.split(r'[\s,]+', form.get('Products', '')) if p))
    unknown = [p for p in pids if p not in known]
    if unknown or not pids:
        errors.append(f"Unknown product id {', '.join(map(show, unknown)) or '(none given)'}: "
                      'use ids from data/products.json, separated by commas.')
    status = STATUSES.get(form.get('Status', ''))
    if not status:
        errors.append('Pick a status.')
    at = parse_when(form.get('When', '').strip(), issue['created_at'], now)
    if not at:
        errors.append('"When" must be blank, a date like 2026-09-20, or a date and time with a UTC offset '
                      'like 2026-09-20T14:30-04:00, and not in the future.')
    expected = form.get('Next restock expected', '').strip()
    try:
        if expected:
            datetime.strptime(expected, '%Y-%m-%d')
    except ValueError:
        errors.append('"Next restock expected" must be a date like 2026-09-25.')
    if errors:
        return 'invalid', ('Not logged:\n\n' + '\n'.join(f'- {e}' for e in errors) +
                           '\n\nOpen a new report from the site to try again.')

    note = ' '.join(form.get('Notes', '').split())[:300]
    for pid in pids:
        report = {'at': at, 'store': store, 'product': pid, 'status': status,
                  'source': 'manual', 'by': issue['user']['login'], 'ref': ref}
        if expected:
            report['expected'] = expected
        if note:
            report['note'] = note
        reports.append(report)
    return 'logged', f'Logged {status} at {show(store)} for {len(pids)} product(s). The site shows it within a few minutes.'


def shopify(url, fetch):
    """Shopify's public product JSON has "available": true when any variant can be bought.
    That is online stock; local game stores usually sell it from the same shelf."""
    m = re.match(r'(https?://[^/]+)/(?:[^?#]*/)?products/([^/?#]+)', url)
    if not m:
        raise ValueError(f'not a Shopify product URL: {url}')
    return 'in_stock' if fetch(f'{m[1]}/products/{m[2]}.js')['available'] else 'out'


def check(stores, reports, fetch, now):
    """Append a report whenever a product's automated answer differs from its last one."""
    changed = 0
    for store in stores:
        kind = store.get('check')
        if not kind:
            continue
        if kind != 'shopify':
            print(f'skip {store["id"]}: unknown check type {kind!r}', file=sys.stderr)
            continue
        for pid, url in store.get('items', {}).items():
            try:
                status = shopify(url, fetch)
            except Exception as e:  # a dead link or a blocked request must not stop the run, or read as "out"
                print(f'skip {store["id"]} {pid}: {e}', file=sys.stderr)
                continue
            last = next((r['status'] for r in reversed(reports) if r['source'] == kind
                         and r['store'] == store['id'] and r['product'] == pid), None)
            print(f'{store["id"]} {pid}: {status}' + ('' if status == last else ' (changed)'))
            if status != last:
                reports.append({'at': now, 'store': store['id'], 'product': pid, 'status': status, 'source': kind})
                changed += 1
    return changed


def fetch_json(url):
    time.sleep(1)  # at most one request a second
    repo = os.environ.get('GITHUB_REPOSITORY', '')
    req = urllib.request.Request(url, headers={'User-Agent': f'PokeRestock/1.0 (+https://github.com/{repo})',
                                               'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def main(argv):
    now = datetime.now(timezone.utc)
    reports = load('reports')
    if argv[1:2] == ['ingest'] and len(argv) == 4:
        event = json.loads(Path(argv[2]).read_text(encoding='utf-8'))
        result, reply = ingest(event, load('stores'), load('products'), reports, now)
        Path(argv[3]).write_text(reply, encoding='utf-8')
    elif argv[1:] == ['check']:
        result = 'changed' if check(load('stores'), reports, fetch_json, utc(now)) else 'same'
    else:
        sys.exit(__doc__)
    if result in ('logged', 'changed'):
        save_reports(reports)
    print(result)


if __name__ == '__main__':
    main(sys.argv)
