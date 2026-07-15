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
  constructor(seed) {
    this.seed = seed | 0;
    this.threshold = 0.57; // darüber ist Land
  }

  // "Höhe" 0..1 an Weltposition (Meter); um den Start herum wird Wasser garantiert
  height(x, y) {
    let h = 0, amp = 0.5, freq = 1 / 700;
    for (let o = 0; o < 4; o++) {
      h += amp * valueNoise(x * freq, y * freq, this.seed + o * 131);
      amp *= 0.5;
      freq *= 2.13;
    }
    h /= 0.9375;
    const r2 = x * x + y * y;
    h -= 0.32 * Math.exp(-r2 / (2 * 260 * 260));
    return h;
  }

  isLand(x, y) {
    return this.height(x, y) > this.threshold;
  }
}
