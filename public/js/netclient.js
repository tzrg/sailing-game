// Kleiner WebSocket-Client für die Caterpillar-Online-Sessions.
// Verbindet sich mit demselben Ursprung (…/ws), ruft registrierte Handler je
// Nachrichtentyp auf und hält die Verbindung mit einem App-Ping (alle 20 s)
// frisch, damit Proxys sie bei Inaktivität nicht kappen (z. B. während ein
// Mitspieler am Zug ist).
export function makeNet() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  const handlers = {};
  let keepalive = 0;
  ws.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.t === 'pong') return;
    const fn = handlers[m.t];
    if (fn) fn(m);
  };
  ws.addEventListener('open', () => {
    keepalive = setInterval(() => { if (ws.readyState === 1) ws.send('{"t":"ping"}'); }, 12000);
  });
  ws.addEventListener('close', () => clearInterval(keepalive));
  return {
    ws,
    on(t, fn) { handlers[t] = fn; return this; },
    open(fn) { ws.addEventListener('open', fn); return this; },
    onClose(fn) { ws.addEventListener('close', fn); return this; },
    onError(fn) { ws.addEventListener('error', fn); return this; },
    send(o) { if (ws.readyState === 1) ws.send(JSON.stringify(o)); },
    close() { try { ws.close(); } catch { /* egal */ } },
  };
}
