// Tims Game Library – Backend.
// Ein einzelner Node-Dienst: liefert die statischen Spiele aus public/,
// bietet die REST-API (Login, Highscores) und den WebSocket für Caterpillar-
// Online-Sessions. Alles über denselben Ursprung/Port -> kein CORS nötig.

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { initDb, db, hashPassword, verifyPassword, newToken } from './db.js';
import { handleMessage, handleClose } from './rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 8080;

const app = express();
app.use(express.json({ limit: '256kb' }));

// ---- Auth-Helfer -----------------------------------------------------------
async function userFromReq(req) {
  const h = req.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  const u = await db.userForToken(token);
  return u ? { name: u.name, token } : null;
}
function validName(n) { return typeof n === 'string' && /^[\w äöüÄÖÜß.\-]{2,24}$/.test(n.trim()); }

// ---- API -------------------------------------------------------------------
app.get('/api/health', (req, res) => res.json({ ok: true, store: STORE }));

app.post('/api/register', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const pass = String(req.body?.pass || '');
  if (!validName(name)) return res.status(400).json({ error: 'Name: 2–24 Zeichen.' });
  if (pass.length < 3) return res.status(400).json({ error: 'Passwort zu kurz (min. 3).' });
  try {
    await db.createUser(name, hashPassword(pass));
  } catch (e) {
    if (e.message === 'exists') return res.status(409).json({ error: 'Name ist schon vergeben.' });
    console.error(e); return res.status(500).json({ error: 'Serverfehler.' });
  }
  const token = newToken();
  await db.setToken(token, name);
  res.json({ token, name });
});

app.post('/api/login', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const pass = String(req.body?.pass || '');
  const u = await db.findUser(name);
  if (!u || !verifyPassword(pass, u.pass)) return res.status(401).json({ error: 'Name oder Passwort falsch.' });
  const token = newToken();
  await db.setToken(token, u.name);
  res.json({ token, name: u.name });
});

app.get('/api/me', async (req, res) => {
  const u = await userFromReq(req);
  if (!u) return res.status(401).json({ error: 'Nicht angemeldet.' });
  res.json({ name: u.name });
});

app.post('/api/logout', async (req, res) => {
  const u = await userFromReq(req);
  if (u) await db.dropToken(u.token);
  res.json({ ok: true });
});

// Highscores hochladen (Batch): [{game,variant,label,sub,value,better}]
app.post('/api/scores', async (req, res) => {
  const u = await userFromReq(req);
  if (!u) return res.status(401).json({ error: 'Nicht angemeldet.' });
  const list = Array.isArray(req.body?.scores) ? req.body.scores : [];
  let saved = 0;
  for (const s of list.slice(0, 200)) {
    if (!s || typeof s.value !== 'number' || !Number.isFinite(s.value)) continue;
    if (!s.game || !s.variant) continue;
    await db.upsertScore(u.name, {
      game: String(s.game).slice(0, 24), variant: String(s.variant).slice(0, 48),
      label: String(s.label || '').slice(0, 40), sub: String(s.sub || '').slice(0, 40),
      value: s.value, better: s.better === 'high' ? 'high' : 'low',
    });
    saved++;
  }
  res.json({ saved });
});

// Eigene Bestwerte
app.get('/api/scores', async (req, res) => {
  const u = await userFromReq(req);
  if (!u) return res.status(401).json({ error: 'Nicht angemeldet.' });
  res.json({ scores: await db.userScores(u.name) });
});

// Globale Bestenliste: bester Wert je (game,variant) über alle Spieler
app.get('/api/leaderboard', async (req, res) => {
  const rows = await db.leaderboard();
  const best = new Map();   // game|variant -> row
  for (const r of rows) {
    const key = `${r.game}|${r.variant}`;
    const cur = best.get(key);
    if (!cur || (r.better === 'high' ? r.value > cur.value : r.value < cur.value)) best.set(key, r);
  }
  res.json({ board: [...best.values()] });
});

// ---- Statische Dateien -----------------------------------------------------
app.use(express.static(PUBLIC, { extensions: ['html'], setHeaders: (r) => r.setHeader('Cache-Control', 'no-cache') }));
app.get('*', (req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));

// ---- HTTP + WebSocket ------------------------------------------------------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  ws.name = 'Gast';
  ws.room = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data) => {
    try { handleMessage(ws, data.toString()); } catch (e) { console.error('[ws]', e.message); }
  });
  ws.on('close', () => handleClose(ws));
  ws.on('error', () => {});
});

// Tote Verbindungen aufräumen
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* egal */ }
  }
}, 30000);

let STORE = 'memory';
initDb().then((mode) => {
  STORE = mode;
  server.listen(PORT, () => console.log(`Tims Game Library läuft auf :${PORT} (Speicher: ${mode})`));
});
