/* The partner profile card that unlocks as chemistry grows. */
import { $, toast } from '../util.js';
import { SLOTS } from '../data.js';
import { L, P, codename, partnerOnline } from '../state.js';
import { score } from '../scoring.js';
import { avatar, blurFor, photoPct } from './avatar.js';

export function partnerCard(){
  return `<aside class="card profile" id="pcard">
    <div class="photo" id="pphoto"></div>
    <div class="who"><div class="eyebrow" id="pwhoLbl">Codename</div><h3 id="pname"></h3></div>
    <div class="slots" id="pslots"></div>
    <div class="meter" id="pmeter"><div class="meter-row"><span class="eyebrow">Chemistry</span><span class="meter-num" id="chemNum">0</span></div>
      <div class="bar"><i id="chemBar"></i></div>
      <div class="ticks">${SLOTS.map(s=>`<span style="left:${s.at}%"></span>`).join('')}</div></div>
  </aside>`;
}

export function updateCard(all=false){
  const p = P(); if (!p || !$('#pcard')) return;
  const { chem } = score();
  const open = s => all || chem >= s.at;
  const photo = $('#pphoto');
  const key = JSON.stringify([p.prof.sk,p.prof.hr,p.prof.bg,p.prof.hs]);
  if (photo.dataset.key !== key){ photo.dataset.key = key; photo.innerHTML = avatar(p.prof,'pava', all?0:blurFor(chem)) + '<span class="tag" id="ptag"></span>'; }
  $('#pava').style.filter = `blur(${all?0:blurFor(chem)}px)`;
  $('#ptag').textContent = all ? 'UNLOCKED' : `PHOTO ${photoPct(chem)}%`;
  const named = open(SLOTS[0]);
  $('#pwhoLbl').textContent = named ? (partnerOnline() ? 'Your match' : 'Your match · offline') : (partnerOnline() ? 'Codename' : 'Codename · offline');
  $('#pname').textContent = named ? p.prof.name : codename(L.code, p.role);
  const slots = $('#pslots');
  SLOTS.forEach((s,i) => {
    let el = slots.children[i];
    if (!el){ el = document.createElement('div'); el.className='slot'; el.innerHTML=`<span class="k">${s.label}</span><span class="v"></span>`; slots.appendChild(el); el.dataset.open = ''; }
    const isOpen = open(s);
    if (el.dataset.open !== String(isOpen)){
      const was = el.dataset.open;
      el.dataset.open = String(isOpen);
      const v = el.querySelector('.v');
      if (isOpen){ v.textContent = s.val(p.prof); if (was==='false'){ el.classList.add('fresh'); toast(`Unlocked: ${s.label}`); } }
      else v.innerHTML = `<span class="lock">unlocks at ${s.at}</span>`;
    }
  });
  $('#pmeter').hidden = all;
  $('#chemNum').textContent = chem;
  $('#chemBar').style.width = chem + '%';
}
