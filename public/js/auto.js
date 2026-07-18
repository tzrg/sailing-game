// Autorennen: Top-Down im GTA2-Stil. Zwei Strecken (City-Rundkurs,
// Drift-Parcours), drei Autos, Driften über Bremsen in der Kurve.
// Rundenzeiten mit Bestzeit pro Strecke und Auto (localStorage).

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const norm = (a) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
const dirVec = (a) => ({ x: Math.sin(a), y: -Math.cos(a) });

function hash2(x, y, seed) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

// schneidet die Strecke p->q die Strecke a->b? (Checkpoint-Tore)
function cross2(ax, ay, bx, by) { return ax * by - ay * bx; }
function segCross(p, q, a, b) {
  const d1 = cross2(b.x - a.x, b.y - a.y, p.x - a.x, p.y - a.y);
  const d2 = cross2(b.x - a.x, b.y - a.y, q.x - a.x, q.y - a.y);
  const d3 = cross2(q.x - p.x, q.y - p.y, a.x - p.x, a.y - p.y);
  const d4 = cross2(q.x - p.x, q.y - p.y, b.x - p.x, b.y - p.y);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

// Tor eines Checkpoints: Linie quer zur Anfahrtsrichtung, über die Strecke
function cpGate(cps, idx, half) {
  const cur = cps[idx];
  const prev = cps[(idx - 1 + cps.length) % cps.length];
  let dx = cur.x - prev.x, dy = cur.y - prev.y;
  const l = Math.hypot(dx, dy) || 1;
  const px = -dy / l, py = dx / l; // Querrichtung
  return {
    a: { x: cur.x - px * half, y: cur.y - py * half },
    b: { x: cur.x + px * half, y: cur.y + py * half },
  };
}

// ---- Autos -----------------------------------------------------------------
const CARS = {
  sport: {
    key: 'sport', name: 'Sportwagen', style: 'car', color: '#e0342e', roof: '#b02420',
    accel: 15, brake: 26, revAccel: 6, drag: 0.4, dragQ: 0.016,
    grip: 9, driftGrip: 2.2, turn: 2.7, len: 4.4, wid: 1.9,
  },
  lambo: {
    key: 'lambo', name: 'Lamborghini', style: 'lambo', color: '#f5c518', roof: '#20242a',
    accel: 19, brake: 30, revAccel: 6, drag: 0.36, dragQ: 0.013,
    grip: 9.5, driftGrip: 1.9, turn: 2.8, len: 4.5, wid: 2.05, // sehr schnell, heckhappig
  },
  motorrad: {
    key: 'motorrad', name: 'Motorrad', style: 'bike', color: '#1f1f24', roof: '#e0342e',
    accel: 18, brake: 22, revAccel: 5, drag: 0.42, dragQ: 0.02,
    grip: 11, driftGrip: 3.4, turn: 3.7, len: 2.4, wid: 0.9, // flink, legt sich in Kurven
  },
  muscle: {
    key: 'muscle', name: 'Muscle-Car', style: 'car', color: '#5a3bb5', roof: '#41298a',
    accel: 13, brake: 20, revAccel: 5, drag: 0.35, dragQ: 0.016,
    grip: 6.2, driftGrip: 1.3, turn: 2.3, len: 5.0, wid: 2.0,
  },
  klein: {
    key: 'klein', name: 'Kleinwagen', style: 'car', color: '#2e9ac4', roof: '#1e7aa0',
    accel: 8, brake: 16, revAccel: 5, drag: 0.5, dragQ: 0.03,
    grip: 10.5, driftGrip: 2.8, turn: 3.3, len: 3.4, wid: 1.6,
  },
  krankenwagen: {
    key: 'krankenwagen', name: 'Krankenwagen', style: 'ambulance', color: '#f4f6f8', roof: '#d8dde2',
    accel: 10, brake: 19, revAccel: 5, drag: 0.42, dragQ: 0.02,
    grip: 7.5, driftGrip: 1.5, turn: 2.1, len: 5.6, wid: 2.25, siren: '#3a7bff',
  },
  feuerwehr: {
    key: 'feuerwehr', name: 'Feuerwehr', style: 'firetruck', color: '#c8261d', roof: '#8f1a14',
    accel: 8, brake: 16, revAccel: 4, drag: 0.4, dragQ: 0.02,
    grip: 6, driftGrip: 1.1, turn: 1.7, len: 7.2, wid: 2.5, siren: '#ff3020', // lang & träge
  },
};

// ---- Strecken --------------------------------------------------------------
// City: Straßenraster mit Häuserblocks; Rundkurs über Checkpoints.
const P = 80, SW = 16; // Rasterperiode, Straßenbreite
const CITY_MIN = -64, CITY_MAX = 240;

const TRACKS = {
  city: {
    key: 'city', name: 'City-Rundkurs',
    isWall(x, y) {
      if (x < CITY_MIN || x > CITY_MAX || y < CITY_MIN || y > CITY_MAX) return true;
      const mx = ((x % P) + P) % P, my = ((y % P) + P) % P;
      return mx >= SW && my >= SW; // Häuserblock
    },
    // Checkpoints entlang eines Rechtecks über die Straßenmitten
    cps: [
      { x: 88, y: 8 }, { x: 168, y: 8 }, { x: 168, y: 88 },
      { x: 168, y: 168 }, { x: 88, y: 168 }, { x: 8, y: 168 },
      { x: 8, y: 88 }, { x: 8, y: 8 },
    ],
    start: { x: 88, y: 8, heading: Math.PI / 2 },
    floor: '#3c4148',
  },
  drift: {
    key: 'drift', name: 'Drift-Parcours',
    isWall(x, y) {
      return x < 0 || x > 300 || y < 0 || y > 200;
    },
    cps: [
      { x: 60, y: 40 }, { x: 240, y: 40 }, { x: 265, y: 100 },
      { x: 240, y: 160 }, { x: 150, y: 110 }, { x: 60, y: 160 }, { x: 35, y: 100 },
    ],
    start: { x: 60, y: 40, heading: Math.PI / 2 },
    floor: '#46494e',
  },
};

// ---- Zustand ---------------------------------------------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let W = 0, H = 0;
let car = CARS.sport;
let track = TRACKS.city;

const st = {
  x: 0, y: 0, heading: 0, vx: 0, vy: 0,
  steer: 0, throttle: 0, drifting: false,
  nextCp: 1, lapStart: null, lapTime: 0, lastLap: null, best: null,
  driftScore: 0,
};

const skids = [];
const smoke = [];

function bestKey() {
  return `auto_${track.key}_${car.key}`;
}

function loadBest() {
  try {
    const v = parseFloat(localStorage.getItem(bestKey()));
    return Number.isFinite(v) ? v : null;
  } catch { return null; }
}

function resetRun() {
  st.x = track.start.x;
  st.y = track.start.y;
  st.heading = track.start.heading;
  st.vx = 0; st.vy = 0;
  st.steer = 0; st.throttle = 0;
  st.nextCp = 1;
  st.lapStart = null;
  st.lastLap = null;
  st.driftScore = 0;
  st.best = loadBest();
  skids.length = 0;
  smoke.length = 0;
}

// ---- Physik ----------------------------------------------------------------
function hitsWall(x, y) {
  const r = car.len * 0.35;
  for (let a = 0; a < TAU - 0.01; a += TAU / 6) {
    if (track.isWall(x + Math.cos(a) * r, y + Math.sin(a) * r)) return true;
  }
  return false;
}

function update(dt, time) {
  const prevPos = { x: st.x, y: st.y };
  const f = dirVec(st.heading);
  const lat = { x: -f.y, y: f.x };
  let vF = st.vx * f.x + st.vy * f.y;
  let vL = st.vx * lat.x + st.vy * lat.y;
  const speed = Math.hypot(st.vx, st.vy);

  // Driften: in der Kurve bremsen reißt das Heck los. Der Drift hält an,
  // solange das Heck seitlich rutscht und man nicht wieder Vollgas gibt.
  const wantDrift = st.throttle < -0.3 && Math.abs(st.steer) > 0.3 && speed > 6;
  st.drifting = wantDrift ||
    (st.drifting && Math.abs(vL) > 1.8 && speed > 4 && st.throttle < 0.4);

  // Antrieb / Bremse
  if (st.throttle > 0) {
    vF += st.throttle * car.accel * dt;
  } else if (st.throttle < 0) {
    if (st.drifting) {
      // blockierte Räder im Drift bremsen nur sanft -> Schwung bleibt
      vF -= Math.sign(vF) * car.brake * 0.14 * dt;
    } else if (vF > 0.5) {
      vF += st.throttle * car.brake * dt;                   // bremsen
    } else {
      vF += st.throttle * car.revAccel * dt;                // rückwärts
    }
  }
  vF -= (car.drag * vF + car.dragQ * vF * Math.abs(vF)) * dt * 2;

  const grip = st.drifting ? car.driftGrip : car.grip;
  vL *= Math.max(0, 1 - grip * dt);

  // Lenken
  const turnEff = clamp(Math.abs(vF) / 6, 0, 1) * (vF >= 0 ? 1 : -1);
  st.heading = norm(st.heading + st.steer * car.turn * turnEff * dt * (st.drifting ? 1.35 : 1));

  st.vx = f.x * vF + lat.x * vL;
  st.vy = f.y * vF + lat.y * vL;

  // Bewegung achsweise (arcade): blockierte Achse prallt leicht ab
  const nx = st.x + st.vx * dt;
  if (!hitsWall(nx, st.y)) st.x = nx;
  else { st.vx *= -0.25; st.vy *= 0.7; }
  const ny = st.y + st.vy * dt;
  if (!hitsWall(st.x, ny)) st.y = ny;
  else { st.vy *= -0.25; st.vx *= 0.7; }

  // Driftspuren + Qualm + Punkte
  if (st.drifting && Math.abs(vL) > 3) {
    st.driftScore += Math.abs(vL) * dt * 2;
    const back = { x: st.x - f.x * car.len * 0.35, y: st.y - f.y * car.len * 0.35 };
    for (const s of [-1, 1]) {
      skids.push({
        x: back.x + lat.x * s * car.wid * 0.4,
        y: back.y + lat.y * s * car.wid * 0.4,
        t: time,
      });
    }
    if (skids.length > 700) skids.splice(0, 2);
    smoke.push({ x: back.x, y: back.y, t: 0 });
  }
  for (let i = smoke.length - 1; i >= 0; i--) {
    smoke[i].t += dt;
    if (smoke[i].t > 0.8) smoke.splice(i, 1);
  }

  // Checkpoints / Runden: Tor quer über die Straße überfahren
  const gate = cpGate(track.cps, st.nextCp % track.cps.length, SW * 0.85);
  if (segCross(prevPos, st, gate.a, gate.b)) {
    st.nextCp++;
    if (st.nextCp % track.cps.length === 1 && st.nextCp > 1) {
      // Start-Ziel überfahren -> Runde komplett
      if (st.lapStart != null) {
        st.lastLap = performance.now() / 1000 - st.lapStart;
        if (st.best == null || st.lastLap < st.best) {
          st.best = st.lastLap;
          try { localStorage.setItem(bestKey(), String(st.best)); } catch { /* egal */ }
        }
      }
      st.lapStart = performance.now() / 1000;
    }
  }
  if (st.lapStart == null && speed > 2) st.lapStart = performance.now() / 1000;
  st.lapTime = st.lapStart != null ? performance.now() / 1000 - st.lapStart : 0;
}

// ---- Rendering -------------------------------------------------------------
let curS = 8.8; // sanft geglättete Zoomstufe
function draw(time) {
  const speed = Math.hypot(st.vx, st.vy);
  // je schneller, desto weiter raus (mehr Übersicht bei Tempo)
  const targetS = 8.8 - clamp(speed / 26, 0, 1) * 4.4; // 8.8 -> ~4.4
  curS += (targetS - curS) * 0.08;
  const S = curS;
  const toS = (wx, wy) => ({ x: (wx - st.x) * S + W / 2, y: (wy - st.y) * S + H / 2 });

  ctx.fillStyle = track.floor;
  ctx.fillRect(0, 0, W, H);

  const x0 = st.x - W / 2 / S, x1 = st.x + W / 2 / S;
  const y0 = st.y - H / 2 / S, y1 = st.y + H / 2 / S;

  if (track.key === 'city') {
    // Fahrbahnmarkierung als weltfeste Strich-Rechtecke auf einem festen
    // Weltraster (kein Bildschirm-Dash -> kriecht garantiert nicht mit).
    const DASH = 3, GAP = 4, PER = DASH + GAP; // Meter
    ctx.fillStyle = 'rgba(220,220,190,0.55)';
    const dw = Math.max(1, 0.4 * S);
    // vertikale Straßen: Striche laufen in Welt-Y
    for (let gx = Math.floor(x0 / P) * P; gx <= x1 + P; gx += P) {
      const cx = gx + SW / 2;
      const sx = (cx - st.x) * S + W / 2;
      if (sx < -5 || sx > W + 5) continue;
      for (let wy = Math.floor(y0 / PER) * PER; wy < y1 + PER; wy += PER) {
        const ya = (wy - st.y) * S + H / 2;
        ctx.fillRect(sx - dw / 2, ya, dw, DASH * S);
      }
    }
    // horizontale Straßen: Striche laufen in Welt-X
    for (let gy = Math.floor(y0 / P) * P; gy <= y1 + P; gy += P) {
      const cy = gy + SW / 2;
      const sy = (cy - st.y) * S + H / 2;
      if (sy < -5 || sy > H + 5) continue;
      for (let wx = Math.floor(x0 / PER) * PER; wx < x1 + PER; wx += PER) {
        const xa = (wx - st.x) * S + W / 2;
        ctx.fillRect(xa, sy - dw / 2, DASH * S, dw);
      }
    }
    for (let gx = Math.floor(x0 / P) * P; gx <= x1 + P; gx += P) {
      for (let gy = Math.floor(y0 / P) * P; gy <= y1 + P; gy += P) {
        const bx = gx + SW, by = gy + SW;
        if (bx + P - SW < CITY_MIN || bx > CITY_MAX || by > CITY_MAX) continue;
        const p = toS(bx, by);
        const wpx = (P - SW) * S;
        const h = hash2(Math.round(gx / P), Math.round(gy / P), 7);
        ctx.fillStyle = ['#5d6672', '#6b6157', '#57636a', '#6e6a5c'][Math.floor(h * 4)];
        ctx.fillRect(p.x, p.y, wpx, wpx);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 2;
        ctx.strokeRect(p.x, p.y, wpx, wpx);
        // Dachaufbau
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.fillRect(p.x + wpx * 0.2, p.y + wpx * 0.2, wpx * 0.6, wpx * 0.6);
      }
    }
    // Außenmauer andeuten
    ctx.strokeStyle = '#20242a';
    ctx.lineWidth = 4;
    const a = toS(CITY_MIN, CITY_MIN), b = toS(CITY_MAX, CITY_MAX);
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  } else {
    // Drift-Parcours: Boden mit Markierung, Begrenzungsmauern, Deko-Hütchen
    ctx.strokeStyle = '#20242a';
    ctx.lineWidth = 6;
    const a = toS(0, 0), b = toS(300, 200);
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    for (let i = 0; i < track.cps.length; i++) {
      const c1 = track.cps[i], c2 = track.cps[(i + 1) % track.cps.length];
      for (let t = 0.2; t < 0.9; t += 0.2) {
        const hx = c1.x + (c2.x - c1.x) * t, hy = c1.y + (c2.y - c1.y) * t;
        const pp = toS(hx + 9, hy + 4);
        ctx.fillStyle = '#e58f2a';
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, Math.max(2, 0.5 * S), 0, TAU);
        ctx.fill();
      }
    }
  }

  // Driftspuren
  ctx.fillStyle = 'rgba(20,20,20,0.5)';
  for (const sk of skids) {
    const age = time - sk.t;
    if (age > 8) continue;
    ctx.globalAlpha = 0.5 * (1 - age / 8);
    const p = toS(sk.x, sk.y);
    ctx.fillRect(p.x - 0.14 * S, p.y - 0.14 * S, 0.28 * S, 0.28 * S);
  }
  ctx.globalAlpha = 1;

  // Start-Ziel + Checkpoints
  const startP = toS(track.cps[0].x, track.cps[0].y);
  ctx.save();
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = i % 2 ? '#eee' : '#222';
    ctx.fillRect(startP.x - 1.5 * S + i * 0.5 * S, startP.y - 0.4 * S, 0.5 * S, 0.8 * S);
  }
  ctx.restore();
  for (let i = 0; i < track.cps.length; i++) {
    const c = track.cps[i];
    const p = toS(c.x, c.y);
    const isNext = i === st.nextCp % track.cps.length;
    // Tor-Linie quer über die Straße
    const gate = cpGate(track.cps, i, SW * 0.85);
    const ga = toS(gate.a.x, gate.a.y), gb = toS(gate.b.x, gate.b.y);
    ctx.strokeStyle = isNext ? 'rgba(255,210,90,0.95)' : 'rgba(255,255,255,0.22)';
    ctx.lineWidth = isNext ? 5 : 3;
    if (isNext) ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(ga.x, ga.y); ctx.lineTo(gb.x, gb.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // Nummer am Tor
    ctx.fillStyle = isNext ? '#ffd25a' : 'rgba(255,255,255,0.6)';
    ctx.font = `bold ${Math.max(12, 1.7 * S)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i === 0 ? '🏁' : i), p.x, p.y);
  }
  // Pfeil zum nächsten Checkpoint
  const nc = track.cps[st.nextCp % track.cps.length];
  const np = toS(nc.x, nc.y);
  const margin = 60;
  if (np.x < margin || np.x > W - margin || np.y < margin || np.y > H - margin) {
    const dx = np.x - W / 2, dy = np.y - H / 2;
    const kk = Math.min((W / 2 - 46) / Math.abs(dx || 1), (H / 2 - 46) / Math.abs(dy || 1));
    const ax = W / 2 + dx * kk, ay = H / 2 + dy * kk;
    const ang = Math.atan2(dy, dx);
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(ang);
    ctx.fillStyle = 'rgba(255,210,90,0.95)';
    ctx.beginPath();
    ctx.moveTo(14, 0); ctx.lineTo(-6, -9); ctx.lineTo(-6, 9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Qualm
  for (const sm of smoke) {
    ctx.globalAlpha = 0.25 * (1 - sm.t / 0.8);
    ctx.fillStyle = '#ddd';
    const p = toS(sm.x, sm.y);
    ctx.beginPath();
    ctx.arc(p.x, p.y, (0.5 + sm.t * 2.4) * S, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Fahrzeug
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(S, S);
  ctx.rotate(st.heading);
  drawVehicle(time);
  ctx.restore();

  drawHUD();
}

// zeichnet das aktuelle Fahrzeug (im gedrehten, skalierten Kontext,
// Fahrtrichtung = -y). Verzweigt nach car.style.
function drawVehicle(time) {
  const L = car.len, Wd = car.wid;
  const body = () => {
    ctx.beginPath();
    ctx.moveTo(0, -L / 2);
    ctx.quadraticCurveTo(Wd / 2, -L / 2 + 0.3, Wd / 2, -L * 0.2);
    ctx.lineTo(Wd / 2, L * 0.38);
    ctx.quadraticCurveTo(Wd / 2, L / 2, 0, L / 2);
    ctx.quadraticCurveTo(-Wd / 2, L / 2, -Wd / 2, L * 0.38);
    ctx.lineTo(-Wd / 2, -L * 0.2);
    ctx.quadraticCurveTo(-Wd / 2, -L / 2 + 0.3, 0, -L / 2);
    ctx.closePath();
  };
  const wheels = () => {
    ctx.fillStyle = '#111';
    for (const [wx, wy] of [[-Wd / 2, -L * 0.32], [Wd / 2, -L * 0.32], [-Wd / 2, L * 0.32], [Wd / 2, L * 0.32]]) {
      ctx.save();
      ctx.translate(wx, wy);
      if (wy < 0) ctx.rotate(st.steer * 0.4);
      ctx.fillRect(-0.14, -0.4, 0.28, 0.8);
      ctx.restore();
    }
  };
  // Blaulicht/Rotlicht der Einsatzfahrzeuge (blinkend)
  const siren = (yFront) => {
    const on = Math.floor(time * 6) % 2 === 0;
    for (const [sx, col] of [[-Wd * 0.28, on ? car.siren : '#333'], [Wd * 0.28, on ? '#333' : car.siren]]) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(sx, yFront, 0.22, 0, TAU);
      ctx.fill();
    }
    if (on || Math.floor(time * 6) % 2 === 1) {
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = car.siren;
      ctx.beginPath();
      ctx.arc(0, yFront, 1.4, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  };

  if (car.style === 'bike') {
    // Motorrad: legt sich in die Kurve (Roll über steer)
    const lean = st.steer * 0.5;
    ctx.save();
    ctx.transform(1, 0, lean * 0.35, 1, 0, 0); // leichtes Kippen zur Seite
    // Schatten
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(0, 0, Wd * 0.7, L * 0.5, 0, 0, TAU); ctx.fill();
    // Reifen
    ctx.fillStyle = '#111';
    ctx.fillRect(-0.12, -L * 0.5, 0.24, 0.7);
    ctx.fillRect(-0.12, L * 0.5 - 0.7, 0.24, 0.7);
    // Rahmen/Tank
    ctx.fillStyle = car.roof;
    ctx.beginPath();
    ctx.moveTo(0, -L * 0.42);
    ctx.quadraticCurveTo(Wd * 0.5, -L * 0.1, Wd * 0.32, L * 0.28);
    ctx.lineTo(-Wd * 0.32, L * 0.28);
    ctx.quadraticCurveTo(-Wd * 0.5, -L * 0.1, 0, -L * 0.42);
    ctx.closePath();
    ctx.fill();
    // Lenker
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 0.12;
    ctx.beginPath(); ctx.moveTo(-Wd * 0.55, -L * 0.28); ctx.lineTo(Wd * 0.55, -L * 0.28); ctx.stroke();
    // Fahrer
    ctx.fillStyle = car.color;
    ctx.beginPath(); ctx.ellipse(0, -0.1, Wd * 0.28, L * 0.22, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e8e8e8';
    ctx.beginPath(); ctx.arc(0, -L * 0.15, 0.26, 0, TAU); ctx.fill(); // Helm
    ctx.restore();
    return;
  }

  if (car.style === 'lambo') {
    // flacher, keilförmiger Supersportwagen
    wheels();
    ctx.beginPath();
    ctx.moveTo(0, -L / 2);                          // spitze Nase
    ctx.lineTo(Wd / 2, -L * 0.1);
    ctx.lineTo(Wd * 0.46, L * 0.42);
    ctx.lineTo(Wd * 0.34, L / 2);
    ctx.lineTo(-Wd * 0.34, L / 2);
    ctx.lineTo(-Wd * 0.46, L * 0.42);
    ctx.lineTo(-Wd / 2, -L * 0.1);
    ctx.closePath();
    ctx.fillStyle = car.color;
    ctx.fill();
    ctx.lineWidth = 0.08; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke();
    // Cockpit
    ctx.fillStyle = car.roof;
    ctx.beginPath();
    ctx.moveTo(0, -L * 0.02);
    ctx.lineTo(Wd * 0.32, L * 0.14);
    ctx.lineTo(Wd * 0.26, L * 0.36);
    ctx.lineTo(-Wd * 0.26, L * 0.36);
    ctx.lineTo(-Wd * 0.32, L * 0.14);
    ctx.closePath();
    ctx.fill();
    // Heckflügel
    ctx.fillStyle = '#20242a';
    ctx.fillRect(-Wd * 0.42, L * 0.44, Wd * 0.84, 0.18);
    return;
  }

  if (car.style === 'ambulance' || car.style === 'firetruck') {
    // Kastenaufbau (Van / LKW)
    wheels();
    ctx.beginPath();
    ctx.moveTo(-Wd / 2, -L / 2 + 0.4);
    ctx.quadraticCurveTo(-Wd / 2, -L / 2, 0, -L / 2);
    ctx.quadraticCurveTo(Wd / 2, -L / 2, Wd / 2, -L / 2 + 0.4);
    ctx.lineTo(Wd / 2, L / 2);
    ctx.lineTo(-Wd / 2, L / 2);
    ctx.closePath();
    ctx.fillStyle = car.color;
    ctx.fill();
    ctx.lineWidth = 0.08; ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.stroke();
    // Fahrerkabine
    ctx.fillStyle = '#26333f';
    ctx.fillRect(-Wd * 0.4, -L * 0.42, Wd * 0.8, L * 0.16);
    if (car.style === 'ambulance') {
      // rotes Kreuz auf dem Dach
      ctx.fillStyle = '#d9291c';
      ctx.fillRect(-0.12, -L * 0.06, 0.24, L * 0.28);
      ctx.fillRect(-Wd * 0.22, L * 0.02, Wd * 0.44, 0.24);
      // Streifen
      ctx.fillStyle = '#e5b100';
      ctx.fillRect(-Wd / 2, L * 0.3, Wd, 0.18);
    } else {
      // Feuerwehr: Leiter + weiße Streifen
      ctx.strokeStyle = '#d8d8d8';
      ctx.lineWidth = 0.12;
      for (let i = 0; i < 6; i++) {
        const yy = -L * 0.2 + i * L * 0.08;
        ctx.beginPath(); ctx.moveTo(-Wd * 0.22, yy); ctx.lineTo(Wd * 0.22, yy); ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(-Wd * 0.22, -L * 0.2); ctx.lineTo(-Wd * 0.22, L * 0.28); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(Wd * 0.22, -L * 0.2); ctx.lineTo(Wd * 0.22, L * 0.28); ctx.stroke();
      ctx.fillStyle = '#f2f2f2';
      ctx.fillRect(-Wd / 2, L * 0.34, Wd, 0.2);
    }
    siren(-L * 0.34);
    return;
  }

  // Standard-Auto
  wheels();
  body();
  ctx.fillStyle = car.color;
  ctx.fill();
  ctx.lineWidth = 0.08;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.stroke();
  ctx.fillStyle = '#1d2733';
  ctx.fillRect(-Wd * 0.36, -L * 0.16, Wd * 0.72, L * 0.14);
  ctx.fillStyle = car.roof;
  ctx.fillRect(-Wd * 0.38, -L * 0.02, Wd * 0.76, L * 0.34);
}

function fmt(t) {
  if (t == null) return '–';
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`;
}

function drawHUD() {
  // Tempo oben links (unter dem Menü-Knopf)
  ctx.fillStyle = 'rgba(8,25,42,0.55)';
  roundRect(14, 64, 132, 52, 10);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 24px system-ui, sans-serif';
  ctx.fillText(Math.round(Math.hypot(st.vx, st.vy) * 3.6) + ' km/h', 26, 96);
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = st.drifting ? '#ffb050' : 'rgba(255,255,255,0.7)';
  ctx.fillText(st.drifting ? 'DRIFT!' : car.name, 26, 110);

  // Zeiten oben Mitte
  ctx.fillStyle = 'rgba(8,25,42,0.6)';
  roundRect(W / 2 - 140, 10, 280, 52, 10);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 20px system-ui, sans-serif';
  ctx.fillText(fmt(st.lapTime), W / 2, 32);
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(`Letzte: ${fmt(st.lastLap)}   ·   Best: ${fmt(st.best)}`, W / 2, 52);

  // Driftpunkte oben rechts
  ctx.fillStyle = 'rgba(8,25,42,0.55)';
  roundRect(W - 146, 64, 132, 52, 10);
  ctx.fill();
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffb050';
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.fillText(String(Math.round(st.driftScore)), W - 132, 96);
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText('Drift-Punkte', W - 132, 110);

  drawControls();
}

// Sichtbare Bedien-Elemente: Lenkung (unten links), Gas/Bremse (unten rechts).
// Die ganze linke bzw. rechte Bildschirmhälfte ist berührbar - die Regler
// zeigen nur, was gerade anliegt.
function drawControls() {
  // Lenk-Bar unten links (horizontal)
  const sb = { x: 20, y: H - 120, w: 190, h: 40 };
  ctx.fillStyle = 'rgba(8,25,42,0.5)';
  roundRect(sb.x - 6, sb.y - 20, sb.w + 12, sb.h + 30, 10);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('◀  Lenken  ▶', sb.x + sb.w / 2, sb.y - 6);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(sb.x + 10, sb.y + sb.h / 2);
  ctx.lineTo(sb.x + sb.w - 10, sb.y + sb.h / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(sb.x + sb.w / 2, sb.y + 6);
  ctx.lineTo(sb.x + sb.w / 2, sb.y + sb.h - 6);
  ctx.stroke();
  ctx.fillStyle = '#ffd166';
  ctx.beginPath();
  ctx.arc(sb.x + sb.w / 2 + st.steer * (sb.w / 2 - 14), sb.y + sb.h / 2, 12, 0, TAU);
  ctx.fill();

  // Gas/Bremse-Bar unten rechts (vertikal)
  const tb = { x: W - 66, y: H - 210, w: 40, h: 150 };
  ctx.fillStyle = 'rgba(8,25,42,0.5)';
  roundRect(tb.x - 8, tb.y - 20, tb.w + 16, tb.h + 42, 10);
  ctx.fill();
  ctx.fillStyle = 'rgba(120,220,140,0.85)';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Gas', tb.x + tb.w / 2, tb.y - 6);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(tb.x, tb.y, tb.w, tb.h);
  // Mittellinie (neutral)
  ctx.beginPath();
  ctx.moveTo(tb.x, tb.y + tb.h / 2);
  ctx.lineTo(tb.x + tb.w, tb.y + tb.h / 2);
  ctx.stroke();
  // Füllung: grün nach oben (Gas), rot nach unten (Bremse)
  const cy = tb.y + tb.h / 2;
  const fill = st.throttle * (tb.h / 2 - 4);
  ctx.fillStyle = st.throttle >= 0 ? 'rgba(90,210,120,0.7)' : 'rgba(230,90,70,0.7)';
  ctx.fillRect(tb.x + 4, cy - Math.max(0, fill), tb.w - 8, Math.abs(fill));
  ctx.fillStyle = '#fff';
  ctx.fillRect(tb.x - 3, cy - fill - 2, tb.w + 6, 4);
  ctx.fillStyle = 'rgba(230,120,110,0.9)';
  ctx.fillText('Bremse', tb.x + tb.w / 2, tb.y + tb.h + 16);
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---- Eingabe ---------------------------------------------------------------
// Linke Hälfte: horizontal ziehen = lenken. Rechte Hälfte: vertikal ziehen =
// Gas (hoch) / Bremse (runter). Loslassen = neutral. Pfeiltasten am Desktop.
const pointers = new Map();
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  hideHelp();
  const role = e.clientX < W / 2 ? 'steer' : 'throttle';
  pointers.set(e.pointerId, { role, sx: e.clientX, sy: e.clientY });
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  if (p.role === 'steer') st.steer = clamp((e.clientX - p.sx) / 80, -1, 1);
  else st.throttle = clamp((p.sy - e.clientY) / 80, -1, 1);
});
function endPointer(e) {
  const p = pointers.get(e.pointerId);
  if (p) {
    if (p.role === 'steer') st.steer = 0;
    else st.throttle = 0;
  }
  pointers.delete(e.pointerId);
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.key.startsWith('Arrow')) { e.preventDefault(); keys.add(e.key); hideHelp(); }
});
window.addEventListener('keyup', (e) => keys.delete(e.key));
function applyKeys() {
  if (pointers.size > 0) return;
  st.steer = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0);
  st.throttle = (keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0);
}

// ---- UI --------------------------------------------------------------------
const menuEl = document.getElementById('menu');
const helpEl = document.getElementById('help');
function hideHelp() { helpEl.classList.add('hidden'); }
document.getElementById('btn-menu').addEventListener('click', () => menuEl.classList.remove('hidden'));
document.getElementById('btn-menu-close').addEventListener('click', () => menuEl.classList.add('hidden'));
menuEl.addEventListener('click', (e) => { if (e.target === menuEl) menuEl.classList.add('hidden'); });
document.getElementById('btn-start').addEventListener('click', hideHelp);
document.getElementById('btn-help').addEventListener('click', () => {
  menuEl.classList.add('hidden');
  helpEl.classList.remove('hidden');
});

const selCar = document.getElementById('sel-car');
for (const c of Object.values(CARS)) {
  const o = document.createElement('option');
  o.value = c.key; o.textContent = c.name;
  selCar.appendChild(o);
}
selCar.addEventListener('change', () => {
  car = CARS[selCar.value];
  resetRun();
});
const modeCity = document.getElementById('mode-city');
const modeDrift = document.getElementById('mode-drift');
function setTrack(key) {
  track = TRACKS[key];
  modeCity.classList.toggle('active', key === 'city');
  modeDrift.classList.toggle('active', key === 'drift');
  resetRun();
}
modeCity.addEventListener('click', () => setTrack('city'));
modeDrift.addEventListener('click', () => setTrack('drift'));
document.getElementById('btn-reset').addEventListener('click', () => {
  resetRun();
  menuEl.classList.add('hidden');
});

// ---- Schleife --------------------------------------------------------------
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();
resetRun();

window.__auto = { st, get car() { return car; }, get track() { return track; }, get zoom() { return curS; }, CARS, TRACKS, resetRun };

let last = performance.now();
let time = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;
  applyKeys();
  update(dt, time);
  draw(time);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
