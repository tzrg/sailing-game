// Caterpillar-Online-Sessions über WebSocket.
//
// Der Server ist ein reiner Relay + Session-Register: Der Host (Spielersteller)
// simuliert das Spiel autoritativ und schickt Snapshots; Gäste schicken nur ihre
// Eingaben. Der Server leitet weiter und verwaltet, wer in welchem Raum ist.
// Räume sind flüchtig (nur im Speicher) – sie leben nur, solange gespielt wird.

import crypto from 'node:crypto';

const rooms = new Map();   // code -> room

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
    players: [...room.conns].map((ws) => ({ name: ws.name, host: ws === room.hostWs })),
  };
}

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}
function broadcast(room, obj, except) {
  for (const ws of room.conns) if (ws !== except) send(ws, obj);
}

function leaveRoom(ws) {
  const room = ws.room;
  if (!room) return;
  room.conns.delete(ws);
  ws.room = null;
  if (ws === room.hostWs || room.conns.size === 0) {
    // Host weg oder leer -> Raum auflösen
    broadcast(room, { t: 'closed', reason: ws === room.hostWs ? 'host-left' : 'empty' });
    for (const c of room.conns) c.room = null;
    rooms.delete(room.code);
  } else {
    broadcast(room, { t: 'room', room: roster(room) });
  }
}

export function openRooms() {
  return [...rooms.values()].filter((r) => !r.started)
    .map((r) => ({ code: r.code, host: r.hostName, teams: r.teams, worms: r.worms, players: r.conns.size }));
}

export function handleMessage(ws, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  const t = msg.t;

  if (t === 'hello') {
    ws.name = String(msg.name || 'Gast').slice(0, 24) || 'Gast';
    send(ws, { t: 'welcome', name: ws.name });
    return;
  }

  if (t === 'list') {
    send(ws, { t: 'rooms', list: openRooms() });
    return;
  }

  if (t === 'create') {
    leaveRoom(ws);
    const code = newCode();
    const room = {
      code, hostWs: ws, hostName: ws.name || 'Gast',
      teams: clamp(msg.teams, 2, 4), worms: clamp(msg.worms, 1, 6),
      started: false, conns: new Set([ws]), createdAt: Date.now(),
    };
    ws.room = room;
    rooms.set(code, room);
    send(ws, { t: 'created', room: roster(room) });
    return;
  }

  if (t === 'join') {
    const room = rooms.get(String(msg.code || '').toUpperCase());
    if (!room) return send(ws, { t: 'error', code: 'no-room', msg: 'Keine Session mit diesem Code.' });
    if (room.started) return send(ws, { t: 'error', code: 'started', msg: 'Session läuft bereits.' });
    if (room.conns.size >= room.teams) return send(ws, { t: 'error', code: 'full', msg: 'Session ist voll.' });
    leaveRoom(ws);
    room.conns.add(ws);
    ws.room = room;
    send(ws, { t: 'joined', room: roster(room) });
    broadcast(room, { t: 'room', room: roster(room) }, ws);
    return;
  }

  if (t === 'leave') { leaveRoom(ws); return; }

  const room = ws.room;
  if (!room) return;

  if (t === 'start') {
    if (ws !== room.hostWs) return;
    room.started = true;
    // Teams den anwesenden Spielern zuordnen (Reihenfolge = Beitritt)
    const players = [...room.conns];
    const assign = players.map((c, i) => ({ name: c.name, team: i }));
    room.teams = players.length;
    for (const c of room.conns) {
      c._teamIdx = assign.find((a) => a.name === c.name)?.team ?? 0;
      send(c, {
        t: 'start', seed: msg.seed | 0, worms: room.worms,
        players: assign, you: c._teamIdx, host: c === room.hostWs,
      });
    }
    return;
  }

  if (t === 'act') {
    // Eingabe eines Gastes -> nur an den Host (der simuliert autoritativ)
    send(room.hostWs, { t: 'act', from: ws.name, team: ws._teamIdx, a: msg.a });
    return;
  }

  if (t === 'snap') {
    // Autoritativer Zustand vom Host -> an alle Gäste
    if (ws !== room.hostWs) return;
    broadcast(room, { t: 'snap', s: msg.s }, ws);
    return;
  }

  if (t === 'chat') {
    broadcast(room, { t: 'chat', from: ws.name, text: String(msg.text || '').slice(0, 200) });
    return;
  }
}

export function handleClose(ws) { leaveRoom(ws); }

function clamp(v, lo, hi) { v = parseInt(v, 10); if (!Number.isFinite(v)) return lo; return Math.max(lo, Math.min(hi, v)); }
