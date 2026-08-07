// Klonk · Goldrausch – Hommage an Clonk 4 / Clonk Planet (eigenständig umgesetzt).
// Zwei Klonks (oder einer gegen die 🤖-KI) graben sich durch zerstörbares
// Pixel-Gelände, klettern Wände hoch, sprengen mit Feuersteinen den Fels auf
// und liefern Goldklumpen an ihrer Hütte ab – zu Fuß oder mit der Lore.
// Die Chemiefabrik an der Hütte tauscht abgeliefertes Gold gegen Feuersteine
// (wie im Standard-Objektpaket von Clonk Planet). Kamera mit Zoom folgt dem
// Geschehen, Touch-Steuerkreuz + Querformat-Drehung für Handys.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const WORLD_W = 960, WORLD_H = 640;

// ---- Materialien (Pixel-Maske) ---------------------------------------------
// SKY: offener Himmel · EARTH: grabbar · ROCK: nur sprengbar · GOLD: grabbar,
// gibt Klumpen · TUNNEL: ausgehobener Stollen (dunkler Hintergrund, begehbar)
const MAT = { SKY: 0, EARTH: 1, ROCK: 2, GOLD: 3, TUNNEL: 4 };
const SOLID = [false, true, true, true, false];

let mask;                    // Uint8Array WORLD_W*WORLD_H mit MAT-Werten
let groundY;                 // Oberflächen-Höhe je Spalte (Startzustand)
let goldSpots = [];          // Zentren der Goldadern (für die KI)
let terrainCanvas, terrainCtx, terrainImage;
const idx = (x, y) => y * WORLD_W + x;

function matAt(x, y) {
  x |= 0; y |= 0;
  if (x < 0 || x >= WORLD_W) return MAT.ROCK;   // Kartenränder sind "Fels"
  if (y < 0) return MAT.SKY;
  if (y >= WORLD_H) return MAT.ROCK;
  return mask[idx(x, y)];
}
const solid = (x, y) => SOLID[matAt(x, y)];

// ---- Zufall (seedbar, damit Tests reproduzierbar generieren können) --------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rng = mulberry32((Math.random() * 1e9) | 0);

// ---- Gelände-Erzeugung ------------------------------------------------------
const BASE_X = [92, WORLD_W - 92];   // Hütten-Positionen (links / rechts)

function genTerrain() {
  mask = new Uint8Array(WORLD_W * WORLD_H);
  groundY = new Int16Array(WORLD_W);
  goldSpots = [];
  const p1 = rng() * 6.28, p2 = rng() * 6.28, p3 = rng() * 6.28, p4 = rng() * 6.28;

  // Hügelige Oberfläche; rund um die Hütten wird sanft eingeebnet
  for (let x = 0; x < WORLD_W; x++) {
    let h = 300 + Math.sin(x * 0.008 + p1) * 55 + Math.sin(x * 0.021 + p2) * 26
      + Math.sin(x * 0.055 + p3) * 9;
    for (const bx of BASE_X) {
      const d = Math.abs(x - bx);
      if (d < 110) {
        // flacher Kern fürs Hütten-Plateau, außen weicher Übergang (Smoothstep)
        const w = d < 60 ? 1 : 1 - (d - 60) / 50;
        const ww = w * w * (3 - 2 * w);
        h = h * (1 - ww) + 296 * ww;
      }
    }
    groundY[x] = Math.round(clamp(h, 120, WORLD_H - 160));
  }

  // Schichten: Erde oben, darunter Fels mit welliger Grenze
  for (let x = 0; x < WORLD_W; x++) {
    const rockTop = groundY[x] + 130 + Math.sin(x * 0.016 + p4) * 38;
    for (let y = groundY[x]; y < WORLD_H; y++) {
      mask[idx(x, y)] = y >= rockTop ? MAT.ROCK : MAT.EARTH;
    }
  }

  // Goldadern: flache in der Erde, fette tief im Fels (nur per Sprengung erreichbar)
  const blob = (cx, cy, r, mat, onlyIn) => {
    cx |= 0; cy |= 0; r = Math.round(r);
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || x >= WORLD_W || y < 0 || y >= WORLD_H) continue;
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy * 1.6 > r * r) continue;
      const m = mask[idx(x, y)];
      if (!onlyIn || onlyIn.includes(m)) mask[idx(x, y)] = mat;
    }
  };
  for (let i = 0; i < 8; i++) {
    const x = 40 + ((rng() * (WORLD_W - 80)) | 0);
    const y = (groundY[clamp(x, 0, WORLD_W - 1)] + 45 + rng() * 70) | 0;
    blob(x, y, 7 + rng() * 6, MAT.GOLD, [MAT.EARTH]);
    goldSpots.push({ x, y, rock: false });
  }
  for (let i = 0; i < 5; i++) {
    const x = 60 + ((rng() * (WORLD_W - 120)) | 0);
    const y = (WORLD_H - 60 - rng() * 110) | 0;
    blob(x, y, 10 + rng() * 8, MAT.GOLD, [MAT.ROCK, MAT.EARTH]);
    goldSpots.push({ x, y, rock: true });
  }
  // ein paar natürliche Höhlen in der Erdschicht
  for (let i = 0; i < 4; i++) {
    const x = 80 + ((rng() * (WORLD_W - 160)) | 0);
    const y = groundY[clamp(x, 0, WORLD_W - 1)] + 60 + rng() * 60;
    blob(x, y | 0, 9 + rng() * 9, MAT.TUNNEL, [MAT.EARTH]);
  }
}

// ---- Terrain-Rendering (eigener Offscreen-Canvas wie bei Lemminge) ---------
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
    const i = idx(x, y), p = i * 4, m = mask[i];
    const nz = ((x * 13 + y * 7) % 17) / 17;
    if (m === MAT.SKY) { d[p + 3] = 0; continue; }
    if (m === MAT.TUNNEL) {           // Stollen: dunkler Erd-Hintergrund
      d[p] = 46 + nz * 8; d[p + 1] = 32 + nz * 6; d[p + 2] = 22; d[p + 3] = 255; continue;
    }
    if (m === MAT.ROCK) {
      const g = 96 + nz * 26 + ((x * 31 + y * 17) % 23 === 0 ? 24 : 0);
      d[p] = g; d[p + 1] = g + 4; d[p + 2] = g + 10; d[p + 3] = 255; continue;
    }
    if (m === MAT.GOLD) {
      const s = (x * 7 + y * 11) % 13 === 0 ? 60 : 0;
      d[p] = 214 + s * 0.6; d[p + 1] = 168 + nz * 20 + s * 0.5; d[p + 2] = 40; d[p + 3] = 255; continue;
    }
    // Erde – mit Grasnarbe, wo oberhalb Himmel ist
    let grass = false;
    for (let k = 1; k <= 4; k++) { if (matAt(x, y - k) === MAT.SKY) { grass = true; break; } }
    if (grass) { d[p] = 88 + nz * 18; d[p + 1] = 148 + nz * 16; d[p + 2] = 66; }
    else { d[p] = 121 + nz * 16; d[p + 1] = 90 + nz * 10; d[p + 2] = 56; }
    d[p + 3] = 255;
  }
}
function applyRegion(x, y, w, h) {
  recolor(x - 2, y - 6, x + w + 2, y + h + 2);
  terrainCtx.putImageData(terrainImage, 0, 0);
}

// Kreis ausheben. breakRock=false: Fels bleibt stehen (Graben);
// true: alles fliegt (Sprengung). Liefert die entfernten Gold-Pixel.
function carveCircle(cx, cy, r, breakRock) {
  cx |= 0; cy |= 0;
  let gold = 0;
  const r2 = r * r;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || x >= WORLD_W || y < 0 || y >= WORLD_H) continue;
      if ((x - cx) ** 2 + (y - cy) ** 2 > r2) continue;
      const i = idx(x, y), m = mask[i];
      if (m === MAT.SKY || m === MAT.TUNNEL) continue;
      if (m === MAT.ROCK && !breakRock) continue;
      if (m === MAT.GOLD) gold++;
      // oben offen? Dann wird's Himmel, sonst dunkler Stollen (Zeilen laufen
      // von oben nach unten, Krater "erben" den Himmel also nach unten durch)
      mask[i] = (y === 0 || mask[idx(x, y - 1)] === MAT.SKY) ? MAT.SKY : MAT.TUNNEL;
    }
  }
  applyRegion(cx - r, cy - r, 2 * r + 1, 2 * r + 1);
  return gold;
}

// ---- Spielzustand -----------------------------------------------------------
const GOLD_PER_NUGGET = 42;   // so viele Gold-Pixel ergeben einen Klumpen
const FLINT_MAX = 4;
const LORE_MAX = 8;
const ROUND_TIME = 300;
const IS_TOUCH = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)
  || 'ontouchstart' in window;

const game = {
  state: 'play', paused: false, t: ROUND_TIME, goal: 8, winner: null,
  mode: '2p',                 // '2p' | 'solo' (gegen die KI)
  flintDropT: 12, shakeT: 0, shakeA: 0,
};
try { game.mode = localStorage.getItem('clonk_mode') || (IS_TOUCH ? 'solo' : '2p'); } catch { /* egal */ }

let players = [];
let items = [];          // { type:'nugget'|'flint', x,y,vx,vy, buried, chute, rest }
let projectiles = [];    // geworfene Feuersteine { x,y,vx,vy, owner, t, spin }
let lores = [];          // Minen-Loren { team, x, y, vx, vy, cargo }
let parts = [];          // Partikel
let floats = [];         // aufsteigende Textchen

// Klonk-Maße & Physik. CWH: schmaler Kollisionskern, damit Hänge bis ~45°
// begehbar bleiben (der gezeichnete Klonk ist breiter als seine Kollision).
const HW = 4, CWH = 2, PH = 16;      // halbe Breite (Optik/Kollision), Höhe (Füße = y)
const WALK = 88, G = 520, JUMP_VY = -238, MAXFALL = 470;
const STEP_UP = 6, STEP_DOWN = 5;
const SCALE_SPEED = 56, DIG_SPEED = 36, DIG_R = 9;
const FALL_HURT = 330;

function makePlayer(id, name, color, keys, baseX) {
  return {
    id, name, color, keys, base: { x: baseX, y: 0 },
    x: 0, y: 0, vx: 0, vy: 0, dir: id === 0 ? 1 : -1,
    state: 'air', hp: 100, carry: 0, flints: 3, score: 0, ko: 0,
    goldPix: 0, rem: 0, respawnT: 0, tumbleT: 0, throwCd: 0, hurtT: 0,
    walkPhase: 0, prevThrow: false, prevBuy: false,
    ai: false,
    virt: { left: false, right: false, jump: false, dig: false, throw: false, buy: false },
    aiS: { thinkT: 0, target: null, lastX: 0, lastY: 0, stuckT: 0, phase: 'seek', backoffT: 0, backDir: 0, throwAfter: false, waitT: 0, throwNow: false },
  };
}

function startGame(seed) {
  rng = mulberry32((seed !== undefined ? seed : (Math.random() * 1e9)) | 0);
  genTerrain();
  buildTerrainCanvas();
  items = []; projectiles = []; parts = []; floats = []; pendingBooms.length = 0;
  game.state = 'play'; game.paused = false; game.t = ROUND_TIME;
  game.winner = null; game.flintDropT = 12; game.shakeT = 0;

  players = [
    makePlayer(0, 'Rot', '#e74c3c',
      { left: ['a'], right: ['d'], jump: ['w'], dig: ['s'], throw: ['q'], buy: ['e'] }, BASE_X[0]),
    makePlayer(1, 'Blau', '#3f7fd6',
      { left: ['arrowleft'], right: ['arrowright'], jump: ['arrowup'], dig: ['arrowdown'], throw: [',', 'm'], buy: ['.', '-'] }, BASE_X[1]),
  ];
  players[1].ai = game.mode === 'solo';
  for (const p of players) {
    p.base.y = groundY[p.base.x];
    p.x = p.base.x + (p.id === 0 ? 26 : -26);
    p.y = groundY[p.x | 0] - 1;
    p.aiS.lastX = p.x; p.aiS.lastY = p.y;
  }
  // je Hütte eine Lore (Richtung Kartenmitte geparkt, auf der Oberfläche)
  lores = players.map((p) => {
    const lx = p.base.x + (p.id === 0 ? 44 : -44);
    return { team: p.id, x: lx, y: groundY[lx] - 1, vx: 0, vy: 0, cargo: 0 };
  });

  // Feuersteine: ein paar offen an der Oberfläche, der Rest vergraben
  for (let i = 0; i < 3; i++) {
    const x = 300 + ((rng() * 360) | 0);
    items.push({ type: 'flint', x, y: groundY[x] - 3, vx: 0, vy: 0 });
  }
  for (let i = 0; i < 8; i++) {
    const x = 50 + ((rng() * (WORLD_W - 100)) | 0);
    const y = groundY[x] + 25 + rng() * (WORLD_H - groundY[x] - 80);
    items.push({ type: 'flint', x, y: y | 0, vx: 0, vy: 0, buried: true });
  }

  // Kamera zurücksetzen
  cam.zoom = game.mode === 'solo' ? 2.1 : 1;
  cam.x = WORLD_W / 2; cam.y = WORLD_H / 2; cam.scale = 0;
}

// ---- Eingabe (Tastatur + Touch-Buttons + KI) --------------------------------
const pressed = new Set();
const buttons = {};   // Touch-Buttons, steuern immer Spieler Rot
const TOUCH_MAP = { left: 'b-left', right: 'b-right', jump: 'b-jump', dig: 'b-dig', throw: 'b-fire', buy: 'b-buy' };

function down(p, action) {
  if (p.ai) return !!p.virt[action];
  if (p.keys[action].some((k) => pressed.has(k))) return true;
  if (p.id === 0) { const b = buttons[TOUCH_MAP[action]]; if (b && b.held) return true; }
  return false;
}

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(k)) e.preventDefault();
  if (k === ' ') { togglePause(); return; }
  if (game.state === 'over' && (k === 'r' || k === 'enter')) { restart(); return; }
  pressed.add(k);
});
window.addEventListener('keyup', (e) => pressed.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => pressed.clear());

// Bildschirm-Buttons (Muster wie bei Raupen): held-Zustand fürs Halten
function setBtn(id, onDown) {
  const el = document.getElementById(id);
  buttons[id] = { held: false };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* egal */ }
    buttons[id].held = true;
    if (onDown) onDown();
  });
  const rel = (e) => { e.preventDefault(); buttons[id].held = false; };
  el.addEventListener('pointerup', rel);
  el.addEventListener('pointercancel', rel);
}

// ---- Kollisionshelfer -------------------------------------------------------
// Körper-Kasten: x-CWH..x+CWH, y-PH+1..y (Füße auf y)
function bodyBlocked(x, fy) {
  x |= 0; fy |= 0;
  for (let yy = fy - PH + 1; yy <= fy; yy++) {
    for (let xx = x - CWH; xx <= x + CWH; xx += 2) if (solid(xx, yy)) return true;
  }
  return false;
}
function rowSolid(x, y) {
  x |= 0; y |= 0;
  for (let xx = x - CWH; xx <= x + CWH; xx += 2) if (solid(xx, y)) return true;
  return false;
}
const grounded = (x, fy) => rowSolid(x, (fy | 0) + 1);
// Wand zum Klettern? Mindestens 5 feste Pixel in der Spalte neben dem Körper.
function wallAt(p, dir) {
  const x = (p.x | 0) + dir * (CWH + 1);
  let n = 0;
  for (let yy = (p.y | 0) - 1; yy > (p.y | 0) - PH; yy--) if (solid(x, yy)) n++;
  return n >= 5;
}

// ---- Klonk-Steuerung & -Physik ---------------------------------------------
function stepWalk(p, dir) {
  const nx = Math.round(p.x) + dir, fy = Math.round(p.y);
  if (nx - HW < 1 || nx + HW > WORLD_W - 2) return 'wall';
  let up = 0;
  while (up <= STEP_UP && bodyBlocked(nx, fy - up)) up++;
  if (up > STEP_UP) return 'wall';
  p.x = nx; p.y = fy - up;
  if (up > 0) return 'ok';
  let d = 0;
  while (d <= STEP_DOWN && !grounded(nx, fy + d)) d++;
  if (d > STEP_DOWN) return 'fall';
  p.y = fy + d;
  return 'ok';
}

function updatePlayer(p, dt) {
  if (p.ai) aiControl(p, dt);
  if (p.state === 'dead') {
    p.respawnT -= dt;
    if (p.respawnT <= 0) respawn(p);
    return;
  }
  p.throwCd = Math.max(0, p.throwCd - dt);
  p.hurtT = Math.max(0, p.hurtT - dt);

  const L = down(p, 'left'), R = down(p, 'right'), J = down(p, 'jump'), D = down(p, 'dig');
  const dirIn = (R ? 1 : 0) - (L ? 1 : 0);
  if (dirIn && p.state !== 'scale') p.dir = dirIn;

  // Werfen & Kaufen (Flanke, nicht Dauerfeuer)
  const T = down(p, 'throw');
  if (T && !p.prevThrow && p.state !== 'tumble') throwFlint(p);
  p.prevThrow = T;
  const B = down(p, 'buy');
  if (B && !p.prevBuy) buyFlint(p);
  p.prevBuy = B;

  switch (p.state) {
    case 'walk': {
      if (D) { p.state = 'dig'; p.rem = 0; digStep(p, dt); break; }
      if (J) { p.vy = JUMP_VY; p.vx = dirIn * WALK; p.state = 'air'; break; }
      if (dirIn) {
        p.walkPhase += dt * 11;
        p.rem += WALK * dt;
        let n = p.rem | 0; p.rem -= n;
        while (n-- > 0) {
          const r = stepWalk(p, dirIn);
          if (r === 'fall') { p.state = 'air'; p.vx = dirIn * WALK * 0.8; p.vy = 40; break; }
          if (r === 'wall') break;
        }
      } else { p.rem = 0; }
      if (p.state === 'walk' && !grounded(p.x, p.y)) { p.state = 'air'; p.vy = 30; }
      break;
    }
    case 'air':
    case 'tumble': {
      const control = p.state === 'tumble' ? 0 : 1;
      if (p.state === 'tumble') { p.tumbleT -= dt; if (p.tumbleT <= 0) p.state = 'air'; }
      p.vx += dirIn * 260 * control * dt;
      p.vx = clamp(p.vx, -180, 180);
      p.vy = Math.min(MAXFALL, p.vy + G * dt);
      moveAir(p, dt);
      // an Wand festhalten (Klettern), wenn man dagegen drückt
      if (p.state === 'air' && dirIn && p.vy > -60 && wallAt(p, dirIn)) {
        p.state = 'scale'; p.dir = dirIn; p.vx = 0; p.vy = 0;
      }
      break;
    }
    case 'scale': {
      // weg von der Wand -> loslassen; Sprungtaste -> hochklettern
      const away = (p.dir === 1 && L && !R) || (p.dir === -1 && R && !L);
      if (away) { p.state = 'air'; p.vy = -40; p.vx = -p.dir * 70; break; }
      if (!wallAt(p, p.dir)) {
        // Kante erreicht: aufs Plateau ziehen
        p.y -= 2; p.x += p.dir * (HW + 2);
        if (grounded(p.x, p.y)) { p.y = Math.round(p.y); p.state = 'walk'; }
        else { p.state = 'air'; p.vy = -60; p.vx = p.dir * 50; }
        break;
      }
      if (J) {
        p.rem += SCALE_SPEED * dt;
        let n = p.rem | 0; p.rem -= n;
        while (n-- > 0) {
          if (rowSolid(p.x, (p.y | 0) - PH)) break;   // Überhang über dem Kopf
          p.y -= 1;
          if (!wallAt(p, p.dir)) break;               // Kante: nächster Frame zieht hoch
        }
      } else if (D) {
        p.y += SCALE_SPEED * dt;
        if (grounded(p.x, p.y)) { p.y = Math.round(p.y); p.state = 'walk'; }
      }
      break;
    }
    case 'dig': {
      if (!D) { if (grounded(p.x, p.y)) p.state = 'walk'; else { p.state = 'air'; p.vy = 0; } break; }
      digStep(p, dt);
      break;
    }
  }

  // Abliefern & Heilen an der eigenen Hütte
  if (Math.abs(p.x - p.base.x) < 42 && Math.abs(p.y - p.base.y) < 50) {
    if (p.carry > 0) {
      p.score += p.carry;
      addFloat(p.x, p.y - PH - 8, `+${p.carry} 💰`, '#ffd166');
      p.carry = 0;
      checkWin();
    }
    p.hp = Math.min(100, p.hp + 7 * dt);
  }

  // Einsammeln (Klumpen & Feuersteine)
  for (const it of items) {
    if (it.buried || it.dead) continue;
    const dx = it.x - p.x, dy = it.y - (p.y - PH / 2);
    if (dx * dx + dy * dy > 15 * 15) continue;
    if (it.type === 'nugget') { it.dead = true; p.carry++; addFloat(p.x, p.y - PH - 6, '💰', '#ffd166'); }
    else if (p.flints < FLINT_MAX) { it.dead = true; p.flints++; addFloat(p.x, p.y - PH - 6, '💣', '#ffb0a0'); }
  }
}

function moveAir(p, dt) {
  const dx = p.vx * dt, dy = p.vy * dt;
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  const sx = dx / n, sy = dy / n;
  for (let i = 0; i < n; i++) {
    if (sx) {
      const nx = clamp(p.x + sx, HW + 1, WORLD_W - HW - 2);
      if (bodyBlocked(Math.round(nx), Math.round(p.y))) p.vx = 0;
      else p.x = nx;
    }
    if (sy) {
      const ny = p.y + sy;
      if (sy > 0 && rowSolid(Math.round(p.x), Math.round(ny))) {
        // Füße auf die Oberfläche setzen und landen
        let fy = Math.round(ny);
        while (fy > 0 && rowSolid(Math.round(p.x), fy)) fy--;
        p.y = fy; land(p); return;
      }
      if (sy < 0 && rowSolid(Math.round(p.x), Math.round(ny) - PH + 1)) p.vy = 0;
      else p.y = ny;
    }
    if (p.y > WORLD_H + 20) { hurt(p, 999, null); return; }
  }
}

function land(p) {
  const v = p.vy;
  p.vy = 0; p.vx = 0;
  p.state = 'walk';
  if (v > FALL_HURT) {
    hurt(p, (v - FALL_HURT) * 0.14, null);
    puff(p.x, p.y, 6, '#9a8468');
  }
}

// Graben: Grabtaste allein = senkrecht runter, mit Richtung = waagerecht
// (leicht fallend), mit Sprungtaste = schräg nach oben. Fels stoppt die
// Schaufel – da hilft nur ein Feuerstein.
function digStep(p, dt) {
  const L = down(p, 'left'), R = down(p, 'right'), J = down(p, 'jump');
  const dirIn = (R ? 1 : 0) - (L ? 1 : 0);
  if (dirIn) p.dir = dirIn;
  let dx, dy;
  if (J) { dx = dirIn || p.dir; dy = -0.62; }
  else if (dirIn) { dx = dirIn; dy = 0.28; }
  else { dx = 0; dy = 1; }
  const len = Math.hypot(dx, dy); dx /= len; dy /= len;

  p.walkPhase += dt * 14;
  p.rem += DIG_SPEED * dt;
  let n = p.rem | 0; p.rem -= n;
  while (n-- > 0) {
    const cx = p.x + dx * 3, cy = p.y - PH / 2 + dy * 3;
    const gold = carveCircle(cx, cy, DIG_R, false);
    collectGoldPix(p, gold, cx, cy);
    const nx = clamp(p.x + dx, HW + 1, WORLD_W - HW - 2), ny = p.y + dy;
    if (bodyBlocked(Math.round(nx), Math.round(ny))) {          // Fels im Weg
      spark(p.x + dx * 8, p.y - PH / 2 + dy * 8, 2, '#c9c9d4');
      break;
    }
    p.x = nx; p.y = ny;
    // beim (fast) waagerechten Graben dem Stollenboden folgen
    if (!J && dy < 0.8) {
      let d = 0;
      while (d <= 4 && !grounded(p.x, p.y)) { p.y += 1; d++; }
      if (d > 4) { p.y -= d; p.state = 'air'; p.vy = 30; break; }   // Hohlraum: fallen
    }
    if ((n & 3) === 0) puff(p.x - dx * 5, p.y - PH / 2, 1, '#8a6a48');
  }
}
function collectGoldPix(p, gold, x, y) {
  if (!gold) return;
  p.goldPix += gold;
  while (p.goldPix >= GOLD_PER_NUGGET) {
    p.goldPix -= GOLD_PER_NUGGET;
    items.push({ type: 'nugget', x: x + rng() * 6 - 3, y, vx: rng() * 40 - 20, vy: -60 });
    spark(x, y, 4, '#ffd166');
  }
}

// ---- Feuersteine ------------------------------------------------------------
function throwFlint(p) {
  if (p.flints <= 0 || p.throwCd > 0 || game.state !== 'play') return;
  p.flints--; p.throwCd = 0.45;
  projectiles.push({
    x: p.x + p.dir * 6, y: p.y - PH + 2,
    vx: p.dir * 175 + p.vx * 0.5, vy: -165, owner: p, t: 0, spin: rng() * 6,
  });
}

// Chemiefabrik an der eigenen Hütte: 1 abgeliefertes Gold -> 2 Feuersteine
function buyFlint(p) {
  if (game.state !== 'play' || p.state === 'dead') return;
  if (Math.abs(p.x - p.base.x) >= 46 || Math.abs(p.y - p.base.y) >= 54) return;
  if (p.flints >= FLINT_MAX) { addFloat(p.x, p.y - PH - 8, '💣 voll!', '#ffb0a0'); return; }
  if (p.score < 1) { addFloat(p.x, p.y - PH - 8, 'Erst ⭐ abliefern!', '#ffb0a0'); return; }
  p.score -= 1;
  p.flints = Math.min(FLINT_MAX, p.flints + 2);
  addFloat(p.x, p.y - PH - 8, '−1 ⭐ → +2 💣', '#ffe6a0');
  const fx = factoryX(p);
  for (let i = 0; i < 6; i++) puff(fx + 8, p.base.y - 40 - i * 3, 1, '#aab4bd');
}
const factoryX = (p) => p.base.x + (p.id === 0 ? -34 : 34);

function updateProjectiles(dt) {
  for (const f of projectiles) {
    f.t += dt; f.spin += dt * 9;
    f.vy = Math.min(430, f.vy + 430 * dt);
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(f.vx * dt), Math.abs(f.vy * dt))));
    for (let i = 0; i < n && !f.dead; i++) {
      f.x += f.vx * dt / n; f.y += f.vy * dt / n;
      if (f.x < 2 || f.x > WORLD_W - 2 || solid(f.x, f.y)) { explode(f.x, f.y, f.owner); f.dead = true; break; }
      for (const p of players) {
        if (p.state === 'dead' || (p === f.owner && f.t < 0.25)) continue;
        const dx = f.x - p.x, dy = f.y - (p.y - PH / 2);
        if (dx * dx + dy * dy < 10 * 10) { explode(f.x, f.y, f.owner); f.dead = true; break; }
      }
    }
    if (f.y > WORLD_H + 10) f.dead = true;
  }
  projectiles = projectiles.filter((f) => !f.dead);
}

function explode(x, y, src) {
  const R = 26;
  const gold = carveCircle(x, y, R, true);
  if (gold) {
    let n = Math.max(1, Math.round(gold / GOLD_PER_NUGGET));
    while (n-- > 0) {
      items.push({ type: 'nugget', x: x + rng() * 20 - 10, y: y + rng() * 10 - 5, vx: rng() * 90 - 45, vy: -90 - rng() * 60 });
    }
  }
  // Schaden + Wumms für alle in Reichweite
  for (const p of players) {
    if (p.state === 'dead') continue;
    const dx = p.x - x, dy = (p.y - PH / 2) - y;
    const d = Math.hypot(dx, dy);
    if (d > R + 20) continue;
    const f = 1 - d / (R + 24);
    hurt(p, 58 * f, src);
    if (p.state !== 'dead') {
      const nd = Math.max(6, d);
      p.vx = clamp(p.vx + (dx / nd) * 260 * f, -260, 260);
      p.vy = clamp(p.vy + (dy / nd) * 260 * f - 130 * f, -320, 320);
      p.state = 'tumble'; p.tumbleT = 0.8;
    }
  }
  // Loren: Wumms + Ladung fliegt raus
  for (const lo of lores) {
    const d = Math.hypot(lo.x - x, (lo.y - 6) - y);
    if (d > R + 24) continue;
    const f = 1 - d / (R + 28);
    lo.vx += Math.sign(lo.x - x || 1) * 220 * f;
    lo.vy = -120 * f; lo.y -= 2;
    while (lo.cargo > 0) {
      lo.cargo--;
      items.push({ type: 'nugget', x: lo.x, y: lo.y - 8, vx: rng() * 140 - 70, vy: -90 - rng() * 80 });
    }
  }
  // Feuersteine in der Nähe gehen mit hoch (Kettenreaktion, leicht verzögert)
  for (const it of items) {
    if (it.dead || it.type !== 'flint') continue;
    if (Math.hypot(it.x - x, it.y - y) < R + 6) { it.dead = true; explodeLater(it.x, it.y, src); }
  }
  game.shakeT = 0.25; game.shakeA = 5;
  for (let i = 0; i < 26; i++) {
    const a = rng() * Math.PI * 2, s = 40 + rng() * 160;
    parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, t: 0, life: 0.5 + rng() * 0.4, color: i % 3 ? '#8a6a48' : '#ffb054', size: 2 + rng() * 2, grav: 300 });
  }
  spark(x, y, 10, '#ffe6a0');
}
// verzögerte Folge-Explosionen, damit Ketten nicht im selben Frame rekursieren
const pendingBooms = [];
function explodeLater(x, y, src) { pendingBooms.push({ x, y, src, t: 0.12 + rng() * 0.1 }); }

function hurt(p, dmg, src) {
  if (p.state === 'dead' || game.state !== 'play') return;
  p.hp -= dmg; p.hurtT = 0.35;
  if (p.hp > 0) return;
  p.hp = 0; p.state = 'dead'; p.respawnT = 4;
  if (src && src !== p) src.ko++;
  addFloat(p.x, p.y - PH - 10, '💀 K. o.!', '#ff7a6a');
  // getragenes Gold & Ersatz-Feuersteine purzeln heraus
  for (let i = 0; i < p.carry; i++) {
    items.push({ type: 'nugget', x: p.x, y: p.y - PH / 2, vx: rng() * 120 - 60, vy: -80 - rng() * 80 });
  }
  for (let i = 0; i < Math.min(2, p.flints); i++) {
    items.push({ type: 'flint', x: p.x, y: p.y - PH / 2, vx: rng() * 100 - 50, vy: -70 - rng() * 60 });
  }
  p.carry = 0;
}

function respawn(p) {
  p.state = 'air'; p.hp = 100; p.flints = 1; p.carry = 0; p.goldPix = 0;
  p.vx = 0; p.vy = 0; p.tumbleT = 0;
  p.x = p.base.x + (p.id === 0 ? 26 : -26);
  p.y = groundY[p.x | 0] - 30;
  p.aiS.target = null; p.aiS.phase = 'seek'; p.aiS.stuckT = 0;
}

// ---- KI (🤖 Blau im Solo-Modus) --------------------------------------------
// Einfacher Goldgräber: sucht Klumpen oder Adern, gräbt hin, bringt das Gold
// heim. Bei Fels: zurückziehen, Feuerstein werfen. Gelegentliche Angriffe.
function aiThink(p) {
  const s = p.aiS;
  const enemy = players[0];
  // Angriffslust: Gegner nah + genug Feuersteine
  if (enemy.state !== 'dead' && p.flints >= 2 && Math.abs(enemy.x - p.x) < 90
    && Math.abs(enemy.y - p.y) < 40 && rng() < 0.3) {
    p.dir = enemy.x >= p.x ? 1 : -1;
    s.throwNow = true;
  }
  // heim, wenn Sack voll, angeschlagen oder Zeitnot
  if (p.carry >= 3 || (p.carry > 0 && p.hp < 40) || p.hp < 30
    || (p.carry > 0 && game.t < 25)) {
    s.target = { x: p.base.x, y: p.base.y - 1, kind: 'base' };
    return;
  }
  // liegender Klumpen in der Nähe?
  let best = null, bd = 1e9;
  for (const it of items) {
    if (it.dead || it.buried || it.type !== 'nugget') continue;
    const d = Math.hypot(it.x - p.x, it.y - p.y);
    if (d < bd) { bd = d; best = it; }
  }
  if (best && bd < 260) { s.target = { x: best.x, y: best.y, kind: 'nugget' }; return; }
  // nächste lebende Goldader (Fels-Adern nur mit Feuerstein im Gepäck)
  let bs = null; bd = 1e9;
  for (const g of goldSpots) {
    if (!goldAlive(g)) continue;
    if (g.rock && p.flints === 0) continue;
    const d = Math.hypot(g.x - p.x, g.y - p.y) + (g.rock ? 200 : 0);
    if (d < bd) { bd = d; bs = g; }
  }
  if (bs) { s.target = { x: bs.x, y: bs.y, kind: 'gold' }; return; }
  s.target = { x: p.base.x, y: p.base.y - 1, kind: 'base' };
}
function goldAlive(g) {
  for (let yy = -5; yy <= 5; yy += 2) for (let xx = -5; xx <= 5; xx += 2) {
    if (matAt(g.x + xx, g.y + yy) === MAT.GOLD) return true;
  }
  return false;
}
function aiControl(p, dt) {
  const s = p.aiS, v = p.virt;
  v.left = v.right = v.jump = v.dig = v.throw = v.buy = false;
  if (p.state === 'dead' || game.state !== 'play') return;

  s.thinkT -= dt;
  if (s.thinkT <= 0) { s.thinkT = 0.3; aiThink(p); }
  if (Math.abs(p.x - s.lastX) < 1 && Math.abs(p.y - s.lastY) < 1) s.stuckT += dt;
  else s.stuckT = 0;
  s.lastX = p.x; s.lastY = p.y;

  if (s.throwNow) { s.throwNow = false; v.throw = true; }

  // Rückzug vor dem eigenen Feuerstein-Wurf auf den Fels
  if (s.phase === 'backoff') {
    s.backoffT -= dt;
    if (s.backDir < 0) v.left = true; else v.right = true;
    if (s.backoffT <= 0) {
      if (s.throwAfter && p.flints > 0 && s.target) {
        p.dir = s.target.x >= p.x ? 1 : -1;
        v.left = v.right = false;
        v.throw = true;
      }
      s.throwAfter = false; s.phase = 'wait'; s.waitT = 1.0;
    }
    return;
  }
  if (s.phase === 'wait') { s.waitT -= dt; if (s.waitT <= 0) s.phase = 'seek'; return; }

  const t = s.target;
  if (!t) return;
  const dx = t.x - p.x, dy = t.y - p.y, adx = Math.abs(dx);
  if (adx > 6) { if (dx < 0) v.left = true; else v.right = true; }

  // Graben Richtung Ziel
  if (dy > 14 && adx < 46) { v.dig = true; if (adx < 10) { v.left = v.right = false; } }
  else if (dy < -26 && adx < 40 && p.state !== 'scale') { v.dig = true; v.jump = true; }

  // Klettern & Anti-Klemm
  if (p.state === 'scale') v.jump = true;
  else if (s.stuckT > 0.7) {
    v.jump = true;
    if (s.stuckT > 1.8) {
      if (p.state === 'dig' && p.flints > 0) {
        // Fels im Weg: 50 px zurück, dann sprengen
        s.phase = 'backoff'; s.backoffT = 0.7; s.backDir = dx >= 0 ? -1 : 1; s.throwAfter = true;
      } else { s.target = null; s.thinkT = 0; }
      s.stuckT = 0;
    }
  }

  // an der Hütte: leere Taschen mit der Fabrik auffüllen
  if (t.kind === 'base' && Math.abs(p.x - p.base.x) < 40 && p.flints === 0 && p.score >= 2) v.buy = true;
}

// ---- Loren (Goldtransport wie im Clonk-Objektpaket) -------------------------
function probeDown(x, yStart) {
  for (let d = 0; d <= 14; d++) if (solid(x, yStart + d)) return yStart + d;
  return null;
}
function updateLores(dt) {
  for (const lo of lores) {
    const supported = solid(lo.x - 5, lo.y + 1) || solid(lo.x + 5, lo.y + 1);
    if (!supported) {
      lo.vy = Math.min(420, lo.vy + 420 * dt);
      lo.y += lo.vy * dt;
      if (solid(lo.x - 5, lo.y + 1) || solid(lo.x + 5, lo.y + 1)) {
        while (solid(lo.x - 5, lo.y) || solid(lo.x + 5, lo.y)) lo.y--;
        lo.vy = 0;
      }
      if (lo.y > WORLD_H + 30) {   // in die Tiefe gestürzt: neue Lore an der Hütte
        const home = players[lo.team];
        lo.x = home.base.x + (lo.team === 0 ? 44 : -44); lo.y = home.base.y - 1;
        lo.vx = 0; lo.vy = 0; lo.cargo = 0;
      }
    } else {
      // Hangneigung lässt die Lore rollen
      const yl = probeDown(lo.x - 5, lo.y - 4), yr = probeDown(lo.x + 5, lo.y - 4);
      if (yl !== null && yr !== null) lo.vx += (yr - yl) * 30 * dt;
      lo.vx *= Math.exp(-1.7 * dt);
      if (Math.abs(lo.vx) < 1) lo.vx = 0;
    }

    // Anschieben + getragenes Gold einladen
    for (const p of players) {
      if (p.state === 'dead') continue;
      const dx = lo.x - p.x;
      if (Math.abs(dx) < 17 && Math.abs(lo.y - p.y) < 16) {
        const dirIn = (down(p, 'right') ? 1 : 0) - (down(p, 'left') ? 1 : 0);
        if (dirIn && Math.sign(dx) === dirIn) lo.vx = dirIn * 62;
        if (p.carry > 0 && lo.cargo < LORE_MAX) {
          const n = Math.min(p.carry, LORE_MAX - lo.cargo);
          lo.cargo += n; p.carry -= n;
          addFloat(lo.x, lo.y - 16, `+${n} 🛒`, '#ffd166');
        }
      }
    }

    // Rollen mit Hangfolgen und Wand-Abprall
    if (lo.vx) {
      let m = Math.abs(lo.vx * dt), dir = Math.sign(lo.vx);
      while (m > 0) {
        const step = Math.min(1, m); m -= step;
        const nx = clamp(lo.x + dir * step, 10, WORLD_W - 10);
        // Wand? (feste Säule vor der Lore oberhalb der Radhöhe)
        let wall = 0;
        for (let yy = -2; yy >= -9; yy--) if (solid(nx + dir * 8, lo.y + yy)) wall++;
        if (wall >= 4) { lo.vx = -lo.vx * 0.3; break; }
        lo.x = nx;
        // Boden folgen (kleine Stufen hoch/runter)
        let up = 0;
        while (up <= 4 && (solid(lo.x - 5, lo.y - up) || solid(lo.x + 5, lo.y - up))) up++;
        if (up > 0 && up <= 4) lo.y -= up - 1;
        let d = 0;
        while (d <= 5 && !(solid(lo.x - 5, lo.y + 1 + d) || solid(lo.x + 5, lo.y + 1 + d))) d++;
        if (d > 0 && d <= 5) lo.y += d;
      }
    }

    // Klumpen aufsammeln
    if (lo.cargo < LORE_MAX) {
      for (const it of items) {
        if (it.dead || it.buried || it.type !== 'nugget') continue;
        if (Math.hypot(it.x - lo.x, it.y - (lo.y - 5)) < 13) {
          it.dead = true; lo.cargo++;
          if (lo.cargo >= LORE_MAX) break;
        }
      }
    }

    // an der eigenen Hütte entladen
    const home = players[lo.team];
    if (lo.cargo > 0 && Math.abs(lo.x - home.base.x) < 42 && Math.abs(lo.y - home.base.y) < 50) {
      home.score += lo.cargo;
      addFloat(lo.x, lo.y - 18, `+${lo.cargo} 💰`, '#ffd166');
      lo.cargo = 0;
      checkWin();
    }
  }
}

// ---- Items (Klumpen, Feuersteine) ------------------------------------------
function updateItems(dt) {
  for (const it of items) {
    if (it.dead) continue;
    if (it.buried) {                        // wartet darauf, freigelegt zu werden
      if (!solid(it.x, it.y)) { it.buried = false; it.vy = -20; }
      continue;
    }
    if (it.rest) {
      if (solid(it.x, it.y + 2)) continue;  // liegt weiter fest
      it.rest = false;                      // Boden weggegraben -> fällt
    }
    it.vy = Math.min(it.chute ? 38 : 420, it.vy + 420 * dt);
    it.x = clamp(it.x + it.vx * dt, 4, WORLD_W - 4);
    it.y += it.vy * dt;
    if (solid(it.x, it.y + 2)) {
      while (solid(it.x, it.y + 1)) it.y--;
      it.vx = 0; it.vy = 0; it.rest = true; it.chute = false;
    }
    if (it.y > WORLD_H + 10) it.dead = true;
  }
  items = items.filter((it) => !it.dead);
}

// gelegentlicher Feuerstein-Nachschub am Fallschirm
function updateFlintDrops(dt) {
  game.flintDropT -= dt;
  if (game.flintDropT > 0) return;
  game.flintDropT = 16 + rng() * 10;
  const inWorld = items.filter((i) => i.type === 'flint' && !i.buried).length;
  if (inWorld >= 5) return;
  items.push({ type: 'flint', x: 80 + rng() * (WORLD_W - 160), y: -14, vx: 0, vy: 20, chute: true });
}

// ---- Sieg & Rundenende ------------------------------------------------------
function checkWin() {
  for (const p of players) {
    if (p.score >= game.goal) { endRound(p); return; }
  }
}
function endRound(winner) {
  if (game.state === 'over') return;
  game.state = 'over';
  game.winner = winner;
}
function restart() { startGame(); }
function togglePause() { if (game.state === 'play') game.paused = !game.paused; }

// ---- Effekte ----------------------------------------------------------------
function addFloat(x, y, text, color) { floats.push({ x, y, text, color, t: 0 }); }
function puff(x, y, n, color) {
  for (let i = 0; i < n; i++) {
    parts.push({ x: x + rng() * 6 - 3, y: y + rng() * 4 - 2, vx: rng() * 50 - 25, vy: -20 - rng() * 40, t: 0, life: 0.4 + rng() * 0.3, color, size: 1.5 + rng() * 1.5, grav: 140 });
  }
}
function spark(x, y, n, color) {
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2, s = 30 + rng() * 90;
    parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: 0.25 + rng() * 0.25, color, size: 1 + rng(), grav: 60 });
  }
}
function updateFx(dt) {
  for (const q of parts) { q.t += dt; q.vy += (q.grav || 0) * dt; q.x += q.vx * dt; q.y += q.vy * dt; }
  parts = parts.filter((q) => q.t < q.life);
  for (const f of floats) { f.t += dt; f.y -= 22 * dt; }
  floats = floats.filter((f) => f.t < 1.4);
  for (let i = pendingBooms.length - 1; i >= 0; i--) {
    pendingBooms[i].t -= dt;
    if (pendingBooms[i].t <= 0) { const b = pendingBooms.splice(i, 1)[0]; explode(b.x, b.y, b.src); }
  }
  game.shakeT = Math.max(0, game.shakeT - dt);
}

// ---- Update-Hauptschritt ----------------------------------------------------
function update(dt) {
  if (game.state === 'play') {
    game.t -= dt;
    if (game.t <= 0) {
      game.t = 0;
      const [a, b] = players;
      endRound(a.score === b.score ? null : (a.score > b.score ? a : b));
    }
  }
  for (const p of players) updatePlayer(p, dt);
  updateProjectiles(dt);
  updateLores(dt);
  updateItems(dt);
  updateFlintDrops(dt);
  updateFx(dt);
}

// ---- Kamera -----------------------------------------------------------------
// zoom = 1: ganze Karte im Bild. Reingezoomt folgt die Kamera dem Klonk
// (solo) bzw. hält beide Spieler im Bild (2P). ＋/－ ändern den Zoom.
const cam = { x: WORLD_W / 2, y: WORLD_H / 2, zoom: 1, scale: 0 };
function setZoom(z) { cam.zoom = clamp(z, 1, 3.5); }
function posOf(p) { return p.state === 'dead' ? { x: p.base.x, y: p.base.y - 30 } : p; }
function computeCam(dt) {
  const fit = Math.min(CW / WORLD_W, (CH - TOP_UI - 8) / WORLD_H);
  let tx, ty, targetScale;
  if (game.mode === 'solo') {
    const p = posOf(players[0]);
    tx = p.x; ty = p.y - 26;
    targetScale = fit * cam.zoom;
  } else {
    const a = posOf(players[0]), b = posOf(players[1]);
    tx = (a.x + b.x) / 2; ty = (a.y + b.y) / 2 - 20;
    // nie so weit ranzoomen, dass einer aus dem Bild fällt
    const needW = Math.abs(a.x - b.x) + 280, needH = Math.abs(a.y - b.y) + 240;
    const fitBoth = Math.max(fit, Math.min(CW / needW, (CH - TOP_UI) / needH));
    targetScale = Math.min(fit * cam.zoom, fitBoth);
  }
  if (!cam.scale) cam.scale = targetScale;
  const k = Math.min(1, dt * 5);
  cam.scale += (targetScale - cam.scale) * k;
  const vw = CW / cam.scale, vh = (CH - TOP_UI) / cam.scale;
  tx = vw >= WORLD_W ? WORLD_W / 2 : clamp(tx, vw / 2, WORLD_W - vw / 2);
  ty = vh >= WORLD_H ? WORLD_H / 2 : clamp(ty, vh / 2, WORLD_H - vh / 2);
  cam.x += (tx - cam.x) * k;
  cam.y += (ty - cam.y) * k;
}

// ---- Rendering --------------------------------------------------------------
const stage = document.getElementById('stage');
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let CW = 0, CH = 0;
const TOP_UI = 64;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rot = stage.classList.contains('rot');   // Querformat: Bühne 90° gedreht
  CW = rot ? window.innerHeight : window.innerWidth;
  CH = rot ? window.innerWidth : window.innerHeight;
  canvas.width = Math.round(CW * dpr); canvas.height = Math.round(CH * dpr);
  canvas.style.width = CW + 'px'; canvas.style.height = CH + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);

const clouds = [
  { x: 140, y: 60, s: 1.0, v: 6 }, { x: 480, y: 110, s: 1.5, v: 4 }, { x: 780, y: 45, s: 0.8, v: 8 },
];

function draw(time) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0d1b28'; ctx.fillRect(0, 0, CW, CH);

  const S = cam.scale || 0.5;
  let shx = 0, shy = 0;
  if (game.shakeT > 0) {
    shx = (rng() - 0.5) * game.shakeA * game.shakeT * 8;
    shy = (rng() - 0.5) * game.shakeA * game.shakeT * 8;
  }
  const OX = CW / 2 - cam.x * S + shx;
  const OY = TOP_UI + (CH - TOP_UI) / 2 - cam.y * S + shy;

  ctx.save();
  ctx.translate(OX, OY); ctx.scale(S, S);

  // Himmel
  const sky = ctx.createLinearGradient(0, 0, 0, WORLD_H);
  sky.addColorStop(0, '#7ec3ea'); sky.addColorStop(0.55, '#b9e0f2'); sky.addColorStop(1, '#dcedf5');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  // Sonne
  ctx.fillStyle = '#ffe38a'; ctx.beginPath(); ctx.arc(840, 70, 26, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,227,138,0.35)'; ctx.beginPath(); ctx.arc(840, 70, 38, 0, Math.PI * 2); ctx.fill();
  // Wolken
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (const c of clouds) {
    c.x += c.v * 0.016; if (c.x > WORLD_W + 60) c.x = -60;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, 34 * c.s, 12 * c.s, 0, 0, Math.PI * 2);
    ctx.ellipse(c.x + 22 * c.s, c.y + 4 * c.s, 24 * c.s, 10 * c.s, 0, 0, Math.PI * 2);
    ctx.ellipse(c.x - 22 * c.s, c.y + 5 * c.s, 22 * c.s, 9 * c.s, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Gelände
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(terrainCanvas, 0, 0);

  // Hütten + Fabriken + Loren
  for (const p of players) drawHut(p);
  for (const lo of lores) drawLore(lo);
  // Items & Projektile
  for (const it of items) drawItem(it, time);
  for (const f of projectiles) drawFlint(f.x, f.y, f.spin);
  // Klonks
  for (const p of players) drawClonk(p, time);
  // Partikel & Floats
  for (const q of parts) {
    ctx.globalAlpha = clamp(1 - q.t / q.life, 0, 1);
    ctx.fillStyle = q.color; ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  for (const f of floats) {
    ctx.globalAlpha = clamp(1.4 - f.t, 0, 1);
    ctx.fillStyle = f.color; ctx.font = 'bold 11px system-ui';
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  drawHUD();
  if (game.paused && game.state === 'play') banner('⏸ Pause', 'Leertaste zum Weiterspielen');
  if (game.state === 'over') {
    const w = game.winner;
    banner(w ? `🏆 ${w.name} gewinnt!` : '🤝 Unentschieden!',
      (w ? `${w.score} Gold abgeliefert · ${w.ko} K. o.` : 'Gleich viel Gold') + ' — R für die Revanche');
  }
}

function drawHut(p) {
  const x = p.base.x, y = p.base.y;
  ctx.save(); ctx.translate(x, y);
  // Abliefer-Zone dezent markieren
  ctx.fillStyle = p.id === 0 ? 'rgba(231,76,60,0.10)' : 'rgba(63,127,214,0.10)';
  ctx.fillRect(-40, -46, 80, 46);
  // Chemiefabrik (Anbau auf der Außenseite)
  const fx = p.id === 0 ? -34 : 34;
  ctx.fillStyle = '#77808a'; ctx.fillRect(fx - 11, -18, 22, 18);
  ctx.fillStyle = '#5c646d'; ctx.fillRect(fx - 12, -20, 24, 4);
  ctx.fillStyle = '#4a525a'; ctx.fillRect(fx + 3, -32, 5, 13);           // Schornstein
  ctx.fillStyle = '#39424b'; ctx.font = '8px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('🏭', fx, -6);
  // Holzhütte
  ctx.fillStyle = '#8a6238'; ctx.fillRect(-20, -26, 40, 26);
  ctx.fillStyle = '#6d4c2a';
  for (let i = 0; i < 3; i++) ctx.fillRect(-20, -19 + i * 8, 40, 2);
  ctx.fillStyle = '#4a3018'; ctx.fillRect(4, -18, 10, 18);              // Tür
  ctx.fillStyle = '#5a3c20'; ctx.beginPath();                            // Dach
  ctx.moveTo(-26, -26); ctx.lineTo(0, -44); ctx.lineTo(26, -26); ctx.closePath(); ctx.fill();
  // Fahne
  ctx.strokeStyle = '#3a2a18'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-14, -44); ctx.lineTo(-14, -66); ctx.stroke();
  ctx.fillStyle = p.color;
  ctx.beginPath(); ctx.moveTo(-14, -66); ctx.lineTo(2, -61); ctx.lineTo(-14, -56); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawLore(lo) {
  ctx.save(); ctx.translate(lo.x, lo.y);
  // Wanne
  ctx.fillStyle = '#6b4a2c';
  ctx.beginPath();
  ctx.moveTo(-9, -12); ctx.lineTo(-7, -3); ctx.lineTo(7, -3); ctx.lineTo(9, -12);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#4c3218'; ctx.lineWidth = 1.4; ctx.stroke();
  // Teamfarbe als Streifen
  ctx.fillStyle = players[lo.team].color;
  ctx.fillRect(-7, -7, 14, 2);
  // Ladung
  if (lo.cargo > 0) {
    const h = Math.min(6, 1.4 + lo.cargo);
    ctx.fillStyle = '#e0b13a';
    ctx.beginPath(); ctx.ellipse(0, -12, 7, h * 0.7, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#ffe28a'; ctx.fillRect(-2, -13 - h * 0.3, 2, 2);
  }
  // Räder
  ctx.fillStyle = '#2e2e34';
  ctx.beginPath(); ctx.arc(-5, -2, 3, 0, Math.PI * 2); ctx.arc(5, -2, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#8a8a95';
  ctx.fillRect(-5.7, -2.7, 1.4, 1.4); ctx.fillRect(4.3, -2.7, 1.4, 1.4);
  ctx.restore();
}

function drawItem(it, time) {
  if (it.buried) return;
  if (it.type === 'nugget') {
    ctx.save(); ctx.translate(it.x, it.y);
    ctx.fillStyle = '#e0b13a';
    ctx.beginPath();
    ctx.moveTo(-4, 1); ctx.lineTo(-2, -3); ctx.lineTo(2, -4); ctx.lineTo(4, 0); ctx.lineTo(2, 2); ctx.lineTo(-2, 3);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffe28a'; ctx.fillRect(-1, -2, 2, 2);
    ctx.restore();
  } else {
    if (it.chute) {
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(it.x - 8, it.y - 12); ctx.quadraticCurveTo(it.x, it.y - 22, it.x + 8, it.y - 12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(it.x - 8, it.y - 12); ctx.lineTo(it.x, it.y - 2); ctx.lineTo(it.x + 8, it.y - 12); ctx.stroke();
    }
    drawFlint(it.x, it.y, 0);
    if (((time * 2) | 0) % 2) { ctx.fillStyle = '#ff5a3c'; ctx.fillRect(it.x + 2, it.y - 5, 2, 2); }
  }
}
function drawFlint(x, y, spin) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(spin);
  ctx.fillStyle = '#2b2b33';
  ctx.beginPath();
  ctx.moveTo(-4, 0); ctx.lineTo(-1, -4); ctx.lineTo(3, -2); ctx.lineTo(4, 2); ctx.lineTo(0, 4);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#55555f'; ctx.fillRect(-1, -2, 2, 2);
  ctx.restore();
}

function drawClonk(p, time) {
  if (p.state === 'dead') {
    ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = 'bold 11px system-ui';
    ctx.fillText(`⏳ ${Math.ceil(p.respawnT)}`, p.base.x + (p.id === 0 ? 26 : -26), groundY[p.base.x] - 40);
    return;
  }
  ctx.save();
  ctx.translate(p.x, p.y);
  if (p.state === 'tumble') ctx.rotate(Math.sin(p.tumbleT * 18) * 0.7);
  ctx.scale(p.dir, 1);
  if (p.hurtT > 0 && ((time * 18) | 0) % 2) ctx.globalAlpha = 0.55;

  const legA = (p.state === 'walk' || p.state === 'dig') ? Math.sin(p.walkPhase) * 2.2 : (p.state === 'air' ? 1.5 : 0);
  // Beine
  ctx.fillStyle = '#43301e';
  ctx.fillRect(-3 + legA, -3, 3, 3); ctx.fillRect(1 - legA, -3, 3, 3);
  // Körper (Kittel)
  ctx.fillStyle = '#c8a06a';
  ctx.fillRect(-4, -11, 9, 8);
  ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(-4, -5, 9, 2);
  // Arme
  ctx.fillStyle = '#b98f5c';
  if (p.state === 'scale') { ctx.fillRect(2, -14, 3, 5); ctx.fillRect(2, -8, 3, 4); }
  else if (p.state === 'dig') { ctx.fillRect(2, -9 + Math.sin(p.walkPhase) * 1.5, 4, 3); }
  else ctx.fillRect(-5, -10, 2, 5);
  // Schaufel beim Graben
  if (p.state === 'dig') {
    ctx.save(); ctx.translate(6, -7); ctx.rotate(0.6 + Math.sin(p.walkPhase) * 0.35);
    ctx.fillStyle = '#7a5a34'; ctx.fillRect(0, -1, 7, 1.6);
    ctx.fillStyle = '#9aa0aa'; ctx.fillRect(6, -2.6, 3.4, 4.4);
    ctx.restore();
  }
  // Kopf
  ctx.fillStyle = '#f0c9a0'; ctx.fillRect(-3, -16, 7, 6);
  ctx.fillStyle = '#241a10'; ctx.fillRect(1.6, -14, 1.4, 1.6);   // Auge
  // Zipfelmütze in Teamfarbe
  ctx.fillStyle = p.color;
  ctx.beginPath();
  ctx.moveTo(-4, -15.5); ctx.lineTo(4.5, -15.5); ctx.lineTo(1, -21); ctx.lineTo(-6, -18.5);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillRect(-6.6, -19.4, 2.2, 2.2);   // Bommel
  // Goldsack, wenn beladen
  if (p.carry > 0) {
    ctx.fillStyle = '#8a6a3c'; ctx.beginPath(); ctx.arc(-5.5, -7, 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd166'; ctx.fillRect(-6.4, -8.2, 1.6, 1.6);
  }
  ctx.restore();

  // Namensschild + HP-Balken
  ctx.textAlign = 'center';
  ctx.font = 'bold 9px system-ui';
  ctx.fillStyle = p.color;
  ctx.fillText((p.ai ? '🤖 ' : '') + p.name, p.x, p.y - PH - 10);
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(p.x - 9, p.y - PH - 8, 18, 3);
  ctx.fillStyle = p.hp > 35 ? '#5ad06e' : '#ff6a5a';
  ctx.fillRect(p.x - 9, p.y - PH - 8, 18 * clamp(p.hp / 100, 0, 1), 3);
}

function drawHUD() {
  const y0 = 8;
  // Uhr in der Mitte
  ctx.fillStyle = 'rgba(8,25,42,0.72)';
  roundRect(CW / 2 - 42, y0, 84, 28, 10); ctx.fill();
  const mm = Math.floor(game.t / 60), ss = Math.floor(game.t % 60);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = game.t < 30 && game.state === 'play' ? '#ff6a5a' : '#eaf3fa';
  ctx.font = 'bold 14px system-ui';
  ctx.fillText(`⏱ ${mm}:${ss.toString().padStart(2, '0')}`, CW / 2, y0 + 15);

  const wide = CW >= 720;
  if (wide) {
    const w = 200, h = 48;
    for (const p of players) {
      const left = p.id === 0;
      const x0 = left ? 158 : CW - 12 - w;
      ctx.fillStyle = 'rgba(8,25,42,0.72)';
      roundRect(x0, y0, w, h, 10); ctx.fill();
      ctx.textAlign = 'left';
      ctx.fillStyle = p.color; ctx.font = 'bold 14px system-ui';
      ctx.fillText((p.ai ? '🤖 ' : left ? '🔴 ' : '🔵 ') + p.name, x0 + 10, y0 + 14);
      ctx.fillStyle = '#eaf3fa'; ctx.font = '12px system-ui';
      ctx.fillText(`⭐ ${p.score}/${game.goal}`, x0 + 92, y0 + 14);
      ctx.fillText(`💰 ${p.carry}  💣 ${p.flints}  🥊 ${p.ko}`, x0 + 10, y0 + 35);
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x0 + 126, y0 + 31, 64, 7);
      ctx.fillStyle = p.hp > 35 ? '#5ad06e' : '#ff6a5a';
      ctx.fillRect(x0 + 126, y0 + 31, 64 * clamp(p.hp / 100, 0, 1), 7);
    }
  } else {
    // Kompakt: eine Zeile unter Uhr/Toolbar
    ctx.font = 'bold 12px system-ui';
    const [a, b] = players;
    ctx.textAlign = 'left'; ctx.fillStyle = a.color;
    ctx.fillText(`🔴⭐${a.score}/${game.goal} 💰${a.carry} 💣${a.flints}`, 10, 50);
    ctx.textAlign = 'right'; ctx.fillStyle = b.color;
    ctx.fillText(`⭐${b.score}/${game.goal} 💰${b.carry} 💣${b.flints} ${b.ai ? '🤖' : '🔵'}`, CW - 10, 50);
  }
  ctx.textBaseline = 'alphabetic';
}
function banner(title, sub) {
  ctx.fillStyle = 'rgba(8,25,42,0.85)';
  roundRect(CW / 2 - 190, CH / 2 - 70, 380, 86, 14); ctx.fill();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff'; ctx.font = 'bold 24px system-ui';
  ctx.fillText(title, CW / 2, CH / 2 - 42);
  ctx.fillStyle = '#bcd6ea'; ctx.font = '13px system-ui';
  ctx.fillText(sub, CW / 2, CH / 2 - 12);
  ctx.textBaseline = 'alphabetic';
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ---- Menü / Buttons ---------------------------------------------------------
const menuEl = document.getElementById('menu');
const helpEl = document.getElementById('help');
document.getElementById('btn-menu').addEventListener('click', () => menuEl.classList.remove('hidden'));
document.getElementById('btn-menu-close').addEventListener('click', () => menuEl.classList.add('hidden'));
menuEl.addEventListener('click', (e) => { if (e.target === menuEl) menuEl.classList.add('hidden'); });
document.getElementById('btn-help').addEventListener('click', () => { menuEl.classList.add('hidden'); helpEl.classList.remove('hidden'); });
document.getElementById('btn-start').addEventListener('click', () => helpEl.classList.add('hidden'));
document.getElementById('btn-restart').addEventListener('click', () => { menuEl.classList.add('hidden'); restart(); });
document.getElementById('btn-pause').addEventListener('click', togglePause);
document.getElementById('btn-rotate').addEventListener('click', () => { stage.classList.toggle('rot'); resize(); });
document.getElementById('b-zoomin').addEventListener('click', () => setZoom(cam.zoom * 1.3));
document.getElementById('b-zoomout').addEventListener('click', () => setZoom(cam.zoom / 1.3));

const selGoal = document.getElementById('sel-goal');
selGoal.addEventListener('change', () => { game.goal = parseInt(selGoal.value, 10) || 8; checkWin(); });
const selMode = document.getElementById('sel-mode');
selMode.value = game.mode;
selMode.addEventListener('change', () => {
  game.mode = selMode.value === 'solo' ? 'solo' : '2p';
  try { localStorage.setItem('clonk_mode', game.mode); } catch { /* egal */ }
  menuEl.classList.add('hidden');
  restart();
});

// Touch-Steuerkreuz (steuert Rot); ohne Touch-Gerät ausgeblendet
setBtn('b-left'); setBtn('b-right'); setBtn('b-jump'); setBtn('b-dig');
setBtn('b-fire'); setBtn('b-buy');
if (!IS_TOUCH) {
  document.getElementById('wctrl-left').classList.add('hidden');
  document.getElementById('wctrl-right').classList.add('hidden');
}
// Hochformat-Handys: automatisch ins Querformat drehen
if (IS_TOUCH && window.innerWidth < window.innerHeight) stage.classList.add('rot');

// ---- Schleife ---------------------------------------------------------------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.04, (now - last) / 1000); last = now;
  if (!game.paused) update(dt);
  computeCam(dt);
  draw(now / 1000);
  requestAnimationFrame(frame);
}

// Test-Hook (Muster wie window.__td / window.__lem)
window.__clonk = {
  MAT, game, WORLD_W, WORLD_H, cam, setZoom, IS_TOUCH,
  get mask() { return mask; },
  matAt, solid, grounded, carveCircle, explode, update, startGame, restart,
  computeCam, buyFlint,
  players: () => players, items: () => items, projectiles: () => projectiles,
  lores: () => lores, goldSpots: () => goldSpots,
  groundY: () => groundY, pressed, buttons, throwFlint, hurt,
};

resize();
startGame();
requestAnimationFrame(frame);
