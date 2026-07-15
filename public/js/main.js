// Spielschleife, Eingaben (Touch/Maus/Tastatur) und Kollision mit Land.

import { clamp, angleOf, normAngle, MS_TO_KN } from './util.js';
import { Terrain } from './terrain.js';
import { Boat, Wind, BOAT_TYPES } from './boat.js';
import { Renderer } from './render.js';

const canvas = document.getElementById('game');
let terrain = new Terrain(Math.floor(Math.random() * 1e9));
const wind = new Wind();
const boat = new Boat(BOAT_TYPES.jolle);
boat.reset(normAngle(wind.dirFrom + Math.PI / 2)); // Start auf Halbwindkurs
const renderer = new Renderer(canvas, terrain);

window.addEventListener('resize', () => renderer.resize());

// ---- Eingabe -------------------------------------------------------------
// Linke Bildschirmhälfte: horizontal ziehen = Ruder.
// Rechte Bildschirmhälfte: vertikal ziehen = Schot dichtholen/fieren.
// Windrose: ziehen = Windrichtung und -stärke setzen.
const pointers = new Map();
let steerPointer = null;

function applyWindDrag(p) {
  const dx = p.x - renderer.rose.x;
  const dy = p.y - renderer.rose.y;
  const dist = Math.hypot(dx, dy);
  const dirFrom = angleOf({ x: dx, y: dy });
  const speed = clamp(dist / renderer.rose.r, 0.12, 1) * 12; // bis ~23 kn
  wind.set(dirFrom, speed);
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  hideHelp();
  const p = { x: e.clientX, y: e.clientY };
  if (renderer.inRose(p)) {
    pointers.set(e.pointerId, { role: 'wind' });
    applyWindDrag(p);
  } else if (p.x < renderer.W / 2) {
    pointers.set(e.pointerId, { role: 'steer', startX: p.x });
    steerPointer = e.pointerId;
  } else {
    pointers.set(e.pointerId, { role: 'trim', startY: p.y, startTrim: boat.trim });
  }
});

canvas.addEventListener('pointermove', (e) => {
  const st = pointers.get(e.pointerId);
  if (!st) return;
  const p = { x: e.clientX, y: e.clientY };
  if (st.role === 'wind') {
    applyWindDrag(p);
  } else if (st.role === 'steer') {
    boat.rudder = clamp((p.x - st.startX) / 90, -1, 1);
  } else if (st.role === 'trim') {
    boat.trim = clamp(st.startTrim + (st.startY - p.y) / 220, 0, 1);
  }
});

function endPointer(e) {
  const st = pointers.get(e.pointerId);
  if (st && st.role === 'steer') {
    boat.rudder = 0;
    steerPointer = null;
  }
  pointers.delete(e.pointerId);
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Tastatur (Desktop): Pfeile links/rechts = Ruder, hoch/runter = Schot
const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.key.startsWith('Arrow')) {
    e.preventDefault();
    keys.add(e.key);
    hideHelp();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key));

function applyKeys(dt) {
  if (steerPointer === null) {
    let r = 0;
    if (keys.has('ArrowLeft')) r -= 1;
    if (keys.has('ArrowRight')) r += 1;
    if (r !== 0) boat.rudder = clamp(boat.rudder + r * dt * 3, -1, 1);
    else if (keys.size >= 0 && boat.rudder !== 0 && !keys.has('ArrowLeft') && !keys.has('ArrowRight')) {
      boat.rudder *= Math.max(0, 1 - dt * 6);
      if (Math.abs(boat.rudder) < 0.02) boat.rudder = 0;
    }
  }
  if (keys.has('ArrowUp')) boat.trim = clamp(boat.trim + dt * 0.6, 0, 1);
  if (keys.has('ArrowDown')) boat.trim = clamp(boat.trim - dt * 0.6, 0, 1);
}

// ---- UI-Buttons ------------------------------------------------------------
const helpEl = document.getElementById('help');
function hideHelp() {
  helpEl.classList.add('hidden');
}
document.getElementById('btn-start').addEventListener('click', hideHelp);
document.getElementById('btn-help').addEventListener('click', () => {
  helpEl.classList.remove('hidden');
});
document.getElementById('btn-map').addEventListener('click', () => {
  terrain = new Terrain(Math.floor(Math.random() * 1e9));
  renderer.setTerrain(terrain);
  boat.reset(normAngle(wind.dirFrom + Math.PI / 2));
});
const btnWander = document.getElementById('btn-wander');
function wanderLabel() {
  btnWander.textContent = wind.wander ? '🌬 Wind wandert: an' : '🌬 Wind wandert: aus';
}
btnWander.addEventListener('click', () => {
  wind.wander = !wind.wander;
  wind.set(wind.dirFrom, wind.speed);
  wanderLabel();
});
wanderLabel();

// ---- Kollision mit Land ----------------------------------------------------
const HULL_POINTS = [[0, -2.9], [0.9, 0.2], [-0.9, 0.2], [0, 2.5]];

function hullHitsLand() {
  const cs = Math.cos(boat.heading), sn = Math.sin(boat.heading);
  for (const [lx, ly] of HULL_POINTS) {
    const wx = boat.x + lx * cs - ly * sn;
    const wy = boat.y + lx * sn + ly * cs;
    if (terrain.isLand(wx, wy)) return true;
  }
  return false;
}

function resolveCollision() {
  if (!hullHitsLand()) return;
  // Gefälle des Geländes -> Richtung zurück ins Wasser
  const e = 3;
  const gx = terrain.height(boat.x + e, boat.y) - terrain.height(boat.x - e, boat.y);
  const gy = terrain.height(boat.x, boat.y + e) - terrain.height(boat.x, boat.y - e);
  let nl = Math.hypot(gx, gy);
  let nx, ny;
  if (nl > 1e-6) {
    nx = -gx / nl;
    ny = -gy / nl;
  } else {
    // Notfall: entgegen der Fahrtrichtung
    const sp = Math.hypot(boat.vx, boat.vy) || 1;
    nx = -boat.vx / sp;
    ny = -boat.vy / sp;
  }
  for (let i = 0; i < 60 && hullHitsLand(); i++) {
    boat.x += nx * 0.35;
    boat.y += ny * 0.35;
  }
  // Aufprall: Geschwindigkeit ins Land wegnehmen, stark abbremsen
  const vn = boat.vx * nx + boat.vy * ny;
  if (vn < 0) {
    boat.vx -= vn * nx * 1.3;
    boat.vy -= vn * ny * 1.3;
  }
  boat.vx *= 0.35;
  boat.vy *= 0.35;
  boat.angVel *= 0.5;
}

// ---- Schleife ---------------------------------------------------------------
let last = performance.now();
let time = 0;

// Debug-/Test-Zugriff in der Konsole
window.__game = { boat, wind, get terrain() { return terrain; }, renderer };

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;

  applyKeys(dt);
  wind.update(dt);
  boat.update(dt, wind);
  resolveCollision();
  renderer.draw(boat, wind, time, dt);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
