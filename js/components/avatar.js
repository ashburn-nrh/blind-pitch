/* SVG stand-in portrait, blurred until chemistry clears it. */
import { BGS, SKINS, HAIRS } from '../data.js';

export function avatar(pr, id, blur){
  const bg = BGS[pr.bg]||BGS[0], skin = SKINS[pr.sk]||SKINS[0], hair = HAIRS[pr.hr]||HAIRS[0];
  const longHair = pr.hs===1 ? `<path d="M58 92 C 54 150, 70 165, 80 170 L 120 170 C 132 165, 146 150, 142 92 Z" fill="${hair}"/>` : '';
  return `<svg viewBox="0 0 200 200" aria-hidden="true" ${id?`id="${id}"`:''} style="filter:blur(${blur||0}px)">
    <defs><linearGradient id="g-${id||'x'}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></linearGradient></defs>
    <rect width="200" height="200" fill="url(#g-${id||'x'})"/>
    <circle cx="160" cy="40" r="26" fill="#ffffff" opacity=".22"/>
    ${longHair}
    <path d="M30 200 C 40 150, 160 150, 170 200 Z" fill="${hair}" opacity=".85"/>
    <rect x="88" y="118" width="24" height="26" rx="8" fill="${skin}"/>
    <ellipse cx="100" cy="92" rx="36" ry="42" fill="${skin}"/>
    <path d="M62 90 C 58 50, 142 42, 140 92 C 132 70, 96 62, 70 78 Z" fill="${hair}"/>
    <circle cx="87" cy="96" r="3.4" fill="#1d1420"/><circle cx="113" cy="96" r="3.4" fill="#1d1420"/>
    <path d="M90 114 Q 100 121 110 114" stroke="#7a3b3b" stroke-width="3" fill="none" stroke-linecap="round"/>
  </svg>`;
}
export const blurFor = c => Math.max(0, 16*(1-c/85));
export const photoPct = c => Math.min(100, Math.round(c/85*100));
