// Super Maze – prozedural generierte Labyrinthe mit Laternen-Nebel und Sternen.
// Jedes Level wird größer; Punkte für Ankunft, Sterne und Restzeit.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const TAU = Math.PI * 2;

// ---- Labyrinth-Generator (Recursive Backtracker) ---------------------------
let COLS = 13, ROWS = 17;
let walls;                 // Uint8Array 1 = Wand
const idx = () => 0;       // wird pro Level neu gebunden
let at, setW;
function bindGrid() {
  at = (x, y) => (x < 0 || x >= COLS || y < 0 || y >= ROWS) ? 1 : walls[y * COLS + x];
  setW = (x, y, v) => { walls[y * COLS + x] = v; };
}

function genMaze() {
  walls = new Uint8Array(COLS * ROWS).fill(1);
  bindGrid();
  // Backtracker auf ungeraden Zellen
  const stack = [[1, 1]];
  setW(1, 1, 0);
  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const dirs = [[2, 0], [-2, 0], [0, 2], [0, -2]].sort(() => Math.random() - 0.5);
    let moved = false;
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (nx > 0 && nx < COLS - 1 && ny > 0 && ny < ROWS - 1 && at(nx, ny) === 1) {
        setW(cx + dx / 2, cy + dy / 2, 0);
        setW(nx, ny, 0);
        stack.push([nx, ny]);
        moved = true;
        break;
      }
    }
    if (!moved) stack.pop();
  }
  // ein paar zusätzliche Durchbrüche -> Schleifen, weniger frustig
  const extra = ((COLS * ROWS) / 60) | 0;
  for (let i = 0; i < extra; i++) {
    const x = 1 + ((Math.random() * (COLS - 2)) | 0), y = 1 + ((Math.random() * (ROWS - 2)) | 0);
    if (at(x, y) === 1 && ((at(x - 1, y) === 0 && at(x + 1, y) === 0) || (at(x, y - 1) === 0 && at(x, y + 1) === 0))) setW(x, y, 0);
  }
}

// Sackgassen finden (für Sterne)
function deadEnds() {
  const out = [];
  for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) {
    if (at(x, y) === 1) continue;
    let open = 0;
    if (!at(x + 1, y)) open++; if (!at(x - 1, y)) open++;
    if (!at(x, y + 1)) open++; if (!at(x, y - 1)) open++;
    if (open === 1 && !(x === 1 && y === 1) && !(x === COLS - 2 && y === ROWS - 2)) out.push([x, y]);
  }
  return out;
}

// ---- Zustand ---------------------------------------------------------------
const game = {
  level: 1, score: 0, best: 0, timeLeft: 0,
  state: 'ready', stateT: 1.2, stars: 0, paused: false,
};
let player, exitPos, stars;

function levelSize(lv) {
  const c = clamp(11 + (lv - 1) * 2, 11, 27);
  const r = clamp(15 + (lv - 1) * 2, 15, 37);
  return [c | 1, r | 1];   // ungerade halten
}

function startLevel() {
  [COLS, ROWS] = levelSize(game.level);
  genMaze();
  player = { x: 1.5, y: 1.5, tx: 1, ty: 1, dir: { x: 0, y: 0 }, queued: null };
  exitPos = { x: COLS - 2, y: ROWS - 2 };
  // 3 Sterne auf zufällige Sackgassen
  const de = deadEnds().sort(() => Math.random() - 0.5);
  stars = de.slice(0, 3).map(([x, y]) => ({ x, y }));
  game.stars = 0;
  game.timeLeft = 25 + COLS * ROWS * 0.06;
  game.state = 'ready'; game.stateT = 1.1;
  resize();
}

function newGame() {
  game.level = 1; game.score = 0;
  startLevel();
}

// ---- Bewegung (Kachel zu Kachel, Wunschrichtung an Kreuzungen) -------------
const SPEED = 6.2;   // Kacheln/s
function update(dt) {
  if (game.state === 'ready') { game.stateT -= dt; if (game.stateT <= 0) game.state = 'play'; return; }
  if (game.state === 'won') {
    game.stateT -= dt;
    if (game.stateT <= 0) { game.level++; startLevel(); }
    return;
  }
  if (game.state !== 'play') return;

  game.timeLeft -= dt;
  if (game.timeLeft <= 0) { game.timeLeft = 0; game.state = 'over'; saveBest(); return; }

  const p = player;
  // an der Kachelmitte: Richtung wählen
  const cx = p.tx + 0.5, cy = p.ty + 0.5;
  const atCenter = Math.abs(p.x - cx) < 0.09 && Math.abs(p.y - cy) < 0.09;
  if (atCenter) {
    p.x = cx; p.y = cy;
    if (p.queued && !at(p.tx + p.queued.x, p.ty + p.queued.y)) p.dir = { ...p.queued };
    if (at(p.tx + p.dir.x, p.ty + p.dir.y)) p.dir = { x: 0, y: 0 };
    if (p.dir.x || p.dir.y) { p.tx += p.dir.x; p.ty += p.dir.y; }
  }
  const txc = p.tx + 0.5, tyc = p.ty + 0.5;
  const d = SPEED * dt;
  p.x += clamp(txc - p.x, -d, d);
  p.y += clamp(tyc - p.y, -d, d);

  // Stern einsammeln
  for (let i = stars.length - 1; i >= 0; i--) {
    if (stars[i].x === p.tx && stars[i].y === p.ty && Math.abs(p.x - (stars[i].x + 0.5)) < 0.4 && Math.abs(p.y - (stars[i].y + 0.5)) < 0.4) {
      stars.splice(i, 1); game.stars++; game.score += 50;
    }
  }
  // Ausgang erreicht
  if (p.tx === exitPos.x && p.ty === exitPos.y && Math.abs(p.x - (exitPos.x + 0.5)) < 0.3) {
    game.score += 100 * game.level + (game.timeLeft | 0);
    game.state = 'won'; game.stateT = 1.4;
    saveBest();
  }
}

// ---- Highscore -------------------------------------------------------------
function loadBest() { try { game.best = parseInt(localStorage.getItem('maze_best') || '0', 10) || 0; } catch { game.best = 0; } }
function saveBest() {
  if (game.score > game.best) {
    game.best = game.score;
    try { localStorage.setItem('maze_best', String(game.best)); } catch { /* egal */ }
  }
}

// ---- Rendering -------------------------------------------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let CW = 0, CH = 0, T = 20, OX = 0, OY = 0;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  CW = window.innerWidth; CH = window.innerHeight;
  canvas.width = Math.round(CW * dpr); canvas.height = Math.round(CH * dpr);
  canvas.style.width = CW + 'px'; canvas.style.height = CH + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  T = Math.min(CW / COLS, (CH - 120) / ROWS);
  OX = (CW - COLS * T) / 2;
  OY = 92 + Math.max(0, (CH - 120 - ROWS * T) / 2 - 20);
}
window.addEventListener('resize', resize);

function draw(time) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0a1220'; ctx.fillRect(0, 0, CW, CH);

  ctx.save(); ctx.translate(OX, OY);
  // Boden + Wände
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (at(x, y)) {
      ctx.fillStyle = '#2c4066';
      ctx.fillRect(x * T, y * T, T + 0.5, T + 0.5);
    } else {
      ctx.fillStyle = (x + y) % 2 ? '#141f33' : '#121d30';
      ctx.fillRect(x * T, y * T, T + 0.5, T + 0.5);
    }
  }
  // Ausgang
  ctx.fillStyle = '#2ecc71';
  ctx.fillRect(exitPos.x * T + T * 0.15, exitPos.y * T + T * 0.1, T * 0.7, T * 0.8);
  ctx.fillStyle = '#0d3320';
  ctx.fillRect(exitPos.x * T + T * 0.25, exitPos.y * T + T * 0.2, T * 0.5, T * 0.7);
  // Sterne
  ctx.font = (T * 0.72) + 'px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const s of stars) {
    const bob = Math.sin(time * 3 + s.x) * T * 0.05;
    ctx.fillText('⭐', s.x * T + T / 2, s.y * T + T / 2 + bob);
  }
  // Spieler
  const px = player.x * T, py = player.y * T;
  ctx.fillStyle = '#ffd166';
  ctx.beginPath(); ctx.arc(px, py, T * 0.34, 0, TAU); ctx.fill();
  ctx.fillStyle = '#5a3d00';
  const ex = player.dir.x * T * 0.1, ey = player.dir.y * T * 0.1;
  ctx.beginPath();
  ctx.arc(px - T * 0.1 + ex, py - T * 0.06 + ey, T * 0.06, 0, TAU);
  ctx.arc(px + T * 0.1 + ex, py - T * 0.06 + ey, T * 0.06, 0, TAU);
  ctx.fill();

  // Laternen-Nebel: dunkle Fläche mit weichem Lichtloch am Spieler
  const R = T * 4.6;
  const grad = ctx.createRadialGradient(px, py, R * 0.35, px, py, R);
  grad.addColorStop(0, 'rgba(6,10,18,0)');
  grad.addColorStop(1, 'rgba(6,10,18,0.96)');
  ctx.fillStyle = grad;
  ctx.fillRect(-OX, -OY, CW, CH);
  ctx.restore();

  drawHUD();
}

function drawHUD() {
  ctx.fillStyle = 'rgba(8,25,42,0.75)'; roundRectP(8, 8, CW - 16, 40, 9); ctx.fill();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left'; ctx.fillStyle = '#eaf3fa'; ctx.font = 'bold 15px system-ui';
  ctx.fillText('🏆 ' + game.score, 104, 28);
  ctx.fillStyle = '#9fc0d8'; ctx.font = '12px system-ui';
  ctx.fillText('Best ' + game.best + ' · Lv ' + game.level + ' · ' + '⭐'.repeat(game.stars) + '☆'.repeat(Math.max(0, 3 - game.stars)), 190, 28);
  ctx.textAlign = 'right';
  ctx.fillStyle = game.timeLeft < 10 ? '#ff6a5a' : '#eaf3fa'; ctx.font = 'bold 15px system-ui';
  ctx.fillText('⏱ ' + Math.ceil(game.timeLeft) + 's', CW - 14, 28);
  ctx.textBaseline = 'alphabetic';

  const mid = OY + (ROWS * T) / 2;
  if (game.state === 'ready') centerText('Level ' + game.level, '#ffd166', mid);
  if (game.paused && game.state === 'play') centerText('⏸ Pause', '#fff', mid);
  if (game.state === 'won') centerText('🚪 Geschafft! +' + (100 * game.level) + ' & Bonus', '#8fe0b6', mid);
  if (game.state === 'over') {
    centerText('⏱ Zeit um! ' + game.score + ' Punkte', '#ff6a5a', mid);
    ctx.fillStyle = '#9fc0d8'; ctx.font = '13px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('Tippe für einen neuen Versuch', CW / 2, mid + 30);
  }
}
function centerText(text, color, y) {
  ctx.fillStyle = 'rgba(8,16,30,0.8)'; roundRectP(CW / 2 - 160, y - 24, 320, 44, 10); ctx.fill();
  ctx.fillStyle = color; ctx.font = 'bold 19px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, CW / 2, y - 2); ctx.textBaseline = 'alphabetic';
}
function roundRectP(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ---- Eingabe ---------------------------------------------------------------
function setDir(x, y) { player.queued = { x, y }; }
window.addEventListener('keydown', (e) => {
  const k = e.key;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(k)) e.preventDefault();
  if (k === 'ArrowLeft') setDir(-1, 0);
  if (k === 'ArrowRight') setDir(1, 0);
  if (k === 'ArrowUp') setDir(0, -1);
  if (k === 'ArrowDown') setDir(0, 1);
  if (k === ' ') togglePause();
});
let touchS = null;
canvas.addEventListener('pointerdown', (e) => {
  touchS = { x: e.clientX, y: e.clientY };
  if (game.state === 'over') newGame();
});
canvas.addEventListener('pointermove', (e) => {
  if (!touchS) return;
  const dx = e.clientX - touchS.x, dy = e.clientY - touchS.y;
  if (Math.hypot(dx, dy) < 22) return;
  if (Math.abs(dx) > Math.abs(dy)) setDir(Math.sign(dx), 0);
  else setDir(0, Math.sign(dy));
  touchS = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointerup', () => { touchS = null; });

// ---- Menü ------------------------------------------------------------------
const menuEl = document.getElementById('menu');
const helpEl = document.getElementById('help');
document.getElementById('btn-menu').addEventListener('click', () => menuEl.classList.remove('hidden'));
document.getElementById('btn-menu-close').addEventListener('click', () => menuEl.classList.add('hidden'));
menuEl.addEventListener('click', (e) => { if (e.target === menuEl) menuEl.classList.add('hidden'); });
document.getElementById('btn-help').addEventListener('click', () => { menuEl.classList.add('hidden'); helpEl.classList.remove('hidden'); });
document.getElementById('btn-start').addEventListener('click', () => helpEl.classList.add('hidden'));
document.getElementById('btn-restart').addEventListener('click', () => { menuEl.classList.add('hidden'); newGame(); });
document.getElementById('btn-pause').addEventListener('click', togglePause);
function togglePause() { if (game.state === 'play' || game.paused) game.paused = !game.paused; }

// ---- Schleife --------------------------------------------------------------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!game.paused) update(dt);
  draw(now / 1000);
  requestAnimationFrame(frame);
}

window.__maze = { game, get player() { return player; }, get stars() { return stars; }, get exitPos() { return exitPos; },
  at: (x, y) => at(x, y), setDir, newGame, startLevel, dims: () => [COLS, ROWS] };

loadBest();
newGame();
requestAnimationFrame(frame);
