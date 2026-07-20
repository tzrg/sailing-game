// Lemminge – ein Puzzle im Stil des Genre-Klassikers (eigenständig umgesetzt).
// Kleine Kerlchen laufen stur los; per Fähigkeit lotst man genug von ihnen zum
// Ausgang. Zerstörbares Pixel-Gelände (wie bei Raupen), rundenlos in Echtzeit.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const WORLD_W = 960, WORLD_H = 600;

// ---- Gelände (Pixel-Maske) -------------------------------------------------
let mask;                    // Uint8Array: 1 = fest
let terrainCanvas, terrainCtx, terrainImage;
const idx = (x, y) => y * WORLD_W + x;
function solid(x, y) {
  x |= 0; y |= 0;
  if (x < 0 || x >= WORLD_W || y < 0) return false;
  if (y >= WORLD_H) return false;
  return mask[idx(x, y)] === 1;
}
function anySolid(x0, y0, w, h) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (solid(x, y)) return true;
  return false;
}

function newMask() { mask = new Uint8Array(WORLD_W * WORLD_H); }
function rect(x, y, w, h) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
    if (xx >= 0 && xx < WORLD_W && yy >= 0 && yy < WORLD_H) mask[idx(xx, yy)] = 1;
  }
}
function buildTerrainCanvas() {
  terrainCanvas = document.createElement('canvas');
  terrainCanvas.width = WORLD_W; terrainCanvas.height = WORLD_H;
  terrainCtx = terrainCanvas.getContext('2d');
  terrainImage = terrainCtx.createImageData(WORLD_W, WORLD_H);
  recolor(0, 0, WORLD_W, WORLD_H);
  terrainCtx.putImageData(terrainImage, 0, 0);
}
function recolor(x0, y0, x1, y1) {
  x0 = clamp(x0 | 0, 0, WORLD_W); x1 = clamp(x1 | 0, 0, WORLD_W);
  y0 = clamp(y0 | 0, 0, WORLD_H); y1 = clamp(y1 | 0, 0, WORLD_H);
  const d = terrainImage.data;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = idx(x, y), p = i * 4;
    if (mask[i] !== 1) { d[p + 3] = 0; continue; }
    let grass = false;
    for (let k = 1; k <= 5; k++) { if (y - k < 0 || mask[idx(x, y - k)] !== 1) { grass = true; break; } }
    const nz = ((x * 13 + y * 7) % 17) / 17 * 16;
    if (grass) { d[p] = 90 + nz; d[p + 1] = 150 + nz; d[p + 2] = 70; }
    else { d[p] = 122 + nz; d[p + 1] = 92 + nz * 0.6; d[p + 2] = 58; }
    d[p + 3] = 255;
  }
}
function applyRegion(x, y, w, h) {
  recolor(x - 2, y - 2, x + w + 2, y + h + 2);
  terrainCtx.putImageData(terrainImage, 0, 0);
}
function carveRect(x, y, w, h) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
    if (xx >= 0 && xx < WORLD_W && yy >= 0 && yy < WORLD_H) mask[idx(xx, yy)] = 0;
  }
  applyRegion(x, y, w, h);
}
function fillRect(x, y, w, h) {
  rect(x, y, w, h);
  applyRegion(x, y, w, h);
}
function carveCircle(cx, cy, r) {
  const r2 = r * r;
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    if ((x - cx) ** 2 + (y - cy) ** 2 <= r2 && x >= 0 && x < WORLD_W && y >= 0 && y < WORLD_H) mask[idx(x, y)] = 0;
  }
  applyRegion(cx - r, cy - r, 2 * r, 2 * r);
}

// ---- Fähigkeiten -----------------------------------------------------------
const SKILLS = [
  { key: 'climber', name: 'Kletterer', icon: '🧗' },
  { key: 'floater', name: 'Schirm', icon: '🪂' },
  { key: 'bomber', name: 'Sprenger', icon: '💥' },
  { key: 'blocker', name: 'Blocker', icon: '🛑' },
  { key: 'builder', name: 'Bauer', icon: '🧱' },
  { key: 'basher', name: 'Graben', icon: '⛏️' },
  { key: 'miner', name: 'Schräg', icon: '⚒️' },
  { key: 'digger', name: 'Buddler', icon: '🔽' },
];

// ---- Levels ----------------------------------------------------------------
// paint(): Maske malen. entrance/exit in Weltkoordinaten. skills: Vorräte.
const LEVELS = [
  {
    name: '1 · Spaziergang',
    total: 10, save: 6, rate: 1.4, time: 120,
    entrance: { x: 110, y: 150 }, exit: { x: 830, y: 172, w: 46, h: 40 },
    skills: { builder: 2, digger: 2, blocker: 2, floater: 4, climber: 2 },
    paint() {
      rect(0, 212, WORLD_W, WORLD_H - 212);   // durchgehender Boden (Oberkante 212)
    },
  },
  {
    name: '2 · Die Grube',
    total: 14, save: 8, rate: 1.4, time: 160,
    entrance: { x: 90, y: 150 }, exit: { x: 850, y: 172, w: 46, h: 40 },
    skills: { builder: 12, blocker: 3, digger: 2, floater: 3, climber: 2 },
    paint() {
      rect(0, 212, 445, WORLD_H - 212);              // linker Boden
      rect(520, 212, WORLD_W - 520, WORLD_H - 212);  // rechter Boden – Grube x 445..520 (~75px)
    },
  },
  {
    name: '3 · Die Wand',
    total: 16, save: 8, rate: 1.5, time: 170,
    entrance: { x: 90, y: 150 }, exit: { x: 862, y: 172, w: 46, h: 40 },
    skills: { basher: 4, builder: 4, climber: 4, floater: 4, blocker: 2, digger: 2 },
    paint() {
      rect(0, 212, WORLD_W, WORLD_H - 212);   // Boden
      rect(470, 60, 66, 152);                 // hohe Wand quer über den Weg
    },
  },
  {
    name: '4 · Nach unten',
    total: 16, save: 9, rate: 1.5, time: 170,
    entrance: { x: 110, y: 150 }, exit: { x: 460, y: 500, w: 46, h: 40 },
    skills: { digger: 4, blocker: 3, builder: 3, basher: 2, floater: 3 },
    paint() {
      rect(0, 212, WORLD_W, 70);        // obere Plattform (y 212..282)
      rect(0, 540, WORLD_W, 60);        // Boden ganz unten
      rect(430, 500, 96, 44);           // Ausgangspodest unten in der Mitte
    },
  },
];

// ---- Zustand ---------------------------------------------------------------
let lems = [];
let level, levelIdx = 0;
const game = {
  running: false, paused: false, spawned: 0, saved: 0, dead: 0, out: 0,
  spawnT: 0, timeLeft: 0, skill: null, supply: {}, over: null, nuking: false,
};

// Physik-Konstanten (px pro Sekunde bzw. Sekunden)
const WALK = 46, FALL = 150, FLOAT = 46, CLIMB = 42;
const MAX_UP = 5, MAX_DOWN = 4, SPLAT = 76, FLOAT_TRIGGER = 26;
const DIG_IV = 0.09, BASH_IV = 0.05, MINE_IV = 0.06, BUILD_IV = 0.30;
const BUILD_BRICKS = 18;     // Ziegel pro Bauer -> längere, flachere Treppe
const LEM_H = 11, LEM_HALF = 3;

function startLevel(i) {
  levelIdx = clamp(i, 0, LEVELS.length - 1);
  level = LEVELS[levelIdx];
  newMask();
  level.paint();
  buildTerrainCanvas();
  lems = [];
  game.running = true; game.paused = false; game.spawned = 0; game.saved = 0;
  game.dead = 0; game.out = 0; game.spawnT = 0.4; game.timeLeft = level.time;
  game.over = null; game.nuking = false;
  game.supply = Object.assign({}, level.skills);
  game.skill = firstSkill();
  buildSkillbar();
  updateSelLevel();
}
function firstSkill() { for (const s of SKILLS) if ((game.supply[s.key] || 0) > 0) return s.key; return null; }

function spawnLem() {
  lems.push({
    x: level.entrance.x + 0.5, y: level.entrance.y, dir: 1, state: 'fall', fall: 0,
    rem: 0, dt: 0, bricks: 0, bomb: 0, climber: false, floater: false, floating: false, t: 0,
  });
  game.spawned++; game.out++;
}

// ---- Blocker-Erkennung ----
function blockerAt(x, y, self) {
  for (const l of lems) {
    if (l === self || l.state !== 'block' || !l.alive !== !l.alive) continue;
    if (l.state === 'block' && Math.abs(x - l.x) < 5 && Math.abs(y - l.y) < LEM_H) return l;
  }
  return false;
}

// ---- Bewegungs-Logik -------------------------------------------------------
function walkOne(l) {
  const dir = l.dir;
  const nx = (l.x | 0) + dir, fy = l.y | 0;
  if (nx < 0 || nx >= WORLD_W) { l.dir = -dir; return false; }
  if (blockerAt(nx, fy, l)) { l.dir = -dir; return false; }
  if (solid(nx, fy)) {
    let up = 0; while (up <= MAX_UP && solid(nx, fy - up)) up++;
    if (up > MAX_UP) { if (l.climber) { l.state = 'climb'; return false; } l.dir = -dir; return false; }
    l.x = nx + 0.5; l.y = fy - up;
    return true;
  }
  l.x = nx + 0.5;
  let d = 0; while (d <= MAX_DOWN && !solid(nx, fy + 1 + d)) d++;
  if (d > MAX_DOWN) { l.state = 'fall'; l.fall = 0; return false; }
  l.y = fy + d;
  return true;
}

function stepPixels(l, speed, dt, fn) {
  let m = speed * dt + l.rem; let n = m | 0; l.rem = m - n;
  for (let i = 0; i < n; i++) { if (fn(l) === false) break; }
}

function update(dt) {
  // Spawnen
  if (game.spawned < level.total && !game.nuking) {
    game.spawnT -= dt;
    if (game.spawnT <= 0) { spawnLem(); game.spawnT += 1 / level.rate; }
  }
  // Zeit
  if (game.timeLeft > 0) { game.timeLeft -= dt; if (game.timeLeft <= 0) { game.timeLeft = 0; nuke(); } }

  for (const l of lems) {
    if (l.dead || l.savedFlag) continue;
    // Bombe zählt immer runter
    if (l.bomb > 0) {
      l.bomb -= dt;
      if (l.bomb <= 0) { explodeLem(l); continue; }
    }
    switch (l.state) {
      case 'walk': tickWalk(l, dt); break;
      case 'fall': tickFall(l, dt); break;
      case 'climb': tickClimb(l, dt); break;
      case 'dig': tickDig(l, dt); break;
      case 'bash': tickBash(l, dt); break;
      case 'mine': tickMine(l, dt); break;
      case 'build': tickBuild(l, dt); break;
      case 'block': break;
      case 'splat': l.t += dt; if (l.t > 0.6) killLem(l, true); break;
    }
    // Ausgang?
    if (!l.dead && !l.savedFlag && l.state !== 'splat') checkExit(l);
    // aus der Welt gefallen
    if (l.y > WORLD_H + 12) killLem(l, true);
  }
  // aufräumen
  lems = lems.filter((l) => !l.remove);

  // Ende?
  if (!game.over) {
    const resolved = game.spawned >= level.total && game.out === 0;
    if (resolved || (game.nuking && game.out === 0)) {
      game.over = game.saved >= level.save ? 'win' : 'lose';
      saveProgress();
    }
  }
}

function tickWalk(l, dt) { stepPixels(l, WALK, dt, walkOne); }
function tickFall(l, dt) {
  if (l.floater && l.fall > FLOAT_TRIGGER) l.floating = true;
  const spd = l.floating ? FLOAT : FALL;
  stepPixels(l, spd, dt, (lm) => {
    const fx = lm.x | 0, fy = lm.y | 0;
    if (solid(fx, fy + 1)) {
      if (lm.fall > SPLAT && !lm.floating) { lm.state = 'splat'; lm.t = 0; return false; }
      lm.state = 'walk'; lm.floating = false; return false;
    }
    lm.y += 1; lm.fall += 1; return true;
  });
}
function tickClimb(l, dt) {
  stepPixels(l, CLIMB, dt, (lm) => {
    const fx = lm.x | 0, fy = lm.y | 0;
    if (solid(fx, fy - LEM_H)) { lm.dir = -lm.dir; lm.state = 'fall'; lm.fall = 0; return false; }
    const wallX = fx + lm.dir;
    if (!solid(wallX, fy - 2)) { lm.x = wallX + 0.5; lm.y = fy - 2; lm.state = 'walk'; return false; }
    lm.y -= 1; return true;
  });
}
function tickDig(l, dt) {
  l.dt += dt; if (l.dt < DIG_IV) return; l.dt -= DIG_IV;
  const fx = l.x | 0, fy = l.y | 0;
  carveRect(fx - 4, fy + 1, 9, 2);
  l.y += 1;
  if (!anySolid(fx - 3, fy + 2, 7, 2)) { l.state = 'fall'; l.fall = 0; }
}
function tickBash(l, dt) {
  l.dt += dt; if (l.dt < BASH_IV) return; l.dt -= BASH_IV;
  const dir = l.dir, fx = l.x | 0, fy = l.y | 0;
  // noch Wand jenseits des Grabbereichs? sonst durch -> weiterlaufen
  if (!anySolid(fx + dir * 7, fy - LEM_H + 1, 4, LEM_H)) { l.state = 'walk'; return; }
  const ax = dir > 0 ? fx + 1 : fx - 7;
  carveRect(ax, fy - LEM_H, 7, LEM_H + 1);   // Kopfhöhe bis Füße, Boden bleibt
  l.x += dir;
}
function tickMine(l, dt) {
  l.dt += dt; if (l.dt < MINE_IV) return; l.dt -= MINE_IV;
  const dir = l.dir, fx = l.x | 0, fy = l.y | 0;
  // Boden diagonal voraus vorhanden? sonst raus (Kante erreicht)
  if (!solid(fx + dir * 4, fy + 4)) { l.state = 'fall'; l.fall = 0; return; }
  carveRect(dir > 0 ? fx : fx - 8, fy - 7, 9, 11);
  l.x += dir; l.y += 1;
}
function tickBuild(l, dt) {
  l.dt += dt; if (l.dt < BUILD_IV) return; l.dt -= BUILD_IV;
  if (l.bricks <= 0) { l.state = 'walk'; return; }
  const dir = l.dir, fx = l.x | 0, fy = l.y | 0;
  fillRect(dir > 0 ? fx : fx - 8, fy, 9, 2);   // breiter Ziegel -> durchgehende Rampe
  l.x += dir * 5; l.y -= 2; l.bricks--;          // flacher (5 vor / 2 hoch) und weiter
  if (solid((l.x | 0) + dir, (l.y | 0) - LEM_H)) { l.dir = -dir; l.state = 'walk'; }
}

function checkExit(l) {
  const e = level.exit;
  if (l.x > e.x && l.x < e.x + e.w && l.y > e.y && l.y < e.y + e.h + 6) {
    l.savedFlag = true; l.remove = true; game.saved++; game.out--;
  }
}
function killLem(l, count) {
  if (l.dead) return;
  l.dead = true; l.remove = true; game.out--; if (count) game.dead++;
}
function explodeLem(l) {
  carveCircle(l.x | 0, (l.y | 0) - 4, 15);
  killLem(l, true);
}
function nuke() {
  if (game.nuking) return;
  game.nuking = true;
  let d = 0;
  for (const l of lems) { if (!l.dead && !l.savedFlag) { l.bomb = 0.15 + d * 0.05; d++; } }
}

// ---- Fähigkeit zuweisen ----------------------------------------------------
function assignSkill(worldX, worldY) {
  if (!game.skill || game.over) return;
  if ((game.supply[game.skill] || 0) <= 0) return;
  // nächsten passenden Lemming in Reichweite finden (Tap-Toleranz ~28 Bildschirm-px)
  const R = 28 / S;
  let best = null, bestD = R * R;
  for (const l of lems) {
    if (l.dead || l.savedFlag) continue;
    const dx = l.x - worldX, dy = (l.y - LEM_H / 2) - worldY;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = l; }
  }
  if (!best) return;
  if (!applySkill(best, game.skill)) return;
  game.supply[game.skill]--;
  if (game.supply[game.skill] <= 0 && !firstSupplyHas(game.skill)) { /* leer */ }
  refreshSkillbar();
}
function firstSupplyHas(k) { return (game.supply[k] || 0) > 0; }

function applySkill(l, key) {
  switch (key) {
    case 'climber': if (l.climber) return false; l.climber = true; return true;
    case 'floater': if (l.floater) return false; l.floater = true; return true;
    case 'bomber': if (l.bomb > 0) return false; l.bomb = 5; return true;
    case 'blocker': if (l.state === 'block' || l.state === 'fall') return false; l.state = 'block'; return true;
    case 'builder': if (l.state !== 'walk') return false; l.state = 'build'; l.bricks = BUILD_BRICKS; l.dt = BUILD_IV; return true;
    case 'basher': if (l.state !== 'walk') return false; l.state = 'bash'; l.dt = 0; return true;
    case 'miner': if (l.state !== 'walk') return false; l.state = 'mine'; l.dt = 0; return true;
    case 'digger': if (l.state !== 'walk') return false; l.state = 'dig'; l.dt = 0; return true;
  }
  return false;
}

// ---- localStorage: bestes Ergebnis pro Level -------------------------------
function progKey() { return `lem_best_${levelIdx}`; }
function saveProgress() {
  try {
    const prev = parseInt(localStorage.getItem(progKey()) || '0', 10);
    if (game.saved > prev) localStorage.setItem(progKey(), String(game.saved));
  } catch { /* egal */ }
}

// ---- Rendering -------------------------------------------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let CW = 0, CH = 0, S = 1, OX = 0, OY = 0;
const TOP_UI = 96, BOT_UI = 66;   // Platz für Toolbar+Status oben, Skill-Leiste unten
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  CW = window.innerWidth; CH = window.innerHeight;
  canvas.width = Math.round(CW * dpr); canvas.height = Math.round(CH * dpr);
  canvas.style.width = CW + 'px'; canvas.style.height = CH + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  S = clamp(Math.min(CW / WORLD_W, (CH - TOP_UI - BOT_UI) / WORLD_H), 0.2, 3);
  OX = (CW - WORLD_W * S) / 2;
  OY = TOP_UI + Math.max(0, (CH - TOP_UI - BOT_UI - WORLD_H * S) / 2);
}
window.addEventListener('resize', resize);

function screenToWorld(sx, sy) { return { x: (sx - OX) / S, y: (sy - OY) / S }; }

function draw(time) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Hintergrund
  ctx.fillStyle = '#12212f'; ctx.fillRect(0, 0, CW, CH);

  ctx.save();
  ctx.translate(OX, OY); ctx.scale(S, S);
  // Spielfeld-Hintergrund
  const g = ctx.createLinearGradient(0, 0, 0, WORLD_H);
  g.addColorStop(0, '#2a3d52'); g.addColorStop(1, '#1a2a3a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  // Ausgang
  drawExit(time);
  // Eingang
  drawEntrance();
  // Gelände
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(terrainCanvas, 0, 0);
  // Lemminge
  for (const l of lems) drawLem(l, time);
  ctx.restore();

  drawHUD(time);
}

function drawEntrance() {
  const e = level.entrance;
  ctx.fillStyle = '#c0392b';
  ctx.fillRect(e.x - 16, e.y - 18, 32, 12);
  ctx.fillStyle = '#7f8c8d';
  ctx.fillRect(e.x - 3, e.y - 6, 6, 6);
}
function drawExit(time) {
  const e = level.exit;
  ctx.fillStyle = '#1e2f24';
  ctx.fillRect(e.x, e.y, e.w, e.h);
  ctx.fillStyle = '#2ecc71';
  const gh = 8 + Math.sin(time * 4) * 2;
  ctx.fillRect(e.x + 6, e.y + e.h - gh, e.w - 12, gh);
  ctx.fillStyle = '#eafff2'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('🚪', e.x + e.w / 2, e.y + 14);
}
function drawLem(l, time) {
  if (l.dead && l.state !== 'splat') return;
  const x = l.x, y = l.y;
  ctx.save(); ctx.translate(x, y);
  if (l.state === 'splat') {
    ctx.globalAlpha = clamp(1 - l.t / 0.6, 0, 1); ctx.fillStyle = '#d24';
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; ctx.fillRect(Math.cos(a) * l.t * 40, -Math.sin(a) * l.t * 20, 2, 2); }
    ctx.restore(); return;
  }
  ctx.scale(l.dir, 1);
  // Körper
  ctx.fillStyle = '#2f6fd8';
  ctx.fillRect(-LEM_HALF, -8, LEM_HALF * 2, 6);
  // Kopf
  ctx.fillStyle = '#f0c9a0';
  ctx.fillRect(-2, -LEM_H, 4, 4);
  // Haare (grün)
  ctx.fillStyle = '#37c26a';
  ctx.fillRect(-2, -LEM_H - 1, 4, 2);
  // Beine
  ctx.fillStyle = '#1a3f7a';
  ctx.fillRect(-LEM_HALF, -2, 2, 2); ctx.fillRect(1, -2, 2, 2);
  ctx.restore();

  // Zustands-Marker / Bombe
  ctx.textAlign = 'center';
  if (l.state === 'block') { ctx.font = '9px system-ui'; ctx.fillText('🛑', x, y - LEM_H - 2); }
  if (l.climber && l.state === 'climb') { ctx.font = '8px system-ui'; ctx.fillText('🧗', x, y - LEM_H - 2); }
  if (l.floating) { ctx.font = '9px system-ui'; ctx.fillText('🪂', x, y - LEM_H - 3); }
  if (l.bomb > 0) {
    ctx.fillStyle = '#ffde59'; ctx.font = 'bold 10px system-ui';
    ctx.fillText(Math.ceil(l.bomb), x, y - LEM_H - 3);
  }
}

function drawHUD(time) {
  // Statuszeile unter der Toolbar (nicht dahinter)
  const by = 54;
  ctx.fillStyle = 'rgba(8,25,42,0.72)'; roundRect(8, by, CW - 16, 34, 8); ctx.fill();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const y = by + 18;
  ctx.fillStyle = '#8fe0b6'; ctx.font = 'bold 15px system-ui';
  ctx.fillText(`🚪 ${game.saved} / ${level.save}`, 16, y);
  ctx.fillStyle = '#9fc0d8'; ctx.font = '12px system-ui';
  ctx.fillText(`unterwegs ${game.out} · kommen ${level.total - game.spawned}`, 118, y);
  ctx.textAlign = 'right'; ctx.fillStyle = game.timeLeft < 15 ? '#ff6a5a' : '#eaf3fa'; ctx.font = 'bold 16px system-ui';
  const mm = Math.floor(game.timeLeft / 60), ss = Math.floor(game.timeLeft % 60);
  ctx.fillText(`⏱ ${mm}:${ss.toString().padStart(2, '0')}`, CW - 18, y);
  ctx.textBaseline = 'alphabetic';

  const selName = game.skill ? (SKILLS.find((s) => s.key === game.skill) || {}).name : '';
  if (selName) { ctx.textAlign = 'center'; ctx.fillStyle = '#ffd166'; ctx.font = '11px system-ui'; ctx.fillText('gewählt: ' + selName, CW / 2, by - 4); }

  if (game.paused && !game.over) banner('⏸ Pause');
  if (game.over === 'win') banner('🎉 Geschafft!  ' + game.saved + ' gerettet');
  if (game.over === 'lose') banner('😵 Zu wenige gerettet (' + game.saved + '/' + level.save + ')');
}
function banner(text) {
  ctx.fillStyle = 'rgba(8,25,42,0.85)'; roundRect(CW / 2 - 170, CH / 2 - 90, 340, 60, 12); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 20px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, CW / 2, CH / 2 - 60); ctx.textBaseline = 'alphabetic';
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ---- Skill-Leiste (UI) -----------------------------------------------------
const skillbar = document.getElementById('skillbar');
function buildSkillbar() {
  skillbar.innerHTML = '';
  for (const s of SKILLS) {
    const b = document.createElement('button');
    b.className = 'skill';
    b.dataset.key = s.key;
    b.innerHTML = `<span class="si">${s.icon}</span><span class="sc" data-c="${s.key}">${game.supply[s.key] || 0}</span>`;
    b.addEventListener('click', () => { game.skill = s.key; refreshSkillbar(); });
    skillbar.appendChild(b);
  }
  refreshSkillbar();
}
function refreshSkillbar() {
  for (const b of skillbar.children) {
    const k = b.dataset.key;
    const n = game.supply[k] || 0;
    b.querySelector('.sc').textContent = n;
    b.classList.toggle('sel', game.skill === k);
    b.classList.toggle('empty', n <= 0);
  }
}

// ---- Eingabe ---------------------------------------------------------------
canvas.addEventListener('pointerdown', (e) => {
  if (game.over) return;
  const r = canvas.getBoundingClientRect();
  const w = screenToWorld(e.clientX - r.left, e.clientY - r.top);
  assignSkill(w.x, w.y);
});
window.addEventListener('keydown', (e) => {
  const k = e.key;
  if (k === ' ') { e.preventDefault(); togglePause(); }
  const n = parseInt(k, 10);
  if (n >= 1 && n <= SKILLS.length) { game.skill = SKILLS[n - 1].key; refreshSkillbar(); }
});

// ---- Menü / Buttons --------------------------------------------------------
const menuEl = document.getElementById('menu');
const helpEl = document.getElementById('help');
document.getElementById('btn-menu').addEventListener('click', () => menuEl.classList.remove('hidden'));
document.getElementById('btn-menu-close').addEventListener('click', () => menuEl.classList.add('hidden'));
menuEl.addEventListener('click', (e) => { if (e.target === menuEl) menuEl.classList.add('hidden'); });
document.getElementById('btn-help').addEventListener('click', () => { menuEl.classList.add('hidden'); helpEl.classList.remove('hidden'); });
document.getElementById('btn-start').addEventListener('click', () => helpEl.classList.add('hidden'));
document.getElementById('btn-restart').addEventListener('click', () => { menuEl.classList.add('hidden'); startLevel(levelIdx); });
document.getElementById('btn-pause').addEventListener('click', togglePause);
document.getElementById('btn-nuke').addEventListener('click', () => { if (!game.over) nuke(); });
function togglePause() { if (!game.over) game.paused = !game.paused; }

const selLevel = document.getElementById('sel-level');
LEVELS.forEach((l, i) => { const o = document.createElement('option'); o.value = i; o.textContent = l.name; selLevel.appendChild(o); });
selLevel.addEventListener('change', () => { menuEl.classList.add('hidden'); startLevel(+selLevel.value); });
function updateSelLevel() { selLevel.value = levelIdx; }

// ---- Schleife --------------------------------------------------------------
let last = performance.now();
function frame(now) {
  let dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (game.running && !game.paused && !game.over) update(dt);
  draw(now / 1000);
  requestAnimationFrame(frame);
}

window.__lem = { game, lems: () => lems, startLevel, get mask() { return mask; }, solid, level: () => level, SKILLS,
  applySkill, spawnLem, assignSkill };

resize();
startLevel(0);
requestAnimationFrame(frame);
