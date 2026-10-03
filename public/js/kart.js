// 🏁 Kart-Rennen – Hommage an die großen Kart-Vorbilder (eigenständig gebaut).
//
// Die Strecke ist eine echte 2D-Karte (1024×1024 Pixel mit Oberflächen-Info),
// die per Mode-7-Projektion zeilenweise in 3D-Perspektive gezeichnet wird –
// genau wie beim SNES-Urahn. Darüber liegen Billboard-Sprites (Karts, Bananen,
// Panzer, Item-Boxen, Bäume), die mit derselben Projektion einsortiert werden.
//
// Features: drei Fahrer mit eigenen Fahrwerten, Drift mit Mini-Turbo,
// Item-Boxen (Banane, grüner Panzer, Pilz, Blitz), Boost-Felder, Gras/Sand als
// Bremse, KI-Gegner mit Gummiband, Rundenzeiten + Bestzeit, Platzierung,
// Minimap, Touch-Steuerung und Querformat-Drehung.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;
// Winkel auf -PI..PI normieren
function norm(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

/* ---------------------------------------------------- Strecke & Material -- */

const MAP = 1024;              // Kantenlänge der Streckenkarte (Welteinheiten)
const ROAD_HW = 40;            // halbe Fahrbahnbreite
const SURF = { GRASS: 0, ROAD: 1, CURB: 2, BOOST: 3, SAND: 4 };
// Stützpunkte der Mittellinie (geschlossener Kurs, im Uhrzeigersinn gefahren)
const CTRL = [
  [250, 858], [560, 886], [800, 820], [892, 640], [800, 492],
  [862, 318], [700, 170], [452, 182], [330, 300], [432, 452],
  [318, 598], [168, 690],
];
const NODES = 480;             // so fein wird die Mittellinie abgetastet
const PATH = [];               // { x, y, ang } – Fahrlinie
const BOOSTS = [40, 190, 300]; // Knoten mit Boost-Feldern

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
    + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
function buildPath() {
  const n = CTRL.length;
  const raw = [];
  const per = Math.ceil(NODES / n);
  for (let i = 0; i < n; i++) {
    const p0 = CTRL[(i - 1 + n) % n], p1 = CTRL[i], p2 = CTRL[(i + 1) % n], p3 = CTRL[(i + 2) % n];
    for (let s = 0; s < per; s++) {
      const t = s / per;
      raw.push({ x: catmull(p0[0], p1[0], p2[0], p3[0], t), y: catmull(p0[1], p1[1], p2[1], p3[1], t) });
    }
  }
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i], b = raw[(i + 1) % raw.length];
    PATH.push({ x: a.x, y: a.y, ang: Math.atan2(b.y - a.y, b.x - a.x) });
  }
}
buildPath();
const N = PATH.length;
const nodeAt = (i) => { const j = Math.round(i); return PATH[((j % N) + N) % N]; };
// Punkt seitlich neben der Mittellinie (off = Querversatz)
function sidePoint(i, off) {
  const p = nodeAt(i);
  return { x: p.x + Math.cos(p.ang + Math.PI / 2) * off, y: p.y + Math.sin(p.ang + Math.PI / 2) * off };
}

// Die Strecke wird einmal in zwei Leinwände gemalt: eine fürs Auge, eine mit
// flachen Kennfarben für die Oberflächen-Abfrage (Asphalt, Gras, Randstein …).
let texData = null;            // Pixel der Optik-Textur
let surf = null;               // Uint8Array mit SURF-Werten
let texCanvas = null;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function buildTrack() {
  texCanvas = makeCanvas(MAP, MAP);
  const vc = texCanvas.getContext('2d');
  const ic = makeCanvas(MAP, MAP).getContext('2d');
  const both = (fn) => { fn(vc, false); fn(ic, true); };
  const id = (s) => `rgb(${s},0,0)`;

  // Wiese
  vc.fillStyle = '#4f8f3f'; vc.fillRect(0, 0, MAP, MAP);
  ic.fillStyle = id(SURF.GRASS); ic.fillRect(0, 0, MAP, MAP);

  // Sandflächen neben der Strecke (bremsen, sehen aber hübsch aus)
  const sand = [[150, 420, 90, 60], [690, 300, 70, 110], [560, 700, 120, 70], [880, 880, 110, 80]];
  both((c, isId) => {
    c.fillStyle = isId ? id(SURF.SAND) : '#d8c488';
    for (const [x, y, rx, ry] of sand) {
      c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, TAU); c.fill();
    }
  });

  const trace = (c, off) => {
    c.beginPath();
    for (let i = 0; i <= N; i++) {
      const p = off ? sidePoint(i, off) : nodeAt(i);
      if (i === 0) c.moveTo(p.x, p.y); else c.lineTo(p.x, p.y);
    }
    c.closePath();
  };

  // Fahrbahn
  both((c, isId) => {
    c.strokeStyle = isId ? id(SURF.ROAD) : '#59595f';
    c.lineWidth = ROAD_HW * 2;
    c.lineJoin = 'round'; c.lineCap = 'round';
    trace(c, 0); c.stroke();
  });
  // Randsteine links und rechts (rot-weiß)
  for (const side of [-1, 1]) {
    both((c, isId) => {
      c.lineWidth = 7;
      c.setLineDash(isId ? [] : [16, 16]);
      c.strokeStyle = isId ? id(SURF.CURB) : '#e8e8ee';
      trace(c, side * (ROAD_HW - 3.5)); c.stroke();
      if (!isId) {
        c.setLineDash([16, 16]); c.lineDashOffset = 16;
        c.strokeStyle = '#d6453c';
        trace(c, side * (ROAD_HW - 3.5)); c.stroke();
        c.lineDashOffset = 0;
      }
      c.setLineDash([]);
    });
  }
  // Boost-Felder quer über die Fahrbahn
  for (const node of BOOSTS) {
    for (let k = 0; k < 3; k++) {
      const p = nodeAt(node + k * 3);
      both((c, isId) => {
        c.save();
        c.translate(p.x, p.y); c.rotate(p.ang);
        c.fillStyle = isId ? id(SURF.BOOST) : (k === 1 ? '#ffb24a' : '#ff8d2e');
        c.fillRect(-5, -ROAD_HW + 8, 10, (ROAD_HW - 8) * 2);
        c.restore();
      });
    }
  }
  // Start-/Zielgerade: Schachbrettband
  const sp = nodeAt(0);
  vc.save();
  vc.translate(sp.x, sp.y); vc.rotate(sp.ang);
  for (let r = 0; r < 4; r++) {
    for (let cq = 0; cq < 12; cq++) {
      vc.fillStyle = (r + cq) % 2 ? '#f2f2f6' : '#23232a';
      vc.fillRect(-14 + r * 7, -ROAD_HW + cq * (ROAD_HW * 2 / 12), 7, ROAD_HW * 2 / 12);
    }
  }
  vc.restore();

  // Asphalt-Körnung und Gras-Flecken: kleine Pixelstörung über alles
  const img = vc.getImageData(0, 0, MAP, MAP);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const p = (i >> 2);
    let h = Math.imul(p ^ (p >>> 15), 2246822519);
    h = (h ^ (h >>> 13)) & 255;
    const n = (h - 128) * 0.085;
    d[i] = clamp(d[i] + n, 0, 255);
    d[i + 1] = clamp(d[i + 1] + n, 0, 255);
    d[i + 2] = clamp(d[i + 2] + n, 0, 255);
  }
  vc.putImageData(img, 0, 0);
  texData = img.data;

  const idData = ic.getImageData(0, 0, MAP, MAP).data;
  surf = new Uint8Array(MAP * MAP);
  for (let i = 0, j = 0; i < idData.length; i += 4, j++) surf[j] = idData[i];
}

// Oberfläche an einer Weltposition (außerhalb der Karte: Wiese)
function surfAt(x, y) {
  const u = x | 0, v = y | 0;
  if (u < 0 || v < 0 || u >= MAP || v >= MAP) return SURF.GRASS;
  return surf[(v << 10) + u];
}
const isSlow = (s) => s === SURF.GRASS || s === SURF.SAND;

/* ------------------------------------------------------------- Fahrer ----- */

const DRIVERS = [
  {
    key: 'fuchs', name: 'Flitzfuchs', emoji: '🦊', color: '#e8743c',
    top: 196, acc: 108, grip: 2.35, weight: 1.0,
    note: 'ausgewogen – schnell und wendig',
  },
  {
    key: 'baer', name: 'Brummbär', emoji: '🐻', color: '#9a6b3f',
    top: 210, acc: 84, grip: 1.95, weight: 1.35,
    note: 'schwer: höchster Topspeed, schiebt andere weg',
  },
  {
    key: 'frosch', name: 'Hüpfer', emoji: '🐸', color: '#5fbf52',
    top: 180, acc: 132, grip: 2.75, weight: 0.78,
    note: 'leicht: beschleunigt super und liegt klasse in der Kurve',
  },
];
const driverOf = (key) => DRIVERS.find((d) => d.key === key) || DRIVERS[0];
const CPU_NAMES = [{ emoji: '🤖', name: 'Robo' }, { emoji: '🐧', name: 'Pingu' }, { emoji: '🦔', name: 'Igel' }];

/* -------------------------------------------------------- Spielzustand ---- */

const ITEMS = {
  banana: { emoji: '🍌', name: 'Banane' },
  shell: { emoji: '🐢', name: 'Panzer' },
  mushroom: { emoji: '🍄', name: 'Pilz' },
  bolt: { emoji: '⚡', name: 'Blitz' },
};

const game = {
  state: 'count',        // count | race | done
  t: 0,                  // Rennzeit
  count: 3.2,
  laps: 3,
  cpu: 3,
  driver: 'fuchs',
  paused: false,
  autoPilot: false,      // true: das eigene Kart fährt von allein (Vorführung/Tests)
  best: 0,               // Bestzeit einer Runde (Fahrer-abhängig, aus localStorage)
  flash: null,           // kurze Einblendung { text, t }
};
let karts = [];
let bananas = [];        // { x, y, t }
let shells = [];         // { x, y, ang, v, owner, life }
let boxes = [];          // { x, y, t } – t > 0: eingesammelt, zählt runter
let puffs = [];          // Partikel { x, y, vx, vy, t, life, color, size }
let trees = [];          // Deko am Streckenrand

function loadBest(key) {
  try { return parseFloat(localStorage.getItem('kart_' + key)) || 0; } catch { return 0; }
}
function saveBest(key, v) {
  try {
    const old = loadBest(key);
    if (!old || v < old) localStorage.setItem('kart_' + key, String(v.toFixed(2)));
  } catch { /* egal */ }
}

function makeKart(d, slot, human) {
  // Startaufstellung: versetzt hinter der Ziellinie, der Spieler ganz hinten
  const back = 26 + slot * 30;
  const lane = (slot % 2 ? 1 : -1) * 16;
  const p = nodeAt(-Math.round(back / 6));
  const px = p.x + Math.cos(p.ang + Math.PI / 2) * lane;
  const py = p.y + Math.sin(p.ang + Math.PI / 2) * lane;
  return {
    d, human,
    name: human ? d.name : CPU_NAMES[slot % CPU_NAMES.length].name,
    emoji: human ? d.emoji : CPU_NAMES[slot % CPU_NAMES.length].emoji,
    color: human ? d.color : ['#4f8ad6', '#b45fc0', '#d8c23c'][slot % 3],
    x: px, y: py, ang: p.ang, velAng: p.ang, speed: 0,
    drift: 0, driftDir: 0, driftCharge: 0,
    boostT: 0, slowT: 0, spinT: 0, hopT: 0,
    item: null, lap: 0, node: 0, prevNode: 0, place: 1,
    lapTime: 0, bestLap: 0, lapTimes: [], finished: false, finishT: 0,
    skill: 1, wobble: Math.random() * TAU,
  };
}

function startRace(seed) {
  if (!texData) buildTrack();
  if (seed !== undefined) rngState = seed >>> 0 || 1;
  const d = driverOf(game.driver);
  karts = [makeKart(d, game.cpu, true)];      // Spieler startet vom letzten Platz
  const pool = DRIVERS.filter((x) => x.key !== d.key).concat(DRIVERS);
  for (let i = 0; i < game.cpu; i++) {
    const k = makeKart(pool[i % pool.length], i, false);
    k.skill = 0.93 + i * 0.02;
    karts.push(k);
  }
  for (const k of karts) { k.node = nearestNode(k, true); k.prevNode = k.node; }
  bananas = []; shells = []; puffs = [];
  boxes = [];
  for (const node of [70, 150, 230, 330, 400, 450]) {
    for (const off of [-18, 0, 18]) {
      const p = sidePoint(node, off);
      boxes.push({ x: p.x, y: p.y, t: 0 });
    }
  }
  trees = [];
  for (let i = 0; i < N; i += 11) {
    const off = (ROAD_HW + 26 + (i % 7) * 5) * (i % 2 ? 1 : -1);
    const p = sidePoint(i, off);
    if (surfAt(p.x, p.y) !== SURF.GRASS) continue;
    trees.push({ x: p.x, y: p.y, kind: i % 5 === 0 ? 'sign' : 'tree', h: 26 + (i % 4) * 5 });
  }
  game.state = 'count'; game.count = 3.2; game.t = 0; game.flash = null;
  game.best = loadBest(d.key);
  Sfx.engine(false); Sfx.stopMusic(); Sfx.intensity = 0;
}

// einfacher deterministischer Zufall (für ruckelfreie Tests)
let rngState = 12345;
function rng() {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 4294967296;
}

/* ------------------------------------------------------------- Strecke ---- */

// nächstgelegener Knoten der Mittellinie (lokal gesucht, sonst komplett)
function nearestNode(k, full) {
  let best = k.node || 0, bd = Infinity;
  const from = full ? 0 : k.node - 14, to = full ? N : k.node + 30;
  for (let i = from; i < to; i++) {
    const p = nodeAt(i);
    const dx = p.x - k.x, dy = p.y - k.y;
    const dd = dx * dx + dy * dy;
    if (dd < bd) { bd = dd; best = ((i % N) + N) % N; }
  }
  return best;
}
// Fortschritt für die Platzierung: Runde + Knotenanteil
const progress = (k) => k.lap + k.node / N;

/* -------------------------------------------------------------- Physik ---- */

function updateKart(k, dt, input) {
  // Nach dem Zieleinlauf rollt der Spieler aus; die KI fährt weiter, damit
  // niemand als Hindernis auf der Strecke steht.
  if (k.finished && k.human) input = { gas: 0, brake: 0, steer: 0, drift: false };
  const s = surfAt(k.x, k.y);
  const slow = isSlow(s);
  const d = k.d;

  if (k.spinT > 0) {
    k.spinT -= dt;
    k.ang += dt * 11;
    k.speed *= Math.exp(-2.4 * dt);
    k.drift = 0; k.driftCharge = 0;
  }
  if (k.boostT > 0) k.boostT -= dt;
  if (k.slowT > 0) k.slowT -= dt;
  if (k.hopT > 0) k.hopT -= dt;

  // Höchstgeschwindigkeit je nach Untergrund, Turbo und Blitz
  let maxV = d.top * k.skill;
  if (slow) maxV *= s === SURF.SAND ? 0.42 : 0.5;
  if (k.boostT > 0) maxV *= 1.45;
  if (k.slowT > 0) maxV *= 0.52;
  if (game.state === 'count') maxV = 0;

  // Im Countdown fährt niemand; nach dem Zieleinlauf rollt nur der Spieler aus
  // (seine Eingaben sind dann genullt), die KI fährt ihr Rennen zu Ende.
  const canDrive = k.spinT <= 0 && game.state !== 'count';
  if (canDrive) {
    const acc = d.acc * (k.boostT > 0 ? 2.1 : 1);
    if (input.gas) k.speed += acc * dt * (k.speed < maxV ? 1 : 0.1);
    if (input.brake) k.speed -= (k.speed > 0 ? 190 : 70) * dt;
  }
  // Roll- und Luftwiderstand, auf Gras deutlich mehr
  k.speed -= k.speed * (slow ? 1.5 : 0.42) * dt;
  if (k.speed > maxV) k.speed += (maxV - k.speed) * 2.6 * dt;
  k.speed = clamp(k.speed, -52, maxV * 1.12 + 1);

  // Lenken: je schneller, desto williger dreht das Kart ein
  if (canDrive && input.steer) {
    const grip = d.grip * (slow ? 0.72 : 1) * (k.drift ? 1.5 : 1);
    const v = Math.min(1, Math.abs(k.speed) / 60);
    k.ang += input.steer * grip * v * dt * Math.sign(k.speed || 1);
  }
  // Drift: Fahrtrichtung hinkt der Blickrichtung hinterher und lädt den Turbo
  if (canDrive && input.drift && k.speed > 70 && Math.abs(input.steer) > 0.25) {
    if (!k.drift) { k.drift = 1; k.driftDir = Math.sign(input.steer); k.hopT = 0.22; Sfx.play('hop'); }
    if (Math.sign(input.steer) === k.driftDir) k.driftCharge += dt;
  } else if (k.drift) {
    // Loslassen: Mini-Turbo je nach Ladung
    if (k.driftCharge > 1.7) { k.boostT = Math.max(k.boostT, 1.1); Sfx.play('boost'); }
    else if (k.driftCharge > 0.85) { k.boostT = Math.max(k.boostT, 0.6); Sfx.play('boost'); }
    k.drift = 0; k.driftCharge = 0;
  }
  if (k.drift) k.ang += k.driftDir * 0.55 * dt;

  // Bewegungsrichtung folgt der Blickrichtung (beim Driften träger)
  const follow = k.drift ? 2.6 : (slow ? 7 : 11);
  k.velAng += norm(k.ang - k.velAng) * Math.min(1, follow * dt);
  k.x += Math.cos(k.velAng) * k.speed * dt;
  k.y += Math.sin(k.velAng) * k.speed * dt;

  // Boost-Feld
  if (s === SURF.BOOST && k.speed > 20) { k.boostT = Math.max(k.boostT, 0.8); }
  // Randstein rumpelt leicht
  if (s === SURF.CURB && k.speed > 40 && rng() < dt * 8) puff(k.x, k.y, '#e8e8ee');

  // Außerhalb der Karte: der Streckenposten setzt zurück
  if (k.x < 4 || k.y < 4 || k.x > MAP - 4 || k.y > MAP - 4) {
    const p = nodeAt(nearestNode(k, true));
    k.x = p.x; k.y = p.y; k.ang = p.ang; k.velAng = p.ang; k.speed *= 0.3;
  }

  // Rundenzählung über die Knoten der Mittellinie
  k.prevNode = k.node;
  k.node = nearestNode(k);
  if (k.prevNode > N * 0.75 && k.node < N * 0.25) finishLap(k);
  else if (k.prevNode < N * 0.25 && k.node > N * 0.75) k.lap--;   // falsche Richtung
  if (!k.finished && game.state === 'race') k.lapTime += dt;
}

function finishLap(k) {
  k.lap++;
  if (k.lap > 1) {
    k.lapTimes.push(k.lapTime);
    if (!k.bestLap || k.lapTime < k.bestLap) k.bestLap = k.lapTime;
    if (k.human) {
      if (!game.best || k.lapTime < game.best) { game.best = k.lapTime; flash('⏱ Neue Bestrunde!'); }
      saveBest(k.d.key, k.lapTime);
    }
  }
  k.lapTime = 0;
  if (k.lap > game.laps) {
    k.finished = true; k.finishT = game.t;
    if (k.human) {
      game.state = 'done';
      Sfx.engine(false); Sfx.stopMusic(); Sfx.play('fanfare');
    }
  } else if (k.human && k.lap === game.laps) flash('🏁 Letzte Runde!');
}

// Karts rempeln sich an (schwerere schieben leichtere beiseite)
function kartCollisions() {
  for (let i = 0; i < karts.length; i++) {
    for (let j = i + 1; j < karts.length; j++) {
      const a = karts[i], b = karts[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const dd = Math.hypot(dx, dy);
      if (dd > 17 || dd < 0.001) continue;
      const nx = dx / dd, ny = dy / dd;
      const push = (17 - dd) / 2;
      const wa = a.d.weight, wb = b.d.weight;
      a.x -= nx * push * (wb / (wa + wb)) * 2;
      a.y -= ny * push * (wb / (wa + wb)) * 2;
      b.x += nx * push * (wa / (wa + wb)) * 2;
      b.y += ny * push * (wa / (wa + wb)) * 2;
      const slower = wa > wb ? b : a;
      slower.speed *= 0.93;
      if (Math.abs(a.speed - b.speed) > 40) Sfx.play('bump');
    }
  }
}

/* --------------------------------------------------------------- Items ---- */

function rollItem(k) {
  // Wer hinten fährt, bekommt die stärkeren Items (wie im Vorbild)
  const n = Math.max(1, karts.length - 1);
  const back = (k.place - 1) / n;
  const w = [
    ['banana', 0.42 - 0.24 * back],
    ['shell', 0.3],
    ['mushroom', 0.16 + 0.22 * back],
    ['bolt', k.place === 1 ? 0 : 0.04 + 0.2 * back],
  ];
  const sum = w.reduce((a, x) => a + x[1], 0);
  let r = rng() * sum;
  for (const [key, p] of w) { r -= p; if (r <= 0) return key; }
  return 'banana';
}

function pickBoxes(dt) {
  for (const b of boxes) {
    if (b.t > 0) { b.t -= dt; continue; }
    for (const k of karts) {
      if (k.item || k.finished) continue;
      if (Math.hypot(k.x - b.x, k.y - b.y) > 13) continue;
      k.item = rollItem(k);
      b.t = 4;
      if (k.human) { flash(ITEMS[k.item].emoji + ' ' + ITEMS[k.item].name); Sfx.play('pickup'); }
      break;
    }
  }
}

function useItem(k) {
  if (!k.item || k.finished || game.state !== 'race') return false;
  const it = k.item;
  k.item = null;
  if (it === 'banana') {
    bananas.push({ x: k.x - Math.cos(k.ang) * 22, y: k.y - Math.sin(k.ang) * 22, t: 0 });
    if (k.human) Sfx.play('drop');
  } else if (it === 'shell') {
    shells.push({
      x: k.x + Math.cos(k.ang) * 18, y: k.y + Math.sin(k.ang) * 18,
      ang: k.ang, v: 268, owner: k, life: 6,
    });
    Sfx.play('shoot');
  } else if (it === 'mushroom') {
    k.boostT = Math.max(k.boostT, 1.5);
    Sfx.play('boost');
  } else if (it === 'bolt') {
    for (const o of karts) {
      if (o === k || o.finished) continue;
      o.slowT = 4.5; o.speed *= 0.55; o.item = null;
    }
    if (k.human) flash('⚡ Blitz!');
    Sfx.play('bolt');
  }
  return true;
}

function spinOut(k, reason) {
  if (k.spinT > 0) return;
  k.spinT = 1.25;
  k.speed *= 0.22;
  k.drift = 0; k.driftCharge = 0; k.boostT = 0;
  for (let i = 0; i < 8; i++) puff(k.x, k.y, '#ffd166');
  if (k.human) { flash(reason); Sfx.play('hit'); }
  else Sfx.play('hit', 0.5);
}

function updateItems(dt) {
  pickBoxes(dt);
  // Bananen liegen herum, bis jemand draufbrettert
  for (const b of bananas) {
    b.t += dt;
    for (const k of karts) {
      if (k.spinT > 0 || k.finished) continue;
      if (Math.hypot(k.x - b.x, k.y - b.y) > 11) continue;
      b.dead = true;
      spinOut(k, '🍌 Banane erwischt!');
      break;
    }
  }
  bananas = bananas.filter((b) => !b.dead && b.t < 90);
  // Panzer fliegen geradeaus und verpuffen im Gelände
  for (const sh of shells) {
    sh.life -= dt;
    const steps = Math.max(1, Math.ceil(sh.v * dt / 6));
    for (let i = 0; i < steps && !sh.dead; i++) {
      sh.x += Math.cos(sh.ang) * sh.v * dt / steps;
      sh.y += Math.sin(sh.ang) * sh.v * dt / steps;
      for (const k of karts) {
        if (k === sh.owner || k.spinT > 0 || k.finished) continue;
        if (Math.hypot(k.x - sh.x, k.y - sh.y) > 12) continue;
        sh.dead = true;
        spinOut(k, '🐢 Panzer getroffen!');
        break;
      }
      if (isSlow(surfAt(sh.x, sh.y))) { sh.dead = true; puff(sh.x, sh.y, '#8ee07a'); }
    }
    if (sh.life <= 0) sh.dead = true;
  }
  shells = shells.filter((s) => !s.dead);
}

function puff(x, y, color) {
  puffs.push({
    x, y, vx: (rng() - 0.5) * 40, vy: (rng() - 0.5) * 40,
    t: 0, life: 0.45 + rng() * 0.3, color, size: 2 + rng() * 2,
  });
}
function updatePuffs(dt) {
  for (const p of puffs) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; }
  puffs = puffs.filter((p) => p.t < p.life);
}

/* ------------------------------------------------------------------ KI ---- */

function aiInput(k, dt) {
  const inp = { gas: 1, brake: 0, steer: 0, drift: false };
  // Zielpunkt ein Stück voraus, leicht versetzt (damit es natürlicher wirkt)
  k.wobble += dt * 0.7;
  const look = 7 + Math.min(12, k.speed / 14);
  const off = Math.sin(k.wobble) * 13;
  const t = sidePoint(k.node + look, off);
  const want = Math.atan2(t.y - k.y, t.x - k.x);
  const err = norm(want - k.ang);
  inp.steer = clamp(err * 2.4, -1, 1);
  // vor engen Kurven bremsen
  const ahead = norm(nodeAt(k.node + 16).ang - nodeAt(k.node).ang);
  if (Math.abs(ahead) > 0.55 && k.speed > k.d.top * 0.78) { inp.gas = 0; inp.brake = 1; }
  // lange Kurven werden gedriftet
  inp.drift = Math.abs(ahead) > 0.42 && Math.abs(inp.steer) > 0.5 && k.speed > 110;

  // Items: Banane legen, wenn jemand dicht dahinter ist; Panzer nach vorn
  if (k.item && rng() < dt * 1.6) {
    const near = karts.find((o) => o !== k && Math.hypot(o.x - k.x, o.y - k.y) < 150);
    if (k.item === 'mushroom' && Math.abs(ahead) < 0.25) useItem(k);
    else if (k.item === 'bolt') useItem(k);
    else if (k.item === 'shell' && near && norm(Math.atan2(near.y - k.y, near.x - k.x) - k.ang) < 0.3) useItem(k);
    else if (k.item === 'banana' && near) useItem(k);
  }
  return inp;
}

// Gummiband: wer weit zurückliegt, fährt etwas beherzter
function rubberBand() {
  const me = karts[0];
  if (!me) return;
  for (const k of karts) {
    if (k.human) continue;
    const diff = progress(me) - progress(k);
    k.skill = clamp(0.94 + diff * 0.9, 0.84, 1.1);
  }
}

/* ------------------------------------------------------- Rennsteuerung ---- */

function flash(text) { game.flash = { text, t: 0 }; }

function updatePlaces() {
  const order = [...karts].sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.finished && b.finished) return a.finishT - b.finishT;
    return progress(b) - progress(a);
  });
  order.forEach((k, i) => { k.place = i + 1; });
}

function update(dt) {
  if (game.state === 'count') {
    game.count -= dt;
    const was = Math.ceil(game.count + dt), now = Math.ceil(game.count);
    if (now !== was && now >= 0 && now <= 3) Sfx.play(now === 0 ? 'go' : 'beep');
    if (game.count <= 0) {
      game.state = 'race';
      // Raketenstart: wer im richtigen Moment Gas gibt, bekommt Schwung
      const me = karts[0];
      if (me && input().gas && me.gasHeld > 0 && me.gasHeld < 0.75) {
        me.boostT = 1.2; flash('🚀 Raketenstart!'); Sfx.play('boost');
      }
      Sfx.engine(true);
      Sfx.intensity = 0;
      Sfx.startMusic();
    }
  }
  if (game.state !== 'done') game.t += dt;

  for (const k of karts) {
    const inp = (k.human && !game.autoPilot) ? input() : aiInput(k, dt);
    if (game.state === 'count' && k.human) k.gasHeld = inp.gas ? (k.gasHeld || 0) + dt : 0;
    updateKart(k, dt, inp);
    if (k.drift && k.speed > 60 && rng() < dt * 30) {
      puff(k.x - Math.cos(k.ang) * 8, k.y - Math.sin(k.ang) * 8,
        k.driftCharge > 1.7 ? '#ff8d2e' : k.driftCharge > 0.85 ? '#6fd0ff' : '#dddddd');
    }
    if (k.boostT > 0 && rng() < dt * 25) puff(k.x - Math.cos(k.ang) * 10, k.y - Math.sin(k.ang) * 10, '#ffb24a');
  }
  kartCollisions();
  updateItems(dt);
  updatePuffs(dt);
  rubberBand();
  updatePlaces();
  if (game.flash) { game.flash.t += dt; if (game.flash.t > 2) game.flash = null; }
  // KI fährt nach dem Zieleinlauf des Spielers noch zu Ende
  for (const k of karts) if (!k.finished && k.lap > game.laps) { k.finished = true; k.finishT = game.t; }
  Sfx.rev(karts[0] ? karts[0].speed / Math.max(1, karts[0].d.top) : 0, game.state === 'race');
  // In der letzten Runde wird die Musik schneller und schärfer
  const me = karts[0];
  Sfx.intensity = (me && game.state === 'race' && me.lap >= game.laps) ? 1 : 0;
}

/* ------------------------------------------------------------- Eingabe ---- */

const pressed = new Set();
const buttons = {};
// Analoges Lenkfeld: x ist der aktuelle Einschlag (-1 .. 1)
const STEER_RANGE = 74;      // Pixel vom Aufsetzpunkt bis zum vollen Einschlag
const steerPad = { x: 0, active: false, range: STEER_RANGE };

function input() {
  const btn = (id) => !!(buttons[id] && buttons[id].held);
  const left = pressed.has('arrowleft') || pressed.has('a');
  const right = pressed.has('arrowright') || pressed.has('d');
  const keys = (right ? 1 : 0) - (left ? 1 : 0);
  return {
    gas: pressed.has('arrowup') || pressed.has('w') || btn('k-gas') ? 1 : 0,
    brake: pressed.has('arrowdown') || pressed.has('s') || btn('k-brake') ? 1 : 0,
    // Tastatur = voller Einschlag, Lenkfeld = stufenlos
    steer: keys || steerPad.x,
    drift: pressed.has('shift') || btn('k-drift'),
  };
}

// Lenkfeld: Daumen aufsetzen (die Stelle ist die Mitte) und nach links/rechts
// ziehen – je weiter, desto stärker der Einschlag. Loslassen stellt gerade.
function setupSteer(id) {
  const el = document.getElementById(id);
  const knob = el.querySelector('.knob');
  let pid = null, ox = 0, oy = 0;
  const show = () => {
    knob.style.transform = `translateX(${steerPad.x * 86}px)`;
    el.classList.toggle('held', steerPad.active);
  };
  const move = (e) => {
    if (pid === null || e.pointerId !== pid) return;
    e.preventDefault();
    // In der gedrehten Bühne ist Spiel-X die Bildschirm-Y-Achse
    const rot = stage.classList.contains('rot');
    const d = rot ? (e.clientY - oy) : (e.clientX - ox);
    steerPad.x = clamp(d / STEER_RANGE, -1, 1);
    show();
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* egal */ }
    pid = e.pointerId;
    ox = e.clientX; oy = e.clientY;      // Aufsetzpunkt = Geradeaus
    steerPad.active = true; steerPad.x = 0;
    Sfx.unlock();
    show();
  });
  el.addEventListener('pointermove', move);
  const up = (e) => {
    if (pid !== null && e.pointerId !== pid) return;
    pid = null; steerPad.active = false; steerPad.x = 0;
    show();
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointerleave', (e) => { if (pid !== null && e.pointerId === pid) move(e); });
}

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(k)) e.preventDefault();
  Sfx.unlock();
  if (k === ' ') { if (karts[0]) useItem(karts[0]); return; }
  if (k === 'r' && game.state === 'done') { startRace(); return; }
  if (k === 'escape') { menuEl.classList.add('hidden'); return; }
  pressed.add(k === 'shift' ? 'shift' : k);
});
window.addEventListener('keyup', (e) => pressed.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => pressed.clear());

function setBtn(id, onDown) {
  const el = document.getElementById(id);
  buttons[id] = { held: false };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* egal */ }
    buttons[id].held = true;
    el.classList.add('held');
    Sfx.unlock();
    if (onDown) onDown();
  });
  const rel = (e) => { e.preventDefault(); buttons[id].held = false; el.classList.remove('held'); };
  el.addEventListener('pointerup', rel);
  el.addEventListener('pointercancel', rel);
}

/* ----------------------------------------------------------------- Ton ---- */
// Kleine Web-Audio-Werkstatt: Motor als Dauerton, Effekte synthetisiert.
const Sfx = {
  ctx: null, master: null, musBus: null, noise: null,
  osc: null, oscGain: null, on: true, musicOn: true, running: false,
  playing: false, step: 0, next: 0, timer: null, intensity: 0,
  load() {
    try {
      this.on = localStorage.getItem('kart_sound') !== '0';
      this.musicOn = localStorage.getItem('kart_music') !== '0';
    } catch { /* egal */ }
    return this;
  },
  save() {
    try {
      localStorage.setItem('kart_sound', this.on ? '1' : '0');
      localStorage.setItem('kart_music', this.musicOn ? '1' : '0');
    } catch { /* egal */ }
  },
  init() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.ctx.destination);
    this.musBus = this.ctx.createGain();
    this.musBus.gain.value = 0.5;
    this.musBus.connect(this.master);
    // Rauschpuffer für Snare und Hi-Hat
    const n = Math.floor(this.ctx.sampleRate * 0.7);
    this.noise = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return true;
  },
  unlock() {
    if (!this.on || !this.init()) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },
  toggle(v) {
    this.on = v === undefined ? !this.on : !!v;
    this.save();
    if (!this.on) { this.engine(false); this.stopMusic(); } else this.unlock();
  },
  setMusic(v) {
    this.musicOn = v === undefined ? !this.musicOn : !!v;
    this.save();
    if (!this.musicOn) this.stopMusic();
    else if (this.on && game.state === 'race') { this.unlock(); this.startMusic(); }
  },
  engine(on) {
    if (!this.on || !this.init() || this.ctx.state === 'suspended') { this.running = false; return; }
    if (on && !this.osc) {
      this.osc = this.ctx.createOscillator();
      this.oscGain = this.ctx.createGain();
      this.osc.type = 'sawtooth';
      this.osc.frequency.value = 70;
      this.oscGain.gain.value = 0.0001;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 900;
      this.osc.connect(f); f.connect(this.oscGain); this.oscGain.connect(this.master);
      this.osc.start();
    }
    if (!on && this.osc) {
      try { this.oscGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.05); } catch { /* egal */ }
      const o = this.osc;
      setTimeout(() => { try { o.stop(); } catch { /* egal */ } }, 250);
      this.osc = null; this.oscGain = null;
    }
    this.running = !!on;
  },
  rev(frac, on) {
    if (!this.on || !this.osc || !this.ctx) return;
    if (!on) { this.oscGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.08); return; }
    this.osc.frequency.setTargetAtTime(62 + frac * 190, this.ctx.currentTime, 0.06);
    this.oscGain.gain.setTargetAtTime(0.035 + frac * 0.05, this.ctx.currentTime, 0.1);
  },
  tone(t, f, dur, type, peak, bend) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (bend) o.frequency.exponentialRampToValueAtTime(Math.max(30, f * bend), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  },
  play(name, vol = 1) {
    if (!this.on || !this.init() || this.ctx.state === 'suspended') return;
    const t = this.ctx.currentTime + 0.001;
    switch (name) {
      case 'beep': this.tone(t, 620, 0.16, 'square', 0.2 * vol); break;
      case 'go': this.tone(t, 980, 0.3, 'square', 0.26 * vol); break;
      case 'pickup': this.tone(t, 760, 0.1, 'triangle', 0.18 * vol); this.tone(t + 0.08, 1180, 0.14, 'triangle', 0.16 * vol); break;
      case 'boost': this.tone(t, 240, 0.35, 'sawtooth', 0.18 * vol, 3.2); break;
      case 'hop': this.tone(t, 420, 0.1, 'sine', 0.1 * vol, 1.6); break;
      case 'drop': this.tone(t, 300, 0.12, 'triangle', 0.12 * vol, 0.6); break;
      case 'shoot': this.tone(t, 520, 0.18, 'square', 0.14 * vol, 2.2); break;
      case 'hit': this.tone(t, 180, 0.3, 'sawtooth', 0.24 * vol, 0.4); break;
      case 'bump': this.tone(t, 120, 0.12, 'triangle', 0.14 * vol, 0.7); break;
      case 'bolt': this.tone(t, 900, 0.45, 'sawtooth', 0.2 * vol, 0.25); break;
      case 'fanfare': [523, 659, 784, 1046].forEach((f, i) => this.tone(t + i * 0.13, f, 0.3, 'triangle', 0.2 * vol)); break;
      default: break;
    }
  },

  /* ------------------------------------------------------------- Musik ---- */
  // Hetziger Renn-Beat, komplett synthetisiert: stampfender Viervierteltakt,
  // laufender Bass in Sechzehnteln, Offbeat-Stabs und eine nervöse Melodie
  // über d-Moll – B♭ – F – C. In der letzten Runde zieht das Tempo an.
  startMusic() {
    if (!this.on || !this.musicOn) return;
    if (!this.init() || this.ctx.state === 'suspended' || this.playing) return;
    this.playing = true;
    this.step = 0;
    this.next = this.ctx.currentTime + 0.08;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.schedule(), 55);
  },
  stopMusic() {
    this.playing = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  },
  // Sechzehntel-Dauer: Grundtempo 152 bpm, bei voller Hektik ~10 % schneller
  stepDur() { return 60 / (152 + this.intensity * 16) / 4; },
  schedule() {
    if (!this.playing || !this.ctx) return;
    if (this.ctx.state === 'suspended') return;
    let guard = 0;
    while (this.next < this.ctx.currentTime + 0.25 && guard++ < 64) {
      this.beat(this.next, this.step);
      this.next += this.stepDur();
      this.step++;
    }
  },
  // Stimme mit Hüllkurve (für Bass, Stabs und Melodie)
  voice(t, freq, dur, type, peak, cutoff, bend) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (bend) o.frequency.exponentialRampToValueAtTime(Math.max(25, freq * bend), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let last = o;
    if (cutoff) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 6;
      o.connect(f); last = f;
    }
    last.connect(g); g.connect(this.musBus);
    o.start(t); o.stop(t + dur + 0.03);
  },
  // Schlagzeug aus Rauschen bzw. fallender Sinuswelle
  drum(t, kind, peak) {
    if (kind === 'kick') {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(160, t);
      o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
      g.gain.setValueAtTime(peak, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g); g.connect(this.musBus);
      o.start(t); o.stop(t + 0.2);
      return;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    const dur = kind === 'snare' ? 0.13 : 0.035;
    if (kind === 'snare') { f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.8; }
    else { f.type = 'highpass'; f.frequency.value = 7200; }
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.musBus);
    src.start(t, Math.random() * 0.4); src.stop(t + dur + 0.02);
  },
  beat(t, step) {
    const s = step & 15;                    // Sechzehntel im Takt
    const bar = (step >> 4) % 4;            // vier Takte im Kreis
    const ch = MUSIC[bar];
    const hot = this.intensity > 0.5;
    const semi = (n) => Math.pow(2, n / 12);

    // Beat: Viervierteltakt, Snare auf 2 und 4, Hi-Hats dazwischen
    if (s % 4 === 0) this.drum(t, 'kick', 0.5);
    if (s === 4 || s === 12) this.drum(t, 'snare', 0.22);
    if (s % 2 === 1) this.drum(t, 'hat', s % 4 === 3 ? 0.11 : 0.06);
    if (hot && (s === 7 || s === 15)) this.drum(t, 'snare', 0.16);

    // Bass: treibendes Sechzehntel-Muster auf dem Grundton
    const BASS = [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1];
    if (BASS[s]) {
      const oct = (s === 6 || s === 14) ? 2 : 1;
      this.voice(t, ch.root * oct, 0.11, 'sawtooth', 0.2, 420 + this.intensity * 260);
    }
    // Offbeat-Stabs (zwei Akkordtöne kurz angerissen)
    if (s === 2 || s === 6 || s === 10 || s === 14) {
      for (const n of [ch.notes[1], ch.notes[2]]) {
        this.voice(t, ch.root * 2 * semi(n), 0.09, 'square', 0.055, 2600);
      }
    }
    // Melodie: nervöse Sechzehntel-Figur, in der letzten Runde eine Oktave höher
    const LEAD = [0, -1, 2, -1, 1, -1, 3, 2, -1, 1, 4, -1, 2, 3, -1, 1];
    const li = LEAD[s];
    if (li >= 0) {
      const n = ch.notes[li % ch.notes.length];
      this.voice(t, ch.root * (hot ? 8 : 4) * semi(n), 0.085, 'square', hot ? 0.05 : 0.04, 3200);
    }
  },
};
// Akkordfolge d-Moll – B♭ – F – C (Grundton in Hz, Töne als Halbtonabstand)
const MUSIC = [
  { root: 73.42, notes: [0, 3, 7, 10, 12] },    // Dm
  { root: 58.27, notes: [0, 4, 7, 11, 12] },    // B♭
  { root: 87.31, notes: [0, 4, 7, 11, 12] },    // F
  { root: 65.41, notes: [0, 4, 7, 10, 12] },    // C
];

/* --------------------------------------------------------------- Optik ---- */

const stage = document.getElementById('stage');
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let CW = 0, CH = 0;            // Anzeigegröße (CSS-Pixel)
let RW = 0, RH = 0;            // interne Mode-7-Auflösung
let frameCanvas = null, frameCtx = null, frameImg = null;
const cam = { x: 0, y: 0, ang: 0, h: 34 };

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rot = stage.classList.contains('rot');
  CW = rot ? window.innerHeight : window.innerWidth;
  CH = rot ? window.innerWidth : window.innerHeight;
  canvas.width = Math.round(CW * dpr);
  canvas.height = Math.round(CH * dpr);
  canvas.style.width = CW + 'px';
  canvas.style.height = CH + 'px';
  RW = Math.min(480, Math.round(CW / 2));
  RH = Math.max(80, Math.round(RW * CH / CW));
  frameCanvas = makeCanvas(RW, RH);
  frameCtx = frameCanvas.getContext('2d');
  frameImg = frameCtx.createImageData(RW, RH);
}
window.addEventListener('resize', resize);

const SKY_TOP = [96, 174, 232], SKY_BOT = [198, 228, 244];
// Mode-7: Fluchtpunkt bei 42 % Höhe, Brennweite leicht weitwinklig
const horizonRow = () => Math.round(RH * 0.42);
const focal = () => RW * 0.62;

function renderGround() {
  const d = frameImg.data;
  const hy = horizonRow(), F = focal();
  const dirX = Math.cos(cam.ang), dirY = Math.sin(cam.ang);
  const rgtX = -dirY, rgtY = dirX;

  // Himmel mit Verlauf, Hügelkette und Wolken (parallax über den Blickwinkel)
  const skyOff = (cam.ang / TAU) * RW * 3;
  for (let y = 0; y < hy; y++) {
    const t = y / hy;
    const r = lerp(SKY_TOP[0], SKY_BOT[0], t), g = lerp(SKY_TOP[1], SKY_BOT[1], t), b = lerp(SKY_TOP[2], SKY_BOT[2], t);
    for (let x = 0; x < RW; x++) {
      const p = (y * RW + x) * 4;
      const wx = x + skyOff;
      const hill = hy - (14 + Math.sin(wx * 0.013) * 9 + Math.sin(wx * 0.031 + 1.7) * 5);
      const hill2 = hy - (7 + Math.sin(wx * 0.021 + 4) * 6);
      if (y > hill2) { d[p] = 104; d[p + 1] = 142; d[p + 2] = 96; }
      else if (y > hill) { d[p] = 126; d[p + 1] = 158; d[p + 2] = 178; }
      else { d[p] = r; d[p + 1] = g; d[p + 2] = b; }
      d[p + 3] = 255;
    }
  }

  // Boden: je Bildzeile eine Strecke in die Tiefe, dann über die Breite laufen
  const FOG0 = 260, FAR = 820;
  for (let y = hy; y < RH; y++) {
    const dz = cam.h * F / (y - hy + 0.6);
    const fog = clamp((dz - FOG0) / (FAR - FOG0), 0, 1);
    const stepX = rgtX * dz / F, stepY = rgtY * dz / F;
    let wx = cam.x + dirX * dz - stepX * (RW / 2);
    let wy = cam.y + dirY * dz - stepY * (RW / 2);
    const sr = lerp(SKY_BOT[0], 150, 0.25), sg = lerp(SKY_BOT[1], 170, 0.25), sb = lerp(SKY_BOT[2], 180, 0.25);
    let p = y * RW * 4;
    for (let x = 0; x < RW; x++, p += 4) {
      const u = wx | 0, v = wy | 0;
      let r, g, b;
      if (u < 0 || v < 0 || u >= MAP || v >= MAP) { r = 62; g = 104; b = 58; }
      else {
        const i = ((v << 10) + u) << 2;
        r = texData[i]; g = texData[i + 1]; b = texData[i + 2];
      }
      if (fog > 0) { r = r + (sr - r) * fog; g = g + (sg - g) * fog; b = b + (sb - b) * fog; }
      d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = 255;
      wx += stepX; wy += stepY;
    }
  }
  frameCtx.putImageData(frameImg, 0, 0);
}

// Weltpunkt -> Bildschirm (in Anzeige-Pixeln). null, wenn hinter der Kamera.
function project(x, y) {
  const dx = x - cam.x, dy = y - cam.y;
  const dirX = Math.cos(cam.ang), dirY = Math.sin(cam.ang);
  const dz = dx * dirX + dy * dirY;
  if (dz < 22) return null;        // direkt an der Kamera: nicht zeichnen
  const lat = dx * -dirY + dy * dirX;
  const F = focal(), K = CW / RW;
  return {
    x: (RW / 2 + F * lat / dz) * K,
    y: (horizonRow() + cam.h * F / dz) * K,
    s: F / dz * K,           // Pixel je Welteinheit
    dz,
  };
}

function drawShadow(p, w) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, w * 0.55, w * 0.2, 0, 0, TAU);
  ctx.fill();
}

// Kart als Billboard: Breite und Räder richten sich nach dem Blickwinkel
function drawKart(k, p) {
  const sc = p.s;
  const rel = norm(k.ang - cam.ang);
  const side = Math.abs(Math.sin(rel)), front = Math.cos(rel);
  const w = (13 + 11 * side) * sc;
  const h = 7 * sc;
  const x = p.x, y = p.y;
  drawShadow(p, w);
  ctx.save();
  ctx.translate(x, y);
  if (k.spinT > 0) ctx.rotate(Math.sin(k.spinT * 14) * 0.5);
  else if (k.drift) ctx.rotate(k.driftDir * 0.11);
  if (k.hopT > 0) ctx.translate(0, -Math.sin((0.22 - k.hopT) / 0.22 * Math.PI) * 6 * sc);
  // Räder: stehen seitlich über das Chassis hinaus
  ctx.fillStyle = '#1e1e24';
  roundRect(-w / 2 - 2.1 * sc, -h * 0.95, 4.2 * sc, h * 1.2, 1.3 * sc); ctx.fill();
  roundRect(w / 2 - 2.1 * sc, -h * 0.95, 4.2 * sc, h * 1.2, 1.3 * sc); ctx.fill();
  // Chassis mit dunklem Schweller
  ctx.fillStyle = k.color;
  roundRect(-w / 2, -h - 2.2 * sc, w, h + 2.2 * sc, 2.2 * sc); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  roundRect(-w / 2, -h * 0.5, w, h * 0.5, 1.4 * sc); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  roundRect(-w / 2 + 1 * sc, -h - 1.6 * sc, w - 2 * sc, 1.9 * sc, 1 * sc); ctx.fill();
  // Heckflügel (nur von hinten zu sehen)
  if (front < -0.1) {
    ctx.fillStyle = '#2b2b33';
    roundRect(-w * 0.32, -h - 4.6 * sc, w * 0.64, 1.5 * sc, 0.6 * sc); ctx.fill();
  }
  // Fahrer
  ctx.font = Math.max(6, 9.5 * sc) + 'px system-ui';
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(k.emoji, 0, -h - 2.4 * sc);
  // Rücklichter, wenn wir von hinten draufschauen
  if (front < -0.2) {
    ctx.fillStyle = k.boostT > 0 ? '#ffd166' : '#d6453c';
    ctx.fillRect(-w / 2 + 1.5 * sc, -h - 0.3 * sc, 2 * sc, 1.5 * sc);
    ctx.fillRect(w / 2 - 3.5 * sc, -h - 0.3 * sc, 2 * sc, 1.5 * sc);
  }
  ctx.restore();
  // Name über dem Kart (nur nah dran)
  if (p.s > 1.4 && p.s < 9 && !k.human) {
    ctx.font = 'bold ' + clamp(3.4 * sc, 9, 16) + 'px system-ui';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.textAlign = 'center';
    ctx.fillText(k.name, x, y - h - 11 * sc);
  }
}

function roundRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawSprites(time) {
  const list = [];
  for (const k of karts) { const p = project(k.x, k.y); if (p) list.push({ p, kind: 'kart', o: k }); }
  for (const b of bananas) { const p = project(b.x, b.y); if (p) list.push({ p, kind: 'banana', o: b }); }
  for (const s of shells) { const p = project(s.x, s.y); if (p) list.push({ p, kind: 'shell', o: s }); }
  for (const b of boxes) { if (b.t > 0) continue; const p = project(b.x, b.y); if (p) list.push({ p, kind: 'box', o: b }); }
  for (const t of trees) { const p = project(t.x, t.y); if (p) list.push({ p, kind: t.kind, o: t }); }
  for (const q of puffs) { const p = project(q.x, q.y); if (p) list.push({ p, kind: 'puff', o: q }); }
  list.sort((a, b) => b.p.dz - a.p.dz);

  for (const e of list) {
    const { p, o } = e;
    if (p.x < -200 || p.x > CW + 200) continue;
    if (e.kind === 'kart') { drawKart(o, p); continue; }
    if (e.kind === 'puff') {
      ctx.globalAlpha = clamp(1 - o.t / o.life, 0, 1);
      ctx.fillStyle = o.color;
      const s = o.size * p.s;
      ctx.fillRect(p.x - s / 2, p.y - s, s, s);
      ctx.globalAlpha = 1;
      continue;
    }
    if (e.kind === 'banana') {
      drawShadow(p, 9 * p.s);
      ctx.font = Math.max(7, 10 * p.s) + 'px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('🍌', p.x, p.y);
      continue;
    }
    if (e.kind === 'shell') {
      drawShadow(p, 9 * p.s);
      ctx.font = Math.max(7, 11 * p.s) + 'px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('🐢', p.x, p.y);
      continue;
    }
    if (e.kind === 'box') {
      const s = 11 * p.s;
      const bob = Math.sin(time * 3 + o.x) * 1.5 * p.s;
      drawShadow(p, s);
      ctx.save();
      ctx.translate(p.x, p.y - s * 0.6 + bob);
      ctx.fillStyle = 'rgba(255,220,90,0.82)';
      roundRect(-s / 2, -s / 2, s, s, s * 0.22); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = Math.max(1, p.s * 0.6);
      roundRect(-s / 2, -s / 2, s, s, s * 0.22); ctx.stroke();
      ctx.fillStyle = '#5b3d12';
      ctx.font = 'bold ' + Math.max(6, s * 0.72) + 'px system-ui';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('?', 0, s * 0.04);
      ctx.textBaseline = 'alphabetic';
      ctx.restore();
      continue;
    }
    // Deko: Baum oder Streckenschild
    const hpx = o.h * p.s;
    drawShadow(p, hpx * 0.5);
    if (e.kind === 'tree') {
      ctx.fillStyle = '#6b4a2a';
      ctx.fillRect(p.x - hpx * 0.07, p.y - hpx * 0.42, hpx * 0.14, hpx * 0.42);
      ctx.fillStyle = '#2f7d3c';
      ctx.beginPath(); ctx.arc(p.x, p.y - hpx * 0.62, hpx * 0.3, 0, TAU); ctx.fill();
      ctx.fillStyle = '#3c9a4c';
      ctx.beginPath(); ctx.arc(p.x - hpx * 0.12, p.y - hpx * 0.72, hpx * 0.22, 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = '#d9d9e0';
      ctx.fillRect(p.x - hpx * 0.04, p.y - hpx * 0.5, hpx * 0.08, hpx * 0.5);
      ctx.fillStyle = '#d6453c';
      roundRect(p.x - hpx * 0.26, p.y - hpx * 0.78, hpx * 0.52, hpx * 0.3, hpx * 0.06); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold ' + Math.max(6, hpx * 0.2) + 'px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('KART', p.x, p.y - hpx * 0.57);
    }
  }
}

/* ------------------------------------------------------------------ HUD --- */

function fmt(t) {
  if (!Number.isFinite(t) || t <= 0) return '--:--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return m + ':' + s.toFixed(2).padStart(5, '0');
}
const ORD = ['', '1.', '2.', '3.', '4.', '5.'];

function drawHUD(time) {
  const me = karts[0];
  if (!me) return;
  ctx.textBaseline = 'alphabetic';

  // Platzierung
  const py0 = 72;
  ctx.fillStyle = 'rgba(8,25,42,0.72)';
  roundRect(12, py0, 86, 56, 12); ctx.fill();
  ctx.fillStyle = me.place === 1 ? '#ffd166' : '#eaf3fa';
  ctx.font = 'bold 34px system-ui'; ctx.textAlign = 'center';
  ctx.fillText(ORD[me.place] || me.place + '.', 55, py0 + 38);
  ctx.font = '11px system-ui'; ctx.fillStyle = '#bcd6ea';
  ctx.fillText('von ' + karts.length, 55, py0 + 52);

  // Runde + Zeiten
  ctx.fillStyle = 'rgba(8,25,42,0.72)';
  roundRect(CW / 2 - 92, 10, 184, 56, 12); ctx.fill();
  ctx.fillStyle = '#eaf3fa'; ctx.font = 'bold 17px system-ui';
  ctx.fillText(`Runde ${clamp(me.lap, 1, game.laps)}/${game.laps}`, CW / 2, 32);
  ctx.font = '13px system-ui'; ctx.fillStyle = '#bcd6ea';
  ctx.fillText(`⏱ ${fmt(me.lapTime)}   🏅 ${game.best ? fmt(game.best) : '--:--'}`, CW / 2, 54);

  // Item-Fenster
  const bx = CW - 86, by = 10;
  ctx.fillStyle = 'rgba(8,25,42,0.72)';
  roundRect(bx, by, 74, 74, 14); ctx.fill();
  ctx.strokeStyle = me.item ? 'rgba(255,220,120,0.9)' : 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 2;
  roundRect(bx + 5, by + 5, 64, 64, 11); ctx.stroke();
  ctx.textAlign = 'center';
  if (me.item) {
    ctx.font = '38px system-ui';
    ctx.fillText(ITEMS[me.item].emoji, bx + 37, by + 54);
  } else {
    ctx.font = '26px system-ui'; ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillText('?', bx + 37, by + 50);
  }

  // Tacho unten rechts
  const sp = Math.round(Math.abs(me.speed) * 1.25);
  const tx = CW / 2 - 57;
  ctx.fillStyle = 'rgba(8,25,42,0.72)';
  roundRect(tx, CH - 54, 114, 44, 12); ctx.fill();
  ctx.fillStyle = me.boostT > 0 ? '#ffd166' : '#eaf3fa';
  ctx.font = 'bold 22px system-ui'; ctx.textAlign = 'right';
  ctx.fillText(String(sp), tx + 74, CH - 22);
  ctx.font = '12px system-ui'; ctx.fillStyle = '#bcd6ea'; ctx.textAlign = 'left';
  ctx.fillText('km/h', tx + 78, CH - 22);
  // Drift-Ladebalken
  if (me.driftCharge > 0) {
    const w = 114 * clamp(me.driftCharge / 1.7, 0, 1);
    ctx.fillStyle = me.driftCharge > 1.7 ? '#ff8d2e' : me.driftCharge > 0.85 ? '#6fd0ff' : '#dddddd';
    ctx.fillRect(tx, CH - 58, w, 4);
  }

  drawMinimap();

  // Countdown, Meldungen, Zielwertung
  ctx.textAlign = 'center';
  if (game.state === 'count') {
    const n = Math.ceil(game.count);
    const txt = n > 0 ? String(Math.min(3, n)) : 'LOS!';
    const pulse = 1 + (1 - (game.count - Math.floor(game.count))) * 0.25;
    ctx.save();
    ctx.translate(CW / 2, CH * 0.42);
    ctx.scale(pulse, pulse);
    ctx.fillStyle = n > 0 ? '#fff' : '#8ee07a';
    ctx.font = 'bold 72px system-ui';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 6;
    ctx.strokeText(txt, 0, 0); ctx.fillText(txt, 0, 0);
    ctx.restore();
  }
  if (game.flash) {
    ctx.globalAlpha = clamp(2 - game.flash.t * 1.2, 0, 1);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 26px system-ui';
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 5;
    ctx.strokeText(game.flash.text, CW / 2, CH * 0.3);
    ctx.fillText(game.flash.text, CW / 2, CH * 0.3);
    ctx.globalAlpha = 1;
  }
  if (game.state === 'done') drawResults();
}

function drawResults() {
  const order = [...karts].sort((a, b) => (a.place - b.place));
  const h = 76 + order.length * 30;
  const w = Math.min(360, CW - 40);
  const x = CW / 2 - w / 2, y = CH / 2 - h / 2;
  ctx.fillStyle = 'rgba(8,25,42,0.9)';
  roundRect(x, y, w, h, 16); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1.5;
  roundRect(x, y, w, h, 16); ctx.stroke();
  const me = karts[0];
  ctx.textAlign = 'center';
  ctx.fillStyle = me.place === 1 ? '#ffd166' : '#eaf3fa';
  ctx.font = 'bold 24px system-ui';
  ctx.fillText(me.place === 1 ? '🏆 Gewonnen!' : `🏁 Platz ${me.place}`, CW / 2, y + 34);
  ctx.font = '13px system-ui'; ctx.fillStyle = '#bcd6ea';
  ctx.fillText(`Beste Runde: ${fmt(me.bestLap)} · Gesamt: ${fmt(me.finishT)}`, CW / 2, y + 55);
  ctx.textAlign = 'left';
  order.forEach((k, i) => {
    const ry = y + 80 + i * 30;
    ctx.fillStyle = k.human ? 'rgba(255,255,255,0.12)' : 'transparent';
    roundRect(x + 14, ry - 18, w - 28, 26, 8); ctx.fill();
    ctx.fillStyle = k === me ? '#ffd166' : '#eaf3fa';
    ctx.font = (k === me ? 'bold ' : '') + '15px system-ui';
    ctx.fillText(`${i + 1}.  ${k.emoji} ${k.name}`, x + 24, ry);
    ctx.textAlign = 'right';
    ctx.fillText(k.finished ? fmt(k.finishT) : '–', x + w - 24, ry);
    ctx.textAlign = 'left';
  });
  ctx.textAlign = 'center';
  ctx.fillStyle = '#9fc0d8'; ctx.font = '13px system-ui';
  ctx.fillText('R oder ☰ · Neues Rennen', CW / 2, y + h - 12);
}

function drawMinimap() {
  const size = Math.min(118, CH * 0.22);
  const x0 = 14, y0 = 140;
  const sc = size / MAP;
  ctx.fillStyle = 'rgba(8,25,42,0.6)';
  roundRect(x0 - 6, y0 - 6, size + 12, size + 12, 10); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = Math.max(2, size * 0.035);
  ctx.beginPath();
  for (let i = 0; i <= N; i += 4) {
    const p = nodeAt(i);
    const px = x0 + p.x * sc, py = y0 + p.y * sc;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath(); ctx.stroke();
  // Ziellinie
  const sp = nodeAt(0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(x0 + sp.x * sc - 2, y0 + sp.y * sc - 2, 4, 4);
  for (const k of karts) {
    ctx.fillStyle = k.color;
    ctx.beginPath();
    ctx.arc(x0 + k.x * sc, y0 + k.y * sc, k.human ? 4 : 3, 0, TAU);
    ctx.fill();
    if (k.human) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
}

/* ------------------------------------------------------------- Kamera ----- */

function updateCam(dt) {
  const me = karts[0];
  if (!me) return;
  const back = 96, want = me.velAng;
  // Blickrichtung zieht weich nach, beim Drift schaut die Kamera in die Kurve
  const target = me.spinT > 0 ? cam.ang : want + (me.drift ? me.driftDir * 0.18 : 0);
  cam.ang += norm(target - cam.ang) * Math.min(1, dt * 5.5);
  const tx = me.x - Math.cos(cam.ang) * back;
  const ty = me.y - Math.sin(cam.ang) * back;
  const f = Math.min(1, dt * 9);
  cam.x += (tx - cam.x) * f;
  cam.y += (ty - cam.y) * f;
  cam.h = 34 + Math.min(10, Math.abs(me.speed) * 0.03);
}

function draw(time) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  renderGround();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(frameCanvas, 0, 0, CW, CH);
  ctx.imageSmoothingEnabled = true;
  drawSprites(time);
  drawHUD(time);
}

/* ----------------------------------------------------------- Bedienung ---- */

const menuEl = document.getElementById('menu');
const helpEl = document.getElementById('help');
document.getElementById('btn-menu').addEventListener('click', () => { menuEl.classList.remove('hidden'); refreshMenu(); });
document.getElementById('btn-menu-close').addEventListener('click', () => menuEl.classList.add('hidden'));
menuEl.addEventListener('click', (e) => { if (e.target === menuEl) menuEl.classList.add('hidden'); });
document.getElementById('btn-help').addEventListener('click', () => { menuEl.classList.add('hidden'); helpEl.classList.remove('hidden'); });
document.getElementById('btn-start').addEventListener('click', () => { helpEl.classList.add('hidden'); Sfx.unlock(); startRace(); });
document.getElementById('btn-restart').addEventListener('click', () => { menuEl.classList.add('hidden'); startRace(); });
document.getElementById('btn-rotate').addEventListener('click', () => {
  stage.classList.toggle('rot');
  resize();
});
const soundBtn = document.getElementById('btn-sound');
soundBtn.addEventListener('click', () => {
  Sfx.toggle();
  if (Sfx.on) {
    Sfx.unlock(); Sfx.play('pickup');
    if (game.state === 'race') { Sfx.engine(true); Sfx.startMusic(); }
  }
  refreshSound();
});
function refreshSound() {
  soundBtn.textContent = Sfx.on ? '🔊' : '🔇';
  soundBtn.classList.toggle('off', !Sfx.on);
}

// Options-Reihen (gleiche Optik wie bei Klonk)
function bindOpts(id, get, set) {
  const row = document.getElementById(id);
  const refresh = () => { for (const b of row.children) b.classList.toggle('sel', b.dataset.v === String(get())); };
  row.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    set(b.dataset.v);
    refresh();
  });
  refresh();
  return refresh;
}
// Fahrerauswahl im Menü und im Hilfe-Fenster
const driverRow = document.getElementById('opt-driver');
driverRow.innerHTML = DRIVERS.map((d) => `<button data-v="${d.key}">${d.emoji} ${d.name}</button>`).join('');
const pickRow = document.getElementById('pick-driver');
pickRow.innerHTML = DRIVERS.map((d) => `<button class="kart-pick" data-v="${d.key}">`
  + `<span class="kp-emoji">${d.emoji}</span><span class="kp-name">${d.name}</span>`
  + `<span class="kp-note">${d.note}</span></button>`).join('');
function setDriver(key) {
  game.driver = driverOf(key).key;
  try { localStorage.setItem('kart_driver', game.driver); } catch { /* egal */ }
  refreshMenu();
  startRace();
}
pickRow.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  setDriver(b.dataset.v);
  refreshPicks();
});
function refreshPicks() {
  for (const b of pickRow.children) b.classList.toggle('sel', b.dataset.v === game.driver);
}
const refreshers = [
  bindOpts('opt-driver', () => game.driver, (v) => { setDriver(v); refreshPicks(); }),
  bindOpts('opt-cpu', () => game.cpu, (v) => {
    game.cpu = parseInt(v, 10) || 0;
    try { localStorage.setItem('kart_cpu', String(game.cpu)); } catch { /* egal */ }
    startRace();
  }),
  bindOpts('opt-laps', () => game.laps, (v) => {
    game.laps = parseInt(v, 10) || 3;
    try { localStorage.setItem('kart_laps', String(game.laps)); } catch { /* egal */ }
    startRace();
  }),
  bindOpts('opt-sfx', () => (Sfx.on ? 1 : 0), (v) => {
    Sfx.toggle(v === '1');
    if (Sfx.on) { Sfx.unlock(); if (game.state === 'race') { Sfx.engine(true); Sfx.startMusic(); } }
    refreshSound();
  }),
  bindOpts('opt-music', () => (Sfx.musicOn ? 1 : 0), (v) => { Sfx.unlock(); Sfx.setMusic(v === '1'); }),
];
function refreshMenu() { for (const r of refreshers) r(); refreshSound(); refreshPicks(); }

setBtn('k-gas'); setBtn('k-brake'); setBtn('k-drift');
setupSteer('k-steer');
setBtn('k-item', () => { if (karts[0]) useItem(karts[0]); });

// gespeicherte Einstellungen
try {
  const d = localStorage.getItem('kart_driver');
  if (d && DRIVERS.some((x) => x.key === d)) game.driver = d;
  const c = parseInt(localStorage.getItem('kart_cpu'), 10);
  if (Number.isFinite(c) && c >= 0 && c <= 3) game.cpu = c;
  const l = parseInt(localStorage.getItem('kart_laps'), 10);
  if (Number.isFinite(l) && l > 0 && l <= 5) game.laps = l;
} catch { /* egal */ }
Sfx.load();
refreshSound();

// Hochformat-Handys starten gedreht (Querformat spielt sich deutlich besser)
const IS_TOUCH = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)
  || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
if (!IS_TOUCH) {
  document.getElementById('wctrl-left').classList.add('hidden');
  document.getElementById('wctrl-right').classList.add('hidden');
}
if (IS_TOUCH && window.innerWidth < window.innerHeight) stage.classList.add('rot');

/* -------------------------------------------------------------- Schleife -- */

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.04, (now - last) / 1000);
  last = now;
  if (!game.paused) update(dt);
  updateCam(dt);
  draw(now / 1000);
  requestAnimationFrame(frame);
}

resize();
startRace();
refreshMenu();
requestAnimationFrame(frame);

// Test-Hook (Muster wie window.__clonk / window.__td)
window.__kart = {
  game, DRIVERS, ITEMS, SURF, MAP, N, PATH, cam,
  karts: () => karts, bananas: () => bananas, shells: () => shells,
  boxes: () => boxes, trees: () => trees, puffs: () => puffs,
  surfAt, nodeAt, sidePoint, project, update, updateCam, startRace, useItem,
  spinOut, rollItem, nearestNode, progress, input, pressed, buttons,
  setDriver, driverOf, resize, Sfx, isSlow, finishLap, updatePlaces, steerPad,
};
