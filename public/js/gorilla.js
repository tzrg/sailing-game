// Gorillas – Bananen-Artillerie über einer zerstörbaren Skyline.
// Hommage an den QBasic-Klassiker, komplett eigenständig umgesetzt.
// Steinschleuder-Steuerung: ziehen & loslassen. Hotseat oder gegen den Computer.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const TAU = Math.PI * 2;
const W_W = 800, W_H = 500;
const GRAV = 300;

// ---- Skyline (Pixel-Maske + Farb-Canvas) -----------------------------------
let mask;                    // Uint8Array 1 = Gebäude
let cityCanvas, cityCtx, cityImage;
let buildings = [];
const idx = (x, y) => y * W_W + x;
function solid(x, y) {
  x |= 0; y |= 0;
  if (x < 0 || x >= W_W || y < 0 || y >= W_H) return false;
  return mask[idx(x, y)] === 1;
}

const BLD_COLORS = [[96, 116, 158], [140, 104, 96], [104, 140, 118], [125, 108, 145], [90, 130, 150]];

function newCity(rand = Math.random) {
  mask = new Uint8Array(W_W * W_H);
  buildings = [];
  const n = 8 + (rand() * 3 | 0);
  let x = 0;
  for (let i = 0; i < n; i++) {
    // Ganzzahlige Koordinaten! (float-Indizes schreiben sonst an der Maske vorbei)
    const w = i === n - 1 ? W_W - x : clamp(60 + rand() * 60, 40, W_W - x) | 0;
    const h = (130 + rand() * 200) | 0;
    buildings.push({ x, w, h, color: BLD_COLORS[(rand() * BLD_COLORS.length) | 0], seed: rand() * 999 | 0 });
    const top = W_H - h;
    for (let bx = x; bx < x + w && bx < W_W; bx++) {
      for (let by = top; by < W_H; by++) mask[idx(bx, by)] = 1;
    }
    x += w;
    if (x >= W_W) break;
  }
  buildCityCanvas();
}

function buildCityCanvas() {
  cityCanvas = document.createElement('canvas');
  cityCanvas.width = W_W; cityCanvas.height = W_H;
  cityCtx = cityCanvas.getContext('2d');
  cityImage = cityCtx.createImageData(W_W, W_H);
  recolor(0, 0, W_W, W_H);
  cityCtx.putImageData(cityImage, 0, 0);
}

// Färbt Maske ein: Gebäudefarbe + Fensterraster
function recolor(x0, y0, x1, y1) {
  x0 = clamp(x0 | 0, 0, W_W); x1 = clamp(x1 | 0, 0, W_W);
  y0 = clamp(y0 | 0, 0, W_H); y1 = clamp(y1 | 0, 0, W_H);
  const d = cityImage.data;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = idx(x, y), p = i * 4;
    if (mask[i] !== 1) { d[p + 3] = 0; continue; }
    let b = null;
    for (const bb of buildings) if (x >= bb.x && x < bb.x + bb.w) { b = bb; break; }
    const c = b ? b.color : [110, 110, 120];
    // Fenster: Raster 14x16, Fensterzelle 6x8; deterministisch an/aus
    const lx = b ? x - b.x : x, ly = y;
    const wx = lx % 14, wy = ly % 16;
    const isWin = wx >= 4 && wx < 10 && wy >= 4 && wy < 12 && lx > 3 && (b ? x < b.x + b.w - 4 : true);
    if (isWin) {
      const cell = ((lx / 14) | 0) * 31 + ((ly / 16) | 0) * 7 + (b ? b.seed : 0);
      const lit = (cell * 2654435761 >>> 0) % 100 < 55;
      if (lit) { d[p] = 255; d[p + 1] = 224; d[p + 2] = 130; }
      else { d[p] = 40; d[p + 1] = 48; d[p + 2] = 66; }
    } else {
      d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2];
    }
    d[p + 3] = 255;
  }
}

function carveCircle(cx, cy, r) {
  const r2 = r * r;
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    if ((x - cx) ** 2 + (y - cy) ** 2 <= r2 && x >= 0 && x < W_W && y >= 0 && y < W_H) mask[idx(x, y)] = 0;
  }
  recolor(cx - r - 2, cy - r - 2, cx + r + 2, cy + r + 2);
  cityCtx.putImageData(cityImage, 0, 0);
}

// ---- Spielzustand ----------------------------------------------------------
const gorillas = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
const game = {
  mode: 'cpu',          // 'cpu' | '2p'
  turn: 0, phase: 'aim', // aim | fly | score | over
  wind: 0, score: [0, 0], target: 3,
  banner: '', bannerT: 0, cpuT: 0, winner: -1,
};
let banana = null;       // {x,y,vx,vy,rot,ignore}
const parts = [];        // Partikel {x,y,vx,vy,t,ttl,color}
const sun = { x: W_W / 2, y: 46, shock: 0 };

function roofY(x) { for (let y = 0; y < W_H; y++) if (solid(x, y)) return y; return W_H; }

function placeGorillas() {
  const bl = buildings[1] || buildings[0];
  const br = buildings[buildings.length - 2] || buildings[buildings.length - 1];
  const x0 = bl.x + bl.w / 2, x1 = br.x + br.w / 2;
  gorillas[0].x = x0; gorillas[0].y = roofY(x0 | 0) - 13;
  gorillas[1].x = x1; gorillas[1].y = roofY(x1 | 0) - 13;
}

function newRound(startTurn) {
  newCity();
  placeGorillas();
  banana = null;
  parts.length = 0;
  game.wind = +((Math.random() * 2 - 1) * 1).toFixed(2);
  game.phase = 'aim';
  game.turn = startTurn;
  game.cpuT = 1.1;
  cpuNoise = 1;
  showTurnBanner();
}

function newMatch() {
  game.score = [0, 0]; game.winner = -1;
  newRound(Math.random() < 0.5 ? 0 : 1);
}

function playerName(i) { return game.mode === 'cpu' ? (i === 0 ? 'Du' : 'Computer') : 'Spieler ' + (i + 1); }
function showTurnBanner() {
  game.banner = game.mode === 'cpu' && game.turn === 1 ? '🤖 Computer denkt …' : '🍌 ' + playerName(game.turn) + ' ist dran';
  game.bannerT = 1.4;
}

// ---- Wurf & Physik ---------------------------------------------------------
function throwBanana(vx, vy) {
  const g = gorillas[game.turn];
  banana = { x: g.x, y: g.y - 14, vx, vy, rot: 0, ignore: 0.25, from: game.turn };
  game.phase = 'fly';
}

function explode(x, y, r) {
  carveCircle(x | 0, y | 0, r);
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * TAU, sp = 50 + Math.random() * 140;
    parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, t: 0, ttl: 0.5 + Math.random() * 0.3, color: i % 3 ? '#ffb24d' : '#ff7043' });
  }
}

function hitGorilla(i, x, y) {
  explode(x, y, 30);
  const winner = 1 - i;   // wer getroffen wurde, verliert den Punkt (auch Eigentreffer)
  game.score[winner]++;
  game.phase = 'score';
  game.banner = game.score[winner] >= game.target
    ? '🏆 ' + playerName(winner) + ' gewinnt das Match!'
    : '💥 Punkt für ' + playerName(winner) + '!';
  game.bannerT = 999;
  game.scoreT = 1.8;
  game.roundWinner = winner;
}

function step(dt) {
  if (game.bannerT > 0 && game.bannerT < 900) game.bannerT -= dt;
  if (sun.shock > 0) sun.shock -= dt;

  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.t += dt;
    if (p.t >= p.ttl) { parts.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += GRAV * dt;
  }

  if (game.phase === 'score') {
    game.scoreT -= dt;
    if (game.scoreT <= 0) {
      if (game.score[game.roundWinner] >= game.target) { game.phase = 'over'; game.winner = game.roundWinner; }
      else newRound(1 - game.roundWinner);   // Verlierer wirft zuerst
    }
    return;
  }

  if (game.phase === 'fly' && banana) {
    const steps = Math.max(1, Math.ceil(dt / 0.004));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      banana.vy += GRAV * h;
      banana.vx += game.wind * 26 * h;
      banana.x += banana.vx * h;
      banana.y += banana.vy * h;
      banana.rot += 9 * h;
      if (banana.ignore > 0) banana.ignore -= h;
      // Sonne erschrecken
      if (Math.abs(banana.x - sun.x) < 34 && Math.abs(banana.y - sun.y) < 34) sun.shock = 1.5;
      // Gorilla-Treffer
      for (let i = 0; i < 2; i++) {
        if (banana.ignore > 0 && i === banana.from) continue;
        const g = gorillas[i];
        if (Math.abs(banana.x - g.x) < 14 && Math.abs(banana.y - (g.y - 8)) < 17) {
          hitGorilla(i, banana.x, banana.y); banana = null; return;
        }
      }
      // Gebäude
      if (solid(banana.x, banana.y)) {
        explode(banana.x, banana.y, 24);
        banana = null;
        nextThrow();
        return;
      }
      // aus dem Bild (seitlich/unten)
      if (banana.x < -80 || banana.x > W_W + 80 || banana.y > W_H + 60) {
        banana = null;
        nextThrow();
        return;
      }
    }
  }

  // Computerzug
  if (game.phase === 'aim' && game.mode === 'cpu' && game.turn === 1) {
    game.cpuT -= dt;
    if (game.cpuT <= 0) { cpuThrow(); }
  }
}

function nextThrow() {
  game.turn = 1 - game.turn;
  game.phase = 'aim';
  game.cpuT = 1.0;
  showTurnBanner();
}

// ---- Computer-Gegner -------------------------------------------------------
// Sucht per schneller Simulation einen Wurf, der trifft, und verwackelt ihn.
// cpuNoise sinkt mit jedem Fehlwurf -> der Computer wird von Wurf zu Wurf besser.
let cpuNoise = 1;
function simulate(vx, vy) {
  const g = gorillas[1], t = gorillas[0];
  let x = g.x, y = g.y - 14, ivx = vx, ivy = vy, ig = 0.25;
  const h = 1 / 120;
  let best = 1e9;
  for (let s = 0; s < 700; s++) {
    ivy += GRAV * h; ivx += game.wind * 26 * h;
    x += ivx * h; y += ivy * h; ig -= h;
    const d = Math.hypot(x - t.x, y - (t.y - 8));
    if (d < best) best = d;
    if (ig <= 0 && d < 14) return { hit: true, dist: 0 };
    if (ig <= 0 && solid(x, y)) return { hit: false, dist: best };
    if (x < -80 || x > W_W + 80 || y > W_H + 60) return { hit: false, dist: best };
  }
  return { hit: false, dist: best };
}
function cpuThrow() {
  let bestV = null, bestD = 1e9;
  for (let i = 0; i < 260; i++) {
    const ang = (100 + Math.random() * 70) * Math.PI / 180;   // nach links oben
    const pow = 250 + Math.random() * 420;
    const vx = Math.cos(ang) * pow, vy = -Math.sin(ang) * pow;
    const r = simulate(vx, vy);
    if (r.hit) { bestV = { vx, vy }; bestD = 0; break; }
    if (r.dist < bestD) { bestD = r.dist; bestV = { vx, vy }; }
  }
  if (!bestV) bestV = { vx: -350, vy: -350 };
  // Verwackeln: anfangs deutlich, wird pro Fehlwurf präziser
  const n = cpuNoise * 0.16;
  const vx = bestV.vx * (1 + (Math.random() - 0.5) * n);
  const vy = bestV.vy * (1 + (Math.random() - 0.5) * n);
  cpuNoise = Math.max(0.15, cpuNoise * 0.55);
  throwBanana(vx, vy);
}

// ---- Rendering -------------------------------------------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const stage = document.getElementById('stage');
let CW = 0, CH = 0, S = 1, OX = 0, OY = 0;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rot = stage.classList.contains('rot');
  CW = rot ? window.innerHeight : window.innerWidth;
  CH = rot ? window.innerWidth : window.innerHeight;
  canvas.width = Math.round(CW * dpr); canvas.height = Math.round(CH * dpr);
  canvas.style.width = CW + 'px'; canvas.style.height = CH + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  S = clamp(Math.min(CW / W_W, (CH - 90) / W_H), 0.2, 3);
  OX = (CW - W_W * S) / 2;
  OY = 64 + Math.max(0, (CH - 90 - W_H * S) / 2);
}
window.addEventListener('resize', resize);
function pointerToCanvas(e) {
  if (stage.classList.contains('rot')) return { x: e.clientY, y: window.innerWidth - e.clientX };
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function draw(time) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0d1b2e'; ctx.fillRect(0, 0, CW, CH);

  ctx.save();
  ctx.translate(OX, OY); ctx.scale(S, S);

  // Nachthimmel
  const sky = ctx.createLinearGradient(0, 0, 0, W_H);
  sky.addColorStop(0, '#16294a'); sky.addColorStop(1, '#33507a');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W_W, W_H);
  // Sterne (deterministisch)
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  for (let i = 0; i < 40; i++) {
    const sx = (i * 197) % W_W, sy = (i * 89) % 200;
    ctx.fillRect(sx, sy, 2, 2);
  }
  drawSun(time);
  ctx.drawImage(cityCanvas, 0, 0);
  drawGorilla(0, time);
  drawGorilla(1, time);
  if (banana) drawBanana();
  for (const p of parts) {
    ctx.globalAlpha = 1 - p.t / p.ttl; ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4); ctx.globalAlpha = 1;
  }
  if (aim.active && game.phase === 'aim') drawAim();
  ctx.restore();

  drawHUD();
}

function drawSun(time) {
  ctx.save(); ctx.translate(sun.x, sun.y);
  ctx.fillStyle = '#ffd166';
  ctx.beginPath(); ctx.arc(0, 0, 22, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 3;
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * TAU + time * 0.2;
    ctx.beginPath(); ctx.moveTo(Math.cos(a) * 27, Math.sin(a) * 27); ctx.lineTo(Math.cos(a) * 34, Math.sin(a) * 34); ctx.stroke();
  }
  ctx.fillStyle = '#7a5c00';
  if (sun.shock > 0) {
    ctx.beginPath(); ctx.arc(-7, -4, 2.6, 0, TAU); ctx.arc(7, -4, 2.6, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(0, 7, 5, 0, TAU); ctx.fill();   // O-Mund
  } else {
    ctx.beginPath(); ctx.arc(-7, -4, 2.2, 0, TAU); ctx.arc(7, -4, 2.2, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(0, 3, 9, 0.15 * Math.PI, 0.85 * Math.PI); ctx.lineWidth = 2.4; ctx.strokeStyle = '#7a5c00'; ctx.stroke();
  }
  ctx.restore();
}

function drawGorilla(i, time) {
  const g = gorillas[i];
  const active = game.turn === i && game.phase === 'aim';
  const jump = game.phase === 'score' && game.roundWinner === i ? Math.abs(Math.sin(time * 8)) * 10 : 0;
  ctx.save(); ctx.translate(g.x, g.y - jump);
  // Körper
  ctx.fillStyle = '#4a3626';
  ctx.beginPath(); ctx.ellipse(0, -6, 11, 10, 0, 0, TAU); ctx.fill();
  // Kopf
  ctx.beginPath(); ctx.arc(0, -17, 7, 0, TAU); ctx.fill();
  // Gesicht
  ctx.fillStyle = '#8a7057';
  ctx.beginPath(); ctx.ellipse(0, -15.5, 4.6, 3.4, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#221610';
  ctx.beginPath(); ctx.arc(-2, -17.5, 1, 0, TAU); ctx.arc(2, -17.5, 1, 0, TAU); ctx.fill();
  // Arme (der aktive hebt einen Arm)
  ctx.strokeStyle = '#4a3626'; ctx.lineWidth = 5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-8, -8); ctx.lineTo(-14, active ? -22 : 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(8, -8); ctx.lineTo(14, 2); ctx.stroke();
  // Beine
  ctx.beginPath(); ctx.moveTo(-5, 2); ctx.lineTo(-7, 10); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(5, 2); ctx.lineTo(7, 10); ctx.stroke();
  ctx.restore();
  // Marker über dem aktiven Gorilla
  if (active) {
    ctx.fillStyle = '#ffd166'; ctx.textAlign = 'center'; ctx.font = 'bold 13px system-ui';
    ctx.fillText('▼', g.x, g.y - 34 + Math.sin(time * 4) * 2);
  }
}

function drawBanana() {
  ctx.save(); ctx.translate(banana.x, banana.y); ctx.rotate(banana.rot);
  ctx.strokeStyle = '#ffe135'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(0, -3, 7, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  ctx.restore();
}

// ---- Zielen (Steinschleuder) -----------------------------------------------
const aim = { active: false, sx: 0, sy: 0, cx: 0, cy: 0 };
function aimVector() {
  // Zieh-Vektor umgekehrt (Schleuder), Faktor -> Wurfstärke
  const dx = (aim.sx - aim.cx) * 2.4, dy = (aim.sy - aim.cy) * 2.4;
  const len = Math.hypot(dx, dy);
  const capped = Math.min(len, 780);
  const f = len > 0 ? capped / len : 0;
  return { vx: dx * f, vy: dy * f, pow: capped };
}
function drawAim() {
  const g = gorillas[game.turn];
  const v = aimVector();
  if (v.pow < 30) return;
  const ex = g.x + v.vx * 0.22, ey = g.y - 14 + v.vy * 0.22;
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.setLineDash([4, 5]); ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(g.x, g.y - 14); ctx.lineTo(ex, ey); ctx.stroke(); ctx.setLineDash([]);
  const a = Math.atan2(ey - (g.y - 14), ex - g.x);
  ctx.save(); ctx.translate(ex, ey); ctx.rotate(a);
  ctx.fillStyle = '#ffd166';
  ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-4, -5); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill();
  ctx.restore();
  // Kraftanzeige
  ctx.fillStyle = 'rgba(8,25,42,0.6)';
  ctx.fillRect(g.x - 26, g.y + 16, 52, 7);
  ctx.fillStyle = v.pow > 640 ? '#ff6a5a' : '#8fe0b6';
  ctx.fillRect(g.x - 26, g.y + 16, 52 * v.pow / 780, 7);
}

function humanTurn() { return game.phase === 'aim' && !(game.mode === 'cpu' && game.turn === 1); }

canvas.addEventListener('pointerdown', (e) => {
  if (!humanTurn()) return;
  const c = pointerToCanvas(e);
  aim.active = true;
  aim.sx = (c.x - OX) / S; aim.sy = (c.y - OY) / S;
  aim.cx = aim.sx; aim.cy = aim.sy;
  try { canvas.setPointerCapture(e.pointerId); } catch { /* egal */ }
});
canvas.addEventListener('pointermove', (e) => {
  if (!aim.active) return;
  const c = pointerToCanvas(e);
  aim.cx = (c.x - OX) / S; aim.cy = (c.y - OY) / S;
});
function release() {
  if (!aim.active) return;
  aim.active = false;
  if (!humanTurn()) return;
  const v = aimVector();
  if (v.pow < 50) return;   // zu schwach = abgebrochen
  throwBanana(v.vx, v.vy);
}
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', () => { aim.active = false; });

// ---- HUD -------------------------------------------------------------------
function drawHUD() {
  // Punkte
  ctx.fillStyle = 'rgba(8,25,42,0.72)'; roundRect(8, 8, CW - 16, 40, 9); ctx.fill();
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 15px system-ui';
  ctx.textAlign = 'left'; ctx.fillStyle = game.turn === 0 && game.phase === 'aim' ? '#ffd166' : '#eaf3fa';
  ctx.fillText('🦍 ' + playerName(0) + '  ' + game.score[0], 108, 28);
  ctx.textAlign = 'right'; ctx.fillStyle = game.turn === 1 && game.phase === 'aim' ? '#ffd166' : '#eaf3fa';
  ctx.fillText(game.score[1] + '  ' + playerName(1) + ' 🦍', CW - 16, 28);
  // Wind
  ctx.textAlign = 'center'; ctx.fillStyle = '#9fc0d8'; ctx.font = '11px system-ui';
  ctx.fillText('Wind', CW / 2, 17);
  const wl = game.wind * 40;
  ctx.strokeStyle = Math.abs(game.wind) > 0.5 ? '#ffb24d' : 'rgba(255,255,255,0.8)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(CW / 2 - wl, 32); ctx.lineTo(CW / 2 + wl, 32); ctx.stroke();
  if (Math.abs(wl) > 3) {
    const dir = Math.sign(wl);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath(); ctx.moveTo(CW / 2 + wl + dir * 7, 32); ctx.lineTo(CW / 2 + wl, 28); ctx.lineTo(CW / 2 + wl, 36); ctx.fill();
  }
  ctx.textBaseline = 'alphabetic';

  // Banner
  if (game.bannerT > 0) {
    ctx.globalAlpha = clamp(game.bannerT, 0, 1);
    ctx.fillStyle = 'rgba(8,25,42,0.85)'; roundRect(CW / 2 - 175, 58, 350, 44, 10); ctx.fill();
    ctx.fillStyle = game.phase === 'over' ? '#ffd166' : '#fff';
    ctx.font = 'bold 18px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(game.banner, CW / 2, 80);
    ctx.textBaseline = 'alphabetic'; ctx.globalAlpha = 1;
  }
  if (game.phase === 'over') {
    ctx.fillStyle = '#9fc0d8'; ctx.font = '13px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('Tippe für ein neues Match', CW / 2, 116);
  }
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
canvas.addEventListener('pointerdown', () => { if (game.phase === 'over') newMatch(); });

// ---- Menü ------------------------------------------------------------------
const menuEl = document.getElementById('menu');
const helpEl = document.getElementById('help');
document.getElementById('btn-menu').addEventListener('click', () => menuEl.classList.remove('hidden'));
document.getElementById('btn-menu-close').addEventListener('click', () => menuEl.classList.add('hidden'));
menuEl.addEventListener('click', (e) => { if (e.target === menuEl) menuEl.classList.add('hidden'); });
document.getElementById('btn-help').addEventListener('click', () => { menuEl.classList.add('hidden'); helpEl.classList.remove('hidden'); });
document.getElementById('btn-start').addEventListener('click', () => helpEl.classList.add('hidden'));
document.getElementById('btn-restart').addEventListener('click', () => { menuEl.classList.add('hidden'); newMatch(); });
document.getElementById('btn-rotate').addEventListener('click', () => { stage.classList.toggle('rot'); resize(); });
const modeCpu = document.getElementById('mode-cpu'), mode2p = document.getElementById('mode-2p');
modeCpu.addEventListener('click', () => { game.mode = 'cpu'; modeCpu.classList.add('active'); mode2p.classList.remove('active'); menuEl.classList.add('hidden'); newMatch(); });
mode2p.addEventListener('click', () => { game.mode = '2p'; mode2p.classList.add('active'); modeCpu.classList.remove('active'); menuEl.classList.add('hidden'); newMatch(); });

// ---- Schleife --------------------------------------------------------------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.04, (now - last) / 1000); last = now;
  step(dt);
  draw(now / 1000);
  requestAnimationFrame(frame);
}

window.__gor = { game, gorillas, throwBanana, get banana() { return banana; }, solid, newMatch, newRound,
  get mask() { return mask; }, cpuThrow, simulate, aim };

if (window.innerWidth < window.innerHeight) stage.classList.add('rot');
resize();
newMatch();
requestAnimationFrame(frame);
