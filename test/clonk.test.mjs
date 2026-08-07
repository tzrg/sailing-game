// Klonk · Goldrausch: Gelände-Materialien, Graben (Fels blockt), Sprengungen,
// Gold-Wirtschaft (Klumpen, Abliefern, Sieg), K. o./Respawn, Klettern und die
// Zwei-Spieler-Tastenbelegung. Läuft über den Test-Hook window.__clonk; die
// Simulation wird pausiert und deterministisch per update(dt) getickt.

import { startServer, launchBrowser, checker } from './helpers.mjs';

const srv = startServer();
await srv.ready;
const { check, summary } = checker();

const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.on('pageerror', (e) => check('Seite ohne JS-Fehler', false, e.message));
  await page.goto(srv.url + '/clonk.html');
  await page.waitForFunction(() => window.__clonk);
  await page.click('#btn-start');   // Hilfe schließen

  // Feste Saat + Pause: alle Ticks kommen ab jetzt aus update(dt)
  await page.evaluate(() => {
    const C = window.__clonk;
    C.startGame(42);
    C.game.paused = true;
  });
  const tick = (secs) => page.evaluate((s) => {
    const C = window.__clonk;
    for (let t = 0; t < s; t += 0.016) C.update(0.016);
  }, secs);

  // ---- Gelände: alle Materialien vorhanden, Spieler an ihren Hütten
  let r = await page.evaluate(() => {
    const C = window.__clonk, M = C.MAT, counts = [0, 0, 0, 0, 0];
    for (const v of C.mask) counts[v]++;
    const [a, b] = C.players();
    return { counts, ax: a.x, bx: b.x, baseA: a.base.x, baseB: b.base.x, n: C.players().length };
  });
  check('Gelände enthält Himmel, Erde, Fels, Gold und Höhlen',
    r.counts[0] > 10000 && r.counts[1] > 10000 && r.counts[2] > 10000 && r.counts[3] > 500 && r.counts[4] > 100,
    r.counts.join(','));
  check('Zwei Klonks starten an ihren Hütten (links/rechts)',
    r.n === 2 && Math.abs(r.ax - r.baseA) < 40 && Math.abs(r.bx - r.baseB) < 40 && r.baseA < 200 && r.baseB > 760);

  // ---- Graben: Erde weicht der Schaufel, Fels nicht
  r = await page.evaluate(() => {
    const C = window.__clonk, M = C.MAT;
    // Spalte 480: Erdoberfläche und Felsgrenze suchen
    const x = 480, g = C.groundY()[x];
    let rockTop = 0;
    for (let y = g; y < C.WORLD_H; y++) if (C.matAt(x, y) === M.ROCK) { rockTop = y; break; }
    const earthBefore = C.solid(x, g + 10);
    C.carveCircle(x, g + 10, 9, false);
    const earthAfter = C.solid(x, g + 10);
    const rockBefore = C.solid(x, rockTop + 5);
    C.carveCircle(x, rockTop + 5, 9, false);
    const rockAfter = C.solid(x, rockTop + 5);
    return { earthBefore, earthAfter, rockBefore, rockAfter, rockTop, g };
  });
  check('Schaufel gräbt Erde weg', r.earthBefore && !r.earthAfter);
  check('Fels widersteht der Schaufel', r.rockBefore && r.rockAfter);

  // ---- Spieler gräbt sich per Grabtaste senkrecht nach unten
  r = await page.evaluate(() => {
    const C = window.__clonk;
    const p = C.players()[0];
    p.x = 480; p.y = C.groundY()[480] - 1; p.state = 'walk'; p.vx = 0; p.vy = 0; p.hp = 100;
    C.pressed.add('s');
    return { y0: p.y };
  });
  await tick(1.2);
  r = await page.evaluate((y0) => {
    const C = window.__clonk;
    const p = C.players()[0];
    C.pressed.delete('s');
    return { dy: p.y - y0, state: p.state, freed: !C.solid(480, y0 + 6) };
  }, r.y0);
  check('Grabtaste: Klonk buddelt sich nach unten durch', r.state === 'dig' && r.dy > 20 && r.freed,
    JSON.stringify(r));

  // ---- Fels stoppt den Buddler
  r = await page.evaluate(() => {
    const C = window.__clonk, M = C.MAT;
    C.startGame(42);
    const p = C.players()[0];
    const x = 700, g = C.groundY()[x];
    let rockTop = 0;
    for (let y = g; y < C.WORLD_H; y++) if (C.matAt(x, y) === M.ROCK) { rockTop = y; break; }
    p.x = x; p.y = g - 1; p.state = 'walk'; p.vx = 0; p.vy = 0;
    C.pressed.add('s');
    return { rockTop };
  });
  await tick(8);
  r = await page.evaluate((rockTop) => {
    const C = window.__clonk;
    const p = C.players()[0];
    C.pressed.delete('s');
    return { y: p.y, rockTop, stopped: p.y <= rockTop + 1 };
  }, r.rockTop);
  check('Felsschicht stoppt das Graben', r.stopped, JSON.stringify(r));

  // ---- Sprengung: bricht Fels und legt Gold als Klumpen frei
  r = await page.evaluate(() => {
    const C = window.__clonk, M = C.MAT;
    C.startGame(42);
    // eine Goldader im Fels suchen
    let gx = -1, gy = -1;
    outer: for (let y = C.WORLD_H - 40; y > 300; y--) {
      for (let x = 60; x < C.WORLD_W - 60; x++) {
        if (C.matAt(x, y) === M.GOLD && C.matAt(x, y - 14) === M.ROCK) { gx = x; gy = y; break outer; }
      }
    }
    const rockBefore = C.solid(gx, gy - 14);
    const before = C.items().filter((i) => i.type === 'nugget').length;
    C.explode(gx, gy - 8, null);
    const after = C.items().filter((i) => i.type === 'nugget').length;
    return { found: gx >= 0, rockBefore, rockAfter: C.solid(gx, gy - 14), nuggets: after - before };
  });
  check('Feuerstein sprengt Fels weg', r.found && r.rockBefore && !r.rockAfter);
  check('Gesprengtes Gold fällt als Klumpen heraus', r.nuggets >= 1, 'nuggets=' + r.nuggets);

  // ---- Klumpen einsammeln, an der Hütte abliefern, Sieg
  r = await page.evaluate(() => {
    const C = window.__clonk;
    C.startGame(42);
    const p = C.players()[0];
    p.x = 480; p.y = C.groundY()[480] - 1; p.state = 'walk';
    C.items().push({ type: 'nugget', x: p.x + 4, y: p.y - 6, vx: 0, vy: 0 });
    return null;
  });
  await tick(0.1);
  r = await page.evaluate(() => {
    const C = window.__clonk;
    const p = C.players()[0];
    const carry = p.carry;
    // mit vollem Sack zur Hütte
    p.carry = 3;
    p.x = p.base.x; p.y = p.base.y - 1; p.state = 'walk'; p.vx = 0; p.vy = 0;
    return { carry };
  });
  await tick(0.1);
  r = await page.evaluate((carried) => {
    const C = window.__clonk;
    const p = C.players()[0];
    return { carried, score: p.score, carry: p.carry, state: C.game.state };
  }, r.carry);
  check('Klumpen wird im Vorbeigehen eingesammelt', r.carried === 1);
  check('Hütte nimmt Gold an (Score steigt, Sack leer)', r.score === 3 && r.carry === 0 && r.state === 'play',
    JSON.stringify(r));

  r = await page.evaluate(() => {
    const C = window.__clonk;
    const p = C.players()[0];
    p.carry = C.game.goal - p.score;
    return null;
  });
  await tick(0.1);
  r = await page.evaluate(() => {
    const C = window.__clonk;
    return { state: C.game.state, winner: C.game.winner && C.game.winner.name };
  });
  check('Spielziel erreicht -> Runde endet mit Sieger', r.state === 'over' && r.winner === 'Rot', JSON.stringify(r));

  // ---- K. o.: Gold purzelt raus, Respawn an der Hütte
  r = await page.evaluate(() => {
    const C = window.__clonk;
    C.startGame(42);
    const p = C.players()[1];
    p.x = 480; p.y = C.groundY()[480] - 1; p.state = 'walk'; p.carry = 2;
    const before = C.items().filter((i) => i.type === 'nugget').length;
    C.hurt(p, 999, C.players()[0]);
    const after = C.items().filter((i) => i.type === 'nugget').length;
    return { state: p.state, dropped: after - before, ko: C.players()[0].ko };
  });
  check('K. o.: Klonk stirbt, Gold fällt raus, Gegner zählt den Treffer',
    r.state === 'dead' && r.dropped === 2 && r.ko === 1, JSON.stringify(r));
  await tick(4.3);
  r = await page.evaluate(() => {
    const C = window.__clonk;
    const p = C.players()[1];
    return { state: p.state, hp: p.hp, nearBase: Math.abs(p.x - p.base.x) < 40, carry: p.carry };
  });
  check('Respawn an der eigenen Hütte mit vollen HP', r.state !== 'dead' && r.hp === 100 && r.nearBase && r.carry === 0,
    JSON.stringify(r));

  // ---- Zwei-Spieler-Tasten: A bewegt Rot, Pfeil-Links bewegt Blau, Q wirft
  r = await page.evaluate(() => {
    const C = window.__clonk;
    C.startGame(42);
    const [a, b] = C.players();
    a.x = 480; a.y = C.groundY()[480] - 1; a.state = 'walk';
    b.x = 520; b.y = C.groundY()[520] - 1; b.state = 'walk';
    C.pressed.add('a'); C.pressed.add('arrowleft');
    return { ax: a.x, bx: b.x };
  });
  await tick(0.5);
  r = await page.evaluate((prev) => {
    const C = window.__clonk;
    C.pressed.delete('a'); C.pressed.delete('arrowleft');
    const [a, b] = C.players();
    const flintsBefore = a.flints;
    C.pressed.add('q');
    C.update(0.016);
    C.pressed.delete('q');
    return { adx: a.x - prev.ax, bdx: b.x - prev.bx,
      flintsBefore, flintsAfter: a.flints, projectiles: C.projectiles().length };
  }, r);
  check('A steuert Rot, Pfeil-Links steuert Blau (eine Tastatur)', r.adx < -10 && r.bdx < -10, JSON.stringify(r));
  check('Q wirft einen Feuerstein', r.flintsAfter === r.flintsBefore - 1 && r.projectiles === 1,
    JSON.stringify(r));

  // geworfener Feuerstein schlägt ein und hinterlässt einen Krater
  await tick(3);
  r = await page.evaluate(() => {
    const C = window.__clonk;
    return { left: C.projectiles().length, shaken: C.game.shakeT >= 0 };
  });
  check('Feuerstein explodiert beim Aufprall', r.left === 0, JSON.stringify(r));

  // ---- Klettern: Wand hoch per Sprungtaste
  r = await page.evaluate(() => {
    const C = window.__clonk;
    C.startGame(42);
    const p = C.players()[0];
    // senkrechten Schacht in die Erde graben, Klonk an die linke Wand stellen
    const cx = 480, g = C.groundY()[480];
    for (let y = g + 6; y < g + 60; y += 4) C.carveCircle(cx, y, 9, false);
    p.x = cx - 5; p.y = g + 52; p.state = 'air'; p.vx = 0; p.vy = 0;
    C.pressed.add('a');
    return { y0: p.y };
  });
  await tick(0.3);
  r = await page.evaluate(() => {
    const C = window.__clonk;
    const p = C.players()[0];
    const attached = p.state === 'scale';
    const yBefore = p.y;
    C.pressed.add('w');
    return { attached, yBefore };
  });
  check('Klonk hält sich an der Wand fest (Scale)', r.attached);
  await tick(0.5);
  r = await page.evaluate((yBefore) => {
    const C = window.__clonk;
    C.pressed.delete('a'); C.pressed.delete('w');
    return { climbed: yBefore - C.players()[0].y };
  }, r.yBefore);
  check('Sprungtaste klettert die Wand hoch', r.climbed > 12, 'climbed=' + r.climbed);

  // ---- Lore: anschieben, Klumpen aufsammeln, an der Hütte entladen
  r = await page.evaluate(() => {
    const C = window.__clonk;
    C.game.mode = '2p';
    C.startGame(42);
    C.game.paused = true;
    const lo = C.lores()[0];
    const p = C.players()[0];
    p.x = lo.x - 12; p.y = lo.y; p.state = 'walk';
    C.pressed.add('d');
    return { n: C.lores().length, x0: lo.x };
  });
  check('Jede Hütte hat eine Lore', r.n === 2);
  await tick(1.2);
  r = await page.evaluate((x0) => {
    const C = window.__clonk;
    C.pressed.delete('d');
    const p = C.players()[0];
    p.x = 300; p.y = C.groundY()[300] - 1;   // aus dem Weg, damit er nichts wegschnappt
    const lo = C.lores()[0];
    C.items().push({ type: 'nugget', x: lo.x, y: lo.y - 6, vx: 0, vy: 0 });
    return { moved: lo.x - x0 };
  }, r.x0);
  check('Lore lässt sich anschieben', r.moved > 8, 'moved=' + r.moved);
  await tick(0.2);
  r = await page.evaluate(() => {
    const C = window.__clonk;
    const lo = C.lores()[0];
    const cargo1 = lo.cargo;
    lo.x = C.players()[0].base.x; lo.y = C.players()[0].base.y - 1; lo.cargo = 3;
    return { cargo1 };
  });
  await tick(0.2);
  r = await page.evaluate((cargo1) => {
    const C = window.__clonk;
    return { cargo1, cargo: C.lores()[0].cargo, score: C.players()[0].score };
  }, r.cargo1);
  check('Lore sammelt Klumpen auf', r.cargo1 === 1, JSON.stringify(r));
  check('Lore kippt ihre Ladung an der Hütte in die Kasse', r.cargo === 0 && r.score === 3, JSON.stringify(r));

  // ---- Chemiefabrik: 1 abgeliefertes Gold -> 2 Feuersteine (Kauf-Taste E)
  r = await page.evaluate(() => {
    const C = window.__clonk;
    C.startGame(42);
    C.game.paused = true;
    const p = C.players()[0];
    p.x = p.base.x; p.y = p.base.y - 1; p.state = 'walk';
    p.score = 2; p.flints = 0;
    C.pressed.add('e');
    return null;
  });
  await tick(0.2);
  r = await page.evaluate(() => {
    const C = window.__clonk;
    C.pressed.delete('e');
    const p = C.players()[0];
    return { flints: p.flints, score: p.score };
  });
  check('Chemiefabrik: −1 ⭐ → +2 💣 (nur einmal pro Tastendruck)',
    r.flints === 2 && r.score === 1, JSON.stringify(r));

  // ---- Solo-Modus: Blau ist KI und macht sich auf Goldsuche
  r = await page.evaluate(() => {
    const C = window.__clonk;
    C.game.mode = 'solo';
    C.startGame(42);
    C.game.paused = true;
    const b = C.players()[1];
    b.x = 700; b.y = C.groundY()[700] - 1; b.state = 'walk';
    C.items().push({ type: 'nugget', x: 640, y: C.groundY()[640] - 4, vx: 0, vy: 0 });
    return { ai: b.ai, hidden: document.getElementById('wctrl-left').classList.contains('hidden') };
  });
  check('Solo-Modus: Blau wird von der 🤖-KI gesteuert', r.ai === true);
  check('Ohne Touch-Gerät bleiben die Bildschirm-Buttons versteckt', r.hidden === true);
  await tick(2.5);
  r = await page.evaluate(() => {
    const C = window.__clonk;
    const b = C.players()[1];
    return { x: b.x, carry: b.carry, kind: b.aiS.target && b.aiS.target.kind };
  });
  check('KI läuft zum Klumpen und sammelt ihn ein', r.carry >= 1 || r.x < 690, JSON.stringify(r));

  // ---- Touch-Steuerkreuz steuert Rot (auch wenn per CSS versteckt)
  r = await page.evaluate(() => {
    const C = window.__clonk;
    const a = C.players()[0];
    a.x = 480; a.y = C.groundY()[480] - 1; a.state = 'walk'; a.vx = 0; a.vy = 0;
    document.getElementById('b-left').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    return { held: C.buttons['b-left'].held, x0: a.x };
  });
  check('Touch-Button meldet Halten', r.held === true);
  await tick(0.6);
  r = await page.evaluate((x0) => {
    const C = window.__clonk;
    document.getElementById('b-left').dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    return { dx: C.players()[0].x - x0, held: C.buttons['b-left'].held };
  }, r.x0);
  check('Touch-Steuerkreuz bewegt Rot nach links', r.dx < -10 && r.held === false, JSON.stringify(r));

  // ---- Kamera: Solo folgt dem Spieler, Zoom ändert den Maßstab
  r = await page.evaluate(() => {
    const C = window.__clonk;
    C.startGame(42);            // solo, cam.zoom = 2.1
    C.game.paused = true;
    for (let i = 0; i < 80; i++) C.computeCam(0.05);
    const s1 = C.cam.scale, z1 = C.cam.zoom;
    C.setZoom(3.4);
    for (let i = 0; i < 80; i++) C.computeCam(0.05);
    const p = C.players()[0];
    return { z1, s1, s2: C.cam.scale, camX: C.cam.x, px: p.x };
  });
  check('Solo startet reingezoomt (kleinerer Bildausschnitt)', r.z1 > 1.5, 'zoom=' + r.z1);
  check('＋/－-Zoom ändert den Maßstab', r.s2 > r.s1 * 1.3, JSON.stringify(r));
  check('Kamera bleibt beim eigenen Klonk (linke Kartenhälfte)', r.camX < 480, 'camX=' + r.camX);

  // ---- Kamera im 2P-Modus: beide Spieler bleiben trotz Zoom im Bild
  r = await page.evaluate(() => {
    const C = window.__clonk;
    C.game.mode = '2p';
    C.startGame(42);
    C.game.paused = true;
    const [a, b] = C.players();
    a.x = 120; b.x = 840;
    C.setZoom(3.5);
    for (let i = 0; i < 80; i++) C.computeCam(0.05);
    const need = (Math.abs(a.x - b.x) + 280) * C.cam.scale;
    return { need, cw: innerWidth, ok: need <= innerWidth + 2 };
  });
  check('2P-Zoom hält beide Klonks im Bild', r.ok, JSON.stringify(r));

  // ---- Querformat-Drehung
  await page.click('#btn-rotate');
  r = await page.evaluate(() => document.getElementById('stage').classList.contains('rot'));
  check('⟳ dreht die Bühne ins Querformat', r === true);
  await page.click('#btn-rotate');
  r = await page.evaluate(() => document.getElementById('stage').classList.contains('rot'));
  check('⟳ dreht auch wieder zurück', r === false);
} finally {
  await browser.close();
  srv.stop();
}

process.exit(summary() ? 1 : 0);
