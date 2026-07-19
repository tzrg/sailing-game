// Speicherschicht für Tims Game Library.
//
// Läuft mit Postgres (wenn DATABASE_URL gesetzt ist) oder – falls keine
// Datenbank konfiguriert ist – mit einem In-Memory-Speicher, damit der Server
// sofort startet und man ihn testen kann. Sobald auf Railway eine Postgres-
// Datenbank angehängt und DATABASE_URL gesetzt wird, werden Konten, Tokens und
// Highscores dauerhaft gespeichert.

import crypto from 'node:crypto';

const url = process.env.DATABASE_URL || '';
let pg = null;      // Postgres-Pool oder null (In-Memory)

// ---- Passwort-Hashing (scrypt, ohne native Abhängigkeiten) -----------------
export function hashPassword(pass) {
  const salt = crypto.randomBytes(16).toString('hex');
  const dk = crypto.scryptSync(pass, salt, 32).toString('hex');
  return `scrypt$${salt}$${dk}`;
}
export function verifyPassword(pass, stored) {
  const [scheme, salt, dk] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !dk) return false;
  const cand = crypto.scryptSync(pass, salt, 32).toString('hex');
  const a = Buffer.from(cand, 'hex'), b = Buffer.from(dk, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function newToken() { return crypto.randomBytes(24).toString('hex'); }

/* ======================================================= In-Memory ======== */
const mem = {
  users: new Map(),   // nameLower -> { name, pass, created }
  tokens: new Map(),  // token -> name
  scores: new Map(),  // `${nameLower}|${game}|${variant}` -> row
};

const memStore = {
  async init() { /* nichts zu tun */ },
  async createUser(name, passHash) {
    const key = name.toLowerCase();
    if (mem.users.has(key)) throw new Error('exists');
    mem.users.set(key, { name, pass: passHash, created: Date.now() });
  },
  async findUser(name) { return mem.users.get(name.toLowerCase()) || null; },
  async setToken(token, name) { mem.tokens.set(token, name); },
  async userForToken(token) {
    const name = mem.tokens.get(token);
    return name ? { name } : null;
  },
  async dropToken(token) { mem.tokens.delete(token); },
  async upsertScore(name, s) {
    const key = `${name.toLowerCase()}|${s.game}|${s.variant}`;
    const prev = mem.scores.get(key);
    if (prev && !isBetter(s.value, prev.value, s.better)) return prev;
    const row = { user_name: name, game: s.game, variant: s.variant,
      label: s.label, sub: s.sub, value: s.value, better: s.better, updated: Date.now() };
    mem.scores.set(key, row);
    return row;
  },
  async userScores(name) {
    return [...mem.scores.values()].filter((r) => r.user_name.toLowerCase() === name.toLowerCase());
  },
  async leaderboard() {
    return [...mem.scores.values()];
  },
};

/* ======================================================= Postgres ========= */
function isBetter(val, prev, better) {
  return better === 'high' ? val > prev : val < prev;
}

let pgStore = null;
async function makePgStore() {
  const { default: pkg } = await import('pg');
  const { Pool } = pkg;
  pg = new Pool({
    connectionString: url,
    ssl: url.includes('railway') || process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined,
    max: 5,
  });
  return {
    async init() {
      await pg.query(`
        CREATE TABLE IF NOT EXISTS users (
          name_lower text PRIMARY KEY,
          name       text NOT NULL,
          pass       text NOT NULL,
          created    bigint NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tokens (
          token      text PRIMARY KEY,
          name       text NOT NULL,
          created    bigint NOT NULL
        );
        CREATE TABLE IF NOT EXISTS scores (
          user_name  text NOT NULL,
          game       text NOT NULL,
          variant    text NOT NULL,
          label      text,
          sub        text,
          value      double precision NOT NULL,
          better     text NOT NULL,
          updated    bigint NOT NULL,
          PRIMARY KEY (user_name, game, variant)
        );
      `);
    },
    async createUser(name, passHash) {
      try {
        await pg.query('INSERT INTO users(name_lower,name,pass,created) VALUES($1,$2,$3,$4)',
          [name.toLowerCase(), name, passHash, Date.now()]);
      } catch (e) {
        if (e.code === '23505') throw new Error('exists');
        throw e;
      }
    },
    async findUser(name) {
      const r = await pg.query('SELECT name,pass,created FROM users WHERE name_lower=$1', [name.toLowerCase()]);
      return r.rows[0] || null;
    },
    async setToken(token, name) {
      await pg.query('INSERT INTO tokens(token,name,created) VALUES($1,$2,$3) ON CONFLICT (token) DO NOTHING',
        [token, name, Date.now()]);
    },
    async userForToken(token) {
      const r = await pg.query('SELECT name FROM tokens WHERE token=$1', [token]);
      return r.rows[0] || null;
    },
    async dropToken(token) { await pg.query('DELETE FROM tokens WHERE token=$1', [token]); },
    async upsertScore(name, s) {
      const cmp = s.better === 'high' ? '>' : '<';
      const r = await pg.query(
        `INSERT INTO scores(user_name,game,variant,label,sub,value,better,updated)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (user_name,game,variant) DO UPDATE
           SET value=EXCLUDED.value, label=EXCLUDED.label, sub=EXCLUDED.sub,
               better=EXCLUDED.better, updated=EXCLUDED.updated
           WHERE EXCLUDED.value ${cmp} scores.value
         RETURNING *`,
        [name, s.game, s.variant, s.label, s.sub, s.value, s.better, Date.now()]);
      if (r.rows[0]) return r.rows[0];
      const cur = await pg.query('SELECT * FROM scores WHERE user_name=$1 AND game=$2 AND variant=$3',
        [name, s.game, s.variant]);
      return cur.rows[0];
    },
    async userScores(name) {
      const r = await pg.query('SELECT * FROM scores WHERE user_name=$1', [name]);
      return r.rows;
    },
    async leaderboard() {
      const r = await pg.query('SELECT * FROM scores');
      return r.rows;
    },
  };
}

/* ======================================================= Fassade ========== */
let store = memStore;

export async function initDb() {
  if (url) {
    try {
      pgStore = await makePgStore();
      await pgStore.init();
      store = pgStore;
      return 'postgres';
    } catch (e) {
      console.error('[db] Postgres-Verbindung fehlgeschlagen, nutze In-Memory:', e.message);
      store = memStore;
      return 'memory (postgres-fehler)';
    }
  }
  await memStore.init();
  return 'memory';
}

export const db = {
  createUser: (...a) => store.createUser(...a),
  findUser: (...a) => store.findUser(...a),
  setToken: (...a) => store.setToken(...a),
  userForToken: (...a) => store.userForToken(...a),
  dropToken: (...a) => store.dropToken(...a),
  upsertScore: (...a) => store.upsertScore(...a),
  userScores: (...a) => store.userScores(...a),
  leaderboard: (...a) => store.leaderboard(...a),
};
