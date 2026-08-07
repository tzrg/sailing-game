// Backend-API: Konten, Scores/Bestenliste (Top 10), Spielstand- und
// Historien-Slots, Auth-Wächter. Läuft gegen einen frisch gestarteten Server
// mit In-Memory-Store.

import { startServer, checker, register, authJson } from './helpers.mjs';

const srv = startServer();
await srv.ready;
const B = srv.url;
const { check, summary } = checker();
const j = (r) => r.json();

try {
  // ---- Health & Store-Anzeige
  const health = await (await fetch(B + '/api/health')).json();
  check('Health meldet Speichermodus', health.ok === true && typeof health.store === 'string', JSON.stringify(health));

  // ---- Konten
  const t1 = await register(B, 'Tim');
  const t2 = await register(B, 'Anna');
  check('Registrierung liefert Token', !!t1 && !!t2);

  const dup = await fetch(B + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Tim', pass: 'x', hp: 'bot', pow: {} }) });
  check('Honeypot-Registrierung wird abgelehnt', dup.status === 400);

  const badLogin = await fetch(B + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Tim', pass: 'falsch' }) });
  check('Falsches Passwort -> 401', badLogin.status === 401);

  const goodLogin = await (await fetch(B + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Tim', pass: 'test1234' }) })).json();
  check('Login liefert Token und Namen', !!goodLogin.token && goodLogin.name === 'Tim');

  const me = await (await fetch(B + '/api/me', { headers: authJson(t1) })).json();
  check('/api/me kennt den Nutzer', me.name === 'Tim');

  // ---- Scores + Bestenliste (Top 10 je Spiel/Variante)
  const post = (tok, value) => fetch(B + '/api/scores', { method: 'POST', headers: authJson(tok),
    body: JSON.stringify({ scores: [{ game: 'td', variant: 'best', label: 'Höchste Welle', sub: 'Endlos', value, better: 'high' }] }) });
  await post(t1, 27);
  await post(t2, 34);
  await post(t1, 12);   // schlechter -> darf den 27er nicht überschreiben
  const lb = (await j(await fetch(B + '/api/leaderboard'))).board;
  const tdRows = lb.filter((r) => r.game === 'td' && r.variant === 'best');
  check('Bestenliste enthält beide Spieler, bester zuerst',
    tdRows.length === 2 && tdRows[0].user_name === 'Anna' && tdRows[0].value === 34 && tdRows[1].value === 27,
    JSON.stringify(tdRows));

  // ---- Spielstand-Slot
  const save = { v: 1, ts: Date.now(), diff: 'normal', money: 333, lives: 12, wave: 7,
    towers: [{ type: 'mg', lvl: 1, x: 3, y: 3, spec: 'fire', kills: 4, dmg: 120 }] };
  const put = await (await fetch(B + '/api/save/td', { method: 'PUT', headers: authJson(t1), body: JSON.stringify({ data: save }) })).json();
  const got = await (await fetch(B + '/api/save/td', { headers: authJson(t1) })).json();
  check('Spielstand speichern + laden', put.ok === true && got.save.wave === 7 && got.save.towers[0].spec === 'fire');

  const other = await (await fetch(B + '/api/save/td', { headers: authJson(t2) })).json();
  check('Fremder Nutzer sieht den Spielstand nicht', other.save === null);

  await fetch(B + '/api/save/td', { method: 'PUT', headers: authJson(t1), body: JSON.stringify({ data: null }) });
  const cleared = await (await fetch(B + '/api/save/td', { headers: authJson(t1) })).json();
  check('data:null löscht den Slot', cleared.save === null);

  // ---- Historien-Slot (gleiche API, eigener Name)
  const runs = { v: 1, runs: [{ ts: Date.now(), diff: 'normal', wave: 9, end: 'over', kills: 120, dmg: 5000, top: 'mg' }] };
  await fetch(B + '/api/save/td_history', { method: 'PUT', headers: authJson(t1), body: JSON.stringify({ data: runs }) });
  const hist = await (await fetch(B + '/api/save/td_history', { headers: authJson(t1) })).json();
  check('Spiel-Historie im eigenen Slot', hist.save.runs.length === 1 && hist.save.runs[0].wave === 9);

  // ---- Wächter
  check('Spielstand ohne Login -> 401', (await fetch(B + '/api/save/td')).status === 401);
  check('Ungültiger Spielname -> 400', (await fetch(B + '/api/save/TD%20x', { headers: authJson(t1) })).status === 400);
  check('Forum ohne Login -> 401', (await fetch(B + '/api/forum/threads')).status === 401);
  // Limit liegt bei 200 kB (Klonk-Spielstände tragen die RLE-Weltmaske)
  const okSize = await fetch(B + '/api/save/td', { method: 'PUT', headers: authJson(t1),
    body: JSON.stringify({ data: { blob: 'x'.repeat(40000) } }) });
  check('40-kB-Spielstand wird angenommen', okSize.status === 200);
  const big = await fetch(B + '/api/save/td', { method: 'PUT', headers: authJson(t1),
    body: JSON.stringify({ data: { blob: 'x'.repeat(210000) } }) });
  check('Zu großer Spielstand -> 400', big.status === 400);
} finally {
  srv.stop();
}

process.exit(summary() ? 1 : 0);
