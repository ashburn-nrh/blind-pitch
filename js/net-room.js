/*
 * Live rooms over the Blind Pitch server's WebSocket, with the same small API as
 * local-room.js and claude.ai rooms, so session.js doesn't care which one it uses:
 *
 *   room.join(name) -> { presence(p), peers(), onPeers(fn), onConnection(fn), leave() }
 *
 * The server stores my presence and sends back a FILTERED view of my partner (only what
 * I've earned so far). One socket per page; it reconnects with backoff and re-joins the
 * current room, re-sending my last presence. Other server pushes (matched, mutual, ended,
 * msg) go to onServerEvent listeners.
 */
let ws = null, open = false, retry = 0, current = null, stopped = false;
const listeners = new Map();
const connHandlers = new Set();

export function onServerEvent(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => listeners.get(type).delete(fn);
}

function send(m) { if (open) ws.send(JSON.stringify(m)); }

function connect() {
  if (stopped) return;
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  ws.onopen = () => {
    open = true; retry = 0;
    connHandlers.forEach(f => f(true));
    if (current) { current.joined = false; send({ t: 'join', code: current.code }); }
  };
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } handle(m); };
  ws.onclose = () => {
    const was = open; open = false; ws = null;
    if (was) connHandlers.forEach(f => f(false));
    if (current) { current.peers = current.peers.filter(p => p.sameTab); current.fire(); }
    if (!stopped) setTimeout(connect, Math.min(10_000, 500 * 2 ** retry++));
  };
}

function handle(m) {
  const c = current;
  if (m.t === 'joined' && c && c.code === m.code) {
    c.joined = true;
    if (c.last) send({ t: 'presence', p: c.last });
    if (c.resolve) { c.resolve(); c.resolve = c.reject = null; }
    return;
  }
  if (m.t === 'peers' && c) { c.peers = m.peers; c.fire(); return; }
  if (m.t === 'error' && c?.reject) { c.reject(new Error(m.error)); c.resolve = c.reject = null; current = null; return; }
  (listeners.get(m.t) || []).forEach(f => f(m));
}

export function startNet() { stopped = false; if (!ws) connect(); }
export function stopNet() { stopped = true; current = null; if (ws) { ws.onclose = null; ws.close(); ws = null; open = false; } }

export const netRoom = {
  join(name) {
    const code = String(name).replace(/^bp-/, '').toUpperCase();
    const handlers = [], mine = new Set();
    const c = current = { code, peers: [], last: null, joined: false, fire() { handlers.forEach(h => h({ peers: c.peers })); } };
    startNet();
    return new Promise((resolve, reject) => {
      const room = {
        presence(p) { c.last = p; if (c.joined) send({ t: 'presence', p }); return Promise.resolve(); },
        peers: () => c.peers.slice(),
        onPeers(fn) { handlers.push(fn); setTimeout(() => fn({ peers: c.peers })); return () => {}; },
        onConnection(fn) { connHandlers.add(fn); mine.add(fn); setTimeout(() => fn(open)); return () => connHandlers.delete(fn); },
        leave() {
          mine.forEach(f => connHandlers.delete(f));
          if (current === c) { send({ t: 'leave' }); current = null; }
          return Promise.resolve();
        },
      };
      c.resolve = () => resolve(room); c.reject = reject;
      if (open) send({ t: 'join', code });
      setTimeout(() => { if (c.reject) { c.reject(new Error('Could not reach the game server.')); c.resolve = c.reject = null; if (current === c) current = null; } }, 10_000);
    });
  },
};
