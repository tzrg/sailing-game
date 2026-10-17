// ✈️ Flugsimulator: Welt (Gelände, Flugplatz, Stadt), Aerodynamik (Auftrieb,
// Abriss, Klappen, Schub), Ruderwirkung und Stabilität, Start und Landung,
// Bruchfälle, Instrumente, Bedienung und die Einbindung in die Sammlung.
// Läuft über window.__flug; die Simulation wird pausiert und per update(dt)
// deterministisch getickt.

import { startServer, launchBrowser, checker } from './helpers.mjs';

const srv = startServer();
await srv.ready;
const { check, summary } = checker();

const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  page.on('pageerror', (e) => check('Seite ohne JS-Fehler', false, e.message));
  await page.goto(srv.url + '/flug.html');
  await page.waitForFunction(() => window.__flug, null, { timeout: 30000 });
  await page.click('#btn-start');

  let r = await page.evaluate(() => window.__flug.glError());
  check('WebGL steht zur Verfügung', r === '', r);

  /* ------------------------------------------------------------ Welt --- */
  r = await page.evaluate(() => {
    const F = window.__flug;
    const w = F.world();
    const hs = w.buildings.map((b) => b.y1 - b.y0).sort((a, b) => b - a);
    return {
      meshes: Object.keys(w.meshes).length,
      dreiecke: Object.values(w.meshes).reduce((s, m) => s + m.n / 3, 0),
      gebaeude: w.buildings.length,
      hoechstes: Math.round(hs[0]),
      ueber100: hs.filter((h) => h > 100).length,
    };
  });
  check('Die Welt steht: Gelände, Wasser, Flugplatz, Stadt, Dörfer, Wald, Straße',
    r.meshes === 7 && r.dreiecke > 40000, JSON.stringify(r));
  check('Die Stadt hat echte Hochhäuser',
    r.gebaeude > 250 && r.hoechstes > 150 && r.ueber100 >= 10, JSON.stringify(r));

  r = await page.evaluate(() => {
    const F = window.__flug;
    const t = F.terrainH;
    const mitte = t(F.AIRPORT.x, F.AIRPORT.z);
    const schwelle = t(F.AIRPORT.x, F.RUNWAY.z1 - 40);
    const quer = t(F.AIRPORT.x + 300, F.AIRPORT.z);
    const see = t(F.LAKE.x, F.LAKE.z);
    const huegel = Math.max(...[1, 2, 3, 4].map((i) => t(-5200 + i * 300, -5200 + i * 500)));
    return { mitte, dLaengs: Math.abs(schwelle - mitte), dQuer: Math.abs(quer - mitte), see, huegel };
  });
  check('Der Flugplatz liegt eben – über die ganze Piste',
    r.dLaengs < 0.2 && r.dQuer < 0.6, JSON.stringify(r));
  check('Drumherum gibt es einen See und Hügel',
    r.see < r.mitte - 15 && r.huegel > r.mitte + 25, JSON.stringify(r));

  /* ---------------------------------------------------- Aerodynamik --- */
  r = await page.evaluate(() => {
    const F = window.__flug;
    const cl = (deg) => F.liftCoef((deg * Math.PI) / 180);
    F.plane.flapStep = 0;
    const vorStall = cl(10), beiStall = cl(16), nachStall = cl(22);
    // Abrissgeschwindigkeit: langsamste Fahrt, bei der der Auftrieb trägt
    const vs = (step) => {
      F.plane.flapStep = step;
      for (let v = 60; v > 10; v -= 0.05) {
        const L = 0.5 * 1.225 * v * v * F.AC.S * F.liftCoef(F.AC.aStall);
        if (L < F.AC.m * 9.80665) return v * 1.94384;
      }
      return -1;
    };
    const sauber = vs(0), klappen = vs(3);
    F.plane.flapStep = 0;
    return {
      vorStall, beiStall, nachStall,
      sauber: +sauber.toFixed(1), klappen: +klappen.toFixed(1),
      rho0: F.density(0), rho3000: F.density(3000),
    };
  });
  check('Der Auftrieb wächst mit dem Anstellwinkel – bis zum Abriss',
    r.vorStall < r.beiStall && r.nachStall < r.beiStall * 0.75, JSON.stringify(r));
  check('Die Abrissgeschwindigkeit liegt im Bereich einer Cessna (45–55 kt)',
    r.sauber > 44 && r.sauber < 56, String(r.sauber));
  check('Klappen senken die Abrissgeschwindigkeit um mindestens 5 kt',
    r.klappen < r.sauber - 5, `${r.klappen} statt ${r.sauber}`);
  check('Die Luft wird mit der Höhe dünner',
    r.rho3000 < r.rho0 * 0.78, JSON.stringify([r.rho0, r.rho3000]));

  /* ---------------------------------------- Start, Steigflug, Ruder --- */
  const fliegen = (sek, opts = {}) => page.evaluate(([s, o]) => {
    const F = window.__flug;
    F.game.paused = true;
    if (o.reset) { F.reset(o.reset); F.set({ elevator: 0, aileron: 0, rudder: 0 }); }
    if (o.throttle !== undefined) F.plane.throttle = o.throttle;
    if (o.flaps !== undefined) F.plane.flapStep = o.flaps;
    for (let i = 0; i < s * 50; i++) {
      if (o.ctl) F.set(o.ctl);
      if (o.rotate && F.kt() > 58) F.set({ elevator: 0.55 });
      F.update(1 / 50);
    }
    const e = F.euler(), D = 180 / Math.PI;
    return {
      kt: F.kt(), alt: F.plane.pos[1], agl: F.plane.agl, boden: F.plane.onGround,
      roll: e.roll * D, pitch: e.pitch * D, kurs: ((e.yaw * D) % 360 + 360) % 360,
      vs: F.plane.vs, stall: F.plane.stall, state: F.game.state,
      aoa: (F.plane.alpha * 180) / Math.PI,
    };
  }, [sek, opts]);

  r = await fliegen(14, { reset: 'runway', throttle: 1 });
  check('Mit Vollgas beschleunigt die Maschine auf Startfahrt',
    r.kt > 52 && r.kt < 75 && r.boden, JSON.stringify({ kt: Math.round(r.kt), boden: r.boden }));

  r = await fliegen(30, { reset: 'runway', throttle: 1, rotate: true });
  check('Nach dem Ziehen hebt sie ab und steigt',
    !r.boden && r.agl > 40 && r.vs > 1, JSON.stringify({ agl: Math.round(r.agl), vs: +r.vs.toFixed(1) }));
  check('Die Steigrate liegt im realistischen Bereich (300–1400 ft/min)',
    r.vs * 196.85 > 300 && r.vs * 196.85 < 1400, String(Math.round(r.vs * 196.85)));

  r = await fliegen(40, { reset: 'approach', throttle: 0.62 });
  check('Ohne Eingabe fliegt sie von allein stabil geradeaus',
    Math.abs(r.roll) < 3 && Math.abs(r.pitch) < 12 && r.state === 'fly',
    JSON.stringify({ roll: +r.roll.toFixed(1), pitch: +r.pitch.toFixed(1) }));

  const kurs0 = (await fliegen(0.02, { reset: 'approach' })).kurs;
  r = await fliegen(1.6, { ctl: { aileron: 0.8 } });
  check('Querruder rechts legt die Maschine nach rechts',
    r.roll > 18 && r.roll < 75, `Rollwinkel ${r.roll.toFixed(0)}°`);
  const nachRolle = await fliegen(5, { ctl: { aileron: 0 } });
  check('In der Schräglage dreht sie nach rechts weg',
    ((nachRolle.kurs - kurs0 + 540) % 360) - 180 > 10,
    `von ${kurs0.toFixed(0)}° auf ${nachRolle.kurs.toFixed(0)}°`);
  const linksRum = await fliegen(1.6, { reset: 'approach', ctl: { aileron: -0.8 } });
  check('Querruder links entsprechend nach links',
    linksRum.roll < -18, `Rollwinkel ${linksRum.roll.toFixed(0)}°`);

  const kurs1 = (await fliegen(0.02, { reset: 'approach' })).kurs;
  r = await fliegen(4, { ctl: { rudder: 1 } });
  check('Seitenruder rechts dreht die Nase nach rechts',
    ((r.kurs - kurs1 + 540) % 360) - 180 > 5, `${kurs1.toFixed(0)}° -> ${r.kurs.toFixed(0)}°`);

  r = await fliegen(2.5, { reset: 'approach', ctl: { elevator: 0.8 } });
  check('Ziehen hebt die Nase', r.pitch > 8, `${r.pitch.toFixed(0)}°`);
  r = await fliegen(2.5, { reset: 'approach', ctl: { elevator: -0.8 } });
  check('Drücken senkt sie', r.pitch < -6, `${r.pitch.toFixed(0)}°`);

  r = await fliegen(24, { reset: 'approach', throttle: 0, ctl: { elevator: 0.8 } });
  check('Zu langsam und zu steil: die Strömung reißt ab und sie sackt durch',
    r.stall && r.aoa > 12 && r.vs < -2,
    JSON.stringify({ aoa: +r.aoa.toFixed(0), kt: Math.round(r.kt), vs: +r.vs.toFixed(1) }));

  // Einfedern beim Start ist keine Landung – auch nicht bei 120 Hz
  r = await page.evaluate(() => {
    const F = window.__flug, out = {};
    F.game.paused = true;
    for (const dt of [1 / 144, 1 / 120, 1 / 60, 1 / 30, 0.06]) {
      F.reset('runway');
      let t = 0;
      while (t < 6 && F.game.state === 'fly') { F.update(dt); t += dt; }
      out[Math.round(1 / dt) + ' Hz'] = F.game.state;
    }
    return out;
  });
  check('Auf der Piste stehen bleibt „fliegen“ – bei jeder Bildrate',
    Object.values(r).every((s) => s === 'fly'), JSON.stringify(r));

  /* ------------------------------------------------ Boden und Bremse --- */
  r = await page.evaluate(() => {
    const F = window.__flug;
    const rollen = (brems) => {
      F.game.paused = true;
      F.reset('runway');
      F.plane.vel = [0, 0, -30];
      F.plane.throttle = 0;
      for (let i = 0; i < 50 * 6; i++) { F.plane.brake = brems; F.update(1 / 50); }
      return F.kt();
    };
    return { ohne: rollen(0), mit: rollen(1) };
  });
  check('Die Bremse verzögert deutlich stärker als das reine Ausrollen',
    r.mit < r.ohne * 0.6, JSON.stringify({ ohne: Math.round(r.ohne), mit: Math.round(r.mit) }));

  /* ------------------------------------------------ Landung und Bruch - */
  r = await page.evaluate(() => {
    const F = window.__flug;
    F.game.paused = true;
    F.reset('approach');
    F.plane.flapStep = 2;
    localStorage.removeItem('flug_best');
    for (let i = 0; i < 50 * 220; i++) {
      const p = F.plane, e = F.euler();
      let soll = -3.0;
      if (p.agl < 16) soll = -0.8;
      if (p.agl < 5) soll = -0.3;
      F.set({
        elevator: Math.max(-1, Math.min(1, (soll - p.vel[1]) * 0.45 - p.om[0] * 2.4)),
        aileron: Math.max(-1, Math.min(1, -e.roll * 2.4 - p.om[2] * 1.5 - p.pos[0] * 0.004)),
        rudder: Math.max(-0.5, Math.min(0.5, -p.beta * 2)),
      });
      if (!p.onGround && p.agl > 6) {
        p.throttle = Math.max(0, Math.min(1, p.throttle + (64 - F.kt()) * 0.004));
      } else {
        p.throttle = 0; p.brake = 1;
        F.set({ elevator: 0.1, aileron: 0, rudder: 0 });
      }
      F.update(1 / 50);
      if (F.game.state !== 'fly') break;
    }
    return {
      state: F.game.state, res: F.game.result,
      best: localStorage.getItem('flug_best'),
      landungen: localStorage.getItem('flug_landungen'),
    };
  });
  check('Ein sauberer Anflug endet als Landung – mit Bewertung',
    r.state === 'landed' && r.res && r.res.ok && r.res.score > 0, JSON.stringify(r.res));
  check('Die beste Landung landet als Rekord im Speicher',
    Number(r.best) > 0 && Number(r.landungen) >= 1, JSON.stringify({ best: r.best, n: r.landungen }));

  r = await page.evaluate(() => {
    const F = window.__flug;
    const crashTest = (setup) => {
      F.game.paused = true;
      F.reset('approach');
      setup(F);
      for (let i = 0; i < 50 * 8 && F.game.state === 'fly'; i++) F.update(1 / 50);
      return { state: F.game.state, why: F.game.result && F.game.result.why };
    };
    return {
      hart: crashTest((f) => {
        f.plane.pos = [0, f.RUNWAY.y + 8, f.RUNWAY.z1 - 400];
        f.plane.vel = [0, -9, -38]; f.plane.throttle = 0;
        f.set({ elevator: -0.3 });
      }),
      haus: crashTest((f) => {
        const b = f.world().buildings.filter((x) => x.y1 - x.y0 > 120)[0];
        f.plane.pos = [b.x, (b.y0 + b.y1) / 2, b.z];
      }),
      berg: crashTest((f) => {
        f.plane.pos = [-5200, f.terrainH(-5200, -4600) - 5, -4600];
        f.plane.vel = [0, -4, -45];
      }),
    };
  });
  check('Zu hart aufgesetzt gibt Bruch', r.hart.state === 'crash', JSON.stringify(r.hart));
  check('Ein Hochhaus im Weg gibt Bruch',
    r.haus.state === 'crash' && /Gebäude/.test(r.haus.why || ''), JSON.stringify(r.haus));
  check('Der Hang im Gelände gibt Bruch', r.berg.state === 'crash', JSON.stringify(r.berg));

  /* --------------------------------------------------------- Kamera --- */
  r = await page.evaluate(() => {
    const F = window.__flug;
    F.game.paused = true;
    F.reset('runway');
    const c = F.cameraFor('cockpit');
    F.game.view = 'chase';
    let h = null;
    for (let i = 0; i < 40; i++) h = F.cameraFor('chase');
    return {
      cockpitNah: Math.hypot(c.eye[0] - F.plane.pos[0], c.eye[1] - F.plane.pos[1], c.eye[2] - F.plane.pos[2]),
      chaseFern: Math.hypot(h.eye[0] - F.plane.pos[0], h.eye[1] - F.plane.pos[1], h.eye[2] - F.plane.pos[2]),
      ueberGrund: h.eye[1] - F.terrainH(h.eye[0], h.eye[2]),
    };
  });
  check('Cockpitsicht sitzt im Flugzeug, die Verfolgerkamera dahinter',
    r.cockpitNah < 2 && r.chaseFern > 15 && r.chaseFern < 40, JSON.stringify(r));
  check('Die Verfolgerkamera taucht nicht in den Boden', r.ueberGrund > 1, String(r.ueberGrund));

  /* ----------------------------------------------------- Bedienung ---- */
  r = await page.evaluate(() => {
    const F = window.__flug;
    F.game.paused = false;
    F.plane.throttle = 0;
    return new Promise((res) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }));
      setTimeout(() => {
        window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w', bubbles: true }));
        F.game.paused = true;
        res(F.plane.throttle);
      }, 420);
    });
  });
  check('W schiebt den Gashebel nach vorn', r > 0.05, String(r));

  r = await page.evaluate(() => {
    const F = window.__flug;
    const vor = F.plane.flapStep;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
    const nach = F.plane.flapStep;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }));
    return { vor, nach, zurueck: F.plane.flapStep, grad: F.FLAPS[nach].deg };
  });
  check('F fährt die Klappen aus, G wieder ein',
    r.nach === r.vor + 1 && r.zurueck === r.vor && r.grad === 10, JSON.stringify(r));

  r = await page.evaluate(() => {
    const F = window.__flug;
    const vor = F.game.view;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
    const nach = F.game.view;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
    return { vor, nach, zurueck: F.game.view };
  });
  check('C schaltet zwischen Cockpit und Außensicht',
    r.vor !== r.nach && r.zurueck === r.vor, JSON.stringify(r));

  r = await page.evaluate(() => {
    const F = window.__flug;
    F.game.paused = true;
    F.reset('runway');
    F.stick.active = true; F.stick.x = 0.8; F.stick.y = -0.6;
    // applyKeys ist nicht öffentlich; der Stick wirkt über denselben Weg
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
    const aktiv = F.stick.active;
    F.stick.active = false; F.stick.x = 0; F.stick.y = 0;
    return aktiv;
  });
  check('Der Touch-Steuerknüppel wird erfasst', r === true, String(r));

  // Menü-Optionen merken sich ihre Wahl
  await page.click('#btn-menu');
  await page.click('#opt-start button[data-v="approach"]');
  await page.click('#opt-wind button[data-v="breeze"]');
  r = await page.evaluate(() => ({
    start: window.__flug.game.startMode,
    wind: window.__flug.game.wind,
    gespeichert: [localStorage.getItem('flug_start'), localStorage.getItem('flug_wind')],
    an: !!document.querySelector('#opt-start button[data-v="approach"].on'),
  }));
  check('Startposition und Wind lassen sich wählen und werden gemerkt',
    r.start === 'approach' && r.wind === 'breeze'
    && r.gespeichert.join(',') === 'approach,breeze' && r.an, JSON.stringify(r));

  r = await page.evaluate(() => {
    const F = window.__flug;
    F.game.paused = true;
    F.game.wind = 'breeze';
    F.reset('approach');
    const a = [...F.plane.vel];
    for (let i = 0; i < 400; i++) F.update(1 / 50);
    F.game.wind = 'calm';
    return { bewegt: Math.hypot(F.plane.vel[0] - a[0], F.plane.vel[2] - a[2]) };
  });
  check('Bei böigem Wind wird die Maschine versetzt', r.bewegt > 0.4, JSON.stringify(r));

  await page.click('#btn-menu-close');
  await page.click('#btn-sound');
  r = await page.evaluate(() => [document.getElementById('btn-sound').textContent,
    localStorage.getItem('flug_sound')]);
  check('🔇 schaltet den Ton ab und merkt sich das', r[0] === '🔇' && r[1] === '0', JSON.stringify(r));
  await page.click('#btn-sound');

  await page.click('#btn-rotate');
  r = await page.evaluate(() => document.getElementById('stage').classList.contains('rot'));
  check('⟳ dreht die Bühne ins Querformat', r === true);
  await page.click('#btn-rotate');

  /* ------------------------------------------------------ Darstellung - */
  r = await page.evaluate(() => {
    const F = window.__flug;
    F.game.paused = true;
    F.reset('runway');
    F.game.view = 'chase';
    F.plane.pos = [0, F.RUNWAY.y + 300, 1800];
    for (let i = 0; i < 40; i++) F.cameraFor('chase');
    F.render();
    const c = document.getElementById('scene');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    const px = (x, y) => {
      const b = new Uint8Array(4);
      gl.readPixels(Math.round(x * c.width), Math.round((1 - y) * c.height), 1, 1,
        gl.RGBA, gl.UNSIGNED_BYTE, b);
      return [...b].slice(0, 3);
    };
    return { himmel: px(0.5, 0.12), boden: px(0.5, 0.92) };
  });
  check('Oben ist Himmel, unten Landschaft',
    r.himmel[2] > r.himmel[0] + 25 && r.boden[1] > r.boden[2] + 15, JSON.stringify(r));

  r = await page.evaluate(() => {
    const F = window.__flug;
    F.game.view = 'cockpit';
    F.plane.flapStep = 2;
    F.plane.throttle = 0.7;
    F.drawHUD();
    const c = document.getElementById('hud');
    const g = c.getContext('2d');
    const d = g.getImageData(0, Math.round(c.height * 0.72), c.width, Math.round(c.height * 0.26)).data;
    let hell = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 150 && d[i + 1] > 150) hell++;
    return { hell, px: d.length / 4 };
  });
  check('Das Instrumentenbrett wird gezeichnet', r.hell > 400, JSON.stringify(r));

  /* ------------------------------------------------ Handy-Ablauf ------ */
  // Öffnen, schon im Hilfefenster drehen, starten – und nach einem Bruch
  // per Knopf neu anfangen (eine Taste R gibt es auf dem Handy nicht).
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  phone.on('pageerror', (e) => check('Handy-Seite ohne JS-Fehler', false, e.message));
  await phone.goto(srv.url + '/flug.html');
  await phone.waitForFunction(() => window.__flug, null, { timeout: 30000 });
  await phone.tap('#btn-rotate', { timeout: 4000 }).catch(() => {});
  r = await phone.evaluate(() => document.getElementById('stage').classList.contains('rot'));
  check('⟳ lässt sich schon im Hilfefenster antippen', r === true);
  await phone.tap('#btn-start');
  await phone.waitForTimeout(1800);
  r = await phone.evaluate(() => ({
    state: window.__flug.game.state,
    knopf: !document.getElementById('btn-again').classList.contains('hidden'),
  }));
  check('Nach dem Start steht die Cessna bereit statt „gelandet“',
    r.state === 'fly' && !r.knopf, JSON.stringify(r));
  await phone.evaluate(() => window.__flug.crash('Test'));
  await phone.waitForTimeout(150);
  r = await phone.evaluate(() => !document.getElementById('btn-again').classList.contains('hidden'));
  check('Nach einem Bruch erscheint „Neuer Versuch“', r === true);
  await phone.tap('#btn-again');
  await phone.waitForTimeout(600);
  r = await phone.evaluate(() => ({
    state: window.__flug.game.state,
    knopf: !document.getElementById('btn-again').classList.contains('hidden'),
  }));
  check('Ein Tipp darauf startet den nächsten Flug', r.state === 'fly' && !r.knopf, JSON.stringify(r));
  await phone.close();

  /* ----------------------------------------------------- Einbindung --- */
  r = await page.evaluate(() => ({
    nav: !!document.querySelector('.game-nav a[href="flug.html"].active'),
    gruppe: document.querySelector('.game-nav a[href="flug.html"]')
      ?.closest('.nav-group')?.querySelector('.ng-title')?.textContent.trim(),
    links: document.querySelectorAll('.game-nav a').length,
  }));
  check('Die Spiel-Navigation führt den Flugsimulator unter Simulation',
    r.nav && /Simulation/.test(r.gruppe || '') && r.links >= 15, JSON.stringify(r));

  const land = await browser.newPage({ viewport: { width: 420, height: 800 } });
  land.on('pageerror', (e) => check('Landing-Page ohne JS-Fehler', false, e.message));
  await land.goto(srv.url + '/index.html');
  r = await land.evaluate(() => {
    const card = document.querySelector('.game-card[href="flug.html"]');
    return { da: !!card, gruppe: card?.closest('.game-group')?.querySelector('.gg-title')?.textContent.trim() };
  });
  check('Die Landing-Page hat eine Kachel in der Gruppe Simulation',
    r.da && /Simulation/.test(r.gruppe || ''), JSON.stringify(r));

  r = await land.evaluate(async () => {
    localStorage.setItem('flug_best', '87');
    localStorage.setItem('flug_landungen', '4');
    const { Scores } = await import('./js/lib.js');
    const g = Scores.summary().flug;
    return { title: g && g.title, entries: g && g.entries.map((e) => `${e.label} ${e.value}`) };
  });
  check('Die Rekorde erscheinen in der Highscore-Übersicht',
    r.title && r.title.includes('Flug') && r.entries.join(' ').includes('87'), JSON.stringify(r));
  await land.close();
} finally {
  await browser.close();
  srv.stop();
}

process.exit(summary() ? 1 : 0);
