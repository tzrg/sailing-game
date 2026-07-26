// Tower Defense – Monster laufen den Parcours entlang, Türme halten sie auf.
// Sechs Turmtypen mit je drei Stufen, Geld pro Abschuss, endlose Wellen.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const TAU = Math.PI * 2;

// ---- Spielfeld & Parcours --------------------------------------------------
const GC = 12, GR = 17;   // Spalten x Zeilen
// Wegpunkte (Spalte, Zeile) – Schlangenlinie von links oben nach rechts unten
const WAYPOINTS = [[0, 2], [9, 2], [9, 5], [2, 5], [2, 8], [9, 8], [9, 11], [2, 11], [2, 14], [11, 14]];
let PATH = [];            // Liste aller Pfadkacheln in Laufrichtung
const pathSet = new Set();
(function buildPath() {
  for (let i = 0; i < WAYPOINTS.length - 1; i++) {
    let [x, y] = WAYPOINTS[i];
    const [tx, ty] = WAYPOINTS[i + 1];
    while (x !== tx || y !== ty) {
      if (!PATH.length || PATH[PATH.length - 1][0] !== x || PATH[PATH.length - 1][1] !== y) PATH.push([x, y]);
      x += Math.sign(tx - x); y += Math.sign(ty - y);
    }
  }
  PATH.push(WAYPOINTS[WAYPOINTS.length - 1]);
  for (const [x, y] of PATH) pathSet.add(x + ',' + y);
})();
const isPath = (x, y) => pathSet.has(x + ',' + y);

// ---- Türme -----------------------------------------------------------------
// levels[i]: cost = Kosten für Bau (i=0) bzw. Upgrade. dmg/rate für Schüsse,
// dps für Dauerstrahler, slow für Aura. range in Kacheln.
const TOWERS = {
  mg: { name: 'MG', icon: '🔫', color: '#8fa3b8', desc: 'schnell, Einzelziel',
    levels: [
      { cost: 45, dmg: 7, rate: 4.5, range: 2.4 },
      { cost: 55, dmg: 13, rate: 5.5, range: 2.6 },
      { cost: 100, dmg: 24, rate: 6.5, range: 2.9 }] },
  grenade: { name: 'Granatkanone', icon: '💣', color: '#c9a15a', desc: 'Flächenschaden',
    levels: [
      { cost: 80, dmg: 26, rate: 0.9, range: 2.6, splash: 1.15 },
      { cost: 90, dmg: 48, rate: 1.0, range: 2.9, splash: 1.3 },
      { cost: 160, dmg: 90, rate: 1.15, range: 3.2, splash: 1.5 }] },
  laser: { name: 'Laser', icon: '📡', color: '#e06fd8', desc: 'durchbohrt alles in einer Linie',
    levels: [
      { cost: 110, dps: 24, range: 3.4 },
      { cost: 120, dps: 46, range: 3.7 },
      { cost: 210, dps: 85, range: 4.0 }] },
  flame: { name: 'Flammenwerfer', icon: '🔥', color: '#e0703a', desc: 'Umkreis + Brennschaden',
    levels: [
      { cost: 85, dps: 24, range: 1.9, burn: 7 },
      { cost: 95, dps: 44, range: 2.1, burn: 13 },
      { cost: 170, dps: 80, range: 2.3, burn: 24 }] },
  rocket: { name: 'Raketenturm', icon: '🚀', color: '#b04a4a', desc: 'zielsuchend, hoher Schaden',
    levels: [
      { cost: 130, dmg: 60, rate: 0.55, range: 3.6, splash: 0.9 },
      { cost: 140, dmg: 110, rate: 0.62, range: 3.9, splash: 1.05 },
      { cost: 240, dmg: 200, rate: 0.7, range: 4.2, splash: 1.2 }] },
  ice: { name: 'Vereiser', icon: '❄️', color: '#6fc4e0', desc: 'verlangsamt im Umkreis',
    levels: [
      { cost: 55, slow: 0.35, range: 2.1 },
      { cost: 60, slow: 0.45, range: 2.4 },
      { cost: 110, slow: 0.55, range: 2.8 }] },
};

// ---- Zustand ---------------------------------------------------------------
const game = {
  money: 120, lives: 20, wave: 0, best: 0,
  state: 'build',       // build | wave | over
  speed: 1, nextT: 0,   // Countdown bis Auto-Start der nächsten Welle
  toSpawn: [], spawnT: 0,
  sel: null,            // gewählte Kachel {x,y}
  banner: '', bannerT: 0,
};
let towers = [];        // {type,lvl,x,y,cd,angle,target}
let enemies = [];       // {type,hp,maxHp,speed,pathI,frac,x,y,slowT,slowF,burnT,burnDps,bounty,boss}
let shots = [];         // Projektile/Effekte
let towerAt = {};       // "x,y" -> tower

function newGame() {
  game.money = 120; game.lives = 20; game.wave = 0;
  game.state = 'build'; game.speed = 1; game.nextT = 0;
  game.toSpawn = []; game.sel = null; game.banner = ''; game.bannerT = 0;
  towers = []; enemies = []; shots = []; towerAt = {};
  updateSpeedBtn();
  hidePanels();
}

// ---- Wellen ----------------------------------------------------------------
function baseHp(w) { return 30 * Math.pow(1.16, w - 1) + 9 * (w - 1); }
function bounty(w, mult) { return Math.round((3 + w * 0.55) * mult); }

function buildWave(w) {
  const list = [];
  const n = Math.min(10 + Math.round(w * 1.6), 34);
  const boss = w % 8 === 0;
  for (let i = 0; i < n; i++) {
    let t = 'blob';
    if (w >= 3 && i % 3 === 2) t = 'runner';
    if (w >= 5 && i % 4 === 3) t = 'tank';
    if (w >= 8 && i % 5 === 4) t = 'regen';
    list.push(t);
  }
  if (boss) list.push('boss');
  return list;
}

const ETYPES = {
  blob: { hp: 1.0, speed: 1.5, mult: 1.0, color: '#7dc95e', r: 0.28 },
  runner: { hp: 0.6, speed: 2.6, mult: 1.1, color: '#e0d05a', r: 0.24 },
  tank: { hp: 3.2, speed: 0.95, mult: 2.5, color: '#8a6fb8', r: 0.34 },
  regen: { hp: 1.7, speed: 1.2, mult: 1.8, color: '#5ac9a8', r: 0.3, regen: 0.02 },
  boss: { hp: 15, speed: 0.55, mult: 12, color: '#d84a6a', r: 0.44, boss: true },
};

function startWave() {
  if (game.state === 'over') return;
  if (game.state === 'wave') return;
  // Frühstart-Bonus, wenn der Countdown noch lief
  if (game.wave > 0 && game.nextT > 0) game.money += Math.round(game.nextT * 2);
  game.wave++;
  game.toSpawn = buildWave(game.wave);
  game.spawnT = 0;
  game.state = 'wave';
  game.banner = 'Welle ' + game.wave; game.bannerT = 1.4;
}

function spawnEnemy(type) {
  const t = ETYPES[type];
  const hp = baseHp(game.wave) * t.hp;
  const [sx, sy] = PATH[0];
  enemies.push({
    type, hp, maxHp: hp, speed: t.speed, pathI: 0, frac: 0,
    x: sx + 0.5, y: sy + 0.5, slowT: 0, slowF: 0, burnT: 0, burnDps: 0,
    bounty: bounty(game.wave, t.mult), boss: !!t.boss, regen: t.regen || 0,
    r: t.r, color: t.color, wob: Math.random() * TAU,
  });
}

// Position/Fortschritt eines Gegners auf dem Pfad
function progress(e) { return e.pathI + e.frac; }

function stepEnemy(e, dt) {
  if (e.slowT > 0) e.slowT -= dt; else e.slowF = 0;
  if (e.burnT > 0) { e.burnT -= dt; e.hp -= e.burnDps * dt; }
  if (e.regen) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * e.regen * dt);
  const spd = e.speed * (1 - e.slowF);
  e.frac += spd * dt;
  while (e.frac >= 1) {
    e.frac -= 1; e.pathI++;
    if (e.pathI >= PATH.length - 1) { e.escaped = true; return; }
  }
  const [ax, ay] = PATH[e.pathI], [bx, by] = PATH[Math.min(e.pathI + 1, PATH.length - 1)];
  e.x = ax + 0.5 + (bx - ax) * e.frac;
  e.y = ay + 0.5 + (by - ay) * e.frac;
}

function damage(e, amt) {
  e.hp -= amt;
}

// ---- Türme: Zielwahl & Feuern ----------------------------------------------
function firstInRange(t, range) {
  let best = null, bp = -1;
  for (const e of enemies) {
    if (e.dead || e.escaped) continue;
    const d = Math.hypot(e.x - (t.x + 0.5), e.y - (t.y + 0.5));
    if (d <= range && progress(e) > bp) { bp = progress(e); best = e; }
  }
  return best;
}

function towerStats(t) { return TOWERS[t.type].levels[t.lvl]; }

function stepTower(t, dt) {
  const s = towerStats(t);
  const cx = t.x + 0.5, cy = t.y + 0.5;

  if (t.type === 'ice') {
    // Aura: alle im Umkreis verlangsamen
    for (const e of enemies) {
      if (e.dead || e.escaped) continue;
      if (Math.hypot(e.x - cx, e.y - cy) <= s.range) { e.slowF = Math.max(e.slowF, s.slow); e.slowT = 0.35; }
    }
    t.pulse = (t.pulse || 0) + dt;
    return;
  }

  if (t.type === 'laser') {
    const target = firstInRange(t, s.range);
    t.target = target;
    if (!target) return;
    t.angle = Math.atan2(target.y - cy, target.x - cx);
    // Strahl durch das Ziel hindurch: alle nahe der Linie treffen
    const len = s.range * 1.7;
    const dx = Math.cos(t.angle), dy = Math.sin(t.angle);
    for (const e of enemies) {
      if (e.dead || e.escaped) continue;
      const px = e.x - cx, py = e.y - cy;
      const along = px * dx + py * dy;
      if (along < 0 || along > len) continue;
      const dist = Math.abs(px * dy - py * dx);
      if (dist < 0.38 + e.r * 0.5) damage(e, s.dps * dt);
    }
    return;
  }

  if (t.type === 'flame') {
    let any = false;
    for (const e of enemies) {
      if (e.dead || e.escaped) continue;
      if (Math.hypot(e.x - cx, e.y - cy) <= s.range) {
        damage(e, s.dps * dt);
        e.burnT = Math.max(e.burnT, 2.5); e.burnDps = Math.max(e.burnDps, s.burn);
        any = true;
      }
    }
    t.firing = any;
    t.pulse = (t.pulse || 0) + dt;
    return;
  }

  // Schuss-Türme (mg, grenade, rocket)
  t.cd -= dt;
  const target = firstInRange(t, s.range);
  if (target) t.angle = Math.atan2(target.y - cy, target.x - cx);
  if (t.cd > 0 || !target) return;
  t.cd = 1 / s.rate;

  if (t.type === 'mg') {
    damage(target, s.dmg);
    shots.push({ kind: 'tracer', x1: cx, y1: cy, x2: target.x, y2: target.y, t: 0, ttl: 0.07 });
  } else if (t.type === 'grenade') {
    shots.push({ kind: 'lob', x: cx, y: cy, sx: cx, sy: cy, tx: target.x, ty: target.y, t: 0, ttl: 0.45, dmg: s.dmg, splash: s.splash });
  } else if (t.type === 'rocket') {
    shots.push({ kind: 'rocket', x: cx, y: cy, target, speed: 7, dmg: s.dmg, splash: s.splash, angle: t.angle });
  }
}

function splashDamage(x, y, radius, dmg) {
  for (const e of enemies) {
    if (e.dead || e.escaped) continue;
    const d = Math.hypot(e.x - x, e.y - y);
    if (d <= radius + e.r) damage(e, dmg * clamp(1 - d / (radius + e.r) * 0.5, 0.5, 1));
  }
  shots.push({ kind: 'boom', x, y, r: radius, t: 0, ttl: 0.3 });
}

function stepShot(sh, dt) {
  sh.t = (sh.t || 0) + dt;
  if (sh.kind === 'tracer' || sh.kind === 'boom') return sh.t >= sh.ttl;
  if (sh.kind === 'lob') {
    const f = clamp(sh.t / sh.ttl, 0, 1);
    sh.x = sh.sx + (sh.tx - sh.sx) * f;
    sh.y = sh.sy + (sh.ty - sh.sy) * f - Math.sin(f * Math.PI) * 1.2;
    if (f >= 1) { splashDamage(sh.tx, sh.ty, sh.splash, sh.dmg); return true; }
    return false;
  }
  if (sh.kind === 'rocket') {
    const tg = sh.target;
    if (!tg || tg.dead || tg.escaped) {
      // weiterfliegen und am letzten Kurs verpuffen
      sh.x += Math.cos(sh.angle) * sh.speed * dt;
      sh.y += Math.sin(sh.angle) * sh.speed * dt;
      if (sh.t > 1.6) { splashDamage(sh.x, sh.y, sh.splash, sh.dmg * 0.5); return true; }
      return false;
    }
    sh.angle = Math.atan2(tg.y - sh.y, tg.x - sh.x);
    sh.x += Math.cos(sh.angle) * sh.speed * dt;
    sh.y += Math.sin(sh.angle) * sh.speed * dt;
    if (Math.hypot(tg.x - sh.x, tg.y - sh.y) < 0.3) { splashDamage(tg.x, tg.y, sh.splash, sh.dmg); return true; }
    return false;
  }
  return true;
}

// ---- Update ----------------------------------------------------------------
function update(dt) {
  if (game.state === 'over') return;
  if (game.bannerT > 0) game.bannerT -= dt;

  // Auto-Countdown zwischen Wellen
  if (game.state === 'build' && game.wave > 0) {
    game.nextT -= dt;
    if (game.nextT <= 0) startWave();
  }

  if (game.state === 'wave') {
    // Nachschub
    if (game.toSpawn.length) {
      game.spawnT -= dt;
      if (game.spawnT <= 0) {
        spawnEnemy(game.toSpawn.shift());
        // mit steigender Welle rückt der Nachschub dichter auf
        const base = Math.max(0.45, 0.78 - game.wave * 0.012);
        game.spawnT = game.toSpawn.length && game.toSpawn[0] === 'runner' ? base * 0.7 : base;
      }
    }
  }

  // Gegner
  for (const e of enemies) {
    if (e.dead || e.escaped) continue;
    stepEnemy(e, dt);
    if (e.escaped) {
      game.lives -= e.boss ? 5 : 1;
      if (game.lives <= 0) { game.lives = 0; gameOver(); }
    } else if (e.hp <= 0) {
      e.dead = true;
      game.money += e.bounty;
      shots.push({ kind: 'coin', x: e.x, y: e.y, t: 0, ttl: 0.6, v: e.bounty });
    }
  }
  enemies = enemies.filter((e) => !e.dead && !e.escaped);

  // Türme & Schüsse
  for (const t of towers) stepTower(t, dt);
  shots = shots.filter((sh) => !stepShot(sh, dt));

  // Welle fertig?
  if (game.state === 'wave' && !game.toSpawn.length && !enemies.length) {
    game.money += 15 + game.wave * 3;
    game.state = 'build';
    game.nextT = 8;
    game.banner = 'Welle ' + game.wave + ' geschafft! +' + (15 + game.wave * 3) + ' 💰';
    game.bannerT = 1.6;
    saveBest();
  }
}

function gameOver() {
  game.state = 'over';
  saveBest();
}

// ---- Highscore -------------------------------------------------------------
function loadBest() { try { game.best = parseInt(localStorage.getItem('td_best') || '0', 10) || 0; } catch { game.best = 0; } }
function saveBest() {
  const reached = game.state === 'over' ? Math.max(0, game.wave - 1) : game.wave;
  if (reached > game.best) {
    game.best = reached;
    try { localStorage.setItem('td_best', String(game.best)); } catch { /* egal */ }
  }
}

// ---- Rendering -------------------------------------------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let CW = 0, CH = 0, T = 24, OX = 0, OY = 0;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  CW = window.innerWidth; CH = window.innerHeight;
  canvas.width = Math.round(CW * dpr); canvas.height = Math.round(CH * dpr);
  canvas.style.width = CW + 'px'; canvas.style.height = CH + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  T = Math.min(CW / GC, (CH - 210) / GR);
  OX = (CW - GC * T) / 2;
  OY = 92;
}
window.addEventListener('resize', resize);

function draw(time) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0c1a12'; ctx.fillRect(0, 0, CW, CH);

  ctx.save(); ctx.translate(OX, OY);
  // Gras + Pfad
  for (let y = 0; y < GR; y++) for (let x = 0; x < GC; x++) {
    if (isPath(x, y)) ctx.fillStyle = (x + y) % 2 ? '#b39b6e' : '#a8905f';
    else ctx.fillStyle = (x + y) % 2 ? '#1d3a24' : '#1a3520';
    ctx.fillRect(x * T, y * T, T + 0.5, T + 0.5);
  }
  // Start/Ziel
  ctx.font = (T * 0.7) + 'px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const [sx, sy] = PATH[0], [ex, ey] = PATH[PATH.length - 1];
  ctx.fillText('🕳', sx * T + T / 2, sy * T + T / 2);
  ctx.fillText('🏠', ex * T + T / 2, ey * T + T / 2);

  // gewählte Kachel + Reichweite
  if (game.sel) {
    const t = towerAt[game.sel.x + ',' + game.sel.y];
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(game.sel.x * T, game.sel.y * T, T, T);
    const range = t ? towerStats(t).range : null;
    if (range) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc((game.sel.x + 0.5) * T, (game.sel.y + 0.5) * T, range * T, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Türme
  for (const t of towers) drawTower(t, time);
  // Gegner
  for (const e of enemies) drawEnemy(e, time);
  // Schüsse/Effekte
  for (const sh of shots) drawShot(sh);
  ctx.restore();

  drawHUD();
}

function drawTower(t, time) {
  const def = TOWERS[t.type], s = towerStats(t);
  const cx = (t.x + 0.5) * T, cy = (t.y + 0.5) * T;
  // Sockel
  ctx.fillStyle = '#3a4a55';
  ctx.beginPath(); ctx.arc(cx, cy, T * 0.38, 0, TAU); ctx.fill();
  ctx.fillStyle = def.color;
  ctx.beginPath(); ctx.arc(cx, cy, T * 0.3, 0, TAU); ctx.fill();
  // Lauf (Richtung)
  if (t.type !== 'ice' && t.type !== 'flame') {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(t.angle || 0);
    ctx.fillStyle = '#22303a';
    ctx.fillRect(0, -T * 0.08, T * 0.42, T * 0.16);
    ctx.restore();
  }
  // Laserstrahl
  if (t.type === 'laser' && t.target && !t.target.dead && !t.target.escaped) {
    const len = s.range * 1.7 * T;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(t.angle || 0);
    ctx.strokeStyle = 'rgba(255,110,240,0.85)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(T * 0.3, 0); ctx.lineTo(len, 0); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(T * 0.3, 0); ctx.lineTo(len, 0); ctx.stroke();
    ctx.restore();
  }
  // Flammenring
  if (t.type === 'flame' && t.firing) {
    ctx.strokeStyle = `rgba(255,${120 + Math.sin(time * 20) * 60 | 0},40,0.5)`;
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(cx, cy, s.range * T * (0.75 + Math.sin(time * 9) * 0.08), 0, TAU); ctx.stroke();
  }
  // Eis-Puls
  if (t.type === 'ice') {
    const f = (t.pulse || 0) % 1.2 / 1.2;
    ctx.strokeStyle = `rgba(140,220,255,${0.55 * (1 - f)})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(cx, cy, s.range * T * f, 0, TAU); ctx.stroke();
  }
  // Icon + Level-Sterne
  ctx.font = (T * 0.42) + 'px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(def.icon, cx, cy - T * 0.02);
  ctx.font = (T * 0.24) + 'px system-ui';
  ctx.fillText('⭐'.repeat(t.lvl), cx, cy + T * 0.34);
}

function drawEnemy(e, time) {
  const cx = e.x * T, cy = e.y * T;
  const wob = Math.sin(time * 8 + e.wob) * T * 0.03;
  ctx.fillStyle = e.color;
  ctx.beginPath(); ctx.arc(cx, cy + wob, e.r * T, 0, TAU); ctx.fill();
  if (e.slowF > 0) { ctx.strokeStyle = 'rgba(140,220,255,0.9)'; ctx.lineWidth = 2; ctx.stroke(); }
  if (e.burnT > 0) { ctx.font = (T * 0.3) + 'px system-ui'; ctx.textAlign = 'center'; ctx.fillText('🔥', cx, cy - e.r * T - T * 0.12); }
  // Augen
  ctx.fillStyle = '#0f1a12';
  ctx.beginPath();
  ctx.arc(cx - e.r * T * 0.35, cy + wob - e.r * T * 0.2, e.r * T * 0.16, 0, TAU);
  ctx.arc(cx + e.r * T * 0.35, cy + wob - e.r * T * 0.2, e.r * T * 0.16, 0, TAU);
  ctx.fill();
  // HP-Balken
  const w = e.r * T * 2.2;
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(cx - w / 2, cy - e.r * T - T * 0.16, w, T * 0.09);
  ctx.fillStyle = e.hp / e.maxHp > 0.4 ? '#7dc95e' : '#e05a4a';
  ctx.fillRect(cx - w / 2, cy - e.r * T - T * 0.16, w * clamp(e.hp / e.maxHp, 0, 1), T * 0.09);
}

function drawShot(sh) {
  if (sh.kind === 'tracer') {
    ctx.strokeStyle = 'rgba(255,240,180,0.9)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(sh.x1 * T, sh.y1 * T); ctx.lineTo(sh.x2 * T, sh.y2 * T); ctx.stroke();
  } else if (sh.kind === 'lob') {
    ctx.fillStyle = '#333';
    ctx.beginPath(); ctx.arc(sh.x * T, sh.y * T, T * 0.12, 0, TAU); ctx.fill();
  } else if (sh.kind === 'rocket') {
    ctx.save(); ctx.translate(sh.x * T, sh.y * T); ctx.rotate(sh.angle);
    ctx.fillStyle = '#ddd'; ctx.fillRect(-T * 0.14, -T * 0.06, T * 0.28, T * 0.12);
    ctx.fillStyle = '#e0453e';
    ctx.beginPath(); ctx.moveTo(T * 0.14, 0); ctx.lineTo(T * 0.04, -T * 0.09); ctx.lineTo(T * 0.04, T * 0.09); ctx.fill();
    ctx.restore();
  } else if (sh.kind === 'boom') {
    const f = sh.t / sh.ttl;
    ctx.globalAlpha = 1 - f;
    ctx.fillStyle = '#ffb24d';
    ctx.beginPath(); ctx.arc(sh.x * T, sh.y * T, sh.r * T * (0.4 + f * 0.8), 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  } else if (sh.kind === 'coin') {
    ctx.globalAlpha = 1 - sh.t / sh.ttl;
    ctx.fillStyle = '#ffd166'; ctx.font = (T * 0.36) + 'px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('+' + sh.v, sh.x * T, (sh.y - sh.t * 1.2) * T);
    ctx.globalAlpha = 1;
  }
}

function drawHUD() {
  ctx.fillStyle = 'rgba(8,25,42,0.78)'; roundRectP(8, 8, CW - 16, 40, 9); ctx.fill();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left'; ctx.fillStyle = '#ffd166'; ctx.font = 'bold 15px system-ui';
  ctx.fillText('💰 ' + game.money, 148, 28);
  ctx.fillStyle = '#eaf3fa';
  ctx.fillText('❤️ ' + game.lives, 238, 28);
  ctx.textAlign = 'right'; ctx.fillStyle = '#9fc0d8'; ctx.font = '13px system-ui';
  ctx.fillText('Welle ' + game.wave + ' · Best ' + game.best, CW - 14, 28);
  ctx.textBaseline = 'alphabetic';

  // Countdown zur nächsten Welle
  if (game.state === 'build' && game.wave > 0 && game.nextT > 0) {
    ctx.fillStyle = '#9fc0d8'; ctx.font = '12px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('Nächste Welle in ' + Math.ceil(game.nextT) + 's – ▶ für Frühstart-Bonus', CW / 2, OY - 10);
  }
  if (game.wave === 0) {
    ctx.fillStyle = '#ffd166'; ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('Baue Türme und starte mit ▶ die erste Welle!', CW / 2, OY - 10);
  }

  if (game.bannerT > 0) {
    ctx.globalAlpha = clamp(game.bannerT, 0, 1);
    centerText(game.banner, '#fff');
    ctx.globalAlpha = 1;
  }
  if (game.state === 'over') {
    centerText('💀 Game Over – Welle ' + game.wave, '#ff6a5a');
    ctx.fillStyle = '#9fc0d8'; ctx.font = '13px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('Tippe für ein neues Spiel', CW / 2, OY + GR * T / 2 + 34);
  }
}
function centerText(text, color) {
  const y = OY + GR * T / 2;
  ctx.fillStyle = 'rgba(8,16,30,0.8)'; roundRectP(CW / 2 - 165, y - 26, 330, 46, 10); ctx.fill();
  ctx.fillStyle = color; ctx.font = 'bold 19px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, CW / 2, y - 3); ctx.textBaseline = 'alphabetic';
}
function roundRectP(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ---- Bau- & Upgrade-UI -----------------------------------------------------
const buildbar = document.getElementById('buildbar');
const upgpanel = document.getElementById('upgpanel');

function hidePanels() { buildbar.classList.add('hidden'); upgpanel.classList.add('hidden'); game.sel = null; }

function showBuildbar() {
  buildbar.innerHTML = '';
  for (const [key, def] of Object.entries(TOWERS)) {
    const cost = def.levels[0].cost;
    const b = document.createElement('button');
    b.className = 'tdt' + (game.money < cost ? ' broke' : '');
    b.innerHTML = `<span class="ti">${def.icon}</span><span class="tn">${def.name}</span><span class="tc">${cost} 💰</span>`;
    b.title = def.desc;
    if (game.money >= cost) b.addEventListener('click', () => buildTower(key));
    buildbar.appendChild(b);
  }
  buildbar.classList.remove('hidden');
  upgpanel.classList.add('hidden');
}

function buildTower(type) {
  const def = TOWERS[type];
  const cost = def.levels[0].cost;
  if (!game.sel || game.money < cost) return;
  const k = game.sel.x + ',' + game.sel.y;
  if (towerAt[k] || isPath(game.sel.x, game.sel.y)) return;
  game.money -= cost;
  const t = { type, lvl: 0, x: game.sel.x, y: game.sel.y, cd: 0, angle: 0 };
  towers.push(t);
  towerAt[k] = t;
  showUpgpanel(t);
}

function sellValue(t) {
  let paid = 0;
  for (let i = 0; i <= t.lvl; i++) paid += TOWERS[t.type].levels[i].cost;
  return Math.round(paid * 0.7);
}

function showUpgpanel(t) {
  buildbar.classList.add('hidden');
  const def = TOWERS[t.type], s = towerStats(t);
  const next = def.levels[t.lvl + 1];
  const info = document.getElementById('upg-info');
  const statBits = [];
  if (s.dmg) statBits.push('Schaden ' + s.dmg);
  if (s.dps) statBits.push('Schaden ' + s.dps + '/s');
  if (s.rate) statBits.push(s.rate + ' Schuss/s');
  if (s.slow) statBits.push('-' + Math.round(s.slow * 100) + '% Tempo');
  if (s.splash) statBits.push('Fläche ' + s.splash);
  if (s.burn) statBits.push('+' + s.burn + '/s Brand');
  statBits.push('Reichweite ' + s.range);
  info.textContent = `${def.icon} ${def.name} · Stufe ${t.lvl + 1}${'⭐'.repeat(t.lvl)} · ${statBits.join(' · ')}`;
  const up = document.getElementById('upg-up');
  if (next) {
    up.textContent = `⬆ Upgrade (${next.cost} 💰)`;
    up.disabled = game.money < next.cost;
    up.onclick = () => {
      if (game.money < next.cost) return;
      game.money -= next.cost; t.lvl++;
      showUpgpanel(t);
    };
  } else {
    up.textContent = '⭐ Max. Stufe';
    up.disabled = true;
    up.onclick = null;
  }
  const sell = document.getElementById('upg-sell');
  sell.textContent = `💰 Verkaufen (${sellValue(t)})`;
  sell.onclick = () => {
    game.money += sellValue(t);
    towers = towers.filter((x) => x !== t);
    delete towerAt[t.x + ',' + t.y];
    hidePanels();
  };
  upgpanel.classList.remove('hidden');
}
document.getElementById('upg-close').addEventListener('click', hidePanels);

canvas.addEventListener('pointerdown', (e) => {
  if (game.state === 'over') { newGame(); return; }
  const r = canvas.getBoundingClientRect();
  const gx = Math.floor((e.clientX - r.left - OX) / T);
  const gy = Math.floor((e.clientY - r.top - OY) / T);
  if (gx < 0 || gx >= GC || gy < 0 || gy >= GR) { hidePanels(); return; }
  const k = gx + ',' + gy;
  game.sel = { x: gx, y: gy };
  if (towerAt[k]) showUpgpanel(towerAt[k]);
  else if (!isPath(gx, gy)) showBuildbar();
  else hidePanels();
});

// ---- Toolbar ---------------------------------------------------------------
const speedBtn = document.getElementById('btn-speed');
function updateSpeedBtn() { speedBtn.textContent = game.speed + '×'; }
speedBtn.addEventListener('click', () => {
  game.speed = game.speed === 1 ? 2 : game.speed === 2 ? 3 : 1;
  updateSpeedBtn();
});
document.getElementById('btn-wave').addEventListener('click', () => { if (game.state === 'build') startWave(); });

const menuEl = document.getElementById('menu');
const helpEl = document.getElementById('help');
document.getElementById('btn-menu').addEventListener('click', () => menuEl.classList.remove('hidden'));
document.getElementById('btn-menu-close').addEventListener('click', () => menuEl.classList.add('hidden'));
menuEl.addEventListener('click', (e) => { if (e.target === menuEl) menuEl.classList.add('hidden'); });
document.getElementById('btn-help').addEventListener('click', () => { menuEl.classList.add('hidden'); helpEl.classList.remove('hidden'); });
document.getElementById('btn-start').addEventListener('click', () => helpEl.classList.add('hidden'));
document.getElementById('btn-restart').addEventListener('click', () => { menuEl.classList.add('hidden'); newGame(); });

// ---- Schleife --------------------------------------------------------------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  for (let i = 0; i < game.speed; i++) update(dt);
  draw(now / 1000);
  requestAnimationFrame(frame);
}

window.__td = { game, get towers() { return towers; }, get enemies() { return enemies; },
  TOWERS, PATH, isPath, startWave, newGame, update,
  place(type, x, y) {
    const k = x + ',' + y;
    if (towerAt[k] || isPath(x, y)) return null;
    const cost = TOWERS[type].levels[0].cost;
    if (game.money < cost) return null;
    game.money -= cost;
    const t = { type, lvl: 0, x, y, cd: 0, angle: 0 };
    towers.push(t); towerAt[k] = t;
    return t;
  },
  upgrade(t) {
    const next = TOWERS[t.type].levels[t.lvl + 1];
    if (!next || game.money < next.cost) return false;
    game.money -= next.cost; t.lvl++;
    return true;
  } };

loadBest();
resize();
newGame();
requestAnimationFrame(frame);
