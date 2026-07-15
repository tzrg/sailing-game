// Regattakurs: Startlinie, Bahnmarken (Bojen) in Reihenfolge, Ziellinie
// (= Startlinie). Die Uhr startet beim Überqueren der Startlinie und stoppt
// beim Zieldurchgang; Bestzeiten pro Karte und Bootstyp im localStorage.

import { TAU, dirVec, rotCW, normAngle, lerp } from './util.js';

const REC_DT = 0.15;   // Abtastintervall der Geisterboot-Aufzeichnung (s)
const KEY_VER = '2';   // bei Kursänderungen erhöhen -> alte Bestzeiten verfallen

function hashAngle(seed) {
  let h = Math.imul(seed ^ 0x5bd1e995, 0x27d4eb2d);
  h ^= h >>> 15;
  return ((h >>> 0) / 4294967296) * TAU;
}

// Punkt mit freiem Wasser drumherum suchen (deterministische Spirale)
function isClear(terrain, x, y, r) {
  if (terrain.isLand(x, y)) return false;
  for (let a = 0; a < TAU - 0.01; a += TAU / 8) {
    if (terrain.isLand(x + Math.cos(a) * r, y + Math.sin(a) * r)) return false;
  }
  return true;
}

function findWaterSpot(terrain, x, y, clearance = 20) {
  if (isClear(terrain, x, y, clearance)) return { x, y };
  for (let r = 15; r < 500; r += 15) {
    for (let a = 0; a < TAU - 0.01; a += 0.35) {
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (isClear(terrain, px, py, clearance)) return { x: px, y: py };
    }
  }
  return { x, y };
}

function cross2(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

// schneidet die Strecke p->q die Strecke a->b?
function segmentsCross(p, q, a, b) {
  const d1 = cross2(b.x - a.x, b.y - a.y, p.x - a.x, p.y - a.y);
  const d2 = cross2(b.x - a.x, b.y - a.y, q.x - a.x, q.y - a.y);
  const d3 = cross2(q.x - p.x, q.y - p.y, a.x - p.x, a.y - p.y);
  const d4 = cross2(q.x - p.x, q.y - p.y, b.x - p.x, b.y - p.y);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

export const MARK_RADIUS = 20; // m: so nah muss man an eine Boje heran

export class Race {
  constructor() {
    this.state = 'idle'; // idle | armed | running | finished
    this.t = 0;
    this.marks = [];
    this.nextIdx = 0;
    this.best = null;
    this.isNewBest = false;
    this.seed = 0;
  }

  // Kurs deterministisch aus dem Karten-Seed ableiten (unabhängig vom Wind),
  // damit Bestzeiten pro Karte vergleichbar sind.
  setup(terrain) {
    this.seed = terrain.seed;
    const dir = hashAngle(terrain.seed);
    this.dir = dir;
    const d = dirVec(dir);
    const perp = rotCW(d);
    const c = findWaterSpot(terrain, 0, 0, 40);
    this.center = c;
    this.line = {
      a: findWaterSpot(terrain, c.x + perp.x * 30, c.y + perp.y * 30, 10),
      b: findWaterSpot(terrain, c.x - perp.x * 30, c.y - perp.y * 30, 10),
    };
    // Dreieckskurs: Kreuz nach oben, Raumschots-Schenkel, zurück zur Linie
    this.marks = [
      findWaterSpot(terrain, c.x + d.x * 380, c.y + d.y * 380),
      findWaterSpot(terrain, c.x + d.x * 200 + perp.x * 260, c.y + d.y * 200 + perp.y * 260),
      findWaterSpot(terrain, c.x + d.x * 40 - perp.x * 240, c.y + d.y * 40 - perp.y * 240),
    ];
  }

  // Rennen scharf schalten: Kurs bauen und Boot hinter die Startlinie setzen
  arm(terrain, boat) {
    this.setup(terrain);
    const d = dirVec(this.dir);
    const start = findWaterSpot(terrain, this.center.x - d.x * 45, this.center.y - d.y * 45, 12);
    boat.x = start.x;
    boat.y = start.y;
    boat.vx = 0;
    boat.vy = 0;
    boat.angVel = 0;
    boat.heading = this.dir;
    this.state = 'armed';
    this.t = 0;
    this.nextIdx = 0;
    this.isNewBest = false;
    this.best = this.loadBest(boat);
    this.ghost = this.loadGhost(boat);
    this.rec = null;
  }

  cancel() {
    this.state = 'idle';
  }

  bestKey(boat) {
    return `sailbest${KEY_VER}_${this.seed}_${boat.type.key}`;
  }

  ghostKey(boat) {
    return `sailghost${KEY_VER}_${this.seed}_${boat.type.key}`;
  }

  loadBest(boat) {
    try {
      const v = parseFloat(localStorage.getItem(this.bestKey(boat)));
      return Number.isFinite(v) ? v : null;
    } catch {
      return null;
    }
  }

  loadGhost(boat) {
    try {
      const g = JSON.parse(localStorage.getItem(this.ghostKey(boat)));
      if (g && Array.isArray(g.x) && g.x.length > 1 && g.dt > 0) return g;
    } catch { /* kein/kaputter Geist */ }
    return null;
  }

  saveGhost(boat) {
    if (!this.rec || this.rec.x.length < 2) return;
    try {
      localStorage.setItem(this.ghostKey(boat), JSON.stringify({
        dt: REC_DT,
        T: this.t,
        len: boat.type.lengthM,
        x: this.rec.x, y: this.rec.y, h: this.rec.h, b: this.rec.b,
      }));
    } catch { /* localStorage voll/nicht verfügbar */ }
  }

  // Geisterboot-Position zur Rennzeit t (linear interpoliert)
  ghostAt(t) {
    const g = this.ghost;
    if (!g) return null;
    const n = g.x.length;
    const i = Math.max(0, Math.min(Math.floor(t / g.dt), n - 1));
    const j = Math.min(i + 1, n - 1);
    const f = Math.max(0, Math.min(1, t / g.dt - i));
    return {
      x: lerp(g.x[i], g.x[j], f),
      y: lerp(g.y[i], g.y[j], f),
      h: g.h[i] + normAngle(g.h[j] - g.h[i]) * f,
      b: lerp(g.b[i], g.b[j], f),
      len: g.len || 5.5,
      finished: t > g.T,
    };
  }

  update(boat, prevPos, dt) {
    if (this.state === 'armed') {
      if (segmentsCross(prevPos, boat, this.line.a, this.line.b)) {
        this.state = 'running';
        this.t = 0;
        this.rec = { x: [], y: [], h: [], b: [] };
      }
    } else if (this.state === 'running') {
      this.t += dt;
      // Fahrt für das Geisterboot aufzeichnen (festes Raster)
      if (this.rec) {
        while (this.rec.x.length * REC_DT <= this.t) {
          this.rec.x.push(Math.round(boat.x * 10) / 10);
          this.rec.y.push(Math.round(boat.y * 10) / 10);
          this.rec.h.push(Math.round(boat.heading * 100) / 100);
          this.rec.b.push(Math.round(boat.boom * 100) / 100);
        }
      }
      if (this.nextIdx < this.marks.length) {
        const m = this.marks[this.nextIdx];
        if (Math.hypot(boat.x - m.x, boat.y - m.y) < MARK_RADIUS) this.nextIdx++;
      } else if (segmentsCross(prevPos, boat, this.line.a, this.line.b)) {
        this.state = 'finished';
        const prevBest = this.loadBest(boat);
        this.isNewBest = prevBest == null || this.t < prevBest;
        this.best = this.isNewBest ? this.t : prevBest;
        if (this.isNewBest) {
          this.saveGhost(boat);
          try {
            localStorage.setItem(this.bestKey(boat), String(this.best));
          } catch { /* localStorage nicht verfügbar */ }
        }
      }
    }
  }

  // Navigationsziele für Ring und Randpfeile; das nächste ist "primary"
  overlayTargets() {
    if (this.state === 'armed') {
      return [{ ...this.center, label: 'Start', primary: true }];
    }
    if (this.state === 'running') {
      const list = [];
      for (let i = this.nextIdx; i < this.marks.length; i++) {
        list.push({ ...this.marks[i], label: String(i + 1), primary: i === this.nextIdx });
      }
      list.push({ ...this.center, label: 'Ziel', primary: this.nextIdx >= this.marks.length });
      return list;
    }
    return [];
  }
}

export function formatTime(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
