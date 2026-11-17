/* Step 2: waiting room until the partner locks in their card. */
import { $, esc, toast } from '../util.js';
import { L, P, partnerOnline } from '../state.js';
import { SERVER } from '../api.js';

export function buildWait(){
  $('#app').innerHTML = `<section class="waiting">
    <div class="eyebrow">Step 2 · waiting for your partner</div>
    ${L.kind==='queue' ? '<h2>You\'ve been matched with someone new</h2>' : `<div class="code" id="code">${esc(L.code)}</div>
    <div class="actions"><button class="btn ghost small" id="copy">Copy code</button></div>`}
    <p class="muted" style="max-width:52ch" id="waitMsg"></p>
    <div class="wait-line"><span class="pulse"><i></i><i></i><i></i></span><span id="waitLine"></span></div>
  </section>`;
  if (L.kind!=='queue') $('#copy').onclick = () => {
    const done = () => toast('Code copied');
    try { navigator.clipboard.writeText(L.code).then(done, () => selectCode()); } catch { selectCode(); }
  };
}
function selectCode(){ const r=document.createRange(); r.selectNodeContents($('#code')); const s=getSelection(); s.removeAllRanges(); s.addRange(r); toast('Code selected, copy it from here'); }

export function updWait(){
  const p = P();
  $('#waitMsg').textContent = L.kind==='queue'
    ? 'Neither of you can see the other yet. The game starts as soon as they arrive.'
    : SERVER && L.role==='host'
    ? 'Send this code to the friend you want to play with. They log in, tap Join and enter it.'
    : L.role==='host'
    ? 'Send this code to the person you want to play with. They open this same page, tap Join and enter it. The page needs to be shared with them first.'
    : 'You\'re in the room. The game starts as soon as the other player has locked in their card.';
  $('#waitLine').textContent = !p ? 'Nobody else here yet' : !partnerOnline() ? 'Your partner went offline' : 'Someone is here, finishing their card…';
}
