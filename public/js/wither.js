// 💀 Wither-Duell – Bosskampf aus der Ich-Perspektive (Moorhuhn-Prinzip).
//
// Vor dir schwebt der Wither: drei Schädel, glühender Rumpf, feurige Schweife.
// Du hast eine 🏹 Armbrust (nach jedem Schuss nachladen) und ein 🛡️ Schild.
// Hinter dem Schild kann dir nichts passieren – aber du kannst dann weder
// schießen noch nachladen. Und genau da liegt der Haken: der Wither heilt sich
// ununterbrochen. Nur wer in den Angriffspausen mutig draufhält, bekommt ihn
// klein. Mit jedem Level wird er zäher, heilt schneller und greift öfter an.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

/* ------------------------------------------------------------ Spielwerte -- */

const RELOAD = 0.72;            // Sekunden zum Nachladen der Armbrust
const DMG_BODY = 9;             // Schaden auf den Rumpf
const DMG_HEAD = 16;            // Schaden auf einen Schädel
const REGEN_STOP = 0.45;        // so lange pausiert die Heilung nach einem Treffer
const PERFECT = 0.35;           // Schild so kurz vor dem Einschlag = perfekter Block
const DIFFS = { leicht: 0.7, normal: 1, hart: 1.35 };

// Je Level: Lebenspunkte, Heilung je Sekunde, Angriffstakt, Tempo, Feueranteil
function levelCfg(lv, diff = 1) {
  return {
    hp: Math.round(80 + (lv - 1) * 34),
    regen: (1.6 + (lv - 1) * 0.95) * diff,
    atkEvery: Math.max(1.15, (3.6 - (lv - 1) * 0.26) / diff),
    speed: 0.26 + (lv - 1) * 0.055,
    skulls: lv >= 8 ? 3 : lv >= 4 ? 2 : 1,
    breath: lv < 3 ? 0 : clamp(0.16 + (lv - 3) * 0.07, 0, 0.5),
    skullSpeed: 0.55 + (lv - 1) * 0.075,
  };
}

/* ------------------------------------------------------------- Pixel-Art -- */
// Alles Sichtbare entsteht als Klötzchen-Grafik: ein Pixel in der Vorlage ist
// ein Block. Die Vorlagen werden einmal in Offscreen-Canvas gemalt (mit
// Körnung, Licht- und Schattenkanten) und danach nur noch ungeglättet
// skaliert – das gibt die kantige Textur des Vorbilds statt glatter Flächen.

let gseed = 20260217;
const grain = () => ((gseed = (gseed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

// Helligkeit eines Hex-Tons verschieben (f < 1 dunkler, f > 1 heller)
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(Math.round(((n >> 16) & 255) * f), 0, 255);
  const g = clamp(Math.round(((n >> 8) & 255) * f), 0, 255);
  const b = clamp(Math.round((n & 255) * f), 0, 255);
  return `rgb(${r},${g},${b})`;
}

function sheet(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  return { c, g };
}

// Blockfläche mit Körnung: jeder Block bekommt seine eigene Helligkeit
function blocks(g, x, y, w, h, hex, spread = 0.14) {
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      g.fillStyle = spread ? shade(hex, 1 - spread / 2 + grain() * spread) : hex;
      g.fillRect(x + xx, y + yy, 1, 1);
    }
  }
}

// Vorlage aus Textzeilen malen ('.' bleibt frei)
function fromMap(map, pal, spread = 0.12) {
  const w = map[0].length, h = map.length;
  const { c, g } = sheet(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const hex = pal[map[y][x]];
      if (!hex) continue;
      g.fillStyle = spread ? shade(hex, 1 - spread / 2 + grain() * spread) : hex;
      g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

// Wither-Schädel (14x14): 1 Kontur, 2 Knochen, 3 Lichtkante, 4 Schatten,
// 5 Augenhöhle, 6 Glut im Auge, 7 Zähne, 8 Nasenloch
const SKULL_MAP = [
  '...11111111...',
  '..1133333311..',
  '.113333333331.',
  '11333333333311',
  '13322222222331',
  '13255522255231',
  '13256622665231',
  '13255522255231',
  '13322288222331',
  '11332222223311',
  '.113777777311.',
  '..1177117711..',
  '..1144444411..',
  '...11111111...',
];

// Farbtöne nach der Kinderzeichnung: brennendes Orange, Gelb und Pink
const BONE = {
  normal: { 2: '#d9b48c', 3: '#f0dcbb', 4: '#7d5a3c', 5: '#2a1410', 6: '#ff7a1f', 7: '#f6ecd8', 8: '#2a1410' },
  hot: { 2: '#e8a24a', 3: '#ffe3a0', 4: '#8a4a18', 5: '#3a1408', 6: '#fff4b0', 7: '#fff3dc', 8: '#4a1c0c' },
  hit: { 2: '#ffffff', 3: '#ffffff', 4: '#e8d8d4', 5: '#ff6a4a', 6: '#ffffff', 7: '#ffffff', 8: '#ffd0c0' },
};
const RIB_COLS = [
  ['#f2c33c', '#fff1a6', '#8f6512'],
  ['#e8902f', '#ffc46a', '#84470f'],
  ['#e8743c', '#ffa473', '#833318'],
  ['#e8558f', '#ff93b8', '#872251'],
];

const SPR = {};

function buildSkulls() {
  for (const key of ['normal', 'hot', 'hit']) {
    SPR['skull_' + key] = fromMap(SKULL_MAP, { 1: '#241310', ...BONE[key] }, key === 'hit' ? 0.04 : 0.1);
  }
}

// Schulterbalken (36x8), an dem die beiden Seitenschädel hängen
function buildBeam() {
  const W = 64, H = 10;
  const { c, g } = sheet(W, H);
  blocks(g, 0, 0, W, H, '#1a0c0a', 0.06);                    // dunkle Kontur
  blocks(g, 1, 2, W - 2, 5, '#e8902f');
  blocks(g, 1, 2, W - 2, 1, '#ffd27a', 0.18);
  blocks(g, 1, 6, W - 2, 1, '#8a3a1c');
  for (const x of [0, 1, 2, W - 3, W - 2, W - 1]) blocks(g, x, 0, 1, 10, '#2a1410', 0.12);
  for (let x = 6; x < W - 6; x += 8) {
    blocks(g, x, 2, 2, 2, '#ffe7a8', 0.1);                   // Nieten
    blocks(g, x, 4, 2, 3, '#a8521c', 0.1);
  }
  return c;
}

// Rumpf (36x34): Wirbelsäule, fünf Rippenpaare in Flammenfarben, Becken
function buildTorso() {
  const W = 36, H = 34;
  const { c, g } = sheet(W, H);
  const mid = 17;
  // Rippen – nach unten kürzer, jede in einer anderen Flammenfarbe
  for (let i = 0; i < 5; i++) {
    const len = Math.round(15 - i * 2.1);
    const y0 = 2 + i * 6;
    const [base, light, dark] = RIB_COLS[i % 4];
    for (const dir of [-1, 1]) {
      for (let k = 0; k < len; k++) {
        const x = mid + dir * (2 + k) - (dir < 0 ? 1 : 0);
        const y = Math.round(y0 + ((k / len) ** 2) * 4);
        blocks(g, x, y - 1, 1, 6, '#1a0c0a', 0.06);          // dunkle Kontur
        blocks(g, x, y, 1, 3, base, 0.18);
        blocks(g, x, y, 1, 1, light, 0.12);
        blocks(g, x, y + 3, 1, 1, dark, 0.1);
      }
    }
  }
  // Wirbelsäule mit einzelnen Wirbeln darüber
  blocks(g, mid - 1, 0, 4, H, '#3a1c14');
  blocks(g, mid - 1, 0, 1, H, '#5c3122', 0.1);
  for (let y = 1; y < H - 3; y += 4) {
    blocks(g, mid - 3, y, 8, 2, '#d9b48c', 0.18);
    blocks(g, mid - 3, y + 2, 8, 1, '#6b4a2e', 0.1);
  }
  // Brustplatte
  blocks(g, mid - 5, 2, 10, 7, '#f2c33c', 0.18);
  blocks(g, mid - 5, 2, 10, 1, '#fff1a6', 0.12);
  blocks(g, mid - 5, 8, 10, 1, '#8f6512', 0.1);
  blocks(g, mid - 2, 4, 5, 4, '#e8743c', 0.16);
  // Becken, aus dem die Schweife wachsen
  blocks(g, mid - 6, 28, 13, 4, '#e8558f', 0.16);
  blocks(g, mid - 6, 28, 13, 1, '#ff93b8', 0.12);
  blocks(g, mid - 6, 31, 13, 1, '#872251', 0.1);
  blocks(g, mid - 5, 32, 4, 2, '#e8743c', 0.16);
  blocks(g, mid + 2, 32, 4, 2, '#e8743c', 0.16);
  return c;
}

// 16x16-Oberflächen für Boden, Felsen und Säulen
function buildTile(kind) {
  const { c, g } = sheet(16, 16);
  if (kind === 'netherrack') {
    blocks(g, 0, 0, 16, 16, '#6e2a22', 0.3);
    for (let i = 0; i < 26; i++) {
      const x = Math.floor(grain() * 16), y = Math.floor(grain() * 16);
      blocks(g, x, y, 1, 1, grain() < 0.3 ? '#9a3a24' : '#4d1a16', 0.2);
    }
  } else if (kind === 'brick') {
    blocks(g, 0, 0, 16, 16, '#2e1d22', 0.18);
    for (let r = 0; r < 4; r++) {
      const off = r % 2 ? 0 : 8;
      blocks(g, 0, r * 4, 16, 1, '#4a3038', 0.12);              // Mörtelfuge
      blocks(g, (off + 7) % 16, r * 4, 1, 4, '#4a3038', 0.12);
      blocks(g, (off + 15) % 16, r * 4, 1, 4, '#4a3038', 0.12);
    }
  } else if (kind === 'basalt') {
    blocks(g, 0, 0, 16, 16, '#2b2630', 0.22);
    for (let x = 0; x < 16; x += 3) blocks(g, x, 0, 1, 16, '#3a3444', 0.14);
    for (let i = 0; i < 10; i++) blocks(g, Math.floor(grain() * 16), Math.floor(grain() * 16), 1, 2, '#1b1821', 0.1);
  } else {                                                      // Glühstein
    blocks(g, 0, 0, 16, 16, '#d8a13a', 0.26);
    for (let i = 0; i < 20; i++) blocks(g, Math.floor(grain() * 16), Math.floor(grain() * 16), 1, 1, '#ffe9a8', 0.2);
  }
  return c;
}

// Armbrust in Ich-Perspektive: Bogenarme quer oben, Schaft zeigt zum Spieler,
// die Faust des Spielers liegt am Griff. Sehne und Bolzen kommen live dazu.
function buildCrossbow() {
  const W = 64, H = 54, cx = 32, dark = '#241a12';
  const { c, g } = sheet(W, H);

  // Schaft in Fluchtperspektive: oben schmal (weit weg), unten breit (nah)
  for (let y = 4; y < H; y++) {
    const hw = Math.round(lerp(3, 16, ((y - 4) / (H - 4)) ** 1.25));
    blocks(g, cx - hw - 1, y, 1, 1, dark, 0.08);
    blocks(g, cx + hw, y, 1, 1, dark, 0.08);
    blocks(g, cx - hw, y, hw * 2, 1, '#6b4a2a', 0.16);
    blocks(g, cx - hw, y, Math.max(1, Math.round(hw * 0.6)), 1, '#8a6134', 0.12);
    if (y % 7 === 0) blocks(g, cx - hw, y, hw * 2, 1, '#4a3119', 0.1);  // Brettfugen
  }
  // Führungsrille für den Bolzen, läuft mit der Perspektive auf
  for (let y = 0; y < H - 14; y++) {
    const gw = 2 + Math.round((y / H) * 4);
    blocks(g, cx - Math.ceil(gw / 2), y, gw, 1, '#2f2014', 0.12);
  }

  // Bogenarme als flaches V – die Enden fallen nach außen ab
  const LIMB = 23;
  for (let k = 0; k <= LIMB; k++) {
    const dy = Math.round(((k / LIMB) ** 1.7) * 9);
    for (const dir of [-1, 1]) {
      const x = cx + dir * (4 + k) - (dir < 0 ? 1 : 0);
      blocks(g, x, 6 + dy, 1, 4, k > LIMB - 4 ? '#3b2a1a' : '#8a6134', 0.16);
      blocks(g, x, 6 + dy, 1, 1, k > LIMB - 4 ? '#6b4f30' : '#c59a5c', 0.12);
      blocks(g, x, 9 + dy, 1, 1, dark, 0.08);
    }
  }
  for (const dir of [-1, 1]) {                               // Eisenbeschläge
    const x = cx + dir * 11 - (dir < 0 ? 4 : 0);
    blocks(g, x, 5, 4, 6, '#9aa3ad', 0.16);
    blocks(g, x, 5, 4, 1, '#d3dae0', 0.1);
  }

  // Nussgehäuse und Abzugsbügel
  blocks(g, cx - 11, 26, 22, 7, '#5c3f22', 0.16);
  blocks(g, cx - 11, 26, 22, 1, '#8a6134', 0.1);
  blocks(g, cx - 11, 32, 22, 1, dark, 0.08);
  blocks(g, cx - 3, 33, 5, 8, '#9aa3ad', 0.18);              // Abzug
  blocks(g, cx - 9, 31, 3, 11, '#9aa3ad', 0.14);             // Bügel
  blocks(g, cx - 9, 41, 9, 2, '#9aa3ad', 0.14);

  // Faust am Griff, dazu der Ärmel – das gibt die Ich-Perspektive
  blocks(g, cx - 15, 41, 30, 10, '#b8794f');
  blocks(g, cx - 15, 41, 30, 1, '#d79a6c', 0.12);
  for (let y = 43; y < 51; y += 3) blocks(g, cx - 15, y, 30, 1, '#8c5635', 0.12);
  blocks(g, cx - 19, 44, 5, 7, '#a56a44', 0.14);             // Daumen
  blocks(g, cx - 15, 50, 30, 4, '#3f5aa8', 0.16);            // Ärmel
  blocks(g, cx - 15, 50, 30, 1, '#5d78c4', 0.1);
  return c;
}

// Schild: Holzbretter, Eisenbuckel und ein Wither-Gesicht als Wappen
function buildShield() {
  const W = 40, H = 46;
  const { c, g } = sheet(W, H);
  blocks(g, 0, 1, W, H - 8, '#2a1c10', 0.1);                // dunkler Rahmen
  blocks(g, 1, 0, W - 2, H - 6, '#2a1c10', 0.1);
  // Bretter mit abwechselnder Maserung
  for (let x = 3, i = 0; x < W - 3; x += 5, i++) {
    blocks(g, x, 2, 5, H - 10, i % 2 ? '#8a6134' : '#7a5429', 0.17);
    blocks(g, x, 2, 1, H - 10, '#5a3c1e', 0.1);
    for (let y = 5 + (i % 3) * 4; y < H - 10; y += 11) blocks(g, x + 1, y, 3, 1, '#6b4a2a', 0.1);
  }
  blocks(g, 3, 2, W - 6, 1, '#c59a5c', 0.12);
  blocks(g, 3, H - 9, W - 6, 1, '#1e1309', 0.08);
  // unten zugespitzt
  blocks(g, 5, H - 8, W - 10, 3, '#7a5429', 0.14);
  blocks(g, 11, H - 5, W - 22, 3, '#5a3c1e', 0.14);
  // Eisenbeschläge in den Ecken
  for (const [ex, ey] of [[1, 1], [W - 5, 1], [1, H - 13], [W - 5, H - 13]]) {
    blocks(g, ex, ey, 4, 4, '#9aa3ad', 0.18);
    blocks(g, ex, ey, 4, 1, '#d3dae0', 0.1);
    blocks(g, ex + 1, ey + 1, 2, 2, '#6f767f', 0.1);
  }
  // Wappen: dunkler Witherschädel über Flammen
  const px = 11, py = 7;
  blocks(g, px, py, 18, 17, '#241a20', 0.12);
  blocks(g, px + 1, py + 1, 16, 15, '#4a3a42', 0.16);
  blocks(g, px + 3, py + 4, 4, 4, '#ff8a2a', 0.22);
  blocks(g, px + 11, py + 4, 4, 4, '#ff8a2a', 0.22);
  blocks(g, px + 7, py + 8, 4, 3, '#241a20', 0.1);
  for (let x = px + 3; x < px + 15; x += 3) blocks(g, x, py + 12, 2, 3, '#e8dcc8', 0.12);
  for (let i = 0; i < 6; i++) {                             // Flammensaum
    const fx = px + 1 + i * 3;
    blocks(g, fx, py + 17, 2, 2 + (i % 2), RIB_COLS[i % 4][0], 0.16);
    blocks(g, fx, py + 17, 2, 1, RIB_COLS[i % 4][1], 0.12);
  }
  return c;
}

// weiß aufblitzende Fassung einer Vorlage (Trefferanzeige)
function whiteVersion(src) {
  const { c, g } = sheet(src.width, src.height);
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(255,255,255,0.88)';
  g.fillRect(0, 0, src.width, src.height);
  return c;
}

/* ------------------------------------------------------------- Sprite-Set - */
function buildSprites() {
  gseed = 20260217;
  buildSkulls();
  SPR.torso = buildTorso();
  SPR.torsoHit = whiteVersion(SPR.torso);
  SPR.beam = buildBeam();
  SPR.netherrack = buildTile('netherrack');
  SPR.brick = buildTile('brick');
  SPR.basalt = buildTile('basalt');
  SPR.glow = buildTile('glow');
  SPR.bow = buildCrossbow();
  SPR.shield = buildShield();
}
buildSprites();

// Vorlage ungeglättet in ein Rechteck blitten
function blit(spr, x, y, w, h) {
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(spr, Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/* --------------------------------------------------------- Spielzustand --- */

const game = {
  state: 'ready',        // ready | play | won | over
  level: 1, startLevel: 1, diff: 'normal',
  score: 0, lives: 3,
  t: 0, banner: 0, paused: false,
  best: 0, hits: 0, crits: 0, blocks: 0,
  shake: 0, flash: 0, burn: 0,
};

const wither = {
  x: 0, y: 0, z: 1.25,          // x/y normiert, z = Tiefe (klein = nah)
  tx: 0, ty: 0, tz: 1.25,
  hp: 80, hpMax: 80, regenStop: 0,
  atkT: 3, charge: 0, chargeHead: 0, breathT: 0, queue: 0,
  hurtT: 0, hurtHead: -1, phase: 0, dead: 0,
};

const player = {
  shield: false, shieldT: 0,     // shieldT: wie lange das Schild schon oben ist
  loaded: true, reload: 0,
  recoil: 0, hitT: 0, aimX: 0, aimY: 0,
};

let skulls = [];       // fliegende Wither-Schädel { x, y, z, sx, sy, spin }
let bolts = [];        // Armbrustbolzen (nur Optik) { x, y, tx, ty, t }
let parts = [];        // Funken/Partikel
let floats = [];       // aufsteigende Texte

function loadSettings() {
  try {
    const d = localStorage.getItem('wither_diff');
    if (DIFFS[d]) game.diff = d;
    const s = parseInt(localStorage.getItem('wither_start'), 10);
    if ([1, 3, 5].includes(s)) game.startLevel = s;
    game.best = parseFloat(localStorage.getItem('wither_best')) || 0;
  } catch { /* egal */ }
}
function saveBest() {
  try {
    if (game.score > (parseFloat(localStorage.getItem('wither_best')) || 0)) {
      localStorage.setItem('wither_best', String(game.score));
    }
    const lv = parseInt(localStorage.getItem('wither_level'), 10) || 0;
    if (game.level > lv) localStorage.setItem('wither_level', String(game.level));
  } catch { /* egal */ }
}

function startFight() {
  game.state = 'ready';
  game.level = game.startLevel;
  game.score = 0; game.lives = 3;
  game.hits = 0; game.crits = 0; game.blocks = 0;
  game.t = 0; game.banner = 1.6; game.shake = 0; game.flash = 0; game.burn = 0;
  setupLevel();
  player.shield = false; player.loaded = true; player.reload = 0; player.hitT = 0;
  player.aimX = CW / 2; player.aimY = CH * 0.42;
  skulls = []; bolts = []; parts = []; floats = [];
}

function setupLevel() {
  const c = levelCfg(game.level, DIFFS[game.diff] || 1);
  wither.hpMax = c.hp; wither.hp = c.hp;
  wither.x = 0; wither.y = -0.22; wither.z = 1.3;
  wither.tx = 0; wither.ty = -0.22; wither.tz = 1.3;
  wither.atkT = Math.max(1.6, c.atkEvery);
  wither.charge = 0; wither.breathT = 0; wither.queue = 0;
  wither.hurtT = 0; wither.dead = 0; wither.regenStop = 0;
  skulls = [];
}
const cfg = () => levelCfg(game.level, DIFFS[game.diff] || 1);

/* ------------------------------------------------------------ Geometrie --- */
// Der Wither sitzt im Raum; Größe und Lage auf dem Bildschirm folgen der Tiefe.
let CW = 0, CH = 0;
const horizon = () => CH * 0.52;

function witherBox() {
  // Höhe des Ungetüms – im Hochformat begrenzt die Breite, sonst ragen die
  // Seitenschädel aus dem Bild
  const h = Math.min(CH * 0.46, CW * 0.45) / wither.z;
  const w = h * 1.55;
  const cx = CW / 2 + (wither.x * CW * 0.34) / wither.z;
  const cy = horizon() + (wither.y * CH * 0.3) / wither.z;
  return { cx, cy, w, h };
}
// Trefferzonen: die drei Schädel und der Rumpf (Bildschirm-Rechtecke)
function witherParts() {
  const b = witherBox();
  const s = b.h * 0.3;                              // Größe des Mittelschädels
  const side = s * 0.78;
  const bob = Math.sin(wither.phase * 1.7) * b.h * 0.02;
  return {
    box: b,
    heads: [
      { x: b.cx - s / 2, y: b.cy - s * 0.42 + bob, w: s, h: s * 1.0, big: true },
      { x: b.cx - b.w * 0.42 - side / 2, y: b.cy - b.h * 0.3 - bob, w: side, h: side },
      { x: b.cx + b.w * 0.42 - side / 2, y: b.cy - b.h * 0.26 + bob, w: side, h: side },
    ],
    body: { x: b.cx - b.w * 0.22, y: b.cy + b.h * 0.04, w: b.w * 0.44, h: b.h * 0.62 },
  };
}
const inRect = (x, y, r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/* --------------------------------------------------------------- Kampf ---- */

function shoot() {
  if (game.state !== 'play' || player.shield || !player.loaded) return null;
  player.loaded = false; player.reload = 0; player.recoil = 1;
  Sfx.play('shot');
  const x = player.aimX, y = player.aimY;
  bolts.push({ x: CW * 0.78, y: CH * 1.02, tx: x, ty: y, t: 0 });
  const p = witherParts();
  let hit = null;
  p.heads.forEach((h, i) => { if (!hit && inRect(x, y, h)) hit = { kind: 'head', i }; });
  if (!hit && inRect(x, y, p.body)) hit = { kind: 'body', i: -1 };
  if (!hit) {
    addFloat(x, y, 'daneben', '#9fc0d8');
    Sfx.play('miss');
    return { hit: false };
  }
  const crit = hit.kind === 'head';
  const dmg = crit ? DMG_HEAD : DMG_BODY;
  wither.hp = Math.max(0, wither.hp - dmg);
  wither.regenStop = REGEN_STOP;
  wither.hurtT = 0.2; wither.hurtHead = crit ? hit.i : -1;
  game.hits++; if (crit) game.crits++;
  game.score += crit ? 25 : 10;
  addFloat(x, y, crit ? `💀 ${dmg}!` : `${dmg}`, crit ? '#ffd166' : '#ffb0a0');
  spark(x, y, crit ? 14 : 8, crit ? '#ffd166' : '#e8743c');
  Sfx.play(crit ? 'crit' : 'hit');
  if (wither.hp <= 0) levelWon();
  return { hit: true, crit, dmg };
}

function levelWon() {
  game.state = 'won';
  wither.dead = 1.8;
  game.score += 100 * game.level + game.lives * 25;
  game.shake = 0.6;
  for (let i = 0; i < 60; i++) {
    const b = witherBox();
    spark(b.cx + (Math.random() - 0.5) * b.w, b.cy + (Math.random() - 0.5) * b.h, 1,
      ['#ffd166', '#e8743c', '#e8558f'][i % 3]);
  }
  Sfx.play('win');
  saveBest();
}

function hurtPlayer(reason) {
  if (player.hitT > 0 || game.state !== 'play') return false;
  game.lives--;
  player.hitT = 1.3;
  game.flash = 1; game.shake = 0.5;
  addFloat(CW / 2, CH * 0.44, reason, '#ff6a5a');
  Sfx.play('hurt');
  if (game.lives <= 0) gameOver();
  return true;
}
function gameOver() {
  game.state = 'over';
  game.lives = 0;
  saveBest();
  Sfx.play('over');
}

// Ein Wither-Schädel fliegt los
function fireSkull(headIdx) {
  const p = witherParts();
  const h = p.heads[headIdx] || p.heads[0];
  skulls.push({
    sx: h.x + h.w / 2, sy: h.y + h.h / 2,
    x: h.x + h.w / 2, y: h.y + h.h / 2,
    tx: CW / 2 + (Math.random() - 0.5) * CW * 0.12,
    ty: CH * 0.62 + (Math.random() - 0.5) * CH * 0.1,
    z: 1, spin: 0, hit: false,
  });
  Sfx.play('skull');
}

function updateWither(dt) {
  const c = cfg();
  wither.phase += dt;
  if (wither.hurtT > 0) wither.hurtT -= dt;

  // Schweben: neues Ziel suchen, sanft hinbewegen
  if (Math.abs(wither.x - wither.tx) < 0.05 && Math.abs(wither.y - wither.ty) < 0.05) {
    wither.tx = (Math.random() - 0.5) * 1.3;
    wither.ty = -0.42 + Math.random() * 0.34;
    wither.tz = 1.05 + Math.random() * 0.5;
  }
  const sp = c.speed * dt;
  wither.x += clamp(wither.tx - wither.x, -sp, sp);
  wither.y += clamp(wither.ty - wither.y, -sp * 0.7, sp * 0.7);
  wither.z += clamp(wither.tz - wither.z, -sp * 0.5, sp * 0.5);
  wither.y += Math.sin(wither.phase * 1.3) * 0.0016;

  // Heilung – pausiert kurz nach jedem Treffer
  if (wither.regenStop > 0) wither.regenStop -= dt;
  else if (wither.hp < wither.hpMax) {
    wither.hp = Math.min(wither.hpMax, wither.hp + c.regen * dt);
  }

  // Angriffe: erst aufladen (Vorwarnung), dann losschicken
  if (wither.breathT > 0) {
    wither.breathT -= dt;
    game.burn = Math.max(game.burn, 0.6);
    if (!player.shield) {
      if (hurtPlayer('🔥 Vom Feuer erwischt!')) { /* Leben weg */ }
    } else if ((wither.breathT * 10 | 0) % 3 === 0) {
      spark(CW / 2, CH * 0.72, 2, '#ffb24a');
    }
  } else if (wither.charge > 0) {
    wither.charge -= dt;
    if (wither.charge <= 0) {
      if (wither.breathPending) {
        wither.breathPending = false;
        wither.breathT = 1.5;
        Sfx.play('breath');
        addFloat(CW / 2, CH * 0.3, '🔥 Feueratem – Schild hoch!', '#ffb24a');
      } else {
        fireSkull(wither.chargeHead);
        if (wither.queue > 0) {
          wither.queue--;
          wither.charge = 0.32;
          wither.chargeHead = (wither.chargeHead + 1) % 3;
        }
      }
    }
  } else {
    wither.atkT -= dt;
    if (wither.atkT <= 0) {
      wither.atkT = c.atkEvery * (0.8 + Math.random() * 0.5);
      if (Math.random() < c.breath) {
        wither.breathPending = true;
        wither.charge = 0.85;
        wither.chargeHead = 0;
        addFloat(CW / 2, CH * 0.26, '⚠️ Er holt Luft …', '#ffd166');
      } else {
        wither.queue = c.skulls - 1;
        wither.charge = 0.6;
        wither.chargeHead = Math.floor(Math.random() * 3);
      }
    }
  }
}

function updateSkulls(dt) {
  const c = cfg();
  for (const s of skulls) {
    s.z -= c.skullSpeed * dt;
    s.spin += dt * 3;
    const t = 1 - s.z;
    s.x = lerp(s.sx, s.tx, t * t);
    s.y = lerp(s.sy, s.ty, t * t);
    if (s.z <= 0.12 && !s.hit) {
      s.hit = true;
      if (player.shield) {
        const perfect = player.shieldT < PERFECT;
        game.blocks++;
        game.score += perfect ? 15 : 5;
        if (perfect) { player.loaded = true; player.reload = 0; }
        addFloat(CW / 2, CH * 0.6, perfect ? '🛡️ Perfekt geblockt!' : '🛡️ Geblockt', perfect ? '#8ee07a' : '#bcd6ea');
        spark(CW / 2, CH * 0.66, 12, perfect ? '#8ee07a' : '#cfd6dc');
        game.shake = 0.25;
        Sfx.play(perfect ? 'perfect' : 'block');
      } else {
        hurtPlayer('💀 Schädel getroffen!');
      }
    }
  }
  skulls = skulls.filter((s) => s.z > 0.05);
}

function updatePlayer(dt) {
  if (player.shield) player.shieldT += dt;
  else player.shieldT = 0;
  // Nachladen geht nur mit gesenktem Schild – beide Hände werden gebraucht
  if (!player.loaded && !player.shield) {
    player.reload += dt;
    if (player.reload >= RELOAD) { player.loaded = true; player.reload = RELOAD; Sfx.play('load'); }
  }
  if (player.recoil > 0) player.recoil = Math.max(0, player.recoil - dt * 4);
  if (player.hitT > 0) player.hitT -= dt;
}

function update(dt) {
  game.t += dt;
  if (game.shake > 0) game.shake -= dt;
  if (game.flash > 0) game.flash -= dt * 2.5;
  if (game.burn > 0) game.burn -= dt;
  for (const f of floats) { f.t += dt; f.y -= 26 * dt; }
  floats = floats.filter((f) => f.t < 1.4);
  for (const p of parts) { p.t += dt; p.vy += 420 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
  parts = parts.filter((p) => p.t < p.life);
  for (const b of bolts) b.t += dt * 7;
  bolts = bolts.filter((b) => b.t < 1);

  if (game.state === 'ready') {
    game.banner -= dt;
    if (game.banner <= 0) { game.state = 'play'; Sfx.play('start'); }
    return;
  }
  if (game.state === 'won') {
    wither.dead -= dt;
    updatePlayer(dt);
    if (wither.dead <= 0) {
      game.level++;
      setupLevel();
      game.state = 'ready'; game.banner = 1.6;
      player.loaded = true; player.reload = RELOAD;
    }
    return;
  }
  if (game.state !== 'play') { updatePlayer(dt); return; }
  updateWither(dt);
  updateSkulls(dt);
  updatePlayer(dt);
}

/* ------------------------------------------------------------- Effekte ---- */

function addFloat(x, y, text, color) { floats.push({ x, y, text, color, t: 0 }); }
function spark(x, y, n, color) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, v = 60 + Math.random() * 220;
    parts.push({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60,
      t: 0, life: 0.4 + Math.random() * 0.5, color, size: 2 + Math.random() * 3,
    });
  }
}

/* ------------------------------------------------------------- Zeichnen --- */

const stage = document.getElementById('stage');
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rot = stage.classList.contains('rot');
  CW = rot ? window.innerHeight : window.innerWidth;
  CH = rot ? window.innerWidth : window.innerHeight;
  canvas.width = Math.round(CW * dpr);
  canvas.height = Math.round(CH * dpr);
  canvas.style.width = CW + 'px';
  canvas.style.height = CH + 'px';
  if (!player.aimX) { player.aimX = CW / 2; player.aimY = CH * 0.45; }
}
window.addEventListener('resize', resize);

function roundRect(x, y, w, h, r) {
  r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// stabiles Rauschen pro Spalte (damit die Felsen nicht flimmern)
function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// Kachelfläche: die 16x16-Vorlage im Blockraster über ein Rechteck legen
function tiled(g, spr, x, y, w, h, bs, tint) {
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.imageSmoothingEnabled = false;
  for (let ty = y; ty < y + h; ty += bs) {
    for (let tx = x; tx < x + w; tx += bs) {
      g.drawImage(spr, Math.round(tx), Math.round(ty), Math.round(bs + 1), Math.round(bs + 1));
    }
  }
  if (tint) { g.fillStyle = tint; g.fillRect(x, y, w, h); }
  g.restore();
}

// Nether-Arena: glühender Himmel, Felskämme mit Glühstein, Lavasee,
// Basaltsäulen und eine Netherziegel-Plattform in Blockperspektive
// Fernes, unbewegtes Bühnenbild (wird nur bei Größenänderung neu gemalt)
function paintFar(g) {
  const hz = horizon();
  const sky = g.createLinearGradient(0, 0, 0, hz);
  sky.addColorStop(0, '#1d0a0e');
  sky.addColorStop(0.45, '#5b1715');
  sky.addColorStop(0.8, '#a8381b');
  sky.addColorStop(1, '#e06a24');
  g.fillStyle = sky; g.fillRect(0, 0, CW, hz);
  // Glutschein über dem Lavasee
  const halo = g.createRadialGradient(CW / 2, hz, 0, CW / 2, hz, CH * 0.6);
  halo.addColorStop(0, 'rgba(255,170,70,0.4)');
  halo.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = halo; g.fillRect(0, 0, CW, hz);
  // Aschewolken
  for (let i = 0; i < 5; i++) {
    const y = hz * (0.12 + i * 0.12);
    g.fillStyle = `rgba(30,12,14,${0.1 + i * 0.03})`;
    g.fillRect(0, y, CW, CH * 0.03);
  }

  const bs = Math.max(3, Math.round(CH * 0.019));             // Blockkante
  // zwei Felskämme hintereinander, im Blockraster gestuft
  for (const layer of [0, 1]) {
    const far = layer === 0;
    const bb = far ? bs : bs * 1.5;
    const amp = far ? CH * 0.1 : CH * 0.16;
    for (let x = -bb; x < CW + bb; x += bb) {
      const n = Math.floor(x / bb) + layer * 77;
      const h = Math.round((0.35 + hash(n) * 0.3 + hash(n * 0.21) * 0.45) * amp / bb) * bb + bb;
      const top = hz - h;
      if (far) {
        g.fillStyle = shade('#531a16', 0.8 + hash(n * 3) * 0.3);
        g.fillRect(x, top, bb + 1, h + 1);
      } else {
        tiled(g, SPR.netherrack, x, top, bb + 1, h + 1, bb, 'rgba(20,6,8,0.22)');
      }
      // Glühstein-Adern im Fels
      if (!far && hash(n * 7.3) > 0.88) {
        g.imageSmoothingEnabled = false;
        g.drawImage(SPR.glow, Math.round(x), Math.round(top + bb), Math.round(bb), Math.round(bb));
        const gg = g.createRadialGradient(x + bb / 2, top + bb * 1.5, 0, x + bb / 2, top + bb * 1.5, bb * 3);
        gg.addColorStop(0, 'rgba(255,220,130,0.4)'); gg.addColorStop(1, 'rgba(255,200,100,0)');
        g.fillStyle = gg; g.fillRect(x - bb * 3, top - bb * 2, bb * 7, bb * 7);
      }
      // Lavafall
      if (far && hash(n * 11.1) > 0.94) {
        g.fillStyle = 'rgba(255,150,50,0.75)';
        g.fillRect(x + bb * 0.2, top + bb, bb * 0.6, h);
      }
    }
  }
  // Grundton des Lavasees
  const lava = g.createLinearGradient(0, hz, 0, CH);
  lava.addColorStop(0, '#ffb24a');
  lava.addColorStop(0.1, '#e8731f');
  lava.addColorStop(0.4, '#9c330f');
  lava.addColorStop(1, '#3d1109');
  g.fillStyle = lava; g.fillRect(0, hz, CW, CH - hz);
}

// Vordergrund: Säulen und Plattform, ebenfalls unbewegt
function paintNear(g) {
  const hz = horizon();
  // Basaltsäulen am Bildrand – sie geben dem Blick Tiefe
  for (const side of [-1, 1]) {
    const pw = CW * 0.07;
    const px = side < 0 ? -pw * 0.3 : CW - pw * 0.7;
    const pTop = hz - CH * 0.3;
    tiled(g, SPR.basalt, px, pTop, pw, CH - pTop, Math.max(4, CH * 0.035), 'rgba(10,6,14,0.25)');
    g.fillStyle = 'rgba(255,150,60,0.12)';
    g.fillRect(side < 0 ? px + pw - 3 : px, pTop, 3, CH - pTop);
  }
  // Netherziegel-Plattform in Blockperspektive: nach vorn größere Blöcke
  let py = hz + CH * 0.14, ph = CH * 0.022, dist = 0;
  while (py < CH) {
    tiled(g, SPR.brick, 0, py, CW, ph + 1, Math.max(4, ph * 1.6),
      `rgba(255,120,40,${Math.max(0, 0.1 - dist * 0.012)})`);
    g.fillStyle = `rgba(0,0,0,${Math.max(0, 0.3 - dist * 0.05)})`;
    g.fillRect(0, py, CW, 1);
    py += ph; ph *= 1.45; dist++;
  }
  // glühende Fuge an der Vorderkante der Plattform
  const seam = g.createLinearGradient(0, hz + CH * 0.12, 0, hz + CH * 0.2);
  seam.addColorStop(0, 'rgba(255,190,90,0.7)');
  seam.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = seam; g.fillRect(0, hz + CH * 0.12, CW, CH * 0.08);
  // dunkle Ecken, damit der Blick in die Mitte geht
  const vig = g.createLinearGradient(0, CH * 0.75, 0, CH);
  vig.addColorStop(0, 'rgba(10,4,8,0)');
  vig.addColorStop(1, 'rgba(10,4,8,0.55)');
  g.fillStyle = vig; g.fillRect(0, CH * 0.75, CW, CH * 0.25);
}

// Beide Ebenen werden bei Größenänderung einmal in Offscreen-Canvas gemalt –
// pro Bild bleibt dann nur noch das Bewegte zu zeichnen.
const bg = { far: null, near: null, w: 0, h: 0 };
function buildBackdrop() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (const [key, paint] of [['far', paintFar], ['near', paintNear]]) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(CW * dpr));
    c.height = Math.max(1, Math.round(CH * dpr));
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    paint(g);
    bg[key] = c;
  }
  bg.w = CW; bg.h = CH;
}

// Nether-Arena: festes Bühnenbild plus alles, was sich bewegt
function drawArena(time) {
  const hz = horizon();
  if (bg.w !== CW || bg.h !== CH) buildBackdrop();
  ctx.drawImage(bg.far, 0, 0, CW, CH);

  // Lavasee: blockige Wellenkämme, nach vorn gröber
  let y = hz, step = Math.max(2, CH * 0.006), row = 0;
  while (y < CH) {
    const bw = step * 2.4;
    for (let x = -bw; x < CW + bw; x += bw) {
      const w = Math.sin(time * 1.3 + x * 0.03 + row * 1.1) + Math.sin(time * 0.7 - x * 0.011 + row)
        + Math.sin(time * 2.1 + x * 0.008 - row * 0.6) * 0.6;
      if (w > 1.3) {                                          // heller Wellenkamm
        ctx.fillStyle = `rgba(255,235,165,${0.26 - row * 0.011})`;
        ctx.fillRect(x, y, bw * (0.5 + (w - 1.3) * 0.5), step);
      } else if (w < -1.4) {                                  // erkaltete Kruste
        ctx.fillStyle = `rgba(74,22,14,${0.42 - row * 0.014})`;
        ctx.fillRect(x, y, bw * 0.9, step);
        ctx.fillStyle = `rgba(255,150,60,${0.2 - row * 0.008})`;
        ctx.fillRect(x, y + step * 0.7, bw * 0.9, step * 0.3);
      }
    }
    y += step; step *= 1.2; row++;
  }
  // Glanzkante direkt am Horizont
  const shine = ctx.createLinearGradient(0, hz, 0, hz + CH * 0.04);
  shine.addColorStop(0, 'rgba(255,245,200,0.5)');
  shine.addColorStop(1, 'rgba(255,200,110,0)');
  ctx.fillStyle = shine; ctx.fillRect(0, hz, CW, CH * 0.04);
  // Blasen im Lavasee
  for (let i = 0; i < 9; i++) {
    const t = (time * 0.35 + i * 0.37) % 1;
    const bx = (hash(i * 5.1) * 1.2 - 0.1) * CW;
    const by = hz + (0.12 + hash(i * 2.3) * 0.8) * (CH - hz) * (0.3 + t * 0.7);
    const r = (CH - hz) * 0.02 * (0.5 + t);
    ctx.fillStyle = `rgba(255,240,180,${(1 - t) * 0.55})`;
    ctx.fillRect(bx - r, by - r, r * 2, r * 2);
  }

  ctx.drawImage(bg.near, 0, 0, CW, CH);
  // Risse mit Lava im Boden
  const fy = hz + CH * 0.26;
  for (let i = 0; i < 7; i++) {
    const fx = hash(i * 13.7) * CW;
    const fw = CW * (0.03 + hash(i * 4.9) * 0.07);
    const yy = fy + hash(i * 8.3) * (CH - fy) * 0.9;
    const fh = Math.max(2, (yy - fy) * 0.05 + 3);
    ctx.fillStyle = `rgba(255,${140 + Math.floor(hash(i) * 70)},50,${0.35 + Math.sin(time * 2 + i) * 0.12})`;
    ctx.fillRect(fx, yy, fw, fh);
  }
  // Aschepartikel in der Luft
  for (let i = 0; i < 34; i++) {
    const sp = 0.3 + hash(i * 1.7) * 0.9;
    const ax = (hash(i * 3.3) * CW + time * sp * 14) % (CW + 40) - 20;
    const ay = ((hash(i * 9.1) * CH + time * sp * 9) % (CH + 40)) - 20;
    const s = Math.max(1, CH * 0.004 * (0.6 + hash(i * 4.4)));
    ctx.fillStyle = `rgba(255,${150 + Math.floor(hash(i) * 80)},90,${0.2 + hash(i * 2.2) * 0.35})`;
    ctx.fillRect(ax, ay, s, s);
  }
}

// Schädel aus der Pixelvorlage, mit Glut-Schein beim Aufladen
function drawSkullArt(x, y, w, h, glow, dark) {
  if (glow) {
    const g = ctx.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, w * 0.9);
    g.addColorStop(0, 'rgba(255,215,120,0.5)');
    g.addColorStop(1, 'rgba(255,170,60,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - w * 0.9, y - h * 0.9, w * 2.8, h * 2.8);
  }
  blit(SPR['skull_' + (dark ? 'hit' : glow ? 'hot' : 'normal')], x, y, w, h);
}

// Rumpf: Rippen, Wirbelsäule und die feurigen Schweife aus der Zeichnung
function drawWither(time) {
  const p = witherParts();
  const b = p.box;
  const flick = 0.5 + Math.sin(time * 9) * 0.5;
  ctx.save();
  if (game.state === 'won') {
    ctx.globalAlpha = clamp(wither.dead / 1.8, 0, 1);
    ctx.translate((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
  }
  // Rauchwolke hinter dem Ungetüm – hebt die Silhouette vom Lavaband ab
  const g = ctx.createRadialGradient(b.cx, b.cy, b.h * 0.05, b.cx, b.cy, b.h * 0.95);
  g.addColorStop(0, `rgba(26,8,10,${0.72 + flick * 0.08})`);
  g.addColorStop(0.55, 'rgba(40,10,10,0.42)');
  g.addColorStop(1, 'rgba(40,10,10,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(b.cx, b.cy, b.h * 0.95, 0, TAU); ctx.fill();
  // darüber ein schmaler Glutsaum
  const g2 = ctx.createRadialGradient(b.cx, b.cy, b.h * 0.3, b.cx, b.cy, b.h * 0.62);
  g2.addColorStop(0, 'rgba(255,120,40,0)');
  g2.addColorStop(0.6, `rgba(255,140,50,${0.1 + flick * 0.08})`);
  g2.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = g2;
  ctx.beginPath(); ctx.arc(b.cx, b.cy, b.h * 0.62, 0, TAU); ctx.fill();
  // alles Folgende wirft einen weichen Schatten
  ctx.shadowColor = 'rgba(12,3,5,0.9)';
  ctx.shadowBlur = Math.max(4, b.h * 0.05);

  // Schweife: blockige Flammenketten, die nach außen schwingen
  const seg = b.h * 0.075;
  for (const dir of [-1, 1]) {
    let tx = b.cx + dir * b.w * 0.1, ty = b.cy + b.h * 0.58;
    for (let i = 0; i < 8; i++) {
      const sw = Math.sin(time * 2.2 + i * 0.75 + (dir > 0 ? 1.4 : 0)) * seg * 0.6;
      tx += dir * seg * 0.5 + sw * 0.4;
      ty += seg * 0.7;
      const s = seg * (1 - i * 0.07);
      const [base, light, dk] = RIB_COLS[(i + 1) % 4];
      ctx.fillStyle = base; ctx.fillRect(tx - s / 2, ty - s / 2, s, s);
      ctx.fillStyle = light; ctx.fillRect(tx - s / 2, ty - s / 2, s, s * 0.26);
      ctx.fillStyle = dk; ctx.fillRect(tx - s / 2, ty + s * 0.26, s, s * 0.24);
      if (i > 4 && Math.random() < 0.3) spark(tx, ty, 1, light);
    }
  }

  // Rumpf und Schulterbalken als Klötzchen-Vorlagen
  const tw = b.w * 0.44, th = tw * (34 / 36), ty = b.cy + b.h * 0.02;
  blit(SPR.torso, b.cx - tw / 2, ty, tw, th);
  // Rumpftreffer blitzen kurz weiß auf
  if (wither.hurtT > 0 && wither.hurtHead === -1 && Math.random() < 0.65) {
    blit(SPR.torsoHit, b.cx - tw / 2, ty, tw, th);
  }
  const bw = b.w * 0.94, bh = bw * (10 / 64);
  blit(SPR.beam, b.cx - bw / 2, b.cy - b.h * 0.24, bw, bh);

  // die drei Schädel
  p.heads.forEach((h, i) => {
    const charging = wither.charge > 0 && wither.chargeHead === i && game.state === 'play';
    const hurt = wither.hurtT > 0 && (wither.hurtHead === i || wither.hurtHead === -1);
    drawSkullArt(h.x, h.y, h.w, h.h, charging, hurt && (Math.random() < 0.6));
  });
  ctx.shadowBlur = 0;

  // Feueratem aus dem Mittelschädel: Kegel plus blockige Flammen
  if (wither.breathT > 0) {
    const h = p.heads[0];
    const t = 1 - clamp(wither.breathT / 1.5, 0, 1);
    const spread = lerp(h.w * 0.6, CW * 0.9, t);
    const mx = h.x + h.w / 2, my = h.y + h.h * 0.72;
    ctx.globalCompositeOperation = 'lighter';                 // Feuer leuchtet auf
    const grad = ctx.createLinearGradient(0, my, 0, CH);
    grad.addColorStop(0, 'rgba(255,190,90,0.5)');
    grad.addColorStop(0.45, 'rgba(230,100,30,0.32)');
    grad.addColorStop(1, 'rgba(150,30,15,0.05)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(h.x + h.w * 0.3, my);
    ctx.lineTo(h.x + h.w * 0.7, my);
    ctx.lineTo(CW / 2 + spread / 2, CH);
    ctx.lineTo(CW / 2 - spread / 2, CH);
    ctx.closePath(); ctx.fill();
    // einzelne Flammenklötze im Strahl
    for (let i = 0; i < 40; i++) {
      const k = (i / 40 + (time * 0.9) % 1) % 1;
      const px = lerp(mx, CW / 2 + (hash(i * 2.7) - 0.5) * spread, k);
      const py = lerp(my, CH, k);
      const s = lerp(h.w * 0.12, h.w * 0.4, k) * (0.6 + hash(i * 5.3) * 0.7);
      const c = k < 0.3 ? '255,235,170' : k < 0.6 ? '255,160,60' : '220,80,30';
      ctx.fillStyle = `rgba(${c},${0.5 - k * 0.32})`;
      ctx.fillRect(px - s / 2, py - s / 2, s, s);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
}

function drawSkullShots() {
  for (const s of skulls) {
    const sz = lerp(CH * 0.05, CH * 0.3, 1 - s.z);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(Math.sin(s.spin) * 0.12);
    // Flammenschweif: zeigt zurück zum Abschussort
    const dx = (s.sx || s.x) - s.x, dy = (s.sy || s.y) - s.y;
    const dl = Math.hypot(dx, dy) || 1;
    for (let i = 6; i >= 1; i--) {
      const k = i / 6;
      const ts = sz * (0.7 - k * 0.42);
      ctx.fillStyle = `rgba(${i > 3 ? '140,50,32' : '255,170,60'},${0.34 - k * 0.22})`;
      ctx.fillRect(
        (dx / dl) * k * sz * 1.1 - ts / 2 + Math.sin(s.spin + i) * sz * 0.06,
        (dy / dl) * k * sz * 1.1 - ts / 2,
        ts, ts,
      );
    }
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, sz * 0.95);
    g.addColorStop(0, 'rgba(255,180,70,0.55)');
    g.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-sz, -sz, sz * 2, sz * 2);
    blit(SPR.skull_hot, -sz / 2, -sz / 2, sz, sz);
    ctx.restore();
  }
}

// Ich-Perspektive: Armbrust unten rechts, Schild fährt von unten hoch
function drawWeapons(time) {
  // Armbrust in Ego-Ansicht: Bogenarme quer, Schaft zeigt zum Spieler.
  // Eine Einheit u entspricht einem Klötzchen.
  const rec = player.recoil;
  // Armbrust-Vorlage ist 62x50 Blöcke – die Breite legt die Blockgröße fest
  const bw = Math.min(CW * 0.3, CH * 0.44), bh = bw * (54 / 64);
  const u = bw / 64;                                          // ein Block
  const bx = CW * 0.56 + rec * 6, by = CH - bh * 0.88 + rec * 22 + (player.shield ? CH * 0.6 : 0);
  ctx.save();
  ctx.translate(bx + bw / 2, by + bh);
  ctx.rotate(-0.05 + rec * 0.06);
  ctx.translate(-(bx + bw / 2), -(by + bh));
  ctx.shadowColor = 'rgba(8,2,4,0.8)';
  ctx.shadowBlur = Math.max(3, u * 2);
  blit(SPR.bow, bx, by, bw, bh);
  ctx.shadowBlur = 0;
  // Sehne spannt sich beim Nachladen sichtbar in die Nuss
  const ready = player.loaded ? 1 : clamp(player.reload / RELOAD, 0, 1);
  // gespannt wird nach hinten: die Sehne wandert zum Spieler hin in die Nuss
  ctx.strokeStyle = '#d8ceb6';
  ctx.lineWidth = Math.max(1.4, u * 0.9);
  ctx.beginPath();
  ctx.moveTo(bx + 8 * u, by + 16 * u);
  ctx.lineTo(bx + 32 * u, by + 16 * u + ready * 12 * u);
  ctx.lineTo(bx + 56 * u, by + 16 * u);
  ctx.stroke();
  if (player.loaded) {                                        // Bolzen in der Rille
    const px = bx + 30.5 * u;
    blocksOn(px, by + 2 * u, 3 * u, 26 * u, '#8f98a2');
    blocksOn(px, by + 2 * u, 1.2 * u, 26 * u, '#b9c2cb');
    blocksOn(px - 0.5 * u, by - 2 * u, 4 * u, 4 * u, '#6f767f');  // Spitze
    blocksOn(px + 0.5 * u, by - 5 * u, 2 * u, 3 * u, '#555c64');
    blocksOn(px - 2.5 * u, by + 22 * u, 8 * u, 3 * u, '#d8ceb6'); // Federn
  }
  ctx.restore();

  // Schild: fährt von unten hoch und wackelt beim Heben
  const up = player.shield ? 1 : 0;
  const sh = (player.shieldY = lerp(player.shieldY || 0, up, 0.35));
  if (sh > 0.02) {
    const w = Math.min(CW * 0.52, CH * 0.6), h = w * (46 / 40);
    const x = CW / 2 - w / 2, y = CH - h * sh + CH * 0.14;
    ctx.save();
    ctx.translate(Math.sin(time * 9) * w * 0.012 * (1 - sh), Math.sin(time * 8) * 2 * (1 - sh));
    // Arm, der das Schild von rechts hält – er ragt neben dem Brett hervor
    blocksOn(x + w * 0.86, y + h * 0.66, w * 0.24, h * 0.44, '#b8794f');
    blocksOn(x + w * 0.86, y + h * 0.66, w * 0.24, h * 0.03, '#d79a6c');
    blocksOn(x + w * 1.04, y + h * 0.66, w * 0.06, h * 0.44, '#8c5635');
    blocksOn(x + w * 0.86, y + h * 0.92, w * 0.24, h * 0.18, '#3f5aa8');
    blocksOn(x + w * 0.86, y + h * 0.92, w * 0.24, h * 0.02, '#5d78c4');
    blit(SPR.shield, x, y, w, h);
    ctx.fillStyle = 'rgba(255,140,50,0.1)';
    ctx.fillRect(x, y, w, h * 0.3);
    ctx.restore();
  }
}

// Blockfläche direkt auf dem Spielfeld (für kleine Teile wie den Bolzen)
function blocksOn(x, y, w, h, hex) {
  ctx.fillStyle = hex;
  ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

function drawBolts() {
  for (const b of bolts) {
    const t = b.t;
    const x = lerp(b.x, b.tx, t), y = lerp(b.y, b.ty, t);
    const px = lerp(b.x, b.tx, Math.max(0, t - 0.25)), py = lerp(b.y, b.ty, Math.max(0, t - 0.25));
    ctx.strokeStyle = `rgba(230,230,240,${1 - t})`;
    ctx.lineWidth = 3 - t * 2;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke();
  }
}

function drawCrosshair() {
  const x = player.aimX, y = player.aimY;
  const r = Math.min(CW, CH) * 0.035;
  ctx.save();
  ctx.globalAlpha = player.shield ? 0.3 : 1;
  ctx.strokeStyle = player.loaded ? '#eaf3fa' : '#ff9b8f';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, TAU); ctx.stroke();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    ctx.beginPath();
    ctx.moveTo(x + dx * r * 0.8, y + dy * r * 0.8);
    ctx.lineTo(x + dx * r * 1.4, y + dy * r * 1.4);
    ctx.stroke();
  }
  ctx.restore();
}

function hearts() { return '❤️'.repeat(Math.max(0, game.lives)) + '🖤'.repeat(Math.max(0, 3 - game.lives)); }

function drawHUD() {
  // Lebensbalken des Withers
  const w = Math.min(CW * 0.7, 520), x = CW / 2 - w / 2, y = 14;
  ctx.fillStyle = 'rgba(8,10,16,0.72)';
  roundRect(x - 6, y - 6, w + 12, 40, 10); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  roundRect(x, y + 12, w, 16, 8); ctx.fill();
  const frac = clamp(wither.hp / wither.hpMax, 0, 1);
  const grad = ctx.createLinearGradient(x, 0, x + w, 0);
  grad.addColorStop(0, '#d63a2f'); grad.addColorStop(1, '#e8902f');
  ctx.fillStyle = grad;
  roundRect(x, y + 12, Math.max(2, w * frac), 16, 8); ctx.fill();
  // Heilung sichtbar machen
  if (wither.regenStop <= 0 && wither.hp < wither.hpMax && game.state === 'play') {
    ctx.fillStyle = 'rgba(142,224,122,0.55)';
    roundRect(x + w * frac, y + 12, Math.min(w * 0.035, w * (1 - frac)), 16, 8); ctx.fill();
  }
  ctx.fillStyle = '#eaf3fa';
  ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center';
  ctx.fillText(`💀 WITHER · Level ${game.level} · ${Math.ceil(wither.hp)}/${wither.hpMax}`, CW / 2, y + 8);

  // Leben und Punkte
  ctx.textAlign = 'left';
  ctx.font = '18px system-ui';
  ctx.fillStyle = 'rgba(8,10,16,0.6)';
  roundRect(10, CH - 46, 128, 34, 9); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(hearts(), 18, CH - 22);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(8,10,16,0.6)';
  roundRect(CW - 138, 60, 128, 32, 9); ctx.fill();
  ctx.fillStyle = '#ffd166'; ctx.font = 'bold 15px system-ui';
  ctx.fillText(`🏆 ${game.score}`, CW - 18, 82);

  // Nachladebalken
  const rw = Math.min(CW * 0.34, 220), rx = CW / 2 - rw / 2, ry = CH - 30;
  ctx.fillStyle = 'rgba(8,10,16,0.6)';
  roundRect(rx - 4, ry - 4, rw + 8, 16, 8); ctx.fill();
  ctx.fillStyle = player.loaded ? '#8ee07a' : '#e8902f';
  const rf = player.loaded ? 1 : clamp(player.reload / RELOAD, 0, 1);
  roundRect(rx, ry, Math.max(2, rw * rf), 8, 4); ctx.fill();
  ctx.fillStyle = '#bcd6ea'; ctx.font = '11px system-ui'; ctx.textAlign = 'center';
  ctx.fillText(player.shield ? '🛡️ Schild oben – kein Nachladen'
    : player.loaded ? '🏹 geladen' : 'lädt nach …', CW / 2, ry - 8);

  // Schwebende Texte
  for (const f of floats) {
    ctx.globalAlpha = clamp(1.4 - f.t, 0, 1);
    ctx.fillStyle = f.color;
    ctx.font = 'bold 17px system-ui';
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
}

function banner(title, sub, color) {
  ctx.fillStyle = 'rgba(8,10,16,0.82)';
  roundRect(CW / 2 - 190, CH * 0.36, 380, 96, 16); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1.5;
  roundRect(CW / 2 - 190, CH * 0.36, 380, 96, 16); ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = color || '#fff'; ctx.font = 'bold 26px system-ui';
  ctx.fillText(title, CW / 2, CH * 0.36 + 42);
  ctx.fillStyle = '#bcd6ea'; ctx.font = '14px system-ui';
  ctx.fillText(sub, CW / 2, CH * 0.36 + 70);
}

function draw(time) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.save();
  if (game.shake > 0) {
    ctx.translate((Math.random() - 0.5) * game.shake * 18, (Math.random() - 0.5) * game.shake * 18);
  }
  drawArena(time);
  if (game.state !== 'over') drawWither(time);
  drawSkullShots();
  for (const p of parts) {
    ctx.globalAlpha = clamp(1 - p.t / p.life, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
  drawBolts();
  drawWeapons(time);
  ctx.restore();

  if (!player.shield && game.state !== 'over') drawCrosshair();
  drawHUD();

  // Treffer-/Feuer-Rotblende
  if (game.flash > 0) {
    ctx.fillStyle = `rgba(200,30,20,${clamp(game.flash, 0, 1) * 0.45})`;
    ctx.fillRect(0, 0, CW, CH);
  }
  if (game.burn > 0 && wither.breathT > 0 && !player.shield) {
    ctx.fillStyle = `rgba(255,120,30,${0.18})`;
    ctx.fillRect(0, 0, CW, CH);
  }

  if (game.state === 'ready') banner(`Level ${game.level}`, cfgText(), '#ffd166');
  else if (game.state === 'won') banner('💥 Wither besiegt!', `+${100 * game.level + game.lives * 25} Punkte – gleich geht es weiter`, '#8ee07a');
  else if (game.state === 'over') {
    const best = Math.max(game.score, parseFloat(localStorage.getItem('wither_best')) || 0);
    banner(game.score >= best && game.score > 0 ? '🏆 Neuer Rekord!' : '☠️ Verloren',
      `Level ${game.level} · ${game.score} Punkte · Rekord ${Math.round(best)} — R für neu`, '#ff8a7a');
  }
}
function cfgText() {
  const c = cfg();
  return `${c.hp} Leben · ${c.regen.toFixed(1)} Heilung/s · ${c.skulls} Schädel${c.breath > 0 ? ' + 🔥' : ''}`;
}

/* ------------------------------------------------------------- Eingabe ---- */

const pressed = new Set();
const buttons = {};

function aimAt(cx, cy) {
  const rect = canvas.getBoundingClientRect();
  let x = cx - rect.left, y = cy - rect.top;
  if (stage.classList.contains('rot')) { const t = x; x = y; y = rect.width - t; }
  player.aimX = clamp(x, 0, CW);
  player.aimY = clamp(y, 0, CH);
}
canvas.addEventListener('pointermove', (e) => { if (!player.shield) aimAt(e.clientX, e.clientY); });
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  Sfx.unlock();
  if (e.button === 2) { player.shield = true; return; }
  if (game.state === 'over') { startFight(); return; }
  if (!player.shield) { aimAt(e.clientX, e.clientY); shoot(); }
});
canvas.addEventListener('pointerup', (e) => { if (e.button === 2) player.shield = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function setBtn(id, down, up) {
  const el = document.getElementById(id);
  buttons[id] = { held: false };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* egal */ }
    buttons[id].held = true; el.classList.add('held');
    Sfx.unlock();
    if (down) down();
  });
  const rel = (e) => {
    e.preventDefault();
    buttons[id].held = false; el.classList.remove('held');
    if (up) up();
  };
  el.addEventListener('pointerup', rel);
  el.addEventListener('pointercancel', rel);
}
setBtn('w-shield', () => { player.shield = true; }, () => { player.shield = false; });
setBtn('w-shoot', () => { if (game.state === 'over') startFight(); else shoot(); });

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if ([' ', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'enter'].includes(k)) e.preventDefault();
  Sfx.unlock();
  if (k === ' ') { player.shield = true; return; }
  if (k === 'enter' || k === 'f') { if (game.state === 'over') startFight(); else shoot(); return; }
  if (k === 'r' && game.state === 'over') { startFight(); return; }
  pressed.add(k);
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k === ' ') player.shield = false;
  pressed.delete(k);
});
window.addEventListener('blur', () => { pressed.clear(); player.shield = false; });

function moveAim(dt) {
  const sp = Math.min(CW, CH) * 0.9 * dt;
  let dx = 0, dy = 0;
  if (pressed.has('arrowleft') || pressed.has('a')) dx -= 1;
  if (pressed.has('arrowright') || pressed.has('d')) dx += 1;
  if (pressed.has('arrowup') || pressed.has('w')) dy -= 1;
  if (pressed.has('arrowdown') || pressed.has('s')) dy += 1;
  if (dx || dy) {
    player.aimX = clamp(player.aimX + dx * sp, 0, CW);
    player.aimY = clamp(player.aimY + dy * sp, 0, CH);
  }
}

/* ----------------------------------------------------------------- Ton ---- */
const Sfx = {
  ctx: null, master: null, noise: null, on: true,
  load() { try { this.on = localStorage.getItem('wither_sound') !== '0'; } catch { /* egal */ } return this; },
  save() { try { localStorage.setItem('wither_sound', this.on ? '1' : '0'); } catch { /* egal */ } },
  init() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
    const n = Math.floor(this.ctx.sampleRate * 0.6);
    this.noise = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return true;
  },
  unlock() { if (this.on && this.init() && this.ctx.state === 'suspended') this.ctx.resume(); },
  toggle(v) { this.on = v === undefined ? !this.on : !!v; this.save(); if (this.on) this.unlock(); },
  tone(t, f, dur, type, peak, bend) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (bend) o.frequency.exponentialRampToValueAtTime(Math.max(25, f * bend), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  },
  rush(t, dur, peak, f0, f1, type = 'bandpass') {
    const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    s.buffer = this.noise;
    f.type = type; f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t, Math.random() * 0.2); s.stop(t + dur + 0.05);
  },
  play(name) {
    if (!this.on || !this.init() || this.ctx.state === 'suspended') return;
    const t = this.ctx.currentTime + 0.001;
    switch (name) {
      case 'shot': this.tone(t, 760, 0.1, 'square', 0.14, 0.4); this.rush(t, 0.12, 0.14, 2400, 600); break;
      case 'load': this.tone(t, 520, 0.06, 'square', 0.08); this.tone(t + 0.06, 700, 0.06, 'square', 0.07); break;
      case 'hit': this.tone(t, 180, 0.14, 'sawtooth', 0.18, 0.5); break;
      case 'crit': this.tone(t, 300, 0.2, 'sawtooth', 0.22, 0.4); this.tone(t + 0.04, 900, 0.18, 'triangle', 0.14); break;
      case 'miss': this.rush(t, 0.18, 0.1, 1600, 400); break;
      case 'skull': this.tone(t, 260, 0.35, 'sine', 0.16, 0.5); this.rush(t, 0.3, 0.1, 900, 300); break;
      case 'block': this.tone(t, 420, 0.14, 'square', 0.16, 0.7); this.rush(t, 0.14, 0.16, 3000, 900); break;
      case 'perfect': [600, 900, 1200].forEach((f, i) => this.tone(t + i * 0.05, f, 0.14, 'triangle', 0.16)); break;
      case 'breath': this.rush(t, 1.4, 0.22, 900, 180, 'lowpass'); this.tone(t, 90, 1.2, 'sawtooth', 0.12); break;
      case 'hurt': this.tone(t, 220, 0.3, 'sawtooth', 0.24, 0.35); this.rush(t, 0.3, 0.18, 700, 150); break;
      case 'win': [392, 523, 659, 784, 1046].forEach((f, i) => this.tone(t + i * 0.11, f, 0.3, 'triangle', 0.17)); break;
      case 'over': [440, 349, 262, 196].forEach((f, i) => this.tone(t + i * 0.16, f, 0.34, 'triangle', 0.17, 0.8)); break;
      case 'start': this.tone(t, 180, 0.5, 'sawtooth', 0.18, 2.4); break;
      default: break;
    }
  },
};

/* ----------------------------------------------------------- Bedienung ---- */

const menuEl = document.getElementById('menu');
const helpEl = document.getElementById('help');
document.getElementById('btn-menu').addEventListener('click', () => { menuEl.classList.remove('hidden'); refreshMenu(); });
document.getElementById('btn-menu-close').addEventListener('click', () => menuEl.classList.add('hidden'));
menuEl.addEventListener('click', (e) => { if (e.target === menuEl) menuEl.classList.add('hidden'); });
document.getElementById('btn-help').addEventListener('click', () => { menuEl.classList.add('hidden'); helpEl.classList.remove('hidden'); });
document.getElementById('btn-start').addEventListener('click', () => { helpEl.classList.add('hidden'); Sfx.unlock(); startFight(); });
document.getElementById('btn-restart').addEventListener('click', () => { menuEl.classList.add('hidden'); startFight(); });
document.getElementById('btn-rotate').addEventListener('click', () => { stage.classList.toggle('rot'); resize(); });
const soundBtn = document.getElementById('btn-sound');
soundBtn.addEventListener('click', () => { Sfx.toggle(); if (Sfx.on) Sfx.play('load'); refreshSound(); });
function refreshSound() {
  soundBtn.textContent = Sfx.on ? '🔊' : '🔇';
  soundBtn.classList.toggle('off', !Sfx.on);
}

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
const refreshers = [
  bindOpts('opt-diff', () => game.diff, (v) => {
    game.diff = DIFFS[v] ? v : 'normal';
    try { localStorage.setItem('wither_diff', game.diff); } catch { /* egal */ }
    startFight();
  }),
  bindOpts('opt-start', () => game.startLevel, (v) => {
    game.startLevel = parseInt(v, 10) || 1;
    try { localStorage.setItem('wither_start', String(game.startLevel)); } catch { /* egal */ }
    startFight();
  }),
];
function refreshMenu() { for (const r of refreshers) r(); refreshSound(); }

const IS_TOUCH = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)
  || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
if (!IS_TOUCH) {
  // Am Rechner wird mit der Maus gezielt und geschossen, Schild auf Leertaste
  document.getElementById('wctrl-left').classList.add('hidden');
  document.getElementById('wctrl-right').classList.add('hidden');
}
if (IS_TOUCH && window.innerWidth < window.innerHeight) stage.classList.add('rot');

/* ------------------------------------------------------------ Schleife ---- */

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  moveAim(dt);
  if (!game.paused) update(dt);
  draw(now / 1000);
  requestAnimationFrame(frame);
}

loadSettings();
Sfx.load();
refreshSound();
resize();
startFight();
refreshMenu();
requestAnimationFrame(frame);

// Test-Hook (Muster wie window.__kart / window.__rechnen)
window.__wither = {
  game, wither, player, levelCfg, cfg, DIFFS, RELOAD, DMG_BODY, DMG_HEAD, PERFECT,
  witherParts, witherBox, update, draw, shoot, startFight, setupLevel, levelWon,
  fireSkull, hurtPlayer, gameOver, Sfx, pressed, buttons, resize,
  skulls: () => skulls, parts: () => parts, floats: () => floats, bolts: () => bolts,
  setSkulls: (v) => { skulls = v; },
  size: () => ({ CW, CH, horizon: horizon() }),
};
