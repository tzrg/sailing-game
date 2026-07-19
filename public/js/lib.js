// Gemeinsame Bibliothek für Tims Game Library.
// Login, Highscores und Caterpillar-Sessions laufen vorerst komplett lokal
// (localStorage). Alles ist so gekapselt, dass später ein echtes Backend
// (Railway-Dienst mit festen Benutzerkonten) eingehängt werden kann, ohne die
// Spiele anzufassen. Die Netz-Aufrufe sind bereits als async ausgelegt.

/* ---------------------------------------------------------------- Auth ---- */

const USERS_KEY = 'tgl_users';   // { name: {hash, created} }
const SESSION_KEY = 'tgl_session'; // aktuell eingeloggter Name

// kleiner, absichtlich schwacher Hash – nur damit im localStorage kein
// Klartext-Passwort liegt. Echte Sicherheit kommt später vom Server.
function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

function readUsers() {
  try { return JSON.parse(localStorage.getItem(USERS_KEY)) || {}; }
  catch { return {}; }
}
function writeUsers(u) {
  try { localStorage.setItem(USERS_KEY, JSON.stringify(u)); } catch { /* egal */ }
}

export const Auth = {
  // true, wenn wir (noch) ohne Backend laufen
  offline: true,

  current() {
    try { return localStorage.getItem(SESSION_KEY) || null; } catch { return null; }
  },

  isLoggedIn() { return !!this.current(); },

  async register(name, pass) {
    name = (name || '').trim();
    if (name.length < 2) throw new Error('Name zu kurz (min. 2 Zeichen).');
    if (!pass || pass.length < 3) throw new Error('Passwort zu kurz (min. 3 Zeichen).');
    const users = readUsers();
    const key = name.toLowerCase();
    if (users[key]) throw new Error('Name ist schon vergeben.');
    users[key] = { name, hash: djb2(pass), created: Date.now() };
    writeUsers(users);
    try { localStorage.setItem(SESSION_KEY, name); } catch { /* egal */ }
    return name;
  },

  async login(name, pass) {
    name = (name || '').trim();
    const users = readUsers();
    const rec = users[name.toLowerCase()];
    if (!rec || rec.hash !== djb2(pass || '')) throw new Error('Name oder Passwort falsch.');
    try { localStorage.setItem(SESSION_KEY, rec.name); } catch { /* egal */ }
    return rec.name;
  },

  logout() {
    try { localStorage.removeItem(SESSION_KEY); } catch { /* egal */ }
  },
};

/* -------------------------------------------------------------- Scores ---- */

// Freundliche Namen für die gespeicherten localStorage-Schlüssel.
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

// Liest alle bekannten Highscore-Schlüssel aus localStorage und liefert eine
// nach Spiel gruppierte Zusammenfassung. `metric` gibt an, ob kleiner (Zeit)
// oder größer (Score) besser ist.
export const Scores = {
  summary() {
    const games = {
      sail: { title: '⛵ Segeln', entries: [] },
      auto: { title: '🏎 Autorennen', entries: [] },
      mtb:  { title: '🚵 Mountainbike', entries: [] },
    };
    let ls;
    try { ls = window.localStorage; } catch { return games; }

    for (let i = 0; i < ls.length; i++) {
      const key = ls.key(i);
      if (!key) continue;
      const raw = parseFloat(ls.getItem(key));
      if (!Number.isFinite(raw)) continue;

      // Segeln: sailbest<VER>_<seed>_<boot>
      let m = key.match(/^sailbest\d*_[^_]+_(.+)$/);
      if (m) {
        games.sail.entries.push({
          label: BOAT_NAMES[m[1]] || m[1], sub: 'Regatta',
          value: fmtTime(raw), sort: raw, better: 'low',
        });
        continue;
      }
      // Auto: auto_<track>_<car>
      m = key.match(/^auto_([^_]+)_(.+)$/);
      if (m) {
        games.auto.entries.push({
          label: CAR_NAMES[m[2]] || m[2], sub: AUTO_TRACKS[m[1]] || m[1],
          value: fmtTime(raw), sort: raw, better: 'low',
        });
        continue;
      }
      // MTB Score: mtbscore_<track>_<bike>
      m = key.match(/^mtbscore_([^_]+)_(.+)$/);
      if (m) {
        games.mtb.entries.push({
          label: BIKE_NAMES[m[2]] || m[2], sub: (MTB_TRACKS[m[1]] || m[1]) + ' · Score',
          value: Math.round(raw).toLocaleString('de-DE'), sort: -raw, better: 'high',
        });
        continue;
      }
      // MTB Zeit: mtb_<track>_<bike>
      m = key.match(/^mtb_([^_]+)_(.+)$/);
      if (m) {
        games.mtb.entries.push({
          label: BIKE_NAMES[m[2]] || m[2], sub: (MTB_TRACKS[m[1]] || m[1]) + ' · Zeit',
          value: fmtTime(raw), sort: raw, better: 'low',
        });
        continue;
      }
    }

    for (const g of Object.values(games)) g.entries.sort((a, b) => a.sort - b.sort);
    return games;
  },

  isEmpty(summary) {
    return Object.values(summary).every(g => g.entries.length === 0);
  },
};

/* ----------------------------------------------------------------- Net ---- */

// Caterpillar-Online-Sessions. Ohne Backend nur ein lokaler Platzhalter, der
// einen Beitritts-Code erzeugt und die Session lokal merkt. Sobald der
// Railway-Dienst steht, werden diese Methoden gegen echte WebSocket-/REST-
// Aufrufe getauscht – die Signaturen bleiben gleich.

const SESSIONS_KEY = 'tgl_cat_sessions';

function newCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 4; i++) c += a[Math.floor(Math.random() * a.length)];
  return c;
}
function readSessions() {
  try { return JSON.parse(localStorage.getItem(SESSIONS_KEY)) || {}; }
  catch { return {}; }
}
function writeSessions(s) {
  try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(s)); } catch { /* egal */ }
}

export const Net = {
  online: false,   // wird true, sobald ein echter Server konfiguriert ist

  // Fragt (später) den Server nach Erreichbarkeit. Aktuell immer offline.
  async ping() { return this.online; },

  async createSession({ host, teams = 2, worms = 3 } = {}) {
    const code = newCode();
    const s = readSessions();
    s[code] = { code, host: host || 'Gast', teams, worms, created: Date.now(), players: [host || 'Gast'] };
    writeSessions(s);
    return s[code];
  },

  async joinSession(code, player) {
    code = (code || '').trim().toUpperCase();
    const s = readSessions();
    const sess = s[code];
    if (!sess) throw new Error('Keine Session mit diesem Code gefunden (offline).');
    if (!sess.players.includes(player)) sess.players.push(player);
    writeSessions(s);
    return sess;
  },

  listSessions() {
    return Object.values(readSessions()).sort((a, b) => b.created - a.created);
  },

  removeSession(code) {
    const s = readSessions();
    delete s[code];
    writeSessions(s);
  },
};
