// ✈️ Flugsimulator – eine Cessna über europäischer Landschaft.
//
// Körperachsen des Flugzeugs: +x nach rechts, +y nach oben, -z nach vorn.
// Drehraten im Körpersystem: om[0] Nicken (positiv = Nase hoch),
// om[1] Gieren (positiv = Nase nach links), om[2] Rollen (positiv =
// rechter Flügel hoch). Die Steuereingaben sind dagegen so herum, wie man
// sie erwartet: elevator > 0 zieht, aileron > 0 rollt nach rechts,
// rudder > 0 tritt rechts.

import { V3, M4, Q, Renderer } from './gl3d.js';
import {
  WORLD, AIRPORT, RUNWAY, CITY, LAKE,
  terrainH, buildWorld, buildPlane, buildProp,
} from './flugwelt.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
// Touch-Gerät: Knüppel und Gashebel liegen dann über dem Bild
const IS_TOUCH = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)
  || 'ontouchstart' in window;
const TAU = Math.PI * 2;
const DEG = 180 / Math.PI;
const KT = 1.94384;          // m/s -> Knoten
const FT = 3.28084;          // m -> Fuß

/* --------------------------------------------------------- Flugzeug ----- */
const AC = {
  m: 1110,                   // Masse (kg), Cessna 172 mit zwei Personen
  S: 16.2,                   // Flügelfläche (m²)
  b: 11.0,                   // Spannweite (m)
  c: 1.49,                   // mittlere Flügeltiefe (m)
  AR: 7.47,
  e: 0.75,                   // Oswald-Faktor
  CL0: 0.30, CLa: 5.0,       // Auftrieb: Grundwert und Anstieg je Radiant
  aStall: 0.283,             // 16,2° – darüber reißt die Strömung ab
  CD0: 0.034,
  Tstatic: 2750,             // Standschub (N)
  P: 124000,                 // Wellenleistung (W) ~ 165 PS
  eta: 0.78,                 // Propellerwirkungsgrad
  Ix: 1950, Iy: 2900, Iz: 1350,   // Trägheitsmomente um Quer-, Hoch-, Längsachse
  vne: 82,                   // Höchstgeschwindigkeit (m/s) ~ 160 kt
};

// Klappenstufen: zusätzlicher Auftrieb, Widerstand und Nickmoment
const FLAPS = [
  { deg: 0, dCL: 0, dCD: 0, dCm: 0 },
  { deg: 10, dCL: 0.32, dCD: 0.011, dCm: -0.03 },
  { deg: 20, dCL: 0.58, dCD: 0.032, dCm: -0.055 },
  { deg: 30, dCL: 0.76, dCD: 0.062, dCm: -0.075 },
];

// Fahrwerk im Körpersystem (Bugrad vorn, Haupträder hinter dem Schwerpunkt)
const GEAR = [
  { p: [0, -2.52, -1.9], steer: true, brake: 0.25 },
  { p: [-1.5, -2.52, 0.45], brake: 1 },
  { p: [1.5, -2.52, 0.45], brake: 1 },
];
// Punkte, deren Bodenberührung als Bruch gilt (Propeller, Flügelspitzen, Heck)
const FRAGILE = [
  [0, -0.35, -2.95], [-5.5, -0.1, 0.1], [5.5, -0.1, 0.1], [0, 0.3, 3.5],
];

/* ------------------------------------------------------ Spielzustand ---- */
const game = {
  state: 'brief',            // brief | fly | crash | landed
  paused: false,
  view: 'cockpit',           // cockpit | chase
  startMode: 'runway',       // runway | approach | city
  wind: 'calm',              // calm | breeze
  sound: true,
  message: '',
  messageT: 0,
  time: 0,
  best: 0,
  landings: 0,
  result: null,
};

const plane = {
  pos: [0, 0, 0],
  vel: [0, 0, 0],
  q: Q.ident(),
  om: [0, 0, 0],
  throttle: 0,
  flapStep: 0,
  trim: 0.02,
  brake: 0,
  rpm: 700,
  onGround: true,
  wasOnGround: true,
  alpha: 0, beta: 0, gLoad: 1,
  vs: 0, agl: 0,
  stall: false,
  touchVS: 0,
  airT: 0,                   // Sekunden seit dem letzten Bodenkontakt
};

// Steuereingaben, -1..1 (von Tastatur, Touch oder Test gesetzt)
const ctl = { elevator: 0, aileron: 0, rudder: 0 };

/* ------------------------------------------------------------- Welt ----- */
const canvas = document.getElementById('scene');
const hud = document.getElementById('hud');
const hctx = hud.getContext('2d');
let R = null, world = null, planeMesh = null, propMesh = null;
let glError = '';

try {
  R = new Renderer(canvas);
  world = buildWorld(R.gl);
  planeMesh = buildPlane(R.gl);
  propMesh = buildProp(R.gl);
} catch (e) {
  glError = e.message || String(e);
}

let CW = 0, CH = 0, DPR = 1;
function resize() {
  const st = document.getElementById('stage');
  CW = st.clientWidth; CH = st.clientHeight;
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  hud.width = Math.round(CW * DPR); hud.height = Math.round(CH * DPR);
  hud.style.width = CW + 'px'; hud.style.height = CH + 'px';
  canvas.style.width = CW + 'px'; canvas.style.height = CH + 'px';
  if (R) R.resize(CW, CH, DPR);
}
window.addEventListener('resize', resize);

/* ------------------------------------------------------- Flugphysik ----- */
const flap = () => FLAPS[plane.flapStep];

// Luftdichte nach Höhe (Standardatmosphäre, vereinfacht)
function density(h) {
  return 1.225 * Math.pow(Math.max(0.1, 1 - 2.2558e-5 * Math.max(0, h)), 4.256);
}

// Auftriebsbeiwert mit Strömungsabriss
function liftCoef(alpha) {
  const f = flap();
  const a = AC.aStall;
  let CL = AC.CL0 + f.dCL + AC.CLa * alpha;
  if (alpha > a) {
    // nach dem Abriss bricht der Auftrieb weg und erholt sich nicht von selbst
    const over = clamp((alpha - a) / 0.14, 0, 1);
    CL = lerp(AC.CL0 + f.dCL + AC.CLa * a, 0.85, over);
  } else if (alpha < -a) {
    const over = clamp((-alpha - a) / 0.14, 0, 1);
    CL = lerp(AC.CL0 + f.dCL - AC.CLa * a, -0.7, over);
  }
  return CL;
}

function windVec() {
  if (game.wind !== 'breeze') return [0, 0, 0];
  const t = game.time;
  return [
    3.4 + Math.sin(t * 0.21) * 1.5,
    Math.sin(t * 0.37) * 0.9,
    1.6 + Math.cos(t * 0.17) * 1.2,
  ];
}

function step(dt) {
  const g = 9.80665;
  const air = V3.sub(plane.vel, windVec());          // Anströmung
  const vb = Q.unrot(plane.q, air);                  // im Körpersystem
  const u = -vb[2];                                  // vorwärts
  const V = Math.max(0.001, V3.len(air));
  const rho = density(plane.pos[1]);
  const qd = 0.5 * rho * V * V;

  // Anstell- und Schiebewinkel
  const alpha = u > 0.5 ? Math.atan2(-vb[1], u) : 0;
  const beta = V > 2 ? Math.asin(clamp(vb[0] / V, -1, 1)) : 0;
  plane.alpha = alpha; plane.beta = beta;
  plane.stall = alpha > AC.aStall - 0.035 && V > 8;

  // Auftrieb und Widerstand in der Anströmebene
  const CL = liftCoef(alpha);
  const CD = AC.CD0 + flap().dCD + (CL * CL) / (Math.PI * AC.AR * AC.e)
    + Math.abs(beta) * 0.22;
  const L = qd * AC.S * CL;
  const D = qd * AC.S * CD;

  const dir = V3.norm(vb);                            // Flugrichtung im Körper
  let span = V3.cross(dir, [0, 1, 0]);
  if (V3.len(span) < 0.02) span = [1, 0, 0];
  span = V3.norm(span);
  const liftDir = V3.norm(V3.cross(span, dir));

  // Schub: Propeller, bei hoher Fahrt begrenzt die Leistung den Schub
  const tMax = Math.min(AC.Tstatic, (AC.P * AC.eta) / Math.max(14, V));
  const thrust = plane.throttle * tMax * (rho / 1.225);

  // Seitenkraft des Seitenleitwerks
  const sideF = -qd * AC.S * 0.62 * beta;

  let F = V3.add(V3.mul(liftDir, L), V3.mul(dir, -D));
  F = V3.add(F, [sideF, 0, 0]);
  F = V3.add(F, [0, 0, -thrust]);
  let Fw = Q.rot(plane.q, F);                         // in die Welt drehen
  Fw = V3.add(Fw, [0, -AC.m * g, 0]);

  // --- Momente ---
  const vSafe = Math.max(18, V);
  const f = flap();
  const qS = qd * AC.S;
  // Nicken: Grundmoment, Längsstabilität, Höhenruder, Trimm, Dämpfung
  const Cm = 0.045 + f.dCm - 1.15 * alpha + 0.26 * ctl.elevator + 0.34 * plane.trim
    - 30 * ((plane.om[0] * AC.c) / (2 * vSafe));
  // Gieren: Wetterfahnenstabilität, Seitenruder, Dämpfung
  const Cn = -0.13 * beta - 0.055 * ctl.rudder - 0.20 * ((plane.om[1] * AC.b) / (2 * vSafe));
  // Rollen: Querruder, Schiebe-Roll-Moment (V-Form), Rolldämpfung
  const Cl = -0.055 * ctl.aileron + 0.09 * beta - 0.60 * ((plane.om[2] * AC.b) / (2 * vSafe));
  let M = [(qS * AC.c * Cm) / AC.Ix, (qS * AC.b * Cn) / AC.Iy, (qS * AC.b * Cl) / AC.Iz];
  // Nach dem Abriss wird es unruhig: die Nase kippt weg
  if (alpha > AC.aStall) {
    const s = clamp((alpha - AC.aStall) / 0.2, 0, 1);
    M[0] -= s * 1.1;
    M[2] += (Math.sin(game.time * 7.3) * s) * 0.5;
  }

  // --- Boden: Fahrwerk als Feder-Dämpfer mit Reibung ---
  const omW = Q.rot(plane.q, plane.om);
  let contact = false, maxPen = 0;
  for (const gset of GEAR) {
    const r = Q.rot(plane.q, gset.p);
    const wp = V3.add(plane.pos, r);
    const gh = terrainH(wp[0], wp[2]);
    const pen = gh - wp[1];
    if (pen <= 0) continue;
    contact = true;
    maxPen = Math.max(maxPen, pen);
    const vP = V3.add(plane.vel, V3.cross(omW, r));
    const N = clamp(pen * 52000 - vP[1] * 7000, 0, 70000);
    let Fg = [0, N, 0];
    // Reibung in der Bodenebene
    const axes = Q.axes(plane.q);
    const fwd = V3.norm([axes[2][0], 0, axes[2][2]]);
    const side = [-fwd[2], 0, fwd[0]];
    const vFwd = V3.dot(vP, fwd), vSide = V3.dot(vP, side);
    const muRoll = 0.022 + plane.brake * gset.brake * 0.62;
    const fFwd = -Math.sign(vFwd) * Math.min(N * muRoll, Math.abs(vFwd) * 900);
    const fSide = -Math.sign(vSide) * Math.min(N * 0.85, Math.abs(vSide) * 2600);
    Fg = V3.add(Fg, V3.add(V3.mul(fwd, fFwd), V3.mul(side, fSide)));
    Fw = V3.add(Fw, Fg);
    const torque = V3.cross(r, Fg);
    const tb = Q.unrot(plane.q, torque);
    M = V3.add(M, [tb[0] / AC.Ix, tb[1] / AC.Iy, tb[2] / AC.Iz]);
  }
  plane.onGround = contact;
  if (contact) {
    // Bugradlenkung: bei Rollgeschwindigkeit wirkt das Seitenruder am Boden
    const spd = Math.abs(V3.dot(plane.vel, Q.axes(plane.q)[2]));
    const steer = ctl.rudder * clamp(1 - spd / 40, 0, 1) * 0.9;
    M[1] -= steer * clamp(spd / 6, 0, 1) * 1.5;
    // Dämpfung, damit das Flugzeug am Boden nicht zappelt
    M[0] -= plane.om[0] * 0.8;
    M[2] -= plane.om[2] * 2.4;
  }

  // --- Integration ---
  const acc = V3.mul(Fw, 1 / AC.m);
  plane.vel = V3.add(plane.vel, V3.mul(acc, dt));
  plane.pos = V3.add(plane.pos, V3.mul(plane.vel, dt));
  plane.om = V3.add(plane.om, V3.mul(M, dt));
  const dq = Q.mul(plane.q, [0, (plane.om[0] * dt) / 2, (plane.om[1] * dt) / 2, (plane.om[2] * dt) / 2]);
  plane.q = Q.norm([plane.q[0] + dq[0], plane.q[1] + dq[1], plane.q[2] + dq[2], plane.q[3] + dq[3]]);

  // Lastvielfaches für das Instrument
  plane.gLoad = (L / (AC.m * g)) * Math.cos(beta) || 0;
  plane.vs = plane.vel[1];
  plane.agl = plane.pos[1] - terrainH(plane.pos[0], plane.pos[2]);

  // Drehzahl folgt dem Gashebel träge
  const target = 700 + plane.throttle * 1950 + Math.min(300, V * 3);
  plane.rpm += (target - plane.rpm) * Math.min(1, dt * 2.6);
  return { contact, maxPen };
}

/* ------------------------------------------------- Bruch und Landung ---- */
function nearRunway() {
  const p = plane.pos;
  return p[0] > RUNWAY.x0 - 12 && p[0] < RUNWAY.x1 + 12
    && p[2] > RUNWAY.z0 - 20 && p[2] < RUNWAY.z1 + 20;
}

function hitsBuilding() {
  const p = plane.pos;
  for (const b of world.buildings) {
    if (p[1] < b.y0 - 6 || p[1] > b.y1 + 4) continue;
    if (Math.abs(p[0] - b.x) > b.sx / 2 + 5.5) continue;
    if (Math.abs(p[2] - b.z) > b.sz / 2 + 5.5) continue;
    return b;
  }
  return null;
}

function crash(why) {
  if (game.state !== 'fly') return;
  game.state = 'crash';
  game.result = { ok: false, why };
  plane.throttle = 0;
  Sfx.play('crash');
  Sfx.engine(0);
}

function landed(score, detail) {
  if (game.state !== 'fly') return;
  game.state = 'landed';
  game.landings++;
  game.result = { ok: true, score, ...detail };
  try {
    if (score > game.best) {
      game.best = score;
      localStorage.setItem('flug_best', String(score));
    }
    const n = Number(localStorage.getItem('flug_landungen') || 0) + 1;
    localStorage.setItem('flug_landungen', String(n));
  } catch { /* ohne Speicher geht es auch */ }
  if (score > game.best) game.best = score;
  Sfx.play('win');
}

// Bewertet das Aufsetzen: sanft, mittig und hinter der Schwelle gibt Punkte
function rateLanding(vs) {
  const dx = Math.abs(plane.pos[0] - AIRPORT.x);
  const fromThr = Math.abs(plane.pos[2] - RUNWAY.z1);
  const sink = Math.abs(vs);
  let s = 100;
  s -= clamp((sink - 0.9) * 30, 0, 50);               // Sinkrate beim Aufsetzen
  s -= clamp((dx - 3) * 2.6, 0, 20);                  // Abstand zur Mittellinie
  s -= clamp((Math.abs(fromThr - 350) - 250) / 14, 0, 16);   // Aufsetzzone
  const { roll } = Q.euler(plane.q);
  s -= clamp((Math.abs(roll * DEG) - 3) * 1.6, 0, 16);
  return { score: Math.max(0, Math.round(s)), sink, dx, fromThr };
}

function checkEvents(res, dt) {
  if (game.state !== 'fly') return;
  const p = plane.pos;

  if (Math.max(Math.abs(p[0]), Math.abs(p[2])) > WORLD / 2 - 300) {
    flash('⚠️ Du verlässt das Gebiet – dreh um!');
  }
  if (p[1] > 4200) flash('⚠️ Ohne Sauerstoff wird die Luft dünn');

  const b = hitsBuilding();
  if (b) { crash('Mit einem Gebäude kollidiert'); return; }

  // Teile, die den Boden nicht berühren dürfen
  for (const f of FRAGILE) {
    const wp = V3.add(p, Q.rot(plane.q, f));
    if (wp[1] < terrainH(wp[0], wp[2])) {
      crash(plane.onGround ? 'Flügel oder Propeller hat den Boden berührt'
        : 'Im Gelände aufgeschlagen');
      return;
    }
  }

  // Aufsetzen – zählt nur nach echtem Flug. Ein kurzes Abheben beim
  // Einfedern oder Rollen (bei 120-Hz-Bildschirmen schon im ersten Bild)
  // ist keine Landung.
  if (res.contact && !plane.wasOnGround && plane.airT > 1) {
    const vs = plane.touchVS;
    Sfx.play(Math.abs(vs) > 2 ? 'thud' : 'touch');
    if (Math.abs(vs) > 4.6) { crash('Zu hart aufgesetzt'); return; }
    if (!nearRunway()) {
      const spd = V3.len(plane.vel);
      if (spd > 34 || Math.abs(vs) > 3) { crash('Außerhalb der Piste aufgeschlagen'); return; }
      flash('🌾 Außenlandung im Feld – Glück gehabt!');
    } else {
      const r = rateLanding(vs);
      flash(r.sink < 1.2 ? '🛬 Butterweich!' : '🛬 Aufgesetzt');
      plane.pendingLanding = r;
    }
  }
  plane.wasOnGround = res.contact;
  if (!res.contact) plane.touchVS = plane.vel[1];
  plane.airT = res.contact ? 0 : plane.airT + dt;

  // Landung gilt als geschafft, wenn das Flugzeug danach ausgerollt ist
  if (plane.pendingLanding && res.contact && V3.len(plane.vel) < 6) {
    const r = plane.pendingLanding;
    plane.pendingLanding = null;
    landed(r.score, r);
  }
  if (plane.pendingLanding && !res.contact && V3.len(plane.vel) > 25) {
    plane.pendingLanding = null;                      // Durchstarten zählt nicht
  }
}

function flash(text) {
  game.message = text;
  game.messageT = 3.2;
}

/* ---------------------------------------------------------- Ablauf ------ */
function reset(mode) {
  game.startMode = mode || game.startMode;
  plane.vel = [0, 0, 0];
  plane.om = [0, 0, 0];
  plane.q = Q.ident();
  plane.brake = 0;
  plane.trim = 0.02;
  plane.flapStep = 0;
  plane.pendingLanding = null;
  plane.wasOnGround = true;
  plane.touchVS = 0;
  plane.airT = 0;
  ctl.elevator = 0; ctl.aileron = 0; ctl.rudder = 0;
  game.result = null;
  game.time = 0;

  if (game.startMode === 'runway') {
    // schon eingefedert hinstellen, damit sie nicht erst auf die Räder fällt
    plane.pos = [AIRPORT.x, RUNWAY.y + 2.52 - 0.07, RUNWAY.z1 - 120];
    plane.throttle = 0;
    plane.onGround = true;
  } else if (game.startMode === 'approach') {
    // 5 km südlich, 450 m über Grund, im Anflug auf die 36
    plane.pos = [AIRPORT.x + 40, RUNWAY.y + 450, RUNWAY.z1 + 4200];
    plane.vel = [0, -2, -42];
    plane.throttle = 0.45;
    plane.flapStep = 1;
    plane.onGround = false;
    plane.wasOnGround = false;
    plane.airT = 30;
  } else {
    // über der Stadt
    plane.pos = [CITY.x - 900, CITY.elev + 620, CITY.z + 1500];
    plane.vel = [0, 0, -50];
    plane.q = Q.axis([0, 1, 0], -0.9);
    plane.vel = Q.rot(plane.q, [0, 0, -50]);
    plane.throttle = 0.6;
    plane.onGround = false;
    plane.wasOnGround = false;
    plane.airT = 30;
  }
  game.state = 'fly';
  flash(game.startMode === 'runway' ? '🛫 Gas geben mit W – bei 60 kt sanft ziehen'
    : '✈️ Viel Spaß beim Fliegen');
}

function update(dt) {
  if (game.messageT > 0) game.messageT -= dt;
  if (game.state === 'brief') return;
  game.time += dt;

  if (game.state === 'fly') {
    // Teilschritte halten die Integration auch bei Rucklern stabil
    const n = Math.min(4, Math.max(1, Math.ceil(dt / 0.012)));
    let res = { contact: plane.onGround };
    for (let i = 0; i < n; i++) res = step(dt / n);
    checkEvents(res, dt);
  } else {
    // Nach Bruch oder Landung rollt nur noch die Zeit
    plane.rpm += (600 - plane.rpm) * Math.min(1, dt * 2);
  }
  Sfx.update(dt);
}

/* ---------------------------------------------------------- Kamera ------ */
let chase = null;
function cameraFor(view) {
  const axes = Q.axes(plane.q);
  if (view === 'cockpit') {
    const eye = V3.add(plane.pos, Q.rot(plane.q, [0, 0.35, -0.55]));
    return { eye, axes, fov: 68, near: 0.6 };
  }
  // Verfolgerkamera: hängt weich hinter dem Flugzeug
  const want = V3.add(plane.pos, V3.add(V3.mul(axes[2], -26), [0, 7, 0]));
  if (!chase) chase = want;
  const k = 0.12;
  chase = [lerp(chase[0], want[0], k), lerp(chase[1], want[1], k), lerp(chase[2], want[2], k)];
  const gh = terrainH(chase[0], chase[2]) + 3;
  const eye = [chase[0], Math.max(chase[1], gh), chase[2]];
  const fwd = V3.norm(V3.sub(V3.add(plane.pos, V3.mul(axes[2], 12)), eye));
  const right = V3.norm(V3.cross(fwd, [0, 1, 0]));
  const up = V3.cross(right, fwd);
  return { eye, axes: [right, up, fwd], fov: 62, near: 1.2 };
}

function render() {
  if (!R) return;
  const cam = cameraFor(game.view);
  R.tint = game.state === 'crash' ? 0.35 : 0;
  R.camera(cam.eye, cam.axes, cam.fov, cam.near, 26000);
  R.drawSky();
  R.begin();
  const m = world.meshes;
  R.draw(m.terrain); R.draw(m.water); R.draw(m.road);
  R.draw(m.port); R.draw(m.city); R.draw(m.village); R.draw(m.trees);
  if (game.view !== 'cockpit') {
    const axes = Q.axes(plane.q);
    R.draw(planeMesh, M4.model(plane.pos, axes));
    const hubPos = V3.add(plane.pos, Q.rot(plane.q, [0, -0.35, -2.95]));
    R.draw(propMesh, M4.model(hubPos, axes, 1 + (plane.rpm > 900 ? 0.25 : 0)));
  }
}

/* ------------------------------------------------------ Instrumente ----- */
const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

function dial(x, y, r, label) {
  hctx.save();
  hctx.translate(x, y);
  hctx.fillStyle = '#10141a';
  hctx.beginPath(); hctx.arc(0, 0, r, 0, TAU); hctx.fill();
  hctx.strokeStyle = '#39424e'; hctx.lineWidth = Math.max(1.5, r * 0.05);
  hctx.beginPath(); hctx.arc(0, 0, r, 0, TAU); hctx.stroke();
  if (label) {
    hctx.fillStyle = '#7d8a99';
    hctx.font = `600 ${Math.round(r * 0.17)}px ${FONT}`;
    hctx.textAlign = 'center';
    hctx.fillText(label, 0, r * 0.84);
  }
  return r;
}

function needle(ang, r, len, w, col) {
  hctx.save();
  hctx.rotate(ang);
  hctx.fillStyle = col;
  hctx.beginPath();
  hctx.moveTo(-w, r * 0.08);
  hctx.lineTo(0, -r * len);
  hctx.lineTo(w, r * 0.08);
  hctx.closePath(); hctx.fill();
  hctx.restore();
}

function drawASI(x, y, r) {
  dial(x, y, r, 'KNOTEN');
  const kt = V3.len(plane.vel) * KT;
  hctx.textAlign = 'center';
  // Bogen: weiß (Klappen), grün (normal), gelb/rot
  const toAng = (v) => (-140 + ((v - 40) / 140) * 280) * (Math.PI / 180);
  const arc = (a, b, col, rr) => {
    hctx.strokeStyle = col; hctx.lineWidth = r * 0.08;
    hctx.beginPath(); hctx.arc(0, 0, r * rr, toAng(a) - Math.PI / 2, toAng(b) - Math.PI / 2);
    hctx.stroke();
  };
  arc(35, 85, '#e8e8e8', 0.86);
  arc(48, 128, '#3fa34d', 0.76);
  arc(128, 158, '#e0b225', 0.76);
  arc(158, 170, '#d33', 0.76);
  hctx.fillStyle = '#c8d4df';
  hctx.font = `600 ${Math.round(r * 0.19)}px ${FONT}`;
  for (let v = 40; v <= 180; v += 20) {
    const a = toAng(v);
    hctx.save(); hctx.rotate(a);
    hctx.fillRect(-r * 0.025, -r * 0.95, r * 0.05, r * 0.16);
    hctx.restore();
    hctx.fillText(String(v), Math.sin(a) * r * 0.62, -Math.cos(a) * r * 0.62 + r * 0.07);
  }
  needle(toAng(clamp(kt, 32, 182)), r, 0.82, r * 0.05, '#f2f5f8');
  hctx.fillStyle = '#e8eef4';
  hctx.font = `700 ${Math.round(r * 0.2)}px ${FONT}`;
  hctx.fillText(Math.round(kt) + ' kt', 0, -r * 0.3);
  hctx.restore();
}

function drawAI(x, y, r) {
  const { roll, pitch } = Q.euler(plane.q);
  hctx.save();
  hctx.translate(x, y);
  hctx.save();
  hctx.beginPath(); hctx.arc(0, 0, r * 0.92, 0, TAU); hctx.clip();
  hctx.rotate(-roll);
  const off = (pitch * DEG) * (r / 26);
  hctx.fillStyle = '#2f73b8';
  hctx.fillRect(-r * 2, -r * 2 + off, r * 4, r * 2);
  hctx.fillStyle = '#7a5a2e';
  hctx.fillRect(-r * 2, off, r * 4, r * 2);
  hctx.strokeStyle = '#f0f4f8'; hctx.lineWidth = Math.max(1, r * 0.022);
  hctx.beginPath(); hctx.moveTo(-r * 2, off); hctx.lineTo(r * 2, off); hctx.stroke();
  hctx.fillStyle = '#dfe8f0';
  hctx.font = `600 ${Math.round(r * 0.14)}px ${FONT}`;
  hctx.textAlign = 'center';
  for (let d = -30; d <= 30; d += 10) {
    if (!d) continue;
    const yy = off - d * (r / 26);
    const w = d % 20 === 0 ? r * 0.36 : r * 0.2;
    hctx.fillRect(-w / 2, yy - r * 0.01, w, r * 0.02);
  }
  hctx.restore();
  // Rollskala
  hctx.strokeStyle = '#c8d4df'; hctx.lineWidth = Math.max(1, r * 0.02);
  for (const d of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const a = (d * Math.PI) / 180;
    hctx.save(); hctx.rotate(a);
    hctx.beginPath();
    hctx.moveTo(0, -r * 0.92); hctx.lineTo(0, -r * (d % 30 === 0 ? 0.78 : 0.85));
    hctx.stroke(); hctx.restore();
  }
  hctx.save(); hctx.rotate(-roll);
  hctx.fillStyle = '#ffd166';
  hctx.beginPath();
  hctx.moveTo(0, -r * 0.74); hctx.lineTo(-r * 0.07, -r * 0.62); hctx.lineTo(r * 0.07, -r * 0.62);
  hctx.closePath(); hctx.fill();
  hctx.restore();
  // feststehendes Flugzeugsymbol
  hctx.strokeStyle = '#ffd166'; hctx.lineWidth = Math.max(2, r * 0.05);
  hctx.beginPath();
  hctx.moveTo(-r * 0.46, 0); hctx.lineTo(-r * 0.16, 0);
  hctx.moveTo(r * 0.16, 0); hctx.lineTo(r * 0.46, 0);
  hctx.moveTo(0, -r * 0.06); hctx.lineTo(0, r * 0.1);
  hctx.stroke();
  hctx.strokeStyle = '#39424e'; hctx.lineWidth = Math.max(1.5, r * 0.05);
  hctx.beginPath(); hctx.arc(0, 0, r * 0.92, 0, TAU); hctx.stroke();
  hctx.fillStyle = '#7d8a99';
  hctx.font = `600 ${Math.round(r * 0.17)}px ${FONT}`;
  hctx.textAlign = 'center';
  hctx.fillText('HORIZONT', 0, r * 0.84);
  hctx.restore();
}

function drawALT(x, y, r) {
  dial(x, y, r, 'FUSS');
  const ft = plane.pos[1] * FT;
  const hund = (ft % 1000) / 1000, taus = (ft % 10000) / 10000;
  hctx.fillStyle = '#c8d4df';
  hctx.font = `600 ${Math.round(r * 0.19)}px ${FONT}`;
  hctx.textAlign = 'center';
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    hctx.save(); hctx.rotate(a);
    hctx.fillRect(-r * 0.03, -r * 0.95, r * 0.06, r * 0.15);
    hctx.restore();
    hctx.fillText(String(i), Math.sin(a) * r * 0.6, -Math.cos(a) * r * 0.6 + r * 0.07);
  }
  needle(taus * TAU, r, 0.52, r * 0.07, '#f2f5f8');
  needle(hund * TAU, r, 0.84, r * 0.045, '#f2f5f8');
  hctx.fillStyle = '#e8eef4';
  hctx.font = `700 ${Math.round(r * 0.2)}px ${FONT}`;
  hctx.fillText(Math.round(ft) + "'", 0, -r * 0.3);
  hctx.restore();
}

function drawVSI(x, y, r) {
  dial(x, y, r, 'STEIGEN');
  const fpm = clamp(plane.vs * FT * 60, -2000, 2000);
  hctx.fillStyle = '#c8d4df';
  hctx.font = `600 ${Math.round(r * 0.18)}px ${FONT}`;
  hctx.textAlign = 'center';
  for (let v = -2000; v <= 2000; v += 500) {
    const a = (v / 2000) * 2.3;
    hctx.save(); hctx.rotate(a + Math.PI / 2);
    hctx.fillRect(-r * 0.025, -r * 0.95, r * 0.05, r * 0.14);
    hctx.restore();
  }
  hctx.fillText('0', -r * 0.6, r * 0.07);
  hctx.fillText('+1', -r * 0.1, -r * 0.46);
  hctx.fillText('-1', -r * 0.1, r * 0.56);
  needle((fpm / 2000) * 2.3 + Math.PI / 2, r, 0.82, r * 0.045, '#8ee07a');
  hctx.restore();
}

function drawHSI(x, y, r) {
  dial(x, y, r, 'KURS');
  const { yaw } = Q.euler(plane.q);
  hctx.save();
  hctx.rotate(-yaw);
  hctx.fillStyle = '#c8d4df';
  hctx.textAlign = 'center';
  const marks = [['N', 0], ['O', 90], ['S', 180], ['W', 270]];
  hctx.font = `700 ${Math.round(r * 0.22)}px ${FONT}`;
  for (const [t, d] of marks) {
    const a = (d * Math.PI) / 180;
    hctx.fillText(t, Math.sin(a) * r * 0.58, -Math.cos(a) * r * 0.58 + r * 0.08);
  }
  hctx.font = `600 ${Math.round(r * 0.15)}px ${FONT}`;
  for (let d = 0; d < 360; d += 30) {
    const a = (d * Math.PI) / 180;
    hctx.save(); hctx.rotate(a);
    hctx.fillRect(-r * 0.02, -r * 0.95, r * 0.04, d % 90 === 0 ? r * 0.18 : r * 0.1);
    hctx.restore();
  }
  hctx.restore();
  hctx.fillStyle = '#ffd166';
  hctx.beginPath();
  hctx.moveTo(0, -r * 0.95); hctx.lineTo(-r * 0.09, -r * 0.78); hctx.lineTo(r * 0.09, -r * 0.78);
  hctx.closePath(); hctx.fill();
  hctx.fillStyle = '#e8eef4';
  hctx.font = `700 ${Math.round(r * 0.2)}px ${FONT}`;
  hctx.textAlign = 'center';
  const deg = ((yaw * DEG) % 360 + 360) % 360;
  hctx.fillText(String(Math.round(deg)).padStart(3, '0') + '°', 0, -r * 0.3);
  // Schiebe-Kugel
  hctx.fillStyle = '#1b222b';
  hctx.fillRect(-r * 0.4, r * 0.3, r * 0.8, r * 0.18);
  hctx.fillStyle = '#d7dee6';
  hctx.beginPath();
  hctx.arc(clamp(-plane.beta * 7, -1, 1) * r * 0.3, r * 0.39, r * 0.08, 0, TAU);
  hctx.fill();
  hctx.restore();
}

function drawRPM(x, y, r) {
  dial(x, y, r, 'RPM x100');
  hctx.fillStyle = '#c8d4df';
  hctx.font = `600 ${Math.round(r * 0.2)}px ${FONT}`;
  hctx.textAlign = 'center';
  const toAng = (v) => (-130 + ((v - 500) / 2200) * 260) * (Math.PI / 180);
  for (let v = 500; v <= 2700; v += 500) {
    const a = toAng(v);
    hctx.save(); hctx.rotate(a);
    hctx.fillRect(-r * 0.03, -r * 0.95, r * 0.06, r * 0.15);
    hctx.restore();
    hctx.fillText(String(Math.round(v / 100)), Math.sin(a) * r * 0.58, -Math.cos(a) * r * 0.58 + r * 0.07);
  }
  hctx.strokeStyle = '#3fa34d'; hctx.lineWidth = r * 0.07;
  hctx.beginPath();
  hctx.arc(0, 0, r * 0.8, toAng(2100) - Math.PI / 2, toAng(2600) - Math.PI / 2);
  hctx.stroke();
  needle(toAng(clamp(plane.rpm, 480, 2720)), r, 0.8, r * 0.05, '#f2f5f8');
  hctx.restore();
}

// Hebel für Gas, Klappen und Trimm
function lever(x, y, w, h, frac, label, col) {
  hctx.fillStyle = 'rgba(12,16,22,0.9)';
  hctx.fillRect(x, y, w, h);
  hctx.strokeStyle = '#39424e'; hctx.lineWidth = 1.5;
  hctx.strokeRect(x, y, w, h);
  hctx.fillStyle = col;
  hctx.fillRect(x + 3, y + h - 3 - (h - 6) * frac, w - 6, (h - 6) * frac);
  hctx.fillStyle = '#9fb0c0';
  hctx.font = `600 ${Math.round(w * 0.52)}px ${FONT}`;
  hctx.textAlign = 'center';
  hctx.fillText(label, x + w / 2, y + h + w * 0.6);
}

function drawPanel() {
  const w = CW, h = CH;
  const twoRows = h > 480 && w > 620;
  const panelH = clamp(h * (twoRows ? 0.40 : 0.30), 112, 330);
  const top = h - panelH;
  // Instrumentenbrett
  const grad = hctx.createLinearGradient(0, top, 0, h);
  grad.addColorStop(0, '#222a33');
  grad.addColorStop(0.12, '#161c23');
  grad.addColorStop(1, '#0a0e13');
  hctx.fillStyle = grad;
  hctx.fillRect(0, top, w, panelH);
  hctx.fillStyle = '#2f3843';
  hctx.fillRect(0, top, w, Math.max(3, panelH * 0.025));

  // Kabinenrahmen: schmale A-Säulen und eine Dachkante
  const post = Math.max(10, w * 0.022);
  hctx.fillStyle = '#1a2028';
  hctx.fillRect(0, 0, w, Math.max(8, h * 0.028));
  for (const s of [0, 1]) {
    hctx.beginPath();
    const x0 = s ? w : 0, x1 = s ? w - post * 1.6 : post * 1.6;
    hctx.moveTo(x0, 0);
    hctx.lineTo(x1, 0);
    hctx.lineTo(s ? w - post * 0.2 : post * 0.2, top);
    hctx.lineTo(x0, top);
    hctx.closePath(); hctx.fill();
  }

  // Auf Touch-Geräten bleiben Knüppel und Gashebel links und rechts frei
  const padL = IS_TOUCH ? Math.min(w * 0.34, 158) : 0;
  const padR = IS_TOUCH ? Math.min(w * 0.34, 158) : 0;
  const frei = w - padL - padR;
  if (frei < 240) {
    // Hochformat auf dem Handy: für Instrumente ist kein Platz
    hctx.fillStyle = '#9fb0c0';
    hctx.font = `600 ${Math.round(Math.min(16, w * 0.042))}px ${FONT}`;
    hctx.textAlign = 'center';
    hctx.fillText('⟳ Für die Instrumente ins Querformat drehen', w / 2, top + panelH * 0.52);
    return;
  }

  // Instrumente: oben das Dreier-Set, darunter die Ergänzungen
  const rowH = twoRows ? panelH * 0.46 : panelH * 0.82;
  const anzahl = twoRows ? 3 : (w - padL - padR > 420 ? 4 : 3);
  const r = Math.min(rowH * 0.46, (frei * 0.72) / (anzahl * 2.3));
  const gap = r * 2.3;
  const lw = Math.max(12, r * 0.42);
  const breite = (anzahl - 1) * gap + 2 * r + lw * 6.2;
  const cx = padL + (frei - breite) / 2 + r + (twoRows ? gap : gap * 1.5);
  const y1 = top + panelH * (twoRows ? 0.3 : 0.5);
  drawASI(cx - gap, y1, r);
  drawAI(cx, y1, r);
  drawALT(cx + gap, y1, r);
  if (twoRows) {
    const r2 = r * 0.8, y2 = top + panelH * 0.74;
    drawRPM(cx - gap, y2, r2);
    drawHSI(cx, y2, r2);
    drawVSI(cx + gap, y2, r2);
  } else {
    drawHSI(cx + gap * 2, y1, r * 0.82);
  }

  // Hebel rechts daneben
  const lh = panelH * 0.5;
  // rechts bleibt der Gashebel der Touch-Steuerung frei
  const lx = Math.min(cx + gap * (twoRows ? 1.6 : 2.65) + r * 0.6, w - padR - lw * 5.2);
  const ly = top + panelH * 0.18;
  lever(lx, ly, lw, lh, plane.throttle, 'GAS', '#e07a2a');
  lever(lx + lw * 1.9, ly, lw, lh, plane.flapStep / 3, 'KL', '#3f8ad8');
  lever(lx + lw * 3.8, ly, lw, lh, (plane.trim + 0.4) / 0.8, 'TR', '#8ee07a');
  const tx = lx + lw * 5.4;
  if (tx < w - padR - 110) {
    hctx.fillStyle = '#9fb0c0';
    hctx.font = `600 ${Math.round(Math.max(11, r * 0.26))}px ${FONT}`;
    hctx.textAlign = 'left';
    hctx.fillText(`Klappen ${flap().deg}°`, tx, ly + lh * 0.26);
    hctx.fillText(`Gas ${Math.round(plane.throttle * 100)} %`, tx, ly + lh * 0.52);
    if (plane.brake > 0.5) {
      hctx.fillStyle = '#ffb0a0';
      hctx.fillText('Bremse', tx, ly + lh * 0.78);
    }
  }
}

function drawHUD() {
  hctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  hctx.clearRect(0, 0, CW, CH);
  if (glError) {
    hctx.fillStyle = '#10141a'; hctx.fillRect(0, 0, CW, CH);
    hctx.fillStyle = '#ffd166';
    hctx.font = `600 16px ${FONT}`;
    hctx.textAlign = 'center';
    hctx.fillText('3D steht hier nicht zur Verfügung:', CW / 2, CH / 2 - 12);
    hctx.fillText(glError, CW / 2, CH / 2 + 12);
    return;
  }
  if (game.view === 'cockpit') drawPanel();

  // Kopfzeile: Fahrt, Höhe, Kurs – in beiden Sichten. Auf schmalen Schirmen
  // rutscht sie unter die Werkzeugleiste, sonst steht sie daneben.
  const kt = V3.len(plane.vel) * KT;
  const bar = Math.max(26, Math.min(42, CH * 0.052));
  const schmal = CW < 560;
  const b0 = schmal ? Math.max(52, CH * 0.06) : 0;
  const links = schmal ? 10 : Math.min(CW * 0.2, 168);
  hctx.fillStyle = 'rgba(8,12,18,0.55)';
  hctx.fillRect(0, b0, CW, bar);
  hctx.fillStyle = '#eaf3fa';
  hctx.font = `700 ${Math.round(bar * 0.42)}px ${FONT}`;
  hctx.textAlign = 'left';
  hctx.fillText(`${Math.round(kt)} kt`, links, b0 + bar * 0.64);
  hctx.textAlign = 'center';
  hctx.fillText(`${Math.round(plane.pos[1] * FT)} ft`, CW * (schmal ? 0.46 : 0.45), b0 + bar * 0.64);
  if (!schmal) {
    hctx.fillText(`${Math.round(plane.agl * FT)} ft GND`, CW * 0.65, b0 + bar * 0.64);
  }
  hctx.textAlign = 'right';
  const deg = ((Q.euler(plane.q).yaw * DEG) % 360 + 360) % 360;
  hctx.fillText(`${String(Math.round(deg)).padStart(3, '0')}°`, CW - 12, b0 + bar * 0.64);

  if (plane.stall && game.state === 'fly') {
    hctx.fillStyle = Math.sin(game.time * 14) > 0 ? '#ff5544' : '#ffaa33';
    hctx.font = `800 ${Math.round(bar * 0.5)}px ${FONT}`;
    hctx.textAlign = 'center';
    hctx.fillText('⚠ ÜBERZIEHEN', CW / 2, b0 + bar * 1.9);
  }

  if (game.messageT > 0 && game.state === 'fly') {
    hctx.globalAlpha = clamp(game.messageT, 0, 1);
    hctx.fillStyle = 'rgba(8,12,18,0.7)';
    const tw = hctx.measureText(game.message).width;
    hctx.font = `600 ${Math.round(bar * 0.44)}px ${FONT}`;
    hctx.fillRect(CW / 2 - tw / 2 - 16, b0 + bar * 2.3, tw + 32, bar * 0.95);
    hctx.fillStyle = '#eaf3fa';
    hctx.textAlign = 'center';
    hctx.fillText(game.message, CW / 2, b0 + bar * 2.95);
    hctx.globalAlpha = 1;
  }

  if (game.state === 'crash' || game.state === 'landed') {
    const ok = game.state === 'landed';
    hctx.fillStyle = ok ? 'rgba(10,40,24,0.82)' : 'rgba(50,10,10,0.82)';
    const bw = Math.min(CW * 0.8, 520), bh = 190;
    const bx = CW / 2 - bw / 2, by = CH * 0.3;
    hctx.fillRect(bx, by, bw, bh);
    hctx.strokeStyle = ok ? '#8ee07a' : '#ff7a6a';
    hctx.lineWidth = 2; hctx.strokeRect(bx, by, bw, bh);
    hctx.textAlign = 'center';
    hctx.fillStyle = '#fff';
    hctx.font = `800 26px ${FONT}`;
    hctx.fillText(ok ? '🛬 Gelandet!' : '💥 Bruch', CW / 2, by + 44);
    hctx.font = `600 15px ${FONT}`;
    const r = game.result || {};
    if (ok) {
      hctx.fillText(`${r.score} Punkte`, CW / 2, by + 78);
      hctx.fillStyle = '#cfe2f0';
      hctx.font = `500 14px ${FONT}`;
      hctx.fillText(`Sinkrate ${(r.sink * FT * 60).toFixed(0)} ft/min · `
        + `${r.dx.toFixed(1)} m neben der Mittellinie`, CW / 2, by + 104);
      hctx.fillText(`Beste Landung: ${game.best} Punkte`, CW / 2, by + 126);
    } else {
      hctx.fillStyle = '#ffd3cd';
      hctx.fillText(r.why || '', CW / 2, by + 80);
    }
    if (!IS_TOUCH) {
      hctx.fillStyle = '#9fb0c0';
      hctx.font = `600 13px ${FONT}`;
      hctx.fillText('oder Taste R', CW / 2, by + bh - 8);
    }
  }
}

/* ------------------------------------------------------------- Ton ------ */
const Sfx = {
  ctx: null, engine_: null, wind_: null, on: true,
  load() {
    try { this.on = localStorage.getItem('flug_sound') !== '0'; } catch { /* egal */ }
  },
  init() {
    if (this.ctx || !this.on) return;
    const AC_ = window.AudioContext || window.webkitAudioContext;
    if (!AC_) return;
    this.ctx = new AC_();
    const c = this.ctx;
    // Motor: Sägezahn plus Rauschen
    const osc = c.createOscillator();
    osc.type = 'sawtooth'; osc.frequency.value = 60;
    const og = c.createGain(); og.gain.value = 0;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    osc.connect(og); og.connect(lp); lp.connect(c.destination);
    osc.start();
    // Fahrtwind: gefiltertes Rauschen
    const len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf; src.loop = true;
    const wg = c.createGain(); wg.gain.value = 0;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 600; bp.Q.value = 0.6;
    src.connect(bp); bp.connect(wg); wg.connect(c.destination);
    src.start();
    this.engine_ = { osc, gain: og };
    this.wind_ = { gain: wg, filt: bp };
  },
  update() {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    const rpm = game.state === 'fly' ? plane.rpm : 0;
    if (this.engine_) {
      this.engine_.osc.frequency.setTargetAtTime(Math.max(20, rpm / 11), t, 0.1);
      this.engine_.gain.gain.setTargetAtTime(rpm > 50 ? 0.055 : 0, t, 0.2);
    }
    if (this.wind_) {
      const v = V3.len(plane.vel);
      this.wind_.gain.gain.setTargetAtTime(clamp(v / 460, 0, 0.1), t, 0.3);
      this.wind_.filt.frequency.setTargetAtTime(380 + v * 9, t, 0.3);
    }
  },
  engine(v) { if (this.engine_ && this.ctx) this.engine_.gain.gain.value = v; },
  play(kind) {
    if (!this.on) return;
    this.init();
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const g = c.createGain(); g.connect(c.destination);
    if (kind === 'crash' || kind === 'thud' || kind === 'touch') {
      const len = c.sampleRate * (kind === 'crash' ? 0.8 : 0.22);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
      const s = c.createBufferSource(); s.buffer = buf;
      const f = c.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = kind === 'crash' ? 700 : 300;
      s.connect(f); f.connect(g);
      g.gain.setValueAtTime(kind === 'touch' ? 0.25 : 0.6, t);
      s.start();
    } else if (kind === 'win') {
      for (const [i, f] of [523, 659, 784, 1046].entries()) {
        const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
        const gg = c.createGain(); gg.connect(c.destination);
        gg.gain.setValueAtTime(0.0001, t + i * 0.12);
        gg.gain.exponentialRampToValueAtTime(0.18, t + i * 0.12 + 0.02);
        gg.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 0.3);
        o.connect(gg); o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.32);
      }
    }
  },
};
Sfx.load();

/* ---------------------------------------------------------- Eingabe ----- */
const keys = new Set();
const KEYMAP = {
  ArrowUp: 'pitchDown', ArrowDown: 'pitchUp', ArrowLeft: 'rollLeft', ArrowRight: 'rollRight',
  w: 'thrUp', s: 'thrDown', a: 'rollLeft', d: 'rollRight',
  y: 'yawLeft', x: 'yawRight', ',': 'yawLeft', '.': 'yawRight',
  b: 'brake', f: 'flapDown', g: 'flapUp', c: 'view', v: 'view', r: 'restart',
  q: 'trimUp', e: 'trimDown',
};

function applyKeys(dt) {
  const rate = 1.7 * dt;              // Ruder laufen weich auf, nicht schlagartig
  const want = (a) => keys.has(a);
  // Höhenruder: Pfeil hoch drückt die Nase, Pfeil runter zieht – wie ein Steuerhorn
  let e = 0;
  if (want('pitchUp')) e += 1;
  if (want('pitchDown')) e -= 1;
  let a = 0;
  if (want('rollRight')) a += 1;
  if (want('rollLeft')) a -= 1;
  let r = 0;
  if (want('yawRight')) r += 1;
  if (want('yawLeft')) r -= 1;
  // Touch-Stick überschreibt die Tastatur, wenn er benutzt wird
  if (stick.active) { e = -stick.y; a = stick.x; }
  if (touchRudder) r = touchRudder;

  const toward = (cur, target, sp) => {
    if (target === 0) return cur * Math.max(0, 1 - sp * 2.4);
    return clamp(cur + Math.sign(target - cur) * Math.min(sp, Math.abs(target - cur)), -1, 1);
  };
  ctl.elevator = toward(ctl.elevator, e, rate);
  ctl.aileron = toward(ctl.aileron, a, rate);
  ctl.rudder = toward(ctl.rudder, r, rate);

  if (want('thrUp')) plane.throttle = clamp(plane.throttle + dt * 0.55, 0, 1);
  if (want('thrDown')) plane.throttle = clamp(plane.throttle - dt * 0.55, 0, 1);
  if (want('trimUp')) plane.trim = clamp(plane.trim + dt * 0.12, -0.4, 0.4);
  if (want('trimDown')) plane.trim = clamp(plane.trim - dt * 0.12, -0.4, 0.4);
  plane.brake = want('brake') || touchBrake ? 1 : 0;
}

window.addEventListener('keydown', (ev) => {
  if (ev.target && /input|textarea/i.test(ev.target.tagName)) return;
  const act = KEYMAP[ev.key] || KEYMAP[ev.key.toLowerCase()];
  if (!act) return;
  ev.preventDefault();
  Sfx.init();
  if (act === 'view') { toggleView(); return; }
  if (act === 'restart') { reset(); return; }
  if (act === 'flapDown') { setFlaps(plane.flapStep + 1); return; }
  if (act === 'flapUp') { setFlaps(plane.flapStep - 1); return; }
  keys.add(act);
});
window.addEventListener('keyup', (ev) => {
  const act = KEYMAP[ev.key] || KEYMAP[ev.key.toLowerCase()];
  if (act) keys.delete(act);
});
window.addEventListener('blur', () => keys.clear());

function setFlaps(step) {
  const s = clamp(Math.round(step), 0, 3);
  if (s === plane.flapStep) return;
  plane.flapStep = s;
  flash(`Klappen ${FLAPS[s].deg}°`);
}

function toggleView() {
  game.view = game.view === 'cockpit' ? 'chase' : 'cockpit';
  chase = null;
  refreshMenu();
}

/* ------------------------------------------------- Touch-Steuerung ------ */
const stick = { active: false, x: 0, y: 0, id: null };
let touchRudder = 0, touchBrake = false;

function setupTouch() {
  const pad = document.getElementById('stick');
  const knob = document.getElementById('stick-knob');
  if (!pad) return;
  const rad = () => pad.getBoundingClientRect();
  const move = (ev) => {
    const b = rad();
    const rot = document.getElementById('stage').classList.contains('rot');
    let dx = (ev.clientX - (b.left + b.width / 2)) / (b.width / 2);
    let dy = (ev.clientY - (b.top + b.height / 2)) / (b.height / 2);
    if (rot) { const t = dx; dx = dy; dy = -t; }
    stick.x = clamp(dx, -1, 1);
    stick.y = clamp(dy, -1, 1);
    knob.style.transform = `translate(${stick.x * 34}px, ${stick.y * 34}px)`;
  };
  pad.addEventListener('pointerdown', (ev) => {
    stick.active = true; stick.id = ev.pointerId;
    pad.setPointerCapture(ev.pointerId); Sfx.init(); move(ev);
  });
  pad.addEventListener('pointermove', (ev) => { if (stick.active && ev.pointerId === stick.id) move(ev); });
  const end = () => {
    stick.active = false; stick.x = 0; stick.y = 0;
    knob.style.transform = 'translate(0,0)';
  };
  pad.addEventListener('pointerup', end);
  pad.addEventListener('pointercancel', end);

  const thr = document.getElementById('thr');
  if (thr) {
    const setThr = (ev) => {
      const b = thr.getBoundingClientRect();
      const rot = document.getElementById('stage').classList.contains('rot');
      const f = rot
        ? (ev.clientX - b.left) / b.width
        : 1 - (ev.clientY - b.top) / b.height;
      plane.throttle = clamp(f, 0, 1);
    };
    thr.addEventListener('pointerdown', (ev) => {
      thr.setPointerCapture(ev.pointerId); Sfx.init(); setThr(ev);
    });
    thr.addEventListener('pointermove', (ev) => {
      if (thr.hasPointerCapture && thr.hasPointerCapture(ev.pointerId)) setThr(ev);
    });
  }

  const hold = (id, down, up) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('pointerdown', (ev) => {
      ev.preventDefault(); el.classList.add('held'); Sfx.init(); down();
    });
    for (const e of ['pointerup', 'pointerleave', 'pointercancel']) {
      el.addEventListener(e, () => { el.classList.remove('held'); if (up) up(); });
    }
  };
  hold('t-left', () => { touchRudder = -1; }, () => { touchRudder = 0; });
  hold('t-right', () => { touchRudder = 1; }, () => { touchRudder = 0; });
  hold('t-brake', () => { touchBrake = true; }, () => { touchBrake = false; });
  document.getElementById('t-flapd')?.addEventListener('click', () => setFlaps(plane.flapStep + 1));
  document.getElementById('t-flapu')?.addEventListener('click', () => setFlaps(plane.flapStep - 1));
  document.getElementById('t-view')?.addEventListener('click', toggleView);
}

/* ------------------------------------------------------------- Menü ----- */
const menuEl = document.getElementById('menu');
const helpEl = document.getElementById('help');
const soundBtn = document.getElementById('btn-sound');

function loadSettings() {
  try {
    game.startMode = localStorage.getItem('flug_start') || 'runway';
    game.wind = localStorage.getItem('flug_wind') || 'calm';
    game.view = localStorage.getItem('flug_view') || 'cockpit';
    game.best = Number(localStorage.getItem('flug_best') || 0);
  } catch { /* egal */ }
}

function refreshSound() {
  if (soundBtn) soundBtn.textContent = Sfx.on ? '🔊' : '🔇';
}

function bindOpts(id, get, set) {
  const row = document.getElementById(id);
  if (!row) return () => {};
  for (const b of row.querySelectorAll('button')) {
    b.addEventListener('click', () => { set(b.dataset.v); refreshMenu(); });
  }
  return () => {
    for (const b of row.querySelectorAll('button')) {
      b.classList.toggle('on', String(get()) === b.dataset.v);
    }
  };
}

const refreshers = [
  bindOpts('opt-start', () => game.startMode, (v) => {
    game.startMode = v;
    try { localStorage.setItem('flug_start', v); } catch { /* egal */ }
  }),
  bindOpts('opt-wind', () => game.wind, (v) => {
    game.wind = v;
    try { localStorage.setItem('flug_wind', v); } catch { /* egal */ }
  }),
  bindOpts('opt-view', () => game.view, (v) => {
    game.view = v; chase = null;
    try { localStorage.setItem('flug_view', v); } catch { /* egal */ }
  }),
];
function refreshMenu() { for (const f of refreshers) f(); refreshSound(); }

document.getElementById('btn-menu')?.addEventListener('click', () => {
  menuEl.classList.remove('hidden'); refreshMenu();
});
document.getElementById('btn-menu-close')?.addEventListener('click', () => menuEl.classList.add('hidden'));
document.getElementById('btn-restart')?.addEventListener('click', () => {
  menuEl.classList.add('hidden'); Sfx.init(); reset();
});
document.getElementById('btn-help')?.addEventListener('click', () => {
  menuEl.classList.add('hidden'); helpEl.style.display = 'flex';
});
document.getElementById('btn-start')?.addEventListener('click', () => {
  helpEl.style.display = 'none';
  Sfx.init();
  if (game.state === 'brief') reset();
});
soundBtn?.addEventListener('click', () => {
  Sfx.on = !Sfx.on;
  try { localStorage.setItem('flug_sound', Sfx.on ? '1' : '0'); } catch { /* egal */ }
  if (!Sfx.on) Sfx.engine(0); else Sfx.init();
  refreshSound();
});

const stage = document.getElementById('stage');
const againBtn = document.getElementById('btn-again');
againBtn.addEventListener('click', () => { Sfx.init(); reset(); });
document.getElementById('btn-rotate')?.addEventListener('click', () => {
  stage.classList.toggle('rot');
  requestAnimationFrame(resize);
});
if (IS_TOUCH) document.body.classList.add('touch');

/* ----------------------------------------------------------- Schleife --- */
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.06, (now - last) / 1000);
  last = now;
  if (!game.paused) {
    applyKeys(dt);
    update(dt);
  }
  render();
  drawHUD();
  againBtn.classList.toggle('hidden', game.state !== 'crash' && game.state !== 'landed');
  requestAnimationFrame(frame);
}

loadSettings();
refreshSound();
setupTouch();
resize();
reset(game.startMode);
game.state = 'brief';
refreshMenu();
requestAnimationFrame(frame);

/* -------------------------------------------------------- Test-Hook ----- */
window.__flug = {
  game, plane, ctl, AC, FLAPS, GEAR,
  update, step, reset, render, drawHUD, resize, setFlaps, toggleView,
  terrainH, liftCoef, density, cameraFor, rateLanding, crash, landed,
  hitsBuilding, nearRunway, flash, Sfx,
  world: () => world,
  keys,
  set: (o) => Object.assign(ctl, o),
  stick,
  AIRPORT, RUNWAY, CITY, LAKE, WORLD,
  kt: () => V3.len(plane.vel) * KT,
  euler: () => Q.euler(plane.q),
  size: () => ({ CW, CH }),
  glError: () => glError,
};
