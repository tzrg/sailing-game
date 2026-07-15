// Bootsphysik: scheinbarer Wind, Auftrieb/Widerstand an Groß- und Vorsegel,
// Rumpfwiderstand längs/quer (Kielwirkung -> wenig Abdrift), Ruderdrehung.
// Modell angelehnt an übliche vereinfachte Segelphysik:
//   Lift  L = 0.5 * rho * A * CL(alpha) * v_app^2   (senkrecht zur Anströmung)
//   Drag  D = 0.5 * rho * A * CD(alpha) * v_app^2   (in Anströmrichtung)
// mit CL ~ sin(2*alpha) (Strömungsabriss inklusive) und CD ~ CD0 + k*sin^2(alpha).

import { clamp, lerp, normAngle, dirVec, angleOf, rotCW, MS_TO_KN } from './util.js';

const RHO_AIR = 1.225;

// Bootstypen; weitere Typen können hier einfach ergänzt werden.
export const BOAT_TYPES = {
  jolle: {
    key: 'jolle',
    name: 'Jolle',
    lengthM: 5.5,
    beamM: 2.0,
    mass: 260,               // kg inkl. Crew
    sails: [
      { kind: 'main', area: 9.5, cl: 1.5, cd0: 0.06, cdMax: 1.5 },
      { kind: 'jib',  area: 4.2, cl: 1.7, cd0: 0.05, cdMax: 1.3 },
    ],
    dragFwdLin: 10,          // Rumpfwiderstand längs (linear + quadratisch)
    dragFwdQuad: 26,
    dragLatLin: 90,          // Querwiderstand (Kiel/Schwert) -> geringe Abdrift
    dragLatQuad: 480,
    maxTurnRate: 1.15,       // rad/s bei Fahrt
    minSheet: 0.14,          // dichteste Schotstellung (~8°)
    maxSheet: 1.48,          // ganz gefiert (~85°)
    heelStiffness: 1100,     // N pro voller Krängung (kleiner = kippliger)
    turnLoss: 0.35,          // Fahrtverlust beim Drehen
    spi: { area: 13, cl: 1.1, cd0: 0.12, cdMax: 1.9 },
    hullStyle: 'mono',
    hullColor: '#f3eddd',
    deckColor: '#d8b878',
    trimColor: '#7a4a24',
  },
  kielboot: {
    key: 'kielboot',
    name: 'Kielboot',
    lengthM: 8.0,
    beamM: 2.5,
    mass: 1500,
    sails: [
      { kind: 'main', area: 15, cl: 1.5, cd0: 0.05, cdMax: 1.5 },
      { kind: 'jib',  area: 9,  cl: 1.7, cd0: 0.045, cdMax: 1.3 },
    ],
    dragFwdLin: 18,
    dragFwdQuad: 40,
    dragLatLin: 300,         // richtiger Kiel: sehr wenig Abdrift
    dragLatQuad: 1600,
    maxTurnRate: 0.7,        // träger als die Jolle
    minSheet: 0.10,          // läuft etwas höher am Wind
    maxSheet: 1.48,
    heelStiffness: 3800,     // Ballastkiel: deutlich steifer
    turnLoss: 0.35,
    spi: { area: 24, cl: 1.1, cd0: 0.12, cdMax: 1.9 },
    hullStyle: 'mono',
    hullColor: '#f4f6f8',
    deckColor: '#9fb4c8',
    trimColor: '#26425e',
  },
  katamaran: {
    key: 'katamaran',
    name: 'Katamaran',
    lengthM: 6.1,
    beamM: 2.5,
    mass: 190,               // federleicht
    sails: [
      { kind: 'main', area: 15, cl: 1.6, cd0: 0.05, cdMax: 1.5 },
      { kind: 'jib',  area: 4,  cl: 1.7, cd0: 0.05, cdMax: 1.3 },
    ],
    dragFwdLin: 6,           // kaum benetzte Fläche -> rennt
    dragFwdQuad: 12,
    dragLatLin: 110,
    dragLatQuad: 520,
    maxTurnRate: 0.55,       // wendet nur widerwillig ...
    turnLoss: 2.2,           // ... und verliert dabei massiv Fahrt
    minSheet: 0.12,
    maxSheet: 1.48,
    heelStiffness: 2600,     // breite Basis, steif
    spi: { area: 17, cl: 1.1, cd0: 0.12, cdMax: 1.9 },
    hullStyle: 'cat',
    hullColor: '#fff8e8',
    deckColor: '#2f3d4a',
    trimColor: '#e2574c',
  },
  floss: {
    key: 'floss',
    name: 'Floß',
    lengthM: 4.0,
    beamM: 2.6,
    mass: 420,               // nasse Baumstämme
    sails: [
      // ein schlaffer Lappen am Ast: kaum Auftrieb, geht praktisch nicht an den Wind
      { kind: 'main', area: 8, cl: 0.5, cd0: 0.18, cdMax: 1.6 },
    ],
    dragFwdLin: 60,          // schiebt eine Bugwelle wie ein Scheunentor
    dragFwdQuad: 200,
    dragLatLin: 25,          // kein Kiel, kein Schwert -> driftet quer weg
    dragLatQuad: 60,
    maxTurnRate: 0.4,
    turnLoss: 1.0,
    minSheet: 0.35,          // die "Schot" ist ein alter Strick
    maxSheet: 1.48,
    heelStiffness: 99999,    // krängen kann es wenigstens nicht
    hullStyle: 'raft',
    hullColor: '#8a5a33',
    deckColor: '#7a4e2b',
    trimColor: '#5b3a1e',
  },
};

export class Wind {
  constructor() {
    this.dirFrom = Math.PI * 0.25; // Wind kommt aus Nordost
    this.speed = 6;                // m/s
    this.baseDir = this.dirFrom;
    this.baseSpeed = this.speed;
    this.wander = true;
    this.t = Math.random() * 1000;
  }

  // Windvektor (wohin der Wind weht), m/s
  vec() {
    const d = this.dirFrom + Math.PI;
    return { x: Math.sin(d) * this.speed, y: -Math.cos(d) * this.speed };
  }

  set(dirFrom, speed) {
    this.baseDir = this.dirFrom = dirFrom;
    if (speed != null) this.baseSpeed = this.speed = speed;
  }

  update(dt) {
    this.t += dt;
    if (this.wander) {
      this.dirFrom = this.baseDir
        + 0.35 * Math.sin(this.t * 0.045)
        + 0.16 * Math.sin(this.t * 0.021 + 2.1);
      this.speed = this.baseSpeed * (1 + 0.18 * Math.sin(this.t * 0.09 + 1) + 0.07 * Math.sin(this.t * 0.31));
    } else {
      this.dirFrom = this.baseDir;
      this.speed = this.baseSpeed;
    }
  }
}

export class Boat {
  constructor(type) {
    this.type = type;
    this.reset(0);
  }

  reset(heading) {
    this.x = 0;
    this.y = 0;
    this.heading = heading;
    this.vx = 0;
    this.vy = 0;
    this.angVel = 0;
    this.rudder = 0;      // -1..1
    this.trimMain = 0.45; // Großschot: 0 = ganz gefiert, 1 = dicht geholt
    this.trimJib = 0.45;  // Fockschot
    this.boom = 0;        // Baumwinkel Groß (Bootskoordinaten, + = Backbord)
    this.jibBoom = 0;
    this.aoaMain = 0;
    this.aoaJib = 0;
    this.heel = 0;     // visuelle Krängung (rad)
    this.apparentSpd = 0;
    this.apparentFrom = 0;
    this.spi = false;      // Spinnaker gesetzt?
    this.spiBoom = 0;
    this.spiEff = 0;       // 0 = eingefallen, 1 = voll stehend
    this.spiHoistT = 0;    // Hysterese-Timer für Auto-Spi
    this.spiDouseT = 0;
    this.autoTrim = false; // Schoten automatisch trimmen
    this.aeroFx = 0;       // Segel-Gesamtkraft (für Vektoranzeige)
    this.aeroFy = 0;
  }

  get speedKn() {
    return Math.hypot(this.vx, this.vy) * MS_TO_KN;
  }

  // Bootstyp wechseln, Fahrtzustand bleibt erhalten
  setType(type) {
    this.type = type;
    if (!type.spi) this.spi = false; // z. B. das Floß hat keinen Spinnaker
  }

  // Schotgrenze (max. Baumwinkel) aus Trimm 0..1
  sheetLimit(trim) {
    return lerp(this.type.maxSheet, this.type.minSheet, trim);
  }

  update(dt, wind) {
    const t = this.type;
    const wv = wind.vec();
    // scheinbarer Wind = wahrer Wind minus Fahrtwind
    const av = { x: wv.x - this.vx, y: wv.y - this.vy };
    const aspd = Math.hypot(av.x, av.y);
    this.apparentSpd = aspd;
    this.apparentFrom = normAngle(angleOf(av) + Math.PI);

    let FxA = 0, FyA = 0; // aerodynamische Kräfte
    if (aspd > 0.05) {
      const flowA = angleOf(av); // wohin die Luft strömt
      const fl = { x: av.x / aspd, y: av.y / aspd };
      const liftDir = rotCW(fl);

      // Autotrim: Baumwinkel ~ halber scheinbarer Windwinkel ergibt einen
      // Anstellwinkel nahe dem Optimum (~18-20°)
      if (this.autoTrim) {
        const bFreeAbs = Math.abs(normAngle(flowA - this.heading - Math.PI));
        const toTrim = (bDes) =>
          clamp((t.maxSheet - bDes) / (t.maxSheet - t.minSheet), 0, 1);
        const desM = toTrim(Math.max(0, bFreeAbs - 0.32));
        const desJ = toTrim(Math.max(0, bFreeAbs - 0.28));
        this.trimMain += (desM - this.trimMain) * Math.min(1, dt * 2.5);
        this.trimJib += (desJ - this.trimJib) * Math.min(1, dt * 2.5);
        // Auto-Spi: auf tiefen Kursen setzen, beim Anluven bergen (Hysterese)
        if (t.spi) {
          if (!this.spi && bFreeAbs > 1.45) {
            this.spiHoistT += dt;
            if (this.spiHoistT > 1.5) { this.spi = true; this.spiHoistT = 0; }
          } else {
            this.spiHoistT = 0;
          }
          if (this.spi && bFreeAbs < 1.1) {
            this.spiDouseT += dt;
            if (this.spiDouseT > 1.0) { this.spi = false; this.spiDouseT = 0; }
          } else {
            this.spiDouseT = 0;
          }
        }
      }

      for (let i = 0; i < t.sails.length; i++) {
        const s = t.sails[i];
        // Segel stellt sich frei in den Wind, die Schot begrenzt den Winkel
        let bFree = normAngle(flowA - this.heading - Math.PI);
        if (Math.PI - Math.abs(bFree) < 0.4) {
          // vor dem Wind: Baumseite beibehalten, kein Flackern beim Halsen
          const prev = i === 0 ? this.boom : this.jibBoom;
          if (prev !== 0) bFree = Math.sign(prev) * Math.abs(bFree);
        }
        const lim = this.sheetLimit(i === 0 ? this.trimMain : this.trimJib);
        const b = clamp(bFree, -lim, lim);
        const aoa = normAngle(bFree - b); // Anstellwinkel (signiert); 0 = Segel killt
        if (i === 0) { this.boom = b; this.aoaMain = aoa; }
        else { this.jibBoom = b; this.aoaJib = aoa; }

        const q = 0.5 * RHO_AIR * s.area * aspd * aspd;
        const CL = s.cl * Math.sin(2 * aoa);
        const sa = Math.sin(Math.abs(aoa));
        const CD = s.cd0 + s.cdMax * sa * sa;
        FxA += q * (CL * liftDir.x + CD * fl.x);
        FyA += q * (CL * liftDir.y + CD * fl.y);
      }

      // Spinnaker: steht nur auf tiefen Kursen, trimmt sich selbst
      this.spiEff = 0;
      if (this.spi && t.spi) {
        let bFree = normAngle(flowA - this.heading - Math.PI);
        if (Math.PI - Math.abs(bFree) < 0.4 && this.spiBoom !== 0) {
          bFree = Math.sign(this.spiBoom) * Math.abs(bFree);
        }
        const eff = clamp((Math.abs(bFree) - 1.15) / 0.45, 0, 1);
        this.spiEff = eff;
        const b = clamp(bFree, -1.5, 1.5);
        this.spiBoom = b;
        if (eff > 0) {
          const s = t.spi;
          const aoa = normAngle(bFree - b);
          const q = 0.5 * RHO_AIR * s.area * aspd * aspd * eff;
          const CL = s.cl * Math.sin(2 * aoa);
          const sa = Math.sin(Math.abs(aoa));
          const CD = s.cd0 + s.cdMax * sa * sa;
          FxA += q * (CL * liftDir.x + CD * fl.x);
          FyA += q * (CL * liftDir.y + CD * fl.y);
        }
      }
    }
    this.aeroFx = FxA;
    this.aeroFy = FyA;

    // Rumpfkräfte in Bootskoordinaten
    const f = dirVec(this.heading);
    const lat = rotCW(f); // Steuerbord
    const vF = this.vx * f.x + this.vy * f.y;
    const vL = this.vx * lat.x + this.vy * lat.y;
    const dragF = -(t.dragFwdLin * vF + t.dragFwdQuad * vF * Math.abs(vF));
    const dragL = -(t.dragLatLin * vL + t.dragLatQuad * vL * Math.abs(vL));

    const Fx = FxA + dragF * f.x + dragL * lat.x;
    const Fy = FyA + dragF * f.y + dragL * lat.y;
    this.vx += (Fx / t.mass) * dt;
    this.vy += (Fy / t.mass) * dt;

    // Drehen: Ruderwirkung wächst mit Fahrt durchs Wasser.
    // Mindest-Grip, damit das Ruder auch bei Stillstand/Rückwärtsdrift
    // in die erwartete Richtung anspricht (kein Umkehreffekt).
    const grip = clamp(Math.abs(vF) / 1.5, 0.3, 1);
    const target = this.rudder * t.maxTurnRate * grip;
    this.angVel += (target - this.angVel) * Math.min(1, dt * 5);
    this.heading = normAngle(this.heading + this.angVel * dt);
    // Drehen kostet Fahrt (Katamaran besonders viel -> Wenden will geplant sein)
    const scrub = 1 - clamp(Math.abs(this.angVel) * (t.turnLoss ?? 0.35) * dt, 0, 0.15);
    this.vx *= scrub;
    this.vy *= scrub;

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Krängung (rein visuell) aus der Querkomponente der Segelkraft
    const latAero = FxA * lat.x + FyA * lat.y;
    const heelTarget = clamp(latAero / t.heelStiffness, -1, 1) * 0.5;
    this.heel += (heelTarget - this.heel) * Math.min(1, dt * 2.5);
  }
}
