/*
 * Two-tab end-to-end match: host and guest in one browser context, linked by
 * js/local-room.js (BroadcastChannel). Plays every round including Draw & Guess and checks:
 *   - drawings sync stroke for stroke between tabs,
 *   - both tabs show the same final chemistry,
 *   - each presence object stays under 4 KiB at the end.
 *
 * Run: npm run test:e2e   (first time: npm install && npx playwright install chromium)
 */
import { test, expect } from '@playwright/test';

const HEADS = /[!#$%&*+.]/g;   // stroke head characters (js/draw/codec.js HEAD)

/** Evaluate against the page's own ES modules (same URL, so the same module instances the app uses). */
const mods = (page, fn, arg) => page.evaluate(async ([src, arg]) => {
  const m = {
    state: await import('/js/state.js'),
    sync: await import('/js/sync.js'),
    scoring: await import('/js/scoring.js'),
    draw: await import('/js/draw/replay.js'),
  };
  return (0, eval)(src)(m, arg);
}, [fn.toString(), arg]);

async function makeCard(page, name) {
  await page.fill('#f-name', name);
  await page.fill('#f-age', '28');
  for (let q = 0; q < 3; q++) await page.click(`[data-q="${q}"][data-o="${q}"]`);
  await page.click('#ready');
}

/** Keep answering until this tab's "next round" button shows up, then press it. */
async function playUntilNext(page, step, nextSel = '#nx', ms = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.locator(nextSel).isVisible()) { await page.click(nextSel); return; }
    await step();
    await page.waitForTimeout(150);
  }
  throw new Error(`${nextSel} never appeared`);
}

const playR1 = page => playUntilNext(page, async () => {
  const c = page.locator('.choice[data-c="0"]:not([disabled])');
  if (await c.count()) await c.first().click();
});

const playMemory = page => playUntilNext(page, async () => {
  const mine = (await page.locator('#turn').textContent())?.startsWith('Your turn');
  if (!mine || await page.locator('#grid.locked').count()) return;
  const pair = await mods(page, m => {
    const D = m.state.deck(), rp = m.scoring.replay(), by = {};
    D.forEach((w, i) => (by[w] ??= []).push(i));
    return Object.values(by).find(p => !rp.matched[p[0]]);
  });
  if (!pair) return;
  await page.click(`.tile[data-i="${pair[0]}"]`);
  await page.click(`.tile[data-i="${pair[1]}"]`);
});

const playReadThem = page => playUntilNext(page, async () => {
  const o = page.locator('.opt[data-o="0"]:not([disabled])');
  if (await o.count()) await o.first().click();
});

/** Draw strokes given in normalised 0..1 canvas coordinates, with real mouse events. */
async function drawStrokes(page, strokes) {
  const box = await page.locator('#dstage canvas').boundingBox();
  const at = ([x, y]) => [box.x + x * box.width, box.y + y * box.height];
  for (const st of strokes) {
    await page.mouse.move(...at(st[0]));
    await page.mouse.down();
    for (const p of st.slice(1)) await page.mouse.move(...at(p), { steps: 6 });
    await page.mouse.up();
  }
}
const mySketch = page => mods(page, m => m.state.L.draw.s);
const partnerSketch = page => mods(page, m => m.state.P()?.draw?.s ?? '');

test('two tabs play a full match including Draw & Guess', async ({ context }) => {
  test.setTimeout(240_000);
  const a = await context.newPage(), b = await context.newPage();
  const errors = [];
  for (const p of [a, b]) p.on('pageerror', e => errors.push(e.message));

  // ---- lobby + cards ----
  await a.goto('/'); await b.goto('/');
  await expect(a.locator('#host')).toBeEnabled();
  await a.click('#host'); await makeCard(a, 'Asha');
  const code = (await a.locator('#code').textContent()).trim();
  await b.fill('#codeIn', code); await b.click('#joinBtn'); await makeCard(b, 'Bilal');

  // ---- rounds 1 and 2 ----
  await expect(a.locator('.round-head .eyebrow')).toHaveText('Round 1 of 4');
  await expect(a.locator('.dots span')).toHaveCount(4);
  await Promise.all([playR1(a), playR1(b)]);
  await Promise.all([playMemory(a), playMemory(b)]);

  // ---- round 3: Draw & Guess ----
  await expect(a.locator('.round-head h2')).toHaveText('Draw & Guess');
  await expect(a.locator('#dturn')).toHaveText('Your turn to draw');
  await expect(b.locator('#dturn')).toHaveText(/you guess/);
  await expect(b.locator('#dundo')).toBeDisabled();             // guesser can't use tools
  await expect(a.locator('#dguessForm')).toBeHidden();          // drawer can't guess
  const words = await mods(a, m => m.draw.drawReplay().items.map(i => i.word));
  expect(await mods(b, m => m.draw.drawReplay().items.map(i => i.word))).toEqual(words);   // seeded, never sent
  await expect(a.locator('#dword')).toContainText(words[0]);
  await expect(b.locator('#dword')).not.toContainText(words[0]);

  // Host draws 3 strokes, undoes one, draws another: the guest's copy must match exactly.
  await drawStrokes(a, [
    [[.2, .2], [.5, .3], [.8, .2]],
    [[.2, .8], [.8, .8]],
    [[.5, .5], [.55, .6], [.6, .62]],
  ]);
  await a.click('#dundo');
  await drawStrokes(a, [[[.3, .4], [.7, .4], [.7, .6]]]);
  const hostDrawing = await mySketch(a);
  expect(hostDrawing.match(HEADS)).toHaveLength(3);
  await expect.poll(() => partnerSketch(b)).toBe(hostDrawing);

  // Guest: one wrong guess, then the word as a plural (exercises guess matching).
  await b.fill('#dguessIn', 'definitely wrong'); await b.press('#dguessIn', 'Enter');
  await expect(a.locator('#dguesses')).toContainText('definitely wrong');
  await b.fill('#dguessIn', words[0] + 's'); await b.press('#dguessIn', 'Enter');
  await expect(b.locator('#dpop')).toContainText('You got it');
  await expect(a.locator('#dpop')).toContainText('They got it');
  await expect(a.locator('#dword')).toContainText(`The word was ${words[0]}`);

  // Roles swap: guest draws, host guesses.
  await expect(b.locator('#dturn')).toHaveText('Your turn to draw', { timeout: 10_000 });
  await expect(a.locator('#dturn')).toHaveText(/you guess/);
  await drawStrokes(b, [[[.1, .5], [.5, .1], [.9, .5], [.5, .9], [.1, .5]], [[.5, .5], [.5, .52]]]);
  const guestDrawing = await mySketch(b);
  expect(guestDrawing.match(HEADS)).toHaveLength(2);
  await expect.poll(() => partnerSketch(a)).toBe(guestDrawing);
  await a.fill('#dguessIn', words[1].toUpperCase() + '!'); await a.press('#dguessIn', 'Enter');
  await expect(a.locator('#dnext')).toBeVisible({ timeout: 10_000 });
  await expect(b.locator('#dnext')).toBeVisible({ timeout: 10_000 });
  await expect(a.locator('#dsum')).toContainText('2 of 2 guessed');
  await a.click('#dnext'); await b.click('#dnext');

  // ---- round 4 + reveal ----
  await expect(a.locator('.round-head .eyebrow')).toHaveText('Round 4 of 4');
  await Promise.all([playReadThem(a), playReadThem(b)]);
  await expect(a.locator('.big-num')).toBeVisible();
  await expect(b.locator('.big-num')).toBeVisible();
  await expect(a.locator('.recap')).toContainText('2/2 guessed');
  // Same chemistry on both screens (poll: the last presence update may still be in flight).
  await expect.poll(async () => (await a.locator('.big-num').textContent()) === (await b.locator('.big-num').textContent())).toBe(true);
  expect(await mods(a, m => m.scoring.score().chem)).toBe(await mods(b, m => m.scoring.score().chem));

  // ---- presence budget ----
  for (const p of [a, b]) expect(await mods(p, m => m.sync.presenceBytes())).toBeLessThan(4096);
  expect(errors).toEqual([]);
});
