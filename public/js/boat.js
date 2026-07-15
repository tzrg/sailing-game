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
    hullColor: '#f4f6f8',
    deckColor: '#9fb4c8',
    trimColor: '#26425e',
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
  }

  get speedKn() {
    return Math.hypot(this.vx, this.vy) * MS_TO_KN;
  }

  // Bootstyp wechseln, Fahrtzustand bleibt erhalten
  setType(type) {
    this.type = type;
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
    }

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

    // Drehen: Ruderwirkung wächst mit Fahrt durchs Wasser
    const grip = clamp(Math.abs(vF) / 1.5, 0, 1) * (vF >= 0 ? 1 : -1);
    const target = this.rudder * t.maxTurnRate * grip;
    this.angVel += (target - this.angVel) * Math.min(1, dt * 5);
    this.heading = normAngle(this.heading + this.angVel * dt);
    // Drehen kostet etwas Fahrt
    const scrub = 1 - clamp(Math.abs(this.angVel) * 0.35 * dt, 0, 0.08);
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
