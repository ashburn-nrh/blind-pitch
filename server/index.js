/* Entry point: `npm start`. Config comes from the environment or a local .env file (see README). */
import { existsSync } from 'node:fs';
import { createApp } from './app.js';
import { geminiAsker } from './ai.js';

if (process.env.DOTENV !== 'off' && existsSync('.env') && process.loadEnvFile) process.loadEnvFile('.env');   // tests set DOTENV=off

const ask = geminiAsker({
  apiKey: process.env.GEMINI_API_KEY?.trim(),
  model: process.env.GEMINI_MODEL || undefined,
  maxPerHour: +process.env.GEMINI_MAX_PER_HOUR || undefined,
});
const app = createApp({
  dbPath: process.env.DB_PATH || 'data/blind-pitch.db',
  production: process.env.NODE_ENV === 'production',
  trustProxy: process.env.TRUST_PROXY === '1',
  ask,
});
const port = await app.listen(+process.env.PORT || 5173);
console.log(`Blind Pitch running at http://localhost:${port}`);
console.log(ask ? 'AI questions: on (Gemini)' : 'AI questions: off (set GEMINI_API_KEY to switch on)');
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.close().then(() => process.exit(0)));
