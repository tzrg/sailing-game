// Die Welt des Flugsimulators: europäische Hügellandschaft mit Feldern,
// Wäldern, See, Dörfern, einer Stadt mit Hochhäusern und dem Flugplatz.
// Alles wird einmal als Höhenfeld berechnet und zu wenigen großen Meshes
// zusammengefasst – pro Mesh ein Zeichenaufruf.

import { MeshBuilder } from './gl3d.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

/* ------------------------------------------------------------ Rauschen -- */
function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + 1442695041;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function noise(x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = smooth(x - x0), fy = smooth(y - y0);
  const a = hash2(x0, y0), b = hash2(x0 + 1, y0);
  const c = hash2(x0, y0 + 1), d = hash2(x0 + 1, y0 + 1);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy) * 2 - 1;
}

/* ------------------------------------------------------------- Maße ----- */
export const WORLD = 15000;             // Kantenlänge der Welt in Metern
const HALF = WORLD / 2;
const GRID = 150;                       // Zellen je Achse (100 m)
const CELL = WORLD / GRID;

// Flugplatz: Piste 18/36, also Nord-Süd. -Z zeigt nach Norden.
export const AIRPORT = {
  x: 0, z: 0, elev: 142,
  len: 1300, width: 34, heading: 0,     // Piste liegt entlang der Z-Achse
};
export const RUNWAY = {
  x0: AIRPORT.x - AIRPORT.width / 2, x1: AIRPORT.x + AIRPORT.width / 2,
  z0: AIRPORT.z - AIRPORT.len / 2, z1: AIRPORT.z + AIRPORT.len / 2,
  y: AIRPORT.elev,
};
export const LAKE = { x: -3100, z: -2300, r: 1050, y: AIRPORT.elev - 24 };
export const CITY = { x: 3300, z: -3100, r: 1500, elev: AIRPORT.elev + 16 };

/* ------------------------------------------------------- Höhenprofil ---- */
function hills(x, z) {
  let h = 150;
  h += noise(x * 0.00011, z * 0.00011) * 230;
  h += noise(x * 0.00037 + 31, z * 0.00037 - 17) * 62;
  h += noise(x * 0.0014 - 5, z * 0.0014 + 9) * 11;
  return h;
}

// Ebnet das Gelände rund um einen Punkt ein (Flugplatz, Stadt)
function flatten(h, target, d, inner, outer) {
  if (d > outer) return h;
  const t = smooth(clamp((d - inner) / (outer - inner), 0, 1));
  return lerp(target, h, t);
}

export function terrainH(x, z) {
  let h = hills(x, z);
  h = flatten(h, AIRPORT.elev, Math.hypot(x - AIRPORT.x, z - AIRPORT.z), 1100, 2600);
  h = flatten(h, CITY.elev, Math.hypot(x - CITY.x, z - CITY.z), CITY.r, CITY.r + 1400);
  // Seemulde
  const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
  if (dl < LAKE.r + 420) {
    const t = smooth(clamp((dl - LAKE.r * 0.7) / (LAKE.r * 0.3 + 420), 0, 1));
    h = lerp(LAKE.y - 16, h, t);
  }
  return h;
}

// Steigung als Maß für Fels/Wiese
function slope(x, z) {
  const d = 55;
  const hx = terrainH(x + d, z) - terrainH(x - d, z);
  const hz = terrainH(x, z + d) - terrainH(x, z - d);
  return Math.hypot(hx, hz) / (2 * d);
}

/* --------------------------------------------------- Flächennutzung ----- */
const FIELD = 235;                      // Kantenlänge einer Parzelle

// 0 Wiese, 1 Acker, 2 Raps, 3 Stoppel, 4 Wald, 5 Stadt/Ort
export function landUse(x, z) {
  const cx = Math.floor(x / FIELD), cz = Math.floor(z / FIELD);
  const r = hash2(cx * 7 + 3, cz * 13 - 5);
  if (Math.hypot(x - CITY.x, z - CITY.z) < CITY.r * 1.08) return 5;
  if (slope(x, z) > 0.17) return 4;                 // steile Hänge = Wald
  if (r > 0.86) return 4;
  if (r > 0.64) return 1;
  if (r > 0.52) return 2;
  if (r > 0.42) return 3;
  return 0;
}

const USE_COL = [
  [0.44, 0.60, 0.30],   // Wiese
  [0.52, 0.42, 0.26],   // Acker
  [0.78, 0.74, 0.24],   // Raps
  [0.70, 0.66, 0.40],   // Stoppelfeld
  [0.20, 0.36, 0.20],   // Wald
  [0.40, 0.40, 0.40],   // Ortslage
];

function groundColor(x, z) {
  const use = landUse(x, z);
  const c = USE_COL[use];
  // leichte Streuung je Parzelle, damit kein Farbteppich entsteht
  const v = 0.86 + hash2(Math.floor(x / FIELD) * 31, Math.floor(z / FIELD) * 17) * 0.28;
  const n = 0.96 + noise(x * 0.004, z * 0.004) * 0.06;
  const near = Math.hypot(x - AIRPORT.x, z - AIRPORT.z);
  if (near < 900) {                                 // Flugplatzwiese
    return [0.40 * n, 0.56 * n, 0.27 * n];
  }
  return [clamp(c[0] * v * n, 0, 1), clamp(c[1] * v * n, 0, 1), clamp(c[2] * v * n, 0, 1)];
}

/* ------------------------------------------------------------ Gebäude --- */
// Quader mit Achsen-Hitbox: dient zugleich der Kollisionsprüfung.
export function buildWorld(gl) {
  const buildings = [];
  const addBox = (b, cx, cy, cz, sx, sy, sz, col, top) => {
    b.box(cx, cy, cz, sx, sy, sz, col, top);
    buildings.push({ x: cx, z: cz, y0: cy, y1: cy + sy, sx, sz });
  };

  /* --- Gelände --- */
  const ter = new MeshBuilder();
  const H = [], C = [];
  for (let iz = 0; iz <= GRID; iz++) {
    H[iz] = []; C[iz] = [];
    for (let ix = 0; ix <= GRID; ix++) {
      const x = -HALF + ix * CELL, z = -HALF + iz * CELL;
      H[iz][ix] = terrainH(x, z);
      C[iz][ix] = groundColor(x, z);
    }
  }
  for (let iz = 0; iz < GRID; iz++) {
    for (let ix = 0; ix < GRID; ix++) {
      const x0 = -HALF + ix * CELL, z0 = -HALF + iz * CELL;
      const x1 = x0 + CELL, z1 = z0 + CELL;
      const a = [x0, H[iz][ix], z0], b2 = [x1, H[iz][ix + 1], z0];
      const c = [x1, H[iz + 1][ix + 1], z1], d = [x0, H[iz + 1][ix], z1];
      const col = C[iz][ix];
      ter.quad(a, d, c, b2, col);
    }
  }

  /* --- Wasser: See als ebene Fläche --- */
  const water = new MeshBuilder();
  const wseg = 26;
  for (let i = 0; i < wseg; i++) {
    const a0 = (i / wseg) * Math.PI * 2, a1 = ((i + 1) / wseg) * Math.PI * 2;
    const r = LAKE.r;
    const p0 = [LAKE.x + Math.cos(a0) * r, LAKE.y, LAKE.z + Math.sin(a0) * r];
    const p1 = [LAKE.x + Math.cos(a1) * r, LAKE.y, LAKE.z + Math.sin(a1) * r];
    const mid = [LAKE.x, LAKE.y, LAKE.z];
    const i0 = water.vert(mid, [0, 1, 0], [0.17, 0.35, 0.52]);
    water.vert(p1, [0, 1, 0], [0.20, 0.40, 0.58]);
    water.vert(p0, [0, 1, 0], [0.20, 0.40, 0.58]);
    water.tri(i0, i0 + 1, i0 + 2);
  }

  /* --- Flugplatz: Piste, Mittellinie, Schwellen, Rollweg, Vorfeld --- */
  const port = new MeshBuilder();
  const pad = (x0, x1, z0, z1, y, col) => port.quad(
    [x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], col, [0, 1, 0],
  );
  const RY = RUNWAY.y + 0.25;
  pad(RUNWAY.x0 - 7, RUNWAY.x1 + 7, RUNWAY.z0 - 10, RUNWAY.z1 + 10, RY - 0.1, [0.30, 0.31, 0.30]);
  pad(RUNWAY.x0, RUNWAY.x1, RUNWAY.z0, RUNWAY.z1, RY, [0.24, 0.24, 0.26]);
  // Mittellinie
  for (let z = RUNWAY.z0 + 30; z < RUNWAY.z1 - 30; z += 60) {
    pad(-0.5, 0.5, z, z + 30, RY + 0.05, [0.88, 0.88, 0.86]);
  }
  // Schwellenbalken an beiden Enden
  for (const end of [RUNWAY.z0, RUNWAY.z1]) {
    const dir = end === RUNWAY.z0 ? 1 : -1;
    for (let i = 0; i < 6; i++) {
      const x = -13 + i * 4.6;
      pad(x, x + 2.6, end + dir * 8, end + dir * 32, RY + 0.05, [0.9, 0.9, 0.88]);
    }
    pad(RUNWAY.x0, RUNWAY.x1, end + dir * 42, end + dir * 45, RY + 0.05, [0.9, 0.9, 0.88]);
  }
  // Rollweg und Vorfeld östlich der Piste
  pad(RUNWAY.x1 + 7, RUNWAY.x1 + 22, RUNWAY.z0 + 60, RUNWAY.z1 - 60, RY - 0.05, [0.27, 0.27, 0.28]);
  pad(RUNWAY.x1 + 22, RUNWAY.x1 + 150, -220, 120, RY - 0.05, [0.30, 0.30, 0.31]);

  // Gebäude am Platz
  const grey = [0.72, 0.72, 0.70], roof = [0.34, 0.30, 0.30];
  addBox(port, RUNWAY.x1 + 70, RY, -150, 46, 11, 26, [0.80, 0.80, 0.78], roof);  // Hangar
  addBox(port, RUNWAY.x1 + 70, RY, -112, 46, 11, 26, [0.76, 0.78, 0.80], roof);
  addBox(port, RUNWAY.x1 + 120, RY, 30, 18, 9, 16, grey, roof);                  // Terminal
  addBox(port, RUNWAY.x1 + 120, RY + 9, 30, 9, 11, 9, [0.55, 0.70, 0.80], [0.3, 0.3, 0.3]); // Tower
  // Windsack
  port.box(RUNWAY.x1 + 30, RY, -40, 0.6, 9, 0.6, [0.8, 0.8, 0.8]);
  port.box(RUNWAY.x1 + 32.5, RY + 7.5, -40, 5, 1.6, 1.6, [0.95, 0.45, 0.1]);
  // Pistenbefeuerung als kleine weiße Pfosten
  for (let z = RUNWAY.z0; z <= RUNWAY.z1; z += 100) {
    for (const x of [RUNWAY.x0 - 4, RUNWAY.x1 + 4]) {
      port.box(x, RY, z, 0.7, 0.8, 0.7, [0.92, 0.92, 0.85]);
    }
  }

  /* --- Stadt: Raster aus Blöcken, in der Mitte die Hochhäuser --- */
  const city = new MeshBuilder();
  const BLOCK = 150;
  for (let gx = -9; gx <= 9; gx++) {
    for (let gz = -9; gz <= 9; gz++) {
      const bx = CITY.x + gx * BLOCK, bz = CITY.z + gz * BLOCK;
      const d = Math.hypot(bx - CITY.x, bz - CITY.z);
      if (d > CITY.r) continue;
      const r = hash2(gx * 97 + 11, gz * 61 - 3);
      if (r < 0.12) continue;                         // Park oder Platz
      const centre = 1 - clamp(d / CITY.r, 0, 1);
      const r2 = hash2(gx * 17 + 101, gz * 29 + 57);
      // Skyline: zur Mitte hin deutlich höher, dazwischen einzelne Türme
      let h = 10 + centre * centre * 46 + r2 * (16 + centre * 140);
      if (centre > 0.55 && r2 > 0.84) h = 150 + r2 * 85;
      const w = 32 + hash2(gx * 3, gz * 11) * 40;
      const dp = 32 + hash2(gx * 13, gz * 2) * 40;
      const y = terrainH(bx, bz);
      const tone = 0.50 + hash2(gx, gz) * 0.34;
      const col = h > 55
        ? [tone * 0.58, tone * 0.68, tone * 0.84]     // Glasfassade
        : [tone, tone * 0.93, tone * 0.86];
      addBox(city, bx, y, bz, w, h, dp, col, [0.30, 0.30, 0.32]);
      if (h > 55) {                                   // Dachaufbau und Antenne
        city.box(bx, y + h, bz, w * 0.4, 5, dp * 0.4, [0.4, 0.42, 0.45]);
        if (h > 120) city.box(bx, y + h + 5, bz, 1.2, 16, 1.2, [0.65, 0.3, 0.25]);
      }
    }
  }

  /* --- Dörfer: kleine Häuser mit roten Dächern --- */
  const village = new MeshBuilder();
  const VILLAGES = [[-2100, 1900], [2400, 2600], [-3600, 900], [1500, -1500]];
  for (const [vx, vz] of VILLAGES) {
    for (let i = 0; i < 26; i++) {
      const a = hash2(vx + i, vz - i) * Math.PI * 2;
      const r = 60 + hash2(vx - i, vz + i) * 300;
      const hx = vx + Math.cos(a) * r, hz = vz + Math.sin(a) * r;
      const y = terrainH(hx, hz);
      const w = 9 + hash2(i, vx) * 7;
      addBox(village, hx, y, hz, w, 5 + hash2(i, vz) * 3, w * 0.8,
        [0.86, 0.84, 0.78], [0.55, 0.22, 0.16]);
    }
    // Kirchturm
    const y = terrainH(vx, vz);
    addBox(village, vx, y, vz, 11, 9, 16, [0.88, 0.87, 0.82], [0.5, 0.2, 0.15]);
    addBox(village, vx + 7, y, vz, 7, 26, 7, [0.86, 0.85, 0.8], [0.35, 0.3, 0.28]);
  }

  /* --- Wälder: Baumkegel in den Waldparzellen --- */
  const trees = new MeshBuilder();
  for (let i = 0; i < 2600; i++) {
    const x = (hash2(i * 3 + 1, i * 7 + 2) - 0.5) * WORLD * 0.94;
    const z = (hash2(i * 11 + 5, i * 5 - 3) - 0.5) * WORLD * 0.94;
    if (landUse(x, z) !== 4) continue;
    if (Math.hypot(x - AIRPORT.x, z - AIRPORT.z) < 900) continue;
    const y = terrainH(x, z);
    if (y < LAKE.y + 2 && Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r) continue;
    const h = 14 + hash2(i, i * 2) * 13;
    const g = 0.15 + hash2(i * 2, i) * 0.14;
    trees.box(x, y, z, 1.4, h * 0.34, 1.4, [0.26, 0.19, 0.13]);
    trees.cone(x, y + h * 0.3, z, 4.2 + hash2(i, 9) * 2.4, h, [g * 0.7, g + 0.14, g * 0.6]);
  }

  /* --- Straße vom Flugplatz zur Stadt --- */
  const road = new MeshBuilder();
  const rp = (t) => [lerp(AIRPORT.x + 230, CITY.x, t), lerp(AIRPORT.z - 200, CITY.z, t)];
  for (let i = 0; i < 90; i++) {
    const [ax, az] = rp(i / 90), [bx, bz] = rp((i + 1) / 90);
    const dx = bx - ax, dz = bz - az;
    const l = Math.hypot(dx, dz) || 1;
    const nx = (-dz / l) * 5, nz = (dx / l) * 5;
    road.quad(
      [ax - nx, terrainH(ax - nx, az - nz) + 0.4, az - nz],
      [ax + nx, terrainH(ax + nx, az + nz) + 0.4, az + nz],
      [bx + nx, terrainH(bx + nx, bz + nz) + 0.4, bz + nz],
      [bx - nx, terrainH(bx - nx, bz - nz) + 0.4, bz - nz],
      [0.23, 0.23, 0.24], [0, 1, 0],
    );
  }

  return {
    meshes: {
      terrain: ter.upload(gl),
      water: water.upload(gl),
      port: port.upload(gl),
      city: city.upload(gl),
      village: village.upload(gl),
      trees: trees.upload(gl),
      road: road.upload(gl),
    },
    buildings,
  };
}

/* ---------------------------------------------------- Cessna-Modell ----- */
// Hochdecker: Rumpf, Tragfläche mit Streben, Leitwerk, Fahrwerk, Propeller.
// Körperachsen: +x rechts, +y oben, -z vorwärts.
export function buildPlane(gl) {
  const b = new MeshBuilder();
  const white = [0.92, 0.92, 0.94], blue = [0.15, 0.33, 0.62];
  const dark = [0.2, 0.2, 0.22], glass = [0.35, 0.48, 0.60];

  b.box(0, -0.75, 0.6, 1.15, 1.5, 5.2, white, white);        // Rumpf
  b.box(0, -0.35, -1.9, 1.1, 0.95, 1.6, white, white);       // Motorhaube
  b.box(0, -0.2, -0.25, 1.16, 0.75, 1.9, glass, glass);      // Kabine
  b.box(0, 0.05, 2.9, 0.9, 0.9, 1.2, white, white);          // Rumpfende
  b.box(0, -0.1, 0.1, 11, 0.26, 1.7, white, white);          // Tragfläche
  b.box(0, -0.12, 0.72, 11, 0.12, 0.5, blue, blue);          // Zierstreifen
  for (const s of [-1, 1]) {                                 // Flügelstreben
    b.box(s * 2.4, -1.1, 0.5, 0.16, 1.1, 0.5, dark, dark);
    b.box(s * 5.2, 0.02, 0.1, 0.5, 0.1, 1.4, blue, blue);    // Querruder
  }
  b.box(0, 0.3, 3.4, 3.6, 0.18, 1.0, white, white);          // Höhenleitwerk
  b.box(0, 0.4, 3.4, 0.2, 1.9, 1.3, white, white);           // Seitenleitwerk
  b.box(0, 1.9, 3.5, 0.22, 0.45, 0.9, blue, blue);
  b.box(0, -1.6, 0.45, 0.3, 0.9, 0.3, dark, dark);           // Hauptfahrwerk
  for (const s of [-1, 1]) {
    b.box(s * 1.5, -2.0, 0.45, 0.3, 0.5, 0.3, dark, dark);
    b.box(s * 1.5, -2.25, 0.45, 0.5, 0.55, 0.55, [0.12, 0.12, 0.12], dark);
  }
  b.box(0, -2.0, -1.9, 0.26, 1.1, 0.26, dark, dark);         // Bugrad
  b.box(0, -2.3, -1.9, 0.45, 0.5, 0.5, [0.12, 0.12, 0.12], dark);
  b.box(0, -0.35, -2.75, 0.36, 0.36, 0.3, dark, dark);       // Spinner
  return b.upload(gl);
}

// Propellerscheibe: wird je nach Drehzahl halbtransparent wirkend gezeichnet
export function buildProp(gl) {
  const b = new MeshBuilder();
  const seg = 14, r = 0.95;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const c = [0.26, 0.26, 0.28];
    const i0 = b.vert([0, 0, 0], [0, 0, -1], c);
    b.vert([Math.cos(a1) * r, Math.sin(a1) * r, 0], [0, 0, -1], c);
    b.vert([Math.cos(a0) * r, Math.sin(a0) * r, 0], [0, 0, -1], c);
    b.tri(i0, i0 + 1, i0 + 2);
  }
  return b.upload(gl);
}
