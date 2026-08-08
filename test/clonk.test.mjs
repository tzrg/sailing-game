// Klonk · Goldrausch: Gelände-Materialien (inkl. Wasser/Lava/Sand/Kohle/
// Granit), Graben, Sprengungen, Gold-Wirtschaft, K. o./Respawn, Klettern,
// Hangeln, Schwimmen/Atem, Lehmbrücken, Lore, Chemiefabrik-Rezepte, Bäume,
// Wipfe, Katastrophen, Mannschafts-Wechsel, Solo-KI, Touch, Kamera/Zoom und
// Querformat. Läuft über window.__clonk; die Simulation wird pausiert und
// deterministisch per update(dt) getickt.

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

  // Frischer Browser (kein localStorage): Standard ist der offene Buddel-Modus
  const defMode = await page.evaluate(() => window.__clonk.game.mode);
  check('Frischer Start landet im ⛏️ Buddel-Modus', defMode === 'sandbox', defMode);

  // Feste Saat + Pause: alle Ticks kommen ab jetzt aus update(dt)
  await page.evaluate(() => {
    const C = window.__clonk;
    C.game.mode = '2p';
    C.startGame(42);
    C.game.paused = true;
  });
  const tick = (secs) => page.evaluate((s) => {
    const C = window.__clonk;
    for (let t = 0; t < s; t += 0.016) C.update(0.016);
  }, secs);
  // trockene, flache Spalten suchen (See/Lava/Sand können überall liegen)
  const findDry = () => page.evaluate(() => {
    const C = window.__clonk, M = C.MAT;
    const out = [];
    outer: for (let x = 260; x < 700; x += 9) {
      const g = C.groundY()[x];
      for (let xx = -14; xx <= 14; xx += 7) for (let y = g - 50; y < g + 70; y++) {
        const m = C.matAt(x + xx, y);
        if (m === M.WATER || m === M.LAVA || m === M.SAND) continue outer;
      }
      if (Math.abs(C.groundY()[x - 8] - C.groundY()[x + 8]) > 10) continue;
      if (out.length && Math.abs(out[out.length - 1] - x) < 120) continue;
      out.push(x);
      if (out.length >= 3) break;
    }
    return out;
  });
  let [dryA, dryB, dryC] = await findDry();
  dryB = dryB || dryA; dryC = dryC || dryB;

  // ---- Gelände: alle Materialien vorhanden, Teams komplett
  let r = await page.evaluate(() => {
    const C = window.__clonk, M = C.MAT, counts = {};
    for (const v of C.mask) counts[v] = (counts[v] || 0) + 1;
    const [a, b] = C.players();
    return {
      counts, n: C.players().length, crew: C.allClonks().length,
      ax: a.x, bx: b.x, baseA: a.base.x, baseB: b.base.x,
      trees: C.trees().length, wipfe: C.wipfe().filter((w) => !w.dead).length,
      M,
    };
  });
  const cnt = (m) => r.counts[m] || 0;
  check('Gelände: Himmel, Erde, Fels, Gold, Höhlen', cnt(r.M.SKY) > 10000 && cnt(r.M.EARTH) > 10000 && cnt(r.M.ROCK) > 10000 && cnt(r.M.GOLD) > 500 && cnt(r.M.TUNNEL) > 100, JSON.stringify(r.counts));
  check('Neue Materialien: Wasser, Lava, Sand, Kohle, Granit', cnt(r.M.WATER) > 400 && cnt(r.M.LAVA) > 120 && cnt(r.M.SAND) > 150 && cnt(r.M.COAL) > 150 && cnt(r.M.GRANIT) > 3000, JSON.stringify(r.counts));
  check('Zwei Teams à zwei Clonks an ihren Hütten', r.n === 2 && r.crew === 4 && Math.abs(r.ax - r.baseA) < 40 && Math.abs(r.bx - r.baseB) < 40);
  check('Bäume wachsen, Wipfe buddeln', r.trees >= 3 && r.wipfe === 3, `trees=${r.trees} wipfe=${r.wipfe}`);

  // ---- Graben: Erde weicht, Fels nicht, Granit hält sogar Sprengungen stand
  r = await page.evaluate((x) => {
    const C = window.__clonk, M = C.MAT;
    const g = C.groundY()[x];
    let rockTop = 0;
    for (let y = g; y < C.WORLD_H; y++) if (C.matAt(x, y) === M.ROCK) { rockTop = y; break; }
    const earthBefore = C.solid(x, g + 10);
    C.carveCircle(x, g + 10, 9, false);
    const earthAfter = C.solid(x, g + 10);
    const rockBefore = C.solid(x, rockTop + 5);
    C.carveCircle(x, rockTop + 5, 9, false);
    const rockAfter = C.solid(x, rockTop + 5);
    const granitBefore = C.matAt(20, C.WORLD_H - 4) === M.GRANIT;
    C.carveCircle(20, C.WORLD_H - 4, 9, true);
    const granitAfter = C.matAt(20, C.WORLD_H - 4) === M.GRANIT;
    return { earthBefore, earthAfter, rockBefore, rockAfter, granitBefore, granitAfter };
  }, dryA);
  check('Schaufel gräbt Erde weg', r.earthBefore && !r.earthAfter);
  check('Fels widersteht der Schaufel', r.rockBefore && r.rockAfter);
  check('Granit widersteht sogar der Sprengung', r.granitBefore && r.granitAfter);

  // ---- Spieler gräbt sich senkrecht nach unten
  r = await page.evaluate((x) => {
    const C = window.__clonk;
    const p = C.players()[0];
    p.x = x; p.y = C.groundY()[x] - 1; p.state = 'walk'; p.vx = 0; p.vy = 0; p.hp = 100;
    C.pressed.add('s');
    return { y0: p.y };
  }, dryA);
  await tick(1.2);
  r = await page.evaluate(({ x, y0 }) => {
    const C = window.__clonk;
    const p = C.players()[0];
    C.pressed.delete('s');
    return { dy: p.y - y0, state: p.state, freed: !C.solid(x, y0 + 6) };
  }, { x: dryA, y0: r.y0 });
  check('Grabtaste: Klonk buddelt sich nach unten durch', r.state === 'dig' && r.dy > 20 && r.freed, JSON.stringify(r));

  // ---- Fels stoppt den Buddler
  r = await page.evaluate((x) => {
    const C = window.__clonk, M = C.MAT;
    C.startGame(42);
    C.game.paused = true;
    const p = C.players()[0];
    const g = C.groundY()[x];
    let rockTop = 0;
    for (let y = g; y < C.WORLD_H; y++) if (C.matAt(x, y) === M.ROCK) { rockTop = y; break; }
    p.x = x; p.y = g - 1; p.state = 'walk'; p.vx = 0; p.vy = 0;
    C.pressed.add('s');
    return { rockTop };
  }, dryB);
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
    C.game.paused = true;
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

  // ---- Klumpen einsammeln, abliefern, Sieg
  await page.evaluate((x) => {
    const C = window.__clonk;
    C.startGame(42);
    C.game.paused = true;
    const p = C.players()[0];
    p.x = x; p.y = C.groundY()[x] - 1; p.state = 'walk';
    C.items().push({ type: 'nugget', x: p.x + 4, y: p.y - 6, vx: 0, vy: 0 });
  }, dryA);
  await tick(0.1);
  r = await page.evaluate(() => {
    const C = window.__clonk;
    const p = C.players()[0];
    const carry = p.carry;
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
  check('Hütte nimmt Gold an (Score steigt, Sack leer)', r.score === 3 && r.carry === 0 && r.state === 'play', JSON.stringify(r));

  await page.evaluate(() => {
    const C = window.__clonk;
    const p = C.players()[0];
    p.carry = C.game.goal - p.score;
  });
  await tick(0.1);
  r = await page.evaluate(() => {
    const C = window.__clonk;
    return { state: C.game.state, winner: C.game.winner && C.game.winner.name };
  });
  check('Spielziel erreicht -> Runde endet mit Sieger', r.state === 'over' && r.winner === 'Rot', JSON.stringify(r));

  // ---- K. o.: Gold purzelt raus, Respawn an der Hütte
  r = await page.evaluate((x) => {
    const C = window.__clonk;
    C.startGame(42);
    C.game.paused = true;
    const p = C.players()[1];
    p.x = x; p.y = C.groundY()[x] - 1; p.state = 'walk'; p.carry = 2;
    const before = C.items().filter((i) => i.type === 'nugget').length;
    C.hurt(p, 999, C.players()[0]);
    const after = C.items().filter((i) => i.type === 'nugget').length;
    return { state: p.state, dropped: after - before, ko: C.players()[0].ko, handover: C.players()[1].controlled === C.players()[1].buddy };
  }, dryA);
  check('K. o.: Clonk stirbt, Gold fällt raus, Gegner zählt den Treffer', r.state === 'dead' && r.dropped === 2 && r.ko === 1, JSON.stringify(r));
  check('Steuerung springt auf den zweiten Clonk der Mannschaft', r.handover === true);
  await tick(4.3);
  r = await page.evaluate(() => {
    const C = window.__clonk;
    const p = C.players()[1];
    return { state: p.state, hp: p.hp, nearBase: Math.abs(p.x - p.base.x) < 50, carry: p.carry };
  });
  check('Respawn an der eigenen Hütte mit vollen HP', r.state !== 'dead' && r.hp === 100 && r.nearBase && r.carry === 0, JSON.stringify(r));

  // ---- Zwei-Spieler-Tasten + Werfen
  r = await page.evaluate(({ a, b }) => {
    const C = window.__clonk;
    C.startGame(42);
    C.game.paused = true;
    const [pa, pb] = C.players();
    pa.x = a; pa.y = C.groundY()[a] - 1; pa.state = 'walk';
    pb.x = b; pb.y = C.groundY()[b] - 1; pb.state = 'walk';
    C.pressed.add('a'); C.pressed.add('arrowleft');
    return { ax: pa.x, bx: pb.x };
  }, { a: dryA, b: dryB });
  await tick(0.5);
  r = await page.evaluate((prev) => {
    const C = window.__clonk;
    C.pressed.delete('a'); C.pressed.delete('arrowleft');
    const [a, b] = C.players();
    const flintsBefore = a.flints;
    C.pressed.add('q');
    C.update(0.016);
    C.pressed.delete('q');
    return { adx: a.x - prev.ax, bdx: b.x - prev.bx, flintsBefore, flintsAfter: a.flints, projectiles: C.projectiles().length };
  }, r);
  check('A steuert Rot, Pfeil-Links steuert Blau (eine Tastatur)', r.adx < -10 && r.bdx < -10, JSON.stringify(r));
  check('Q wirft einen Feuerstein', r.flintsAfter === r.flintsBefore - 1 && r.projectiles === 1, JSON.stringify(r));
  await tick(3);
  r = await page.evaluate(() => ({ left: window.__clonk.projectiles().length }));
  check('Feuerstein explodiert beim Aufprall', r.left === 0, JSON.stringify(r));

  // ---- Mannschaft: Wechsel-Taste steuert den zweiten Clonk
  r = await page.evaluate(() => {
    const C = window.__clonk;
    C.startGame(42);
    C.game.paused = true;
    const p = C.players()[0];
    C.pressed.add('f');
    C.update(0.016);
    C.pressed.delete('f');
    const onBuddy = p.controlled === p.buddy;
    const bx = p.buddy.x, px = p.x;
    C.pressed.add('d');
    return { onBuddy, bx, px };
  });
  await tick(0.6);
  r = await page.evaluate((prev) => {
    const C = window.__clonk;
    C.pressed.delete('d');
    const p = C.players()[0];
    return { onBuddy: prev.onBuddy, buddyMoved: p.buddy.x - prev.bx, capMoved: p.x - prev.px };
  }, r);
  check('F wechselt zum zweiten Clonk', r.onBuddy === true);
  check('Nur der gesteuerte Clonk läuft los', r.buddyMoved > 10 && Math.abs(r.capMoved) < 2, JSON.stringify(r));

  // ---- Klettern & Hangeln
  r = await page.evaluate((cx) => {
    const C = window.__clonk;
    C.startGame(42);
    C.game.paused = true;
    const p = C.players()[0];
    const g = C.groundY()[cx];
    for (let y = g + 6; y < g + 60; y += 4) C.carveCircle(cx, y, 9, false);
    p.x = cx - 5; p.y = g + 52; p.state = 'air'; p.vx = 0; p.vy = 0;
    C.pressed.add('a');
    return { y0: p.y };
  }, dryA);
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

  r = await page.evaluate((cx) => {
    const C = window.__clonk;
    C.startGame(42);
    C.game.paused = true;
    const p = C.players()[0];
    const g = C.groundY()[cx];
    // breiter Stollen mit halbwegs flacher Decke
    for (let xx = cx - 24; xx <= cx + 24; xx += 6) C.carveCircle(xx, g + 44, 10, true);
    let ceil = 0;
    for (let y = g + 44; y > g + 10; y--) if (C.solid(cx, y)) { ceil = y; break; }
    p.x = cx; p.y = ceil + 17; p.state = 'air'; p.vx = 0; p.vy = 0;
    C.pressed.add('w');
    return { ceil };
  }, dryB);
  await tick(0.3);
  r = await page.evaluate(() => {
    const C = window.__clonk;
    const p = C.players()[0];
    const state1 = p.state;
    const x0 = p.x;
    C.pressed.add('a');
    return { state1, x0 };
  });
  await tick(0.4);
  r = await page.evaluate((prev) => {
    const C = window.__clonk;
    C.pressed.delete('a'); C.pressed.delete('w');
    const p = C.players()[0];
    return { state1: prev.state1, moved: prev.x0 - p.x, state2: p.state };
  }, r);
  check('Hangeln: ⤒ unter der Decke hält fest', r.state1 === 'hangle', r.state1);
  check('Hangeln: seitwärts an der Decke entlang', r.moved > 5, JSON.stringify(r));

  // ---- Wasser: Schwimmen, Atem; Lava: Verbrennen; Sand rieselt; Lava+Wasser=Stein
  r = await page.evaluate(() => {
    const C = window.__clonk, M = C.MAT;
    C.startGame(42);
    C.game.paused = true;
    // tiefste Wasserstelle suchen
    let wx = -1, wy = -1, best = 0;
    for (let x = 40; x < C.WORLD_W - 40; x += 4) {
      let depth = 0, top = -1;
      for (let y = 100; y < C.WORLD_H; y++) {
        if (C.matAt(x, y) === M.WATER) { if (top < 0) top = y; depth++; }
      }
      if (depth > best) { best = depth; wx = x; wy = top; }
    }
    const p = C.players()[0];
    p.x = wx; p.y = wy + 10; p.state = 'air'; p.vx = 0; p.vy = 0;
    C.pressed.add('s');   // abtauchen
    return { wx, wy, depth: best };
  });
  check('Es gibt einen See (mind. 14 px tief)', r.depth >= 14, 'depth=' + r.depth);
  await tick(0.8);
  await page.evaluate(() => window.__clonk.pressed.delete('s'));
  r = await page.evaluate(() => {
    const C = window.__clonk;
    const p = C.players()[0];
    return { state: p.state, breath: p.breath };
  });
  check('Im Wasser wird geschwommen, der Atem läuft ab', r.state === 'swim' && r.breath < 0.99, JSON.stringify(r));
  r = await page.evaluate(() => {
    const C = window.__clonk;
    C.pressed.add('w');
    return C.players()[0].y;
  });
  await tick(0.8);
  r = await page.evaluate((y0) => {
    const C = window.__clonk;
    C.pressed.delete('w');
    return { rose: y0 - C.players()[0].y };
  }, r);
  check('⤒ schwimmt nach oben', r.rose > 6, JSON.stringify(r));

  r = await page.evaluate(() => {
    const C = window.__clonk, M = C.MAT;
    // Lava suchen
    let lx = -1, ly = -1;
    outer: for (let y = C.WORLD_H - 12; y > 300; y--) {
      for (let x = 20; x < C.WORLD_W - 20; x++) {
        if (C.matAt(x, y) === M.LAVA) { lx = x; ly = y; break outer; }
      }
    }
    const p = C.players()[0];
    p.x = lx; p.y = ly + 6; p.state = 'air'; p.vx = 0; p.vy = 0; p.hp = 100; p.breath = 1;
    return { found: lx >= 0, lx, ly };
  });
  check('Es gibt eine Lavagrotte', r.found);
  await tick(0.4);
  const lavaPos = r;
  r = await page.evaluate(() => {
    const C = window.__clonk;
    const p = C.players()[0];
    return { hp: p.hp, burning: p.burnT > 0 };
  });
  check('Lava verbrennt den Clonk', r.hp < 95 && r.burning, JSON.stringify(r));

  r = await page.evaluate(({ lx, ly }) => {
    const C = window.__clonk, M = C.MAT;
    // Wasser direkt über die Lava setzen -> Kontakt macht Fels
    const i = (ly - 1) * C.WORLD_W + lx;
    C.mask[i] = M.WATER;
    C.wakeArea(lx - 2, ly - 3, lx + 2, ly + 2);
    return null;
  }, lavaPos);
  await tick(0.5);
  r = await page.evaluate(({ lx, ly }) => {
    const C = window.__clonk, M = C.MAT;
    let rock = false;
    for (let y = ly - 2; y <= ly + 2; y++) for (let x = lx - 2; x <= lx + 2; x++) {
      if (C.matAt(x, y) === M.ROCK) rock = true;
    }
    return { rock };
  }, lavaPos);
  check('Lava + Wasser = Stein', r.rock === true);

  r = await page.evaluate(() => {
    const C = window.__clonk, M = C.MAT;
    C.startGame(42);
    C.game.paused = true;
    // Sandtasche suchen und den Boden darunter wegsprengen
    let sx = -1, sy = -1;
    outer: for (let y = 200; y < C.WORLD_H - 40; y++) {
      for (let x = 40; x < C.WORLD_W - 40; x++) {
        if (C.matAt(x, y) === M.SAND && C.matAt(x, y + 4) === M.SAND) { sx = x; sy = y; break outer; }
      }
    }
    C.carveCircle(sx, sy + 16, 9, true);
    return { sx, sy, found: sx >= 0 };
  });
  check('Es gibt Sandtaschen', r.found);
  await tick(1.5);
  r = await page.evaluate(({ sx, sy }) => {
    const C = window.__clonk, M = C.MAT;
    let sandBelow = false;
    for (let y = sy + 8; y < sy + 26; y++) if (C.matAt(sx, y) === M.SAND) sandBelow = true;
    return { sandBelow, still: C.matAt(sx, sy) === M.SAND };
  }, r);
  check('Sand rieselt in gesprengte Hohlräume', r.sandBelow, JSON.stringify(r));

  // ---- Lehmbrücke über eine Grube
  r = await page.evaluate((x) => {
    const C = window.__clonk;
    C.startGame(42);
    C.game.paused = true;
    const p = C.players()[0];
    const g = C.groundY()[x];
    C.carveCircle(x + 18, g + 6, 10, true);   // Grube voraus
    p.x = x; p.y = C.groundY()[x] - 1; p.state = 'walk'; p.dir = 1; p.loam = 2;
    C.pressed.add('e');
    return { x0: p.x };
  }, dryA);
  await tick(1.4);
  r = await page.evaluate(({ x, x0 }) => {
    const C = window.__clonk, M = C.MAT;
    C.pressed.delete('e');
    const p = C.players()[0];
    let loamCells = 0;
    for (let xx = x + 6; xx < x + 34; xx++) for (let y = C.groundY()[x] - 6; y < C.groundY()[x] + 20; y++) {
      if (C.matAt(xx, y) === M.LOAM) loamCells++;
    }
    return { adv: p.x - x0, loamCells, loamLeft: p.loam };
  }, { x: dryA, x0: r.x0 });
  check('Lehmbrücke: Benutzen-Taste baut über die Grube', r.loamCells > 20 && r.adv > 10, JSON.stringify(r));

  // ---- Lore: anschieben, Klumpen aufsammeln, entladen (auf freier Fläche,
  // damit weder Förderturm noch Gefälle an der Hütte dazwischenfunken)
  r = await page.evaluate((x) => {
    const C = window.__clonk;
    C.startGame(42);
    C.game.paused = true;
    const lo = C.lores()[0];
    const p = C.players()[0];
    lo.x = x; lo.y = C.groundY()[x] - 1; lo.vx = 0;
    p.x = x - 12; p.y = C.groundY()[x - 12] - 1; p.state = 'walk';
    C.pressed.add('d');
    return { n: C.lores().length, x0: lo.x };
  }, dryA);
  check('Jede Hütte hat eine Lore', r.n === 2);
  await tick(1.2);
  r = await page.evaluate((x0) => {
    const C = window.__clonk;
    C.pressed.delete('d');
    const p = C.players()[0];
    p.x = 60; p.y = C.groundY()[60] - 1;
    const lo = C.lores()[0];
    lo.vx = 0;
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

  // ---- Grubenlift: Korb ist begehbar, bohrt nach unten, fährt wieder hoch
  r = await page.evaluate(() => {
    const C = window.__clonk, M = C.MAT;
    C.startGame(42);
    C.game.paused = true;
    const el = C.elevators()[0];
    const p = C.players()[0];
    p.x = el.x; p.y = el.y - 1; p.state = 'walk'; p.vx = 0; p.vy = 0;
    const platform = C.matAt(el.x, el.y) === M.PLATFORM && C.solid(el.x, el.y);
    const riding = C.onElevatorCase(p);
    C.pressed.add('s');   // bohren
    return { n: C.elevators().length, platform, riding, y0: el.y, py0: p.y };
  });
  check('Jedes Team hat einen Grubenlift mit Förderturm', r.n === 2);
  check('Der Aufzugskorb ist festes, begehbares Material', r.platform && r.riding, JSON.stringify(r));
  await tick(2);
  r = await page.evaluate(({ y0, py0 }) => {
    const C = window.__clonk, M = C.MAT;
    C.pressed.delete('s');
    const el = C.elevators()[0];
    const p = C.players()[0];
    return {
      drilled: el.y - y0, rode: p.y - py0, still: C.onElevatorCase(p),
      shaft: C.matAt(el.x, el.y - 6) === M.TUNNEL || C.matAt(el.x, el.y - 6) === M.SKY,
    };
  }, r);
  check('⛏️ auf dem Korb bohrt den Schacht nach unten', r.drilled > 30, JSON.stringify(r));
  check('Der Clonk fährt auf dem Korb mit', r.rode > 30 && r.still, JSON.stringify(r));
  check('Hinter dem Korb bleibt ein offener Schacht', r.shaft === true);
  r = await page.evaluate(() => {
    const C = window.__clonk;
    C.pressed.add('w');   // hochfahren
    return { y0: C.elevators()[0].y };
  });
  await tick(2);
  r = await page.evaluate((y0) => {
    const C = window.__clonk;
    C.pressed.delete('w');
    const el = C.elevators()[0];
    const p = C.players()[0];
    return { rose: y0 - el.y, atTop: el.y === el.topY, riding: C.onElevatorCase(p) };
  }, r.y0);
  check('⤒ fährt den Korb zurück zum Förderturm', r.rose > 30 && r.atTop && r.riding, JSON.stringify(r));
  r = await page.evaluate(() => {
    const C = window.__clonk, M = C.MAT;
    const el = C.elevators()[0];
    C.explode(el.x, el.y - 6, null);
    return { survives: C.matAt(el.x, el.y) === M.PLATFORM };
  });
  check('Der Stahlkorb übersteht Explosionen', r.survives === true);

  // ---- Chemiefabrik-Rezepte: Kohle > Holz > Gold
  r = await page.evaluate(() => {
    const C = window.__clonk;
    C.startGame(42);
    C.game.paused = true;
    const p = C.players()[0];
    p.x = p.base.x; p.y = p.base.y - 1; p.state = 'walk';
    p.score = 5; p.flints = 0; p.coal = 1; p.wood = 0;
    C.buyFlint(p);
    const coalBuy = { flints: p.flints, coal: p.coal, score: p.score };
    p.flints = 0; p.coal = 0; p.wood = 2;
    C.buyFlint(p);
    const woodBuy = { flints: p.flints, wood: p.wood, score: p.score };
    p.flints = 0; p.wood = 0;
    C.buyFlint(p);
    const goldBuy = { flints: p.flints, score: p.score };
    return { coalBuy, woodBuy, goldBuy };
  });
  check('Fabrik: 1 ⚫ Kohle → 2 💣', r.coalBuy.flints === 2 && r.coalBuy.coal === 0 && r.coalBuy.score === 5, JSON.stringify(r.coalBuy));
  check('Fabrik: 2 🪵 Holz → 1 💣', r.woodBuy.flints === 1 && r.woodBuy.wood === 0 && r.woodBuy.score === 5, JSON.stringify(r.woodBuy));
  check('Fabrik: −1 ⭐ → +2 💣', r.goldBuy.flints === 2 && r.goldBuy.score === 4, JSON.stringify(r.goldBuy));

  // ---- Bäume geben Holz
  r = await page.evaluate(() => {
    const C = window.__clonk;
    const t = C.trees().find((t) => !t.dead);
    const before = C.items().filter((i) => i.type === 'wood').length;
    C.fellTree(t);
    const after = C.items().filter((i) => i.type === 'wood').length;
    return { dead: t.dead, wood: after - before };
  });
  check('Gefällter Baum gibt Holz', r.dead && r.wood >= 2, JSON.stringify(r));

  // ---- Katastrophen: Meteor, Vulkan, Erdbeben, Regen
  r = await page.evaluate((x) => {
    const C = window.__clonk;
    C.startGame(42);
    C.game.paused = true;
    C.doMeteor(x);
    return { falling: C.projectiles().some((f) => f.meteor) };
  }, dryB);
  check('Meteor fällt vom Himmel', r.falling);
  await tick(4);
  r = await page.evaluate(() => ({ left: window.__clonk.projectiles().length, shook: true }));
  check('Meteor schlägt ein und explodiert', r.left === 0);

  r = await page.evaluate((x) => {
    const C = window.__clonk, M = C.MAT;
    let lava = 0;
    for (const v of C.mask) if (v === M.LAVA) lava++;
    C.doVolcano(x);
    return { lava0: lava, vents: C.volcanoes().length };
  }, dryC);
  check('Vulkan bricht aus', r.vents === 1);
  await tick(3);
  r = await page.evaluate((prev) => {
    const C = window.__clonk, M = C.MAT;
    let lava = 0;
    for (const v of C.mask) if (v === M.LAVA) lava++;
    return { grown: lava - prev.lava0 };
  }, r);
  check('Der Schlot füllt sich mit aufsteigender Lava', r.grown > 150, 'grown=' + r.grown);

  r = await page.evaluate(() => {
    const C = window.__clonk;
    C.doQuake();
    C.update(0.016);
    const quake = C.game.quakeT > 0 && C.game.shakeT > 0;
    C.doRain();
    return { quake, rain: C.game.rainT > 0 };
  });
  check('Erdbeben schüttelt die Karte', r.quake);
  check('Regen zieht auf', r.rain);
  await tick(3);
  r = await page.evaluate(() => ({ budget: window.__clonk.game.rainBudget }));
  check('Regen lässt Wasser in die Senken laufen', r.budget < 420, 'budget=' + r.budget);

  // ---- Solo-Modus: Blau ist KI und sammelt
  r = await page.evaluate(({ a, b }) => {
    const C = window.__clonk;
    C.game.mode = 'solo';
    C.startGame(42);
    C.game.paused = true;
    const cap = C.players()[1];
    cap.x = b; cap.y = C.groundY()[b] - 1; cap.state = 'walk';
    C.items().push({ type: 'nugget', x: a, y: C.groundY()[a] - 4, vx: 0, vy: 0 });
    return { ai: cap.ai, hidden: document.getElementById('wctrl-left').classList.contains('hidden'), start: cap.x };
  }, { a: dryA, b: dryB });
  check('Solo-Modus: Blau wird von der 🤖-KI gesteuert', r.ai === true);
  check('Ohne Touch-Gerät bleiben die Bildschirm-Buttons versteckt', r.hidden === true);
  await tick(2.5);
  r = await page.evaluate((start) => {
    const C = window.__clonk;
    const cap = C.players()[1];
    const c = cap.controlled;
    return { moved: Math.abs(c.x - start) > 10, carry: c.carry };
  }, r.start);
  check('KI macht sich auf den Weg zum Gold', r.moved || r.carry >= 1, JSON.stringify(r));

  // ---- Touch-Joysticks: Rot links; im 2P-Modus bekommt Blau eigene Controls
  r = await page.evaluate((x) => {
    const C = window.__clonk;
    C.game.mode = '2p';
    C.startGame(42);
    C.game.paused = true;
    const [a, b] = C.players();
    a.x = x; a.y = C.groundY()[x] - 1; a.state = 'walk'; a.vx = 0; a.vy = 0;
    b.x = x + 60; b.y = C.groundY()[x + 60] - 1; b.state = 'walk'; b.vx = 0; b.vy = 0;
    C.joys[0].dx = -1;                 // Rot-Joystick nach links
    C.joys[1].dx = 1;                  // Blau-Joystick nach rechts
    return {
      x0: a.x, bx0: b.x,
      leftHasActions: document.getElementById('tc-a-actions').parentElement.id === 'wctrl-left',
      joyBShown: !document.getElementById('joy-b').classList.contains('hidden'),
      b2fire: !!document.getElementById('b2-fire'),
    };
  }, dryA);
  check('2P-Layout: Rot-Aktionen wandern nach links, Blau bekommt Joystick + Tasten',
    r.leftHasActions && r.joyBShown && r.b2fire, JSON.stringify(r));
  await tick(0.6);
  r = await page.evaluate(({ x0, bx0 }) => {
    const C = window.__clonk;
    const [a, b] = C.players();
    const res = { adx: a.x - x0, bdx: b.x - bx0 };
    C.joys[0].dx = 0; C.joys[1].dx = 0;
    // Joystick nach unten = graben
    a.state = 'walk'; a.vx = 0; a.vy = 0;
    C.joys[0].dy = 1;
    res.y0 = a.y;
    return res;
  }, r);
  check('Joystick links bewegt Rot, Blau-Joystick bewegt Blau', r.adx < -10 && r.bdx > 10, JSON.stringify(r));
  await tick(0.8);
  r = await page.evaluate((y0) => {
    const C = window.__clonk;
    C.joys[0].dy = 0;
    const a = C.players()[0];
    const noDig = { state: a.state, dy: a.y - y0 };
    // ⛏️-Taste + Joystick seitlich = graben mit Richtung
    C.buttons['b-dig'].held = true;
    C.joys[0].dx = 1;
    return { noDig, x0: a.x };
  }, r.y0);
  check('Joystick nach unten gräbt NICHT (nur Bewegung)', r.noDig.state !== 'dig' && r.noDig.dy < 4, JSON.stringify(r.noDig));
  await tick(0.8);
  r = await page.evaluate((x0) => {
    const C = window.__clonk;
    C.buttons['b-dig'].held = false;
    C.joys[0].dx = 0;
    const a = C.players()[0];
    return { state: a.state, moved: a.x - x0 };
  }, r.x0);
  check('⛏️-Taste + Joystick-Richtung gräbt', r.state === 'dig' && r.moved > 8, JSON.stringify(r));
  r = await page.evaluate(() => {
    const C = window.__clonk;
    C.game.mode = 'solo';
    C.startGame(42);
    return {
      rightHasActions: document.getElementById('tc-a-actions').parentElement.id === 'wctrl-right',
      joyBHidden: document.getElementById('joy-b').classList.contains('hidden'),
    };
  });
  check('Solo-Layout: Aktionen rechts, Blau-Controls versteckt', r.rightHasActions && r.joyBHidden, JSON.stringify(r));

  // ---- Aus dem Fahrstuhl heraus graben (Grabtaste + Richtung)
  r = await page.evaluate(() => {
    const C = window.__clonk;
    C.game.mode = '2p';
    C.startGame(42);
    C.game.paused = true;
    const el = C.elevators()[0];
    const p = C.players()[0];
    p.x = el.x; p.y = el.y - 1; p.state = 'walk'; p.vx = 0; p.vy = 0;
    C.pressed.add('s');
    C.pressed.add('d');   // Grabtaste MIT Richtung: seitlich rausgraben
    return { elY0: el.y, x0: p.x };
  });
  await tick(1);
  r = await page.evaluate(({ elY0, x0 }) => {
    const C = window.__clonk;
    C.pressed.delete('s'); C.pressed.delete('d');
    const el = C.elevators()[0];
    const p = C.players()[0];
    return { state: p.state, moved: p.x - x0, drilled: el.y - elY0 };
  }, r);
  check('Grabtaste + Richtung gräbt seitlich aus dem Fahrstuhl (Korb bohrt nicht)',
    r.state === 'dig' && r.moved > 8 && r.drilled === 0, JSON.stringify(r));

  // ---- Grubenlift: Joystick nach unten bohrt (ohne ⛏️-Taste)
  r = await page.evaluate(() => {
    const C = window.__clonk;
    C.startGame(42);
    C.game.paused = true;
    const el = C.elevators()[0];
    const p = C.players()[0];
    p.x = el.x; p.y = el.y - 1; p.state = 'walk'; p.vx = 0; p.vy = 0;
    C.joys[0].dy = 1;
    return { y0: el.y };
  });
  await tick(1);
  r = await page.evaluate((y0) => {
    const C = window.__clonk;
    C.joys[0].dy = 0;
    return { drilled: C.elevators()[0].y - y0 };
  }, r.y0);
  check('Joystick nach unten bohrt auf dem Aufzugskorb', r.drilled > 15, JSON.stringify(r));

  // ---- Nach oben graben geht NICHT (wie im Original – nur Brücke/Klettern/Lift)
  r = await page.evaluate((x) => {
    const C = window.__clonk;
    C.startGame(42);
    C.game.paused = true;
    const p = C.players()[0];
    const g = C.groundY()[x];
    C.carveCircle(x, g + 50, 13, true);   // Höhle als Startpunkt
    let floor = g + 50;
    while (!C.solid(x, floor + 1)) floor++;
    p.x = x; p.y = floor; p.state = 'walk'; p.vx = 0; p.vy = 0;
    C.pressed.add('s'); C.pressed.add('w'); C.pressed.add('d');   // Grab + Sprung + Richtung
    return { y0: p.y, x0: p.x };
  }, dryB);
  await tick(0.9);
  r = await page.evaluate(({ y0, x0 }) => {
    const C = window.__clonk;
    C.pressed.delete('s'); C.pressed.delete('w'); C.pressed.delete('d');
    const p = C.players()[0];
    return { rose: y0 - p.y, moved: p.x - x0 };
  }, r);
  check('Hochgraben ist unmöglich – es geht nur waagerecht weiter', r.rose < 4 && r.moved > 6, JSON.stringify(r));

  // ---- Buddel-Modus (Sandbox): offen, ohne Gegner, koop-fähig
  r = await page.evaluate(() => {
    const C = window.__clonk;
    C.game.mode = 'sandbox';
    C.startGame(42);
    C.game.paused = true;
    const t0 = C.game.t;
    for (let i = 0; i < 60; i++) C.update(0.016);
    const p = C.players()[0];
    p.score = 99;
    C.update(0.016);
    return {
      aiOff: C.players()[1].ai === false,
      timerFrozen: C.game.t === t0,
      neverOver: C.game.state === 'play',
    };
  });
  check('Buddel-Modus: keine KI, kein Zeitlimit, kein Rundenende', r.aiOff && r.timerFrozen && r.neverOver, JSON.stringify(r));
  r = await page.evaluate(() => {
    const C = window.__clonk;
    const [a, b] = C.players();
    a.x = 200; b.x = 800;
    b.activeT = 0;
    for (let i = 0; i < 80; i++) C.computeCam(0.05);
    const soloCamX = C.cam.x;
    b.activeT = 10;                     // Blau steigt ein (Koop)
    for (let i = 0; i < 80; i++) C.computeCam(0.05);
    return { soloCamX, koopCamX: C.cam.x };
  });
  check('Buddel-Kamera folgt Rot, bis Blau mitspielt (dann beide im Bild)',
    r.soloCamX < 420 && r.koopCamX > r.soloCamX + 60, JSON.stringify(r));

  // ---- Menü: Options-Reihen statt Selects
  r = await page.evaluate(() => {
    const C = window.__clonk;
    const row = document.getElementById('opt-goal');
    row.querySelector('button[data-v="12"]').click();
    const modeRow = document.getElementById('opt-mode');
    return {
      goal: C.game.goal,
      goalSel: row.querySelector('button[data-v="12"]').classList.contains('sel'),
      modeButtons: modeRow.children.length,
      modeSel: modeRow.querySelector('button.sel')?.dataset.v,
    };
  });
  check('Menü-Buttons: Spielziel-Klick übernimmt & markiert', r.goal === 12 && r.goalSel, JSON.stringify(r));
  check('Modus-Reihe zeigt 3 Optionen, aktuelle markiert', r.modeButtons === 3 && r.modeSel === 'sandbox', JSON.stringify(r));

  // ---- Werfen aus dem Inventar: Wurfgut wechseln + Auto-Auswahl
  r = await page.evaluate((x) => {
    const C = window.__clonk;
    C.game.mode = '2p';
    C.startGame(42);
    C.game.paused = true;
    const p = C.players()[0];
    p.x = x; p.y = C.groundY()[x] - 1; p.state = 'walk';
    p.flints = 2; p.carry = 2; p.throwSel = 0;
    C.pressed.add('r');   // Wurfgut wechseln: 💣 -> 💰
    C.update(0.016);
    C.pressed.delete('r');
    const sel = p.throwSel;
    C.pressed.add('q');
    C.update(0.016);
    C.pressed.delete('q');
    return {
      sel, carry: p.carry, flints: p.flints,
      thrown: C.items().some((i) => i.type === 'nugget' && i.own),
    };
  }, dryA);
  check('R wechselt das Wurfgut auf 💰 Gold', r.sel === 1, JSON.stringify(r));
  check('Geworfenes Gold fliegt als Gegenstand (Feuersteine bleiben in der Tasche)',
    r.carry === 1 && r.flints === 2 && r.thrown, JSON.stringify(r));
  r = await page.evaluate(() => {
    const C = window.__clonk;
    const p = C.players()[0];
    p.flints = 0; p.carry = 0; p.coal = 1; p.throwSel = 0;   // Gewähltes leer
    p.throwCd = 0;
    C.throwItem(p);
    return { coal: p.coal, sel: p.throwSel, thrown: C.items().some((i) => i.type === 'coal' && i.own) };
  });
  check('Leeres Wurfgut: automatisch nächstes (⚫ Kohle)', r.coal === 0 && r.sel === 2 && r.thrown, JSON.stringify(r));
  await tick(1);
  r = await page.evaluate(() => {
    const C = window.__clonk;
    const p = C.players()[0];
    const it = C.items().find((i) => i.type === 'coal');
    if (it) { p.x = it.x; p.y = it.y + 6; }   // hinterherlaufen
    return null;
  });
  await tick(0.2);
  r = await page.evaluate(() => {
    const C = window.__clonk;
    return { coal: C.players()[0].coal, left: C.items().some((i) => i.type === 'coal') };
  });
  check('Geworfenes lässt sich wieder aufsammeln (nach kurzer Schonfrist)', r.coal === 1 && !r.left, JSON.stringify(r));

  // ---- Sprengung im See hinterlässt keine dunklen Flecken über der Oberfläche
  r = await page.evaluate(() => {
    const C = window.__clonk, M = C.MAT;
    C.startGame(42);
    C.game.paused = true;
    let wx = -1, wy = -1, best = 0;
    for (let x = 40; x < C.WORLD_W - 40; x += 4) {
      let depth = 0, top = -1;
      for (let y = 100; y < C.WORLD_H; y++) if (C.matAt(x, y) === M.WATER) { if (top < 0) top = y; depth++; }
      if (depth > best) { best = depth; wx = x; wy = top; }
    }
    C.explode(wx, wy + 6, null);
    let darkAboveSurface = 0;
    for (let y = wy - 30; y < wy + 30; y++) for (let x = wx - 30; x <= wx + 30; x++) {
      if (C.matAt(x, y) === M.TUNNEL && y < C.groundY()[x]) darkAboveSurface++;
    }
    return { darkAboveSurface };
  });
  check('Sprengung im See: kein dunkler Stollen-Fleck über der Oberfläche', r.darkAboveSurface === 0, JSON.stringify(r));

  // ---- Waagerecht graben trägt zuverlässig (auch über Unebenheiten)
  r = await page.evaluate((x) => {
    const C = window.__clonk;
    C.startGame(42);
    C.game.paused = true;
    const p = C.players()[0];
    const g = C.groundY()[x];
    p.x = x; p.y = g - 1; p.state = 'walk'; p.vx = 0; p.vy = 0;
    C.pressed.add('s');
    return { y0: p.y };
  }, dryA);
  await tick(0.8);   // erst ein Stück senkrecht runter
  r = await page.evaluate((y0) => {
    const C = window.__clonk;
    const p = C.players()[0];
    C.pressed.add('d');   // dann waagerecht weiter
    return { y0, x0: p.x, y1: p.y };
  }, r.y0);
  await tick(1.5);
  r = await page.evaluate(({ x0, y1 }) => {
    const C = window.__clonk;
    C.pressed.delete('s'); C.pressed.delete('d');
    const p = C.players()[0];
    return { moved: p.x - x0, sank: p.y - y1, state: p.state };
  }, r);
  check('Waagerecht graben aus dem Schacht heraus trägt weit', r.moved > 25 && r.state === 'dig', JSON.stringify(r));

  // ---- Spielstände: kompletter Roundtrip über die RLE-Maske
  r = await page.evaluate((x) => {
    const C = window.__clonk;
    C.startGame(42);
    C.game.paused = true;
    const p = C.players()[0];
    C.carveCircle(x, C.groundY()[x] + 30, 12, true);   // markante Höhle graben
    p.score = 4; p.carry = 2; p.flints = 3; p.coal = 2;
    p.x = x; p.y = C.groundY()[x] - 1; p.state = 'walk';   // weg von der Hütte,
    C.game.t = 123;                                        // sonst liefert er beim Laden ab
    const snap = C.serialize();
    const size = JSON.stringify({ data: snap }).length;
    C.startGame(99);                                    // ganz andere Welt
    const holeGone = C.solid(x, C.groundY()[x] + 30);
    const ok = C.applyLoad(snap);
    return {
      ok, size, holeGone,
      holeBack: !C.solid(x, C.groundY()[x] + 30),
      score: C.players()[0].score, carry: C.players()[0].carry,
      flints: C.players()[0].flints, coal: C.players()[0].coal,
      t: Math.round(C.game.t), lifts: C.elevators().length,
    };
  }, dryA);
  check('Spielstand: Serialisieren + Laden stellt die Welt wieder her',
    r.ok && r.holeBack && r.score === 4 && r.carry === 2 && r.flints === 3 && r.coal === 2 && r.t === 123 && r.lifts === 2,
    JSON.stringify(r));
  check('Spielstand passt in den Server-Slot (< 200 kB)', r.size < 200000, 'size=' + r.size);
  r = await page.evaluate(async () => {
    const C = window.__clonk;
    await C.saveGame();                                  // ohne Login -> localStorage
    const p = C.players()[0];
    p.score = 0;
    C.startGame(7);
    const loaded = await C.loadGame();
    return { loaded, score: C.players()[0].score, hasLocal: !!localStorage.getItem('clonk_save') };
  });
  check('💾 Speichern/📂 Laden über localStorage funktioniert',
    r.loaded && r.score === 4 && r.hasLocal, JSON.stringify(r));

  // ---- Kamera: Solo folgt dem Spieler, Zoom ändert den Maßstab
  r = await page.evaluate(() => {
    const C = window.__clonk;
    C.game.mode = 'solo';
    C.startGame(42);            // solo -> cam.zoom = 2.1
    C.game.paused = true;
    for (let i = 0; i < 80; i++) C.computeCam(0.05);
    const s1 = C.cam.scale, z1 = C.cam.zoom;
    C.setZoom(3.4);
    for (let i = 0; i < 80; i++) C.computeCam(0.05);
    return { z1, s1, s2: C.cam.scale, camX: C.cam.x };
  });
  check('Solo startet reingezoomt (kleinerer Bildausschnitt)', r.z1 > 1.5, 'zoom=' + r.z1);
  check('＋/－-Zoom ändert den Maßstab', r.s2 > r.s1 * 1.3, JSON.stringify(r));
  check('Kamera bleibt beim eigenen Klonk (linke Kartenhälfte)', r.camX < 480, 'camX=' + r.camX);

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
    return { need, ok: need <= innerWidth + 2 };
  });
  check('2P-Zoom hält beide Klonks im Bild', r.ok, JSON.stringify(r));

  // ---- Querformat-Drehung
  await page.click('#btn-rotate');
  r = await page.evaluate(() => document.getElementById('stage').classList.contains('rot'));
  check('⟳ dreht die Bühne ins Querformat', r === true);
  await page.click('#btn-rotate');
  r = await page.evaluate(() => document.getElementById('stage').classList.contains('rot'));
  check('⟳ dreht auch wieder zurück', r === false);

  // ---- Hilfe-Panel im gedrehten Querformat (Handy hochkant): muss in die
  // gedrehte Bühne passen und scrollbar sein (Bug: max-height in vh lief
  // aus dem Bild, Scrollen griff ins Leere)
  const page2 = await browser.newPage({ viewport: { width: 400, height: 800 } });
  page2.on('pageerror', (e) => check('Hochformat-Seite ohne JS-Fehler', false, e.message));
  await page2.goto(srv.url + '/clonk.html');
  await page2.waitForFunction(() => window.__clonk);
  r = await page2.evaluate(() => {
    document.getElementById('stage').classList.add('rot');
    const panel = document.querySelector('#help .panel');
    const cs = getComputedStyle(panel);
    panel.scrollTop = 120;
    return {
      maxH: parseFloat(cs.maxHeight), iw: innerWidth, overflow: cs.overflowY,
      scrollable: panel.scrollHeight > panel.clientHeight, scrolled: panel.scrollTop > 0,
    };
  });
  check('Hilfe-Panel passt im Querformat in die gedrehte Bühne',
    r.maxH <= r.iw && r.overflow === 'auto', JSON.stringify(r));
  check('Hilfe lässt sich im Querformat scrollen', r.scrollable && r.scrolled, JSON.stringify(r));
  await page2.close();
} finally {
  await browser.close();
  srv.stop();
}

process.exit(summary() ? 1 : 0);
