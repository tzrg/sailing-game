// Rendering: Wasser mit Wellen-Glitzern, gecachte Gelände-Chunks,
// Boot mit Segeln, Windpartikel, Windrose und HUD.

import { clamp, normAngle, dirVec, angleOf, rotCW, MS_TO_KN, TAU } from './util.js';
import { MARK_RADIUS, formatTime } from './race.js';

const SCALE = 8;        // Pixel pro Meter bei Zoom 1
// Gelände-Chunks in zwei Auflösungen: fein für Nahsicht, grob für Übersicht
const TIERS = {
  fine: { m: 48, step: 0.5 },
  coarse: { m: 192, step: 2 },
};

function hashCell(x, y, seed) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export class Renderer {
  constructor(canvas, terrain) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.terrain = terrain;
    this.chunks = new Map();
    this.particles = [];
    this.wake = [];
    this.wakeTimer = 0;
    this.W = 0;
    this.H = 0;
    this.rose = { x: 0, y: 0, r: 56 };
    this.trimBars = {
      jib: { x: 0, y: 0, w: 0, h: 0 },
      main: { x: 0, y: 0, w: 0, h: 0 },
      spi: { x: 0, y: 0, w: 0, h: 0 },
    };
    this.zoom = 1; // 1 = Normalansicht, <1 = herausgezoomt
    this.showVectors = false;
    this.rudderBar = { x: 0, y: 0, w: 0, h: 0 };
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.canvas.style.width = this.W + 'px';
    this.canvas.style.height = this.H + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.rose.x = this.W - this.rose.r - 24;
    this.rose.y = this.rose.r + 34;
  }

  setTerrain(terrain) {
    this.terrain = terrain;
    this.chunks.clear();
    this.wake.length = 0;
  }

  inRose(p) {
    const dx = p.x - this.rose.x, dy = p.y - this.rose.y;
    return dx * dx + dy * dy < (this.rose.r + 14) * (this.rose.r + 14);
  }

  hitRudderBar(p) {
    const b = this.rudderBar;
    return p.x >= b.x - 12 && p.x <= b.x + b.w + 12 && p.y >= b.y - 12 && p.y <= b.y + b.h + 12;
  }

  // liegt der Punkt auf einem der Regler? -> 'main' | 'jib' | 'spi' | null
  hitTrimBar(p) {
    for (const key of ['main', 'jib', 'spi']) {
      const b = this.trimBars[key];
      if (p.x >= b.x - 14 && p.x <= b.x + b.w + 14 && p.y >= b.y - 14 && p.y <= b.y + b.h + 14) {
        return key;
      }
    }
    return null;
  }

  // ---- Gelände ----------------------------------------------------------
  // Chunks werden mit 1 Pixel pro Sample gecacht und beim Zeichnen skaliert
  chunkCanvas(tier, cx, cy) {
    const key = tier + ':' + cx + ',' + cy;
    let c = this.chunks.get(key);
    if (c) return c;
    const { m, step } = TIERS[tier];
    const n = Math.round(m / step);
    c = document.createElement('canvas');
    c.width = n;
    c.height = n;
    const g = c.getContext('2d');
    const thr = this.terrain.threshold;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const wx = cx * m + (i + 0.5) * step;
        const wy = cy * m + (j + 0.5) * step;
        const h = this.terrain.height(wx, wy);
        let col = null;
        if (h > thr) {
          if (h < thr + 0.018) col = '#e8dcab';
          else if (h < thr + 0.07) col = '#8fbf6f';
          else if (h < thr + 0.15) col = '#5f9c4f';
          else col = '#47803e';
        } else if (h > thr - 0.035) {
          col = 'rgba(150,214,204,0.50)';
        } else if (h > thr - 0.085) {
          col = 'rgba(150,214,204,0.20)';
        }
        if (col) {
          g.fillStyle = col;
          g.fillRect(i, j, 1, 1);
        }
      }
    }
    this.chunks.set(key, c);
    if (this.chunks.size > 700) {
      this.chunks.delete(this.chunks.keys().next().value);
    }
    return c;
  }

  drawTerrain(cam) {
    const { ctx } = this;
    const S = SCALE * this.zoom;
    const tier = this.zoom < 0.3 ? 'coarse' : 'fine';
    const M = TIERS[tier].m;
    const sizePx = M * S;
    const x0 = Math.floor((cam.x - this.W / 2 / S) / M);
    const x1 = Math.floor((cam.x + this.W / 2 / S) / M);
    const y0 = Math.floor((cam.y - this.H / 2 / S) / M);
    const y1 = Math.floor((cam.y + this.H / 2 / S) / M);
    ctx.imageSmoothingEnabled = false;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const img = this.chunkCanvas(tier, cx, cy);
        const sx = (cx * M - cam.x) * S + this.W / 2;
        const sy = (cy * M - cam.y) * S + this.H / 2;
        ctx.drawImage(img, sx, sy, sizePx + 0.6, sizePx + 0.6);
      }
    }
    ctx.imageSmoothingEnabled = true;
  }

  // ---- Wasser -----------------------------------------------------------
  drawWater(cam, time) {
    const { ctx } = this;
    const S = SCALE * this.zoom;
    ctx.fillStyle = '#2e6fa3';
    ctx.fillRect(0, 0, this.W, this.H);
    // dezente Wellenringe auf einem Weltraster (bei Übersicht gröber)
    const cell = this.zoom < 0.5 ? 14 / (this.zoom * 2) : 14; // Meter
    const gx0 = Math.floor((cam.x - this.W / 2 / S) / cell);
    const gx1 = Math.floor((cam.x + this.W / 2 / S) / cell);
    const gy0 = Math.floor((cam.y - this.H / 2 / S) / cell);
    const gy1 = Math.floor((cam.y + this.H / 2 / S) / cell);
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const r = hashCell(gx, gy, 7777);
        if (r > 0.14) continue;
        const phase = (time * 0.25 + r * 40) % 1;
        const wx = (gx + 0.2 + r * 4) * cell;
        const wy = (gy + 0.3 + ((r * 977) % 1) * 0.5) * cell;
        const sx = (wx - cam.x) * S + this.W / 2;
        const sy = (wy - cam.y) * S + this.H / 2;
        const rad = (2 + phase * 14) * this.zoom;
        ctx.globalAlpha = 0.7 * (1 - phase);
        ctx.beginPath();
        ctx.arc(sx, sy, rad, Math.PI * 1.1, Math.PI * 1.75);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---- Windpartikel -----------------------------------------------------
  updateParticles(cam, wind, dt) {
    const S = SCALE * this.zoom;
    const halfW = this.W / 2 / S + 20;
    const halfH = this.H / 2 / S + 20;
    const want = Math.min(130, Math.round(42 / this.zoom));
    while (this.particles.length < want) {
      this.particles.push({
        x: cam.x + (Math.random() * 2 - 1) * halfW,
        y: cam.y + (Math.random() * 2 - 1) * halfH,
      });
    }
    const wv = wind.vec();
    const { ctx } = this;
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1;
    const ux = wv.x / (wind.speed || 1), uy = wv.y / (wind.speed || 1);
    for (const p of this.particles) {
      p.x += wv.x * dt * 1.1;
      p.y += wv.y * dt * 1.1;
      if (p.x < cam.x - halfW || p.x > cam.x + halfW || p.y < cam.y - halfH || p.y > cam.y + halfH) {
        // gegen den Wind versetzt neu einsetzen
        p.x = cam.x + (Math.random() * 2 - 1) * halfW - ux * halfW * 0.9;
        p.y = cam.y + (Math.random() * 2 - 1) * halfH - uy * halfH * 0.9;
        continue;
      }
      const sx = (p.x - cam.x) * S + this.W / 2;
      const sy = (p.y - cam.y) * S + this.H / 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx - ux * 3 * S * 0.6, sy - uy * 3 * S * 0.6);
      ctx.stroke();
    }
  }

  // ---- Kielwasser -------------------------------------------------------
  updateWake(boat, dt) {
    this.wakeTimer -= dt;
    const spd = Math.hypot(boat.vx, boat.vy);
    if (this.wakeTimer <= 0 && spd > 0.6) {
      const f = dirVec(boat.heading);
      this.wake.push({ x: boat.x - f.x * 2.6, y: boat.y - f.y * 2.6, t: 0 });
      this.wakeTimer = 0.09;
    }
    for (const w of this.wake) w.t += dt;
    while (this.wake.length && this.wake[0].t > 3.5) this.wake.shift();
  }

  drawWake(cam) {
    const { ctx } = this;
    const S = SCALE * this.zoom;
    for (const w of this.wake) {
      const a = 0.14 * (1 - w.t / 3.5);
      if (a <= 0) continue;
      const sx = (w.x - cam.x) * S + this.W / 2;
      const sy = (w.y - cam.y) * S + this.H / 2;
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(sx, sy, (1.5 + w.t * 1.6) * this.zoom, 0, TAU);
      ctx.fill();
    }
  }

  // ---- Boot -------------------------------------------------------------
  drawBoat(boat, time) {
    const { ctx } = this;
    const type = boat.type;
    // Zeichnung ist für ein 5,5-m-Boot modelliert; andere Typen skalieren
    const k = type.lengthM / 5.5;
    const beamFactor = type.beamM / (2.0 * k);
    ctx.save();
    ctx.translate(this.W / 2, this.H / 2);
    ctx.scale(SCALE * this.zoom * k, SCALE * this.zoom * k);
    ctx.rotate(boat.heading);
    ctx.lineJoin = 'round';

    // Krängung: Rigg wandert optisch nach Lee, Rumpf wirkt schmaler
    const heelOff = Math.sin(boat.heel) * 0.7; // Meter nach Steuerbord
    const bw = (1 - 0.16 * Math.abs(Math.sin(boat.heel))) * beamFactor;

    // Rumpf je nach Bauart
    if (type.hullStyle === 'cat') {
      this.drawCatHull(type);
    } else if (type.hullStyle === 'raft') {
      this.drawRaftHull(type);
    } else {
      ctx.save();
      ctx.scale(bw, 1);
      ctx.beginPath();
      ctx.moveTo(0, -2.9);
      ctx.quadraticCurveTo(1.05, -1.4, 0.95, 0.6);
      ctx.quadraticCurveTo(0.9, 1.9, 0.62, 2.5);
      ctx.lineTo(-0.62, 2.5);
      ctx.quadraticCurveTo(-0.9, 1.9, -0.95, 0.6);
      ctx.quadraticCurveTo(-1.05, -1.4, 0, -2.9);
      ctx.closePath();
      ctx.fillStyle = type.hullColor;
      ctx.fill();
      ctx.lineWidth = 0.1;
      ctx.strokeStyle = type.trimColor;
      ctx.stroke();
      // Deckslinie
      ctx.beginPath();
      ctx.moveTo(0, -2.4);
      ctx.quadraticCurveTo(0.72, -1.2, 0.66, 0.6);
      ctx.quadraticCurveTo(0.62, 1.7, 0.42, 2.2);
      ctx.lineTo(-0.42, 2.2);
      ctx.quadraticCurveTo(-0.62, 1.7, -0.66, 0.6);
      ctx.quadraticCurveTo(-0.72, -1.2, 0, -2.4);
      ctx.closePath();
      ctx.fillStyle = type.deckColor;
      ctx.fill();
      ctx.restore();
    }

    // Ruderblatt am Heck (schlägt zur Kurvenseite aus)
    const ra = boat.rudder * 0.6;
    ctx.strokeStyle = '#5b3a1e';
    ctx.lineWidth = 0.12;
    ctx.beginPath();
    ctx.moveTo(0, 2.45);
    ctx.lineTo(Math.sin(ra) * 0.8, 2.45 + Math.cos(ra) * 0.8);
    ctx.stroke();

    // Rigg-Geometrie je Bauart (Zeichnungseinheiten eines 5,5-m-Boots)
    const rig = type.hullStyle === 'raft'
      ? { mastY: -0.2, boom: 2.2, jibTackY: 0, jib: 0, spi: 0 }
      : type.hullStyle === 'cat'
        ? { mastY: -0.5, boom: 2.8, jibTackY: -2.6, jib: 2.0, spi: 3.2 }
        : { mastY: -0.6, boom: 3.0, jibTackY: -2.8, jib: 2.3, spi: 3.4 };

    // Spinnaker: großer bunter Ballon vor dem Bug, wächst mit dem Setzgrad
    if (type.spi && boat.spiHoist > 0.08) {
      const st = { x: heelOff * 0.3, y: rig.jibTackY - 0.1 };
      const sl = rig.spi * (0.35 + 0.65 * boat.spiHoist);
      const sEnd = {
        x: st.x - Math.sin(boat.spiBoom) * sl,
        y: st.y + Math.cos(boat.spiBoom) * sl,
      };
      ctx.save();
      if (boat.spiEff < 0.3) ctx.globalAlpha = 0.55; // eingefallen
      this.drawSail(
        st, sEnd,
        boat.spiEff > 0.3 ? Math.sign(boat.spiBoom || 1) * 1.1 : 0,
        boat.apparentSpd, time, 1.9 * boat.spiHoist, '#ff6b6b',
      );
      ctx.restore();
    }

    // Vorsegel (Fock): Hals am Bug, Schothorn je nach Stellung
    if (type.sails.length > 1) {
      const tack = { x: heelOff * 0.35, y: rig.jibTackY };
      const jl = rig.jib;
      const jEnd = {
        x: tack.x - Math.sin(boat.jibBoom) * jl,
        y: tack.y + Math.cos(boat.jibBoom) * jl,
      };
      this.drawSail(tack, jEnd, boat.aoaJib, boat.apparentSpd, time, 0.65);
    }

    // Großsegel am Mast
    const mast = { x: heelOff * 0.6, y: rig.mastY };
    const bl = rig.boom;
    const bEnd = {
      x: mast.x - Math.sin(boat.boom) * bl,
      y: mast.y + Math.cos(boat.boom) * bl,
    };
    // Baum
    ctx.strokeStyle = '#6b4a2b';
    ctx.lineWidth = 0.14;
    ctx.beginPath();
    ctx.moveTo(mast.x, mast.y);
    ctx.lineTo(bEnd.x, bEnd.y);
    ctx.stroke();
    this.drawSail(
      mast, bEnd, boat.aoaMain, boat.apparentSpd, time, 1.0,
      type.hullStyle === 'raft' ? 'rgba(214,198,160,0.96)' : undefined,
    );

    // Mast
    ctx.fillStyle = '#3d3d3d';
    ctx.beginPath();
    ctx.arc(mast.x, mast.y, 0.14, 0, TAU);
    ctx.fill();

    ctx.restore();
  }

  // Katamaran: zwei schlanke Rümpfe mit Trampolin
  drawCatHull(type) {
    const { ctx } = this;
    // Trampolin
    ctx.fillStyle = 'rgba(30,42,54,0.85)';
    ctx.fillRect(-1.0, -1.3, 2.0, 3.0);
    // Querträger
    ctx.fillStyle = type.deckColor;
    ctx.fillRect(-1.15, -1.35, 2.3, 0.28);
    ctx.fillRect(-1.15, 1.45, 2.3, 0.28);
    for (const side of [-1, 1]) {
      const hx = side * 1.05;
      ctx.beginPath();
      ctx.moveTo(hx, -2.75);
      ctx.quadraticCurveTo(hx + 0.3, -1.6, hx + 0.26, 0.4);
      ctx.quadraticCurveTo(hx + 0.24, 1.8, hx + 0.18, 2.4);
      ctx.lineTo(hx - 0.18, 2.4);
      ctx.quadraticCurveTo(hx - 0.24, 1.8, hx - 0.26, 0.4);
      ctx.quadraticCurveTo(hx - 0.3, -1.6, hx, -2.75);
      ctx.closePath();
      ctx.fillStyle = type.hullColor;
      ctx.fill();
      ctx.lineWidth = 0.08;
      ctx.strokeStyle = type.trimColor;
      ctx.stroke();
    }
  }

  // Floß: Baumstämme mit Tauwerk
  drawRaftHull(type) {
    const { ctx } = this;
    for (let i = -2; i <= 2; i++) {
      const x = i * 0.5;
      ctx.fillStyle = i % 2 === 0 ? type.hullColor : type.deckColor;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x - 0.22, -1.8, 0.44, 3.6, 0.2);
      else ctx.rect(x - 0.22, -1.8, 0.44, 3.6);
      ctx.fill();
      ctx.lineWidth = 0.05;
      ctx.strokeStyle = type.trimColor;
      ctx.stroke();
    }
    // Zurrgurte
    ctx.strokeStyle = 'rgba(60,42,24,0.9)';
    ctx.lineWidth = 0.12;
    for (const y of [-1.2, 1.1]) {
      ctx.beginPath();
      ctx.moveTo(-1.25, y);
      ctx.lineTo(1.25, y);
      ctx.stroke();
    }
  }

  // Segeltuch als gewölbte Fläche zwischen zwei Punkten
  drawSail(a, b, aoa, apparent, time, bulgeScale, fill = 'rgba(255,255,255,0.96)') {
    const { ctx } = this;
    const dx = b.x - a.x, dy = b.y - a.y;
    // Normale des Baums (nach Lee zeigt die Wölbung)
    const nx = -dy, ny = dx;
    const nl = Math.hypot(nx, ny) || 1;
    let camber = Math.sin(clamp(aoa, -1.3, 1.3)) * 0.85 * bulgeScale;
    if (Math.abs(aoa) < 0.06 && apparent > 1.5) {
      // Segel killt: Flattern
      camber = Math.sin(time * 22) * 0.14 * bulgeScale;
    }
    const cx = (a.x + b.x) / 2 + (nx / nl) * camber;
    const cy = (a.y + b.y) / 2 + (ny / nl) * camber;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(cx, cy, b.x, b.y);
    ctx.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2, a.x, a.y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 0.09;
    ctx.strokeStyle = 'rgba(70,80,90,0.9)';
    ctx.stroke();
  }

  // Vektoranzeige am Boot: Wind, scheinbarer Wind, Fahrt, Vortrieb, Drift
  screenArrow(dx, dy, color, label) {
    const { ctx } = this;
    const len = Math.hypot(dx, dy);
    if (len < 8) return;
    const cx = this.W / 2, cy = this.H / 2;
    const ux = dx / len, uy = dy / len;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + dx, cy + dy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + dx + ux * 9, cy + dy + uy * 9);
    ctx.lineTo(cx + dx - uy * 5, cy + dy + ux * 5);
    ctx.lineTo(cx + dx + uy * 5, cy + dy - ux * 5);
    ctx.closePath();
    ctx.fill();
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(label, cx + dx + ux * 22, cy + dy + uy * 22 + 4);
  }

  drawVectors(boat, wind) {
    if (!this.showVectors) return;
    const { ctx } = this;
    ctx.save();
    const cap = (x, m) => clamp(x, -m, m);
    // wahrer Wind (Vektor, wohin er weht)
    const wv = wind.vec();
    this.screenArrow(wv.x * 8, wv.y * 8, '#ff7a5c', 'Wind');
    // scheinbarer Wind
    const af = dirVec(boat.apparentFrom + Math.PI);
    this.screenArrow(af.x * boat.apparentSpd * 8, af.y * boat.apparentSpd * 8, '#6fd6ff', 'scheinb. Wind');
    // Fahrt über Grund
    this.screenArrow(boat.vx * 16, boat.vy * 16, '#7dff9a', 'Fahrt');
    // Vortrieb (Segelkraft längsschiffs) und Drift (Querfahrt)
    const f = dirVec(boat.heading);
    const lat = rotCW(f);
    const drive = boat.aeroFx * f.x + boat.aeroFy * f.y;
    const dl = cap(drive * 0.12, 130);
    this.screenArrow(f.x * dl, f.y * dl, '#ffd166', 'Vortrieb');
    const vLat = boat.vx * lat.x + boat.vy * lat.y;
    const ll = cap(vLat * 60, 120);
    this.screenArrow(lat.x * ll, lat.y * ll, '#ff9ff3', 'Drift');
    ctx.restore();
  }

  // ---- Windrose & HUD ---------------------------------------------------
  drawRose(wind, boat) {
    const { ctx } = this;
    const { x, y, r } = this.rose;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = 'rgba(8,25,42,0.55)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lab = ['N', 'O', 'S', 'W'];
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      ctx.fillText(lab[i], x + Math.sin(a) * (r - 11), y - Math.cos(a) * (r - 11));
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 + Math.PI / 8;
      ctx.beginPath();
      ctx.moveTo(x + Math.sin(a) * (r - 6), y - Math.cos(a) * (r - 6));
      ctx.lineTo(x + Math.sin(a) * (r - 12), y - Math.cos(a) * (r - 12));
      ctx.stroke();
    }

    // wahrer Wind (rot): Pfeil von der Herkunftsrichtung zur Mitte
    this.roseArrow(wind.dirFrom, r - 8, 26, '#ff7a5c', 3);
    // scheinbarer Wind (cyan)
    if (boat.apparentSpd > 0.3) {
      this.roseArrow(boat.apparentFrom, r - 22, 18, '#6fd6ff', 2);
    }
    // Kurs (weißer Punkt am Rand)
    const hd = dirVec(boat.heading);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(x + hd.x * (r - 5), y + hd.y * (r - 5), 2.5, 0, TAU);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(Math.round(wind.speed * MS_TO_KN) + ' kn Wind', x, y + r + 14);
    ctx.restore();
  }

  roseArrow(dirFrom, rOut, len, color, width) {
    const { ctx } = this;
    const { x, y } = this.rose;
    const d = dirVec(dirFrom);
    const x1 = x + d.x * rOut, y1 = y + d.y * rOut;
    const x2 = x + d.x * (rOut - len), y2 = y + d.y * (rOut - len);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    // Pfeilspitze zeigt mit dem Wind (zur Mitte)
    const px = -d.y, py = d.x;
    ctx.beginPath();
    ctx.moveTo(x2 - d.x * 7, y2 - d.y * 7);
    ctx.lineTo(x2 + px * 4 + d.x * 2, y2 + py * 4 + d.y * 2);
    ctx.lineTo(x2 - px * 4 + d.x * 2, y2 - py * 4 + d.y * 2);
    ctx.closePath();
    ctx.fill();
  }

  pointOfSail(wind, boat) {
    const a = Math.abs(normAngle(wind.dirFrom - boat.heading));
    if (a < 0.62) return 'Im Wind – kein Vortrieb!';
    if (a < 1.13) return 'Am Wind';
    if (a < 1.83) return 'Halbwind';
    if (a < 2.62) return 'Raumschots';
    return 'Vor dem Wind';
  }

  drawHUD(boat, wind) {
    const { ctx } = this;
    ctx.save();
    // Geschwindigkeit
    ctx.fillStyle = 'rgba(8,25,42,0.5)';
    this.roundRect(14, this.H - 78, 128, 64, 10);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.fillText(boat.speedKn.toFixed(1) + ' kn', 26, this.H - 46);
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(this.pointOfSail(wind, boat), 26, this.H - 26);

    // Regler rechts: Spi (setzen/bergen), Fock- und Großschot, direkt anfassbar
    const bh = 130, bwd = 18;
    const offscreen = { x: -9999, y: -9999, w: 0, h: 0 };
    const bars = [];
    if (boat.type.spi) {
      bars.push({ key: 'spi', label: 'Spi', color: '#ff8fa3', trim: boat.spiHoist });
    } else {
      this.trimBars.spi = offscreen;
    }
    if (boat.type.sails.length > 1) {
      bars.push({ key: 'jib', label: 'Fock', color: '#8fe3a1', trim: boat.trimJib });
    } else {
      this.trimBars.jib = offscreen;
    }
    bars.push({ key: 'main', label: 'Groß', color: '#6fd6ff', trim: boat.trimMain });
    const panelW = 16 + bars.length * 48;
    const px0 = this.W - panelW - 12;
    const by = this.H - 200;
    ctx.fillStyle = 'rgba(8,25,42,0.5)';
    this.roundRect(px0, by - 30, panelW, bh + 64, 10);
    ctx.fill();
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    bars.forEach((b, i) => {
      const bx = px0 + 24 + i * 48 - bwd / 2;
      this.trimBars[b.key] = { x: bx, y: by, w: bwd, h: bh };
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, bwd, bh);
      ctx.fillStyle = b.color;
      const fh = bh * b.trim;
      ctx.fillRect(bx, by + bh - fh, bwd, fh);
      // Griff
      ctx.fillStyle = '#fff';
      ctx.fillRect(bx - 3, by + bh - fh - 2, bwd + 6, 4);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(b.label, bx + bwd / 2, by + bh + 16);
    });
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('dicht · oben', px0 + panelW / 2, by - 16);
    ctx.fillText('offen · unten', px0 + panelW / 2, by + bh + 30);

    // Ruder-Schieber links über dem Tacho (anfassbar; loslassen = mittschiffs)
    const rb = { x: 14, y: this.H - 122, w: 170, h: 28 };
    this.rudderBar = rb;
    const rcx = rb.x + rb.w / 2, rcy = rb.y + rb.h / 2;
    ctx.fillStyle = 'rgba(8,25,42,0.5)';
    this.roundRect(rb.x, rb.y, rb.w, rb.h, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rb.x + 10, rcy);
    ctx.lineTo(rb.x + rb.w - 10, rcy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(rcx, rb.y + 5);
    ctx.lineTo(rcx, rb.y + rb.h - 5);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Ruder', rb.x + 5, rb.y - 7);
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.arc(rcx + boat.rudder * (rb.w / 2 - 14), rcy, 9, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // ---- Regatta ----------------------------------------------------------
  toScreen(p, cam) {
    const S = SCALE * this.zoom;
    return {
      x: (p.x - cam.x) * S + this.W / 2,
      y: (p.y - cam.y) * S + this.H / 2,
    };
  }

  drawBuoy(s, color, label) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 7, 0, TAU);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    if (label) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, s.x, s.y);
    }
  }

  drawRaceWorld(race, cam, boat, time) {
    if (race.state === 'idle') return;
    const { ctx } = this;
    ctx.save();
    // Start-/Ziellinie
    const a = this.toScreen(race.line.a, cam);
    const b = this.toScreen(race.line.b, cam);
    ctx.setLineDash([9, 7]);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    this.drawBuoy(a, '#ff8c42', null);
    this.drawBuoy(b, '#ff8c42', null);

    // Bahnmarken
    race.marks.forEach((m, i) => {
      const s = this.toScreen(m, cam);
      const passed = race.state === 'running' && i < race.nextIdx;
      this.drawBuoy(s, passed ? '#5fae62' : '#ff5c33', String(i + 1));
    });

    // Ziele: Ring ums aktuelle, Randpfeile für alle ausstehenden
    const targets = race.overlayTargets();
    for (const tgt of targets) {
      const s = this.toScreen(tgt, cam);
      if (tgt.primary) {
        const isLine = tgt.label === 'Start' || tgt.label === 'Ziel';
        const rad = (isLine ? 26 : MARK_RADIUS) * SCALE * this.zoom * (1 + 0.05 * Math.sin(time * 3));
        ctx.beginPath();
        ctx.arc(s.x, s.y, rad, 0, TAU);
        ctx.strokeStyle = 'rgba(255,220,120,0.45)';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      this.drawRaceArrow(tgt, s, boat);
    }
    ctx.restore();
  }

  // Randposition für ein Ziel außerhalb des Sichtfelds
  edgePoint(s, margin) {
    const cx = this.W / 2, cy = this.H / 2;
    const dx = s.x - cx, dy = s.y - cy;
    const kx = dx !== 0 ? (this.W / 2 - margin) / Math.abs(dx) : Infinity;
    const ky = dy !== 0 ? (this.H / 2 - margin) / Math.abs(dy) : Infinity;
    const kk = Math.min(kx, ky);
    return { x: cx + dx * kk, y: cy + dy * kk, ang: Math.atan2(dy, dx) };
  }

  // Hinweis am Bildschirmrand: großer Pfeil fürs nächste Ziel,
  // nummerierte Punkte für die weiteren
  drawRaceArrow(tgt, s, boat) {
    const { ctx } = this;
    const margin = 56;
    const inside = s.x > margin && s.x < this.W - margin && s.y > margin && s.y < this.H - margin;
    if (inside) {
      if (tgt.primary) {
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(tgt.label, s.x, s.y - 22);
      }
      return; // Boje selbst ist sichtbar (und nummeriert)
    }
    const e = this.edgePoint(s, margin);
    if (tgt.primary) {
      const distM = Math.round(Math.hypot(tgt.x - boat.x, tgt.y - boat.y));
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.ang);
      ctx.fillStyle = 'rgba(255,220,120,0.95)';
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.lineTo(-6, -9);
      ctx.lineTo(-6, 9);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const tx = clamp(e.x, 70, this.W - 70);
      const ty = clamp(e.y + (e.y < this.H / 2 ? 26 : -14), 20, this.H - 8);
      ctx.fillText(`${tgt.label} · ${distM} m`, tx, ty);
    } else {
      // kleines nummeriertes Scheibchen für spätere Ziele
      ctx.save();
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.arc(e.x, e.y, 11, 0, TAU);
      ctx.fillStyle = 'rgba(8,25,42,0.8)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tgt.label === 'Ziel' ? '🏁' : tgt.label, e.x, e.y);
      ctx.restore();
    }
  }

  // halbtransparentes Geisterboot der Bestzeit
  drawGhost(race, cam) {
    if (race.state !== 'running') return;
    const p = race.ghostAt(race.t);
    if (!p) return;
    const { ctx } = this;
    const s = this.toScreen(p, cam);
    const k = (p.len || 5.5) / 5.5;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.scale(SCALE * this.zoom * k, SCALE * this.zoom * k);
    ctx.rotate(p.h);
    ctx.globalAlpha = p.finished ? 0.25 : 0.45;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -2.9);
    ctx.quadraticCurveTo(1.05, -1.4, 0.95, 0.6);
    ctx.quadraticCurveTo(0.9, 1.9, 0.62, 2.5);
    ctx.lineTo(-0.62, 2.5);
    ctx.quadraticCurveTo(-0.9, 1.9, -0.95, 0.6);
    ctx.quadraticCurveTo(-1.05, -1.4, 0, -2.9);
    ctx.closePath();
    ctx.fillStyle = '#bfe9ff';
    ctx.fill();
    ctx.lineWidth = 0.12;
    ctx.strokeStyle = '#eaf7ff';
    ctx.stroke();
    // Baum als Andeutung des Segels
    ctx.beginPath();
    ctx.moveTo(0, -0.6);
    ctx.lineTo(-Math.sin(p.b) * 3, -0.6 + Math.cos(p.b) * 3);
    ctx.lineWidth = 0.18;
    ctx.strokeStyle = '#9fd8f5';
    ctx.stroke();
    ctx.restore();
    // Beschriftung
    ctx.fillStyle = 'rgba(190,230,255,0.8)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('Geist', s.x, s.y - 3.4 * SCALE * this.zoom * k - 4);
  }

  drawRacePanel(race) {
    if (race.state === 'idle') return;
    const { ctx } = this;
    const w = 240, h = 52;
    // die Toolbar ist nur noch der Menü-Knopf; nur auf sehr schmalen
    // Screens muss das Panel unter die Windrose ausweichen
    const x = this.W / 2 - w / 2;
    const y = this.W < 520 ? this.rose.y + this.rose.r + 26 : 10;
    ctx.save();
    ctx.fillStyle = 'rgba(8,25,42,0.6)';
    this.roundRect(x, y, w, h, 10);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 20px system-ui, sans-serif';
    let line1, line2;
    if (race.state === 'armed') {
      line1 = '0:00.0';
      line2 = 'Über die Startlinie!';
    } else if (race.state === 'running') {
      line1 = formatTime(race.t);
      line2 = race.penaltyFlash > 0
        ? '+10 s Strafe (Grundberührung)'
        : race.nextIdx < race.marks.length
          ? `Nächste: Boje ${race.nextIdx + 1} von ${race.marks.length}`
          : 'Zurück zur Ziellinie!';
    } else {
      line1 = `🏁 ${formatTime(race.t)}`;
      line2 = race.isNewBest ? 'Neue Bestzeit!' : `Bestzeit: ${formatTime(race.best)}`;
    }
    ctx.fillText(line1, this.W / 2, y + 24);
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle =
      race.state === 'running' && race.penaltyFlash > 0 ? '#ff9a8a' :
      race.state === 'finished' && race.isNewBest ? '#ffd166' :
      'rgba(255,255,255,0.85)';
    ctx.fillText(line2, this.W / 2, y + 42);
    ctx.restore();
  }

  roundRect(x, y, w, h, r) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---- Hauptzeichnung ---------------------------------------------------
  draw(boat, wind, race, time, dt) {
    const cam = { x: boat.x, y: boat.y };
    this.drawWater(cam, time);
    this.drawTerrain(cam);
    this.updateWake(boat, dt);
    this.drawWake(cam);
    this.drawRaceWorld(race, cam, boat, time);
    this.updateParticles(cam, wind, dt);
    this.drawGhost(race, cam);
    this.drawBoat(boat, time);
    if (this.zoom < 0.25) {
      // Übersicht: Markierungsring, damit man das winzige Boot findet
      const { ctx } = this;
      ctx.beginPath();
      ctx.arc(this.W / 2, this.H / 2, 14, 0, TAU);
      ctx.strokeStyle = 'rgba(255,255,255,0.65)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    this.drawVectors(boat, wind);
    this.drawRose(wind, boat);
    this.drawHUD(boat, wind);
    this.drawRacePanel(race);
  }
}

export { SCALE };
