/* Practice-mode bot: answers, flips tiles, draws, guesses and chats like a second player. */
import { pick, sleep } from './util.js';
import { SAME, DIFF } from './data.js';
import { L, B, ui, deck } from './state.js';
import { replay, score } from './scoring.js';
import { render, stage } from './router.js';
import { drawReplay } from './draw/replay.js';
import { DRAW_WORDS, DRAW_SECS, MAX_GUESSES, checkGuess } from './draw/rules.js';
import { BOT_DRAWINGS } from './draw/bot-drawings.js';
import { encodeStroke, decode } from './draw/codec.js';

export function botSay(text, delay=900){
  setTimeout(()=>{ if (!B) return; B.msg = { n:B.msg.n+1, text }; render(); }, delay);
}
export function botReply(){ if (Math.random()<.6) botSay(pick(["Ha, okay.","Agreed.","You're funny.","Focus! We're winning this."]), 1200); }

export function botTick(){
  if (!B || ui.botBusy) return;
  const s = stage();
  if (!B.said && (s==='r1')){ B.said = true; botSay(B.hi, 600); }
  B.at = Math.max(B.at, L.at);
  if (s==='r1'){
    const qi = [0,1,2,3,4,5].find(i => L.r1[i]!=null && B.r1[i]==null);
    if (qi!=null){ ui.botBusy = true; setTimeout(()=>{ ui.botBusy=false; if(!B) return; B.r1[qi] = B.prefs[qi]; if (Math.random()<.6) botSay(L.r1[qi]===B.prefs[qi] ? pick(SAME) : pick(DIFF), 500); render(); }, 900); }
  }
  if (L.at>=2){
    const rp = replay();
    if (!rp.done && rp.turn==='guest' && !ui.flash){ ui.botBusy = true; botMove(rp); return; }
  }
  if (s==='draw' && botDraw()) return;
  if (L.at>=4){
    const qi = B.r3.findIndex(x=>x==null);
    if (qi!==-1){ ui.botBusy = true; setTimeout(()=>{ ui.botBusy=false; if(!B) return; B.r3[qi] = Math.random()<.6 ? L.prof.self[qi] : pick([0,1,2]); render(); }, 1500); }
  }
  if (L.date && !B.date){
    ui.botBusy = true;
    setTimeout(()=>{ ui.botBusy=false; if(!B) return; const c = score().chem; B.date = c>=45 ? 'yes' : 'no';
      botSay(B.date==='yes' ? "Yes! Okay, where are we going?" : "You were really fun to play with. Friends?", 300); render(); }, 1800);
  }
}

async function botMove(rp){
  const D = deck();
  const all = L.flips.concat(B.flips); const seen = new Map();
  all.forEach(i => { if (!rp.matched[i]) seen.set(i, D[i]); });
  const open = D.map((_,i)=>i).filter(i=>!rp.matched[i]);
  const recall = Math.random() < .75;
  let a, b;
  if (recall){ for (const [i,w] of seen){ const j=[...seen].find(([k,x])=>k!==i&&x===w); if (j){ a=i; b=j[0]; break; } } }
  if (a==null){ const unseen = open.filter(i=>!seen.has(i)); a = unseen.length ? pick(unseen) : pick(open); }
  await sleep(800); if (!B) return;
  B.flips.push(a); render();
  if (b==null){ const m = recall && [...seen].find(([k,w])=>k!==a && w===D[a]); if (m) b=m[0]; else { const rest=open.filter(i=>i!==a && !seen.has(i)); b = rest.length?pick(rest):pick(open.filter(i=>i!==a)); } }
  await sleep(700); if (!B) return;
  B.flips.push(b); ui.botBusy = false; render();
}

/*
 * Draw & Guess. In practice mode the player is always the host, so the player draws first
 * (bot guesses), then the bot draws (player guesses). The bot writes B.draw exactly like a
 * partner's presence would look, so the round logic doesn't know it's a bot.
 * Returns true if it scheduled something (botBusy is set until it runs).
 */
function botDraw(){
  const dr = drawReplay(), k = dr.cur;
  if (dr.items[1]?.correct && !B.cheered){ B.cheered = true; botSay(pick(["YES! You got it!","Okay, I'm basically an artist now.","Nailed it, both of us."]), 500); }
  if (k >= dr.items.length) return false;
  if (k > 0 && !ui.drawSeen.has(k-1)) return false;      // player is still looking at the last reveal
  const it = dr.items[k];

  if (k === 0){
    // Bot guesses. Always one wrong guess first; then right about 60% of the time.
    if (!it.s || B.draw.g.length >= MAX_GUESSES) return false;
    const n = B.draw.g.length;
    if (B.drawPlan == null) B.drawPlan = Math.random() < .6;
    ui.botBusy = true;
    setTimeout(()=>{
      ui.botBusy = false; if (!B) return;
      const now = drawReplay();
      if (now.cur !== 0) { render(); return; }               // drawing ended meanwhile
      const word = now.items[0].word;
      const right = n >= 1 && B.drawPlan;
      const g = right ? word : pick(DRAW_WORDS.filter(w => !checkGuess(w, word) && !B.draw.g.includes(w)));
      B.draw.g.push(g); B.draw.t.push(Math.min(DRAW_SECS, L.dl.el[0] || 0));
      if (right) botSay(pick(["Wait, I know this one!","Ha, that's a great drawing.","That was SO clear."]), 700);
      else if (n === 0) botSay(pick(["Hmm, let me squint…","Okay, wild guess.","Ooh, I think I know."]), 200);
      render();
    }, n === 0 ? 7000 + Math.random()*4000 : 4500 + Math.random()*3000);
    return true;
  }

  // k === 1: bot draws, one pre-made stroke at a time, at a human-ish pace.
  if (B.draw.e || it.over) return false;
  const plan = BOT_DRAWINGS[it.word]; if (!plan) return false;
  const doneStrokes = decode(B.draw.s).length;
  if (doneStrokes >= plan.length) return false;
  const st = plan[doneStrokes];
  ui.botBusy = true;
  setTimeout(()=>{
    ui.botBusy = false; if (!B) return;
    const now = drawReplay();
    if (now.cur === 1 && !now.items[1].over) B.draw.s += encodeStroke(st);
    render();
  }, (doneStrokes === 0 ? 1500 : 500) + st.pts.length * 90);
  return true;
}
