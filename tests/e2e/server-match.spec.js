/*
 * Server mode, end to end: two separate people (separate browser contexts, so separate
 * sessions) sign up, make cards, get paired by the queue, play all four rounds, say yes,
 * chat, and one reports the other. Checks the server never hands over an unearned card.
 *
 * Run: npm run test:e2e   (starts server/ on :5175 with an in-memory database)
 */
import { test, expect } from '@playwright/test';

/* Read the page's own modules. No eval: the server's Content Security Policy forbids it. */
const myRole = page => page.evaluate(async () => (await import('/js/state.js')).L.role);
const partnerProf = page => page.evaluate(async () => (await import('/js/state.js')).P().prof);
const drawWords = page => page.evaluate(async () => (await import('/js/draw/replay.js')).drawReplay().items.map(i => i.word));
const nextPair = page => page.evaluate(async () => {
  const S = await import('/js/state.js'), Sc = await import('/js/scoring.js');
  const D = S.deck(), rp = Sc.replay(), by = {};
  D.forEach((w, i) => (by[w] ??= []).push(i));
  return Object.values(by).find(p => !rp.matched[p[0]]);
});

const dob = age => { const d = new Date(); d.setFullYear(d.getFullYear() - age); d.setDate(d.getDate() - 2); return d.toISOString().slice(0, 10); };

async function signUp(page, { email, name, gender, seeking, self }) {
  await page.goto('/');
  await page.click('#signup');
  await page.fill('#a-email', email);
  await page.fill('#a-pass', 'correct horse battery');
  await page.fill('#a-dob', dob(29));
  await page.check('#a-ok');
  await page.click('#aGo');
  await expect(page.locator('h2')).toHaveText('Make your secret card');
  await page.fill('#f-name', name);
  await page.fill('#f-city', 'Pune');
  await page.fill('#f-bio', 'Rain, records and long walks.');
  for (let q = 0; q < 3; q++) await page.click(`[data-q="${q}"][data-o="${self[q]}"]`);
  await page.click(`[data-s="gender"][data-v="${gender}"]`);
  await page.click(`[data-m="seeking"][data-v="${seeking}"]`);
  await page.click('#save');
  await expect(page.locator('.lobby-title')).toHaveText('Ready to play?');
  await expect(page.locator('#find')).toBeEnabled();
}

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
  const pair = await nextPair(page);
  if (!pair) return;
  await page.click(`.tile[data-i="${pair[0]}"]`);
  await page.click(`.tile[data-i="${pair[1]}"]`);
});
const playReadThem = page => playUntilNext(page, async () => {
  const o = page.locator('.opt[data-o="0"]:not([disabled])');
  if (await o.count()) await o.first().click();
});
async function draw(page) {
  const box = await page.locator('#dstage canvas').boundingBox();
  await page.mouse.move(box.x + box.width * .2, box.y + box.height * .2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .8, box.y + box.height * .7, { steps: 8 });
  await page.mouse.up();
}

test('two strangers: match, play, mutual yes, chat, report', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctxA = await browser.newContext(), ctxB = await browser.newContext();
  const a = await ctxA.newPage(), b = await ctxB.newPage();
  const errors = [];
  for (const p of [a, b]) p.on('pageerror', e => errors.push(e.message));

  await signUp(a, { email: 'asha@e2e.dev', name: 'Asha', gender: 'woman', seeking: 'man', self: [0, 1, 2] });
  await signUp(b, { email: 'bilal@e2e.dev', name: 'Bilal', gender: 'man', seeking: 'woman', self: [2, 2, 2] });

  // ---- the queue pairs them ----
  await a.click('#find');
  await expect(a.locator('#qLine')).toContainText('Waiting');
  await b.click('#find');
  for (const p of [a, b]) await expect(p.locator('.round-head .eyebrow')).toHaveText('Round 1 of 4', { timeout: 15_000 });
  const roleA = await myRole(a);
  const [host, guest] = roleA === 'host' ? [a, b] : [b, a];

  // ---- the server hides what hasn't been earned ----
  const early = await partnerProf(b);
  expect(early.bio).toBe('');
  expect(early.city).toBe('');
  expect(early.self).toEqual([null, null, null]);
  await expect(b.locator('#pname')).not.toHaveText('Asha');
  await expect(a.locator('#report')).toBeVisible();

  // ---- four rounds ----
  await Promise.all([playR1(a), playR1(b)]);
  await Promise.all([playMemory(a), playMemory(b)]);
  await expect(host.locator('#dturn')).toHaveText('Your turn to draw');
  const words = await drawWords(host);
  await draw(host);
  await guest.fill('#dguessIn', words[0]); await guest.press('#dguessIn', 'Enter');
  await expect(guest.locator('#dturn')).toHaveText('Your turn to draw', { timeout: 10_000 });
  await draw(guest);
  await host.fill('#dguessIn', words[1]); await host.press('#dguessIn', 'Enter');
  for (const p of [a, b]) await expect(p.locator('#dnext')).toBeVisible({ timeout: 10_000 });
  await a.click('#dnext'); await b.click('#dnext');
  await Promise.all([playReadThem(a), playReadThem(b)]);

  // ---- reveal: everything unlocked, same chemistry, mutual yes ----
  await expect(b.locator('#pname')).toHaveText('Asha', { timeout: 10_000 });
  await expect.poll(async () => (await a.locator('.big-num').textContent()) === (await b.locator('.big-num').textContent())).toBe(true);
  await a.click('#yes');
  await expect(a.locator('.wait-line')).toContainText('Waiting for Bilal');
  await b.click('#yes');
  for (const p of [a, b]) await expect(p.locator('.match')).toHaveText('It\'s a match.');

  // ---- persistent chat with starters ----
  await a.click('#openChat');
  await expect(a.locator('#cName')).toHaveText(/^Bilal, \d+$/);
  await expect(a.locator('#startList .chip').first()).toBeVisible();
  await b.click('#openChat');
  await a.fill('#cIn', 'Coffee on Sunday?'); await a.press('#cIn', 'Enter');
  await expect(b.locator('#thread .msg')).toHaveText(['Coffee on Sunday?']);
  await b.reload();                                                    // the match survives a reload
  await b.click('#matches');
  await expect(b.locator('.mrow')).toContainText('Coffee on Sunday?');

  // ---- report: match disappears for both ----
  await a.click('#cSafety');
  await a.click('[data-r="harassment"]');
  await a.click('#sReport');
  await expect(a.locator('#mList')).toContainText('No matches yet');
  await b.reload(); await b.click('#matches');
  await expect(b.locator('#mList')).toContainText('No matches yet');

  expect(errors).toEqual([]);
});
