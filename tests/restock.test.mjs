// node tests/restock.test.mjs
import assert from 'node:assert/strict';
import { miles, carries, shopifyJson, restocks, timing, DAY } from '../restock.js';

assert.equal(shopifyJson('https://shop.example/collections/tcg/products/etb-1?variant=2'), 'https://shop.example/products/etb-1.js');
assert.equal(shopifyJson('https://www.target.com/p/-/A-123'), null);

// New York to Los Angeles is about 2,445 miles.
assert(Math.abs(miles({ lat: 40.7128, lng: -74.006 }, { lat: 34.0522, lng: -118.2437 }) - 2445) < 10);

const store = { id: 's', carries: ['Elite Trainer Box'], items: { 'x-box': 'https://example.test/x' } };
assert(carries(store, { id: 'a-etb', type: 'Elite Trainer Box' }));
assert(!carries(store, { id: 'a-box', type: 'Booster Box' }));
assert(carries(store, { id: 'x-box', type: 'Booster Box' }));          // has an item link
assert(carries(store, { id: 'a-box', type: 'Booster Box' }, true));    // someone reported it
assert(carries({ id: 't' }, { id: 'a-box', type: 'Booster Box' }));    // no list = carries everything

const at = (day, hour = 10) => new Date(2026, 8, day, hour).toISOString(); // local time, Sept 2026
const log = [
  { at: at(2), product: 'etb', status: 'out' },
  { at: at(3), product: 'etb', status: 'in_stock' },       // Thu: out -> in = restock
  { at: at(3, 16), product: 'box', status: 'restocked' },  // same delivery, counted once
  { at: at(8), product: 'box', status: 'in_stock' },       // box never ran out: not a restock
  { at: at(9), product: 'etb', status: 'out' },
  { at: at(10), product: 'etb', status: 'low' },           // Thu: restock
  { at: at(17), product: 'etb', status: 'restocked', expected: '2026-09-24' }, // Thu
];
assert.deepEqual(restocks(log), [at(3), at(10), at(17)].map(Date.parse));

const t = timing(log, Date.parse(at(18)));
assert.equal(t.last, Date.parse(at(17)));
assert.equal(Math.round(t.every / DAY), 7);
assert.equal(t.next, t.last + t.every);
assert.equal(t.said, '2026-09-24');
assert.equal(t.weekday, 4); // Thursday
assert.equal(timing(log, Date.parse(at(25))).said, null); // the date staff gave has passed
assert.deepEqual(timing([]), { last: null, said: null, next: null, every: null, weekday: null, usual: null });

// Stated restock days: the next one from Mon Sept 21 2026, today included.
const mon = Date.parse(at(21, 9));
assert.equal(new Date(timing([], mon, ['Wed', 'Fri']).usual).getDate(), 23);
assert.equal(new Date(timing([], mon, ['Mon']).usual).getDate(), 21);
assert.equal(timing([], mon, ['Someday']).usual, null);

console.log('ok');
