/*
 * Square drawing canvas used by Draw & Guess.
 *
 * - Coordinates are normalised and snapped to the 64 x 64 codec grid, so a drawing looks
 *   the same on any screen size. The canvas is sized to its box x devicePixelRatio for
 *   crisp lines, and redrawn on resize and on light/dark theme change.
 * - Pen colours come from CSS tokens (--pen0..3); strokes store only a colour index.
 * - Pointer events + touch-action:none (in CSS) give one code path for mouse, pen and touch.
 */
import { GRID, snap } from '../draw/codec.js';

const BRUSH = [0.012, 0.028];   // line width as a share of canvas width: fine, bold

export function createSketchpad(host, opts) {
  const board = document.createElement('div');
  board.className = 'draw-board';
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Drawing canvas');
  board.appendChild(canvas);
  host.appendChild(board);
  const ctx = canvas.getContext('2d');

  let strokes = [], key = null, liveStroke = null, cut = false, pid = null;
  let enabled = false, W = 0, pens = [];

  const readPens = () => { const cs = getComputedStyle(canvas); pens = [0, 1, 2, 3].map(i => cs.getPropertyValue('--pen' + i).trim() || '#000'); };

  function paintStroke(st) {
    const pts = st.pts.map(([x, y]) => [(x + .5) / GRID * W, (y + .5) / GRID * W]);
    const lw = Math.max(2, BRUSH[st.sz] * W);
    ctx.strokeStyle = ctx.fillStyle = pens[st.c] || pens[0];
    ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (pts.length === 1) { ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], lw / 2, 0, Math.PI * 2); ctx.fill(); return; }
    // Smooth: quadratic curves through the midpoints, with the real points as control points.
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    const last = pts[pts.length - 1]; ctx.lineTo(last[0], last[1]);
    ctx.stroke();
  }

  function paint() {
    if (!W) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, W);
    strokes.forEach(paintStroke);
    if (liveStroke) paintStroke(liveStroke);
  }

  function resize() {
    const w = board.getBoundingClientRect().width;
    if (!w) return;
    const dpr = window.devicePixelRatio || 1;
    W = w;
    canvas.width = canvas.height = Math.round(w * dpr);
    readPens(); paint();
  }
  const ro = new ResizeObserver(resize); ro.observe(board);
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const onTheme = () => { readPens(); paint(); };
  mq.addEventListener('change', onTheme);
  const mo = new MutationObserver(onTheme); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  /* ---- input ---- */
  const cellOf = e => { const r = canvas.getBoundingClientRect(); return [snap((e.clientX - r.left) / r.width), snap((e.clientY - r.top) / r.height)]; };
  function add(e) {
    if (cut) return;
    const p = cellOf(e), last = liveStroke.pts[liveStroke.pts.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) return;          // closer than 1 cell: drop
    // Cost check: 1 head char + 2 chars per point must fit the ink that is left.
    if (1 + (liveStroke.pts.length + 1) * 2 > opts.remaining()) { cut = true; opts.onOutOfInk(); return; }
    liveStroke.pts.push(p);
  }
  function finish() {
    if (!liveStroke) return;
    const st = liveStroke; liveStroke = null; pid = null; cut = false;
    if (st.pts.length) opts.onCommit(st);
    paint();
  }
  canvas.addEventListener('pointerdown', e => {
    if (!enabled || pid !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (!opts.canStart()) { opts.onOutOfInk(); return; }
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId); pid = e.pointerId;
    const { c, sz } = opts.tool();
    liveStroke = { c, sz, pts: [] }; cut = false;
    add(e); paint();
  });
  canvas.addEventListener('pointermove', e => {
    if (e.pointerId !== pid || !liveStroke) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    (evs.length ? evs : [e]).forEach(add);
    paint();
  });
  const end = e => { if (e.pointerId === pid) finish(); };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('lostpointercapture', end);

  return {
    canvas,
    /** Show these strokes. `k` is the encoded string, used to skip repaints when nothing changed. */
    set(list, k) { if (k === key) return; key = k; strokes = list; paint(); },
    setEnabled(on) {
      enabled = on; board.classList.toggle('off', !on);
      if (!on && liveStroke) { liveStroke = null; pid = null; paint(); }
    },
    destroy() { ro.disconnect(); mo.disconnect(); mq.removeEventListener('change', onTheme); board.remove(); },
  };
}
