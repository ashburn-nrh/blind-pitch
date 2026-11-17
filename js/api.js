/*
 * Talking to server/. When the page is served by the Blind Pitch server, /api/health answers
 * and the app runs in "server mode": accounts, matchmaking, server-checked games and chat.
 * Anywhere else (live-server, claude.ai) SERVER stays false and the app works as before.
 */
export let SERVER = false;

export async function detectServer() {
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    SERVER = r.ok && (await r.json()).ok === true;
  } catch { SERVER = false; }
  return SERVER;
}

/** JSON request. Throws an Error with the server's friendly message (and .status) on failure. */
export async function api(method, path, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (method !== 'GET') { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body ?? {}); }
  let r;
  try { r = await fetch(path, opts); } catch { throw Object.assign(new Error('You seem to be offline.'), { status: 0 }); }
  let data = {};
  try { data = await r.json(); } catch {}
  if (!r.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: r.status });
  return data;
}
