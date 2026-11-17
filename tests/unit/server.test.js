/* Server tests: real HTTP + WebSocket against an in-memory database. Run: npm test */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createApp, DAILY_MATCHES, QUESTION_SHUFFLES } from '../../server/app.js';
import { setGame, newGame, deck } from '../../js/state.js';
import { hasContact, stripContact, isUnfriendly, mask } from '../../server/moderation.js';
import { ageFromDob } from '../../server/auth.js';

let app, base;
let fakeAsk = async () => null;                       // AI off by default: template starters stay
before(async () => { app = createApp({ dbPath: ':memory:', authPerMinute: 10_000, ask: (f, a) => fakeAsk(f, a) }); base = `http://127.0.0.1:${await app.listen(0)}`; });
after(() => app.close());

/* ---------- helpers ---------- */
function client() {
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const r = await fetch(base + path, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(method !== 'GET' ? { 'content-type': 'application/json' } : {}), ...headers },
      body: method !== 'GET' ? JSON.stringify(body ?? {}) : undefined,
    });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  };
  return { call, get cookie() { return cookie; } };
}
let n = 0;
const dobForAge = age => { const d = new Date(); d.setFullYear(d.getFullYear() - age); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); };
const card = over => ({ name: 'Alex', city: 'Pune', song: 'Holocene', bio: 'Likes rain.', sk: 1, hr: 0, bg: 2, hs: 1, self: [0, 1, 2],
  gender: 'woman', seeking: ['man'], intent: 'long-term', ageMin: 18, ageMax: 99, ...over });
async function user(profile = {}, age = 28) {
  const c = client();
  const r = await c.call('POST', '/api/signup', { email: `u${++n}@test.dev`, password: 'correct horse battery', dob: dobForAge(age) });
  assert.equal(r.status, 200, r.error);
  if (profile) assert.equal((await c.call('PUT', '/api/profile', card(profile))).status, 200);
  return c;
}
function socket(c) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws', { headers: { cookie: c.cookie } });
  const msgs = [];
  ws.on('message', d => msgs.push(JSON.parse(d)));
  const until = (pred, ms = 3000) => new Promise((res, rej) => {
    const t0 = Date.now();
    const tick = () => { const m = msgs.find(pred); if (m) return res(m); if (Date.now() - t0 > ms) return rej(new Error('timed out waiting for message')); setTimeout(tick, 20); };
    tick();
  });
  const opened = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  return { ws, msgs, until, opened, send: m => ws.send(JSON.stringify(m)), lastPeers: () => [...msgs].reverse().find(m => m.t === 'peers') };
}
const partnerOf = peersMsg => peersMsg?.peers.find(p => !p.sameTab)?.presence;
const blankP = role => ({ v: 1, role, at: 1, prof: { ready: true }, r1: Array(6).fill(null), r3: [null, null, null], flips: [], draw: { s: '', e: 0, g: [], t: [], x: 0 }, date: null, msg: { n: 0, text: '' } });

/* ---------- pure helpers ---------- */
test('moderation: contact details and abuse are caught', () => {
  for (const s of ['call me 98765 43210', 'mail a.b@c.io', 'insta: joe.k', 'find me @joe_k', 'www.site.com', 'see joe.me']) assert.ok(hasContact(s), s);
  for (const s of ['I like 3 cats', 'Mountains or beach', 'Pune, India', 'cold/mess by Prateek Kuhad']) assert.ok(!hasContact(s), s);
  assert.ok(!stripContact('text me 9876543210 ok').includes('9876'));
  assert.ok(isUnfriendly('you are a b1tch'));
  assert.equal(mask('oh shit'), 'oh ****');
});
test('auth: age from date of birth', () => {
  assert.equal(ageFromDob('2000-02-30'), null);
  assert.equal(ageFromDob('nope'), null);
  assert.equal(ageFromDob(dobForAge(18)), 18);
});

/* ---------- HTTP basics & security ---------- */
test('static: serves the app, never server code or data', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.match(await r.text(), /Blind Pitch/);
  for (const p of ['/js/%2e%2e/server/app.js', '/js/..%2fserver/db.js', '/css/%2e%2e/package.json']) {
    const t = await (await fetch(base + p)).text();
    assert.ok(!t.includes('createApp') && !t.includes('better-sqlite3') && !t.includes('"dependencies"'), p);
  }
  assert.match(await (await fetch(base + '/server/app.js')).text(), /<!doctype html>/i);   // unknown paths get the app shell
});
test('csrf: writes need JSON and same origin', async () => {
  const c = await user();
  let r = await fetch(base + '/api/queue', { method: 'POST', headers: { cookie: c.cookie, 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(r.status, 403);
  r = await fetch(base + '/api/queue', { method: 'POST', headers: { cookie: c.cookie, 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' });
  assert.equal(r.status, 403);
});

test('signup: adults only, strong-enough password, unique email, generic login errors', async () => {
  const c = client();
  assert.equal((await c.call('POST', '/api/signup', { email: 'kid@test.dev', password: 'correct horse battery', dob: dobForAge(17) })).status, 403);
  assert.equal((await c.call('POST', '/api/signup', { email: 'x@test.dev', password: 'short', dob: dobForAge(30) })).status, 400);
  assert.equal((await c.call('POST', '/api/signup', { email: 'dupe@test.dev', password: 'correct horse battery', dob: dobForAge(30) })).status, 200);
  assert.equal((await client().call('POST', '/api/signup', { email: 'DUPE@test.dev', password: 'correct horse battery', dob: dobForAge(30) })).status, 409);
  const bad = await client().call('POST', '/api/login', { email: 'dupe@test.dev', password: 'wrong password!!' });
  const missing = await client().call('POST', '/api/login', { email: 'nobody@test.dev', password: 'wrong password!!' });
  assert.equal(bad.status, 401); assert.equal(bad.error, missing.error);
  const ok = await client().call('POST', '/api/login', { email: 'dupe@test.dev', password: 'correct horse battery' });
  assert.equal(ok.status, 200);
  assert.equal((await client().call('GET', '/api/me')).status, 401);
});

test('profile: validated, contact details and abuse refused', async () => {
  const c = await user(null);
  assert.equal((await c.call('PUT', '/api/profile', card({ bio: 'text me on 98765 43210' }))).status, 400);
  assert.equal((await c.call('PUT', '/api/profile', card({ name: 'shithead' }))).status, 400);
  assert.equal((await c.call('PUT', '/api/profile', card({ seeking: [] }))).status, 400);
  const r = await c.call('PUT', '/api/profile', card({ ageMin: 40, ageMax: 30 }));
  assert.equal(r.status, 200);
  assert.equal(r.profile.ageMax, 40);                     // max is raised to min
  assert.equal(r.profile.age, 28);
});

/* ---------- matchmaking ---------- */
test('queue: pairs only people who want to meet each other', async () => {
  const a = await user({ gender: 'woman', seeking: ['man'] });
  const wrong = await user({ gender: 'woman', seeking: ['man'] });         // a woman: a doesn't seek women
  assert.equal((await a.call('POST', '/api/queue')).status, 'waiting');
  assert.equal((await wrong.call('POST', '/api/queue')).status, 'waiting');
  const tooOld = await user({ gender: 'man', seeking: ['woman'], ageMin: 40 });   // a is 28
  assert.equal((await tooOld.call('POST', '/api/queue')).status, 'waiting');
  const b = await user({ gender: 'man', seeking: ['woman'] });
  const r = await b.call('POST', '/api/queue');
  assert.equal(r.status, 'matched'); assert.equal(r.role, 'guest');
  const poll = await a.call('GET', '/api/queue');
  assert.equal(poll.status, 'matched'); assert.equal(poll.code, r.code); assert.equal(poll.role, 'host');
  for (const c of [wrong, tooOld]) await c.call('DELETE', '/api/queue');
});

test('queue: daily limit, no rematches, blocked people never meet', async () => {
  const me = await user({ gender: 'man', seeking: ['woman'], intent: 'casual' });
  for (let i = 0; i < DAILY_MATCHES; i++) {
    const p = await user({ gender: 'woman', seeking: ['man'], intent: 'not-sure' });
    await p.call('POST', '/api/queue');
    assert.equal((await me.call('POST', '/api/queue')).status, 'matched');
  }
  assert.equal((await me.call('POST', '/api/queue')).status, 'limit');

  // block: x blocks y in a private room, then both queue: no match
  const x = await user({ gender: 'man', seeking: ['woman'] }), y = await user({ gender: 'woman', seeking: ['man'] });
  const room = await x.call('POST', '/api/rooms');
  await y.call('POST', `/api/rooms/${room.code}/join`);
  assert.equal((await x.call('POST', `/api/matches/${room.code}/block`)).ok, true);
  await x.call('POST', '/api/queue');
  assert.equal((await y.call('POST', '/api/queue')).status, 'waiting');
  assert.equal((await y.call('POST', `/api/rooms/${room.code}/join`)).status, 404);
  for (const c of [x, y]) await c.call('DELETE', '/api/queue');
});

/* ---------- live game ---------- */
async function privateGame() {
  const host = await user({ name: 'Hana', gender: 'woman', seeking: ['man'], self: [0, 1, 2] });
  const guest = await user({ name: 'Gabe', gender: 'man', seeking: ['woman'], self: [2, 2, 2] });
  const { code } = await host.call('POST', '/api/rooms');
  assert.equal((await guest.call('POST', `/api/rooms/${code}/join`)).role, 'guest');
  assert.equal((await client().call('POST', `/api/rooms/${code}/join`)).status, 401);
  const H = socket(host), G = socket(guest);
  await Promise.all([H.opened, G.opened]);
  H.send({ t: 'join', code }); G.send({ t: 'join', code });
  await H.until(m => m.t === 'joined'); await G.until(m => m.t === 'joined');
  return { host, guest, code, H, G };
}
const settle = () => new Promise(r => setTimeout(r, 120));

test('game: partner card stays hidden until earned; moves are final', async () => {
  const { H, G } = await privateGame();
  const hp = blankP('host'), gp = blankP('guest');
  hp.r1 = [0, 0, null, null, null, null];
  hp.msg = { n: 1, text: 'call me 98765 43210' };
  H.send({ t: 'presence', p: hp }); G.send({ t: 'presence', p: gp });
  await settle();
  let seen = partnerOf(G.lastPeers());
  assert.equal(seen.prof.name, '');                     // chemistry below 12: no name
  assert.equal(seen.prof.bio, '');
  assert.deepEqual(seen.r1, [null, null, null, null, null, null]);   // guest hasn't answered: picks hidden
  assert.deepEqual(seen.prof.self, [null, null, null]); // "about me" answers hidden
  assert.ok(!seen.msg.text.includes('9876'));           // no contact details before a mutual yes

  gp.r1 = [0, 1, null, null, null, null];
  G.send({ t: 'presence', p: gp }); await settle();
  seen = partnerOf(G.lastPeers());
  assert.deepEqual(seen.r1.slice(0, 2), [0, 0]);        // revealed only for questions guest answered
  assert.equal(seen.r1[2], null);

  gp.r1 = [1, 1, null, null, null, null];               // try to change an answer after seeing theirs
  G.send({ t: 'presence', p: gp }); await settle();
  seen = partnerOf(H.lastPeers());
  assert.equal(seen.r1[0], 0);                          // still the original answer

  gp.r3 = [0, null, null];                              // guess about the host
  G.send({ t: 'presence', p: gp }); await settle();
  seen = partnerOf(G.lastPeers());
  assert.deepEqual(seen.prof.self, [0, null, null]);    // only the guessed answer is revealed
  H.ws.close(); G.ws.close();
});

function completePresences(code) {
  setGame(newGame(code, 'host'));
  const by = {}; deck().forEach((w, i) => (by[w] ??= []).push(i));
  const pairs = Object.values(by);
  const hp = blankP('host'), gp = blankP('guest');
  pairs.forEach((p, i) => (i % 2 === 0 ? hp : gp).flips.push(...p));
  for (const p of [hp, gp]) { p.at = 5; p.r1 = [0, 0, 0, 0, 0, 0]; }
  hp.draw = { s: '!ABCD', e: 1, g: [], t: [], x: 0 };
  gp.draw = { s: '#EFGH', e: 1, g: [], t: [], x: 0 };
  hp.r3 = [2, 2, 2]; gp.r3 = [0, 1, 2];
  return { hp, gp };
}

test('game: mutual yes creates a match with starters; chat opens; report ends it', async () => {
  const { host, guest, code, H, G } = await privateGame();
  const { hp, gp } = completePresences(code);
  H.send({ t: 'presence', p: hp }); G.send({ t: 'presence', p: gp }); await settle();
  assert.equal(partnerOf(G.lastPeers()).prof.name, 'Hana');      // game finished: everything unlocks
  assert.equal(partnerOf(G.lastPeers()).date, null);
  hp.date = 'yes'; H.send({ t: 'presence', p: hp }); await settle();
  assert.equal(partnerOf(G.lastPeers()).date, null);             // can't see their answer before giving mine
  assert.equal((await guest.call('GET', `/api/matches/${code}/messages`)).status, 403);
  gp.date = 'yes'; G.send({ t: 'presence', p: gp });
  await H.until(m => m.t === 'mutual' && m.code === code);
  const { matches } = await guest.call('GET', '/api/matches');
  const m = matches.find(x => x.code === code);
  assert.equal(m.partner.name, 'Hana');
  assert.ok(m.chem >= 40);
  assert.ok(m.starters.some(s => s.includes('We both picked')));

  const sent = await guest.call('POST', `/api/matches/${code}/messages`, { body: 'Coffee on Sunday? my number is 98765 43210, holy shit so excited' });
  assert.equal(sent.status, 200);
  assert.ok(sent.message.body.includes('98765'));       // contact details are fine after a mutual yes
  assert.ok(sent.message.body.includes('****'));        // abuse still masked
  const push = await H.until(x => x.t === 'msg' && x.code === code);
  assert.equal(push.message.mine, false);
  const thread = await host.call('GET', `/api/matches/${code}/messages`);
  assert.equal(thread.messages.length, 1);

  assert.equal((await client().call('GET', `/api/matches/${code}/messages`)).status, 401);
  const stranger = await user();
  assert.equal((await stranger.call('GET', `/api/matches/${code}/messages`)).status, 404);

  assert.equal((await host.call('POST', `/api/matches/${code}/report`, { reason: 'nope' })).status, 400);
  assert.equal((await host.call('POST', `/api/matches/${code}/report`, { reason: 'harassment', details: 'rude' })).ok, true);
  await G.until(x => x.t === 'ended' && x.code === code);
  assert.equal((await guest.call('GET', '/api/matches')).matches.find(x => x.code === code), undefined);
  H.ws.close(); G.ws.close();
});

test('AI questions: built from game facts only, sent to both, shuffle is limited', async () => {
  const { host, guest, code, H, G } = await privateGame();
  const calls = [];
  let round = 0;
  fakeAsk = async (facts, avoid) => { calls.push({ facts, avoid }); round++; return [`Question set ${round}, one?`, `Question set ${round}, two?`, `Question set ${round}, three?`]; };
  const { hp, gp } = completePresences(code);
  hp.date = gp.date = 'yes';
  H.send({ t: 'presence', p: hp }); G.send({ t: 'presence', p: gp });
  const pushed = await G.until(m => m.t === 'questions' && m.code === code);
  assert.deepEqual(pushed.questions, ['Question set 1, one?', 'Question set 1, two?', 'Question set 1, three?']);
  await H.until(m => m.t === 'questions' && m.code === code);

  // Only facts from fixed lists reach the AI: no names, cities, songs or bios.
  const sent = JSON.stringify(calls[0].facts);
  for (const secret of ['Hana', 'Gabe', 'Pune', 'Holocene', 'Likes rain']) assert.ok(!sent.includes(secret), secret);
  assert.deepEqual(calls[0].facts.bothPicked.length, 6);
  assert.equal(calls[0].facts.personB[0].answer, 'Whatever the person before me got');

  const m = (await host.call('GET', '/api/matches')).matches.find(x => x.code === code);
  assert.equal(m.ai, true);
  assert.equal(m.starters[0], 'Question set 1, one?');

  const again = await guest.call('POST', `/api/matches/${code}/questions`);
  assert.equal(again.questions[0], 'Question set 2, one?');
  assert.deepEqual(calls[1].avoid, pushed.questions);           // asks for different ones
  await H.until(x => x.t === 'questions' && x.questions[0] === 'Question set 2, one?');
  for (let i = 1; i < QUESTION_SHUFFLES; i++) assert.equal((await host.call('POST', `/api/matches/${code}/questions`)).status, 200);
  assert.equal((await host.call('POST', `/api/matches/${code}/questions`)).status, 429);

  fakeAsk = async () => null;                                   // AI down: keep what they have
  const { code: c2, host: h2, H: H2, G: G2 } = await privateGame();
  const p2 = completePresences(c2);
  p2.hp.date = p2.gp.date = 'yes';
  H2.send({ t: 'presence', p: p2.hp }); G2.send({ t: 'presence', p: p2.gp });
  await H2.until(x => x.t === 'mutual');
  assert.equal((await h2.call('POST', `/api/matches/${c2}/questions`)).status, 503);
  assert.ok((await h2.call('GET', '/api/matches')).matches.find(x => x.code === c2).starters.some(s => s.includes('We both picked')));
  assert.equal((await client().call('POST', `/api/matches/${code}/questions`)).status, 401);
  for (const s of [H, G, H2, G2]) s.ws.close();
});

test('sockets: need a session; oversized or foreign presences are refused', async () => {
  await assert.rejects(new Promise((res, rej) => { const ws = new WebSocket(base.replace('http', 'ws') + '/ws'); ws.on('open', res); ws.on('error', rej); }));
  const { code, H, G } = await privateGame();
  const outsider = await user(); const O = socket(outsider); await O.opened;
  O.send({ t: 'join', code });
  assert.match((await O.until(m => m.t === 'error')).error, /not available/);
  H.send({ t: 'presence', p: { ...blankP('host'), msg: { n: 1, text: 'x'.repeat(5000) } } });
  assert.match((await H.until(m => m.t === 'error')).error, /Too much data/);
  for (const s of [H, G, O]) s.ws.close();
});

test('account deletion removes the person everywhere', async () => {
  const c = await user();
  assert.equal((await c.call('DELETE', '/api/me')).ok, true);
  assert.equal((await c.call('GET', '/api/me')).status, 401);
});
