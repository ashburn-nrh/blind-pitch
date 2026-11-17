/* Step 1: build your secret card. */
import { $, $$, esc } from '../util.js';
import { BGS, SKINS, HAIRS, SELFQ } from '../data.js';
import { L } from '../state.js';
import { save, pushPresence } from '../sync.js';
import { render } from '../router.js';
import { avatar } from '../components/avatar.js';

export function buildProfile(){
  const pr = L.prof;
  const sw = (key, list, fn) => list.map((v,i)=>`<button type="button" class="sw" data-k="${key}" data-i="${i}" aria-pressed="${pr[key]===i}" aria-label="${key} option ${i+1}" style="background:${fn(v)}"></button>`).join('');
  $('#app').innerHTML = `<section class="form">
    <div class="fields">
      <div><div class="eyebrow">Room ${esc(L.code)} · step 1</div><h2 style="font-size:clamp(28px,4.5vw,40px);margin-top:6px">Make your secret card</h2>
        <p class="muted" style="margin-top:6px;max-width:56ch">Your partner sees none of this at first. Each piece unlocks as your chemistry grows, and everything is revealed at the end.</p></div>
      <div class="row2">
        <div class="field"><label for="f-name">First name</label><input type="text" id="f-name" maxlength="24" value="${esc(pr.name)}"></div>
        <div class="field"><label for="f-age">Age</label><input type="number" id="f-age" min="18" max="99" value="${esc(pr.age)}"></div>
      </div>
      <div class="field"><label for="f-city">City</label><input type="text" id="f-city" maxlength="40" value="${esc(pr.city)}"></div>
      <div class="field"><label for="f-song">Song on repeat</label><input type="text" id="f-song" maxlength="60" placeholder="Song by Artist" value="${esc(pr.song)}"></div>
      <div class="field"><label for="f-bio">Bio</label><textarea id="f-bio" maxlength="160" placeholder="One or two lines about you">${esc(pr.bio)}</textarea><small>Up to 160 characters. Keep contact details out of it; you can swap those after a mutual yes.</small></div>
      <div class="field"><span class="lbl">Your portrait</span><small>No real photos. Build a little stand-in.</small>
        <div class="chips">${sw('bg',BGS,v=>`linear-gradient(135deg,${v[0]},${v[1]})`)}</div>
        <div class="chips">${sw('sk',SKINS,v=>v)}</div>
        <div class="chips">${sw('hr',HAIRS,v=>v)}</div>
        <div class="chips"><button type="button" class="chip" data-k="hs" data-i="0" aria-pressed="${pr.hs===0}">Short hair</button><button type="button" class="chip" data-k="hs" data-i="1" aria-pressed="${pr.hs===1}">Long hair</button></div>
      </div>
      ${SELFQ.map((q,qi)=>`<div class="field"><span class="lbl">${q.me}</span><div class="chips">${q.opts.map((o,oi)=>`<button type="button" class="chip" data-q="${qi}" data-o="${oi}" aria-pressed="${pr.self[qi]===oi}">${esc(o)}</button>`).join('')}</div></div>`).join('')}
      <div class="err" id="ferr"></div>
      <button class="btn" id="ready" style="align-self:flex-start">Lock in my card</button>
    </div>
    <div class="card preview" id="preview"></div>
  </section>`;
  const prev = () => { $('#preview').innerHTML = `<div class="photo">${avatar(pr,'me',0)}<span class="tag">WHAT THEY'LL UNLOCK</span></div><div class="who"><div class="eyebrow">Your card</div><h3>${esc(pr.name||'Your name')}${pr.age?', '+esc(pr.age):''}</h3></div><p class="muted" style="font-size:13.5px">${esc(pr.city||'City')} · ${esc(pr.song||'Song on repeat')}</p>`; };
  prev();
  ['name','age','city','song','bio'].forEach(k => $('#f-'+k).oninput = e => { pr[k] = e.target.value; prev(); save(); });
  $$('[data-k]').forEach(b => b.onclick = () => { pr[b.dataset.k] = +b.dataset.i; $$(`[data-k="${b.dataset.k}"]`).forEach(x=>x.setAttribute('aria-pressed', x===b)); prev(); save(); });
  $$('[data-q]').forEach(b => b.onclick = () => { pr.self[+b.dataset.q] = +b.dataset.o; $$(`[data-q="${b.dataset.q}"]`).forEach(x=>x.setAttribute('aria-pressed', x===b)); save(); });
  $('#ready').onclick = () => {
    const age = parseInt(pr.age,10);
    const err = !pr.name.trim() ? 'Add your first name.' : !(age>=18 && age<=99) ? 'Blind Pitch is for adults: enter an age of 18 or over.' : pr.self.some(x=>x==null) ? 'Answer the three questions about yourself.' : '';
    $('#ferr').textContent = err; if (err) return;
    pr.name = pr.name.trim(); pr.age = age; pr.ready = true;
    pushPresence(); render();
  };
}
