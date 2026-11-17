/* AI question client: validation and the Gemini request, with a fake fetch (no network). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanQuestions, geminiAsker, QUESTION_COUNT } from '../../server/ai.js';

const reply = obj => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }) });

test('cleanQuestions keeps only safe, distinct, sensible questions', () => {
  const out = cleanQuestions([
    '1. You both love rainy days. Best rainy-day plan?',
    'You both love rainy days. Best rainy-day plan?',   // duplicate after numbering is stripped
    'Hi?',                                               // too short
    'What is your insta handle so we can talk there?',   // contact
    'Why the fuck would you pick cats?',                 // abuse
    42, null,
    'x'.repeat(200) + '?',                               // too long
    'Already asked this one, right?',
    'Who drew the better kite, honestly?',
  ], ['Already asked this one, right?']);
  assert.deepEqual(out, ['You both love rainy days. Best rainy-day plan?', 'Who drew the better kite, honestly?']);
  assert.deepEqual(cleanQuestions('nope'), []);
  assert.equal(cleanQuestions(Array.from({ length: 20 }, (_, i) => `Question number ${i} for you?`)).length, QUESTION_COUNT);
});

test('geminiAsker: off without a key; sends key in a header and facts in the prompt', async () => {
  assert.equal(geminiAsker({ apiKey: '' }), null);
  let req;
  const ask = geminiAsker({ apiKey: 'test-key', model: 'm1', fetchImpl: async (url, init) => { req = { url, init }; return reply({ questions: ['Mountains or beach for date two?', 'Who wins at memory next time?', 'Best café order you have ever tried?'] }); } });
  const qs = await ask({ bothPicked: ['Beach'] }, ['Old one?']);
  assert.equal(qs.length, 3);
  assert.ok(req.url.endsWith('/models/m1:generateContent'));
  assert.ok(!req.url.includes('test-key'));                      // key never in the URL (logs)
  assert.equal(req.init.headers['x-goog-api-key'], 'test-key');
  const body = JSON.parse(req.init.body);
  assert.match(body.contents[0].parts[0].text, /"bothPicked":\["Beach"\]/);
  assert.match(body.contents[0].parts[0].text, /Old one\?/);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
});

test('geminiAsker: failures and junk return null so templates stay', async () => {
  const warn = console.warn; console.warn = () => {};
  try {
    const cases = [
      async () => ({ ok: false, status: 429, json: async () => ({}) }),
      async () => { throw new Error('network down'); },
      async () => reply({ questions: ['Only one good question here?'] }),
      async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] }) }),
      async () => ({ ok: true, status: 200, json: async () => ({}) }),
    ];
    for (const fetchImpl of cases) assert.equal(await geminiAsker({ apiKey: 'k', fetchImpl })({}), null);
    const capped = geminiAsker({ apiKey: 'k', maxPerHour: 1, fetchImpl: async () => reply({ questions: ['First question for you?', 'Second question for you?', 'Third question for you?'] }) });
    assert.ok(await capped({}));
    assert.equal(await capped({}), null);                        // hourly budget reached
  } finally { console.warn = warn; }
});
