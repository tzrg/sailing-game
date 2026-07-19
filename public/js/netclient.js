// Kleiner WebSocket-Client für die Caterpillar-Online-Sessions.
// Verbindet sich mit demselben Ursprung (…/ws) und ruft registrierte Handler
// je Nachrichtentyp auf.
export function makeNet() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  const handlers = {};
  ws.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    const fn = handlers[m.t];
    if (fn) fn(m);
  };
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
