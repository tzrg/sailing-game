// Tims Game Library – Backend.
// Ein einzelner Node-Dienst: liefert die statischen Spiele aus public/,
// bietet die REST-API (Login, Highscores) und den WebSocket für Caterpillar-
// Online-Sessions. Alles über denselben Ursprung/Port -> kein CORS nötig.

import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { initDb, db, hashPassword, verifyPassword, newToken } from './db.js';
import { handleMessage, handleClose, handleOpen } from './rooms.js';
import { rateLimiter, issueChallenge, verifyPow, securityHeaders } from './security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 8080;

const app = express();
app.set('trust proxy', true);   // hinter Railway-Proxy -> echte Client-IP aus X-Forwarded-For
app.use(securityHeaders);
app.use(express.json({ limit: '64kb' }));

// Rate-Limits pro IP (gleitendes Fenster)
const limitChallenge = rateLimiter({ windowMs: 5 * 60 * 1000, max: 40 });
const limitRegister = rateLimiter({ windowMs: 10 * 60 * 1000, max: 6 });
const limitLogin = rateLimiter({ windowMs: 5 * 60 * 1000, max: 12 });
const limitWrite = rateLimiter({ windowMs: 10 * 60 * 1000, max: 20 });   // Forum-/Feedback-Beiträge

// Admins (dürfen alles Feedback lesen): Namen kommasepariert in ADMIN_USERS
const ADMINS = new Set((process.env.ADMIN_USERS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
const isAdmin = (name) => ADMINS.has(String(name).toLowerCase());

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

// Proof-of-Work-Aufgabe für die Registrierung (Bot-Check).
app.get('/api/challenge', limitChallenge, (req, res) => res.json(issueChallenge()));

app.post('/api/register', limitRegister, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const pass = String(req.body?.pass || '');
  // Honeypot: verstecktes Feld – nur Bots füllen es aus.
  if (String(req.body?.hp || '').length > 0) return res.status(400).json({ error: 'Bot erkannt.' });
  // Proof-of-Work prüfen (Bot-Check).
  const pow = verifyPow(req.body?.pow);
  if (!pow.ok) return res.status(400).json({ error: pow.error });
  if (!validName(name)) return res.status(400).json({ error: 'Name: 2–24 Zeichen (Buchstaben, Zahlen, . - _).' });
  if (pass.length < 4) return res.status(400).json({ error: 'Passwort zu kurz (min. 4 Zeichen).' });
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

// Dummy-Hash, damit Login bei unbekanntem Namen genauso lange dauert (kein User-Enum).
const DUMMY_HASH = hashPassword(crypto.randomBytes(8).toString('hex'));

app.post('/api/login', limitLogin, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const pass = String(req.body?.pass || '');
  const u = await db.findUser(name);
  const ok = u ? verifyPassword(pass, u.pass) : (verifyPassword(pass, DUMMY_HASH), false);
  if (!ok) return res.status(401).json({ error: 'Name oder Passwort falsch.' });
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

// ---- Feedback & Forum (nur für eingeloggte Nutzer) -------------------------
async function requireAuth(req, res) {
  const u = await userFromReq(req);
  if (!u) { res.status(401).json({ error: 'Bitte einloggen.' }); return null; }
  return u;
}
const cleanText = (v, max) => String(v || '').trim().slice(0, max);

app.post('/api/feedback', limitWrite, async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  const text = cleanText(req.body?.text, 4000);
  const game = cleanText(req.body?.game, 40);
  if (text.length < 3) return res.status(400).json({ error: 'Bitte etwas mehr Text.' });
  await db.addFeedback(u.name, game || null, text);
  res.json({ ok: true });
});

app.get('/api/feedback', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  const rows = await db.listFeedback(isAdmin(u.name) ? null : u.name);
  res.json({ feedback: rows, admin: isAdmin(u.name) });
});

app.get('/api/forum/threads', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  res.json({ threads: await db.listThreads() });
});

app.post('/api/forum/threads', limitWrite, async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  const title = cleanText(req.body?.title, 120);
  const text = cleanText(req.body?.text, 4000);
  if (title.length < 3) return res.status(400).json({ error: 'Titel zu kurz.' });
  if (text.length < 1) return res.status(400).json({ error: 'Der erste Beitrag fehlt.' });
  const t = await db.createThread(u.name, title, text);
  res.json({ thread: t });
});

app.get('/api/forum/threads/:id', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Ungültige ID.' });
  const t = await db.getThread(id);
  if (!t) return res.status(404).json({ error: 'Thread nicht gefunden.' });
  res.json({ thread: t });
});

app.post('/api/forum/threads/:id/posts', limitWrite, async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  const id = parseInt(req.params.id, 10);
  const text = cleanText(req.body?.text, 4000);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Ungültige ID.' });
  if (text.length < 1) return res.status(400).json({ error: 'Leerer Beitrag.' });
  try { await db.addPost(id, u.name, text); } catch { return res.status(404).json({ error: 'Thread nicht gefunden.' }); }
  res.json({ ok: true });
});

// ---- Spielstände (ein Slot pro Nutzer und Spiel) ---------------------------
const limitSave = rateLimiter({ windowMs: 60 * 1000, max: 30 });
const validGame = (g) => /^[a-z0-9_-]{1,24}$/.test(g);

app.put('/api/save/:game', limitSave, async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  const g = String(req.params.game || '');
  if (!validGame(g)) return res.status(400).json({ error: 'Ungültiges Spiel.' });
  const data = req.body?.data;
  if (data == null) {           // null = Spielstand löschen (z. B. Neues Spiel)
    await db.setSave(u.name, g, null);
    return res.json({ ok: true });
  }
  const str = JSON.stringify(data);
  if (typeof data !== 'object' || str.length > 32000) return res.status(400).json({ error: 'Spielstand ungültig oder zu groß.' });
  await db.setSave(u.name, g, str);
  res.json({ ok: true });
});

app.get('/api/save/:game', async (req, res) => {
  const u = await requireAuth(req, res); if (!u) return;
  const g = String(req.params.game || '');
  if (!validGame(g)) return res.status(400).json({ error: 'Ungültiges Spiel.' });
  const row = await db.getSave(u.name, g);
  let save = null;
  if (row) { try { save = JSON.parse(row.data); } catch { /* egal */ } }
  res.json({ save });
});

// Globale Bestenliste: Top 10 je (game,variant) über alle Spieler –
// die Landing-Page zeigt den Besten und klappt die Liste auf Wunsch auf.
app.get('/api/leaderboard', async (req, res) => {
  const rows = await db.leaderboard();
  const groups = new Map();   // game|variant -> rows
  for (const r of rows) {
    const key = `${r.game}|${r.variant}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const board = [];
  for (const list of groups.values()) {
    const better = list[0].better;
    list.sort((a, b) => (better === 'high' ? b.value - a.value : a.value - b.value));
    board.push(...list.slice(0, 10));
  }
  res.json({ board });
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
  ws.authed = false;
  ws.isAlive = true;
  handleOpen(ws);
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', async (data) => {
    ws.isAlive = true;   // jede Nachricht (auch App-Ping) hält die Verbindung frisch
    let msg; try { msg = JSON.parse(data.toString()); } catch { return; }
    // hello wird hier behandelt: optionales Token verifizieren (nur eingeloggte
    // Spieler dürfen Spiele eröffnen und erscheinen mit ihrem echten Namen).
    if (msg.t === 'hello') {
      let name = String(msg.name || 'Gast').slice(0, 24) || 'Gast';
      ws.authed = false;
      if (msg.token) {
        try { const u = await db.userForToken(msg.token); if (u) { name = u.name; ws.authed = true; } }
        catch { /* egal */ }
      }
      ws.name = name;
      ws.send(JSON.stringify({ t: 'welcome', name, authed: ws.authed }));
      return;
    }
    try { handleMessage(ws, data.toString()); } catch (e) { console.error('[ws]', e.message); }
  });
  ws.on('close', () => handleClose(ws));
  ws.on('error', () => {});
});

// Tote Verbindungen aufräumen – erst nach mehreren verpassten Pings kappen,
// damit ein kurz pausierter (z. B. in den Hintergrund gewechselter) Tab nicht
// sofort rausfliegt. Der Client sendet zusätzlich alle 12 s einen App-Ping.
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive) ws.missed = 0;
    else ws.missed = (ws.missed || 0) + 1;
    if (ws.missed >= 3) { ws.terminate(); continue; }   // ~135 s Toleranz
    ws.isAlive = false;
    try { ws.ping(); } catch { /* egal */ }
  }
}, 45000);

let STORE = 'memory';
initDb().then((mode) => {
  STORE = mode;
  server.listen(PORT, () => console.log(`Tims Game Library läuft auf :${PORT} (Speicher: ${mode})`));
});
