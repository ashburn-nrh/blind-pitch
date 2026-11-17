/* The reveal: final chemistry, second-date decision, and open chat on a mutual yes. */
import { $, esc } from '../util.js';
import { L, P, partnerOnline } from '../state.js';
import { pushPresence } from '../sync.js';
import { score } from '../scoring.js';
import { render } from '../router.js';
import { leave } from '../session.js';
import { chatHTML, wireChat } from '../components/chat.js';
import { SERVER } from '../api.js';
import { openChatFor } from './account.js';

export function updEnd(){
  const play = $('#play'); const p = P(); const s = score();
  $('#offline').hidden = partnerOnline();
  const tier = s.chem>=70 ? 'Real spark' : s.chem>=45 ? 'Slow burn' : 'Good company';
  const decided = L.date, theirs = p.date;
  let decision;
  if (!decided){
    decision = `<p>Would you like a second date with ${esc(p.prof.name)}? They won't see your answer unless you both say yes.</p>
      <div class="actions"><button class="btn" id="yes">I'd like a second date</button><button class="btn ghost" id="no">Let's stay friends</button></div>`;
  } else if (!theirs){
    decision = `<div class="wait-line"><span class="pulse"><i></i><i></i><i></i></span>You answered. Waiting for ${esc(p.prof.name)}…</div>`;
  } else if (decided==='yes' && theirs==='yes'){
    decision = SERVER
      ? `<div class="match">It's a match.</div><p>You both said yes. Your chat stays open in Matches, with a few conversation starters from tonight's games.</p><div class="actions"><button class="btn" id="openChat">Open our chat</button></div>`
      : `<div class="match">It's a match.</div><p>You both said yes. The chat below is open now, so plan that second date.</p>`;
  } else {
    decision = `<div class="verdict">Not this time.</div><p class="muted">No second date, but you played four games with a stranger and learned something about them. That counts.</p>`;
  }
  play.innerHTML = `<div class="eyebrow">Final chemistry</div>
    <div class="big-num">${s.chem}</div><div class="verdict">${tier}</div>
    <div class="recap">
      <div><span>Same Wavelength</span><span>${s.sync}/6 in sync</span></div>
      <div><span>Memory Duet</span><span>${s.mem ?? '–'} turns</span></div>
      <div><span>Draw &amp; Guess</span><span>${s.drawHits}/2 guessed</span></div>
      <div><span>You read them</span><span>${s.mine}/3</span></div>
      <div><span>They read you</span><span>${s.theirsDone ? s.theirs+'/3' : 'still guessing'}</span></div>
    </div>
    ${decision}
    <button class="link" id="again" style="align-self:flex-start">Play again with someone new</button>`;
  const set = v => { L.date = v; pushPresence(); render(); };
  if ($('#yes')) $('#yes').onclick = () => set('yes');
  if ($('#no')) $('#no').onclick = () => set('no');
  $('#again').onclick = leave;
  if ($('#openChat')) $('#openChat').onclick = () => openChatFor(L.code);
  const mutual = decided==='yes' && theirs==='yes';
  const hasForm = !!$('#sayForm');
  if (mutual !== hasForm){
    const old = $('#chat').parentElement; $('#chat').remove(); ($('#reacts')||$('#sayForm'))?.remove();
    old.insertAdjacentHTML('beforeend', chatHTML(mutual)); wireChat();
  }
}
