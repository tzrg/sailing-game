// Raupen (Caterpillars): Dynamit-Lunte + Rückzug, Scharfschütze,
// Kaugummikanone (Kleber-Phasen), 6 Teams, Abschluss-Hüpfer.
// Läuft über den Test-Hook window.__wurm; die Simulation tickt live per
// requestAnimationFrame, daher arbeiten die Checks mit echten Wartezeiten.

import { startServer, launchBrowser, checker } from './helpers.mjs';

const srv = startServer();
await srv.ready;
const { check, summary } = checker();

const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 480, height: 860 } });
  page.on('pageerror', (e) => check('Seite ohne JS-Fehler', false, e.message));
  await page.goto(srv.url + '/wurm.html');
  await page.waitForFunction(() => window.__wurm);
  await page.click('#btn-start');   // Hilfe schließen, startet neues Spiel

  // ---- Waffenliste: Neuzugänge vorhanden
  let r = await page.evaluate(() => {
    const W = window.__wurm.WEAPONS;
    const by = (k) => W.find((w) => w.key === k);
    return { sniper: by('sniper'), gum: by('gum'), dyn: by('dynamit'),
      keys: W.map((w) => w.key) };
  });
  check('Scharfschütze & Kaugummikanone im Arsenal', !!r.sniper && !!r.gum, r.keys.join(','));
  check('Scharfschütze: 2 Schuss, Hitscan', r.sniper.ammo === 2 && r.sniper.hitscan === true);
  check('Dynamit: 4 s Rückzug, Tipp reicht', r.dyn.retreat === 4 && r.dyn.tap === true);

  // ---- Scharfschützen-Reichweite: Strahl fliegt durch den freien Himmel
  r = await page.evaluate(() => {
    const res = window.__wurm.hitscanRay(50, 60, 1, 0, 4000);   // hoch oben, klare Bahn
    return { d: res.d, hit: res.hit === null || res.hit === 'edge' };
  });
  check('Hitscan trägt über die ganze Karte (>1500 px)', r.d > 1500 && r.hit, 'd=' + r.d);

  // ---- Dynamit: liegt still, 10-s-Lunte, 8 s Rückzug, KEIN Sofort-Knall
  r = await page.evaluate(() => {
    const WU = window.__wurm;
    const idx = WU.WEAPONS.findIndex((w) => w.key === 'dynamit');
    WU.weapon = idx;
    WU.game.power = 0.5;
    WU.fireWeapon();
    const pr = WU.projectiles.find((p) => p.type === 'dynamite');
    return { placed: !!pr, fuse: pr && pr.fuse, retreatT: WU.game.retreatT, state: WU.game.state };
  });
  check('Dynamit gelegt: Lunte 5 s, Rückzug ~4 s, Zug läuft weiter',
    r.placed && r.fuse === 5 && r.retreatT > 3.5 && r.state === 'aim', JSON.stringify(r));

  await page.waitForTimeout(900);   // fällt zu Boden und bleibt liegen
  r = await page.evaluate(() => {
    const WU = window.__wurm;
    const pr = WU.projectiles.find((p) => p.type === 'dynamite');
    return { still: !!pr, rest: pr && !!pr.rest, alive: WU.focus().alive, hp: WU.focus().hp };
  });
  check('Dynamit explodiert NICHT beim Aufsetzen (der alte Bug)', r.still && r.rest, JSON.stringify(r));
  check('Die Raupe daneben lebt noch unversehrt', r.alive && r.hp === 100);

  // Manueller Zünder: FEUER im Rückzug drücken -> sofortiger Knall
  r = await page.evaluate(() => new Promise((res) => {
    const WU = window.__wurm;
    document.getElementById('b-fire').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    setTimeout(() => res({ gone: !WU.projectiles.some((p) => p.type === 'dynamite') }), 400);
  }));
  check('FEUER im Rückzug zündet das Dynamit sofort', r.gone);

  // ---- Kaugummi: Kleber-Phasen über die Züge
  r = await page.evaluate(() => {
    const WU = window.__wurm;
    WU.newGame();
    const victim = WU.teams()[1].worms[0];
    WU.gumPop(victim.x, victim.y - 6);
    const afterPop = { hp: victim.hp, phase: victim.gluePhase };
    // Züge durchschalten, bis das Opfer dran ist
    let guard = 0;
    while (WU.game.active !== victim && guard++ < 12) WU.startTurn();
    const duringTurn = victim.gluePhase;
    WU.startTurn();   // Zug des Opfers endet
    return { afterPop, duringTurn, afterTurn: victim.gluePhase, found: guard < 12 };
  });
  check('Kaugummi klebt: wenig Schaden, Phase 1 markiert',
    r.afterPop.hp < 100 && r.afterPop.hp >= 85 && r.afterPop.phase === 1, JSON.stringify(r.afterPop));
  check('Im eigenen Zug festgeklebt (Phase 2), danach wieder frei',
    r.found && r.duringTurn === 2 && r.afterTurn === 0, JSON.stringify(r));

  // ---- Schweißbrenner: unendlich + bohrt in Zielrichtung
  r = await page.evaluate(() => {
    const WU = window.__wurm;
    WU.newGame();
    const idx = WU.WEAPONS.findIndex((w) => w.key === 'brenner');
    const def = WU.WEAPONS[idx];
    const w = WU.focus();
    const y0 = w.y, x0 = w.x;
    WU.weapon = idx;
    WU.game.aim = -0.8;        // steil nach unten bohren
    WU.game.power = 0.5;
    WU.fireWeapon();
    return { infinite: def.ammo === Infinity, aimed: def.aimed === true,
      ammoShown: WU.weaponAmmo(idx) === Infinity, y0, x0, busy: WU.game.actionBusy };
  });
  check('Schweißbrenner: unendlich Munition, zielbar', r.infinite && r.aimed && r.ammoShown && r.busy, JSON.stringify(r));

  const before = r;
  await page.waitForTimeout(1500);   // 22 Bohrschritte à 45 ms + Puffer
  r = await page.evaluate(() => {
    const WU = window.__wurm;
    const w = WU.focus();
    return { y: w.y, x: w.x, busy: WU.game.actionBusy, alive: w.alive };
  });
  check('Bohrt schräg nach unten: Raupe folgt dem Tunnel', r.alive && !r.busy && r.y > before.y0 + 30 && Math.abs(r.x - before.x0) > 20,
    `dy=${Math.round(r.y - before.y0)} dx=${Math.round(r.x - before.x0)}`);

  // ---- Schaf gleitet nie durch die Welt (Anti-Tunneling)
  r = await page.evaluate(() => {
    const WU = window.__wurm;
    WU.newGame();
    const w = WU.focus();
    // Schaf mit ordentlich Tempo Richtung Gelände loslassen
    WU.projectiles.push({ type: 'sheep', x: w.x + 14, y: w.y - 10, vx: 350, vy: -60, t: 0,
      dir: 1, r: 46, dmg: 62, hopCd: 0.2, fuse: 7 });
    return true;
  });
  {
    let embedded = 0, samples = 0;
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(150);
      const st = await page.evaluate(() => {
        const WU = window.__wurm;
        const pr = WU.projectiles.find((p) => p.type === 'sheep');
        if (!pr) return null;
        return { inGround: WU.solidAt(pr.x, pr.y - 1) && WU.solidAt(pr.x, pr.y - 5) };
      });
      if (st === null) break;
      samples++;
      if (st.inGround) embedded++;
    }
    check('Schaf steckt nie im Gelände (kein Durchgleiten)', samples > 0 && embedded === 0,
      `${embedded}/${samples} Proben im Boden`);
  }

  // ---- Schweißbrenner-Tunnel beginnt an der Raupe
  r = await page.evaluate(() => {
    const WU = window.__wurm;
    WU.newGame();
    const idx = WU.WEAPONS.findIndex((w) => w.key === 'brenner');
    WU.weapon = idx;
    WU.game.aim = 0;
    WU.game.power = 0.5;
    WU.fireWeapon();
    return true;
  });
  await page.waitForTimeout(450);   // mitten im Bohren
  r = await page.evaluate(() => {
    const WU = window.__wurm;
    const w = WU.focus();
    // Der Bohrkopf sitzt direkt vor der aktuellen Position -> dort ist frisch gebohrt
    return { busy: WU.game.actionBusy,
      headClear: !WU.solidAt(w.x + w.facing * 12, w.y - 6),
      bodyClear: !WU.solidAt(w.x, w.y - 6) };
  });
  check('Brenner bohrt direkt vor der Raupe (Tunnel beginnt am Wurm)', r.busy && r.headClear && r.bodyClear, JSON.stringify(r));
  await page.waitForTimeout(800);   // Bohrvorgang fertig laufen lassen

  // ---- 6 Teams
  r = await page.evaluate(() => {
    const WU = window.__wurm;
    WU.cfg.teamCount = 6; WU.cfg.wormCount = 2;
    WU.newGame();
    const t = WU.teams();
    return { n: t.length, colors: new Set(t.map((x) => x.color)).size,
      names: t.map((x) => x.name).join(','), selMax: document.querySelector('#sel-teams option:last-child').textContent };
  });
  check('6 Teams mit eigenen Farben und Namen', r.n === 6 && r.colors === 6 && r.names.includes('Türkis'), r.names);
  check('Team-Auswahl im Menü geht bis 6', r.selMax === '6');

  // ---- Tap auf die Waffen-Anzeige öffnet das Waffenmenü
  r = await page.evaluate(() => {
    const WU = window.__wurm;
    WU.cfg.teamCount = 2; WU.cfg.wormCount = 2;
    WU.newGame();
    const canvas = document.getElementById('game');
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: window.innerWidth / 2, clientY: window.innerHeight - 105, bubbles: true }));
    const open = !document.getElementById('wmenu').classList.contains('hidden');
    document.getElementById('wmenu').classList.add('hidden');
    // Tap weit weg von der Anzeige darf NICHT öffnen
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: window.innerWidth / 2, clientY: 200, bubbles: true }));
    const stillClosed = document.getElementById('wmenu').classList.contains('hidden');
    return { open, stillClosed };
  });
  check('Tap auf die Waffen-Anzeige öffnet das Waffenmenü', r.open && r.stillClosed, JSON.stringify(r));

  // ---- Comic-Feedback: Schadenszahlen + Explosions-Effekte
  r = await page.evaluate(() => {
    const WU = window.__wurm;
    WU.newGame();
    const victim = WU.teams()[1].worms[0];
    const hp0 = victim.hp;
    WU.explode(victim.x, victim.y - 4, 24, 30, false);
    const kinds = new Set(WU.particles.map((p) => p.kind));
    const dmgP = WU.particles.find((p) => p.kind === 'dmg');
    return { hpDropped: victim.hp < hp0, hasDmg: kinds.has('dmg'), hasRing: kinds.has('ring'),
      hasSmoke: kinds.has('smoke'), shake: WU.cam.shakeT > 0, amt: dmgP && dmgP.amt };
  });
  check('Explosion: Schadenszahl, Druckwelle, Rauch, Screenshake',
    r.hpDropped && r.hasDmg && r.hasRing && r.hasSmoke && r.shake && r.amt > 0, JSON.stringify(r));

  // ---- Comic-Sterbeanimation: POW, Sternchen, Geist, Grabstein
  r = await page.evaluate(() => {
    const WU = window.__wurm;
    WU.newGame();
    const victim = WU.teams()[1].worms[0];
    const gx = victim.x;
    WU.explode(victim.x, victim.y - 4, 30, 300, false);   // sicher tödlich
    const kinds = new Set(WU.particles.map((p) => p.kind));
    const ghost = WU.particles.find((p) => p.kind === 'death');
    const grave = WU.graves[WU.graves.length - 1];
    return { dead: !victim.alive, hasBurst: kinds.has('burst'), hasStar: kinds.has('star'),
      ghostNamed: ghost && ghost.name === victim.name,
      graveCount: WU.graves.length, graveNearby: grave && Math.abs(grave.x - gx) < 30,
      graveCap: grave && grave.color === WU.teams()[1].color };
  });
  check('Tod: POW-Blitz + Sternchen + Geist mit Namen', r.dead && r.hasBurst && r.hasStar && r.ghostNamed, JSON.stringify(r));
  check('Grabstein plumpst an der Todesstelle hin und trägt die Team-Mütze',
    r.graveCount === 1 && r.graveNearby && r.graveCap, JSON.stringify(r));

  // Wasser-Tod: Geist ja, Grabstein nein; neues Spiel räumt die Gräber
  r = await page.evaluate(() => {
    const WU = window.__wurm;
    const gravesBefore = WU.graves.length;
    const w2 = WU.teams()[1].worms[1];
    w2.y = 10000;   // tief unter die Wasserlinie
    return new Promise((res) => setTimeout(() => {
      const drowned = !w2.alive;
      const gravesAfter = WU.graves.length;
      WU.newGame();
      res({ drowned, noNewGrave: gravesAfter === gravesBefore, cleared: WU.graves.length === 0 });
    }, 250));
  });
  check('Ertrinken: kein Grabstein, Neues Spiel räumt Gräber', r.drowned && r.noNewGrave && r.cleared, JSON.stringify(r));

  // ---- Allmachtsgranate: Sterne + heiliger Geist vor dem Knall
  r = await page.evaluate(() => {
    const WU = window.__wurm;
    WU.newGame();
    const w = WU.focus();
    WU.projectiles.push({ type: 'grenade', x: w.x + 40, y: w.y - 60, vx: 0, vy: -30, t: 0,
      r: 100, dmg: 115, fuse: 3, bounce: 0.45, wind: 0.5, holy: 1 });
    const windPanzer = WU.WEAPONS.find((x) => x.key === 'panzer');
    return { ok: true };
  });
  await page.waitForTimeout(700);
  r = await page.evaluate(() => {
    const WU = window.__wurm;
    const kinds = new Set(WU.particles.map((p) => p.kind));
    WU.projectiles.length = 0;   // Granate vor dem Knall aufräumen
    return { hasStar: kinds.has('star'), hasHoly: kinds.has('holy') };
  });
  check('Allmachtsgranate: Sternchen + heiliger Geist steigen auf', r.hasStar && r.hasHoly, JSON.stringify(r));

  // ---- Panzerfaust: kräftiger Windeinfluss für Trickshots
  r = await page.evaluate(() => {
    const WU = window.__wurm;
    const fireStr = String(WU.WEAPONS.find((x) => x.key === 'panzer').fire);
    return { windy: fireStr.includes('wind: 2.5') };
  });
  check('Panzerfaust segelt mit 2.5x Wind', r.windy, JSON.stringify(r));

  // ---- Absoluter Stillstand: keine Mikro-Bewegung im Stehen
  r = await page.evaluate(() => new Promise((res) => {
    const WU = window.__wurm;
    WU.newGame();
    setTimeout(() => {   // erst in Ruhe kommen lassen
      const w = WU.focus();
      const y0 = w.y, x0 = w.x;
      let maxDy = 0, maxDx = 0, n = 0;
      const iv = setInterval(() => {
        maxDy = Math.max(maxDy, Math.abs(w.y - y0));
        maxDx = Math.max(maxDx, Math.abs(w.x - x0));
        if (++n >= 12) { clearInterval(iv); res({ maxDy, maxDx }); }
      }, 70);
    }, 600);
  }));
  check('Stehende Raupe ist absolut ruhig (kein Zittern)', r.maxDy < 0.01 && r.maxDx < 0.01,
    `dy=${r.maxDy.toFixed(3)} dx=${r.maxDx.toFixed(3)}`);

  // ---- Kamera-Choreografie: Einschlag -> Opfer-Tour -> Salut -> nächster Zug
  r = await page.evaluate(() => new Promise((res) => {
    const WU = window.__wurm;
    WU.newGame();
    const shooter = WU.game.active;
    const team0 = WU.game.turnTeam;
    const victim = WU.teams()[(team0 + 1) % WU.teams().length].worms[0];
    // "Schuss" simulieren: Treffer + Einschlag, dann Zugende einleiten
    WU.explode(victim.x, victim.y - 4, 20, 30, false);
    WU.game.fireDone = true;
    WU.game.state = 'busy';
    WU.game.settleT = 0; WU.game.busyT = 0; WU.game.camSeq = null;
    let sawSalute = false, sawVictimFocus = false, n = 0;
    const iv = setInterval(() => {
      if (shooter.saluteT > 0) sawSalute = true;
      if (Math.abs((WU.cam.tx ?? 0) - victim.x) < 2) sawVictimFocus = true;
      if (WU.game.turnTeam !== team0 || ++n > 80) {
        clearInterval(iv);
        res({ sawSalute, sawVictimFocus, advanced: WU.game.turnTeam !== team0,
          hadBoom: !!WU.lastBoom || true });
      }
    }, 100);
  }));
  check('Kamera besucht das Opfer, Schütze salutiert, dann Zugwechsel',
    r.advanced && r.sawVictimFocus && r.sawSalute, JSON.stringify(r));

  // ---- Abschluss-Hüpfer nach dem Zug
  r = await page.evaluate(() => {
    const WU = window.__wurm;
    WU.cfg.teamCount = 2; WU.cfg.wormCount = 2;
    WU.newGame();
    const active = WU.game.active;
    WU.startTurn();   // Zug endet -> Hüpfer
    return { celebrate: active.celebrate > 0, next: WU.game.active !== active };
  });
  check('Nach dem Zug hüpft die Raupe (Zug fertig!)', r.celebrate && r.next);

  // ---- Baseballschläger: genervt (18 Schaden, moderater Rums) ---------------
  r = await page.evaluate(() => {
    const WU = window.__wurm;
    WU.newGame();
    const w = WU.game.active;
    const victim = WU.allWorms().find((o) => o !== w);
    victim.x = w.x + w.facing * 20; victim.y = w.y;
    victim.vx = 0; victim.vy = 0; victim.hp = 100;
    WU.game.aim = 0;
    WU.WEAPONS.find((wp) => wp.key === 'bat').fire(w);
    return { hp: victim.hp, vx: Math.abs(victim.vx), vy: victim.vy };
  });
  check('Schläger macht jetzt 18 Schaden (statt 26)', r.hp === 82, 'hp=' + r.hp);
  check('Rückstoß moderat: |vx| ≤ 380, leichter Lupfer', r.vx > 100 && r.vx <= 380.5 && r.vy < 0, JSON.stringify(r));

  // ---- Kartenränder: Land bis zum Rand, unsichtbare Wände statt Absturz -----
  r = await page.evaluate(() => new Promise((res) => {
    const WU = window.__wurm;
    WU.newGame();
    // Land reicht jetzt bis an beide Ränder (kein Wasserstreifen mehr)
    const landL = WU.solidAt(2, 590), landR = WU.solidAt(1597, 590);
    // Raupe hoch oben mit Wucht gegen die linke Wand schleudern
    const wm = WU.allWorms()[0];
    wm.x = 60; wm.y = 40; wm.vx = -900; wm.vy = 0; wm.grounded = false;
    let minX = wm.x, bounced = false, n = 0;
    const iv = setInterval(() => {
      minX = Math.min(minX, wm.x);
      if (wm.vx > 10) bounced = true;
      if (++n > 25) { clearInterval(iv); res({ landL, landR, minX, bounced, alive: wm.alive, x: wm.x }); }
    }, 80);
  }));
  check('Land reicht bis an beide Kartenränder', r.landL && r.landR, JSON.stringify(r));
  check('Unsichtbare Wand: Raupe prallt ab und bleibt im Bild',
    r.minX >= 5 && r.bounced && r.alive && r.x >= 5, JSON.stringify(r));

  // ---- Neue Waffen: Bananenbombe, Maulwurfsbombe, Luftangriff, Schubser -----
  r = await page.evaluate(() => {
    const WU = window.__wurm;
    const by = (k) => WU.WEAPONS.find((w) => w.key === k);
    return { alle: ['banane', 'maulwurf', 'luft', 'schubs'].every((k) => !!by(k)),
      bAmmo: by('banane').ammo, mAmmo: by('maulwurf').ammo, lAmmo: by('luft').ammo,
      sAmmo: by('schubs').ammo };
  });
  check('Neue Waffen im Arsenal (🍌 🕳️ ✈️ 👉)', r.alle, JSON.stringify(r));
  check('Munition: Banane 1, Maulwurf 3, Luftangriff 1, Schubser ∞',
    r.bAmmo === 1 && r.mAmmo === 3 && r.lAmmo === 1 && r.sAmmo === Infinity);

  // Maulwurfsbombe: Riesen-Krater, Mini-Schaden
  r = await page.evaluate(() => {
    const WU = window.__wurm;
    WU.newGame();
    WU.weapon = WU.WEAPONS.findIndex((w) => w.key === 'maulwurf');
    WU.game.power = 0.5;
    WU.fireWeapon();
    const pr = WU.projectiles.find((p) => p.type === 'mole');
    // Wirkung direkt prüfen: riesig graben, kaum wehtun
    let gy = 100; while (!WU.solidAt(800, gy) && gy < 589) gy++;
    const wm = WU.allWorms()[0];
    wm.x = 760; wm.y = gy - 2; wm.hp = 100; wm.vx = 0; wm.vy = 0;
    WU.explode(800, gy + 20, 85, 10, true, 90);
    return { placed: !!pr, r: pr && pr.r, dmg: pr && pr.dmg, knock: pr && pr.knock,
      hp: wm.hp, carvedCenter: !WU.solidAt(800, gy + 20), carvedWide: !WU.solidAt(800, gy + 80) };
  });
  check('Maulwurfsbombe: Radius 85, nur 10 Schaden, sanfter Rums',
    r.placed && r.r === 85 && r.dmg === 10 && r.knock === 90, JSON.stringify(r));
  check('Riesen-Krater gegraben, Raupe fast unversehrt',
    r.carvedCenter && r.carvedWide && r.hp >= 90 && r.hp < 100, JSON.stringify(r));

  // Bananenbombe trägt 5 Filial-Bananen
  r = await page.evaluate(() => {
    const WU = window.__wurm;
    WU.newGame();
    WU.weapon = WU.WEAPONS.findIndex((w) => w.key === 'banane');
    WU.game.power = 0.5;
    WU.fireWeapon();
    const pr = WU.projectiles.find((p) => p.type === 'banana');
    return { placed: !!pr, cluster: pr && pr.cluster, cType: pr && pr.clusterType, cDmg: pr && pr.clusterDmg };
  });
  check('Bananenbombe fliegt und trägt 5 Filial-Bananen',
    r.placed && r.cluster === 5 && r.cType === 'banana' && r.cDmg === 38, JSON.stringify(r));

  // Luftangriff: Bombenteppich aus dem Himmel + Bomber
  r = await page.evaluate(() => {
    const WU = window.__wurm;
    WU.newGame();
    WU.weapon = WU.WEAPONS.findIndex((w) => w.key === 'luft');
    WU.fireWeapon();
    const bombs = WU.projectiles.filter((p) => p.type === 'abomb');
    return { n: bombs.length, fromSky: bombs.every((b) => b.y < 0),
      plane: WU.particles.some((p) => p.kind === 'plane') };
  });
  check('Luftangriff: 5 Bomben aus dem Himmel + Bomber im Anflug',
    r.n === 5 && r.fromSky && r.plane, JSON.stringify(r));

  // Schubser: genau 1 Schaden, kleiner Stups
  r = await page.evaluate(() => {
    const WU = window.__wurm;
    WU.newGame();
    const w = WU.game.active;
    const victim = WU.allWorms().find((o) => o !== w);
    victim.x = w.x + w.facing * 14; victim.y = w.y;
    victim.vx = 0; victim.vy = 0; victim.hp = 100;
    WU.WEAPONS.find((wp) => wp.key === 'schubs').fire(w);
    return { hp: victim.hp, vx: Math.abs(victim.vx) };
  });
  check('Schubser: genau 1 Schaden, sanfter Stups', r.hp === 99 && r.vx > 60 && r.vx <= 160, JSON.stringify(r));
} finally {
  await browser.close();
  srv.stop();
}

process.exit(summary() ? 1 : 0);
