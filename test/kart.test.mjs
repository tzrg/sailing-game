// 🏁 Kart-Rennen: Strecke, Fahrphysik (Gas, Gras, Boost, Drift mit Mini-Turbo),
// Items (Banane, Panzer, Pilz, Blitz), KI-Gegner, Rundenzählung, Platzierung,
// Zieleinlauf samt Bestzeit, Bedienung (Tastatur/Touch) und Querformat.
// Läuft über window.__kart; die Simulation wird pausiert und deterministisch
// per update(dt) getickt.

import { startServer, launchBrowser, checker } from './helpers.mjs';

const srv = startServer();
await srv.ready;
const { check, summary } = checker();

const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.on('pageerror', (e) => check('Seite ohne JS-Fehler', false, e.message));
  await page.goto(srv.url + '/kart.html');
  await page.waitForFunction(() => window.__kart);
  await page.click('#btn-start');   // Hilfe schließen

  // deterministisch ticken: Spiel pausieren, Zeit selbst vorgeben
  const setup = (opts = {}) => page.evaluate((o) => {
    const K = window.__kart;
    K.game.paused = true;
    K.game.cpu = o.cpu !== undefined ? o.cpu : 3;
    K.game.laps = o.laps !== undefined ? o.laps : 3;
    if (o.driver) K.game.driver = o.driver;
    K.pressed.clear();
    for (const b of Object.values(K.buttons)) b.held = false;
    K.startRace(o.seed !== undefined ? o.seed : 7);
    if (o.skipCount) { K.game.state = 'race'; K.game.count = 0; }
  }, opts);
  const tick = (secs) => page.evaluate((s) => {
    const K = window.__kart;
    for (let t = 0; t < s; t += 0.016) { K.update(0.016); K.updateCam(0.016); }
  }, secs);

  // ---- Strecke: Startaufstellung, Oberflächen, Deko
  await setup();
  let r = await page.evaluate(() => {
    const K = window.__kart, S = K.SURF;
    const onRoad = K.karts().every((k) => K.surfAt(k.x, k.y) === S.ROAD);
    // Oberflächen über die ganze Karte zählen
    const cnt = {};
    for (let y = 0; y < K.MAP; y += 3) for (let x = 0; x < K.MAP; x += 3) {
      const s = K.surfAt(x, y); cnt[s] = (cnt[s] || 0) + 1;
    }
    // neben der Fahrbahn liegt Gras
    const side = K.sidePoint(100, 90);
    return {
      onRoad, cnt, karts: K.karts().length, boxes: K.boxes().length, trees: K.trees().length,
      nodes: K.N, sideGrass: K.surfAt(side.x, side.y) === S.GRASS,
      mid: K.surfAt(K.nodeAt(200).x, K.nodeAt(200).y) === S.ROAD,
      S,
    };
  });
  check('Alle Karts stehen beim Start auf der Fahrbahn', r.onRoad, JSON.stringify(r.cnt));
  check('Die Strecke hat Asphalt, Gras, Randsteine, Boost-Felder und Sand',
    r.cnt[r.S.ROAD] > 3000 && r.cnt[r.S.GRASS] > 20000 && r.cnt[r.S.CURB] > 300
    && r.cnt[r.S.BOOST] > 20 && r.cnt[r.S.SAND] > 300, JSON.stringify(r.cnt));
  check('Die Mittellinie liegt überall auf Asphalt, daneben ist Gras', r.mid && r.sideGrass);
  check('Vier Karts, Item-Boxen und Deko stehen bereit',
    r.karts === 4 && r.boxes >= 12 && r.trees > 10, JSON.stringify(r));

  // ---- Countdown: erst bei LOS geht es los
  r = await page.evaluate(() => ({ state: window.__kart.game.state, count: window.__kart.game.count }));
  check('Das Rennen startet mit einem Countdown', r.state === 'count' && r.count > 2);
  await page.evaluate(() => window.__kart.pressed.add('arrowup'));
  await tick(1);
  r = await page.evaluate(() => ({ speed: window.__kart.karts()[0].speed, state: window.__kart.game.state }));
  check('Während des Countdowns steht das Kart still', r.speed < 1 && r.state === 'count', JSON.stringify(r));
  await tick(2.6);
  r = await page.evaluate(() => ({ state: window.__kart.game.state, speed: window.__kart.karts()[0].speed }));
  check('Nach dem Countdown läuft das Rennen', r.state === 'race');
  check('Gas beschleunigt das Kart', r.speed > 40, 'speed=' + r.speed);

  // ---- Bremse
  await page.evaluate(() => { window.__kart.pressed.delete('arrowup'); window.__kart.pressed.add('arrowdown'); });
  const before = await page.evaluate(() => window.__kart.karts()[0].speed);
  await tick(0.8);
  r = await page.evaluate((b) => ({ b, now: window.__kart.karts()[0].speed }), before);
  check('Die Bremse verzögert spürbar', r.now < r.b - 30, JSON.stringify(r));
  await page.evaluate(() => window.__kart.pressed.clear());

  // ---- Lenken
  await setup({ skipCount: true });
  r = await page.evaluate(async () => {
    const K = window.__kart, k = K.karts()[0];
    K.pressed.add('arrowup');
    for (let i = 0; i < 90; i++) K.update(0.016);
    const a0 = k.ang;
    K.pressed.add('arrowright');
    for (let i = 0; i < 60; i++) K.update(0.016);
    const a1 = k.ang;
    K.pressed.clear();
    return { turned: a1 - a0 };
  });
  check('Lenken dreht das Kart in die Kurve', r.turned > 0.3, JSON.stringify(r));

  // ---- Untergrund: Gras bremst deutlich (gemessen auf der Startgeraden)
  r = await page.evaluate(() => {
    const K = window.__kart;
    // sauberen Grasfleck neben der Startgeraden suchen
    let gp = null;
    for (let off = 70; off < 160 && !gp; off += 5) {
      const p = K.sidePoint(8, off);
      if (K.surfAt(p.x, p.y) === K.SURF.GRASS) gp = p;
    }
    const run = (start) => {
      K.startRace(5); K.game.state = 'race'; K.game.count = 0;
      const k = K.karts()[0];
      k.x = start.x; k.y = start.y; k.ang = K.nodeAt(8).ang; k.velAng = k.ang; k.speed = 0;
      K.pressed.add('arrowup');
      let surf = -1;
      for (let i = 0; i < 90; i++) { K.update(0.016); surf = K.surfAt(k.x, k.y); }
      K.pressed.clear();
      return { v: k.speed, surf };
    };
    const road = run(K.nodeAt(8)), grass = run(gp);
    return { road: road.v, grass: grass.v, rs: road.surf, gs: grass.surf };
  });
  check('Auf Gras ist deutlich weniger Tempo drin',
    r.grass < r.road * 0.7 && r.gs === 0 && r.rs === 1, JSON.stringify(r));

  // ---- Boost-Feld
  r = await page.evaluate(() => {
    const K = window.__kart;
    const run = (onPad) => {
      K.startRace(5); K.game.state = 'race'; K.game.count = 0;
      const k = K.karts()[0];
      const p = onPad ? K.nodeAt(40) : K.nodeAt(10);
      k.x = p.x; k.y = p.y; k.ang = p.ang; k.velAng = p.ang; k.speed = 150;
      K.pressed.add('arrowup');
      let boosted = 0;
      for (let i = 0; i < 40; i++) { K.update(0.016); if (k.boostT > 0) boosted++; }
      K.pressed.clear();
      return { boosted, speed: k.speed, surf: K.surfAt(p.x, p.y) };
    };
    const pad = run(true), plain = run(false);
    return { pad, plain, top: K.karts()[0].d.top };
  });
  check('Das ⏩ Boost-Feld gibt Schub',
    r.pad.surf === 3 && r.pad.boosted > 20 && !r.plain.boosted && r.pad.speed > r.plain.speed + 20,
    JSON.stringify(r));

  // ---- Drift mit Mini-Turbo
  r = await page.evaluate(() => {
    const K = window.__kart;
    K.startRace(5); K.game.state = 'race'; K.game.count = 0;
    const k = K.karts()[0];
    k.speed = 150;
    K.pressed.add('arrowup'); K.pressed.add('arrowright'); K.pressed.add('shift');
    let maxCharge = 0, drifting = false;
    for (let i = 0; i < 130; i++) { K.update(0.016); drifting = drifting || !!k.drift; maxCharge = Math.max(maxCharge, k.driftCharge); }
    K.pressed.delete('shift');
    K.update(0.016);
    const boost = k.boostT;
    K.pressed.clear();
    return { drifting, maxCharge, boost };
  });
  check('Driften lädt den Mini-Turbo auf', r.drifting && r.maxCharge > 0.9, JSON.stringify(r));
  check('Loslassen gibt den Mini-Turbo frei', r.boost > 0.3, JSON.stringify(r));

  // ---- Item-Boxen
  r = await page.evaluate(() => {
    const K = window.__kart;
    K.game.cpu = 0;                       // allein, damit niemand dazwischenfunkt
    K.startRace(11); K.game.state = 'race'; K.game.count = 0;
    const k = K.karts()[0], box = K.boxes()[0];
    k.x = box.x; k.y = box.y; k.speed = 0;
    K.update(0.016);
    const got = k.item;
    const gone = K.boxes()[0].t > 0;
    k.x = -1e4; k.y = -1e4;               // Fahrer weg, sonst greift er gleich wieder zu
    for (let i = 0; i < 300; i++) K.update(0.016);     // ~5 s später ist sie wieder da
    const back = K.boxes()[0].t <= 0;
    K.game.cpu = 3;
    return { got, gone, back, items: Object.keys(K.ITEMS) };
  });
  check('Die ❓ Item-Box gibt ein Item', !!r.got && r.items.includes(r.got), JSON.stringify(r));
  check('Eingesammelte Boxen kommen nach kurzer Zeit wieder', r.gone && r.back, JSON.stringify(r));

  // ---- Banane: wird abgelegt und dreht den Verfolger aus
  r = await page.evaluate(() => {
    const K = window.__kart;
    K.startRace(11); K.game.state = 'race'; K.game.count = 0;
    const me = K.karts()[0], foe = K.karts()[1];
    me.item = 'banana';
    const ok = K.useItem(me);
    const b = K.bananas()[0];
    foe.x = b.x; foe.y = b.y; foe.speed = 150; foe.spinT = 0;
    K.update(0.016);
    return { ok, dropped: !!b, spin: foe.spinT, left: K.bananas().length, slow: foe.speed };
  });
  check('🍌 Banane lässt sich hinter sich ablegen', r.ok && r.dropped);
  check('Wer in die Banane fährt, dreht sich aus', r.spin > 0.5 && r.slow < 60 && r.left === 0, JSON.stringify(r));

  // ---- Grüner Panzer fliegt nach vorn und trifft
  r = await page.evaluate(() => {
    const K = window.__kart;
    K.startRace(11); K.game.state = 'race'; K.game.count = 0;
    const me = K.karts()[0], foe = K.karts()[1];
    const p = K.nodeAt(8);
    me.x = p.x; me.y = p.y; me.ang = p.ang; me.velAng = p.ang; me.speed = 0;
    const t = K.nodeAt(24);
    foe.x = t.x; foe.y = t.y; foe.speed = 0; foe.spinT = 0;
    me.item = 'shell';
    K.useItem(me);
    const fired = K.shells().length;
    let hit = 0;
    for (let i = 0; i < 90 && !hit; i++) { K.update(0.016); if (foe.spinT > 0) hit = 1; }
    return { fired, hit, shells: K.shells().length };
  });
  check('🐢 Panzer fliegt nach vorn und trifft den Gegner', r.fired === 1 && r.hit === 1, JSON.stringify(r));

  // ---- Pilz und Blitz
  r = await page.evaluate(() => {
    const K = window.__kart;
    K.startRace(11); K.game.state = 'race'; K.game.count = 0;
    const me = K.karts()[0];
    me.item = 'mushroom'; K.useItem(me);
    const boost = me.boostT;
    me.item = 'bolt'; K.useItem(me);
    const others = K.karts().slice(1);
    return { boost, slowed: others.every((o) => o.slowT > 1), mine: me.slowT };
  });
  check('🍄 Pilz gibt Turbo', r.boost > 1, JSON.stringify(r));
  check('⚡ Blitz bremst alle anderen aus (einen selbst nicht)', r.slowed && r.mine === 0, JSON.stringify(r));

  // ---- Item-Verteilung: vorne gibt es keinen Blitz, hinten schon
  r = await page.evaluate(() => {
    const K = window.__kart;
    K.startRace(3);
    const k = K.karts()[0];
    const roll = (place) => { k.place = place; const out = {}; for (let i = 0; i < 400; i++) { const it = K.rollItem(k); out[it] = (out[it] || 0) + 1; } return out; };
    return { first: roll(1), last: roll(4) };
  });
  check('Führende ziehen keinen Blitz, Hintermänner schon',
    !r.first.bolt && r.last.bolt > 10, JSON.stringify(r));

  // ---- Karts rempeln sich: der Schwere schiebt den Leichten
  r = await page.evaluate(() => {
    const K = window.__kart;
    K.startRace(3); K.game.state = 'race'; K.game.count = 0;
    const heavy = K.karts()[0], light = K.karts()[1];
    heavy.d = K.DRIVERS.find((d) => d.key === 'baer');
    light.d = K.DRIVERS.find((d) => d.key === 'frosch');
    const p = K.nodeAt(150);
    heavy.x = p.x; heavy.y = p.y; light.x = p.x + 6; light.y = p.y;
    heavy.speed = 0; light.speed = 0;
    const d0 = Math.hypot(light.x - heavy.x, light.y - heavy.y);
    const hx = heavy.x, lx = light.x;
    K.update(0.016);
    const d1 = Math.hypot(light.x - heavy.x, light.y - heavy.y);
    return { d0, d1, heavyMoved: Math.abs(heavy.x - hx), lightMoved: Math.abs(light.x - lx) };
  });
  check('Karts schieben sich auseinander – der Schwere setzt sich durch',
    r.d1 > r.d0 && r.lightMoved > r.heavyMoved, JSON.stringify(r));

  // ---- Streckenposten: wer die Karte verlässt, kommt zurück
  r = await page.evaluate(() => {
    const K = window.__kart;
    K.startRace(3); K.game.state = 'race'; K.game.count = 0;
    const k = K.karts()[0];
    k.x = -40; k.y = -40; k.speed = 100;
    K.update(0.016);
    return { x: k.x, y: k.y, surf: K.surfAt(k.x, k.y) };
  });
  check('Wer die Karte verlässt, wird auf die Strecke zurückgesetzt',
    r.x > 0 && r.y > 0 && [1, 2, 3].includes(r.surf), JSON.stringify(r));

  // ---- Rundenzählung und Platzierung
  r = await page.evaluate(() => {
    const K = window.__kart;
    K.startRace(3); K.game.state = 'race'; K.game.count = 0;
    const k = K.karts()[0];
    const put = (node) => { const p = K.nodeAt(node); k.x = p.x; k.y = p.y; k.ang = p.ang; k.velAng = p.ang; K.update(0.016); };
    const lap0 = k.lap;
    for (const n of [100, 240, 380, 470, 10]) put(n);    // einmal herum
    const lap1 = k.lap;
    for (const n of [470, 380]) put(n);                   // rückwärts über die Linie
    const lapBack = k.lap;
    return { lap0, lap1, lapBack, node: k.node };
  });
  check('Eine Runde über die Ziellinie zählt hoch', r.lap1 === r.lap0 + 1, JSON.stringify(r));
  check('Rückwärts über die Linie zählt nicht als Runde', r.lapBack === r.lap1 - 1, JSON.stringify(r));

  r = await page.evaluate(() => {
    const K = window.__kart;
    K.startRace(3); K.game.state = 'race'; K.game.count = 0;
    const [me, a, b, c] = K.karts();
    const put = (k, node) => { const p = K.nodeAt(node); k.x = p.x; k.y = p.y; k.node = K.nearestNode(k, true); };
    put(me, 300); put(a, 120); put(b, 60); put(c, 20);
    K.updatePlaces();
    return { me: me.place, a: a.place, c: c.place };
  });
  check('Die Platzierung folgt dem Streckenfortschritt',
    r.me === 1 && r.a === 2 && r.c === 4, JSON.stringify(r));

  // ---- Zieleinlauf: eine Runde, Autopilot, Bestzeit landet in localStorage
  await page.evaluate(() => { try { localStorage.removeItem('kart_fuchs'); } catch { /* egal */ } });
  r = await page.evaluate(async () => {
    const K = window.__kart;
    K.game.cpu = 2; K.game.laps = 1; K.game.driver = 'fuchs';
    K.startRace(21);
    K.game.state = 'race'; K.game.count = 0;
    K.game.autoPilot = true;                 // Autopilot fährt die Runde
    for (let i = 0; i < 70 / 0.016 && K.game.state !== 'done'; i++) K.update(0.016);
    const me = K.karts()[0];
    const doneState = K.game.state;
    for (let i = 0; i < 25 / 0.016; i++) K.update(0.016);   // die KI fährt zu Ende
    return {
      state: doneState, lap: me.lap, fin: me.finished,
      best: me.bestLap, total: me.finishT, place: me.place,
      stored: parseFloat(localStorage.getItem('kart_fuchs')),
      cpuFinished: K.karts().slice(1).filter((k) => k.finished).length,
      auto: K.game.autoPilot,
    };
  });
  await page.evaluate(() => { window.__kart.game.autoPilot = false; });
  check('Nach der letzten Runde ist das Rennen vorbei',
    r.state === 'done' && r.fin && r.lap === 2, JSON.stringify(r));
  check('Rundenzeit und Gesamtzeit werden festgehalten',
    r.best > 5 && r.best < 60 && r.total >= r.best, JSON.stringify(r));
  check('Die Bestrunde landet im Speicher', Number.isFinite(r.stored) && r.stored > 0, JSON.stringify(r));
  check('Auch die KI kommt ins Ziel', r.cpuFinished >= 1, JSON.stringify(r));

  // ---- KI fährt ein ganzes Rennen sauber (bleibt auf der Strecke)
  r = await page.evaluate(() => {
    const K = window.__kart;
    K.game.cpu = 3; K.game.laps = 3;
    K.startRace(9);
    K.game.state = 'race'; K.game.count = 0;
    let onRoad = 0, samples = 0;
    for (let i = 0; i < 60 / 0.016; i++) {
      K.update(0.016);
      if (i % 60 === 0) {
        for (const k of K.karts().slice(1)) { samples++; if (K.surfAt(k.x, k.y) !== 0) onRoad++; }
      }
    }
    const laps = K.karts().slice(1).map((k) => k.lap);
    return { laps, onRoad, samples, best: K.karts()[1].bestLap };
  });
  check('Die KI dreht in einer Minute mehrere Runden', Math.max(...r.laps) >= 3, JSON.stringify(r.laps));
  check('Die KI bleibt dabei fast immer auf der Strecke', r.onRoad / r.samples > 0.85,
    `${r.onRoad}/${r.samples}`);
  check('KI-Rundenzeiten sind plausibel (8–40 s)', r.best > 8 && r.best < 40, 'best=' + r.best);

  // ---- Fahrer: drei Typen mit unterschiedlichen Werten
  r = await page.evaluate(() => {
    const K = window.__kart;
    const d = K.DRIVERS;
    K.setDriver('baer');
    const after = { key: K.game.driver, top: K.karts()[0].d.top, stored: localStorage.getItem('kart_driver') };
    K.setDriver('fuchs');
    return { n: d.length, tops: d.map((x) => x.top), accs: d.map((x) => x.acc), after };
  });
  check('Es gibt drei Fahrer mit eigenen Fahrwerten',
    r.n === 3 && new Set(r.tops).size === 3 && new Set(r.accs).size === 3, JSON.stringify(r));
  check('Die Fahrerwahl wirkt sofort und wird gemerkt',
    r.after.key === 'baer' && r.after.top > 200 && r.after.stored === 'baer', JSON.stringify(r.after));

  // ---- Touch-Steuerung
  r = await page.evaluate(() => {
    const K = window.__kart;
    K.startRace(3); K.game.state = 'race'; K.game.count = 0;
    K.pressed.clear();
    K.buttons['k-gas'].held = true;
    for (let i = 0; i < 60; i++) K.update(0.016);
    const v = K.karts()[0].speed;
    const a0 = K.karts()[0].ang;
    K.buttons['k-right'].held = true;
    for (let i = 0; i < 40; i++) K.update(0.016);
    const turned = K.karts()[0].ang - a0;
    K.buttons['k-gas'].held = false; K.buttons['k-right'].held = false;
    return { v, turned };
  });
  check('Touch: 🚀 gibt Gas und ▶ lenkt', r.v > 30 && r.turned > 0.2, JSON.stringify(r));

  r = await page.evaluate(async () => {
    const K = window.__kart;
    K.startRace(3); K.game.state = 'race'; K.game.count = 0;
    K.karts()[0].item = 'banana';
    document.getElementById('k-item').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    const used = !K.karts()[0].item && K.bananas().length === 1;
    document.getElementById('k-item').dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    return { used };
  });
  check('Touch: 🎁 setzt das Item ein', r.used);

  // ---- Menü-Optionen
  r = await page.evaluate(async () => {
    const K = window.__kart;
    document.querySelector('#opt-cpu button[data-v="2"]').click();
    const cpu = { n: K.karts().length, stored: localStorage.getItem('kart_cpu') };
    document.querySelector('#opt-laps button[data-v="5"]').click();
    const laps = { laps: K.game.laps, stored: localStorage.getItem('kart_laps') };
    document.querySelector('#opt-cpu button[data-v="3"]').click();
    document.querySelector('#opt-laps button[data-v="3"]').click();
    return { cpu, laps };
  });
  check('Die Gegnerzahl lässt sich einstellen', r.cpu.n === 3 && r.cpu.stored === '2', JSON.stringify(r.cpu));
  check('Die Rundenzahl lässt sich einstellen', r.laps.laps === 5 && r.laps.stored === '5', JSON.stringify(r.laps));

  // ---- Ton an/aus wird gemerkt
  await page.click('#btn-sound');
  r = await page.evaluate(() => ({ on: window.__kart.Sfx.on, stored: localStorage.getItem('kart_sound'), icon: document.getElementById('btn-sound').textContent }));
  check('🔇 schaltet den Ton ab und merkt sich das', r.on === false && r.stored === '0' && r.icon === '🔇', JSON.stringify(r));
  await page.click('#btn-sound');
  r = await page.evaluate(() => ({ on: window.__kart.Sfx.on, stored: localStorage.getItem('kart_sound') }));
  check('🔊 schaltet ihn wieder an', r.on === true && r.stored === '1', JSON.stringify(r));

  // ---- Querformat-Drehung
  await page.click('#btn-rotate');
  r = await page.evaluate(() => document.getElementById('stage').classList.contains('rot'));
  check('⟳ dreht die Bühne ins Querformat', r === true);
  await page.click('#btn-rotate');
  r = await page.evaluate(() => document.getElementById('stage').classList.contains('rot'));
  check('⟳ dreht auch wieder zurück', r === false);

  // ---- Darstellung: Mode-7-Bild ist kein leeres Blatt
  r = await page.evaluate(() => {
    const K = window.__kart;
    K.startRace(3); K.game.state = 'race'; K.game.count = 0;
    for (let i = 0; i < 60; i++) { K.update(0.016); K.updateCam(0.016); }
    const c = document.getElementById('game');
    const g = c.getContext('2d');
    const d = g.getImageData(0, Math.round(c.height * 0.75), c.width, 1).data;
    let dark = 0, light = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i] < 90) dark++; else light++; }
    const p = K.project(K.karts()[0].x, K.karts()[0].y);
    return { dark, light, proj: p ? { x: Math.round(p.x), y: Math.round(p.y), s: +p.s.toFixed(2) } : null };
  });
  check('Die Strecke wird perspektivisch gezeichnet (Asphalt + Gras im Bild)',
    r.dark > 100 && r.light > 100, JSON.stringify({ dark: r.dark, light: r.light }));
  check('Das eigene Kart wird unten in der Bildmitte projiziert',
    r.proj && Math.abs(r.proj.x - 600) < 120 && r.proj.y > 400, JSON.stringify(r.proj));
} finally {
  await browser.close();
  srv.stop();
}

process.exit(summary() ? 1 : 0);
