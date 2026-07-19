// Sicherheits-Helfer: Rate-Limiting, Proof-of-Work-Bot-Check und Header.
//
// Ziel: Account-Erstellungs-Spam und Brute-Force bremsen, ohne externe Dienste
// (CAPTCHA o. Ä.) und ohne die normale Nutzung spürbar zu stören.
//  - Rate-Limiting: pro IP gleitendes Zeitfenster je Endpunkt.
//  - Proof-of-Work: Registrierung muss einen kleinen Rechen-Nachweis erbringen
//    (SHA-256 mit n Null-Bits). Für einen Menschen < 1 s, für Massen-Bots teuer.
//  - Honeypot: verstecktes Formularfeld; ausgefüllt = Bot.

import crypto from 'node:crypto';

const SECRET = process.env.APP_SECRET || crypto.randomBytes(32).toString('hex');
const POW_DIFFICULTY = parseInt(process.env.POW_BITS || '16', 10);   // führende Null-Bits
const POW_TTL_MS = 5 * 60 * 1000;

/* ---------------------------------------------------------- Rate-Limit ---- */
export function rateLimiter({ windowMs, max }) {
  const hits = new Map();   // ip -> number[] (Zeitstempel)
  // gelegentlich aufräumen, damit die Map nicht wächst
  setInterval(() => {
    const now = Date.now();
    for (const [ip, arr] of hits) {
      const keep = arr.filter((t) => now - t < windowMs);
      if (keep.length) hits.set(ip, keep); else hits.delete(ip);
    }
  }, Math.max(windowMs, 60000)).unref?.();

  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const arr = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: 'Zu viele Versuche. Bitte kurz warten und erneut probieren.' });
    }
    arr.push(now);
    hits.set(ip, arr);
    next();
  };
}

/* ---------------------------------------------------------- Proof-of-Work */
const usedChallenges = new Map();   // challenge -> Ablaufzeit (Replay-Schutz)
setInterval(() => {
  const now = Date.now();
  for (const [c, exp] of usedChallenges) if (exp < now) usedChallenges.delete(c);
}, 60000).unref?.();

function hmac(data) { return crypto.createHmac('sha256', SECRET).update(data).digest('hex'); }

function leadingZeroBits(buf) {
  let bits = 0;
  for (const b of buf) {
    if (b === 0) { bits += 8; continue; }
    let x = b;
    while ((x & 0x80) === 0) { bits++; x = (x << 1) & 0xff; }
    break;
  }
  return bits;
}

// Vom Server signierte Aufgabe – kein State nötig (HMAC + Zeitstempel).
export function issueChallenge() {
  const challenge = crypto.randomBytes(16).toString('hex');
  const ts = Date.now();
  const difficulty = POW_DIFFICULTY;
  const sig = hmac(`${challenge}.${ts}.${difficulty}`);
  return { challenge, ts, difficulty, sig };
}

// Prüft den mitgelieferten Nachweis. Gibt {ok:true} oder {ok:false, error}.
export function verifyPow(p) {
  if (!p || typeof p.challenge !== 'string' || typeof p.nonce === 'undefined') {
    return { ok: false, error: 'Bot-Check fehlt. Seite neu laden.' };
  }
  const ts = parseInt(p.ts, 10), difficulty = parseInt(p.difficulty, 10);
  if (!Number.isFinite(ts) || !Number.isFinite(difficulty)) return { ok: false, error: 'Bot-Check ungültig.' };
  if (difficulty < POW_DIFFICULTY) return { ok: false, error: 'Bot-Check ungültig.' };
  if (Date.now() - ts > POW_TTL_MS || ts > Date.now() + 60000) return { ok: false, error: 'Bot-Check abgelaufen. Bitte erneut versuchen.' };

  const expect = hmac(`${p.challenge}.${ts}.${difficulty}`);
  const a = Buffer.from(String(p.sig || ''), 'utf8'), b = Buffer.from(expect, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, error: 'Bot-Check ungültig.' };

  if (usedChallenges.has(p.challenge)) return { ok: false, error: 'Bot-Check schon benutzt. Bitte erneut versuchen.' };

  const digest = crypto.createHash('sha256').update(`${p.challenge}:${p.nonce}`).digest();
  if (leadingZeroBits(digest) < difficulty) return { ok: false, error: 'Bot-Check nicht bestanden.' };

  usedChallenges.set(p.challenge, ts + POW_TTL_MS);
  return { ok: true };
}

/* ------------------------------------------------------------- Header ----- */
export function securityHeaders(req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Cross-Origin-Opener-Policy', 'same-origin');
  next();
}
