/* Blind Pitch entry point: first paint, then pick a mode and connect.
 *   server mode  served by server/: accounts, matchmaking, server-checked games, chat
 *   room mode    claude.ai live rooms, or local-room.js between tabs of one browser
 */
import { setRoomCap, setView } from './state.js';
import { render, stage } from './router.js';
import { detectServer } from './api.js';
import { netRoom } from './net-room.js';
import { loadMe, wireServerEvents } from './views/account.js';

render();
(async () => {
  if (await detectServer()) {
    await loadMe();
    wireServerEvents();
    setRoomCap(netRoom);
  } else {
    let cap = null;
    try { cap = window.claude?.use ? await window.claude.use("room") : null; } catch { cap = null; }
    setRoomCap(cap);
  }
  if (stage()==='home'){ setView(''); render(); }
})();
