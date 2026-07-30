// Raupen · Caterpillars – rundenbasiertes Artillerie-Spiel.
// 2D-Seitenansicht, prozedural erzeugtes, zerstörbares Gelände. Lokal als
// Hotseat (Handy weiterreichen) oder online: der Host simuliert autoritativ
// und schickt Snapshots, Gäste schicken nur ihre Eingaben (siehe net-Block).

import { makeNet } from './netclient.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---- Welt ------------------------------------------------------------------
const WORLD_W = 1600, WORLD_H = 640, WATERLINE = 600;
const GRAV = 520;              // px/s²
let mask;                       // Uint8Array: 1 = fester Grund
let terrainCanvas, terrainCtx, terrainImage;
let waveT = 0;

function idx(x, y) { return y * WORLD_W + x; }
function solidAt(x, y) {
  const ix = x | 0, iy = y | 0;
  if (ix < 0 || ix >= WORLD_W || iy < 0 || iy >= WORLD_H) return false;
  return mask[idx(ix, iy)] === 1;
}

// deterministisches Wert-Rauschen für die Geländeerzeugung
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

function generateTerrain(seed) {
  mask = new Uint8Array(WORLD_W * WORLD_H);
  const r = rng(seed);
  // Höhenprofil aus mehreren Sinus-Oktaven
  const base = 320 + r() * 60;
  const oct = [];
  for (let i = 0; i < 5; i++) {
    oct.push({ amp: (70 / (i + 1)) * (0.6 + r()), freq: (i + 1) * 0.9 / WORLD_W * TAU, ph: r() * TAU });
  }
  const height = new Float32Array(WORLD_W);
  for (let x = 0; x < WORLD_W; x++) {
    let h = base;
    for (const o of oct) h += o.amp * Math.sin(x * o.freq + o.ph);
    height[x] = h;
  }
  for (let x = 0; x < WORLD_W; x++) {
    const top = Math.max(60, Math.min(WATERLINE - 10, height[x] | 0));
    for (let y = top; y < WORLD_H; y++) mask[idx(x, y)] = 1;
  }
  // ein paar schwebende Plattformen / Höhlen für Abwechslung
  const holes = 6 + (r() * 6 | 0);
  for (let i = 0; i < holes; i++) {
    const cx = (r() * WORLD_W) | 0, cy = (200 + r() * 300) | 0, rad = 30 + r() * 60;
    carveCircle(cx, cy, rad, false);
  }
  // Das Land reicht bis an die Kartenränder – seitlich fällt niemand raus,
  // ins Wasser geht es nur durch Löcher, die bis ganz nach unten reichen.
  buildTerrainCanvas();
}

function buildTerrainCanvas() {
  terrainCanvas = document.createElement('canvas');
  terrainCanvas.width = WORLD_W; terrainCanvas.height = WORLD_H;
  terrainCtx = terrainCanvas.getContext('2d');
  terrainImage = terrainCtx.createImageData(WORLD_W, WORLD_H);
  recolorRegion(0, 0, WORLD_W, WORLD_H);
  terrainCtx.putImageData(terrainImage, 0, 0);
}

// färbt eine Region aus der Maske ein (Gras oben, Erde darunter)
function recolorRegion(x0, y0, x1, y1) {
  x0 = clamp(x0 | 0, 0, WORLD_W); x1 = clamp(x1 | 0, 0, WORLD_W);
  y0 = clamp(y0 | 0, 0, WORLD_H); y1 = clamp(y1 | 0, 0, WORLD_H);
  const d = terrainImage.data;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = idx(x, y), p = i * 4;
      if (mask[i] !== 1) { d[p + 3] = 0; continue; }
      // Abstand zur Luft nach oben bestimmt Gras/Erde und die Tiefenschattierung
      let airDist = 25;
      for (let k = 1; k <= 24; k++) { if (y - k < 0 || mask[idx(x, y - k)] !== 1) { airDist = k; break; } }
      const nz = ((x * 13 + y * 7) % 17) / 17 * 14;
      // dunkle Kontur, wo Land seitlich/unten an Luft grenzt (Comic-Outline)
      const edge = (x > 0 && !mask[idx(x - 1, y)]) || (x < WORLD_W - 1 && !mask[idx(x + 1, y)]) ||
        (y < WORLD_H - 1 && !mask[idx(x, y + 1)]);
      if (edge && airDist > 2) { d[p] = 62; d[p + 1] = 46; d[p + 2] = 30; d[p + 3] = 255; continue; }
      if (airDist <= 2) { d[p] = 128 + nz; d[p + 1] = 196 + nz; d[p + 2] = 88; }        // Gras-Highlight
      else if (airDist <= 6) { d[p] = 88 + nz; d[p + 1] = 150 + nz; d[p + 2] = 60; }    // sattes Gras
      else {
        // Erde: wird mit der Tiefe dunkler, mit Steinchen-Sprenkeln
        const depth = Math.min(1, (airDist - 6) / 60) * 34;
        const stone = ((((x * 73856093) ^ (y * 19349663)) >>> 0) % 223) < 4;
        if (stone) { const s = 118 + nz; d[p] = s; d[p + 1] = s - 8; d[p + 2] = s - 14; }
        else { d[p] = 124 + nz - depth; d[p + 1] = 88 + nz * 0.6 - depth * 0.7; d[p + 2] = 56 - depth * 0.5; }
      }
      d[p + 3] = 255;
    }
  }
}

function carveCircle(cx, cy, rad, rebuild = true) {
  const r2 = rad * rad;
  const x0 = clamp(cx - rad, 0, WORLD_W), x1 = clamp(cx + rad, 0, WORLD_W);
  const y0 = clamp(cy - rad, 0, WORLD_H), y1 = clamp(cy + rad, 0, WORLD_H);
  for (let y = y0 | 0; y < y1; y++) {
    for (let x = x0 | 0; x < x1; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r2) mask[idx(x, y)] = 0;
    }
  }
  // Online: der Host merkt sich jeden Krater und schickt ihn an die Gäste,
  // damit ihr Gelände identisch zerstört wird (rebuild=false = Terrain-Gen).
  if (rebuild && net.on && net.host) net.craters.push({ x: cx | 0, y: cy | 0, r: Math.round(rad) });
  if (rebuild && terrainImage) {
    recolorRegion(cx - rad - 6, cy - rad - 6, cx + rad + 6, cy + rad + 6);
    terrainCtx.putImageData(terrainImage, 0, 0);
  }
}

// ---- Teams & Würmer --------------------------------------------------------
const TEAM_COLORS = ['#e0453e', '#3d8ee0', '#3fb14e', '#e0a92e', '#9b59b6', '#1abc9c'];
const TEAM_NAMES = ['Rot', 'Blau', 'Grün', 'Gelb', 'Lila', 'Türkis'];
const WORM_NAMES = ['Kalle', 'Rudi', 'Emma', 'Fritz', 'Berta', 'Otto', 'Lotti', 'Egon',
  'Hilde', 'Kurt', 'Wanda', 'Bruno', 'Gundi', 'Manni', 'Resi', 'Ferdi', 'Olga', 'Heinz',
  'Trudi', 'Sepp', 'Mia', 'Balu', 'Nala', 'Pepe'];
let teams = [];
let cfg = { teamCount: 2, wormCount: 3 };

function surfaceY(x) {
  for (let y = 40; y < WATERLINE; y++) if (solidAt(x, y)) return y;
  return WATERLINE;
}

function spawnTeams() {
  teams = [];
  const spots = [];
  const n = cfg.teamCount * cfg.wormCount;
  for (let i = 0; i < n; i++) {
    let x, tries = 0;
    do { x = 80 + Math.random() * (WORLD_W - 160); tries++; }
    while (tries < 40 && spots.some((s) => Math.abs(s - x) < 70));
    spots.push(x);
  }
  const namePool = WORM_NAMES.slice().sort(() => Math.random() - 0.5);
  let np = 0;
  let s = 0;
  for (let t = 0; t < cfg.teamCount; t++) {
    const worms = [];
    for (let w = 0; w < cfg.wormCount; w++) {
      const x = spots[s++];
      const y = surfaceY(x | 0) - 8;
      const name = namePool[np++ % namePool.length];
      worms.push({ x, y, vx: 0, vy: 0, hp: 100, alive: true, facing: 1, team: t, grounded: false, fall: 0, crawl: Math.random() * TAU, name });
    }
    teams.push({ color: TEAM_COLORS[t], name: TEAM_NAMES[t], worms, cur: 0, ammoUsed: {} });
  }
}

// ---- Spielzustand ----------------------------------------------------------
const game = {
  state: 'aim',      // aim | busy | switch | over | pilot
  turnTeam: 0,
  active: null,
  wind: 0,
  aim: 0.6,          // Zielwinkel (positiv = nach oben)
  power: 0,
  charging: false,
  weaponIdx: 0,
  timer: 45,
  banner: '', bannerT: 0,
  winner: null,
  fireDone: false,
  settleT: 0,
  busyT: 0,
  actionBusy: false,
};

const projectiles = [];
const particles = [];

// Grabsteine gefallener Raupen (rein visuell, plumpsen rein und bleiben)
const graves = [];

// Wer hat in diesem Zug wie viel abbekommen? (für die Kamera-Tour danach)
const hitLog = [];
let lastBoom = null;
function logHit(wm, amt) {
  const e = hitLog.find((h) => h.wm === wm);
  if (e) e.amt += amt; else hitLog.push({ wm, amt });
}

// Comic-Wolken: treiben gemächlich mit dem Wind über den Himmel
const clouds = [];
for (let i = 0; i < 6; i++) {
  clouds.push({ x: Math.random() * WORLD_W, y: 30 + Math.random() * 170, s: 0.7 + Math.random() * 0.9, spd: 4 + Math.random() * 8 });
}

// ---- Waffen ----------------------------------------------------------------
// Jede Waffe: name, icon, ammo, endsTurn, fire(worm). Projektil-Typen steuern
// Flug/Explosion. Namen bewusst eigenständig (kein geschütztes Original).
const WEAPONS = [
  { key: 'panzer', name: 'Panzerfaust', icon: '🚀', ammo: Infinity, aimed: true,
    fire: (w) => launch(w, 'rocket', 720, { r: 34, dmg: 48, wind: 2.5 }) },
  { key: 'granate', name: 'Splittergranate', icon: '💣', ammo: Infinity, aimed: true, retreat: true,
    fire: (w) => launch(w, 'grenade', 620, { r: 36, dmg: 46, fuse: 3, bounce: 0.55, wind: 0.5 }) },
  { key: 'schrot', name: 'Schrotflinte', icon: '🔫', ammo: Infinity, aimed: true, hitscan: true,
    fire: (w) => shotgun(w) },
  { key: 'mp', name: 'MP (Uzi)', icon: '🔩', ammo: Infinity, aimed: true, hitscan: true,
    fire: (w) => uzi(w) },
  { key: 'dynamit', name: 'Dynamit', icon: '🧨', ammo: 3, aimed: false, retreat: 4, tap: true,
    fire: (w) => drop(w, 'dynamite', { r: 52, dmg: 62, fuse: 5 }) },
  { key: 'sniper', name: 'Scharfschütze', icon: '🔭', ammo: 2, aimed: true, hitscan: true,
    fire: (w) => sniper(w) },
  { key: 'gum', name: 'Kaugummikanone', icon: '🍬', ammo: 3, aimed: true,
    fire: (w) => launch(w, 'gum', 620, { r: 20, dmg: 12, wind: 0.4 }) },
  { key: 'cluster', name: 'Streubombe', icon: '🍒', ammo: 2, aimed: true, retreat: true,
    fire: (w) => launch(w, 'cluster', 640, { r: 24, dmg: 26, fuse: 3, bounce: 0.5, wind: 1, cluster: 6 }) },
  { key: 'banane', name: 'Bananenbombe', icon: '🍌', ammo: 1, aimed: true, retreat: true,
    fire: (w) => launch(w, 'banana', 640, { r: 30, dmg: 30, fuse: 3, bounce: 0.65, wind: 0.8,
      cluster: 5, clusterType: 'banana', clusterR: 32, clusterDmg: 38 }) },
  { key: 'maulwurf', name: 'Maulwurfsbombe', icon: '🕳️', ammo: 3, aimed: true, retreat: true,
    fire: (w) => launch(w, 'mole', 620, { r: 85, dmg: 10, fuse: 3, bounce: 0.4, wind: 0.5, knock: 90 }) },
  { key: 'luft', name: 'Luftangriff', icon: '✈️', ammo: 1, aimed: true,
    fire: (w) => airstrike(w) },
  { key: 'schubs', name: 'Schubser', icon: '👉', ammo: Infinity, aimed: false, melee: true,
    fire: (w) => prod(w) },
  { key: 'allmacht', name: 'Allmachtsgranate', icon: '✨', ammo: 1, aimed: true, retreat: true,
    fire: (w) => launch(w, 'grenade', 600, { r: 100, dmg: 115, fuse: 3.5, bounce: 0.45, wind: 0.5, holy: 1 }) },
  { key: 'brenner', name: 'Schweißbrenner', icon: '🔥', ammo: Infinity, aimed: true, endsTurn: true,
    fire: (w) => blowtorch(w) },
  { key: 'bat', name: 'Baseballschläger', icon: '🏏', ammo: Infinity, aimed: true, melee: true,
    fire: (w) => bat(w) },
  { key: 'schaf', name: 'Explosivschaf', icon: '🐑', ammo: 2, aimed: false, retreat: true,
    fire: (w) => dropSheep(w) },
  { key: 'minigun', name: 'Minigun', icon: '🌀', ammo: 3, aimed: true, hitscan: true,
    fire: (w) => minigun(w) },
];

function curWeapon() { return WEAPONS[game.weaponIdx]; }

function launch(w, type, speed, opt) {
  const a = game.aim;
  const dir = w.facing;
  const vx = dir * Math.cos(a) * speed * game.power;
  const vy = -Math.sin(a) * speed * game.power;
  const mx = w.x + dir * 12, my = w.y - 10;
  projectiles.push({ type, x: mx, y: my, vx, vy, t: 0, ...opt });
}

function drop(w, type, opt) {
  projectiles.push({ type, x: w.x, y: w.y - 4, vx: 0, vy: -20, t: 0, ...opt });
}

function hitscanRay(x, y, dirx, diry, maxDist) {
  for (let d = 0; d < maxDist; d += 2) {
    const px = x + dirx * d, py = y + diry * d;
    if (px < 0 || px > WORLD_W || py > WATERLINE) return { x: px, y: py, hit: 'edge', d };
    if (solidAt(px, py)) return { x: px, y: py, hit: 'ground', d };
    for (const wm of allWorms()) {
      // Treffer gegen die Körpermitte (wm.y ist der Fußpunkt, Körper ~11 px hoch),
      // großzügiger Radius, damit horizontale Schüsse nicht drüberfliegen.
      if (wm.alive && wm !== game.active) {
        const dx = px - wm.x, dy = py - (wm.y - 6);
        if (dx * dx + dy * dy < 144) return { x: px, y: py, hit: wm, d };
      }
    }
  }
  return { x: x + dirx * maxDist, y: y + diry * maxDist, hit: null, d: maxDist };
}

function shotgun(w) {
  const a = game.aim, dir = w.facing;
  const dirx = dir * Math.cos(a), diry = -Math.sin(a);
  const res = hitscanRay(w.x + dir * 12, w.y - 8, dirx, diry, 900);
  spawnTracer(w.x + dir * 12, w.y - 8, res.x, res.y);
  // trifft ein Wurm -> Volltreffer; sonst Krater ins Gelände
  const onWorm = res.hit && res.hit !== 'edge' && res.hit !== 'ground';
  explode(res.x, res.y, onWorm ? 22 : 18, onWorm ? 40 : 26, res.hit === 'ground');
  game.shotgunShots = (game.shotgunShots || 0) + 1;
  if (game.shotgunShots < 2) { game.fireDone = false; return 'more'; }
  game.shotgunShots = 0;
}

function uzi(w) {
  const dir = w.facing;
  game.actionBusy = true; // hält die Runde, bis die Salve durch ist
  let n = 0;
  const iv = setInterval(() => {
    if (n >= 8) { clearInterval(iv); game.actionBusy = false; return; }
    const a = game.aim + (Math.random() - 0.5) * 0.12;
    const dirx = dir * Math.cos(a), diry = -Math.sin(a);
    const res = hitscanRay(w.x + dir * 12, w.y - 10, dirx, diry, 800);
    spawnTracer(w.x + dir * 12, w.y - 10, res.x, res.y);
    if (res.hit && res.hit !== 'edge') explode(res.x, res.y, 7, 9, res.hit === 'ground');
    n++;
  }, 70);
}

function blowtorch(w) {
  const dir = w.facing;
  // Bohrwinkel aus der Zielhilfe: auch schräg nach oben oder unten graben
  const ang = clamp(game.aim, -0.9, 0.9);
  const dx = dir * Math.cos(ang), dy = -Math.sin(ang);
  game.actionBusy = true;     // hält die Runde, bis der Tunnel gegraben ist
  let step = 0;
  const iv = setInterval(() => {
    if (step >= 22 || !w.alive) { clearInterval(iv); game.actionBusy = false; return; }
    // Der Bohrkopf sitzt IMMER direkt vor der Raupe – wo auch immer sie
    // gerade ist. Der Tunnel beginnt damit garantiert am Wurm, und der
    // Vortrieb ist konstant 6 px pro Tick (keine Beschleunigung möglich).
    const px = w.x + dx * 12, py = (w.y - 6) + dy * 12;
    carveCircle(px | 0, py | 0, 12);
    for (const wm of allWorms()) if (wm.alive && wm !== w && Math.hypot(px - wm.x, py - wm.y) < 16) damage(wm, 6, dx * 60, -40);
    w.x = clamp(w.x + dx * 6, 4, WORLD_W - 4);
    w.y += dy * 6;
    w.vx = 0; w.vy = 0;
    particles.push({ kind: 'spark', x: px, y: py, vx: (Math.random() - 0.5) * 130, vy: -Math.random() * 110, t: 0, ttl: 0.3 });
    step++;
  }, 45);
}

// Baseballschläger: Nahkampf – trifft Raupen direkt vor sich und schlägt sie
// kräftig in Zielrichtung weg (gern ins Wasser!).
function bat(w) {
  const a = game.aim, dir = w.facing;
  const dirx = dir * Math.cos(a), diry = -Math.sin(a);
  const hx = w.x + dirx * 22, hy = (w.y - 6) + diry * 22;
  let hit = false;
  for (const wm of allWorms()) {
    if (!wm.alive || wm === w) continue;
    if (Math.hypot(wm.x - hx, (wm.y - 6) - hy) < 30) {
      damage(wm, 18, dirx * 380, diry * 300 - 100);   // Schaden + ordentlicher Schlag
      hit = true;
    }
  }
  spawnTracer(w.x + dir * 6, w.y - 8, w.x + dirx * 36, w.y - 8 + diry * 36);
  for (let i = 0; i < 6; i++) particles.push({ kind: 'spark', x: hx, y: hy, vx: (Math.random() - 0.5) * 120, vy: -Math.random() * 120, t: 0, ttl: 0.3 });
  if (!hit) game.banner = 'Daneben!', game.bannerT = 0.8;
}

// Schubser: der sanfteste Angriff der Welt – 1 Schaden, kleiner Stups.
// Perfekt, um jemanden von der Kante (oder ins frisch gegrabene Loch) zu
// schieben, ohne selbst Dreck aufzuwirbeln.
function prod(w) {
  const dir = w.facing;
  const hx = w.x + dir * 14, hy = w.y - 6;
  let hit = false;
  for (const wm of allWorms()) {
    if (!wm.alive || wm === w) continue;
    if (Math.hypot(wm.x - hx, (wm.y - 6) - hy) < 26) {
      damage(wm, 1, dir * 150, -60);
      hit = true;
    }
  }
  spawnTracer(w.x + dir * 6, w.y - 8, w.x + dir * 20, w.y - 8);
  if (!hit) game.banner = 'Ins Leere geschubst!', game.bannerT = 0.8;
}

// Luftangriff: die Zielhilfe bestimmt den Einschlagspunkt (wo der Strahl
// aufs Gelände trifft), dann fliegt ein Flugzeug ein und legt dort einen
// Teppich aus fünf Bomben.
function airstrike(w) {
  const a = game.aim, dir = w.facing;
  const res = hitscanRay(w.x + dir * 12, w.y - 10, dir * Math.cos(a), -Math.sin(a), 2200);
  const tx = clamp(res.x, 40, WORLD_W - 40);
  particles.push({ kind: 'plane', x: tx - dir * 340, y: 46, vx: dir * 280, dir, t: 0, ttl: 2.6 });
  for (let i = 0; i < 5; i++) {
    projectiles.push({ type: 'abomb', x: tx + dir * (i - 2) * 26, y: -24 - i * 20,
      vx: dir * 55, vy: 130, t: 0, r: 28, dmg: 30, wind: 0.5 });
  }
}

// Explosivschaf: hüpft in Blickrichtung los und explodiert bei Kontakt mit
// einer Raupe (oder nach Ablauf der Zündschnur).
function dropSheep(w) {
  projectiles.push({ type: 'sheep', x: w.x + w.facing * 14, y: w.y - 10, vx: w.facing * 70, vy: -60, t: 0, dir: w.facing, r: 46, dmg: 62, hopCd: 0.2, fuse: 7 });
}

// Minigun: riesige Streuung – trifft fast nie, aber jeder Treffer tut richtig weh.
function minigun(w) {
  const dir = w.facing;
  game.actionBusy = true;
  let n = 0;
  const iv = setInterval(() => {
    if (n >= 26) { clearInterval(iv); game.actionBusy = false; return; }
    const a = game.aim + (Math.random() - 0.5) * 1.15;   // absichtlich sehr ungenau
    const dirx = dir * Math.cos(a), diry = -Math.sin(a);
    const res = hitscanRay(w.x + dir * 12, w.y - 10, dirx, diry, 700);
    spawnTracer(w.x + dir * 12, w.y - 10, res.x, res.y);
    if (res.hit && res.hit !== 'edge' && res.hit !== 'ground') explode(res.x, res.y, 9, 22, false);
    else if (res.hit === 'ground') explode(res.x, res.y, 5, 0, true);
    n++;
  }, 45);
}

function spawnTracer(x1, y1, x2, y2) { particles.push({ kind: 'tracer', x1, y1, x2, y2, t: 0, ttl: 0.12 }); }

// Scharfschütze: ein einzelner, haargenauer Schuss über die ganze Karte.
// Kein Wind, keine Ballistik – wo das Fadenkreuz hinzeigt, schlägt er ein.
function sniper(w) {
  const a = game.aim, dir = w.facing;
  const dirx = dir * Math.cos(a), diry = -Math.sin(a);
  const sx = w.x + dir * 14, sy = w.y - 8;
  const res = hitscanRay(sx, sy, dirx, diry, 4000);
  particles.push({ kind: 'tracer', x1: sx, y1: sy, x2: res.x, y2: res.y, t: 0, ttl: 0.35 });
  const onWorm = res.hit && res.hit !== 'edge' && res.hit !== 'ground';
  if (onWorm) explode(res.x, res.y, 9, 55, false);        // präziser Volltreffer, kaum Krater
  else if (res.hit === 'ground') explode(res.x, res.y, 5, 0, true);
  else { game.banner = 'Daneben!'; game.bannerT = 0.8; }
}

// Kaugummi platzt: wenig Schaden, kein Krater – aber wer klebt, kann in
// seinem nächsten Zug nicht mehr laufen.
function gumPop(x, y) {
  for (const wm of allWorms()) {
    if (!wm.alive) continue;
    const d = Math.hypot(wm.x - x, (wm.y - 6) - y);
    if (d < 34) {
      damage(wm, Math.round(12 * clamp(1 - d / 44, 0.4, 1)), 0, -30);
      wm.gluePhase = Math.max(wm.gluePhase || 0, 1);
    }
  }
  for (let i = 0; i < 14; i++) {
    particles.push({ kind: 'gum', x, y, vx: (Math.random() - 0.5) * 170, vy: -Math.random() * 150, t: 0, ttl: 0.5 + Math.random() * 0.3 });
  }
  particles.push({ kind: 'blast', x, y, r: 18, t: 0, ttl: 0.3, pink: 1 });
}

// ---- Explosion -------------------------------------------------------------
function explode(x, y, r, dmg, dig = true, knock = 260) {
  lastBoom = { x, y };
  if (dig) carveCircle(x | 0, y | 0, r);
  for (const wm of allWorms()) {
    if (!wm.alive) continue;
    const dist = Math.hypot(wm.x - x, wm.y - y);
    if (dist < r + 18) {
      const f = clamp(1 - dist / (r + 18), 0, 1);
      const ang = Math.atan2(wm.y - y, wm.x - x);
      damage(wm, Math.round(dmg * f), Math.cos(ang) * knock * f, Math.sin(ang) * knock * f - knock * 0.3 * f);
    }
  }
  const nSpark = Math.round(clamp(r * 0.5, 12, 44));   // größere Explosion = mehr Funken
  for (let i = 0; i < nSpark; i++) {
    const a = Math.random() * TAU, sp = 60 + Math.random() * 160 + r;
    particles.push({ kind: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, t: 0, ttl: 0.6 });
  }
  particles.push({ kind: 'blast', x, y, r, t: 0, ttl: 0.35 });
  // Comic-Wumms: weiße Druckwelle, aufsteigender Rauch, kurzer Screenshake
  particles.push({ kind: 'ring', x, y, r, t: 0, ttl: 0.35 });
  for (let i = 0; i < Math.round(clamp(r / 7, 3, 8)); i++) {
    particles.push({ kind: 'smoke', x: x + (Math.random() - 0.5) * r, y: y + (Math.random() - 0.5) * r * 0.5,
      vx: (Math.random() - 0.5) * 22, vy: -28 - Math.random() * 26, r0: 5 + Math.random() * 6, t: 0, ttl: 0.9 + Math.random() * 0.5 });
  }
  cam.shakeT = Math.max(cam.shakeT || 0, clamp(r / 70, 0.12, 0.5));
}

// Comic-Sterbeanimation: POW-Blitz, Sternchen, farbige Funken, ein Geist
// steigt auf – und an Land plumpst ein Grabstein hin, der liegen bleibt.
function killWorm(wm) {
  const color = (teams[wm.team] && teams[wm.team].color) || '#fff';
  particles.push({ kind: 'burst', x: wm.x, y: wm.y - 8, t: 0, ttl: 0.35 });
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * TAU, sp = 60 + Math.random() * 130;
    particles.push({ kind: 'star', x: wm.x, y: wm.y - 8, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 90, rot: Math.random() * TAU, t: 0, ttl: 0.7 + Math.random() * 0.3 });
  }
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * TAU, sp = 40 + Math.random() * 150;
    particles.push({ kind: 'deadspark', x: wm.x, y: wm.y - 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 70, t: 0, ttl: 0.6 + Math.random() * 0.5, color });
  }
  particles.push({ kind: 'death', x: wm.x, y: wm.y - 8, name: wm.name || '', t: 0, ttl: 1.9 });
  cam.shakeT = Math.max(cam.shakeT || 0, 0.2);
  // Grabstein nur an Land: auf den Boden unterhalb der Todesstelle setzen
  if (wm.y < WATERLINE - 6) {
    let gy = wm.y | 0;
    while (gy < WATERLINE - 2 && !solidAt(wm.x, gy + 1)) gy++;
    if (gy < WATERLINE - 2) graves.push({ x: wm.x, y: gy, t: 0, color });
  }
}

function damage(wm, amt, kx, ky) {
  const wasAlive = wm.alive;
  if (wasAlive && amt >= 1) {
    particles.push({ kind: 'dmg', x: wm.x, y: wm.y - 20, amt: Math.round(amt), t: 0, ttl: 1.1 });
    logHit(wm, amt);
  }
  wm.hp -= amt;
  wm.vx += kx; wm.vy += ky;
  wm.grounded = false;
  if (wm.hp <= 0) { wm.hp = 0; wm.alive = false; if (wasAlive) killWorm(wm); }
}

function allWorms() { return teams.flatMap((t) => t.worms); }

// ---- Physik ----------------------------------------------------------------
// wm.y ist der Fußpunkt; der Körper reicht ~9 px nach oben.
function bodyClear(x, fy) {
  for (let d = 1; d <= 9; d++) if (solidAt(x, fy - d)) return false;
  return true;
}

function stepWorm(wm, dt) {
  if (!wm.alive) return;
  if (wm.celebrate > 0) wm.celebrate -= dt;
  if (wm.saluteT > 0) wm.saluteT -= dt;
  if (wm.squashT > 0) wm.squashT -= dt;
  // Stabiler Stand: wer ruhig auf festem Boden steht, bekommt keine
  // Schwerkraft-Mikroschritte. (Sonst sinkt die Raupe sub-pixelweise ein und
  // wird ganzzahlig wieder hochgeschoben -> sichtbares Auf-und-ab-Zittern.)
  const resting = wm.grounded && Math.abs(wm.vx) < 1 && wm.vy <= 0 &&
    (solidAt(wm.x, wm.y + 1) || solidAt(wm.x, wm.y + 2));
  if (resting) wm.vy = 0;
  else wm.vy += GRAV * dt;

  // horizontale Bewegung mit Stufen-Klettern
  if (Math.abs(wm.vx) > 1) {
    let nx = wm.x + wm.vx * dt;
    // Unsichtbare Wände links/rechts: wer dagegen geschlagen wird, prallt ab
    // (beim normalen Laufen einfach stehen bleiben)
    if (nx < 6) { nx = 6; wm.vx = Math.abs(wm.vx) > 80 ? Math.abs(wm.vx) * 0.5 : 0; }
    else if (nx > WORLD_W - 6) { nx = WORLD_W - 6; wm.vx = Math.abs(wm.vx) > 80 ? -Math.abs(wm.vx) * 0.5 : 0; }
    if (bodyClear(nx, wm.y)) {
      wm.x = nx;
    } else {
      let climbed = false;
      for (let up = 1; up <= 9; up++) { if (bodyClear(nx, wm.y - up)) { wm.x = nx; wm.y -= up; climbed = true; break; } }
      if (!climbed) wm.vx = 0; // Wand
    }
  }

  // vertikal
  wm.y += wm.vy * dt;
  // eingesunken -> bis knapp über den Grund hochschieben
  let sink = 0;
  while (solidAt(wm.x, wm.y) && sink < 60) { wm.y -= 1; sink++; }
  // Bodenkontakt: fester Grund innerhalb weniger Pixel unter den Füßen
  let support = false;
  for (let d = 1; d <= 4; d++) if (solidAt(wm.x, wm.y + d)) { support = true; break; }
  if (support) {
    if (wm.vy > 150 && !wm.grounded) wm.squashT = 0.22;   // Comic-Plumps bei der Landung
    if (wm.vy > 260) damage(wm, Math.round((wm.vy - 260) / 22), 0, 0);
    if (wm.vy > 0) wm.vy = 0;
    wm.grounded = true;
    wm.vx *= 0.6;
    if (Math.abs(wm.vx) < 8) wm.vx = 0;
  } else {
    wm.grounded = false;
  }

  // Kriech-Phase (Wellenbewegung der Raupe)
  if (wm.grounded && Math.abs(wm.vx) > 5) wm.crawl += Math.min(0.5, Math.abs(wm.vx) * dt * 0.5);
  // Wasser
  if (wm.y > WATERLINE + 4) {
    const wasAlive = wm.alive;
    wm.alive = false; wm.hp = 0;
    if (wasAlive) logHit(wm, 0);
    particles.push({ kind: 'splash', x: wm.x, y: WATERLINE, t: 0, ttl: 0.6 });
    if (wasAlive) particles.push({ kind: 'death', x: wm.x, y: WATERLINE - 12, name: wm.name || '', t: 0, ttl: 1.9 });
  }
}

function stepProjectile(pr, dt) {
  pr.t += dt;
  pr.vy += GRAV * dt;
  if (pr.type === 'rocket' && Math.random() < dt * 55) {
    particles.push({ kind: 'smoke', x: pr.x, y: pr.y, vx: 0, vy: -14, r0: 3.5, t: 0, ttl: 0.5 });
  }
  if (pr.holy) {
    // Halleluja: goldene Sternchen sprudeln, der heilige Geist steigt auf
    if (Math.random() < dt * 14) {
      particles.push({ kind: 'star', x: pr.x + (Math.random() - 0.5) * 12, y: pr.y - 4,
        vx: (Math.random() - 0.5) * 30, vy: -70 - Math.random() * 40, rot: Math.random() * TAU, t: 0, ttl: 0.8 });
    }
    pr.holyT = (pr.holyT || 0) + dt;
    if (pr.holyT >= 0.45) {   // verlässlich alle 0,45 s eine Taube
      pr.holyT = 0;
      particles.push({ kind: 'holy', x: pr.x, y: pr.y - 10, t: 0, ttl: 1.2 });
    }
  }
  if (pr.wind) pr.vx += game.wind * 40 * pr.wind * dt;
  let nx = pr.x + pr.vx * dt, ny = pr.y + pr.vy * dt;

  // Wasser
  if (ny > WATERLINE) { particles.push({ kind: 'splash', x: nx, y: WATERLINE, t: 0, ttl: 0.5 }); return true; }
  // Kaugummi klebt direkt am getroffenen Wurm fest
  if (pr.type === 'gum') {
    for (const wm of allWorms()) {
      if (wm.alive && wm !== game.active && Math.hypot(nx - wm.x, ny - (wm.y - 6)) < 13) { gumPop(nx, ny); return true; }
    }
  }
  // Wurm getroffen (Raketen/Cluster/Schaf/Fliegerbomben explodieren bei Kontakt)
  if (pr.type === 'rocket' || pr.type === 'cluster' || pr.type === 'sheep' || pr.type === 'abomb') {
    for (const wm of allWorms()) if (wm.alive && wm !== game.active && Math.hypot(nx - wm.x, ny - (wm.y - 6)) < 13) { detonate(pr, nx, ny); return true; }
  }
  // Schaf: hüpft über den Boden statt liegen zu bleiben. Die Bewegung wird
  // in kleinen Schritten abgetastet, damit es nie durch Wände oder dünne
  // Böden hindurchgleitet (Tunneling bei hohem Tempo).
  if (pr.type === 'sheep') {
    pr.hopCd -= dt;
    const steps = Math.max(1, Math.ceil(Math.hypot(nx - pr.x, ny - pr.y) / 4));
    let cx2 = pr.x, cy2 = pr.y;
    for (let i = 1; i <= steps; i++) {
      const tx = pr.x + (nx - pr.x) * i / steps;
      const ty = pr.y + (ny - pr.y) * i / steps;
      if (solidAt(tx, ty)) {
        // kleine Stufe hochklettern – sonst an der Wand umdrehen
        let up = 0;
        while (up <= 10 && solidAt(tx, ty - up)) up++;
        if (up <= 10) { cx2 = tx; cy2 = ty - up; if (pr.vy > 0) pr.vy = 0; }
        else { pr.dir *= -1; pr.vx = -pr.vx * 0.5; }
        break;
      }
      cx2 = tx; cy2 = ty;
    }
    nx = cx2; ny = cy2;
    if (solidAt(nx, ny + 7)) {                 // steht auf dem Boden
      if (pr.hopCd <= 0) { pr.vy = -250; pr.vx = pr.dir * 135; pr.hopCd = 0.45; }
      else if (pr.vy > 0) pr.vy = 0;
    }
    pr.x = nx; pr.y = ny;
    if (pr.fuse != null && pr.t >= pr.fuse) { detonate(pr, pr.x, pr.y); return true; }
    return false;
  }
  // Gelände
  if (solidAt(nx, ny)) {
    if (pr.type === 'dynamite' || pr.type === 'gum') {
      // liegen bleiben statt sofort explodieren – gezündet wird über die Lunte
      pr.vx = 0; pr.vy = 0; pr.rest = true;
      if (pr.type === 'gum') {
        if (pr.landT == null) pr.landT = pr.t;
        if (pr.t - pr.landT >= 1) { gumPop(pr.x, pr.y); return true; }   // klebt 1 s, dann platzt er
      }
      if (pr.fuse != null && pr.t >= pr.fuse) { detonate(pr, pr.x, pr.y); return true; }
      return false;
    }
    if (pr.bounce && pr.type !== 'rocket') {
      // Normale grob aus Maskengradient, abprallen
      const n = terrainNormal(nx, ny);
      const dot = pr.vx * n.x + pr.vy * n.y;
      pr.vx = (pr.vx - 2 * dot * n.x) * pr.bounce;
      pr.vy = (pr.vy - 2 * dot * n.y) * pr.bounce;
      // aus dem Boden schieben
      pr.x += n.x * 3; pr.y += n.y * 3;
      return false;
    }
    detonate(pr, pr.x, pr.y);
    return true;
  }
  pr.x = nx; pr.y = ny;
  // Zünder
  if (pr.fuse != null && pr.t >= pr.fuse) { detonate(pr, pr.x, pr.y); return true; }
  return false;
}

function terrainNormal(x, y) {
  let gx = 0, gy = 0;
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    if (solidAt(x + dx, y + dy)) { gx -= dx; gy -= dy; }
  }
  const l = Math.hypot(gx, gy) || 1;
  return { x: gx / l, y: gy / l };
}

function detonate(pr, x, y) {
  explode(x, y, pr.r, pr.dmg, true, pr.knock);
  if (pr.cluster) {
    // Streubombe: kleine Granaten; Bananenbombe: fette Filial-Bananen
    for (let i = 0; i < pr.cluster; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      projectiles.push({ type: pr.clusterType || 'grenade', x, y: y - 6,
        vx: Math.cos(a) * (120 + Math.random() * 120), vy: Math.sin(a) * (160 + Math.random() * 120),
        t: 0, r: pr.clusterR || 20, dmg: pr.clusterDmg || 22, fuse: 1.5 + Math.random(), bounce: 0.55 });
    }
  }
}

// ---- Rundensteuerung -------------------------------------------------------
function livingTeams() { return teams.filter((t) => t.worms.some((w) => w.alive)); }

function startTurn() {
  const lt = livingTeams();
  if (lt.length <= 1) { game.state = 'over'; game.winner = lt[0] || null; game.banner = game.winner ? game.winner.name + ' gewinnt!' : 'Unentschieden'; game.bannerT = 999; return; }
  // Abschluss-Hüpfer: die Raupe, die gerade dran war, freut sich sichtbar
  if (game.active && game.active.alive) game.active.celebrate = 1.5;
  // nächstes lebendes Team ab turnTeam+1
  for (let k = 1; k <= teams.length; k++) {
    const t = (game.turnTeam + k) % teams.length;
    if (teams[t].worms.some((w) => w.alive)) { game.turnTeam = t; break; }
  }
  const team = teams[game.turnTeam];
  // nächster lebender Wurm des Teams
  for (let k = 1; k <= team.worms.length; k++) {
    const wi = (team.cur + k) % team.worms.length;
    if (team.worms[wi].alive) { team.cur = wi; break; }
  }
  game.active = team.worms[team.cur];
  game.wind = +(Math.random() * 2 - 1).toFixed(2);
  game.aim = 0.6; game.power = 0; game.charging = false;
  game.timer = 45; game.fireDone = false; game.shotgunShots = 0; game.actionBusy = false; game.retreatT = 0;
  game.camSeq = null; hitLog.length = 0; lastBoom = null;
  net.remote.moveDir = 0; net.remote.aimDir = 0;   // relayed Eingaben zurücksetzen
  game.state = 'aim';
  game.banner = 'Team ' + team.name + ' ist dran'; game.bannerT = 1.6;
  // Kaugummi: alter Kleber löst sich, frischer wird jetzt wirksam
  for (const wmx of allWorms()) if (wmx.gluePhase === 2) wmx.gluePhase = 0;
  if (game.active.gluePhase === 1) {
    game.active.gluePhase = 2;
    game.banner = game.active.name + ' klebt fest – laufen unmöglich!'; game.bannerT = 2;
  }
  // Waffe mit Munition wählen, falls aktuelle leer
  if (weaponAmmo(game.weaponIdx) <= 0) game.weaponIdx = 0;
  focusCam(game.active.x, game.active.y);
}

// Vor dem Zug die eigene Raupe durchschalten (nächste lebende des Teams).
function switchWorm() {
  const team = teams[game.turnTeam];
  if (!team) return;
  for (let k = 1; k <= team.worms.length; k++) {
    const wi = (team.cur + k) % team.worms.length;
    if (team.worms[wi].alive) { team.cur = wi; break; }
  }
  game.active = team.worms[team.cur];
  game.charging = false; game.power = 0;
  focusCam(game.active.x, game.active.y);
}

// Munitionsvorrat ist pro Team: jedes Team hat sein eigenes ammoUsed-Map.
function teamAmmoUsed() { const t = teams[game.turnTeam]; return t ? t.ammoUsed : {}; }
function weaponAmmo(i) { const w = WEAPONS[i]; return w.ammo === Infinity ? Infinity : w.ammo - (teamAmmoUsed()[w.key] || 0); }

function fireWeapon() {
  const w = WEAPONS[game.weaponIdx];
  if (weaponAmmo(game.weaponIdx) <= 0) return;
  game.fireDone = true;
  const r = w.fire(game.active);
  if (r === 'more') return; // Schrot: zweiter Schuss folgt
  if (w.ammo !== Infinity) { const u = teamAmmoUsed(); u[w.key] = (u[w.key] || 0) + 1; }
  if (w.retreat) {
    // Nach Granate/Dynamit & Co. noch weglaufen dürfen (Dynamit: 8 s!).
    game.retreatT = w.retreat === true ? 3.5 : w.retreat;
    game.banner = 'Rückzug!'; game.bannerT = 1.2;
  } else {
    game.state = 'busy';
    game.settleT = 0;
    game.busyT = 0;
  }
}

function endTurnAfterSettle(dt) {
  game.busyT += dt;
  if (game.busyT > 16) { startTurn(); return; } // Sicherheits-Zeitgrenze
  if (game.actionBusy) { game.settleT = 0; return; } // Uzi/Brenner noch aktiv
  // warten bis Projektile weg und Würmer wirklich ruhig sind (nur echte
  // Geschwindigkeit prüfen – nicht das grounded-Flag, das sonst hängen bleibt)
  const moving = projectiles.length > 0 ||
    allWorms().some((w) => w.alive && (Math.abs(w.vx) > 6 || Math.abs(w.vy) > 6));
  if (moving) { game.settleT = 0; game.camSeq = null; return; }
  game.settleT += dt;

  // Zeit abgelaufen ohne Schuss: kurz warten, direkt weiter
  if (!game.fireDone) { if (game.settleT > 0.7) startTurn(); return; }

  // Kamera-Choreografie: 1) am Einschlag verweilen, 2) jeden getroffenen Wurm
  // nacheinander besuchen (mit Schadens-Verrechnung), 3) zurück zum Schützen
  // für einen kleinen Mützen-Salut, 4) erst dann der nächste Zug.
  if (!game.camSeq) {
    if (lastBoom && game.settleT < 0.55) { focusCam(lastBoom.x, lastBoom.y); return; }
    game.camSeq = { steps: hitLog.filter((h) => h.wm !== game.active), i: -1, t: 99 };
  }
  const seq = game.camSeq;
  seq.t += dt;
  if (seq.t < 0.85) return;
  seq.t = 0; seq.i++;
  if (seq.i < seq.steps.length) {
    const h = seq.steps[seq.i];
    focusCam(h.wm.x, h.wm.y);
    if (h.amt >= 1) particles.push({ kind: 'dmg', x: h.wm.x, y: h.wm.y - 24, amt: Math.round(h.amt), t: 0, ttl: 0.9 });
  } else if (seq.i === seq.steps.length && game.active && game.active.alive) {
    focusCam(game.active.x, game.active.y);
    game.active.saluteT = 1;   // Mützen-Salut!
  } else {
    startTurn();
  }
}

// ---- Kamera ----------------------------------------------------------------
const cam = { x: WORLD_W / 2, y: WORLD_H / 2, scale: 1, base: 1, zoom: 1 };
let W = 0, H = 0;
function focusCam(x, y) { cam.tx = x; cam.ty = y; }
function setZoom(z) { cam.zoom = clamp(z, 0.45, 1.7); }

// ---- Rendering -------------------------------------------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function worldToScreen(x, y) { return { x: (x - cam.x) * cam.scale + W / 2, y: (y - cam.y) * cam.scale + H / 2 }; }

// ferne Hügelketten mit Parallaxe (rein dekorativ, in Bildschirm-Koordinaten)
function drawHillLayer(col, par, base, amp, f1, f2) {
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(-2, H + 2);
  for (let sx = 0; sx <= W + 10; sx += 10) {
    const wx = cam.x * par + sx;
    const y = base + Math.sin(wx * f1) * amp + Math.sin(wx * f2 + 2.1) * amp * 0.5
      - (cam.y - WORLD_H / 2) * par * 0.4;
    ctx.lineTo(sx, y);
  }
  ctx.lineTo(W + 2, H + 2); ctx.closePath(); ctx.fill();
}

let vigGrad = null;

function draw(time) {
  // Himmel: warmer Verlauf mit Sonne und fernen Hügelketten
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#4a7ab2'); sky.addColorStop(0.55, '#7fa8cd'); sky.addColorStop(1, '#c8ddec');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  const sunX = W * 0.82, sunY = H * 0.13;
  const sg = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, 95);
  sg.addColorStop(0, 'rgba(255,246,214,0.95)');
  sg.addColorStop(0.3, 'rgba(255,240,190,0.5)');
  sg.addColorStop(1, 'rgba(255,240,190,0)');
  ctx.fillStyle = sg; ctx.fillRect(sunX - 100, sunY - 100, 200, 200);
  ctx.fillStyle = '#fff8dc';
  ctx.beginPath(); ctx.arc(sunX, sunY, 21, 0, TAU); ctx.fill();
  drawHillLayer('rgba(136,164,198,0.65)', 0.22, H * 0.5, 44, 0.004, 0.011);
  drawHillLayer('rgba(100,136,172,0.75)', 0.42, H * 0.64, 58, 0.006, 0.015);

  ctx.save();
  let shx = 0, shy = 0;
  if (cam.shakeT > 0) { shx = (Math.random() - 0.5) * cam.shakeT * 26; shy = (Math.random() - 0.5) * cam.shakeT * 26; }
  ctx.translate(W / 2, H / 2); ctx.scale(cam.scale, cam.scale); ctx.translate(-cam.x + shx, -cam.y + shy);

  // Wolken (mit sanft schattierter Unterseite)
  for (const c of clouds) {
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#cfdeeb';
    ctx.beginPath();
    ctx.arc(c.x, c.y + 2.5 * c.s, 16 * c.s, 0, TAU);
    ctx.arc(c.x + 14 * c.s, c.y + 5.5 * c.s, 12 * c.s, 0, TAU);
    ctx.arc(c.x - 14 * c.s, c.y + 6.5 * c.s, 11 * c.s, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(c.x, c.y, 16 * c.s, 0, TAU);
    ctx.arc(c.x + 14 * c.s, c.y + 3 * c.s, 12 * c.s, 0, TAU);
    ctx.arc(c.x - 14 * c.s, c.y + 4 * c.s, 11 * c.s, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Wasser: mit der Tiefe dunkler, zwei versetzte Wellenlinien
  const wg = ctx.createLinearGradient(0, WATERLINE, 0, WORLD_H);
  wg.addColorStop(0, 'rgba(72,152,206,0.8)');
  wg.addColorStop(1, 'rgba(16,58,102,0.95)');
  ctx.fillStyle = wg;
  ctx.fillRect(-200, WATERLINE, WORLD_W + 400, WORLD_H);
  ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = -200; x < WORLD_W + 400; x += 20) {
    const yy = WATERLINE + Math.sin((x + waveT * 60) * 0.05) * 3;
    if (x === -200) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(210,235,255,0.22)'; ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let x = -200; x < WORLD_W + 400; x += 20) {
    const yy = WATERLINE + 7 + Math.sin((x - waveT * 45) * 0.045 + 1.7) * 3.5;
    if (x === -200) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
  }
  ctx.stroke();

  // Gelände
  ctx.drawImage(terrainCanvas, 0, 0);

  // Grabsteine gefallener Raupen
  for (const g of graves) drawGrave(g);

  // Projektile
  for (const pr of projectiles) drawProjectile(pr, time);

  // Würmer
  for (const t of teams) for (const wm of t.worms) drawWorm(wm, t, time);

  // Partikel
  for (const p of particles) drawParticle(p);

  // Zielhilfe des aktiven Wurms (nicht mehr im Rückzug)
  if (game.state === 'aim' && game.active && curWeapon().aimed && !game.fireDone) drawAim(game.active);

  ctx.restore();

  // sanfte Vignette erdet das Bild
  if (!vigGrad) {
    vigGrad = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.55, W / 2, H / 2, Math.max(W, H) * 0.78);
    vigGrad.addColorStop(0, 'rgba(0,0,0,0)');
    vigGrad.addColorStop(1, 'rgba(10,22,36,0.26)');
  }
  ctx.fillStyle = vigGrad;
  ctx.fillRect(0, 0, W, H);

  drawHUD(time);
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp((n >> 16) + amt, 0, 255), g = clamp(((n >> 8) & 255) + amt, 0, 255), b = clamp((n & 255) + amt, 0, 255);
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

// Raupe: Kette aus Segmenten mit wandernder Kriech-Welle (Inchworm-Look)
function drawWorm(wm, team, time) {
  if (!wm.alive) return;
  const f = wm.facing;
  const segN = 5, gap = 3.4, segR = 4.2;
  const moving = wm.grounded && Math.abs(wm.vx) > 6;
  const amp = moving ? 2.8 : 0;   // im Stand ganz ruhig (kein Dauergewackel)
  // Tickt Dynamit in der Nähe? Dann Ohren zu und Augen zusammenkneifen!
  let earsShut = false;
  for (const pr of projectiles) {
    if (pr.type === 'dynamite' && Math.hypot(pr.x - wm.x, pr.y - wm.y) < 110) { earsShut = true; break; }
  }
  // Aufbäumen wie im Klassiker: im Stand richtet sich die Raupe auf (Kopf
  // hoch, Körper eingerollt), beim Kriechen und im Flug macht sie sich lang
  const rearTarget = (moving || !wm.grounded || wm.squashT > 0) ? 0 : 1;
  wm.rearF = (wm.rearF ?? 1) + (rearTarget - (wm.rearF ?? 1)) * 0.12;
  const rear = wm.rearF;
  const headFwd = [2.6, 1.3, 0.4, 0, 0];
  const lift = (i) => (segN - 1 - i) * 3.3 * rear;
  // Raupenwellen-Gang: die Segmente stauchen und strecken sich beim Kriechen
  const inch = (i) => (moving ? Math.sin(wm.crawl * 1.8 - i) * 0.16 : 0);
  const segX = (i) => wm.x - f * i * gap * (1 - 0.55 * rear) * (1 + inch(i)) + f * rear * headFwd[i];
  const segY = (i) => wm.y - segR + Math.sin(wm.crawl - i * 0.95) * amp - lift(i);

  ctx.save();
  // weicher Bodenschatten verankert die Raupe optisch
  if (wm.grounded) {
    ctx.globalAlpha = 0.22; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(wm.x - f * 6 * (1 - 0.6 * rear), wm.y + 1.6, 12 - 4 * rear, 2.6, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }
  // Kaugummi-Pfütze unter festgeklebten Raupen
  if (wm.gluePhase) {
    ctx.fillStyle = 'rgba(255,120,200,0.5)';
    ctx.beginPath(); ctx.ellipse(wm.x, wm.y - 0.5, 11, 4.5, 0, 0, TAU); ctx.fill();
  }
  // Abschluss-Hüpfer: kleine Freudensprünge nach dem eigenen Zug
  const hop = wm.celebrate > 0 ? Math.abs(Math.sin(wm.celebrate * 9)) * 4.5 : 0;
  if (hop) ctx.translate(0, -hop);
  // Squash & Stretch: im Flug lang und schmal, bei der Landung platt und breit
  let scX = 1, scY = 1;
  if (!wm.grounded && Math.abs(wm.vy) > 90) { scY = 1.14; scX = 0.9; }
  if (wm.squashT > 0) { const sf = wm.squashT / 0.22; scY = 1 - 0.32 * sf; scX = 1 + 0.28 * sf; }
  if (scX !== 1 || scY !== 1) { ctx.translate(wm.x, wm.y); ctx.scale(scX, scY); ctx.translate(-wm.x, -wm.y); }
  // Beinchen
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1;
  for (let i = 0; i < segN; i++) {
    const sx = segX(i), sy = segY(i);
    const wig = moving ? Math.sin(wm.crawl * 2 - i) * 1.2 : 0;
    ctx.beginPath();
    ctx.moveTo(sx - 2, sy + segR - 1); ctx.lineTo(sx - 2 + wig, sy + segR + 2.5);
    ctx.moveTo(sx + 2, sy + segR - 1); ctx.lineTo(sx + 2 - wig, sy + segR + 2.5);
    ctx.stroke();
  }
  // Körper (hinten zuerst, Kopf zuletzt): sattes Logo-Grün mit
  // Kugel-Verlauf für den plastischen Look – die Teamfarbe sitzt auf der Mütze
  for (let i = segN - 1; i >= 0; i--) {
    const sx = segX(i), sy = segY(i);
    const r = i === 0 ? segR + 1.3 : segR * (1 - i * 0.06);
    const base = i % 2 ? '#5cbf4e' : '#48a83e';
    const grad = ctx.createRadialGradient(sx - r * 0.35, sy - r * 0.45, r * 0.15, sx, sy, r * 1.15);
    grad.addColorStop(0, shade(base, 55));
    grad.addColorStop(0.6, base);
    grad.addColorStop(1, shade(base, -40));
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1.2; ctx.stroke();   // fette Comic-Outline
    // kleiner Glanzpunkt obendrauf
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.arc(sx - r * 0.32, sy - r * 0.42, r * 0.16, 0, TAU); ctx.fill();
  }
  // Team-Mütze: farbige Kappe mit Schirm und Bommel auf dem Kopf
  {
    const chx = segX(0);
    let chy = segY(0) - 2.6;
    // Salut: die Mütze wird kurz gelüpft
    if (wm.saluteT > 0) chy -= Math.sin((1 - clamp(wm.saluteT, 0, 1)) * Math.PI) * 4;
    ctx.fillStyle = team.color; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.arc(chx, chy, segR + 0.9, Math.PI + 0.15, -0.15); ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Schirm in Blickrichtung
    ctx.beginPath(); ctx.ellipse(chx + f * (segR + 1.6), chy + 0.4, 2.7, 1.1, 0, 0, TAU);
    ctx.fill(); ctx.stroke();
    // Glanz auf der Kappe + weißer Bommel
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.arc(chx - 1.6, chy - 2.6, 1.3, 0, TAU); ctx.fill();
    ctx.fillStyle = '#f2f2f2'; ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.arc(chx, chy - segR - 1.1, 1.2, 0, TAU); ctx.fill(); ctx.stroke();
  }
  // Kopf-Details (mit gelegentlichem Blinzeln)
  const hx = segX(0), hy = segY(0);
  const blink = earsShut || ((time * 0.9 + wm.crawl * 0.37) % 3.1) < 0.14;
  if (blink) {
    ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(hx + f * 0.8, hy - 0.5); ctx.lineTo(hx + f * 3.6, hy - 0.5); ctx.stroke();
  } else {
    // großes Glubschauge; die Pupille schaut beim Zielen mit
    const lookA = (wm === game.active && game.state === 'aim') ? game.aim : 0;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(hx + f * 2, hy - 0.7, 2.3, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 0.6; ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(hx + f * (2.4 + Math.cos(lookA) * 0.6), hy - 0.7 - Math.sin(lookA) * 0.9, 1.05, 0, TAU); ctx.fill();
  }
  // Mund: fröhlich, bei wenig HP (oder tickendem Dynamit) besorgt
  ctx.strokeStyle = '#111'; ctx.lineWidth = 0.8; ctx.lineCap = 'round';
  ctx.beginPath();
  if (wm.hp > 25 && !earsShut) ctx.arc(hx + f * 1.8, hy + 2.2, 1.7, 0.35, Math.PI - 0.35);
  else ctx.arc(hx + f * 1.8, hy + 4.4, 1.7, Math.PI + 0.35, TAU - 0.35);
  ctx.stroke();
  // Ohren zuhalten: zwei Pfötchen seitlich an den Kopf gepresst
  if (earsShut) {
    ctx.fillStyle = shade('#5cbf4e', 22); ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.arc(hx - f * 1.2, hy - 4.6, 1.7, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(hx + f * 4.4, hy - 3.6, 1.7, 0, TAU); ctx.fill(); ctx.stroke();
  }
  // Fühler
  ctx.strokeStyle = team.color; ctx.lineWidth = 0.9;
  const antW = Math.sin(time * 3 + wm.x) * 1;
  ctx.beginPath(); ctx.moveTo(hx + f * 1.5, hy - 4.5); ctx.lineTo(hx + f * 3.5 + antW, hy - 9); ctx.stroke();
  ctx.fillStyle = team.color;
  ctx.beginPath(); ctx.arc(hx + f * 3.5 + antW, hy - 9.5, 0.9, 0, TAU); ctx.fill();
  ctx.restore();

  // Namens- und HP-Schild im Stil des Klassikers: zwei gestapelte dunkle
  // Boxen mit Teamfarben-Rand über dem Kopf
  const headTop = segY(0) - segR - 7;   // über Mütze samt Bommel
  if (wm === game.active && game.state === 'aim') {
    // aktiver Wurm: hüpfender Pfeil über den Schildern
    const bob = Math.sin(time * 4) * 2;
    const ay = headTop - 36 - bob;
    ctx.fillStyle = team.color;
    ctx.beginPath();
    ctx.moveTo(wm.x, ay); ctx.lineTo(wm.x - 5, ay - 8); ctx.lineTo(wm.x + 5, ay - 8);
    ctx.closePath(); ctx.fill();
  }
  ctx.textAlign = 'center'; ctx.font = '700 9px system-ui';
  const plate = (txt, py, col) => {
    const wdt = Math.max(20, ctx.measureText(txt).width + 10);
    ctx.fillStyle = 'rgba(14,18,48,0.88)';
    roundRect(wm.x - wdt / 2, py, wdt, 12, 3.5); ctx.fill();
    ctx.strokeStyle = team.color; ctx.lineWidth = 1.2;
    roundRect(wm.x - wdt / 2, py, wdt, 12, 3.5); ctx.stroke();
    ctx.fillStyle = col; ctx.fillText(txt, wm.x, py + 9);
    return wdt;
  };
  const nw = plate(wm.name || '?', headTop - 31, '#fff');
  const hpCol = wm.hp > 50 ? '#eaf3fa' : wm.hp > 25 ? '#ffd166' : '#ff6a5a';
  plate(String(Math.max(0, Math.round(wm.hp))), headTop - 17, hpCol);
  if (wm.gluePhase) { ctx.font = '9px system-ui'; ctx.fillText('🍬', wm.x + nw / 2 + 8, headTop - 22); }
  // Sprechblase zum Abschluss-Hüpfer: „Zug fertig!"
  if (wm.celebrate > 0.25) {
    ctx.globalAlpha = clamp(wm.celebrate, 0, 1);
    const bx = wm.x + 12, by = wm.y - 32;
    ctx.fillStyle = '#fff';
    roundRect(bx, by - 10, 52, 14, 6); ctx.fill();
    ctx.beginPath(); ctx.moveTo(bx + 5, by + 3); ctx.lineTo(bx + 1, by + 9); ctx.lineTo(bx + 12, by + 3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#222'; ctx.font = '700 8px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('Zug fertig!', bx + 26, by);
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = 'left';
}

function drawProjectile(pr, time) {
  ctx.save(); ctx.translate(pr.x, pr.y);
  if (pr.type === 'rocket') {
    ctx.rotate(Math.atan2(pr.vy, pr.vx));
    ctx.fillStyle = '#444'; ctx.fillRect(-6, -2, 12, 4);
    ctx.fillStyle = '#e0453e'; ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(2, -3); ctx.lineTo(2, 3); ctx.fill();
  } else if (pr.type === 'cluster') {
    ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.arc(0, 0, 5, 0, TAU); ctx.fill();
  } else if (pr.type === 'dynamite') {
    ctx.fillStyle = '#c0392b'; ctx.fillRect(-3, -8, 6, 16);
    const on = Math.floor(time * 10) % 2 === 0;
    ctx.fillStyle = on ? '#ffcc33' : '#883'; ctx.beginPath(); ctx.arc(0, -9, 2, 0, TAU); ctx.fill();
  } else if (pr.type === 'gum') {
    const r = pr.rest ? 7 : 5;
    ctx.fillStyle = '#ff8ad0';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.3, r * 0.32, 0, TAU); ctx.fill();
  } else if (pr.type === 'sheep') {
    ctx.font = '20px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🐑', 0, 0);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  } else if (pr.type === 'banana') {
    // rotierende Banane (Halbmond mit Stiel)
    ctx.rotate(pr.t * 7);
    ctx.strokeStyle = '#f5d33a'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, -2, 6, 0.35, Math.PI - 0.35); ctx.stroke();
    ctx.strokeStyle = '#7a5a20'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-5.2, 0); ctx.lineTo(-6.4, -1.6); ctx.stroke();
  } else if (pr.type === 'mole') {
    // Maulwurfsbombe: braune Buddelkugel mit Schnäuzchen und Schaufel-Pfoten
    ctx.fillStyle = '#5a4632'; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, 6, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e8a8b8';
    ctx.beginPath(); ctx.arc(4, 1.5, 1.8, 0, TAU); ctx.fill();
    ctx.fillStyle = '#d8c8a8';
    ctx.beginPath(); ctx.arc(-3, 4, 2, 0, TAU); ctx.arc(2, 5, 2, 0, TAU); ctx.fill();
    const on = Math.floor(time * 10) % 2 === 0;
    ctx.fillStyle = on ? '#ffcc33' : '#883'; ctx.beginPath(); ctx.arc(0, -7, 1.5, 0, TAU); ctx.fill();
  } else if (pr.type === 'abomb') {
    // Fliegerbombe: fällt mit der Nase voran
    ctx.rotate(Math.atan2(pr.vy, pr.vx) - Math.PI / 2);
    ctx.fillStyle = '#4a545c'; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(0, 0, 3.2, 6.5, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e0453e';
    ctx.beginPath(); ctx.moveTo(-3, -5); ctx.lineTo(0, -9); ctx.lineTo(3, -5); ctx.closePath(); ctx.fill();
  } else {
    ctx.fillStyle = pr.holy ? '#f5d76e' : '#2c3e50';
    ctx.beginPath(); ctx.arc(0, 0, pr.holy ? 6 : 4, 0, TAU); ctx.fill();
    const on = Math.floor(time * 10) % 2 === 0;
    ctx.fillStyle = on ? '#ffcc33' : '#883'; ctx.beginPath(); ctx.arc(0, -5, 1.5, 0, TAU); ctx.fill();
    if (pr.holy) {
      // schwebender Heiligenschein
      ctx.strokeStyle = 'rgba(255,238,150,0.9)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.ellipse(0, -10 - Math.sin(time * 5) * 1.2, 5, 1.8, 0, 0, TAU); ctx.stroke();
    }
  }
  ctx.restore();
}

// Grabstein: fällt von oben ein, plumpst mit Squash und bleibt stehen
function drawGrave(g) {
  const t = g.t;
  const fall = t < 0.35 ? (0.35 - t) / 0.35 : 0;
  const yOff = fall * fall * 90;
  let sq = 1;
  if (t >= 0.35 && t < 0.55) sq = 1 - 0.3 * Math.sin((t - 0.35) / 0.2 * Math.PI);
  ctx.save();
  ctx.translate(g.x, g.y - yOff);
  ctx.scale(2 - sq, sq);   // Comic-Plumps: breit und platt beim Aufprall
  ctx.fillStyle = '#a9b2ba'; ctx.strokeStyle = '#4a545c'; ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-7, 0); ctx.lineTo(-7, -9);
  ctx.arc(0, -9, 7, Math.PI, 0);
  ctx.lineTo(7, 0); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#57616a'; ctx.font = '700 5px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('RIP', 0, -7.5);
  ctx.font = '6px system-ui'; ctx.fillText('🌼', 8, 0);
  // die Team-Mütze des Gefallenen ruht auf dem Stein
  if (g.color) {
    ctx.fillStyle = g.color; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.arc(0, -15, 4.6, Math.PI + 0.2, -0.2); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(4.8, -14.4, 2.1, 0.9, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f2f2f2';
    ctx.beginPath(); ctx.arc(0, -19.2, 1.1, 0, TAU); ctx.fill();
  }
  ctx.restore();
  ctx.textAlign = 'left';
}

function drawParticle(p) {
  if (p.kind === 'blast') {
    // additiv gezeichnet: glüht richtig, mit weißheißem Kern
    const f = p.t / p.ttl;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (1 - f) * 0.9;
    ctx.fillStyle = p.pink ? '#ff9ad5' : '#ffb24d';
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.5 + f * 0.8), 0, TAU); ctx.fill();
    ctx.fillStyle = p.pink ? '#ffe0f2' : '#fff0c8';
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.28 + f * 0.4), 0, TAU); ctx.fill();
    ctx.restore();
  } else if (p.kind === 'spark') {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 1 - p.t / p.ttl; ctx.fillStyle = '#ffd27f';
    ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, TAU); ctx.fill();
    ctx.restore();
  } else if (p.kind === 'gum') {
    ctx.globalAlpha = 1 - p.t / p.ttl; ctx.fillStyle = '#ff8ad0';
    ctx.beginPath(); ctx.arc(p.x, p.y, 2.4, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
  } else if (p.kind === 'plane') {
    // Bomber im Anflug (Luftangriff)
    ctx.save(); ctx.translate(p.x, p.y);
    if ((p.dir || 1) < 0) ctx.scale(-1, 1);
    ctx.font = '22px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('✈️', 0, 0);
    ctx.restore();
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  } else if (p.kind === 'deadspark') {
    ctx.globalAlpha = 1 - p.t / p.ttl; ctx.fillStyle = p.color || '#fff';
    ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
  } else if (p.kind === 'death') {
    // Geist schwebt schlängelnd gen Himmel, der Name winkt hinterher
    const f = p.t / p.ttl;
    const wig = Math.sin(p.t * 6.5) * 5;
    ctx.globalAlpha = 1 - f * f;
    ctx.font = '18px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('👻', p.x + wig, p.y - f * 38);
    if (p.name) {
      ctx.font = '700 10px system-ui';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.strokeText(p.name, p.x + wig, p.y - f * 38 + 12);
      ctx.fillStyle = '#fff'; ctx.fillText(p.name, p.x + wig, p.y - f * 38 + 12);
    }
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
  } else if (p.kind === 'holy') {
    const f = p.t / p.ttl;
    const wig = Math.sin(p.t * 5) * 3;
    ctx.globalAlpha = (1 - f) * 0.95;
    ctx.fillStyle = 'rgba(255,240,150,0.45)';
    ctx.beginPath(); ctx.arc(p.x + wig, p.y - f * 34, 8, 0, TAU); ctx.fill();
    ctx.font = '12px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('🕊️', p.x + wig, p.y - f * 34 + 4);
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
  } else if (p.kind === 'burst') {
    // POW!-Blitz: gezackter Comic-Stern
    const f = p.t / p.ttl;
    const R = 10 + f * 26, r2 = R * 0.45;
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(f * 0.6);
    ctx.globalAlpha = 1 - f;
    ctx.fillStyle = '#fff2a8'; ctx.strokeStyle = '#e0453e'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 16; i++) { const a = i / 16 * TAU; const rr = i % 2 ? r2 : R; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore(); ctx.globalAlpha = 1;
  } else if (p.kind === 'star') {
    // herumwirbelnde Cartoon-Sternchen
    const f = p.t / p.ttl;
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate((p.rot || 0) + p.t * 8);
    ctx.globalAlpha = 1 - f;
    ctx.fillStyle = '#ffd93b'; ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = i / 10 * TAU - Math.PI / 2; const rr = i % 2 ? 2 : 4.5; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore(); ctx.globalAlpha = 1;
  } else if (p.kind === 'tracer') {
    // Leuchtspur: breiter Glow + heller Kern
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (1 - p.t / p.ttl) * 0.4;
    ctx.strokeStyle = '#ffca7a'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); ctx.stroke();
    ctx.globalAlpha = 1 - p.t / p.ttl;
    ctx.strokeStyle = '#fff4c0'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); ctx.stroke();
    ctx.restore();
  } else if (p.kind === 'ring') {
    const f = p.t / p.ttl;
    ctx.globalAlpha = (1 - f) * 0.9;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, 3.5 * (1 - f));
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.4 + f * 1.5), 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (p.kind === 'smoke') {
    const f = p.t / p.ttl;
    ctx.globalAlpha = (1 - f) * 0.4;
    ctx.fillStyle = '#cfc8bc';
    ctx.beginPath(); ctx.arc(p.x, p.y, (p.r0 || 5) * (1 + f * 1.8), 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  } else if (p.kind === 'dmg') {
    const f = p.t / p.ttl;
    ctx.globalAlpha = 1 - f * f;
    ctx.font = '900 13px system-ui'; ctx.textAlign = 'center';
    const y = p.y - f * 26;
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.strokeText('-' + p.amt, p.x, y);
    ctx.fillStyle = '#ffd166'; ctx.fillText('-' + p.amt, p.x, y);
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
  } else if (p.kind === 'splash') {
    ctx.globalAlpha = 1 - p.t / p.ttl; ctx.fillStyle = '#bfe3ff';
    for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i - 2) * 0.3; ctx.beginPath(); ctx.arc(p.x + Math.cos(a) * p.t * 60, p.y - Math.sin(-a) * p.t * 40, 2, 0, TAU); ctx.fill(); }
    ctx.globalAlpha = 1;
  }
}

function drawAim(wm) {
  const a = game.aim, dir = wm.facing;
  const dx = dir * Math.cos(a), dy = -Math.sin(a);
  // auslaufende Punktreihe statt starrer Strichellinie
  ctx.fillStyle = '#fff';
  for (let i = 1; i <= 6; i++) {
    ctx.globalAlpha = 0.75 - i * 0.1;
    ctx.beginPath();
    ctx.arc(wm.x + dx * i * 12, wm.y - 8 + dy * i * 12, 2 - i * 0.18, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
  // pulsierendes Fadenkreuz in Teamfarbe
  const col = curWeapon() ? teams[game.turnTeam].color : '#fff';
  const cx2 = wm.x + dx * 80, cy2 = wm.y - 8 + dy * 80;
  const pulse = 1 + Math.sin(waveT * 6) * 0.18;
  ctx.strokeStyle = col; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(cx2, cy2, 6.5 * pulse, 0, TAU); ctx.stroke();
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(cx2, cy2, 2.6, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx2 - 10 * pulse, cy2); ctx.lineTo(cx2 - 5 * pulse, cy2);
  ctx.moveTo(cx2 + 5 * pulse, cy2); ctx.lineTo(cx2 + 10 * pulse, cy2);
  ctx.moveTo(cx2, cy2 - 10 * pulse); ctx.lineTo(cx2, cy2 - 5 * pulse);
  ctx.moveTo(cx2, cy2 + 5 * pulse); ctx.lineTo(cx2, cy2 + 10 * pulse);
  ctx.stroke();
}

// Pfeile am Rand zu allen anderen Raupen (außerhalb des Bildes), mit Entfernung.
function drawTargets() {
  if (game.state !== 'aim' || !game.active) return;
  const cx = W / 2, cy = H / 2, mx = 66, my = 96;   // Rand freihalten (Buttons/HUD)
  const halfW = W / 2 - mx, halfH = H / 2 - my;
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.font = '600 11px system-ui';
  for (const t of teams) {
    for (const wm of t.worms) {
      if (!wm.alive || wm === game.active) continue;
      const s = worldToScreen(wm.x, wm.y);
      if (s.x > mx && s.x < W - mx && s.y > my && s.y < H - my) continue;   // sichtbar -> kein Pfeil
      let dx = s.x - cx, dy = s.y - cy;
      const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
      const scale = Math.min(halfW / (Math.abs(dx) || 1e-6), halfH / (Math.abs(dy) || 1e-6));
      const ex = cx + dx * scale, ey = cy + dy * scale;
      ctx.fillStyle = t.color;
      ctx.save(); ctx.translate(ex, ey); ctx.rotate(Math.atan2(dy, dx));
      ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-7, -6); ctx.lineTo(-7, 6); ctx.closePath(); ctx.fill();
      ctx.restore();
      const dist = Math.hypot(wm.x - game.active.x, wm.y - game.active.y);
      const label = Math.round(dist / 10) + ' m';
      const tx = cx + dx * (scale - 26), ty = cy + dy * (scale - 26);
      const tw = ctx.measureText(label).width + 8;
      ctx.fillStyle = 'rgba(8,25,42,0.72)'; roundRect(tx - tw / 2, ty - 9, tw, 16, 4); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(label, tx, ty + 3);
    }
  }
  ctx.restore();
}

// ---- HUD -------------------------------------------------------------------
function drawHUD(time) {
  drawTargets();
  // Team-Gesundheitsbalken oben
  const bw = Math.min(150, (W - 28 - (teams.length - 1) * 10) / teams.length);
  teams.forEach((t, i) => {
    const total = t.worms.reduce((s, w) => s + Math.max(0, w.hp), 0);
    const max = t.worms.length * 100;
    const x = 14 + i * (bw + 10), y = 64; // unter der Toolbar
    ctx.fillStyle = 'rgba(8,25,42,0.55)'; roundRect(x, y, bw, 30, 8); ctx.fill();
    // dunkle Mulde, darin der glänzende Füllbalken
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; roundRect(x + 3, y + 16.5, bw - 6, 11, 4.5); ctx.fill();
    const tw = (bw - 8) * total / max;
    if (tw > 0.5) {
      const tg = ctx.createLinearGradient(0, y + 18, 0, y + 26);
      tg.addColorStop(0, shade(t.color, 55));
      tg.addColorStop(0.45, t.color);
      tg.addColorStop(1, shade(t.color, -45));
      ctx.fillStyle = tg; roundRect(x + 4, y + 18, tw, 8, 3.2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      roundRect(x + 5, y + 19, Math.max(1, tw - 2), 2.5, 1.2); ctx.fill();
    }
    ctx.fillStyle = i === game.turnTeam ? '#fff' : 'rgba(255,255,255,0.7)';
    ctx.font = (i === game.turnTeam ? 'bold ' : '') + '12px system-ui'; ctx.textAlign = 'left';
    ctx.fillText('Team ' + t.name, x + 6, y + 13);
  });

  // Wind
  ctx.fillStyle = 'rgba(8,25,42,0.55)'; roundRect(W / 2 - 70, 10, 140, 34, 8); ctx.fill();
  ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = '11px system-ui';
  ctx.fillText('Wind', W / 2, 22);
  const wv = game.wind;
  ctx.strokeStyle = Math.abs(wv) > 0.5 ? '#ffb24d' : 'rgba(255,255,255,0.7)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(W / 2, 34); ctx.lineTo(W / 2 + wv * 46, 34); ctx.stroke();
  ctx.fillStyle = ctx.strokeStyle; const ah = wv >= 0 ? 1 : -1;
  ctx.beginPath(); ctx.moveTo(W / 2 + wv * 46 + ah * 6, 34); ctx.lineTo(W / 2 + wv * 46, 30); ctx.lineTo(W / 2 + wv * 46, 38); ctx.fill();

  // Timer / Rückzug
  if (game.state === 'aim') {
    if (game.retreatT > 0) {
      ctx.fillStyle = '#ffd166'; ctx.font = 'bold 17px system-ui'; ctx.textAlign = 'right';
      ctx.fillText('🏃 Rückzug ' + Math.ceil(game.retreatT) + 's', W - 16, 34);
    } else {
      ctx.fillStyle = game.timer < 10 ? '#ff6a5a' : '#fff'; ctx.font = 'bold 22px system-ui'; ctx.textAlign = 'right';
      ctx.fillText(Math.ceil(game.timer) + 's', W - 16, 34);
    }
  }

  // Waffe + Power (über der unteren Button-Reihe)
  const w = curWeapon();
  ctx.fillStyle = 'rgba(8,25,42,0.6)'; roundRect(W / 2 - 92, H - 128, 184, 46, 10); ctx.fill();
  ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = '17px system-ui';
  const am = weaponAmmo(game.weaponIdx);
  ctx.fillText(w.icon + ' ' + w.name + (am === Infinity ? '' : ' (' + am + ')'), W / 2, H - 108);
  // Power-Balken
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1; ctx.strokeRect(W / 2 - 82, H - 96, 164, 9);
  ctx.fillStyle = game.power > 0.8 ? '#ff6a5a' : '#ffd166'; ctx.fillRect(W / 2 - 82, H - 96, 164 * game.power, 9);

  // Banner
  if (game.bannerT > 0) {
    ctx.globalAlpha = clamp(game.bannerT, 0, 1);
    ctx.fillStyle = 'rgba(8,25,42,0.8)'; roundRect(W / 2 - 160, H / 2 - 34, 320, 56, 12); ctx.fill();
    ctx.fillStyle = game.state === 'over' ? '#ffd166' : '#fff';
    ctx.font = 'bold 26px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(game.banner, W / 2, H / 2 - 6);
    ctx.textBaseline = 'alphabetic'; ctx.globalAlpha = 1;
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ---- Eingabe (Bildschirm-Buttons) ------------------------------------------
const buttons = {};
// onDown: beim Drücken, onUp: beim Loslassen (beide optional). Der gedrückte
// Zustand steht immer in buttons[id].held (für Halten wie Laufen/Zielen).
function setBtn(id, onDown, onUp) {
  const el = document.getElementById(id);
  buttons[id] = { held: false };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* egal */ }
    buttons[id].held = true;
    if (onDown) onDown();
  });
  const rel = (e) => {
    e.preventDefault();
    if (!buttons[id].held) return;
    buttons[id].held = false;
    if (onUp) onUp();
  };
  el.addEventListener('pointerup', rel);
  el.addEventListener('pointercancel', rel);
}

function canAct() { return game.state === 'aim' && game.active && !game.fireDone; }
function canMove() { return game.state === 'aim' && game.active; }   // auch im Rückzug (nach fireDone)

function releaseFire() {
  if (!game.charging) return;
  game.charging = false;
  // Nahkampf & Dynamit brauchen keine Aufladung – tippen reicht.
  if (canAct() && (game.power > 0.02 || curWeapon().melee || curWeapon().tap)) fireWeapon();
  else game.power = 0;
}

// Manueller Zünder: FEUER während des Rückzugs drücken lässt gelegtes
// Dynamit sofort hochgehen (statt die restliche Lunte abzuwarten).
function triggerDynamite() {
  if (!game.fireDone || game.state !== 'aim') return;
  for (const pr of projectiles) {
    if (pr.type === 'dynamite' && pr.fuse != null) pr.fuse = Math.min(pr.fuse, pr.t + 0.1);
  }
}

function actJump() {
  if (game.active && game.active.gluePhase === 2) return;   // festgeklebt
  if (canMove() && game.active && game.active.grounded) {   // Springen auch im Rückzug
    game.active.vy = -230; game.active.vx = game.active.facing * 90; game.active.grounded = false;
  }
}

// Steuer-Intents werden je nach Modus lokal ausgeführt (Hotseat/Host) oder als
// Aktion an den Host geschickt (Gast, nur wenn man am Zug ist).
function onJump() {
  if (net.on && !net.host) { if (iTurn()) net.client.send({ t: 'act', a: { k: 'jump' } }); return; }
  if (net.on && game.turnTeam !== net.you) return;
  actJump();
}
function onFireDown() {
  if (net.on && !net.host) { if (iTurn()) net.client.send({ t: 'act', a: { k: 'fire', on: true } }); return; }
  if (net.on && game.turnTeam !== net.you) return;
  if (canAct()) game.charging = true;
  else triggerDynamite();
}
function onFireUp() {
  if (net.on && !net.host) { if (iTurn()) net.client.send({ t: 'act', a: { k: 'fire', on: false } }); return; }
  if (net.on && game.turnTeam !== net.you) return;
  releaseFire();
}
function selectWeapon(i) {
  if (net.on) {
    if (!iTurn()) return;
    if (!net.host) net.client.send({ t: 'act', a: { k: 'weapon', i } });
    game.weaponIdx = i; game.shotgunShots = 0;
    return;
  }
  game.weaponIdx = i; game.shotgunShots = 0;
}
function onSwitch() {
  if (net.on && !net.host) { if (iTurn()) net.client.send({ t: 'act', a: { k: 'switch' } }); return; }
  if (net.on && game.turnTeam !== net.you) return;
  if (canAct()) switchWorm();
}

setBtn('b-left');
setBtn('b-right');
setBtn('b-jump', onJump);
setBtn('b-aimup');
setBtn('b-aimdn');
setBtn('b-fire', onFireDown, onFireUp);

// Waffenmenü – zentrierte Karte in der Mitte (überlagert nicht mehr die HUD oben)
const wmenu = document.getElementById('wmenu');
document.getElementById('b-weapon').addEventListener('click', () => { if (game.state === 'aim') buildWeaponMenu(); });
function buildWeaponMenu() {
  wmenu.innerHTML = '';
  const panel = document.createElement('div');
  panel.className = 'wmenu-panel';
  WEAPONS.forEach((w, i) => {
    const b = document.createElement('button');
    const am = weaponAmmo(i);
    b.className = 'wpn' + (i === game.weaponIdx ? ' sel' : '') + (am <= 0 ? ' out' : '');
    b.innerHTML = `<span class="wi">${w.icon}</span><span class="wn">${w.name}</span><span class="wa">${am === Infinity ? '∞' : am}</span>`;
    if (am > 0) b.addEventListener('click', () => { selectWeapon(i); wmenu.classList.add('hidden'); });
    panel.appendChild(b);
  });
  wmenu.appendChild(panel);
  wmenu.classList.remove('hidden');
}
wmenu.addEventListener('click', (e) => { if (e.target === wmenu) wmenu.classList.add('hidden'); });

// Tap auf die Waffen-Anzeige unten in der Mitte öffnet ebenfalls das Waffenmenü
canvas.addEventListener('pointerdown', (e) => {
  if (game.state !== 'aim') return;
  const rect = canvas.getBoundingClientRect();
  let px, py;
  if (stage.classList.contains('rot')) {
    // Bühne ist um 90° gedreht: Client- in Canvas-Koordinaten zurückdrehen
    px = e.clientY; py = window.innerWidth - e.clientX;
  } else {
    px = e.clientX - rect.left; py = e.clientY - rect.top;
  }
  if (px >= W / 2 - 92 && px <= W / 2 + 92 && py >= H - 128 && py <= H - 82) buildWeaponMenu();
});

// Raupe wechseln + Zoom
document.getElementById('b-switch').addEventListener('click', onSwitch);
document.getElementById('b-zoomin').addEventListener('click', () => setZoom(cam.zoom * 1.25));
document.getElementById('b-zoomout').addEventListener('click', () => setZoom(cam.zoom / 1.25));

// Tastatur (Desktop)
const keys = new Set();
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' ', 'enter'].includes(k)) e.preventDefault();
  keys.add(k);
  if (k === ' ' && !e.repeat) onFireDown();
  if (k === 'tab') { e.preventDefault(); if (game.state === 'aim') buildWeaponMenu(); }
  if (k === 'w' && !e.repeat) onJump();
  if ((k === 'enter' || k === 'q') && !e.repeat) onSwitch();
  if (k === '+' || k === '=') setZoom(cam.zoom * 1.25);
  if (k === '-' || k === '_') setZoom(cam.zoom / 1.25);
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  keys.delete(k);
  if (k === ' ') onFireUp();
});

function localMoveDir() {
  const l = keys.has('arrowleft') || buttons['b-left'].held;
  const r = keys.has('arrowright') || buttons['b-right'].held;
  return l ? -1 : r ? 1 : 0;
}
function localAimDir() {
  const u = keys.has('arrowup') || buttons['b-aimup'].held;
  const d = keys.has('arrowdown') || buttons['b-aimdn'].held;
  return u ? 1 : d ? -1 : 0;
}

// Läuft nur beim Simulator (Hotseat oder Host). Beim Host-Zug eines fremden
// Teams kommen Bewegung/Zielen aus net.remote (vom Gast relayed).
function readInput(dt) {
  if (!canMove()) { return; }
  const wm = game.active;
  let moveDir, aimDir;
  if (net.on && net.host && game.turnTeam !== net.you) {
    moveDir = net.remote.moveDir; aimDir = net.remote.aimDir;
  } else {
    moveDir = localMoveDir(); aimDir = localAimDir();
  }
  if (wm.gluePhase === 2) moveDir = 0;   // festgeklebt: kein Schritt möglich
  if (moveDir < 0) { wm.vx = -70; wm.facing = -1; }
  else if (moveDir > 0) { wm.vx = 70; wm.facing = 1; }
  else if (wm.grounded) wm.vx *= 0.4;
  if (game.fireDone) return;   // Rückzug: nur noch laufen/springen, kein Zielen/Aufladen
  if (aimDir > 0) game.aim = clamp(game.aim + 1.5 * dt, -1.4, 1.4);
  if (aimDir < 0) game.aim = clamp(game.aim - 1.5 * dt, -1.4, 1.4);
  if (game.charging) game.power = clamp(game.power + dt * 0.9, 0, 1);
}

// ---- Menü / Start ----------------------------------------------------------
const menuEl = document.getElementById('menu');
const helpEl = document.getElementById('help');
function hideHelp() { helpEl.classList.add('hidden'); }
document.getElementById('btn-menu').addEventListener('click', () => menuEl.classList.remove('hidden'));
document.getElementById('btn-menu-close').addEventListener('click', () => menuEl.classList.add('hidden'));
menuEl.addEventListener('click', (e) => { if (e.target === menuEl) menuEl.classList.add('hidden'); });
document.getElementById('btn-start').addEventListener('click', () => { hideHelp(); newGame(); });
document.getElementById('btn-help').addEventListener('click', () => { menuEl.classList.add('hidden'); helpEl.classList.remove('hidden'); });
const selTeams = document.getElementById('sel-teams'), selWorms = document.getElementById('sel-worms');
document.getElementById('btn-newgame').addEventListener('click', () => {
  cfg.teamCount = +selTeams.value; cfg.wormCount = +selWorms.value;
  menuEl.classList.add('hidden'); newGame();
});

function newGame() {
  generateTerrain((Math.random() * 1e9) | 0);
  spawnTeams();  // jedes Team startet mit vollem, eigenem Munitionsvorrat
  projectiles.length = 0; particles.length = 0; graves.length = 0;
  game.turnTeam = -1; game.weaponIdx = 0; game.winner = null;
  startTurn();
}

// ---- Schleife --------------------------------------------------------------
const stage = document.getElementById('stage');
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rot = stage.classList.contains('rot');
  W = rot ? window.innerHeight : window.innerWidth;
  H = rot ? window.innerWidth : window.innerHeight;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cam.base = clamp(H / (WORLD_H * 0.62), 0.5, 1.1);
  cam.scale = cam.base * cam.zoom;
  vigGrad = null;   // Vignette an die neue Größe anpassen
}
window.addEventListener('resize', resize);
document.getElementById('btn-rotate').addEventListener('click', () => {
  stage.classList.toggle('rot');
  resize();
});
resize();

window.__wurm = { game, teams: () => teams, projectiles, particles, graves, hitLog,
  get lastBoom() { return lastBoom; }, WEAPONS, fireWeapon, weaponAmmo,
  set weapon(i) { game.weaponIdx = i; }, focus: () => game.active, newGame,
  get mask() { return mask; }, solidAt, explode, cfg, net: () => net, cam,
  startTurn, hitscanRay, gumPop, allWorms };

// ==========================================================================
//  Online-Multiplayer (Caterpillars) – Host-autoritativ
// ==========================================================================
const net = {
  on: false, host: false, you: 0, players: [], client: null, ready: false,
  remote: { moveDir: 0, aimDir: 0 }, craters: [], snapAcc: 0, lastMove: 0, lastAim: 0,
};
function iTurn() { return net.on && game.turnTeam === net.you && game.state === 'aim'; }

// ---- Snapshot (Host -> Gäste) ----
function sendSnapshot() {
  const t = teams[game.turnTeam];
  const s = {
    st: game.state, tt: game.turnTeam, ai: +(+game.aim).toFixed(3), pw: +(+game.power).toFixed(3),
    wi: game.weaponIdx, wind: game.wind, bn: game.banner || '', bnT: +(game.bannerT || 0).toFixed(2),
    rt: +(game.retreatT || 0).toFixed(2), fd: game.fireDone ? 1 : 0,
    win: game.winner ? game.winner.name : null, ac: { t: game.turnTeam, i: t ? t.cur : 0 },
    tm: teams.map((tt) => ({ c: tt.cur, au: tt.ammoUsed,
      w: tt.worms.map((w) => ({ x: Math.round(w.x), y: Math.round(w.y), hp: w.hp | 0, al: w.alive ? 1 : 0, f: w.facing, n: w.name, g: w.gluePhase || 0, cb: w.celebrate > 0 ? 1 : 0, sl: w.saluteT > 0 ? 1 : 0 })) })),
    pj: projectiles.map((p) => ({ t: p.type, x: Math.round(p.x), y: Math.round(p.y), r: p.r,
      vx: Math.round(p.vx || 0), vy: Math.round(p.vy || 0), ang: p.ang || 0 })),
    cr: net.craters.length ? net.craters.splice(0, net.craters.length) : undefined,
  };
  net.client.send({ t: 'snap', s });
}

// ---- Snapshot anwenden (Gast) ----
function applySnap(s) {
  if (!teams.length || teams.length !== s.tm.length || teams[0].worms.length !== s.tm[0].w.length) {
    teams = s.tm.map((tt, i) => ({ color: TEAM_COLORS[i], name: TEAM_NAMES[i], cur: tt.c, ammoUsed: tt.au || {},
      worms: tt.w.map((w) => ({ x: w.x, y: w.y, vx: 0, vy: 0, hp: w.hp, alive: !!w.al, facing: w.f,
        team: i, grounded: true, fall: 0, crawl: Math.random() * TAU, name: w.n, gluePhase: w.g || 0 })) }));
  } else {
    s.tm.forEach((tt, i) => {
      teams[i].cur = tt.c; teams[i].ammoUsed = tt.au || {};
      tt.w.forEach((w, j) => {
        const o = teams[i].worms[j];
        if (o.alive && !w.al) killWorm(o);   // gerade gestorben -> Sterbe-Effekt
        o.x = w.x; o.y = w.y; o.hp = w.hp; o.alive = !!w.al; o.facing = w.f; if (w.n) o.name = w.n;
        o.gluePhase = w.g || 0;
        if (w.cb && !(o.celebrate > 0)) o.celebrate = 1.5;
        if (w.sl && !(o.saluteT > 0)) o.saluteT = 1;
      });
    });
  }
  game.state = s.st; game.turnTeam = s.tt; game.aim = s.ai; game.power = s.pw;
  game.weaponIdx = s.wi; game.wind = s.wind; game.banner = s.bn; game.bannerT = s.bnT;
  game.retreatT = s.rt || 0; game.fireDone = !!s.fd;
  game.winner = s.win ? { name: s.win } : null;
  game.active = teams[s.ac.t] ? teams[s.ac.t].worms[s.ac.i] : null;
  projectiles.length = 0;
  for (const p of s.pj) projectiles.push({ type: p.t, x: p.x, y: p.y, r: p.r, vx: p.vx, vy: p.vy, ang: p.ang, t: 0 });
  if (s.cr) {
    for (const c of s.cr) {
      carveCircle(c.x, c.y, c.r);
      particles.push({ kind: 'blast', x: c.x, y: c.y, r: c.r, t: 0, ttl: 0.35 });
      particles.push({ kind: 'ring', x: c.x, y: c.y, r: c.r, t: 0, ttl: 0.35 });
      cam.shakeT = Math.max(cam.shakeT || 0, clamp(c.r / 70, 0.12, 0.5));
    }
  }
  net.ready = true;
}

// ---- Match starten (beide Seiten, ausgelöst durch Server-'start') ----
function beginMatch(m) {
  net.on = true; net.you = m.you; net.host = !!m.host; net.players = m.players;
  cfg.teamCount = m.players.length; cfg.wormCount = m.worms;
  hideLobby(); hideHelp(); hideChat();   // Chat aus (per 💬 wieder öffnbar), Toasts zeigen Nachrichten
  projectiles.length = 0; particles.length = 0; graves.length = 0; net.craters = [];
  if (net.host) {
    generateTerrain(m.seed | 0);
    spawnTeams();
    game.turnTeam = -1; game.weaponIdx = 0; game.winner = null;
    net.ready = true;
    startTurn();
    sendSnapshot();
  } else {
    generateTerrain(m.seed | 0);   // gleiches Gelände aus gleichem Seed
    teams = []; net.ready = false;
    game.state = 'aim'; game.turnTeam = 0; game.active = null;
  }
}

// ---- Remote-Aktion (Host wendet Gast-Eingabe an) ----
function onRemoteAct(m) {
  if (!net.host) return;
  if (m.team !== game.turnTeam) return;   // nur der Spieler am Zug
  const a = m.a || {};
  if (a.k === 'move') net.remote.moveDir = a.dir | 0;
  else if (a.k === 'aim') net.remote.aimDir = a.dir | 0;
  else if (a.k === 'jump') actJump();
  else if (a.k === 'fire') { if (a.on) { if (canAct()) game.charging = true; else triggerDynamite(); } else releaseFire(); }
  else if (a.k === 'weapon') { if (canAct()) { game.weaponIdx = a.i | 0; game.shotgunShots = 0; } }
  else if (a.k === 'switch') { if (canAct()) switchWorm(); }
}

// ---- Lobby-UI ----
const lobbyEl = document.getElementById('lobby');
const $ = (id) => document.getElementById(id);
function showLobby() { if (lobbyEl) lobbyEl.classList.remove('hidden'); }
function hideLobby() { if (lobbyEl) lobbyEl.classList.add('hidden'); }
function lobbyStatus(msg, err) {
  const el = $('lobby-status');
  if (el) { el.textContent = msg; el.classList.toggle('err', !!err); }
}
function showSection(which) {  // 'browse' | 'room'
  $('lobby-browse')?.classList.toggle('hidden', which !== 'browse');
  $('lobby-room')?.classList.toggle('hidden', which !== 'room');
}

// Live-Liste offener Spiele
function renderOpenGames(list) {
  const box = $('lb-list');
  if (!box) return;
  box.innerHTML = '';
  if (!list.length) { box.innerHTML = '<p class="muted small">Gerade keine offenen Spiele – eröffne selbst eins!</p>'; return; }
  for (const g of list) {
    const row = document.createElement('div');
    row.className = 'lb-item';
    row.innerHTML = `<span class="lb-host">${g.locked ? '🔒 ' : ''}${g.host}</span>` +
      `<span class="lb-meta">${g.players}/${g.teams} Spieler · ${g.worms} Raupen</span>`;
    const btn = document.createElement('button');
    btn.textContent = 'Beitreten';
    btn.onclick = () => joinGame(g.code, g.locked);
    row.appendChild(btn);
    box.appendChild(row);
  }
}
function joinGame(code, locked) {
  let password = '';
  if (locked) { password = prompt('Passwort für diese Runde:') || ''; if (!password) return; }
  net.pw = password;   // für automatischen Reconnect merken
  net.client.send({ t: 'join', code, password });
}

function renderRoster(room) {
  const ul = $('lobby-players');
  if (!ul) return;
  ul.innerHTML = '';
  room.players.forEach((p) => {
    const li = document.createElement('li');
    const off = p.connected === false;
    li.textContent = (p.host ? '👑 ' : '👤 ') + p.name + (off ? '  (offline …)' : '');
    if (off) li.style.opacity = '0.5';
    ul.appendChild(li);
  });
}
function onRoom(room, isHost) {
  net.host = isHost;
  showSection('room');
  renderRoster(room);
  const codeBox = $('lobby-code'), codeVal = $('lobby-code-val');
  if (codeBox && codeVal) { codeVal.textContent = room.code; codeBox.classList.remove('hidden'); }
  const startBtn = $('lobby-start'), wait = $('lobby-wait');
  if (isHost) {
    startBtn?.classList.toggle('hidden', room.players.length < 2);
    wait?.classList.add('hidden');
    lobbyStatus(room.players.length < 2
      ? 'Deine Runde ist offen – Mitspieler finden dich im Browser oder per Code.'
      : 'Bereit! Tippe auf „Spiel starten", sobald alle da sind.');
  } else {
    startBtn?.classList.add('hidden');
    wait?.classList.remove('hidden');
    lobbyStatus('Beigetreten. Warte, bis der Host startet …');
  }
  showChatButton(true);
  $('chat')?.classList.remove('hidden');   // Chat direkt offen fürs Warten/Smack-Talk
}

function startOnline(mode, params) {
  net.name = (localStorage.getItem('tgl_session') || 'Gast').slice(0, 24) || 'Gast';
  net.token = localStorage.getItem('tgl_token') || '';
  net.mode = mode; net.params = params;
  net.code = null; net.pw = ''; net.intentional = false; net.backoff = 800;
  showLobby();
  lobbyStatus('Verbinde mit dem Server …');
  wireLobbyButtons();
  connect();
}

// Baut (oder erneuert) die Verbindung und verkabelt alle Handler. Bricht die
// Verbindung während einer Runde ab, wird automatisch neu verbunden und die
// Runde per Code wieder betreten (Platz/Host-Rolle kommen zurück).
function connect() {
  const client = makeNet();
  net.client = client;
  client.onError(() => { if (!net.code && !net.on) lobbyStatus('Server nicht erreichbar. Läuft der Online-Dienst schon? Über die Library kannst du lokal im Hotseat spielen.', true); });
  client.onClose(() => {
    if (net.intentional) return;
    if (net.code) {                                   // in einer Runde -> neu verbinden
      chatToast('Verbindung verloren – verbinde neu …');
      setTimeout(connect, net.backoff);
      net.backoff = Math.min(net.backoff * 2, 15000);
    } else if (!net.on) lobbyStatus('Verbindung getrennt.', true);
  });
  client.open(() => { net.backoff = 800; client.send({ t: 'hello', name: net.name, token: net.token }); });

  client.on('welcome', (m) => {
    net.authed = !!m.authed;
    if (net.code) { client.send({ t: 'join', code: net.code, password: net.pw || '' }); return; }  // Reconnect -> Platz zurückholen
    dispatchInitial(m);
  });
  client.on('rooms', (m) => renderOpenGames(m.list || []));
  client.on('created', (m) => { net.code = m.room.code; net.pw = net._createPw || ''; onRoom(m.room, true); });
  client.on('joined', (m) => { net.code = m.room.code; onRoom(m.room, false); });
  client.on('room', (m) => onRoom(m.room, net.host));
  client.on('resume', (m) => onResume(m));
  client.on('error', (m) => onNetError(m));
  client.on('closed', (m) => onRoomClosed(m));
  client.on('start', (m) => { beginMatch(m); showChatButton(true); });
  client.on('act', (m) => onRemoteAct(m));
  client.on('snap', (m) => applySnap(m.s));
  client.on('chat', (m) => chatReceive(m.from, m.text));
}

function dispatchInitial(m) {
  if (net.mode === 'host') { net._createPw = net.params.get('pw') || ''; net.client.send({ t: 'create', teams: +net.params.get('teams') || 2, worms: +net.params.get('worms') || 3, password: net._createPw }); return; }
  if (net.mode === 'join') { const code = (net.params.get('code') || '').toUpperCase(); if (code) return joinGame(code, false); }
  showSection('browse');
  if (!net.authed) { lobbyStatus('Als Gast dabei: du kannst offenen Runden beitreten. Zum Eröffnen einer eigenen Runde in der Library einloggen.'); $('lb-create')?.setAttribute('disabled', 'disabled'); }
  else lobbyStatus(`Angemeldet als ${m.name}. Eröffne ein Spiel oder tritt einem offenen bei.`);
  net.client.send({ t: 'list' });
}

// Nach Reconnect in eine bereits laufende Partie.
function onResume(m) {
  net.on = true; net.you = m.you; net.host = !!m.host;
  cfg.wormCount = m.worms || cfg.wormCount;
  hideLobby(); hideHelp(); showChatButton(true);
  if (!net.host && (!teams.length || !terrainCanvas)) {
    // Seite war neu geladen -> Gelände aus Seed neu aufbauen, auf Snapshots warten
    if (m.seed != null) generateTerrain(m.seed | 0);
    teams = []; net.ready = false; game.state = 'aim'; game.turnTeam = 0; game.active = null;
  }
  chatToast('Wieder verbunden.');
}

function onNetError(m) {
  if (m.code === 'no-room') {
    net.code = null; net.on = false; net.ready = false;
    showLobby(); showSection('browse'); lobbyStatus('Diese Runde ist nicht mehr verfügbar.', true);
    net.client.send({ t: 'list' });
    return;
  }
  lobbyStatus(m.msg || 'Fehler', true);
}

function onRoomClosed(m) {
  const why = m.reason === 'host-left' ? 'Der Host hat die Runde beendet.' : 'Session geschlossen.';
  net.code = null; net.on = false; net.ready = false;
  showLobby(); showSection('browse'); showChatButton(false); hideChat();
  lobbyStatus(why, true);
  net.client.send({ t: 'list' });
}

let lobbyWired = false;
function wireLobbyButtons() {
  if (lobbyWired) return; lobbyWired = true;   // Buttons nur einmal verkabeln (Reconnect erneuert Client)
  $('lobby-start')?.addEventListener('click', () => net.client.send({ t: 'start', seed: (Math.random() * 1e9) | 0 }));
  $('lobby-join-btn')?.addEventListener('click', () => { const v = ($('lobby-code-in')?.value || '').toUpperCase(); if (v) { net.pw = ''; net.client.send({ t: 'join', code: v, password: '' }); } });
  $('lb-create')?.addEventListener('click', () => { net._createPw = $('lb-pass').value || ''; net.client.send({ t: 'create', teams: +$('lb-teams').value || 2, worms: +$('lb-worms').value || 3, password: net._createPw }); });
  $('lobby-leave')?.addEventListener('click', () => {
    net.code = null; net.on = false; net.ready = false;
    net.client.send({ t: 'leave' });
    showSection('browse'); showChatButton(false); hideChat();
    net.client.send({ t: 'list' });
  });
}

/* ---- Ingame-Chat ---- */
function showChatButton(on) { $('btn-chat')?.classList.toggle('hidden', !on); }
function hideChat() { $('chat')?.classList.add('hidden'); }
function toggleChat() {
  const c = $('chat'); if (!c) return;
  c.classList.toggle('hidden');
  if (!c.classList.contains('hidden')) $('chat-input')?.focus();
}
function chatReceive(from, text) {
  const log = $('chat-log');
  if (log) {
    const div = document.createElement('div');
    div.className = 'chat-msg';
    const mine = from === (localStorage.getItem('tgl_session') || 'Gast');
    div.innerHTML = `<b style="color:${mine ? '#8fe0b6' : '#ffd166'}">${from}:</b> ${escapeHtml(text)}`;
    log.appendChild(div);
    while (log.children.length > 60) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }
  if ($('chat')?.classList.contains('hidden')) chatToast(`${from}: ${text}`);
}
let toastT = 0;
function chatToast(text) {
  const el = $('chat-toast'); if (!el) return;
  el.textContent = text; el.classList.remove('hidden');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.add('hidden'), 3500);
}
function chatSend() {
  const inp = $('chat-input'); if (!inp || !net.client) return;
  const text = inp.value.trim(); if (!text) return;
  net.client.send({ t: 'chat', text }); inp.value = '';
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
$('btn-chat')?.addEventListener('click', toggleChat);
$('chat-send')?.addEventListener('click', chatSend);
$('chat-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); chatSend(); } });

function drawWaiting() {
  ctx.fillStyle = '#0a2036';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#eaf3fa';
  ctx.font = '600 18px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Warte auf den Host …', W / 2, H / 2);
  ctx.textAlign = 'left';
}

// ---- Bootstrap: online (per URL) oder lokaler Hotseat ----
const params = new URLSearchParams(location.search);
const netMode = params.get('net');
if (netMode === 'host' || netMode === 'join' || netMode === 'lobby') {
  hideHelp();
  startOnline(netMode, params);
} else {
  newGame();
}

function updateCamera(dt) {
  cam.scale = cam.base * cam.zoom;   // Zoom live anwenden
  if (cam.shakeT > 0) cam.shakeT = Math.max(0, cam.shakeT - dt);
  // Wolken treiben mit dem Wind
  for (const c of clouds) {
    c.x += (game.wind * 10 + c.spd) * dt;
    if (c.x > WORLD_W + 60) c.x = -60;
  }
  let ft = game.active;
  if (projectiles.length) ft = projectiles[projectiles.length - 1];
  else if (game.state === 'busy' && game.fireDone) ft = null;   // Choreografie steuert selbst
  if (ft) { cam.tx = ft.x; cam.ty = ft.y - 40; }
  cam.x += ((cam.tx ?? cam.x) - cam.x) * Math.min(1, dt * 4);
  cam.y += ((cam.ty ?? cam.y) - cam.y) * Math.min(1, dt * 4);
  // Ist die Welt größer als die Ansicht -> klemmen; sonst zentrieren.
  // (Sonst kreuzen sich die Grenzen und die Kamera flackert auf/ab.)
  const hvx = W / 2 / cam.scale, hvy = H / 2 / cam.scale;
  cam.x = WORLD_W - hvx > hvx ? clamp(cam.x, hvx, WORLD_W - hvx) : WORLD_W / 2;
  const minY = hvy, maxY = WORLD_H - hvy + 40;
  cam.y = maxY > minY ? clamp(cam.y, minY, maxY) : WORLD_H / 2;
}

let last = performance.now(), time = 0;
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000); last = now; time += dt; waveT += dt;

  // Noch kein Gelände (z. B. Online-Lobby vor Spielstart): nur Hintergrund.
  if (!terrainCanvas) {
    ctx.fillStyle = '#0a2036'; ctx.fillRect(0, 0, W, H);
    requestAnimationFrame(frame);
    return;
  }

  if (net.on && !net.host) {
    // Gast: nicht simulieren – nur Eingaben senden, Kamera + Zeichnen.
    if (game.state === 'aim' && game.turnTeam === net.you) {
      const md = localMoveDir(); if (md !== net.lastMove) { net.lastMove = md; net.client.send({ t: 'act', a: { k: 'move', dir: md } }); }
      const ad = localAimDir(); if (ad !== net.lastAim) { net.lastAim = ad; net.client.send({ t: 'act', a: { k: 'aim', dir: ad } }); }
    } else { net.lastMove = 0; net.lastAim = 0; }
    for (let i = particles.length - 1; i >= 0; i--) { particles[i].t += dt; if (particles[i].t >= particles[i].ttl) particles.splice(i, 1); }
    for (const p of particles) {
      if (p.kind === 'spark' || p.kind === 'deadspark' || p.kind === 'gum' || p.kind === 'star') { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += GRAV * dt; }
      else if (p.kind === 'smoke') { p.x += (p.vx || 0) * dt; p.y += (p.vy || -24) * dt; }
      else if (p.kind === 'plane') p.x += p.vx * dt;
    }
    for (const g of graves) g.t += dt;
    for (const wmx of allWorms()) { if (wmx.celebrate > 0) wmx.celebrate -= dt; if (wmx.saluteT > 0) wmx.saluteT -= dt; }
    updateCamera(dt);
    if (net.ready) draw(time); else drawWaiting();
    requestAnimationFrame(frame);
    return;
  }

  if (game.bannerT > 0 && game.state !== 'over') game.bannerT -= dt;

  if (game.state === 'aim') {
    readInput(dt);
    if (game.retreatT > 0) {
      game.retreatT -= dt;
      if (game.retreatT <= 0) { game.retreatT = 0; game.state = 'busy'; game.settleT = 0; game.busyT = 0; }
    } else {
      game.timer -= dt;
      if (game.timer <= 0 && !game.fireDone) { game.state = 'busy'; game.settleT = 0; game.busyT = 0; }
    }
  }

  // Physik immer (Würmer fallen, auch nach Explosionen)
  for (const wm of allWorms()) stepWorm(wm, dt);
  for (let i = projectiles.length - 1; i >= 0; i--) { if (stepProjectile(projectiles[i], dt)) projectiles.splice(i, 1); }
  for (let i = particles.length - 1; i >= 0; i--) { particles[i].t += dt; if (particles[i].t >= particles[i].ttl) particles.splice(i, 1); }
  if (particles.length) {
    for (const p of particles) {
      if (p.kind === 'spark' || p.kind === 'deadspark' || p.kind === 'gum' || p.kind === 'star') { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += GRAV * dt; }
      else if (p.kind === 'smoke') { p.x += (p.vx || 0) * dt; p.y += (p.vy || -24) * dt; }
      else if (p.kind === 'plane') p.x += p.vx * dt;
    }
  }
  for (const g of graves) g.t += dt;

  if (game.state === 'busy') endTurnAfterSettle(dt);

  // Host: autoritativen Zustand ~20×/s an die Gäste schicken.
  if (net.on && net.host) {
    net.snapAcc += dt;
    if (net.snapAcc >= 0.05) { net.snapAcc = 0; sendSnapshot(); }
  }

  updateCamera(dt);
  draw(time);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
