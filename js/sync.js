/* Persistence and room sync: saving my state, publishing presence, reading the partner's. */
import { clip, store } from './util.js';
import { R, L, live, isBot, setLive } from './state.js';
import { sanitize, undoLast, INK_MAX } from './draw/codec.js';
import { MAX_GUESSES, DRAW_SECS } from './draw/rules.js';

/*
 * Size limits. The room rejects a presence object over 4 KiB of JSON, so we publish
 * comfortably below that. Draw & Guess gets its own budget: INK_MAX characters of strokes
 * plus 3 short guesses comes to ~1.55 KB, under the 1.6 KB DRAW_MAX. The ink meter in the
 * UI stops the drawer before these guards ever need to trim anything.
 */
export const PRESENCE_LIMIT = 4096;
export const PRESENCE_SAFE = 3900;
export const DRAW_MAX = 1600;
const GUESS_LEN = 24;

const enc = new TextEncoder();
export const jsonBytes = v => enc.encode(JSON.stringify(v)).length;

export const gkey = (code, role) => `bp:${code}:${role}`;

export function save(){ if (L && !L.bot) { store.set(gkey(L.code,L.role), L); store.set('bp:last', {code:L.code, role:L.role}); } }

/** My presence object exactly as it will be published (also used by tests to measure size). */
export function buildPresence(){
  const pr = L.prof, d = L.draw;
  const draw = { s:d.s, e:d.e, g:d.g.slice(0,MAX_GUESSES).map(x=>clip(x,GUESS_LEN)), t:d.t.slice(0,MAX_GUESSES), x:d.x };
  const obj = { v:1, role:L.role, at:L.at,
    prof:{ name:clip(pr.name,24), age:+pr.age||0, city:clip(pr.city,40), song:clip(pr.song,60), bio:clip(pr.bio,160), sk:pr.sk, hr:pr.hr, bg:pr.bg, hs:pr.hs, self:pr.self, ready:pr.ready },
    r1:L.r1, flips:L.flips.slice(0,80), r3:L.r3, date:L.date, msg:{ n:L.msg.n, text:clip(L.msg.text,200) }, draw };
  // Guards. These should never fire because the ink meter stops drawing first; if they do,
  // drop trailing strokes rather than let the whole presence update be rejected.
  let trimmed = false;
  while (draw.s && (jsonBytes(draw) > DRAW_MAX || jsonBytes(obj) > PRESENCE_SAFE)) { draw.s = undoLast(draw.s); trimmed = true; }
  if (trimmed) console.warn('[blind-pitch] presence over budget, trimmed strokes to', jsonBytes(obj), 'bytes');
  return obj;
}
export const presenceBytes = () => jsonBytes(buildPresence());

export function pushPresence(){
  save();
  if (!R || isBot()) return;
  R.presence(buildPresence()).catch(()=>{});
}

/* ---- validate untrusted partner data ---- */
const int = (v, lo, hi, dflt) => Number.isInteger(v) ? Math.max(lo, Math.min(hi, v)) : dflt;

function cleanDraw(d){
  d = d && typeof d === 'object' ? d : {};
  // Bound the work before decoding, then re-encode so only HEAD/ALPHA characters survive,
  // the stroke count is capped and the result fits INK_MAX.
  const s = typeof d.s === 'string' ? sanitize(d.s.slice(0, INK_MAX * 2)) : '';
  const g = Array.isArray(d.g) ? d.g.slice(0, MAX_GUESSES).map(x => clip(typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f]/g,'') : '', GUESS_LEN)) : [];
  const t = g.map((_, i) => int(Array.isArray(d.t) ? d.t[i] : null, 0, DRAW_SECS, DRAW_SECS));
  return { s, e: d.e === 1 || d.e === 2 ? d.e : 0, g, t, x: d.x === 1 ? 1 : 0 };
}

export function cleanP(p){
  if (!p || typeof p !== 'object') return null;
  const pr = p.prof && typeof p.prof === 'object' ? p.prof : {};
  const idx = (v,n) => Number.isInteger(v) && v>=0 && v<n ? v : 0;
  const arr = (a,n,max) => Array.from({length:n}, (_,i) => Array.isArray(a) && Number.isInteger(a[i]) && a[i]>=0 && a[i]<max ? a[i] : null);
  return {
    role: p.role === 'host' ? 'host' : 'guest',
    at: int(p.at, 0, 9, 0),
    prof: { name:clip(pr.name,24) || 'Someone', age: Number.isInteger(pr.age) ? pr.age : '', city:clip(pr.city,40), song:clip(pr.song,60), bio:clip(pr.bio,160),
            sk:idx(pr.sk,4), hr:idx(pr.hr,4), bg:idx(pr.bg,4), hs:idx(pr.hs,2), self:arr(pr.self,3,3), ready: pr.ready === true },
    r1: arr(p.r1,6,2), r3: arr(p.r3,3,3),
    flips: Array.isArray(p.flips) ? p.flips.filter(x=>Number.isInteger(x) && x>=0 && x<16).slice(0,80) : [],
    date: p.date === 'yes' || p.date === 'no' ? p.date : null,
    msg: p.msg && Number.isInteger(p.msg.n) ? { n:p.msg.n, text:clip(p.msg.text,200) } : { n:0, text:'' },
    draw: cleanDraw(p.draw),
  };
}

export function findPartner(){
  if (!R) return;
  const peer = R.peers().find(p => !p.sameTab && p.presence && p.presence.v===1 && (p.presence.role==='host'||p.presence.role==='guest') && p.presence.role!==L.role);
  setLive(peer ? cleanP(peer.presence) : null);
  if (live){ L.lastP = live; save(); }
}
