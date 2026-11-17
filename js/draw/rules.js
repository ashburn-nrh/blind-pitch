/* Draw & Guess rules: word list, seeded word choice, guess checking and points. Pure, no DOM. */
import { sshuffle, rng, hash } from '../util.js';
import { BOT_DRAWINGS } from './bot-drawings.js';

export const DRAW_SECS = 45;      // time per drawing
export const GUESS_GRACE = 4;     // guesser waits this long past 45s for the drawer's "time" before calling it
export const MAX_GUESSES = 3;
export const DRAWINGS = 2;        // drawing 0: host draws. drawing 1: guest draws.

/* Friendly, date-night words. Nothing sensitive or suggestive. */
export const DRAW_WORDS = [
  'coffee','picnic','karaoke','sunset','guitar','umbrella','pizza','dog','bicycle','popcorn',
  'balloon','cupcake','rainbow','camera','kite','sailboat','cat','flower','moon','butterfly',
  'sandwich','headphones','snowman','pancake','banana','candle','telescope','lantern','bridge','rocket',
  'sunglasses','piano','taco','donut','mountain','beach','teapot','skateboard','pineapple','campfire',
];

/**
 * The two secret words, from the same room-code seeded shuffle the memory board uses.
 * Both pages compute the same pair, so the word is never sent over the wire.
 * (Trade-off: anyone who reads the code could work it out. See README "Known limits".)
 * In practice mode the second drawing is swapped to one the bot has a drawing for.
 */
export function drawWords(code, bot = false) {
  const list = sshuffle(DRAW_WORDS, rng(hash(code + ':draw')));
  if (bot && !BOT_DRAWINGS[list[1]]) {
    const j = list.findIndex((w, i) => i !== 1 && BOT_DRAWINGS[w]);
    [list[1], list[j]] = [list[j], list[1]];
  }
  return [list[0], list[1]];
}

/** Speed bonus: +8 for a correct guess, plus up to +4 for guessing fast. secs = time of the correct guess. */
export function drawPoints(secs) {
  const t = Math.min(Math.max(+secs || 0, 0), DRAW_SECS);
  return 8 + Math.round(4 * (1 - t / DRAW_SECS));
}

/* ---- guess checking ---- */
function normalise(s) {
  return String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/^\s*(a|an|the)\s+/, '')       // "a dog", "the moon"
    .replace(/[^a-z0-9]/g, '');             // punctuation and spaces
}

/** True if a and b are equal or differ by one substitution, insertion, deletion or adjacent swap. */
function withinOneEdit(a, b) {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === lb) {
    let i = 0; while (i < la && a[i] === b[i]) i++;
    if (a.slice(i + 1) === b.slice(i + 1)) return true;                                  // substitution
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);  // swap
  }
  const [s, l] = la < lb ? [a, b] : [b, a];
  let i = 0; while (i < s.length && s[i] === l[i]) i++;
  return s.slice(i) === l.slice(i + 1);                                                  // insertion/deletion
}

/** Lowercase, ignore punctuation, accept the plural, allow one typo for words of 5+ letters. */
export function checkGuess(guess, word) {
  const g = normalise(guess), w = normalise(word);
  if (!g || !w) return false;
  const forms = [w, w + 's', w + 'es'];
  if (w.endsWith('y')) forms.push(w.slice(0, -1) + 'ies');
  if (forms.includes(g)) return true;
  return w.length >= 5 && forms.some(f => withinOneEdit(g, f));
}
