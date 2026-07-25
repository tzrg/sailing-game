// Mampf – Labyrinth-Fresser im Stil des Arcade-Urgesteins, eigenständig gebaut.
// Punkte fressen, Geistern ausweichen, Kraftpillen drehen den Spieß um.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const TAU = Math.PI * 2;

// ---- Labyrinth (19 x 21) ---------------------------------------------------
// # Wand · . Punkt · o Kraftpille · ' ' leerer Weg · - Geistertür · G Geisterhaus · C Start
const MAZE_SRC = [
  '###################',
  '#........#........#',
  '#o##.###.#.###.##o#',
  '#.................#',
  '#.##.#.#####.#.##.#',
  '#....#...#...#....#',
  '####.###.#.###.####',
  '####.#.......#.####',
  '####.#.##-##.#.####',
  '    ...#GGG#...    ',
  '####.#.#####.#.####',
  '####.#.......#.####',
  '####.#.#####.#.####',
  '#........#........#',
  '#.##.###.#.###.##.#',
  '#o.#.....C.....#.o#',
  '##.#.#.#####.#.#.##',
  '#....#...#...#....#',
  '#.######.#.######.#',
  '#.................#',
  '###################',
];
const COLS = 19, ROWS = 21;
const TUNNEL_ROW = 9;

let walls, pellets, powers, door, houseTiles, pacStart, ghostStarts;
function parseMaze() {
  walls = new Set(); pellets = new Set(); powers = new Set();
  houseTiles = []; ghostStarts = [];
  for (let y = 0; y < ROWS; y++) {
    const row = MAZE_SRC[y];
    for (let x = 0; x < COLS; x++) {
      const c = row[x];
      const k = x + ',' + y;
      if (c === '#') walls.add(k);
      else if (c === '.') pellets.add(k);
      else if (c === 'o') powers.add(k);
      else if (c === '-') door = { x, y };
      else if (c === 'G') { houseTiles.push({ x, y }); ghostStarts.push({ x, y }); }
      else if (c === 'C') pacStart = { x, y };
    }
  }
}
function isWall(x, y, canDoor) {
  if (y === TUNNEL_ROW) { if (x < 0) x = COLS - 1; if (x >= COLS) x = 0; }
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return true;
  if (door && x === door.x && y === door.y) return !canDoor;
  return walls.has(x + ',' + y);
}

// ---- Zustand ---------------------------------------------------------------
const GHOST_DEF = [
  { name: 'Rufus', color: '#ff5548' },
  { name: 'Rosa', color: '#ff9edb' },
  { name: 'Ziggy', color: '#39d5e8' },
  { name: 'Otto', color: '#ffb14d' },
];
const CORNERS = [[COLS - 2, 1], [1, 1], [COLS - 2, ROWS - 2], [1, ROWS - 2]];

const game = {
  score: 0, best: 0, lives: 3, level: 1,
  state: 'ready',   // ready | play | dying | over | levelup
  stateT: 1.2, frightT: 0, chain: 0, modeT: 7, mode: 'scatter', paused: false,
};
let pac, ghosts, pelletsLeft;

function mkEntity(tx, ty) {
  return { x: tx + 0.5, y: ty + 0.5, dir: { x: 0, y: 0 }, tx, ty };
}
function resetPositions() {
  pac = mkEntity(pacStart.x, pacStart.y);
  pac.dir = { x: -1, y: 0 }; pac.queued = { x: -1, y: 0 }; pac.mouth = 0;
  ghosts = GHOST_DEF.map((d, i) => {
    const s = ghostStarts[i % ghostStarts.length];
    const g = mkEntity(s.x, s.y);
    g.name = d.name; g.color = d.color; g.i = i;
    g.state = 'house';                   // house | out | eyes
    g.releaseT = i === 0 ? 0.5 : 2.5 + i * 2.5;
    g.dir = { x: 0, y: 0 };
    return g;
  });
  game.frightT = 0; game.chain = 0; game.mode = 'scatter'; game.modeT = 7;
}
function newLevelPellets() {
  parseMaze();
  pelletsLeft = pellets.size + powers.size;
}
function newGame() {
  game.score = 0; game.lives = 3; game.level = 1;
  game.state = 'ready'; game.stateT = 1.6; game.paused = false;
  newLevelPellets();
  resetPositions();
}

// ---- Geschwindigkeit -------------------------------------------------------
function pacSpeed() { return 4.6 + game.level * 0.15; }          // Kacheln/s
function ghostSpeed(g) {
  if (g.state === 'eyes') return 8;
  if (game.frightT > 0 && g.state === 'out') return 2.6;
  if (g.ty === TUNNEL_ROW) return 2.6;
  return 3.9 + game.level * 0.22;
}

// ---- Bewegung --------------------------------------------------------------
function atCenter(e) { return Math.abs(e.x - (e.tx + 0.5)) < 0.08 && Math.abs(e.y - (e.ty + 0.5)) < 0.08; }

function moveEntity(e, speed, dt, canDoor) {
  let rest = speed * dt;
  while (rest > 0) {
    const cx = e.tx + 0.5, cy = e.ty + 0.5;
    const distToCenter = (e.dir.x !== 0) ? (cx - e.x) * Math.sign(e.dir.x) : (cy - e.y) * Math.sign(e.dir.y || 1);
    if (e.dir.x === 0 && e.dir.y === 0) break;
    const toCenter = Math.max(0, distToCenter);
    const stepLen = Math.min(rest, toCenter > 0 ? toCenter : rest);
    e.x += e.dir.x * stepLen; e.y += e.dir.y * stepLen;
    rest -= stepLen;
    // Tunnel-Wrap
    if (e.ty === TUNNEL_ROW) {
      if (e.x < -0.5) { e.x += COLS; e.tx = COLS - 1; }
      if (e.x > COLS + 0.5) { e.x -= COLS; e.tx = 0; }
    }
    if (toCenter > 0 && stepLen >= toCenter - 1e-9) {
      // Kachelmitte erreicht -> neue Richtung wählen
      e.x = cx; e.y = cy;
      e.chooseDir(canDoor);
      const nx = e.tx + e.dir.x, ny = e.ty + e.dir.y;
      if (isWall(nx, ny, canDoor)) { e.dir = { x: 0, y: 0 }; break; }
      e.tx = (ny === TUNNEL_ROW && nx < 0) ? COLS - 1 : (ny === TUNNEL_ROW && nx >= COLS) ? 0 : nx;
      e.ty = ny;
    } else if (toCenter <= 0) {
      // bereits hinter der Mitte (frisch gesetzt) -> Zielkachel fortschreiben
      const nx = e.tx + e.dir.x, ny = e.ty + e.dir.y;
      if (isWall(nx, ny, canDoor)) break;
      e.tx = (ny === TUNNEL_ROW && nx < 0) ? COLS - 1 : (ny === TUNNEL_ROW && nx >= COLS) ? 0 : nx;
      e.ty = ny;
    }
  }
}

// Pac: an Kachelmitten Wunschrichtung übernehmen, wenn frei
function pacChoose() {
  const q = pac.queued;
  if (q && !isWall(pac.tx + q.x, pac.ty + q.y, false)) pac.dir = { x: q.x, y: q.y };
  if (isWall(pac.tx + pac.dir.x, pac.ty + pac.dir.y, false)) pac.dir = { x: 0, y: 0 };
}

// Geister: Zielkachel je Persönlichkeit; an Kreuzungen Richtung Richtung Ziel
function ghostTarget(g) {
  if (g.state === 'eyes') return [door.x, door.y - 0];
  if (game.frightT > 0) return null;   // zufällig
  if (game.mode === 'scatter') return CORNERS[g.i];
  switch (g.i) {
    case 0: return [pac.tx, pac.ty];
    case 1: return [pac.tx + pac.dir.x * 4, pac.ty + pac.dir.y * 4];
    case 2: return [pac.tx + pac.dir.x * 2 + ((Math.random() * 5) | 0) - 2, pac.ty + pac.dir.y * 2 + ((Math.random() * 5) | 0) - 2];
    case 3: {
      const d = Math.hypot(g.tx - pac.tx, g.ty - pac.ty);
      return d > 8 ? [pac.tx, pac.ty] : CORNERS[3];
    }
  }
}
function ghostChoose(g) {
  const canDoor = g.state !== 'out' ? true : false;
  const opts = [];
  const dirs = [{ x: 0, y: -1 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 0 }];
  for (const d of dirs) {
    if (d.x === -g.dir.x && d.y === -g.dir.y && (g.dir.x || g.dir.y)) continue;   // kein Umkehren
    if (!isWall(g.tx + d.x, g.ty + d.y, canDoor)) opts.push(d);
  }
  if (!opts.length) { g.dir = { x: -g.dir.x, y: -g.dir.y }; return; }   // Sackgasse -> umdrehen
  const t = ghostTarget(g);
  if (!t) { g.dir = opts[(Math.random() * opts.length) | 0]; return; }
  let best = opts[0], bd = 1e9;
  for (const d of opts) {
    const dist = (g.tx + d.x - t[0]) ** 2 + (g.ty + d.y - t[1]) ** 2;
    if (dist < bd) { bd = dist; best = d; }
  }
  g.dir = best;
}

// ---- Update ----------------------------------------------------------------
function update(dt) {
  if (game.state === 'ready') { game.stateT -= dt; if (game.stateT <= 0) game.state = 'play'; return; }
  if (game.state === 'levelup') {
    game.stateT -= dt;
    if (game.stateT <= 0) { newLevelPellets(); resetPositions(); game.state = 'ready'; game.stateT = 1.2; }
    return;
  }
  if (game.state === 'dying') {
    game.stateT -= dt;
    if (game.stateT <= 0) {
      if (game.lives <= 0) { game.state = 'over'; saveBest(); }
      else { resetPositions(); game.state = 'ready'; game.stateT = 1.2; }
    }
    return;
  }
  if (game.state !== 'play') return;

  // Modus-Timer (Scatter/Chase im Wechsel)
  if (game.frightT > 0) {
    game.frightT -= dt;
    if (game.frightT <= 0) game.chain = 0;
  } else {
    game.modeT -= dt;
    if (game.modeT <= 0) {
      game.mode = game.mode === 'scatter' ? 'chase' : 'scatter';
      game.modeT = game.mode === 'chase' ? 20 : 6;
      for (const g of ghosts) if (g.state === 'out') g.dir = { x: -g.dir.x, y: -g.dir.y };
    }
  }

  // Pac
  pac.chooseDir = pacChoose;
  pac.mouth += dt * 9;
  if (pac.dir.x === 0 && pac.dir.y === 0) pacChoose();   // an der Wand gestoppt -> Wunschrichtung erneut versuchen
  moveEntity(pac, pacSpeed(), dt, false);
  // fressen
  const k = pac.tx + ',' + pac.ty;
  if (pellets.has(k)) { pellets.delete(k); game.score += 10; pelletsLeft--; }
  if (powers.has(k)) {
    powers.delete(k); pelletsLeft--;
    game.score += 50; game.chain = 0;
    game.frightT = Math.max(3.5, 7 - game.level * 0.5);
    for (const g of ghosts) if (g.state === 'out') g.dir = { x: -g.dir.x, y: -g.dir.y };
  }
  if (pelletsLeft <= 0) { game.state = 'levelup'; game.stateT = 1.6; game.level++; saveBest(); return; }

  // Geister
  for (const g of ghosts) {
    if (g.state === 'house') {
      g.releaseT -= dt;
      g.y = g.ty + 0.5 + Math.sin(performance.now() / 220 + g.i) * 0.12;
      if (g.releaseT <= 0) {
        // durch die Tür nach draußen teleport-laufen (vereinfachte Ausfahrt)
        g.state = 'out';
        g.tx = door.x; g.ty = door.y - 1;
        g.x = g.tx + 0.5; g.y = g.ty + 0.5;
        g.dir = { x: Math.random() < 0.5 ? -1 : 1, y: 0 };
        if (isWall(g.tx + g.dir.x, g.ty, false)) g.dir.x = -g.dir.x;
      }
      continue;
    }
    g.chooseDir = () => ghostChoose(g);
    moveEntity(g, ghostSpeed(g), dt, g.state === 'eyes');
    if (g.state === 'eyes') {
      // Zuhause angekommen?
      if (Math.abs(g.tx - door.x) <= 0 && Math.abs(g.ty - door.y) <= 1) {
        const s = ghostStarts[g.i % ghostStarts.length];
        g.state = 'house'; g.releaseT = 2;
        g.tx = s.x; g.ty = s.y; g.x = s.x + 0.5; g.y = s.y + 0.5;
      }
      continue;
    }
    // Kollision mit Pac
    const d = Math.hypot(g.x - pac.x, g.y - pac.y);
    if (d < 0.7) {
      if (game.frightT > 0) {
        game.chain++;
        game.score += 100 * Math.pow(2, game.chain);   // 200/400/800/1600
        g.state = 'eyes';
      } else {
        game.lives--;
        game.state = 'dying'; game.stateT = 1.4;
        return;
      }
    }
  }
}

// ---- Highscore -------------------------------------------------------------
function loadBest() { try { game.best = parseInt(localStorage.getItem('mampf_best') || '0', 10) || 0; } catch { game.best = 0; } }
function saveBest() {
  if (game.score > game.best) {
    game.best = game.score;
    try { localStorage.setItem('mampf_best', String(game.best)); } catch { /* egal */ }
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
  ctx.fillStyle = '#08101e'; ctx.fillRect(0, 0, CW, CH);

  ctx.save(); ctx.translate(OX, OY);
  // Wände
  ctx.fillStyle = '#1a2f66';
  ctx.strokeStyle = '#3f63d8'; ctx.lineWidth = 2;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (!walls.has(x + ',' + y)) continue;
    ctx.fillRect(x * T + 1, y * T + 1, T - 2, T - 2);
  }
  ctx.strokeStyle = '#3f63d8';
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (!walls.has(x + ',' + y)) continue;
    ctx.strokeRect(x * T + 1.5, y * T + 1.5, T - 3, T - 3);
  }
  // Tür
  if (door) { ctx.fillStyle = '#ffb6d9'; ctx.fillRect(door.x * T + 2, door.y * T + T * 0.4, T - 4, T * 0.2); }
  // Punkte
  ctx.fillStyle = '#ffe8b0';
  for (const k of pellets) {
    const [x, y] = k.split(',').map(Number);
    ctx.beginPath(); ctx.arc(x * T + T / 2, y * T + T / 2, Math.max(1.6, T * 0.08), 0, TAU); ctx.fill();
  }
  // Kraftpillen (pulsierend)
  const pr = (Math.sin(time * 5) * 0.15 + 0.32) * T;
  for (const k of powers) {
    const [x, y] = k.split(',').map(Number);
    ctx.beginPath(); ctx.arc(x * T + T / 2, y * T + T / 2, pr, 0, TAU); ctx.fill();
  }
  // Pac
  drawPac(time);
  // Geister
  for (const g of ghosts) drawGhost(g, time);
  ctx.restore();

  drawHUD();
}

function drawPac(time) {
  const px = pac.x * T, py = pac.y * T;
  const dying = game.state === 'dying';
  const open = dying ? clamp((1.4 - game.stateT) / 1.4, 0, 1) * Math.PI : (Math.sin(pac.mouth) * 0.28 + 0.32);
  let ang = 0;
  if (pac.dir.x < 0) ang = Math.PI;
  else if (pac.dir.y < 0) ang = -Math.PI / 2;
  else if (pac.dir.y > 0) ang = Math.PI / 2;
  ctx.save(); ctx.translate(px, py); ctx.rotate(ang);
  ctx.fillStyle = '#ffe135';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, T * 0.44, open, TAU - open);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawGhost(g, time) {
  const gx = g.x * T, gy = g.y * T;
  const r = T * 0.42;
  const fright = game.frightT > 0 && g.state === 'out';
  const blink = fright && game.frightT < 2 && Math.floor(time * 6) % 2 === 0;
  ctx.save(); ctx.translate(gx, gy);
  if (g.state !== 'eyes') {
    ctx.fillStyle = fright ? (blink ? '#f4f6ff' : '#3947c9') : g.color;
    // Körper: Halbkreis + Zackenrock
    ctx.beginPath();
    ctx.arc(0, -r * 0.1, r, Math.PI, 0);
    const feet = 4;
    for (let i = 0; i <= feet * 2; i++) {
      const fx = r - (i / (feet * 2)) * 2 * r;
      const fy = r * 0.75 + ((i % 2) ? 0 : r * 0.22) - r * 0.1;
      ctx.lineTo(fx, fy);
    }
    ctx.closePath(); ctx.fill();
  }
  // Augen
  const ex = clamp(g.dir.x, -1, 1) * r * 0.18, ey = clamp(g.dir.y, -1, 1) * r * 0.18;
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(-r * 0.35, -r * 0.25, r * 0.26, 0, TAU); ctx.arc(r * 0.35, -r * 0.25, r * 0.26, 0, TAU); ctx.fill();
  ctx.fillStyle = fright ? '#c0392b' : '#20306b';
  ctx.beginPath(); ctx.arc(-r * 0.35 + ex, -r * 0.25 + ey, r * 0.13, 0, TAU); ctx.arc(r * 0.35 + ex, -r * 0.25 + ey, r * 0.13, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawHUD() {
  ctx.fillStyle = 'rgba(8,25,42,0.75)'; roundRect(8, 8, CW - 16, 40, 9); ctx.fill();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left'; ctx.fillStyle = '#eaf3fa'; ctx.font = 'bold 15px system-ui';
  ctx.fillText('🏆 ' + game.score, 104, 28);
  ctx.fillStyle = '#9fc0d8'; ctx.font = '12px system-ui';
  ctx.fillText('Best ' + game.best + ' · Lv ' + game.level, 190, 28);
  ctx.textAlign = 'right';
  ctx.font = '15px system-ui';
  ctx.fillText('❤️'.repeat(Math.max(0, game.lives)), CW - 14, 28);
  ctx.textBaseline = 'alphabetic';

  const mid = OY + (ROWS * T) / 2;
  if (game.state === 'ready') centerText('Bereit?', '#ffe135', mid);
  if (game.paused && game.state === 'play') centerText('⏸ Pause', '#fff', mid);
  if (game.state === 'levelup') centerText('Level ' + game.level + '!', '#8fe0b6', mid);
  if (game.state === 'over') {
    centerText('Game Over – ' + game.score + ' Punkte', '#ff6a5a', mid);
    ctx.fillStyle = '#9fc0d8'; ctx.font = '13px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('Tippe für ein neues Spiel', CW / 2, mid + 30);
  }
}
function centerText(text, color, y) {
  ctx.fillStyle = 'rgba(8,16,30,0.75)'; roundRect(CW / 2 - 150, y - 24, 300, 44, 10); ctx.fill();
  ctx.fillStyle = color; ctx.font = 'bold 20px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, CW / 2, y - 2); ctx.textBaseline = 'alphabetic';
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ---- Eingabe ---------------------------------------------------------------
function setDir(x, y) { pac.queued = { x, y }; }
window.addEventListener('keydown', (e) => {
  const k = e.key;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(k)) e.preventDefault();
  if (k === 'ArrowLeft') setDir(-1, 0);
  if (k === 'ArrowRight') setDir(1, 0);
  if (k === 'ArrowUp') setDir(0, -1);
  if (k === 'ArrowDown') setDir(0, 1);
  if (k === ' ') togglePause();
});
// Wischen
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
  touchS = { x: e.clientX, y: e.clientY };   // erlaubt mehrere Swipes am Stück
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

window.__mampf = { game, get pac() { return pac; }, get ghosts() { return ghosts; }, isWall, newGame,
  get pellets() { return pellets; }, get powers() { return powers; }, get pelletsLeft() { return pelletsLeft; },
  setDir, MAZE_SRC, pacStart: () => pacStart };

parseMaze();
loadBest();
resize();
newGame();
requestAnimationFrame(frame);
