/*
 * Round 3: Draw & Guess.
 *
 * Two drawings: the host draws first while the guest guesses, then they swap.
 * The round's state is derived from both presences by draw/replay.js; this file only renders
 * it and writes MY half (L.draw) when I draw, guess or hit Done.
 *
 * Timing is the one thing presence can't derive. Each page counts its own seconds for the
 * current drawing (L.dl.el, saved locally so a refresh resumes) and only while the partner is
 * online and in this round, so going offline pauses the clock on both sides. The DRAWER's
 * page is authoritative: when its clock hits 45s it publishes e=2. If the guesser's clock
 * runs GUESS_GRACE seconds past that with no word from the drawer, it publishes x=1 so the
 * round can't stall on a frozen tab.
 */
import { $, $$, clip, esc } from '../util.js';
import { L, B, P, ui, isBot, partnerOnline } from '../state.js';
import { save, pushPresence } from '../sync.js';
import { render } from '../router.js';
import { drawReplay } from '../draw/replay.js';
import { DRAW_SECS, GUESS_GRACE, MAX_GUESSES, DRAWINGS } from '../draw/rules.js';
import { decode, encodeStroke, undoLast, strokeCount, inkLeft, canStart, INK_MAX, MAX_STROKES } from '../draw/codec.js';
import { createSketchpad } from '../components/sketchpad.js';

const PEN_NAMES = ['Ink', 'Pink', 'Blue', 'Green'];
const REVEAL_MS = 3600;
const fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Everything the view needs, derived fresh each time. No side effects. */
function phase() {
  const p = P(), dr = drawReplay();
  const k = dr.cur;
  // After a drawing ends, keep showing it (with the word) for a moment before moving on.
  const reveal = k > 0 && !ui.drawSeen.has(k - 1);
  const shown = reveal ? k - 1 : k;
  const item = dr.items[shown] || null;                 // null = both drawings finished: summary
  const iAmDrawer = !!item && (shown === 0 ? 'host' : 'guest') === L.role;
  // Partner here and in this round. The practice bot is always ready (its `at` only catches up
  // in botTick, after this view has rendered, which would otherwise leave the player waiting).
  const ready = isBot() || (!!p && partnerOnline() && p.at >= 3);
  const live = !!item && !reveal && !item.over;
  return { p, dr, k, reveal, shown, item, iAmDrawer, ready, live };
}
const canDraw = ph => ph.live && ph.ready && ph.iAmDrawer;
const canGuess = ph => ph.live && ph.ready && !ph.iAmDrawer && ph.item.guesses.length < MAX_GUESSES;

/* ---- timers ---- */
function tick() {
  const ph = phase();
  if (!ph.live || !ph.ready) return;                    // paused: reveal, waiting, or partner offline
  const i = ph.shown;
  const el = L.dl.el[i] = (L.dl.el[i] || 0) + 1;
  save();
  const t = $('#dtime'); if (t) t.textContent = fmt(Math.max(0, DRAW_SECS - el));
  if (ph.iAmDrawer) {
    if (el >= DRAW_SECS && !L.draw.e) { L.draw.e = 2; pushPresence(); render(); }
  } else if (isBot()) {
    if (el >= DRAW_SECS && !B.draw.e) { B.draw.e = 2; render(); }    // the bot drawer's clock is ours
  } else if (el >= DRAW_SECS + GUESS_GRACE && !L.draw.x) {
    L.draw.x = 1; pushPresence(); render();
  }
}
export function stopDraw() {
  clearInterval(ui.drawTimer); ui.drawTimer = null;
  clearTimeout(ui.drawRevealT); ui.drawRevealT = null;
  clearTimeout(ui.drawPopT); ui.drawPopT = null;
  ui.pad?.destroy(); ui.pad = null;
  ui.drawIdx = -1; ui.drawSumKey = '';
}

/* ---- feedback ---- */
function pop(text, kind) {
  const el = $('#dpop'); if (!el) return;
  el.textContent = text;                                 // may contain partner text: never innerHTML
  el.className = 'draw-pop show ' + kind;
  clearTimeout(ui.drawPopT);
  ui.drawPopT = setTimeout(() => { el.className = 'draw-pop'; }, 2000);
}
function celebrate() {
  const box = $('#dconf'); if (!box) return;
  box.textContent = '';
  for (let i = 0; i < 22; i++) {
    const s = document.createElement('i');
    const a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 90;
    s.style.setProperty('--dx', Math.round(Math.cos(a) * d) + 'px');
    s.style.setProperty('--dy', Math.round(Math.sin(a) * d - 40) + 'px');
    s.style.setProperty('--rot', Math.round(Math.random() * 540) + 'deg');
    s.style.background = i % 5 === 4 ? 'var(--glow)' : `var(--pen${i % 4})`;
    s.style.animationDelay = (Math.random() * .12).toFixed(2) + 's';
    box.appendChild(s);
  }
  setTimeout(() => { box.textContent = ''; }, 1500);
}

/* ---- build once per visit to the round ---- */
function build(play) {
  stopDraw();
  play.innerHTML = `<div class="draw" id="dboard">
    <div class="draw-live" id="dlive">
      <div class="mem-info"><span class="turn" id="dturn"></span><span>Drawing <b id="dnum">1/${DRAWINGS}</b> · <b id="dtime">${fmt(DRAW_SECS)}</b></span></div>
      <div class="draw-word" id="dword"></div>
      <div class="draw-stage" id="dstage"><div class="draw-pop" id="dpop" role="status" aria-live="polite"></div><div class="confetti" id="dconf" aria-hidden="true"></div></div>
      <div class="draw-tools" id="dtools">
        <div class="chips" role="group" aria-label="Brush colour">${PEN_NAMES.map((n, i) => `<button type="button" class="sw pen" data-pen="${i}" aria-label="${n} brush" aria-pressed="${i === ui.drawTool.c}" style="background:var(--pen${i})"></button>`).join('')}</div>
        <div class="chips" role="group" aria-label="Brush size">
          <button type="button" class="chip size" data-size="0" aria-pressed="${ui.drawTool.sz === 0}"><span class="dot s0"></span>Fine</button>
          <button type="button" class="chip size" data-size="1" aria-pressed="${ui.drawTool.sz === 1}"><span class="dot s1"></span>Bold</button>
        </div>
        <div class="chips">
          <button type="button" class="btn ghost small" id="dundo">Undo</button>
          <button type="button" class="btn ghost small" id="dclear">Clear</button>
          <button type="button" class="btn small" id="ddone">Done</button>
        </div>
      </div>
      <div class="ink-row"><span class="eyebrow">Ink</span><div class="bar ink-bar" id="inkWrap"><i id="inkBar"></i></div><span class="ink-txt" id="inkTxt"></span></div>
      <div class="guess-row"><span class="eyebrow" id="dgcount">Guesses 0/${MAX_GUESSES}</span><div class="guesses" id="dguesses"></div></div>
      <form class="say" id="dguessForm" autocomplete="off"><input type="text" id="dguessIn" maxlength="24" aria-label="Your guess" autocomplete="off" spellcheck="false"><button class="btn small" id="dguessBtn">Guess</button></form>
      <div class="draw-result" id="dresult" aria-live="polite"></div>
    </div>
    <div id="dsum" hidden></div>
  </div>`;

  ui.pad = createSketchpad($('#dstage'), {
    tool: () => ui.drawTool,
    remaining: () => INK_MAX - L.draw.s.length,
    canStart: () => canStart(L.draw.s),
    onOutOfInk: () => pop('Out of ink! Undo or clear to get some back.', 'ink'),
    onCommit: st => {
      if (!canDraw(phase())) return;
      const e = encodeStroke(st);
      if (!e || L.draw.s.length + e.length > INK_MAX || strokeCount(L.draw.s) >= MAX_STROKES) return;
      L.draw.s += e;
      pushPresence(); render();
    },
  });
  // The stage keeps pop + confetti above the canvas.
  $('#dstage').appendChild($('#dpop')); $('#dstage').appendChild($('#dconf'));

  $$('.pen').forEach(b => b.onclick = () => {
    ui.drawTool.c = +b.dataset.pen;
    $$('.pen').forEach(x => x.setAttribute('aria-pressed', x === b));
  });
  $$('.size').forEach(b => b.onclick = () => {
    ui.drawTool.sz = +b.dataset.size;
    $$('.size').forEach(x => x.setAttribute('aria-pressed', x === b));
  });
  $('#dundo').onclick = () => { if (!canDraw(phase())) return; L.draw.s = undoLast(L.draw.s); pushPresence(); render(); };
  $('#dclear').onclick = () => { if (!canDraw(phase())) return; L.draw.s = ''; pushPresence(); render(); };
  $('#ddone').onclick = () => { if (!canDraw(phase()) || !L.draw.s) return; L.draw.e = 1; pushPresence(); render(); };
  $('#dguessForm').onsubmit = e => {
    e.preventDefault();
    const ph = phase(), inp = $('#dguessIn'), v = inp.value.trim();
    if (!v || !canGuess(ph)) return;
    L.draw.g.push(clip(v, 24));
    L.draw.t.push(Math.min(DRAW_SECS, L.dl.el[ph.shown] || 0));
    inp.value = '';
    pushPresence(); render();
  };
}

/* ---- update on every render ---- */
export function updDraw() {
  const play = $('#play');
  $('#offline').hidden = partnerOnline();
  if (!$('#dboard')) build(play);
  if (!ui.drawTimer) ui.drawTimer = setInterval(tick, 1000);

  const ph = phase();
  const { dr, shown, item, reveal, iAmDrawer, ready, live } = ph;
  $('#dlive').hidden = !item; $('#dsum').hidden = !!item;
  if (!item) { ui.pad?.setEnabled(false); return renderSummary(dr); }

  if (reveal && !ui.drawRevealT) {
    ui.drawRevealT = setTimeout(() => { ui.drawRevealT = null; ui.drawSeen.add(shown); render(); }, REVEAL_MS);
  }
  if (ui.drawIdx !== shown) {            // a new drawing is on screen
    ui.drawIdx = shown; $('#dguessIn').value = '';
    ui.drawPrevG = { idx: shown, n: item.guesses.length };
  }
  if (!item.over) ui.drawLive.add(shown);

  // canvas
  ui.pad.set(decode(item.s), item.s);
  ui.pad.setEnabled(canDraw(ph));

  // header
  const el = L.dl.el[shown] || 0;
  $('#dnum').textContent = `${shown + 1}/${DRAWINGS}`;
  $('#dtime').textContent = fmt(Math.max(0, DRAW_SECS - el));
  const turn = $('#dturn');
  turn.className = 'turn' + (iAmDrawer && live && ready ? '' : ' theirs');
  turn.textContent = item.over ? (item.correct ? 'Got it!' : 'Drawing over')
    : !ready ? (partnerOnline() ? 'Waiting for them to join this round…' : 'Paused · they\'re offline')
    : iAmDrawer ? 'Your turn to draw' : 'Their turn to draw · you guess';

  // the word (our own list, but set with textContent anyway)
  const w = $('#dword'); w.textContent = '';
  const strong = document.createElement('strong'); strong.textContent = item.word;
  if (item.over) w.append('The word was ', strong);
  else if (iAmDrawer) w.append('Draw: ', strong, Object.assign(document.createElement('span'), { className: 'muted', textContent: ' · keep it secret' }));
  else w.append(`Guess what they're drawing · ${item.word.length} letters`);

  // tools + ink
  const on = canDraw(ph);
  $$('#dtools button').forEach(b => b.disabled = !on);
  if (on && !item.s) { $('#dundo').disabled = $('#dclear').disabled = $('#ddone').disabled = true; }
  const ink = inkLeft(item.s);
  $('#inkBar').style.width = Math.round(ink * 100) + '%';
  $('#inkWrap').classList.toggle('low', ink < .2);
  $('#inkTxt').textContent = ink >= .5 ? 'Plenty of ink' : ink >= .2 ? 'Ink is getting low' : ink > 0 ? 'Almost out of ink' : 'Out of ink · undo or clear to refill';

  // guesses (partner text: textContent only)
  const gl = $('#dguesses'); gl.textContent = '';
  item.guesses.forEach((g, i) => {
    const s = document.createElement('span');
    s.className = 'guess ' + (i === item.idx ? 'ok' : 'no');
    s.textContent = (i === item.idx ? '✓ ' : '✗ ') + g;
    gl.appendChild(s);
  });
  if (!item.guesses.length) gl.append(Object.assign(document.createElement('span'), { className: 'muted', textContent: iAmDrawer ? 'No guesses yet' : 'Up to 3 guesses' }));
  $('#dgcount').textContent = `Guesses ${item.guesses.length}/${MAX_GUESSES}`;

  const inp = $('#dguessIn'), gOn = canGuess(ph);
  inp.disabled = $('#dguessBtn').disabled = !gOn;
  inp.placeholder = iAmDrawer ? 'They\'re guessing…' : item.over ? '' : 'Type a guess';
  $('#dguessForm').hidden = iAmDrawer;

  // new guess since last render: "not quite" pop (the correct one gets a celebration instead)
  const n = item.guesses.length;
  if (ui.drawPrevG.idx === shown && n > ui.drawPrevG.n && !item.correct) {
    pop(iAmDrawer ? `They guessed “${item.guesses[n - 1]}”. Not it!` : 'Not quite. Try again!', 'miss');
  }
  ui.drawPrevG = { idx: shown, n };
  if (item.correct && ui.drawLive.has(shown) && !ui.drawCeleb.has(shown)) {
    ui.drawCeleb.add(shown);
    pop(`${iAmDrawer ? 'They got it!' : 'You got it!'} +${item.pts}`, 'win');
    celebrate();
  }

  // result line
  const res = $('#dresult');
  if (!item.over) res.textContent = '';
  else {
    const who = iAmDrawer ? 'They' : 'You';
    res.textContent = (item.correct ? `${who} got it in ${item.secs}s · +${item.pts} chemistry.`
      : item.reason === 'guesses' ? 'Out of guesses.' : item.reason === 'done' ? 'Finished without a correct guess.' : 'Time\'s up.')
      + (shown < DRAWINGS - 1 ? ' Swapping roles…' : '');
  }
}

function renderSummary(dr) {
  const key = JSON.stringify(dr.items.map(it => [it.correct, it.secs, it.reason]));
  if (ui.drawSumKey === key) return;
  ui.drawSumKey = key;
  const row = (it, i) => {
    const drewIt = (i === 0 ? 'host' : 'guest') === L.role ? 'You drew' : 'They drew';
    const res = it.correct ? `✓ ${it.secs}s · +${it.pts}` : '✗';
    return `<div><span>${drewIt} <b>${esc(it.word)}</b></span><span>${res}</span></div>`;
  };
  $('#dsum').innerHTML = `<div class="sum"><h3>${dr.hits} of ${DRAWINGS} guessed</h3>
    <p class="muted">${dr.hits === 2 ? 'Picasso who? You two read each other\'s scribbles perfectly.' : dr.hits === 1 ? 'One out of two. Somebody\'s art career is on hold.' : 'Neither landed, but that was fun to watch.'}</p>
    <div class="recap" style="width:100%">${dr.items.map(row).join('')}</div>
    <button class="btn" id="dnext">Last round</button></div>`;
  $('#dnext').onclick = () => { L.at = 4; pushPresence(); render(); };
}
