// Rendering: Wasser mit Wellen-Glitzern, gecachte Gelände-Chunks,
// Boot mit Segeln, Windpartikel, Windrose und HUD.

import { clamp, normAngle, dirVec, angleOf, MS_TO_KN, TAU } from './util.js';

const SCALE = 8;        // Pixel pro Meter
const CHUNK_M = 48;     // Kantenlänge eines Gelände-Chunks in Metern
const CHUNK_PX = CHUNK_M * SCALE;
const SAMPLE_M = 0.5;   // Abtastung innerhalb eines Chunks
const SAMPLE_PX = SAMPLE_M * SCALE;

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

  // ---- Gelände ----------------------------------------------------------
  chunkCanvas(cx, cy) {
    const key = cx + ',' + cy;
    let c = this.chunks.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = CHUNK_PX;
    c.height = CHUNK_PX;
    const g = c.getContext('2d');
    const thr = this.terrain.threshold;
    const n = Math.round(CHUNK_M / SAMPLE_M);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const wx = cx * CHUNK_M + (i + 0.5) * SAMPLE_M;
        const wy = cy * CHUNK_M + (j + 0.5) * SAMPLE_M;
        const h = this.terrain.height(wx, wy);
        let col = null;
        let overlap = 0.5; // vermeidet Haarlinien zwischen deckenden Kacheln
        if (h > thr) {
          if (h < thr + 0.018) col = '#e8dcab';
          else if (h < thr + 0.07) col = '#8fbf6f';
          else if (h < thr + 0.15) col = '#5f9c4f';
          else col = '#47803e';
        } else if (h > thr - 0.035) {
          col = 'rgba(150,214,204,0.50)';
          overlap = 0; // transparente Kacheln nicht überlappen (Gittermuster)
        } else if (h > thr - 0.085) {
          col = 'rgba(150,214,204,0.20)';
          overlap = 0;
        }
        if (col) {
          g.fillStyle = col;
          g.fillRect(i * SAMPLE_PX, j * SAMPLE_PX, SAMPLE_PX + overlap, SAMPLE_PX + overlap);
        }
      }
    }
    this.chunks.set(key, c);
    if (this.chunks.size > 240) {
      this.chunks.delete(this.chunks.keys().next().value);
    }
    return c;
  }

  drawTerrain(cam) {
    const { ctx } = this;
    const x0 = Math.floor((cam.x - this.W / 2 / SCALE) / CHUNK_M);
    const x1 = Math.floor((cam.x + this.W / 2 / SCALE) / CHUNK_M);
    const y0 = Math.floor((cam.y - this.H / 2 / SCALE) / CHUNK_M);
    const y1 = Math.floor((cam.y + this.H / 2 / SCALE) / CHUNK_M);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const img = this.chunkCanvas(cx, cy);
        const sx = Math.floor((cx * CHUNK_M - cam.x) * SCALE + this.W / 2);
        const sy = Math.floor((cy * CHUNK_M - cam.y) * SCALE + this.H / 2);
        ctx.drawImage(img, sx, sy);
      }
    }
  }

  // ---- Wasser -----------------------------------------------------------
  drawWater(cam, time) {
    const { ctx } = this;
    ctx.fillStyle = '#2e6fa3';
    ctx.fillRect(0, 0, this.W, this.H);
    // dezente Wellenringe auf einem Weltraster
    const cell = 14; // Meter
    const gx0 = Math.floor((cam.x - this.W / 2 / SCALE) / cell);
    const gx1 = Math.floor((cam.x + this.W / 2 / SCALE) / cell);
    const gy0 = Math.floor((cam.y - this.H / 2 / SCALE) / cell);
    const gy1 = Math.floor((cam.y + this.H / 2 / SCALE) / cell);
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const r = hashCell(gx, gy, 7777);
        if (r > 0.14) continue;
        const phase = (time * 0.25 + r * 40) % 1;
        const wx = (gx + 0.2 + r * 4) * cell;
        const wy = (gy + 0.3 + ((r * 977) % 1) * 0.5) * cell;
        const sx = (wx - cam.x) * SCALE + this.W / 2;
        const sy = (wy - cam.y) * SCALE + this.H / 2;
        const rad = 2 + phase * 14;
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
    const halfW = this.W / 2 / SCALE + 20;
    const halfH = this.H / 2 / SCALE + 20;
    while (this.particles.length < 42) {
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
      const sx = (p.x - cam.x) * SCALE + this.W / 2;
      const sy = (p.y - cam.y) * SCALE + this.H / 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx - ux * 3 * SCALE * 0.6, sy - uy * 3 * SCALE * 0.6);
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
    for (const w of this.wake) {
      const a = 0.14 * (1 - w.t / 3.5);
      if (a <= 0) continue;
      const sx = (w.x - cam.x) * SCALE + this.W / 2;
      const sy = (w.y - cam.y) * SCALE + this.H / 2;
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(sx, sy, 1.5 + w.t * 1.6, 0, TAU);
      ctx.fill();
    }
  }

  // ---- Boot -------------------------------------------------------------
  drawBoat(boat, time) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(this.W / 2, this.H / 2);
    ctx.scale(SCALE, SCALE);
    ctx.rotate(boat.heading);
    ctx.lineJoin = 'round';

    // Krängung: Rigg wandert optisch nach Lee, Rumpf wirkt schmaler
    const heelOff = Math.sin(boat.heel) * 0.7; // Meter nach Steuerbord
    const bw = 1 - 0.16 * Math.abs(Math.sin(boat.heel));

    // Rumpf
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
    ctx.fillStyle = '#f3eddd';
    ctx.fill();
    ctx.lineWidth = 0.1;
    ctx.strokeStyle = '#7a4a24';
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
    ctx.fillStyle = '#d8b878';
    ctx.fill();
    ctx.restore();

    // Pinne
    const ra = boat.rudder * 0.6;
    ctx.strokeStyle = '#5b3a1e';
    ctx.lineWidth = 0.12;
    ctx.beginPath();
    ctx.moveTo(0, 2.45);
    ctx.lineTo(Math.sin(-ra) * 0.8, 2.45 + Math.cos(ra) * 0.8);
    ctx.stroke();

    // Vorsegel (Fock): Hals am Bug, Schothorn je nach Stellung
    const tack = { x: heelOff * 0.35, y: -2.8 };
    const jl = 2.3;
    const jEnd = {
      x: tack.x - Math.sin(boat.jibBoom) * jl,
      y: tack.y + Math.cos(boat.jibBoom) * jl,
    };
    this.drawSail(tack, jEnd, boat.aoaJib, boat.apparentSpd, time, 0.65);

    // Großsegel am Mast
    const mast = { x: heelOff * 0.6, y: -0.6 };
    const bl = 3.0;
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
    this.drawSail(mast, bEnd, boat.aoaMain, boat.apparentSpd, time, 1.0);

    // Mast
    ctx.fillStyle = '#3d3d3d';
    ctx.beginPath();
    ctx.arc(mast.x, mast.y, 0.14, 0, TAU);
    ctx.fill();

    ctx.restore();
  }

  // Segeltuch als gewölbte Fläche zwischen zwei Punkten
  drawSail(a, b, aoa, apparent, time, bulgeScale) {
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
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.fill();
    ctx.lineWidth = 0.09;
    ctx.strokeStyle = 'rgba(70,80,90,0.9)';
    ctx.stroke();
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

    // Schot-Anzeige rechts
    const bx = this.W - 46, by = this.H - 190, bh = 150, bwd = 16;
    ctx.fillStyle = 'rgba(8,25,42,0.5)';
    this.roundRect(bx - 10, by - 26, 56, bh + 52, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, bwd, bh);
    ctx.fillStyle = '#6fd6ff';
    const fh = bh * boat.trim;
    ctx.fillRect(bx, by + bh - fh, bwd, fh);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('dicht', bx + bwd / 2, by - 10);
    ctx.fillText('Schot', bx + bwd / 2, by + bh + 16);
    ctx.fillText('offen', bx + bwd / 2, by + bh + 30);

    // Ruderanzeige unten Mitte
    const rw = 150, rx = this.W / 2 - rw / 2, ry = this.H - 30;
    ctx.fillStyle = 'rgba(8,25,42,0.5)';
    this.roundRect(rx - 10, ry - 12, rw + 20, 24, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    ctx.moveTo(rx, ry);
    ctx.lineTo(rx + rw, ry);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(this.W / 2, ry - 8);
    ctx.lineTo(this.W / 2, ry + 8);
    ctx.stroke();
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.arc(this.W / 2 + boat.rudder * rw / 2, ry, 6, 0, TAU);
    ctx.fill();
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
  draw(boat, wind, time, dt) {
    const cam = { x: boat.x, y: boat.y };
    this.drawWater(cam, time);
    this.drawTerrain(cam);
    this.updateWake(boat, dt);
    this.drawWake(cam);
    this.updateParticles(cam, wind, dt);
    this.drawBoat(boat, time);
    this.drawRose(wind, boat);
    this.drawHUD(boat, wind);
  }
}

export { SCALE };
