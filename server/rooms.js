// Caterpillar-Online-Sessions über WebSocket.
//
// Der Server ist Relay + Session-Register. Wichtig: Räume überleben kurze
// Verbindungsabbrüche. Ein Spieler (auch der Host) kann jederzeit mit demselben
// Konto/Code wieder rein – seinen Platz und ggf. die Host-Rolle bekommt er
// zurück. So kann eine Partie über Stunden laufen, ohne dass ein Netz-Hüpfer
// alles beendet. Der Host simuliert autoritativ; fällt er kurz raus, pausiert
// das Spiel, bis er wieder da ist.

import crypto from 'node:crypto';

const rooms = new Map();       // code -> room
const everyone = new Set();    // alle verbundenen Sockets (für Lobby-Broadcast)
const EMPTY_GRACE_MS = 30 * 60 * 1000;   // leere Runde erst nach 30 min entsorgen

function newCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = ''; for (let i = 0; i < 4; i++) c += a[crypto.randomInt(a.length)]; }
  while (rooms.has(c));
  return c;
}

function connectedMembers(room) { return [...room.members.values()].filter((m) => m.connected); }

function roster(room) {
  return {
    code: room.code,
    host: room.hostName,
    teams: room.teams,
    worms: room.worms,
    started: room.started,
    locked: !!room.password,
    players: [...room.members.values()].map((m) => ({ name: m.name, host: m.isHost, connected: m.connected })),
  };
}

function openList() {
  return [...rooms.values()].filter((r) => !r.started)
    .map((r) => ({ code: r.code, host: r.hostName, teams: r.teams, worms: r.worms, players: connectedMembers(r).length, locked: !!r.password }));
}

function send(ws, obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast(room, obj, exceptWs) {
  for (const m of room.members.values()) if (m.ws && m.ws !== exceptWs) send(m.ws, obj);
}
function hostWs(room) { const h = [...room.members.values()].find((m) => m.isHost); return h ? h.ws : null; }

function broadcastLobby() {
  const list = openList();
  for (const ws of everyone) if (!ws.room) send(ws, { t: 'rooms', list });
}

// Verbindung eines Sockets aus dem Raum lösen (Abbruch), aber Mitglied behalten.
function detach(ws) {
  const room = ws.room;
  if (!room) return;
  ws.room = null;
  const m = ws.member;
  if (m && m.ws === ws) { m.connected = false; m.ws = null; }
  ws.member = null;
  if (connectedMembers(room).length === 0) room.emptySince = Date.now();
  broadcast(room, { t: 'room', room: roster(room) });
  broadcastLobby();
}

// Endgültig verlassen (Klick auf „verlassen"): Mitglied entfernen.
function leaveRoom(ws) {
  const room = ws.room;
  if (!room) { return; }
  const wasHost = ws.member?.isHost;
  room.members.delete(ws.member?.key);
  ws.room = null; ws.member = null;
  if (wasHost || room.members.size === 0) {
    broadcast(room, { t: 'closed', reason: wasHost ? 'host-left' : 'empty' });
    for (const m of room.members.values()) { if (m.ws) m.ws.room = null; }
    rooms.delete(room.code);
  } else {
    broadcast(room, { t: 'room', room: roster(room) });
  }
  broadcastLobby();
}

export function handleOpen(ws) { everyone.add(ws); }

export function handleMessage(ws, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  const t = msg.t;

  if (t === 'ping') { send(ws, { t: 'pong' }); return; }
  if (t === 'list') { send(ws, { t: 'rooms', list: openList() }); return; }

  if (t === 'create') {
    if (!ws.authed) return send(ws, { t: 'error', code: 'auth', msg: 'Zum Eröffnen bitte einloggen.' });
    const now = Date.now();
    if (now - (ws._lastCreate || 0) < 4000) return send(ws, { t: 'error', code: 'slow', msg: 'Bitte kurz warten.' });
    if (rooms.size >= 300) return send(ws, { t: 'error', code: 'busy', msg: 'Server ist gerade voll – bitte später erneut.' });
    ws._lastCreate = now;
    detach(ws);
    const code = newCode();
    const key = (ws.name || 'Gast').toLowerCase();
    const room = {
      code, hostName: ws.name || 'Gast', password: (msg.password || '').toString().slice(0, 40) || null,
      teams: clamp(msg.teams, 2, 4), worms: clamp(msg.worms, 1, 6),
      started: false, seed: 0, members: new Map(), createdAt: now, emptySince: 0,
    };
    const m = { key, name: ws.name || 'Gast', isHost: true, teamIdx: 0, ws, connected: true };
    room.members.set(key, m);
    ws.room = room; ws.member = m; ws._teamIdx = 0;
    rooms.set(code, room);
    send(ws, { t: 'created', room: roster(room) });
    broadcastLobby();
    return;
  }

  if (t === 'join') {
    const room = rooms.get(String(msg.code || '').toUpperCase());
    if (!room) return send(ws, { t: 'error', code: 'no-room', msg: 'Keine Session mit diesem Code (evtl. beendet).' });
    if (room.password && (msg.password || '') !== room.password) return send(ws, { t: 'error', code: 'password', msg: 'Falsches oder fehlendes Passwort.' });
    const key = (ws.name || 'Gast').toLowerCase();
    const existing = room.members.get(key);

    detach(ws);   // evtl. aus altem Raum lösen

    if (existing) {
      // Rückkehr: Platz (und Host-Rolle) zurückgeben
      existing.ws = ws; existing.connected = true; existing.name = ws.name || existing.name;
      ws.room = room; ws.member = existing; ws._teamIdx = existing.teamIdx;
      room.emptySince = 0;
      if (room.started) send(ws, { t: 'resume', you: existing.teamIdx, host: existing.isHost, worms: room.worms, seed: room.seed });
      else send(ws, { t: 'joined', room: roster(room) });
      broadcast(room, { t: 'room', room: roster(room) }, ws);
      broadcastLobby();
      return;
    }
    // Neuer Spieler
    if (room.started) return send(ws, { t: 'error', code: 'started', msg: 'Session läuft bereits.' });
    if (connectedMembers(room).length >= room.teams) return send(ws, { t: 'error', code: 'full', msg: 'Session ist voll.' });
    const m = { key, name: ws.name || 'Gast', isHost: false, teamIdx: room.members.size, ws, connected: true };
    room.members.set(key, m);
    ws.room = room; ws.member = m; ws._teamIdx = m.teamIdx;
    room.emptySince = 0;
    send(ws, { t: 'joined', room: roster(room) });
    broadcast(room, { t: 'room', room: roster(room) }, ws);
    broadcastLobby();
    return;
  }

  if (t === 'leave') { leaveRoom(ws); return; }

  const room = ws.room;
  if (!room) return;

  if (t === 'start') {
    if (!ws.member?.isHost) return;
    // Teams den aktuell anwesenden Mitgliedern in Beitrittsreihenfolge zuordnen
    const active = [...room.members.values()].filter((m) => m.connected);
    active.forEach((m, i) => { m.teamIdx = i; if (m.ws) m.ws._teamIdx = i; });
    // nicht anwesende Mitglieder rausnehmen (sie waren beim Start nicht da)
    for (const [k, m] of [...room.members]) if (!m.connected) room.members.delete(k);
    room.teams = active.length;
    room.started = true;
    room.seed = msg.seed | 0;
    for (const m of active) send(m.ws, { t: 'start', seed: room.seed, worms: room.worms, players: active.map((x) => ({ name: x.name, team: x.teamIdx })), you: m.teamIdx, host: m.isHost });
    broadcastLobby();
    return;
  }

  if (t === 'act') { send(hostWs(room), { t: 'act', from: ws.name, team: ws._teamIdx, a: msg.a }); return; }

  if (t === 'snap') { if (!ws.member?.isHost) return; broadcast(room, { t: 'snap', s: msg.s }, ws); return; }

  if (t === 'chat') {
    const now = Date.now();
    ws._chat = (ws._chat || []).filter((x) => now - x < 3000);
    if (ws._chat.length >= 5 || now - (ws._lastChat || 0) < 300) return;
    ws._chat.push(now); ws._lastChat = now;
    const text = String(msg.text || '').slice(0, 200).trim();
    if (text) broadcast(room, { t: 'chat', from: ws.name, text });
    return;
  }
}

export function handleClose(ws) { everyone.delete(ws); detach(ws); }

// verwaiste Räume aufräumen (alle lange weg)
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (connectedMembers(room).length === 0 && room.emptySince && now - room.emptySince > EMPTY_GRACE_MS) {
      rooms.delete(room.code);
    }
  }
}, 60000).unref?.();

function clamp(v, lo, hi) { v = parseInt(v, 10); if (!Number.isFinite(v)) return lo; return Math.max(lo, Math.min(hi, v)); }
