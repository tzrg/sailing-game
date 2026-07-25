// Snake – der Handy-Klassiker. Äpfel fressen, wachsen, nicht anecken.
// Zwei Modi: Wände tödlich oder Durchgang (Wrap). Highscore in localStorage.

const COLS = 17, ROWS = 24;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const game = {
  state: 'ready',       // ready | play | over
  score: 0, best: 0, eaten: 0,
  wrap: false, paused: false,
  tick: 0.16, acc: 0,
};
let snake, dir, queued, food, bonus;   // bonus: {x,y,t} oder null

function key(x, y) { return x + ',' + y; }
function freeCell() {
  const used = new Set(snake.map((s) => key(s.x, s.y)));
  if (food) used.add(key(food.x, food.y));
  if (bonus) used.add(key(bonus.x, bonus.y));
  let x, y, tries = 0;
  do { x = (Math.random() * COLS) | 0; y = (Math.random() * ROWS) | 0; tries++; }
  while (used.has(key(x, y)) && tries < 500);
  return { x, y };
}

function newGame() {
  const cx = (COLS / 2) | 0, cy = (ROWS / 2) | 0;
  snake = [{ x: cx, y: cy }, { x: cx, y: cy + 1 }, { x: cx, y: cy + 2 }];
  dir = { x: 0, y: -1 }; queued = { x: 0, y: -1 };
  game.score = 0; game.eaten = 0; game.tick = 0.16; game.acc = 0;
  game.state = 'ready'; game.paused = false;
  bonus = null;
  food = freeCell();
}

function die() {
  game.state = 'over';
  saveBest();
}

function step() {
  // Richtungswunsch übernehmen (kein direktes Umkehren)
  if (!(queued.x === -dir.x && queued.y === -dir.y)) dir = { x: queued.x, y: queued.y };
  let nx = snake[0].x + dir.x, ny = snake[0].y + dir.y;
  if (game.wrap) {
    nx = (nx + COLS) % COLS; ny = (ny + ROWS) % ROWS;
  } else if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) { die(); return; }
  // Selbst-Kollision (Schwanzspitze zieht gleichzeitig weg -> letztes Glied ignorieren)
  for (let i = 0; i < snake.length - 1; i++) if (snake[i].x === nx && snake[i].y === ny) { die(); return; }

  snake.unshift({ x: nx, y: ny });
  let grew = false;
  if (food && nx === food.x && ny === food.y) {
    game.score += 1; game.eaten++;
    game.tick = Math.max(0.07, game.tick * 0.97);   // schneller!
    food = freeCell();
    grew = true;
    if (game.eaten % 5 === 0) bonus = { ...freeCell(), t: 6 };
  }
  if (bonus && nx === bonus.x && ny === bonus.y) { game.score += 5; bonus = null; grew = true; }
  if (!grew) snake.pop();
  else snake.push({ ...snake[snake.length - 1] });   // Wachsen: +1 extra Glied
}

function update(dt) {
  if (game.state !== 'play') return;
  if (bonus) { bonus.t -= dt; if (bonus.t <= 0) bonus = null; }
  game.acc += dt;
  while (game.acc >= game.tick) {
    game.acc -= game.tick;
    step();
    if (game.state !== 'play') break;
  }
}

// ---- Highscore -------------------------------------------------------------
function loadBest() { try { game.best = parseInt(localStorage.getItem('snake_best') || '0', 10) || 0; } catch { game.best = 0; } }
function saveBest() {
  if (game.score > game.best) {
    game.best = game.score;
    try { localStorage.setItem('snake_best', String(game.best)); } catch { /* egal */ }
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
  T = Math.floor(Math.min(CW / COLS, (CH - 120) / ROWS));
  OX = (CW - COLS * T) / 2;
  OY = 92 + Math.max(0, (CH - 120 - ROWS * T) / 2 - 20);
}
window.addEventListener('resize', resize);

function draw(time) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0a1626'; ctx.fillRect(0, 0, CW, CH);

  ctx.save(); ctx.translate(OX, OY);
  // Spielfeld (Schachbrett dezent)
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    ctx.fillStyle = (x + y) % 2 ? '#12233a' : '#102035';
    ctx.fillRect(x * T, y * T, T, T);
  }
  // Rand (nur im tödlichen Modus rot markiert)
  ctx.strokeStyle = game.wrap ? 'rgba(120,170,220,0.35)' : 'rgba(220,90,80,0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(-1, -1, COLS * T + 2, ROWS * T + 2);

  // Futter
  if (food) drawApple(food.x, food.y, time);
  if (bonus) {
    const blink = bonus.t < 2 && Math.floor(time * 5) % 2 === 0;
    if (!blink) { ctx.font = (T * 0.8) + 'px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🍒', bonus.x * T + T / 2, bonus.y * T + T / 2); }
  }

  // Schlange
  for (let i = snake.length - 1; i >= 0; i--) {
    const s = snake[i];
    const f = i / Math.max(1, snake.length - 1);
    ctx.fillStyle = i === 0 ? '#59d97a' : `rgb(${40 + f * 20},${170 - f * 60},${80 - f * 30})`;
    const pad = i === 0 ? 1 : 1.5;
    roundRectP(s.x * T + pad, s.y * T + pad, T - pad * 2, T - pad * 2, T * 0.28);
    ctx.fill();
  }
  // Augen
  if (snake.length) {
    const h = snake[0];
    ctx.fillStyle = '#0a2a12';
    const ex = dir.x * T * 0.15, ey = dir.y * T * 0.15;
    ctx.beginPath();
    ctx.arc(h.x * T + T * 0.35 + ex, h.y * T + T * 0.35 + ey, T * 0.08, 0, Math.PI * 2);
    ctx.arc(h.x * T + T * 0.65 + ex, h.y * T + T * 0.35 + ey, T * 0.08, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  drawHUD();
}
function drawApple(x, y, time) {
  const cx = x * T + T / 2, cy = y * T + T / 2;
  const r = T * (0.32 + Math.sin(time * 4) * 0.03);
  ctx.fillStyle = '#e0453e';
  ctx.beginPath(); ctx.arc(cx, cy + T * 0.03, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#57772e'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx, cy - r * 0.8); ctx.quadraticCurveTo(cx + T * 0.15, cy - r * 1.4, cx + T * 0.2, cy - r * 1.6); ctx.stroke();
}
function roundRectP(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function drawHUD() {
  ctx.fillStyle = 'rgba(8,25,42,0.75)'; roundRectP(8, 8, CW - 16, 40, 9); ctx.fill();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left'; ctx.fillStyle = '#eaf3fa'; ctx.font = 'bold 15px system-ui';
  ctx.fillText('🍎 ' + game.score, 104, 28);
  ctx.fillStyle = '#9fc0d8'; ctx.font = '12px system-ui';
  ctx.fillText('Best ' + game.best, 185, 28);
  ctx.textAlign = 'right';
  ctx.fillText(game.wrap ? 'Durchgang' : 'Wände', CW - 14, 28);
  ctx.textBaseline = 'alphabetic';

  const mid = OY + (ROWS * T) / 2;
  if (game.state === 'ready') centerText('Wisch los!', '#59d97a', mid);
  if (game.paused && game.state === 'play') centerText('⏸ Pause', '#fff', mid);
  if (game.state === 'over') {
    centerText('Game Over – ' + game.score + ' Punkte', '#ff6a5a', mid);
    ctx.fillStyle = '#9fc0d8'; ctx.font = '13px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('Tippe für ein neues Spiel', CW / 2, mid + 30);
  }
}
function centerText(text, color, y) {
  ctx.fillStyle = 'rgba(8,16,30,0.78)'; roundRectP(CW / 2 - 150, y - 24, 300, 44, 10); ctx.fill();
  ctx.fillStyle = color; ctx.font = 'bold 20px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, CW / 2, y - 2); ctx.textBaseline = 'alphabetic';
}

// ---- Eingabe ---------------------------------------------------------------
function setDir(x, y) {
  queued = { x, y };
  if (game.state === 'ready') game.state = 'play';
}
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
const modeWall = document.getElementById('mode-wall'), modeWrap = document.getElementById('mode-wrap');
modeWall.addEventListener('click', () => { game.wrap = false; modeWall.classList.add('active'); modeWrap.classList.remove('active'); menuEl.classList.add('hidden'); newGame(); });
modeWrap.addEventListener('click', () => { game.wrap = true; modeWrap.classList.add('active'); modeWall.classList.remove('active'); menuEl.classList.add('hidden'); newGame(); });

// ---- Schleife --------------------------------------------------------------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!game.paused) update(dt);
  draw(now / 1000);
  requestAnimationFrame(frame);
}

window.__snake = { game, get snake() { return snake; }, get food() { return food; }, get bonus() { return bonus; },
  setDir, newGame, step, COLS, ROWS };

loadBest();
resize();
newGame();
requestAnimationFrame(frame);
