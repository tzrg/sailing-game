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
  check('Dynamit: 8 s Rückzug konfiguriert', r.dyn.retreat === 8);

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
  check('Dynamit gelegt: Lunte 10 s, Rückzug ~8 s, Zug läuft weiter',
    r.placed && r.fuse === 10 && r.retreatT > 7.5 && r.state === 'aim', JSON.stringify(r));

  await page.waitForTimeout(900);   // fällt zu Boden und bleibt liegen
  r = await page.evaluate(() => {
    const WU = window.__wurm;
    const pr = WU.projectiles.find((p) => p.type === 'dynamite');
    return { still: !!pr, rest: pr && !!pr.rest, alive: WU.focus().alive, hp: WU.focus().hp };
  });
  check('Dynamit explodiert NICHT beim Aufsetzen (der alte Bug)', r.still && r.rest, JSON.stringify(r));
  check('Die Raupe daneben lebt noch unversehrt', r.alive && r.hp === 100);

  // Lunte fast abbrennen lassen -> jetzt muss es krachen
  await page.evaluate(() => {
    const pr = window.__wurm.projectiles.find((p) => p.type === 'dynamite');
    pr.t = 9.9;
  });
  await page.waitForTimeout(400);
  r = await page.evaluate(() => ({ gone: !window.__wurm.projectiles.some((p) => p.type === 'dynamite') }));
  check('Nach 10 s Lunte explodiert das Dynamit', r.gone);

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
} finally {
  await browser.close();
  srv.stop();
}

process.exit(summary() ? 1 : 0);
