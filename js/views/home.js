/* Home: start/join a room, resume, or practice with a bot. In server mode, welcome or lobby. */
import { $, esc, store, toast } from '../util.js';
import { SLOTS } from '../data.js';
import { ROOM, roomReady, newGame, newCode } from '../state.js';
import { gkey } from '../sync.js';
import { start } from '../session.js';
import { avatar } from '../components/avatar.js';
import { SERVER } from '../api.js';
import { buildServerHome } from './account.js';

/** The landing hero, rules and demo card, with `entry` as the call-to-action column. */
export function intro(entry){
  return `<section class="intro">
    <div>
      <div class="eyebrow">A dating game for two strangers</div>
      <h1>Fall for how they <em>play</em>, not how they pose.</h1>
      <p class="lede">You and a stranger each fill in a private card. Then you play four short co-op games together, live, from your own phones. Every bit of chemistry clears their photo a little and unlocks more of who they are.</p>
      <ol class="rules">
        <li><b>R1</b><span><strong>Same Wavelength.</strong> Pick this-or-that. Matching answers build chemistry.</span></li>
        <li><b>R2</b><span><strong>Memory Duet.</strong> Take turns flipping tiles and clear one shared board.</span></li>
        <li><b>R3</b><span><strong>Draw &amp; Guess.</strong> One draws a secret word, the other guesses. Then swap.</span></li>
        <li><b>R4</b><span><strong>Read Them.</strong> Guess how they described themselves.</span></li>
      </ol>
      <div class="entry">${entry}</div>
    </div>
    <div class="intro-art"><div class="card"><div class="photo">${avatar({sk:1,hr:0,bg:0,hs:1},'demo',14)}<span class="tag">PHOTO 0%</span></div>
      <div class="who"><div class="eyebrow">Codename</div><h3>Velvet Otter</h3></div>
      <div class="slots">${SLOTS.map(s=>`<div class="slot"><span class="k">${s.label}</span><span class="v"><span class="lock">unlocks at ${s.at}</span></span></div>`).join('')}</div></div></div>
  </section>`;
}

export function buildHome(){
  if (SERVER) return buildServerHome();
  const resume = (r => r && typeof r.code==='string' && (r.role==='host'||r.role==='guest') ? r : null)(store.get('bp:last'));
  const can = !!ROOM;
  $('#app').innerHTML = intro(`
        <button class="btn" id="host" ${can?'':'disabled'}>Start a room</button>
        <div class="join"><input type="text" id="codeIn" maxlength="5" placeholder="ROOM CODE" aria-label="Room code" autocomplete="off" ${can?'':'disabled'}><button class="btn ghost" id="joinBtn" ${can?'':'disabled'}>Join</button></div>
        ${resume && can ? `<button class="link" id="resume" style="align-self:flex-start">Go back to room ${esc(resume.code)}</button>` : ''}
        <p class="note" id="roomNote">${!roomReady ? 'Connecting to live rooms…' : window.BP_LOCAL ? 'Local mode: rooms work between tabs of this browser. Start a room here, then join it from a second tab.' : can ? 'Both players need to be signed in to Claude, and this page has to be shared with the person you invite.' : 'Live rooms aren\'t available in this view. You can still play a practice round.'}</p>
        <button class="link" id="practice" style="align-self:flex-start">Practice with a bot instead</button>`);
  if (can){
    $('#host').onclick = () => start(newGame(newCode(), 'host'));
    const join = () => { const c = $('#codeIn').value.trim().toUpperCase().replace(/[^A-Z0-9]/g,''); if (c.length!==5){ toast('Room codes have 5 characters'); return; } start(store.get(gkey(c,'guest')) || newGame(c,'guest')); };
    $('#joinBtn').onclick = join;
    $('#codeIn').onkeydown = e => { if (e.key==='Enter') join(); };
    const r = $('#resume'); if (r) r.onclick = () => { const g = store.get(gkey(resume.code, resume.role)); if (g) start(g); else store.del('bp:last'); };
  }
  $('#practice').onclick = () => start(newGame('BOT'+Math.floor(Math.random()*1e6), 'host', true));
}
