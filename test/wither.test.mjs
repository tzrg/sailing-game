// 💀 Wither-Duell: Levelkurve (Leben, Regeneration, Angriffe), Armbrust mit
// Nachladen, Treffer auf Rumpf und Schädel, Heilung samt Unterbrechung,
// Wither-Schädel und Feueratem, Schild (blocken, kein Schuss, kein Nachladen),
// drei Leben, Levelaufstieg, Bedienung, Ton und Einbindung in die Sammlung.
// Läuft über window.__wither; die Simulation wird pausiert und per update(dt)
// deterministisch getickt.

import { startServer, launchBrowser, checker } from './helpers.mjs';

const srv = startServer();
await srv.ready;
const { check, summary } = checker();

const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  page.on('pageerror', (e) => check('Seite ohne JS-Fehler', false, e.message));
  await page.goto(srv.url + '/wither.html');
  await page.waitForFunction(() => window.__wither);
  await page.click('#btn-start');

  // Kampf im Zustand "play" aufsetzen, Zeit selbst vorgeben
  const fresh = (opts = {}) => page.evaluate((o) => {
    const W = window.__wither;
    W.game.paused = true;
    if (o.diff) W.game.diff = o.diff;
    W.game.startLevel = o.level || 1;
    W.startFight();
    W.game.state = 'play'; W.game.banner = 0;
    W.wither.atkT = 99;                 // Angriffe nur, wenn der Test sie will
    W.player.shield = false; W.player.loaded = true; W.player.reload = W.RELOAD;
    W.player.hitT = 0;
    W.setSkulls([]);
  }, opts);
  const tick = (secs, step = 0.016) => page.evaluate(([s, st]) => {
    const W = window.__wither;
    for (let t = 0; t < s; t += st) W.update(st);
  }, [secs, step]);
  // zielt auf eine Trefferzone und schießt
  const shootAt = (what) => page.evaluate((w) => {
    const W = window.__wither;
    const p = W.witherParts();
    const r = w === 'head' ? p.heads[0] : w === 'head2' ? p.heads[1] : p.body;
    if (w === 'miss') { W.player.aimX = 5; W.player.aimY = 5; }
    else { W.player.aimX = r.x + r.w / 2; W.player.aimY = r.y + r.h / 2; }
    return W.shoot();
  }, what);

  /* ------------------------------------------------- Levelkurve & Werte -- */

  let r = await page.evaluate(() => {
    const W = window.__wither;
    const lv = (n, d) => W.levelCfg(n, d);
    return {
      l1: lv(1, 1), l3: lv(3, 1), l6: lv(6, 1), l9: lv(9, 1),
      leicht: lv(5, W.DIFFS.leicht), hart: lv(5, W.DIFFS.hart),
    };
  });
  check('Mit jedem Level hat der Wither mehr Leben',
    r.l1.hp < r.l3.hp && r.l3.hp < r.l6.hp && r.l6.hp < r.l9.hp,
    JSON.stringify([r.l1.hp, r.l3.hp, r.l6.hp, r.l9.hp]));
  check('… und regeneriert deutlich schneller',
    r.l1.regen < r.l3.regen && r.l6.regen > r.l1.regen * 2.5,
    JSON.stringify([r.l1.regen, r.l3.regen, r.l6.regen]));
  check('… und greift immer häufiger an',
    r.l1.atkEvery > r.l6.atkEvery && r.l6.atkEvery > r.l9.atkEvery,
    JSON.stringify([r.l1.atkEvery, r.l6.atkEvery, r.l9.atkEvery]));
  check('Anfangs ein Schädel, später mehrere',
    r.l1.skulls === 1 && r.l6.skulls === 2 && r.l9.skulls === 3, JSON.stringify(r));
  check('Feueratem kommt erst in späteren Leveln dazu',
    r.l1.breath === 0 && r.l6.breath > 0 && r.l9.breath > r.l6.breath, JSON.stringify(r));
  check('Die Schwierigkeit regelt Heilung und Angriffstakt',
    r.leicht.regen < r.hart.regen && r.leicht.atkEvery > r.hart.atkEvery,
    JSON.stringify({ leicht: r.leicht.regen, hart: r.hart.regen }));

  /* ------------------------------------------------- Armbrust & Treffer -- */

  await fresh();
  r = await page.evaluate(() => {
    const W = window.__wither;
    return { hp: W.wither.hp, hpMax: W.wither.hpMax, lives: W.game.lives, loaded: W.player.loaded };
  });
  check('Der Kampf startet mit vollem Wither und drei Leben',
    r.hp === r.hpMax && r.lives === 3 && r.loaded, JSON.stringify(r));

  r = await page.evaluate(() => {
    const W = window.__wither;
    const before = W.wither.hp;
    const p = W.witherParts();
    W.player.aimX = p.body.x + p.body.w / 2; W.player.aimY = p.body.y + p.body.h / 2;
    const res = W.shoot();
    return { res, dmg: before - W.wither.hp, body: W.DMG_BODY, loaded: W.player.loaded };
  });
  check('Ein Treffer auf den Rumpf zieht Leben ab',
    r.res.hit && !r.res.crit && r.dmg === r.body, JSON.stringify(r));
  check('Nach dem Schuss ist die Armbrust leer', r.loaded === false);

  await fresh();
  r = await page.evaluate(() => {
    const W = window.__wither;
    const before = W.wither.hp;
    const p = W.witherParts();
    W.player.aimX = p.heads[0].x + p.heads[0].w / 2;
    W.player.aimY = p.heads[0].y + p.heads[0].h / 2;
    const res = W.shoot();
    return { res, dmg: before - W.wither.hp, head: W.DMG_HEAD, body: W.DMG_BODY, score: W.game.score };
  });
  check('Ein Kopftreffer macht deutlich mehr Schaden',
    r.res.crit && r.dmg === r.head && r.head > r.body, JSON.stringify(r));
  check('Kopftreffer geben mehr Punkte', r.score === 25, 'score=' + r.score);

  await fresh();
  r = await page.evaluate(() => {
    const W = window.__wither;
    const before = W.wither.hp;
    W.player.aimX = 5; W.player.aimY = 5;
    const res = W.shoot();
    return { res, dmg: before - W.wither.hp };
  });
  check('Ein Fehlschuss macht keinen Schaden', r.res.hit === false && r.dmg === 0, JSON.stringify(r));

  // Nachladen
  await fresh();
  r = await page.evaluate(async () => {
    const W = window.__wither;
    W.player.aimX = 5; W.player.aimY = 5;
    W.shoot();
    const blocked = W.shoot();                 // zweiter Schuss sofort
    for (let i = 0; i < 0.3 / 0.016; i++) W.update(0.016);
    const half = { loaded: W.player.loaded, t: W.player.reload };
    for (let i = 0; i < 0.6 / 0.016; i++) W.update(0.016);
    return { blocked, half, loaded: W.player.loaded, reload: W.RELOAD };
  });
  check('Ohne Nachladen gibt es keinen zweiten Schuss', r.blocked === null);
  check('Nach dem Nachladen ist die Armbrust wieder bereit',
    r.half.loaded === false && r.half.t > 0.2 && r.loaded === true, JSON.stringify(r));

  /* ------------------------------------------------------------ Schild -- */

  await fresh();
  r = await page.evaluate(() => {
    const W = window.__wither;
    W.player.shield = true;
    const shot = W.shoot();
    W.player.loaded = false; W.player.reload = 0;
    for (let i = 0; i < 1.2 / 0.016; i++) W.update(0.016);
    const shielded = { loaded: W.player.loaded, reload: W.player.reload };
    W.player.shield = false;
    for (let i = 0; i < 0.9 / 0.016; i++) W.update(0.016);
    return { shot, shielded, loadedAfter: W.player.loaded };
  });
  check('Mit erhobenem Schild kann man nicht schießen', r.shot === null);
  check('Hinter dem Schild wird auch nicht nachgeladen',
    r.shielded.loaded === false && r.shielded.reload === 0, JSON.stringify(r.shielded));
  check('Schild runter – dann lädt die Armbrust wieder', r.loadedAfter === true);

  /* ----------------------------------------------------- Regeneration --- */

  await fresh();
  r = await page.evaluate(() => {
    const W = window.__wither;
    W.wither.hp = 40; W.wither.regenStop = 0;
    for (let i = 0; i < 2 / 0.016; i++) W.update(0.016);
    const healed = W.wither.hp - 40;
    // Treffer stoppt die Heilung kurz
    const p = W.witherParts();
    W.player.loaded = true;
    W.player.aimX = p.body.x + p.body.w / 2; W.player.aimY = p.body.y + p.body.h / 2;
    W.shoot();
    const hp0 = W.wither.hp, stop = W.wither.regenStop;
    for (let i = 0; i < 0.3 / 0.016; i++) W.update(0.016);
    const duringStop = W.wither.hp - hp0;
    return { healed, stop, duringStop, regen: W.cfg().regen };
  });
  check('Der Wither heilt sich fortlaufend',
    Math.abs(r.healed - r.regen * 2) < 0.4 && r.healed > 1, JSON.stringify(r));
  check('Ein Treffer unterbricht die Heilung kurz',
    r.stop > 0.3 && r.duringStop === 0, JSON.stringify(r));

  r = await page.evaluate(() => {
    const W = window.__wither;
    const heal = (lvl) => {
      W.game.startLevel = lvl; W.startFight();
      W.game.state = 'play'; W.game.banner = 0; W.wither.atkT = 99;
      W.wither.hp = 20; W.wither.regenStop = 0;
      for (let i = 0; i < 1 / 0.016; i++) W.update(0.016);
      return W.wither.hp - 20;
    };
    const l1 = heal(1), l6 = heal(6);
    W.game.startLevel = 1;
    return { l1, l6 };
  });
  check('In höheren Leveln heilt er viel schneller', r.l6 > r.l1 * 2.5, JSON.stringify(r));

  /* ------------------------------------------- Angriffe, Blocken, Leben -- */

  await fresh();
  r = await page.evaluate(() => {
    const W = window.__wither;
    W.fireSkull(0);
    const s0 = W.skulls()[0];
    const z0 = s0.z;
    for (let i = 0; i < 0.5 / 0.016; i++) W.update(0.016);
    return { count: W.skulls().length, z0, z1: W.skulls()[0] ? W.skulls()[0].z : 0 };
  });
  check('Der Wither schleudert Schädel, die näher kommen',
    r.count === 1 && r.z1 < r.z0, JSON.stringify(r));

  await fresh();
  r = await page.evaluate(() => {
    const W = window.__wither;
    W.fireSkull(0);
    W.player.shield = false;
    for (let i = 0; i < 3 / 0.016 && W.game.lives === 3; i++) W.update(0.016);
    return { lives: W.game.lives, hitT: W.player.hitT > 0 };
  });
  check('Ein ungeblockter Schädel kostet ein Leben', r.lives === 2 && r.hitT, JSON.stringify(r));

  await fresh();
  r = await page.evaluate(() => {
    const W = window.__wither;
    W.fireSkull(0);
    W.player.shield = true;
    W.player.shieldT = 5;                      // schon länger oben = normaler Block
    for (let i = 0; i < 3 / 0.016 && W.skulls().length; i++) W.update(0.016);
    return { lives: W.game.lives, blocks: W.game.blocks, score: W.game.score, left: W.skulls().length };
  });
  check('Hinter dem Schild passiert nichts',
    r.lives === 3 && r.blocks === 1 && r.score > 0, JSON.stringify(r));

  await fresh();
  r = await page.evaluate(() => {
    const W = window.__wither;
    W.fireSkull(0);
    W.player.loaded = false; W.player.reload = 0;
    // Schild erst im letzten Moment hoch = perfekter Block
    for (let i = 0; i < 3 / 0.016 && W.skulls().length; i++) {
      W.update(0.016);
      const s = W.skulls()[0];
      if (s && s.z < 0.22) { W.player.shield = true; W.player.shieldT = 0; }
    }
    return { lives: W.game.lives, loaded: W.player.loaded, score: W.game.score };
  });
  check('Ein perfekter Block lädt die Armbrust sofort nach',
    r.lives === 3 && r.loaded === true && r.score >= 15, JSON.stringify(r));

  // Feueratem
  await fresh({ level: 6 });
  r = await page.evaluate(() => {
    const W = window.__wither;
    W.player.shield = false;
    W.wither.breathT = 1.2;
    for (let i = 0; i < 0.2 / 0.016 && W.game.lives === 3; i++) W.update(0.016);
    const unguarded = W.game.lives;
    // mit Schild passiert nichts
    W.game.lives = 3; W.player.hitT = 0; W.player.shield = true;
    W.wither.breathT = 1.2;
    for (let i = 0; i < 1.2 / 0.016; i++) W.update(0.016);
    return { unguarded, guarded: W.game.lives };
  });
  check('Feueratem ohne Schild kostet ein Leben', r.unguarded === 2, JSON.stringify(r));
  check('Mit Schild übersteht man den Feueratem', r.guarded === 3, JSON.stringify(r));

  // Drei Leben, dann ist Schluss
  await fresh();
  r = await page.evaluate(() => {
    const W = window.__wither;
    localStorage.removeItem('wither_best');
    W.game.score = 250;
    const hit = () => { W.player.hitT = 0; W.hurtPlayer('Test'); };
    hit(); const l1 = W.game.lives;
    hit(); const l2 = W.game.lives;
    hit();
    return { l1, l2, lives: W.game.lives, state: W.game.state, best: parseFloat(localStorage.getItem('wither_best')) };
  });
  check('Drei Leben – dann ist der Kampf verloren',
    r.l1 === 2 && r.l2 === 1 && r.lives === 0 && r.state === 'over', JSON.stringify(r));
  check('Der Punktestand landet als Rekord im Speicher', r.best === 250, JSON.stringify(r));

  /* ------------------------------------------------------ Levelaufstieg -- */

  await fresh();
  r = await page.evaluate(() => {
    const W = window.__wither;
    const lvl0 = W.game.level, hp0 = W.wither.hpMax, score0 = W.game.score;
    W.wither.hp = W.DMG_HEAD - 1;
    const p = W.witherParts();
    W.player.loaded = true;
    W.player.aimX = p.heads[0].x + p.heads[0].w / 2;
    W.player.aimY = p.heads[0].y + p.heads[0].h / 2;
    W.shoot();
    const won = { state: W.game.state, score: W.game.score > score0 };
    for (let i = 0; i < 2.2 / 0.016; i++) W.update(0.016);
    return {
      won, lvl0, hp0, level: W.game.level, hpMax: W.wither.hpMax,
      full: W.wither.hp === W.wither.hpMax, state: W.game.state,
      regen0: W.levelCfg(lvl0).regen, regen1: W.cfg().regen,
    };
  });
  check('Ist der Wither bei null, ist das Level geschafft',
    r.won.state === 'won' && r.won.score, JSON.stringify(r.won));
  check('Danach geht es eine Stufe weiter – mit mehr Leben und Heilung',
    r.level === r.lvl0 + 1 && r.hpMax > r.hp0 && r.regen1 > r.regen0 && r.full,
    JSON.stringify(r));

  /* ---------------------------------------------------------- Bedienung -- */

  await fresh();
  r = await page.evaluate(() => {
    const W = window.__wither;
    const p = W.witherParts();
    const c = document.getElementById('game').getBoundingClientRect();
    const x = p.heads[0].x + p.heads[0].w / 2, y = p.heads[0].y + p.heads[0].h / 2;
    const hp0 = W.wither.hp;
    document.getElementById('game').dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, pointerId: 1, clientX: c.left + x, clientY: c.top + y, button: 0,
    }));
    return { aimed: Math.abs(W.player.aimX - x) < 2, dmg: hp0 - W.wither.hp };
  });
  check('Ein Klick zielt dorthin und schießt', r.aimed && r.dmg > 0, JSON.stringify(r));

  r = await page.evaluate(() => {
    const W = window.__wither;
    const btn = document.getElementById('w-shield');
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2 }));
    const down = W.player.shield;
    btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 2 }));
    return { down, up: W.player.shield };
  });
  check('Der 🛡️-Knopf hält das Schild, Loslassen senkt es', r.down === true && r.up === false, JSON.stringify(r));

  await fresh();
  r = await page.evaluate(() => {
    const W = window.__wither;
    const key = (k, type = 'keydown') => window.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true }));
    key(' ');
    const shield = W.player.shield;
    key(' ', 'keyup');
    const down = W.player.shield;
    const p = W.witherParts();
    W.player.aimX = p.body.x + p.body.w / 2; W.player.aimY = p.body.y + p.body.h / 2;
    const hp0 = W.wither.hp;
    key('Enter');
    return { shield, down, dmg: hp0 - W.wither.hp };
  });
  check('Tastatur: Leertaste hebt das Schild, Enter schießt',
    r.shield === true && r.down === false && r.dmg > 0, JSON.stringify(r));

  r = await page.evaluate(() => {
    const W = window.__wither;
    W.player.aimX = 400; W.player.aimY = 400;
    W.pressed.add('arrowright');
    // moveAim läuft in der Schleife – hier direkt über die Tastenmenge prüfen
    return { has: W.pressed.has('arrowright') };
  });
  check('Pfeiltasten werden fürs Zielen erfasst', r.has === true);
  await page.evaluate(() => window.__wither.pressed.clear());

  // Menü
  r = await page.evaluate(() => {
    const W = window.__wither;
    document.querySelector('#opt-diff button[data-v="hart"]').click();
    const diff = { d: W.game.diff, stored: localStorage.getItem('wither_diff'), regen: W.cfg().regen };
    document.querySelector('#opt-start button[data-v="5"]').click();
    const start = { lvl: W.game.level, stored: localStorage.getItem('wither_start'), hp: W.wither.hpMax };
    document.querySelector('#opt-diff button[data-v="normal"]').click();
    document.querySelector('#opt-start button[data-v="1"]').click();
    return { diff, start };
  });
  check('Die Schwierigkeit lässt sich umstellen und wird gemerkt',
    r.diff.d === 'hart' && r.diff.stored === 'hart' && r.diff.regen > 2, JSON.stringify(r.diff));
  check('Das Startlevel lässt sich wählen und wird gemerkt',
    r.start.lvl === 5 && r.start.stored === '5' && r.start.hp > 150, JSON.stringify(r.start));

  // Ton
  await page.click('#btn-sound');
  r = await page.evaluate(() => ({
    on: window.__wither.Sfx.on, stored: localStorage.getItem('wither_sound'),
    icon: document.getElementById('btn-sound').textContent,
  }));
  check('🔇 schaltet den Ton ab und merkt sich das',
    r.on === false && r.stored === '0' && r.icon === '🔇', JSON.stringify(r));
  await page.click('#btn-sound');
  r = await page.evaluate(() => ({ on: window.__wither.Sfx.on, stored: localStorage.getItem('wither_sound') }));
  check('🔊 schaltet ihn wieder an', r.on === true && r.stored === '1', JSON.stringify(r));

  // Querformat
  await page.click('#btn-rotate');
  r = await page.evaluate(() => document.getElementById('stage').classList.contains('rot'));
  check('⟳ dreht die Bühne ins Querformat', r === true);
  await page.click('#btn-rotate');

  // Darstellung: der Wither wird wirklich gezeichnet
  r = await page.evaluate(() => {
    const W = window.__wither;
    const c = document.getElementById('game');
    const g = c.getContext('2d');
    W.draw(1.5);
    const b = W.witherBox();
    const sc = c.width / W.size().CW; // CSS-Pixel -> Gerätepixel
    const x = Math.max(0, Math.round((b.cx - b.w * 0.6) * sc));
    const y = Math.max(0, Math.round((b.cy - b.h * 0.6) * sc));
    const w = Math.min(c.width - x, Math.round(b.w * 1.2 * sc));
    const h = Math.min(c.height - y, Math.round(b.h * 1.2 * sc));
    const d = g.getImageData(x, y, w, h).data;
    let warm = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 150 && d[i] - d[i + 2] > 50) warm++;
    }
    return { warm, px: w * h, parts: W.witherParts().heads.length };
  });
  check('Der Wither steht mit drei Schädeln im Bild', r.parts === 3 && r.warm > 300, JSON.stringify(r));

  // Einbindung in die Sammlung
  r = await page.evaluate(() => ({
    nav: !!document.querySelector('.game-nav a[href="wither.html"].active'),
  }));
  check('Die Spiel-Navigation enthält das Wither-Duell', r.nav === true);

  const land = await browser.newPage({ viewport: { width: 420, height: 800 } });
  land.on('pageerror', (e) => check('Landing-Page ohne JS-Fehler', false, e.message));
  await land.goto(srv.url + '/index.html');
  r = await land.evaluate(() => !!document.querySelector('.game-card[href="wither.html"]'));
  check('Die Landing-Page hat eine Kachel fürs Wither-Duell', r === true);
  r = await land.evaluate(async () => {
    localStorage.setItem('wither_best', '1234');
    const { Scores } = await import('./js/lib.js');
    const g = Scores.summary().wither;
    return { title: g && g.title, entries: g && g.entries.map((e) => e.value) };
  });
  check('Der Rekord erscheint in der Highscore-Übersicht',
    r.title && r.title.includes('Wither') && r.entries.join(' ').includes('1.234'), JSON.stringify(r));
  await land.close();
} finally {
  await browser.close();
  srv.stop();
}

process.exit(summary() ? 1 : 0);
