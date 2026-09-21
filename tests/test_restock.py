"""py tests/test_restock.py  (or pytest)"""
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))
import restock as R  # noqa: E402

NOW = datetime(2026, 9, 21, 18, 0, tzinfo=timezone.utc)
STORES = [{'id': 'lgs', 'check': 'shopify',
           'items': {'etb': 'https://shop.example/collections/tcg/products/etb-1?variant=2'}}]
PRODUCTS = [{'id': 'etb'}, {'id': 'box'}]
LABELS = {'store': 'Store', 'products': 'Products', 'status': 'Status', 'when': 'When',
          'expected': 'Next restock expected', 'notes': 'Notes'}


def form(**fields):
    """An issue body the way GitHub renders an issue form."""
    return '\n\n'.join(f'### {LABELS[k]}\n\n{v or "_No response_"}' for k, v in fields.items())


def event(body, assoc='OWNER', action='opened', label=None):
    e = {'action': action, 'issue': {'number': 7, 'body': body, 'author_association': assoc,
                                     'created_at': '2026-09-21T17:00:00Z', 'user': {'login': 'ash'}}}
    if label:
        e['label'] = {'name': label}
    return e


def ingest(ev, reports=None):
    reports = [] if reports is None else reports
    return R.ingest(ev, STORES, PRODUCTS, reports, NOW)[0], reports


def test_logs_a_trusted_report():
    result, reps = ingest(event(form(store='lgs', products='etb, box etb', status='Out of stock', when='',
                                     expected='2026-09-25', notes='  staff  said\n Thursday ')))
    assert result == 'logged'
    assert [r['product'] for r in reps] == ['etb', 'box']
    assert reps[0] == {'at': '2026-09-21T17:00:00Z', 'store': 'lgs', 'product': 'etb', 'status': 'out',
                       'source': 'manual', 'by': 'ash', 'ref': '#7', 'expected': '2026-09-25',
                       'note': 'staff said Thursday'}


def test_when_formats():
    assert R.parse_when('2026-09-20', 'x', NOW) == '2026-09-20T12:00:00Z'
    assert R.parse_when('2026-09-20T14:30-04:00', 'x', NOW) == '2026-09-20T18:30:00Z'
    assert R.parse_when('2026-09-20 14:30', 'x', NOW) is None  # no offset: ambiguous
    assert R.parse_when('2026-12-01', 'x', NOW) is None        # future
    assert R.parse_when('yesterday', 'x', NOW) is None


def test_rejects_bad_input_and_says_why():
    res, reply = R.ingest(event(form(store='no`pe', products='etb, zzz', status='', when='yesterday',
                                     expected='Friday')), STORES, PRODUCTS, reps := [], NOW)
    assert res == 'invalid' and not reps
    for bit in ('`nope`', '`zzz`', 'status', '"When"', '"Next restock expected"'):
        assert bit in reply, bit


def test_untrusted_reports_wait_for_the_approved_label():
    body = form(store='lgs', products='etb', status='In stock')
    assert ingest(event(body, assoc='NONE'))[0] == 'skip'
    assert ingest(event(body, assoc='NONE', action='labeled', label='bug'))[0] == 'skip'
    assert ingest(event(body, assoc='NONE', action='labeled', label='approved'))[0] == 'logged'


def test_ignores_other_issues_and_repeats():
    assert ingest(event('Found a bug in the site'))[0] == 'skip'
    body = form(store='lgs', products='etb', status='In stock')
    _, reps = ingest(event(body))
    assert ingest(event(body, action='labeled', label='approved'), reps)[0] == 'skip'
    assert len(reps) == 1


def test_check_logs_only_changes_and_skips_errors():
    answers = iter([True, True, False, OSError('HTTP 429')])

    def fetch(url):
        assert url == 'https://shop.example/products/etb-1.js', url
        a = next(answers)
        if isinstance(a, Exception):
            raise a
        return {'available': a}

    reports = []
    assert [R.check(STORES, reports, fetch, t) for t in ('t1', 't2', 't3', 't4')] == [1, 0, 1, 0]
    assert [(r['at'], r['status']) for r in reports] == [('t1', 'in_stock'), ('t3', 'out')]


def test_ics_feed():
    feed = R.ics([
        {'id': 'd1', 'retailer': 'Walmart', 'title': 'ETB, drawing', 'opens': '2026-09-24T10:00:00-04:00',
         'closes': '2026-09-25T10:00:00-04:00', 'url': 'https://www.walmart.com/x', 'notes': 'Walmart+ only; 1 per account'},
        {'id': 'd2', 'retailer': 'Pokémon Center', 'title': 'Preorders', 'opens': '2026-09-30T12:00:00-04:00',
         'url': 'https://www.pokemoncenter.com'},
    ], NOW)
    lines = feed.split('\r\n')
    assert feed.endswith('END:VCALENDAR\r\n') and lines.count('BEGIN:VEVENT') == 2
    assert 'DTSTART:20260924T140000Z' in lines and 'DTEND:20260925T140000Z' in lines  # converted to UTC
    assert 'DTEND:20260930T170000Z' in lines                                          # no close: one hour
    assert 'SUMMARY:Walmart: ETB\\, drawing' in lines                                 # commas escaped
    assert lines.count('TRIGGER:-PT15M') == 2 and lines.count('TRIGGER;RELATED=END:-PT1H') == 1
    weekly = R.ics([{'id': 'w', 'retailer': 'Walmart', 'title': 'Drawing', 'opens': '2026-09-23T17:00:00-04:00',
                     'closes': '2026-09-23T18:00:00-04:00', 'repeat': 'weekly', 'url': 'https://www.walmart.com/'}], NOW)
    assert 'DTSTART;TZID=America/New_York:20260923T170000' in weekly and 'RRULE:FREQ=WEEKLY' in weekly
    assert 'TZID:America/New_York' in weekly  # the time zone it refers to is defined in the feed


if __name__ == '__main__':
    for name, fn in list(globals().items()):
        if name.startswith('test_'):
            fn()
    print('ok')
