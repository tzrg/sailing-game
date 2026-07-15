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
    this.islandSize = cfg.islandSize ?? 0.4;
    this.lakeSize = cfg.lakeSize ?? 0.5;
    // mehr Dichte -> niedrigere Landschwelle; mehr Größe -> längere Wellenlänge.
    // Kalibriert: bei Standarddichte liegt die nächste Insel im Median ~260 m
    // vom Start (wenige Minuten Segelzeit), Landanteil ~28%; Dichte 1 ~ Archipel.
    this.threshold = 0.66 - 0.20 * this.islandDensity;
    this.wavelength = 250 + 900 * this.islandSize;
    this.lakeR = 220 + 1080 * this.lakeSize; // Seeradius in Metern
  }

  // Wie stark der Regattakurs schrumpfen muss, damit er ins Gewässer passt
  get courseScale() {
    if (this.mode !== 'see') return 1;
    return Math.min(1, Math.max(0.35, (this.lakeR * 0.75) / 380));
  }

  // "Höhe" 0..1 an Weltposition (Meter); um den Start herum wird Wasser garantiert
  height(x, y) {
    let h = 0, amp = 0.5, freq = 1 / this.wavelength;
    for (let o = 0; o < 4; o++) {
      h += amp * valueNoise(x * freq, y * freq, this.seed + o * 131);
      amp *= 0.5;
      freq *= 2.13;
    }
    h /= 0.9375;
    const r2 = x * x + y * y;
    if (this.mode === 'see') {
      // außerhalb des Seeradius steigt das Ufer an; das Rauschen
      // macht die Uferlinie unregelmäßig
      const r = Math.sqrt(r2);
      h += Math.min(1.2, Math.max(0, (r - this.lakeR) / 180) * 0.5);
    }
    // kleiner Freiraum am Startpunkt (nur so groß wie nötig, damit
    // Inseln in Seen nicht weggebügelt werden)
    h -= 0.3 * Math.exp(-r2 / (2 * 130 * 130));
    return h;
  }

  isLand(x, y) {
    return this.height(x, y) > this.threshold;
  }
}
