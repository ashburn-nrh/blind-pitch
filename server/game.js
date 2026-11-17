/*
 * Server-side view of a game. The server runs the SAME scoring modules the browser uses
 * (js/scoring.js, js/draw/replay.js), then decides what each player is allowed to see of the
 * other. Nothing a player hasn't earned is ever sent to their browser:
 *
 *   name+age / city / song / bio   only once chemistry reaches 12 / 30 / 50 / 70
 *   their this-or-that pick        only for questions I have answered
 *   their "about me" answer        only for questions I have guessed
 *   their second-date answer       only after I have given mine
 *   contact details in any text    only after a mutual yes
 *   everything                     once all four rounds are really finished
 *
 * Profiles come from the database, not from the presence a browser sends, so nobody can
 * change their card mid-game. The shared modules read module-level state (setGame/setLive);
 * that is safe here because every call below is synchronous and resets it before returning.
 */
import { setGame, setLive, newGame } from '../js/state.js';
import { score, replay } from '../js/scoring.js';
import { drawReplay } from '../js/draw/replay.js';
import { drawWords, checkGuess } from '../js/draw/rules.js';
import { QS, SELFQ, SLOTS } from '../js/data.js';
import { stripContact, mask } from './moderation.js';

const card = p => ({ name: p.name, age: p.age, city: p.city, song: p.song, bio: p.bio, sk: p.sk, hr: p.hr, bg: p.bg, hs: p.hs, self: p.self.slice(), ready: true });
const [AT_NAME, AT_CITY, AT_SONG, AT_BIO] = SLOTS.map(s => s.at);

/** Chemistry and completion as seen from `role`'s side (chemistry is the same from both). */
function compute(code, role, me, meProf, them, themProf) {
  setGame({ ...newGame(code, role), ...(me || {}), code, role, bot: false, prof: card(meProf) });
  setLive({ ...them, prof: card(themProf) });
  try {
    const dr = drawReplay();
    const answered = a => Array.isArray(a) && a.every(x => x != null);
    return {
      chem: score().chem,
      done: !!me && replay().done && dr.done && answered(me.r1) && answered(me.r3),
      words: dr.items.map(i => i.word),
    };
  } finally { setGame(null); setLive(null); }
}

/**
 * Moves are final. A new presence may add answers, flips and guesses, but never change or
 * remove ones the server has already seen; otherwise a player could answer, see the reveal,
 * then switch their answer. Strokes stay editable (undo/clear) until the drawing has ended.
 */
const isPrefix = (a, b) => b.length >= a.length && a.every((v, i) => v === b[i]);
export function mergePresence(prev, next) {
  if (!prev) return next;
  const keep = (a, b) => a.map((v, i) => v != null ? v : b[i]);
  const d0 = prev.draw, d1 = next.draw;
  const guessesOk = isPrefix(d0.g, d1.g) && isPrefix(d0.t, d1.t);
  return {
    ...next,
    at: Math.max(prev.at, next.at),
    prof: { ...next.prof, ready: prev.prof.ready || next.prof.ready },
    r1: keep(prev.r1, next.r1), r3: keep(prev.r3, next.r3),
    flips: isPrefix(prev.flips, next.flips) ? next.flips : prev.flips,
    date: prev.date || next.date,
    msg: next.msg.n >= prev.msg.n ? next.msg : prev.msg,
    draw: {
      s: d0.e ? d0.s : d1.s, e: d0.e || d1.e,
      g: guessesOk ? d1.g : d0.g, t: guessesOk ? d1.t : d0.t, x: d0.x || d1.x,
    },
  };
}

/** What `role` may see of their partner right now. me/them are cleaned presences (or null). */
export function partnerView({ code, role, me, meProf, them, themProf, mutual }) {
  if (!them || !meProf || !themProf) return null;
  const { chem, done, words } = compute(code, role, me, meProf, them, themProf);
  const text = s => mask(mutual ? s : stripContact(s));
  const open = at => done || chem >= at;
  const theirWord = words[role === 'host' ? 0 : 1];      // the word THEY are guessing (I drew it)
  return {
    v: 1, role: them.role, at: them.at, sv: chem,
    prof: {
      name: open(AT_NAME) ? text(themProf.name) : '', age: open(AT_NAME) ? themProf.age : 0,
      city: open(AT_CITY) ? text(themProf.city) : '', song: open(AT_SONG) ? text(themProf.song) : '', bio: open(AT_BIO) ? text(themProf.bio) : '',
      sk: themProf.sk, hr: themProf.hr, bg: themProf.bg, hs: themProf.hs,
      self: themProf.self.map((v, i) => done || me?.r3?.[i] != null ? v : null),
      ready: them.prof.ready === true,
    },
    r1: them.r1.map((v, i) => me?.r1?.[i] != null ? v : null),
    r3: them.r3, flips: them.flips,
    // A correct guess is passed through untouched so both sides agree it was correct.
    draw: { ...them.draw, g: them.draw.g.map(g => checkGuess(g, theirWord) ? g : text(g)) },
    date: me?.date ? them.date : null,
    msg: { n: them.msg.n, text: text(them.msg.text) },
  };
}

/** Has the game reached a result? -> { status:'mutual', chem, starters } | { status:'declined' } | null */
export function outcome({ code, host, hostProf, guest, guestProf }) {
  if (!host || !guest || !hostProf || !guestProf || !host.date || !guest.date) return null;
  if (host.date !== 'yes' || guest.date !== 'yes') return { status: 'declined' };
  const a = compute(code, 'host', host, hostProf, guest, guestProf);
  const b = compute(code, 'guest', guest, guestProf, host, hostProf);
  if (!a.done || !b.done) return null;                   // a "yes" only counts once the game is really over
  return { status: 'mutual', chem: a.chem, starters: starters(code, host, guest, hostProf, guestProf) };
}

/**
 * What the AI is told about a finished game. Only facts picked from fixed lists: no names, ages,
 * cities, songs, bios or chat text ever leave the server, and nothing a player typed can reach
 * the prompt (so nobody can inject instructions through their card).
 */
export function gameFacts({ code, host, guest, hostProf, guestProf }) {
  setGame({ ...newGame(code, 'host'), ...host, code, role: 'host', bot: false, prof: card(hostProf) });
  setLive({ ...guest, prof: card(guestProf) });
  try {
    const s = score(), dr = drawReplay();
    const both = [], split = [];
    QS.forEach((q, i) => {
      const a = host.r1[i], b = guest.r1[i];
      if (a == null || b == null) return;
      if (a === b) both.push(q[a]); else split.push({ A: q[a], B: q[b] });
    });
    const about = p => SELFQ.map((q, i) => ({ q: q.me, answer: q.opts[p.self[i]] }));
    return {
      chemistry: s.chem,
      bothPicked: both,
      differentPicks: split,
      personA: about(hostProf),
      personB: about(guestProf),
      readEachOtherRight: s.mine + s.theirs,                 // out of 6
      drawings: dr.items.map((it, d) => ({ drewIt: d === 0 ? 'A' : 'B', word: it.word, guessed: it.correct })),
      memoryTurns: s.mem,
    };
  } finally { setGame(null); setLive(null); }
}

/** Conversation openers taken from what actually happened in the game. */
export function starters(code, host, guest, hostProf, guestProf) {
  const picks = [];
  for (let i = 0; i < QS.length; i++) if (host.r1[i] != null && host.r1[i] === guest.r1[i]) picks.push(`We both picked “${QS[i][host.r1[i]]}”. What's the story there?`);
  const [w0, w1] = drawWords(code);
  return [...picks.slice(0, 2), `${hostProf.name} drew “${w0}” and ${guestProf.name} drew “${w1}”. Whose was better?`, 'So… where are we going for the second date?'];
}
