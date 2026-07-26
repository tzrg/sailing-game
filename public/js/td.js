// Tower Defense – Monster laufen den Parcours entlang, Türme halten sie auf.
// Zwölf Turmtypen mit Stufen und Spezialisierungen, Geld pro Abschuss,
// endlose Wellen. Die Kommandozentrale schaltet Nuke + Orbital-Laser frei.

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

// Teiche (hübsch anzusehen, nicht bebaubar)
const POND = new Set(['0,0', '1,0', '0,1', '11,16', '10,16', '11,15', '11,0']);
const isPond = (x, y) => POND.has(x + ',' + y);

// deterministischer Hash pro Kachel für die Deko (Grasbüschel, Blumen, Steine …)
function tileHash(x, y) { return ((x * 73856093) ^ (y * 19349663)) >>> 0; }

// ---- Türme -----------------------------------------------------------------
// levels[i]: cost = Kosten für Bau (i=0) bzw. Upgrade. dmg/rate für Schüsse,
// dps für Dauerstrahler, slow für Aura. range in Kacheln.
const TOWERS = {
  mg: { name: 'MG', icon: '🔫', color: '#8fa3b8', desc: 'schnell, Einzelziel; Spezialmunition wählbar',
    levels: [
      { cost: 45, dmg: 6, rate: 4.5, range: 2.4 },
      { cost: 55, dmg: 11, rate: 5.5, range: 2.6 },
      { cost: 100, dmg: 19, rate: 6.5, range: 2.9 }] },
  cannon: { name: 'Kanone', icon: '🎯', color: '#7a8a6a', desc: 'Kinetik: viel Schaden, weit, knackt Panzerung',
    levels: [
      { cost: 125, dmg: 85, rate: 0.5, range: 4.2 },
      { cost: 135, dmg: 160, rate: 0.55, range: 4.5 },
      { cost: 245, dmg: 300, rate: 0.6, range: 4.8 }] },
  grenade: { name: 'Granatkanone', icon: '💣', color: '#c9a15a', desc: 'Flächenschaden (prallt an Panzerung ab)',
    levels: [
      { cost: 80, dmg: 22, rate: 0.9, range: 2.6, splash: 1.15 },
      { cost: 90, dmg: 40, rate: 1.0, range: 2.9, splash: 1.3 },
      { cost: 160, dmg: 75, rate: 1.15, range: 3.2, splash: 1.5 }] },
  laser: { name: 'Laser', icon: '📡', color: '#e06fd8', desc: 'durchbohrt Linie UND Panzerung',
    levels: [
      { cost: 110, dps: 20, range: 3.4 },
      { cost: 120, dps: 38, range: 3.7 },
      { cost: 210, dps: 70, range: 4.0 }] },
  flame: { name: 'Flammenwerfer', icon: '🔥', color: '#e0703a', desc: 'Umkreis + Brennschaden',
    levels: [
      { cost: 85, dps: 16, range: 1.9, burn: 5 },
      { cost: 95, dps: 30, range: 2.1, burn: 10 },
      { cost: 170, dps: 55, range: 2.3, burn: 18 }] },
  rocket: { name: 'Raketenturm', icon: '🚀', color: '#b04a4a', desc: 'zielsuchend, hoher Schaden',
    levels: [
      { cost: 130, dmg: 50, rate: 0.55, range: 3.6, splash: 0.9 },
      { cost: 140, dmg: 95, rate: 0.62, range: 3.9, splash: 1.05 },
      { cost: 240, dmg: 170, rate: 0.7, range: 4.2, splash: 1.2 }] },
  ice: { name: 'Vereiser', icon: '❄️', color: '#6fc4e0', desc: 'verlangsamt im Umkreis',
    levels: [
      { cost: 55, slow: 0.35, range: 2.1 },
      { cost: 60, slow: 0.45, range: 2.4 },
      { cost: 110, slow: 0.55, range: 2.8 }] },
  tesla: { name: 'Blitzturm', icon: '⚡', color: '#ffe66e', desc: 'Kettenblitz springt von Gegner zu Gegner',
    levels: [
      { cost: 120, dmg: 28, rate: 1.1, range: 2.7, chain: 3 },
      { cost: 130, dmg: 50, rate: 1.25, range: 3.0, chain: 4 },
      { cost: 230, dmg: 92, rate: 1.4, range: 3.3, chain: 6 }] },
  gift: { name: 'Giftschleuder', icon: '🧪', color: '#8ad84a', desc: 'hinterlässt ätzende Giftpfützen',
    levels: [
      { cost: 95, dps: 13, rate: 0.45, range: 3.0, pool: 0.95, dur: 4 },
      { cost: 105, dps: 25, rate: 0.5, range: 3.3, pool: 1.1, dur: 4.5 },
      { cost: 185, dps: 45, rate: 0.55, range: 3.6, pool: 1.25, dur: 5 }] },
  wind: { name: 'Windmaschine', icon: '🌪️', color: '#9fd8d0', desc: 'pustet Gegner zurück (danach kurz windfest)',
    levels: [
      { cost: 100, push: 0.9, rate: 0.18, range: 2.6 },
      { cost: 110, push: 1.4, rate: 0.2, range: 2.9 },
      { cost: 200, push: 2.0, rate: 0.22, range: 3.2 }] },
  gold: { name: 'Goldmine', icon: '💰', color: '#d8b84a', desc: 'schürft stetig Gold (kein Schaden)',
    levels: [
      { cost: 100, gold: 2, interval: 3 },
      { cost: 120, gold: 4, interval: 3.1 },
      { cost: 220, gold: 7, interval: 3.2 }] },
  command: { name: 'Kommandozentrale', icon: '🛰️', color: '#c0c8e8', desc: 'schaltet ☢️ Nuke + 🛰️ Orbital-Laser frei (je 1× pro Welle)',
    levels: [
      { cost: 400 }] },
};

// ---- Spezialisierungen: exklusive Entweder-oder-Wahl pro Turm --------------
const AMMO_SPECS = [
  { key: 'fire', icon: '🔥', name: 'Brandmarkierer', cost: 90, desc: '+50% Feuerschaden auf Getroffene (4s)' },
  { key: 'shock', icon: '⚡', name: 'Ionisiert', cost: 90, desc: '+50% Blitzschaden auf Getroffene (4s)' },
  { key: 'tungsten', icon: '🔩', name: 'Wolframkern', cost: 90, desc: '+60% Schaden, extrem panzerbrechend' },
];
const SPECS = {
  mg: AMMO_SPECS,
  cannon: AMMO_SPECS.map((a) => ({ ...a, cost: 110 })),
  grenade: [
    { key: 'dmg', icon: '💥', name: 'Sprengkraft', cost: 110, desc: '+50% Schaden', mod: (s) => { s.dmg *= 1.5; } },
    { key: 'range', icon: '🔭', name: 'Langrohr', cost: 110, desc: '+1,0 Reichweite', mod: (s) => { s.range += 1.0; } },
  ],
  rocket: [
    { key: 'dmg', icon: '💥', name: 'Gefechtskopf', cost: 130, desc: '+50% Schaden', mod: (s) => { s.dmg *= 1.5; } },
    { key: 'range', icon: '🔭', name: 'Booster', cost: 130, desc: '+1,0 Reichweite', mod: (s) => { s.range += 1.0; } },
  ],
  tesla: [
    { key: 'chain', icon: '🕸️', name: 'Mehr Ziele', cost: 120, desc: '+2 Kettenziele', mod: (s) => { s.chain += 2; } },
    { key: 'range', icon: '📡', name: 'Fernfunken', cost: 120, desc: '+0,9 Reichweite', mod: (s) => { s.range += 0.9; } },
  ],
  flame: [
    { key: 'wide', icon: '🌊', name: 'Breitmaul', cost: 100, desc: 'fast doppelt so breiter Feuerkegel', mod: (s) => { s.cone = 1.75; } },
    { key: 'range', icon: '🗼', name: 'Feuerlanze', cost: 100, desc: '+0,8 Reichweite', mod: (s) => { s.range += 0.8; } },
  ],
};
// Effektive Werte inkl. gewählter Spezialisierung
function effStats(t) {
  const s = { ...towerStats(t) };
  if (t.type === 'flame') s.cone = 0.95;   // Grundkegel (~110°)
  const spec = t.spec && (SPECS[t.type] || []).find((o) => o.key === t.spec);
  if (spec && spec.mod) spec.mod(s);
  return s;
}

// ---- Schwierigkeitsgrade ---------------------------------------------------
const DIFFS = {
  leicht: { label: 'Leicht', hpMul: 0.8, growth: 1.16, lives: 20, money: 140 },
  normal: { label: 'Normal', hpMul: 1.0, growth: 1.18, lives: 15, money: 120 },
  schwer: { label: 'Schwer', hpMul: 1.3, growth: 1.2, lives: 10, money: 100 },
};
let DIFF = DIFFS.normal;

// ---- Zustand ---------------------------------------------------------------
const game = {
  money: 120, lives: 15, wave: 0, best: 0,
  state: 'build',       // build | wave | over
  speed: 1, nextT: 0,   // Countdown bis Auto-Start der nächsten Welle
  toSpawn: [], spawnT: 0,
  sel: null,            // gewählte Kachel {x,y}
  banner: '', bannerT: 0,
  nukeUsed: false, laserUsed: false,   // Superwaffen: je 1x pro Welle
  targeting: null,      // 'slaser' = nächster Tap aufs Feld feuert den Orbital-Laser
};
let towers = [];        // {type,lvl,x,y,cd,angle,target}
let enemies = [];       // {type,hp,maxHp,speed,pathI,frac,x,y,slowT,slowF,burnT,burnDps,bounty,boss}
let shots = [];         // Projektile/Effekte
let towerAt = {};       // "x,y" -> tower
let parts = [];         // Deko-Partikel (Flammen, Funken, Rauch, Schnee, …)
const MAX_PARTS = 520;
function spawnPart(p) { if (parts.length < MAX_PARTS) { p.t = 0; parts.push(p); } }

function newGame() {
  game.money = DIFF.money; game.lives = DIFF.lives; game.wave = 0;
  game.state = 'build'; game.speed = 1; game.nextT = 0;
  game.toSpawn = []; game.sel = null; game.banner = ''; game.bannerT = 0;
  game.nukeUsed = false; game.laserUsed = false; game.targeting = null;
  towers = []; enemies = []; shots = []; towerAt = {}; parts = [];
  updateSpeedBtn();
  updateSupers();
  hidePanels();
}

// ---- Wellen ----------------------------------------------------------------
function baseHp(w) { return (30 * Math.pow(DIFF.growth, w - 1) + 10 * (w - 1)) * DIFF.hpMul; }
function bounty(w, mult) { return Math.round((3 + w * 0.55) * mult); }

function buildWave(w) {
  const list = [];
  const n = Math.min(10 + Math.round(w * 1.8), 40);
  for (let i = 0; i < n; i++) {
    let t = 'blob';
    if (w >= 2 && i % 3 === 2) t = 'runner';
    if (w >= 4 && i % 4 === 3) t = 'tank';
    if (w >= 7 && i % 5 === 4) t = 'regen';
    list.push(t);
  }
  // Boss-Wellen: ab Welle 16 kommen sie im Rudel
  if (w % 8 === 0) for (let b = 0; b <= (w / 16 | 0); b++) list.push('boss');
  return list;
}

const ETYPES = {
  blob: { hp: 1.0, speed: 1.5, mult: 1.0, color: '#7dc95e', r: 0.28 },
  runner: { hp: 0.6, speed: 2.6, mult: 1.1, color: '#e0d05a', r: 0.24 },
  tank: { hp: 2.6, speed: 0.95, mult: 2.5, color: '#8a6fb8', r: 0.34, armor: 0.5 },
  regen: { hp: 1.7, speed: 1.2, mult: 1.8, color: '#5ac9a8', r: 0.3, regen: 0.02 },
  boss: { hp: 14, speed: 0.55, mult: 12, color: '#d84a6a', r: 0.44, boss: true, armor: 0.3 },
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
  game.nukeUsed = false; game.laserUsed = false;
  updateSupers();
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
    armorHp: t.armor ? hp * t.armor : 0, maxArmor: t.armor ? hp * t.armor : 0,
    vulnFire: 0, vulnShock: 0, windCd: 0,
    r: t.r, color: t.color, wob: Math.random() * TAU,
  });
}

// Position/Fortschritt eines Gegners auf dem Pfad
function progress(e) { return e.pathI + e.frac; }

function stepEnemy(e, dt) {
  if (e.slowT > 0) e.slowT -= dt; else e.slowF = 0;
  if (e.vulnFire > 0) e.vulnFire -= dt;
  if (e.vulnShock > 0) e.vulnShock -= dt;
  if (e.windCd > 0) e.windCd -= dt;
  if (e.burnT > 0) { e.burnT -= dt; damage(e, e.burnDps * dt, 'fire'); }
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

// Schadenstypen: kinetic | laser | fire | shock | explosive | poison
// Panzerung schluckt Feuer/Blitz/Explosion/Gift fast komplett, wird aber von
// Kinetik (x1.5, Wolfram x2.2) und Laser (x1) effektiv zerlegt.
function damage(e, amt, type = 'kinetic', ap = false) {
  if (type === 'fire' && e.vulnFire > 0) amt *= 1.5;
  if (type === 'shock' && e.vulnShock > 0) amt *= 1.5;
  if (e.armorHp > 0) {
    let mult = 0.25;
    if (type === 'kinetic') mult = ap ? 2.2 : 1.5;
    else if (type === 'laser') mult = 1.0;
    e.armorHp -= amt * mult;
    if (e.armorHp <= 0) { e.armorHp = 0; armorBreak(e); }
    return;
  }
  e.hp -= amt;
}

// Panzerung zerspringt: graue Scherben + Ring
function armorBreak(e) {
  spawnPart({ kind: 'pop', x: e.x, y: e.y, r: e.r * 2.0, ttl: 0.25, color: '#c8d2da' });
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * TAU, sp = 1.5 + Math.random() * 2.5;
    spawnPart({ kind: 'shard', x: e.x, y: e.y - 0.1, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.8, ttl: 0.5, rot: Math.random() * TAU });
  }
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

// Turm dreht weich in Zielrichtung (statt zu springen)
function aimAt(t, x, y, dt) {
  const want = Math.atan2(y - (t.y + 0.5), x - (t.x + 0.5));
  let d = want - (t.angle || 0);
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  t.angle = (t.angle || 0) + d * Math.min(1, dt * 14);
}

// Gegner ein Stück den Pfad ZURÜCK schieben (Windmaschine)
function pushBack(e, dist) {
  const d = e.boss ? dist * 0.3 : dist;
  let p = Math.max(0, progress(e) - d);
  e.pathI = Math.floor(p); e.frac = p - e.pathI;
  const [ax, ay] = PATH[e.pathI], [bx, by] = PATH[Math.min(e.pathI + 1, PATH.length - 1)];
  e.x = ax + 0.5 + (bx - ax) * e.frac;
  e.y = ay + 0.5 + (by - ay) * e.frac;
}

function stepTower(t, dt) {
  if (t.type === 'command') { t.pulse = (t.pulse || 0) + dt; return; }
  const s = effStats(t);
  const cx = t.x + 0.5, cy = t.y + 0.5;
  t.born = (t.born ?? 1) + dt;
  if (t.kick > 0) t.kick = Math.max(0, t.kick - dt * 9);

  if (t.type === 'gold') {
    // Goldmine: schürft im Takt, egal was draußen los ist
    t.goldT = (t.goldT || 0) + dt;
    t.pulse = (t.pulse || 0) + dt;
    if (t.goldT >= s.interval) {
      t.goldT -= s.interval;
      game.money += s.gold;
      shots.push({ kind: 'coin', x: cx, y: cy - 0.3, t: 0, ttl: 0.7, v: s.gold });
      for (let i = 0; i < 3; i++) spawnPart({ kind: 'spark', x: cx, y: cy, vx: (Math.random() - 0.5) * 1.4, vy: -1 - Math.random(), ttl: 0.35, color: '#ffd166' });
    }
    return;
  }

  if (t.type === 'tesla') {
    t.cd -= dt;
    const target = firstInRange(t, s.range);
    if (target) aimAt(t, target.x, target.y, dt);
    if (t.cd > 0 || !target) return;
    t.cd = 1 / s.rate;
    // Kettenblitz: springt zu den jeweils nächsten, noch nicht getroffenen Gegnern
    const hit = [target];
    let cur = target, dmg = s.dmg;
    damage(cur, dmg, 'shock');
    for (let j = 1; j < s.chain; j++) {
      let next = null, nd = 2.3;
      for (const e of enemies) {
        if (e.dead || e.escaped || hit.includes(e)) continue;
        const d = Math.hypot(e.x - cur.x, e.y - cur.y);
        if (d < nd) { nd = d; next = e; }
      }
      if (!next) break;
      dmg *= 0.75;
      damage(next, dmg, 'shock');
      hit.push(next);
      cur = next;
    }
    shots.push({ kind: 'zap', pts: [[cx, cy], ...hit.map((e) => [e.x, e.y - 0.1])], t: 0, ttl: 0.16 });
    for (const e of hit) spawnPart({ kind: 'spark', x: e.x, y: e.y - 0.2, vx: (Math.random() - 0.5) * 2, vy: -1.5, ttl: 0.25, color: '#fff8b0' });
    t.kick = 1;
    return;
  }

  if (t.type === 'gift') {
    t.cd -= dt;
    const target = firstInRange(t, s.range);
    if (target) aimAt(t, target.x, target.y, dt);
    if (t.cd > 0 || !target) return;
    t.cd = 1 / s.rate;
    // Flasche fliegt dorthin, wo das Ziel gleich sein wird
    shots.push({ kind: 'glob', x: cx, y: cy, sx: cx, sy: cy, tx: target.x, ty: target.y, t: 0, ttl: 0.5, dps: s.dps, pool: s.pool, dur: s.dur });
    t.kick = 1;
    return;
  }

  if (t.type === 'wind') {
    t.cd -= dt;
    t.pulse = (t.pulse || 0) + dt;
    if (t.cd > 0) return;
    let any = false;
    for (const e of enemies) {
      if (e.dead || e.escaped || e.windCd > 0) continue;
      if (Math.hypot(e.x - cx, e.y - cy) <= s.range) { pushBack(e, s.push); e.windCd = 2.5; any = true; }
    }
    if (any) {
      t.cd = 1 / s.rate;
      shots.push({ kind: 'gust', x: cx, y: cy, r: s.range, t: 0, ttl: 0.45 });
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * TAU;
        spawnPart({ kind: 'leaf', x: cx + Math.cos(a) * 0.3, y: cy + Math.sin(a) * 0.3, vx: Math.cos(a) * 3, vy: Math.sin(a) * 3, ttl: 0.5, rot: Math.random() * TAU });
      }
    }
    return;
  }

  if (t.type === 'ice') {
    // Aura: alle im Umkreis verlangsamen
    for (const e of enemies) {
      if (e.dead || e.escaped) continue;
      if (Math.hypot(e.x - cx, e.y - cy) <= s.range) { e.slowF = Math.max(e.slowF, s.slow); e.slowT = 0.35; }
    }
    t.pulse = (t.pulse || 0) + dt;
    // sanftes Schneegestöber im Wirkradius
    if (Math.random() < dt * 5) {
      const a = Math.random() * TAU, r = Math.random() * s.range;
      spawnPart({ kind: 'snow', x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r - 0.3, vx: 0, vy: 0.45, ttl: 1.1, ph: Math.random() * TAU });
    }
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
      if (dist < 0.38 + e.r * 0.5) {
        damage(e, s.dps * dt, 'laser');
        // Brutzel-Funken am Auftreffpunkt
        if (Math.random() < dt * 9) spawnPart({ kind: 'spark', x: e.x, y: e.y - 0.1, vx: (Math.random() - 0.5) * 2, vy: -1 - Math.random(), ttl: 0.25, color: '#ff9ef0' });
      }
    }
    return;
  }

  if (t.type === 'flame') {
    // Feuerkegel: Turm schwenkt zum nächsten Gegner, geröstet wird nur, wer im
    // Kegel (halber Öffnungswinkel s.cone) steht. 'Breitmaul' macht ihn breiter.
    let nearest = null, nd = 1e9;
    for (const e of enemies) {
      if (e.dead || e.escaped) continue;
      const d = Math.hypot(e.x - cx, e.y - cy);
      if (d <= s.range && d < nd) { nd = d; nearest = e; }
    }
    let any = false;
    if (nearest) {
      aimAt(t, nearest.x, nearest.y, dt);
      for (const e of enemies) {
        if (e.dead || e.escaped) continue;
        if (Math.hypot(e.x - cx, e.y - cy) > s.range) continue;
        let da = Math.atan2(e.y - cy, e.x - cx) - t.angle;
        while (da > Math.PI) da -= TAU;
        while (da < -Math.PI) da += TAU;
        if (Math.abs(da) > s.cone) continue;
        damage(e, s.dps * dt, 'fire');
        e.burnT = Math.max(e.burnT, 2.5); e.burnDps = Math.max(e.burnDps, s.burn);
        any = true;
      }
    }
    t.firing = any;
    t.pulse = (t.pulse || 0) + dt;
    if (any) {
      // Flammenzungen über die ganze Kegelbreite, mit Streuung und Aufsteigen
      for (let i = 0; i < 3; i++) {
        const a = t.angle + (Math.random() - 0.5) * s.cone * 1.8;
        const sp = 2.0 + Math.random() * 1.8;
        spawnPart({ kind: 'flame', x: cx + Math.cos(a) * 0.3, y: cy + Math.sin(a) * 0.3,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, ttl: 0.3 + Math.random() * 0.22, size: 0.13 + Math.random() * 0.1 });
      }
    }
    return;
  }

  // Schuss-Türme (mg, grenade, rocket)
  t.cd -= dt;
  const target = firstInRange(t, s.range);
  if (target) aimAt(t, target.x, target.y, dt);
  if (t.cd > 0 || !target) return;
  t.cd = 1 / s.rate;
  t.kick = 1;   // Rückstoß-Animation

  if (t.type === 'mg') {
    let dmg = s.dmg;
    if (t.spec === 'tungsten') dmg *= 1.6;
    damage(target, dmg, 'kinetic', t.spec === 'tungsten');
    if (t.spec === 'fire') target.vulnFire = 4;      // Brandmarkierer: nimmt 4s mehr Feuerschaden
    if (t.spec === 'shock') target.vulnShock = 4;    // Ionisiert: nimmt 4s mehr Blitzschaden
    const tcol = t.spec === 'fire' ? 'rgba(255,150,60,0.95)' : t.spec === 'shock' ? 'rgba(140,190,255,0.95)' : t.spec === 'tungsten' ? 'rgba(240,248,255,1)' : 'rgba(255,240,180,0.9)';
    shots.push({ kind: 'tracer', x1: cx, y1: cy, x2: target.x, y2: target.y, t: 0, ttl: 0.07, color: tcol });
    // Mündungsfeuer + Einschlagsfunken
    spawnPart({ kind: 'muzzle', x: cx + Math.cos(t.angle) * 0.45, y: cy + Math.sin(t.angle) * 0.45, a: t.angle, ttl: 0.06, size: 0.2 });
    for (let i = 0; i < 3; i++) {
      const a = t.angle + Math.PI + (Math.random() - 0.5) * 1.6;
      spawnPart({ kind: 'spark', x: target.x, y: target.y - 0.1, vx: Math.cos(a) * (1 + Math.random() * 2), vy: Math.sin(a) * 2 - 1.2, ttl: 0.3, color: '#ffd27f' });
    }
  } else if (t.type === 'cannon') {
    let cdmg = s.dmg;
    if (t.spec === 'tungsten') cdmg *= 1.6;
    damage(target, cdmg, 'kinetic', t.spec === 'tungsten');
    if (t.spec === 'fire') target.vulnFire = 4;
    if (t.spec === 'shock') target.vulnShock = 4;
    shots.push({ kind: 'tracer', x1: cx, y1: cy, x2: target.x, y2: target.y, t: 0, ttl: 0.1, color: 'rgba(255,255,255,0.95)', w: 3 });
    spawnPart({ kind: 'muzzle', x: cx + Math.cos(t.angle) * 0.5, y: cy + Math.sin(t.angle) * 0.5, a: t.angle, ttl: 0.09, size: 0.3 });
    spawnPart({ kind: 'smoke', x: cx + Math.cos(t.angle) * 0.55, y: cy + Math.sin(t.angle) * 0.55, vx: Math.cos(t.angle) * 0.8, vy: -0.3, ttl: 0.6, size: 0.15 });
    for (let i = 0; i < 5; i++) {
      const a = t.angle + Math.PI + (Math.random() - 0.5) * 1.2;
      spawnPart({ kind: 'spark', x: target.x, y: target.y - 0.1, vx: Math.cos(a) * (1.5 + Math.random() * 2.5), vy: Math.sin(a) * 2.5 - 1.5, ttl: 0.35, color: '#fff0c0' });
    }
  } else if (t.type === 'grenade') {
    shots.push({ kind: 'lob', x: cx, y: cy, sx: cx, sy: cy, tx: target.x, ty: target.y, t: 0, ttl: 0.45, dmg: s.dmg, splash: s.splash });
    spawnPart({ kind: 'smoke', x: cx + Math.cos(t.angle) * 0.4, y: cy + Math.sin(t.angle) * 0.4, vx: 0, vy: -0.4, ttl: 0.5, size: 0.16 });
  } else if (t.type === 'rocket') {
    shots.push({ kind: 'rocket', x: cx, y: cy, target, speed: 7, dmg: s.dmg, splash: s.splash, angle: t.angle });
  }
}

function splashDamage(x, y, radius, dmg) {
  for (const e of enemies) {
    if (e.dead || e.escaped) continue;
    const d = Math.hypot(e.x - x, e.y - y);
    if (d <= radius + e.r) damage(e, dmg * clamp(1 - d / (radius + e.r) * 0.5, 0.5, 1), 'explosive');
  }
  shots.push({ kind: 'boom', x, y, r: radius, t: 0, ttl: 0.3 });
  // Druckwelle, Splitter und Rauch
  spawnPart({ kind: 'shock', x, y, r: radius * 1.25, ttl: 0.32 });
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * TAU, sp = 2 + Math.random() * 3.5;
    spawnPart({ kind: 'debris', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2.2, ttl: 0.45 + Math.random() * 0.3, rot: Math.random() * TAU });
  }
  for (let i = 0; i < 4; i++) {
    spawnPart({ kind: 'smoke', x: x + (Math.random() - 0.5) * radius, y: y + (Math.random() - 0.5) * radius, vx: (Math.random() - 0.5) * 0.4, vy: -0.5 - Math.random() * 0.4, ttl: 0.8 + Math.random() * 0.4, size: 0.2 + Math.random() * 0.14 });
  }
}

function stepShot(sh, dt) {
  sh.t = (sh.t || 0) + dt;
  if (sh.kind === 'tracer' || sh.kind === 'boom' || sh.kind === 'zap' || sh.kind === 'gust' || sh.kind === 'nuke') return sh.t >= sh.ttl;
  if (sh.kind === 'sbeam') {
    // Orbital-Laser: erst Zielmarkierung, nach 0,35s kracht der Strahl runter
    if (!sh.hit && sh.t >= 0.35) {
      sh.hit = true;
      for (const e of enemies) {
        if (e.dead || e.escaped) continue;
        if (Math.hypot(e.x - sh.x, e.y - sh.y) <= 1.2 + e.r) damage(e, 420, 'laser');
      }
      spawnPart({ kind: 'shock', x: sh.x, y: sh.y, r: 1.6, ttl: 0.35, color: '#cfe8ff' });
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * TAU, sp = 2 + Math.random() * 3;
        spawnPart({ kind: 'spark', x: sh.x, y: sh.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2, ttl: 0.4, color: '#dff0ff' });
      }
    }
    return sh.t >= sh.ttl;
  }
  if (sh.kind === 'pool') {
    // Giftpfütze: ätzt alle, die drin stehen
    for (const e of enemies) {
      if (e.dead || e.escaped) continue;
      if (Math.hypot(e.x - sh.x, e.y - sh.y) <= sh.r + e.r * 0.5) damage(e, sh.dps * dt, 'poison');
    }
    if (Math.random() < dt * 8) spawnPart({ kind: 'bubble', x: sh.x + (Math.random() - 0.5) * sh.r * 1.4, y: sh.y + (Math.random() - 0.5) * sh.r * 1.0, vx: 0, vy: -0.4, ttl: 0.5 });
    return sh.t >= sh.ttl;
  }
  if (sh.kind === 'glob') {
    const f = clamp(sh.t / sh.ttl, 0, 1);
    sh.x = sh.sx + (sh.tx - sh.sx) * f;
    sh.y = sh.sy + (sh.ty - sh.sy) * f - Math.sin(f * Math.PI) * 1.1;
    if (f >= 1) {
      shots.push({ kind: 'pool', x: sh.tx, y: sh.ty, r: sh.pool, dps: sh.dps, t: 0, ttl: sh.dur });
      for (let i = 0; i < 6; i++) spawnPart({ kind: 'spark', x: sh.tx, y: sh.ty, vx: (Math.random() - 0.5) * 2.4, vy: -Math.random() * 2, ttl: 0.3, color: '#a8e86a' });
      return true;
    }
    return false;
  }
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
    // Rauchspur hinter der Rakete
    if (Math.random() < dt * 45) spawnPart({ kind: 'smoke', x: sh.x - Math.cos(sh.angle) * 0.2, y: sh.y - Math.sin(sh.angle) * 0.2, vx: 0, vy: -0.25, ttl: 0.55, size: 0.1 });
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
    // brennende Gegner züngeln
    if (e.burnT > 0 && Math.random() < dt * 7) {
      spawnPart({ kind: 'flame', x: e.x + (Math.random() - 0.5) * e.r, y: e.y - e.r, vx: (Math.random() - 0.5) * 0.5, vy: -1.2, ttl: 0.3, size: 0.09 });
    }
    if (e.escaped) {
      game.lives -= e.boss ? 5 : 1;
      spawnPart({ kind: 'shock', x: e.x, y: e.y, r: 0.8, ttl: 0.4, color: '#ff5548' });
      if (game.lives <= 0) { game.lives = 0; gameOver(); }
    } else if (e.hp <= 0) {
      e.dead = true;
      game.money += e.bounty;
      shots.push({ kind: 'coin', x: e.x, y: e.y, t: 0, ttl: 0.6, v: e.bounty });
      // Todes-Pop: Ring + Konfetti in Gegnerfarbe
      spawnPart({ kind: 'pop', x: e.x, y: e.y, r: e.r * 2.4, ttl: 0.3, color: e.color });
      for (let i = 0; i < (e.boss ? 16 : 7); i++) {
        const a = Math.random() * TAU, sp = 1.5 + Math.random() * 2.5;
        spawnPart({ kind: 'spark', x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.5, ttl: 0.4 + Math.random() * 0.25, color: e.color });
      }
    }
  }
  enemies = enemies.filter((e) => !e.dead && !e.escaped);

  // Türme & Schüsse
  for (const t of towers) stepTower(t, dt);
  shots = shots.filter((sh) => !stepShot(sh, dt));

  // Deko-Partikel bewegen
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.t += dt;
    if (p.t >= p.ttl) { parts.splice(i, 1); continue; }
    if (p.vx !== undefined) { p.x += p.vx * dt; p.y += p.vy * dt; }
    if (p.kind === 'flame') { p.vy -= 1.4 * dt; p.vx *= 1 - dt * 1.5; }        // Flammen steigen auf
    else if (p.kind === 'spark' || p.kind === 'debris' || p.kind === 'shard') p.vy += 7 * dt;   // Funken/Splitter/Scherben fallen
    else if (p.kind === 'smoke') p.vy -= 0.4 * dt;                             // Rauch steigt
    else if (p.kind === 'snow') p.x += Math.sin(p.t * 4 + p.ph) * dt * 0.5;    // Schnee taumelt
    else if (p.kind === 'leaf') { p.vx *= 1 - dt * 2; p.vy = p.vy * (1 - dt * 2) + 1.2 * dt; }   // Blätter verwirbeln
    else if (p.kind === 'bubble') p.vy -= 0.2 * dt;                            // Giftblasen steigen
    if (p.rot !== undefined) p.rot += dt * 9;
  }

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

// ---- Superwaffen (Kommandozentrale) ----------------------------------------
function hasCommand() { return towers.some((t) => t.type === 'command'); }

function fireNuke() {
  game.nukeUsed = true;
  // Riesen-Flächenschlag auf ALLES, was gerade unterwegs ist. Panzerung
  // schluckt davon wie üblich das meiste – Bosse überleben den Blitz.
  shots.push({ kind: 'nuke', x: GC / 2, y: GR / 2, t: 0, ttl: 0.9 });
  for (const e of enemies) {
    if (e.dead || e.escaped) continue;
    damage(e, 260, 'explosive');
    spawnPart({ kind: 'shock', x: e.x, y: e.y, r: 1.0, ttl: 0.4, color: '#ffd8a0' });
  }
  // Pilzwolke über der Feldmitte
  for (let i = 0; i < 12; i++) {
    spawnPart({ kind: 'smoke', x: GC / 2 + (Math.random() - 0.5) * 3, y: GR / 2 + (Math.random() - 0.5) * 2,
      vx: (Math.random() - 0.5) * 0.5, vy: -0.9 - Math.random() * 0.7, ttl: 1.2 + Math.random() * 0.6, size: 0.3 + Math.random() * 0.25 });
  }
  game.banner = '☢️ NUKE!'; game.bannerT = 1.2;
  updateSupers();
}

function fireSlaser(x, y) {
  game.laserUsed = true;
  game.targeting = null;
  shots.push({ kind: 'sbeam', x, y, t: 0, ttl: 0.85, hit: false });
  updateSupers();
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
  // Wiese
  for (let y = 0; y < GR; y++) for (let x = 0; x < GC; x++) {
    ctx.fillStyle = (x + y) % 2 ? '#1d3a24' : '#1a3520';
    ctx.fillRect(x * T, y * T, T + 0.5, T + 0.5);
  }
  // Teiche (leicht schimmernd, mit Ufer)
  for (const k of POND) {
    const [x, y] = k.split(',').map(Number);
    ctx.fillStyle = '#2a5a7a';
    ctx.fillRect(x * T, y * T, T + 0.5, T + 0.5);
    ctx.fillStyle = `rgba(140,200,235,${0.16 + Math.sin(time * 1.6 + x * 2 + y) * 0.08})`;
    ctx.fillRect(x * T, y * T, T + 0.5, T + 0.5);
    ctx.fillStyle = 'rgba(220,240,255,0.35)';
    const wy = y * T + T * (0.3 + Math.sin(time * 2 + x * 3) * 0.1);
    ctx.fillRect(x * T + T * 0.15, wy, T * 0.35, 1.6);
    ctx.fillRect(x * T + T * 0.55, wy + T * 0.25, T * 0.28, 1.6);
  }
  // Pfad: Erde mit dunklem Rand + Kieseln
  for (const [x, y] of PATH) {
    ctx.fillStyle = (x + y) % 2 ? '#b39b6e' : '#a8905f';
    ctx.fillRect(x * T, y * T, T + 0.5, T + 0.5);
  }
  ctx.strokeStyle = 'rgba(70,52,30,0.55)'; ctx.lineWidth = 2;
  for (const [x, y] of PATH) {
    if (!isPath(x, y - 1)) { ctx.beginPath(); ctx.moveTo(x * T, y * T + 1); ctx.lineTo((x + 1) * T, y * T + 1); ctx.stroke(); }
    if (!isPath(x, y + 1)) { ctx.beginPath(); ctx.moveTo(x * T, (y + 1) * T - 1); ctx.lineTo((x + 1) * T, (y + 1) * T - 1); ctx.stroke(); }
    if (!isPath(x - 1, y)) { ctx.beginPath(); ctx.moveTo(x * T + 1, y * T); ctx.lineTo(x * T + 1, (y + 1) * T); ctx.stroke(); }
    if (!isPath(x + 1, y)) { ctx.beginPath(); ctx.moveTo((x + 1) * T - 1, y * T); ctx.lineTo((x + 1) * T - 1, (y + 1) * T); ctx.stroke(); }
    const h = tileHash(x, y);
    ctx.fillStyle = 'rgba(90,70,45,0.5)';
    for (let i = 0; i < 3; i++) {
      const px = x * T + ((h >> (i * 5)) % 80) / 100 * T + T * 0.1;
      const py = y * T + ((h >> (i * 7 + 3)) % 80) / 100 * T + T * 0.1;
      ctx.beginPath(); ctx.arc(px, py, T * 0.035, 0, TAU); ctx.fill();
    }
  }
  // Wiesen-Deko (deterministisch, unter den Türmen)
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let y = 0; y < GR; y++) for (let x = 0; x < GC; x++) {
    if (isPath(x, y) || isPond(x, y)) continue;
    const h = tileHash(x, y) % 100;
    const cx2 = x * T + T * (0.3 + (tileHash(x, y) >> 8) % 40 / 100);
    const cy2 = y * T + T * (0.3 + (tileHash(x, y) >> 12) % 40 / 100);
    if (h < 26) {           // Grasbüschel
      ctx.strokeStyle = '#2f5c36'; ctx.lineWidth = 1.4;
      const sway = Math.sin(time * 1.8 + x + y) * T * 0.03;
      ctx.beginPath();
      ctx.moveTo(cx2 - T * 0.06, cy2 + T * 0.08); ctx.lineTo(cx2 - T * 0.08 + sway, cy2 - T * 0.1);
      ctx.moveTo(cx2, cy2 + T * 0.08); ctx.lineTo(cx2 + sway, cy2 - T * 0.14);
      ctx.moveTo(cx2 + T * 0.06, cy2 + T * 0.08); ctx.lineTo(cx2 + T * 0.08 + sway, cy2 - T * 0.1);
      ctx.stroke();
    } else if (h < 36) {    // Blume
      ctx.font = (T * 0.3) + 'px system-ui';
      ctx.fillText(h % 2 ? '🌼' : '🌸', cx2, cy2);
    } else if (h < 44) {    // Stein
      ctx.fillStyle = '#4a5a58';
      ctx.beginPath(); ctx.ellipse(cx2, cy2, T * 0.11, T * 0.075, 0.4, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.beginPath(); ctx.ellipse(cx2 - T * 0.03, cy2 - T * 0.025, T * 0.05, T * 0.03, 0.4, 0, TAU); ctx.fill();
    } else if (h < 50) {    // Baum (klein, Türme bleiben sichtbar davor)
      ctx.font = (T * 0.52) + 'px system-ui';
      ctx.fillText(h % 2 ? '🌲' : '🌳', cx2, cy2);
    } else if (h < 54) {    // Pilz
      ctx.font = (T * 0.26) + 'px system-ui';
      ctx.fillText('🍄', cx2, cy2);
    }
  }
  // Start/Ziel
  ctx.font = (T * 0.7) + 'px system-ui';
  const [sx, sy] = PATH[0], [ex, ey] = PATH[PATH.length - 1];
  ctx.fillText('🕳', sx * T + T / 2, sy * T + T / 2);
  ctx.fillText('🏠', ex * T + T / 2, ey * T + T / 2);

  // gewählte Kachel + Reichweite
  if (game.sel) {
    const t = towerAt[game.sel.x + ',' + game.sel.y];
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(game.sel.x * T, game.sel.y * T, T, T);
    const range = t ? effStats(t).range : null;
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
  drawParts();
  ctx.restore();

  drawHUD();
}

function drawTower(t, time) {
  const def = TOWERS[t.type], s = effStats(t);
  const cx = (t.x + 0.5) * T, cy = (t.y + 0.5) * T;
  // Aufbau-Animation: kurz überschwingen, dann setzen
  const b = clamp((t.born ?? 1) / 0.35, 0, 1);
  const scale = b < 1 ? 0.2 + b * 1.0 - Math.sin(b * Math.PI) * -0.15 : 1;
  if (scale !== 1) { ctx.save(); ctx.translate(cx, cy); ctx.scale(scale, scale); ctx.translate(-cx, -cy); }
  // Schatten unter dem Turm
  ctx.globalAlpha = 0.3; ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.ellipse(cx + T * 0.04, cy + T * 0.3, T * 0.38, T * 0.15, 0, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
  // Sockel
  ctx.fillStyle = '#3a4a55';
  ctx.beginPath(); ctx.arc(cx, cy, T * 0.38, 0, TAU); ctx.fill();
  ctx.fillStyle = def.color;
  ctx.beginPath(); ctx.arc(cx, cy, T * 0.3, 0, TAU); ctx.fill();
  // Lauf mit Rückstoß (kickt beim Schuss nach hinten)
  if (!['ice', 'flame', 'wind', 'gold', 'command'].includes(t.type)) {
    const kick = (t.kick || 0) * T * 0.1;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(t.angle || 0);
    ctx.fillStyle = '#22303a';
    ctx.fillRect(-kick, -T * 0.08, T * 0.42, T * 0.16);
    ctx.restore();
  }
  // Kommandozentrale: Radar-Sweep + blinkendes Bereitschaftslicht
  if (t.type === 'command') {
    const ready = !game.nukeUsed || !game.laserUsed;
    ctx.save(); ctx.translate(cx, cy);
    ctx.strokeStyle = 'rgba(180,200,255,0.55)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(0, 0, T * 0.34, 0, TAU); ctx.stroke();
    ctx.rotate((t.pulse || 0) * 2.2);
    ctx.strokeStyle = 'rgba(140,220,120,0.8)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(T * 0.34, 0); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = ready && Math.sin(time * 6) > 0 ? '#7dff8a' : '#2a5a34';
    ctx.beginPath(); ctx.arc(cx + T * 0.26, cy - T * 0.26, T * 0.05, 0, TAU); ctx.fill();
  }
  // Windmaschine: rotierender Propeller
  if (t.type === 'wind') {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate((t.pulse || 0) * 5);
    ctx.strokeStyle = '#e8f6f2'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      ctx.rotate(TAU / 3);
      ctx.beginPath(); ctx.moveTo(T * 0.08, 0); ctx.lineTo(T * 0.3, 0); ctx.stroke();
    }
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
  // Feuerkegel-Bogen in Zielrichtung
  if (t.type === 'flame' && t.firing) {
    ctx.strokeStyle = `rgba(255,${120 + Math.sin(time * 20) * 60 | 0},40,0.5)`;
    ctx.lineWidth = 5;
    const fr = s.range * T * (0.75 + Math.sin(time * 9) * 0.08);
    ctx.beginPath(); ctx.arc(cx, cy, fr, (t.angle || 0) - s.cone, (t.angle || 0) + s.cone); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,150,60,0.25)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos((t.angle || 0) - s.cone) * fr, cy + Math.sin((t.angle || 0) - s.cone) * fr);
    ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos((t.angle || 0) + s.cone) * fr, cy + Math.sin((t.angle || 0) + s.cone) * fr); ctx.stroke();
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
  if (scale !== 1) ctx.restore();
}

// ---- Deko-Partikel zeichnen ----
function drawParts() {
  for (const p of parts) {
    const f = p.t / p.ttl;
    if (p.kind === 'flame') {
      const c = f < 0.35 ? '#ffe66e' : f < 0.7 ? '#ff9a3c' : '#d84a2a';
      ctx.globalAlpha = (1 - f) * 0.9;
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(p.x * T, p.y * T, p.size * T * (1 + f * 1.2), 0, TAU); ctx.fill();
    } else if (p.kind === 'muzzle') {
      ctx.globalAlpha = 1 - f;
      ctx.save(); ctx.translate(p.x * T, p.y * T); ctx.rotate(p.a);
      ctx.fillStyle = '#ffe66e';
      ctx.beginPath();
      ctx.moveTo(0, -p.size * T * 0.5); ctx.lineTo(p.size * T * 1.6, 0); ctx.lineTo(0, p.size * T * 0.5);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    } else if (p.kind === 'spark') {
      ctx.globalAlpha = 1 - f;
      ctx.fillStyle = p.color || '#ffd27f';
      ctx.fillRect(p.x * T - 1.6, p.y * T - 1.6, 3.2, 3.2);
    } else if (p.kind === 'shard') {
      ctx.globalAlpha = 1 - f;
      ctx.save(); ctx.translate(p.x * T, p.y * T); ctx.rotate(p.rot || 0);
      ctx.fillStyle = '#aab6c0';
      ctx.beginPath(); ctx.moveTo(0, -2.6); ctx.lineTo(2.2, 1.8); ctx.lineTo(-2.2, 1.8); ctx.closePath(); ctx.fill();
      ctx.restore();
    } else if (p.kind === 'debris') {
      ctx.globalAlpha = 1 - f;
      ctx.save(); ctx.translate(p.x * T, p.y * T); ctx.rotate(p.rot || 0);
      ctx.fillStyle = '#6a5238';
      ctx.fillRect(-2.2, -1.4, 4.4, 2.8);
      ctx.restore();
    } else if (p.kind === 'smoke') {
      ctx.globalAlpha = (1 - f) * (p.dust ? 0.4 : 0.32);
      ctx.fillStyle = p.dust ? '#b8a888' : '#9aa5ad';
      ctx.beginPath(); ctx.arc(p.x * T, p.y * T, (p.size || 0.14) * T * (1 + f * 1.6), 0, TAU); ctx.fill();
    } else if (p.kind === 'snow') {
      ctx.globalAlpha = (1 - f) * 0.85;
      ctx.fillStyle = '#dff2ff';
      ctx.beginPath(); ctx.arc(p.x * T, p.y * T, T * 0.05, 0, TAU); ctx.fill();
    } else if (p.kind === 'leaf') {
      ctx.globalAlpha = 1 - f;
      ctx.save(); ctx.translate(p.x * T, p.y * T); ctx.rotate(p.rot || 0);
      ctx.fillStyle = '#7ab84a';
      ctx.beginPath(); ctx.ellipse(0, 0, T * 0.08, T * 0.045, 0, 0, TAU); ctx.fill();
      ctx.restore();
    } else if (p.kind === 'bubble') {
      ctx.globalAlpha = (1 - f) * 0.8;
      ctx.strokeStyle = '#a8e86a'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(p.x * T, p.y * T, T * 0.055 * (1 + f), 0, TAU); ctx.stroke();
    } else if (p.kind === 'shock') {
      ctx.globalAlpha = 1 - f;
      ctx.strokeStyle = p.color || '#ffe2b0';
      ctx.lineWidth = Math.max(1, 4 * (1 - f));
      ctx.beginPath(); ctx.arc(p.x * T, p.y * T, p.r * T * (0.25 + f * 0.75), 0, TAU); ctx.stroke();
    } else if (p.kind === 'pop') {
      ctx.globalAlpha = 1 - f;
      ctx.strokeStyle = p.color || '#fff';
      ctx.lineWidth = Math.max(1, 3 * (1 - f));
      ctx.beginPath(); ctx.arc(p.x * T, p.y * T, p.r * T * (0.3 + f * 0.7), 0, TAU); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

function drawEnemy(e, time) {
  const cx = e.x * T, cy = e.y * T;
  const wob = Math.sin(time * 8 + e.wob) * T * 0.03;
  // Boss: pulsierende Bedrohungs-Aura
  if (e.boss) {
    ctx.globalAlpha = 0.25 + Math.sin(time * 5) * 0.12;
    ctx.fillStyle = '#d84a6a';
    ctx.beginPath(); ctx.arc(cx, cy, e.r * T * (1.5 + Math.sin(time * 5) * 0.18), 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }
  // Schatten am Boden
  ctx.globalAlpha = 0.28; ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.ellipse(cx, cy + e.r * T * 0.85, e.r * T * 0.9, e.r * T * 0.32, 0, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
  // Watschel-Gang: Körper staucht und streckt sich im Rhythmus
  const squash = 1 + Math.sin(time * 9 + e.wob) * 0.08 * (e.slowF > 0 ? 0.4 : 1);
  ctx.save();
  ctx.translate(cx, cy + wob);
  ctx.scale(2 - squash, squash);
  ctx.fillStyle = e.color;
  ctx.beginPath(); ctx.arc(0, 0, e.r * T, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.16)';   // Glanzlicht
  ctx.beginPath(); ctx.arc(-e.r * T * 0.3, -e.r * T * 0.35, e.r * T * 0.32, 0, TAU); ctx.fill();
  if (e.slowF > 0) { ctx.strokeStyle = 'rgba(140,220,255,0.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, e.r * T, 0, TAU); ctx.stroke(); }
  ctx.restore();
  // Panzerplatten (solange Rüstung intakt)
  if (e.armorHp > 0) {
    ctx.strokeStyle = '#b8c4cc'; ctx.lineWidth = Math.max(2, T * 0.09);
    ctx.beginPath(); ctx.arc(cx, cy + wob, e.r * T * 1.05, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#98a6b0';
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * TAU + 0.4;
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * e.r * T * 1.05, cy + wob + Math.sin(a) * e.r * T * 1.05, T * 0.045, 0, TAU); ctx.fill();
    }
  }
  // Verwundbarkeits-Markierungen (Spezialmunition)
  if (e.vulnFire > 0) { ctx.strokeStyle = 'rgba(255,140,50,0.9)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(cx, cy + wob, e.r * T * 1.35, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
  if (e.vulnShock > 0) { ctx.strokeStyle = 'rgba(120,180,255,0.9)'; ctx.setLineDash([2, 4]); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(cx, cy + wob, e.r * T * 1.5, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
  if (e.burnT > 0) { ctx.font = (T * 0.3) + 'px system-ui'; ctx.textAlign = 'center'; ctx.fillText('🔥', cx, cy - e.r * T - T * 0.12); }
  // Augen blicken in Laufrichtung
  const [pax, pay] = PATH[e.pathI], [pbx, pby] = PATH[Math.min(e.pathI + 1, PATH.length - 1)];
  const dx = Math.sign(pbx - pax), dy = Math.sign(pby - pay);
  const eox = dx * e.r * T * 0.22, eoy = dy * e.r * T * 0.22;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(cx - e.r * T * 0.32 + eox, cy + wob - e.r * T * 0.2 + eoy, e.r * T * 0.2, 0, TAU);
  ctx.arc(cx + e.r * T * 0.32 + eox, cy + wob - e.r * T * 0.2 + eoy, e.r * T * 0.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#0f1a12';
  ctx.beginPath();
  ctx.arc(cx - e.r * T * 0.32 + eox * 1.4, cy + wob - e.r * T * 0.2 + eoy * 1.4, e.r * T * 0.1, 0, TAU);
  ctx.arc(cx + e.r * T * 0.32 + eox * 1.4, cy + wob - e.r * T * 0.2 + eoy * 1.4, e.r * T * 0.1, 0, TAU);
  ctx.fill();
  // HP-Balken
  const w = e.r * T * 2.2;
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(cx - w / 2, cy - e.r * T - T * 0.16, w, T * 0.09);
  ctx.fillStyle = e.hp / e.maxHp > 0.4 ? '#7dc95e' : '#e05a4a';
  ctx.fillRect(cx - w / 2, cy - e.r * T - T * 0.16, w * clamp(e.hp / e.maxHp, 0, 1), T * 0.09);
  if (e.maxArmor > 0 && e.armorHp > 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(cx - w / 2, cy - e.r * T - T * 0.28, w, T * 0.07);
    ctx.fillStyle = '#c8d2da';
    ctx.fillRect(cx - w / 2, cy - e.r * T - T * 0.28, w * clamp(e.armorHp / e.maxArmor, 0, 1), T * 0.07);
  }
}

function drawShot(sh) {
  if (sh.kind === 'tracer') {
    ctx.strokeStyle = sh.color || 'rgba(255,240,180,0.9)'; ctx.lineWidth = sh.w || 1.5;
    ctx.beginPath(); ctx.moveTo(sh.x1 * T, sh.y1 * T); ctx.lineTo(sh.x2 * T, sh.y2 * T); ctx.stroke();
  } else if (sh.kind === 'zap') {
    // Kettenblitz: dreifacher Strahl (Glow, Kern, Weißglut), wildes Zittern,
    // kleine Verästelungen und grelle Blitzlichter an jedem Treffer
    const flick = Math.random() < 0.25 ? 0.4 : 1;   // Flackern
    ctx.globalAlpha = (1 - sh.t / sh.ttl) * flick;
    for (const w of [[8, 'rgba(120,170,255,0.28)'], [3.4, 'rgba(170,210,255,0.85)'], [1.4, '#ffffff']]) {
      ctx.strokeStyle = w[1]; ctx.lineWidth = w[0];
      ctx.beginPath();
      for (let i = 0; i < sh.pts.length - 1; i++) {
        const [x1, y1] = sh.pts[i], [x2, y2] = sh.pts[i + 1];
        ctx.moveTo(x1 * T, y1 * T);
        const segs = 6;
        for (let sgi = 1; sgi <= segs; sgi++) {
          const f = sgi / segs;
          const jx = sgi < segs ? (Math.random() - 0.5) * 0.34 : 0;
          const jy = sgi < segs ? (Math.random() - 0.5) * 0.34 : 0;
          ctx.lineTo((x1 + (x2 - x1) * f + jx) * T, (y1 + (y2 - y1) * f + jy) * T);
        }
      }
      ctx.stroke();
    }
    // Verästelungen: kurze Seitenblitze
    ctx.strokeStyle = 'rgba(190,220,255,0.7)'; ctx.lineWidth = 1;
    for (let i = 0; i < sh.pts.length - 1; i++) {
      if (Math.random() < 0.6) {
        const [x1, y1] = sh.pts[i], [x2, y2] = sh.pts[i + 1];
        const f = Math.random();
        const bx = (x1 + (x2 - x1) * f) * T, by = (y1 + (y2 - y1) * f) * T;
        const a = Math.random() * TAU;
        ctx.beginPath(); ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(a) * T * 0.35, by + Math.sin(a) * T * 0.35);
        ctx.lineTo(bx + Math.cos(a + 0.5) * T * 0.55, by + Math.sin(a + 0.5) * T * 0.55);
        ctx.stroke();
      }
    }
    // Blitzlicht an jedem getroffenen Gegner
    for (let i = 1; i < sh.pts.length; i++) {
      const [hx, hy] = sh.pts[i];
      ctx.fillStyle = 'rgba(220,240,255,0.8)';
      ctx.beginPath(); ctx.arc(hx * T, hy * T, T * 0.2 * (1 - sh.t / sh.ttl), 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (sh.kind === 'pool') {
    // Giftpfütze mit blubberndem Rand
    const a = clamp(sh.ttl - sh.t, 0, 1);
    ctx.globalAlpha = 0.45 * Math.min(1, a);
    ctx.fillStyle = '#5ab82a';
    ctx.beginPath(); ctx.ellipse(sh.x * T, sh.y * T, sh.r * T, sh.r * T * 0.7, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.7 * Math.min(1, a);
    ctx.strokeStyle = '#8ce84a'; ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (sh.kind === 'glob') {
    // Schatten am Boden + Flasche im Flug
    const f = clamp(sh.t / sh.ttl, 0, 1);
    const gy = sh.sy + (sh.ty - sh.sy) * f;
    ctx.globalAlpha = 0.25; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(sh.x * T, gy * T + T * 0.1, T * 0.1, T * 0.05, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#8ad84a';
    ctx.beginPath(); ctx.arc(sh.x * T, sh.y * T, T * 0.11, 0, TAU); ctx.fill();
  } else if (sh.kind === 'gust') {
    // Windstoß: expandierende Doppelringe
    const f = sh.t / sh.ttl;
    ctx.globalAlpha = (1 - f) * 0.6;
    ctx.strokeStyle = '#cfeee8'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(sh.x * T, sh.y * T, sh.r * T * (0.3 + f * 0.7), 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(sh.x * T, sh.y * T, sh.r * T * Math.max(0, f - 0.18), 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (sh.kind === 'lob') {
    // Schatten am Boden, Granate rotiert im Bogenflug
    const f = clamp(sh.t / sh.ttl, 0, 1);
    const gy = sh.sy + (sh.ty - sh.sy) * f;
    ctx.globalAlpha = 0.25; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(sh.x * T, gy * T + T * 0.1, T * 0.1, T * 0.05, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.save(); ctx.translate(sh.x * T, sh.y * T); ctx.rotate(f * 9);
    ctx.fillStyle = '#333';
    ctx.beginPath(); ctx.arc(0, 0, T * 0.12, 0, TAU); ctx.fill();
    ctx.fillStyle = '#666'; ctx.fillRect(-T * 0.02, -T * 0.17, T * 0.04, T * 0.07);
    ctx.restore();
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
  } else if (sh.kind === 'nuke') {
    // Nuke: greller Blitz übers ganze Feld + Druckwellenring
    const f = sh.t / sh.ttl;
    ctx.fillStyle = `rgba(255,240,200,${0.7 * (1 - f)})`;
    ctx.fillRect(-OX, -OY, CW, CH);
    ctx.globalAlpha = 1 - f;
    ctx.strokeStyle = '#ffb24d'; ctx.lineWidth = 3 + 8 * (1 - f);
    ctx.beginPath(); ctx.arc(sh.x * T, sh.y * T, f * GC * T * 0.75, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (sh.kind === 'sbeam') {
    const x = sh.x * T, y = sh.y * T;
    if (sh.t < 0.35) {
      // rotes Zielkreuz zieht sich zusammen
      const g = sh.t / 0.35;
      ctx.strokeStyle = `rgba(255,90,60,${0.45 + g * 0.5})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, T * (1.3 - g * 0.75), 0, TAU); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - T * 0.5, y); ctx.lineTo(x + T * 0.5, y);
      ctx.moveTo(x, y - T * 0.5); ctx.lineTo(x, y + T * 0.5);
      ctx.stroke();
    } else {
      // Strahl aus dem Orbit: breite Säule + weißglühender Kern + Aufschlag
      const b = 1 - (sh.t - 0.35) / (sh.ttl - 0.35);
      ctx.globalAlpha = Math.min(1, b * 1.4);
      ctx.fillStyle = 'rgba(150,215,255,0.55)';
      ctx.fillRect(x - T * 0.55 * b, -OY, T * 1.1 * b, y + OY);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - T * 0.16 * b, -OY, T * 0.32 * b, y + OY);
      ctx.beginPath(); ctx.arc(x, y, T * 0.95 * b, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
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

  if (game.targeting === 'slaser') {
    ctx.fillStyle = '#ff8a6a'; ctx.font = 'bold 14px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('🛰️ Ziel fürs Orbital-Laser antippen!', CW / 2, OY - 10);
  }

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
  if (towerAt[k] || isPath(game.sel.x, game.sel.y) || isPond(game.sel.x, game.sel.y)) return;
  game.money -= cost;
  const t = { type, lvl: 0, x: game.sel.x, y: game.sel.y, cd: 0, angle: 0, born: 0 };
  towers.push(t);
  towerAt[k] = t;
  buildDust(t);
  updateSupers();
  showUpgpanel(t);
}

// Staubwölkchen beim Bauen
function buildDust(t) {
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * TAU;
    spawnPart({ kind: 'smoke', x: t.x + 0.5 + Math.cos(a) * 0.25, y: t.y + 0.75, vx: Math.cos(a) * 1.1, vy: -0.3 - Math.random() * 0.4, ttl: 0.5 + Math.random() * 0.25, size: 0.12 + Math.random() * 0.08, dust: true });
  }
}

function sellValue(t) {
  let paid = 0;
  for (let i = 0; i <= t.lvl; i++) paid += TOWERS[t.type].levels[i].cost;
  return Math.round(paid * 0.7);
}

function showUpgpanel(t) {
  buildbar.classList.add('hidden');
  const def = TOWERS[t.type], s = effStats(t);
  const next = def.levels[t.lvl + 1];
  const info = document.getElementById('upg-info');
  const statBits = [];
  if (s.dmg) statBits.push('Schaden ' + Math.round(s.dmg));
  if (s.dps) statBits.push('Schaden ' + s.dps + '/s');
  if (s.rate && t.type !== 'gift') statBits.push(s.rate + ' Schuss/s');
  if (s.slow) statBits.push('-' + Math.round(s.slow * 100) + '% Tempo');
  if (s.splash) statBits.push('Fläche ' + s.splash);
  if (s.burn) statBits.push('+' + s.burn + '/s Brand');
  if (s.chain) statBits.push(s.chain + ' Kettenziele');
  if (s.cone) statBits.push('Kegel ' + Math.round(s.cone * 2 * 180 / Math.PI) + '°');
  if (s.gold) statBits.push('+' + s.gold + ' 💰 alle ' + s.interval + ' s');
  if (s.range) statBits.push('Reichweite ' + (Math.round(s.range * 10) / 10));
  if (t.type === 'command') statBits.push('☢️ + 🛰️ freigeschaltet');
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
    updateSupers();
    hidePanels();
  };
  renderSpecs(t);
  upgpanel.classList.remove('hidden');
}
// Spezialisierung: einmalige, exklusive Entweder-oder-Wahl pro Turm
function renderSpecs(t) {
  const box = document.getElementById('upg-ammo');
  const list = SPECS[t.type];
  if (!list) { box.classList.add('hidden'); return; }
  box.innerHTML = '';
  if (t.spec) {
    const a = list.find((o) => o.key === t.spec);
    const div = document.createElement('div');
    div.className = 'ammo-chosen';
    div.textContent = `${a.icon} ${a.name} gewählt – ${a.desc}`;
    box.appendChild(div);
  } else {
    for (const a of list) {
      const b = document.createElement('button');
      b.className = 'ammo-btn';
      b.textContent = `${a.icon} ${a.name} (${a.cost} 💰)`;
      b.title = a.desc;
      b.disabled = game.money < a.cost;
      b.addEventListener('click', () => {
        if (game.money < a.cost || t.spec) return;
        game.money -= a.cost;
        t.spec = a.key;
        showUpgpanel(t);   // Stats & Anzeige auffrischen
      });
      box.appendChild(b);
    }
  }
  box.classList.remove('hidden');
}
document.getElementById('upg-close').addEventListener('click', hidePanels);

// Schwierigkeit umschalten (startet neues Spiel)
for (const key of ['leicht', 'normal', 'schwer']) {
  document.getElementById('diff-' + key).addEventListener('click', () => {
    DIFF = DIFFS[key];
    for (const k2 of ['leicht', 'normal', 'schwer']) document.getElementById('diff-' + k2).classList.toggle('active', k2 === key);
    menuEl.classList.add('hidden');
    newGame();
  });
}

canvas.addEventListener('pointerdown', (e) => {
  if (game.state === 'over') { newGame(); return; }
  if (game.targeting === 'slaser') {
    const rr = canvas.getBoundingClientRect();
    const wx = (e.clientX - rr.left - OX) / T, wy = (e.clientY - rr.top - OY) / T;
    if (wx >= 0 && wx < GC && wy >= 0 && wy < GR) fireSlaser(wx, wy);
    else { game.targeting = null; updateSupers(); }
    return;
  }
  const r = canvas.getBoundingClientRect();
  const gx = Math.floor((e.clientX - r.left - OX) / T);
  const gy = Math.floor((e.clientY - r.top - OY) / T);
  if (gx < 0 || gx >= GC || gy < 0 || gy >= GR) { hidePanels(); return; }
  const k = gx + ',' + gy;
  game.sel = { x: gx, y: gy };
  if (towerAt[k]) showUpgpanel(towerAt[k]);
  else if (!isPath(gx, gy) && !isPond(gx, gy)) showBuildbar();
  else hidePanels();
});

// ---- Toolbar ---------------------------------------------------------------
const speedBtn = document.getElementById('btn-speed');
function updateSpeedBtn() { speedBtn.textContent = '⏩' + game.speed + '×'; }
speedBtn.addEventListener('click', () => {
  game.speed = game.speed === 1 ? 2 : game.speed === 2 ? 3 : game.speed === 3 ? 5 : 1;
  updateSpeedBtn();
});
document.getElementById('btn-wave').addEventListener('click', () => { if (game.state === 'build') startWave(); });

const nukeBtn = document.getElementById('btn-nuke');
const slaserBtn = document.getElementById('btn-slaser');
function updateSupers() {
  const has = hasCommand();
  nukeBtn.classList.toggle('hidden', !has);
  slaserBtn.classList.toggle('hidden', !has);
  nukeBtn.disabled = game.nukeUsed;
  slaserBtn.disabled = game.laserUsed || game.targeting === 'slaser';
}
nukeBtn.addEventListener('click', () => {
  if (!hasCommand() || game.nukeUsed || game.state === 'over') return;
  fireNuke();
});
slaserBtn.addEventListener('click', () => {
  if (!hasCommand() || game.laserUsed || game.state === 'over') return;
  game.targeting = 'slaser';
  updateSupers();
});

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
  TOWERS, SPECS, PATH, isPath, startWave, newGame, update, effStats, fireNuke, fireSlaser,
  get shots() { return shots; },
  place(type, x, y) {
    const k = x + ',' + y;
    if (towerAt[k] || isPath(x, y) || isPond(x, y)) return null;
    const cost = TOWERS[type].levels[0].cost;
    if (game.money < cost) return null;
    game.money -= cost;
    const t = { type, lvl: 0, x, y, cd: 0, angle: 0, born: 0 };
    towers.push(t); towerAt[k] = t;
    buildDust(t);
    updateSupers();
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
