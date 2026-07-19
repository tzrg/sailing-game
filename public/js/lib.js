// Gemeinsame Bibliothek für Tims Game Library.
//
// Auth und Highscores sprechen bevorzugt mit dem Backend (gleicher Ursprung,
// /api/*). Ist der Server nicht erreichbar, fällt alles auf einen lokalen
// localStorage-Modus zurück, sodass die Seite auch ohne Backend funktioniert.
// Die Caterpillar-Online-Sessions laufen über WebSocket direkt im Spiel
// (siehe js/netclient.js + wurm.js); die Landing-Page verlinkt nur dorthin.

const TOKEN_KEY = 'tgl_token';
const SESSION_KEY = 'tgl_session';   // aktueller Anzeigename
const USERS_KEY = 'tgl_users';       // nur lokaler Fallback

async function api(path, opts = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(path, { ...opts, headers });
  let data = {};
  try { data = await res.json(); } catch { /* egal */ }
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data;
}

/* ---------------------------------------------------------------- Auth ---- */

function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
function readUsers() { try { return JSON.parse(localStorage.getItem(USERS_KEY)) || {}; } catch { return {}; } }
function writeUsers(u) { try { localStorage.setItem(USERS_KEY, JSON.stringify(u)); } catch { /* egal */ } }

export const Auth = {
  serverUp: false,

  // Prüft, ob das Backend erreichbar ist, und verifiziert ein vorhandenes Token.
  async probe() {
    try {
      const h = await fetch('/api/health', { cache: 'no-store' });
      this.serverUp = h.ok;
    } catch { this.serverUp = false; }
    if (this.serverUp && localStorage.getItem(TOKEN_KEY)) {
      try { const me = await api('/api/me'); localStorage.setItem(SESSION_KEY, me.name); }
      catch { this._clear(); }   // Token ungültig -> abmelden
    }
    return this.serverUp;
  },

  current() { try { return localStorage.getItem(SESSION_KEY) || null; } catch { return null; } },
  isLoggedIn() { return !!this.current(); },
  online() { return this.serverUp; },

  _save(d) {
    if (d.token) localStorage.setItem(TOKEN_KEY, d.token);
    localStorage.setItem(SESSION_KEY, d.name);
  },
  _clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(SESSION_KEY);
  },

  async register(name, pass) {
    if (this.serverUp) {
      const d = await api('/api/register', { method: 'POST', body: JSON.stringify({ name, pass }) });
      this._save(d); return d.name;
    }
    return this._localRegister(name, pass);
  },

  async login(name, pass) {
    if (this.serverUp) {
      const d = await api('/api/login', { method: 'POST', body: JSON.stringify({ name, pass }) });
      this._save(d); return d.name;
    }
    return this._localLogin(name, pass);
  },

  async logout() {
    if (this.serverUp) { try { await api('/api/logout', { method: 'POST' }); } catch { /* egal */ } }
    this._clear();
  },

  // ---- lokaler Fallback ----
  _localRegister(name, pass) {
    name = (name || '').trim();
    if (name.length < 2) throw new Error('Name zu kurz (min. 2 Zeichen).');
    if (!pass || pass.length < 3) throw new Error('Passwort zu kurz (min. 3 Zeichen).');
    const users = readUsers(); const key = name.toLowerCase();
    if (users[key]) throw new Error('Name ist schon vergeben.');
    users[key] = { name, hash: djb2(pass) }; writeUsers(users);
    localStorage.setItem(SESSION_KEY, name); return name;
  },
  _localLogin(name, pass) {
    name = (name || '').trim();
    const rec = readUsers()[name.toLowerCase()];
    if (!rec || rec.hash !== djb2(pass || '')) throw new Error('Name oder Passwort falsch.');
    localStorage.setItem(SESSION_KEY, rec.name); return rec.name;
  },
};

/* -------------------------------------------------------------- Scores ---- */

const BOAT_NAMES = {
  jolle: 'Jolle', kielboot: 'Kielboot', ketsch: 'Ketsch', katamaran: 'Katamaran',
  moth: 'Moth', floss: 'Floß', pirat: 'Piratenschiff', rah: 'Rahsegler',
};
const CAR_NAMES = {
  sport: 'Sportwagen', lambo: 'Lamborghini', motorrad: 'Motorrad', muscle: 'Muscle-Car',
  klein: 'Kleinwagen', krankenwagen: 'Krankenwagen', feuerwehr: 'Feuerwehr',
};
const AUTO_TRACKS = { city: 'City', drift: 'Drift-Parcours' };
const BIKE_NAMES = { fully: 'Fully-MTB', bmx: 'BMX', kinder: 'Kinderrad' };
const MTB_TRACKS = { wald: 'Waldstrecke', halle: 'Jumphalle' };

function fmtTime(s) {
  if (!Number.isFinite(s)) return '–';
  const m = Math.floor(s / 60), r = s - m * 60;
  return m > 0 ? `${m}:${r.toFixed(2).padStart(5, '0')}` : `${r.toFixed(2)} s`;
}
export function fmtValue(v, better) {
  return better === 'high' ? Math.round(v).toLocaleString('de-DE') : fmtTime(v);
}

// Parst einen localStorage-Schlüssel in einen strukturierten Score oder null.
function parseKey(key, raw) {
  let m = key.match(/^sailbest\d*_[^_]+_(.+)$/);
  if (m) return { game: 'sail', variant: m[1], label: BOAT_NAMES[m[1]] || m[1], sub: 'Regatta', value: raw, better: 'low' };
  m = key.match(/^auto_([^_]+)_(.+)$/);
  if (m) return { game: 'auto', variant: `${m[1]}_${m[2]}`, label: CAR_NAMES[m[2]] || m[2], sub: AUTO_TRACKS[m[1]] || m[1], value: raw, better: 'low' };
  m = key.match(/^mtbscore_([^_]+)_(.+)$/);
  if (m) return { game: 'mtb', variant: `score_${m[1]}_${m[2]}`, label: BIKE_NAMES[m[2]] || m[2], sub: (MTB_TRACKS[m[1]] || m[1]) + ' · Score', value: raw, better: 'high' };
  m = key.match(/^mtb_([^_]+)_(.+)$/);
  if (m) return { game: 'mtb', variant: `time_${m[1]}_${m[2]}`, label: BIKE_NAMES[m[2]] || m[2], sub: (MTB_TRACKS[m[1]] || m[1]) + ' · Zeit', value: raw, better: 'low' };
  return null;
}

const GAME_TITLES = { sail: '⛵ Segeln', auto: '🏎 Autorennen', mtb: '🚵 Mountainbike' };

export const Scores = {
  // Alle lokalen Bestwerte als flache Liste.
  localList() {
    const out = [];
    let ls; try { ls = window.localStorage; } catch { return out; }
    for (let i = 0; i < ls.length; i++) {
      const key = ls.key(i); if (!key) continue;
      const raw = parseFloat(ls.getItem(key)); if (!Number.isFinite(raw)) continue;
      const s = parseKey(key, raw); if (s) out.push(s);
    }
    return out;
  },

  // Nach Spiel gruppiert (für die eigene Highscore-Anzeige).
  summary() {
    const games = { sail: { title: GAME_TITLES.sail, entries: [] }, auto: { title: GAME_TITLES.auto, entries: [] }, mtb: { title: GAME_TITLES.mtb, entries: [] } };
    for (const s of this.localList()) {
      games[s.game].entries.push({ label: s.label, sub: s.sub, value: fmtValue(s.value, s.better), sort: s.better === 'high' ? -s.value : s.value });
    }
    for (const g of Object.values(games)) g.entries.sort((a, b) => a.sort - b.sort);
    return games;
  },
  isEmpty(summary) { return Object.values(summary).every((g) => g.entries.length === 0); },

  // Lokale Bestwerte zum Server hochladen (nach dem Login).
  async syncUp() {
    if (!Auth.serverUp || !Auth.isLoggedIn()) return 0;
    const scores = this.localList();
    if (!scores.length) return 0;
    try { const r = await api('/api/scores', { method: 'POST', body: JSON.stringify({ scores }) }); return r.saved || 0; }
    catch { return 0; }
  },

  // Globale Bestenliste vom Server.
  async leaderboard() {
    if (!Auth.serverUp) return null;
    try { const r = await api('/api/leaderboard'); return r.board || []; }
    catch { return null; }
  },

  gameTitle(g) { return GAME_TITLES[g] || g; },
};
