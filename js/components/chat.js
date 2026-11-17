/* Reaction chips (during games) and free-text chat (after a mutual yes). */
import { $, $$, esc, clip } from '../util.js';
import { REACTS } from '../data.js';
import { L, P, LOG, isBot } from '../state.js';
import { save, pushPresence } from '../sync.js';
import { botReply } from '../bot.js';

export function chatHTML(free){
  return `<div class="chat" id="chat" aria-live="polite"></div>
    ${free ? `<form class="say" id="sayForm"><input type="text" id="sayIn" maxlength="200" placeholder="Say something…" autocomplete="off"><button class="btn small">Send</button></form>`
           : `<div class="reacts" id="reacts">${REACTS.map(r=>`<button class="chip" data-r="${esc(r)}">${esc(r)}</button>`).join('')}</div>`}`;
}
export function wireChat(){
  $$('#reacts .chip').forEach(b => b.onclick = () => sendMsg(b.dataset.r));
  const f = $('#sayForm'); if (f) f.onsubmit = e => { e.preventDefault(); const v=$('#sayIn').value.trim(); if (v){ sendMsg(v); $('#sayIn').value=''; } };
  renderChat();
}
export function sendMsg(text){
  L.msg = { n: L.msg.n+1, text: clip(text,200) };
  LOG.push({who:'me', text:L.msg.text}); pushPresence(); renderChat();
  if (isBot()) botReply(text);
}
export function renderChat(){
  const c = $('#chat'); if (!c) return;
  c.innerHTML = '';
  LOG.slice(-6).forEach(m => { const d=document.createElement('div'); d.className='msg'+(m.who==='me'?' me':m.who==='sys'?' sys':''); d.textContent=m.text; c.appendChild(d); });
}
export function checkIncoming(){
  const p = P(); if (!p) return;
  if (p.msg.n > L.seenN){ L.seenN = p.msg.n; if (p.msg.text) LOG.push({who:'them', text:p.msg.text}); save(); renderChat(); }
}
