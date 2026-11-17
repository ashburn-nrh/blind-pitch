/*
 * Pre-made vector drawings the practice bot "draws", stroke by stroke.
 * Coordinates are on the same 64 x 64 grid the real strokes use, so they go through the
 * normal codec and render exactly like a human drawing. Colour indexes: 0 ink, 1 pink, 2 blue, 3 green.
 */
import { simplify } from './codec.js';

const rad = d => d * Math.PI / 180;
const cell = n => Math.max(0, Math.min(63, Math.round(n)));
const arc = (cx, cy, r, a0, a1, n = 12) => Array.from({ length: n + 1 }, (_, i) => {
  const a = rad(a0 + (a1 - a0) * i / n);
  return [cell(cx + r * Math.cos(a)), cell(cy + r * Math.sin(a))];
});
const ellipse = (cx, cy, rx, ry, n = 16) => arc(cx, cy, 1, 0, 360, n).map((_, i) => {
  const a = rad(360 * i / n);
  return [cell(cx + rx * Math.cos(a)), cell(cy + ry * Math.sin(a))];
});
const S = (c, sz, pts) => ({ c, sz, pts: simplify(pts) });

const petals = [0, 72, 144, 216, 288].map(a =>
  S(1, 0, ellipse(32 + 12 * Math.cos(rad(a - 90)), 24 + 12 * Math.sin(rad(a - 90)), 7, 7, 10)));

export const BOT_DRAWINGS = {
  moon: [
    S(0, 1, arc(30, 32, 20, 60, 300, 16)),
    S(0, 1, arc(38, 32, 17.4, 276.6, 83.4, 14)),
    S(3, 0, [[50, 14]]), S(3, 0, [[55, 28]]), S(3, 0, [[49, 46]]),
  ],
  kite: [
    S(1, 1, [[32, 6], [48, 26], [32, 50], [16, 26], [32, 6]]),
    S(0, 0, [[32, 6], [32, 50]]),
    S(0, 0, [[16, 26], [48, 26]]),
    S(2, 0, [[32, 50], [27, 54], [34, 57], [28, 61]]),
  ],
  flower: [
    ...petals,
    S(0, 1, ellipse(32, 24, 4, 4, 8)),
    S(3, 1, [[32, 32], [32, 60]]),
    S(3, 0, [[32, 48], [40, 42], [44, 46], [34, 52]]),
  ],
  umbrella: [
    S(1, 1, arc(32, 30, 22, 180, 360, 16)),
    S(1, 0, arc(17.3, 30, 7.3, 180, 0, 6)),
    S(1, 0, arc(32, 30, 7.3, 180, 0, 6)),
    S(1, 0, arc(46.7, 30, 7.3, 180, 0, 6)),
    S(0, 1, [[32, 30], [32, 52]]),
    S(0, 1, arc(28, 52, 4, 0, 180, 6)),
  ],
  pizza: [
    S(1, 1, [[10, 14], [32, 58], [54, 14]]),
    S(0, 1, [[10, 14], [20, 10], [32, 8], [44, 10], [54, 14]]),
    S(1, 0, ellipse(28, 26, 4, 4, 8)),
    S(1, 0, ellipse(38, 32, 4, 4, 8)),
    S(1, 0, ellipse(30, 42, 3, 3, 8)),
  ],
  balloon: [
    S(1, 1, ellipse(32, 24, 14, 18, 20)),
    S(1, 0, [[32, 42], [28, 48], [36, 48], [32, 42]]),
    S(0, 0, [[32, 48], [29, 52], [35, 56], [30, 60], [33, 63]]),
  ],
  sailboat: [
    S(0, 1, [[10, 42], [54, 42], [46, 54], [18, 54], [10, 42]]),
    S(0, 1, [[30, 42], [30, 8]]),
    S(2, 1, [[32, 10], [48, 38], [32, 38], [32, 10]]),
    S(2, 0, [[28, 14], [16, 38], [28, 38]]),
    S(2, 0, [[4, 60], [10, 57], [16, 60], [22, 57], [28, 60], [34, 57], [40, 60], [46, 57], [52, 60], [58, 57]]),
  ],
  cupcake: [
    S(2, 1, [[18, 36], [46, 36], [42, 58], [22, 58], [18, 36]]),
    S(2, 0, [[26, 38], [27, 56]]),
    S(2, 0, [[32, 38], [32, 56]]),
    S(2, 0, [[38, 38], [37, 56]]),
    S(1, 1, [[16, 36], [17, 28], [22, 22], [28, 18], [34, 18], [40, 22], [46, 28], [48, 36]]),
    S(1, 1, ellipse(32, 12, 3, 3, 8)),
  ],
};
