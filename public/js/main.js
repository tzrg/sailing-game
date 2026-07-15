// Spielschleife, Eingaben (Touch/Maus/Tastatur) und Kollision mit Land.

import { clamp, angleOf, normAngle, MS_TO_KN } from './util.js';
import { Terrain } from './terrain.js';
import { Boat, Wind, BOAT_TYPES } from './boat.js';
import { Renderer } from './render.js';
import { Race, findWaterSpot } from './race.js';

const canvas = document.getElementById('game');
// Karten-Einstellungen (im Menü einstellbar, wirken bei "Neue Karte")
const mapCfg = { mode: 'see', lakeSize: 0.5, islandDensity: 0.5, islandSize: 0.3 };
let terrain = new Terrain(Math.floor(Math.random() * 1e9), mapCfg);
const wind = new Wind();
const boat = new Boat(BOAT_TYPES.jolle);
boat.reset(normAngle(wind.dirFrom + Math.PI / 2)); // Start auf Halbwindkurs
const renderer = new Renderer(canvas, terrain);
const race = new Race();

window.addEventListener('resize', () => renderer.resize());

// ---- Eingabe -------------------------------------------------------------
// Linke Bildschirmhälfte: horizontal ziehen = Ruder.
// Rechte Bildschirmhälfte: vertikal ziehen = beide Schoten zusammen.
// Schot-Regler (rechts unten): einzeln Groß- bzw. Fockschot.
// Windrose: ziehen = Windrichtung und -stärke setzen.
const pointers = new Map();
let steerPointer = null;

function applyTrimBar(which, p) {
  const r = renderer.trimBars[which];
  const v = clamp((r.y + r.h - p.y) / r.h, 0, 1);
  if (which === 'main') boat.trimMain = v;
  else if (which === 'jib') boat.trimJib = v;
  else if (which === 'spi') {
    boat.spiHoist = v;
    boat.spiTarget = v;
  }
  disableAutoTrim();
}

function applyRudderBar(p) {
  const r = renderer.rudderBar;
  boat.rudder = clamp((p.x - (r.x + r.w / 2)) / (r.w / 2 - 14), -1, 1);
}

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
  const bar = renderer.hitTrimBar(p);
  if (renderer.inRose(p)) {
    pointers.set(e.pointerId, { role: 'wind' });
    applyWindDrag(p);
  } else if (bar) {
    pointers.set(e.pointerId, { role: 'bar', bar });
    applyTrimBar(bar, p);
  } else if (renderer.hitRudderBar(p)) {
    pointers.set(e.pointerId, { role: 'rudbar' });
    applyRudderBar(p);
  } else if (p.x < renderer.W / 2) {
    pointers.set(e.pointerId, { role: 'steer', startX: p.x });
    steerPointer = e.pointerId;
  } else {
    pointers.set(e.pointerId, {
      role: 'trim',
      startY: p.y,
      startMain: boat.trimMain,
      startJib: boat.trimJib,
    });
  }
});

canvas.addEventListener('pointermove', (e) => {
  const st = pointers.get(e.pointerId);
  if (!st) return;
  const p = { x: e.clientX, y: e.clientY };
  if (st.role === 'wind') {
    applyWindDrag(p);
  } else if (st.role === 'bar') {
    applyTrimBar(st.bar, p);
  } else if (st.role === 'rudbar') {
    applyRudderBar(p);
  } else if (st.role === 'steer') {
    boat.rudder = clamp((p.x - st.startX) / 90, -1, 1);
  } else if (st.role === 'trim') {
    const d = (st.startY - p.y) / 220;
    boat.trimMain = clamp(st.startMain + d, 0, 1);
    boat.trimJib = clamp(st.startJib + d, 0, 1);
    disableAutoTrim();
  }
});

function endPointer(e) {
  const st = pointers.get(e.pointerId);
  if (st && st.role === 'steer') {
    boat.rudder = 0; // Geste losgelassen -> Ruder mittschiffs
    steerPointer = null;
  }
  // der Ruder-Schieber dagegen bleibt stehen, wo man ihn hingezogen hat
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
  } else if (e.key === '+' || e.key === '=') {
    setZoom(zoomIdx + 1);
  } else if (e.key === '-') {
    setZoom(zoomIdx - 1);
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key));

let keySteerActive = false; // nur Tasten-Steuerung zentriert von selbst zurück
function applyKeys(dt) {
  if (steerPointer === null) {
    let r = 0;
    if (keys.has('ArrowLeft')) r -= 1;
    if (keys.has('ArrowRight')) r += 1;
    if (r !== 0) {
      boat.rudder = clamp(boat.rudder + r * dt * 3, -1, 1);
      keySteerActive = true;
    } else if (keySteerActive) {
      boat.rudder *= Math.max(0, 1 - dt * 6);
      if (Math.abs(boat.rudder) < 0.02) {
        boat.rudder = 0;
        keySteerActive = false;
      }
    }
  }
  if (keys.has('ArrowUp')) {
    boat.trimMain = clamp(boat.trimMain + dt * 0.6, 0, 1);
    boat.trimJib = clamp(boat.trimJib + dt * 0.6, 0, 1);
    disableAutoTrim();
  }
  if (keys.has('ArrowDown')) {
    boat.trimMain = clamp(boat.trimMain - dt * 0.6, 0, 1);
    boat.trimJib = clamp(boat.trimJib - dt * 0.6, 0, 1);
    disableAutoTrim();
  }
}

// ---- UI: Hamburger-Menü ------------------------------------------------------
const helpEl = document.getElementById('help');
const menuEl = document.getElementById('menu');
function hideHelp() {
  helpEl.classList.add('hidden');
}
function closeMenu() {
  menuEl.classList.add('hidden');
}
document.getElementById('btn-menu').addEventListener('click', () => {
  menuEl.classList.remove('hidden');
});
document.getElementById('btn-menu-close').addEventListener('click', closeMenu);
menuEl.addEventListener('click', (e) => {
  if (e.target === menuEl) closeMenu(); // Klick auf den Hintergrund
});
document.getElementById('btn-start').addEventListener('click', hideHelp);
document.getElementById('btn-help').addEventListener('click', () => {
  closeMenu();
  helpEl.classList.remove('hidden');
});

// Karten-Einstellungen
const modeSee = document.getElementById('mode-see');
const modeMeer = document.getElementById('mode-meer');
const rowLake = document.getElementById('row-lake');
function setMode(mode) {
  mapCfg.mode = mode;
  modeSee.classList.toggle('active', mode === 'see');
  modeMeer.classList.toggle('active', mode === 'meer');
  rowLake.classList.toggle('hidden', mode !== 'see');
}
modeSee.addEventListener('click', () => setMode('see'));
modeMeer.addEventListener('click', () => setMode('meer'));
document.getElementById('rng-lake').addEventListener('input', (e) => {
  mapCfg.lakeSize = parseFloat(e.target.value);
});
document.getElementById('rng-dens').addEventListener('input', (e) => {
  mapCfg.islandDensity = parseFloat(e.target.value);
});
document.getElementById('rng-size').addEventListener('input', (e) => {
  mapCfg.islandSize = parseFloat(e.target.value);
});

document.getElementById('btn-map').addEventListener('click', () => {
  terrain = new Terrain(Math.floor(Math.random() * 1e9), mapCfg);
  renderer.setTerrain(terrain);
  boat.reset(normAngle(wind.dirFrom + Math.PI / 2));
  placeBoatOnWater();
  race.cancel();
  raceLabel();
  closeMenu();
});

// Startpunkt notfalls auf freies Wasser schieben
function placeBoatOnWater() {
  const spot = findWaterSpot(terrain, boat.x, boat.y, 10);
  boat.x = spot.x;
  boat.y = spot.y;
}
placeBoatOnWater();

// Bootstyp durchschalten
const btnBoat = document.getElementById('btn-boat');
const typeKeys = Object.keys(BOAT_TYPES);
let typeIdx = 0;
function boatLabel() {
  btnBoat.textContent = '⛵ ' + boat.type.name;
}
btnBoat.addEventListener('click', () => {
  typeIdx = (typeIdx + 1) % typeKeys.length;
  boat.setType(BOAT_TYPES[typeKeys[typeIdx]]);
  boatLabel();
});
boatLabel();

// Regatta starten/abbrechen/neu
const btnRace = document.getElementById('btn-race');
function raceLabel() {
  btnRace.textContent =
    race.state === 'idle' ? '🏁 Regatta' :
    race.state === 'finished' ? '🏁 Nochmal' : '🏁 Abbrechen';
}
btnRace.addEventListener('click', () => {
  hideHelp();
  closeMenu();
  if (race.state === 'idle' || race.state === 'finished') {
    race.arm(terrain, boat);
  } else {
    race.cancel();
  }
  raceLabel();
});
raceLabel();

// ---- Grundberührung: Freikommen ---------------------------------------------
const btnFree = document.getElementById('btn-free');
let groundedT = 0;
btnFree.addEventListener('click', () => {
  // Richtung ins tiefe Wasser (bergab im Höhenfeld)
  const e = 3;
  const gx = terrain.height(boat.x + e, boat.y) - terrain.height(boat.x - e, boat.y);
  const gy = terrain.height(boat.x, boat.y + e) - terrain.height(boat.x, boat.y - e);
  const nl = Math.hypot(gx, gy);
  let nx, ny;
  if (nl > 1e-6) {
    nx = -gx / nl;
    ny = -gy / nl;
  } else {
    nx = -Math.sin(boat.heading); // Notfall: rückwärts
    ny = Math.cos(boat.heading);
  }
  const L = boat.type.lengthM;
  let spot = null;
  for (const d of [3, 5, 8, 12, 18, 28]) {
    const px = boat.x + nx * d * L;
    const py = boat.y + ny * d * L;
    if (!terrain.isLand(px, py)) {
      spot = findWaterSpot(terrain, px, py, 8);
      break;
    }
  }
  if (!spot) spot = findWaterSpot(terrain, boat.x, boat.y, 8);
  boat.x = spot.x;
  boat.y = spot.y;
  boat.vx = 0;
  boat.vy = 0;
  boat.angVel = 0;
  race.addPenalty(10);
  groundedT = 0;
});

let btnFreeVisible = false;
function updateFreeButton(dt) {
  groundedT = Math.max(0, groundedT - dt);
  const show = groundedT > 0;
  if (show !== btnFreeVisible) {
    btnFreeVisible = show;
    btnFree.classList.toggle('hidden', !show);
    btnFree.textContent = race.state === 'running'
      ? '⚓ Freikommen (+10 s)'
      : '⚓ Freikommen';
  }
}
// Zoomstufen (herausgezoomt sieht man Kurs und Küste)
const ZOOM_LEVELS = [0.1, 0.2, 0.35, 0.6, 1, 1.5];
let zoomIdx = 4;
function setZoom(i) {
  zoomIdx = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, i));
  renderer.zoom = ZOOM_LEVELS[zoomIdx];
}
document.getElementById('btn-zoom-in').addEventListener('click', () => setZoom(zoomIdx + 1));
document.getElementById('btn-zoom-out').addEventListener('click', () => setZoom(zoomIdx - 1));

// Autotrim: Segel stellen sich selbst optimal
const btnAuto = document.getElementById('btn-autotrim');
function autoLabel() {
  btnAuto.textContent = boat.autoTrim ? '🪄 Autotrim: an' : '🪄 Autotrim: aus';
}
function disableAutoTrim() {
  if (boat.autoTrim) {
    boat.autoTrim = false;
    autoLabel();
  }
}
btnAuto.addEventListener('click', () => {
  boat.autoTrim = !boat.autoTrim;
  autoLabel();
});
autoLabel();

// Vektoranzeige (Wind, Fahrt, Vortrieb, Drift)
const btnVec = document.getElementById('btn-vectors');
function vecLabel() {
  btnVec.textContent = renderer.showVectors ? '📐 Vektoren: an' : '📐 Vektoren: aus';
}
btnVec.addEventListener('click', () => {
  renderer.showVectors = !renderer.showVectors;
  vecLabel();
});
vecLabel();

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
  groundedT = 1.5; // Freikommen-Knopf zeigen, solange wir festhängen
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
window.__game = { boat, wind, race, get terrain() { return terrain; }, renderer };

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;

  applyKeys(dt);
  wind.update(dt);
  const prevPos = { x: boat.x, y: boat.y };
  boat.update(dt, wind);
  resolveCollision();
  const prevState = race.state;
  race.update(boat, prevPos, dt);
  if (race.state !== prevState) raceLabel();
  updateFreeButton(dt);
  renderer.draw(boat, wind, race, time, dt);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
