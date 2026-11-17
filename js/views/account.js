/*
 * Server-mode screens: welcome, sign up / log in, my card, lobby, finding a match,
 * matches and chat. Only used when the app is served by server/ (js/api.js SERVER).
 */
import { $, $$, esc, toast, store } from '../util.js';
import { BGS, SKINS, HAIRS, SELFQ } from '../data.js';
import { L, acct, screen, setScreen, setView, newGame } from '../state.js';
import { api } from '../api.js';
import { startNet, stopNet, onServerEvent } from '../net-room.js';
import { gkey } from '../sync.js';
import { start, leave } from '../session.js';
import { render } from '../router.js';
import { avatar } from '../components/avatar.js';
import { openSafety } from '../components/safety.js';
import { intro } from './home.js';

// Always rebuild: the first-time card and the lobby are both drawn from the 'home' view.
const go = s => { setScreen(s); setView(''); render(); };

/* A screen can register a cleanup (stop polling, leave the queue) for when it is left. */
let cleanup = null;
export function runScreenCleanup() { const f = cleanup; cleanup = null; f?.(); }

export const SCREENS = {
  signup: () => buildAuth('signup'),
  login: () => buildAuth('login'),
  card: () => buildCard(),
  queue: buildQueue,
  matches: buildMatches,
  chat: buildChat,
};

/* ---------------- session ---------------- */
export async function loadMe() {
  try {
    const r = await api('GET', '/api/me');
    Object.assign(acct, { user: r.user, profile: r.profile, dailyLeft: r.dailyLeft });
    startNet();
  } catch { Object.assign(acct, { user: null, profile: null }); }
}

export function wireServerEvents() {
  onServerEvent('matched', m => { if (!L && screen === 'queue') startServerGame(m.code, m.role, 'queue'); });
  onServerEvent('ended', m => {
    if (L && L.code === m.code) { toast('This game has ended.'); leave(); }
    else if (screen === 'chat' && acct.chatCode === m.code) { toast('This match has ended.'); go('matches'); }
  });
  onServerEvent('mutual', () => toast('It\'s a match! Your chat is open in Matches.'));
  onServerEvent('questions', m => {
    if (acct.chatMatch?.code === m.code) acct.chatMatch.starters = m.questions;
    if (screen === 'chat' && acct.chatCode === m.code) showQuestions(m.questions);
  });
  onServerEvent('msg', m => {
    if (screen === 'chat' && acct.chatCode === m.code) appendMsg(m.message);
    else if (!m.message.mine) toast('New message from a match');
  });
}

/** Open a server game. My card comes from my account; the server checks it's the same. */
export function startServerGame(code, role, kind) {
  if (L && L.code === code) return;
  runScreenCleanup();
  const g = store.get(gkey(code, role)) || newGame(code, role);
  const p = acct.profile;
  g.kind = kind || g.kind || 'private';
  g.prof = { name: p.name, age: p.age, city: p.city, song: p.song, bio: p.bio, sk: p.sk, hr: p.hr, bg: p.bg, hs: p.hs, self: p.self.slice(), ready: true };
  setScreen(null);
  start(g);
}

/* ---------------- home: welcome or lobby ---------------- */
export function buildServerHome() {
  if (!acct.user) return buildWelcome();
  if (!acct.profile) return buildCard();
  return buildLobby();
}

function buildWelcome() {
  $('#app').innerHTML = intro(`
    <button class="btn" id="signup">Create an account</button>
    <button class="btn ghost" id="login">I already have an account</button>
    <p class="note">For adults 18+. Every card is private until it's earned, and you can report or block anyone at any time.</p>
    <button class="link" id="practice" style="align-self:flex-start">Practice with a bot first</button>`);
  $('#signup').onclick = () => go('signup');
  $('#login').onclick = () => go('login');
  $('#practice').onclick = () => start(newGame('BOT' + Math.floor(Math.random() * 1e6), 'host', true));
}

function buildAuth(mode) {
  const signup = mode === 'signup';
  const max = new Date(); max.setFullYear(max.getFullYear() - 18);
  $('#app').innerHTML = `<section class="auth card">
    <div><div class="eyebrow">${signup ? 'Step 1 of 2' : 'Welcome back'}</div><h2>${signup ? 'Create your account' : 'Log in'}</h2></div>
    <form id="authForm" class="fields" novalidate>
      <div class="field"><label for="a-email">Email</label><input type="email" id="a-email" autocomplete="email" required></div>
      <div class="field"><label for="a-pass">Password</label><input type="password" id="a-pass" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="10" required>
        ${signup ? '<small>At least 10 characters.</small>' : ''}</div>
      ${signup ? `<div class="field"><label for="a-dob">Date of birth</label><input type="date" id="a-dob" max="${max.toISOString().slice(0, 10)}" required><small>Only your age is ever shown.</small></div>
      <label class="check"><input type="checkbox" id="a-ok"> I'm 18 or over and I'll play kindly.</label>` : ''}
      <div class="err" id="aErr" role="alert"></div>
      <button class="btn" id="aGo">${signup ? 'Create account' : 'Log in'}</button>
    </form>
    <button class="link" id="aSwap">${signup ? 'Already have an account? Log in' : 'New here? Create an account'}</button>
    <button class="link" id="aBack">Back</button>
  </section>`;
  $('#aSwap').onclick = () => go(signup ? 'login' : 'signup');
  $('#aBack').onclick = () => go(null);
  $('#authForm').onsubmit = async e => {
    e.preventDefault();
    const err = $('#aErr'); err.textContent = '';
    if (signup && !$('#a-ok').checked) { err.textContent = 'Please confirm you are 18 or over.'; return; }
    $('#aGo').disabled = true;
    try {
      const body = { email: $('#a-email').value, password: $('#a-pass').value, ...(signup ? { dob: $('#a-dob').value } : {}) };
      await api('POST', signup ? '/api/signup' : '/api/login', body);
      await loadMe();
      go(null);
    } catch (ex) { err.textContent = ex.message; $('#aGo').disabled = false; }
  };
}

/* ---------------- my card (profile + who I want to meet) ---------------- */
const GENDERS = [['woman', 'Woman'], ['man', 'Man'], ['nonbinary', 'Non-binary']];
const INTENTS = [['long-term', 'Something long-term'], ['casual', 'Something casual'], ['not-sure', 'Not sure yet']];

function buildCard() {
  const first = !acct.profile;
  const d = acct.profile ? JSON.parse(JSON.stringify(acct.profile))
    : { name: '', city: '', song: '', bio: '', sk: 0, hr: 0, bg: 0, hs: 0, self: [null, null, null], gender: null, seeking: [], intent: 'not-sure', ageMin: 18, ageMax: 99 };
  const sw = (key, list, fn) => list.map((v, i) => `<button type="button" class="sw" data-k="${key}" data-i="${i}" aria-pressed="${d[key] === i}" aria-label="${key} option ${i + 1}" style="background:${fn(v)}"></button>`).join('');
  const chips = (key, list, multi) => list.map(([v, l]) => `<button type="button" class="chip" data-${multi ? 'm' : 's'}="${key}" data-v="${v}" aria-pressed="${multi ? d[key].includes(v) : d[key] === v}">${l}</button>`).join('');
  $('#app').innerHTML = `<section class="form">
    <div class="fields">
      <div><div class="eyebrow">${first ? 'Step 2 of 2' : 'Your card'}</div><h2 style="font-size:clamp(28px,4.5vw,40px);margin-top:6px">${first ? 'Make your secret card' : 'Edit your card'}</h2>
        <p class="muted" style="margin-top:6px;max-width:56ch">Matches see none of this at first. Each piece unlocks as your chemistry grows. Contact details stay out until you both say yes.</p></div>
      <div class="field"><label for="f-name">First name</label><input type="text" id="f-name" maxlength="24" value="${esc(d.name)}"></div>
      <div class="field"><label for="f-city">City</label><input type="text" id="f-city" maxlength="40" value="${esc(d.city)}"></div>
      <div class="field"><label for="f-song">Song on repeat</label><input type="text" id="f-song" maxlength="60" placeholder="Song by Artist" value="${esc(d.song)}"></div>
      <div class="field"><label for="f-bio">Bio</label><textarea id="f-bio" maxlength="160" placeholder="One or two lines about you">${esc(d.bio)}</textarea></div>
      <div class="field"><span class="lbl">Your portrait</span><small>No real photos yet. Build a little stand-in.</small>
        <div class="chips">${sw('bg', BGS, v => `linear-gradient(135deg,${v[0]},${v[1]})`)}</div>
        <div class="chips">${sw('sk', SKINS, v => v)}</div>
        <div class="chips">${sw('hr', HAIRS, v => v)}</div>
        <div class="chips"><button type="button" class="chip" data-k="hs" data-i="0" aria-pressed="${d.hs === 0}">Short hair</button><button type="button" class="chip" data-k="hs" data-i="1" aria-pressed="${d.hs === 1}">Long hair</button></div>
      </div>
      ${SELFQ.map((q, qi) => `<div class="field"><span class="lbl">${q.me}</span><div class="chips">${q.opts.map((o, oi) => `<button type="button" class="chip" data-q="${qi}" data-o="${oi}" aria-pressed="${d.self[qi] === oi}">${esc(o)}</button>`).join('')}</div></div>`).join('')}
      <div class="field"><span class="lbl">I am a</span><div class="chips">${chips('gender', GENDERS, false)}</div></div>
      <div class="field"><span class="lbl">I'd like to meet</span><small>Pick any that apply.</small><div class="chips">${chips('seeking', GENDERS, true)}</div></div>
      <div class="field"><span class="lbl">I'm looking for</span><div class="chips">${chips('intent', INTENTS, false)}</div></div>
      <div class="field"><span class="lbl">Age range</span><div class="range"><input type="number" id="f-amin" min="18" max="99" value="${d.ageMin}" aria-label="Youngest"> to <input type="number" id="f-amax" min="18" max="99" value="${d.ageMax}" aria-label="Oldest"></div></div>
      <div class="err" id="ferr" role="alert"></div>
      <div class="actions"><button class="btn" id="save">${first ? 'Lock in my card' : 'Save'}</button>${first ? '' : '<button class="btn ghost" id="cBack">Back</button>'}</div>
      ${first ? '' : `<div class="danger"><button class="link" id="logout">Log out</button> · <button class="link" id="delete">Delete my account</button></div>`}
    </div>
    <div class="card preview" id="preview"></div>
  </section>`;
  const prev = () => { $('#preview').innerHTML = `<div class="photo">${avatar(d, 'me', 0)}<span class="tag">WHAT THEY'LL UNLOCK</span></div><div class="who"><div class="eyebrow">Your card</div><h3>${esc(d.name || 'Your name')}${acct.user?.age ? ', ' + acct.user.age : ''}</h3></div><p class="muted" style="font-size:13.5px">${esc(d.city || 'City')} · ${esc(d.song || 'Song on repeat')}</p>`; };
  prev();
  ['name', 'city', 'song', 'bio'].forEach(k => $('#f-' + k).oninput = e => { d[k] = e.target.value; prev(); });
  const press = (sel, b) => $$(sel).forEach(x => x.setAttribute('aria-pressed', x === b));
  $$('[data-k]').forEach(b => b.onclick = () => { d[b.dataset.k] = +b.dataset.i; press(`[data-k="${b.dataset.k}"]`, b); prev(); });
  $$('[data-q]').forEach(b => b.onclick = () => { d.self[+b.dataset.q] = +b.dataset.o; press(`[data-q="${b.dataset.q}"]`, b); });
  $$('[data-s]').forEach(b => b.onclick = () => { d[b.dataset.s] = b.dataset.v; press(`[data-s="${b.dataset.s}"]`, b); });
  $$('[data-m]').forEach(b => b.onclick = () => {
    const list = d[b.dataset.m], v = b.dataset.v, on = !list.includes(v);
    d[b.dataset.m] = on ? [...list, v] : list.filter(x => x !== v);
    b.setAttribute('aria-pressed', on);
  });
  $('#save').onclick = async () => {
    $('#ferr').textContent = '';
    $('#save').disabled = true;
    try {
      const r = await api('PUT', '/api/profile', { ...d, ageMin: parseInt($('#f-amin').value, 10), ageMax: parseInt($('#f-amax').value, 10) });
      acct.profile = r.profile;
      toast(first ? 'Card locked in. Time to play!' : 'Saved');
      go(null);
    } catch (e) { $('#ferr').textContent = e.message; $('#save').disabled = false; }
  };
  if (!first) {
    $('#cBack').onclick = () => go(null);
    $('#logout').onclick = logout;
    $('#delete').onclick = async () => {
      if (!confirm('Delete your account, card, matches and messages? This can\'t be undone.')) return;
      try { await api('DELETE', '/api/me'); signedOut('Your account has been deleted.'); } catch (e) { $('#ferr').textContent = e.message; }
    };
  }
}

async function logout() { try { await api('POST', '/api/logout'); } catch {} signedOut('Logged out.'); }
function signedOut(message) {
  stopNet();
  Object.assign(acct, { user: null, profile: null, dailyLeft: 0, chatCode: null, chatMatch: null });
  store.del('bp:last');
  toast(message); go(null);
}

/* ---------------- lobby ---------------- */
function buildLobby() {
  const left = acct.dailyLeft;
  const last = store.get('bp:last');
  const resume = last && typeof last.code === 'string' && /^[A-Z0-9]{5}$/.test(last.code) && (last.role === 'host' || last.role === 'guest') ? last : null;
  $('#app').innerHTML = `<section class="lobby">
    <div><div class="eyebrow">Hi ${esc(acct.profile.name)}</div><h2 class="lobby-title">Ready to play?</h2></div>
    <div class="lobby-grid">
      <div class="card lobby-main">
        <h3>Meet someone new</h3>
        <p class="muted">We pair you with a stranger who wants to meet you too, in your age range and looking for the same kind of thing. Four games, then you both decide.</p>
        <button class="btn" id="find" ${left > 0 ? '' : 'disabled'}>Find a match</button>
        <span class="eyebrow">${left > 0 ? `${left} of 3 left today` : 'That\'s 3 for today. Back tomorrow!'}</span>
      </div>
      <div class="card"><h3>Your matches</h3><p class="muted">People who said yes back. Your chats live here.</p><button class="btn ghost" id="matches">Open matches</button></div>
      <div class="card"><h3>Play with a friend</h3><p class="muted">Start a private room and share the code, or join theirs.</p>
        <button class="btn ghost small" id="host">Start a room</button>
        <div class="join"><input type="text" id="codeIn" maxlength="5" placeholder="ROOM CODE" aria-label="Room code" autocomplete="off"><button class="btn ghost small" id="joinBtn">Join</button></div></div>
      <div class="card"><h3>Warm up</h3><p class="muted">A quick practice game with a friendly bot.</p><button class="btn ghost small" id="practice">Practice with a bot</button></div>
    </div>
    <div class="lobby-foot">
      ${resume ? `<button class="link" id="resume">Go back to room ${esc(resume.code)}</button> · ` : ''}
      <button class="link" id="editCard">Edit my card</button> · <button class="link" id="logout">Log out</button>
    </div>
  </section>`;
  $('#find').onclick = () => go('queue');
  $('#matches').onclick = () => go('matches');
  $('#editCard').onclick = () => go('card');
  $('#logout').onclick = logout;
  $('#practice').onclick = () => start(newGame('BOT' + Math.floor(Math.random() * 1e6), 'host', true));
  $('#host').onclick = async () => {
    try { const r = await api('POST', '/api/rooms'); startServerGame(r.code, r.role, 'private'); } catch (e) { toast(e.message); }
  };
  const join = async () => {
    const c = $('#codeIn').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.length !== 5) { toast('Room codes have 5 characters'); return; }
    try { const r = await api('POST', `/api/rooms/${c}/join`); startServerGame(r.code, r.role, 'private'); } catch (e) { toast(e.message); }
  };
  $('#joinBtn').onclick = join;
  $('#codeIn').onkeydown = e => { if (e.key === 'Enter') join(); };
  if (resume) $('#resume').onclick = () => startServerGame(resume.code, resume.role, store.get(gkey(resume.code, resume.role))?.kind);
  // Refresh today's count quietly (it may have changed in another tab).
  api('GET', '/api/me').then(r => { if (r.dailyLeft !== acct.dailyLeft) { acct.dailyLeft = r.dailyLeft; if (!L && !screen && $('.lobby')) buildLobby(); } }).catch(() => {});
}

/* ---------------- finding a match ---------------- */
function buildQueue() {
  $('#app').innerHTML = `<section class="waiting">
    <div class="eyebrow">Finding your match</div>
    <h2>Looking for someone who fits…</h2>
    <p class="muted" style="max-width:52ch">You'll be paired with someone who wants to meet you too, in each other's age range, with compatible intentions. Keep this page open.</p>
    <div class="wait-line"><span class="pulse"><i></i><i></i><i></i></span><span id="qLine">Searching…</span></div>
    <div class="actions"><button class="btn ghost" id="qCancel">Stop looking</button></div>
  </section>`;
  let alive = true, timer = null, matched = false;
  const line = t => { const el = $('#qLine'); if (el) el.textContent = t; };
  const handle = r => {
    if (!alive) return;
    if (r.status === 'matched') { matched = true; alive = false; acct.dailyLeft = Math.max(0, acct.dailyLeft - 1); startServerGame(r.code, r.role, 'queue'); return; }
    if (r.status === 'limit') { alive = false; acct.dailyLeft = 0; line('That\'s your 3 matches for today. Come back tomorrow!'); return; }
    if (r.status === 'idle') { api('POST', '/api/queue').then(handle, failed); return; }
    line('Waiting for someone compatible to join…');
    timer = setTimeout(poll, 3000);
  };
  const failed = e => { if (!alive) return; line(e.message); timer = setTimeout(poll, 5000); };
  const poll = () => api('GET', '/api/queue').then(handle, failed);
  api('POST', '/api/queue').then(handle, failed);
  $('#qCancel').onclick = () => go(null);
  cleanup = () => { alive = false; clearTimeout(timer); if (!matched) api('DELETE', '/api/queue').catch(() => {}); };
}

/* ---------------- matches + chat ---------------- */
async function buildMatches() {
  $('#app').innerHTML = `<section class="matches">
    <div class="round-head"><div><div class="eyebrow">Your matches</div><h2>People who said yes back</h2></div><button class="link" id="mBack">Back</button></div>
    <div class="mlist" id="mList"><div class="wait-line"><span class="pulse"><i></i><i></i><i></i></span>Loading…</div></div>
    <p class="banner">Stay safe: meet somewhere public, tell a friend where you're going, and keep chatting here until you trust them. You can report or block from any chat.</p>
  </section>`;
  $('#mBack').onclick = () => go(null);
  let matches;
  try { ({ matches } = await api('GET', '/api/matches')); } catch (e) { const l = $('#mList'); if (l) l.textContent = e.message; return; }
  const list = $('#mList'); if (!list) return;
  list.textContent = '';
  if (!matches.length) { list.innerHTML = '<p class="muted">No matches yet. Play a game, and if you both say yes at the end, they show up here.</p>'; return; }
  for (const m of matches) {
    const b = document.createElement('button');
    b.className = 'mrow';
    b.innerHTML = `<span class="mava">${avatar(m.partner, 'mv' + m.code, 0)}</span><span class="minfo"><b></b><span class="muted"></span></span><span class="mchem" title="Chemistry">${Number(m.chem) || ''}</span>`;
    b.querySelector('b').textContent = `${m.partner.name}, ${m.partner.age}`;
    b.querySelector('.muted').textContent = m.last ? (m.last.mine ? 'You: ' : '') + m.last.body : 'Say hi! Questions from your game are waiting.';
    b.onclick = () => { acct.chatCode = m.code; acct.chatMatch = m; go('chat'); };
    list.appendChild(b);
  }
}

const shown = new Set();
function appendMsg(msg) {
  const t = $('#thread');
  if (!t || shown.has(msg.id)) return;
  shown.add(msg.id);
  const d = document.createElement('div');
  d.className = 'msg' + (msg.mine ? ' me' : '');
  d.textContent = msg.body;
  t.appendChild(d);
  t.scrollTop = t.scrollHeight;
  const st = $('#starters'), more = $('#qMore');
  if (st && more) { st.hidden = true; more.hidden = false; }
}

/** The question deck: tap one to put it in the message box. */
function showQuestions(list) {
  const box = $('#startList'); if (!box) return;
  box.textContent = '';
  for (const s of list || []) {
    const c = document.createElement('button');
    c.type = 'button'; c.className = 'chip'; c.textContent = s;
    c.onclick = () => { $('#cIn').value = s; $('#cIn').focus(); };
    box.appendChild(c);
  }
}

async function buildChat() {
  const m = acct.chatMatch;
  if (!m || m.code !== acct.chatCode) return go('matches');
  shown.clear();
  $('#app').innerHTML = `<section class="chatroom">
    <div class="chat-head">
      <button class="link" id="cBack">‹ Matches</button>
      <div class="chat-who"><span class="mava">${avatar(m.partner, 'cv', 0)}</span><div><h3 id="cName"></h3><div class="muted" id="cMeta"></div></div></div>
      <button class="link" id="cSafety">Report or block</button>
    </div>
    <div class="chat thread" id="thread" aria-live="polite"></div>
    <div class="starters" id="starters">
      <div class="starters-head"><span class="eyebrow">Questions from your game</span>${m.ai ? '<button type="button" class="link" id="qNew">New questions</button>' : ''}</div>
      <div class="reacts" id="startList"></div>
    </div>
    <button type="button" class="link" id="qMore" hidden>Need a question?</button>
    <form class="say" id="cForm"><input type="text" id="cIn" maxlength="1000" placeholder="Write a message…" autocomplete="off" aria-label="Message"><button class="btn small">Send</button></form>
    <details class="card about"><summary id="cAbout"></summary><p id="cBio"></p><p class="muted" id="cMore"></p></details>
  </section>`;
  const p = m.partner;
  $('#cName').textContent = `${p.name}, ${p.age}`;
  $('#cMeta').textContent = `Chemistry ${Number(m.chem) || '–'}${p.city ? ' · ' + p.city : ''}`;
  $('#cAbout').textContent = `About ${p.name}`;
  $('#cBio').textContent = p.bio || 'No bio. Mysterious.';
  $('#cMore').textContent = p.song ? `On repeat: ${p.song}` : '';
  showQuestions(m.starters);
  $('#qMore').onclick = () => { $('#starters').hidden = false; $('#qMore').hidden = true; };
  const qNew = $('#qNew');
  if (qNew) qNew.onclick = async () => {
    qNew.disabled = true; qNew.textContent = 'Thinking…';
    try { const r = await api('POST', `/api/matches/${m.code}/questions`); m.starters = r.questions; showQuestions(r.questions); }
    catch (ex) { toast(ex.message); }
    finally { if (qNew.isConnected) { qNew.disabled = false; qNew.textContent = 'New questions'; } }
  };
  $('#cBack').onclick = () => go('matches');
  $('#cSafety').onclick = () => openSafety({ code: m.code, allowUnmatch: true, onDone: () => go('matches') });
  $('#cForm').onsubmit = async e => {
    e.preventDefault();
    const v = $('#cIn').value.trim(); if (!v) return;
    try { const r = await api('POST', `/api/matches/${m.code}/messages`, { body: v }); $('#cIn').value = ''; appendMsg(r.message); }
    catch (ex) { toast(ex.message); }
  };
  try {
    const { messages } = await api('GET', `/api/matches/${m.code}/messages`);
    messages.forEach(appendMsg);
  } catch (e) { toast(e.message); }
}

/** From the reveal screen: leave the game and open the new match's chat. */
export async function openChatFor(code) {
  leave();
  try {
    const { matches } = await api('GET', '/api/matches');
    const m = matches.find(x => x.code === code);
    if (m) { acct.chatCode = code; acct.chatMatch = m; go('chat'); } else go('matches');
  } catch { go('matches'); }
}
