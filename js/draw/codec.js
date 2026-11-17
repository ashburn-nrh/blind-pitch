/*
 * Compact stroke codec for Draw & Guess. Pure functions, no DOM, so it is safe to
 * run on untrusted partner data and easy to unit-test.
 *
 * A drawing is ONE string. Each stroke is:
 *
 *     <head><x><y><x><y>...
 *
 *  - head : one character from HEAD, = colourIndex * 2 + sizeIndex (4 colours x 2 sizes).
 *  - x, y : one character each from ALPHA (64 chars = a 64 x 64 grid, 6 bits per axis).
 *
 * HEAD and ALPHA share no characters, so stroke boundaries are unambiguous without
 * delimiters or lengths. Every character is JSON-safe (nothing to escape), so the
 * string costs exactly its length in the presence object.
 */
export const GRID = 64;
export const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export const HEAD = '!#$%&*+.';
export const COLOURS = 4;
export const SIZES = 2;

/* "Ink": the size limit presented as a game mechanic. 1 ink = 1 character of the string. */
export const INK_MAX = 1400;
export const MAX_STROKES = 60;

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

/** Normalised 0..1 coordinate -> grid cell 0..63. */
export const snap = n => clamp(Math.floor(n * GRID), 0, GRID - 1);

/**
 * Shrink a point list before encoding:
 *  - drop a point that lands in the same cell as the previous one (closer than 1 cell);
 *  - drop a point that sits on a straight line between its neighbours, since the
 *    renderer joins the remaining points with curves anyway.
 */
export function simplify(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && q[0] === p[0] && q[1] === p[1]) continue;
    while (out.length >= 2) {
      const a = out[out.length - 2], b = out[out.length - 1];
      const cross = (b[0] - a[0]) * (p[1] - b[1]) - (b[1] - a[1]) * (p[0] - b[0]);
      const dot = (b[0] - a[0]) * (p[0] - b[0]) + (b[1] - a[1]) * (p[1] - b[1]);
      if (cross === 0 && dot > 0) out.pop(); else break;
    }
    out.push(p);
  }
  return out;
}

/** {c, sz, pts:[[x,y]...]} -> string. Returns '' for an empty stroke. */
export function encodeStroke(st) {
  const pts = simplify(st.pts || []);
  if (!pts.length) return '';
  const head = HEAD[clamp(st.c | 0, 0, COLOURS - 1) * 2 + clamp(st.sz | 0, 0, SIZES - 1)];
  return head + pts.map(([x, y]) => ALPHA[clamp(x | 0, 0, GRID - 1)] + ALPHA[clamp(y | 0, 0, GRID - 1)]).join('');
}

/**
 * String -> strokes. Strict about its input: characters outside HEAD/ALPHA are skipped,
 * a dangling half coordinate is dropped, empty strokes are dropped and the stroke count
 * is capped. This is what makes partner data safe to render.
 */
export function decode(s, maxStrokes = MAX_STROKES) {
  const out = [];
  let cur = null, pending = -1;
  for (const ch of String(s ?? '')) {
    const h = HEAD.indexOf(ch);
    if (h >= 0) {
      if (out.length >= maxStrokes) break;
      cur = { c: h >> 1, sz: h & 1, pts: [] };
      out.push(cur); pending = -1;
      continue;
    }
    const v = ALPHA.indexOf(ch);
    if (v < 0 || !cur) continue;
    if (pending < 0) pending = v; else { cur.pts.push([pending, v]); pending = -1; }
  }
  return out.filter(st => st.pts.length);
}

/** Re-encode untrusted input into canonical form, never longer than INK_MAX. */
export function sanitize(s) {
  let out = '';
  for (const st of decode(s)) {
    const e = encodeStroke(st);
    if (out.length + e.length > INK_MAX) break;
    out += e;
  }
  return out;
}

export function strokeCount(s) {
  let n = 0;
  for (const ch of s) if (HEAD.includes(ch)) n++;
  return n;
}

/** Remove the last stroke (gives its ink back). Works because coordinates never contain HEAD chars. */
export function undoLast(s) {
  let i = -1;
  for (const h of HEAD) i = Math.max(i, s.lastIndexOf(h));
  return i < 0 ? '' : s.slice(0, i);
}

/** 0..1 share of ink still available (limited by characters and by stroke count). */
export const inkLeft = s => Math.max(0, 1 - Math.max(s.length / INK_MAX, strokeCount(s) / MAX_STROKES));
/** Room for at least a header plus one point? */
export const canStart = s => strokeCount(s) < MAX_STROKES && INK_MAX - s.length >= 3;
