/*
 * Blind Pitch server: static files, JSON API and live game rooms over WebSocket.
 *
 * Runs the same browser app; when /api/health answers, the app switches from "local mode"
 * (tabs of one browser) to accounts, matchmaking and server-checked games.
 *
 *   Auth      POST /api/signup  POST /api/login  POST /api/logout  GET /api/me  DELETE /api/me
 *   Profile   PUT  /api/profile
 *   Matching  POST /api/queue   GET /api/queue   DELETE /api/queue
 *   Friends   POST /api/rooms   POST /api/rooms/:code/join
 *   Matches   GET  /api/matches GET|POST /api/matches/:code/messages
 *             POST /api/matches/:code/(unmatch|block|report)
 *             POST /api/matches/:code/questions   (new AI questions, when GEMINI_API_KEY is set)
 *   Live      GET  /ws  (WebSocket; messages: join, presence, leave)
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { openDb } from './db.js';
import { hashPassword, verifyPassword, newToken, tokenHash, ageFromDob, rateLimiter } from './auth.js';
import { hasContact, isUnfriendly, mask } from './moderation.js';
import { partnerView, outcome, mergePresence, gameFacts } from './game.js';
import { cleanP, jsonBytes, PRESENCE_LIMIT } from '../js/sync.js';
import { newCode } from '../js/state.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = ['index.html', 'css/', 'js/'];
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const DAY = 86_400_000;
const SESSION_MS = 30 * DAY;
const QUEUE_STALE_MS = 30_000;             // a waiting player must poll at least this often
export const DAILY_MATCHES = 3;
export const GENDERS = ['woman', 'man', 'nonbinary'];
export const INTENTS = ['long-term', 'casual', 'not-sure'];
export const REPORT_REASONS = ['harassment', 'inappropriate', 'spam', 'underage', 'fake', 'other'];
export const QUESTION_SHUFFLES = 5;        // new AI question sets per match per day
const AUTO_HIDE_REPORTS = 3;               // distinct reporters before someone is kept out of the queue

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const str = (v, n) => typeof v === 'string' ? v.trim().slice(0, n) : '';

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };

/** ask: optional (facts, avoid) => Promise<string[]|null> from server/ai.js; null keeps template starters. */
export function createApp({ dbPath = ':memory:', production = false, trustProxy = false, authPerMinute = 10, ask = null } = {}) {
  if (dbPath !== ':memory:') mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = openDb(dbPath);
  const q = sql => db.prepare(sql);
  const now = () => Date.now();

  /* ---------------- users, sessions, profiles ---------------- */
  const authLimit = rateLimiter(authPerMinute, 60_000);
  const apiLimit = rateLimiter(240, 60_000);
  const chatLimit = rateLimiter(30, 60_000);
  const shuffleLimit = rateLimiter(QUESTION_SHUFFLES, DAY);

  function loadProfile(userId) {
    const row = q('SELECT p.json, u.dob FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ?').get(userId);
    return row ? { ...JSON.parse(row.json), age: ageFromDob(row.dob) } : null;
  }
  function userFromCookie(header) {
    const m = /(?:^|;\s*)bp_session=([\w-]+)/.exec(header || '');
    if (!m) return null;
    const row = q('SELECT s.user_id AS id, s.expires_at, u.email, u.dob FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?').get(tokenHash(m[1]));
    if (!row || row.expires_at < now()) return null;
    return { id: row.id, email: row.email, dob: row.dob };
  }
  function startSession(res, userId) {
    const token = newToken();
    q('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash(token), userId, now() + SESSION_MS);
    res.setHeader('Set-Cookie', `bp_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${production ? '; Secure' : ''}`);
  }
  const clearCookie = res => res.setHeader('Set-Cookie', `bp_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${production ? '; Secure' : ''}`);

  function validProfile(b, age) {
    const name = str(b.name, 24);
    if (!name) fail(400, 'Add your first name.');
    const idx = (v, n) => Number.isInteger(v) && v >= 0 && v < n ? v : 0;
    const self = Array.isArray(b.self) && b.self.length === 3 && b.self.every(v => Number.isInteger(v) && v >= 0 && v < 3) ? b.self : null;
    if (!self) fail(400, 'Answer the three questions about yourself.');
    if (!GENDERS.includes(b.gender)) fail(400, 'Choose how you describe yourself.');
    const seeking = Array.isArray(b.seeking) ? [...new Set(b.seeking.filter(g => GENDERS.includes(g)))] : [];
    if (!seeking.length) fail(400, 'Choose who you would like to meet.');
    const ageMin = clamp(Number.isInteger(b.ageMin) ? b.ageMin : 18, 18, 99);
    const ageMax = clamp(Number.isInteger(b.ageMax) ? b.ageMax : 99, ageMin, 99);
    const p = { name, city: str(b.city, 40), song: str(b.song, 60), bio: str(b.bio, 160),
      sk: idx(b.sk, 4), hr: idx(b.hr, 4), bg: idx(b.bg, 4), hs: idx(b.hs, 2), self,
      gender: b.gender, seeking, intent: INTENTS.includes(b.intent) ? b.intent : 'not-sure', ageMin, ageMax };
    for (const k of ['name', 'city', 'song', 'bio']) {
      if (hasContact(p[k])) fail(400, `Keep contact details out of your ${k}. You can swap them after a mutual yes.`);
      if (isUnfriendly(p[k])) fail(400, `Please keep your ${k} friendly.`);
    }
    return { ...p, age };
  }

  /* ---------------- matches ---------------- */
  const matchByCode = code => q('SELECT * FROM matches WHERE code = ?').get(String(code || '').toUpperCase());
  const roleOf = (m, userId) => m.host_id === userId ? 'host' : m.guest_id === userId ? 'guest' : null;
  const otherId = (m, userId) => m.host_id === userId ? m.guest_id : m.host_id;
  const blockedEitherWay = (a, b) => !!q('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)').get(a, b, b, a);
  function uniqueCode() {
    for (let i = 0; i < 20; i++) { const c = newCode(); if (!matchByCode(c)) return c; }
    fail(500, 'Could not create a room. Try again.');
  }
  function myMatch(code, userId) {
    const m = matchByCode(code);
    if (!m || !roleOf(m, userId)) fail(404, 'Match not found.');
    return m;
  }
  function endMatch(m, by, reason) {
    q("UPDATE matches SET status = 'ended' WHERE id = ?").run(m.id);
    for (const uid of [m.host_id, m.guest_id]) if (uid && uid !== by) push(uid, { t: 'ended', code: m.code, reason });
    for (const ws of rooms.get(m.code) || []) if (ws.user.id === by) leaveRoom(ws);
  }

  /* ---------------- matchmaking queue ---------------- */
  function compatible(a, b) {
    return a.seeking.includes(b.gender) && b.seeking.includes(a.gender)
      && b.age >= a.ageMin && b.age <= a.ageMax && a.age >= b.ageMin && a.age <= b.ageMax
      && (a.intent === b.intent || a.intent === 'not-sure' || b.intent === 'not-sure');
  }
  const queueMatchesToday = userId => q("SELECT COUNT(*) AS n FROM matches WHERE kind = 'queue' AND (host_id = ? OR guest_id = ?) AND created_at > ?").get(userId, userId, now() - DAY).n;
  const hiddenByReports = userId => q('SELECT COUNT(DISTINCT reporter_id) AS n FROM reports WHERE reported_id = ?').get(userId).n >= AUTO_HIDE_REPORTS;
  const metBefore = (a, b) => !!q('SELECT 1 FROM matches WHERE (host_id = ? AND guest_id = ?) OR (host_id = ? AND guest_id = ?)').get(a, b, b, a);

  function joinQueue(user) {
    const me = loadProfile(user.id);
    if (!me) fail(400, 'Make your card first.');
    const used = queueMatchesToday(user.id);
    if (used >= DAILY_MATCHES) return { status: 'limit', left: 0 };
    q('DELETE FROM queue WHERE seen_at < ?').run(now() - QUEUE_STALE_MS);
    if (!hiddenByReports(user.id)) {
      const waiting = q('SELECT user_id FROM queue WHERE user_id != ? ORDER BY joined_at').all(user.id);
      for (const { user_id: other } of waiting) {
        const them = loadProfile(other);
        if (!them || !compatible(me, them) || blockedEitherWay(user.id, other) || metBefore(user.id, other) || hiddenByReports(other)) continue;
        if (queueMatchesToday(other) >= DAILY_MATCHES) continue;
        const code = uniqueCode();
        db.transaction(() => {
          q('DELETE FROM queue WHERE user_id IN (?, ?)').run(user.id, other);
          q("INSERT INTO matches (code, kind, host_id, guest_id, created_at) VALUES (?, 'queue', ?, ?, ?)").run(code, other, user.id, now());
        })();
        push(other, { t: 'matched', code, role: 'host' });
        return { status: 'matched', code, role: 'guest', left: DAILY_MATCHES - used - 1 };
      }
    }
    q('INSERT INTO queue (user_id, joined_at, seen_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET seen_at = excluded.seen_at').run(user.id, now(), now());
    return { status: 'waiting', left: DAILY_MATCHES - used };
  }
  function pollQueue(user) {
    const row = q('UPDATE queue SET seen_at = ? WHERE user_id = ? RETURNING user_id').get(now(), user.id);
    if (row) return { status: 'waiting', left: DAILY_MATCHES - queueMatchesToday(user.id) };
    const m = q("SELECT code FROM matches WHERE kind = 'queue' AND status = 'playing' AND host_id = ? AND created_at > ? ORDER BY id DESC LIMIT 1").get(user.id, now() - 120_000);
    return m ? { status: 'matched', code: m.code, role: 'host' } : { status: 'idle', left: DAILY_MATCHES - queueMatchesToday(user.id) };
  }

  /* ---------------- live rooms (WebSocket) ---------------- */
  let closing = false;      // set by close(): late socket events must not touch the closed database
  const conns = new Map();   // userId -> Set<ws>
  const rooms = new Map();   // code   -> Set<ws>
  function push(userId, msg) {
    const s = JSON.stringify(msg);
    for (const ws of conns.get(userId) || []) if (ws.readyState === 1) ws.send(s);
  }
  const storedPresence = (m, role) => { const raw = m[role === 'host' ? 'host_presence' : 'guest_presence']; return raw ? JSON.parse(raw) : null; };
  function broadcastPeers(code) {
    const set = rooms.get(code);
    if (!set) return;
    const m = matchByCode(code);
    if (!m) return;
    const profiles = { host: loadProfile(m.host_id), guest: m.guest_id ? loadProfile(m.guest_id) : null };
    const online = new Set([...set].map(ws => ws.room.role));
    for (const ws of set) {
      const role = ws.room.role, other = role === 'host' ? 'guest' : 'host';
      const peers = [{ peer: 'me', sameTab: true, presence: storedPresence(m, role) }];
      if (online.has(other)) {
        const view = partnerView({ code, role, me: storedPresence(m, role), meProf: profiles[role],
          them: storedPresence(m, other), themProf: profiles[other], mutual: m.status === 'mutual' });
        if (view) peers.push({ peer: other, sameTab: false, presence: view });
      }
      if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'peers', peers }));
    }
  }
  function leaveRoom(ws) {
    const code = ws.room?.code;
    if (!code) return;
    ws.room = null;
    const set = rooms.get(code);
    if (set) { set.delete(ws); if (!set.size) rooms.delete(code); else if (!closing) broadcastPeers(code); }
  }
  function onSocketMessage(ws, data) {
    if (closing) return;
    if (!ws.limit(ws.user.id)) return ws.send(JSON.stringify({ t: 'error', error: 'Slow down a little.' }));
    let msg; try { msg = JSON.parse(data); } catch { return; }
    if (msg?.t === 'join') {
      const m = matchByCode(msg.code);
      const role = m && roleOf(m, ws.user.id);
      if (!role || m.status === 'ended') return ws.send(JSON.stringify({ t: 'error', error: 'This game is not available.' }));
      leaveRoom(ws);
      ws.room = { code: m.code, role };
      if (!rooms.has(m.code)) rooms.set(m.code, new Set());
      rooms.get(m.code).add(ws);
      ws.send(JSON.stringify({ t: 'joined', code: m.code, role }));
      return broadcastPeers(m.code);
    }
    if (msg?.t === 'leave') return leaveRoom(ws);
    if (msg?.t === 'presence' && ws.room) {
      if (jsonBytes(msg.p ?? null) > PRESENCE_LIMIT) return ws.send(JSON.stringify({ t: 'error', error: 'Too much data.' }));
      const m = matchByCode(ws.room.code);
      if (!m || m.status === 'ended') return;
      const role = ws.room.role;
      const clean = cleanP({ ...(msg.p || {}), v: 1, role });
      if (!clean) return;
      const prof = loadProfile(ws.user.id);
      clean.prof = { ...clean.prof, ready: !!prof && clean.prof.ready };
      const merged = mergePresence(storedPresence(m, role), clean);
      q(`UPDATE matches SET ${role === 'host' ? 'host_presence' : 'guest_presence'} = ? WHERE id = ?`).run(JSON.stringify(merged), m.id);
      settle(matchByCode(m.code));
      return broadcastPeers(m.code);
    }
  }
  /** Record the result once both have answered the second-date question. */
  function settle(m) {
    if (m.status !== 'playing' || !m.guest_id) return;
    const res = outcome({ code: m.code, host: storedPresence(m, 'host'), guest: storedPresence(m, 'guest'),
      hostProf: loadProfile(m.host_id), guestProf: loadProfile(m.guest_id) });
    if (!res) return;
    q('UPDATE matches SET status = ?, chem = ?, starters = ? WHERE id = ?').run(res.status, res.chem ?? null, JSON.stringify(res.starters || []), m.id);
    if (res.status === 'mutual') {
      for (const uid of [m.host_id, m.guest_id]) push(uid, { t: 'mutual', code: m.code });
      if (ask) aiQuestions(m.code, []).catch(e => console.error(e));   // templates stay until the AI answers
    }
  }

  /** Ask the AI for questions built on this match's game; store them and send them to both. */
  async function aiQuestions(code, avoid) {
    const m = matchByCode(code);
    if (!m || m.status !== 'mutual') return null;
    const g = { code, host: storedPresence(m, 'host'), guest: storedPresence(m, 'guest'), hostProf: loadProfile(m.host_id), guestProf: loadProfile(m.guest_id) };
    if (!g.host || !g.guest || !g.hostProf || !g.guestProf) return null;
    const qs = await ask(gameFacts(g), avoid);
    if (!qs || closing) return null;
    const cur = matchByCode(code);
    if (!cur || cur.status !== 'mutual') return null;          // unmatched while we waited
    q('UPDATE matches SET starters = ? WHERE id = ?').run(JSON.stringify(qs), cur.id);
    for (const uid of [cur.host_id, cur.guest_id]) push(uid, { t: 'questions', code, questions: qs });
    return qs;
  }

  /* ---------------- HTTP ---------------- */
  async function body(req) {
    let size = 0; const chunks = [];
    for await (const c of req) { size += c.length; if (size > 16_384) fail(413, 'Request too large.'); chunks.push(c); }
    if (!chunks.length) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail(400, 'Invalid JSON.'); }
  }
  const ipOf = req => (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress;
  function sameOrigin(req) {
    const o = req.headers.origin;
    if (!o) return true;
    try { return new URL(o).host === req.headers.host; } catch { return false; }
  }

  const routes = [];
  const route = (method, pattern, handler, { auth = true } = {}) =>
    routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler, auth });

  route('GET', '/api/health', () => ({ ok: true }), { auth: false });

  route('POST', '/api/signup', async ({ req, res, b }) => {
    if (!authLimit(ipOf(req))) fail(429, 'Too many attempts. Try again in a minute.');
    const email = str(b.email, 200).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a valid email.');
    if (typeof b.password !== 'string' || b.password.length < 10 || b.password.length > 200) fail(400, 'Use a password of at least 10 characters.');
    const age = ageFromDob(b.dob);
    if (age == null) fail(400, 'Enter your date of birth.');
    if (age < 18) fail(403, 'Blind Pitch is for adults 18 and over.');
    if (age > 110) fail(400, 'Check your date of birth.');
    if (q('SELECT 1 FROM users WHERE email = ?').get(email)) fail(409, 'That email already has an account. Log in instead.');
    const { salt, hash } = await hashPassword(b.password);
    const { lastInsertRowid: id } = q('INSERT INTO users (email, pass_hash, pass_salt, dob, created_at) VALUES (?, ?, ?, ?, ?)').run(email, hash, salt, b.dob, now());
    startSession(res, Number(id));
    return { user: { email, age }, profile: null };
  }, { auth: false });

  route('POST', '/api/login', async ({ req, res, b }) => {
    if (!authLimit(ipOf(req))) fail(429, 'Too many attempts. Try again in a minute.');
    const row = q('SELECT * FROM users WHERE email = ?').get(str(b.email, 200).toLowerCase());
    if (!row || typeof b.password !== 'string' || !(await verifyPassword(b.password, row.pass_salt, row.pass_hash))) fail(401, 'Email or password is incorrect.');
    startSession(res, row.id);
    return { user: { email: row.email, age: ageFromDob(row.dob) }, profile: loadProfile(row.id) };
  }, { auth: false });

  route('POST', '/api/logout', ({ req, res }) => {
    const m = /(?:^|;\s*)bp_session=([\w-]+)/.exec(req.headers.cookie || '');
    if (m) q('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(m[1]));
    clearCookie(res);
    return { ok: true };
  });

  route('GET', '/api/me', ({ user }) => ({ user: { email: user.email, age: ageFromDob(user.dob) }, profile: loadProfile(user.id), dailyLeft: DAILY_MATCHES - queueMatchesToday(user.id) }));

  route('DELETE', '/api/me', ({ user, res }) => {
    const id = user.id;
    for (const m of q("SELECT * FROM matches WHERE (host_id = ? OR guest_id = ?) AND status != 'ended'").all(id, id)) endMatch(m, id, 'deleted');
    db.transaction(() => {
      q('DELETE FROM messages WHERE sender_id = ?').run(id);
      q('DELETE FROM queue WHERE user_id = ?').run(id);
      q('DELETE FROM profiles WHERE user_id = ?').run(id);
      q('DELETE FROM sessions WHERE user_id = ?').run(id);
      q('UPDATE matches SET host_presence = NULL WHERE host_id = ?').run(id);
      q('UPDATE matches SET guest_presence = NULL WHERE guest_id = ?').run(id);
      q('DELETE FROM users WHERE id = ?').run(id);   // reports and blocks are kept for safety
    })();
    clearCookie(res);
    return { ok: true };
  });

  route('PUT', '/api/profile', ({ user, b }) => {
    const p = validProfile(b, ageFromDob(user.dob));
    const { age, ...stored } = p;
    q('INSERT INTO profiles (user_id, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at').run(user.id, JSON.stringify(stored), now());
    return { profile: p };
  });

  route('POST', '/api/queue', ({ user }) => joinQueue(user));
  route('GET', '/api/queue', ({ user }) => pollQueue(user));
  route('DELETE', '/api/queue', ({ user }) => { q('DELETE FROM queue WHERE user_id = ?').run(user.id); return { status: 'idle' }; });

  route('POST', '/api/rooms', ({ user }) => {
    if (!loadProfile(user.id)) fail(400, 'Make your card first.');
    const code = uniqueCode();
    q("INSERT INTO matches (code, kind, host_id, created_at) VALUES (?, 'private', ?, ?)").run(code, user.id, now());
    return { code, role: 'host' };
  });
  route('POST', '/api/rooms/:code/join', ({ user, params }) => {
    if (!loadProfile(user.id)) fail(400, 'Make your card first.');
    const m = matchByCode(params.code);
    if (!m || m.status === 'ended') fail(404, 'No room with that code.');
    const role = roleOf(m, user.id);
    if (role) return { code: m.code, role };
    if (m.guest_id) fail(409, 'That room is full.');
    if (blockedEitherWay(user.id, m.host_id)) fail(404, 'No room with that code.');
    q('UPDATE matches SET guest_id = ? WHERE id = ? AND guest_id IS NULL').run(user.id, m.id);
    return { code: m.code, role: 'guest' };
  });

  route('GET', '/api/matches', ({ user }) => {
    const rows = q("SELECT * FROM matches WHERE status = 'mutual' AND (host_id = ? OR guest_id = ?) ORDER BY id DESC").all(user.id, user.id);
    return { matches: rows.map(m => {
      const them = loadProfile(otherId(m, user.id));
      if (!them) return null;
      const last = q('SELECT body, sender_id, created_at FROM messages WHERE match_id = ? ORDER BY id DESC LIMIT 1').get(m.id);
      return { code: m.code, chem: m.chem, starters: JSON.parse(m.starters || '[]'), ai: !!ask, created_at: m.created_at,
        partner: { name: them.name, age: them.age, city: them.city, song: them.song, bio: them.bio, sk: them.sk, hr: them.hr, bg: them.bg, hs: them.hs },
        last: last && { body: last.body, mine: last.sender_id === user.id, at: last.created_at } };
    }).filter(Boolean) };
  });

  route('POST', '/api/matches/:code/questions', async ({ user, params }) => {
    const m = myMatch(params.code, user.id);
    if (m.status !== 'mutual') fail(403, 'Questions open after a mutual yes.');
    if (!ask) fail(404, 'AI questions are not switched on.');
    if (!shuffleLimit(m.code)) fail(429, "That's all the new questions for today. Ask one of these!");
    const qs = await aiQuestions(m.code, JSON.parse(m.starters || '[]'));
    if (!qs) fail(503, "Couldn't think of new questions right now. Try again in a bit.");
    return { questions: qs };
  });

  route('GET', '/api/matches/:code/messages', ({ user, params, url }) => {
    const m = myMatch(params.code, user.id);
    if (m.status !== 'mutual') fail(403, 'Chat opens after a mutual yes.');
    const after = Math.max(0, parseInt(url.searchParams.get('after'), 10) || 0);
    const rows = q('SELECT id, sender_id, body, created_at FROM messages WHERE match_id = ? AND id > ? ORDER BY id LIMIT 200').all(m.id, after);
    return { messages: rows.map(r => ({ id: r.id, mine: r.sender_id === user.id, body: r.body, at: r.created_at })) };
  });
  route('POST', '/api/matches/:code/messages', ({ user, params, b }) => {
    const m = myMatch(params.code, user.id);
    if (m.status !== 'mutual') fail(403, 'Chat opens after a mutual yes.');
    if (!chatLimit(user.id)) fail(429, 'You are sending messages very fast. Take a breath.');
    const text = str(b.body, 1000);
    if (!text) fail(400, 'Write something first.');
    const body = mask(text);
    const { lastInsertRowid: id } = q('INSERT INTO messages (match_id, sender_id, body, created_at) VALUES (?, ?, ?, ?)').run(m.id, user.id, body, now());
    const message = { id: Number(id), body, at: now() };
    push(user.id, { t: 'msg', code: m.code, message: { ...message, mine: true } });
    push(otherId(m, user.id), { t: 'msg', code: m.code, message: { ...message, mine: false } });
    return { message: { ...message, mine: true } };
  });

  route('POST', '/api/matches/:code/unmatch', ({ user, params }) => { endMatch(myMatch(params.code, user.id), user.id, 'unmatched'); return { ok: true }; });
  route('POST', '/api/matches/:code/block', ({ user, params }) => {
    const m = myMatch(params.code, user.id), other = otherId(m, user.id);
    if (other) q('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)').run(user.id, other, now());
    endMatch(m, user.id, 'ended');
    return { ok: true };
  });
  route('POST', '/api/matches/:code/report', ({ user, params, b }) => {
    const m = myMatch(params.code, user.id), other = otherId(m, user.id);
    if (!other) fail(400, 'Nobody to report yet.');
    if (!REPORT_REASONS.includes(b.reason)) fail(400, 'Choose a reason.');
    q('INSERT INTO reports (reporter_id, reported_id, match_id, reason, details, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(user.id, other, m.id, b.reason, str(b.details, 1000), now());
    q('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)').run(user.id, other, now());
    endMatch(m, user.id, 'ended');
    return { ok: true };
  });

  const securityHeaders = {
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    ...(production ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
  };

  async function serveStatic(url, res) {
    const isPublic = rel => PUBLIC.some(p => p.endsWith('/') ? rel.startsWith(p) : rel === p);
    let rel;
    try { rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'; } catch { fail(400, 'Bad path.'); }
    if (!isPublic(rel)) rel = 'index.html';                                   // app shell for unknown paths
    // Re-check AFTER resolving, so "js/%2e%2e/data/blind-pitch.db" can't escape the public folders.
    const file = path.resolve(ROOT, rel);
    if (!isPublic(path.relative(ROOT, file).split(path.sep).join('/'))) fail(404, 'Not found.');
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': rel === 'index.html' ? 'no-cache' : 'public, max-age=300' });
      res.end(data);
    } catch { fail(404, 'Not found.'); }
  }

  const server = http.createServer(async (req, res) => {
    for (const [k, v] of Object.entries(securityHeaders)) res.setHeader(k, v);
    const url = new URL(req.url, 'http://x');
    try {
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') fail(405, 'Method not allowed.');
        return await serveStatic(url, res);
      }
      const r = routes.find(r => r.method === req.method && r.re.test(url.pathname));
      if (!r) fail(404, 'Not found.');
      if (req.method !== 'GET') {
        // CSRF: cross-site requests can't send JSON without a preflight, and we never allow one.
        if (!sameOrigin(req) || !String(req.headers['content-type'] || '').startsWith('application/json')) fail(403, 'Blocked request.');
      }
      const user = userFromCookie(req.headers.cookie);
      if (r.auth && !user) fail(401, 'Please log in.');
      if (user && !apiLimit(user.id)) fail(429, 'Too many requests.');
      const b = req.method === 'GET' ? {} : await body(req);
      const result = await r.handler({ req, res, url, user, b, params: url.pathname.match(r.re).groups || {} });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(result));
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: status === 500 ? 'Something went wrong.' : e.message }));
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 8192 });
  server.on('upgrade', (req, socket, head) => {
    const user = new URL(req.url, 'http://x').pathname === '/ws' && sameOrigin(req) && userFromCookie(req.headers.cookie);
    if (!user) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => {
      ws.user = user; ws.room = null; ws.limit = rateLimiter(60, 10_000); ws.alive = true;
      if (!conns.has(user.id)) conns.set(user.id, new Set());
      conns.get(user.id).add(ws);
      ws.on('message', d => { try { onSocketMessage(ws, d.toString()); } catch (e) { console.error(e); } });
      ws.on('pong', () => { ws.alive = true; });
      ws.on('close', () => { leaveRoom(ws); conns.get(user.id)?.delete(ws); if (!conns.get(user.id)?.size) conns.delete(user.id); });
    });
  });
  // Drop dead connections so "partner offline" shows up within ~30s even without a clean close.
  const heartbeat = setInterval(() => { for (const ws of wss.clients) { if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); } } }, 15_000);
  heartbeat.unref();

  return {
    server, db,
    listen: (port = 0) => new Promise(r => server.listen(port, () => r(server.address().port))),
    close: () => new Promise(r => { closing = true; clearInterval(heartbeat); for (const ws of wss.clients) ws.terminate(); server.close(() => { db.close(); r(); }); }),
  };
}
