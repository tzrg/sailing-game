// 🧮 Rechen-Rallye: Aufgaben-Generator (alle Stufen, saubere Ergebnisse im
// Zahlenraum der 2. Klasse), Punkte- und Serienlogik, Stufenaufstieg, Leben,
// Übungsmodus, Zehnerblock und Tastatur, Bestwert, Menü und Ton.
// Läuft über window.__rechnen.

import { startServer, launchBrowser, checker } from './helpers.mjs';

const srv = startServer();
await srv.ready;
const { check, summary } = checker();

const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 430, height: 880 } });
  page.on('pageerror', (e) => check('Seite ohne JS-Fehler', false, e.message));
  await page.goto(srv.url + '/rechnen.html');
  await page.waitForFunction(() => window.__rechnen);
  await page.click('#btn-start');   // Hilfe schließen

  const fresh = (opts = {}) => page.evaluate((o) => {
    const R = window.__rechnen;
    R.game.mode = o.mode || 'rallye';
    R.game.startLevel = o.start || 1;
    R.game.timerOn = o.timer !== false;
    R.newRound(o.seed === undefined ? 7 : o.seed);
  }, opts);
  // beantwortet die aktuelle Aufgabe richtig bzw. absichtlich falsch
  const answer = (right = true) => page.evaluate((ok) => {
    const R = window.__rechnen, g = R.game;
    const want = g.task.a;
    const give = ok ? want : (want + 1);
    for (const ch of String(give)) R.typeKey(ch);
    return R.submit();
  }, right);

  /* ---------------------------------------------------- Aufgaben-Fabrik -- */

  let r = await page.evaluate(() => {
    const R = window.__rechnen;
    R.setSeed(1234);
    const out = { bad: [], kinds: {}, max: 0, byLevel: {} };
    for (let lvl = 1; lvl <= R.MAX_LEVEL; lvl++) {
      const kinds = new Set();
      for (let i = 0; i < 600; i++) {
        const t = R.makeTask(lvl);
        kinds.add(t.key);
        out.kinds[t.key] = (out.kinds[t.key] || 0) + 1;
        out.max = Math.max(out.max, t.a);
        const bad = !t.q || typeof t.q !== 'string'
          || !Number.isInteger(t.a) || t.a < 0 || t.a > 120;
        if (bad && out.bad.length < 5) out.bad.push({ lvl, q: t.q, a: t.a, key: t.key });
      }
      out.byLevel[lvl] = kinds.size;
    }
    out.types = R.TYPES.length;
    return out;
  });
  check('Alle Stufen liefern saubere Aufgaben (ganzzahlig, 0–120, nie negativ)',
    r.bad.length === 0, JSON.stringify(r.bad));
  check('Es gibt rund zwanzig Aufgabenarten', r.types >= 18, 'types=' + r.types);
  check('Stufe 1 ist einfach, später kommen immer mehr Arten dazu',
    r.byLevel[1] === 2 && r.byLevel[6] > r.byLevel[3] && r.byLevel[13] > r.byLevel[8],
    JSON.stringify(r.byLevel));
  check('Die Zahlen bleiben im Zahlenraum der 2. Klasse', r.max <= 120, 'max=' + r.max);

  // Rechenart für Rechenart nachrechnen
  r = await page.evaluate(() => {
    const R = window.__rechnen;
    R.setSeed(99);
    const bad = [];
    const num = (s) => (s.match(/-?\d+/g) || []).map(Number);
    for (let i = 0; i < 4000; i++) {
      const lvl = 1 + (i % R.MAX_LEVEL);
      const t = R.makeTask(lvl);
      const n = num(t.q);
      let ok = true;
      if (/^\d+ \+ \d+$/.test(t.q)) ok = n[0] + n[1] === t.a;
      else if (/^\d+ − \d+$/.test(t.q)) ok = n[0] - n[1] === t.a && t.a >= 0;
      else if (/^\d+ · \d+$/.test(t.q)) ok = n[0] * n[1] === t.a;
      else if (/^\d+ : \d+$/.test(t.q)) ok = n[0] / n[1] === t.a && Number.isInteger(t.a);
      else if (/^Verdopple \d+$/.test(t.q)) ok = n[0] * 2 === t.a;
      else if (/^Halbiere \d+$/.test(t.q)) ok = n[0] / 2 === t.a;
      else if (/☐ = /.test(t.q)) {
        if (t.q.includes('+')) ok = n[0] + t.a === n[1];
        else if (t.q.includes('−')) ok = n[0] - t.a === n[1];
        else ok = t.a * n[0] === n[1];
      } else if (/^\d+ \+ \d+ \+ \d+$/.test(t.q)) ok = n[0] + n[1] + n[2] === t.a;
      else if (/^\d+ − \d+ − \d+$/.test(t.q)) ok = n[0] - n[1] - n[2] === t.a && t.a >= 0;
      if (!ok && bad.length < 5) bad.push({ q: t.q, a: t.a, key: t.key });
    }
    return { bad };
  });
  check('Jede Rechenart stimmt rechnerisch (nachgerechnet über 4000 Aufgaben)',
    r.bad.length === 0, JSON.stringify(r.bad));

  // Division geht immer glatt auf, Minus nie ins Minus
  r = await page.evaluate(() => {
    const R = window.__rechnen;
    R.setSeed(5);
    let divs = 0, subs = 0, bad = 0;
    for (let i = 0; i < 3000; i++) {
      const t = R.makeTask(10 + (i % 5));
      const n = (t.q.match(/\d+/g) || []).map(Number);
      if (/ : /.test(t.q)) { divs++; if (n[0] % n[1] !== 0) bad++; }
      if (/ − /.test(t.q)) { subs++; if (t.a < 0) bad++; }
    }
    return { divs, subs, bad };
  });
  check('Geteilt wird immer ohne Rest, Minus nie unter null',
    r.divs > 50 && r.subs > 50 && r.bad === 0, JSON.stringify(r));

  // Sachaufgaben und Platzhalter kommen vor und sind lesbar
  r = await page.evaluate(() => {
    const R = window.__rechnen;
    R.setSeed(3);
    let story = null, gap = null;
    for (let i = 0; i < 3000 && (!story || !gap); i++) {
      const t = R.makeTask(12);
      if (t.story && !story) story = t;
      if (t.gap && !gap) gap = t;
    }
    return {
      story: story && { q: story.q, a: story.a, long: story.q.length > 25 },
      gap: gap && { q: gap.q, a: gap.a, box: gap.q.includes('☐') },
      stories: R.STORIES.length,
    };
  });
  check('Es gibt Sachaufgaben mit Text und Ergebnis',
    r.story && r.story.long && Number.isInteger(r.story.a) && r.stories >= 8, JSON.stringify(r.story));
  check('Es gibt Platzhalter-Aufgaben mit ☐', r.gap && r.gap.box, JSON.stringify(r.gap));

  /* ------------------------------------------------------------- Spiel --- */

  await fresh();
  r = await page.evaluate(() => {
    const R = window.__rechnen, g = R.game;
    return { lvl: g.level, pts: g.points, hearts: g.hearts, task: !!g.task, input: g.input, state: g.state };
  });
  check('Eine neue Runde startet auf Stufe 1 mit drei Leben und einer Aufgabe',
    r.lvl === 1 && r.pts === 0 && r.hearts === 3 && r.task && r.input === '' && r.state === 'play',
    JSON.stringify(r));

  r = await answer(true);
  let st = await page.evaluate(() => {
    const g = window.__rechnen.game;
    return { pts: g.points, streak: g.streak, solved: g.solved, inLevel: g.inLevel, hearts: g.hearts };
  });
  check('Eine richtige Antwort gibt Punkte und zählt die Serie hoch',
    r.ok && r.gained > 0 && st.pts === r.gained && st.streak === 1 && st.solved === 1, JSON.stringify({ r, st }));

  // Serie bringt mehr Punkte
  r = await page.evaluate(async () => {
    const R = window.__rechnen, g = R.game;
    R.newRound(11);
    const solve = () => { for (const ch of String(g.task.a)) R.typeKey(ch); return R.submit(); };
    g.timerOn = false;                      // Zeitbonus ausklammern
    const first = solve().gained;
    let last = 0;
    for (let i = 0; i < 4; i++) last = solve().gained;
    return { first, last, streak: g.streak };
  });
  check('Eine Serie ohne Fehler bringt Zusatzpunkte', r.last > r.first && r.streak === 5, JSON.stringify(r));

  // Stufenaufstieg nach fünf richtigen Aufgaben
  r = await page.evaluate(() => {
    const R = window.__rechnen, g = R.game;
    R.newRound(21);
    const solve = () => { for (const ch of String(g.task.a)) R.typeKey(ch); return R.submit(); };
    const levels = [];
    let up = 0;
    for (let i = 0; i < 10; i++) { const res = solve(); if (res.levelUp) up++; levels.push(g.level); }
    return { levels, up, lvl: g.level, name: R.levelName(g.level) };
  });
  check('Nach je fünf richtigen Aufgaben geht es eine Stufe höher',
    r.levels[4] === 2 && r.levels[9] === 3 && r.up === 2, JSON.stringify(r.levels));
  check('Jede Stufe hat einen Namen', typeof r.name === 'string' && r.name.length > 3, r.name);

  // Höhere Stufe = mehr Punkte je Aufgabe
  r = await page.evaluate(() => {
    const R = window.__rechnen, g = R.game;
    R.newRound(31); g.timerOn = false;
    const at = (lvl) => { g.level = lvl; g.streak = 0; return R.scoreFor().total; };
    return { l1: at(1), l6: at(6), l12: at(12) };
  });
  check('Auf höheren Stufen gibt es mehr Punkte je Aufgabe',
    r.l1 < r.l6 && r.l6 < r.l12, JSON.stringify(r));

  // Falsche Antwort: Leben weg, richtige Lösung wird gezeigt, Serie futsch
  r = await page.evaluate(() => {
    const R = window.__rechnen, g = R.game;
    R.newRound(41);
    for (const ch of String(g.task.a)) R.typeKey(ch);
    R.submit();                                   // erst eine richtige für die Serie
    const want = g.task.a;
    for (const ch of String(want + 1)) R.typeKey(ch);
    const res = R.submit();
    return {
      ok: res.ok, shown: res.answer === want, hearts: g.hearts, streak: g.streak,
      wrong: g.wrong, feedback: document.getElementById('feedback').textContent,
      pts: g.points,
    };
  });
  check('Eine falsche Antwort kostet ein Leben und setzt die Serie zurück',
    r.ok === false && r.hearts === 2 && r.streak === 0 && r.wrong === 1, JSON.stringify(r));
  check('Bei einem Fehler wird das richtige Ergebnis angezeigt',
    r.shown && /Richtig wäre \d+/.test(r.feedback), r.feedback);

  // Drei Fehler beenden die Runde, der Bestwert wird gespeichert
  r = await page.evaluate(() => {
    const R = window.__rechnen, g = R.game;
    localStorage.removeItem('rechnen_best');
    R.newRound(51);
    for (const ch of String(g.task.a)) R.typeKey(ch);
    R.submit();
    const pts = g.points;
    for (let i = 0; i < 3; i++) {
      for (const ch of String(g.task.a + 1)) R.typeKey(ch);
      R.submit();
    }
    return {
      state: g.state, hearts: g.hearts, pts,
      stored: parseFloat(localStorage.getItem('rechnen_best')),
      panel: !document.getElementById('over').classList.contains('hidden'),
      stats: document.getElementById('over-stats').textContent,
    };
  });
  check('Nach drei Fehlern ist die Runde vorbei', r.state === 'over' && r.hearts === 0 && r.panel, JSON.stringify(r));
  check('Die Auswertung zeigt Punkte, Stufe und beste Serie',
    /Punkte/.test(r.stats) && /Stufe/.test(r.stats) && /Serie/.test(r.stats), r.stats);
  check('Der Bestwert landet im Speicher', r.stored === r.pts, JSON.stringify(r));

  // Nach dem Ende nimmt das Spiel keine Eingaben mehr an
  r = await page.evaluate(() => {
    const R = window.__rechnen;
    R.typeKey('5');
    return { input: R.game.input, res: R.submit() };
  });
  check('Nach dem Rundenende wird nichts mehr gewertet', r.input === '' && r.res === null, JSON.stringify(r));

  /* -------------------------------------------------------- Übungsmodus -- */

  r = await page.evaluate(() => {
    const R = window.__rechnen, g = R.game;
    g.mode = 'ueben';
    R.newRound(61);
    const hearts = g.hearts;
    for (let i = 0; i < 6; i++) {
      for (const ch of String(g.task.a + 1)) R.typeKey(ch);
      R.submit();
    }
    const after = { state: g.state, hearts: g.hearts, wrong: g.wrong };
    g.mode = 'rallye';
    return { hearts, after, display: document.getElementById('h-hearts').textContent };
  });
  check('Im Übungsmodus gibt es keine Leben – es geht immer weiter',
    r.hearts === Infinity && r.after.state === 'play' && r.after.wrong === 6, JSON.stringify(r));
  check('Die Anzeige zeigt dafür ein ∞', r.display === '∞', r.display);

  /* ------------------------------------------------------- Eingabe/UI ---- */

  await fresh({ seed: 71 });
  r = await page.evaluate(() => {
    const R = window.__rechnen;
    const hit = (k) => document.querySelector(`#pad button[data-k="${k}"]`).click();
    hit('1'); hit('2'); hit('3');
    const typed = R.game.input;
    hit('del');
    const afterDel = R.game.input;
    const shown = document.getElementById('answer-text').textContent;
    return { typed, afterDel, shown };
  });
  check('Der Zehnerblock tippt Ziffern und ⌫ löscht die letzte',
    r.typed === '123' && r.afterDel === '12' && r.shown === '12', JSON.stringify(r));

  r = await page.evaluate(async () => {
    const R = window.__rechnen, g = R.game;
    R.newRound(81);
    const want = String(g.task.a);
    for (const ch of want) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
    }
    const typed = g.input;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    const back = g.input;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: want[want.length - 1], bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return { typed, back, solved: g.solved, pts: g.points };
  });
  check('Die Tastatur funktioniert genauso (Ziffern, Rücktaste, Enter)',
    r.typed.length > 0 && r.back.length === r.typed.length - 1 && r.solved === 1 && r.pts > 0,
    JSON.stringify(r));

  r = await page.evaluate(() => {
    const R = window.__rechnen, g = R.game;
    R.newRound(91);
    const before = g.task.q;
    for (const ch of String(g.task.a)) R.typeKey(ch);
    R.submit();
    return {
      changed: g.task.q !== before || g.input === '',
      input: g.input,
      task: document.getElementById('task').textContent,
      bar: document.getElementById('levelfill').style.width,
    };
  });
  check('Nach jeder Antwort kommt sofort die nächste Aufgabe',
    r.changed && r.input === '' && r.task.length > 2, JSON.stringify(r));
  check('Der Stufenbalken zeigt den Fortschritt', r.bar === '20%', r.bar);

  // Konfetti zur Belohnung
  r = await page.evaluate(() => {
    const R = window.__rechnen;
    R.newRound(101);
    const before = R.parts().length;
    for (const ch of String(R.game.task.a)) R.typeKey(ch);
    R.submit();
    return { before, after: R.parts().length };
  });
  check('Für eine richtige Antwort gibt es Konfetti', r.after > r.before + 5, JSON.stringify(r));

  /* ------------------------------------------------------------- Menü ---- */

  r = await page.evaluate(() => {
    const R = window.__rechnen;
    document.querySelector('#opt-start button[data-v="8"]').click();
    const start = { lvl: R.game.level, stored: localStorage.getItem('rechnen_start'), name: R.levelName(R.game.level) };
    document.querySelector('#opt-mode button[data-v="ueben"]').click();
    const mode = { mode: R.game.mode, stored: localStorage.getItem('rechnen_mode'), hearts: R.game.hearts };
    document.querySelector('#opt-timer button[data-v="0"]').click();
    const timer = { on: R.game.timerOn, stored: localStorage.getItem('rechnen_timer') };
    document.querySelector('#opt-mode button[data-v="rallye"]').click();
    document.querySelector('#opt-start button[data-v="1"]').click();
    document.querySelector('#opt-timer button[data-v="1"]').click();
    return { start, mode, timer };
  });
  check('Die Startstufe lässt sich einstellen und wird gemerkt',
    r.start.lvl === 8 && r.start.stored === '8' && r.start.name.length > 3, JSON.stringify(r.start));
  check('Die Spielart lässt sich umstellen und wird gemerkt',
    r.mode.mode === 'ueben' && r.mode.stored === 'ueben' && r.mode.hearts === Infinity, JSON.stringify(r.mode));
  check('Der Zeitbonus lässt sich abschalten und wird gemerkt',
    r.timer.on === false && r.timer.stored === '0', JSON.stringify(r.timer));

  r = await page.evaluate(() => {
    const R = window.__rechnen, g = R.game;
    g.timerOn = true; R.newRound(111);
    g.taskT = 0;
    const quick = R.scoreFor().timeBonus;
    g.taskT = R.LIMIT + 5;
    const slow = R.scoreFor().timeBonus;
    g.timerOn = false;
    const off = R.scoreFor().timeBonus;
    g.timerOn = true;
    return { quick, slow, off };
  });
  check('Schnelles Rechnen bringt Zeitbonus, langsames nicht',
    r.quick > 0 && r.slow === 0 && r.off === 0, JSON.stringify(r));

  // Ton
  await page.click('#btn-sound');
  r = await page.evaluate(() => ({
    on: window.__rechnen.Sfx.on, stored: localStorage.getItem('rechnen_sound'),
    icon: document.getElementById('btn-sound').textContent,
  }));
  check('🔇 schaltet den Ton ab und merkt sich das',
    r.on === false && r.stored === '0' && r.icon === '🔇', JSON.stringify(r));
  await page.click('#btn-sound');
  r = await page.evaluate(() => ({ on: window.__rechnen.Sfx.on, stored: localStorage.getItem('rechnen_sound') }));
  check('🔊 schaltet ihn wieder an', r.on === true && r.stored === '1', JSON.stringify(r));

  // Hilfe und Menü
  r = await page.evaluate(() => {
    document.getElementById('btn-menu').click();
    const open = !document.getElementById('menu').classList.contains('hidden');
    document.getElementById('btn-help').click();
    const help = !document.getElementById('help').classList.contains('hidden');
    document.getElementById('btn-start').click();
    return { open, help, closed: document.getElementById('help').classList.contains('hidden') };
  });
  check('☰ Menü und ❓ Hilfe lassen sich öffnen und schließen',
    r.open && r.help && r.closed, JSON.stringify(r));

  // Die Spielesammlung kennt das neue Spiel
  r = await page.evaluate(() => ({
    nav: !!document.querySelector('.game-nav a[href="rechnen.html"].active'),
    links: document.querySelectorAll('.game-nav a').length,
  }));
  check('Die Spiel-Navigation enthält die Rechen-Rallye', r.nav && r.links >= 14, JSON.stringify(r));

  const land = await browser.newPage({ viewport: { width: 400, height: 760 } });
  land.on('pageerror', (e) => check('Landing-Page ohne JS-Fehler', false, e.message));
  await land.goto(srv.url + '/index.html');
  r = await land.evaluate(() => !!document.querySelector('.game-card[href="rechnen.html"]'));
  check('Die Landing-Page hat eine Kachel für die Rechen-Rallye', r === true);
  // Bestzeiten tauchen in der eigenen Highscore-Liste auf
  r = await land.evaluate(async () => {
    localStorage.setItem('rechnen_best', '420');
    const { Scores } = await import('./js/lib.js');
    const sum = Scores.summary();
    const g = sum.rechnen;
    return { title: g && g.title, entries: g && g.entries.map((e) => e.value + ' ' + e.label) };
  });
  check('Der Punkte-Rekord erscheint in der Highscore-Übersicht',
    r.title && r.title.includes('Rechen') && r.entries.join(' ').includes('420'), JSON.stringify(r));
  await land.close();
} finally {
  await browser.close();
  srv.stop();
}

process.exit(summary() ? 1 : 0);
