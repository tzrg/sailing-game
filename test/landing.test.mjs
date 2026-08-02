// Landing-Page im Browser: Datenbank-Warnbanner (In-Memory-Modus) und die
// aufklappbare Top-10-Bestenliste je Spiel.

import { startServer, launchBrowser, checker, register, authJson } from './helpers.mjs';

const srv = startServer();
await srv.ready;
const B = srv.url;
const { check, summary } = checker();

const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 480, height: 860 } });
  page.on('pageerror', (e) => check('Seite ohne JS-Fehler', false, e.message));

  // ---- Warnbanner: Server läuft absichtlich ohne Datenbank (Memory-Store)
  await page.goto(B + '/index.html');
  await page.waitForFunction(() => document.getElementById('db-warn'), null, { timeout: 8000 });
  const warn = await page.evaluate(() => document.getElementById('db-warn').textContent);
  check('DB-Warnbanner erscheint im Memory-Modus', warn.includes('Keine Datenbank'), warn.slice(0, 60));

  // ---- Bestenliste: zwei Konten mit TD-Scores
  const t1 = await register(B, 'Tim');
  const t2 = await register(B, 'Anna');
  const post = (tok, value) => fetch(B + '/api/scores', { method: 'POST', headers: authJson(tok),
    body: JSON.stringify({ scores: [{ game: 'td', variant: 'best', label: 'Höchste Welle', sub: 'Endlos', value, better: 'high' }] }) });
  await post(t1, 27);
  await post(t2, 34);

  await page.evaluate((tok) => {
    localStorage.setItem('tgl_token', tok);
    localStorage.setItem('tgl_session', 'Tim');
  }, t1);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.lb-click'), null, { timeout: 8000 });
  await page.click('.panel-details summary');   // Highscores-Abschnitt aufklappen

  const r = await page.evaluate(() => {
    const row = document.querySelector('.lb-click');
    const summaryText = row.textContent;
    row.click();
    const list = row.nextElementSibling;
    const entries = [...list.querySelectorAll('.lb-entry')].map((e) => e.textContent.trim());
    const meHighlighted = !!list.querySelector('.lb-entry.me');
    const visible = !list.classList.contains('hidden');
    row.click();
    return { summaryText, entries, meHighlighted, visible, closedAgain: list.classList.contains('hidden') };
  });
  check('Zeile nennt Führenden und Spielerzahl', r.summaryText.includes('Anna') && r.summaryText.includes('2 Spieler'), r.summaryText);
  check('Aufklappen zeigt die Top-Liste mit Medaillen',
    r.visible && r.entries.length === 2
    && r.entries[0].includes('🥇') && r.entries[0].includes('Anna') && r.entries[0].includes('34')
    && r.entries[1].includes('🥈') && r.entries[1].includes('Tim') && r.entries[1].includes('27'),
    JSON.stringify(r.entries));
  check('Eigener Name ist hervorgehoben', r.meHighlighted);
  check('Erneutes Tippen klappt wieder zu', r.closedAgain);

  // ---- Letzte TD-Partien mit aufklappbarer Statistik auf der Titelseite
  const hist = { v: 1, runs: [
    { ts: Date.now(), diff: 'normal', wave: 12, end: 'over', kills: 55, dmg: 12345, top: 'mg',
      st: { types: { mg: { kills: 40, dmg: 9000 }, tesla: { kills: 15, dmg: 3345 } },
        vs: { mg: { blob: 30, tank: 10 }, tesla: { runner: 15 } } } },
    { ts: Date.now() - 100000, diff: 'schwer', wave: 4, end: 'quit', kills: 9, dmg: 800, top: 'cannon' },
  ] };
  await fetch(B + '/api/save/td_history', { method: 'PUT', headers: authJson(t1), body: JSON.stringify({ data: hist }) });
  await page.reload();
  await page.waitForFunction(() => {
    const el = document.getElementById('score-history');
    return el && !el.classList.contains('hidden');
  }, null, { timeout: 8000 });
  const h = await page.evaluate(() => {
    const wrap = document.getElementById('score-history');
    const rows = [...wrap.querySelectorAll('.score-row')].map((el) => el.textContent);
    const row = wrap.querySelector('.score-row.lb-click');
    row.click();
    const det = row.nextElementSibling;
    return { n: rows.length, first: rows[0], second: rows[1],
      open: !det.classList.contains('hidden'),
      hasTowers: det.innerHTML.includes('MG') && det.innerHTML.includes('Blitzturm'),
      hasMatrix: det.innerHTML.includes('🟣') };
  });
  check('Titelseite zeigt die letzten TD-Partien (vom Server)',
    h.n === 2 && h.first.includes('Welle 12') && h.second.includes('Welle 4'), JSON.stringify(h));
  check('Partie aufklappen zeigt Turm-Tabelle + Monster-Matrix',
    h.open && h.hasTowers && h.hasMatrix, JSON.stringify(h));
} finally {
  await browser.close();
  srv.stop();
}

process.exit(summary() ? 1 : 0);
