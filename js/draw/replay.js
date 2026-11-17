/*
 * Derive the whole Draw & Guess round from both players' `draw` presence fields,
 * the same way scoring.replay() rebuilds the memory board from both flip lists.
 *
 * Each player publishes ONE small object:
 *
 *   draw = { s, e, g, t, x }
 *     s : my drawing (codec string). I draw exactly one of the two drawings.
 *     e : how my drawing ended, as decided by me, the drawer: 0 running, 1 tapped Done, 2 time ran out.
 *     g : my guesses (max 3) on the drawing I guess.
 *     t : seconds into that drawing when each guess was made (same length as g).
 *     x : 1 if, as the guesser, my clock passed 45s + grace and the drawer still hadn't
 *         ended it (covers a drawer whose tab stalled). 0 otherwise.
 *
 * Drawing 0: host draws, guest guesses. Drawing 1: guest draws, host guesses.
 * Because a player is drawer in one drawing and guesser in the other, each field has
 * exactly one meaning per player, and nothing has to be indexed by drawing.
 * Everything below is a pure function of (my draw, partner's draw, room code), so both
 * pages compute identical results, and a refresh or reconnect just recomputes.
 */
import { L, P, blankDraw } from '../state.js';
import { drawWords, checkGuess, drawPoints, MAX_GUESSES, DRAWINGS } from './rules.js';

export function drawReplay() {
  const p = P();
  const mine = L.draw || blankDraw(), theirs = p?.draw || blankDraw();
  const H = L.role === 'host' ? mine : theirs;
  const G = L.role === 'guest' ? mine : theirs;
  const words = drawWords(L.code, !!L.bot);

  const items = Array.from({ length: DRAWINGS }, (_, d) => {
    const drawer = d === 0 ? H : G, guesser = d === 0 ? G : H;
    const guesses = guesser.g.slice(0, MAX_GUESSES);
    const times = guesser.t.slice(0, MAX_GUESSES);
    const idx = guesses.findIndex(g => checkGuess(g, words[d]));
    const correct = idx >= 0;
    const reason = correct ? 'correct'
      : guesses.length >= MAX_GUESSES ? 'guesses'
      : drawer.e === 1 ? 'done'
      : drawer.e === 2 || guesser.x === 1 ? 'time'
      : null;
    return {
      word: words[d], s: drawer.s, guesses, times, idx, correct,
      over: reason !== null, reason,
      secs: correct ? times[idx] : null,
      pts: correct ? drawPoints(times[idx]) : 0,
    };
  });

  const cur = items.findIndex(it => !it.over);
  return {
    items,
    cur: cur === -1 ? DRAWINGS : cur,          // index of the drawing in play; DRAWINGS = all done
    done: cur === -1,
    hits: items.filter(it => it.correct).length,
    pts: items.reduce((n, it) => n + it.pts, 0),
  };
}
