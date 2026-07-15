// Prozedurales Gelände: fraktales Value-Noise erzeugt Seeufer und Inseln.
// Alle Koordinaten in Metern, deterministisch pro Seed.

function hash2(x, y, seed) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

function valueNoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(x - ix), fy = smooth(y - iy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

export class Terrain {
  // cfg: mode 'see' (Binnensee mit Ufer) | 'meer' (offenes Meer),
  //      lakeSize, islandDensity, islandSize jeweils 0..1
  constructor(seed, cfg = {}) {
    this.seed = seed | 0;
    this.mode = cfg.mode === 'meer' ? 'meer' : 'see';
    this.islandDensity = cfg.islandDensity ?? 0.5;
    this.islandSize = cfg.islandSize ?? 0.25;
    this.lakeSize = cfg.lakeSize ?? 0.5;
    this.threshold = 0.6;
    // Inseln werden als Einzelfeatures auf einem gejitterten Raster gestreut:
    // Dichte = Wahrscheinlichkeit pro Rasterzelle, Größe = Zellabstand/Radius.
    // So entstehen viele getrennte kleine Inseln statt zusammenhängender Klumpen.
    this.islandProb = 0.45 + 0.55 * this.islandDensity;
    this.spacing = 100 + 180 * this.islandSize;
    // schwaches Großrelief (größere Landmassen nur bei großer Inselgröße)
    this.bgWeight = 0.15 + 0.5 * this.islandSize;
    this.wavelength = 500 + 700 * this.islandSize;
    this.lakeR = 220 + 1080 * this.lakeSize; // Seeradius in Metern
  }

  // Wie stark der Regattakurs schrumpfen muss, damit er ins Gewässer passt
  // (längster Kursschenkel ist ~230 m)
  get courseScale() {
    if (this.mode !== 'see') return 1;
    return Math.min(1, Math.max(0.35, (this.lakeR * 0.75) / 230));
  }

  // gestreute Einzelinseln: 0 = Wasser, bis ~1 im Inselzentrum
  islandField(x, y, r) {
    const cell = this.spacing;
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    let v = 0;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const gx = cx + i, gy = cy + j;
        if (hash2(gx, gy, this.seed ^ 0x9134) > this.islandProb) continue;
        const px = (gx + 0.15 + 0.7 * hash2(gx, gy, this.seed + 11)) * cell;
        const py = (gy + 0.15 + 0.7 * hash2(gx, gy, this.seed + 23)) * cell;
        const rad = cell * (0.14 + 0.3 * hash2(gx, gy, this.seed + 37));
        const d = Math.hypot(x - px, y - py);
        if (d > rad * 1.6) continue;
        // Küstenlinie mit Rauschen verwackeln
        const wob = 0.75 + 0.5 * valueNoise(x / 45, y / 45, this.seed + 51);
        v = Math.max(v, 1 - d / (rad * wob));
      }
    }
    // Startbereich bleibt frei
    return v * Math.min(1, r / 150);
  }

  // "Höhe" 0..1 an Weltposition (Meter); um den Start herum wird Wasser garantiert
  height(x, y) {
    const r2 = x * x + y * y;
    const r = Math.sqrt(r2);
    let n = 0, amp = 0.5, freq = 1 / this.wavelength;
    for (let o = 0; o < 4; o++) {
      n += amp * valueNoise(x * freq, y * freq, this.seed + o * 131);
      amp *= 0.5;
      freq *= 2.13;
    }
    n /= 0.9375;
    let h = 0.5 + (n - 0.5) * this.bgWeight;
    h += this.islandField(x, y, r) * 0.35;
    if (this.mode === 'see') {
      // außerhalb des Seeradius steigt das Ufer an; das Rauschen
      // macht die Uferlinie unregelmäßig
      h += Math.min(1.2, Math.max(0, (r - this.lakeR + (n - 0.5) * 260) / 180) * 0.5);
    }
    h -= 0.3 * Math.exp(-r2 / (2 * 130 * 130));
    return h;
  }

  isLand(x, y) {
    return this.height(x, y) > this.threshold;
  }
}
