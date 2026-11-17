/*
 * Local stand-in for Claude's live "room" capability.
 *
 * On claude.ai the page gets real-time rooms from window.claude.use("room").
 * Anywhere else (VS Code Live Server, a plain browser) that doesn't exist, so
 * this file provides the same small API using BroadcastChannel. It only links
 * tabs of the SAME browser on the SAME machine: good for development, not for
 * two people on two phones. For that you need a real backend (see README).
 *
 * API used by session.js and sync.js:
 *   room.join(name) -> { presence(patch), peers(), onPeers(fn), onConnection(fn), leave() }
 */
(function () {
  if (window.claude && window.claude.use) return; // real platform present
  window.BP_LOCAL = true;

  const myPeer = Math.random().toString(36).slice(2, 10);

  function join(name) {
    const bc = new BroadcastChannel('blind-pitch:' + name);
    const others = new Map();          // peer -> { presence, updatedAt }
    let mine = {};
    const peerHandlers = [];

    const list = () => [
      { peer: myPeer, sameTab: true, isMe: true, kind: 'viewer', by: null, guest: false, presence: mine, updatedAt: Date.now() },
      ...[...others].map(([peer, v]) => ({ peer, sameTab: false, isMe: false, kind: 'viewer', by: null, guest: false, presence: v.presence, updatedAt: v.updatedAt })),
    ];
    const fire = () => { const peers = list(); peerHandlers.forEach(h => h({ peers, joined: [], left: [], updated: [] })); };

    bc.onmessage = (e) => {
      const d = e.data || {};
      if (d.type === 'presence') { others.set(d.peer, { presence: d.presence, updatedAt: Date.now() }); fire(); }
      if (d.type === 'hello') bc.postMessage({ type: 'presence', peer: myPeer, presence: mine });
      if (d.type === 'bye') { others.delete(d.peer); fire(); }
    };
    bc.postMessage({ type: 'hello' });
    window.addEventListener('pagehide', () => bc.postMessage({ type: 'bye', peer: myPeer }));

    return Promise.resolve({
      name,
      presence(patch) {
        mine = JSON.parse(JSON.stringify({ ...mine, ...patch }));
        bc.postMessage({ type: 'presence', peer: myPeer, presence: mine });
        fire();
        return Promise.resolve();
      },
      peers: list,
      onPeers(fn) { peerHandlers.push(fn); setTimeout(fire); return () => {}; },
      onConnection(fn) { setTimeout(() => fn(true)); return () => {}; },
      connected: () => true,
      leave() { bc.postMessage({ type: 'bye', peer: myPeer }); bc.close(); return Promise.resolve(); },
    });
  }

  window.claude = { use: async (cap) => (cap === 'room' ? { join } : null) };
})();
