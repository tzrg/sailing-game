// Tower Defense: die komplette Spiellogik-Suite (Spezialisierungen, Kegel,
// Superwaffen, Bestrahlung, Wind-Regel, Querformat, Stufe 4, Resistenzen,
// Railgun, Hypnose, Fernsehturm, Kids-Modus, Zähler, Statistik, Historie,
// Spielstand-Roundtrip).
// Läuft über den Test-Hook window.__td gegen einen frischen Server.

import { startServer, launchBrowser, checker } from './helpers.mjs';

const srv = startServer();
await srv.ready;
const base = srv.url;
const { check, summary } = checker();

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 480, height: 860 } });
page.on('pageerror', (e) => check('Seite ohne JS-Fehler', false, e.message));
await page.goto(base + '/td.html');
await page.waitForFunction(() => window.__td);

// Hilfen im Seitenkontext
await page.evaluate(() => {
  // Gegner auf einer Pfadkachel verankern (stepEnemy setzt x/y aus pathI neu)
  window.mkEnemy = (tx, ty, hp, armor = 0) => {
    const pathI = window.__td.PATH.findIndex((p) => p[0] === tx && p[1] === ty);
    if (pathI < 0) throw new Error('kein Pfadfeld: ' + tx + ',' + ty);
    const e = { type: 'blob', hp, maxHp: hp, speed: 0, pathI, frac: 0, x: tx + 0.5, y: ty + 0.5,
      slowT: 0, slowF: 0, burnT: 0, burnDps: 0, bounty: 0, boss: false, regen: 0,
      armorHp: armor, maxArmor: armor, vulnFire: 0, vulnShock: 0, windCd: 0,
      r: 0.28, color: '#fff', wob: 0 };
    window.__td.enemies.push(e);
    return e;
  };
  window.tapTile = (x, y) => {
    const T = Math.min(innerWidth / 12, (innerHeight - 210) / 17);
    const OX = (innerWidth - 12 * T) / 2, OY = 92;
    document.getElementById('game').dispatchEvent(new PointerEvent('pointerdown', {
      clientX: OX + (x + 0.5) * T, clientY: OY + (y + 0.5) * T, bubbles: true }));
  };
});

// ---- 1) Spezialisierung per UI kaufen (MG) --------------------------------
let r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.money = 1000;
  TD.place('mg', 4, 3);
  window.tapTile(4, 3);   // Upgrade-Panel öffnen
  const box = document.getElementById('upg-ammo');
  const visible = !box.classList.contains('hidden');
  const btns = box.querySelectorAll('.ammo-btn');
  const before = TD.game.money;
  btns[2].click();        // Wolframkern
  const t = TD.towers[0];
  return { visible, nBtns: btns.length, spec: t.spec, spent: before - TD.game.money,
    chosen: !!box.querySelector('.ammo-chosen'), btnsAfter: box.querySelectorAll('.ammo-btn').length };
});
check('MG-Spezialbox sichtbar mit 3 Optionen', r.visible && r.nBtns === 3, JSON.stringify(r));
check('Kauf setzt t.spec=tungsten und kostet 90', r.spec === 'tungsten' && r.spent === 90);
check('nach Kauf exklusiv (keine weiteren Buttons)', r.chosen && r.btnsAfter === 0);

// ---- 2) Kanone hat ebenfalls Spezialmunition, Granate dmg/range ------------
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.game.money = 5000;
  const c = TD.place('cannon', 7, 6);
  window.tapTile(7, 6);
  const cBtns = document.querySelectorAll('#upg-ammo .ammo-btn').length;
  const g = TD.place('grenade', 6, 3);
  const base = TD.effStats(g).range, baseDmg = TD.effStats(g).dmg, baseSplash = TD.effStats(g).splash;
  g.spec = 'range';
  const withRange = TD.effStats(g).range;
  g.spec = 'dmg';
  const withDmg = TD.effStats(g).dmg, withSplash = TD.effStats(g).splash;
  const te = TD.place('tesla', 5, 6);
  const baseChain = TD.effStats(te).chain;
  te.spec = 'chain';
  const gi = TD.place('gift', 6, 6);
  const gBase = TD.effStats(gi);
  gi.spec = 'dur';
  const gDur = TD.effStats(gi).dur;
  gi.spec = 'pool';
  const gPool = TD.effStats(gi).pool;
  return { cBtns, cType: c.type, dRange: withRange - base, dDmg: withDmg / baseDmg,
    dSplash: withSplash - baseSplash, dChain: TD.effStats(te).chain - baseChain,
    gDur: gDur - gBase.dur, gPool: gPool / gBase.pool };
});
check('Kanone bietet 3 Munitionsarten', r.cBtns === 3, JSON.stringify(r));
check('Granate: Langrohr +1.0 Reichweite', Math.abs(r.dRange - 1.0) < 1e-9);
check('Granate: Sprengkraft x1.5 Schaden + 0.35 Fläche', Math.abs(r.dDmg - 1.5) < 1e-9 && Math.abs(r.dSplash - 0.35) < 1e-9);
check('Tesla: Mehr Ziele +2 Ketten', r.dChain === 2);
check('Gift: Zähflüssig +3s, Große Pfützen x1.4', Math.abs(r.gDur - 3) < 1e-9 && Math.abs(r.gPool - 1.4) < 1e-9);

// ---- 3) Flammenwerfer-Kegel ------------------------------------------------
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.money = 1000;
  const f = TD.place('flame', 5, 4);
  const a = window.mkEnemy(6, 5, 500);   // schräg vorm Rohr, im Kegel
  const b = window.mkEnemy(4, 5, 500);   // gleiche Distanz, außerhalb des Kegels
  for (let i = 0; i < 12; i++) TD.update(0.05);
  return { aHp: a.hp, bHp: b.hp, angle: f.angle, cone: TD.effStats(f).cone };
});
check('Flamme trifft Gegner im Kegel', r.aHp < 499, JSON.stringify(r));
check('Gegner hinter dem Turm bleibt heil', r.bHp === 500, 'bHp=' + r.bHp);

// Breitmaul verbreitert den Kegel
r = await page.evaluate(() => {
  const TD = window.__td;
  const f = TD.towers[0];
  const basis = TD.effStats(f).cone;
  f.spec = 'wide';
  return { basis, breit: TD.effStats(f).cone };
});
check('Breitmaul: Kegel 0.95 → 1.75', r.basis === 0.95 && r.breit === 1.75);

// ---- 4) Kommandozentrale + Nuke -------------------------------------------
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.money = 1000;
  const hiddenBefore = document.getElementById('btn-nuke').classList.contains('hidden');
  TD.place('command', 4, 6);
  const nukeBtn = document.getElementById('btn-nuke');
  const visAfter = !nukeBtn.classList.contains('hidden') && !document.getElementById('btn-slaser').classList.contains('hidden');
  const a = window.mkEnemy(5, 8, 1000);
  const tank = window.mkEnemy(6, 8, 300, 200);   // gepanzert
  nukeBtn.click();
  TD.update(0.05);
  const secondTry = a.hp;
  nukeBtn.click();   // darf nix mehr tun
  TD.update(0.05);
  return { hiddenBefore, visAfter, used: TD.game.nukeUsed, aHp: a.hp, sameAfter2nd: a.hp === secondTry,
    tankHp: tank.hp, tankArmor: tank.armorHp, disabled: nukeBtn.disabled };
});
check('Superwaffen erst mit Kommandozentrale sichtbar', r.hiddenBefore && r.visAfter, JSON.stringify(r));
check('Nuke macht 340 Flächenschaden (Stufe 1)', r.aHp === 660, 'aHp=' + r.aHp);
check('Panzerung schluckt Nuke (Rüstung leidet, HP heil)', r.tankHp === 300 && r.tankArmor === 200 - 340 * 0.25, 'armor=' + r.tankArmor);
check('Nuke nur 1x (Button disabled, kein Doppelschaden)', r.used && r.disabled && r.sameAfter2nd);

// Reset zur nächsten Welle
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.startWave();
  return { used: TD.game.nukeUsed, laserUsed: TD.game.laserUsed, disabled: document.getElementById('btn-nuke').disabled };
});
check('startWave setzt Superwaffen zurück', !r.used && !r.laserUsed && !r.disabled);

// ---- 5) Orbital-Laser: Button → Ziel antippen ------------------------------
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.money = 1000;
  TD.place('command', 4, 6);
  const a = window.mkEnemy(5, 8, 1000);
  const far = window.mkEnemy(0, 2, 1000);
  const tank = window.mkEnemy(6, 8, 1000, 500);
  document.getElementById('btn-slaser').click();
  const targeting = TD.game.targeting;
  window.tapTile(5, 8);   // Mitte (5.5, 8.5); Panzer bei (6.5,8.5) -> Abstand 1.0 im Radius
  for (let i = 0; i < 20; i++) TD.update(0.05);
  return { targeting, used: TD.game.laserUsed, aHp: a.hp, farHp: far.hp,
    tankArmor: tank.armorHp, tankHp: tank.hp, targetingAfter: TD.game.targeting };
});
check('Laser-Button aktiviert Zielmodus', r.targeting === 'slaser');
check('Tap feuert: 600 Laserschaden im Radius', r.aHp === 400 && r.farHp === 1000, JSON.stringify(r));
check('Laser sprengt Panzerung (500 Rüstung weg, HP heil)', r.tankArmor === 0 && r.tankHp === 1000, 'armor=' + r.tankArmor);
check('Zielmodus beendet, verbraucht', r.used && r.targetingAfter === null);

// Verkauf der Kommandozentrale blendet Buttons aus
r = await page.evaluate(() => {
  const TD = window.__td;
  window.tapTile(4, 6);
  document.getElementById('upg-sell').click();
  return { hidden: document.getElementById('btn-nuke').classList.contains('hidden') };
});
check('Verkauf versteckt Superwaffen wieder', r.hidden);

// ---- 6) Kommandozentrale upgraden: Superwaffen werden stärker --------------
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.money = 5000;
  const c = TD.place('command', 4, 6);
  TD.upgrade(c); TD.upgrade(c);   // Stufe 3
  const lvl = c.lvl;
  const a = window.mkEnemy(5, 8, 1000);
  TD.fireNuke();
  const nukeHp = a.hp;
  TD.startWave();                 // Superwaffen zurücksetzen
  const b = window.mkEnemy(6, 8, 2000);
  TD.fireSlaser(6.5, 8.5);
  for (let i = 0; i < 12; i++) TD.update(0.05);
  return { lvl, nukeHp, beamHp: b.hp };
});
check('Kommandozentrale Stufe 3 (2 Upgrades)', r.lvl === 2, JSON.stringify(r));
check('Nuke Stufe 3 macht 780 Schaden', r.nukeHp === 220, 'hp=' + r.nukeHp);
check('Orbital-Laser Stufe 3 macht 1450 Schaden', r.beamHp === 550, 'hp=' + r.beamHp);

// ---- 6b) Bestrahlungsturm: permanente, panzerignorierende Verstrahlung -----
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.money = 2000;
  const ry = TD.place('ray', 5, 4);
  const a = window.mkEnemy(6, 5, 400, 200);   // gepanzert, im Kegel
  const b = window.mkEnemy(4, 5, 400);        // gleiche Distanz, außerhalb des Kegels
  for (let i = 0; i < 40; i++) TD.update(0.05);
  return { aHp: a.hp, aArmor: a.armorHp, aRad: a.radDps, bHp: b.hp, bRad: b.radDps || 0,
    cone: TD.effStats(ry).cone, cap: TD.effStats(ry).cap };
});
check('Verstrahlung nagt direkt an HP, Panzerung bleibt voll', r.aHp < 399 && r.aArmor === 200, JSON.stringify(r));
check('Verstrahlung baut sich auf (radDps > 0, unter Limit)', r.aRad > 2 && r.aRad <= r.cap, 'rad=' + r.aRad);
check('Gegner außerhalb des Kegels bleibt sauber', r.bHp === 400 && r.bRad === 0);

// Turm verkaufen -> Verstrahlung wirkt trotzdem weiter (für immer)
r = await page.evaluate(() => {
  const TD = window.__td;
  window.tapTile(5, 4);
  document.getElementById('upg-sell').click();
  const a = TD.enemies[0];
  const radBefore = a.radDps, hpBefore = a.hp;
  for (let i = 0; i < 40; i++) TD.update(0.05);
  return { towers: TD.towers.length, radBefore, radAfter: a.radDps, drop: hpBefore - a.hp };
});
check('Nach Turmverkauf tickt die Verstrahlung weiter', r.towers === 0 && r.radAfter === r.radBefore && r.drop > r.radBefore * 2 * 0.9,
  JSON.stringify(r));

// Spezialisierung: Zerfallsplus
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.game.money = 2000;
  const ry = TD.place('ray', 5, 4);
  const base = TD.effStats(ry);
  ry.spec = 'charge';
  const c = TD.effStats(ry);
  ry.spec = 'range';
  return { dCharge: c.charge / base.charge, cap: c.cap, dRange: TD.effStats(ry).range - base.range };
});
check('Ray-Spec: Zerfallsplus x1.5, Langstrahler +0.8', Math.abs(r.dCharge - 1.5) < 1e-9 && r.cap === 39 && Math.abs(r.dRange - 0.8) < 1e-9, JSON.stringify(r));

// ---- 6c) Windmaschine: nur vorderster Gegner, 3/4-Aufhol-Regel -------------
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.money = 2000;
  const w = TD.place('wind', 5, 4);   // Reichweite 2.6 deckt Reihe 5 ab
  const front = window.mkEnemy(4, 5, 500);   // weiter auf dem Pfad (Reihe 5 läuft nach links)
  const back = window.mkEnemy(6, 5, 500);
  front.speed = 1.5; back.speed = 1.5;
  const progOf = (e) => e.pathI + e.frac;
  const pf0 = progOf(front), pb0 = progOf(back);
  TD.update(0.05);                    // Turm feuert sofort (cd=0)
  const s = TD.effStats(w);
  const expected = 0.75 * 1.5 / s.rate;   // 6.25 Kacheln bei Stufe 1
  return { dFront: pf0 - progOf(front), dBack: progOf(back) - pb0, expected,
    cdFront: front.windCd, cdBack: back.windCd };
});
check('Wind trifft nur den vordersten Gegner', r.dFront > 5 && Math.abs(r.dBack - 0.075) < 0.02, JSON.stringify(r));
check('Wurfweite = 3/4 der Strecke bis zum nächsten Stoß', Math.abs(r.dFront - (r.expected - 0.075)) < 0.1, 'd=' + r.dFront + ' exp=' + r.expected);
check('Getroffener ist kurz windfest, der andere nicht', r.cdFront > 0 && r.cdBack === 0);

// Langfristig kommt der Gegner trotz Dauerwind vorbei
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.money = 2000;
  TD.place('wind', 5, 4);
  const e = window.mkEnemy(0, 2, 1e9);   // Pfadstart, unsterblich
  e.speed = 1.5;
  const lives0 = TD.game.lives;
  let guard = 0;
  while (!e.escaped && guard++ < 3000) TD.update(0.05);   // max 150 s
  return { escaped: !!e.escaped, seconds: guard * 0.05, livesDrop: lives0 - TD.game.lives };
});
check('Trotz Windmaschine kommt der Gegner langfristig durch', r.escaped && r.livesDrop === 1, JSON.stringify(r));

// ---- 6d) Querformat: Feld gedreht, Eingaben richtig zurückgerechnet --------
{
  const lp = await browser.newPage({ viewport: { width: 860, height: 480 } });
  await lp.goto(base + '/td.html');
  await lp.waitForFunction(() => window.__td);
  const lr = await lp.evaluate(() => {
    const TD = window.__td;
    TD.newGame();
    const g = TD.geom;
    // Kachel (4,3) über die gedrehte Abbildung antippen
    const cx = g.OX + 17 * g.T - (3 + 0.5) * g.T;
    const cy = g.OY + (4 + 0.5) * g.T;
    document.getElementById('game').dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, bubbles: true }));
    return { rot: g.ROT, T: g.T, sel: TD.game.sel,
      buildbar: !document.getElementById('buildbar').classList.contains('hidden') };
  });
  check('Querformat aktiviert Drehung mit größeren Kacheln', lr.rot && lr.T > 20, JSON.stringify(lr));
  check('Tap im gedrehten Feld trifft die richtige Kachel', lr.sel && lr.sel.x === 4 && lr.sel.y === 3 && lr.buildbar, JSON.stringify(lr));
  await lp.close();
}

// ---- 6e) Stufe 4: sündhaft teurer Endgame-Ausbau ---------------------------
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.money = 20000;
  const m = TD.place('mg', 4, 3);
  TD.upgrade(m); TD.upgrade(m);
  const costL4 = TD.TOWERS.mg.levels[3].cost;
  const before = TD.game.money;
  TD.upgrade(m);
  const paid = before - TD.game.money;
  const c = TD.place('command', 4, 6);
  TD.upgrade(c); TD.upgrade(c); TD.upgrade(c);
  const a = window.mkEnemy(5, 8, 3000);
  TD.fireNuke();
  return { lvl: m.lvl, dmg: TD.effStats(m).dmg, costL4, paid,
    cLvl: c.lvl, nukeHp: a.hp, maxed: !TD.TOWERS.mg.levels[4] };
});
check('MG Stufe 4: 1000 Gold, 45 Schaden, dann Schluss', r.lvl === 3 && r.dmg === 45 && r.costL4 === 1000 && r.paid === 1000 && r.maxed, JSON.stringify(r));
check('Kommandozentrale Stufe 4: Nuke macht 1400', r.cLvl === 3 && r.nukeHp === 1600, 'hp=' + r.nukeHp);

// ---- 6f) Resistenzler: Feuer/Laser/Blitz prallen ab ------------------------
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.money = 5000;
  TD.place('flame', 5, 4);
  const norm = window.mkEnemy(6, 5, 5000);
  const emb = window.mkEnemy(5, 5, 5000);   // direkt vorm Rohr, feuerresistent
  emb.resist = 'fire';
  for (let i = 0; i < 30; i++) TD.update(0.05);
  const fireRatio = (5000 - emb.hp) / (5000 - norm.hp);
  // Tesla vs. Geerdeter
  TD.newGame(); TD.game.money = 5000;
  TD.place('tesla', 5, 4);
  const n2 = window.mkEnemy(5, 5, 5000);
  TD.update(0.05);
  const normShock = 5000 - n2.hp;
  TD.newGame(); TD.game.money = 5000;
  TD.place('tesla', 5, 4);
  const b2 = window.mkEnemy(5, 5, 5000);
  b2.resist = 'shock';
  TD.update(0.05);
  const resShock = 5000 - b2.hp;
  return { fireRatio, normShock, resShock, shockRatio: resShock / normShock };
});
check('Glutläufer nimmt ~10% Feuerschaden', r.fireRatio > 0.05 && r.fireRatio < 0.2, 'ratio=' + r.fireRatio);
check('Geerdeter nimmt genau 10% Blitzschaden', Math.abs(r.shockRatio - 0.1) < 1e-6, JSON.stringify(r));

// Spätwellen enthalten die neuen Typen
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.wave = 13;
  TD.startWave();   // -> Welle 14
  const list = TD.game.toSpawn;
  return { wave: TD.game.wave, ember: list.includes('ember'), prisma: list.includes('prisma'), blitzer: list.includes('blitzer') };
});
check('Welle 14 bringt Glutläufer, Prismen und Geerdete', r.ember && r.prisma && r.blitzer, JSON.stringify(r));

// ---- 6g) Railgun: Boss-Killer mit Streuung ---------------------------------
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.money = 5000;
  const rg = TD.place('railgun', 5, 4);
  const boss = window.mkEnemy(5, 5, 100000, 50000);
  boss.boss = true;
  const origRandom = Math.random;
  Math.random = () => 0.99;               // würde bei Kleinen IMMER verfehlen
  TD.update(0.05);                        // erster Schuss (cd=0)
  Math.random = origRandom;
  const s = TD.effStats(rg);
  return { bossHp: boss.hp, bossArmor: boss.armorHp, dmg: s.dmg, mul: s.bossMul,
    expected: 100000 - s.dmg * s.bossMul };
});
check('Railgun trifft Boss immer, 3× Schaden, ignoriert Panzerung',
  r.bossHp === r.expected && r.bossArmor === 50000, JSON.stringify(r));

r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.money = 5000;
  const rg = TD.place('railgun', 5, 4);
  const small = window.mkEnemy(5, 5, 100000);
  const origRandom = Math.random;
  Math.random = () => 0.99;   // verfehlt
  TD.update(0.05);
  const missHp = small.hp;
  rg.cd = 0;
  Math.random = () => 0.0;    // trifft
  TD.update(0.05);
  Math.random = origRandom;
  const s = TD.effStats(rg);
  // Spezialisierungen
  const base = TD.effStats(rg);
  rg.spec = 'focus';
  const foc = TD.effStats(rg);
  rg.spec = 'hyper';
  const hyp = TD.effStats(rg);
  return { missHp, hitHp: small.hp, dmg: s.dmg, baseAcc: base.acc, focAcc: foc.acc,
    hypAcc: hyp.acc, hypMul: hyp.bossMul };
});
check('Railgun verfehlt kleine Gegner (kein Schaden)', r.missHp === 100000, 'hp=' + r.missHp);
check('Railgun-Treffer macht vollen Schaden (1×)', r.hitHp === 100000 - r.dmg, 'hp=' + r.hitHp);
check('Fokus: 90% Trefferquote · Hypercharge: halbe Quote, Boss ×6',
  r.focAcc === 0.9 && Math.abs(r.hypAcc - r.baseAcc * 0.5) < 1e-9 && r.hypMul === 6, JSON.stringify(r));

// ---- 6h) Hypnoseturm --------------------------------------------------------
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.money = 5000;
  const hy = TD.place('hypno', 5, 4);
  const victim = window.mkEnemy(4, 5, 4000);   // vorderster -> wird hypnotisiert
  victim.maxHp = 4000;
  const prey = window.mkEnemy(5, 5, 4000);     // steht daneben -> wird gebissen
  victim.speed = 1.5; prey.speed = 0;
  const p0 = victim.pathI + victim.frac;
  for (let i = 0; i < 20; i++) TD.update(0.05);   // 1 s
  const s = TD.effStats(hy);
  return { hypnoT: victim.hypnoT, victimMoved: (victim.pathI + victim.frac) - p0,
    victimHp: victim.hp, preyHp: prey.hp, dur: s.dur,
    expectedBite: 4000 * s.factor * 1.0 };
});
check('Hypnose: Opfer bleibt stehen und ist markiert', r.hypnoT > 0 && r.victimMoved < 0.1 && r.victimHp === 4000, JSON.stringify(r));
check('Opfer beißt den Nachbarn (~Faktor x MaxHP/s)', Math.abs((4000 - r.preyHp) - r.expectedBite) < r.expectedBite * 0.15, 'bite=' + (4000 - r.preyHp));

r = await page.evaluate(() => {
  const TD = window.__td;
  // Nach Ablauf der Hypnose läuft das Opfer weiter; Bosse sind immun
  const victim = TD.enemies[0];
  victim.hypnoT = 0.01;
  const p0 = victim.pathI + victim.frac;
  for (let i = 0; i < 10; i++) TD.update(0.05);
  const moved = (victim.pathI + victim.frac) - p0;
  TD.newGame(); TD.game.money = 5000;
  TD.place('hypno', 5, 4);
  const boss = window.mkEnemy(5, 5, 100000);
  boss.boss = true;
  for (let i = 0; i < 10; i++) TD.update(0.05);
  return { moved, bossHypno: boss.hypnoT || 0 };
});
check('Nach der Hypnose geht es weiter · Bosse sind immun', r.moved > 0.5 && r.bossHypno === 0, JSON.stringify(r));

// ---- 6i) Abschuss-Zähler ----------------------------------------------------
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.money = 5000;
  const m = TD.place('mg', 4, 3);
  const e = window.mkEnemy(4, 2, 10);   // ein MG-Schuss reicht
  let guard = 0;
  while (!e.dead && guard++ < 200) TD.update(0.05);
  // Toggle im Menü
  const btn = document.getElementById('btn-kills');
  const before = btn.textContent;
  btn.click();
  const after = btn.textContent;
  // Kills landen im Spielstand
  TD.saveState();
  const save = JSON.parse(localStorage.getItem('td_save'));
  btn.click();   // wieder aus
  return { kills: m.kills, before, after, savedKills: save.towers[0].kills };
});
check('MG bekommt den Abschuss gutgeschrieben', r.kills === 1, 'kills=' + r.kills);
check('Toggle schaltet um und Kills stehen im Spielstand',
  r.before.includes('aus') && r.after.includes('an') && r.savedKills === 1, JSON.stringify(r));

// ---- 6j) Todesstoß-Regel + Schadenszähler ----------------------------------
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.money = 5000;
  const ry = TD.place('ray', 5, 4);
  const mg = TD.place('mg', 4, 4);
  const e = window.mkEnemy(5, 5, 5000);
  for (let i = 0; i < 20; i++) TD.update(0.05);   // Verstrahlung tickt, MG ballert
  // Jetzt den Todesstoß erzwingen: MG-Schuss (6 dmg) killt, obwohl Verstrahlung aktiv ist
  e.hp = 4;
  e.radDps = 0.001;   // Verstrahlung tickt weiter, killt aber nicht selbst
  mg.cd = 0;
  let guard = 0;
  while (!e.dead && guard++ < 100) TD.update(0.05);
  return { mgKills: mg.kills || 0, rayKills: ry.kills || 0,
    mgDmg: mg.dmgDone || 0, rayDmg: ry.dmgDone || 0, radDps: e.radDps };
});
check('Todesstoß: MG bekommt den Kill trotz aktiver Verstrahlung', r.mgKills === 1 && r.rayKills === 0, JSON.stringify(r));
check('Beide haben Schaden gutgeschrieben', r.mgDmg > 0 && r.rayDmg > 0, JSON.stringify(r));

// Verstrahlung als Todesstoß zählt für den Bestrahlungsturm
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.money = 5000;
  const ry = TD.place('ray', 5, 4);
  const e = window.mkEnemy(5, 5, 60);
  let guard = 0;
  while (!e.dead && guard++ < 2000) TD.update(0.05);
  return { rayKills: ry.kills || 0, dead: e.dead };
});
check('Verstrahlungs-Todesstoß zählt für den Bestrahlungsturm', r.dead && r.rayKills === 1, JSON.stringify(r));

// Schadenszähler: kein Overkill, Panzerschaden zählt mit
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.money = 5000;
  const mg = TD.place('mg', 4, 4);
  const e = window.mkEnemy(4, 5, 4);      // MG macht 6 -> nur 4 dürfen zählen
  let guard = 0;
  while (!e.dead && guard++ < 100) TD.update(0.05);
  const noOverkill = mg.dmgDone;
  const c = TD.place('cannon', 5, 4);
  const tank = window.mkEnemy(5, 5, 5000, 5000);   // dicke Panzerung
  c.cd = 0;
  TD.update(0.05);
  // Kanone 85 kinetisch x1.5 = 127.5 Panzerschaden
  return { noOverkill, cannonDmg: c.dmgDone || 0, tankArmor: tank.armorHp };
});
check('Kein Overkill im Schadenszähler (4 statt 6)', r.noOverkill === 4, 'dmg=' + r.noOverkill);
check('Panzerschaden zählt für den Schadenszähler', Math.abs(r.cannonDmg - 127.5) < 0.01 && Math.abs(r.tankArmor - (5000 - 127.5)) < 0.01, JSON.stringify(r));

// Schaden wandert mit in den Spielstand
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.saveState();
  const save = JSON.parse(localStorage.getItem('td_save'));
  const cannonSave = save.towers.find((t) => t.type === 'cannon');
  return { savedDmg: cannonSave.dmg };
});
check('Schadenszähler steht im Spielstand', r.savedDmg === 128 || r.savedDmg === 127, 'dmg=' + r.savedDmg);

// ---- 6k) Statistik-Ansicht --------------------------------------------------
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.money = 5000;
  const mg = TD.place('mg', 4, 3);
  const e1 = window.mkEnemy(4, 2, 10);            // Blob -> MG-Kill
  const e2 = window.mkEnemy(5, 2, 10);
  e2.type = 'tank';                                // "Panzer" -> MG-Kill
  let guard = 0;
  while ((!e1.dead || !e2.dead) && guard++ < 400) TD.update(0.05);
  const st = TD.stats;
  // Turm verkaufen -> Statistik bleibt
  window.tapTile(4, 3);
  document.getElementById('upg-sell').click();
  const afterSell = TD.stats.types.mg;
  // Ansicht öffnen
  document.getElementById('btn-menu').click();
  document.getElementById('btn-stats').click();
  const visible = !document.getElementById('stats').classList.contains('hidden');
  const html = document.getElementById('stats-body').innerHTML;
  document.getElementById('btn-stats-close').click();
  const closed = document.getElementById('stats').classList.contains('hidden');
  return { mgKills: st.types.mg.kills, mgDmg: st.types.mg.dmg,
    vsBlob: st.vs.mg.blob, vsTank: st.vs.mg.tank,
    sellKills: afterSell.kills, visible, closed,
    hasTable: html.includes('stats-table'), hasMatrix: html.includes('Wer erlegt'),
    hasMG: html.includes('MG'), hasTankCol: html.includes('🟣') };
});
check('Statistik je Turmart: 2 Kills, Schaden erfasst', r.mgKills === 2 && r.mgDmg >= 20, JSON.stringify(r));
check('Matrix: MG hat 1 Blob und 1 Panzer erlegt', r.vsBlob === 1 && r.vsTank === 1);
check('Statistik überlebt den Turmverkauf', r.sellKills === 2);
check('Statistik-Ansicht öffnet mit Tabelle + Matrix und schließt', r.visible && r.closed && r.hasTable && r.hasMatrix && r.hasMG && r.hasTankCol, JSON.stringify(r));

// Statistik wandert mit in den Spielstand
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.game.money = 500;
  TD.place('cannon', 3, 3);   // damit gespeichert wird
  TD.saveState();
  const save = JSON.parse(localStorage.getItem('td_save'));
  return { savedKills: save.stats && save.stats.types.mg && save.stats.types.mg.kills,
    savedVs: save.stats && save.stats.vs.mg && save.stats.vs.mg.tank };
});
check('Statistik steht im Spielstand', r.savedKills === 2 && r.savedVs === 1, JSON.stringify(r));

// ---- 6l) Auto-Lader: Feuerraten-Boost für Nachbarn --------------------------
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.money = 10000;
  const mg = TD.place('mg', 4, 3);
  const far = TD.place('cannon', 7, 3);
  const baseRate = TD.effStats(mg).rate;
  const ld = TD.place('loader', 4, 4);      // direkt unterm MG
  const boosted = TD.effStats(mg).rate;
  TD.upgrade(ld);
  const boosted2 = TD.effStats(mg).rate;
  const ld2 = TD.place('loader', 3, 3);     // zweiter, schwächerer Lader
  const best = TD.effStats(mg).rate;
  return { baseRate, boosted, boosted2, best, farRate: TD.effStats(far).rate,
    flag: TD.effStats(mg).boosted, farFlag: TD.effStats(far).boosted || null };
});
check('Auto-Lader: MG daneben schießt x1.5', Math.abs(r.boosted - r.baseRate * 1.5) < 0.01 && r.flag === 1.8, JSON.stringify(r));
check('Lader-Upgrade hebt auf x1.8', Math.abs(r.boosted2 - r.baseRate * 1.8) < 0.01);
check('Nur der beste Nachbar-Lader zählt, Ferne unberührt', Math.abs(r.best - r.baseRate * 1.8) < 0.01 && !r.farFlag);

// ---- 6m) Taktische Nuke: Zentrum extrem, außen wenig ------------------------
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.money = 10000;
  const ro = TD.place('rocket', 5, 4);
  ro.spec = 'tnuke';
  const center = window.mkEnemy(5, 5, 100000);
  const edge = window.mkEnemy(7, 5, 100000);   // ~2 Kacheln vom Einschlag
  let guard = 0;
  while (center.hp === 100000 && guard++ < 200) TD.update(0.05);   // Rakete fliegt + boom
  const s = TD.effStats(ro);
  return { centerDmg: 100000 - center.hp, edgeDmg: 100000 - edge.hp, dmg: s.dmg,
    expectCenter: s.dmg * 6 };
});
check('Taktische Nuke: ~6x Schaden im Zentrum', r.centerDmg > r.expectCenter * 0.85 && r.centerDmg <= r.expectCenter * 1.01, JSON.stringify(r));
check('Nach außen stark abnehmend', r.edgeDmg > 0 && r.edgeDmg < r.centerDmg * 0.15, 'edge=' + r.edgeDmg);

// ---- 6n) Unwahrscheinlichkeitskanone ---------------------------------------
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.money = 10000;
  TD.place('improb', 5, 4);
  const e = window.mkEnemy(5, 5, 1000);
  e.maxHp = 1000; e.hp = 500;                    // 50%
  const origRandom = Math.random;
  Math.random = () => 0;                          // blob -> options[0] = 'runner'
  for (let i = 0; i < 10; i++) TD.update(0.05);
  Math.random = origRandom;
  const afterType = e.type, afterMax = e.maxHp, afterHp = e.hp, spd = e.speed, morphed = e.morphed;
  for (let i = 0; i < 30; i++) TD.update(0.05);   // darf NICHT nochmal verwandeln
  return { afterType, afterMax, afterHp, spd, morphed, still: e.type };
});
check('Verwandlung: Blob -> Renner mit 50% HP-Anteil', r.afterType === 'runner' && r.afterMax === 600 && r.afterHp === 300 && r.spd === 2.6, JSON.stringify(r));
check('Nur einmal pro Monster', r.morphed && r.still === 'runner');

r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.money = 10000;
  TD.place('improb', 5, 4);
  const tank = window.mkEnemy(5, 5, 1000, 500);   // Panzer mit Rüstung
  tank.type = 'tank'; tank.maxHp = 1000; tank.hp = 1000;
  const boss = window.mkEnemy(4, 5, 90000);
  boss.boss = true; boss.type = 'boss';
  const origRandom = Math.random;
  Math.random = () => 0;                          // tank -> options[0] = 'blob'
  for (let i = 0; i < 10; i++) TD.update(0.05);
  Math.random = origRandom;
  return { tankType: tank.type, tankArmor: tank.armorHp, bossMorphed: !!boss.morphed, bossType: boss.type };
});
check('Panzer -> Blob verliert die Rüstung, Boss bleibt Boss', r.tankType === 'blob' && r.tankArmor === 0 && !r.bossMorphed && r.bossType === 'boss', JSON.stringify(r));

// ---- 6o) Auto-Lader beschleunigt auch die Railgun ---------------------------
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.money = 10000;
  const rg = TD.place('railgun', 4, 3);
  const base = TD.effStats(rg).rate;
  TD.place('loader', 4, 4);
  return { base, boosted: TD.effStats(rg).rate, flag: TD.effStats(rg).boosted };
});
check('Auto-Lader beschleunigt die Railgun x1.5', Math.abs(r.boosted - r.base * 1.5) < 0.011 && r.flag === 1.5, JSON.stringify(r));

// ---- 6p) Neues Hilfe-Menü: Dropdowns je Turm- und Gegnerart ----------------
r = await page.evaluate(() => {
  const TD = window.__td;
  const tw = document.querySelectorAll('#help-towers details');
  const en = document.querySelectorAll('#help-enemies details');
  const mgBody = document.querySelector('#help-towers details .hd-body').innerHTML;
  const allTowers = Object.keys(TD.TOWERS).length;
  const enemyTexts = [...en].map((d) => d.querySelector('summary').textContent).join('|');
  return { nTowers: tw.length, allTowers, nEnemies: en.length,
    mgHasTip: mgBody.includes('💡'), mgHasStufen: mgBody.includes('Stufen'), mgHasSpec: mgBody.includes('Wolframkern'),
    hasGeerdeter: enemyTexts.includes('Geerdeter'), hasBoss: enemyTexts.includes('Boss'),
    hasWave: enemyTexts.includes('ab Welle 14') };
});
check('Hilfe: ein Dropdown pro Turmart', r.nTowers === r.allTowers && r.nTowers >= 17, JSON.stringify(r));
check('Turm-Dropdown hat Tipp, Stufen und Spezialisierungen', r.mgHasTip && r.mgHasStufen && r.mgHasSpec);
check('Hilfe: 8 Gegner-Dropdowns mit Wellen-Angabe', r.nEnemies === 8 && r.hasGeerdeter && r.hasBoss && r.hasWave, JSON.stringify(r));

// ---- 6q) Spiel-Historie -----------------------------------------------------
r = await page.evaluate(() => {
  const TD = window.__td;
  localStorage.removeItem('td_history');
  const base = TD.history.length;   // frühere Tests haben schon Quit-Einträge erzeugt
  TD.newGame();
  TD.game.money = 5000;
  TD.place('mg', 4, 3);
  const e = window.mkEnemy(4, 2, 10);
  let guard = 0;
  while (!e.dead && guard++ < 200) TD.update(0.05);
  TD.startWave();                 // Welle 1 läuft
  TD.newGame();                   // aufgeben -> 'quit'-Eintrag
  const afterQuit = TD.history.length - base;
  // zweiter Lauf: Game Over erzwingen
  TD.game.money = 5000;
  TD.place('cannon', 3, 3);
  const e2 = window.mkEnemy(4, 2, 10);
  guard = 0;
  while (!e2.dead && guard++ < 200) TD.update(0.05);
  TD.startWave();
  TD.game.lives = 1;
  const runner = window.mkEnemy(10, 14, 1e9);   // kurz vorm Ziel
  runner.speed = 3;
  guard = 0;
  while (TD.game.state !== 'over' && guard++ < 2000) TD.update(0.05);
  const h = TD.history;
  const raw = JSON.parse(localStorage.getItem('td_history'));
  return { afterQuit, n: h.length - base, first: h[0], second: h[1], stored: raw.length,
    total: h.length, state: TD.game.state };
});
check('Aufgeben erzeugt Historien-Eintrag (quit, Welle 1)',
  r.afterQuit === 1 && r.second && r.second.end === 'quit' && r.second.wave === 1 && r.second.kills === 1 && r.second.top === 'mg', JSON.stringify(r.second));
check('Game Over erzeugt Historien-Eintrag mit Statistik',
  r.state === 'over' && r.n === 2 && r.first.end === 'over' && r.first.wave === 0 && r.first.kills >= 1 && r.first.top === 'cannon' && r.first.diff === 'normal', JSON.stringify(r.first));
check('Historie liegt im localStorage', r.stored === r.total);

// Historie erscheint in der Statistik-Ansicht
r = await page.evaluate(() => {
  document.getElementById('btn-menu').click();
  document.getElementById('btn-stats').click();
  const html = document.getElementById('stats-body').innerHTML;
  document.getElementById('btn-stats-close').click();
  return { hasHist: html.includes('Spiel-Historie'), hasQuit: html.includes('🚪'), hasOver: html.includes('💀') };
});
check('Statistik-Ansicht zeigt die Spiel-Historie', r.hasHist && r.hasQuit && r.hasOver, JSON.stringify(r));

// Tap nach Game Over startet neu OHNE Doppel-Eintrag
r = await page.evaluate(() => {
  const TD = window.__td;
  const before = TD.history.length;
  window.tapTile(5, 5);   // Neustart-Tap
  return { same: TD.history.length === before, state: TD.game.state };
});
check('Neustart nach Game Over erzeugt keinen Doppel-Eintrag', r.same && r.state === 'build');

// ---- 6r) Manueller Speichern-Button ----------------------------------------
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.money = 800;
  TD.place('mg', 4, 3);
  TD.startWave();
  for (let i = 0; i < 10; i++) TD.update(0.05);
  localStorage.removeItem('td_save');   // sicherstellen, dass der Button es neu schreibt
  document.getElementById('btn-menu').click();
  document.getElementById('btn-save').click();
  const save = JSON.parse(localStorage.getItem('td_save') || 'null');
  const banner = TD.game.banner;
  const menuClosed = document.getElementById('menu').classList.contains('hidden');
  return { saved: !!save, wave: save && save.wave, towers: save && save.towers.length,
    banner, menuClosed };
});
check('💾-Button speichert sofort (mitten in Welle 1 -> ab Wellenstart)',
  r.saved && r.wave === 0 && r.towers === 1 && r.menuClosed, JSON.stringify(r));
check('Speichern-Banner wird angezeigt', r.banner.includes('💾') && r.banner.includes('Welle 1'), r.banner);

// Nach Game Over gibt es nichts zu speichern
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.game.lives = 1;
  const runner = window.mkEnemy(10, 14, 1e9);
  runner.speed = 3;
  let guard = 0;
  while (TD.game.state !== 'over' && guard++ < 2000) TD.update(0.05);
  document.getElementById('btn-save').click();
  return { state: TD.game.state, save: localStorage.getItem('td_save'), banner: TD.game.banner };
});
check('Nach Game Over: kein Speichern, freundlicher Hinweis',
  r.state === 'over' && r.save === null && r.banner.includes('Nichts zu speichern'), JSON.stringify(r));

// ---- 7) Kurzer Spiel-Sanity-Lauf (Normal, 10 Wellen) -----------------------
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.money = 800;
  TD.place('mg', 3, 3); TD.place('cannon', 3, 4); TD.place('grenade', 8, 6);
  TD.place('ice', 8, 7); TD.place('tesla', 3, 9);
  const t0 = Date.now();
  TD.startWave();
  let guard = 0;
  while (TD.game.wave <= 10 && TD.game.state !== 'over' && guard++ < 120000) {
    TD.update(0.05);
    if (TD.game.state === 'build' && TD.game.money > 150) {
      for (const t of TD.towers) TD.upgrade(t);
    }
  }
  return { wave: TD.game.wave, state: TD.game.state, lives: TD.game.lives, ms: Date.now() - t0, guard };
});
check('10 Wellen laufen ohne Crash durch', r.wave >= 10, JSON.stringify(r));
console.log('  Sanity:', JSON.stringify(r));

// ---- 8) Spielstand: sichern, Seite neu laden, weiterspielen ----------------
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.money = 600;
  const m = TD.place('mg', 3, 3);
  m.spec = 'tungsten';
  TD.place('cannon', 3, 4);
  TD.startWave();
  let guard = 0;
  while (TD.game.state === 'wave' && guard++ < 20000) TD.update(0.05);
  const raw = localStorage.getItem('td_save');
  return { state: TD.game.state, wave: TD.game.wave, money: TD.game.money,
    lives: TD.game.lives, saved: !!raw, save: JSON.parse(raw || 'null') };
});
check('Nach Welle 1 liegt ein Spielstand im localStorage', r.saved && r.save.wave === 1 && r.save.towers.length === 2, JSON.stringify(r.save));
const beforeReload = r;

await page.reload();
await page.waitForFunction(() => window.__td && window.__td.towers.length === 2, null, { timeout: 5000 });
r = await page.evaluate(() => {
  const TD = window.__td;
  const mg = TD.towers.find((t) => t.type === 'mg');
  return { wave: TD.game.wave, money: TD.game.money, lives: TD.game.lives,
    types: TD.towers.map((t) => t.type).sort(), spec: mg && mg.spec, state: TD.game.state };
});
check('Reload stellt Türme + Spezialisierung wieder her', r.types.join() === 'cannon,mg' && r.spec === 'tungsten', JSON.stringify(r));
check('Reload stellt Welle/Geld/Leben wieder her',
  r.wave === beforeReload.wave && r.money === Math.round(beforeReload.money) && r.lives === beforeReload.lives, JSON.stringify(r));

// Neues Spiel löscht den Spielstand
r = await page.evaluate(() => {
  window.__td.newGame();
  return { raw: localStorage.getItem('td_save') };
});
check('Neues Spiel löscht den Spielstand', r.raw === null);

// ---- 9) Fernsehturm: fesselt Zuschauer, danach kurz immun ------------------
// (der Reload in Abschnitt 8 hat die Seiten-Helfer verworfen -> neu anlegen)
await page.evaluate(() => {
  window.mkEnemy = (tx, ty, hp, armor = 0) => {
    const pathI = window.__td.PATH.findIndex((p) => p[0] === tx && p[1] === ty);
    if (pathI < 0) throw new Error('kein Pfadfeld: ' + tx + ',' + ty);
    const e = { type: 'blob', hp, maxHp: hp, speed: 0, pathI, frac: 0, x: tx + 0.5, y: ty + 0.5,
      slowT: 0, slowF: 0, burnT: 0, burnDps: 0, bounty: 0, boss: false, regen: 0,
      armorHp: armor, maxArmor: armor, vulnFire: 0, vulnShock: 0, windCd: 0,
      r: 0.28, color: '#fff', wob: 0 };
    window.__td.enemies.push(e);
    return e;
  };
  window.tapTile = (x, y) => {
    const T = Math.min(innerWidth / 12, (innerHeight - 210) / 17);
    const OX = (innerWidth - 12 * T) / 2, OY = 92;
    document.getElementById('game').dispatchEvent(new PointerEvent('pointerdown', {
      clientX: OX + (x + 0.5) * T, clientY: OY + (y + 0.5) * T, bubbles: true }));
  };
});
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.money = 5000;
  const tv = TD.place('tv', 4, 3);
  const s = TD.effStats(tv);
  // drei Gegner auf der oberen Pfadreihe, alle in Reichweite – Stufe 1 hat
  // aber nur 2 Zuschauerplätze
  const a = window.mkEnemy(5, 2, 1e6);
  const b = window.mkEnemy(4, 2, 1e6);
  const c = window.mkEnemy(3, 2, 1e6);
  TD.update(0.05);
  const dazed = [a.dazeT > 0, b.dazeT > 0, c.dazeT > 0];
  // Festgehalten: trotz Tempo keine Bewegung
  a.speed = 1.5;
  const p0 = a.pathI + a.frac;
  for (let i = 0; i < 10; i++) TD.update(0.05);
  const pFrozen = a.pathI + a.frac;
  // Programm zu Ende schauen -> kurz immun, läuft weiter
  let guard = 0;
  while (a.dazeT > 0 && guard++ < 400) TD.update(0.05);
  const cdAfter = a.dazeCd;
  const p1 = a.pathI + a.frac;
  for (let i = 0; i < 10; i++) TD.update(0.05);
  const moved = a.pathI + a.frac - p1;
  return { dur: s.dur, aud: s.aud, dazed, p0, pFrozen, cdAfter, moved };
});
check('Fernsehturm fesselt die vordersten 2 Zuschauer (Stufe 1: aud=2)',
  r.aud === 2 && r.dazed[0] && r.dazed[1] && !r.dazed[2], JSON.stringify(r.dazed));
check('Zuschauer bleibt trotz Tempo stehen', r.pFrozen === r.p0, 'p0=' + r.p0 + ' p=' + r.pFrozen);
check('Nach dem Programm: kurz immun und läuft weiter', r.cdAfter > 0 && r.moved > 0.5, JSON.stringify(r));

// Boss schaut nur kurz hin, Spezialisierungen wirken
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.money = 5000;
  const tv = TD.place('tv', 4, 3);
  const s = TD.effStats(tv);
  const boss = window.mkEnemy(4, 2, 1e6);
  boss.boss = true;
  TD.update(0.05);   // Gegner tickt vor dem Turm, daher noch unverbraucht
  const bossDaze = boss.dazeT;
  tv.spec = 'binge';
  const dBinge = TD.effStats(tv).dur - s.dur;
  tv.spec = 'big';
  const sBig = TD.effStats(tv);
  window.tapTile(4, 3);
  const info = document.getElementById('upg-info').textContent;
  return { dur: s.dur, bossDaze, dBinge, dAud: sBig.aud - s.aud, dRange: sBig.range - s.range, info };
});
check('Boss schaut nur 30% der Zeit zu', Math.abs(r.bossDaze - r.dur * 0.3) < 1e-9, JSON.stringify(r));
check('TV-Spezialisierungen: 🍿 +1,2s Programm, 🖥️ +2 Plätze +0,5 Reichweite',
  Math.abs(r.dBinge - 1.2) < 1e-9 && r.dAud === 2 && Math.abs(r.dRange - 0.5) < 1e-9, JSON.stringify(r));
check('Upgrade-Panel nennt Zuschauer und Programmdauer', r.info.includes('Zuschauer') && r.info.includes('Programm'), r.info);

// ---- 10) Kids-Modus: reine Anzeige-Ebene per Toggle ------------------------
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.money = 500;
  const cannon = TD.place('cannon', 7, 6);
  const dmgNormal = TD.effStats(cannon).dmg;
  window.tapTile(5, 3);   // freies Feld -> Bau-Leiste
  const names = () => [...document.querySelectorAll('#buildbar .tn')].map((el) => el.textContent);
  const normal = names();
  TD.setKidsMode(true);
  const kids = names();
  const stored = localStorage.getItem('td_kids');
  const helpHtml = document.getElementById('help-towers').innerHTML;
  const menuTxt = document.getElementById('btn-kids').textContent;
  const nukeIcon = document.getElementById('btn-nuke').textContent;
  const dmgKids = TD.effStats(cannon).dmg;
  TD.setKidsMode(false);
  const back = names();
  return { normal, kids, back, stored, menuTxt, nukeIcon, dmgSame: dmgKids === dmgNormal,
    helpKids: helpHtml.includes('Pupsmaschine') && helpHtml.includes('Kartoffelkanone'),
    backStored: localStorage.getItem('td_kids') };
});
check('Normalmodus zeigt Kanone, Flammenwerfer und Fernsehturm',
  r.normal.includes('Kanone') && r.normal.includes('Flammenwerfer') && r.normal.includes('Fernsehturm'), JSON.stringify(r.normal));
check('Kids-Modus: Kartoffelkanone, Pupsmaschine, Riesenflitsche, Kasperletheater',
  r.kids.includes('Kartoffelkanone') && r.kids.includes('Pupsmaschine')
  && r.kids.includes('Riesenflitsche') && r.kids.includes('Kasperletheater'), JSON.stringify(r.kids));
check('Toggle bleibt gespeichert, Hilfe + Superwaffen wechseln mit',
  r.stored === '1' && r.helpKids && r.nukeIcon === '🪅' && r.menuTxt.includes('an'), JSON.stringify(r));
check('Spielwerte bleiben im Kids-Modus identisch', r.dmgSame);
check('Zurückschalten stellt Originalnamen wieder her',
  r.back.includes('Kanone') && r.back.includes('Flammenwerfer') && r.backStored === '0', JSON.stringify(r.back));

// Spezialisierungen werden mit-übersetzt: aus der Taktischen Nuke wird die
// Mega-Konfettibombe, und die Kids-Hilfe ist frei von Militär-Vokabular
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.game.money = 5000;
  TD.place('rocket', 6, 3);
  window.tapTile(6, 3);
  const specTexts = () => [...document.querySelectorAll('#upg-ammo .ammo-btn')].map((b) => b.textContent);
  const normal = specTexts();
  TD.setKidsMode(true);
  const kids = specTexts();
  const helpKids = document.getElementById('help-towers').innerHTML;
  TD.setKidsMode(false);
  return { normal, kids,
    kidsWords: helpKids.includes('Mega-Konfettibombe') && helpKids.includes('Bohnen-Diät') && helpKids.includes('Murmelkern'),
    leaks: ['Nuke', 'Wolframkern', 'Hypercharge', 'Gefechtskopf'].filter((w) => helpKids.includes(w)) };
});
check('Raketen-Specs normal mit Taktischer Nuke', r.normal.some((s) => s.includes('Taktische Nuke')), JSON.stringify(r.normal));
check('Kids-Modus: aus der Nuke wird die Mega-Konfettibombe',
  r.kids.some((s) => s.includes('Mega-Konfettibombe')) && !r.kids.some((s) => s.includes('Nuke')), JSON.stringify(r.kids));
check('Kids-Hilfe komplett übersetzt (kein Nuke/Wolframkern/Hypercharge)',
  r.kidsWords && r.leaks.length === 0, JSON.stringify(r.leaks));

// ---- 11) Kommandozentrale: Ende offen, Superwaffen boss-stark --------------
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.money = 1e6;
  const c = TD.place('command', 4, 6);
  for (let i = 0; i < 5; i++) TD.upgrade(c);   // 2 Stufen über das alte Maximum hinaus
  const s = TD.effStats(c);
  window.tapTile(4, 6);
  const info = document.getElementById('upg-info').textContent;
  const upTxt = document.getElementById('upg-up').textContent;
  const spent = 1e6 - TD.game.money;
  // Boss: Nuke trifft 3-fach direkt auf die HP, Panzerung bleibt unberührt
  const boss = window.mkEnemy(5, 8, 1e6, 500);
  boss.boss = true;
  TD.fireNuke();
  const nukeDelta = 1e6 - boss.hp, bossArmor = boss.armorHp;
  TD.startWave();   // Superwaffen zurücksetzen
  const boss2 = window.mkEnemy(6, 8, 1e6, 500);
  boss2.boss = true;
  TD.fireSlaser(6.5, 8.5);
  let guard = 0;
  while (TD.shots.some((sh) => sh.kind === 'sbeam') && guard++ < 100) TD.update(0.05);
  return { lvl: c.lvl, nuke: s.nuke, beam: s.beam, spent, upTxt, info,
    nukeDelta, bossArmor, beamDelta: 1e6 - boss2.hp, b2Armor: boss2.armorHp };
});
check('Kommandozentrale über Stufe 4 hinaus: Werte wachsen ×1,7 je Stufe',
  r.lvl === 5 && r.nuke === Math.round(1400 * 1.7 * 1.7) && r.beam === Math.round(2600 * 1.7 * 1.7), JSON.stringify(r));
check('Endlos-Stufen extrem teuer (6250 → 15625 → …)', r.spent === 25625 && r.upTxt.includes('39063'),
  'spent=' + r.spent + ' up=' + r.upTxt);
check('Panel nennt die Boss-Stärke der Superwaffen', r.info.includes('gegen Bosse 3×'), r.info);
check('Nuke trifft Boss 3-fach direkt (Panzerung bleibt)', r.nukeDelta === r.nuke * 3 && r.bossArmor === 500, JSON.stringify(r));
check('Orbital-Laser trifft Boss 3-fach direkt', r.beamDelta === r.beam * 3 && r.b2Armor === 500, JSON.stringify(r));

// ---- 12) Historie: Voll-Statistik je Partie, aufklappbar -------------------
r = await page.evaluate(() => {
  const TD = window.__td;
  // schnelle Partie mit einem MG-Abschuss, dann aufgeben -> Historien-Eintrag
  TD.newGame();
  TD.game.money = 2000;
  TD.place('mg', 4, 3);
  TD.game.wave = 3;
  TD.game.nextT = 999;   // Auto-Start der nächsten Welle unterbinden
  window.mkEnemy(5, 2, 10);
  let guard = 0;
  while (TD.enemies.length && guard++ < 200) TD.update(0.05);
  TD.newGame();
  const run = TD.history[0];
  return { hasSt: !!(run && run.st), mgKills: run && run.st && run.st.types.mg && run.st.types.mg.kills,
    vsBlob: run && run.st && run.st.vs.mg && run.st.vs.mg.blob, wave: run && run.wave };
});
check('Historien-Eintrag trägt die volle Partie-Statistik (Kills + Matrix)',
  r.hasSt && r.mgKills === 1 && r.vsBlob === 1 && r.wave === 3, JSON.stringify(r));

r = await page.evaluate(() => {
  document.getElementById('btn-stats').click();
  const body = document.getElementById('stats-body');
  const row = body.querySelector('.hist-row');
  const detail = row && body.querySelector(`.hist-detail[data-d="${row.dataset.i}"]`);
  const hiddenBefore = !!detail && detail.classList.contains('hidden');
  if (row) row.click();
  const visible = !!detail && !detail.classList.contains('hidden');
  const hasMg = !!detail && detail.innerHTML.includes('MG') && detail.innerHTML.includes('Gesamt');
  if (row) row.click();
  const closedAgain = !!detail && detail.classList.contains('hidden');
  document.getElementById('btn-stats-close').click();
  return { hasRow: !!row, hiddenBefore, visible, hasMg, closedAgain };
});
check('Historien-Zeile klappt die Partie-Statistik auf und wieder zu',
  r.hasRow && r.hiddenBefore && r.visible && r.hasMg && r.closedAgain, JSON.stringify(r));

// Nur die jüngsten 12 Partien behalten die Voll-Statistik (32-KB-Slot!)
r = await page.evaluate(() => {
  const TD = window.__td;
  for (let i = 0; i < 14; i++) {
    TD.newGame();
    TD.game.money = 2000;
    TD.place('mg', 4, 3);
    window.mkEnemy(5, 2, 5);
    let guard = 0;
    while (TD.enemies.length && guard++ < 100) TD.update(0.05);
    TD.game.wave = 1;
  }
  TD.newGame();
  const h = TD.history;
  const size = JSON.stringify({ v: 1, runs: h }).length;
  return { n: h.length, newest: !!h[0].st, at11: !!h[11].st, at12: !!(h[12] && h[12].st),
    at13: !!(h[13] && h[13].st), size };
});
check('Voll-Statistik nur für die letzten 12 Partien, Slot bleibt klein',
  r.newest && r.at11 && !r.at12 && !r.at13 && r.size < 32000, JSON.stringify(r));

// ---- 13) Regenerierer: Heilung gedeckelt, Brand stoppt sie -----------------
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.wave = 67;
  TD.game.nextT = 999;
  const e = window.mkEnemy(5, 2, 500000);
  e.maxHp = 1e6; e.regen = 0.02;   // ungedeckelt wären das 20.000 HP/s
  for (let i = 0; i < 20; i++) TD.update(0.05);   // 1 Sekunde
  const healed = e.hp - 500000;
  e.hp = 500000; e.burnT = 5; e.burnDps = 0;      // brennt (ohne Brandschaden)
  for (let i = 0; i < 20; i++) TD.update(0.05);
  const healedBurning = e.hp - 500000;
  TD.newGame();
  return { healed, healedBurning };
});
check('Regenerierer-Heilung hart gedeckelt (~700/s statt 20.000/s bei Welle 67)',
  r.healed > 600 && r.healed < 800, JSON.stringify(r));
check('Brand stoppt die Selbstheilung komplett', r.healedBurning <= 0, JSON.stringify(r));

// ---- 14) Anti-Panzer: Hohlladung (Kanone) + Säure (Giftschleuder) ----------
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.money = 2000;
  const c = TD.place('cannon', 7, 6);
  c.spec = 'heat';
  const s = TD.effStats(c);
  const tank = window.mkEnemy(8, 5, 1000, 100000);
  TD.update(0.05); TD.update(0.05);   // genau ein Schuss (danach 2 s Ladezeit)
  const heatDmg = 100000 - tank.armorHp;
  // Säurepfützen direkt: normal ätzt ×1,3, Königswasser ×2,5
  const tank2 = window.mkEnemy(5, 2, 1000, 10000);
  TD.shots.push({ kind: 'pool', x: 5.5, y: 2.5, r: 1, dps: 100, t: 0, ttl: 5, src: null });
  TD.update(0.05);
  const acidBase = 10000 - tank2.armorHp;
  const tank3 = window.mkEnemy(3, 2, 1000, 10000);
  TD.shots.push({ kind: 'pool', x: 3.5, y: 2.5, r: 1, dps: 100, t: 0, ttl: 5, src: null, acid: true });
  TD.update(0.05);
  const acidRoyal = 10000 - tank3.armorHp;
  TD.newGame();
  return { dmg: s.dmg, heatDmg, acidBase, acidRoyal,
    cannonSpecs: (TD.SPECS.cannon || []).map((o) => o.key).join() };
});
check('Kanone: Hohlladung statt Wolframkern (fire/shock/heat)', r.cannonSpecs === 'fire,shock,heat', r.cannonSpecs);
check('Hohlladung trifft Panzerung ×4', r.heatDmg === r.dmg * 4, JSON.stringify(r));
check('Säure ätzt Panzerung ×1,3 · Königswasser ×2,5',
  Math.abs(r.acidBase - 100 * 0.05 * 1.3) < 1e-6 && Math.abs(r.acidRoyal - 100 * 0.05 * 2.5) < 1e-6, JSON.stringify(r));

// ---- 15) Buff-Türme: Starkstromaggregat, Chemiefabrik, Sprengstofffabrik ---
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.money = 100000;
  const te = TD.place('tesla', 4, 3);
  const la = TD.place('laser', 4, 4);
  const rg = TD.place('railgun', 5, 4);
  const base = { te: TD.effStats(te).dmg, la: TD.effStats(la).dps, rg: TD.effStats(rg).dmg,
    chain: TD.effStats(te).chain, acc: TD.effStats(rg).acc, rate: TD.effStats(te).rate };
  const v = TD.place('volt', 5, 3);
  const amp = { te: TD.effStats(te).dmg, la: TD.effStats(la).dps, rg: TD.effStats(rg).dmg };
  v.spec = 'surge';
  const surge = { chain: TD.effStats(te).chain, acc: TD.effStats(rg).acc };
  v.spec = 'turbo';
  const rateTurbo = TD.effStats(te).rate;
  return { base, amp, surge, rateTurbo };
});
check('Starkstromaggregat: ×1,3 Schaden für Blitzturm, Laser & Railgun',
  r.amp.te === Math.round(r.base.te * 1.3) && r.amp.la === Math.round(r.base.la * 1.3) && r.amp.rg === Math.round(r.base.rg * 1.3), JSON.stringify(r));
check('⚡ Überspannung: +2 Kettenziele, +15% Railgun-Trefferchance',
  r.surge.chain === r.base.chain + 2 && Math.abs(r.surge.acc - (r.base.acc + 0.15)) < 1e-9, JSON.stringify(r.surge));
check('🔌 Turbolader: Feuerrate ×1,2', Math.abs(r.rateTurbo - Math.round(r.base.rate * 1.2 * 100) / 100) < 1e-9, 'rate=' + r.rateTurbo);

r = await page.evaluate(() => {
  const TD = window.__td;
  const fl = TD.place('flame', 7, 6);
  const gi = TD.place('gift', 7, 7);
  const base = { fl: TD.effStats(fl).dps, burn: TD.effStats(fl).burn, gi: TD.effStats(gi).dps, dur: TD.effStats(gi).dur };
  const ch = TD.place('chem', 8, 6);
  const amp = { fl: TD.effStats(fl).dps, gi: TD.effStats(gi).dps };
  ch.spec = 'napalm';
  const burnN = TD.effStats(fl).burn;
  ch.spec = 'toxin';
  const durT = TD.effStats(gi).dur;
  const gr = TD.place('grenade', 3, 6);
  const gBase = { dmg: TD.effStats(gr).dmg, splash: TD.effStats(gr).splash };
  const ex = TD.place('explo', 3, 7);
  const gAmp = TD.effStats(gr).dmg;
  ex.spec = 'splitter';
  const splS = TD.effStats(gr).splash;
  return { base, amp, burnN, durT, gBase, gAmp, splS };
});
check('Chemiefabrik: ×1,3 Schaden/s für Flammenwerfer & Giftschleuder',
  r.amp.fl === Math.round(r.base.fl * 1.3) && r.amp.gi === Math.round(r.base.gi * 1.3), JSON.stringify(r));
check('☠️ Nervengift +2,5 s Pfützen · 🔥 Napalm Brand ×1,6',
  Math.abs(r.durT - (r.base.dur + 2.5)) < 1e-9 && r.burnN === Math.round(r.base.burn * 1.6), JSON.stringify(r));
check('Sprengstofffabrik: ×1,3 Granaten-Schaden, 💥 Splitterladung +0,35 Fläche',
  r.gAmp === Math.round(r.gBase.dmg * 1.3) && Math.abs(r.splS - (r.gBase.splash + 0.35)) < 1e-9, JSON.stringify(r));

// Auto-Lader-Ausprägungen: Experimentelle Treibladung + Uranmunition
r = await page.evaluate(() => {
  const TD = window.__td;
  const m = TD.place('mg', 6, 3);
  const baseR = TD.effStats(m).range;
  const lo = TD.place('loader', 7, 3);
  lo.spec = 'exp';
  const expR = TD.effStats(m).range - baseR;
  lo.spec = 'uran';
  const uranFlag = TD.effStats(m).uran === true;
  const e = window.mkEnemy(6, 2, 1e6);
  for (let i = 0; i < 30; i++) TD.update(0.05);   // 1,5 s Dauerfeuer
  const rad = e.radDps;
  TD.newGame();
  return { expR, uranFlag, rad };
});
check('🧪 Treibladung: +0,8 Reichweite für geboostete Türme', Math.abs(r.expR - 0.8) < 1e-9, 'dR=' + r.expR);
check('☢️ Uranmunition: Treffer verstrahlen bis zum 30/s-Deckel', r.uranFlag && r.rad === 30, JSON.stringify(r));

// ---- 16) Blitzturm-Relevanz: Geblitzte sind statisch aufgeladen ------------
r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.money = 5000;
  TD.place('tesla', 4, 3);
  const e = window.mkEnemy(4, 2, 1e6);
  const grounded = window.mkEnemy(6, 2, 1e6);   // außer Reichweite (2.7): Abstand 2.06? nein – resist prüfen
  grounded.resist = 'shock';
  TD.update(0.05); TD.update(0.05);
  return { zap: e.zapT, groundedZap: grounded.zapT || 0 };
});
check('Blitztreffer lädt statisch auf (3 s), Geerdete nicht',
  r.zap > 2.8 && r.groundedZap === 0, JSON.stringify(r));

r = await page.evaluate(() => {
  const TD = window.__td;
  TD.newGame();
  TD.game.money = 5000;
  // Tempo: aufgeladen läuft nur 75%
  const e = window.mkEnemy(5, 2, 1e6);
  e.speed = 1.5; e.zapT = 60;
  const p0 = e.pathI + e.frac;
  for (let i = 0; i < 20; i++) TD.update(0.05);   // 1 s
  const slowDist = e.pathI + e.frac - p0;
  e.dead = true;   // aus dem Weg, sonst zielt das MG gleich auf ihn
  // Kinetik: MG-Schuss trifft Aufgeladene x1,3
  const m = TD.place('mg', 4, 3);
  const dmg = TD.effStats(m).dmg;
  const v = window.mkEnemy(4, 2, 1000);
  v.zapT = 60;
  TD.update(0.05); TD.update(0.05);   // genau ein Schuss
  const kinDelta = 1000 - v.hp;
  TD.newGame();
  return { slowDist, dmg, kinDelta };
});
check('Aufgeladene laufen 25% langsamer', Math.abs(r.slowDist - 1.5 * 0.75) < 0.08, 'dist=' + r.slowDist);
check('Aufgeladene nehmen +30% Kinetik-Schaden', Math.abs(r.kinDelta - r.dmg * 1.3) < 1e-9, JSON.stringify(r));

// Kids-Modus übersteht einen Reload (localStorage)
await page.evaluate(() => window.__td.setKidsMode(true));
await page.reload();
await page.waitForFunction(() => window.__td, null, { timeout: 5000 });
r = await page.evaluate(() => {
  const on = window.__td.kidsMode;
  const helpKids = document.getElementById('help-towers').innerHTML.includes('Kasperletheater');
  window.__td.setKidsMode(false);   // aufräumen für spätere Läufe
  return { on, helpKids };
});
check('Kids-Modus bleibt nach Reload aktiv', r.on && r.helpKids, JSON.stringify(r));

await browser.close();
srv.stop();
process.exit(summary() ? 1 : 0);
