/*
 * AI conversation questions for a new match, written by Google Gemini from what happened in
 * the game (server/game.js gameFacts: shared picks, how each person described themselves,
 * the drawings). Server-side only: the API key never reaches a browser.
 *
 * Every answer is checked before anyone sees it (shape, length, no contact details, no abuse).
 * If Gemini is off, slow, over its budget or returns junk, the caller keeps the template starters.
 *
 * Config (environment): GEMINI_API_KEY (off when empty), GEMINI_MODEL, GEMINI_MAX_PER_HOUR.
 */
import { hasContact, isUnfriendly } from './moderation.js';
import { rateLimiter } from './auth.js';

export const QUESTION_COUNT = 6;
const MIN_OK = 3;                    // fewer usable questions than this counts as a failure
const TIMEOUT_MS = 20_000;               // templates show meanwhile, so waiting is cheap

const SYSTEM = `You write conversation questions for two adults who just matched on a dating game.
They played four short co-op rounds without seeing each other, then both said yes to a second date.
You get only game facts: this-or-that picks, how each person described themselves, the words they drew.

Write ${QUESTION_COUNT} questions either person could send as their first chat message.
- Build each one on a specific fact: something they both picked, a pick where they differ, how one described themselves, or a drawing.
- Warm, playful and curious. Short: one sentence, under 120 characters, ending with a question mark.
- Address the other person as "you". Never use names, never guess ages, places or appearance.
- Nothing sexual, no questions about money, religion, politics, health, exes or body.
- Mix it up: a few light ones, one or two that invite a story, one about a possible second date.`;

/** Keep only usable questions: strings, sensible length, no contact details, no abuse, no repeats. */
export function cleanQuestions(list, avoid = []) {
  if (!Array.isArray(list)) return [];
  const seen = new Set(avoid.map(s => String(s).toLowerCase()));
  const out = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const q = raw.replace(/\s+/g, ' ').replace(/^[-*\d.)\s]+/, '').trim();
    if (q.length < 12 || q.length > 160 || hasContact(q) || isUnfriendly(q)) continue;
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length === QUESTION_COUNT) break;
  }
  return out;
}

/**
 * Returns ask(facts, avoid) -> Promise<string[] | null>, or null when there is no key.
 * `fetchImpl` is injectable for tests.
 */
export function geminiAsker({ apiKey, model = 'gemini-3.1-flash-lite', maxPerHour = 300, fetchImpl = fetch } = {}) {
  if (!apiKey) return null;
  const budget = rateLimiter(maxPerHour, 3_600_000);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  return async (facts, avoid = []) => {
    if (!budget('all')) return null;
    const prompt = `Game facts (JSON):\n${JSON.stringify(facts)}`
      + (avoid.length ? `\n\nThey already have these, write different ones:\n${avoid.map(a => '- ' + a).join('\n')}` : '');
    try {
      const r = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 1, maxOutputTokens: 1024,
            responseMimeType: 'application/json',
            responseSchema: { type: 'OBJECT', properties: { questions: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['questions'] },
          },
        }),
      });
      if (!r.ok) { console.warn(`Gemini: HTTP ${r.status}`); return null; }
      const data = await r.json();
      const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
      const qs = cleanQuestions(JSON.parse(text).questions, avoid);
      return qs.length >= MIN_OK ? qs : null;
    } catch (e) {
      console.warn('Gemini:', e.name === 'TimeoutError' ? 'timed out' : e.message);
      return null;
    }
  };
}
