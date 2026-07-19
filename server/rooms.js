// Caterpillar-Online-Sessions über WebSocket.
//
// Der Server ist ein reiner Relay + Session-Register: Der Host (Spielersteller)
// simuliert das Spiel autoritativ und schickt Snapshots; Gäste schicken nur ihre
// Eingaben. Zusätzlich pflegt er einen „Open Games"-Browser: eingeloggte Spieler
// sehen offene Runden live und treten mit einem Klick bei (optional per Passwort).
// Räume sind flüchtig (nur im Speicher) – sie leben nur, solange gespielt wird.

import crypto from 'node:crypto';

const rooms = new Map();       // code -> room
const everyone = new Set();    // alle verbundenen Sockets (für Lobby-Broadcast)

function newCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = ''; for (let i = 0; i < 4; i++) c += a[crypto.randomInt(a.length)]; }
  while (rooms.has(c));
  return c;
}

function roster(room) {
  return {
    code: room.code,
    host: room.hostName,
    teams: room.teams,
    worms: room.worms,
    started: room.started,
    locked: !!room.password,
    players: [...room.conns].map((ws) => ({ name: ws.name, host: ws === room.hostWs })),
  };
}

function openList() {
  return [...rooms.values()].filter((r) => !r.started)
    .map((r) => ({ code: r.code, host: r.hostName, teams: r.teams, worms: r.worms, players: r.conns.size, locked: !!r.password }));
}

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast(room, obj, except) { for (const ws of room.conns) if (ws !== except) send(ws, obj); }

// Aktualisierte Liste an alle schicken, die gerade im Browser sitzen (kein Raum).
function broadcastLobby() {
  const list = openList();
  for (const ws of everyone) if (!ws.room) send(ws, { t: 'rooms', list });
}

function leaveRoom(ws) {
  const room = ws.room;
  if (!room) return;
  room.conns.delete(ws);
  ws.room = null;
  if (ws === room.hostWs || room.conns.size === 0) {
    broadcast(room, { t: 'closed', reason: ws === room.hostWs ? 'host-left' : 'empty' });
    for (const c of room.conns) c.room = null;
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

  if (t === 'list') { send(ws, { t: 'rooms', list: openList() }); return; }

  if (t === 'create') {
    if (!ws.authed) return send(ws, { t: 'error', code: 'auth', msg: 'Zum Eröffnen bitte einloggen.' });
    const now = Date.now();
    if (now - (ws._lastCreate || 0) < 4000) return send(ws, { t: 'error', code: 'slow', msg: 'Bitte kurz warten.' });
    if (rooms.size >= 300) return send(ws, { t: 'error', code: 'busy', msg: 'Server ist gerade voll – bitte später erneut.' });
    ws._lastCreate = now;
    leaveRoom(ws);
    const code = newCode();
    const pw = (msg.password || '').toString().slice(0, 40) || null;
    const room = {
      code, hostWs: ws, hostName: ws.name || 'Gast', password: pw,
      teams: clamp(msg.teams, 2, 4), worms: clamp(msg.worms, 1, 6),
      started: false, conns: new Set([ws]), createdAt: Date.now(),
    };
    ws.room = room;
    rooms.set(code, room);
    send(ws, { t: 'created', room: roster(room) });
    broadcastLobby();
    return;
  }

  if (t === 'join') {
    const room = rooms.get(String(msg.code || '').toUpperCase());
    if (!room) return send(ws, { t: 'error', code: 'no-room', msg: 'Keine Session mit diesem Code.' });
    if (room.started) return send(ws, { t: 'error', code: 'started', msg: 'Session läuft bereits.' });
    if (room.conns.size >= room.teams) return send(ws, { t: 'error', code: 'full', msg: 'Session ist voll.' });
    if (room.password && (msg.password || '') !== room.password) return send(ws, { t: 'error', code: 'password', msg: 'Falsches oder fehlendes Passwort.' });
    leaveRoom(ws);
    room.conns.add(ws);
    ws.room = room;
    send(ws, { t: 'joined', room: roster(room) });
    broadcast(room, { t: 'room', room: roster(room) }, ws);
    broadcastLobby();
    return;
  }

  if (t === 'leave') { leaveRoom(ws); return; }

  const room = ws.room;
  if (!room) return;

  if (t === 'start') {
    if (ws !== room.hostWs) return;
    room.started = true;
    const players = [...room.conns];
    const assign = players.map((c, i) => ({ name: c.name, team: i }));
    room.teams = players.length;
    for (const c of room.conns) {
      c._teamIdx = assign.find((a) => a.name === c.name)?.team ?? 0;
      send(c, { t: 'start', seed: msg.seed | 0, worms: room.worms, players: assign, you: c._teamIdx, host: c === room.hostWs });
    }
    broadcastLobby();
    return;
  }

  if (t === 'act') { send(room.hostWs, { t: 'act', from: ws.name, team: ws._teamIdx, a: msg.a }); return; }

  if (t === 'snap') { if (ws !== room.hostWs) return; broadcast(room, { t: 'snap', s: msg.s }, ws); return; }

  if (t === 'chat') {
    // Flood-Schutz: max. 5 Nachrichten in 3 s, min. 300 ms Abstand.
    const now = Date.now();
    ws._chat = (ws._chat || []).filter((x) => now - x < 3000);
    if (ws._chat.length >= 5 || now - (ws._lastChat || 0) < 300) return;
    ws._chat.push(now); ws._lastChat = now;
    const text = String(msg.text || '').slice(0, 200).trim();
    if (text) broadcast(room, { t: 'chat', from: ws.name, text });
    return;
  }
}

export function handleClose(ws) { everyone.delete(ws); leaveRoom(ws); }

function clamp(v, lo, hi) { v = parseInt(v, 10); if (!Number.isFinite(v)) return lo; return Math.max(lo, Math.min(hi, v)); }
