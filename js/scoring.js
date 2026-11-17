/* Scoring, symmetric for both players: derived purely from both sides' recorded moves. */
import { L, P, deck } from './state.js';
import { drawReplay } from './draw/replay.js';

export function replay(){
  const D = deck(), p = P();
  const H = L.role==='host' ? L.flips : (p?.flips||[]);
  const G = L.role==='guest' ? L.flips : (p?.flips||[]);
  const matched = {}; let t=0, up=[], last=null, count=0;
  for (let guard=0; guard<200; guard++){
    const arr = t%2===0 ? H : G, k = Math.floor(t/2)*2;
    if (arr.length >= k+2){
      const a=arr[k], b=arr[k+1];
      const ok = a!==b && !matched[a] && !matched[b] && D[a]===D[b];
      if (ok){ matched[a]=matched[b]=(t%2===0?'host':'guest'); count+=2; }
      last = {a,b,ok,t}; t++;
      if (count===16) break;
    } else { up = arr.slice(k,k+1); break; }
  }
  return { matched, t, up, last, turn: t%2===0 ? 'host' : 'guest', pairs: count/2, done: count===16 };
}

/*
 * Chemistry, 0..100. Every term uses data both players hold, so both see the same number.
 *
 *   4                          base
 * + 4  x matching picks        Same Wavelength  (0..24)
 * + memory points              Memory Duet      (4..24: 24 at <=10 turns, -1.5 per extra turn)
 * + per correct drawing guess  Draw & Guess     (0..24: 8 each + up to 4 for speed, 2 drawings)
 * + 4  x correct reads         Read Them        (0..24: 3 guesses each way)
 *
 * Perfect match = 100. A typical match (3-4 picks in sync, ~16 memory turns, one or two
 * drawings guessed, half the reads right) lands around 55-70. Unlocks stay at 12/30/50/70
 * and the photo is fully clear at 85.
 */
export const SYNC_PTS = 4, READ_PTS = 4;
export const memPoints = turns => Math.max(4, Math.min(24, Math.round(24 - (turns - 10) * 1.5)));

export function score(){
  const p = P(); if (!p) return { chem:0, sync:0, mem:null, mine:0, theirs:0, theirsDone:false, draw:0, drawHits:0 };
  let sync=0; for (let i=0;i<6;i++) if (L.r1[i]!=null && L.r1[i]===p.r1[i]) sync++;
  const rp = replay(); const mem = rp.done ? rp.t : null;
  const dr = drawReplay();
  const mine = L.r3.filter((g,i)=>g!=null && g===p.prof.self[i]).length;
  const theirs = p.r3.filter((g,i)=>g!=null && g===L.prof.self[i]).length;
  const memPts = mem==null ? 0 : memPoints(mem);
  const chem = Math.min(100, 4 + sync*SYNC_PTS + memPts + dr.pts + (mine+theirs)*READ_PTS);
  return { chem, sync, mem, mine, theirs, theirsDone: p.r3.every(x=>x!=null), draw: dr.pts, drawHits: dr.hits };
}
