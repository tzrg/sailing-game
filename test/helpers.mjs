// Gemeinsame Helfer für die Test-Suite (node test/run-all.mjs bzw. npm test).
//
// Jede Testdatei startet ihren eigenen Server (In-Memory-Store, niedriger
// Proof-of-Work) und einen Headless-Chromium über Playwright. Playwright wird
// zuerst als normales Paket gesucht; als Fallback greifen die Pfade der
// Claude-Code-Umgebung (global installiertes Playwright + System-Chromium).

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* weiter */ }
  return import('/opt/node22/lib/node_modules/playwright/index.mjs');
}

export async function launchBrowser() {
  const { chromium } = await loadPlaywright();
  const exe = process.env.TEST_CHROMIUM
    || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  return chromium.launch(exe ? { executablePath: exe } : {});
}

// Startet server/index.js auf einem zufälligen Port und wartet auf /api/health.
export function startServer(extraEnv = {}) {
  const port = 8900 + Math.floor(Math.random() * 900);
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(port), POW_BITS: '4', DATABASE_URL: '', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const url = 'http://localhost:' + port;
  const ready = (async () => {
    for (let i = 0; i < 100; i++) {
      try { const r = await fetch(url + '/api/health'); if (r.ok) return; } catch { /* noch nicht da */ }
      await new Promise((res) => setTimeout(res, 100));
    }
    throw new Error('Server startet nicht auf Port ' + port);
  })();
  return { url, port, ready, stop() { try { child.kill(); } catch { /* egal */ } } };
}

// Mini-Harness: check() sammelt, summary() druckt und liefert die Fail-Anzahl.
export function checker() {
  let pass = 0, fail = 0;
  return {
    check(name, ok, extra = '') {
      if (ok) { pass++; console.log('  ok  ' + name); }
      else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
    },
    summary() {
      console.log(`\n${pass} ok, ${fail} fail`);
      return fail;
    },
  };
}

/* ------------------------------------------------ API-Helfer (PoW, Konto) -- */

function leadingZeroBits(buf) {
  let n = 0;
  for (const b of buf) {
    if (b === 0) { n += 8; continue; }
    let x = b;
    while (!(x & 0x80)) { n++; x = (x << 1) & 0xff; }
    break;
  }
  return n;
}

export async function register(base, name, pass = 'test1234') {
  const ch = await (await fetch(base + '/api/challenge')).json();
  let nonce = 0;
  for (;; nonce++) {
    const h = crypto.createHash('sha256').update(`${ch.challenge}:${nonce}`).digest();
    if (leadingZeroBits(h) >= ch.difficulty) break;
  }
  const d = await (await fetch(base + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, pass, hp: '', pow: { ...ch, nonce: String(nonce) } }),
  })).json();
  if (!d.token) throw new Error('Registrierung fehlgeschlagen: ' + JSON.stringify(d));
  return d.token;
}

export function authJson(token) {
  return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
}
