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
      { kind: 'main', ctl: 'main', area: 9.5, cl: 1.5, cd0: 0.06, cdMax: 1.5 },
      { kind: 'jib',  ctl: 'jib',  area: 4.2, cl: 1.7, cd0: 0.05, cdMax: 1.3 },
    ],
    dragFwdLin: 10,          // Rumpfwiderstand längs (linear + quadratisch)
    dragFwdQuad: 26,
    dragLatLin: 90,          // Querwiderstand (Kiel/Schwert) -> geringe Abdrift
    dragLatQuad: 480,
    maxTurnRate: 1.15,       // rad/s bei Fahrt
    minSheet: 0.14,          // dichteste Schotstellung (~8°)
    maxSheet: 1.48,          // ganz gefiert (~85°)
    heelStiffness: 1100,     // N pro voller Krängung (kleiner = kippliger)
    capsizeHeel: 0.62,       // ab dieser Krängung (rad) kentert die Jolle
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
      { kind: 'main', ctl: 'main', area: 15, cl: 1.5, cd0: 0.05, cdMax: 1.5 },
      { kind: 'jib',  ctl: 'jib',  area: 9,  cl: 1.7, cd0: 0.045, cdMax: 1.3 },
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
      { kind: 'main', ctl: 'main', area: 15, cl: 1.6, cd0: 0.05, cdMax: 1.5 },
      { kind: 'jib',  ctl: 'jib',  area: 4,  cl: 1.7, cd0: 0.05, cdMax: 1.3 },
    ],
    dragFwdLin: 6,           // kaum benetzte Fläche -> rennt
    dragFwdQuad: 12,
    dragLatLin: 110,
    dragLatQuad: 520,
    maxTurnRate: 0.55,       // wendet nur widerwillig ...
    turnLoss: 2.2,           // ... und verliert dabei massiv Fahrt
    minSheet: 0.12,
    maxSheet: 1.48,
    heelStiffness: 1600,     // breite Basis, aber bei Überpower kippt er
    capsizeHeel: 0.55,
    spi: { area: 17, cl: 1.1, cd0: 0.12, cdMax: 1.9 },
    hullStyle: 'cat',
    hullColor: '#fff8e8',
    deckColor: '#2f3d4a',
    trimColor: '#e2574c',
  },
  moth: {
    key: 'moth',
    name: 'Moth (Foiler)',
    lengthM: 3.4,
    beamM: 1.6,
    mass: 75,                // Boot + Segler, federleicht
    sails: [
      // nur ein Großsegel, kein Vorsegel
      { kind: 'main', ctl: 'main', area: 8, cl: 1.8, cd0: 0.04, cdMax: 1.4 },
    ],
    dragFwdLin: 14,
    dragFwdQuad: 38,
    dragLatLin: 70,
    dragLatQuad: 380,
    maxTurnRate: 1.5,
    turnLoss: 1.0,
    minSheet: 0.12,
    maxSheet: 1.48,
    heelStiffness: 300,      // extrem kipplig ...
    capsizeHeel: 0.42,       // ... und kentert sehr früh
    // Foils: ab ~2 kn hebt der Rumpf aus dem Wasser, ab ~3,2 kn fliegt er
    // ganz - der Widerstand bricht auf 15% ein (im Flug ~18 kn möglich).
    // balanceLat: so viel Querkraft braucht die Balance beim Foilen.
    // Überlebensfenster ~[50, 550] N: Schot lose/killend -> Kenterung nach
    // Luv, überpowert -> nach Lee
    foils: { liftKn: 2, fullKn: 3.2, dragFactor: 0.15, balanceLat: 300 },
    hullStyle: 'mono',
    hullColor: '#e8f4f8',
    deckColor: '#3a4d5c',
    trimColor: '#d4574e',
  },
  pirat: {
    key: 'pirat',
    name: 'Piratenschiff',
    lengthM: 45,
    beamM: 10,
    mass: 120000,
    // Rahsegel: die Rah steht quer zum Schiff und wird über Brassen gedreht.
    // Trim 0 (offen) = vierkant (Rah quer, Position vor dem Wind),
    // Trim 1 (dicht) = scharf angebrasst (~55 Grad, für halben Wind).
    // Physik: Flächen-Normalkraft (flat plate) - hoch am Wind geht fast
    // nichts, raume Kurse sind das Revier des Dreimasters.
    // JEDES Segel wird einzeln gebrasst (perSailTrim): 3 Masten x 3 Rahen
    // plus zwei Vorsegel - manuell herrlich nervig, Autotrim hilft.
    perSailTrim: true,
    sailLabels: ['F1', 'F2', 'F3', 'G1', 'G2', 'G3', 'B1', 'B2', 'B3', 'V1', 'V2'],
    sails: [
      { kind: 'square', ctl: 'main', area: 95, cn: 1.3 },
      { kind: 'square', ctl: 'main', area: 70, cn: 1.3 },
      { kind: 'square', ctl: 'main', area: 45, cn: 1.3 },
      { kind: 'square', ctl: 'main', area: 95, cn: 1.3 },
      { kind: 'square', ctl: 'main', area: 70, cn: 1.3 },
      { kind: 'square', ctl: 'main', area: 45, cn: 1.3 },
      { kind: 'square', ctl: 'main', area: 95, cn: 1.3 },
      { kind: 'square', ctl: 'main', area: 70, cn: 1.3 },
      { kind: 'square', ctl: 'main', area: 45, cn: 1.3 },
      { kind: 'jib',    ctl: 'jib',  area: 60, cl: 1.3, cd0: 0.06, cdMax: 1.4 },
      { kind: 'jib',    ctl: 'jib',  area: 60, cl: 1.3, cd0: 0.06, cdMax: 1.4 },
    ],
    braceMax: 0.96, // max. Brasswinkel (~55 Grad von vierkant)
    // Breitseite statt Spinnaker
    cannons: { perSide: 3, range: 170, speed: 55, cooldown: 4 },
    dragFwdLin: 400,
    dragFwdQuad: 780,
    dragLatLin: 4000,
    dragLatQuad: 30000,
    maxTurnRate: 0.28,       // dreht wie ein Möbelwagen
    turnLoss: 0.4,
    minSheet: 0.14,
    maxSheet: 1.48,
    heelStiffness: 50000,    // Ballast ohne Ende
    mainLabel: 'Rahen',
    jibLabel: 'Vor',
    hullStyle: 'ship',
    hullColor: '#6b4226',
    deckColor: '#9c6b3f',
    trimColor: '#3e2715',
  },
  floss: {
    key: 'floss',
    name: 'Floß',
    lengthM: 4.0,
    beamM: 2.6,
    mass: 420,               // nasse Baumstämme
    sails: [
      // ein schlaffer Lappen am Ast: kaum Auftrieb, geht praktisch nicht an den Wind
      { kind: 'main', ctl: 'main', area: 8, cl: 0.5, cd0: 0.18, cdMax: 1.6 },
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
    this.initSailArrays();
    this.cannonCd = 0;    // Nachladezeit der Kanonen
    this.boom = 0;        // Baumwinkel Groß (Bootskoordinaten, + = Backbord)
    this.jibBoom = 0;
    this.aoaMain = 0;
    this.aoaJib = 0;
    this.heel = 0;     // Krängung (rad)
    this.capsized = false;
    this.capsizeT = 0;
    this.capsizeSide = 1;
    this.foilLevel = 0; // 0 = im Wasser, 1 = voll auf den Foils
    this.apparentSpd = 0;
    this.apparentFrom = 0;
    this.spiHoist = 0;     // Spinnaker 0 = geborgen .. 1 = voll gesetzt
    this.spiTarget = 0;    // Zielwert des Auto-Spi (Hysterese)
    this.spiBoom = 0;
    this.spiEff = 0;       // 0 = eingefallen, 1 = voll stehend
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
    if (!type.spi) { // z. B. das Floß hat keinen Spinnaker
      this.spiHoist = 0;
      this.spiTarget = 0;
    }
    this.initSailArrays();
  }

  initSailArrays() {
    // Einzeltrimm (Piratenschiff): ein Trimmwert je Segel
    this.sailTrims = this.type.perSailTrim
      ? this.type.sails.map(() => 0.45)
      : null;
    this.sailBooms = this.type.sails.map(() => 0);
    this.sailAoas = this.type.sails.map(() => 0);
  }

  // Schotgrenze (max. Baumwinkel) aus Trimm 0..1
  sheetLimit(trim) {
    return lerp(this.type.maxSheet, this.type.minSheet, trim);
  }

  update(dt, wind) {
    const t = this.type;
    if (this.cannonCd > 0) this.cannonCd = Math.max(0, this.cannonCd - dt);

    // gekentert: treiben, keine Segelkräfte, bis aufgerichtet wird
    if (this.capsized) {
      const damp = Math.max(0, 1 - dt * 1.5);
      this.vx *= damp;
      this.vy *= damp;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.angVel = 0;
      const target = this.capsizeSide * 1.35;
      this.heel += (target - this.heel) * Math.min(1, dt * 3);
      this.spiHoist = 0;
      this.spiTarget = 0;
      this.spiEff = 0;
      return;
    }

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
        if (this.sailTrims) {
          // Einzeltrimm: die Crew trimmt jedes Segel für sich.
          // Rahsegel: optimaler Brasswinkel = halber Anströmwinkel
          const psiAbs = Math.abs(normAngle(flowA - this.heading));
          const desSq = clamp((psiAbs / 2) / (t.braceMax ?? 0.96), 0, 1);
          for (let i = 0; i < t.sails.length; i++) {
            const s = t.sails[i];
            const des = s.kind === 'square' ? desSq : s.ctl === 'jib' ? desJ : desM;
            this.sailTrims[i] += (des - this.sailTrims[i]) * Math.min(1, dt * 2.5);
          }
        }
        this.trimMain += (desM - this.trimMain) * Math.min(1, dt * 2.5);
        this.trimJib += (desJ - this.trimJib) * Math.min(1, dt * 2.5);
        // Auto-Spi: auf tiefen Kursen setzen, beim Anluven bergen.
        // Totband zwischen den Schwellen = Hysterese, sanftes Durchziehen.
        if (t.spi) {
          if (bFreeAbs > 1.45) this.spiTarget = 1;
          else if (bFreeAbs < 1.1) this.spiTarget = 0;
          this.spiHoist += (this.spiTarget - this.spiHoist) * Math.min(1, dt * 0.7);
        }
      }

      let mainSet = false, jibSet = false;
      for (let i = 0; i < t.sails.length; i++) {
        const s = t.sails[i];
        const isJib = s.ctl === 'jib';

        if (s.kind === 'square') {
          // Rahsegel: Rah quer zum Schiff, per Brassen um beta gedreht.
          // Optimal ist beta ~ halber Winkel zwischen Anströmung und Kurs;
          // die Kraft wirkt als Normalkraft auf die Segelfläche (flat plate),
          // rückwärtige Anströmung legt das Segel back.
          const braceMax = t.braceMax ?? 0.96;
          const psi = normAngle(flowA - this.heading); // Anströmung relativ zum Bug
          const trim = this.sailTrims ? this.sailTrims[i] : this.trimMain;
          // Brass-Seite folgt der Anströmung; genau vor dem Wind Seite halten
          const side = Math.abs(psi) > 0.05
            ? Math.sign(psi)
            : Math.sign(this.sailBooms[i]) || 1;
          const beta = side * trim * braceMax;
          const nAng = this.heading + Math.PI + beta; // Flächennormale (achterlich)
          const nx = Math.sin(nAng), ny = -Math.cos(nAng);
          const fn = fl.x * nx + fl.y * ny; // Anströmung senkrecht zur Fläche
          this.sailBooms[i] = beta;
          this.sailAoas[i] = fn; // Vorzeichen = Wölbungsseite, ~0 = killt
          if (!mainSet) { this.boom = beta; this.aoaMain = fn; mainSet = true; }
          const q = 0.5 * RHO_AIR * s.area * aspd * aspd;
          FxA += q * s.cn * fn * nx;
          FyA += q * s.cn * fn * ny;
          continue;
        }

        // Segel stellt sich frei in den Wind, die Schot begrenzt den Winkel
        let bFree = normAngle(flowA - this.heading - Math.PI);
        if (Math.PI - Math.abs(bFree) < 0.4) {
          // vor dem Wind: Baumseite beibehalten, kein Flackern beim Halsen
          const prev = this.sailBooms[i] || (isJib ? this.jibBoom : this.boom);
          if (prev !== 0) bFree = Math.sign(prev) * Math.abs(bFree);
        }
        const trim = this.sailTrims
          ? this.sailTrims[i]
          : isJib ? this.trimJib : this.trimMain;
        let lim = this.sheetLimit(trim);
        if (s.maxB) lim = Math.min(lim, s.maxB); // Rahen lassen sich nur begrenzt brassen
        let b = clamp(bFree, -lim, lim);
        if (s.minB && Math.abs(b) < s.minB) {
          // Rahsegel können nicht in die Mittschiffslinie gedreht werden
          b = (b !== 0 ? Math.sign(b) : bFree >= 0 ? 1 : -1) * s.minB;
        }
        const aoa = normAngle(bFree - b); // Anstellwinkel (signiert); 0 = Segel killt
        this.sailBooms[i] = b;
        this.sailAoas[i] = aoa;
        if (!isJib && !mainSet) { this.boom = b; this.aoaMain = aoa; mainSet = true; }
        if (isJib && !jibSet) { this.jibBoom = b; this.aoaJib = aoa; jibSet = true; }

        const q = 0.5 * RHO_AIR * s.area * aspd * aspd;
        const CL = s.cl * Math.sin(2 * aoa);
        const sa = Math.sin(Math.abs(aoa));
        const CD = s.cd0 + s.cdMax * sa * sa;
        FxA += q * (CL * liftDir.x + CD * fl.x);
        FyA += q * (CL * liftDir.y + CD * fl.y);
      }

      // Spinnaker: steht nur auf tiefen Kursen, trimmt sich selbst
      this.spiEff = 0;
      if (t.spi && this.spiHoist > 0.03) {
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
          // wirksame Fläche wächst mit dem Setzgrad
          const q = 0.5 * RHO_AIR * s.area * this.spiHoist * aspd * aspd * eff;
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
    // Foils: über der Abhebe-Geschwindigkeit steigt der Rumpf aus dem
    // Wasser, der Längswiderstand bricht ein
    let dragScale = 1;
    if (t.foils) {
      const kn = Math.hypot(this.vx, this.vy) * MS_TO_KN;
      this.foilLevel = clamp((kn - t.foils.liftKn) / (t.foils.fullKn - t.foils.liftKn), 0, 1);
      dragScale = 1 - (1 - t.foils.dragFactor) * this.foilLevel;
    } else {
      this.foilLevel = 0;
    }
    const dragF = -(t.dragFwdLin * vF + t.dragFwdQuad * vF * Math.abs(vF)) * dragScale;
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

    // Krängung aus der Querkomponente der Segelkraft. Beim Foilen braucht
    // die Balance eine Mindest-Querkraft: zu wenig Druck (Schot zu lose,
    // Segel killt) kippt das Boot nach Luv!
    const latAero = FxA * lat.x + FyA * lat.y;
    let effLat = latAero;
    if (t.foils && this.foilLevel > 0) {
      const side = latAero !== 0 ? Math.sign(latAero) : -Math.sign(this.boom || 1);
      effLat = latAero - t.foils.balanceLat * this.foilLevel * side;
    }
    const heelDes = clamp((effLat / t.heelStiffness) * 0.5, -1.2, 1.2);
    this.heel += (heelDes - this.heel) * Math.min(1, dt * (t.foils ? 4 : 2.5));

    // Kentern: zu lange zu stark gekrängt -> Boot liegt flach
    if (t.capsizeHeel) {
      if (Math.abs(this.heel) > t.capsizeHeel) {
        this.capsizeT += dt;
        if (this.capsizeT > 0.35) {
          this.capsized = true;
          this.capsizeSide = Math.sign(this.heel) || 1;
          this.capsizeT = 0;
        }
      } else {
        this.capsizeT = Math.max(0, this.capsizeT - dt * 2);
      }
    }
  }
}
