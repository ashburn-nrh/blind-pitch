/* Session lifecycle: start a game (real room or bot) and leave it. */
import { pick, store, toast } from './util.js';
import { BOTS } from './data.js';
import { ROOM, R, L, LOG, setRoom, setGame, setBot, setLive, setConnected, setView, setScreen, resetUi, migrate, blankDraw } from './state.js';
import { save, pushPresence, findPartner } from './sync.js';
import { render, setTop } from './router.js';

export async function start(game){
  setGame(migrate(game)); LOG.length = 0; resetUi(); setLive(null);
  setView('');
  if (L.bot){
    const b = pick(BOTS);
    setBot({ role:'guest', at:1, prof:{...b, self:b.self.slice(), ready:true}, r1:Array(6).fill(null), r3:[null,null,null], flips:[], draw:blankDraw(), date:null, msg:{n:0,text:''}, prefs:b.prefs, hi:b.hi, said:false });
    render(); return;
  }
  save();
  render();
  try {
    setRoom(await ROOM.join('bp-' + L.code.toLowerCase()));
  } catch (e) {
    toast('Couldn\'t open that room. Try again in a moment.'); leave(); return;
  }
  R.onPeers(() => { findPartner(); render(); }, () => {});
  R.onConnection(c => { setConnected(c); setTop(); }, () => {});
  pushPresence();
  render();
}

export function leave(){
  if (R){ R.leave().catch(()=>{}); setRoom(null); }
  if (L && !L.bot) store.del('bp:last');
  setGame(null); setBot(null); setLive(null); setView(''); setScreen(null); resetUi();
  render();
}
