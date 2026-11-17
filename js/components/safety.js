/* Report / block / unmatch sheet, used in games and in chats (server mode). */
import { $, $$, toast } from '../util.js';
import { api } from '../api.js';

const REASONS = [
  ['harassment', 'Harassment or threats'], ['inappropriate', 'Sexual or inappropriate'], ['spam', 'Spam or scam'],
  ['underage', 'Seems under 18'], ['fake', 'Fake profile'], ['other', 'Something else'],
];

export function openSafety({ code, allowUnmatch = false, onDone }) {
  document.querySelector('.sheet-wrap')?.remove();
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet card" role="dialog" aria-modal="true" aria-labelledby="sTitle">
    <h3 id="sTitle">Report or block</h3>
    <p class="muted">They won't be told who reported them. Blocking ends this game or chat, and the two of you won't be matched again.</p>
    <div class="chips" role="group" aria-label="Reason">${REASONS.map(([k, l]) => `<button type="button" class="chip" data-r="${k}" aria-pressed="false">${l}</button>`).join('')}</div>
    <textarea id="sDetails" maxlength="1000" placeholder="Anything else we should know? (optional)" aria-label="Details"></textarea>
    <div class="err" id="sErr" role="alert"></div>
    <div class="actions">
      <button type="button" class="btn" id="sReport">Report and block</button>
      <button type="button" class="btn ghost" id="sBlock">Just block</button>
      ${allowUnmatch ? '<button type="button" class="btn ghost" id="sUnmatch">Unmatch</button>' : ''}
      <button type="button" class="link" id="sCancel">Cancel</button>
    </div></div>`;
  document.body.appendChild(wrap);
  let reason = null;
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  $$('[data-r]', wrap).forEach(b => b.onclick = () => { reason = b.dataset.r; $$('[data-r]', wrap).forEach(x => x.setAttribute('aria-pressed', x === b)); });
  const act = async (what, payload, message) => {
    $$('button', wrap).forEach(b => b.disabled = true);
    try {
      await api('POST', `/api/matches/${encodeURIComponent(code)}/${what}`, payload);
      close(); toast(message); onDone?.();
    } catch (e) {
      $('#sErr', wrap).textContent = e.message;
      $$('button', wrap).forEach(b => b.disabled = false);
    }
  };
  $('#sReport', wrap).onclick = () => {
    if (!reason) { $('#sErr', wrap).textContent = 'Choose a reason first.'; return; }
    act('report', { reason, details: $('#sDetails', wrap).value }, 'Thanks for telling us. They are blocked.');
  };
  $('#sBlock', wrap).onclick = () => act('block', {}, 'Blocked. You won\'t see them again.');
  if (allowUnmatch) $('#sUnmatch', wrap).onclick = () => act('unmatch', {}, 'Unmatched.');
  $('#sCancel', wrap).onclick = close;
  $('[data-r]', wrap).focus();
}
