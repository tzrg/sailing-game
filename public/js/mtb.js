// Mountainbike: Top-Down-Parcours mit Rampen. Über Rampen springen, in der
// Luft Saltos (vor/zurück lehnen) und Spins (links/rechts) - sauber landen
// oder crashen. Zwei Parcours (Wald, Jumphalle), drei Räder, Trickscore und
// Bestzeit. Optionaler "Annoying-Mode": Gas durch schnelles Wackeln.

const TAU = Math.PI * 2;
const GRAV = 15; // niedrige Schwerkraft = mehr Airtime für Tricks
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const norm = (a) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
const dirVec = (a) => ({ x: Math.sin(a), y: -Math.cos(a) });

// ---- Räder -----------------------------------------------------------------
const BIKES = {
  fully: {
    key: 'fully', name: 'Fully-MTB', color: '#39a845', accent: '#1e6b28',
    accel: 11, brake: 16, maxSpeed: 20, turn: 2.4, size: 1.2,
    launch: 1.05, rotAir: 4.6, landTol: 0.62, wheel: 0.42,
  },
  bmx: {
    key: 'bmx', name: 'BMX', color: '#e0a020', accent: '#a06e10',
    accel: 9, brake: 14, maxSpeed: 16, turn: 3.0, size: 1.0,
    launch: 1.25, rotAir: 6.0, landTol: 0.85, wheel: 0.36, // dreht leicht, gutmütig
  },
  kinder: {
    key: 'kinder', name: 'Kinderrad', color: '#e5487f', accent: '#a82c58',
    accel: 6, brake: 12, maxSpeed: 10, turn: 3.4, size: 0.78,
    launch: 0.6, rotAir: 3.2, landTol: 0.42, wheel: 0.3, // springt kaum, crasht leicht
  },
};

// ---- Parcours --------------------------------------------------------------
// Ein Parcours ist eine geschlossene Mittellinie (Wegpunkte) mit Breite;
// dazu Rampen und Deko. Off-track bremst (Wald) bzw. ist Wand (Halle).
function makePath(pts) {
  // Checkpoints = jeder n-te Wegpunkt
  return pts;
}

const TRACKS = {
  wald: {
    key: 'wald', name: 'Waldstrecke', width: 9, offGrip: 0.55, bg: '#2f5a34',
    trees: true, walls: false,
    path: makePath([
      { x: 40, y: 40 }, { x: 150, y: 30 }, { x: 250, y: 55 }, { x: 300, y: 140 },
      { x: 260, y: 230 }, { x: 160, y: 250 }, { x: 70, y: 220 }, { x: 30, y: 130 },
    ]),
    ramps: [
      { x: 200, y: 40, dir: 0.5, big: 1.0 },
      { x: 285, y: 190, dir: 2.4, big: 1.3 },
      { x: 110, y: 240, dir: 3.3, big: 1.0 },
      { x: 30, y: 90, dir: 5.6, big: 0.9 },
    ],
    floor: '#6a5236',
  },
  halle: {
    key: 'halle', name: 'Jumphalle', width: 11, offGrip: 1.0, bg: '#2b2f38',
    trees: false, walls: true,
    path: makePath([
      { x: 50, y: 50 }, { x: 250, y: 50 }, { x: 250, y: 150 }, { x: 50, y: 150 },
    ]),
    ramps: [
      { x: 120, y: 50, dir: 1.571, big: 1.4 },
      { x: 190, y: 50, dir: 1.571, big: 1.7 },
      { x: 250, y: 100, dir: 3.14, big: 1.3 },
      { x: 150, y: 150, dir: 4.712, big: 1.6 },
      { x: 50, y: 100, dir: 0, big: 1.3 },
    ],
    bounds: { x0: 10, y0: 10, x1: 290, y1: 190 },
    floor: '#3a3f4a',
  },
};

// nächster Punkt auf der Mittellinie -> Abstand (für on/off track)
function distToPath(track, x, y) {
  let best = 1e9;
  const p = track.path;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    let t = ((x - a.x) * dx + (y - a.y) * dy) / l2;
    t = clamp(t, 0, 1);
    const px = a.x + dx * t, py = a.y + dy * t;
    best = Math.min(best, Math.hypot(x - px, y - py));
  }
  return best;
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

// Tor eines Checkpoints: Linie quer zur Streckenrichtung, über die Bahnbreite
function cpGate(track, idx, half) {
  const p = track.path;
  const cur = p[idx % p.length];
  const prev = p[(idx - 1 + p.length) % p.length];
  let dx = cur.x - prev.x, dy = cur.y - prev.y;
  const l = Math.hypot(dx, dy) || 1;
  const px = -dy / l, py = dx / l;
  return {
    a: { x: cur.x - px * half, y: cur.y - py * half },
    b: { x: cur.x + px * half, y: cur.y + py * half },
  };
}

// Fahrtrichtung (Heading) des nächsten Streckensegments an (x,y)
function pathDirAt(track, x, y) {
  let best = 1e9, dir = 0;
  const p = track.path;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / l2, 0, 1);
    const px = a.x + dx * t, py = a.y + dy * t;
    const d = Math.hypot(x - px, y - py);
    if (d < best) { best = d; dir = Math.atan2(dx, -dy); }
  }
  return dir;
}

// Rampen an die Streckenrichtung ausrichten (in Fahrtrichtung)
function orientRamps(track) {
  for (const r of track.ramps) r.dir = pathDirAt(track, r.x, r.y);
}

// deterministische Bäume neben der Strecke
function treeAt(track, gx, gy) {
  let h = Math.imul(gx, 0x27d4eb2d) ^ Math.imul(gy, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  const r = (h >>> 0) / 4294967296;
  if (r > 0.5) return null;
  const x = gx * 22 + (r * 400 % 16), y = gy * 22 + ((r * 977) % 1) * 16;
  if (distToPath(track, x, y) < track.width + 3) return null;
  return { x, y, r: 2.4 + r * 1.8 };
}

// ---- Zustand ---------------------------------------------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let W = 0, H = 0;
let bike = BIKES.fully;
let track = TRACKS.wald;
let annoying = false;

const st = {
  x: 0, y: 0, heading: 0, speed: 0,
  z: 0, vz: 0, airborne: false,
  pitch: 0, spin: 0, launchDir: 0, launchVel: { x: 0, y: 0 },
  steer: 0, lean: 0, throttle: 0,
  crashT: 0,
  nextCp: 1, lapStart: null, lapTime: 0, lastLap: null, best: null,
  score: 0, bestScore: null, combo: '', comboT: 0, lastRampT: -99,
};

const trail = [];
const wiggle = { last: 0, dir: 0, boost: 0 };

function cpKey(i) { return track.path[i % track.path.length]; }
function bestKey() { return `mtb_${track.key}_${bike.key}`; }
function bestScoreKey() { return `mtbscore_${track.key}_${bike.key}`; }
function loadNum(k) {
  try { const v = parseFloat(localStorage.getItem(k)); return Number.isFinite(v) ? v : null; }
  catch { return null; }
}

function resetRun() {
  orientRamps(track);
  const p0 = track.path[0], p1 = track.path[1];
  st.x = p0.x; st.y = p0.y;
  st.heading = Math.atan2(p1.x - p0.x, -(p1.y - p0.y));
  st.speed = 0; st.z = 0; st.vz = 0; st.airborne = false;
  st.pitch = 0; st.spin = 0;
  st.crashT = 0;
  st.nextCp = 1; st.lapStart = null; st.lastLap = null;
  st.score = 0; st.combo = ''; st.comboT = 0;
  st.best = loadNum(bestKey());
  st.bestScore = loadNum(bestScoreKey());
  trail.length = 0;
}

function respawnCheckpoint() {
  const cp = cpKey((st.nextCp - 1 + track.path.length) % track.path.length);
  const nx = cpKey(st.nextCp);
  st.x = cp.x; st.y = cp.y;
  st.heading = Math.atan2(nx.x - cp.x, -(nx.y - cp.y));
  st.speed = 0; st.z = 0; st.vz = 0; st.airborne = false;
  st.pitch = 0; st.spin = 0;
  st.combo = 'CRASH!'; st.comboT = 1.6;
}

// ---- Physik ----------------------------------------------------------------
function nearRamp() {
  for (const r of track.ramps) {
    if (Math.hypot(st.x - r.x, st.y - r.y) < 7) {
      // nur auslösen, wenn man ungefähr in Rampenrichtung fährt
      if (Math.abs(norm(st.heading - r.dir)) < 1.1) return r;
    }
  }
  return null;
}

function checkGates(prevPos) {
  const gate = cpGate(track, st.nextCp, track.width * 1.15);
  if (segCross(prevPos, st, gate.a, gate.b)) {
    st.nextCp++;
    if (st.nextCp % track.path.length === 1 && st.nextCp > 1) {
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
  if (st.lapStart == null && Math.abs(st.speed) > 1) st.lapStart = performance.now() / 1000;
  st.lapTime = st.lapStart != null ? performance.now() / 1000 - st.lapStart : 0;
}

function update(dt, time) {
  const prevPos = { x: st.x, y: st.y };
  if (st.crashT > 0) {
    st.crashT -= dt;
    if (st.crashT <= 0) respawnCheckpoint();
    st.speed *= Math.max(0, 1 - dt * 4);
    return;
  }

  // Gas: normal über throttle, im Annoying-Mode über Wackel-Boost
  let thr = st.throttle;
  if (annoying) {
    wiggle.boost = Math.max(0, wiggle.boost - dt * 0.9);
    thr = clamp(wiggle.boost, 0, 1);
  }

  if (st.airborne) {
    // in der Luft: lehnen = Salto (pitch), steuern = Spin
    st.pitch += st.lean * bike.rotAir * dt;
    st.spin += st.steer * bike.rotAir * dt;
    // Flugbahn: Momentum aus dem Absprung
    st.x += st.launchVel.x * dt;
    st.y += st.launchVel.y * dt;
    st.z += st.vz * dt;
    st.vz -= GRAV * dt;
    if (st.z <= 0) {
      st.z = 0;
      landing(time);
    }
    trail.push({ x: st.x, y: st.y, t: time });
    if (trail.length > 60) trail.shift();
    checkGates(prevPos); // durch ein Tor fliegen zählt auch
    return;
  }

  // am Boden
  if (thr > 0) st.speed += thr * bike.accel * dt;
  else if (thr < 0) st.speed += thr * bike.brake * dt;
  // Rollwiderstand + Gelände
  const onTrack = distToPath(track, st.x, st.y) < track.width;
  const off = onTrack ? 1 : track.offGrip;
  st.speed -= (2.2 + (1 - off) * 8) * dt * Math.sign(st.speed) * (Math.abs(st.speed) > 0.1 ? 1 : 0);
  st.speed = clamp(st.speed, -4, bike.maxSpeed * off);

  // Lenken (dreht das Rad in der Kurve)
  const turnEff = clamp(Math.abs(st.speed) / 4, 0, 1);
  st.heading = norm(st.heading + st.steer * bike.turn * turnEff * dt);

  const f = dirVec(st.heading);
  const nx = st.x + f.x * st.speed * dt;
  const ny = st.y + f.y * st.speed * dt;

  // Halle: Wände
  if (track.walls) {
    const b = track.bounds;
    if (nx < b.x0 || nx > b.x1 || ny < b.y0 || ny > b.y1) {
      st.speed *= 0.3;
      st.crashT = 0.9;
      return;
    }
  }
  // Wald: Baumkollision
  if (track.trees) {
    const gx = Math.round(nx / 22), gy = Math.round(ny / 22);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const tr = treeAt(track, gx + i, gy + j);
      if (tr && Math.hypot(nx - tr.x, ny - tr.y) < tr.r + 0.8) {
        st.speed *= 0.2;
        st.crashT = 0.9;
        return;
      }
    }
  }
  st.x = nx; st.y = ny;

  // Rampe getroffen?
  const r = nearRamp();
  if (r && st.speed > 5) {
    st.airborne = true;
    st.vz = st.speed * bike.launch * r.big * 0.9;
    st.launchDir = st.heading;
    const f2 = dirVec(st.heading);
    st.launchVel = { x: f2.x * st.speed, y: f2.y * st.speed };
    st.pitch = 0; st.spin = 0;
    st.lastRampT = time;
  }

  checkGates(prevPos);
}

function landing(time) {
  st.airborne = false;
  const pitchErr = Math.abs(norm(st.pitch));
  const spinErr = Math.abs(norm(st.spin));
  const tol = bike.landTol;
  const flips = Math.round(st.pitch / TAU);
  const spins = Math.round(st.spin / TAU);
  if (pitchErr < tol && spinErr < tol) {
    // saubere Landung
    st.heading = norm(st.launchDir + spins * TAU);
    st.speed = Math.hypot(st.launchVel.x, st.launchVel.y);
    let pts = (Math.abs(flips) * 120 + Math.abs(spins) * 100);
    const clean = 1 + Math.max(0, (tol - Math.max(pitchErr, spinErr)) / tol);
    pts = Math.round(pts * clean);
    if (pts > 0) {
      st.score += pts;
      st.combo = `${flips ? Math.abs(flips) + '× Salto ' : ''}${spins ? Math.abs(spins) + '× Spin ' : ''}+${pts}`;
      st.comboT = 1.8;
      if (st.bestScore == null || st.score > st.bestScore) {
        st.bestScore = st.score;
        try { localStorage.setItem(bestScoreKey(), String(st.bestScore)); } catch { /* egal */ }
      }
    } else {
      st.combo = 'sauber!'; st.comboT = 0.9;
    }
    st.pitch = 0; st.spin = 0;
  } else {
    // verpatzt -> Crash
    st.crashT = 1.2;
  }
}

// ---- Rendering -------------------------------------------------------------
function draw(time) {
  const S = 8.5 - clamp(Math.abs(st.speed) / 40, 0, 1) * 1.5; // bei Tempo weiter raus
  const toS = (wx, wy) => ({ x: (wx - st.x) * S + W / 2, y: (wy - st.y) * S + H / 2 });

  ctx.fillStyle = track.bg;
  ctx.fillRect(0, 0, W, H);

  // Strecke (Mittellinie als breites Band)
  ctx.strokeStyle = track.floor;
  ctx.lineWidth = track.width * 2 * S;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const p = track.path;
  for (let i = 0; i <= p.length; i++) {
    const q = toS(p[i % p.length].x, p[i % p.length].y);
    if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
  }
  ctx.stroke();
  // Mittelstrich
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = Math.max(1, 0.3 * S);
  ctx.setLineDash([2.5 * S, 3 * S]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Halle: Wände
  if (track.walls) {
    const b = track.bounds;
    const a1 = toS(b.x0, b.y0), a2 = toS(b.x1, b.y1);
    ctx.strokeStyle = '#161a20';
    ctx.lineWidth = 6;
    ctx.strokeRect(a1.x, a1.y, a2.x - a1.x, a2.y - a1.y);
  }

  // Bäume rund um die Kamera
  if (track.trees) {
    const gx0 = Math.floor((st.x - W / 2 / S) / 22) - 1, gx1 = Math.ceil((st.x + W / 2 / S) / 22) + 1;
    const gy0 = Math.floor((st.y - H / 2 / S) / 22) - 1, gy1 = Math.ceil((st.y + H / 2 / S) / 22) + 1;
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
      const tr = treeAt(track, gx, gy);
      if (!tr) continue;
      const q = toS(tr.x, tr.y);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.arc(q.x + 3, q.y + 4, tr.r * S, 0, TAU); ctx.fill();
      ctx.fillStyle = '#2c6b34';
      ctx.beginPath(); ctx.arc(q.x, q.y, tr.r * S, 0, TAU); ctx.fill();
      ctx.fillStyle = '#3d8f45';
      ctx.beginPath(); ctx.arc(q.x - tr.r * 0.3 * S, q.y - tr.r * 0.3 * S, tr.r * 0.6 * S, 0, TAU); ctx.fill();
    }
  }

  // Rampen (Keil mit hellem Kamm)
  for (const r of track.ramps) {
    const q = toS(r.x, r.y);
    const d = dirVec(r.dir);
    ctx.save();
    ctx.translate(q.x, q.y);
    ctx.rotate(Math.atan2(d.y, d.x) + Math.PI / 2);
    const rw = 6 * S, rl = 6 * S * r.big;
    const grad = ctx.createLinearGradient(0, rl / 2, 0, -rl / 2);
    grad.addColorStop(0, '#6b5a3a');
    grad.addColorStop(1, '#b89a5e');
    ctx.fillStyle = grad;
    ctx.fillRect(-rw / 2, -rl / 2, rw, rl);
    ctx.strokeStyle = '#d8c082';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-rw / 2, -rl / 2); ctx.lineTo(rw / 2, -rl / 2); ctx.stroke();
    // Streifen
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    for (let s = -2; s <= 2; s++) ctx.fillRect(-rw / 2, s * rl / 6, rw, rl / 24);
    ctx.restore();
  }

  // Checkpoints als Tore quer über die Bahn
  for (let i = 0; i < track.path.length; i++) {
    const c = track.path[i];
    const q = toS(c.x, c.y);
    const isNext = i === st.nextCp % track.path.length;
    const gate = cpGate(track, i, track.width * 1.15);
    const ga = toS(gate.a.x, gate.a.y), gb = toS(gate.b.x, gate.b.y);
    ctx.strokeStyle = isNext ? 'rgba(255,210,90,0.95)' : 'rgba(255,255,255,0.22)';
    ctx.lineWidth = isNext ? 5 : 3;
    if (isNext) ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(ga.x, ga.y); ctx.lineTo(gb.x, gb.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = isNext ? '#ffd25a' : 'rgba(255,255,255,0.5)';
    ctx.font = `bold ${1.6 * S}px system-ui`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(i === 0 ? '🏁' : String(i), q.x, q.y);
  }

  // Flugschatten-Trail
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  for (const tp of trail) {
    const q = toS(tp.x, tp.y);
    ctx.beginPath(); ctx.arc(q.x, q.y, 1.4 * S, 0, TAU); ctx.fill();
  }

  drawBike(time, S);
  drawHUD(time);
}

function drawBike(time, S) {
  // Schatten am Boden (wandert beim Sprung leicht weg, wird kleiner)
  const shOff = st.z * 1.4;
  const shScale = 1 / (1 + st.z * 0.12);
  ctx.save();
  ctx.translate(W / 2 + shOff * S * 0.2, H / 2 + shOff * S * 0.5);
  ctx.fillStyle = `rgba(0,0,0,${0.28 * shScale})`;
  ctx.beginPath();
  ctx.ellipse(0, 0, 1.4 * S * shScale, 0.7 * S * shScale, 0, 0, TAU);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(W / 2, H / 2 - st.z * S * 1.1); // Höhe = nach oben
  const lift = 1 + st.z * 0.06;
  ctx.scale(S * bike.size * lift, S * bike.size * lift);
  // Spin dreht die ganze Ansicht; am Boden zeigt heading
  ctx.rotate(st.airborne ? st.launchDir + st.spin : st.heading);
  // Salto: Rad staucht sich in Fahrtrichtung (cos), Farbe kippt bei Kopfüber
  const pc = Math.cos(st.pitch);
  const upsideDown = pc < 0;
  ctx.scale(1, Math.max(0.12, Math.abs(pc)));

  if (st.crashT > 0 && !st.airborne) {
    // Crash: durcheinander
    ctx.rotate(Math.sin(time * 40) * 0.5);
  }

  // Rahmen
  ctx.strokeStyle = upsideDown ? bike.accent : bike.color;
  ctx.lineWidth = 0.3;
  ctx.beginPath();
  ctx.moveTo(0, -1.1); ctx.lineTo(0, 1.1);
  ctx.stroke();
  // Räder
  ctx.fillStyle = '#181818';
  ctx.strokeStyle = upsideDown ? bike.color : bike.accent;
  ctx.lineWidth = 0.18;
  for (const wy of [-1.1, 1.1]) {
    ctx.beginPath(); ctx.arc(0, wy, bike.wheel, 0, TAU);
    ctx.fill(); ctx.stroke();
  }
  // Lenker
  ctx.strokeStyle = upsideDown ? bike.accent : bike.color;
  ctx.lineWidth = 0.22;
  ctx.beginPath(); ctx.moveTo(-0.5, -0.95); ctx.lineTo(0.5, -0.95); ctx.stroke();
  // Fahrer (Punkt)
  ctx.fillStyle = upsideDown ? '#c94' : '#eee';
  ctx.beginPath(); ctx.arc(0, 0, 0.32, 0, TAU); ctx.fill();
  ctx.restore();

  // In der Luft: Rotations-Indikator (Ziel: Räder unten = pitch ~0)
  if (st.airborne) {
    const cx = W / 2, cy = H / 2 - st.z * S * 1.1;
    ctx.strokeStyle = Math.abs(norm(st.pitch)) < bike.landTol && Math.abs(norm(st.spin)) < bike.landTol
      ? 'rgba(90,220,120,0.9)' : 'rgba(255,120,90,0.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, 2.6 * S, -Math.PI / 2, -Math.PI / 2 + norm(st.pitch), norm(st.pitch) < 0);
    ctx.stroke();
  }
}

function fmt(t) {
  if (t == null) return '–';
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`;
}

function drawHUD(time) {
  // Tempo oben links (unter dem Menü-Knopf)
  ctx.fillStyle = 'rgba(8,25,42,0.55)';
  roundRect(14, 64, 138, 52, 10); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 22px system-ui';
  ctx.fillText(Math.round(Math.abs(st.speed) * 3.6) + ' km/h', 26, 94);
  ctx.font = '12px system-ui';
  ctx.fillStyle = st.airborne ? '#8fd6ff' : 'rgba(255,255,255,0.7)';
  ctx.fillText(st.airborne ? '✈ in der Luft!' : bike.name, 26, 110);

  // Zeit + Score oben Mitte
  ctx.fillStyle = 'rgba(8,25,42,0.6)';
  roundRect(W / 2 - 150, 10, 300, 52, 10); ctx.fill();
  ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
  ctx.font = 'bold 20px system-ui';
  ctx.fillText(fmt(st.lapTime), W / 2 - 70, 32);
  ctx.font = 'bold 20px system-ui'; ctx.fillStyle = '#ffd25a';
  ctx.fillText('★ ' + st.score, W / 2 + 75, 32);
  ctx.font = '11px system-ui'; ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillText(`Best-Zeit ${fmt(st.best)}`, W / 2 - 70, 50);
  ctx.fillText(`Best ★ ${st.bestScore ?? '–'}`, W / 2 + 75, 50);

  // Combo-Popup
  if (st.comboT > 0) {
    ctx.globalAlpha = clamp(st.comboT, 0, 1);
    ctx.fillStyle = st.combo === 'CRASH!' ? '#ff6a5a' : '#ffe08a';
    ctx.font = 'bold 30px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(st.combo, W / 2, H / 2 - 70);
    ctx.globalAlpha = 1;
    st.comboT -= 1 / 60;
  }

  drawControls();
  if (st.airborne) drawAttitude();
}

// Lage-Anzeige in der Luft (wie der Moth-Balance-Anzeiger beim Segeln):
// zwei Nadeln für Salto (pitch) und Spin (yaw) relativ zur nächsten vollen
// Umdrehung. Nadel in der grünen Mitte = landbar; rot = Crash.
function drawAttitude() {
  const gw = Math.min(230, W - 360), gh = 20;
  if (gw < 120) return;
  const gx = W / 2 - gw / 2;
  const y0 = H - 150;
  const tolFrac = clamp(bike.landTol / Math.PI, 0, 1);
  const rows = [
    { label: 'Salto', val: norm(st.pitch), y: y0 },
    { label: 'Spin', val: norm(st.spin), y: y0 + 40 },
  ];
  ctx.fillStyle = 'rgba(8,25,42,0.6)';
  roundRect(gx - 12, y0 - 22, gw + 24, 78, 10);
  ctx.fill();
  const bothOk = Math.abs(norm(st.pitch)) < bike.landTol && Math.abs(norm(st.spin)) < bike.landTol;
  ctx.textAlign = 'center';
  ctx.fillStyle = bothOk ? '#7dff9a' : 'rgba(255,255,255,0.9)';
  ctx.font = 'bold 12px system-ui';
  ctx.fillText(bothOk ? '✓ LANDEN!' : 'gerade ausrichten', W / 2, y0 - 8);
  for (const r of rows) {
    const toX = (frac) => gx + gw / 2 + frac * (gw / 2); // frac in [-1,1]
    // Zonen: rot | gelb | grün | gelb | rot (grün = ±tol um die volle Umdrehung)
    const zones = [
      [-1, -tolFrac * 2.2, 'rgba(220,70,60,0.85)'],
      [-tolFrac * 2.2, -tolFrac, 'rgba(230,190,60,0.8)'],
      [-tolFrac, tolFrac, 'rgba(70,190,110,0.85)'],
      [tolFrac, tolFrac * 2.2, 'rgba(230,190,60,0.8)'],
      [tolFrac * 2.2, 1, 'rgba(220,70,60,0.85)'],
    ];
    for (const [a, b, col] of zones) {
      ctx.fillStyle = col;
      ctx.fillRect(toX(a), r.y, toX(b) - toX(a), gh);
    }
    // Nadel
    const nx = toX(clamp(r.val / Math.PI, -1, 1));
    ctx.fillStyle = '#fff';
    ctx.fillRect(nx - 2, r.y - 4, 4, gh + 8);
    // Label + Rotationszähler
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '11px system-ui';
    const full = Math.round((r.label === 'Salto' ? st.pitch : st.spin) / TAU);
    ctx.fillText(`${r.label}${full ? ' ' + Math.abs(full) + '×' : ''}`, gx - 4, r.y + gh - 5);
    ctx.textAlign = 'center';
  }
}

// Sichtbare Bedien-Elemente: links ein 2D-Pad (lenken/spinnen + lehnen),
// rechts Gas/Bremse. Die ganze jeweilige Bildschirmhälfte ist berührbar.
function drawControls() {
  // Linkes 2D-Pad
  const pad = { x: 20, y: H - 168, s: 132 };
  ctx.fillStyle = 'rgba(8,25,42,0.5)';
  roundRect(pad.x - 6, pad.y - 20, pad.s + 12, pad.s + 30, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(pad.x, pad.y, pad.s, pad.s);
  ctx.beginPath();
  ctx.moveTo(pad.x + pad.s / 2, pad.y); ctx.lineTo(pad.x + pad.s / 2, pad.y + pad.s);
  ctx.moveTo(pad.x, pad.y + pad.s / 2); ctx.lineTo(pad.x + pad.s, pad.y + pad.s / 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '10px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('◀ lenken / spinnen ▶', pad.x + pad.s / 2, pad.y - 6);
  ctx.textBaseline = 'middle';
  ctx.save();
  ctx.translate(pad.x - 2, pad.y + pad.s / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillText('vor ⟂ zurück', 0, 0);
  ctx.restore();
  ctx.textBaseline = 'alphabetic';
  // Knopf: x = steer, y = -lean (hoch = vorlehnen)
  ctx.fillStyle = st.airborne ? '#8fd6ff' : '#ffd166';
  ctx.beginPath();
  ctx.arc(pad.x + pad.s / 2 + st.steer * (pad.s / 2 - 12),
          pad.y + pad.s / 2 - st.lean * (pad.s / 2 - 12), 12, 0, TAU);
  ctx.fill();

  // Rechts: Gas/Bremse bzw. Wackel-Hinweis
  const tb = { x: W - 62, y: H - 200, w: 38, h: 140 };
  ctx.fillStyle = 'rgba(8,25,42,0.5)';
  roundRect(tb.x - 8, tb.y - 20, tb.w + 16, tb.h + 42, 10);
  ctx.fill();
  ctx.textAlign = 'center';
  if (annoying) {
    ctx.fillStyle = '#ff9060';
    ctx.font = 'bold 11px system-ui';
    ctx.fillText('WACKELN', tb.x + tb.w / 2, tb.y - 6);
    ctx.save();
    ctx.translate(tb.x + tb.w / 2, tb.y + tb.h / 2);
    const wob = Math.sin(performance.now() / 90) * 10;
    ctx.fillStyle = '#ffb050';
    ctx.beginPath(); ctx.arc(wob, 0, 12, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '10px system-ui';
    ctx.fillText('◀ ▶ treten', tb.x + tb.w / 2, tb.y + tb.h + 16);
    // Boost-Füllung
    ctx.fillStyle = 'rgba(90,210,120,0.6)';
    const bh = tb.h * clamp(wiggle.boost, 0, 1);
    ctx.fillRect(tb.x + 4, tb.y + tb.h - bh, tb.w - 8, bh);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(tb.x, tb.y, tb.w, tb.h);
  } else {
    ctx.fillStyle = 'rgba(120,220,140,0.85)';
    ctx.font = '11px system-ui';
    ctx.fillText('schnell', tb.x + tb.w / 2, tb.y - 6);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(tb.x, tb.y, tb.w, tb.h);
    ctx.beginPath();
    ctx.moveTo(tb.x, tb.y + tb.h / 2); ctx.lineTo(tb.x + tb.w, tb.y + tb.h / 2);
    ctx.stroke();
    const cy = tb.y + tb.h / 2;
    const fill = st.throttle * (tb.h / 2 - 4);
    ctx.fillStyle = st.throttle >= 0 ? 'rgba(90,210,120,0.7)' : 'rgba(230,90,70,0.7)';
    ctx.fillRect(tb.x + 4, cy - Math.max(0, fill), tb.w - 8, Math.abs(fill));
    ctx.fillStyle = '#fff';
    ctx.fillRect(tb.x - 3, cy - fill - 2, tb.w + 6, 4);
    ctx.fillStyle = 'rgba(230,120,110,0.9)';
    ctx.fillText('langsam', tb.x + tb.w / 2, tb.y + tb.h + 16);
  }
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
// Links (2D): horizontal = lenken/spinnen, vertikal = vor/zurück lehnen (Salto).
// Rechts: vertikal = Gas/Bremse. Annoying: rechts schnell links/rechts wackeln.
const pointers = new Map();
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  hideHelp();
  const role = e.clientX < W / 2 ? 'left' : 'right';
  pointers.set(e.pointerId, { role, sx: e.clientX, sy: e.clientY, lastX: e.clientX });
});
canvas.addEventListener('pointermove', (e) => {
  const pt = pointers.get(e.pointerId);
  if (!pt) return;
  if (pt.role === 'left') {
    st.steer = clamp((e.clientX - pt.sx) / 70, -1, 1);
    st.lean = clamp((pt.sy - e.clientY) / 70, -1, 1); // hoch = vorlehnen
  } else if (annoying) {
    // Wackeln: jede Richtungsumkehr gibt Schub
    const dx = e.clientX - pt.lastX;
    if (Math.abs(dx) > 6) {
      const d = Math.sign(dx);
      if (d !== wiggle.dir) { wiggle.boost = clamp(wiggle.boost + 0.32, 0, 1.2); wiggle.dir = d; }
      pt.lastX = e.clientX;
    }
  } else {
    st.throttle = clamp((pt.sy - e.clientY) / 70, -1, 1);
  }
});
function endPointer(e) {
  const pt = pointers.get(e.pointerId);
  if (pt) {
    if (pt.role === 'left') { st.steer = 0; st.lean = 0; }
    else if (!annoying) st.throttle = 0;
  }
  pointers.delete(e.pointerId);
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const keys = new Set();
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 's', 'a', 'd'].includes(k)) {
    e.preventDefault(); keys.add(k); hideHelp();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
function applyKeys() {
  if (pointers.size > 0) return;
  st.steer = (keys.has('arrowright') ? 1 : 0) - (keys.has('arrowleft') ? 1 : 0);
  st.lean = (keys.has('arrowup') ? 1 : 0) - (keys.has('arrowdown') ? 1 : 0);
  if (!annoying) st.throttle = (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0);
  else if (keys.has('w')) wiggle.boost = clamp(wiggle.boost + 0.03, 0, 1);
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
  menuEl.classList.add('hidden'); helpEl.classList.remove('hidden');
});

const selBike = document.getElementById('sel-bike');
for (const b of Object.values(BIKES)) {
  const o = document.createElement('option'); o.value = b.key; o.textContent = b.name;
  selBike.appendChild(o);
}
selBike.addEventListener('change', () => { bike = BIKES[selBike.value]; resetRun(); });
const modeWald = document.getElementById('mode-wald');
const modeHalle = document.getElementById('mode-halle');
function setTrack(key) {
  track = TRACKS[key];
  modeWald.classList.toggle('active', key === 'wald');
  modeHalle.classList.toggle('active', key === 'halle');
  resetRun();
}
modeWald.addEventListener('click', () => setTrack('wald'));
modeHalle.addEventListener('click', () => setTrack('halle'));
const btnAnnoy = document.getElementById('btn-annoy');
function annoyLabel() { btnAnnoy.textContent = annoying ? '😖 Annoying-Mode: an' : '😖 Annoying-Mode: aus'; }
btnAnnoy.addEventListener('click', () => { annoying = !annoying; annoyLabel(); });
annoyLabel();
document.getElementById('btn-reset').addEventListener('click', () => { resetRun(); menuEl.classList.add('hidden'); });

// ---- Schleife --------------------------------------------------------------
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();
resetRun();

window.__mtb = {
  st, get bike() { return bike; }, get track() { return track; },
  get annoying() { return annoying; }, set annoying(v) { annoying = v; },
  BIKES, TRACKS, resetRun,
};

let last = performance.now();
let time = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now; time += dt;
  applyKeys();
  update(dt, time);
  draw(time);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
