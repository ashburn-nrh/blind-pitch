/* Round 1: Same Wavelength (this-or-that). */
import { $, $$ } from '../util.js';
import { QS } from '../data.js';
import { L, P, ui, qOrder, partnerOnline } from '../state.js';
import { pushPresence } from '../sync.js';
import { score, SYNC_PTS } from '../scoring.js';
import { render } from '../router.js';

export function updR1(){
  const p = P(); const play = $('#play'); const order = qOrder();
  $('#offline').hidden = partnerOnline();
  const q = order.findIndex(i => L.r1[i]==null);
  const k = q===-1 ? 5 : q-1;               // last question I answered (position)
  if (k>=0 && !ui.r1shown.has(k)){
    const qi = order[k], mine = L.r1[qi], theirs = p.r1[qi];
    const btn = (c) => `<button class="choice ${mine===c?'mine':''}" disabled>${QS[qi][c]}${mine===c?'<span class="pin you">YOU</span>':''}${theirs===c?'<span class="pin them">THEM</span>':''}</button>`;
    play.innerHTML = `<div class="qcount">Question ${k+1} of 6</div><div class="vs">${btn(0)}<span class="or">or</span>${btn(1)}</div>
      ${theirs==null ? `<div class="wait-line"><span class="pulse"><i></i><i></i><i></i></span>Waiting for their pick…</div>` : `<div class="wait-line">${mine===theirs ? `In sync. +${SYNC_PTS} chemistry` : 'Different picks.'}</div>`}`;
    if (theirs!=null && !ui.r1timer){ ui.r1timer = setTimeout(()=>{ ui.r1timer=null; ui.r1shown.add(k); render(); }, 1700); }
    return;
  }
  if (q!==-1){
    const qi = order[q];
    play.innerHTML = `<div class="qcount">Question ${q+1} of 6</div><div class="vs"><button class="choice" data-c="0">${QS[qi][0]}</button><span class="or">or</span><button class="choice" data-c="1">${QS[qi][1]}</button></div>`;
    $$('.choice', play).forEach(b => b.onclick = () => { L.r1[qi] = +b.dataset.c; pushPresence(); render(); });
    return;
  }
  const { sync } = score();
  play.innerHTML = `<div class="sum"><h3>${sync} of 6 in sync</h3><p class="muted">${sync>=4?'Strong start. They noticed.':sync>=2?'A few sparks. Plenty of game left.':'Very different people. That can be fun too.'}</p><button class="btn" id="nx">Next round</button></div>`;
  $('#nx').onclick = () => { L.at = 2; pushPresence(); render(); };
}
