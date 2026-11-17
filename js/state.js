/*
 * Shared game state.
 *
 * ES module imports are read-only views, so the reassignable values below are
 * exported as live bindings and changed only through the setters. Reading
 * `L.role` from any module always sees the current value.
 */
import { rng, hash, sshuffle } from './util.js';
import { ADJ, NOUN, WORDS } from './data.js';

export let ROOM = null, roomReady = false;   // lobby namespace
export let R = null;                         // named room for this game
export let L = null;                         // my local game state (persisted)
export let B = null;                         // bot partner state (practice mode)
export let live = null;                      // partner's live presence
export let connected = false;
export let currentView = '';

export const setRoomCap = r => { ROOM = r; roomReady = true; };
export const setRoom = r => { R = r; };
export const setGame = g => { L = g; };
export const setBot = b => { B = b; };
export const setLive = p => { live = p; };
export const setConnected = c => { connected = c; };
export const setView = v => { currentView = v; };

export let screen = null;                    // non-game screen while no game is open (server mode)
export const setScreen = s => { screen = s; };
/* Account state, only used when the app is served by server/ (see js/api.js). */
export const acct = { user:null, profile:null, dailyLeft:0, chatCode:null };

export const LOG = [];                       // chat lines this session

/* Per-session UI state (timers, animations, what has been shown). Never synced or saved. */
const makeUi = () => ({
  r1shown:new Set(), r1timer:null, flash:null, flashT:null, lastTurns:null, r3show:null, botBusy:false, prevChem:null,
  // Draw & Guess
  pad:null, drawTimer:null, drawRevealT:null, drawPopT:null, drawIdx:-1, drawSumKey:'',
  drawSeen:new Set(),        // drawings whose end-of-drawing reveal has finished
  drawLive:new Set(),        // drawings seen while still in play (only these get a celebration)
  drawCeleb:new Set(),       // drawings already celebrated
  drawPrevG:{ idx:-1, n:0 }, // last seen guess count, to pop "not quite"
  drawTool:{ c:0, sz:1 },
});
export const ui = makeUi();
export function resetUi(){
  clearTimeout(ui.r1timer); clearTimeout(ui.flashT);
  clearInterval(ui.drawTimer); clearTimeout(ui.drawRevealT); clearTimeout(ui.drawPopT);
  ui.pad?.destroy();
  Object.assign(ui, makeUi());
}

/* ---- factories ---- */
export const GAME_VER = 2;
export const blankDraw = () => ({ s:'', e:0, g:[], t:[], x:0 });
export function codename(code, role){ const r = rng(hash(code+':'+role)); return `${ADJ[Math.floor(r()*ADJ.length)]} ${NOUN[Math.floor(r()*NOUN.length)]}`; }
export function newCode(){ const A="ABCDEFGHJKMNPQRSTUVWXYZ23456789"; let s=''; for (let i=0;i<5;i++) s+=A[Math.floor(Math.random()*A.length)]; return s; }
export function blankProf(){ return { name:'', age:'', city:'', song:'', bio:'', sk:0, hr:0, bg:0, hs:0, self:[null,null,null], ready:false }; }
export function newGame(code, role, bot=false){
  return { ver:GAME_VER, code, role, bot, at:0, prof:blankProf(), r1:Array(6).fill(null), flips:[], draw:blankDraw(), dl:{ el:[0,0] },
           r3:[null,null,null], date:null, msg:{n:0,text:''}, seenN:0, lastP:null };
}
/**
 * Bring a game saved by an older version up to date.
 * v1 had 3 rounds (at: 1 r1, 2 r2, 3 r3, 4 end); v2 inserts Draw & Guess at 3.
 * `dl` holds local-only Draw & Guess state (seconds elapsed per drawing); it is saved, never sent.
 */
export function migrate(g){
  if (!g.ver){ if (g.at >= 3) g.at += 1; g.ver = GAME_VER; }
  g.draw = g.draw || blankDraw();
  g.dl = g.dl && Array.isArray(g.dl.el) ? g.dl : { el:[0,0] };
  return g;
}

/* ---- derived ---- */
export const isBot = () => !!L?.bot;
export const P = () => isBot() ? B : (live || L?.lastP || null);   // the partner, real or bot
export const partnerOnline = () => isBot() || !!live;
export const deck = () => sshuffle(WORDS.concat(WORDS), rng(hash(L.code+':deck')));
export const qOrder = () => sshuffle([0,1,2,3,4,5], rng(hash(L.code+':qs')));
