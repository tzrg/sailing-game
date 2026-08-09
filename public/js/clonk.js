// Klonk · Goldrausch – Hommage an Clonk 4 / Clonk Planet (eigenständig umgesetzt).
// Der volle Standard-Clonk-Baukasten: zerstörbares Pixel-Gelände mit Erde,
// Fels, Granit, Gold, Kohle, Sand (rieselt), Wasser und Lava (fließen, Lava +
// Wasser = Stein), Schwimmen/Tauchen mit Atem, Klettern, Hangeln an Decken,
// Lehmbrücken, Bäume (fällbar/brennbar, geben Holz), Wipfe, Loren,
// Chemiefabrik mit Rezepten, zwei Clonks pro Team mit Wechsel-Taste und
// Katastrophen (Regen, Erdbeben, Meteor, Vulkan). Solo gegen die 🤖-KI oder
// zu zweit an einer Tastatur; Touch-Steuerkreuz + Zoom-Kamera für Handys.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const WORLD_W = 960, WORLD_H = 1500;   // tiefe Karte: Erde, Fels, Tiefengestein

// ---- Materialien (Pixel-Maske) ---------------------------------------------
const MAT = {
  SKY: 0, EARTH: 1, ROCK: 2, GOLD: 3, TUNNEL: 4,
  WATER: 5, LAVA: 6, SAND: 7, COAL: 8, GRANIT: 9, LOAM: 10,
  PLATFORM: 11,   // Aufzugskorb des Grubenlifts (beweglich, unzerstörbar)
  ORE: 12,        // Eisenerz: nur sprengbar, wird im Hochofen zu Metall
  BEDROCK: 13,    // Kartenrand/Grundgestein: hält wirklich allem stand
};
//                  SKY    EARTH ROCK  GOLD  TUNNEL WATER  LAVA   SAND  COAL  GRANIT LOAM  PLATTF. ORE   BEDROCK
const SOLID =      [false, true, true, true, false, false, false, true, true, true,  true, true,   true, true];
const DIGGABLE =   [false, true, false, true, false, false, false, true, true, false, true, false,  false, false];
// Sprengfestigkeit: wie viele Treffer eine Zelle aushält (0 = fliegt sofort)
const TOUGH =      [0,     0,    0,    0,    0,     0,     0,     0,    0,    3,     0,    99,     0,    99];
const isFree = (m) => m === MAT.SKY || m === MAT.TUNNEL;
const isGrain = (m) => m === MAT.WATER || m === MAT.LAVA || m === MAT.SAND;

let mask;                    // Uint8Array WORLD_W*WORLD_H mit MAT-Werten
let groundY;                 // Oberflächen-Höhe je Spalte (Startzustand)
let goldSpots = [];          // Zentren der Goldadern (für die KI)
let terrainCanvas, terrainCtx, terrainImage;
const idx = (x, y) => y * WORLD_W + x;

function matAt(x, y) {
  x |= 0; y |= 0;
  if (x < 0 || x >= WORLD_W) return MAT.BEDROCK;   // Kartenränder: unzerstörbar
  if (y < 0) return MAT.SKY;
  if (y >= WORLD_H) return MAT.BEDROCK;
  return mask[idx(x, y)];
}
const solid = (x, y) => SOLID[matAt(x, y)];
// Hintergrund für freigelegte Zellen: über der ursprünglichen Oberfläche
// Himmel, darunter dunkler Stollen (sonst schwimmen dunkle Flecken im See,
// wenn Sprengungen Wasser verdrängen)
function bgMat(x, y) {
  x |= 0; y |= 0;
  return groundY && y < groundY[clamp(x, 0, WORLD_W - 1)] ? MAT.SKY : MAT.TUNNEL;
}

// ---- Zufall (seedbar, damit Tests reproduzierbar generieren können) --------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rng = mulberry32((Math.random() * 1e9) | 0);

// ---- Gelände-Erzeugung ------------------------------------------------------
const BASE_X = [92, WORLD_W - 92];   // Hütten-Positionen (links / rechts)
let trees = [];
let wipfe = [];
let birds = [];

function genTerrain() {
  mask = new Uint8Array(WORLD_W * WORLD_H);
  granitHp = new Uint8Array(WORLD_W * WORLD_H);
  groundY = new Int16Array(WORLD_W);
  goldSpots = [];
  const p1 = rng() * 6.28, p2 = rng() * 6.28, p3 = rng() * 6.28, p4 = rng() * 6.28;

  // Hügelige Oberfläche; rund um die Hütten wird sanft eingeebnet
  for (let x = 0; x < WORLD_W; x++) {
    let h = 300 + Math.sin(x * 0.008 + p1) * 55 + Math.sin(x * 0.021 + p2) * 26
      + Math.sin(x * 0.055 + p3) * 9;
    for (const bx of BASE_X) {
      const d = Math.abs(x - bx);
      if (d < 110) {
        // flacher Kern fürs Hütten-Plateau, außen weicher Übergang (Smoothstep)
        const w = d < 60 ? 1 : 1 - (d - 60) / 50;
        const ww = w * w * (3 - 2 * w);
        h = h * (1 - ww) + 296 * ww;
      }
    }
    groundY[x] = Math.round(clamp(h, 120, 460));   // Oberfläche im oberen Drittel
  }

  // Schichten: dicke Erd- und Felszone zum Buddeln, erst ganz unten Granit
  const GRANIT_TOP = WORLD_H - 260;
  for (let x = 0; x < WORLD_W; x++) {
    const rockTop = groundY[x] + 380 + Math.sin(x * 0.016 + p4) * 70;   // dicke Erdzone
    const granitTop = GRANIT_TOP + Math.sin(x * 0.011 + p2) * 34 + Math.sin(x * 0.03 + p3) * 12;
    for (let y = groundY[x]; y < WORLD_H; y++) {
      let m = y >= rockTop ? MAT.ROCK : MAT.EARTH;
      // Tiefe: Granitbänder mit Fels-Zwischenlagen (sprengbar, aber zäh)
      if (y >= granitTop) {
        const band = Math.sin(y * 0.06 + Math.sin(x * 0.02) * 1.6);
        m = band > -0.35 ? MAT.GRANIT : MAT.ROCK;
      }
      if (y >= WORLD_H - 6 || x < 4 || x >= WORLD_W - 4) m = MAT.BEDROCK;
      mask[idx(x, y)] = m;
    }
  }

  const blob = (cx, cy, r, mat, onlyIn) => {
    cx |= 0; cy |= 0; r = Math.round(r);
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || x >= WORLD_W || y < 0 || y >= WORLD_H) continue;
      const dx = x - cx, dy = y - cy;
      // unrunder Rand: leichtes Rauschen auf dem Radius
      const wob = 1 + (texNoise(x >> 2, y >> 2) - 0.5) * 0.55;
      if (dx * dx + dy * dy * 1.35 > (r * wob) ** 2) continue;
      const m = mask[idx(x, y)];
      if (!onlyIn || onlyIn.includes(m)) mask[idx(x, y)] = mat;
    }
  };
  // Organische Ader: mäandernder Random-Walk mit wechselnder Dicke und
  // Verästelungen – so sehen Gold-, Kohle- und Erzvorkommen aus wie gewachsen
  // statt wie hingelegte Eier.
  const vein = (cx, cy, mat, onlyIn, opts = {}) => {
    const len = opts.len || 60;
    const thick = opts.thick || 5;
    const branches = opts.branches === undefined ? 2 : opts.branches;
    let a = opts.angle === undefined ? rng() * Math.PI * 2 : opts.angle;
    let x = cx, y = cy;
    const pts = [];
    for (let i = 0; i < len; i++) {
      a += (rng() - 0.5) * 0.55;
      // Adern ziehen bevorzugt in die Waagerechte (wie echte Flöze)
      a = a * 0.9 + (Math.abs(Math.cos(a)) > 0.5 ? a : Math.atan2(Math.sin(a) * 0.5, Math.cos(a))) * 0.1;
      x += Math.cos(a) * 2.2; y += Math.sin(a) * 1.5;
      if (x < 20 || x > WORLD_W - 20 || y < 60 || y > WORLD_H - 20) break;
      const t = i / len;
      const r = thick * (0.55 + Math.sin(t * Math.PI) * 0.9) * (0.75 + rng() * 0.5);
      blob(x, y, Math.max(2, r), mat, onlyIn);
      pts.push({ x, y, a });
    }
    for (let b = 0; b < branches && pts.length > 6; b++) {
      const p = pts[(6 + rng() * (pts.length - 6)) | 0];
      vein(p.x, p.y, mat, onlyIn, {
        len: len * (0.35 + rng() * 0.3), thick: thick * 0.7, branches: 0,
        angle: p.a + (rng() < 0.5 ? -1 : 1) * (0.7 + rng() * 0.8),
      });
    }
    return pts;
  };

  // ---- Bodenschätze: je tiefer, desto fetter (organische Adern) ----------
  const surf = (x) => groundY[clamp(x | 0, 0, WORLD_W - 1)];
  const randX = (m) => m + ((rng() * (WORLD_W - 2 * m)) | 0);
  // Zone 1 – flache Erde: kleine Nester zum Warmlaufen
  for (let i = 0; i < 7; i++) {
    const x = randX(50), y = (surf(x) + 40 + rng() * 90) | 0;
    vein(x, y, MAT.GOLD, [MAT.EARTH], { len: 22 + rng() * 14, thick: 3.5 + rng() * 1.5, branches: 1 });
    goldSpots.push({ x, y, rock: false });
  }
  // Zone 2 – tiefe Erde: ordentliche Flöze, noch mit der Schaufel abbaubar
  for (let i = 0; i < 10; i++) {
    const x = randX(50), y = (surf(x) + 150 + rng() * 210) | 0;
    vein(x, y, MAT.GOLD, [MAT.EARTH, MAT.ROCK], { len: 50 + rng() * 40, thick: 6 + rng() * 3, branches: 2 });
    goldSpots.push({ x, y, rock: false });
  }
  // Zone 3 – Felszone: dicke, weit verzweigte Adern
  for (let i = 0; i < 7; i++) {
    const x = randX(60), y = (GRANIT_TOP - 80 - rng() * 380) | 0;
    vein(x, y, MAT.GOLD, [MAT.ROCK, MAT.EARTH], { len: 70 + rng() * 50, thick: 8 + rng() * 4, branches: 3 });
    goldSpots.push({ x, y, rock: true });
  }
  // Zone 4 – Granit: Mutterlager, riesig und stark verästelt
  for (let i = 0; i < 5; i++) {
    const x = randX(90), y = (GRANIT_TOP + 50 + rng() * 150) | 0;
    vein(x, y, MAT.GOLD, [MAT.ROCK, MAT.GRANIT], { len: 95 + rng() * 60, thick: 12 + rng() * 6, branches: 4 });
    goldSpots.push({ x, y, rock: true, deep: true });
  }
  // Kohleflöze: oben klein, in der Tiefe lange Bänder
  for (let i = 0; i < 7; i++) {
    const x = randX(50), y = (surf(x) + 35 + rng() * 150) | 0;
    vein(x, y, MAT.COAL, [MAT.EARTH], { len: 26 + rng() * 20, thick: 3.5 + rng() * 2, branches: 1 });
  }
  for (let i = 0; i < 6; i++) {
    const x = randX(50), y = (GRANIT_TOP - 100 - rng() * 380) | 0;
    vein(x, y, MAT.COAL, [MAT.ROCK], { len: 60 + rng() * 40, thick: 6 + rng() * 3, branches: 2 });
  }
  // Eisenerz: nur sprengbar, im Fels und als dicke Lager im Granit
  for (let i = 0; i < 7; i++) {
    const x = randX(50), y = (GRANIT_TOP - 60 - rng() * 400) | 0;
    vein(x, y, MAT.ORE, [MAT.ROCK], { len: 45 + rng() * 35, thick: 6 + rng() * 3, branches: 2 });
  }
  for (let i = 0; i < 4; i++) {
    const x = randX(90), y = (GRANIT_TOP + 70 + rng() * 140) | 0;
    vein(x, y, MAT.ORE, [MAT.ROCK, MAT.GRANIT], { len: 70 + rng() * 40, thick: 9 + rng() * 4, branches: 3 });
  }
  // Sandtaschen in der Erdzone (rieseln beim Anschneiden nach)
  for (let i = 0; i < 6; i++) {
    const x = randX(70), y = (surf(x) + 30 + rng() * 180) | 0;
    blob(x, y, 7 + rng() * 6, MAT.SAND, [MAT.EARTH]);
  }
  // Höhlen: kleine in der Erde, weite Kavernen als Baugrund für Anlagen,
  // Lavaseen ganz unten
  for (let i = 0; i < 6; i++) {
    const x = randX(80), y = (surf(x) + 70 + rng() * 150) | 0;
    blob(x, y, 10 + rng() * 10, MAT.TUNNEL, [MAT.EARTH]);
  }
  for (let i = 0; i < 4; i++) {   // breite, flache Hallen zum Ausbauen
    const x = randX(120), y = (surf(x) + 200 + rng() * 220) | 0;
    for (let k = -3; k <= 3; k++) blob(x + k * 14, y + Math.sin(k) * 6, 13 + rng() * 6, MAT.TUNNEL, [MAT.EARTH, MAT.ROCK, MAT.SAND]);
  }
  for (let i = 0; i < 5; i++) {
    const x = randX(90), y = (GRANIT_TOP - 60 - rng() * 320) | 0;
    for (let k = -2; k <= 2; k++) blob(x + k * 16, y + Math.sin(k * 1.3) * 8, 15 + rng() * 8, MAT.TUNNEL, [MAT.ROCK, MAT.COAL, MAT.ORE]);
  }
  for (let i = 0; i < 3; i++) {
    const x = randX(140), y = (WORLD_H - 60 - rng() * 120) | 0;
    blob(x, y, 16 + rng() * 10, MAT.TUNNEL, [MAT.ROCK, MAT.GRANIT, MAT.GOLD, MAT.ORE]);
    blob(x, y + 10, 15 + rng() * 6, MAT.LAVA, [MAT.TUNNEL]);
  }

  // See in der tiefsten Senke (weit weg von den Hütten)
  let vx = -1, vy = -1;
  for (let x = 220; x < WORLD_W - 220; x++) {
    if (Math.abs(x - BASE_X[0]) < 170 || Math.abs(x - BASE_X[1]) < 170) continue;
    if (groundY[x] > vy) { vy = groundY[x]; vx = x; }
  }
  if (vx >= 0) {
    const level = vy - 22;
    for (let x = Math.max(6, vx - 140); x < Math.min(WORLD_W - 6, vx + 140); x++) {
      if (groundY[x] <= level) continue;
      for (let y = level; y < groundY[x]; y++) {
        if (mask[idx(x, y)] === MAT.SKY) mask[idx(x, y)] = MAT.WATER;
      }
    }
  }

  // Bäume auf freier Fläche (nicht an Hütten, nicht im See)
  trees = [];
  for (let i = 0; i < 24 && trees.length < 8; i++) {
    const x = 60 + ((rng() * (WORLD_W - 120)) | 0);
    if (Math.abs(x - BASE_X[0]) < 80 || Math.abs(x - BASE_X[1]) < 80) continue;
    const g = groundY[x];
    if (matAt(x, g - 4) === MAT.WATER) continue;
    if (Math.abs(groundY[clamp(x - 6, 0, WORLD_W - 1)] - groundY[clamp(x + 6, 0, WORLD_W - 1)]) > 9) continue;
    if (trees.some((t) => Math.abs(t.x - x) < 46)) continue;
    trees.push({ x, y: g, h: 24 + rng() * 12, sway: rng() * 6.28, burn: 0, dead: false });
  }

  // Wipfe: kleine Erdbuddler
  wipfe = [];
  for (let i = 0; i < 3; i++) {
    const x = 150 + ((rng() * (WORLD_W - 300)) | 0);
    wipfe.push({ x, y: groundY[x] - 1, dir: rng() < 0.5 ? -1 : 1, t: rng() * 3, state: 'walk', fleeT: 0, dead: false, respT: 0 });
  }
  // Fische im See (Wasserzellen einsammeln und ein paar besetzen)
  fish = [];
  const pond = [];
  for (let x = 20; x < WORLD_W - 20; x += 7) {
    for (let y = 150; y < WORLD_H - 20; y += 7) {
      if (mask[idx(x, y)] === MAT.WATER && mask[idx(x, y + 6)] === MAT.WATER) pond.push({ x, y });
    }
  }
  for (let i = 0; i < 6 && pond.length; i++) {
    const s = pond[(rng() * pond.length) | 0];
    fish.push({ x: s.x, y: s.y, dir: rng() < 0.5 ? -1 : 1, v: 18 + rng() * 16, ph: rng() * 6.28, size: 0.8 + rng() * 0.5 });
  }

  // Vögel: ziehen ihre Kreise über der Landschaft
  birds = [];
  for (let i = 0; i < 5; i++) {
    birds.push({
      x: rng() * WORLD_W, y: 60 + rng() * 140, dir: rng() < 0.5 ? -1 : 1,
      v: 26 + rng() * 22, ph: rng() * 6.28, amp: 6 + rng() * 10, scale: 0.8 + rng() * 0.5,
    });
  }
}

// ---- Terrain-Rendering (eigener Offscreen-Canvas wie bei Lemminge) ---------
function buildTerrainCanvas() {
  terrainCanvas = document.createElement('canvas');
  terrainCanvas.width = WORLD_W; terrainCanvas.height = WORLD_H;
  terrainCtx = terrainCanvas.getContext('2d');
  terrainImage = terrainCtx.createImageData(WORLD_W, WORLD_H);
  recolor(0, 0, WORLD_W, WORLD_H);
  terrainCtx.putImageData(terrainImage, 0, 0);
}
// körniges Textur-Rauschen (zwei "Oktaven": fein + blockig) für den
// erdig-handgemalten Clonk-Look
function texNoise(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) & 255) / 255;
}
function recolor(x0, y0, x1, y1) {
  x0 = clamp(x0 | 0, 0, WORLD_W); x1 = clamp(x1 | 0, 0, WORLD_W);
  y0 = clamp(y0 | 0, 0, WORLD_H); y1 = clamp(y1 | 0, 0, WORLD_H);
  const d = terrainImage.data;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = idx(x, y), p = i * 4, m = mask[i];
    const n = texNoise(x, y);                 // feines Korn
    const n2 = texNoise(x >> 2, y >> 2);      // blockige Flecken
    if (m === MAT.SKY) { d[p + 3] = 0; continue; }
    d[p + 3] = 255;
    if (m === MAT.TUNNEL) {                   // Stollen: dunkler Erd-Hintergrund
      d[p] = 42 + n * 10 + n2 * 6; d[p + 1] = 29 + n * 7; d[p + 2] = 19; continue;
    }
    if (m === MAT.WATER) {                    // halbtransparent, leichte Wellenbänder
      const band = y % 9 < 2 ? 10 : 0;
      d[p] = 36 + n * 10 + band; d[p + 1] = 102 + n * 14 + band; d[p + 2] = 192 + band; d[p + 3] = 170; continue;
    }
    if (m === MAT.LAVA) {                     // glühende Schlieren
      const hot = n2 > 0.55;
      d[p] = hot ? 250 : 205 + n * 24; d[p + 1] = (hot ? 140 : 68) + n * 26; d[p + 2] = hot ? 46 : 24; continue;
    }
    if (m === MAT.SAND) {
      const spk = n > 0.92 ? 26 : 0;
      d[p] = 202 + n * 18 + spk; d[p + 1] = 178 + n * 14 + spk; d[p + 2] = 118 + spk; continue;
    }
    if (m === MAT.COAL) {                     // fast schwarz mit Glanzpunkten
      const shine = n > 0.94 ? 62 : 0;
      d[p] = 38 + n * 10 + shine; d[p + 1] = 38 + n * 10 + shine; d[p + 2] = 44 + shine; continue;
    }
    if (m === MAT.GRANIT) {                   // dunkles Gestein, angeschlagen heller gesprenkelt
      const hp = granitHp && granitHp[i] ? granitHp[i] : TOUGH[MAT.GRANIT];
      const crack = hp < TOUGH[MAT.GRANIT] && n > 0.45 ? (TOUGH[MAT.GRANIT] - hp) * 12 : 0;
      const g = 56 + n * 10 + (n2 > 0.75 ? 22 : 0) + crack;
      d[p] = g + crack * 0.4; d[p + 1] = g; d[p + 2] = g + 9; continue;
    }
    if (m === MAT.BEDROCK) {                  // Grundgestein: fast schwarz, sehr grob
      const g = 34 + n * 8 + (n2 > 0.8 ? 14 : 0);
      d[p] = g; d[p + 1] = g; d[p + 2] = g + 6; continue;
    }
    if (m === MAT.ORE) {                      // Eisenerz: rostrote Adern im Grau
      const vein = texNoise(x >> 1, y >> 1) > 0.62;
      if (vein) { d[p] = 166 + n * 22; d[p + 1] = 88 + n * 16; d[p + 2] = 52; }
      else { d[p] = 96 + n * 14; d[p + 1] = 86 + n * 12; d[p + 2] = 84; }
      continue;
    }
    if (m === MAT.LOAM) {
      d[p] = 164 + n * 18; d[p + 1] = 132 + n * 14; d[p + 2] = 80 + n2 * 10; continue;
    }
    if (m === MAT.PLATFORM) {                 // Stahlkorb mit Nieten
      const b = (x + y) % 5 === 0 ? 34 : 0;
      d[p] = 116 + n * 10 + b; d[p + 1] = 112 + n * 10 + b; d[p + 2] = 124 + b; continue;
    }
    if (m === MAT.ROCK) {                     // Fels mit Schichten und Rissen
      let g = 94 + n * 18 + (n2 > 0.62 ? 13 : 0);
      if (texNoise(x >> 1, y >> 1) > 0.96) g -= 34;   // Risse
      d[p] = g; d[p + 1] = g + 4; d[p + 2] = g + 10; continue;
    }
    if (m === MAT.GOLD) {                     // glitzernde Klumpen-Klüfte
      const blk = texNoise(x >> 1, y >> 1);
      if (blk > 0.72) { d[p] = 255; d[p + 1] = 218 + n * 20; d[p + 2] = 90; }
      else if (n < 0.07) { d[p] = 150; d[p + 1] = 110; d[p + 2] = 26; }
      else { d[p] = 204 + n * 18; d[p + 1] = 158 + n * 18; d[p + 2] = 42; }
      continue;
    }
    // Erde – Grasnarbe (mit unregelmäßigen Halmen) nur, wo oberhalb Himmel ist
    let skyDist = 0;
    for (let k = 1; k <= 5; k++) { if (matAt(x, y - k) === MAT.SKY) { skyDist = k; break; } }
    const grassDepth = 2 + ((texNoise(x, 0) * 3) | 0);
    if (skyDist && skyDist <= grassDepth) {
      const light = skyDist === 1 ? 22 : 0;
      d[p] = 78 + n * 20 + light * 0.4; d[p + 1] = 136 + n * 20 + light; d[p + 2] = 58 + light * 0.3;
      continue;
    }
    const pebble = n > 0.955;
    const fleck = n < 0.04;
    let r = 118 + n * 14 + n2 * 10, g2 = 86 + n * 11 + n2 * 8, b = 52 + n * 7;
    if (pebble) { r -= 34; g2 -= 28; b -= 18; }
    if (fleck) { r += 22; g2 += 18; b += 10; }
    d[p] = r; d[p + 1] = g2; d[p + 2] = b;
  }
}
function applyRegion(x, y, w, h) {
  recolor(x - 2, y - 6, x + w + 2, y + h + 2);
  terrainCtx.putImageData(terrainImage, 0, 0);
}
// setzt Material in ein Rechteck (Lehmbrücke) – nur in freie/flüssige Zellen
function fillMat(x0, y0, w, h, mat) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    if (x < 1 || x >= WORLD_W - 1 || y < 1 || y >= WORLD_H - 1) continue;
    const m = mask[idx(x, y)];
    if (isFree(m) || m === MAT.WATER) mask[idx(x, y)] = mat;
  }
  applyRegion(x0, y0, w, h);
  wakeArea(x0 - 3, y0 - 3, x0 + w + 3, y0 + h + 3);
}

// Granit-Schadenskarte: Granit hält im Original mehrere Sprengungen aus,
// bröckelt aber Stück für Stück weg (nur der Kartenrand ist wirklich fest).
let granitHp = null;

// Kreis ausheben. breakRock=false: Fels bleibt stehen (Graben);
// true: Sprengung – alles außer Grundgestein fliegt, Granit erst nach
// mehreren Treffern. Liefert Gold-Pixel, Kohle/Erz in lastCoal/lastOre.
function carveCircle(cx, cy, r, breakRock) {
  cx |= 0; cy |= 0;
  let gold = 0, coal = 0, ore = 0;
  const r2 = r * r;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || x >= WORLD_W || y < 0 || y >= WORLD_H) continue;
      if ((x - cx) ** 2 + (y - cy) ** 2 > r2) continue;
      const i = idx(x, y), m = mask[i];
      if (isFree(m) || m === MAT.PLATFORM || m === MAT.BEDROCK) continue;
      if (!breakRock && !DIGGABLE[m]) continue;         // Fels/Wasser/Lava: Schaufel scheitert
      if (breakRock && TOUGH[m] > 0) {                  // zäh: erst anschlagen
        granitHp[i] = (granitHp[i] || TOUGH[m]) - 1;
        if (granitHp[i] > 0) continue;
      }
      if (breakRock && (m === MAT.WATER || m === MAT.LAVA)) {
        mask[i] = bgMat(x, y);                           // Sprengung verdrängt Flüssigkeit
        continue;
      }
      if (m === MAT.GOLD) gold++;
      if (m === MAT.COAL) coal++;
      if (m === MAT.ORE) ore++;
      // oben offen? Dann wird's Himmel, sonst dunkler Stollen
      mask[i] = bgMat(x, y);
    }
  }
  applyRegion(cx - r, cy - r, 2 * r + 1, 2 * r + 1);
  wakeArea(cx - r - 3, cy - r - 3, cx + r + 3, cy + r + 3);
  carveCircle.lastCoal = coal;
  carveCircle.lastOre = ore;
  return gold;
}
carveCircle.lastCoal = 0;
carveCircle.lastOre = 0;

// ---- Flüssigkeits-/Sand-Simulation ------------------------------------------
// Zellautomat mit Aktiv-Liste: Wasser & Lava fallen und fließen seitlich,
// Sand rieselt. Lava + Wasser => Fels. Budget pro Frame hält die FPS stabil.
let active = [];
let activeFlag;
let simTick = 0;
let dirty = null;
function wake(x, y) {
  if (x < 0 || x >= WORLD_W || y < 0 || y >= WORLD_H) return;
  const i = idx(x, y);
  if (!isGrain(mask[i]) || activeFlag[i]) return;
  activeFlag[i] = 1; active.push(i);
}
function wakeArea(x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) wake(x, y);
}
function markDirty(x, y) {
  if (!dirty) dirty = { x0: x, y0: y, x1: x, y1: y };
  else {
    if (x < dirty.x0) dirty.x0 = x; if (x > dirty.x1) dirty.x1 = x;
    if (y < dirty.y0) dirty.y0 = y; if (y > dirty.y1) dirty.y1 = y;
  }
}
// Lava trifft Wasser: an der Kontaktstelle entsteht Fels (+ Dampf)
function quench(x, y) {
  const i = idx(x, y);
  mask[i] = MAT.ROCK;
  markDirty(x, y);
  puff(x, y, 2, '#cfd8dd');
}
function tryFlow(i, x, y, m) {
  const liquid = m !== MAT.SAND;
  const opposing = m === MAT.WATER ? MAT.LAVA : m === MAT.LAVA ? MAT.WATER : -1;
  const moves = [];
  if (y + 1 < WORLD_H) moves.push(i + WORLD_W);
  const par = ((x + simTick) & 1) ? 1 : -1;
  if (y + 1 < WORLD_H) { moves.push(i + WORLD_W + par, i + WORLD_W - par); }
  if (liquid) moves.push(i + par, i - par);
  for (const j of moves) {
    const jy = (j / WORLD_W) | 0, jx = j - jy * WORLD_W;
    if (Math.abs(jx - x) > 1) continue;                 // Zeilenumbruch abfangen
    const mj = mask[j];
    if (opposing !== -1 && mj === opposing) { quench(jx, jy); mask[i] = bgMat(x, y); markDirty(x, y); return true; }
    if (!isFree(mj)) continue;
    mask[j] = m;
    mask[i] = bgMat(x, y);
    activeFlag[j] = 1; active.push(j);
    markDirty(x, y); markDirty(jx, jy);
    wake(x - 1, y); wake(x + 1, y); wake(x, y - 1);
    wake(jx - 1, jy); wake(jx + 1, jy); wake(jx, jy - 1);
    return true;
  }
  return false;
}
function simStep(budget = 6000) {
  simTick++;
  const n = Math.min(active.length, budget);
  const next = [];
  for (let k = 0; k < active.length; k++) {
    const i = active[k];
    activeFlag[i] = 0;
    if (k >= n) { const m = mask[i]; if (isGrain(m)) { activeFlag[i] = 1; next.push(i); } continue; }
    const m = mask[i];
    if (!isGrain(m)) continue;
    const y = (i / WORLD_W) | 0, x = i - y * WORLD_W;
    if (tryFlow(i, x, y, m)) continue;
    // liegt still – schläft, bis Nachbarn wecken
  }
  active = next;
  if (dirty) {
    applyRegion(dirty.x0, dirty.y0, dirty.x1 - dirty.x0 + 1, dirty.y1 - dirty.y0 + 1);
    dirty = null;
  }
}

// ---- Spielzustand -----------------------------------------------------------
const GOLD_PER_NUGGET = 42;   // so viele Gold-Pixel ergeben einen Klumpen
const COAL_PER_CHUNK = 40;
const ORE_PER_CHUNK = 60;
// Ein Clonk trägt wie im Original nur eine Handvoll Zeug – alles andere
// liegt herum und will mit der Lore transportiert werden.
const SLOTS = 4;
const FLINT_MAX = SLOTS;
const LORE_MAX = 24;
const LOAM_MAX = SLOTS;
// Tragbare Güter (Feld am Clonk / Schlüssel im Basis-Lager / Item-Typ)
const GOODS = [
  { key: 'flint', field: 'flints', emoji: '💣' },
  { key: 'loam', field: 'loam', emoji: '🧱' },
  { key: 'rail', field: 'rail', emoji: '🛤' },
  { key: 'nugget', field: 'carry', emoji: '💰' },
  { key: 'coal', field: 'coal', emoji: '⚫' },
  { key: 'ore', field: 'ore', emoji: '🪨' },
  { key: 'metal', field: 'metal', emoji: '🔩' },
  { key: 'plank', field: 'plank', emoji: '🪜' },
  { key: 'wood', field: 'wood', emoji: '🪵' },
];
const goodOf = (key) => GOODS.find((g) => g.key === key);
// belegte Plätze = Summe aller getragenen Güter
function invCount(c) {
  let n = 0;
  for (const g of GOODS) n += c[g.field] || 0;
  return n;
}
const invFree = (c) => Math.max(0, SLOTS - invCount(c));
// Basis-Lager eines Teams (die Lore kippt hier ab, die Werke greifen darauf zu)
function stockOf(c) { return teamOf(c).stock; }
function have(c, key) { return (c[goodOf(key).field] || 0) + (stockOf(c)[key] || 0); }
// verbraucht n Stück: erst aus dem Lager, dann aus der Hand
function takeRes(c, key, n) {
  const st = stockOf(c), f = goodOf(key).field;
  const fromStock = Math.min(n, st[key] || 0);
  st[key] -= fromStock; n -= fromStock;
  if (n > 0) c[f] = Math.max(0, (c[f] || 0) - n);
}
// gibt n Stück aus: erst in die Hand (soweit Platz), Rest ins Lager
function giveRes(c, key, n) {
  const st = stockOf(c), f = goodOf(key).field;
  const toHand = Math.min(n, invFree(c));
  c[f] = (c[f] || 0) + toHand;
  st[key] = (st[key] || 0) + (n - toHand);
}
const ROUND_TIME = 300;
const IS_TOUCH = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)
  || 'ontouchstart' in window;

const MODES = ['sandbox', 'solo', '2p'];
const game = {
  state: 'play', paused: false, t: ROUND_TIME, goal: 8, winner: null,
  mode: 'sandbox',            // 'sandbox' (offen, koop) | 'solo' (gegen KI) | '2p'
  disasters: 'normal',        // 'aus' | 'normal' | 'wild'
  flintDropT: 12, shakeT: 0, shakeA: 0,
  disasterT: 60, rainT: 0, rainBudget: 0, quakeT: 0,
};
try {
  const m = localStorage.getItem('clonk_mode');
  game.mode = MODES.includes(m) ? m : 'sandbox';
  game.disasters = localStorage.getItem('clonk_disasters') || 'normal';
} catch { /* egal */ }

let players = [];        // die beiden Team-Anführer (zugleich Clonk Nr. 1)
let items = [];          // { type, x, y, vx, vy, buried, chute, rest }
let projectiles = [];    // Feuersteine + Meteore
let lores = [];          // Minen-Loren { team, x, y, vx, vy, load{} }
let railY = null;        // Schienen-Höhe je Spalte (-1 = keine Schiene)
let fish = [];           // Fische im See
let elevators = [];      // Grubenlifte { team, x, y (Korb-Oberkante), topY, acc }
let volcanoes = [];      // aktive Vulkanschlote
let parts = [];          // Partikel
let floats = [];         // aufsteigende Textchen

// Klonk-Maße & Physik. CWH: schmaler Kollisionskern, damit Hänge bis ~45°
// begehbar bleiben (der gezeichnete Klonk ist breiter als seine Kollision).
const HW = 4, CWH = 2, PH = 16;      // halbe Breite (Optik/Kollision), Höhe (Füße = y)
const WALK = 88, G = 520, JUMP_VY = -238, MAXFALL = 470;
const STEP_UP = 6, STEP_DOWN = 5;
const SCALE_SPEED = 56, DIG_SPEED = 36, DIG_R = 9;
const SWIM_SPEED = 66, HANGLE_SPEED = 44;
const FALL_HURT = 330;
const BREATH_TIME = 11;

function makeClonk(id, name, color, keys, baseX) {
  return {
    id, name, color, keys, base: { x: baseX, y: 0 },
    x: 0, y: 0, vx: 0, vy: 0, dir: id === 0 ? 1 : -1,
    state: 'air', hp: 100, carry: 0, flints: 1, coal: 0, wood: 0, loam: 1,
    ore: 0, metal: 0, plank: 0, rail: 0, score: 0, ko: 0,
    stock: { flint: 3, loam: 2, rail: 8, nugget: 0, coal: 2, ore: 0, metal: 0, plank: 0, wood: 0 },
    breath: 1, burnT: 0, goldPix: 0, coalPix: 0, rem: 0, bridgeT: 0,
    respawnT: 0, tumbleT: 0, throwCd: 0, hurtT: 0, throwSel: 0,
    walkPhase: 0, prevThrow: false, prevUse: false, prevSwitch: false, prevCycle: false,
    ai: false, buddy: null, lead: null, controlled: null,
    virt: { left: false, right: false, jump: false, dig: false, throw: false, use: false, switch: false },
    aiS: { thinkT: 0, target: null, lastX: 0, lastY: 0, stuckT: 0, phase: 'seek', backoffT: 0, backDir: 0, throwAfter: false, waitT: 0, throwNow: false },
  };
}
const teamOf = (c) => c.lead || c;
const otherClonk = (c) => (c.lead ? c.lead : c.buddy);
function allClonks() {
  const out = [];
  for (const p of players) { out.push(p); if (p.buddy) out.push(p.buddy); }
  return out;
}

function startGame(seed) {
  rng = mulberry32((seed !== undefined ? seed : (Math.random() * 1e9)) | 0);
  genTerrain();
  buildTerrainCanvas();
  activeFlag = new Uint8Array(WORLD_W * WORLD_H);
  active = []; dirty = null;
  // alle beweglichen Materialien einmal wecken, dann pendelt sich alles ein
  for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++) wake(x, y);

  items = []; projectiles = []; parts = []; floats = []; volcanoes = [];
  pendingBooms.length = 0;
  game.state = 'play'; game.paused = false; game.t = ROUND_TIME;
  game.winner = null; game.flintDropT = 12; game.shakeT = 0;
  game.disasterT = (game.disasters === 'wild' ? 25 : 55) + rng() * 30;
  game.rainT = 0; game.quakeT = 0;

  players = [
    makeClonk(0, 'Rot', '#e74c3c',
      { left: ['a'], right: ['d'], jump: ['w'], dig: ['s'], throw: ['q'], use: ['e'], switch: ['f'], cycle: ['r'] }, BASE_X[0]),
    makeClonk(1, 'Blau', '#3f7fd6',
      { left: ['arrowleft'], right: ['arrowright'], jump: ['arrowup'], dig: ['arrowdown'], throw: [','], use: ['.', '-'], switch: ['n'], cycle: ['m'] }, BASE_X[1]),
  ];
  players[1].ai = game.mode === 'solo';
  for (const p of players) {
    p.base.y = groundY[p.base.x];
    p.x = p.base.x + (p.id === 0 ? 26 : -26);
    p.y = groundY[p.x | 0] - 1;
    // zweiter Clonk der Mannschaft (teilt sich Basis und Lager)
    const b = makeClonk(p.id, p.name, p.color, p.keys, p.base.x);
    b.lead = p; b.base = p.base; b.flints = 1; b.loam = 1; b.stock = p.stock;
    b.x = p.base.x + (p.id === 0 ? 8 : -8);
    b.y = groundY[b.x | 0] - 1;
    p.buddy = b;
    p.controlled = p;
    p.aiS.lastX = p.x; p.aiS.lastY = p.y;
  }
  // je Hütte eine Lore (Richtung Kartenmitte geparkt, auf der Oberfläche)
  lores = players.map((p) => {
    const lx = p.base.x + (p.id === 0 ? 44 : -44);
    return { team: p.id, x: lx, y: groundY[lx] - 1, vx: 0, vy: 0, load: {} };
  });
  // Schienenstück ab Werk vor jeder Hütte (Anschluss ans Netz)
  railY = new Int16Array(WORLD_W).fill(-1);
  for (const p of players) {
    const from = p.id === 0 ? p.base.x + 20 : p.base.x - 56;
    for (let x = from; x < from + 36; x++) railY[clamp(x, 0, WORLD_W - 1)] = groundY[clamp(x, 0, WORLD_W - 1)] - 1;
  }
  // je Team ein Grubenlift mit Förderturm (Richtung Kartenmitte)
  elevators = players.map((p) => {
    const ex = p.base.x + (p.id === 0 ? 66 : -66);
    // Korb (3 px hoch) sitzt zu Beginn auf der Oberfläche
    const el = { team: p.id, x: ex, y: groundY[ex] - 3, topY: groundY[ex] - 3, acc: 0, goldPix: 0, coalPix: 0 };
    // Schachtstation freiräumen: kein Geländeüberhang über dem Korb,
    // damit Fahrgäste oben sauber ein- und aussteigen können
    for (let y = el.topY - 18; y <= el.topY + 2; y++) {
      for (let x = el.x - CASE_HW - 1; x <= el.x + CASE_HW + 1; x++) {
        const m = matAt(x, y);
        if (m !== MAT.GRANIT && SOLID[m]) {
          mask[idx(x, y)] = bgMat(x, y);
        }
      }
    }
    writeCase(el);
    applyRegion(el.x - CASE_HW - 2, el.topY - 20, CASE_HW * 2 + 5, 26);
    return el;
  });

  // Fundsachen: Feuersteine offen + vergraben, Lehmklumpen vergraben
  for (let i = 0; i < 3; i++) {
    const x = 300 + ((rng() * 360) | 0);
    items.push({ type: 'flint', x, y: groundY[x] - 3, vx: 0, vy: 0 });
  }
  for (let i = 0; i < 8; i++) {
    const x = 50 + ((rng() * (WORLD_W - 100)) | 0);
    const y = groundY[x] + 25 + rng() * (WORLD_H - groundY[x] - 80);
    items.push({ type: 'flint', x, y: y | 0, vx: 0, vy: 0, buried: true });
  }
  for (let i = 0; i < 6; i++) {
    const x = 60 + ((rng() * (WORLD_W - 120)) | 0);
    const y = groundY[x] + 20 + rng() * 70;
    items.push({ type: 'loam', x, y: y | 0, vx: 0, vy: 0, buried: true });
  }

  // Kamera zurücksetzen + Touch-Layout an den Modus anpassen
  cam.zoom = game.mode === '2p' ? 1 : 2.1;
  cam.x = WORLD_W / 2; cam.y = WORLD_H / 2; cam.scale = 0;
  layoutTouch();
}

// ---- Eingabe (Tastatur + Touch-Joysticks/-Buttons + KI) ---------------------
const pressed = new Set();
const buttons = {};   // Touch-Buttons (Aktionen)
// Virtuelle Joysticks: Team Rot links, Team Blau (nur 2P) rechts.
// dx/dy sind normiert (-1..1) und bereits um die Bühnendrehung bereinigt.
const joys = [{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }];
const JOY_X = 0.38, JOY_Y = 0.45;
const TOUCH_MAPS = [
  { dig: 'b-dig', throw: 'b-fire', use: 'b-buy', switch: 'b-switch' },
  { dig: 'b2-dig', throw: 'b2-fire', use: 'b2-buy', switch: 'b2-switch' },
];

// 'dig' = Schaufel ansetzen (nur Grabtaste/⛏️-Button, NICHT der Joystick).
// 'down' = Runter-Bewegung (abtauchen, abseilen, Lift bohren): zusätzlich
// auch über den Joystick nach unten.
function down(p, action) {
  const key = action === 'down' ? 'dig' : action;
  if (p.ai) return !!p.virt[key];
  if (p.keys[key].some((k) => pressed.has(k))) return true;
  const b = buttons[TOUCH_MAPS[p.id][key]];
  if (b && b.held) return true;
  const js = joys[p.id];
  if (js) {
    if (action === 'left') return js.dx < -JOY_X;
    if (action === 'right') return js.dx > JOY_X;
    if (action === 'jump') return js.dy < -JOY_Y;
    if (action === 'down') return js.dy > JOY_Y;
  }
  return false;
}
// Eingabe für einen konkreten Clonk: nur der gesteuerte der Mannschaft hört zu
function cIn(c, action) {
  const cap = teamOf(c);
  return cap.controlled === c && down(cap, action);
}

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(k)) e.preventDefault();
  if (k === ' ') { togglePause(); return; }
  if (k === 'escape') { closeShop(); return; }
  if (k === 'b') { if (!shopEl.classList.contains('hidden')) closeShop(); else openShop(0); return; }
  if (k === 'k') { if (!shopEl.classList.contains('hidden')) closeShop(); else openShop(1); return; }
  if (game.state === 'over' && (k === 'r' || k === 'enter')) { restart(); return; }
  pressed.add(k);
});
window.addEventListener('keyup', (e) => pressed.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => pressed.clear());

// Bildschirm-Buttons (Muster wie bei Raupen): held-Zustand fürs Halten
function setBtn(id, onDown) {
  const el = document.getElementById(id);
  buttons[id] = { held: false };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* egal */ }
    buttons[id].held = true;
    el.classList.add('held');
    if (onDown) onDown();
  });
  const rel = (e) => { e.preventDefault(); buttons[id].held = false; el.classList.remove('held'); };
  el.addEventListener('pointerup', rel);
  el.addEventListener('pointercancel', rel);
}

// Virtueller Joystick: Knüppel folgt dem Finger, Richtung liegt in joys[team]
function setupJoy(id, team) {
  const el = document.getElementById(id);
  const knob = el.querySelector('.knob');
  const R = 38;
  let pid = null, cx = 0, cy = 0;
  const setKnob = () => { knob.style.transform = `translate(${joys[team].dx * R * 0.7}px, ${joys[team].dy * R * 0.7}px)`; };
  const move = (e) => {
    if (pid === null || e.pointerId !== pid) return;
    e.preventDefault();
    let dx = (e.clientX - cx) / R, dy = (e.clientY - cy) / R;
    // Bühnendrehung rausrechnen: im rotierten Querformat ist Spiel-X = Screen-Y
    if (stage.classList.contains('rot')) { const t = dx; dx = dy; dy = -t; }
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    joys[team].dx = dx; joys[team].dy = dy;
    setKnob();
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* egal */ }
    pid = e.pointerId;
    const r = el.getBoundingClientRect();
    cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    move(e);
  });
  el.addEventListener('pointermove', move);
  const up = (e) => {
    if (e.pointerId !== pid) return;
    pid = null; joys[team].dx = 0; joys[team].dy = 0; setKnob();
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

// Touch-Layout: solo = Joystick links + Rot-Aktionen rechts;
// 2P = links Rot (Aktionen über Joystick), rechts Blau genauso
function layoutTouch() {
  const two = game.mode === '2p';
  const left = document.getElementById('wctrl-left');
  const right = document.getElementById('wctrl-right');
  const aActs = document.getElementById('tc-a-actions');
  const bActs = document.getElementById('tc-b-actions');
  const joyA = document.getElementById('joy-a');
  const joyB = document.getElementById('joy-b');
  if (two) {
    left.insertBefore(aActs, joyA);
    bActs.classList.remove('hidden');
    joyB.classList.remove('hidden');
  } else {
    right.insertBefore(aActs, right.firstChild);
    bActs.classList.add('hidden');
    joyB.classList.add('hidden');
  }
}

// ---- Kollisionshelfer -------------------------------------------------------
function bodyBlocked(x, fy) {
  x |= 0; fy |= 0;
  for (let yy = fy - PH + 1; yy <= fy; yy++) {
    for (let xx = x - CWH; xx <= x + CWH; xx += 2) if (solid(xx, yy)) return true;
  }
  return false;
}
function rowSolid(x, y) {
  x |= 0; y |= 0;
  for (let xx = x - CWH; xx <= x + CWH; xx += 2) if (solid(xx, y)) return true;
  return false;
}
const grounded = (x, fy) => rowSolid(x, (fy | 0) + 1);
function wallAt(p, dir) {
  const x = (p.x | 0) + dir * (CWH + 1);
  let n = 0;
  for (let yy = (p.y | 0) - 1; yy > (p.y | 0) - PH; yy--) if (solid(x, yy)) n++;
  return n >= 5;
}

// ---- Klonk-Steuerung & -Physik ---------------------------------------------
function stepWalk(p, dir) {
  const nx = Math.round(p.x) + dir, fy = Math.round(p.y);
  if (nx - HW < 1 || nx + HW > WORLD_W - 2) return 'wall';
  let up = 0;
  while (up <= STEP_UP && bodyBlocked(nx, fy - up)) up++;
  if (up > STEP_UP) return 'wall';
  p.x = nx; p.y = fy - up;
  if (up > 0) return 'ok';
  let d = 0;
  while (d <= STEP_DOWN && !grounded(nx, fy + d)) d++;
  if (d > STEP_DOWN) return 'fall';
  p.y = fy + d;
  return 'ok';
}

function updateClonk(c, dt) {
  const cap = teamOf(c);
  if (c === cap && c.ai) aiControl(c, dt);
  if (c.state === 'dead') {
    c.respawnT -= dt;
    if (c.respawnT <= 0) respawn(c);
    return;
  }
  c.throwCd = Math.max(0, c.throwCd - dt);
  c.hurtT = Math.max(0, c.hurtT - dt);

  // Wasser / Lava / Atem / Brennen
  const midMat = matAt(c.x, c.y - PH / 2);
  const feetMat = matAt(c.x, c.y - 1);
  const inLiquid = midMat === MAT.WATER || midMat === MAT.LAVA;
  const headUnderWater = matAt(c.x, c.y - PH + 1) === MAT.WATER;
  if (midMat === MAT.LAVA || feetMat === MAT.LAVA) {
    hurt(c, 30 * dt, null);
    c.burnT = Math.max(c.burnT, 1.2);
  }
  if (c.burnT > 0) {
    c.burnT -= dt;
    hurt(c, 9 * dt, null);
    if ((simTick & 3) === 0) parts.push({ x: c.x + rng() * 6 - 3, y: c.y - PH + rng() * 8, vx: rng() * 20 - 10, vy: -40 - rng() * 30, t: 0, life: 0.4, color: rng() < 0.5 ? '#ff9040' : '#ffd050', size: 2, grav: -60 });
    if (midMat === MAT.WATER) { c.burnT = 0; puff(c.x, c.y - PH, 4, '#cfd8dd'); }
  }
  if (headUnderWater) {
    c.breath = Math.max(0, c.breath - dt / BREATH_TIME);
    if (c.breath <= 0) hurt(c, 8 * dt, null);
    if (rng() < dt * 2) parts.push({ x: c.x, y: c.y - PH, vx: 0, vy: -30, t: 0, life: 0.8, color: '#cfe8ff', size: 1.5, grav: -30 });
  } else c.breath = Math.min(1, c.breath + dt / 1.5);
  if (c.state === 'dead') return;   // an Lava/Atemnot gestorben

  if (inLiquid && c.state !== 'swim') { c.state = 'swim'; c.vy *= 0.3; c.vx *= 0.5; }
  if (!inLiquid && c.state === 'swim') { c.state = grounded(c.x, c.y) ? 'walk' : 'air'; }

  const L = cIn(c, 'left'), R = cIn(c, 'right'), J = cIn(c, 'jump');
  const D = cIn(c, 'dig'), DN = cIn(c, 'down');
  const dirIn = (R ? 1 : 0) - (L ? 1 : 0);
  // Koop-Erkennung im Buddel-Modus: sobald Blau Eingaben macht, hält die
  // Kamera beide Teams im Bild
  if (cap.id === 1 && !cap.ai && (L || R || J || D || DN)) cap.activeT = 10;
  if (dirIn && c.state !== 'scale') c.dir = dirIn;

  // Werfen, Wurfgut wechseln, Benutzen, Wechseln (Flanken)
  const T = cIn(c, 'throw');
  if (T && !c.prevThrow && c.state !== 'tumble') throwItem(c);
  c.prevThrow = T;
  const CY = cIn(c, 'cycle');
  if (CY && !c.prevCycle) cycleThrow(c);
  c.prevCycle = CY;
  const U = cIn(c, 'use');
  const nearBase = Math.abs(c.x - cap.base.x) < 46 && Math.abs(c.y - cap.base.y) < 54;
  if (U && !c.prevUse && nearBase) buyFlint(c);
  c.prevUse = U;
  if (U && !nearBase) buildSelected(c, dt, J);
  const SW = down(cap, 'switch');
  if (SW && !cap.prevSwitch) switchClonk(cap);
  cap.prevSwitch = SW;

  switch (c.state) {
    case 'walk': {
      // auf dem Aufzugskorb: Grabtaste ohne Richtung bohrt (der Lift übernimmt),
      // MIT Richtung/Sprungtaste gräbt man sich normal seitlich/schräg heraus
      if (D && !(onElevatorCase(c) && dirIn === 0)) { c.state = 'dig'; c.rem = 0; digStep(c, dt); break; }
      // auf dem Aufzugskorb: ⤒ ohne Richtung fährt hoch statt zu springen
      if (J && !U && !(dirIn === 0 && onElevatorCase(c))) { c.vy = JUMP_VY; c.vx = dirIn * WALK; c.state = 'air'; break; }
      if (dirIn) {
        c.walkPhase += dt * 11;
        c.rem += WALK * dt;
        let n = c.rem | 0; c.rem -= n;
        while (n-- > 0) {
          const r = stepWalk(c, dirIn);
          if (r === 'fall') { c.state = 'air'; c.vx = dirIn * WALK * 0.8; c.vy = 40; break; }
          if (r === 'wall') break;
        }
      } else { c.rem = 0; }
      if (c.state === 'walk' && !grounded(c.x, c.y)) { c.state = 'air'; c.vy = 30; }
      break;
    }
    case 'air':
    case 'tumble': {
      const control = c.state === 'tumble' ? 0 : 1;
      if (c.state === 'tumble') { c.tumbleT -= dt; if (c.tumbleT <= 0) c.state = 'air'; }
      c.vx += dirIn * 260 * control * dt;
      c.vx = clamp(c.vx, -180, 180);
      c.vy = Math.min(MAXFALL, c.vy + G * dt);
      moveAir(c, dt);
      if (c.state === 'air' && dirIn && c.vy > -60 && wallAt(c, dirIn)) {
        c.state = 'scale'; c.dir = dirIn; c.vx = 0; c.vy = 0;
      }
      // Hangeln: unter der Decke ⤒ halten
      if (c.state === 'air' && J && c.vy > -40 && rowSolid(c.x, (c.y | 0) - PH)) {
        c.state = 'hangle'; c.vx = 0; c.vy = 0; c.y = Math.round(c.y);
      }
      break;
    }
    case 'hangle': {
      if (!rowSolid(c.x, (c.y | 0) - PH)) { c.state = 'air'; c.vy = 0; break; }
      if (DN) { c.state = 'air'; c.vy = 20; break; }    // loslassen
      if (dirIn) {
        c.walkPhase += dt * 8;
        c.rem += HANGLE_SPEED * dt;
        let n = c.rem | 0; c.rem -= n;
        while (n-- > 0) {
          const nx = c.x + dirIn;
          if (nx - HW < 1 || nx + HW > WORLD_W - 2) break;
          // unebene Decken (±1 px) mitgehen
          let ny = c.y;
          if (!rowSolid(nx, (ny | 0) - PH)) {
            if (rowSolid(nx, (ny | 0) - PH + 1)) ny += 1;
            else if (rowSolid(nx, (ny | 0) - PH - 1)) ny -= 1;
            else break;                                 // Decke endet
          }
          if (bodyBlocked(Math.round(nx), Math.round(ny))) {
            if (!bodyBlocked(Math.round(nx), Math.round(ny) - 2)) ny -= 2;
            else break;
          }
          c.x = nx; c.y = ny;
        }
      }
      break;
    }
    case 'swim': {
      const dy = (J ? -1 : 0) + (DN ? 1 : 0);
      const spd = midMat === MAT.LAVA ? 26 : SWIM_SPEED;
      c.vx += (dirIn * spd - c.vx) * Math.min(1, dt * 6);
      const targetVy = dy !== 0 ? dy * spd : -10;        // leichter Auftrieb
      c.vy += (targetVy - c.vy) * Math.min(1, dt * 6);
      moveSwim(c, dt);
      // am Ufer rausklettern
      if (dirIn && grounded(c.x, c.y)) {
        const r = stepWalk(c, dirIn);
        if (r === 'ok' && matAt(c.x, c.y - PH / 2) !== MAT.WATER) c.state = 'walk';
      }
      if (J && !headUnderWater && rng() < dt * 20) c.vy = -120;   // Sprung aus dem Wasser
      break;
    }
    case 'scale': {
      const away = (c.dir === 1 && L && !R) || (c.dir === -1 && R && !L);
      if (away) { c.state = 'air'; c.vy = -40; c.vx = -c.dir * 70; break; }
      if (!wallAt(c, c.dir)) {
        c.y -= 2; c.x += c.dir * (HW + 2);
        if (grounded(c.x, c.y)) { c.y = Math.round(c.y); c.state = 'walk'; }
        else { c.state = 'air'; c.vy = -60; c.vx = c.dir * 50; }
        break;
      }
      if (J) {
        c.rem += SCALE_SPEED * dt;
        let n = c.rem | 0; c.rem -= n;
        while (n-- > 0) {
          if (rowSolid(c.x, (c.y | 0) - PH)) break;
          c.y -= 1;
          if (!wallAt(c, c.dir)) break;
        }
      } else if (DN) {
        c.y += SCALE_SPEED * dt;
        if (grounded(c.x, c.y)) { c.y = Math.round(c.y); c.state = 'walk'; }
      }
      break;
    }
    case 'dig': {
      if (!D) { if (grounded(c.x, c.y)) c.state = 'walk'; else { c.state = 'air'; c.vy = 0; } break; }
      digStep(c, dt);
      break;
    }
  }

  // Abliefern & Heilen an der eigenen Hütte
  if (nearBase) {
    if (c.carry > 0) {
      cap.score += c.carry;
      addFloat(c.x, c.y - PH - 8, `+${c.carry} 💰`, '#ffd166');
      c.carry = 0;
      checkWin();
    }
    c.hp = Math.min(100, c.hp + 7 * dt);
  }

  // Einsammeln – aber nur, solange Platz in den paar Taschen ist. Der Rest
  // bleibt liegen und will mit der Lore abgeholt werden (wie im Original).
  for (const it of items) {
    if (it.buried || it.dead) continue;
    if (it.own === c && it.ownT > 0) continue;   // frisch Geworfenes nicht sofort wieder einstecken
    const dx = it.x - c.x, dy = it.y - (c.y - PH / 2);
    if (dx * dx + dy * dy > 15 * 15) continue;
    const g = goodOf(it.type);
    if (!g) continue;
    if (invFree(c) <= 0) {
      if (!c.fullHintT) { c.fullHintT = 2; addFloat(c.x, c.y - PH - 10, '🎒 voll – ab in die Lore!', '#ffb0a0'); }
      continue;
    }
    it.dead = true; c[g.field]++;
    addFloat(c.x, c.y - PH - 6, g.emoji, '#ffd166');
  }
  c.fullHintT = Math.max(0, (c.fullHintT || 0) - dt);
}

function switchClonk(cap) {
  const next = cap.controlled === cap ? cap.buddy : cap;
  if (!next || next.state === 'dead') return;
  cap.controlled = next;
  addFloat(next.x, next.y - PH - 14, '🔄', '#fff');
}

function moveAir(p, dt) {
  const dx = p.vx * dt, dy = p.vy * dt;
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  const sx = dx / n, sy = dy / n;
  for (let i = 0; i < n; i++) {
    if (sx) {
      const nx = clamp(p.x + sx, HW + 1, WORLD_W - HW - 2);
      if (bodyBlocked(Math.round(nx), Math.round(p.y))) p.vx = 0;
      else p.x = nx;
    }
    if (sy) {
      const ny = p.y + sy;
      if (sy > 0 && rowSolid(Math.round(p.x), Math.round(ny))) {
        let fy = Math.round(ny);
        while (fy > 0 && rowSolid(Math.round(p.x), fy)) fy--;
        p.y = fy; land(p); return;
      }
      if (sy < 0 && rowSolid(Math.round(p.x), Math.round(ny) - PH + 1)) p.vy = 0;
      else p.y = ny;
    }
    if (p.y > WORLD_H + 20) { hurt(p, 999, null); return; }
  }
}
function moveSwim(p, dt) {
  const dx = p.vx * dt, dy = p.vy * dt;
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  const sx = dx / n, sy = dy / n;
  for (let i = 0; i < n; i++) {
    const nx = clamp(p.x + sx, HW + 1, WORLD_W - HW - 2);
    if (!bodyBlocked(Math.round(nx), Math.round(p.y))) p.x = nx; else p.vx = 0;
    const ny = p.y + sy;
    if (!bodyBlocked(Math.round(p.x), Math.round(ny))) p.y = ny; else p.vy = 0;
  }
}

function land(p) {
  const v = p.vy;
  p.vy = 0; p.vx = 0;
  p.state = 'walk';
  if (v > FALL_HURT) {
    hurt(p, (v - FALL_HURT) * 0.14, null);
    puff(p.x, p.y, 6, '#9a8468');
  }
}

// Graben wie im Original: Grabtaste allein = senkrecht runter, mit Richtung
// = waagerecht (leicht fallend). Nach OBEN gräbt kein Clonk – dafür gibt es
// Lehmbrücken, Klettern und den Grubenlift. Fels stoppt die Schaufel
// (Feuerstein!), Granit sogar die Sprengung.
function digStep(c, dt) {
  const L = cIn(c, 'left'), R = cIn(c, 'right');
  const dirIn = (R ? 1 : 0) - (L ? 1 : 0);
  if (dirIn) c.dir = dirIn;
  let dx, dy;
  if (dirIn) { dx = dirIn; dy = 0.28; }
  else { dx = 0; dy = 1; }
  const len = Math.hypot(dx, dy); dx /= len; dy /= len;

  c.walkPhase += dt * 14;
  c.rem += DIG_SPEED * dt;
  let n = c.rem | 0; c.rem -= n;
  while (n-- > 0) {
    const cx = c.x + dx * 3, cy = c.y - PH / 2 + dy * 3;
    // Ist in Grabrichtung überhaupt noch Material? Beim Graben "schwimmt" der
    // Clonk durchs Erdreich (wie im Original) – erst wenn der Weg offen ist,
    // gilt wieder normale Physik.
    if (!areaDiggable(cx + dx * 5, cy + dy * 5, DIG_R)) {
      if (!grounded(c.x, c.y)) { c.state = 'air'; c.vy = 30; break; }
      const r = stepWalk(c, dirIn || c.dir);       // offener Stollen: weiterlaufen
      if (r === 'fall') { c.state = 'air'; c.vy = 30; break; }
      if (r === 'wall') break;
      continue;
    }
    const gold = carveCircle(cx, cy, DIG_R, false);
    collectGoldPix(c, gold, carveCircle.lastCoal, cx, cy);
    const nx = clamp(c.x + dx, HW + 1, WORLD_W - HW - 2);
    let ny = c.y + dy;
    if (bodyBlocked(Math.round(nx), Math.round(ny))) {
      // hartes Material (Fels, Aufzugskorb) unter den Füßen: waagerecht weiter
      if (dy > 0 && dx !== 0 && !bodyBlocked(Math.round(nx), Math.round(c.y))) ny = c.y;
      else {                                                    // Fels im Weg
        spark(c.x + dx * 8, c.y - PH / 2 + dy * 8, 2, '#c9c9d4');
        break;
      }
    }
    c.x = nx; c.y = ny;
    if ((n & 3) === 0) puff(c.x - dx * 5, c.y - PH / 2, 1, '#8a6a48');
  }
}
// grobe Abtastung: liegt im Umkreis noch grabbares Material?
function areaDiggable(cx, cy, r) {
  cx |= 0; cy |= 0;
  for (let y = cy - r; y <= cy + r; y += 3) for (let x = cx - r; x <= cx + r; x += 3) {
    if (DIGGABLE[matAt(x, y)]) return true;
  }
  return false;
}
function collectGoldPix(c, gold, coal, x, y) {
  if (gold) {
    c.goldPix += gold;
    while (c.goldPix >= GOLD_PER_NUGGET) {
      c.goldPix -= GOLD_PER_NUGGET;
      items.push({ type: 'nugget', x: x + rng() * 6 - 3, y, vx: rng() * 40 - 20, vy: -60 });
      spark(x, y, 4, '#ffd166');
    }
  }
  if (coal) {
    c.coalPix += coal;
    while (c.coalPix >= COAL_PER_CHUNK) {
      c.coalPix -= COAL_PER_CHUNK;
      items.push({ type: 'coal', x: x + rng() * 6 - 3, y, vx: rng() * 40 - 20, vy: -60 });
    }
  }
}
// Sprengungen fördern Erz und Kohle als Brocken zutage
function spillChunks(x, y, coal, ore) {
  if (coal >= COAL_PER_CHUNK / 2) {
    items.push({ type: 'coal', x: x + rng() * 16 - 8, y: y - 4, vx: rng() * 80 - 40, vy: -80 - rng() * 50 });
  }
  let n = Math.floor(ore / ORE_PER_CHUNK);
  if (!n && ore >= ORE_PER_CHUNK / 2) n = 1;
  while (n-- > 0) {
    items.push({ type: 'ore', x: x + rng() * 18 - 9, y: y - 4, vx: rng() * 80 - 40, vy: -80 - rng() * 50 });
  }
}

// Bauen unterwegs (Benutzen-Taste): baut das gewählte Baumaterial –
// 🧱 Lehmbrücke oder 🛤 Schienen unter den Füßen.
function buildSelected(c, dt, up) {
  const sel = THROWABLES[c.throwSel || 0];
  if (sel && sel.build === 'rail' && c.rail > 0) { layRail(c, dt); return; }
  buildBridge(c, dt, up);
}
// Schienen legen: unter dem Clonk entsteht ein Gleis, das der Lore Halt gibt
function layRail(c, dt) {
  if (c.state === 'dead' || c.state === 'tumble') return;
  c.bridgeT += dt;
  if (c.bridgeT < 0.14) return;
  c.bridgeT = 0;
  const x = Math.round(c.x), y = Math.round(c.y);
  let n = 0;
  for (let xx = x - 5; xx <= x + 5; xx++) {
    const cx = clamp(xx, 0, WORLD_W - 1);
    if (railY[cx] === y - 1) continue;
    railY[cx] = y - 1; n++;
  }
  if (!n) return;
  c.railPix = (c.railPix || 0) + 1;
  if (c.railPix >= 3) { c.railPix = 0; c.rail--; }
  spark(c.x, c.y - 2, 2, '#9aa4b0');
}

// Lehmbrücke: Benutzen-Taste unterwegs halten, baut in Blickrichtung
// (mit Sprungtaste als Rampe nach oben)
function buildBridge(c, dt, up) {
  if (c.loam <= 0 || c.state === 'dead' || c.state === 'tumble') return;
  c.bridgeT += dt;
  if (c.bridgeT < 0.13) return;
  c.bridgeT = 0;
  const dir = c.dir;
  const bx = Math.round(c.x) + dir * 2;
  const by = Math.round(c.y) + (up ? -1 : 1);
  fillMat(dir > 0 ? bx : bx - 7, by, 8, 3, MAT.LOAM);
  puff(bx + dir * 3, by, 1, '#c9a86a');
  // auf die frische Brücke steigen
  for (let i = 0; i < 4; i++) stepWalk(c, dir);
  if (up) { c.y -= 2; if (bodyBlocked(c.x, c.y)) c.y += 2; }
  if (c.state === 'air') { c.state = 'walk'; c.vy = 0; }
  c.loamPix = (c.loamPix || 0) + 1;
  if (c.loamPix >= 9) { c.loamPix = 0; c.loam--; if (c.loam <= 0) addFloat(c.x, c.y - PH - 8, '🧱 leer', '#ffb0a0'); }
}

// ---- Werfen (alles aus den Taschen, wie im Original) ------------------------
const THROWABLES = [
  { key: 'flint', emoji: '💣', has: (c) => c.flints > 0, take: (c) => c.flints-- },
  { key: 'loam', emoji: '🧱', has: (c) => c.loam > 0, take: (c) => c.loam--, build: 'bridge' },
  { key: 'rail', emoji: '🛤', has: (c) => c.rail > 0, take: (c) => c.rail--, build: 'rail' },
  { key: 'nugget', emoji: '💰', has: (c) => c.carry > 0, take: (c) => c.carry-- },
  { key: 'coal', emoji: '⚫', has: (c) => c.coal > 0, take: (c) => c.coal-- },
  { key: 'ore', emoji: '🪨', has: (c) => c.ore > 0, take: (c) => c.ore-- },
  { key: 'metal', emoji: '🔩', has: (c) => c.metal > 0, take: (c) => c.metal-- },
  { key: 'plank', emoji: '🪜', has: (c) => c.plank > 0, take: (c) => c.plank-- },
  { key: 'wood', emoji: '🪵', has: (c) => c.wood > 0, take: (c) => c.wood-- },
];
function throwItem(c) {
  if (c.throwCd > 0 || game.state !== 'play') return;
  let i = c.throwSel || 0;
  if (!THROWABLES[i].has(c)) {                 // Gewähltes leer: nimm das nächste
    i = THROWABLES.findIndex((t) => t.has(c));
    if (i < 0) { addFloat(c.x, c.y - PH - 8, 'Taschen leer!', '#ffb0a0'); c.throwCd = 0.3; return; }
    c.throwSel = i;
  }
  const t = THROWABLES[i];
  t.take(c);
  c.throwCd = 0.45;
  if (t.key === 'flint') {
    projectiles.push({
      x: c.x + c.dir * 6, y: c.y - PH + 2,
      vx: c.dir * 175 + c.vx * 0.5, vy: -165, owner: c, t: 0, spin: rng() * 6,
    });
  } else {
    // Gegenstände fliegen im Bogen und bleiben liegen (Gold gern in die Lore!)
    items.push({ type: t.key, x: c.x + c.dir * 6, y: c.y - PH + 2, vx: c.dir * 150 + c.vx * 0.5, vy: -140, own: c, ownT: 0.7 });
  }
}
function cycleThrow(c) {
  for (let k = 1; k <= THROWABLES.length; k++) {
    const i = ((c.throwSel || 0) + k) % THROWABLES.length;
    if (THROWABLES[i].has(c)) {
      c.throwSel = i;
      addFloat(c.x, c.y - PH - 8, THROWABLES[i].emoji + ' gewählt', '#fff');
      return;
    }
  }
  addFloat(c.x, c.y - PH - 8, 'Taschen leer!', '#ffb0a0');
}
const throwFlint = throwItem;   // alter Name, weiter im Test-Hook verfügbar

// ---- Basis: Produktion, Kaufen und Verkaufen -------------------------------
// Wie im Objektpaket: die Gebäude an der Hütte verarbeiten eigene Rohstoffe
// (kostenlos), und über die Basis lässt sich alles gegen 💰 Gold handeln.
const atBase = (c) => {
  const cap = teamOf(c);
  return Math.abs(c.x - cap.base.x) < 46 && Math.abs(c.y - cap.base.y) < 54;
};
const factoryX = (p) => p.base.x + (p.id === 0 ? -34 : 34);
const furnaceX = (p) => p.base.x + (p.id === 0 ? -58 : 58);
const sawmillX = (p) => p.base.x + (p.id === 0 ? -82 : 82);
const millX = (p) => p.base.x + (p.id === 0 ? 74 : -74);

// Produktionsrezepte: greifen auf Basis-Lager UND Hand zu (an der Hütte ist
// beides ein Topf); das Ergebnis geht in die Hand, der Rest ins Lager.
const RECIPES = [
  {
    key: 'smelt', label: '🪨+⚫ → 🔩', name: 'Hochofen',
    can: (c) => have(c, 'ore') >= 1 && have(c, 'coal') >= 1,
    run: (c) => {
      const cap = teamOf(c);
      takeRes(c, 'ore', 1); takeRes(c, 'coal', 1);
      giveRes(c, 'metal', cap.windmill ? 2 : 1);   // Strom verdoppelt
      smoke(furnaceX(cap), cap.base.y - 44, '#e0a070');
      return cap.windmill ? '🪨+⚫ → 2 🔩 (⚡)' : '🪨+⚫ → 🔩';
    },
  },
  {
    key: 'saw', label: '🪵 → 2 🪜', name: 'Sägewerk',
    can: (c) => have(c, 'wood') >= 1,
    run: (c) => {
      const cap = teamOf(c);
      takeRes(c, 'wood', 1); giveRes(c, 'plank', 2);
      smoke(sawmillX(cap), cap.base.y - 30, '#d8c090');
      return '🪵 → 2 🪜 Bretter';
    },
  },
  {
    key: 'rails', label: '🪜+🔩 → 4 🛤', name: 'Schienenschmiede',
    can: (c) => have(c, 'plank') >= 1 && have(c, 'metal') >= 1,
    run: (c) => {
      const cap = teamOf(c);
      takeRes(c, 'plank', 1); takeRes(c, 'metal', 1); giveRes(c, 'rail', 4);
      smoke(factoryX(cap), cap.base.y - 40, '#aab4bd');
      return '🪜+🔩 → 4 🛤 Schienen';
    },
  },
  {
    key: 'flintM', label: '🔩 → 3 💣', name: 'Chemiefabrik',
    can: (c) => have(c, 'metal') >= 1,
    run: (c) => { takeRes(c, 'metal', 1); giveRes(c, 'flint', 3); smoke(factoryX(teamOf(c)), teamOf(c).base.y - 40, '#aab4bd'); return '🔩 → 3 💣'; },
  },
  {
    key: 'flintC', label: '⚫ → 2 💣', name: 'Chemiefabrik',
    can: (c) => have(c, 'coal') >= 1,
    run: (c) => { takeRes(c, 'coal', 1); giveRes(c, 'flint', 2); smoke(factoryX(teamOf(c)), teamOf(c).base.y - 40, '#aab4bd'); return '⚫ → 2 💣'; },
  },
  {
    key: 'flintW', label: '2 🪵 → 1 💣', name: 'Chemiefabrik',
    can: (c) => have(c, 'wood') >= 2,
    run: (c) => { takeRes(c, 'wood', 2); giveRes(c, 'flint', 1); smoke(factoryX(teamOf(c)), teamOf(c).base.y - 40, '#aab4bd'); return '2 🪵 → 1 💣'; },
  },
];

// Handel: Preise in 💰 Gold (die abgelieferten Klumpen sind die Währung).
// Gekauftes landet in der Hand, sonst im Lager.
const SHOP = [
  { key: 'flint', label: '💣 Feuerstein', price: 2 },
  { key: 'loam', label: '🧱 Lehm', price: 1 },
  { key: 'wood', label: '🪵 Holz', price: 1 },
  { key: 'coal', label: '⚫ Kohle', price: 2 },
  { key: 'metal', label: '🔩 Metall', price: 4 },
  { key: 'rail', label: '🛤 Schienen ×4', price: 2, amount: 4 },
  { key: 'lore', label: '🛒 Lore', price: 6, special: (c) => { addLore(teamOf(c)); return true; } },
  { key: 'mill', label: '🌬️ Windrad', price: 10, special: (c) => { const cap = teamOf(c); if (cap.windmill) return false; cap.windmill = true; return true; } },
];
const SELL = [
  { key: 'ore', label: '🪨 Erz', price: 2 },
  { key: 'metal', label: '🔩 Metall', price: 5 },
  { key: 'coal', label: '⚫ Kohle', price: 2 },
  { key: 'plank', label: '🪜 Bretter', price: 2 },
  { key: 'wood', label: '🪵 Holz', price: 1 },
];

function smoke(x, y, color) { for (let i = 0; i < 7; i++) puff(x, y - i * 3, 1, color); }

// Schnell-Produktion an der Hütte (Benutzen-Taste): erstes passendes Rezept
function buyFlint(c) {
  if (game.state !== 'play' || c.state === 'dead' || !atBase(c)) return;
  for (const r of RECIPES) {
    if (!r.can(c)) continue;
    addFloat(c.x, c.y - PH - 8, r.run(c), '#ffe6a0');
    return;
  }
  // nichts zu produzieren: Taschen ins Lager leeren, sonst Gold tauschen
  if (stockPutAll(c)) return;
  const cap = teamOf(c);
  if (cap.score >= 2 && invFree(c) > 0) {
    cap.score -= 2; c.flints++;
    addFloat(c.x, c.y - PH - 8, '−2 💰 → 💣', '#ffe6a0');
    return;
  }
  addFloat(c.x, c.y - PH - 8, 'Nichts zu tun – 🛒 Basis-Menü?', '#ffb0a0');
}
function shopBuy(c, key) {
  const cap = teamOf(c);
  const it = SHOP.find((s) => s.key === key);
  if (!it || !atBase(c)) return false;
  if (cap.score < it.price) { addFloat(c.x, c.y - PH - 8, 'Zu wenig 💰', '#ffb0a0'); return false; }
  if (it.special) { if (!it.special(c)) { addFloat(c.x, c.y - PH - 8, 'Geht nicht!', '#ffb0a0'); return false; } }
  else giveRes(c, it.key, it.amount || 1);
  cap.score -= it.price;
  addFloat(c.x, c.y - PH - 8, `−${it.price} 💰 ${it.label}`, '#ffe6a0');
  return true;
}
function shopSell(c, key) {
  const cap = teamOf(c);
  const it = SELL.find((s) => s.key === key);
  if (!it || !atBase(c) || have(c, key) < 1) return false;
  takeRes(c, key, 1);
  cap.score += it.price;
  addFloat(c.x, c.y - PH - 8, `${it.label} → +${it.price} 💰`, '#ffd166');
  checkWin();
  return true;
}
// Lager <-> Hand: einzeln entnehmen bzw. alles ablegen
function stockTake(c, key) {
  if (!atBase(c)) return false;
  const st = stockOf(c), g = goodOf(key);
  if (!g || (st[key] || 0) < 1 || invFree(c) < 1) return false;
  st[key]--; c[g.field]++;
  return true;
}
function stockPutAll(c) {
  if (!atBase(c)) return false;
  const st = stockOf(c);
  let n = 0;
  for (const g of GOODS) {
    if (g.key === 'nugget') continue;         // Gold wird an der Hütte abgeliefert
    while (c[g.field] > 0) { c[g.field]--; st[g.key] = (st[g.key] || 0) + 1; n++; }
  }
  if (n) addFloat(c.x, c.y - PH - 8, `${n} → 📦 Lager`, '#eaf3fa');
  return n > 0;
}
function craft(c, key) {
  const r = RECIPES.find((x) => x.key === key);
  if (!r || !atBase(c) || !r.can(c)) return false;
  addFloat(c.x, c.y - PH - 8, r.run(c), '#ffe6a0');
  return true;
}

function updateProjectiles(dt) {
  for (const f of projectiles) {
    f.t += dt; f.spin += dt * 9;
    f.vy = Math.min(f.meteor ? 520 : 430, f.vy + (f.meteor ? 300 : 430) * dt);
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(f.vx * dt), Math.abs(f.vy * dt))));
    for (let i = 0; i < n && !f.dead; i++) {
      f.x += f.vx * dt / n; f.y += f.vy * dt / n;
      if (f.meteor && (simTick & 1) === 0) {
        parts.push({ x: f.x + rng() * 8 - 4, y: f.y - 6, vx: rng() * 30 - 15, vy: -30, t: 0, life: 0.5, color: rng() < 0.5 ? '#ff9040' : '#666', size: 2.5, grav: -40 });
      }
      if (f.x < 2 || f.x > WORLD_W - 2 || solid(f.x, f.y)) {
        boom(f); break;
      }
      for (const c of allClonks()) {
        if (c.state === 'dead' || (c === f.owner && f.t < 0.25)) continue;
        const dx = f.x - c.x, dy = f.y - (c.y - PH / 2);
        if (dx * dx + dy * dy < 10 * 10) { boom(f); break; }
      }
    }
    if (f.y > WORLD_H + 10) f.dead = true;
  }
  projectiles = projectiles.filter((f) => !f.dead);
}
function boom(f) {
  f.dead = true;
  explode(f.x, f.y, f.owner);
  if (f.meteor) explode(f.x + rng() * 20 - 10, f.y + 10, null);
}

function explode(x, y, src) {
  const R = 26;
  const gold = carveCircle(x, y, R, true);
  if (gold) {
    let n = Math.max(1, Math.round(gold / GOLD_PER_NUGGET));
    while (n-- > 0) items.push({ type: 'nugget', x: x + rng() * 20 - 10, y: y + rng() * 10 - 5, vx: rng() * 90 - 45, vy: -90 - rng() * 60 });
  }
  spillChunks(x, y, carveCircle.lastCoal, carveCircle.lastOre);
  // Schaden + Wumms für alle in Reichweite
  for (const c of allClonks()) {
    if (c.state === 'dead') continue;
    const dx = c.x - x, dy = (c.y - PH / 2) - y;
    const d = Math.hypot(dx, dy);
    if (d > R + 20) continue;
    const f = 1 - d / (R + 24);
    hurt(c, 58 * f, src);
    if (c.state !== 'dead') {
      const nd = Math.max(6, d);
      c.vx = clamp(c.vx + (dx / nd) * 260 * f, -260, 260);
      c.vy = clamp(c.vy + (dy / nd) * 260 * f - 130 * f, -320, 320);
      c.state = 'tumble'; c.tumbleT = 0.8;
    }
  }
  // Loren: Wumms + Ladung fliegt raus
  for (const lo of lores) {
    const d = Math.hypot(lo.x - x, (lo.y - 6) - y);
    if (d > R + 24) continue;
    const f = 1 - d / (R + 28);
    lo.vx += Math.sign(lo.x - x || 1) * 220 * f;
    lo.vy = -120 * f; lo.y -= 2;
    for (const [key, n] of Object.entries(lo.load || {})) {
      for (let k = 0; k < n; k++) items.push({ type: key, x: lo.x, y: lo.y - 8, vx: rng() * 140 - 70, vy: -90 - rng() * 80 });
    }
    lo.load = {};
  }
  // Bäume: direkter Treffer fällt, Nähe zündet an
  for (const t of trees) {
    if (t.dead) continue;
    const d = Math.hypot(t.x - x, (t.y - t.h / 2) - y);
    if (d < R + 6) fellTree(t);
    else if (d < R + 26 && t.burn <= 0) t.burn = 4;
  }
  // Wipfe erschrecken/erwischen
  for (const w of wipfe) {
    if (w.dead) continue;
    const d = Math.hypot(w.x - x, w.y - y);
    if (d < R + 8) { w.dead = true; w.respT = 25; puff(w.x, w.y - 3, 6, '#a5825a'); }
    else if (d < 150) { w.fleeT = 3; w.dir = w.x < x ? -1 : 1; }
  }
  // Feuersteine in der Nähe gehen mit hoch (Kettenreaktion, leicht verzögert)
  for (const it of items) {
    if (it.dead || it.type !== 'flint') continue;
    if (Math.hypot(it.x - x, it.y - y) < R + 6) { it.dead = true; explodeLater(it.x, it.y, src); }
  }
  game.shakeT = 0.25; game.shakeA = 5;
  for (let i = 0; i < 26; i++) {
    const a = rng() * Math.PI * 2, s = 40 + rng() * 160;
    parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, t: 0, life: 0.5 + rng() * 0.4, color: i % 3 ? '#8a6a48' : '#ffb054', size: 2 + rng() * 2, grav: 300 });
  }
  spark(x, y, 10, '#ffe6a0');
}
const pendingBooms = [];
function explodeLater(x, y, src) { pendingBooms.push({ x, y, src, t: 0.12 + rng() * 0.1 }); }

function hurt(c, dmg, src) {
  if (c.state === 'dead' || game.state !== 'play') return;
  c.hp -= dmg; c.hurtT = 0.35;
  if (c.hp > 0) return;
  c.hp = 0; c.state = 'dead'; c.respawnT = 4; c.burnT = 0;
  if (src && src !== c && teamOf(src) !== teamOf(c)) teamOf(src).ko++;
  addFloat(c.x, c.y - PH - 10, '💀 K. o.!', '#ff7a6a');
  for (let i = 0; i < c.carry; i++) {
    items.push({ type: 'nugget', x: c.x, y: c.y - PH / 2, vx: rng() * 120 - 60, vy: -80 - rng() * 80 });
  }
  for (let i = 0; i < Math.min(2, c.flints); i++) {
    items.push({ type: 'flint', x: c.x, y: c.y - PH / 2, vx: rng() * 100 - 50, vy: -70 - rng() * 60 });
  }
  c.carry = 0;
  // Steuerung springt auf den anderen Clonk der Mannschaft
  const cap = teamOf(c), other = otherClonk(c);
  if (cap.controlled === c && other && other.state !== 'dead') cap.controlled = other;
}

function respawn(c) {
  c.state = 'air'; c.hp = 100; c.flints = 1; c.loam = 1; c.carry = 0; c.goldPix = 0;
  c.coal = 0; c.ore = 0; c.metal = 0; c.plank = 0; c.wood = 0; c.rail = 0;
  c.vx = 0; c.vy = 0; c.tumbleT = 0; c.breath = 1; c.burnT = 0;
  const cap = teamOf(c);
  c.x = cap.base.x + (cap.id === 0 ? 26 : -26) + (c.lead ? (cap.id === 0 ? -16 : 16) : 0);
  c.y = groundY[c.x | 0] - 30;
  c.aiS.target = null; c.aiS.phase = 'seek'; c.aiS.stuckT = 0;
}

// ---- KI (🤖 Blau im Solo-Modus) --------------------------------------------
function aiThink(cap) {
  const c = cap.controlled, s = cap.aiS;
  const enemyCap = players[0];
  const enemy = enemyCap.controlled;
  if (enemy.state !== 'dead' && c.flints >= 2 && Math.abs(enemy.x - c.x) < 90
    && Math.abs(enemy.y - c.y) < 40 && rng() < 0.3) {
    c.dir = enemy.x >= c.x ? 1 : -1;
    s.throwNow = true;
  }
  // Taschen voll (oder angeschlagen): ab nach Hause
  if (invFree(c) <= 0 || (c.carry > 0 && c.hp < 40) || c.hp < 30
    || (c.carry > 0 && game.t < 25)) {
    s.target = { x: cap.base.x, y: cap.base.y - 1, kind: 'base' };
    return;
  }
  let best = null, bd = 1e9;
  for (const it of items) {
    if (it.dead || it.buried || (it.type !== 'nugget' && it.type !== 'coal')) continue;
    const d = Math.hypot(it.x - c.x, it.y - c.y);
    if (d < bd) { bd = d; best = it; }
  }
  if (best && bd < 260) { s.target = { x: best.x, y: best.y, kind: 'nugget' }; return; }
  let bs = null; bd = 1e9;
  for (const g of goldSpots) {
    if (!goldAlive(g)) continue;
    if (g.rock && c.flints === 0) continue;
    const d = Math.hypot(g.x - c.x, g.y - c.y) + (g.rock ? 200 : 0);
    if (d < bd) { bd = d; bs = g; }
  }
  if (bs) { s.target = { x: bs.x, y: bs.y, kind: 'gold' }; return; }
  s.target = { x: cap.base.x, y: cap.base.y - 1, kind: 'base' };
}
function goldAlive(g) {
  for (let yy = -5; yy <= 5; yy += 2) for (let xx = -5; xx <= 5; xx += 2) {
    if (matAt(g.x + xx, g.y + yy) === MAT.GOLD) return true;
  }
  return false;
}
function aiControl(cap, dt) {
  const s = cap.aiS, v = cap.virt;
  v.left = v.right = v.jump = v.dig = v.throw = v.use = false;
  if (game.state !== 'play') return;
  // toter gesteuerter Clonk: sofort zum anderen wechseln
  if (cap.controlled.state === 'dead') {
    const other = cap.controlled === cap ? cap.buddy : cap;
    if (other && other.state !== 'dead') cap.controlled = other;
    else return;
  }
  const c = cap.controlled;

  s.thinkT -= dt;
  if (s.thinkT <= 0) { s.thinkT = 0.3; aiThink(cap); }
  if (Math.abs(c.x - s.lastX) < 1 && Math.abs(c.y - s.lastY) < 1) s.stuckT += dt;
  else s.stuckT = 0;
  s.lastX = c.x; s.lastY = c.y;

  if (s.throwNow) { s.throwNow = false; v.throw = true; }

  // im Wasser: hoch und Richtung Ufer/Basis
  if (c.state === 'swim') {
    v.jump = true;
    if (c.x > cap.base.x) v.left = true; else v.right = true;
    return;
  }

  if (s.phase === 'backoff') {
    s.backoffT -= dt;
    if (s.backDir < 0) v.left = true; else v.right = true;
    if (s.backoffT <= 0) {
      if (s.throwAfter && c.flints > 0 && s.target) {
        c.dir = s.target.x >= c.x ? 1 : -1;
        v.left = v.right = false;
        v.throw = true;
      }
      s.throwAfter = false; s.phase = 'wait'; s.waitT = 1.0;
    }
    return;
  }
  if (s.phase === 'wait') { s.waitT -= dt; if (s.waitT <= 0) s.phase = 'seek'; return; }

  const t = s.target;
  if (!t) return;
  const dx = t.x - c.x, dy = t.y - c.y, adx = Math.abs(dx);
  if (adx > 6) { if (dx < 0) v.left = true; else v.right = true; }

  if (dy > 14 && adx < 46) { v.dig = true; if (adx < 10) { v.left = v.right = false; } }
  else if (dy < -26 && adx < 30 && c.state !== 'scale') { v.jump = true; }   // hoch geht's nur kletternd

  if (c.state === 'scale') v.jump = true;
  else if (c.state === 'hangle') { v.dig = true; }
  else if (s.stuckT > 0.7) {
    v.jump = true;
    if (s.stuckT > 1.8) {
      if (c.state === 'dig' && c.flints > 0) {
        s.phase = 'backoff'; s.backoffT = 0.7; s.backDir = dx >= 0 ? -1 : 1; s.throwAfter = true;
      } else { s.target = null; s.thinkT = 0; }
      s.stuckT = 0;
    }
  }

  // an der Hütte: Taschen leeren bzw. nachproduzieren (Benutzen-Taste)
  if (t.kind === 'base' && Math.abs(c.x - cap.base.x) < 40
    && (invCount(c) > 0 || c.flints === 0)) v.use = true;
}

// ---- Grubenlift (Aufzug mit Förderturm, wie im Clonk-Objektpaket) ----------
// Der Korb liegt als PLATFORM-Material in der Maske: Clonks, Loren und Items
// stehen ganz normal darauf. Auf dem Korb: ⛏️/↓ bohrt nach unten (durch Fels
// nur langsam, Granit stoppt), ⤒ fährt hoch. Erbohrtes Gold/Kohle fällt als
// Brocken auf den Korb.
const CASE_HW = 8;                    // halbe Korbbreite
function onElevatorCase(c) {
  return elevators.some((el) => Math.abs(c.x - el.x) <= CASE_HW + 2 && Math.abs((c.y + 1) - el.y) <= 2);
}
function eraseCase(el) {
  for (let y = el.y; y < el.y + 3; y++) for (let x = el.x - CASE_HW; x <= el.x + CASE_HW; x++) {
    if (matAt(x, y) === MAT.PLATFORM) {
      mask[idx(x, y)] = bgMat(x, y);
    }
  }
}
function writeCase(el) {
  for (let y = el.y; y < el.y + 3; y++) for (let x = el.x - CASE_HW; x <= el.x + CASE_HW; x++) {
    const m = matAt(x, y);
    if (isFree(m) || m === MAT.WATER || m === MAT.LAVA) mask[idx(x, y)] = MAT.PLATFORM;
  }
  applyRegion(el.x - CASE_HW - 1, el.y - 2, CASE_HW * 2 + 3, 7);
}
function moveCase(el, dir) {
  if (dir > 0) {
    // Zeile unter dem Korb wegbohren (Granit blockiert)
    let gold = 0, coal = 0;
    let ore = 0;
    for (let xx = el.x - CASE_HW - 1; xx <= el.x + CASE_HW + 1; xx++) {
      const m = matAt(xx, el.y + 3);
      if (m === MAT.GRANIT || m === MAT.BEDROCK || m === MAT.ORE) return false;   // zu hart für den Bohrer
      if (m === MAT.GOLD) gold++;
      if (m === MAT.COAL) coal++;
      if (!isFree(m) && m !== MAT.PLATFORM) mask[idx(xx, el.y + 3)] = bgMat(xx, el.y + 3);
    }
    el.goldPix += gold; el.coalPix += coal;
    while (el.goldPix >= GOLD_PER_NUGGET) {
      el.goldPix -= GOLD_PER_NUGGET;
      items.push({ type: 'nugget', x: el.x + rng() * 10 - 5, y: el.y - 3, vx: 0, vy: -20 });
      spark(el.x, el.y + 3, 4, '#ffd166');
    }
    while (el.coalPix >= COAL_PER_CHUNK) {
      el.coalPix -= COAL_PER_CHUNK;
      items.push({ type: 'coal', x: el.x + rng() * 10 - 5, y: el.y - 3, vx: 0, vy: -20 });
    }
  } else {
    if (el.y <= el.topY) return false;
    // Räumschild: nachgerieselter Sand / eingelaufenes Wasser im Schacht
    // über dem Korb wird beiseitegeschaufelt
    for (let y = el.y - 19; y <= el.y + 1; y++) {
      for (let x = el.x - CASE_HW; x <= el.x + CASE_HW; x++) {
        if (isGrain(matAt(x, y))) {
          mask[idx(x, y)] = bgMat(x, y);
          markDirty(x, y);
        }
      }
    }
    // festes Hindernis über einem Fahrgast? Dann stoppt der Lift
    for (const c of allClonks()) {
      if (c.state === 'dead') continue;
      if (Math.abs(c.x - el.x) <= CASE_HW + 2 && Math.abs((c.y + 1) - el.y) <= 2
        && bodyBlocked(Math.round(c.x), Math.round(c.y) - 1)) return false;
    }
  }
  eraseCase(el);
  el.y += dir;
  writeCase(el);
  // Fahrgäste (Clonks + Loren) mitnehmen
  for (const c of allClonks()) {
    if (c.state === 'dead') continue;
    if (Math.abs(c.x - el.x) <= CASE_HW + 2 && Math.abs((c.y + 1) - (el.y - dir)) <= 2) {
      const ny = c.y + dir;
      if (dir > 0 || !bodyBlocked(Math.round(c.x), Math.round(ny))) c.y = ny;
    }
  }
  for (const lo of lores) {
    if (Math.abs(lo.x - el.x) <= CASE_HW + 2 && Math.abs((lo.y + 1) - (el.y - dir)) <= 3) lo.y += dir;
  }
  wakeArea(el.x - CASE_HW - 3, el.y - 3, el.x + CASE_HW + 3, el.y + 6);
  return true;
}
function updateElevators(dt) {
  for (const el of elevators) {
    // Fahrgast-Wunsch: ⛏️/↓ bohrt runter, ⤒ (ohne Richtung) fährt hoch
    let move = 0, rockBelow = false;
    for (const c of allClonks()) {
      if (c.state === 'dead' || !onElevatorCase(c) || Math.abs(c.x - el.x) > CASE_HW + 2) continue;
      // Runter (Joystick/Grabtaste) OHNE Richtung bohrt; mit Richtung
      // gräbt sich der Clonk selbst aus dem Korb
      if (cIn(c, 'down') && !cIn(c, 'dig') && !cIn(c, 'left') && !cIn(c, 'right') && !cIn(c, 'jump')) move = 1;
      else if (cIn(c, 'dig') && !cIn(c, 'left') && !cIn(c, 'right') && !cIn(c, 'jump')) move = 1;
      else if (cIn(c, 'jump') && !cIn(c, 'left') && !cIn(c, 'right')) move = -1;
    }
    if (move === 1) {
      for (let xx = el.x - CASE_HW; xx <= el.x + CASE_HW; xx++) {
        if (matAt(xx, el.y + 3) === MAT.ROCK) { rockBelow = true; break; }
      }
      if (el.y + 6 >= WORLD_H - 8) move = 0;                 // Grundgestein erreicht
    }
    if (!move) { el.acc = 0; continue; }
    const power = players[el.team] && players[el.team].windmill ? 1.8 : 1;   // Strom vom Windrad
    el.acc += (move === 1 ? (rockBelow ? 9 : 34) : 48) * power * dt;
    let n = el.acc | 0; el.acc -= n;
    while (n-- > 0) {
      if (!moveCase(el, move)) { spark(el.x, el.y + 3, 2, '#c9c9d4'); break; }
    }
  }
}

// ---- Loren (Goldtransport wie im Clonk-Objektpaket) -------------------------
function probeDown(x, yStart) {
  for (let d = 0; d <= 14; d++) if (solid(x, yStart + d)) return yStart + d;
  return null;
}
const railAt = (x) => (railY && x >= 0 && x < WORLD_W ? railY[x | 0] : -1);
function addLore(cap) {
  const lx = cap.base.x + (cap.id === 0 ? 44 : -44);
  lores.push({ team: cap.id, x: lx, y: groundY[clamp(lx, 0, WORLD_W - 1)] - 1, vx: 0, vy: 0, load: {} });
}

function updateLores(dt) {
  for (const lo of lores) {
    // ---- Schienenfahrt: die Lore rastet aufs Gleis und rollt fast reibungsfrei
    const rail = railAt(lo.x);
    lo.onRail = rail >= 0 && Math.abs(lo.y - rail) < 7;
    if (lo.onRail) {
      lo.y = rail; lo.vy = 0;
      pushLore(lo, dt);
      const rl = railAt(lo.x - 6), rr = railAt(lo.x + 6);
      if (rl >= 0 && rr >= 0) lo.vx += (rr - rl) * 26 * dt;     // Gefälle zieht an
      lo.vx *= Math.exp(-0.35 * dt);                            // kaum Rollwiderstand
      if (Math.abs(lo.vx) < 0.6) lo.vx = 0;
      // dem Gleis folgen; endet es, rollt die Lore normal weiter
      let m = Math.abs(lo.vx * dt), dir = Math.sign(lo.vx);
      while (m > 0) {
        const step = Math.min(1, m); m -= step;
        const nx = clamp(lo.x + dir * step, 10, WORLD_W - 10);
        const ny = railAt(nx);
        if (ny < 0 || Math.abs(ny - lo.y) > 6) { lo.onRail = false; break; }
        lo.x = nx; lo.y = ny;
      }
      loreWork(lo, dt);
      continue;
    }
    const supported = solid(lo.x - 5, lo.y + 1) || solid(lo.x + 5, lo.y + 1);
    if (!supported) {
      lo.vy = Math.min(420, lo.vy + 420 * dt);
      lo.y += lo.vy * dt;
      if (solid(lo.x - 5, lo.y + 1) || solid(lo.x + 5, lo.y + 1)) {
        while (solid(lo.x - 5, lo.y) || solid(lo.x + 5, lo.y)) lo.y--;
        lo.vy = 0;
      }
      if (lo.y > WORLD_H + 30) {
        const home = players[lo.team];
        lo.x = home.base.x + (lo.team === 0 ? 44 : -44); lo.y = home.base.y - 1;
        lo.vx = 0; lo.vy = 0; lo.load = {};
      }
    } else {
      const yl = probeDown(lo.x - 5, lo.y - 4), yr = probeDown(lo.x + 5, lo.y - 4);
      if (yl !== null && yr !== null) lo.vx += (yr - yl) * 30 * dt;
      lo.vx *= Math.exp(-1.7 * dt);
      if (Math.abs(lo.vx) < 1) lo.vx = 0;
    }

    pushLore(lo, dt);

    if (lo.vx) {
      let m = Math.abs(lo.vx * dt), dir = Math.sign(lo.vx);
      while (m > 0) {
        const step = Math.min(1, m); m -= step;
        const nx = clamp(lo.x + dir * step, 10, WORLD_W - 10);
        if (railAt(nx) >= 0 && Math.abs(lo.y - railAt(nx)) < 7) { lo.x = nx; lo.y = railAt(nx); break; }
        let wall = 0;
        for (let yy = -2; yy >= -9; yy--) if (solid(nx + dir * 8, lo.y + yy)) wall++;
        if (wall >= 4) { lo.vx = -lo.vx * 0.3; break; }
        lo.x = nx;
        let up = 0;
        while (up <= 4 && (solid(lo.x - 5, lo.y - up) || solid(lo.x + 5, lo.y - up))) up++;
        if (up > 0 && up <= 4) lo.y -= up - 1;
        let d = 0;
        while (d <= 5 && !(solid(lo.x - 5, lo.y + 1 + d) || solid(lo.x + 5, lo.y + 1 + d))) d++;
        if (d > 0 && d <= 5) lo.y += d;
      }
    }

    loreWork(lo, dt);
  }
}
// Ladung der Lore: alle Güterarten, gezählt in load[key]
const loreCount = (lo) => Object.values(lo.load || {}).reduce((a, b) => a + b, 0);
function loreAdd(lo, key, n = 1) {
  lo.load = lo.load || {};
  lo.load[key] = (lo.load[key] || 0) + n;
}
// Anschieben durch Clonks + Zeug aus der Hand einladen
function pushLore(lo, dt) {
  for (const c of allClonks()) {
    if (c.state === 'dead') continue;
    const dx = lo.x - c.x;
    if (Math.abs(dx) < 17 && Math.abs(lo.y - c.y) < 16) {
      const dirIn = (cIn(c, 'right') ? 1 : 0) - (cIn(c, 'left') ? 1 : 0);
      if (dirIn && Math.sign(dx) === dirIn) lo.vx = dirIn * (lo.onRail ? 96 : 62);
      // Alles aus der Hand wandert in die Lore (Feuersteine behält der Clonk)
      let moved = 0;
      for (const g of GOODS) {
        if (g.key === 'flint' || g.key === 'loam' || g.key === 'rail') continue;
        while (c[g.field] > 0 && loreCount(lo) < LORE_MAX) { c[g.field]--; loreAdd(lo, g.key); moved++; }
      }
      if (moved) addFloat(lo.x, lo.y - 16, `+${moved} 🛒`, '#ffd166');
    }
  }
}
// Herumliegendes einsammeln + an der eigenen Hütte abkippen
function loreWork(lo, dt) {
  // Fangbereich: die offene Wanne schluckt alles, was hineinfällt oder
  // -fliegt (großzügig nach oben, damit Reinwerfen wirklich klappt)
  if (loreCount(lo) < LORE_MAX) {
    for (const it of items) {
      if (it.dead || it.buried || !goodOf(it.type)) continue;
      if (Math.abs(it.x - lo.x) > 11) continue;
      if (it.y > lo.y + 4 || it.y < lo.y - 30) continue;
      it.dead = true; loreAdd(lo, it.type);
      spark(lo.x, lo.y - 10, 3, '#ffd166');
      if (loreCount(lo) >= LORE_MAX) break;
    }
  }
  const home = players[lo.team];
  if (loreCount(lo) > 0 && Math.abs(lo.x - home.base.x) < 42 && Math.abs(lo.y - home.base.y) < 50) {
    const gold = lo.load.nugget || 0;
    let rest = 0;
    for (const [key, n] of Object.entries(lo.load)) {
      if (key === 'nugget') continue;
      home.stock[key] = (home.stock[key] || 0) + n; rest += n;
    }
    home.score += gold;
    lo.load = {};
    addFloat(lo.x, lo.y - 18, (gold ? `+${gold} 💰` : '') + (rest ? ` +${rest} 📦` : ''), '#ffd166');
    if (gold) checkWin();
  }
}

// ---- Bäume & Wipfe ----------------------------------------------------------
function fellTree(t) {
  if (t.dead) return;
  t.dead = true;
  const n = 2 + (rng() < 0.5 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    items.push({ type: 'wood', x: t.x + rng() * 14 - 7, y: t.y - 6 - rng() * t.h * 0.5, vx: rng() * 60 - 30, vy: -40 - rng() * 40 });
  }
  puff(t.x, t.y - t.h / 2, 8, '#7a9a4a');
}
function updateTrees(dt) {
  for (const t of trees) {
    if (t.dead || t.burn <= 0) continue;
    t.burn -= dt;
    if ((simTick & 1) === 0) {
      parts.push({ x: t.x + rng() * 16 - 8, y: t.y - t.h + rng() * t.h * 0.6, vx: rng() * 20 - 10, vy: -50 - rng() * 30, t: 0, life: 0.5, color: rng() < 0.6 ? '#ff9040' : '#555', size: 2.5, grav: -50 });
    }
    // Feuer springt auf Nachbarn und anfassende Clonks über
    for (const t2 of trees) {
      if (!t2.dead && t2.burn <= 0 && t2 !== t && Math.abs(t2.x - t.x) < 34 && t.burn < 2) t2.burn = 4;
    }
    for (const c of allClonks()) {
      if (c.state !== 'dead' && Math.abs(c.x - t.x) < 12 && Math.abs(c.y - t.y) < 30) c.burnT = Math.max(c.burnT, 1);
    }
    if (t.burn <= 0) {
      t.dead = true;
      const n = 1 + (rng() < 0.5 ? 1 : 0);
      for (let i = 0; i < n; i++) items.push({ type: 'wood', x: t.x + rng() * 10 - 5, y: t.y - 8, vx: rng() * 40 - 20, vy: -30 });
      puff(t.x, t.y - t.h / 2, 8, '#555');
    }
  }
}
// Fische: leben im Wasser, weichen Clonks aus, sterben in Lava
function updateFish(dt) {
  for (const f of fish) {
    f.ph += dt * 3;
    if (matAt(f.x, f.y) !== MAT.WATER) {
      // an Land gelandet: zurück ins Wasser zappeln
      f.vy = Math.min(200, (f.vy || 0) + 300 * dt);
      f.y += f.vy * dt;
      if (matAt(f.x, f.y) === MAT.LAVA || f.y > WORLD_H) { f.dead = true; }
      if (matAt(f.x, f.y) === MAT.WATER) f.vy = 0;
      continue;
    }
    f.vy = 0;
    let vx = f.dir * f.v, vy = Math.sin(f.ph) * 12;
    for (const c of allClonks()) {                 // vor Clonks fliehen
      if (c.state === 'dead') continue;
      if (Math.hypot(c.x - f.x, c.y - f.y) < 46) { f.dir = f.x < c.x ? -1 : 1; vx = f.dir * f.v * 2; }
    }
    const nx = f.x + vx * dt, ny = f.y + vy * dt;
    if (matAt(nx, f.y) === MAT.WATER) f.x = nx; else f.dir = -f.dir;
    if (matAt(f.x, ny) === MAT.WATER) f.y = ny;
  }
  fish = fish.filter((f) => !f.dead);
}
function updateBirds(dt) {
  for (const b of birds) {
    b.x += b.dir * b.v * dt;
    b.ph += dt * 6;
    if (b.x < -40) { b.x = WORLD_W + 40; b.y = 60 + rng() * 140; }
    if (b.x > WORLD_W + 40) { b.x = -40; b.y = 60 + rng() * 140; }
    // Explosionen und Feuer scheuchen sie auf
    for (const f of projectiles) {
      if (Math.hypot(f.x - b.x, f.y - b.y) < 90) { b.dir = b.x < f.x ? -1 : 1; b.v = Math.min(90, b.v * 1.5); }
    }
    b.v += (34 - b.v) * dt * 0.25;
  }
}
function updateWipfe(dt) {
  for (const w of wipfe) {
    if (w.dead) {
      w.respT -= dt;
      if (w.respT <= 0) {
        const x = 150 + ((rng() * (WORLD_W - 300)) | 0);
        w.dead = false; w.x = x; w.y = groundY[x] - 1; w.state = 'walk'; w.fleeT = 0;
      }
      continue;
    }
    w.t -= dt;
    if (w.fleeT > 0) w.fleeT -= dt;
    if (w.t <= 0) {
      w.t = 1.5 + rng() * 3;
      const roll = rng();
      if (roll < 0.25) w.state = 'idle';
      else if (roll < 0.4 && solid(w.x + w.dir * 3, w.y - 1)) w.state = 'dig';
      else { w.state = 'walk'; if (rng() < 0.4) w.dir = -w.dir; }
    }
    const speed = w.fleeT > 0 ? 66 : 22;
    if (w.state === 'walk' || w.fleeT > 0) {
      const nx = w.x + w.dir * speed * dt;
      if (nx < 20 || nx > WORLD_W - 20) { w.dir = -w.dir; continue; }
      // simple Lauflogik: kleine Stufen hoch/runter
      let ny = w.y;
      if (solid(nx, ny - 1)) { let u = 0; while (u <= 5 && solid(nx, ny - 1 - u)) u++; if (u > 5) { w.dir = -w.dir; continue; } ny -= u; }
      else { let d = 0; while (d <= 5 && !solid(nx, ny + d)) d++; if (d > 5) { w.dir = -w.dir; continue; } ny += d - 1; }
      w.x = nx; w.y = ny;
    } else if (w.state === 'dig') {
      // buddelt einen kleinen Gang
      if ((simTick & 3) === 0) {
        carveCircle(w.x + w.dir * 3, w.y - 3, 4, false);
        w.x += w.dir * 8 * dt;
        puff(w.x, w.y - 2, 1, '#8a6a48');
      }
    }
    // im Wasser: zurück an Land hoppeln
    if (matAt(w.x, w.y - 2) === MAT.WATER) { w.dir = -w.dir; w.y -= 20 * dt; }
    if (matAt(w.x, w.y - 2) === MAT.LAVA) { w.dead = true; w.respT = 25; puff(w.x, w.y, 5, '#ff9040'); }
  }
}

// ---- Items ------------------------------------------------------------------
function updateItems(dt) {
  for (const it of items) {
    if (it.dead) continue;
    if (it.buried) {
      if (!solid(it.x, it.y)) { it.buried = false; it.vy = -20; }
      continue;
    }
    if (it.ownT > 0) it.ownT -= dt;
    if (it.rest) {
      if (solid(it.x, it.y + 2)) continue;
      it.rest = false;
    }
    const inWater = matAt(it.x, it.y) === MAT.WATER;
    it.vy = Math.min(it.chute ? 38 : inWater ? 50 : 420, it.vy + 420 * dt);
    it.x = clamp(it.x + it.vx * dt, 8, WORLD_W - 8);
    it.y += it.vy * dt;
    if (matAt(it.x, it.y) === MAT.LAVA) { it.dead = true; puff(it.x, it.y, 3, '#ff9040'); continue; }
    if (solid(it.x, it.y + 2)) {
      while (solid(it.x, it.y + 1)) it.y--;
      it.vx = 0; it.vy = 0; it.rest = true; it.chute = false;
    }
    if (it.y > WORLD_H + 10) it.dead = true;
  }
  items = items.filter((it) => !it.dead);
}

function updateFlintDrops(dt) {
  game.flintDropT -= dt;
  if (game.flintDropT > 0) return;
  game.flintDropT = 16 + rng() * 10;
  const inWorld = items.filter((i) => i.type === 'flint' && !i.buried).length;
  if (inWorld >= 5) return;
  items.push({ type: 'flint', x: 80 + rng() * (WORLD_W - 160), y: -14, vx: 0, vy: 20, chute: true });
}

// ---- Katastrophen -----------------------------------------------------------
function updateDisasters(dt) {
  if (game.disasters === 'aus' || game.state !== 'play') { game.rainT = Math.max(0, game.rainT - dt); return; }
  game.disasterT -= dt;
  if (game.disasterT <= 0) {
    game.disasterT = (game.disasters === 'wild' ? 22 : 50) + rng() * (game.disasters === 'wild' ? 20 : 40);
    const roll = rng();
    if (roll < 0.3) doRain();
    else if (roll < 0.55) doQuake();
    else if (roll < 0.8) doMeteor();
    else doVolcano();
  }
  // Regen: Tropfen + gelegentlich ein Wasserpixel, das in Senken läuft
  if (game.rainT > 0) {
    game.rainT -= dt;
    for (let i = 0; i < 5; i++) {
      const x = 10 + rng() * (WORLD_W - 20);
      parts.push({ x, y: -4, vx: 14, vy: 330, t: 0, life: 1.9, color: 'rgba(160,200,255,0.7)', size: 1.6, grav: 0, rain: true });
    }
    if (game.rainBudget > 0 && rng() < dt * 14) {
      const x = 10 + ((rng() * (WORLD_W - 20)) | 0);
      let y = 0; while (y < WORLD_H - 2 && !solid(x, y) && matAt(x, y) !== MAT.WATER) y++;
      if (y > 4 && y < WORLD_H - 10) {
        mask[idx(x, y - 2)] = MAT.WATER;
        markDirty(x, y - 2); wake(x, y - 2);
        game.rainBudget--;
      }
    }
  }
  // Erdbeben: Dauer-Schütteln + Risse
  if (game.quakeT > 0) {
    game.quakeT -= dt;
    game.shakeT = Math.max(game.shakeT, 0.2); game.shakeA = 4;
    if (rng() < dt * 5) {
      const x = 40 + ((rng() * (WORLD_W - 80)) | 0);
      const y = groundY[x] + 10 + rng() * 120;
      carveCircle(x, y | 0, 4 + rng() * 4, true);
    }
  }
  // Vulkane: der Schlot frisst sich nach oben und speit Lava
  for (const v of volcanoes) {
    if (v.done) continue;
    v.t += dt;
    v.riseY -= 60 * dt;
    const top = groundY[clamp(v.x | 0, 0, WORLD_W - 1)] - 6;
    if (v.riseY <= top) { v.riseY = top; v.spewT = (v.spewT || 0) + dt; }
    // Schlot schmelzen + mit Lava füllen
    for (let yy = 0; yy < 4; yy++) {
      const y = (v.riseY + yy) | 0;
      for (let xx = -4; xx <= 4; xx++) {
        const x = (v.x + xx) | 0;
        if (x < 2 || x >= WORLD_W - 2 || y < 2 || y >= WORLD_H - 9) continue;
        const m = mask[idx(x, y)];
        if (m !== MAT.GRANIT) { mask[idx(x, y)] = MAT.LAVA; markDirty(x, y); wake(x, y); }
      }
    }
    wakeArea((v.x - 7) | 0, (v.riseY - 4) | 0, (v.x + 7) | 0, (v.riseY + 8) | 0);
    if (rng() < dt * 8) parts.push({ x: v.x + rng() * 8 - 4, y: v.riseY, vx: rng() * 60 - 30, vy: -120 - rng() * 80, t: 0, life: 0.8, color: '#ff7030', size: 2.5, grav: 260 });
    if (v.spewT > 3.5) v.done = true;
  }
  volcanoes = volcanoes.filter((v) => !v.done);
}
function doRain() { game.rainT = 14; game.rainBudget = 420; addFloat(WORLD_W / 2, 60, '🌧 Regen!', '#bcd6ea'); }
function doQuake() { game.quakeT = 2.6; addFloat(WORLD_W / 2, 60, '🫨 Erdbeben!', '#e8c37a'); }
function doMeteor(x) {
  const mx = x !== undefined ? x : 80 + rng() * (WORLD_W - 160);
  projectiles.push({ x: mx, y: -16, vx: rng() * 80 - 40, vy: 160, owner: null, t: 0, spin: 0, meteor: true });
  addFloat(clamp(mx, 60, WORLD_W - 60), 60, '☄️ Meteor!', '#ffb054');
}
function doVolcano(x) {
  const vx = x !== undefined ? x : (() => {
    let c = 140 + rng() * (WORLD_W - 280);
    for (let i = 0; i < 6 && (Math.abs(c - BASE_X[0]) < 140 || Math.abs(c - BASE_X[1]) < 140); i++) c = 140 + rng() * (WORLD_W - 280);
    return c;
  })();
  volcanoes.push({ x: vx, riseY: WORLD_H - 12, t: 0, done: false });
  addFloat(clamp(vx, 60, WORLD_W - 60), 60, '🌋 Vulkan!', '#ff7030');
}

// ---- Spielstände ------------------------------------------------------------
// Die Weltmaske wird lauflängen-kodiert ("b3k.a12..." = Material+Anzahl in
// Base36) – so passt der komplette Stand in den Server-Slot /api/save/clonk
// (eingeloggt, geräteübergreifend) bzw. in localStorage.
function packMask() {
  const out = [];
  let cur = mask[0], n = 1;
  for (let i = 1; i < mask.length; i++) {
    if (mask[i] === cur) n++;
    else { out.push(String.fromCharCode(97 + cur) + n.toString(36)); cur = mask[i]; n = 1; }
  }
  out.push(String.fromCharCode(97 + cur) + n.toString(36));
  return out.join('.');
}
function unpackMask(s) {
  const m = new Uint8Array(WORLD_W * WORLD_H);
  let i = 0;
  for (const tok of s.split('.')) {
    const v = tok.charCodeAt(0) - 97;
    const n = parseInt(tok.slice(1), 36);
    m.fill(v, i, i + n); i += n;
  }
  return m;
}
function serialize() {
  const clk = (c) => ({
    x: Math.round(c.x), y: Math.round(c.y), hp: Math.round(c.hp), carry: c.carry,
    flints: c.flints, coal: c.coal, wood: c.wood, loam: c.loam, dir: c.dir,
    ore: c.ore, metal: c.metal, plank: c.plank, rail: c.rail,
    dead: c.state === 'dead' ? 1 : 0,
  });
  return {
    v: 3, ts: Date.now(),
    mode: game.mode, goal: game.goal, disasters: game.disasters, t: Math.round(game.t),
    mask: packMask(), groundY: Array.from(groundY),
    teams: players.map((p) => ({
      score: p.score, ko: p.ko, onBuddy: p.controlled === p.buddy ? 1 : 0,
      windmill: p.windmill ? 1 : 0, stock: p.stock,
      a: clk(p), b: clk(p.buddy),
    })),
    rails: Array.from(railY),
    items: items.filter((i) => !i.dead).map((i) => ({ t: i.type, x: Math.round(i.x), y: Math.round(i.y), bu: i.buried ? 1 : 0 })),
    lores: lores.map((l) => ({ team: l.team, x: Math.round(l.x), y: Math.round(l.y), load: l.load || {} })),
    elevators: elevators.map((e) => ({ x: e.x, y: e.y, topY: e.topY })),
    trees: trees.map((t) => ({ x: t.x, y: Math.round(t.y), h: Math.round(t.h), dead: t.dead ? 1 : 0 })),
    goldSpots,
  };
}
function applyLoad(s) {
  // ältere Stände stammen aus früheren Weltversionen und passen nicht mehr
  if (!s || s.v !== 3 || typeof s.mask !== 'string' || !Array.isArray(s.teams)) return false;
  game.mode = MODES.includes(s.mode) ? s.mode : 'sandbox';
  startGame(0);                        // Grundgerüst (Teams, Loren, Lifte) aufbauen
  mask = unpackMask(s.mask);
  groundY = Int16Array.from(s.groundY || groundY);
  goldSpots = s.goldSpots || goldSpots;
  game.goal = s.goal || 8;
  game.t = typeof s.t === 'number' ? s.t : ROUND_TIME;
  game.state = 'play'; game.winner = null;
  const setClk = (c, d) => {
    Object.assign(c, { x: d.x, y: d.y, hp: d.hp, carry: d.carry, flints: d.flints, coal: d.coal, wood: d.wood, loam: d.loam, dir: d.dir, ore: d.ore || 0, metal: d.metal || 0, plank: d.plank || 0, rail: d.rail || 0 });
    c.vx = 0; c.vy = 0; c.tumbleT = 0; c.burnT = 0; c.breath = 1;
    c.state = d.dead ? 'dead' : 'air';
    if (d.dead) c.respawnT = 3;
  };
  s.teams.forEach((t, i) => {
    const p = players[i];
    if (!p) return;
    p.score = t.score || 0; p.ko = t.ko || 0; p.windmill = !!t.windmill;
    if (t.stock) { Object.assign(p.stock, t.stock); p.buddy.stock = p.stock; }
    setClk(p, t.a); setClk(p.buddy, t.b);
    p.controlled = t.onBuddy ? p.buddy : p;
  });
  items = (s.items || []).map((i) => ({ type: i.t, x: i.x, y: i.y, vx: 0, vy: 0, buried: !!i.bu }));
  if (Array.isArray(s.rails) && s.rails.length === WORLD_W) railY = Int16Array.from(s.rails);
  lores = (s.lores || []).map((l, i) => ({ team: l.team ?? (i < 2 ? i : 0), x: l.x, y: l.y, vx: 0, vy: 0, load: l.load || {} }));
  if (!lores.length) players.forEach((p) => addLore(p));
  (s.elevators || []).forEach((e, i) => { if (elevators[i]) Object.assign(elevators[i], { x: e.x, y: e.y, topY: e.topY, acc: 0 }); });
  trees = (s.trees || []).map((t) => ({ x: t.x, y: t.y, h: t.h, sway: rng() * 6.28, burn: 0, dead: !!t.dead }));
  granitHp = new Uint8Array(WORLD_W * WORLD_H);   // Anschläge im Granit heilen beim Laden
  // Wipfe auf die geladene Oberfläche setzen
  for (const w of wipfe) { const x = 150 + ((rng() * (WORLD_W - 300)) | 0); w.x = x; w.y = groundY[x] - 1; w.dead = false; w.fleeT = 0; }
  projectiles = []; volcanoes = []; parts = []; floats = []; pendingBooms.length = 0;
  buildTerrainCanvas();
  activeFlag = new Uint8Array(WORLD_W * WORLD_H);
  active = []; dirty = null;
  for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++) wake(x, y);
  cam.zoom = game.mode === '2p' ? 1 : 2.1; cam.scale = 0;
  layoutTouch();
  if (typeof refreshMenu === 'function') refreshMenu();
  return true;
}
function toast(text, color) { addFloat(cam.x, cam.y - 30, text, color || '#eaf3fa'); }
function authToken() { try { return localStorage.getItem('tgl_token'); } catch { return null; } }
async function saveGame() {
  const data = serialize();
  let local = false;
  try { localStorage.setItem('clonk_save', JSON.stringify(data)); local = true; } catch { /* egal */ }
  let server = false;
  const token = authToken();
  if (token) {
    try {
      const r = await fetch('/api/save/clonk', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ data }),
      });
      server = r.ok;
    } catch { /* offline */ }
  }
  toast(server ? '💾 Gespeichert (Server + lokal)' : local ? '💾 Lokal gespeichert' : '⚠️ Speichern fehlgeschlagen',
    server || local ? '#8fe0b6' : '#ff8a7a');
}
async function loadGame() {
  let data = null;
  const token = authToken();
  if (token) {
    try {
      const r = await fetch('/api/save/clonk', { headers: { Authorization: 'Bearer ' + token } });
      if (r.ok) data = (await r.json()).save;
    } catch { /* offline */ }
  }
  if (!data) { try { data = JSON.parse(localStorage.getItem('clonk_save') || 'null'); } catch { /* egal */ } }
  if (!data || !applyLoad(data)) { toast('⚠️ Kein Spielstand gefunden', '#ff8a7a'); return false; }
  toast('📂 Spielstand geladen', '#8fe0b6');
  return true;
}

// ---- Sieg & Rundenende ------------------------------------------------------
function checkWin() {
  if (game.mode === 'sandbox') return;   // offenes Buddeln: kein Rundenende
  for (const p of players) {
    if (p.score >= game.goal) { endRound(p); return; }
  }
}
function endRound(winner) {
  if (game.state === 'over') return;
  game.state = 'over';
  game.winner = winner;
}
function restart() { startGame(); }
function togglePause() { if (game.state === 'play') game.paused = !game.paused; }

// ---- Effekte ----------------------------------------------------------------
function addFloat(x, y, text, color) { floats.push({ x, y, text, color, t: 0 }); }
function puff(x, y, n, color) {
  for (let i = 0; i < n; i++) {
    parts.push({ x: x + rng() * 6 - 3, y: y + rng() * 4 - 2, vx: rng() * 50 - 25, vy: -20 - rng() * 40, t: 0, life: 0.4 + rng() * 0.3, color, size: 1.5 + rng() * 1.5, grav: 140 });
  }
}
function spark(x, y, n, color) {
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2, s = 30 + rng() * 90;
    parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: 0.25 + rng() * 0.25, color, size: 1 + rng(), grav: 60 });
  }
}
function updateFx(dt) {
  for (const q of parts) {
    q.t += dt; q.vy += (q.grav || 0) * dt; q.x += q.vx * dt; q.y += q.vy * dt;
    if (q.rain && (solid(q.x, q.y) || matAt(q.x, q.y) === MAT.WATER)) q.t = q.life;
  }
  parts = parts.filter((q) => q.t < q.life);
  for (const f of floats) { f.t += dt; f.y -= 22 * dt; }
  floats = floats.filter((f) => f.t < 1.4);
  for (let i = pendingBooms.length - 1; i >= 0; i--) {
    pendingBooms[i].t -= dt;
    if (pendingBooms[i].t <= 0) { const b = pendingBooms.splice(i, 1)[0]; explode(b.x, b.y, b.src); }
  }
  game.shakeT = Math.max(0, game.shakeT - dt);
}

// ---- Update-Hauptschritt ----------------------------------------------------
function update(dt) {
  // im Buddel-Modus gibt es weder Zeitlimit noch Rundenende
  if (game.state === 'play' && game.mode !== 'sandbox') {
    game.t -= dt;
    if (game.t <= 0) {
      game.t = 0;
      const [a, b] = players;
      endRound(a.score === b.score ? null : (a.score > b.score ? a : b));
    }
  }
  for (const p of players) {
    p.activeT = Math.max(0, (p.activeT || 0) - dt);
    if (p.windmill) p.millPh = (p.millPh || 0) + dt * 2.2;
  }
  for (const c of allClonks()) updateClonk(c, dt);
  updateProjectiles(dt);
  updateElevators(dt);
  updateLores(dt);
  updateItems(dt);
  updateFlintDrops(dt);
  updateTrees(dt);
  updateWipfe(dt);
  updateBirds(dt);
  updateFish(dt);
  updateDisasters(dt);
  simStep();
  updateFx(dt);
}

// ---- Kamera -----------------------------------------------------------------
const cam = { x: WORLD_W / 2, y: WORLD_H / 2, zoom: 1, scale: 0 };
function setZoom(z) { cam.zoom = clamp(z, 1, 3.5); }
function posOf(c) { return c.state === 'dead' ? { x: teamOf(c).base.x, y: teamOf(c).base.y - 30 } : c; }
const VIEW_H = 760;   // Basis-Sichthöhe: die Welt ist tiefer als der Bildschirm
function computeCam(dt) {
  // Grundmaßstab: ganze Kartenbreite sichtbar, vertikal wird gescrollt
  const fit = Math.max(CW / WORLD_W, (CH - TOP_UI - 8) / VIEW_H);
  let tx, ty, targetScale;
  // Buddel-Modus: solange Blau nicht mitspielt, folgt die Kamera Rot
  const soloView = game.mode === 'solo' || (game.mode === 'sandbox' && !(players[1] && players[1].activeT > 0));
  if (soloView) {
    const p = posOf(players[0].controlled);
    tx = p.x; ty = p.y - 26;
    targetScale = fit * cam.zoom;
  } else {
    const a = posOf(players[0].controlled), b = posOf(players[1].controlled);
    tx = (a.x + b.x) / 2; ty = (a.y + b.y) / 2 - 20;
    const needW = Math.abs(a.x - b.x) + 280, needH = Math.abs(a.y - b.y) + 240;
    // beide im Bild halten, aber nie weiter als die ganze Karte rauszoomen
    const fitBoth = Math.max(CW / WORLD_W * 0.55, Math.min(CW / needW, (CH - TOP_UI) / needH));
    targetScale = Math.min(fit * cam.zoom, fitBoth);
  }
  if (!cam.scale) cam.scale = targetScale;
  const k = Math.min(1, dt * 5);
  cam.scale += (targetScale - cam.scale) * k;
  const vw = CW / cam.scale, vh = (CH - TOP_UI) / cam.scale;
  tx = vw >= WORLD_W ? WORLD_W / 2 : clamp(tx, vw / 2, WORLD_W - vw / 2);
  ty = vh >= WORLD_H ? WORLD_H / 2 : clamp(ty, vh / 2, WORLD_H - vh / 2);
  cam.x += (tx - cam.x) * k;
  cam.y += (ty - cam.y) * k;
}

// ---- Rendering --------------------------------------------------------------
const stage = document.getElementById('stage');
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let CW = 0, CH = 0;
const TOP_UI = 64;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rot = stage.classList.contains('rot');
  CW = rot ? window.innerHeight : window.innerWidth;
  CH = rot ? window.innerWidth : window.innerHeight;
  canvas.width = Math.round(CW * dpr); canvas.height = Math.round(CH * dpr);
  canvas.style.width = CW + 'px'; canvas.style.height = CH + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);

const clouds = [
  { x: 140, y: 60, s: 1.0, v: 6 }, { x: 480, y: 110, s: 1.5, v: 4 }, { x: 780, y: 45, s: 0.8, v: 8 },
];

function draw(time) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0d1b28'; ctx.fillRect(0, 0, CW, CH);

  const S = cam.scale || 0.5;
  let shx = 0, shy = 0;
  if (game.shakeT > 0) {
    shx = (rng() - 0.5) * game.shakeA * game.shakeT * 8;
    shy = (rng() - 0.5) * game.shakeA * game.shakeT * 8;
  }
  const OX = CW / 2 - cam.x * S + shx;
  const OY = TOP_UI + (CH - TOP_UI) / 2 - cam.y * S + shy;

  ctx.save();
  ctx.translate(OX, OY); ctx.scale(S, S);

  // Himmel (bei Regen düsterer)
  const sky = ctx.createLinearGradient(0, 0, 0, WORLD_H);
  if (game.rainT > 0) { sky.addColorStop(0, '#5a7c96'); sky.addColorStop(0.55, '#87a4b8'); sky.addColorStop(1, '#a8bfc9'); }
  else { sky.addColorStop(0, '#7ec3ea'); sky.addColorStop(0.55, '#b9e0f2'); sky.addColorStop(1, '#dcedf5'); }
  ctx.fillStyle = sky; ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  ctx.fillStyle = '#ffe38a'; ctx.beginPath(); ctx.arc(840, 70, 26, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,227,138,0.35)'; ctx.beginPath(); ctx.arc(840, 70, 38, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = game.rainT > 0 ? 'rgba(120,140,155,0.9)' : 'rgba(255,255,255,0.85)';
  for (const c of clouds) {
    c.x += c.v * 0.016; if (c.x > WORLD_W + 60) c.x = -60;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, 34 * c.s, 12 * c.s, 0, 0, Math.PI * 2);
    ctx.ellipse(c.x + 22 * c.s, c.y + 4 * c.s, 24 * c.s, 10 * c.s, 0, 0, Math.PI * 2);
    ctx.ellipse(c.x - 22 * c.s, c.y + 5 * c.s, 22 * c.s, 9 * c.s, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // ferne Bergketten mit leichter Parallaxe (rein dekorativ)
  drawHills(0.18, 'rgba(150,180,200,0.75)', 268, 46);
  drawHills(0.34, 'rgba(120,156,180,0.8)', 320, 58);

  // Vögel am Himmel, Bäume hinter dem Gelände (wurzeln im Boden)
  for (const b of birds) drawBird(b);
  for (const t of trees) drawTree(t, time);

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(terrainCanvas, 0, 0);

  drawRails();
  for (const p of players) drawHut(p);
  for (const el of elevators) drawElevator(el);
  for (const lo of lores) drawLore(lo);
  for (const f of fish) drawFish(f);
  for (const w of wipfe) drawWipf(w, time);
  for (const it of items) drawItem(it, time);
  for (const f of projectiles) { if (f.meteor) drawMeteor(f); else drawFlint(f.x, f.y, f.spin); }
  for (const c of allClonks()) drawClonk(c, time);
  for (const q of parts) {
    ctx.globalAlpha = clamp(1 - q.t / q.life, 0, 1);
    ctx.fillStyle = q.color; ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  for (const f of floats) {
    ctx.globalAlpha = clamp(1.4 - f.t, 0, 1);
    ctx.fillStyle = f.color; ctx.font = 'bold 11px system-ui';
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  updateThrowBtns();
  drawHUD();
  if (game.paused && game.state === 'play') banner('⏸ Pause', 'Leertaste zum Weiterspielen');
  if (game.state === 'over') {
    const w = game.winner;
    banner(w ? `🏆 ${w.name} gewinnt!` : '🤝 Unentschieden!',
      (w ? `${w.score} Gold abgeliefert · ${w.ko} K. o.` : 'Gleich viel Gold') + ' — R für die Revanche');
  }
}

// Ferne Bergketten: enden am Erdboden (nicht am Kartenboden – sonst schauen
// sie in der tiefen Welt neben dem Gelände hervor)
function drawHills(par, col, base, amp) {
  const off = (cam.x - WORLD_W / 2) * par;
  const foot = base + amp * 2 + 60;
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(-60, foot);
  for (let x = -60; x <= WORLD_W + 60; x += 16) {
    const wx = x + off;
    ctx.lineTo(x, base + Math.sin(wx * 0.006 + 1.7) * amp + Math.sin(wx * 0.017 + 4.1) * amp * 0.35);
  }
  ctx.lineTo(WORLD_W + 60, foot);
  ctx.closePath(); ctx.fill();
}
function drawBird(b) {
  const flap = Math.sin(b.ph) * b.amp * 0.35;
  ctx.save();
  ctx.translate(b.x, b.y + Math.sin(b.ph * 0.3) * b.amp);
  ctx.scale(b.dir * b.scale, b.scale);
  ctx.strokeStyle = 'rgba(48,64,80,0.85)'; ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-7, flap); ctx.quadraticCurveTo(-3, -2, 0, 0);
  ctx.quadraticCurveTo(3, -2, 7, flap);
  ctx.stroke();
  ctx.restore();
}
function drawTree(t, time) {
  if (t.dead) return;
  const sway = Math.sin(time * 1.2 + t.sway) * 1.5;
  ctx.save(); ctx.translate(t.x, t.y);
  // Stamm mit Umriss und Astansatz
  ctx.fillStyle = '#3a2812';
  ctx.fillRect(-3.4, -t.h - 1, 6.8, t.h + 2);
  ctx.fillStyle = t.burn > 0 ? '#4a2c14' : '#6b4a2c';
  ctx.fillRect(-2.5, -t.h, 5, t.h);
  ctx.fillStyle = t.burn > 0 ? '#3a2210' : '#59391f';
  ctx.fillRect(-1, -t.h * 0.55, 3.4, 2);
  // Krone: dunkler Umriss, darüber zwei Grüntöne
  const leaf = t.burn > 0 ? '#7a4a20' : '#356b31';
  const leaf2 = t.burn > 0 ? '#8a5a28' : '#4f9040';
  ctx.fillStyle = '#1e3a1c';
  ctx.beginPath();
  ctx.ellipse(sway, -t.h - 6, 14.4, 12.4, 0, 0, Math.PI * 2);
  ctx.ellipse(sway - 8, -t.h + 2, 10.4, 9.4, 0, 0, Math.PI * 2);
  ctx.ellipse(sway + 8, -t.h + 2, 10.4, 9.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = leaf;
  ctx.beginPath();
  ctx.ellipse(sway, -t.h - 6, 13, 11, 0, 0, Math.PI * 2);
  ctx.ellipse(sway - 8, -t.h + 2, 9, 8, 0, 0, Math.PI * 2);
  ctx.ellipse(sway + 8, -t.h + 2, 9, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = leaf2;
  ctx.beginPath();
  ctx.ellipse(sway - 3, -t.h - 9, 7.5, 5.5, -0.3, 0, Math.PI * 2);
  ctx.ellipse(sway + 6, -t.h - 2, 5.5, 4, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
function drawWipf(w, time) {
  if (w.dead) return;
  ctx.save(); ctx.translate(w.x, w.y); ctx.scale(w.dir, 1);
  const hop = w.state === 'walk' || w.fleeT > 0 ? Math.abs(Math.sin(time * 9)) * 1.5 : 0;
  ctx.fillStyle = '#a5825a';
  ctx.beginPath(); ctx.ellipse(0, -3 - hop, 5, 3.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(4, -5 - hop, 2.4, 0, Math.PI * 2); ctx.fill();       // Kopf
  ctx.fillStyle = '#8a6a45';
  ctx.beginPath(); ctx.moveTo(3, -7.4 - hop); ctx.lineTo(4.4, -10 - hop); ctx.lineTo(5.4, -7.2 - hop); ctx.closePath(); ctx.fill();  // Ohr
  ctx.fillStyle = '#241a10'; ctx.fillRect(5, -5.6 - hop, 1, 1);                 // Auge
  ctx.fillStyle = '#8a6a45'; ctx.fillRect(-6.4, -4.4 - hop, 2, 1.4);            // Schwänzchen
  ctx.restore();
}
function drawMeteor(f) {
  ctx.save(); ctx.translate(f.x, f.y);
  ctx.fillStyle = 'rgba(255,140,60,0.4)';
  ctx.beginPath(); ctx.arc(0, -4, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#5a4a42';
  ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#7a675c'; ctx.fillRect(-3, -3, 2.4, 2.4);
  ctx.restore();
}

function drawHut(p) {
  const x = p.base.x, y = p.base.y;
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = p.id === 0 ? 'rgba(231,76,60,0.10)' : 'rgba(63,127,214,0.10)';
  ctx.fillRect(-40, -46, 80, 46);
  const fx = p.id === 0 ? -34 : 34;
  ctx.fillStyle = '#77808a'; ctx.fillRect(fx - 11, -18, 22, 18);
  ctx.fillStyle = '#5c646d'; ctx.fillRect(fx - 12, -20, 24, 4);
  ctx.fillStyle = '#4a525a'; ctx.fillRect(fx + 3, -32, 5, 13);
  ctx.fillStyle = '#39424b'; ctx.font = '8px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('🏭', fx, -6);
  // Hochofen (Erz + Kohle -> Metall) auf der ganz äußeren Seite
  const hx = p.id === 0 ? -58 : 58;
  ctx.fillStyle = '#4a4038'; ctx.fillRect(hx - 10, -24, 20, 24);
  ctx.fillStyle = '#5c5048'; ctx.fillRect(hx - 11, -26, 22, 3);
  ctx.fillStyle = '#3a322c'; ctx.fillRect(hx - 5, -38, 10, 13);       // Schlot
  ctx.fillStyle = '#ff8a3c'; ctx.fillRect(hx - 4, -12, 8, 8);          // Glut
  ctx.fillStyle = '#ffd07a'; ctx.fillRect(hx - 2, -10, 4, 4);
  // Sägewerk (Holz -> Bretter)
  const sx = p.id === 0 ? -82 : 82;
  ctx.fillStyle = '#7a5a34'; ctx.fillRect(sx - 11, -20, 22, 20);
  ctx.fillStyle = '#5c4326'; ctx.beginPath();
  ctx.moveTo(sx - 13, -20); ctx.lineTo(sx, -30); ctx.lineTo(sx + 13, -20); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#c3ccd6'; ctx.lineWidth = 1.4;                    // Sägeblatt
  ctx.beginPath(); ctx.arc(sx, -10, 5.4, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#d8b284'; ctx.fillRect(sx - 9, -5, 18, 2);          // Bretterstapel
  ctx.fillStyle = '#8a6238'; ctx.fillRect(-20, -26, 40, 26);
  ctx.fillStyle = '#6d4c2a';
  for (let i = 0; i < 3; i++) ctx.fillRect(-20, -19 + i * 8, 40, 2);
  ctx.fillStyle = '#4a3018'; ctx.fillRect(4, -18, 10, 18);
  ctx.fillStyle = '#5a3c20'; ctx.beginPath();
  ctx.moveTo(-26, -26); ctx.lineTo(0, -44); ctx.lineTo(26, -26); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#3a2a18'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-14, -44); ctx.lineTo(-14, -66); ctx.stroke();
  ctx.fillStyle = p.color;
  ctx.beginPath(); ctx.moveTo(-14, -66); ctx.lineTo(2, -61); ctx.lineTo(-14, -56); ctx.closePath(); ctx.fill();
  ctx.restore();
  if (p.windmill) drawWindmill(p);
}
// Windrad: liefert Strom (Hochofen doppelt, Aufzug schneller)
function drawWindmill(p) {
  const x = millX(p), y = p.base.y;
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = '#8a8f96'; ctx.fillRect(-3, -46, 6, 46);
  ctx.fillStyle = '#6d737a'; ctx.fillRect(-6, -4, 12, 4);
  ctx.save(); ctx.translate(0, -48); ctx.rotate(p.millPh || 0);
  ctx.fillStyle = '#e8eef4';
  for (let i = 0; i < 3; i++) {
    ctx.rotate(Math.PI * 2 / 3);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(3, -18); ctx.lineTo(-2, -19); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = '#39424b'; ctx.beginPath(); ctx.arc(0, -48, 2.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawElevator(el) {
  const p = players[el.team];
  ctx.save(); ctx.translate(el.x, el.topY);
  // Förderturm: Beine, Streben, Seilrad
  ctx.strokeStyle = '#5a4632'; ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-11, 0); ctx.lineTo(0, -34);
  ctx.moveTo(11, 0); ctx.lineTo(0, -34);
  ctx.moveTo(-7.5, -11); ctx.lineTo(7.5, -11);
  ctx.moveTo(-4.5, -21); ctx.lineTo(4.5, -21);
  ctx.stroke();
  ctx.fillStyle = '#39424b';
  ctx.beginPath(); ctx.arc(0, -35, 4.4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#8a8a95';
  ctx.beginPath(); ctx.arc(0, -35, 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = p.color;                                  // Team-Wimpel
  ctx.beginPath(); ctx.moveTo(0, -40); ctx.lineTo(9, -37.5); ctx.lineTo(0, -35); ctx.closePath(); ctx.fill();
  ctx.restore();
  // Förderseil bis zum Korb
  ctx.strokeStyle = '#2e2e34'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(el.x, el.topY - 35); ctx.lineTo(el.x, el.y); ctx.stroke();
  // Korb-Geländer (die Plattform selbst liegt als Material in der Maske)
  ctx.strokeStyle = '#4c4c56'; ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(el.x - CASE_HW, el.y + 1); ctx.lineTo(el.x - CASE_HW, el.y - 9);
  ctx.moveTo(el.x + CASE_HW, el.y + 1); ctx.lineTo(el.x + CASE_HW, el.y - 9);
  ctx.stroke();
}

// Schienennetz: zwei Gleise mit Schwellen, in zusammenhängenden Segmenten
function drawRails() {
  if (!railY) return;
  for (let x = 0; x < WORLD_W; x++) {
    if (railY[x] < 0) continue;
    const start = x;
    // Segment läuft, solange die Schienenhöhe stetig bleibt
    while (x + 1 < WORLD_W && railY[x + 1] >= 0 && Math.abs(railY[x + 1] - railY[x]) < 8) x++;
    const end = x;
    ctx.strokeStyle = '#6a563c'; ctx.lineWidth = 1.2;          // Schwellen
    for (let sx = start; sx <= end; sx += 6) {
      ctx.beginPath(); ctx.moveTo(sx, railY[sx] + 1); ctx.lineTo(sx + 3, railY[sx] + 1); ctx.stroke();
    }
    ctx.strokeStyle = '#9aa4b0'; ctx.lineWidth = 1;            // Gleise
    for (const off of [-0.5, 1.5]) {
      ctx.beginPath();
      ctx.moveTo(start, railY[start] + off);
      for (let sx = start + 1; sx <= end; sx++) ctx.lineTo(sx, railY[sx] + off);
      ctx.stroke();
    }
  }
}
function drawFish(f) {
  ctx.save(); ctx.translate(f.x, f.y); ctx.scale(f.dir * f.size, f.size);
  ctx.fillStyle = '#e8a13c';
  ctx.beginPath(); ctx.ellipse(0, 0, 4.2, 2.2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath();                                              // Schwanzflosse
  ctx.moveTo(-3.6, 0); ctx.lineTo(-6.4, -2.4 + Math.sin(f.ph) * 1.2); ctx.lineTo(-6.4, 2.4 + Math.sin(f.ph) * 1.2);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#241a10'; ctx.fillRect(2, -0.9, 1, 1);
  ctx.restore();
}

function drawLore(lo) {
  ctx.save(); ctx.translate(lo.x, lo.y);
  ctx.fillStyle = '#6b4a2c';
  ctx.beginPath();
  ctx.moveTo(-9, -12); ctx.lineTo(-7, -3); ctx.lineTo(7, -3); ctx.lineTo(9, -12);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#4c3218'; ctx.lineWidth = 1.4; ctx.stroke();
  ctx.fillStyle = players[lo.team].color;
  ctx.fillRect(-7, -7, 14, 2);
  const n = loreCount(lo);
  if (n > 0) {
    const h = Math.min(6, 1.4 + n * 0.5);
    ctx.fillStyle = '#e0b13a';
    ctx.beginPath(); ctx.ellipse(0, -12, 7, h * 0.7, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#ffe28a'; ctx.fillRect(-2, -13 - h * 0.3, 2, 2);
  }
  ctx.fillStyle = '#2e2e34';
  ctx.beginPath(); ctx.arc(-5, -2, 3, 0, Math.PI * 2); ctx.arc(5, -2, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#8a8a95';
  ctx.fillRect(-5.7, -2.7, 1.4, 1.4); ctx.fillRect(4.3, -2.7, 1.4, 1.4);
  ctx.restore();
}

function drawItem(it, time) {
  if (it.buried) return;
  if (it.type === 'nugget') {
    ctx.save(); ctx.translate(it.x, it.y);
    ctx.fillStyle = '#e0b13a';
    ctx.beginPath();
    ctx.moveTo(-4, 1); ctx.lineTo(-2, -3); ctx.lineTo(2, -4); ctx.lineTo(4, 0); ctx.lineTo(2, 2); ctx.lineTo(-2, 3);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffe28a'; ctx.fillRect(-1, -2, 2, 2);
    ctx.restore();
  } else if (it.type === 'loam') {
    ctx.fillStyle = '#c9a86a';
    ctx.beginPath(); ctx.ellipse(it.x, it.y - 2, 4.4, 3.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#a8894e'; ctx.fillRect(it.x - 1.4, it.y - 3.4, 2, 1.4);
  } else if (it.type === 'coal') {
    ctx.fillStyle = '#33343c';
    ctx.beginPath(); ctx.moveTo(it.x - 4, it.y); ctx.lineTo(it.x - 1, it.y - 4); ctx.lineTo(it.x + 3, it.y - 3); ctx.lineTo(it.x + 4, it.y + 1); ctx.lineTo(it.x, it.y + 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#61636e'; ctx.fillRect(it.x - 1, it.y - 2, 1.6, 1.6);
  } else if (it.type === 'ore') {
    ctx.fillStyle = '#6f6560';
    ctx.beginPath(); ctx.moveTo(it.x - 4, it.y + 1); ctx.lineTo(it.x - 2, it.y - 3); ctx.lineTo(it.x + 3, it.y - 3); ctx.lineTo(it.x + 4, it.y + 1); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#a4603a'; ctx.fillRect(it.x - 2, it.y - 2, 2, 1.6); ctx.fillRect(it.x + 1, it.y - 1, 1.6, 1.6);
  } else if (it.type === 'metal') {
    ctx.fillStyle = '#8d97a4'; ctx.fillRect(it.x - 4, it.y - 3, 8, 5);
    ctx.fillStyle = '#c8d2dc'; ctx.fillRect(it.x - 3, it.y - 2.4, 6, 1.6);
    ctx.fillStyle = '#6b7480'; ctx.fillRect(it.x - 4, it.y + 0.8, 8, 1.2);
  } else if (it.type === 'wood') {
    ctx.save(); ctx.translate(it.x, it.y); ctx.rotate(0.2);
    ctx.fillStyle = '#9a6f42'; ctx.fillRect(-5, -2, 10, 4);
    ctx.fillStyle = '#c9a06a'; ctx.beginPath(); ctx.ellipse(5, 0, 1.6, 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  } else if (it.type === 'plank') {
    ctx.fillStyle = '#d8b284'; ctx.fillRect(it.x - 6, it.y - 2.6, 12, 2.2);
    ctx.fillStyle = '#bb9264'; ctx.fillRect(it.x - 6, it.y - 0.2, 12, 2.2);
  } else if (it.type === 'rail') {
    ctx.fillStyle = '#9aa4b0'; ctx.fillRect(it.x - 6, it.y - 3, 12, 1.4); ctx.fillRect(it.x - 6, it.y, 12, 1.4);
    ctx.fillStyle = '#6a563c'; ctx.fillRect(it.x - 3, it.y - 3.4, 1.6, 5);
  } else {
    if (it.chute) {
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(it.x - 8, it.y - 12); ctx.quadraticCurveTo(it.x, it.y - 22, it.x + 8, it.y - 12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(it.x - 8, it.y - 12); ctx.lineTo(it.x, it.y - 2); ctx.lineTo(it.x + 8, it.y - 12); ctx.stroke();
    }
    drawFlint(it.x, it.y, 0);
    if (((time * 2) | 0) % 2) { ctx.fillStyle = '#ff5a3c'; ctx.fillRect(it.x + 2, it.y - 5, 2, 2); }
  }
}
function drawFlint(x, y, spin) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(spin);
  ctx.fillStyle = '#2b2b33';
  ctx.beginPath();
  ctx.moveTo(-4, 0); ctx.lineTo(-1, -4); ctx.lineTo(3, -2); ctx.lineTo(4, 2); ctx.lineTo(0, 4);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#55555f'; ctx.fillRect(-1, -2, 2, 2);
  ctx.restore();
}

function drawClonk(c, time) {
  const cap = teamOf(c);
  if (c.state === 'dead') {
    ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = 'bold 11px system-ui';
    ctx.fillText(`⏳ ${Math.ceil(c.respawnT)}`, cap.base.x + (cap.id === 0 ? 26 : -26), groundY[cap.base.x] - 40);
    return;
  }
  ctx.save();
  ctx.translate(c.x, c.y);
  if (c.state === 'tumble') ctx.rotate(Math.sin(c.tumbleT * 18) * 0.7);
  ctx.scale(c.dir, 1);
  if (c.hurtT > 0 && ((time * 18) | 0) % 2) ctx.globalAlpha = 0.55;

  // Clonk-Look: großer Kopf, kleiner Kittel, dunkle Umrisse
  const oRect = (x, y, w, h, fill) => {
    ctx.fillStyle = 'rgba(28,20,12,0.9)';
    ctx.fillRect(x - 0.7, y - 0.7, w + 1.4, h + 1.4);
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
  };
  const legA = (c.state === 'walk' || c.state === 'dig') ? Math.sin(c.walkPhase) * 2.2
    : (c.state === 'swim' ? Math.sin(time * 6) * 2 : c.state === 'air' ? 1.5 : 0);
  // Stiefel
  oRect(-3.4 + legA, -3, 3.2, 3, '#3a2a18');
  oRect(0.6 - legA, -3, 3.2, 3, '#3a2a18');
  // Kittel
  oRect(-4, -10, 9, 8, '#c8a06a');
  ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(-4, -4.5, 9, 1.6);
  ctx.fillStyle = '#8a6a3c'; ctx.fillRect(-1, -8.4, 1.4, 1.4);   // Knopf
  // Arme
  if (c.state === 'scale') { oRect(2, -15, 3, 5, '#b98f5c'); oRect(2, -8, 3, 4, '#b98f5c'); }
  else if (c.state === 'hangle') { oRect(-3.4, -19, 3, 5, '#b98f5c'); oRect(1.6, -19, 3, 5, '#b98f5c'); }
  else if (c.state === 'dig') { oRect(2, -9 + Math.sin(c.walkPhase) * 1.5, 4, 3, '#b98f5c'); }
  else if (c.state === 'swim') { oRect(2, -12 + Math.sin(time * 6) * 2, 5, 3, '#b98f5c'); }
  else oRect(-5.4, -9.6, 2.4, 5, '#b98f5c');
  if (c.state === 'dig') {
    ctx.save(); ctx.translate(6, -7); ctx.rotate(0.6 + Math.sin(c.walkPhase) * 0.35);
    ctx.fillStyle = '#5a3f22'; ctx.fillRect(-0.6, -1.6, 8.2, 2.8);
    ctx.fillStyle = '#7a5a34'; ctx.fillRect(0, -1, 7, 1.6);
    ctx.fillStyle = '#6a707a'; ctx.fillRect(5.6, -3.2, 4.6, 5.6);
    ctx.fillStyle = '#aab2bc'; ctx.fillRect(6.2, -2.6, 3.4, 4.4);
    ctx.restore();
  }
  // großer Kopf mit Knopfauge
  oRect(-4.5, -17, 9, 8, '#f0c9a0');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(1.2, -15.2, 2.6, 2.8);
  ctx.fillStyle = '#241a10'; ctx.fillRect(2.4, -14.6, 1.4, 1.8);
  ctx.fillStyle = '#d8a988'; ctx.fillRect(-3.6, -11.4, 2.4, 1.4);  // Wange
  // Zipfelmütze in Teamfarbe (mit Umriss)
  ctx.fillStyle = 'rgba(28,20,12,0.9)';
  ctx.beginPath();
  ctx.moveTo(-5.9, -16); ctx.lineTo(5.6, -16); ctx.lineTo(1.4, -23); ctx.lineTo(-7.4, -19.6);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = c.color;
  ctx.beginPath();
  ctx.moveTo(-5, -16.5); ctx.lineTo(4.8, -16.5); ctx.lineTo(1, -22); ctx.lineTo(-6.4, -19.2);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-6.2, -19.8, 1.5, 0, Math.PI * 2); ctx.fill();
  if (c.carry > 0) {
    ctx.fillStyle = 'rgba(28,20,12,0.9)'; ctx.beginPath(); ctx.arc(-5.5, -6.5, 3.9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8a6a3c'; ctx.beginPath(); ctx.arc(-5.5, -6.5, 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd166'; ctx.fillRect(-6.4, -7.7, 1.6, 1.6);
  }
  ctx.restore();

  // Schilder: Name beim gesteuerten, ② beim wartenden Clonk
  ctx.textAlign = 'center';
  const isCtl = cap.controlled === c;
  ctx.font = 'bold 9px system-ui';
  ctx.fillStyle = c.color;
  ctx.fillText(isCtl ? (cap.ai ? '🤖 ' : '') + cap.name : '②', c.x, c.y - PH - 10);
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(c.x - 9, c.y - PH - 8, 18, 3);
  ctx.fillStyle = c.hp > 35 ? '#5ad06e' : '#ff6a5a';
  ctx.fillRect(c.x - 9, c.y - PH - 8, 18 * clamp(c.hp / 100, 0, 1), 3);
  if (c.breath < 1) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(c.x - 9, c.y - PH - 4, 18, 2);
    ctx.fillStyle = '#6cc3ff';
    ctx.fillRect(c.x - 9, c.y - PH - 4, 18 * clamp(c.breath, 0, 1), 2);
  }
}

// Wurf-Taste zeigt das gewählte Wurfgut des gesteuerten Clonks
const lastThrowBtn = ['', ''];
function updateThrowBtns() {
  for (let i = 0; i < 2; i++) {
    const p = players[i];
    if (!p) continue;
    const em = THROWABLES[p.controlled.throwSel || 0].emoji;
    if (lastThrowBtn[i] === em) continue;
    lastThrowBtn[i] = em;
    const el = document.getElementById(i === 0 ? 'b-fire' : 'b2-fire');
    if (el) el.textContent = em;
  }
}

function drawHUD() {
  const y0 = 8;
  ctx.fillStyle = 'rgba(8,25,42,0.72)';
  roundRect(CW / 2 - 42, y0, 84, 28, 10); ctx.fill();
  const sandbox = game.mode === 'sandbox';
  const mm = Math.floor(game.t / 60), ss = Math.floor(game.t % 60);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = !sandbox && game.t < 30 && game.state === 'play' ? '#ff6a5a' : '#eaf3fa';
  ctx.font = 'bold 14px system-ui';
  ctx.fillText(sandbox ? '⛏️ ∞' : `⏱ ${mm}:${ss.toString().padStart(2, '0')}`, CW / 2, y0 + 15);

  const wide = CW >= 720;
  if (wide) {
    const w = 260, h = 48;
    for (const p of players) {
      const c = p.controlled;
      const left = p.id === 0;
      const x0 = left ? 158 : CW - 12 - w;
      ctx.fillStyle = 'rgba(8,25,42,0.72)';
      roundRect(x0, y0, w, h, 10); ctx.fill();
      ctx.textAlign = 'left';
      ctx.fillStyle = p.color; ctx.font = 'bold 14px system-ui';
      ctx.fillText((p.ai ? '🤖 ' : left ? '🔴 ' : '🔵 ') + p.name + (c === p ? ' ①' : ' ②') + (p.windmill ? ' ⚡' : ''), x0 + 10, y0 + 14);
      ctx.fillStyle = '#eaf3fa'; ctx.font = '12px system-ui';
      ctx.fillText(sandbox ? `💰 ${p.score}` : `💰 ${p.score}/${game.goal}`, x0 + 118, y0 + 14);
      const bag = GOODS.filter((g) => c[g.field] > 0).map((g) => `${g.emoji}${c[g.field]}`).join(' ') || '—';
      ctx.fillText(`🎒${invCount(c)}/${SLOTS} ${bag}`, x0 + 10, y0 + 35);
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x0 + 178, y0 + 8, 70, 7);
      ctx.fillStyle = c.hp > 35 ? '#5ad06e' : '#ff6a5a';
      ctx.fillRect(x0 + 178, y0 + 8, 70 * clamp(c.hp / 100, 0, 1), 7);
    }
  } else {
    ctx.font = 'bold 12px system-ui';
    const [a, b] = players;
    const gl = sandbox ? '' : `/${game.goal}`;
    ctx.textAlign = 'left'; ctx.fillStyle = a.color;
    ctx.fillText(`🔴⭐${a.score}${gl} 💰${a.controlled.carry} 💣${a.controlled.flints}`, 10, 50);
    ctx.textAlign = 'right'; ctx.fillStyle = b.color;
    ctx.fillText(`⭐${b.score}${gl} 💰${b.controlled.carry} 💣${b.controlled.flints} ${b.ai ? '🤖' : '🔵'}`, CW - 10, 50);
  }
  ctx.textBaseline = 'alphabetic';
}
function banner(title, sub) {
  ctx.fillStyle = 'rgba(8,25,42,0.85)';
  roundRect(CW / 2 - 190, CH / 2 - 70, 380, 86, 14); ctx.fill();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff'; ctx.font = 'bold 24px system-ui';
  ctx.fillText(title, CW / 2, CH / 2 - 42);
  ctx.fillStyle = '#bcd6ea'; ctx.font = '13px system-ui';
  ctx.fillText(sub, CW / 2, CH / 2 - 12);
  ctx.textBaseline = 'alphabetic';
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ---- Basis-Menü (Produktion / Kaufen / Verkaufen) --------------------------
const shopEl = document.getElementById('shop');
let shopTeam = 0;
function shopClonk() {
  const cap = players[shopTeam];
  return cap ? cap.controlled : null;
}
function openShop(team) {
  const cap = players[team];
  if (!cap) return false;
  const c = cap.controlled;
  if (!c || c.state === 'dead' || !atBase(c)) {
    if (c) addFloat(c.x, c.y - PH - 8, '🛒 nur an der eigenen Hütte', '#ffb0a0');
    return false;
  }
  shopTeam = team;
  shopEl.classList.remove('hidden');
  renderShop();
  return true;
}
function closeShop() { shopEl.classList.add('hidden'); }
function renderShop() {
  const cap = players[shopTeam], c = shopClonk();
  if (!c) return;
  document.getElementById('shop-title').textContent = `🏠 Basis ${cap.name} · 💰 ${cap.score}`;
  const body = document.getElementById('shop-body');
  const st = cap.stock;
  const bag = GOODS.filter((g) => c[g.field] > 0).map((g) => `${g.emoji}${c[g.field]}`).join(' ') || '—';
  const store = GOODS.filter((g) => g.key !== 'nugget' && (st[g.key] || 0) > 0)
    .map((g) => `${g.emoji}${st[g.key]}`).join(' ') || '—';
  const sec = (title, rows) => `<div class="shop-sec"><div class="group-title">${title}</div><div class="shop-grid">${rows}</div></div>`;
  const prod = RECIPES.map((r) => `<button data-act="craft" data-key="${r.key}" ${r.can(c) ? '' : 'disabled'}>`
    + `<span>${r.label}</span><span class="cost">${r.name}</span></button>`).join('');
  const take = GOODS.filter((g) => g.key !== 'nugget').map((g) =>
    `<button data-act="take" data-key="${g.key}" ${(st[g.key] || 0) > 0 && invFree(c) > 0 ? '' : 'disabled'}>`
    + `<span>${g.emoji} nehmen</span><span class="cost">📦 ${st[g.key] || 0}</span></button>`).join('')
    + `<button data-act="putall" ${invCount(c) > 0 ? '' : 'disabled'}><span>📦 Alles ablegen</span><span class="cost">🎒 ${invCount(c)}</span></button>`;
  const buy = SHOP.map((s) => `<button data-act="buy" data-key="${s.key}" ${cap.score >= s.price ? '' : 'disabled'}>`
    + `<span>${s.label}</span><span class="cost">${s.price} 💰</span></button>`).join('');
  const sell = SELL.map((s) => `<button data-act="sell" data-key="${s.key}" ${have(c, s.key) > 0 ? '' : 'disabled'}>`
    + `<span>${s.label}</span><span class="cost">+${s.price} 💰</span></button>`).join('');
  body.innerHTML = `<p class="shop-bag">🎒 Hand (${invCount(c)}/${SLOTS}): ${bag}<br>`
    + `📦 Lager: ${store}${cap.windmill ? ' · ⚡ Windrad' : ''}</p>`
    + sec('🏭 Produktion (Lager + Hand)', prod)
    + sec('📦 Lager ↔ Hand', take)
    + sec('🛒 Kaufen', buy)
    + sec('💱 Verkaufen', sell);
}
shopEl.addEventListener('click', (e) => {
  if (e.target === shopEl) { closeShop(); return; }
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const c = shopClonk();
  if (!c) return;
  const act = b.dataset.act;
  if (act === 'craft') craft(c, b.dataset.key);
  else if (act === 'buy') shopBuy(c, b.dataset.key);
  else if (act === 'sell') shopSell(c, b.dataset.key);
  else if (act === 'take') stockTake(c, b.dataset.key);
  else if (act === 'putall') stockPutAll(c);
  renderShop();
});
document.getElementById('shop-close').addEventListener('click', closeShop);

// ---- Menü / Buttons ---------------------------------------------------------
const menuEl = document.getElementById('menu');
const helpEl = document.getElementById('help');
document.getElementById('btn-menu').addEventListener('click', () => menuEl.classList.remove('hidden'));
document.getElementById('btn-menu-close').addEventListener('click', () => menuEl.classList.add('hidden'));
menuEl.addEventListener('click', (e) => { if (e.target === menuEl) menuEl.classList.add('hidden'); });
document.getElementById('btn-help').addEventListener('click', () => { menuEl.classList.add('hidden'); helpEl.classList.remove('hidden'); });
document.getElementById('btn-start').addEventListener('click', () => helpEl.classList.add('hidden'));
document.getElementById('btn-restart').addEventListener('click', () => { menuEl.classList.add('hidden'); restart(); });
document.getElementById('btn-save').addEventListener('click', () => { menuEl.classList.add('hidden'); saveGame(); });
document.getElementById('btn-load').addEventListener('click', () => { menuEl.classList.add('hidden'); loadGame(); });
document.getElementById('btn-pause').addEventListener('click', togglePause);
document.getElementById('btn-rotate').addEventListener('click', () => { stage.classList.toggle('rot'); resize(); });
document.getElementById('b-zoomin').addEventListener('click', () => setZoom(cam.zoom * 1.3));
document.getElementById('b-zoomout').addEventListener('click', () => setZoom(cam.zoom / 1.3));

// Options-Reihen (statt nativer Selects – die sehen in der gedrehten Bühne
// unglücklich aus): angewählter Knopf wird hervorgehoben
function bindOpts(id, get, set) {
  const row = document.getElementById(id);
  const refresh = () => {
    for (const b of row.children) b.classList.toggle('sel', b.dataset.v === String(get()));
  };
  row.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    set(b.dataset.v);
    refresh();
  });
  refresh();
  return refresh;
}
const menuRefreshers = [
  bindOpts('opt-mode', () => game.mode, (v) => {
    game.mode = MODES.includes(v) ? v : 'sandbox';
    try { localStorage.setItem('clonk_mode', game.mode); } catch { /* egal */ }
    menuEl.classList.add('hidden');
    restart();
  }),
  bindOpts('opt-goal', () => game.goal, (v) => { game.goal = parseInt(v, 10) || 8; checkWin(); }),
  bindOpts('opt-disasters', () => game.disasters, (v) => {
    game.disasters = v;
    try { localStorage.setItem('clonk_disasters', game.disasters); } catch { /* egal */ }
    game.disasterT = (game.disasters === 'wild' ? 25 : 55) + rng() * 30;
  }),
];
function refreshMenu() { for (const r of menuRefreshers) r(); }

// Touch-Steuerung: Joysticks + Aktions-Buttons; ohne Touch-Gerät ausgeblendet
setBtn('b-dig'); setBtn('b-fire'); setBtn('b-buy'); setBtn('b-switch');
setBtn('b2-dig'); setBtn('b2-fire'); setBtn('b2-buy'); setBtn('b2-switch');
setBtn('b-cycle', () => { if (players[0]) cycleThrow(players[0].controlled); });
setBtn('b2-cycle', () => { if (players[1] && !players[1].ai) cycleThrow(players[1].controlled); });
setBtn('b-shop', () => openShop(0));
setBtn('b2-shop', () => openShop(1));
setupJoy('joy-a', 0); setupJoy('joy-b', 1);
layoutTouch();
if (!IS_TOUCH) {
  document.getElementById('wctrl-left').classList.add('hidden');
  document.getElementById('wctrl-right').classList.add('hidden');
}
if (IS_TOUCH && window.innerWidth < window.innerHeight) stage.classList.add('rot');

// ---- Schleife ---------------------------------------------------------------
// Etwas gemächlicheres Tempo als Echtzeit – mehr Clonk, weniger Hektik
const GAME_SPEED = 0.8;
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.04, (now - last) / 1000); last = now;
  if (!game.paused) update(dt * GAME_SPEED);
  computeCam(dt);
  draw(now / 1000);
  requestAnimationFrame(frame);
}

// Test-Hook (Muster wie window.__td / window.__lem)
window.__clonk = {
  MAT, game, WORLD_W, WORLD_H, cam, setZoom, IS_TOUCH,
  get mask() { return mask; },
  matAt, solid, grounded, carveCircle, explode, update, startGame, restart,
  computeCam, buyFlint, fillMat, simStep, wakeArea, switchClonk, fellTree,
  doRain, doQuake, doMeteor, doVolcano,
  serialize, applyLoad, saveGame, loadGame, joys, layoutTouch, GAME_SPEED,
  THROWABLES, throwItem, cycleThrow, bgMat, areaDiggable,
  RECIPES, SHOP, SELL, craft, shopBuy, shopSell, openShop, closeShop, atBase,
  GOODS, SLOTS, invCount, invFree, have, takeRes, giveRes, stockTake, stockPutAll,
  loreCount, loreAdd,
  railAt, addLore, fish: () => fish, get railY() { return railY; },
  players: () => players, allClonks, items: () => items, projectiles: () => projectiles,
  lores: () => lores, elevators: () => elevators, onElevatorCase,
  goldSpots: () => goldSpots, trees: () => trees, wipfe: () => wipfe,
  volcanoes: () => volcanoes,
  groundY: () => groundY, birds: () => birds, pressed, buttons, throwFlint, hurt,
  TOUGH, ORE_PER_CHUNK,
};

resize();
startGame();
requestAnimationFrame(frame);
