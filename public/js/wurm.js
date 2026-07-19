// Wurmkrieg – rundenbasiertes Artillerie-Spiel im Worms-Stil.
// 2D-Seitenansicht, prozedural erzeugtes, zerstörbares Gelände, Hotseat
// (Handy weiterreichen). Eigenständiges Spiel mit eigenen Waffennamen.

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
      // Gras, wenn innerhalb 6px Luft darüber liegt
      let grass = false;
      for (let k = 1; k <= 6; k++) { if (y - k < 0 || mask[idx(x, y - k)] !== 1) { grass = true; break; } }
      const nz = ((x * 13 + y * 7) % 17) / 17 * 14;
      if (grass) { d[p] = 96 + nz; d[p + 1] = 156 + nz; d[p + 2] = 66; }
      else { d[p] = 120 + nz; d[p + 1] = 86 + nz * 0.6; d[p + 2] = 54; }
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
  if (rebuild && terrainImage) {
    recolorRegion(cx - rad - 6, cy - rad - 6, cx + rad + 6, cy + rad + 6);
    terrainCtx.putImageData(terrainImage, 0, 0);
  }
}

// ---- Teams & Würmer --------------------------------------------------------
const TEAM_COLORS = ['#e0453e', '#3d8ee0', '#3fb14e', '#e0a92e'];
const TEAM_NAMES = ['Rot', 'Blau', 'Grün', 'Gelb'];
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
  let s = 0;
  for (let t = 0; t < cfg.teamCount; t++) {
    const worms = [];
    for (let w = 0; w < cfg.wormCount; w++) {
      const x = spots[s++];
      const y = surfaceY(x | 0) - 8;
      worms.push({ x, y, vx: 0, vy: 0, hp: 100, alive: true, facing: 1, team: t, grounded: false, fall: 0, crawl: Math.random() * TAU });
    }
    teams.push({ color: TEAM_COLORS[t], name: TEAM_NAMES[t], worms, cur: 0 });
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

// ---- Waffen ----------------------------------------------------------------
// Jede Waffe: name, icon, ammo, endsTurn, fire(worm). Projektil-Typen steuern
// Flug/Explosion. Namen bewusst eigenständig (kein geschütztes Original).
const WEAPONS = [
  { key: 'panzer', name: 'Panzerfaust', icon: '🚀', ammo: Infinity, aimed: true,
    fire: (w) => launch(w, 'rocket', 720, { r: 34, dmg: 48, wind: 1 }) },
  { key: 'granate', name: 'Splittergranate', icon: '💣', ammo: Infinity, aimed: true,
    fire: (w) => launch(w, 'grenade', 620, { r: 36, dmg: 46, fuse: 3, bounce: 0.55, wind: 0.5 }) },
  { key: 'schrot', name: 'Schrotflinte', icon: '🔫', ammo: Infinity, aimed: true, hitscan: true,
    fire: (w) => shotgun(w) },
  { key: 'mp', name: 'MP (Uzi)', icon: '🔩', ammo: Infinity, aimed: true, hitscan: true,
    fire: (w) => uzi(w) },
  { key: 'dynamit', name: 'Dynamit', icon: '🧨', ammo: 3, aimed: false,
    fire: (w) => drop(w, 'dynamite', { r: 52, dmg: 62, fuse: 4 }) },
  { key: 'cluster', name: 'Streubombe', icon: '🍒', ammo: 2, aimed: true,
    fire: (w) => launch(w, 'cluster', 640, { r: 24, dmg: 26, fuse: 3, bounce: 0.5, wind: 1, cluster: 6 }) },
  { key: 'allmacht', name: 'Allmachtsgranate', icon: '✨', ammo: 1, aimed: true,
    fire: (w) => launch(w, 'grenade', 600, { r: 64, dmg: 82, fuse: 3.5, bounce: 0.5, wind: 0.5, holy: 1 }) },
  { key: 'brenner', name: 'Schweißbrenner', icon: '🔥', ammo: 2, aimed: false, endsTurn: true,
    fire: (w) => blowtorch(w) },
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
      if (wm.alive && wm !== game.active && Math.hypot(px - wm.x, py - wm.y) < 9) return { x: px, y: py, hit: wm, d };
    }
  }
  return { x: x + dirx * maxDist, y: y + diry * maxDist, hit: null, d: maxDist };
}

function shotgun(w) {
  const a = game.aim, dir = w.facing;
  const dirx = dir * Math.cos(a), diry = -Math.sin(a);
  const res = hitscanRay(w.x + dir * 12, w.y - 10, dirx, diry, 900);
  spawnTracer(w.x + dir * 12, w.y - 10, res.x, res.y);
  explode(res.x, res.y, 16, 26, false);
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
  game.actionBusy = true; // hält die Runde, bis der Tunnel gegraben ist
  let step = 0;
  const iv = setInterval(() => {
    if (step >= 22) { clearInterval(iv); game.actionBusy = false; return; }
    const px = w.x + dir * (10 + step * 3), py = w.y - 6;
    carveCircle(px | 0, py | 0, 12);
    for (const wm of allWorms()) if (wm.alive && wm !== w && Math.hypot(px - wm.x, py - wm.y) < 16) damage(wm, 6, dir * 60, -40);
    w.x = clamp(px - dir * 8, 4, WORLD_W - 4);
    step++;
  }, 45);
}

function spawnTracer(x1, y1, x2, y2) { particles.push({ kind: 'tracer', x1, y1, x2, y2, t: 0, ttl: 0.12 }); }

// ---- Explosion -------------------------------------------------------------
function explode(x, y, r, dmg, dig = true) {
  if (dig) carveCircle(x | 0, y | 0, r);
  for (const wm of allWorms()) {
    if (!wm.alive) continue;
    const dist = Math.hypot(wm.x - x, wm.y - y);
    if (dist < r + 18) {
      const f = clamp(1 - dist / (r + 18), 0, 1);
      const ang = Math.atan2(wm.y - y, wm.x - x);
      damage(wm, Math.round(dmg * f), Math.cos(ang) * 260 * f, Math.sin(ang) * 260 * f - 80 * f);
    }
  }
  for (let i = 0; i < 18; i++) {
    const a = Math.random() * TAU, sp = 60 + Math.random() * 160;
    particles.push({ kind: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, t: 0, ttl: 0.6 });
  }
  particles.push({ kind: 'blast', x, y, r, t: 0, ttl: 0.35 });
}

function damage(wm, amt, kx, ky) {
  wm.hp -= amt;
  wm.vx += kx; wm.vy += ky;
  wm.grounded = false;
  if (wm.hp <= 0) { wm.hp = 0; wm.alive = false; }
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
  wm.vy += GRAV * dt;

  // horizontale Bewegung mit Stufen-Klettern
  if (Math.abs(wm.vx) > 1) {
    const nx = clamp(wm.x + wm.vx * dt, 2, WORLD_W - 2);
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
  else wm.crawl += dt * 1.6; // ruhiges „Atmen"
  // Wasser
  if (wm.y > WATERLINE + 4) { wm.alive = false; wm.hp = 0; particles.push({ kind: 'splash', x: wm.x, y: WATERLINE, t: 0, ttl: 0.6 }); }
}

function stepProjectile(pr, dt) {
  pr.t += dt;
  pr.vy += GRAV * dt;
  if (pr.wind) pr.vx += game.wind * 40 * pr.wind * dt;
  let nx = pr.x + pr.vx * dt, ny = pr.y + pr.vy * dt;

  // Wasser
  if (ny > WATERLINE) { particles.push({ kind: 'splash', x: nx, y: WATERLINE, t: 0, ttl: 0.5 }); return true; }
  // Wurm getroffen (Raketen/Cluster explodieren bei Kontakt)
  if (pr.type === 'rocket' || pr.type === 'cluster') {
    for (const wm of allWorms()) if (wm.alive && wm !== game.active && Math.hypot(nx - wm.x, ny - wm.y) < 9) { detonate(pr, nx, ny); return true; }
  }
  // Gelände
  if (solidAt(nx, ny)) {
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
  explode(x, y, pr.r, pr.dmg, true);
  if (pr.cluster) {
    for (let i = 0; i < pr.cluster; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      projectiles.push({ type: 'grenade', x, y: y - 6, vx: Math.cos(a) * (120 + Math.random() * 120), vy: Math.sin(a) * (160 + Math.random() * 120), t: 0, r: 20, dmg: 22, fuse: 1.5 + Math.random(), bounce: 0.5 });
    }
  }
}

// ---- Rundensteuerung -------------------------------------------------------
function livingTeams() { return teams.filter((t) => t.worms.some((w) => w.alive)); }

function startTurn() {
  const lt = livingTeams();
  if (lt.length <= 1) { game.state = 'over'; game.winner = lt[0] || null; game.banner = game.winner ? game.winner.name + ' gewinnt!' : 'Unentschieden'; game.bannerT = 999; return; }
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
  game.timer = 45; game.fireDone = false; game.shotgunShots = 0; game.actionBusy = false;
  game.state = 'aim';
  game.banner = 'Team ' + team.name + ' ist dran'; game.bannerT = 1.6;
  // Waffe mit Munition wählen, falls aktuelle leer
  if (weaponAmmo(game.weaponIdx) <= 0) game.weaponIdx = 0;
  focusCam(game.active.x, game.active.y);
}

const ammoUsed = {}; // key -> Anzahl verbraucht (global, vereinfachter Vorrat)
function weaponAmmo(i) { const w = WEAPONS[i]; return w.ammo === Infinity ? Infinity : w.ammo - (ammoUsed[w.key] || 0); }

function fireWeapon() {
  const w = WEAPONS[game.weaponIdx];
  if (weaponAmmo(game.weaponIdx) <= 0) return;
  game.fireDone = true;
  const r = w.fire(game.active);
  if (r === 'more') return; // Schrot: zweiter Schuss folgt
  if (w.ammo !== Infinity) ammoUsed[w.key] = (ammoUsed[w.key] || 0) + 1;
  game.state = 'busy';
  game.settleT = 0;
  game.busyT = 0;
}

function endTurnAfterSettle(dt) {
  game.busyT += dt;
  if (game.busyT > 8) { startTurn(); return; } // Sicherheits-Zeitgrenze
  if (game.actionBusy) { game.settleT = 0; return; } // Uzi/Brenner noch aktiv
  // warten bis Projektile weg und Würmer wirklich ruhig sind (nur echte
  // Geschwindigkeit prüfen – nicht das grounded-Flag, das sonst hängen bleibt)
  const moving = projectiles.length > 0 ||
    allWorms().some((w) => w.alive && (Math.abs(w.vx) > 6 || Math.abs(w.vy) > 6));
  if (moving) { game.settleT = 0; return; }
  game.settleT += dt;
  if (game.settleT > 0.7) startTurn();
}

// ---- Kamera ----------------------------------------------------------------
const cam = { x: WORLD_W / 2, y: WORLD_H / 2, scale: 1 };
let W = 0, H = 0;
function focusCam(x, y) { cam.tx = x; cam.ty = y; }

// ---- Rendering -------------------------------------------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function worldToScreen(x, y) { return { x: (x - cam.x) * cam.scale + W / 2, y: (y - cam.y) * cam.scale + H / 2 }; }

function draw(time) {
  // Himmel
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#5b86b5'); sky.addColorStop(1, '#9fc0d8');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(W / 2, H / 2); ctx.scale(cam.scale, cam.scale); ctx.translate(-cam.x, -cam.y);

  // Wasser
  ctx.fillStyle = 'rgba(40,110,170,0.75)';
  ctx.fillRect(-200, WATERLINE, WORLD_W + 400, WORLD_H);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = -200; x < WORLD_W + 400; x += 20) {
    const yy = WATERLINE + Math.sin((x + waveT * 60) * 0.05) * 3;
    if (x === -200) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
  }
  ctx.stroke();

  // Gelände
  ctx.drawImage(terrainCanvas, 0, 0);

  // Projektile
  for (const pr of projectiles) drawProjectile(pr, time);

  // Würmer
  for (const t of teams) for (const wm of t.worms) drawWorm(wm, t, time);

  // Partikel
  for (const p of particles) drawParticle(p);

  // Zielhilfe des aktiven Wurms
  if (game.state === 'aim' && game.active && curWeapon().aimed) drawAim(game.active);

  ctx.restore();

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
  const amp = moving ? 2.8 : 0.6;
  const segY = (i) => wm.y - segR + Math.sin(wm.crawl - i * 0.95) * amp;

  ctx.save();
  // Beinchen
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1;
  for (let i = 0; i < segN; i++) {
    const sx = wm.x - f * i * gap, sy = segY(i);
    const wig = moving ? Math.sin(wm.crawl * 2 - i) * 1.2 : 0;
    ctx.beginPath();
    ctx.moveTo(sx - 2, sy + segR - 1); ctx.lineTo(sx - 2 + wig, sy + segR + 2.5);
    ctx.moveTo(sx + 2, sy + segR - 1); ctx.lineTo(sx + 2 - wig, sy + segR + 2.5);
    ctx.stroke();
  }
  // Körper (hinten zuerst, Kopf zuletzt)
  for (let i = segN - 1; i >= 0; i--) {
    const sx = wm.x - f * i * gap, sy = segY(i);
    const r = i === 0 ? segR + 1.3 : segR * (1 - i * 0.06);
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU);
    ctx.fillStyle = i % 2 ? team.color : shade(team.color, -22);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.6; ctx.stroke();
  }
  // Kopf-Details
  const hx = wm.x, hy = segY(0);
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(hx + f * 2, hy - 1.6, 1.9, 0, TAU); ctx.fill();
  ctx.fillStyle = '#111';
  ctx.beginPath(); ctx.arc(hx + f * 2.7, hy - 1.6, 0.95, 0, TAU); ctx.fill();
  // Fühler
  ctx.strokeStyle = team.color; ctx.lineWidth = 0.9;
  const antW = Math.sin(time * 3 + wm.x) * 1;
  ctx.beginPath(); ctx.moveTo(hx + f * 1.5, hy - 4.5); ctx.lineTo(hx + f * 3.5 + antW, hy - 9); ctx.stroke();
  ctx.fillStyle = team.color;
  ctx.beginPath(); ctx.arc(hx + f * 3.5 + antW, hy - 9.5, 0.9, 0, TAU); ctx.fill();
  ctx.restore();

  const topY = wm.y - segR - amp - 9;
  // aktiver Wurm: Pfeil
  if (wm === game.active && game.state === 'aim') {
    const bob = Math.sin(time * 4) * 2;
    ctx.fillStyle = team.color;
    ctx.beginPath();
    ctx.moveTo(wm.x, topY - 4 - bob); ctx.lineTo(wm.x - 5, topY - 12 - bob); ctx.lineTo(wm.x + 5, topY - 12 - bob);
    ctx.closePath(); ctx.fill();
  }
  // HP-Balken
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(wm.x - 11, topY, 22, 4);
  ctx.fillStyle = team.color; ctx.fillRect(wm.x - 11, topY, 22 * wm.hp / 100, 4);
  ctx.fillStyle = '#fff'; ctx.font = '7px system-ui'; ctx.textAlign = 'center';
  ctx.fillText(wm.hp, wm.x, topY - 2);
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
  } else {
    ctx.fillStyle = pr.holy ? '#f5d76e' : '#2c3e50';
    ctx.beginPath(); ctx.arc(0, 0, pr.holy ? 6 : 4, 0, TAU); ctx.fill();
    const on = Math.floor(time * 10) % 2 === 0;
    ctx.fillStyle = on ? '#ffcc33' : '#883'; ctx.beginPath(); ctx.arc(0, -5, 1.5, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

function drawParticle(p) {
  if (p.kind === 'blast') {
    const f = p.t / p.ttl;
    ctx.globalAlpha = 1 - f; ctx.fillStyle = '#ffb24d';
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.5 + f * 0.8), 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  } else if (p.kind === 'spark') {
    ctx.globalAlpha = 1 - p.t / p.ttl; ctx.fillStyle = '#ffd27f';
    ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
  } else if (p.kind === 'tracer') {
    ctx.globalAlpha = 1 - p.t / p.ttl; ctx.strokeStyle = '#fff4c0'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); ctx.stroke(); ctx.globalAlpha = 1;
  } else if (p.kind === 'splash') {
    ctx.globalAlpha = 1 - p.t / p.ttl; ctx.fillStyle = '#bfe3ff';
    for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i - 2) * 0.3; ctx.beginPath(); ctx.arc(p.x + Math.cos(a) * p.t * 60, p.y - Math.sin(-a) * p.t * 40, 2, 0, TAU); ctx.fill(); }
    ctx.globalAlpha = 1;
  }
}

function drawAim(wm) {
  const a = game.aim, dir = wm.facing;
  const dx = dir * Math.cos(a), dy = -Math.sin(a);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(wm.x, wm.y - 8);
  for (let i = 1; i <= 6; i++) { ctx.lineTo(wm.x + dx * i * 12, wm.y - 8 + dy * i * 12); }
  ctx.stroke(); ctx.setLineDash([]);
  // Fadenkreuz
  ctx.fillStyle = curWeapon() ? teams[game.turnTeam].color : '#fff';
  ctx.beginPath(); ctx.arc(wm.x + dx * 80, wm.y - 8 + dy * 80, 3, 0, TAU); ctx.fill();
}

// ---- HUD -------------------------------------------------------------------
function drawHUD(time) {
  // Team-Gesundheitsbalken oben
  const bw = Math.min(150, (W - 28 - (teams.length - 1) * 10) / teams.length);
  teams.forEach((t, i) => {
    const total = t.worms.reduce((s, w) => s + Math.max(0, w.hp), 0);
    const max = t.worms.length * 100;
    const x = 14 + i * (bw + 10), y = 54; // unter der Toolbar
    ctx.fillStyle = 'rgba(8,25,42,0.55)'; roundRect(x, y, bw, 30, 8); ctx.fill();
    ctx.fillStyle = t.color; roundRect(x + 4, y + 18, (bw - 8) * total / max, 8, 3); ctx.fill();
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

  // Timer
  if (game.state === 'aim') {
    ctx.fillStyle = game.timer < 10 ? '#ff6a5a' : '#fff'; ctx.font = 'bold 22px system-ui'; ctx.textAlign = 'right';
    ctx.fillText(Math.ceil(game.timer) + 's', W - 16, 34);
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

function releaseFire() {
  if (!game.charging) return;
  game.charging = false;
  if (canAct() && game.power > 0.02) fireWeapon();
  else game.power = 0;
}

setBtn('b-left');
setBtn('b-right');
setBtn('b-jump', () => { if (canAct() && game.active.grounded) { game.active.vy = -230; game.active.vx = game.active.facing * 90; game.active.grounded = false; } });
setBtn('b-aimup');
setBtn('b-aimdn');
setBtn('b-fire', () => { if (canAct()) game.charging = true; }, releaseFire);

// Waffenmenü
const wmenu = document.getElementById('wmenu');
document.getElementById('b-weapon').addEventListener('click', () => { if (game.state === 'aim') buildWeaponMenu(); });
function buildWeaponMenu() {
  wmenu.innerHTML = '';
  WEAPONS.forEach((w, i) => {
    const b = document.createElement('button');
    const am = weaponAmmo(i);
    b.className = 'wpn' + (i === game.weaponIdx ? ' sel' : '') + (am <= 0 ? ' out' : '');
    b.innerHTML = `<span class="wi">${w.icon}</span><span class="wn">${w.name}</span><span class="wa">${am === Infinity ? '∞' : am}</span>`;
    if (am > 0) b.addEventListener('click', () => { game.weaponIdx = i; game.shotgunShots = 0; wmenu.classList.add('hidden'); });
    wmenu.appendChild(b);
  });
  wmenu.classList.remove('hidden');
}
wmenu.addEventListener('click', (e) => { if (e.target === wmenu) wmenu.classList.add('hidden'); });

// Tastatur (Desktop)
const keys = new Set();
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' ', 'enter'].includes(k)) e.preventDefault();
  keys.add(k);
  if (k === ' ' && canAct() && !game.charging) game.charging = true;
  if (k === 'tab') { e.preventDefault(); if (game.state === 'aim') buildWeaponMenu(); }
  if (k === 'w' && canAct() && game.active.grounded) { game.active.vy = -230; game.active.vx = game.active.facing * 90; game.active.grounded = false; }
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  keys.delete(k);
  if (k === ' ') releaseFire();
});

function readInput(dt) {
  if (!canAct()) { return; }
  const wm = game.active;
  const left = keys.has('arrowleft') || buttons['b-left'].held;
  const right = keys.has('arrowright') || buttons['b-right'].held;
  if (left) { wm.vx = -70; wm.facing = -1; }
  else if (right) { wm.vx = 70; wm.facing = 1; }
  else if (wm.grounded) wm.vx *= 0.4;
  const up = keys.has('arrowup') || buttons['b-aimup'].held;
  const dn = keys.has('arrowdown') || buttons['b-aimdn'].held;
  if (up) game.aim = clamp(game.aim + 1.5 * dt, -1.4, 1.4);
  if (dn) game.aim = clamp(game.aim - 1.5 * dt, -1.4, 1.4);
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
  for (const k in ammoUsed) delete ammoUsed[k];
  spawnTeams();
  projectiles.length = 0; particles.length = 0;
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
  cam.scale = clamp(H / (WORLD_H * 0.62), 0.5, 1.1);
}
window.addEventListener('resize', resize);
document.getElementById('btn-rotate').addEventListener('click', () => {
  stage.classList.toggle('rot');
  resize();
});
resize();

window.__wurm = { game, teams: () => teams, projectiles, WEAPONS, fireWeapon, weaponAmmo,
  set weapon(i) { game.weaponIdx = i; }, focus: () => game.active, newGame,
  get mask() { return mask; }, solidAt, explode, cfg };

newGame();

let last = performance.now(), time = 0;
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000); last = now; time += dt; waveT += dt;

  if (game.bannerT > 0 && game.state !== 'over') game.bannerT -= dt;

  if (game.state === 'aim') {
    readInput(dt);
    game.timer -= dt;
    if (game.timer <= 0 && !game.fireDone) { game.state = 'busy'; game.settleT = 0; game.busyT = 0; }
  }

  // Physik immer (Würmer fallen, auch nach Explosionen)
  for (const wm of allWorms()) stepWorm(wm, dt);
  for (let i = projectiles.length - 1; i >= 0; i--) { if (stepProjectile(projectiles[i], dt)) projectiles.splice(i, 1); }
  for (let i = particles.length - 1; i >= 0; i--) { particles[i].t += dt; if (particles[i].t >= particles[i].ttl) particles.splice(i, 1); }
  if (particles.length) for (const p of particles) if (p.kind === 'spark') { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += GRAV * dt; }

  if (game.state === 'busy') endTurnAfterSettle(dt);

  // Kamera folgt Projektil oder aktivem Wurm
  let ft = game.active;
  if (projectiles.length) ft = projectiles[projectiles.length - 1];
  if (ft) { cam.tx = ft.x; cam.ty = ft.y - 40; }
  cam.x += ((cam.tx ?? cam.x) - cam.x) * Math.min(1, dt * 4);
  cam.y += ((cam.ty ?? cam.y) - cam.y) * Math.min(1, dt * 4);
  cam.x = clamp(cam.x, W / 2 / cam.scale, WORLD_W - W / 2 / cam.scale);
  cam.y = clamp(cam.y, H / 2 / cam.scale, WORLD_H - H / 2 / cam.scale + 40);

  draw(time);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
