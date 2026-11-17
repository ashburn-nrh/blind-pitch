# Blind Pitch

A blind-date game for two strangers. You match with someone you can't see, play four short co-op rounds together, and every bit of chemistry clears their photo a little and unlocks more of their profile.

## Run it

```bash
npm install
npm start            # http://localhost:5173  (server mode: accounts, matchmaking, chat)
```

The app runs in one of two modes, picked automatically:

- **Server mode** (served by `server/`): people sign up (18+), make a card with who they'd like to meet, and get paired with a compatible stranger from a queue (3 matches a day). The server checks every game and only sends each player what they've earned. A mutual yes creates a lasting match with chat and conversation starters. Report, block, unmatch and account deletion are built in.
- **Room mode** (plain static files, e.g. `npm run dev:static` or claude.ai): no accounts. Two tabs of one browser (or two people on claude.ai) play through a room code, as before. Practice with a bot works in both.

Settings (environment variables, or a `.env` file next to `package.json`; copy `.env.example`): `PORT` (default 5173), `DB_PATH` (default `data/blind-pitch.db`, SQLite; `:memory:` for throwaway), `NODE_ENV=production` (secure cookies + HSTS), `TRUST_PROXY=1` (behind a load balancer, for rate limiting by client IP), `GEMINI_API_KEY` (switches on AI questions), `GEMINI_MODEL` (default `gemini-3.1-flash-lite`, on the free tier), `GEMINI_MAX_PER_HOUR` (default 300, a cost cap). `.env` is git-ignored; never commit a key.

## Try two-player mode on one computer

**Server mode** (`npm start`): open the app in a normal window and in a private/incognito window (two separate logins). Sign up in both with cards that want to meet each other, then press **Find a match** in both. Or use **Play with a friend** and share the room code. Two phones on the same Wi-Fi can use your computer's local IP address.

**Room mode** (`npm run dev:static`):
1. In the first tab, choose **Start a room**, fill in your card and copy the 5-letter code.
2. Open a second tab at the same address, choose **Join** and enter the code.
3. Play both sides.

Room mode only connects tabs of the **same browser on the same computer** (`js/local-room.js` uses `BroadcastChannel`). Inside claude.ai the same page uses Claude's live rooms.

Or skip all that and choose **Practice with a bot**.

## How it's built

Plain HTML, CSS and native ES modules in the browser, no build step. A small Node server (`server/`, with `better-sqlite3` and `ws`) runs the same game modules on the server side.

```
blind-pitch/
├── index.html              page skeleton
├── css/styles.css          all styling, light and dark themes
└── js/
    ├── local-room.js       local stand-in for live rooms (classic script, tabs of one browser)
    ├── main.js             entry point: first paint, then connect to rooms
    ├── util.js             DOM, random, escaping and localStorage helpers
    ├── data.js             questions, palettes, unlock slots, bot personas
    ├── state.js            shared game state (live-bound exports + setters) and derived getters
    ├── sync.js             save, publish presence, validate partner data
    ├── scoring.js          replay() and score(), symmetric for both players
    ├── session.js          start / leave a game
    ├── router.js           stage(), render(), top bar
    ├── bot.js              practice-mode bot
    ├── draw/               Draw & Guess logic (pure, no DOM)
    │   ├── codec.js        compact stroke encoding, sanitising, ink limits
    │   ├── rules.js        word list, seeded words, guess checking, points
    │   ├── replay.js       derives the round from both players' presence
    │   └── bot-drawings.js 8 pre-made drawings for the practice bot
    ├── components/         avatar, partner-card, chat, sketchpad (canvas)
    └── views/              home, profile, wait, round1, round2, draw, round3 (Read Them), end
    ├── api.js              server detection + JSON fetch helper
    ├── net-room.js         live rooms over the server's WebSocket (same API as local-room.js)
    └── views/account.js    server-mode screens: sign up, card, lobby, queue, matches, chat
server/
    ├── index.js            entry point (npm start)
    ├── app.js              HTTP API, static files, WebSocket rooms, matchmaking, chat, safety
    ├── game.js             what each player may see of the other; moves are final
    ├── db.js               SQLite schema
    ├── auth.js             scrypt passwords, session tokens, age, rate limits
    ├── ai.js               Gemini question writer: request, validation, cost cap
    └── moderation.js       contact-detail and abuse screening
tests/
    ├── unit/               node --test (npm test): game logic + real HTTP/WebSocket server tests
    └── e2e/                Playwright (npm run test:e2e): two-tab local match + two-user server match
```

The rounds are `L.at` 1 Same Wavelength, 2 Memory Duet, 3 Draw & Guess, 4 Read Them, 5 the reveal. Games saved by the 3-round version are migrated on load (`migrate()` in `state.js`).

State lives in `state.js`. Modules read it through imports (`L`, `B`, `R`, `live`…) and change it only through the exported setters (`setGame`, `setBot`…), because ES module imports are read-only. Some modules import each other (for example `router` and `session`), which is safe because they only call each other inside functions, never at load time.

### How sync works
Each player publishes their whole state as one "presence" object (profile card, round 1 picks, memory flips, round 3 guesses, second-date answer, last chat message). Both pages rebuild the game from the two presence objects, so they always agree:

- **Same Wavelength:** question order is shuffled from the room code, so both players get the same order.
- **Memory Duet:** the board is shuffled from the room code. `replay()` alternates host and guest turns through both players' flip lists to rebuild the board.
- **Draw & Guess:** each player publishes one small `draw` object: `s` their drawing, `e` how they ended it (Done / time), `g` + `t` their guesses and when they made them, `x` a guesser-side timeout. The host draws drawing 1 and the guest drawing 2, so each field has one meaning per player. `drawReplay()` rebuilds both drawings from the two objects, the same way `replay()` rebuilds the memory board. The two secret words come from a room-code seeded shuffle, so they are never sent.
  - **Strokes** are one string: a head character per stroke (colour × size), then one character per coordinate on a 64 × 64 grid. Points in the same cell or on a straight line are dropped, and the canvas smooths with quadratic curves.
  - **Ink** is the size limit as a game mechanic: 1 ink = 1 character, 1400 max (and 60 strokes). Undo and Clear give ink back. With 3 guesses the `draw` object stays under ~1.6 KB, and the whole presence object stays under 4 KiB even with maximum-length multi-byte profile and chat text. `buildPresence()` measures the encoded byte size and trims strokes as a last-resort guard.
  - **The clock** is the one thing presence can't derive. Each page counts seconds only while the partner is online and in the round, so going offline pauses both. The drawer's page decides "time's up". A guesser whose clock runs 4 s past it can also end the drawing, so a frozen tab can't stall the game.
- **Chemistry:** `score()` is symmetric, so both players see the same number.
  `4 + 4 × matching picks (0–24) + memory points (4–24) + Draw & Guess (8 per correct drawing + up to 4 for speed, 0–24) + 4 × correct reads, both players (0–24)`, capped at 100.
  A perfect match is 100; a typical one (3–4 picks in sync, ~16 memory turns, a drawing or two guessed, half the reads right) lands around 55–70.
- Unlocks happen at chemistry 12 (name), 30 (city), 50 (song) and 70 (bio). The photo clears fully at 85.

## Tests

```bash
npm test                                   # game logic + server API/WebSocket tests
npx playwright install chromium            # once
npm run test:e2e                           # local two-tab match + two-user server match
```

### Privacy and fairness in server mode
The browser never receives anything its player hasn't earned. The server runs the same scoring code, stores both players' moves, and sends each one a filtered view of the other (`server/game.js`):
- name/age, city, song and bio arrive only at chemistry 12 / 30 / 50 / 70 (everything once all four rounds are done);
- a this-or-that pick only after you've answered that question, an "about me" answer only after you've guessed it, and their second-date answer only after you've given yours;
- phone numbers, emails, handles and links are stripped from cards, reactions and guesses until a mutual yes; obvious abuse is masked.
Profiles come from the account, not from the browser, and moves are final: the server ignores attempts to change an answer after seeing the other person's.

### AI questions (server mode, optional)
When both players say yes, the chat opens with template starters straight away. If `GEMINI_API_KEY` is set, the server then asks Gemini for 6 questions built on that game and swaps them in for both people live. **New questions** in the chat asks for a fresh set (5 per match per day).
- **What Gemini sees:** only facts picked from fixed lists (`gameFacts()` in `server/game.js`): the this-or-that picks they shared and split on, each person's "about me" answers, the two drawing words and whether they were guessed, chemistry. People are "A" and "B". No names, ages, cities, songs, bios or chat messages, and no text anyone typed, so a card can't inject instructions.
- **What users see:** every question is checked (length, no contact details, no abuse, no repeats). If Gemini is off, slow (20 s), over the hourly cap or returns junk, the template starters stay.
- The key stays on the server and goes in a request header, never a URL.
- Use a paid-tier key for real users: on Google's free tier, prompts may be used to improve their products. Mention the AI provider in the privacy policy.

### Known limits
- In room mode (no server) profile answers travel in presence, so a player who opens dev tools could read them early. Server mode fixes this.
- The Draw & Guess words come from the room code, so a player who reads the code could work out the word. Guess times are self-reported by the guesser. Same trade-off as above; moving this to a server fixes both.
- Each page runs its own Draw & Guess clock, so the two countdowns can differ by about the network delay. The drawer's page decides when time is up.

## Before a public launch
Server mode is built for a small trial. Before opening it to the public:
- **Email verification and password reset** (needs an email provider). Signup currently trusts the email address.
- **Real photo + verification**: a selfie/ID check service (the dating-app norm since 2025) and photo storage, then a blurred real photo as the final reveal.
- **Moderation**: the word list and contact filter are a first line only. Add a moderation API and a person who reviews `reports` (3 reports from different people already keep someone out of the queue automatically).
- **Scale**: SQLite and in-memory rate limits/sockets suit one server. For several instances, move to Postgres and share sessions/rate limits/pub-sub through Redis.
- **AI**: shuffle limits are in memory (reset on restart); move them to the database or Redis when scaling.
- **Ops**: HTTPS, backups of the database file, error monitoring, privacy policy, terms, and a data export for users.
- **Later**: push notifications and installable app, voice round, async (turn-based) play.
