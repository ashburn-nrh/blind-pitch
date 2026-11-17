/* Unit tests for Draw & Guess logic. Run: npm test  (Node 20+, no dependencies). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { encodeStroke, decode, sanitize, undoLast, strokeCount, inkLeft, simplify, INK_MAX, MAX_STROKES, ALPHA, HEAD } from '../../js/draw/codec.js';
import { checkGuess, drawWords, drawPoints, DRAW_WORDS } from '../../js/draw/rules.js';
import { BOT_DRAWINGS } from '../../js/draw/bot-drawings.js';
import { setGame, setLive, newGame, migrate, deck, L } from '../../js/state.js';
import { cleanP, buildPresence, jsonBytes, PRESENCE_LIMIT, DRAW_MAX } from '../../js/sync.js';
import { score } from '../../js/scoring.js';
import { drawReplay } from '../../js/draw/replay.js';

/* ---------- codec ---------- */
test('codec: alphabet is 64 JSON-safe chars, disjoint from stroke heads', () => {
  assert.equal(new Set(ALPHA).size, 64);
  assert.equal(new Set(HEAD).size, 8);
  for (const c of HEAD) assert.ok(!ALPHA.includes(c));
  assert.equal(JSON.stringify(ALPHA + HEAD).length, ALPHA.length + HEAD.length + 2);   // nothing escaped
});

test('codec: round trip, one char per coordinate, one head per stroke', () => {
  const st = { c: 2, sz: 1, pts: [[0, 0], [10, 3], [63, 63]] };
  const s = encodeStroke(st);
  assert.equal(s.length, 1 + 3 * 2);
  assert.deepEqual(decode(s), [st]);
});

test('codec: drops repeats and straight-line midpoints', () => {
  assert.deepEqual(simplify([[1, 1], [1, 1], [2, 2], [3, 3], [4, 3]]), [[1, 1], [3, 3], [4, 3]]);
});

test('codec: undo removes exactly the last stroke', () => {
  const a = encodeStroke({ c: 0, sz: 0, pts: [[1, 1], [5, 9]] });
  const b = encodeStroke({ c: 1, sz: 1, pts: [[2, 2]] });
  assert.equal(undoLast(a + b), a);
  assert.equal(undoLast(a), '');
  assert.equal(strokeCount(a + b), 2);
});

test('codec: sanitize rejects junk, caps strokes and length', () => {
  assert.equal(sanitize('<img onerror=alert(1)>'), '');                         // no head: nothing survives
  assert.equal(sanitize('!AB"\\<>CD'), '!ABCD');                                 // stray chars skipped
  assert.equal(sanitize('!ABC'), '!AB');                                         // dangling half point dropped
  assert.equal(strokeCount(sanitize('!AB'.repeat(500))), MAX_STROKES);
  assert.ok(sanitize('!' + 'AB'.repeat(2000)).length <= INK_MAX);
});

test('codec: ink meter reaches 0 at the limit and undo refills it', () => {
  const big = '!' + 'AB'.repeat((INK_MAX - 1) / 2 | 0);
  assert.ok(inkLeft(big) < 0.01);
  assert.equal(inkLeft(undoLast(big)), 1);
});

/* ---------- words & guesses ---------- */
test('words: 40 unique friendly words; bot drawings cover 8 of them and fit the ink', () => {
  assert.equal(DRAW_WORDS.length, 40);
  assert.equal(new Set(DRAW_WORDS).size, 40);
  const keys = Object.keys(BOT_DRAWINGS);
  assert.equal(keys.length, 8);
  for (const k of keys) {
    assert.ok(DRAW_WORDS.includes(k), k);
    const s = BOT_DRAWINGS[k].map(encodeStroke).join('');
    assert.ok(s.length <= INK_MAX, `${k}: ${s.length}`);
    assert.equal(sanitize(s), s);
  }
});

test('words: same code gives same pair on both pages; bot games get a drawable 2nd word', () => {
  assert.deepEqual(drawWords('ABCDE'), drawWords('ABCDE'));
  const [a, b] = drawWords('ABCDE');
  assert.notEqual(a, b);
  for (let i = 0; i < 200; i++) {
    const [x, y] = drawWords('BOT' + i, true);
    assert.ok(BOT_DRAWINGS[y], `BOT${i}: ${y}`);
    assert.notEqual(x, y);
  }
});

test('guesses: case, punctuation, articles, plurals, one typo for 5+ letters', () => {
  const yes = [['Coffee', 'coffee'], ['  coffee!! ', 'coffee'], ['a dog', 'dog'], ['dogs', 'dog'], ['sandwiches', 'sandwich'],
    ['coffe', 'coffee'], ['cofee', 'coffee'], ['cofefe', 'coffee'], ['pizzas', 'pizza'], ['guitra', 'guitar'], ['Bi-cycle', 'bicycle'],
    ['sun set', 'sunset'], ['the moon', 'moon']];
  const no = [['dot', 'dog'], ['do', 'dog'], ['cat', 'dog'], ['mon', 'moon'], ['coff', 'coffee'], ['', 'coffee'], ['!!!', 'kite'], ['kites2', 'kite']];
  for (const [g, w] of yes) assert.ok(checkGuess(g, w), `${g} ~ ${w}`);
  for (const [g, w] of no) assert.ok(!checkGuess(g, w), `${g} !~ ${w}`);
});

test('points: 8 + up to 4 for speed', () => {
  assert.equal(drawPoints(0), 12);
  assert.equal(drawPoints(45), 8);
  assert.equal(drawPoints(999), 8);
  assert.equal(drawPoints(-5), 12);
});

/* ---------- partner validation ---------- */
test('cleanP: validates draw from an untrusted partner', () => {
  const p = cleanP({ v: 1, role: 'guest', at: 3, prof: {}, draw: {
    s: '!AB<"\\ {}>CD\u0000', e: 7, g: ['<b>x</b>', 42, 'a'.repeat(99), 'fourth'], t: [-3, 'x', 9999, 5], x: 'yes' } });
  assert.equal(p.draw.s, '!ABCD');
  // Whatever survives is only stroke heads and grid coordinates.
  const evil = cleanP({ v: 1, role: 'guest', draw: { s: '<script>alert("x")</script>'.repeat(50) } }).draw.s;
  assert.ok([...evil].every(c => ALPHA.includes(c) || HEAD.includes(c)));
  assert.equal(p.draw.e, 0);
  assert.equal(p.draw.g.length, 3);
  assert.equal(p.draw.g[0], '<b>x</b>');            // kept as text; the UI only ever uses textContent
  assert.equal(p.draw.g[1], '');
  assert.equal(p.draw.g[2].length, 24);
  assert.deepEqual(p.draw.t, [0, 45, 45]);
  assert.equal(p.draw.x, 0);
  assert.deepEqual(cleanP({ v: 1, role: 'host' }).draw, { s: '', e: 0, g: [], t: [], x: 0 });   // older client
});

/* ---------- presence size ---------- */
function worstCaseGame() {
  const g = newGame('ZZZZZ', 'host');
  const emoji = '😀', cjk = '漢';
  Object.assign(g.prof, { name: cjk.repeat(24), age: 30, city: cjk.repeat(40), song: cjk.repeat(60), bio: '"'.repeat(160), ready: true, self: [0, 1, 2] });
  g.flips = Array.from({ length: 80 }, (_, i) => i % 16);
  g.msg = { n: 999999, text: emoji.repeat(100) };
  g.draw = { s: '!' + 'AB'.repeat((INK_MAX - 1) / 2 | 0), e: 2, g: ['w'.repeat(24), 'w'.repeat(24), 'w'.repeat(24)], t: [45, 45, 45], x: 1 };
  g.at = 5; g.date = 'yes';
  return g;
}
test('presence: worst case stays under 4 KiB and draw under 1.6 KB, with no trimming', () => {
  setGame(worstCaseGame());
  const before = L.draw.s.length;
  const obj = buildPresence();
  assert.equal(obj.draw.s.length, before, 'guard should not need to trim');
  assert.ok(jsonBytes(obj.draw) <= DRAW_MAX, `draw ${jsonBytes(obj.draw)}`);
  assert.ok(jsonBytes(obj) < PRESENCE_LIMIT, `presence ${jsonBytes(obj)}`);
});
test('presence: guard trims strokes if something ever overflows', () => {
  setGame(worstCaseGame());
  L.draw.s = '!' + 'AB'.repeat(1500);                // bypassing the ink meter
  const obj = buildPresence();
  assert.ok(jsonBytes(obj.draw) <= DRAW_MAX);
  assert.ok(jsonBytes(obj) < PRESENCE_LIMIT);
});

/* ---------- symmetric scoring ---------- */
/** Build a host and a guest, then score from each side using the other's cleaned presence. */
function pair(setup) {
  const host = newGame('QWERT', 'host'), guest = newGame('QWERT', 'guest');
  for (const g of [host, guest]) Object.assign(g.prof, { name: 'X', age: 30, ready: true });
  setup(host, guest);
  const pres = g => cleanP({ ...JSON.parse(JSON.stringify(g)), v: 1 });
  setGame(host); setLive(pres(guest)); const a = { s: score(), d: drawReplay() };
  setGame(guest); setLive(pres(host)); const b = { s: score(), d: drawReplay() };
  setLive(null);
  return [a, b];
}
/** Play a memory game that takes exactly `turns` turns (>= 8): misses first, then all 8 pairs. */
function memFlips(host, guest, turns) {
  setGame(host);
  const byWord = {}; deck().forEach((w, i) => (byWord[w] ??= []).push(i));
  const pairs = Object.values(byWord);
  let misses = turns - 8, t = 0, pi = 0;
  while (pi < 8) {
    const who = t % 2 === 0 ? host : guest;
    if (misses > 0) { who.flips.push(pairs[pi][0], pairs[pi + 1][0]); misses--; }
    else { who.flips.push(...pairs[pi]); pi++; }
    t++;
  }
}

test('score: both players always see the same chemistry, through every draw state', () => {
  const words = drawWords('QWERT');
  const scenarios = [
    () => {},
    (h, g) => { h.draw.s = '!ABCD'; g.draw.g = ['nope']; g.draw.t = [5]; },
    (h, g) => { h.draw.s = '!ABCD'; g.draw.g = ['nope', words[0]]; g.draw.t = [5, 12]; },
    (h, g) => { h.draw.s = '!ABCD'; h.draw.e = 1; g.draw.s = '#CD'; h.draw.g = [words[1] + 's']; h.draw.t = [30]; },
    (h, g) => { h.draw.e = 2; g.draw.e = 2; },
    (h, g) => { g.draw.x = 1; h.draw.x = 1; },
  ];
  for (const sc of scenarios) {
    const [a, b] = pair(sc);
    assert.equal(a.s.chem, b.s.chem);
    assert.equal(a.s.draw, b.s.draw);
    assert.deepEqual(a.d.items.map(i => [i.over, i.correct, i.pts]), b.d.items.map(i => [i.over, i.correct, i.pts]));
  }
  const [a] = pair((h, g) => { g.draw.g = ['x', words[0]]; g.draw.t = [5, 12]; h.draw.g = [words[1]]; h.draw.t = [0]; });
  assert.equal(a.d.hits, 2);
  assert.equal(a.s.draw, drawPoints(12) + drawPoints(0));
  assert.equal(a.d.done, true);
});

test('score: perfect match is 100, typical match lands in 55-70', () => {
  const words = drawWords('QWERT');
  const [perfect] = pair((h, g) => {
    h.r1 = [0, 1, 0, 1, 0, 1]; g.r1 = [0, 1, 0, 1, 0, 1];
    memFlips(h, g, 8);
    g.draw.g = [words[0]]; g.draw.t = [0]; h.draw.g = [words[1]]; h.draw.t = [0];
    h.prof.self = [0, 1, 2]; g.prof.self = [0, 1, 2]; h.r3 = [0, 1, 2]; g.r3 = [0, 1, 2];
  });
  assert.equal(perfect.s.chem, 100);

  const [typical] = pair((h, g) => {
    h.r1 = [0, 1, 0, 1, 0, 1]; g.r1 = [0, 1, 0, 1, 1, 0];            // 4 of 6 in sync
    memFlips(h, g, 16);                                               // 16 turns
    g.draw.g = ['x', words[0]]; g.draw.t = [10, 22];                  // one drawing guessed, mid-speed
    h.draw.g = ['a', 'b', 'c']; h.draw.t = [5, 10, 15];               // the other missed
    h.prof.self = [0, 1, 2]; g.prof.self = [0, 1, 2]; h.r3 = [0, 2, 1]; g.r3 = [0, 1, 0];   // 1 + 2 reads right
  });
  assert.equal(typical.s.mem, 16);
  assert.ok(typical.s.chem >= 55 && typical.s.chem <= 70, `typical ${typical.s.chem}`);
});

/* ---------- migration ---------- */
test('migrate: v1 saves shift Read Them and the reveal past the new round', () => {
  assert.equal(migrate({ at: 2 }).at, 2);
  assert.equal(migrate({ at: 3 }).at, 4);
  const m = migrate({ at: 4 });
  assert.equal(m.at, 5);
  assert.equal(migrate(m).at, 5);                    // idempotent
  assert.deepEqual(m.draw, { s: '', e: 0, g: [], t: [], x: 0 });
});

/* ---------- theme ---------- */
test('theme: every brush colour is readable (>= 3:1) on the canvas paper, light and dark', () => {
  const css = readFileSync(new URL('../../css/styles.css', import.meta.url), 'utf8');
  const blocks = [...css.matchAll(/--paper:(#[0-9a-f]{6});\s*--pen0:(#[0-9a-f]{6});\s*--pen1:(#[0-9a-f]{6});\s*--pen2:(#[0-9a-f]{6});\s*--pen3:(#[0-9a-f]{6})/gi)];
  assert.equal(blocks.length, 3);                    // light, dark (media query), dark (data-theme)
  const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + .05) / (y + .05); };
  for (const [, paper, ...pens] of blocks) for (const pen of pens) assert.ok(ratio(paper, pen) >= 3, `${pen} on ${paper}: ${ratio(paper, pen).toFixed(2)}`);
});
