/* Round 4: Read Them (guess the partner's self-description). Stage key stays 'r3'. */
import { $, $$, esc } from '../util.js';
import { SELFQ } from '../data.js';
import { L, P, ui, partnerOnline } from '../state.js';
import { pushPresence } from '../sync.js';
import { score, READ_PTS } from '../scoring.js';
import { render } from '../router.js';

export function updR3(){
  const play = $('#play'); const p = P();
  $('#offline').hidden = partnerOnline();
  if (ui.r3show){
    const { q } = ui.r3show, g = L.r3[q], a = p.prof.self[q];
    // In server mode their answer is only sent once my guess has reached the server.
    if (a == null){
      play.innerHTML = `<div class="qcard"><div class="qcount">Question ${q+1} of 3</div><h3>${SELFQ[q].them}</h3>
        <div class="wait-line"><span class="pulse"><i></i><i></i><i></i></span>Checking their answer…</div></div>`;
      return;
    }
    if (!ui.r3show.t) ui.r3show.t = setTimeout(()=>{ ui.r3show = null; render(); }, 1600);
    play.innerHTML = `<div class="qcard"><div class="qcount">Question ${q+1} of 3</div><h3>${SELFQ[q].them}</h3>
      <div class="opts">${SELFQ[q].opts.map((o,i)=>`<button class="opt ${i===a?'right':''} ${i===g&&g!==a?'wrong':''}" disabled>${esc(o)}</button>`).join('')}</div>
      <div class="wait-line">${g===a ? `You read them right. +${READ_PTS} chemistry` : 'Not quite. Now you know.'}</div></div>`;
    return;
  }
  const q = L.r3.findIndex(x=>x==null);
  if (q!==-1){
    play.innerHTML = `<div class="qcard"><div class="qcount">Question ${q+1} of 3</div><h3>${SELFQ[q].them}</h3>
      <div class="opts">${SELFQ[q].opts.map((o,i)=>`<button class="opt" data-o="${i}">${esc(o)}</button>`).join('')}</div></div>`;
    $$('.opt', play).forEach(b => b.onclick = () => {
      L.r3[q] = +b.dataset.o; pushPresence();
      ui.r3show = { q, t:null }; render();
    });
    return;
  }
  const s = score();
  play.innerHTML = `<div class="sum"><h3>You got ${s.mine} of 3</h3><p class="muted">${s.theirsDone ? `They guessed ${s.theirs} of 3 about you.` : 'They\'re still guessing about you.'} The games are over. Time to see who you've been playing with.</p><button class="btn" id="nx">Reveal everything</button></div>`;
  $('#nx').onclick = () => { L.at = 5; pushPresence(); render(); };
}
