/* Decides which screen to show and (re)renders it. */
import { $, esc } from './util.js';
import { L, P, ui, currentView, setView, codename, isBot, partnerOnline, screen, acct } from './state.js';
import { SERVER } from './api.js';
import { SCREENS, runScreenCleanup } from './views/account.js';
import { openSafety } from './components/safety.js';
import { leave } from './session.js';
import { botTick } from './bot.js';
import { partnerCard, updateCard } from './components/partner-card.js';
import { chatHTML, wireChat, checkIncoming } from './components/chat.js';
import { buildHome } from './views/home.js';
import { buildProfile } from './views/profile.js';
import { buildWait, updWait } from './views/wait.js';
import { updR1 } from './views/round1.js';
import { updR2 } from './views/round2.js';
import { updDraw, stopDraw } from './views/draw.js';
import { updR3 } from './views/round3.js';
import { updEnd } from './views/end.js';

const ROUNDS = 4;

export function setTop(){
  const t = $('#topRight');
  if (!L){ t.innerHTML = `<span class="eyebrow">Play first. Look later.</span>`; return; }
  const on = partnerOnline();
  const canReport = SERVER && !L.bot && acct.user && !!P();      // only once there is someone to report
  t.innerHTML = `<span class="eyebrow">You are ${esc(codename(L.code, L.role))}</span>
    ${L.bot ? `<span class="status on"><i></i>Practice mode</span>` : `<span class="status ${on?'on':''}"><i></i>${on ? 'Partner online' : 'Partner offline'}</span><span class="eyebrow">Room ${esc(L.code)}</span>`}
    ${canReport ? '<button class="link" id="report">Report</button>' : ''}
    <button class="link" id="leave">Leave</button>`;
  $('#leave').onclick = leave;
  if (canReport) $('#report').onclick = () => openSafety({ code: L.code, onDone: leave });
}

export function stage(){
  if (!L) return screen || 'home';           // screen: account screens in server mode
  if (!L.prof.ready) return 'profile';
  const p = P();
  if (!p || !p.prof.ready) return 'wait';
  if (L.at < 1) L.at = 1;
  // L.at: 1 Same Wavelength, 2 Memory Duet, 3 Draw & Guess, 4 Read Them, 5 reveal
  return ['','r1','r2','draw','r3','end'][Math.min(L.at,5)];
}

const UPDATERS = { r1:updR1, r2:updR2, draw:updDraw, r3:updR3, end:updEnd, wait:updWait };

export function render(){
  const s = stage();
  if (s !== 'draw') stopDraw();                  // drop the round's timers and canvas once we leave it
  if (s !== currentView){ runScreenCleanup(); setView(s); build(s); }
  setTop();
  if (['r1','r2','draw','r3','end'].includes(s)){ updateCard(s==='end'); checkIncoming(); }
  (UPDATERS[s] || (() => {}))();
  if (isBot()) botTick();
}

const ROUND_HEADS = {
  r1:[1,"Same Wavelength","Pick one. They pick too. You'll see both answers once you've both chosen."],
  r2:[2,"Memory Duet","Take turns flipping two tiles. Every pair counts for both of you. Fewer turns means more chemistry."],
  draw:[3,"Draw & Guess","One of you draws a secret word, the other has three guesses and 45 seconds. Then swap."],
  r3:[4,"Read Them","Before the game, they answered three questions about themselves. Guess what they said."],
};

function build(s){
  const app = $('#app');
  if (SCREENS[s]) return SCREENS[s]();
  if (s==='home') return buildHome();
  if (s==='profile') return buildProfile();
  if (s==='wait') return buildWait();
  const head = ROUND_HEADS[s];
  const free = s==='end';
  app.innerHTML = `<section class="game">${partnerCard()}
    <div class="stage">
      ${head ? `<div class="round-head"><div><div class="eyebrow">Round ${head[0]} of ${ROUNDS}</div><h2>${head[1]}</h2><p>${head[2]}</p></div>
        <div class="dots">${Array.from({length:ROUNDS},(_,i)=>i+1).map(i=>`<span class="${i<=head[0]?'on':''}"></span>`).join('')}</div></div>` : ''}
      <div id="offline" class="banner" hidden>Your partner is offline. Their moves will show up here when they come back.</div>
      <div class="card" id="play"></div>
      ${chatHTML(free)}
    </div></section>`;
  wireChat();
  if (s==='r2'){ ui.lastTurns = null; ui.flash = null; }
}
