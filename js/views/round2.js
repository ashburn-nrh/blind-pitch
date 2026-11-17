/* Round 2: Memory Duet (turn-based shared tile board). */
import { $, $$, pick } from '../util.js';
import { L, ui, deck, isBot, partnerOnline } from '../state.js';
import { pushPresence } from '../sync.js';
import { replay, memPoints } from '../scoring.js';
import { render } from '../router.js';
import { botSay } from '../bot.js';

export function updR2(){
  const play = $('#play'); const D = deck(); const rp = replay();
  $('#offline').hidden = partnerOnline();
  if (!$('#grid')){
    play.innerHTML = `<div class="mem-info"><span class="turn" id="turn"></span><span>Pairs <b id="pairs">0/8</b> · Turns <b id="turns">0</b></span></div>
      <div class="grid" id="grid">${D.map((w,i)=>`<button class="tile" data-i="${i}" aria-label="Hidden tile"><span class="in"><span class="f"></span><span class="b" data-by="">${w}</span></span></button>`).join('')}</div><div id="memDone"></div>`;
    $('#grid').onclick = e => {
      const el = e.target.closest('.tile'); if (!el) return;
      const r = replay(), i = +el.dataset.i;
      if (r.done || r.turn!==L.role || ui.flash || r.matched[i] || r.up.includes(i)) return;
      L.flips.push(i); pushPresence(); render();
    };
  }
  // flash a just-missed pair so both players can see it
  if (ui.lastTurns!=null && rp.t > ui.lastTurns && rp.last && !rp.last.ok){
    ui.flash = [rp.last.a, rp.last.b]; clearTimeout(ui.flashT);
    ui.flashT = setTimeout(()=>{ ui.flash=null; render(); }, 1100);
  }
  if (ui.lastTurns!=null && rp.t > ui.lastTurns && rp.last && rp.last.ok && Math.random()<.5 && isBot()){
    botSay(rp.last.t%2===0 ? pick(["Nice one!","Teamwork.","Ooh, good memory."]) : pick(["Got it!","Told you I'm good at this."]));
  }
  ui.lastTurns = rp.t;
  const up = new Set([...(rp.up), ...(ui.flash||[])]);
  $$('.tile', play).forEach(el => {
    const i = +el.dataset.i, m = rp.matched[i];
    el.classList.toggle('done', !!m); el.classList.toggle('up', !m && up.has(i));
    el.querySelector('.b').dataset.by = m ? (m===L.role ? 'you' : 'them') : '';
    el.setAttribute('aria-label', m || up.has(i) ? D[i] : 'Hidden tile');
  });
  const mine = rp.turn===L.role;
  $('#grid').classList.toggle('locked', !mine || !!ui.flash || rp.done);
  const t = $('#turn'); t.className = 'turn' + (mine?'':' theirs');
  t.textContent = rp.done ? 'Board cleared' : mine ? (rp.up.length ? 'Your turn · pick one more' : 'Your turn') : (partnerOnline() ? 'Their turn…' : 'Their turn (they\'re offline)');
  $('#pairs').textContent = rp.pairs+'/8'; $('#turns').textContent = rp.t;
  if (rp.done && !$('#nx')){
    const pts = memPoints(rp.t);
    $('#memDone').innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:14px"><span>Cleared in <b>${rp.t}</b> turns · +${pts} chemistry</span><button class="btn" id="nx">Next round</button></div>`;
    $('#nx').onclick = () => { L.at = 3; pushPresence(); render(); };
  }
}
