// Tower Defense – Monster laufen den Parcours entlang, Türme halten sie auf.
// Achtzehn Turmtypen mit Stufen und Spezialisierungen, Geld pro Abschuss,
// endlose Wellen. Die Kommandozentrale schaltet Nuke + Orbital-Laser frei.
// Kids-Modus: alle Türme werden zu Spielzeug (nur Optik, gleiche Werte).

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const TAU = Math.PI * 2;

// ---- Spielfeld & Parcours --------------------------------------------------
const GC = 12, GR = 17;   // Spalten x Zeilen
// Wegpunkte (Spalte, Zeile) – Schlangenlinie von links oben nach rechts unten
const WAYPOINTS = [[0, 2], [9, 2], [9, 5], [2, 5], [2, 8], [9, 8], [9, 11], [2, 11], [2, 14], [11, 14]];
let PATH = [];            // Liste aller Pfadkacheln in Laufrichtung
const pathSet = new Set();
(function buildPath() {
  for (let i = 0; i < WAYPOINTS.length - 1; i++) {
    let [x, y] = WAYPOINTS[i];
    const [tx, ty] = WAYPOINTS[i + 1];
    while (x !== tx || y !== ty) {
      if (!PATH.length || PATH[PATH.length - 1][0] !== x || PATH[PATH.length - 1][1] !== y) PATH.push([x, y]);
      x += Math.sign(tx - x); y += Math.sign(ty - y);
    }
  }
  PATH.push(WAYPOINTS[WAYPOINTS.length - 1]);
  for (const [x, y] of PATH) pathSet.add(x + ',' + y);
})();
const isPath = (x, y) => pathSet.has(x + ',' + y);

// Teiche (hübsch anzusehen, nicht bebaubar)
const POND = new Set(['0,0', '1,0', '0,1', '11,16', '10,16', '11,15', '11,0']);
const isPond = (x, y) => POND.has(x + ',' + y);

// deterministischer Hash pro Kachel für die Deko (Grasbüschel, Blumen, Steine …)
function tileHash(x, y) { return ((x * 73856093) ^ (y * 19349663)) >>> 0; }

// ---- Türme -----------------------------------------------------------------
// levels[i]: cost = Kosten für Bau (i=0) bzw. Upgrade. dmg/rate für Schüsse,
// dps für Dauerstrahler, slow für Aura. range in Kacheln.
const TOWERS = {
  mg: { name: 'MG', icon: '🔫', color: '#8fa3b8', desc: 'schnell, Einzelziel; Spezialmunition wählbar',
    levels: [
      { cost: 45, dmg: 6, rate: 4.5, range: 2.4 },
      { cost: 55, dmg: 11, rate: 5.5, range: 2.6 },
      { cost: 100, dmg: 19, rate: 6.5, range: 2.9 },
      { cost: 1000, dmg: 45, rate: 8, range: 3.3 }] },
  cannon: { name: 'Kanone', icon: '🎯', color: '#7a8a6a', desc: 'Kinetik: viel Schaden, weit, knackt Panzerung',
    levels: [
      { cost: 125, dmg: 85, rate: 0.5, range: 4.2 },
      { cost: 135, dmg: 160, rate: 0.55, range: 4.5 },
      { cost: 245, dmg: 300, rate: 0.6, range: 4.8 },
      { cost: 1800, dmg: 700, rate: 0.7, range: 5.4 }] },
  grenade: { name: 'Granatkanone', icon: '💣', color: '#c9a15a', desc: 'Flächenschaden (prallt an Panzerung ab)',
    levels: [
      { cost: 80, dmg: 22, rate: 0.9, range: 2.6, splash: 1.15 },
      { cost: 90, dmg: 40, rate: 1.0, range: 2.9, splash: 1.3 },
      { cost: 160, dmg: 75, rate: 1.15, range: 3.2, splash: 1.5 },
      { cost: 1500, dmg: 180, rate: 1.3, range: 3.6, splash: 1.9 }] },
  laser: { name: 'Laser', icon: '📡', color: '#e06fd8', desc: 'durchbohrt Linie UND Panzerung',
    levels: [
      { cost: 110, dps: 20, range: 3.4 },
      { cost: 120, dps: 38, range: 3.7 },
      { cost: 210, dps: 70, range: 4.0 },
      { cost: 1600, dps: 170, range: 4.5 }] },
  flame: { name: 'Flammenwerfer', icon: '🔥', color: '#e0703a', desc: 'Umkreis + Brennschaden',
    levels: [
      { cost: 85, dps: 16, range: 1.9, burn: 5 },
      { cost: 95, dps: 30, range: 2.1, burn: 10 },
      { cost: 170, dps: 55, range: 2.3, burn: 18 },
      { cost: 1400, dps: 130, range: 2.7, burn: 40 }] },
  rocket: { name: 'Raketenturm', icon: '🚀', color: '#b04a4a', desc: 'zielsuchend, hoher Schaden',
    levels: [
      { cost: 130, dmg: 50, rate: 0.55, range: 3.6, splash: 0.9 },
      { cost: 140, dmg: 95, rate: 0.62, range: 3.9, splash: 1.05 },
      { cost: 240, dmg: 170, rate: 0.7, range: 4.2, splash: 1.2 },
      { cost: 1800, dmg: 400, rate: 0.8, range: 4.6, splash: 1.5 }] },
  ice: { name: 'Vereiser', icon: '❄️', color: '#6fc4e0', desc: 'verlangsamt im Umkreis',
    levels: [
      { cost: 55, slow: 0.35, range: 2.1 },
      { cost: 60, slow: 0.45, range: 2.4 },
      { cost: 110, slow: 0.55, range: 2.8 },
      { cost: 900, slow: 0.68, range: 3.3 }] },
  tesla: { name: 'Blitzturm', icon: '⚡', color: '#ffe66e', desc: 'Kettenblitz springt von Gegner zu Gegner',
    levels: [
      { cost: 120, dmg: 28, rate: 1.1, range: 2.7, chain: 3 },
      { cost: 130, dmg: 50, rate: 1.25, range: 3.0, chain: 4 },
      { cost: 230, dmg: 92, rate: 1.4, range: 3.3, chain: 6 },
      { cost: 1700, dmg: 210, rate: 1.6, range: 3.7, chain: 8 }] },
  ray: { name: 'Bestrahlungsturm', icon: '☣️', color: '#9ee06a', desc: 'Dauerstrahl-Kegel: verstrahlt statt zu schießen – Verstrahlung ignoriert Panzerung und bleibt für immer',
    levels: [
      { cost: 110, charge: 4, cap: 26, range: 2.3 },
      { cost: 120, charge: 7, cap: 48, range: 2.6 },
      { cost: 210, charge: 12, cap: 85, range: 2.9 },
      { cost: 1500, charge: 24, cap: 170, range: 3.3 }] },
  gift: { name: 'Giftschleuder', icon: '🧪', color: '#8ad84a', desc: 'hinterlässt ätzende Giftpfützen',
    levels: [
      { cost: 95, dps: 13, rate: 0.45, range: 3.0, pool: 0.95, dur: 4 },
      { cost: 105, dps: 25, rate: 0.5, range: 3.3, pool: 1.1, dur: 4.5 },
      { cost: 185, dps: 45, rate: 0.55, range: 3.6, pool: 1.25, dur: 5 },
      { cost: 1400, dps: 95, rate: 0.6, range: 4.0, pool: 1.45, dur: 5.5 }] },
  wind: { name: 'Windmaschine', icon: '🌪️', color: '#9fd8d0', desc: 'pustet den vordersten Gegner zurück – nie weiter, als er bis zum nächsten Stoß wieder aufholt',
    levels: [
      { cost: 100, rate: 0.18, range: 2.6 },
      { cost: 110, rate: 0.24, range: 2.9 },
      { cost: 200, rate: 0.3, range: 3.2 },
      { cost: 900, rate: 0.38, range: 3.6 }] },
  gold: { name: 'Goldmine', icon: '💰', color: '#d8b84a', desc: 'schürft stetig Gold (kein Schaden)',
    levels: [
      { cost: 100, gold: 2, interval: 3 },
      { cost: 120, gold: 4, interval: 3.1 },
      { cost: 220, gold: 7, interval: 3.2 },
      { cost: 1200, gold: 16, interval: 3.2 }] },
  loader: { name: 'Auto-Lader', icon: '⚙️', color: '#d8c56a', desc: 'passiv: MG, Kanone & Railgun auf Nachbarfeldern schießen deutlich schneller (der beste Lader daneben zählt)',
    levels: [
      { cost: 90, boost: 1.5 },
      { cost: 100, boost: 1.8 },
      { cost: 180, boost: 2.1 },
      { cost: 900, boost: 2.6 }] },
  improb: { name: 'Unwahrscheinlichkeitskanone', icon: '🎲', color: '#e08ad8', desc: 'verwandelt Gegner in eine zufällige andere Art – HP-Anteil bleibt, nur 1× pro Monster, Bosse sind immun',
    levels: [
      { cost: 140, rate: 0.25, range: 3.0 },
      { cost: 150, rate: 0.3, range: 3.3 },
      { cost: 260, rate: 0.35, range: 3.6 },
      { cost: 1300, rate: 0.5, range: 4.0 }] },
  railgun: { name: 'Railgun', icon: '🧲', color: '#7a9ac8', desc: 'Anti-Boss-Geschütz: durchschlägt Panzerung komplett, 3× Schaden an Bossen (trifft immer) – verfehlt kleine Gegner oft',
    levels: [
      { cost: 250, dmg: 180, rate: 0.35, range: 4.5, acc: 0.35 },
      { cost: 260, dmg: 340, rate: 0.4, range: 4.8, acc: 0.4 },
      { cost: 450, dmg: 620, rate: 0.45, range: 5.2, acc: 0.45 },
      { cost: 2000, dmg: 1400, rate: 0.5, range: 5.6, acc: 0.55 }] },
  hypno: { name: 'Hypnoseturm', icon: '🌀', color: '#c883e0', desc: 'hypnotisiert einen Gegner: der bleibt stehen und beißt die anderen (Bosse sind immun)',
    levels: [
      { cost: 160, dur: 4, factor: 0.05, range: 2.8 },
      { cost: 170, dur: 5, factor: 0.07, range: 3.1 },
      { cost: 300, dur: 6, factor: 0.09, range: 3.4 },
      { cost: 1600, dur: 8, factor: 0.13, range: 3.8 }] },
  tv: { name: 'Fernsehturm', icon: '📺', color: '#8ab8e0', desc: 'lenkt Gegner mit dem laufenden Programm ab: Zuschauer bleiben stehen, sind danach kurz immun (Bosse schauen nur kurz hin)',
    levels: [
      { cost: 120, dur: 1.6, aud: 2, range: 2.6 },
      { cost: 130, dur: 2.0, aud: 3, range: 2.9 },
      { cost: 230, dur: 2.5, aud: 4, range: 3.2 },
      { cost: 1500, dur: 3.4, aud: 6, range: 3.6 }] },
  command: { name: 'Kommandozentrale', icon: '🛰️', color: '#c0c8e8', desc: 'schaltet ☢️ Nuke + 🛰️ Orbital-Laser frei (je 1× pro Welle, gegen Bosse 3× und durch jede Panzerung) – endlos ausbaubar, jede Stufe teurer und stärker',
    levels: [
      { cost: 400, nuke: 340, beam: 600, brad: 1.25 },
      { cost: 300, nuke: 520, beam: 950, brad: 1.45 },
      { cost: 550, nuke: 780, beam: 1450, brad: 1.7 },
      { cost: 2500, nuke: 1400, beam: 2600, brad: 2.0 }] },
};

// ---- Spezialisierungen: exklusive Entweder-oder-Wahl pro Turm --------------
const AMMO_SPECS = [
  { key: 'fire', icon: '🔥', name: 'Brandmarkierer', cost: 90, desc: '+50% Feuerschaden auf Getroffene (4s)' },
  { key: 'shock', icon: '⚡', name: 'Ionisiert', cost: 90, desc: '+50% Blitzschaden auf Getroffene (4s)' },
  { key: 'tungsten', icon: '🔩', name: 'Wolframkern', cost: 90, desc: '+60% Schaden, extrem panzerbrechend' },
];
const SPECS = {
  mg: AMMO_SPECS,
  cannon: AMMO_SPECS.map((a) => ({ ...a, cost: 110 })),
  grenade: [
    { key: 'dmg', icon: '💥', name: 'Sprengkraft', cost: 110, desc: '+50% Schaden, größere Fläche', mod: (s) => { s.dmg *= 1.5; s.splash += 0.35; } },
    { key: 'range', icon: '🔭', name: 'Langrohr', cost: 110, desc: '+1,0 Reichweite', mod: (s) => { s.range += 1.0; } },
  ],
  rocket: [
    { key: 'dmg', icon: '💥', name: 'Gefechtskopf', cost: 130, desc: '+50% Schaden', mod: (s) => { s.dmg *= 1.5; } },
    { key: 'range', icon: '🔭', name: 'Booster', cost: 130, desc: '+1,0 Reichweite', mod: (s) => { s.range += 1.0; } },
    { key: 'tnuke', icon: '☢️', name: 'Taktische Nuke', cost: 1200, desc: 'Sprengkopf: 6× Schaden im Zentrum, nach außen stark abnehmend, Radius 2,3' },
  ],
  tesla: [
    { key: 'chain', icon: '🕸️', name: 'Mehr Ziele', cost: 120, desc: '+2 Kettenziele', mod: (s) => { s.chain += 2; } },
    { key: 'range', icon: '📡', name: 'Fernfunken', cost: 120, desc: '+0,9 Reichweite', mod: (s) => { s.range += 0.9; } },
  ],
  flame: [
    { key: 'wide', icon: '🌊', name: 'Breitmaul', cost: 100, desc: 'fast doppelt so breiter Feuerkegel', mod: (s) => { s.cone = 1.75; } },
    { key: 'range', icon: '🗼', name: 'Feuerlanze', cost: 100, desc: '+0,8 Reichweite', mod: (s) => { s.range += 0.8; } },
  ],
  gift: [
    { key: 'dur', icon: '⏳', name: 'Zähflüssig', cost: 100, desc: 'Pfützen halten 3 s länger', mod: (s) => { s.dur += 3; } },
    { key: 'pool', icon: '🫧', name: 'Große Pfützen', cost: 100, desc: '+40% Pfützenradius', mod: (s) => { s.pool *= 1.4; } },
  ],
  ray: [
    { key: 'charge', icon: '☢️', name: 'Zerfallsplus', cost: 120, desc: '+50% Verstrahlung & Limit', mod: (s) => { s.charge *= 1.5; s.cap = Math.round(s.cap * 1.5); } },
    { key: 'range', icon: '📡', name: 'Langstrahler', cost: 120, desc: '+0,8 Reichweite', mod: (s) => { s.range += 0.8; } },
  ],
  railgun: [
    { key: 'focus', icon: '🎯', name: 'Fokus', cost: 200, desc: 'zielsicher: trifft kleine Gegner zu 90%', mod: (s) => { s.acc = 0.9; } },
    { key: 'hyper', icon: '⚡', name: 'Hypercharge', cost: 200, desc: 'streut doppelt so stark, aber 6× Schaden an Bossen', mod: (s) => { s.acc *= 0.5; s.bossMul = 6; } },
  ],
  tv: [
    { key: 'binge', icon: '🍿', name: 'Serienmarathon', cost: 130, desc: '+1,2 s Programm', mod: (s) => { s.dur += 1.2; } },
    { key: 'big', icon: '🖥️', name: 'Großbildleinwand', cost: 130, desc: '+2 Zuschauerplätze, +0,5 Reichweite', mod: (s) => { s.aud += 2; s.range += 0.5; } },
  ],
};
// Effektive Werte inkl. gewählter Spezialisierung
function effStats(t) {
  const s = { ...towerStats(t) };
  if (t.type === 'flame') s.cone = 0.95;   // Grundkegel (~110°)
  if (t.type === 'ray') s.cone = 0.55;     // schmaler Strahlenkegel (~63°)
  if (t.type === 'railgun') s.bossMul = 3; // Grundbonus gegen Bosse
  const spec = t.spec && (SPECS[t.type] || []).find((o) => o.key === t.spec);
  if (spec && spec.mod) spec.mod(s);
  // Auto-Lader: der beste ⚙️ auf einem der 8 Nachbarfelder beschleunigt
  // MG, Kanone und Railgun
  if ((t.type === 'mg' || t.type === 'cannon' || t.type === 'railgun') && s.rate) {
    let boost = 1;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const n = towerAt[(t.x + dx) + ',' + (t.y + dy)];
        if (n && n.type === 'loader') boost = Math.max(boost, towerStats(n).boost);
      }
    }
    if (boost > 1) { s.rate = Math.round(s.rate * boost * 100) / 100; s.boosted = boost; }
  }
  return s;
}

// ---- Schwierigkeitsgrade ---------------------------------------------------
const DIFFS = {
  leicht: { label: 'Leicht', hpMul: 0.8, growth: 1.16, lives: 20, money: 140 },
  normal: { label: 'Normal', hpMul: 1.0, growth: 1.18, lives: 15, money: 120 },
  schwer: { label: 'Schwer', hpMul: 1.3, growth: 1.2, lives: 10, money: 100 },
};
let DIFF = DIFFS.normal;

// ---- Zustand ---------------------------------------------------------------
const game = {
  money: 120, lives: 15, wave: 0, best: 0,
  state: 'build',       // build | wave | over
  speed: 1, nextT: 0,   // Countdown bis Auto-Start der nächsten Welle
  toSpawn: [], spawnT: 0,
  sel: null,            // gewählte Kachel {x,y}
  banner: '', bannerT: 0,
  nukeUsed: false, laserUsed: false,   // Superwaffen: je 1x pro Welle
  targeting: null,      // 'slaser' = nächster Tap aufs Feld feuert den Orbital-Laser
  shakeT: 0,            // Bildschirm-Wackeln (Nuke/Orbital-Laser)
};
let towers = [];        // {type,lvl,x,y,cd,angle,target}
// Gesamtstatistik je Turmart: kills/dmg + Matrix "Turmart x Monsterart"
let stats = { types: {}, vs: {} };
function statType(type) { return stats.types[type] || (stats.types[type] = { kills: 0, dmg: 0 }); }
function creditDmg(src, dealt) {
  src.dmgDone = (src.dmgDone || 0) + dealt;
  statType(src.type).dmg += dealt;
}
let enemies = [];       // {type,hp,maxHp,speed,pathI,frac,x,y,slowT,slowF,burnT,burnDps,bounty,boss}
let shots = [];         // Projektile/Effekte
let towerAt = {};       // "x,y" -> tower
let parts = [];         // Deko-Partikel (Flammen, Funken, Rauch, Schnee, …)
const MAX_PARTS = 520;
function spawnPart(p) { if (parts.length < MAX_PARTS) { p.t = 0; parts.push(p); } }

function newGame(keepSave) {
  if (!keepSave) {
    // laufende Partie wird aufgegeben -> als Ergebnis in die Historie
    if (game.wave > 0 && game.state !== 'over') recordResult('quit');
    clearSave();
  }
  game.money = DIFF.money; game.lives = DIFF.lives; game.wave = 0;
  game.state = 'build'; game.speed = 1; game.nextT = 0;
  game.toSpawn = []; game.sel = null; game.banner = ''; game.bannerT = 0;
  game.nukeUsed = false; game.laserUsed = false; game.targeting = null;
  towers = []; enemies = []; shots = []; towerAt = {}; parts = [];
  stats = { types: {}, vs: {} };
  updateSpeedBtn();
  updateSupers();
  hidePanels();
}

// ---- Wellen ----------------------------------------------------------------
function baseHp(w) { return (30 * Math.pow(DIFF.growth, w - 1) + 10 * (w - 1)) * DIFF.hpMul; }
function bounty(w, mult) { return Math.round((3 + w * 0.55) * mult); }

function buildWave(w) {
  const list = [];
  const n = Math.min(10 + Math.round(w * 1.8), 40);
  for (let i = 0; i < n; i++) {
    let t = 'blob';
    if (w >= 2 && i % 3 === 2) t = 'runner';
    if (w >= 4 && i % 4 === 3) t = 'tank';
    if (w >= 7 && i % 5 === 4) t = 'regen';
    if (w >= 10 && i % 6 === 1) t = 'ember';
    if (w >= 12 && i % 6 === 3) t = 'prisma';
    if (w >= 14 && i % 6 === 5) t = 'blitzer';
    list.push(t);
  }
  // Boss-Wellen: ab Welle 16 kommen sie im Rudel
  if (w % 8 === 0) for (let b = 0; b <= (w / 16 | 0); b++) list.push('boss');
  return list;
}

const ETYPES = {
  blob: { hp: 1.0, speed: 1.5, mult: 1.0, color: '#7dc95e', r: 0.28 },
  runner: { hp: 0.6, speed: 2.6, mult: 1.1, color: '#e0d05a', r: 0.24 },
  tank: { hp: 2.6, speed: 0.95, mult: 2.5, color: '#8a6fb8', r: 0.34, armor: 0.5 },
  regen: { hp: 1.7, speed: 1.2, mult: 1.8, color: '#5ac9a8', r: 0.3, regen: 0.02 },
  // Resistenzler (ab Welle 10/12/14): nehmen von "ihrem" Element nur 10% –
  // damit braucht jede Verteidigung einen Waffen-Mix
  ember: { hp: 1.4, speed: 1.7, mult: 1.7, color: '#e0703a', r: 0.29, resist: 'fire' },
  prisma: { hp: 1.7, speed: 1.25, mult: 1.9, color: '#e8b8f0', r: 0.3, resist: 'laser' },
  blitzer: { hp: 1.5, speed: 1.9, mult: 1.9, color: '#ffe66e', r: 0.28, resist: 'shock' },
  boss: { hp: 14, speed: 0.55, mult: 12, color: '#d84a6a', r: 0.44, boss: true, armor: 0.3 },
};

function startWave() {
  if (game.state === 'over') return;
  if (game.state === 'wave') return;
  // Frühstart-Bonus, wenn der Countdown noch lief
  if (game.wave > 0 && game.nextT > 0) game.money += Math.round(game.nextT * 2);
  game.wave++;
  game.toSpawn = buildWave(game.wave);
  game.spawnT = 0;
  game.state = 'wave';
  game.nukeUsed = false; game.laserUsed = false;
  updateSupers();
  game.banner = 'Welle ' + game.wave; game.bannerT = 1.4;
}

function spawnEnemy(type) {
  const t = ETYPES[type];
  const hp = baseHp(game.wave) * t.hp;
  const [sx, sy] = PATH[0];
  enemies.push({
    type, hp, maxHp: hp, speed: t.speed, pathI: 0, frac: 0,
    x: sx + 0.5, y: sy + 0.5, slowT: 0, slowF: 0, burnT: 0, burnDps: 0,
    bounty: bounty(game.wave, t.mult), boss: !!t.boss, regen: t.regen || 0,
    armorHp: t.armor ? hp * t.armor : 0, maxArmor: t.armor ? hp * t.armor : 0,
    vulnFire: 0, vulnShock: 0, windCd: 0, dazeT: 0, dazeCd: 0, radDps: 0, resist: t.resist || null,
    r: t.r, color: t.color, wob: Math.random() * TAU,
  });
}

// Position/Fortschritt eines Gegners auf dem Pfad
function progress(e) { return e.pathI + e.frac; }

function stepEnemy(e, dt) {
  if (e.slowT > 0) e.slowT -= dt; else e.slowF = 0;
  if (e.vulnFire > 0) e.vulnFire -= dt;
  if (e.vulnShock > 0) e.vulnShock -= dt;
  if (e.windCd > 0) e.windCd -= dt;
  if (e.dazeCd > 0) e.dazeCd -= dt;
  if (e.burnT > 0) { e.burnT -= dt; damage(e, e.burnDps * dt, 'fire', false, e.burnSrc); }
  if (e.radDps > 0) {   // Verstrahlung: ignoriert Panzerung, klingt nie ab
    const dealt = Math.min(Math.max(e.hp, 0), e.radDps * dt);
    e.hp -= e.radDps * dt;
    if (e.radSrc) {
      creditDmg(e.radSrc, dealt);
      if (e.hp <= 0 && !e.killedBy) e.killedBy = e.radSrc;
    }
  }
  if (e.regen) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * e.regen * dt);
  if (e.hypnoT > 0) {
    // Hypnotisiert: bleibt stehen und beißt den nächsten anderen Gegner
    e.hypnoT -= dt;
    let tgt = null, nd = 1.8;
    for (const o of enemies) {
      if (o === e || o.dead || o.escaped) continue;
      const d = Math.hypot(o.x - e.x, o.y - e.y);
      if (d < nd) { nd = d; tgt = o; }
    }
    if (tgt) {
      damage(tgt, e.hypnoDps * dt, 'kinetic', false, e.hypnoSrc);
      if (Math.random() < dt * 7) {
        spawnPart({ kind: 'spark', x: tgt.x, y: tgt.y - 0.2, vx: (Math.random() - 0.5) * 2, vy: -1.4, ttl: 0.3, color: '#f0a8ff' });
      }
    }
    return;
  }
  if (e.dazeT > 0) {
    // Abgelenkt vom Fernsehprogramm: bleibt stehen und glotzt. Danach kurz
    // immun, damit ihn niemand ewig festhalten kann.
    e.dazeT -= dt;
    if (e.dazeT <= 0) e.dazeCd = 2.5;
    return;
  }
  const spd = e.speed * (1 - e.slowF);
  e.frac += spd * dt;
  while (e.frac >= 1) {
    e.frac -= 1; e.pathI++;
    if (e.pathI >= PATH.length - 1) { e.escaped = true; return; }
  }
  const [ax, ay] = PATH[e.pathI], [bx, by] = PATH[Math.min(e.pathI + 1, PATH.length - 1)];
  e.x = ax + 0.5 + (bx - ax) * e.frac;
  e.y = ay + 0.5 + (by - ay) * e.frac;
}

// Schadenstypen: kinetic | laser | fire | shock | explosive | poison
// Panzerung schluckt Feuer/Blitz/Explosion/Gift fast komplett, wird aber von
// Kinetik (x1.5, Wolfram x2.2) und Laser (x1) effektiv zerlegt.
function damage(e, amt, type = 'kinetic', ap = false, src = null) {
  if (e.resist === type) amt *= 0.1;   // Resistenzler: nur 10% vom eigenen Element
  if (type === 'fire' && e.vulnFire > 0) amt *= 1.5;
  if (type === 'shock' && e.vulnShock > 0) amt *= 1.5;
  if (e.armorHp > 0) {
    let mult = 0.25;
    if (type === 'kinetic') mult = ap ? 2.2 : 1.5;
    else if (type === 'laser') mult = 1.0;
    if (src) creditDmg(src, Math.min(e.armorHp, amt * mult));
    e.armorHp -= amt * mult;
    if (e.armorHp <= 0) { e.armorHp = 0; armorBreak(e); }
    return;
  }
  if (src) creditDmg(src, Math.min(Math.max(e.hp, 0), amt));
  e.hp -= amt;
  // Abschuss bekommt, wer den Todesstoß landet
  if (e.hp <= 0 && !e.killedBy && src) e.killedBy = src;
}

// Panzerung zerspringt: graue Scherben + Ring
function armorBreak(e) {
  spawnPart({ kind: 'pop', x: e.x, y: e.y, r: e.r * 2.0, ttl: 0.25, color: '#c8d2da' });
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * TAU, sp = 1.5 + Math.random() * 2.5;
    spawnPart({ kind: 'shard', x: e.x, y: e.y - 0.1, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.8, ttl: 0.5, rot: Math.random() * TAU });
  }
}

// ---- Türme: Zielwahl & Feuern ----------------------------------------------
function firstInRange(t, range) {
  let best = null, bp = -1;
  for (const e of enemies) {
    if (e.dead || e.escaped) continue;
    const d = Math.hypot(e.x - (t.x + 0.5), e.y - (t.y + 0.5));
    if (d <= range && progress(e) > bp) { bp = progress(e); best = e; }
  }
  return best;
}

// Endlos-Ausbau der Kommandozentrale: über Stufe 4 hinaus gibt es immer eine
// weitere Stufe – jede wird extrem teurer und pumpt Nuke + Orbital-Laser
// kräftig weiter auf (Ende offen).
function commandLevel(lvl) {
  const base = TOWERS.command.levels[3];
  const n = lvl - 3;
  return {
    cost: Math.round(2500 * Math.pow(2.5, n)),
    nuke: Math.round(base.nuke * Math.pow(1.7, n)),
    beam: Math.round(base.beam * Math.pow(1.7, n)),
    brad: Math.round((base.brad + n * 0.15) * 100) / 100,
  };
}
function levelStats(type, lvl) {
  return TOWERS[type].levels[lvl] || (type === 'command' ? commandLevel(lvl) : undefined);
}
function towerStats(t) { return levelStats(t.type, t.lvl); }

// Turm dreht weich in Zielrichtung (statt zu springen)
function aimAt(t, x, y, dt) {
  const want = Math.atan2(y - (t.y + 0.5), x - (t.x + 0.5));
  let d = want - (t.angle || 0);
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  t.angle = (t.angle || 0) + d * Math.min(1, dt * 14);
}

// Gegner ein Stück den Pfad ZURÜCK schieben (Windmaschine)
function pushBack(e, dist) {
  const d = e.boss ? dist * 0.3 : dist;
  let p = Math.max(0, progress(e) - d);
  e.pathI = Math.floor(p); e.frac = p - e.pathI;
  const [ax, ay] = PATH[e.pathI], [bx, by] = PATH[Math.min(e.pathI + 1, PATH.length - 1)];
  e.x = ax + 0.5 + (bx - ax) * e.frac;
  e.y = ay + 0.5 + (by - ay) * e.frac;
}

// Unwahrscheinlichkeitskanone: Gegner wird zufällig zu einer anderen Art.
// Der prozentuale HP-Stand bleibt erhalten, jede Verwandlung nur einmal.
const MORPHS = ['blob', 'runner', 'tank', 'regen', 'ember', 'prisma', 'blitzer'];
function morphEnemy(e) {
  const options = MORPHS.filter((k) => k !== e.type);
  const def = ETYPES[options[Math.floor(Math.random() * options.length)]];
  const oldDef = ETYPES[e.type] || { hp: 1 };
  const pct = clamp(e.hp / e.maxHp, 0, 1);
  const base = e.maxHp / (oldDef.hp || 1);   // Wellen-Grundwert rückrechnen
  e.type = MORPHS.find((k) => ETYPES[k] === def);
  e.maxHp = base * def.hp;
  e.hp = e.maxHp * pct;
  e.speed = def.speed;
  e.maxArmor = def.armor ? e.maxHp * def.armor : 0;
  e.armorHp = e.maxArmor * pct;
  e.regen = def.regen || 0;
  e.resist = def.resist || null;
  e.r = def.r;
  e.color = def.color;
  e.morphed = true;
  // Regenbogen-Puff
  spawnPart({ kind: 'pop', x: e.x, y: e.y, r: e.r * 2.6, ttl: 0.4, color: '#ffffff' });
  const cols = ['#ff6a6a', '#ffd166', '#7dff8a', '#6fd6ff', '#e08ad8'];
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * TAU, sp = 1.8 + Math.random() * 2;
    spawnPart({ kind: 'spark', x: e.x, y: e.y - 0.1, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.2, ttl: 0.45, color: cols[i % 5] });
  }
}

// Taktische Nuke (Raketen-Spezialisierung): extremer Schaden im Zentrum,
// quadratisch nach außen abnehmend
function tacticalNuke(x, y, dmg, src) {
  const R = 2.3;
  for (const e of enemies) {
    if (e.dead || e.escaped) continue;
    const d = Math.hypot(e.x - x, e.y - y);
    if (d > R + e.r) continue;
    const f = Math.pow(1 - clamp(d / (R + e.r), 0, 1), 2);
    damage(e, dmg * 6 * f, 'explosive', false, src);
  }
  shots.push({ kind: 'tnuke', x, y, r: R, t: 0, ttl: 0.7 });
  game.shakeT = Math.max(game.shakeT, 0.25);
  for (let i = 0; i < 8; i++) {
    spawnPart({ kind: 'flame', x: x + (Math.random() - 0.5) * 0.5, y: y + (Math.random() - 0.5) * 0.4,
      vx: (Math.random() - 0.5) * 0.8, vy: -1.6 - Math.random() * 1.2, ttl: 0.5 + Math.random() * 0.3, size: 0.15 + Math.random() * 0.1 });
  }
  for (let i = 0; i < 6; i++) {
    spawnPart({ kind: 'smoke', x: x + (Math.random() - 0.5) * 1.2, y: y + (Math.random() - 0.5) * 0.8,
      vx: (Math.random() - 0.5) * 0.4, vy: -0.7 - Math.random() * 0.5, ttl: 1.0 + Math.random() * 0.5, size: 0.22 + Math.random() * 0.16 });
  }
}

function stepTower(t, dt) {
  if (t.type === 'command' || t.type === 'loader') { t.pulse = (t.pulse || 0) + dt; return; }
  const s = effStats(t);
  const cx = t.x + 0.5, cy = t.y + 0.5;
  t.born = (t.born ?? 1) + dt;
  if (t.kick > 0) t.kick = Math.max(0, t.kick - dt * 9);

  if (t.type === 'gold') {
    // Goldmine: schürft im Takt, egal was draußen los ist
    t.goldT = (t.goldT || 0) + dt;
    t.pulse = (t.pulse || 0) + dt;
    if (t.goldT >= s.interval) {
      t.goldT -= s.interval;
      game.money += s.gold;
      shots.push({ kind: 'coin', x: cx, y: cy - 0.3, t: 0, ttl: 0.7, v: s.gold });
      for (let i = 0; i < 3; i++) spawnPart({ kind: 'spark', x: cx, y: cy, vx: (Math.random() - 0.5) * 1.4, vy: -1 - Math.random(), ttl: 0.35, color: '#ffd166' });
    }
    return;
  }

  if (t.type === 'tesla') {
    t.cd -= dt;
    const target = firstInRange(t, s.range);
    if (target) aimAt(t, target.x, target.y, dt);
    if (t.cd > 0 || !target) return;
    t.cd = 1 / s.rate;
    // Kettenblitz: springt zu den jeweils nächsten, noch nicht getroffenen Gegnern
    const hit = [target];
    let cur = target, dmg = s.dmg;
    damage(cur, dmg, 'shock', false, t);
    for (let j = 1; j < s.chain; j++) {
      let next = null, nd = 2.3;
      for (const e of enemies) {
        if (e.dead || e.escaped || hit.includes(e)) continue;
        const d = Math.hypot(e.x - cur.x, e.y - cur.y);
        if (d < nd) { nd = d; next = e; }
      }
      if (!next) break;
      dmg *= 0.75;
      damage(next, dmg, 'shock', false, t);
      hit.push(next);
      cur = next;
    }
    shots.push({ kind: 'zap', pts: [[cx, cy], ...hit.map((e) => [e.x, e.y - 0.1])], t: 0, ttl: 0.16 });
    for (const e of hit) spawnPart({ kind: 'spark', x: e.x, y: e.y - 0.2, vx: (Math.random() - 0.5) * 2, vy: -1.5, ttl: 0.25, color: '#fff8b0' });
    t.kick = 1;
    return;
  }

  if (t.type === 'gift') {
    t.cd -= dt;
    const target = firstInRange(t, s.range);
    if (target) aimAt(t, target.x, target.y, dt);
    if (t.cd > 0 || !target) return;
    t.cd = 1 / s.rate;
    // Flasche fliegt dorthin, wo das Ziel gleich sein wird
    shots.push({ kind: 'glob', x: cx, y: cy, sx: cx, sy: cy, tx: target.x, ty: target.y, t: 0, ttl: 0.5, dps: s.dps, pool: s.pool, dur: s.dur, src: t });
    t.kick = 1;
    return;
  }

  if (t.type === 'wind') {
    t.cd -= dt;
    t.pulse = (t.pulse || 0) + dt;
    if (t.cd > 0) return;
    // Nur der VORDERSTE Gegner im Radius wird zurückgepustet – und höchstens
    // 3/4 der Strecke, die er bis zum nächsten Windstoß läuft. Langfristig
    // kommt also jeder vorbei, der Turm verzögert nur.
    let target = null, bp = -1;
    for (const e of enemies) {
      if (e.dead || e.escaped || e.windCd > 0) continue;
      if (Math.hypot(e.x - cx, e.y - cy) <= s.range && progress(e) > bp) { bp = progress(e); target = e; }
    }
    if (target) {
      pushBack(target, 0.75 * target.speed / s.rate);
      target.windCd = 2.5;
      t.cd = 1 / s.rate;
      shots.push({ kind: 'gust', x: cx, y: cy, r: s.range, t: 0, ttl: 0.45 });
      const dir = Math.atan2(target.y - cy, target.x - cx);
      for (let i = 0; i < 8; i++) {
        const a = dir + (Math.random() - 0.5) * 0.9;
        spawnPart({ kind: 'leaf', x: cx + Math.cos(a) * 0.3, y: cy + Math.sin(a) * 0.3, vx: Math.cos(a) * 3, vy: Math.sin(a) * 3, ttl: 0.5, rot: Math.random() * TAU });
      }
    }
    return;
  }

  if (t.type === 'ice') {
    // Aura: alle im Umkreis verlangsamen
    for (const e of enemies) {
      if (e.dead || e.escaped) continue;
      if (Math.hypot(e.x - cx, e.y - cy) <= s.range) { e.slowF = Math.max(e.slowF, s.slow); e.slowT = 0.35; }
    }
    t.pulse = (t.pulse || 0) + dt;
    // sanftes Schneegestöber im Wirkradius
    if (Math.random() < dt * 5) {
      const a = Math.random() * TAU, r = Math.random() * s.range;
      spawnPart({ kind: 'snow', x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r - 0.3, vx: 0, vy: 0.45, ttl: 1.1, ph: Math.random() * TAU });
    }
    return;
  }

  if (t.type === 'laser') {
    const target = firstInRange(t, s.range);
    t.target = target;
    if (!target) return;
    t.angle = Math.atan2(target.y - cy, target.x - cx);
    // Strahl durch das Ziel hindurch: alle nahe der Linie treffen
    const len = s.range * 1.7;
    const dx = Math.cos(t.angle), dy = Math.sin(t.angle);
    for (const e of enemies) {
      if (e.dead || e.escaped) continue;
      const px = e.x - cx, py = e.y - cy;
      const along = px * dx + py * dy;
      if (along < 0 || along > len) continue;
      const dist = Math.abs(px * dy - py * dx);
      if (dist < 0.38 + e.r * 0.5) {
        damage(e, s.dps * dt, 'laser', false, t);
        // Brutzel-Funken am Auftreffpunkt
        if (Math.random() < dt * 9) spawnPart({ kind: 'spark', x: e.x, y: e.y - 0.1, vx: (Math.random() - 0.5) * 2, vy: -1 - Math.random(), ttl: 0.25, color: '#ff9ef0' });
      }
    }
    return;
  }

  if (t.type === 'improb') {
    t.cd -= dt;
    // vorderster Nicht-Boss, der noch nie verwandelt wurde
    let target = null, bp = -1;
    for (const e of enemies) {
      if (e.dead || e.escaped || e.boss || e.morphed) continue;
      if (Math.hypot(e.x - cx, e.y - cy) <= s.range && progress(e) > bp) { bp = progress(e); target = e; }
    }
    if (target) aimAt(t, target.x, target.y, dt);
    if (t.cd > 0 || !target) return;
    t.cd = 1 / s.rate;
    t.kick = 1;
    shots.push({ kind: 'tracer', x1: cx, y1: cy, x2: target.x, y2: target.y, t: 0, ttl: 0.16, color: 'rgba(224,138,216,0.95)', w: 3 });
    morphEnemy(target);
    return;
  }

  if (t.type === 'railgun') {
    t.cd -= dt;
    // Bosse haben Vorrang, sonst der vorderste Gegner
    let front = null, bp = -1, boss = null, bbp = -1;
    for (const e of enemies) {
      if (e.dead || e.escaped) continue;
      const d = Math.hypot(e.x - cx, e.y - cy);
      if (d > s.range) continue;
      if (e.boss && progress(e) > bbp) { bbp = progress(e); boss = e; }
      if (progress(e) > bp) { bp = progress(e); front = e; }
    }
    const tg = boss || front;
    if (tg) aimAt(t, tg.x, tg.y, dt);
    if (t.cd > 0 || !tg) return;
    t.cd = 1 / s.rate;
    t.kick = 1;
    spawnPart({ kind: 'muzzle', x: cx + Math.cos(t.angle) * 0.55, y: cy + Math.sin(t.angle) * 0.55, a: t.angle, ttl: 0.1, size: 0.34 });
    if (tg.boss || Math.random() < s.acc) {
      // Volltreffer: durchschlägt die Panzerung komplett, Bosse kriegen extra
      const rdmg = s.dmg * (tg.boss ? s.bossMul : 1);
      creditDmg(t, Math.min(Math.max(tg.hp, 0), rdmg));
      tg.hp -= rdmg;
      if (tg.hp <= 0 && !tg.killedBy) tg.killedBy = t;
      shots.push({ kind: 'rail', x1: cx, y1: cy, x2: tg.x, y2: tg.y, t: 0, ttl: 0.15 });
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * TAU, sp = 2 + Math.random() * 3;
        spawnPart({ kind: 'spark', x: tg.x, y: tg.y - 0.1, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.5, ttl: 0.35, color: '#bfe6ff' });
      }
      if (tg.boss) game.shakeT = Math.max(game.shakeT, 0.12);
    } else {
      // Daneben! Der Schuss zischt am kleinen Ziel vorbei
      const oa = t.angle + (Math.random() < 0.5 ? 1 : -1) * (0.25 + Math.random() * 0.3);
      const mx = cx + Math.cos(oa) * s.range * 0.9, my = cy + Math.sin(oa) * s.range * 0.9;
      shots.push({ kind: 'rail', x1: cx, y1: cy, x2: mx, y2: my, t: 0, ttl: 0.12, miss: true });
      spawnPart({ kind: 'smoke', x: mx, y: my, vx: 0, vy: -0.3, ttl: 0.5, size: 0.12, dust: true });
    }
    return;
  }

  if (t.type === 'tv') {
    t.pulse = (t.pulse || 0) + dt;
    // Fernsehturm: das laufende Programm fesselt die vordersten Zuschauer im
    // Umkreis (bis zur Platzzahl). Wer schon zuschaut, belegt einen Platz;
    // wer gerade ausgeschaut hat (dazeCd), ist noch immun. Bosse finden das
    // Programm nur kurz spannend.
    let watching = 0;
    const cand = [];
    for (const e of enemies) {
      if (e.dead || e.escaped) continue;
      if (Math.hypot(e.x - cx, e.y - cy) > s.range) continue;
      if (e.dazeT > 0) { watching++; continue; }
      if (e.dazeCd > 0 || e.hypnoT > 0) continue;
      cand.push(e);
    }
    cand.sort((a, b) => progress(b) - progress(a));
    for (const e of cand) {
      if (watching >= s.aud) break;
      e.dazeT = e.boss ? s.dur * 0.3 : s.dur;
      watching++;
      spawnPart({ kind: 'pop', x: e.x, y: e.y, r: e.r * 2.0, ttl: 0.3, color: '#8ad0ff' });
    }
    return;
  }

  if (t.type === 'hypno') {
    t.pulse = (t.pulse || 0) + dt;
    t.cd -= dt;
    if (t.victim && (t.victim.dead || t.victim.escaped || t.victim.hypnoT <= 0)) { t.victim = null; t.cd = 1.5; }
    if (t.victim || t.cd > 0) return;
    // vorderster Nicht-Boss ohne laufende Hypnose
    let target = null, bp = -1;
    for (const e of enemies) {
      if (e.dead || e.escaped || e.boss || e.hypnoT > 0) continue;
      if (Math.hypot(e.x - cx, e.y - cy) <= s.range && progress(e) > bp) { bp = progress(e); target = e; }
    }
    if (target) {
      target.hypnoT = s.dur;
      target.hypnoDps = target.maxHp * s.factor;
      target.hypnoSrc = t;
      t.victim = target;
      spawnPart({ kind: 'pop', x: target.x, y: target.y, r: target.r * 2.2, ttl: 0.35, color: '#e0a8ff' });
      shots.push({ kind: 'tracer', x1: cx, y1: cy, x2: target.x, y2: target.y, t: 0, ttl: 0.25, color: 'rgba(224,168,255,0.8)', w: 2.5 });
    }
    return;
  }

  if (t.type === 'ray') {
    // Bestrahlung: kontinuierlicher Kegel Richtung nächster Gegner. Kein
    // Direktschaden – wer im Strahl steht, sammelt dauerhafte Verstrahlung,
    // die direkt an den Lebenspunkten nagt und jede Panzerung ignoriert.
    let nearest = null, nd = 1e9;
    for (const e of enemies) {
      if (e.dead || e.escaped) continue;
      const d = Math.hypot(e.x - cx, e.y - cy);
      if (d <= s.range && d < nd) { nd = d; nearest = e; }
    }
    let any = false;
    if (nearest) {
      aimAt(t, nearest.x, nearest.y, dt);
      for (const e of enemies) {
        if (e.dead || e.escaped) continue;
        if (Math.hypot(e.x - cx, e.y - cy) > s.range) continue;
        let da = Math.atan2(e.y - cy, e.x - cx) - t.angle;
        while (da > Math.PI) da -= TAU;
        while (da < -Math.PI) da += TAU;
        if (Math.abs(da) > s.cone) continue;
        const cur = e.radDps || 0;
        if (cur < s.cap) e.radDps = Math.min(s.cap, cur + s.charge * dt);
        e.radSrc = t;
        any = true;
      }
    }
    t.firing = any;
    t.pulse = (t.pulse || 0) + dt;
    if (any && Math.random() < dt * 16) {
      const a = t.angle + (Math.random() - 0.5) * s.cone * 1.8;
      const sp = 1.6 + Math.random() * 1.6;
      spawnPart({ kind: 'rad', x: cx + Math.cos(a) * 0.35, y: cy + Math.sin(a) * 0.35,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, ttl: 0.4 + Math.random() * 0.25 });
    }
    return;
  }

  if (t.type === 'flame') {
    // Feuerkegel: Turm schwenkt zum nächsten Gegner, geröstet wird nur, wer im
    // Kegel (halber Öffnungswinkel s.cone) steht. 'Breitmaul' macht ihn breiter.
    let nearest = null, nd = 1e9;
    for (const e of enemies) {
      if (e.dead || e.escaped) continue;
      const d = Math.hypot(e.x - cx, e.y - cy);
      if (d <= s.range && d < nd) { nd = d; nearest = e; }
    }
    let any = false;
    if (nearest) {
      aimAt(t, nearest.x, nearest.y, dt);
      for (const e of enemies) {
        if (e.dead || e.escaped) continue;
        if (Math.hypot(e.x - cx, e.y - cy) > s.range) continue;
        let da = Math.atan2(e.y - cy, e.x - cx) - t.angle;
        while (da > Math.PI) da -= TAU;
        while (da < -Math.PI) da += TAU;
        if (Math.abs(da) > s.cone) continue;
        damage(e, s.dps * dt, 'fire', false, t);
        e.burnT = Math.max(e.burnT, 2.5); e.burnDps = Math.max(e.burnDps, s.burn); e.burnSrc = t;
        any = true;
      }
    }
    t.firing = any;
    t.pulse = (t.pulse || 0) + dt;
    if (any) {
      // Flammenzungen über die ganze Kegelbreite, mit Streuung und Aufsteigen
      for (let i = 0; i < 3; i++) {
        const a = t.angle + (Math.random() - 0.5) * s.cone * 1.8;
        const sp = 2.0 + Math.random() * 1.8;
        spawnPart({ kind: 'flame', x: cx + Math.cos(a) * 0.3, y: cy + Math.sin(a) * 0.3,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, ttl: 0.3 + Math.random() * 0.22, size: 0.13 + Math.random() * 0.1 });
      }
    }
    return;
  }

  // Schuss-Türme (mg, grenade, rocket)
  t.cd -= dt;
  const target = firstInRange(t, s.range);
  if (target) aimAt(t, target.x, target.y, dt);
  if (t.cd > 0 || !target) return;
  t.cd = 1 / s.rate;
  t.kick = 1;   // Rückstoß-Animation

  if (t.type === 'mg') {
    let dmg = s.dmg;
    if (t.spec === 'tungsten') dmg *= 1.6;
    damage(target, dmg, 'kinetic', t.spec === 'tungsten', t);
    if (t.spec === 'fire') target.vulnFire = 4;      // Brandmarkierer: nimmt 4s mehr Feuerschaden
    if (t.spec === 'shock') target.vulnShock = 4;    // Ionisiert: nimmt 4s mehr Blitzschaden
    const tcol = t.spec === 'fire' ? 'rgba(255,150,60,0.95)' : t.spec === 'shock' ? 'rgba(140,190,255,0.95)' : t.spec === 'tungsten' ? 'rgba(240,248,255,1)' : 'rgba(255,240,180,0.9)';
    shots.push({ kind: 'tracer', x1: cx, y1: cy, x2: target.x, y2: target.y, t: 0, ttl: 0.07, color: tcol });
    // Mündungsfeuer + Einschlagsfunken
    spawnPart({ kind: 'muzzle', x: cx + Math.cos(t.angle) * 0.45, y: cy + Math.sin(t.angle) * 0.45, a: t.angle, ttl: 0.06, size: 0.2 });
    for (let i = 0; i < 3; i++) {
      const a = t.angle + Math.PI + (Math.random() - 0.5) * 1.6;
      spawnPart({ kind: 'spark', x: target.x, y: target.y - 0.1, vx: Math.cos(a) * (1 + Math.random() * 2), vy: Math.sin(a) * 2 - 1.2, ttl: 0.3, color: '#ffd27f' });
    }
  } else if (t.type === 'cannon') {
    let cdmg = s.dmg;
    if (t.spec === 'tungsten') cdmg *= 1.6;
    damage(target, cdmg, 'kinetic', t.spec === 'tungsten', t);
    if (t.spec === 'fire') target.vulnFire = 4;
    if (t.spec === 'shock') target.vulnShock = 4;
    shots.push({ kind: 'tracer', x1: cx, y1: cy, x2: target.x, y2: target.y, t: 0, ttl: 0.1, color: 'rgba(255,255,255,0.95)', w: 3 });
    spawnPart({ kind: 'muzzle', x: cx + Math.cos(t.angle) * 0.5, y: cy + Math.sin(t.angle) * 0.5, a: t.angle, ttl: 0.09, size: 0.3 });
    spawnPart({ kind: 'smoke', x: cx + Math.cos(t.angle) * 0.55, y: cy + Math.sin(t.angle) * 0.55, vx: Math.cos(t.angle) * 0.8, vy: -0.3, ttl: 0.6, size: 0.15 });
    for (let i = 0; i < 5; i++) {
      const a = t.angle + Math.PI + (Math.random() - 0.5) * 1.2;
      spawnPart({ kind: 'spark', x: target.x, y: target.y - 0.1, vx: Math.cos(a) * (1.5 + Math.random() * 2.5), vy: Math.sin(a) * 2.5 - 1.5, ttl: 0.35, color: '#fff0c0' });
    }
  } else if (t.type === 'grenade') {
    shots.push({ kind: 'lob', x: cx, y: cy, sx: cx, sy: cy, tx: target.x, ty: target.y, t: 0, ttl: 0.45, dmg: s.dmg, splash: s.splash, src: t });
    spawnPart({ kind: 'smoke', x: cx + Math.cos(t.angle) * 0.4, y: cy + Math.sin(t.angle) * 0.4, vx: 0, vy: -0.4, ttl: 0.5, size: 0.16 });
  } else if (t.type === 'rocket') {
    shots.push({ kind: 'rocket', x: cx, y: cy, target, speed: 7, dmg: s.dmg, splash: s.splash, angle: t.angle, src: t });
  }
}

function splashDamage(x, y, radius, dmg, src = null) {
  for (const e of enemies) {
    if (e.dead || e.escaped) continue;
    const d = Math.hypot(e.x - x, e.y - y);
    if (d <= radius + e.r) damage(e, dmg * clamp(1 - d / (radius + e.r) * 0.5, 0.5, 1), 'explosive', false, src);
  }
  shots.push({ kind: 'boom', x, y, r: radius, t: 0, ttl: 0.3 });
  // Druckwelle, Splitter und Rauch
  spawnPart({ kind: 'shock', x, y, r: radius * 1.25, ttl: 0.32 });
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * TAU, sp = 2 + Math.random() * 3.5;
    spawnPart({ kind: 'debris', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2.2, ttl: 0.45 + Math.random() * 0.3, rot: Math.random() * TAU });
  }
  for (let i = 0; i < 4; i++) {
    spawnPart({ kind: 'smoke', x: x + (Math.random() - 0.5) * radius, y: y + (Math.random() - 0.5) * radius, vx: (Math.random() - 0.5) * 0.4, vy: -0.5 - Math.random() * 0.4, ttl: 0.8 + Math.random() * 0.4, size: 0.2 + Math.random() * 0.14 });
  }
}

function stepShot(sh, dt) {
  sh.t = (sh.t || 0) + dt;
  if (sh.kind === 'tracer' || sh.kind === 'boom' || sh.kind === 'zap' || sh.kind === 'gust' || sh.kind === 'nuke' || sh.kind === 'rail' || sh.kind === 'tnuke') return sh.t >= sh.ttl;
  if (sh.kind === 'sbeam') {
    // Orbital-Laser: erst Zielmarkierung, nach 0,35s kracht der Strahl runter
    if (!sh.hit && sh.t >= 0.35) {
      sh.hit = true;
      game.shakeT = Math.max(game.shakeT, 0.35);
      for (const e of enemies) {
        if (e.dead || e.escaped) continue;
        if (Math.hypot(e.x - sh.x, e.y - sh.y) <= sh.rad + e.r) superDamage(e, sh.dmg, 'laser', sh.src);
      }
      spawnPart({ kind: 'shock', x: sh.x, y: sh.y, r: sh.rad * 1.4, ttl: 0.35, color: '#cfe8ff' });
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * TAU, sp = 2 + Math.random() * 3.5;
        spawnPart({ kind: 'spark', x: sh.x, y: sh.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2.4, ttl: 0.45, color: '#dff0ff' });
      }
      for (let i = 0; i < 5; i++) {
        spawnPart({ kind: 'smoke', x: sh.x + (Math.random() - 0.5) * sh.rad, y: sh.y + (Math.random() - 0.5) * sh.rad * 0.6,
          vx: (Math.random() - 0.5) * 0.4, vy: -0.7 - Math.random() * 0.5, ttl: 0.9 + Math.random() * 0.4, size: 0.2 + Math.random() * 0.14 });
      }
    }
    return sh.t >= sh.ttl;
  }
  if (sh.kind === 'pool') {
    // Giftpfütze: ätzt alle, die drin stehen
    for (const e of enemies) {
      if (e.dead || e.escaped) continue;
      if (Math.hypot(e.x - sh.x, e.y - sh.y) <= sh.r + e.r * 0.5) damage(e, sh.dps * dt, 'poison', false, sh.src);
    }
    if (Math.random() < dt * 8) spawnPart({ kind: 'bubble', x: sh.x + (Math.random() - 0.5) * sh.r * 1.4, y: sh.y + (Math.random() - 0.5) * sh.r * 1.0, vx: 0, vy: -0.4, ttl: 0.5 });
    return sh.t >= sh.ttl;
  }
  if (sh.kind === 'glob') {
    const f = clamp(sh.t / sh.ttl, 0, 1);
    sh.x = sh.sx + (sh.tx - sh.sx) * f;
    sh.y = sh.sy + (sh.ty - sh.sy) * f - Math.sin(f * Math.PI) * 1.1;
    if (f >= 1) {
      shots.push({ kind: 'pool', x: sh.tx, y: sh.ty, r: sh.pool, dps: sh.dps, t: 0, ttl: sh.dur, src: sh.src });
      for (let i = 0; i < 6; i++) spawnPart({ kind: 'spark', x: sh.tx, y: sh.ty, vx: (Math.random() - 0.5) * 2.4, vy: -Math.random() * 2, ttl: 0.3, color: '#a8e86a' });
      return true;
    }
    return false;
  }
  if (sh.kind === 'lob') {
    const f = clamp(sh.t / sh.ttl, 0, 1);
    sh.x = sh.sx + (sh.tx - sh.sx) * f;
    sh.y = sh.sy + (sh.ty - sh.sy) * f - Math.sin(f * Math.PI) * 1.2;
    if (f >= 1) { splashDamage(sh.tx, sh.ty, sh.splash, sh.dmg, sh.src); return true; }
    return false;
  }
  if (sh.kind === 'rocket') {
    const tg = sh.target;
    if (!tg || tg.dead || tg.escaped) {
      // weiterfliegen und am letzten Kurs verpuffen
      sh.x += Math.cos(sh.angle) * sh.speed * dt;
      sh.y += Math.sin(sh.angle) * sh.speed * dt;
      if (sh.t > 1.6) {
        if (sh.src && sh.src.spec === 'tnuke') tacticalNuke(sh.x, sh.y, sh.dmg * 0.5, sh.src);
        else splashDamage(sh.x, sh.y, sh.splash, sh.dmg * 0.5, sh.src);
        return true;
      }
      return false;
    }
    sh.angle = Math.atan2(tg.y - sh.y, tg.x - sh.x);
    sh.x += Math.cos(sh.angle) * sh.speed * dt;
    sh.y += Math.sin(sh.angle) * sh.speed * dt;
    // Rauchspur hinter der Rakete
    if (Math.random() < dt * 45) spawnPart({ kind: 'smoke', x: sh.x - Math.cos(sh.angle) * 0.2, y: sh.y - Math.sin(sh.angle) * 0.2, vx: 0, vy: -0.25, ttl: 0.55, size: 0.1 });
    if (Math.hypot(tg.x - sh.x, tg.y - sh.y) < 0.3) {
      if (sh.src && sh.src.spec === 'tnuke') tacticalNuke(tg.x, tg.y, sh.dmg, sh.src);
      else splashDamage(tg.x, tg.y, sh.splash, sh.dmg, sh.src);
      return true;
    }
    return false;
  }
  return true;
}

// ---- Update ----------------------------------------------------------------
function update(dt) {
  if (game.state === 'over') return;
  if (game.bannerT > 0) game.bannerT -= dt;

  // Auto-Countdown zwischen Wellen
  if (game.state === 'build' && game.wave > 0) {
    game.nextT -= dt;
    if (game.nextT <= 0) startWave();
  }

  if (game.state === 'wave') {
    // Nachschub
    if (game.toSpawn.length) {
      game.spawnT -= dt;
      if (game.spawnT <= 0) {
        spawnEnemy(game.toSpawn.shift());
        // mit steigender Welle rückt der Nachschub dichter auf
        const base = Math.max(0.45, 0.78 - game.wave * 0.012);
        game.spawnT = game.toSpawn.length && game.toSpawn[0] === 'runner' ? base * 0.7 : base;
      }
    }
  }

  // Gegner
  for (const e of enemies) {
    if (e.dead || e.escaped) continue;
    stepEnemy(e, dt);
    // brennende Gegner züngeln
    if (e.burnT > 0 && Math.random() < dt * 7) {
      spawnPart({ kind: 'flame', x: e.x + (Math.random() - 0.5) * e.r, y: e.y - e.r, vx: (Math.random() - 0.5) * 0.5, vy: -1.2, ttl: 0.3, size: 0.09 });
    }
    // verstrahlte dünsten grüne Wölkchen aus
    if (e.radDps > 0 && Math.random() < dt * 5) {
      spawnPart({ kind: 'rad', x: e.x + (Math.random() - 0.5) * e.r, y: e.y - e.r * 0.5, vx: (Math.random() - 0.5) * 0.4, vy: -0.8, ttl: 0.45 });
    }
    if (e.escaped) {
      game.lives -= e.boss ? 5 : 1;
      spawnPart({ kind: 'shock', x: e.x, y: e.y, r: 0.8, ttl: 0.4, color: '#ff5548' });
      if (game.lives <= 0) { game.lives = 0; gameOver(); }
    } else if (e.hp <= 0) {
      e.dead = true;
      if (e.killedBy) {
        if (towers.includes(e.killedBy)) e.killedBy.kills = (e.killedBy.kills || 0) + 1;
        statType(e.killedBy.type).kills++;
        const vs = stats.vs[e.killedBy.type] || (stats.vs[e.killedBy.type] = {});
        vs[e.type] = (vs[e.type] || 0) + 1;
      }
      game.money += e.bounty;
      shots.push({ kind: 'coin', x: e.x, y: e.y, t: 0, ttl: 0.6, v: e.bounty });
      // Todes-Pop: Ring + Konfetti in Gegnerfarbe
      spawnPart({ kind: 'pop', x: e.x, y: e.y, r: e.r * 2.4, ttl: 0.3, color: e.color });
      for (let i = 0; i < (e.boss ? 16 : 7); i++) {
        const a = Math.random() * TAU, sp = 1.5 + Math.random() * 2.5;
        spawnPart({ kind: 'spark', x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.5, ttl: 0.4 + Math.random() * 0.25, color: e.color });
      }
    }
  }
  enemies = enemies.filter((e) => !e.dead && !e.escaped);

  if (game.shakeT > 0) game.shakeT = Math.max(0, game.shakeT - dt);

  // Türme & Schüsse
  for (const t of towers) stepTower(t, dt);
  shots = shots.filter((sh) => !stepShot(sh, dt));

  // Deko-Partikel bewegen
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.t += dt;
    if (p.t >= p.ttl) { parts.splice(i, 1); continue; }
    if (p.vx !== undefined) { p.x += p.vx * dt; p.y += p.vy * dt; }
    if (p.kind === 'flame') { p.vy -= 1.4 * dt; p.vx *= 1 - dt * 1.5; }        // Flammen steigen auf
    else if (p.kind === 'spark' || p.kind === 'debris' || p.kind === 'shard') p.vy += 7 * dt;   // Funken/Splitter/Scherben fallen
    else if (p.kind === 'smoke') p.vy -= 0.4 * dt;                             // Rauch steigt
    else if (p.kind === 'snow') p.x += Math.sin(p.t * 4 + p.ph) * dt * 0.5;    // Schnee taumelt
    else if (p.kind === 'leaf') { p.vx *= 1 - dt * 2; p.vy = p.vy * (1 - dt * 2) + 1.2 * dt; }   // Blätter verwirbeln
    else if (p.kind === 'bubble') p.vy -= 0.2 * dt;                            // Giftblasen steigen
    if (p.rot !== undefined) p.rot += dt * 9;
  }

  // Welle fertig?
  if (game.state === 'wave' && !game.toSpawn.length && !enemies.length) {
    game.money += 15 + game.wave * 3;
    game.state = 'build';
    game.nextT = 8;
    game.banner = 'Welle ' + game.wave + ' geschafft! +' + (15 + game.wave * 3) + ' 💰';
    game.bannerT = 1.6;
    saveBest();
    saveState();
  }
}

function gameOver() {
  game.state = 'over';
  saveBest();
  recordResult('over');
  clearSave();
}

// ---- Highscore -------------------------------------------------------------
function loadBest() { try { game.best = parseInt(localStorage.getItem('td_best') || '0', 10) || 0; } catch { game.best = 0; } }
function saveBest() {
  const reached = game.state === 'over' ? Math.max(0, game.wave - 1) : game.wave;
  if (reached > game.best) {
    game.best = reached;
    try { localStorage.setItem('td_best', String(game.best)); } catch { /* egal */ }
  }
}

// ---- Superwaffen (Kommandozentrale) ----------------------------------------
function hasCommand() { return towers.some((t) => t.type === 'command'); }
// Die stärkste (höchststufige) Kommandozentrale bestimmt die Superwaffen-Werte
function commandTower() {
  let best = null;
  for (const t of towers) if (t.type === 'command' && (!best || t.lvl > best.lvl)) best = t;
  return best;
}

// Superwaffen wirken gegen Bosse 3-fach und direkt auf die Lebenspunkte –
// keine Panzerung hält Nuke oder Orbital-Laser auf. Kleinere Gegner werden
// wie üblich verrechnet (Panzerung schluckt Explosionen weitgehend).
function superDamage(e, amt, type, src) {
  if (!e.boss) { damage(e, amt, type, false, src); return; }
  const hit = amt * 3;
  if (src) creditDmg(src, Math.min(Math.max(e.hp, 0), hit));
  e.hp -= hit;
  if (e.hp <= 0 && !e.killedBy && src) e.killedBy = src;
}

function fireNuke() {
  const c = commandTower();
  if (!c) return;
  const s = towerStats(c);
  game.nukeUsed = true;
  game.shakeT = 0.6;
  // Riesen-Flächenschlag auf ALLES, was gerade unterwegs ist
  shots.push({ kind: 'nuke', x: GC / 2, y: GR / 2, t: 0, ttl: 1.5 });
  for (const e of enemies) {
    if (e.dead || e.escaped) continue;
    superDamage(e, s.nuke, 'explosive', c);
    spawnPart({ kind: 'shock', x: e.x, y: e.y, r: 1.0, ttl: 0.4, color: '#ffd8a0' });
  }
  // Feuerball, Pilzstiel und -wolke über der Feldmitte
  const nx = GC / 2, ny = GR / 2;
  for (let i = 0; i < 20; i++) {
    const a = Math.random() * TAU;
    spawnPart({ kind: 'flame', x: nx + Math.cos(a) * Math.random() * 0.7, y: ny + Math.sin(a) * Math.random() * 0.5,
      vx: Math.cos(a) * 0.9, vy: -2.0 - Math.random() * 1.8, ttl: 0.6 + Math.random() * 0.5, size: 0.18 + Math.random() * 0.16 });
  }
  for (let i = 0; i < 14; i++) {
    spawnPart({ kind: 'smoke', x: nx + (Math.random() - 0.5) * 3, y: ny + (Math.random() - 0.5) * 2,
      vx: (Math.random() - 0.5) * 0.5, vy: -0.9 - Math.random() * 0.8, ttl: 1.3 + Math.random() * 0.7, size: 0.3 + Math.random() * 0.28 });
  }
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * TAU, sp = 3 + Math.random() * 4;
    spawnPart({ kind: 'debris', x: nx, y: ny, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 3, ttl: 0.6 + Math.random() * 0.4, rot: Math.random() * TAU });
  }
  game.banner = kidsMode ? '🪅 RIESEN-PIÑATA!' : '☢️ NUKE!'; game.bannerT = 1.2;
  updateSupers();
}

function fireSlaser(x, y) {
  const c = commandTower();
  if (!c) return;
  const s = towerStats(c);
  game.laserUsed = true;
  game.targeting = null;
  shots.push({ kind: 'sbeam', x, y, t: 0, ttl: 1.2, hit: false, dmg: s.beam, rad: s.brad, src: c });
  updateSupers();
}

// ---- Abschuss-Zähler-Anzeige (an/aus, bleibt gespeichert) ------------------
let showKills = false;
try { showKills = localStorage.getItem('td_kills') === '1'; } catch { /* egal */ }

// ---- Kids-Modus: alles wird zum Spielzeug ----------------------------------
// Reine Anzeige-Ebene (Namen, Icons, Beschreibungen) – Werte und Spiellogik
// bleiben exakt gleich. Per ☰-Menü umschaltbar, bleibt gespeichert.
const KIDS = {
  mg: { name: 'Nerf-Blaster', icon: '🎯', desc: 'feuert superschnell Schaumstoffpfeile – plopp plopp plopp' },
  cannon: { name: 'Kartoffelkanone', icon: '🥔', desc: 'wumst dicke Kartoffeln – die machen ordentlich Beulen' },
  grenade: { name: 'Wasserbomben-Katapult', icon: '🎈', desc: 'katapultiert platschende Wasserbomben in die Gruppe' },
  laser: { name: 'Kitzel-Laserpointer', icon: '🔦', desc: 'kitzelt alle auf einer Linie mit dem Lichtpunkt' },
  flame: { name: 'Pupsmaschine', icon: '💨', desc: 'pupst grüne Wolken – und der Geruch bleibt hängen' },
  rocket: { name: 'Silvesterrakete', icon: '🎆', desc: 'zischt mit Ziel-Automatik hinterher und macht BUMM in bunt' },
  ice: { name: 'Klebeschleim-Verteiler', icon: '🐌', desc: 'verteilt zähen Glibberschleim – da kommt keiner schnell durch' },
  tesla: { name: 'Juckpulver-Werfer', icon: '🪶', desc: 'wirft Juckpulver, das von Monster zu Monster staubt' },
  ray: { name: 'Oma-Parfüm-Zerstäuber', icon: '🧴', desc: 'sprüht Omas Parfüm – der Duft geht NIE wieder raus' },
  gift: { name: 'Spinat-Katapult', icon: '🥦', desc: 'schleudert Spinatpfützen auf den Weg – bäh, da will keiner durch' },
  wind: { name: 'Riesen-Föhn', icon: '🌬️', desc: 'föhnt den Vordersten ein Stück zurück Richtung Start' },
  gold: { name: 'Taschengeld-Sparschwein', icon: '🐷', desc: 'sammelt fleißig Taschengeld (tut niemandem weh)' },
  loader: { name: 'Zuckerschub-Bude', icon: '🍭', desc: 'passiv: Nerf-Blaster, Kartoffelkanone & Riesenflitsche daneben ballern nach der Zuckerration viel schneller' },
  improb: { name: 'Zauberhut', icon: '🎩', desc: 'Simsalabim: verwandelt ein Monster in ein zufälliges anderes' },
  railgun: { name: 'Riesenflitsche', icon: '🪃', desc: 'die Mega-Steinschleuder: trifft die ganz Großen mit Karacho, kleine flutschen oft durch' },
  hypno: { name: 'Seifenblasen-Turm', icon: '🫧', desc: 'schillernde Seifenblasen: ein Monster bleibt stehen und schubst die anderen' },
  tv: { name: 'Kasperletheater', icon: '🎭', desc: 'Tri tra trallala: wer zuschaut, vergisst das Weiterlaufen' },
  command: { name: 'Baumhaus-Zentrale', icon: '🏡', desc: 'schaltet 🪅 Riesen-Piñata + 🚿 Mega-Wasserstrahl frei (je 1× pro Welle)' },
};
let kidsMode = false;
try { kidsMode = localStorage.getItem('td_kids') === '1'; } catch { /* egal */ }
// Anzeige-Infos je Turmart: im Kids-Modus Name/Icon/Beschreibung getauscht
const KIDS_FULL = {};
for (const [k, v] of Object.entries(KIDS)) KIDS_FULL[k] = { ...TOWERS[k], ...v };
function tInfo(type) { return kidsMode && KIDS_FULL[type] ? KIDS_FULL[type] : TOWERS[type]; }
// Auch die Spezialisierungen werden zum Spielzeug (aus der Taktischen Nuke
// wird die Mega-Konfettibombe) – Schlüssel, Kosten und Wirkung bleiben gleich.
const KIDS_SPECS = {
  mg: {
    fire: { icon: '🌶️', name: 'Chili-Pulver', desc: '+50% Stink-Schaden auf Getroffene (4 s)' },
    shock: { icon: '🪶', name: 'Kitzel-Staub', desc: '+50% Juckpulver-Schaden auf Getroffene (4 s)' },
    tungsten: { icon: '🎱', name: 'Murmelkern', desc: '+60% Schaden, knackt sogar Ritterrüstungen' },
  },
  grenade: {
    dmg: { icon: '💦', name: 'XXL-Ballons', desc: '+50% Platsch-Schaden, größere Fläche' },
    range: { icon: '🦾', name: 'Weitwurf-Arm', desc: '+1,0 Reichweite' },
  },
  rocket: {
    dmg: { icon: '🧨', name: 'Extra-Böller', desc: '+50% Schaden' },
    range: { icon: '💨', name: 'Turbo-Treibsatz', desc: '+1,0 Reichweite' },
    tnuke: { icon: '🎊', name: 'Mega-Konfettibombe', desc: 'Riesen-Knaller: 6× Schaden im Zentrum, nach außen stark abnehmend, Radius 2,3' },
  },
  tesla: {
    chain: { icon: '🌪️', name: 'Extra-Staubwolke', desc: '+2 Kettenziele' },
    range: { icon: '🪁', name: 'Weitpuster', desc: '+0,9 Reichweite' },
  },
  flame: {
    wide: { icon: '🫘', name: 'Bohnen-Diät', desc: 'fast doppelt so breite Pupswolke' },
    range: { icon: '💨', name: 'Druckpups', desc: '+0,8 Reichweite' },
  },
  gift: {
    dur: { icon: '🥣', name: 'Extra matschig', desc: 'Pfützen halten 3 s länger' },
    pool: { icon: '🍲', name: 'Familienportion', desc: '+40% Pfützenradius' },
  },
  ray: {
    charge: { icon: '🌹', name: 'Extra-starker-Flakon', desc: '+50% Duft & Limit' },
    range: { icon: '🌬️', name: 'Turbo-Düse', desc: '+0,8 Reichweite' },
  },
  railgun: {
    focus: { icon: '👓', name: 'Zielbrille', desc: 'zielsicher: trifft kleine Gegner zu 90%' },
    hyper: { icon: '🦵', name: 'Doppelt gespannt', desc: 'streut doppelt so stark, aber 6× Schaden an den ganz Großen' },
  },
  tv: {
    binge: { icon: '👏', name: 'Zugabe! Zugabe!', desc: '+1,2 s Vorstellung' },
    big: { icon: '🎪', name: 'Große Bühne', desc: '+2 Sitzplätze, +0,5 Reichweite' },
  },
};
KIDS_SPECS.cannon = KIDS_SPECS.mg;   // gleiche Munitionsarten wie der Nerf-Blaster
function sInfo(type, sp) {
  const o = kidsMode && KIDS_SPECS[type] && KIDS_SPECS[type][sp.key];
  return o ? { ...sp, ...o } : sp;
}
// Hilfe-Tipps in Kids-Sprache (gleiche Taktik, anderes Vokabular)
const KIDS_TIPS = {
  mg: 'Früh billig; mit 🍭 Zuckerschub daneben wird er zur Plopp-Maschine. 🎱 Murmelkern knackt Ritterrüstungen.',
  cannon: 'Lange Reichweite – wirkt über mehrere Pfadschleifen. Erste Wahl gegen Ritterrüstungen.',
  grenade: 'An Kurven und Doppelpfaden stellen, wo Gruppen dicht laufen. An Rüstungen platschen die Ballons nur ab.',
  laser: 'An lange Geraden bauen – kitzelt alles auf der Linie, sogar durch die Rüstung.',
  flame: 'Die Wolke schwenkt zum nächsten Gegner; der Geruch wirkt nach. Gegen 🔥 Glutläufer nutzlos – die riechen nichts.',
  rocket: 'Zielsuchend, verfehlt nie. Mit der 🎊 Mega-Konfettibombe die dickste Party-Waffe.',
  ice: 'Macht keinen Schaden, ist aber Gold wert: an Kurven festkleben, dahinter draufhauen.',
  tesla: 'Stark gegen Pulks – das Juckpulver staubt weiter. ⚡ Geerdete juckt es nicht.',
  ray: 'Der Duft bleibt für immer und zieht durch jede Rüstung – vorne einsprühen, hinten schlappmachen lassen.',
  loader: 'Passiv! Direkt neben Nerf-Blaster, Kartoffelkanone oder Riesenflitsche stellen – nur die beste Bude daneben zählt.',
  improb: 'Glücksspiel: verwandelt Panzer in Blobs – oder in Renner. Am besten auf dicke Brocken.',
  railgun: 'Der Riesen-Schreck: trifft die ganz Großen immer, 3× Schaden, durch jede Rüstung. Kleine flutschen oft durch.',
  hypno: 'Verzauberte stehen still und schubsen Nachbarn – je fetter das Opfer, desto doller.',
  tv: 'Hält die Vordersten vor der Kill-Zone fest, während die Türme dahinter arbeiten. Niemand hängt ewig: nach der Vorstellung ist jeder kurz immun.',
  gift: 'Pfützen liegen auf dem Weg – wer durchläuft, kriegt Bauchweh. Länge vor Fläche an Engstellen.',
  wind: 'Föhnt den Vordersten zurück (¾-Regel: niemand hängt ewig fest). Gut vor der Kill-Zone.',
  gold: 'Früh gebaut zahlt es sich über die Wellen aus. In eine ruhige Ecke stellen.',
  command: 'Schaltet 🪅 Riesen-Piñata und 🚿 Mega-Wasserstrahl frei (je 1× pro Welle, gegen die ganz Großen 3× und durch jede Rüstung). Endlos ausbaubar – jede weitere Stufe kostet ein Vermögen.',
};
// Stufen-Beschriftungen, die im Kids-Modus anders heißen
const KIDS_MAINLBL = { ray: 'Duft/s', gift: 'Spinat/s', hypno: 'Schubs', command: '🪅-Schaden' };

// ---- Spielstand ------------------------------------------------------------
// Zwischen den Wellen wird automatisch gesichert: immer lokal (localStorage),
// für eingeloggte Spieler zusätzlich in der Datenbank (geräteübergreifend).
const SAVE_KEY = 'td_save';
function diffKey() { return DIFF === DIFFS.leicht ? 'leicht' : DIFF === DIFFS.schwer ? 'schwer' : 'normal'; }
function authHeaders() {
  let tok = null;
  try { tok = localStorage.getItem('tgl_token'); } catch { /* egal */ }
  return tok ? { Authorization: 'Bearer ' + tok } : null;
}
function saveState() {
  if (game.state === 'over') return;
  if (game.wave === 0 && !towers.length) return;
  const d = {
    v: 1, ts: Date.now(), diff: diffKey(),
    money: Math.round(game.money), lives: game.lives,
    wave: game.state === 'wave' ? game.wave - 1 : game.wave,   // laufende Welle wird wiederholt
    towers: towers.map((t) => ({ type: t.type, lvl: t.lvl, x: t.x, y: t.y, spec: t.spec || null, kills: t.kills || 0, dmg: Math.round(t.dmgDone || 0) })),
    stats,
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(d)); } catch { /* egal */ }
  const h = authHeaders();
  if (h) {
    fetch('/api/save/td', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify({ data: d }) }).catch(() => {});
  }
}
function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* egal */ }
  const h = authHeaders();
  if (h) {
    fetch('/api/save/td', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify({ data: null }) }).catch(() => {});
  }
}
function applySave(d) {
  if (!d || !Array.isArray(d.towers)) return false;
  DIFF = DIFFS[d.diff] || DIFFS.normal;
  for (const k of ['leicht', 'normal', 'schwer']) {
    document.getElementById('diff-' + k).classList.toggle('active', DIFFS[k] === DIFF);
  }
  newGame(true);
  game.money = Math.max(0, d.money | 0);
  game.lives = Math.max(1, Math.min(99, d.lives | 0));
  game.wave = Math.max(0, d.wave | 0);
  for (const td of d.towers) {
    const def = TOWERS[td.type];
    if (!def) continue;
    const x = td.x | 0, y = td.y | 0, k = x + ',' + y;
    if (x < 0 || x >= GC || y < 0 || y >= GR || towerAt[k] || isPath(x, y) || isPond(x, y)) continue;
    const maxLvl = td.type === 'command' ? 99 : def.levels.length - 1;   // Zentrale: Ende offen
    const t = { type: td.type, lvl: clamp(td.lvl | 0, 0, maxLvl), x, y, cd: 0, angle: 0, born: 1, kills: Math.max(0, td.kills | 0), dmgDone: Math.max(0, td.dmg | 0) };
    if (td.spec && (SPECS[td.type] || []).some((o) => o.key === td.spec)) t.spec = td.spec;
    towers.push(t); towerAt[k] = t;
  }
  if (d.stats && typeof d.stats === 'object') {
    stats = { types: d.stats.types || {}, vs: d.stats.vs || {} };
  }
  updateSupers();
  if (game.wave > 0) game.nextT = 12;
  game.banner = 'Spielstand geladen – weiter mit Welle ' + (game.wave + 1);
  game.bannerT = 2.2;
  return true;
}
async function tryRestore() {
  let local = null;
  try { local = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { /* egal */ }
  let remote = null;
  const h = authHeaders();
  if (h) {
    try {
      const r = await fetch('/api/save/td', { headers: h });
      if (r.ok) remote = (await r.json()).save || null;
    } catch { /* egal */ }
  }
  const best = remote && (!local || (remote.ts || 0) > (local.ts || 0)) ? remote : local;
  if (best) applySave(best);
}
// beim Verlassen der Seite den aktuellen Stand mitnehmen
window.addEventListener('pagehide', saveState);

// ---- Spiel-Historie: jedes Ergebnis mit Statistik-Zusammenfassung ----------
// Lokal (localStorage) und für eingeloggte Spieler zusätzlich in der
// Datenbank (eigener Slot 'td_history' über dieselbe Save-API).
const HIST_KEY = 'td_history';
let history = [];
function pushHistoryToServer() {
  const h = authHeaders();
  if (!h) return;
  fetch('/api/save/td_history', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...h },
    body: JSON.stringify({ data: { v: 1, runs: history } }) }).catch(() => { /* egal */ });
}
function recordResult(end) {
  const reached = end === 'over' ? Math.max(0, game.wave - 1) : game.wave;
  // Game Over zählt immer (auch in Welle 1 gestorben); Abbruch nur, wenn
  // überhaupt eine Welle lief
  if (end !== 'over' && reached < 1) return;
  let kills = 0, dmg = 0, top = null;
  for (const [k, st] of Object.entries(stats.types)) {
    kills += st.kills; dmg += st.dmg;
    if (!top || st.dmg > stats.types[top].dmg) top = k;
  }
  history.unshift({ ts: Date.now(), diff: diffKey(), wave: reached, end, kills, dmg: Math.round(dmg), top });
  history = history.slice(0, 50);
  try { localStorage.setItem(HIST_KEY, JSON.stringify(history)); } catch { /* egal */ }
  pushHistoryToServer();
}
async function loadHistory() {
  try { history = JSON.parse(localStorage.getItem(HIST_KEY) || '[]') || []; } catch { history = []; }
  const h = authHeaders();
  if (!h) return;
  try {
    const r = await fetch('/api/save/td_history', { headers: h });
    if (!r.ok) return;
    const remote = ((await r.json()).save || {}).runs || [];
    const seen = new Set(history.map((x) => x && x.ts));
    let merged = false;
    for (const run of remote) {
      if (run && typeof run.ts === 'number' && !seen.has(run.ts)) { history.push(run); merged = true; }
    }
    if (merged) {
      history.sort((a, b) => b.ts - a.ts);
      history = history.slice(0, 50);
      try { localStorage.setItem(HIST_KEY, JSON.stringify(history)); } catch { /* egal */ }
    }
  } catch { /* egal */ }
}

// ---- Rendering -------------------------------------------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let CW = 0, CH = 0, T = 24, OX = 0, OY = 0, ROT = false;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  CW = window.innerWidth; CH = window.innerHeight;
  canvas.width = Math.round(CW * dpr); canvas.height = Math.round(CH * dpr);
  canvas.style.width = CW + 'px'; canvas.style.height = CH + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Querformat: das hohe Spielfeld wird um 90° gedreht, damit es den
  // Bildschirm füllt (Handy quer, Desktop). Eingaben werden zurückgerechnet.
  ROT = CW > CH;
  if (ROT) {
    T = Math.min((CW - 16) / GR, (CH - 120) / GC);
    OX = (CW - GR * T) / 2;
    OY = Math.max(58, (CH - GC * T) / 2);
  } else {
    T = Math.min(CW / GC, (CH - 210) / GR);
    OX = (CW - GC * T) / 2;
    OY = 92;
  }
}
// Bildschirm- in Feldkoordinaten (berücksichtigt die Drehung)
function toField(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  const sx = clientX - r.left, sy = clientY - r.top;
  if (ROT) return { wx: (sy - OY) / T, wy: (OX + GR * T - sx) / T };
  return { wx: (sx - OX) / T, wy: (sy - OY) / T };
}
window.addEventListener('resize', resize);

function draw(time) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0c1a12'; ctx.fillRect(0, 0, CW, CH);

  let jx = 0, jy = 0;
  if (game.shakeT > 0) { jx = (Math.random() - 0.5) * game.shakeT * 18; jy = (Math.random() - 0.5) * game.shakeT * 18; }
  ctx.save();
  ctx.translate(OX + jx, OY + jy);
  if (ROT) { ctx.rotate(Math.PI / 2); ctx.translate(0, -GR * T); }
  // Wiese
  for (let y = 0; y < GR; y++) for (let x = 0; x < GC; x++) {
    ctx.fillStyle = (x + y) % 2 ? '#1d3a24' : '#1a3520';
    ctx.fillRect(x * T, y * T, T + 0.5, T + 0.5);
  }
  // Teiche (leicht schimmernd, mit Ufer)
  for (const k of POND) {
    const [x, y] = k.split(',').map(Number);
    ctx.fillStyle = '#2a5a7a';
    ctx.fillRect(x * T, y * T, T + 0.5, T + 0.5);
    ctx.fillStyle = `rgba(140,200,235,${0.16 + Math.sin(time * 1.6 + x * 2 + y) * 0.08})`;
    ctx.fillRect(x * T, y * T, T + 0.5, T + 0.5);
    ctx.fillStyle = 'rgba(220,240,255,0.35)';
    const wy = y * T + T * (0.3 + Math.sin(time * 2 + x * 3) * 0.1);
    ctx.fillRect(x * T + T * 0.15, wy, T * 0.35, 1.6);
    ctx.fillRect(x * T + T * 0.55, wy + T * 0.25, T * 0.28, 1.6);
  }
  // Pfad: Erde mit dunklem Rand + Kieseln
  for (const [x, y] of PATH) {
    ctx.fillStyle = (x + y) % 2 ? '#b39b6e' : '#a8905f';
    ctx.fillRect(x * T, y * T, T + 0.5, T + 0.5);
  }
  ctx.strokeStyle = 'rgba(70,52,30,0.55)'; ctx.lineWidth = 2;
  for (const [x, y] of PATH) {
    if (!isPath(x, y - 1)) { ctx.beginPath(); ctx.moveTo(x * T, y * T + 1); ctx.lineTo((x + 1) * T, y * T + 1); ctx.stroke(); }
    if (!isPath(x, y + 1)) { ctx.beginPath(); ctx.moveTo(x * T, (y + 1) * T - 1); ctx.lineTo((x + 1) * T, (y + 1) * T - 1); ctx.stroke(); }
    if (!isPath(x - 1, y)) { ctx.beginPath(); ctx.moveTo(x * T + 1, y * T); ctx.lineTo(x * T + 1, (y + 1) * T); ctx.stroke(); }
    if (!isPath(x + 1, y)) { ctx.beginPath(); ctx.moveTo((x + 1) * T - 1, y * T); ctx.lineTo((x + 1) * T - 1, (y + 1) * T); ctx.stroke(); }
    const h = tileHash(x, y);
    ctx.fillStyle = 'rgba(90,70,45,0.5)';
    for (let i = 0; i < 3; i++) {
      const px = x * T + ((h >> (i * 5)) % 80) / 100 * T + T * 0.1;
      const py = y * T + ((h >> (i * 7 + 3)) % 80) / 100 * T + T * 0.1;
      ctx.beginPath(); ctx.arc(px, py, T * 0.035, 0, TAU); ctx.fill();
    }
  }
  // Wiesen-Deko (deterministisch, unter den Türmen)
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let y = 0; y < GR; y++) for (let x = 0; x < GC; x++) {
    if (isPath(x, y) || isPond(x, y)) continue;
    const h = tileHash(x, y) % 100;
    const cx2 = x * T + T * (0.3 + (tileHash(x, y) >> 8) % 40 / 100);
    const cy2 = y * T + T * (0.3 + (tileHash(x, y) >> 12) % 40 / 100);
    if (h < 26) {           // Grasbüschel
      ctx.strokeStyle = '#2f5c36'; ctx.lineWidth = 1.4;
      const sway = Math.sin(time * 1.8 + x + y) * T * 0.03;
      ctx.beginPath();
      ctx.moveTo(cx2 - T * 0.06, cy2 + T * 0.08); ctx.lineTo(cx2 - T * 0.08 + sway, cy2 - T * 0.1);
      ctx.moveTo(cx2, cy2 + T * 0.08); ctx.lineTo(cx2 + sway, cy2 - T * 0.14);
      ctx.moveTo(cx2 + T * 0.06, cy2 + T * 0.08); ctx.lineTo(cx2 + T * 0.08 + sway, cy2 - T * 0.1);
      ctx.stroke();
    } else if (h < 36) {    // Blume
      ctx.font = (T * 0.3) + 'px system-ui';
      fText(h % 2 ? '🌼' : '🌸', cx2, cy2);
    } else if (h < 44) {    // Stein
      ctx.fillStyle = '#4a5a58';
      ctx.beginPath(); ctx.ellipse(cx2, cy2, T * 0.11, T * 0.075, 0.4, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.beginPath(); ctx.ellipse(cx2 - T * 0.03, cy2 - T * 0.025, T * 0.05, T * 0.03, 0.4, 0, TAU); ctx.fill();
    } else if (h < 50) {    // Baum (klein, Türme bleiben sichtbar davor)
      ctx.font = (T * 0.52) + 'px system-ui';
      fText(h % 2 ? '🌲' : '🌳', cx2, cy2);
    } else if (h < 54) {    // Pilz
      ctx.font = (T * 0.26) + 'px system-ui';
      fText('🍄', cx2, cy2);
    }
  }
  // Start/Ziel
  ctx.font = (T * 0.7) + 'px system-ui';
  const [sx, sy] = PATH[0], [ex, ey] = PATH[PATH.length - 1];
  fText('🕳', sx * T + T / 2, sy * T + T / 2);
  fText('🏠', ex * T + T / 2, ey * T + T / 2);

  // gewählte Kachel + Reichweite
  if (game.sel) {
    const t = towerAt[game.sel.x + ',' + game.sel.y];
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(game.sel.x * T, game.sel.y * T, T, T);
    const range = t ? effStats(t).range : null;
    if (range) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc((game.sel.x + 0.5) * T, (game.sel.y + 0.5) * T, range * T, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Türme
  for (const t of towers) drawTower(t, time);
  // Abschuss-Zähler (im Menü umschaltbar)
  if (showKills) {
    for (const t of towers) {
      if (['gold', 'ice', 'wind', 'loader', 'improb', 'tv'].includes(t.type)) continue;
      const kx = (t.x + 0.5) * T, ky = (t.y + 0.5) * T;
      ctx.fillStyle = 'rgba(8,16,24,0.72)';
      roundRectP(kx - T * 0.62, ky + T * 0.4, T * 1.24, T * 0.28, 4); ctx.fill();
      ctx.fillStyle = '#ffd166'; ctx.font = (T * 0.175) + 'px system-ui';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      fText('💀' + (t.kills || 0) + ' 💥' + fmtCount(t.dmgDone || 0), kx, ky + T * 0.55);
      ctx.textBaseline = 'alphabetic';
    }
  }
  // Gegner
  for (const e of enemies) drawEnemy(e, time);
  // Schüsse/Effekte
  for (const sh of shots) drawShot(sh);
  drawParts();
  ctx.restore();

  drawHUD();
}

function drawTower(t, time) {
  const def = tInfo(t.type), s = effStats(t);
  const cx = (t.x + 0.5) * T, cy = (t.y + 0.5) * T;
  // Aufbau-Animation: kurz überschwingen, dann setzen
  const b = clamp((t.born ?? 1) / 0.35, 0, 1);
  const scale = b < 1 ? 0.2 + b * 1.0 - Math.sin(b * Math.PI) * -0.15 : 1;
  if (scale !== 1) { ctx.save(); ctx.translate(cx, cy); ctx.scale(scale, scale); ctx.translate(-cx, -cy); }
  // Schatten unter dem Turm
  ctx.globalAlpha = 0.3; ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.ellipse(cx + T * 0.04, cy + T * 0.3, T * 0.38, T * 0.15, 0, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
  // Sockel (die Kommandozentrale ist ein sichtbar größerer Bau)
  const sock = t.type === 'command' ? 1.25 : 1;
  ctx.fillStyle = '#3a4a55';
  ctx.beginPath(); ctx.arc(cx, cy, T * 0.38 * sock, 0, TAU); ctx.fill();
  ctx.fillStyle = def.color;
  ctx.beginPath(); ctx.arc(cx, cy, T * 0.3 * sock, 0, TAU); ctx.fill();
  // Lauf mit Rückstoß (kickt beim Schuss nach hinten)
  if (!['ice', 'flame', 'wind', 'gold', 'command', 'ray', 'railgun', 'hypno', 'loader', 'tv'].includes(t.type)) {
    const kick = (t.kick || 0) * T * 0.1;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(t.angle || 0);
    ctx.fillStyle = '#22303a';
    ctx.fillRect(-kick, -T * 0.08, T * 0.42, T * 0.16);
    ctx.restore();
  }
  // Auto-Lader: rotierender Zahnkranz
  if (t.type === 'loader') {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate((t.pulse || 0) * 2);
    ctx.strokeStyle = '#f5e6b0'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      ctx.rotate(TAU / 6);
      ctx.beginPath(); ctx.moveTo(T * 0.3, 0); ctx.lineTo(T * 0.38, 0); ctx.stroke();
    }
    ctx.restore();
  }
  // Railgun: zwei Magnetschienen mit Glimmen dazwischen
  if (t.type === 'railgun') {
    const kick = (t.kick || 0) * T * 0.12;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(t.angle || 0);
    ctx.fillStyle = '#22303a';
    ctx.fillRect(-kick, -T * 0.13, T * 0.55, T * 0.09);
    ctx.fillRect(-kick, T * 0.04, T * 0.55, T * 0.09);
    ctx.fillStyle = `rgba(140,200,255,${0.35 + (t.kick || 0) * 0.6})`;
    ctx.fillRect(-kick + T * 0.08, -T * 0.04, T * 0.44, T * 0.08);
    ctx.restore();
  }
  // Hypnoseturm: rotierende Spiral-Segmente
  if (t.type === 'hypno') {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate((t.pulse || 0) * 2.6);
    ctx.strokeStyle = 'rgba(240,190,255,0.75)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      ctx.rotate(TAU / 3);
      ctx.beginPath(); ctx.arc(0, 0, T * 0.3, 0, 1.6); ctx.stroke();
    }
    ctx.restore();
    if (t.victim && !t.victim.dead && !t.victim.escaped && t.victim.hypnoT > 0) {
      ctx.strokeStyle = 'rgba(224,168,255,0.4)'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(t.victim.x * T, t.victim.y * T); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  // Fernsehturm: Sendewellen + flackernder Bildschirmschein
  if (t.type === 'tv') {
    const f = (t.pulse || 0) % 1.4 / 1.4;
    ctx.strokeStyle = `rgba(140,190,255,${0.45 * (1 - f)})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, s.range * T * f, 0, TAU); ctx.stroke();
    // Bildzeilen-Flackern hinter dem Icon (Programm läuft immer)
    const flick = 0.25 + Math.abs(Math.sin((t.pulse || 0) * 7 + Math.sin((t.pulse || 0) * 3))) * 0.3;
    ctx.fillStyle = `rgba(180,225,255,${flick})`;
    ctx.beginPath(); ctx.arc(cx, cy, T * 0.26, 0, TAU); ctx.fill();
  }
  // Kommandozentrale: Radar-Sweep + blinkendes Bereitschaftslicht
  if (t.type === 'command') {
    const ready = !game.nukeUsed || !game.laserUsed;
    ctx.save(); ctx.translate(cx, cy);
    ctx.strokeStyle = 'rgba(180,200,255,0.55)'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.arc(0, 0, T * 0.42, 0, TAU); ctx.stroke();
    ctx.rotate((t.pulse || 0) * 2.2);
    ctx.strokeStyle = 'rgba(140,220,120,0.8)'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(T * 0.42, 0); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = ready && Math.sin(time * 6) > 0 ? '#7dff8a' : '#2a5a34';
    ctx.beginPath(); ctx.arc(cx + T * 0.32, cy - T * 0.32, T * 0.055, 0, TAU); ctx.fill();
  }
  // Windmaschine: rotierender Propeller
  if (t.type === 'wind') {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate((t.pulse || 0) * 5);
    ctx.strokeStyle = '#e8f6f2'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      ctx.rotate(TAU / 3);
      ctx.beginPath(); ctx.moveTo(T * 0.08, 0); ctx.lineTo(T * 0.3, 0); ctx.stroke();
    }
    ctx.restore();
  }
  // Laserstrahl
  if (t.type === 'laser' && t.target && !t.target.dead && !t.target.escaped) {
    const len = s.range * 1.7 * T;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(t.angle || 0);
    ctx.strokeStyle = 'rgba(255,110,240,0.85)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(T * 0.3, 0); ctx.lineTo(len, 0); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(T * 0.3, 0); ctx.lineTo(len, 0); ctx.stroke();
    ctx.restore();
  }
  // Strahlenkegel (giftgrün, flackernd)
  if (t.type === 'ray' && t.firing) {
    const rr = s.range * T;
    ctx.globalAlpha = 0.15 + Math.sin(time * 13) * 0.05;
    ctx.fillStyle = '#7dff5e';
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, rr, (t.angle || 0) - s.cone, (t.angle || 0) + s.cone);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#a8ff8a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, rr, (t.angle || 0) - s.cone, (t.angle || 0) + s.cone); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // Feuerkegel-Bogen in Zielrichtung
  if (t.type === 'flame' && t.firing) {
    ctx.strokeStyle = `rgba(255,${120 + Math.sin(time * 20) * 60 | 0},40,0.5)`;
    ctx.lineWidth = 5;
    const fr = s.range * T * (0.75 + Math.sin(time * 9) * 0.08);
    ctx.beginPath(); ctx.arc(cx, cy, fr, (t.angle || 0) - s.cone, (t.angle || 0) + s.cone); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,150,60,0.25)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos((t.angle || 0) - s.cone) * fr, cy + Math.sin((t.angle || 0) - s.cone) * fr);
    ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos((t.angle || 0) + s.cone) * fr, cy + Math.sin((t.angle || 0) + s.cone) * fr); ctx.stroke();
  }
  // Eis-Puls
  if (t.type === 'ice') {
    const f = (t.pulse || 0) % 1.2 / 1.2;
    ctx.strokeStyle = `rgba(140,220,255,${0.55 * (1 - f)})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(cx, cy, s.range * T * f, 0, TAU); ctx.stroke();
  }
  // Icon + Level-Sterne
  ctx.font = (T * (t.type === 'command' ? 0.62 : 0.42)) + 'px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  fText(def.icon, cx, cy - T * 0.02);
  ctx.font = (T * 0.24) + 'px system-ui';
  fText(t.lvl >= 4 ? '👑' + (t.lvl - 2) : t.lvl >= 3 ? '👑' : '⭐'.repeat(t.lvl), cx, cy + T * 0.34);
  if (scale !== 1) ctx.restore();
}

// ---- Deko-Partikel zeichnen ----
function drawParts() {
  for (const p of parts) {
    const f = p.t / p.ttl;
    if (p.kind === 'flame') {
      const c = f < 0.35 ? '#ffe66e' : f < 0.7 ? '#ff9a3c' : '#d84a2a';
      ctx.globalAlpha = (1 - f) * 0.9;
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(p.x * T, p.y * T, p.size * T * (1 + f * 1.2), 0, TAU); ctx.fill();
    } else if (p.kind === 'muzzle') {
      ctx.globalAlpha = 1 - f;
      ctx.save(); ctx.translate(p.x * T, p.y * T); ctx.rotate(p.a);
      ctx.fillStyle = '#ffe66e';
      ctx.beginPath();
      ctx.moveTo(0, -p.size * T * 0.5); ctx.lineTo(p.size * T * 1.6, 0); ctx.lineTo(0, p.size * T * 0.5);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    } else if (p.kind === 'spark') {
      ctx.globalAlpha = 1 - f;
      ctx.fillStyle = p.color || '#ffd27f';
      ctx.fillRect(p.x * T - 1.6, p.y * T - 1.6, 3.2, 3.2);
    } else if (p.kind === 'shard') {
      ctx.globalAlpha = 1 - f;
      ctx.save(); ctx.translate(p.x * T, p.y * T); ctx.rotate(p.rot || 0);
      ctx.fillStyle = '#aab6c0';
      ctx.beginPath(); ctx.moveTo(0, -2.6); ctx.lineTo(2.2, 1.8); ctx.lineTo(-2.2, 1.8); ctx.closePath(); ctx.fill();
      ctx.restore();
    } else if (p.kind === 'debris') {
      ctx.globalAlpha = 1 - f;
      ctx.save(); ctx.translate(p.x * T, p.y * T); ctx.rotate(p.rot || 0);
      ctx.fillStyle = '#6a5238';
      ctx.fillRect(-2.2, -1.4, 4.4, 2.8);
      ctx.restore();
    } else if (p.kind === 'smoke') {
      ctx.globalAlpha = (1 - f) * (p.dust ? 0.4 : 0.32);
      ctx.fillStyle = p.dust ? '#b8a888' : '#9aa5ad';
      ctx.beginPath(); ctx.arc(p.x * T, p.y * T, (p.size || 0.14) * T * (1 + f * 1.6), 0, TAU); ctx.fill();
    } else if (p.kind === 'snow') {
      ctx.globalAlpha = (1 - f) * 0.85;
      ctx.fillStyle = '#dff2ff';
      ctx.beginPath(); ctx.arc(p.x * T, p.y * T, T * 0.05, 0, TAU); ctx.fill();
    } else if (p.kind === 'leaf') {
      ctx.globalAlpha = 1 - f;
      ctx.save(); ctx.translate(p.x * T, p.y * T); ctx.rotate(p.rot || 0);
      ctx.fillStyle = '#7ab84a';
      ctx.beginPath(); ctx.ellipse(0, 0, T * 0.08, T * 0.045, 0, 0, TAU); ctx.fill();
      ctx.restore();
    } else if (p.kind === 'rad') {
      ctx.globalAlpha = (1 - f) * 0.85;
      ctx.fillStyle = '#8aff6a';
      ctx.beginPath(); ctx.arc(p.x * T, p.y * T, T * 0.055 * (1 + f * 0.6), 0, TAU); ctx.fill();
      ctx.globalAlpha = (1 - f) * 0.3;
      ctx.beginPath(); ctx.arc(p.x * T, p.y * T, T * 0.12 * (1 + f), 0, TAU); ctx.fill();
    } else if (p.kind === 'bubble') {
      ctx.globalAlpha = (1 - f) * 0.8;
      ctx.strokeStyle = '#a8e86a'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(p.x * T, p.y * T, T * 0.055 * (1 + f), 0, TAU); ctx.stroke();
    } else if (p.kind === 'shock') {
      ctx.globalAlpha = 1 - f;
      ctx.strokeStyle = p.color || '#ffe2b0';
      ctx.lineWidth = Math.max(1, 4 * (1 - f));
      ctx.beginPath(); ctx.arc(p.x * T, p.y * T, p.r * T * (0.25 + f * 0.75), 0, TAU); ctx.stroke();
    } else if (p.kind === 'pop') {
      ctx.globalAlpha = 1 - f;
      ctx.strokeStyle = p.color || '#fff';
      ctx.lineWidth = Math.max(1, 3 * (1 - f));
      ctx.beginPath(); ctx.arc(p.x * T, p.y * T, p.r * T * (0.3 + f * 0.7), 0, TAU); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

function drawEnemy(e, time) {
  const cx = e.x * T, cy = e.y * T;
  const wob = Math.sin(time * 8 + e.wob) * T * 0.03;
  // Boss: pulsierende Bedrohungs-Aura
  if (e.boss) {
    ctx.globalAlpha = 0.25 + Math.sin(time * 5) * 0.12;
    ctx.fillStyle = '#d84a6a';
    ctx.beginPath(); ctx.arc(cx, cy, e.r * T * (1.5 + Math.sin(time * 5) * 0.18), 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }
  // Schatten am Boden
  ctx.globalAlpha = 0.28; ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.ellipse(cx, cy + e.r * T * 0.85, e.r * T * 0.9, e.r * T * 0.32, 0, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
  // Watschel-Gang: Körper staucht und streckt sich im Rhythmus
  const squash = 1 + Math.sin(time * 9 + e.wob) * 0.08 * (e.slowF > 0 ? 0.4 : 1);
  ctx.save();
  ctx.translate(cx, cy + wob);
  ctx.scale(2 - squash, squash);
  ctx.fillStyle = e.color;
  ctx.beginPath(); ctx.arc(0, 0, e.r * T, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.16)';   // Glanzlicht
  ctx.beginPath(); ctx.arc(-e.r * T * 0.3, -e.r * T * 0.35, e.r * T * 0.32, 0, TAU); ctx.fill();
  if (e.slowF > 0) { ctx.strokeStyle = 'rgba(140,220,255,0.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, e.r * T, 0, TAU); ctx.stroke(); }
  ctx.restore();
  // Panzerplatten (solange Rüstung intakt)
  if (e.armorHp > 0) {
    ctx.strokeStyle = '#b8c4cc'; ctx.lineWidth = Math.max(2, T * 0.09);
    ctx.beginPath(); ctx.arc(cx, cy + wob, e.r * T * 1.05, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#98a6b0';
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * TAU + 0.4;
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * e.r * T * 1.05, cy + wob + Math.sin(a) * e.r * T * 1.05, T * 0.045, 0, TAU); ctx.fill();
    }
  }
  // Verwundbarkeits-Markierungen (Spezialmunition)
  if (e.vulnFire > 0) { ctx.strokeStyle = 'rgba(255,140,50,0.9)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(cx, cy + wob, e.r * T * 1.35, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
  if (e.vulnShock > 0) { ctx.strokeStyle = 'rgba(120,180,255,0.9)'; ctx.setLineDash([2, 4]); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(cx, cy + wob, e.r * T * 1.5, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
  if (e.burnT > 0) { ctx.font = (T * 0.3) + 'px system-ui'; ctx.textAlign = 'center'; fText('🔥', cx, cy - e.r * T - T * 0.12); }
  if (e.dazeT > 0) {
    // gebannt vorm Programm: Bildschirm überm Kopf + Sterne in den Augen
    ctx.font = (T * 0.28) + 'px system-ui'; ctx.textAlign = 'center';
    fText(kidsMode ? '🎭' : '📺', cx, cy - e.r * T - T * 0.3);
    ctx.strokeStyle = `rgba(140,190,255,${0.5 + Math.sin(time * 8) * 0.25})`;
    ctx.lineWidth = 1.6; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.arc(cx, cy + wob, e.r * T * 1.25, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
  }
  if (e.hypnoT > 0) {
    ctx.strokeStyle = `rgba(224,168,255,${0.55 + Math.sin(time * 9) * 0.25})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy + wob, e.r * T * 1.3, time * 3, time * 3 + 4.6); ctx.stroke();
    ctx.font = (T * 0.28) + 'px system-ui'; ctx.textAlign = 'center';
    fText('💫', cx, cy - e.r * T - T * 0.3);
  }
  if (e.resist) {
    // kleines Abzeichen über der linken Schulter: wogegen er immun-ish ist
    const bx2 = cx - e.r * T * 0.95, by2 = cy - e.r * T - T * 0.1;
    ctx.fillStyle = 'rgba(10,22,16,0.8)';
    ctx.beginPath(); ctx.arc(bx2, by2, T * 0.14, 0, TAU); ctx.fill();
    ctx.strokeStyle = e.resist === 'fire' ? '#ff9a3c' : e.resist === 'laser' ? '#e88af0' : '#ffe66e';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(bx2, by2, T * 0.14, 0, TAU); ctx.stroke();
    ctx.font = (T * 0.17) + 'px system-ui'; ctx.textAlign = 'center';
    fText(e.resist === 'fire' ? '🔥' : e.resist === 'laser' ? '📡' : '⚡', bx2, by2);
  }
  if (e.radDps > 0) {
    ctx.strokeStyle = `rgba(140,255,110,${0.45 + Math.sin(time * 7 + e.wob) * 0.25})`;
    ctx.lineWidth = 1.6; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.arc(cx, cy + wob, e.r * T * 1.2, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = (T * 0.24) + 'px system-ui'; ctx.textAlign = 'center';
    fText('☣️', cx + e.r * T * 0.95, cy - e.r * T - T * 0.08);
  }
  // Augen blicken in Laufrichtung
  const [pax, pay] = PATH[e.pathI], [pbx, pby] = PATH[Math.min(e.pathI + 1, PATH.length - 1)];
  const dx = Math.sign(pbx - pax), dy = Math.sign(pby - pay);
  const eox = dx * e.r * T * 0.22, eoy = dy * e.r * T * 0.22;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(cx - e.r * T * 0.32 + eox, cy + wob - e.r * T * 0.2 + eoy, e.r * T * 0.2, 0, TAU);
  ctx.arc(cx + e.r * T * 0.32 + eox, cy + wob - e.r * T * 0.2 + eoy, e.r * T * 0.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#0f1a12';
  ctx.beginPath();
  ctx.arc(cx - e.r * T * 0.32 + eox * 1.4, cy + wob - e.r * T * 0.2 + eoy * 1.4, e.r * T * 0.1, 0, TAU);
  ctx.arc(cx + e.r * T * 0.32 + eox * 1.4, cy + wob - e.r * T * 0.2 + eoy * 1.4, e.r * T * 0.1, 0, TAU);
  ctx.fill();
  // HP-Balken
  const w = e.r * T * 2.2;
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(cx - w / 2, cy - e.r * T - T * 0.16, w, T * 0.09);
  ctx.fillStyle = e.hp / e.maxHp > 0.4 ? '#7dc95e' : '#e05a4a';
  ctx.fillRect(cx - w / 2, cy - e.r * T - T * 0.16, w * clamp(e.hp / e.maxHp, 0, 1), T * 0.09);
  if (e.maxArmor > 0 && e.armorHp > 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(cx - w / 2, cy - e.r * T - T * 0.28, w, T * 0.07);
    ctx.fillStyle = '#c8d2da';
    ctx.fillRect(cx - w / 2, cy - e.r * T - T * 0.28, w * clamp(e.armorHp / e.maxArmor, 0, 1), T * 0.07);
  }
}

function drawShot(sh) {
  if (sh.kind === 'tracer') {
    ctx.strokeStyle = sh.color || 'rgba(255,240,180,0.9)'; ctx.lineWidth = sh.w || 1.5;
    ctx.beginPath(); ctx.moveTo(sh.x1 * T, sh.y1 * T); ctx.lineTo(sh.x2 * T, sh.y2 * T); ctx.stroke();
  } else if (sh.kind === 'zap') {
    // Kettenblitz: dreifacher Strahl (Glow, Kern, Weißglut), wildes Zittern,
    // kleine Verästelungen und grelle Blitzlichter an jedem Treffer
    const flick = Math.random() < 0.25 ? 0.4 : 1;   // Flackern
    ctx.globalAlpha = (1 - sh.t / sh.ttl) * flick;
    for (const w of [[8, 'rgba(120,170,255,0.28)'], [3.4, 'rgba(170,210,255,0.85)'], [1.4, '#ffffff']]) {
      ctx.strokeStyle = w[1]; ctx.lineWidth = w[0];
      ctx.beginPath();
      for (let i = 0; i < sh.pts.length - 1; i++) {
        const [x1, y1] = sh.pts[i], [x2, y2] = sh.pts[i + 1];
        ctx.moveTo(x1 * T, y1 * T);
        const segs = 6;
        for (let sgi = 1; sgi <= segs; sgi++) {
          const f = sgi / segs;
          const jx = sgi < segs ? (Math.random() - 0.5) * 0.34 : 0;
          const jy = sgi < segs ? (Math.random() - 0.5) * 0.34 : 0;
          ctx.lineTo((x1 + (x2 - x1) * f + jx) * T, (y1 + (y2 - y1) * f + jy) * T);
        }
      }
      ctx.stroke();
    }
    // Verästelungen: kurze Seitenblitze
    ctx.strokeStyle = 'rgba(190,220,255,0.7)'; ctx.lineWidth = 1;
    for (let i = 0; i < sh.pts.length - 1; i++) {
      if (Math.random() < 0.6) {
        const [x1, y1] = sh.pts[i], [x2, y2] = sh.pts[i + 1];
        const f = Math.random();
        const bx = (x1 + (x2 - x1) * f) * T, by = (y1 + (y2 - y1) * f) * T;
        const a = Math.random() * TAU;
        ctx.beginPath(); ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(a) * T * 0.35, by + Math.sin(a) * T * 0.35);
        ctx.lineTo(bx + Math.cos(a + 0.5) * T * 0.55, by + Math.sin(a + 0.5) * T * 0.55);
        ctx.stroke();
      }
    }
    // Blitzlicht an jedem getroffenen Gegner
    for (let i = 1; i < sh.pts.length; i++) {
      const [hx, hy] = sh.pts[i];
      ctx.fillStyle = 'rgba(220,240,255,0.8)';
      ctx.beginPath(); ctx.arc(hx * T, hy * T, T * 0.2 * (1 - sh.t / sh.ttl), 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (sh.kind === 'pool') {
    // Giftpfütze mit blubberndem Rand
    const a = clamp(sh.ttl - sh.t, 0, 1);
    ctx.globalAlpha = 0.45 * Math.min(1, a);
    ctx.fillStyle = '#5ab82a';
    ctx.beginPath(); ctx.ellipse(sh.x * T, sh.y * T, sh.r * T, sh.r * T * 0.7, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.7 * Math.min(1, a);
    ctx.strokeStyle = '#8ce84a'; ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (sh.kind === 'glob') {
    // Schatten am Boden + Flasche im Flug
    const f = clamp(sh.t / sh.ttl, 0, 1);
    const gy = sh.sy + (sh.ty - sh.sy) * f;
    ctx.globalAlpha = 0.25; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(sh.x * T, gy * T + T * 0.1, T * 0.1, T * 0.05, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#8ad84a';
    ctx.beginPath(); ctx.arc(sh.x * T, sh.y * T, T * 0.11, 0, TAU); ctx.fill();
  } else if (sh.kind === 'gust') {
    // Windstoß: expandierende Doppelringe
    const f = sh.t / sh.ttl;
    ctx.globalAlpha = (1 - f) * 0.6;
    ctx.strokeStyle = '#cfeee8'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(sh.x * T, sh.y * T, sh.r * T * (0.3 + f * 0.7), 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(sh.x * T, sh.y * T, sh.r * T * Math.max(0, f - 0.18), 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (sh.kind === 'lob') {
    // Schatten am Boden, Granate rotiert im Bogenflug
    const f = clamp(sh.t / sh.ttl, 0, 1);
    const gy = sh.sy + (sh.ty - sh.sy) * f;
    ctx.globalAlpha = 0.25; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(sh.x * T, gy * T + T * 0.1, T * 0.1, T * 0.05, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.save(); ctx.translate(sh.x * T, sh.y * T); ctx.rotate(f * 9);
    ctx.fillStyle = '#333';
    ctx.beginPath(); ctx.arc(0, 0, T * 0.12, 0, TAU); ctx.fill();
    ctx.fillStyle = '#666'; ctx.fillRect(-T * 0.02, -T * 0.17, T * 0.04, T * 0.07);
    ctx.restore();
  } else if (sh.kind === 'rocket') {
    ctx.save(); ctx.translate(sh.x * T, sh.y * T); ctx.rotate(sh.angle);
    ctx.fillStyle = '#ddd'; ctx.fillRect(-T * 0.14, -T * 0.06, T * 0.28, T * 0.12);
    ctx.fillStyle = '#e0453e';
    ctx.beginPath(); ctx.moveTo(T * 0.14, 0); ctx.lineTo(T * 0.04, -T * 0.09); ctx.lineTo(T * 0.04, T * 0.09); ctx.fill();
    ctx.restore();
  } else if (sh.kind === 'boom') {
    const f = sh.t / sh.ttl;
    ctx.globalAlpha = 1 - f;
    ctx.fillStyle = '#ffb24d';
    ctx.beginPath(); ctx.arc(sh.x * T, sh.y * T, sh.r * T * (0.4 + f * 0.8), 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  } else if (sh.kind === 'rail') {
    const a = 1 - sh.t / sh.ttl;
    ctx.globalAlpha = a * (sh.miss ? 0.55 : 1);
    for (const w of [[8, 'rgba(120,190,255,0.35)'], [3.2, '#9fd4ff'], [1.3, '#ffffff']]) {
      ctx.strokeStyle = w[1]; ctx.lineWidth = w[0];
      ctx.beginPath(); ctx.moveTo(sh.x1 * T, sh.y1 * T); ctx.lineTo(sh.x2 * T, sh.y2 * T); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else if (sh.kind === 'nuke') {
    // Nuke: greller Anfangsblitz, doppelte Druckwelle und ein aufsteigender
    // Feuerball, der zur Pilzwolke wird
    const f = sh.t / sh.ttl;
    const x = sh.x * T, y = sh.y * T;
    if (f < 0.16) {
      const D = CW + CH;
      ctx.fillStyle = `rgba(255,250,235,${0.9 * (1 - f / 0.16)})`;
      ctx.fillRect(-D, -D, 2 * D, 2 * D);
    }
    for (const ring of [[0.95, 6, '255,178,77'], [0.7, 3, '255,240,200']]) {
      ctx.strokeStyle = `rgba(${ring[2]},${0.9 * (1 - f)})`;
      ctx.lineWidth = ring[1] * (1 - f) + 1;
      ctx.beginPath(); ctx.arc(x, y, f * GC * T * ring[0], 0, TAU); ctx.stroke();
    }
    const rise = f * T * 2.4;
    const fb = T * (0.5 + f * 1.9);
    // "oben" zeigt im gedrehten Feld Richtung -x
    const ux = ROT ? -1 : 0, uy = ROT ? 0 : -1;
    const bx = x + ux * rise, by = y + uy * rise;
    ctx.globalAlpha = Math.min(1, 1.5 * (1 - f));
    ctx.fillStyle = 'rgba(255,120,40,0.35)';
    ctx.beginPath(); ctx.arc(bx, by, fb * 1.5, 0, TAU); ctx.fill();
    // Pilzstiel unter dem Ball
    ctx.fillStyle = 'rgba(255,150,70,0.4)';
    if (ROT) ctx.fillRect(bx, y - fb * 0.32, rise + fb * 0.2, fb * 0.64);
    else ctx.fillRect(x - fb * 0.32, by, fb * 0.64, rise + fb * 0.2);
    ctx.fillStyle = '#ff9a3c';
    ctx.beginPath(); ctx.arc(bx, by, fb, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffe66e';
    ctx.beginPath(); ctx.arc(bx + ux * fb * 0.15, by + uy * fb * 0.15, fb * 0.62, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff8e0';
    ctx.beginPath(); ctx.arc(bx + ux * fb * 0.22, by + uy * fb * 0.22, fb * 0.3, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  } else if (sh.kind === 'tnuke') {
    const f = sh.t / sh.ttl;
    const x = sh.x * T, y = sh.y * T;
    ctx.globalAlpha = 1 - f;
    ctx.fillStyle = 'rgba(255,240,200,0.8)';
    ctx.beginPath(); ctx.arc(x, y, sh.r * T * 0.4 * (1 - f * 0.5), 0, TAU); ctx.fill();
    ctx.strokeStyle = '#ffb24d'; ctx.lineWidth = 3 + 5 * (1 - f);
    ctx.beginPath(); ctx.arc(x, y, sh.r * T * f, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, sh.r * T * f * 0.65, 0, TAU); ctx.stroke();
    const ux2 = ROT ? -1 : 0, uy2 = ROT ? 0 : -1;
    const rise = f * T * 1.2, fb = T * (0.3 + f * 0.7);
    ctx.fillStyle = '#ff9a3c';
    ctx.beginPath(); ctx.arc(x + ux2 * rise, y + uy2 * rise, fb, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffe66e';
    ctx.beginPath(); ctx.arc(x + ux2 * rise, y + uy2 * rise, fb * 0.55, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  } else if (sh.kind === 'sbeam') {
    const x = sh.x * T, y = sh.y * T;
    const rad = (sh.rad || 1.2) * T;
    if (sh.t < 0.35) {
      // rotes Zielkreuz zieht sich zusammen, dünner Leitstrahl aus dem Orbit
      const g = sh.t / 0.35;
      ctx.strokeStyle = `rgba(255,90,60,${0.45 + g * 0.5})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, T * (1.3 - g * 0.75), 0, TAU); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - T * 0.5, y); ctx.lineTo(x + T * 0.5, y);
      ctx.moveTo(x, y - T * 0.5); ctx.lineTo(x, y + T * 0.5);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,130,100,${0.2 + g * 0.5})`; ctx.lineWidth = 1.2 + g * 1.5;
      ctx.beginPath();
      if (ROT) { ctx.moveTo(-CH, y); ctx.lineTo(x, y); } else { ctx.moveTo(x, -CW); ctx.lineTo(x, y); }
      ctx.stroke();
    } else if (sh.t < 0.85) {
      // Strahl aus dem Orbit: pulsierende Lichtsäule mit weißglühendem Kern
      const p = (sh.t - 0.35) / 0.5;
      const puls = 1 + Math.sin(sh.t * 55) * 0.18;
      const w = T * 0.6 * (1 - p * 0.3) * puls;
      const beamRect = (hw) => {
        if (ROT) ctx.fillRect(-CH, y - hw, x + CH, hw * 2);
        else ctx.fillRect(x - hw, -CW, hw * 2, y + CW);
      };
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#8fd0ff';
      beamRect(w * 1.6);
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#cfeaff';
      beamRect(w * 0.7);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      beamRect(w * 0.28);
      // Aufschlag: grelle Scheibe + expandierende Doppelringe
      ctx.fillStyle = 'rgba(235,248,255,0.95)';
      ctx.beginPath(); ctx.arc(x, y, T * (0.7 + p * 0.4) * puls, 0, TAU); ctx.fill();
      ctx.strokeStyle = `rgba(160,220,255,${0.9 * (1 - p)})`; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(x, y, rad * (0.3 + p * 0.9), 0, TAU); ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,255,${0.7 * (1 - p)})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, rad * p * 1.2, 0, TAU); ctx.stroke();
    } else {
      // glühender Nachbrand am Einschlagspunkt
      const p = (sh.t - 0.85) / (sh.ttl - 0.85);
      ctx.globalAlpha = (1 - p) * 0.7;
      ctx.fillStyle = '#ff9a5c';
      ctx.beginPath(); ctx.ellipse(x, y, rad * 0.75, rad * 0.5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffe6b0';
      ctx.beginPath(); ctx.ellipse(x, y, rad * 0.4, rad * 0.26, 0, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (sh.kind === 'coin') {
    ctx.globalAlpha = 1 - sh.t / sh.ttl;
    ctx.fillStyle = '#ffd166'; ctx.font = (T * 0.36) + 'px system-ui'; ctx.textAlign = 'center';
    fText('+' + sh.v, sh.x * T, (sh.y - sh.t * 1.2) * T);
    ctx.globalAlpha = 1;
  }
}

function drawHUD() {
  ctx.fillStyle = 'rgba(8,25,42,0.78)'; roundRectP(8, 8, CW - 16, 40, 9); ctx.fill();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left'; ctx.fillStyle = '#ffd166'; ctx.font = 'bold 15px system-ui';
  ctx.fillText('💰 ' + game.money, 148, 28);
  ctx.fillStyle = '#eaf3fa';
  ctx.fillText('❤️ ' + game.lives, 238, 28);
  ctx.textAlign = 'right'; ctx.fillStyle = '#9fc0d8'; ctx.font = '13px system-ui';
  ctx.fillText('Welle ' + game.wave + ' · Best ' + game.best, CW - 14, 28);
  ctx.textBaseline = 'alphabetic';

  if (game.targeting === 'slaser') {
    ctx.fillStyle = '#ff8a6a'; ctx.font = 'bold 14px system-ui'; ctx.textAlign = 'center';
    ctx.fillText(kidsMode ? '🚿 Ziel für den Mega-Wasserstrahl antippen!' : '🛰️ Ziel fürs Orbital-Laser antippen!', CW / 2, OY - 10);
  }

  // Countdown zur nächsten Welle
  if (game.state === 'build' && game.wave > 0 && game.nextT > 0) {
    ctx.fillStyle = '#9fc0d8'; ctx.font = '12px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('Nächste Welle in ' + Math.ceil(game.nextT) + 's – ▶ für Frühstart-Bonus', CW / 2, OY - 10);
  }
  if (game.wave === 0) {
    ctx.fillStyle = '#ffd166'; ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('Baue Türme und starte mit ▶ die erste Welle!', CW / 2, OY - 10);
  }

  if (game.bannerT > 0) {
    ctx.globalAlpha = clamp(game.bannerT, 0, 1);
    centerText(game.banner, '#fff');
    ctx.globalAlpha = 1;
  }
  if (game.state === 'over') {
    centerText('💀 Game Over – Welle ' + game.wave, '#ff6a5a');
    ctx.fillStyle = '#9fc0d8'; ctx.font = '13px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('Tippe für ein neues Spiel', CW / 2, OY + (ROT ? GC : GR) * T / 2 + 34);
  }
}
function centerText(text, color) {
  const y = OY + (ROT ? GC : GR) * T / 2;
  ctx.fillStyle = 'rgba(8,16,30,0.8)'; roundRectP(CW / 2 - 165, y - 26, 330, 46, 10); ctx.fill();
  ctx.fillStyle = color; ctx.font = 'bold 19px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, CW / 2, y - 3); ctx.textBaseline = 'alphabetic';
}
// Schadenszahlen kompakt: 950 · 5,3k · 1,2M
function fmtCount(v) {
  if (v >= 1e6) return (Math.round(v / 1e5) / 10).toLocaleString('de-DE') + 'M';
  if (v >= 1000) return (Math.round(v / 100) / 10).toLocaleString('de-DE') + 'k';
  return String(Math.round(v));
}
// Text im Feld aufrecht zeichnen, auch wenn das Feld gedreht ist
function fText(txt, x, y) {
  if (!ROT) { ctx.fillText(txt, x, y); return; }
  ctx.save(); ctx.translate(x, y); ctx.rotate(-Math.PI / 2); ctx.fillText(txt, 0, 0); ctx.restore();
}
function roundRectP(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ---- Bau- & Upgrade-UI -----------------------------------------------------
const buildbar = document.getElementById('buildbar');
const upgpanel = document.getElementById('upgpanel');

function hidePanels() { buildbar.classList.add('hidden'); upgpanel.classList.add('hidden'); game.sel = null; }

function showBuildbar() {
  buildbar.innerHTML = '';
  for (const key of Object.keys(TOWERS)) {
    const def = tInfo(key);
    const cost = def.levels[0].cost;
    const b = document.createElement('button');
    b.className = 'tdt' + (game.money < cost ? ' broke' : '');
    b.innerHTML = `<span class="ti">${def.icon}</span><span class="tn">${def.name}</span><span class="tc">${cost} 💰</span>`;
    b.title = def.desc;
    if (game.money >= cost) b.addEventListener('click', () => buildTower(key));
    buildbar.appendChild(b);
  }
  buildbar.classList.remove('hidden');
  upgpanel.classList.add('hidden');
}

function buildTower(type) {
  const def = TOWERS[type];
  const cost = def.levels[0].cost;
  if (!game.sel || game.money < cost) return;
  const k = game.sel.x + ',' + game.sel.y;
  if (towerAt[k] || isPath(game.sel.x, game.sel.y) || isPond(game.sel.x, game.sel.y)) return;
  game.money -= cost;
  const t = { type, lvl: 0, x: game.sel.x, y: game.sel.y, cd: 0, angle: 0, born: 0, kills: 0 };
  towers.push(t);
  towerAt[k] = t;
  buildDust(t);
  updateSupers();
  saveState();
  showUpgpanel(t);
}

// Staubwölkchen beim Bauen
function buildDust(t) {
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * TAU;
    spawnPart({ kind: 'smoke', x: t.x + 0.5 + Math.cos(a) * 0.25, y: t.y + 0.75, vx: Math.cos(a) * 1.1, vy: -0.3 - Math.random() * 0.4, ttl: 0.5 + Math.random() * 0.25, size: 0.12 + Math.random() * 0.08, dust: true });
  }
}

function sellValue(t) {
  let paid = 0;
  for (let i = 0; i <= t.lvl; i++) paid += levelStats(t.type, i).cost;
  return Math.round(paid * 0.7);
}

function showUpgpanel(t) {
  buildbar.classList.add('hidden');
  const def = tInfo(t.type), s = effStats(t);
  const next = levelStats(t.type, t.lvl + 1);
  const info = document.getElementById('upg-info');
  const statBits = [];
  if (s.dmg) statBits.push('Schaden ' + Math.round(s.dmg));
  if (s.dps) statBits.push('Schaden ' + s.dps + '/s');
  if (s.rate && t.type !== 'gift') statBits.push(s.rate + ' Schuss/s');
  if (s.slow) statBits.push('-' + Math.round(s.slow * 100) + '% Tempo');
  if (s.splash) statBits.push('Fläche ' + s.splash);
  if (s.burn) statBits.push('+' + s.burn + '/s ' + (kidsMode ? 'Nachgeruch' : 'Brand'));
  if (s.charge) statBits.push('+' + s.charge + '/s ' + (kidsMode ? 'Duft' : 'Verstrahlung') + ' · max ' + s.cap + '/s');
  if (s.boost) statBits.push('Feuerrate ×' + s.boost + ' für ' + tInfo('mg').name + ', ' + tInfo('cannon').name + ' & ' + tInfo('railgun').name + ' daneben');
  if (s.boosted) statBits.push(tInfo('loader').icon + ' ' + tInfo('loader').name + ' aktiv: Feuerrate ×' + s.boosted);
  if (t.type === 'improb') statBits.push('verwürfelt 1 Monster pro Schuss (je nur 1×, keine Bosse)');
  if (s.acc) statBits.push('trifft Kleine zu ' + Math.round(s.acc * 100) + '% · Bosse immer, ×' + s.bossMul);
  if (s.factor) statBits.push((kidsMode ? 'Zauber ' : 'Hypnose ') + s.dur + ' s · ' + (kidsMode ? 'Schubs ' : 'Biss ') + Math.round(s.factor * 100) + '% seiner Max-HP/s');
  if (s.aud) statBits.push('fesselt ' + s.aud + ' Zuschauer · ' + s.dur + ' s Programm');
  if (s.chain) statBits.push(s.chain + ' Kettenziele');
  if (s.cone) statBits.push('Kegel ' + Math.round(s.cone * 2 * 180 / Math.PI) + '°');
  if (s.gold) statBits.push('+' + s.gold + ' 💰 alle ' + s.interval + ' s');
  if (s.pool) statBits.push('Pfütze ' + (Math.round(s.pool * 100) / 100) + ' · ' + (Math.round(s.dur * 10) / 10) + ' s');
  if (s.range) statBits.push('Reichweite ' + (Math.round(s.range * 10) / 10));
  if (t.type === 'command') statBits.push((kidsMode ? '🪅 ' : '☢️ ') + s.nuke + ' Schaden', (kidsMode ? '🚿 ' : '🛰️ ') + s.beam + ' Schaden · Radius ' + s.brad, 'gegen Bosse 3× · durch jede Panzerung');
  if (!['gold', 'ice', 'wind', 'loader', 'improb', 'tv'].includes(t.type)) statBits.push('💀 ' + (t.kills || 0) + ' Abschüsse · 💥 ' + fmtCount(t.dmgDone || 0) + ' Schaden');
  info.textContent = `${def.icon} ${def.name} · Stufe ${t.lvl + 1}${t.lvl >= 3 ? '👑' : '⭐'.repeat(t.lvl)} · ${statBits.join(' · ')}`;
  const up = document.getElementById('upg-up');
  if (next) {
    up.textContent = `⬆ Upgrade (${next.cost} 💰)`;
    up.disabled = game.money < next.cost;
    up.onclick = () => {
      if (game.money < next.cost) return;
      game.money -= next.cost; t.lvl++;
      saveState();
      showUpgpanel(t);
    };
  } else {
    up.textContent = '⭐ Max. Stufe';
    up.disabled = true;
    up.onclick = null;
  }
  const sell = document.getElementById('upg-sell');
  sell.textContent = `💰 Verkaufen (${sellValue(t)})`;
  sell.onclick = () => {
    game.money += sellValue(t);
    towers = towers.filter((x) => x !== t);
    delete towerAt[t.x + ',' + t.y];
    updateSupers();
    saveState();
    hidePanels();
  };
  renderSpecs(t);
  upgpanel.classList.remove('hidden');
}
// Spezialisierung: einmalige, exklusive Entweder-oder-Wahl pro Turm
function renderSpecs(t) {
  const box = document.getElementById('upg-ammo');
  const list = SPECS[t.type];
  if (!list) { box.classList.add('hidden'); return; }
  box.innerHTML = '';
  if (t.spec) {
    const a = sInfo(t.type, list.find((o) => o.key === t.spec));
    const div = document.createElement('div');
    div.className = 'ammo-chosen';
    div.textContent = `${a.icon} ${a.name} gewählt – ${a.desc}`;
    box.appendChild(div);
  } else {
    for (const a0 of list) {
      const a = sInfo(t.type, a0);
      const b = document.createElement('button');
      b.className = 'ammo-btn';
      b.textContent = `${a.icon} ${a.name} (${a.cost} 💰)`;
      b.title = a.desc;
      b.disabled = game.money < a.cost;
      b.addEventListener('click', () => {
        if (game.money < a.cost || t.spec) return;
        game.money -= a.cost;
        t.spec = a0.key;
        saveState();
        showUpgpanel(t);   // Stats & Anzeige auffrischen
      });
      box.appendChild(b);
    }
  }
  box.classList.remove('hidden');
}
document.getElementById('upg-close').addEventListener('click', hidePanels);

// Schwierigkeit umschalten (startet neues Spiel)
for (const key of ['leicht', 'normal', 'schwer']) {
  document.getElementById('diff-' + key).addEventListener('click', () => {
    DIFF = DIFFS[key];
    for (const k2 of ['leicht', 'normal', 'schwer']) document.getElementById('diff-' + k2).classList.toggle('active', k2 === key);
    menuEl.classList.add('hidden');
    newGame();
  });
}

canvas.addEventListener('pointerdown', (e) => {
  if (game.state === 'over') { newGame(); return; }
  if (game.targeting === 'slaser') {
    const { wx, wy } = toField(e.clientX, e.clientY);
    if (wx >= 0 && wx < GC && wy >= 0 && wy < GR) fireSlaser(wx, wy);
    else { game.targeting = null; updateSupers(); }
    return;
  }
  const { wx, wy } = toField(e.clientX, e.clientY);
  const gx = Math.floor(wx);
  const gy = Math.floor(wy);
  if (gx < 0 || gx >= GC || gy < 0 || gy >= GR) { hidePanels(); return; }
  const k = gx + ',' + gy;
  game.sel = { x: gx, y: gy };
  if (towerAt[k]) showUpgpanel(towerAt[k]);
  else if (!isPath(gx, gy) && !isPond(gx, gy)) showBuildbar();
  else hidePanels();
});

// ---- Toolbar ---------------------------------------------------------------
const speedBtn = document.getElementById('btn-speed');
function updateSpeedBtn() { speedBtn.textContent = '⏩' + game.speed + '×'; }
speedBtn.addEventListener('click', () => {
  game.speed = game.speed === 1 ? 2 : game.speed === 2 ? 3 : game.speed === 3 ? 5 : 1;
  updateSpeedBtn();
});
document.getElementById('btn-wave').addEventListener('click', () => { if (game.state === 'build') startWave(); });

const nukeBtn = document.getElementById('btn-nuke');
const slaserBtn = document.getElementById('btn-slaser');
function updateSupers() {
  const has = hasCommand();
  nukeBtn.classList.toggle('hidden', !has);
  slaserBtn.classList.toggle('hidden', !has);
  nukeBtn.disabled = game.nukeUsed;
  slaserBtn.disabled = game.laserUsed || game.targeting === 'slaser';
  // Kids-Modus: aus Nuke wird Piñata, aus Orbital-Laser der Wasserstrahl
  nukeBtn.textContent = kidsMode ? '🪅' : '☢️';
  slaserBtn.textContent = kidsMode ? '🚿' : '🛰️';
  nukeBtn.title = (kidsMode ? 'Riesen-Piñata' : 'Nuke') + ' – 1× pro Welle';
  slaserBtn.title = (kidsMode ? 'Mega-Wasserstrahl' : 'Orbital-Laser') + ' – 1× pro Welle';
}
nukeBtn.addEventListener('click', () => {
  if (!hasCommand() || game.nukeUsed || game.state === 'over') return;
  fireNuke();
});
slaserBtn.addEventListener('click', () => {
  if (!hasCommand() || game.laserUsed || game.state === 'over') return;
  game.targeting = 'slaser';
  updateSupers();
});

const menuEl = document.getElementById('menu');
const helpEl = document.getElementById('help');
document.getElementById('btn-menu').addEventListener('click', () => menuEl.classList.remove('hidden'));
document.getElementById('btn-menu-close').addEventListener('click', () => menuEl.classList.add('hidden'));
menuEl.addEventListener('click', (e) => { if (e.target === menuEl) menuEl.classList.add('hidden'); });
document.getElementById('btn-help').addEventListener('click', () => { menuEl.classList.add('hidden'); helpEl.classList.remove('hidden'); });
document.getElementById('btn-start').addEventListener('click', () => helpEl.classList.add('hidden'));
document.getElementById('btn-restart').addEventListener('click', () => { menuEl.classList.add('hidden'); newGame(); });
// ---- Statistik-Ansicht -----------------------------------------------------
const EINFO = {
  blob: ['🟢', 'Blob'], runner: ['🟡', 'Renner'], tank: ['🟣', 'Panzer'],
  regen: ['♻️', 'Regenerierer'], ember: ['🔥', 'Glutläufer'], prisma: ['💎', 'Prisma'],
  blitzer: ['⚡', 'Geerdeter'], boss: ['👹', 'Boss'],
};
const statsEl = document.getElementById('stats');
function historyHtml() {
  if (!history.length) return '';
  let html = '<div class="stats-h">📜 Spiel-Historie</div>'
    + '<div class="stats-wrap"><table class="stats-table"><tr><th>Datum</th><th>Grad</th><th>Welle</th><th>💀</th><th>💥</th><th>Top</th></tr>';
  for (const run of history.slice(0, 15)) {
    const d = new Date(run.ts).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const icon = run.top && TOWERS[run.top] ? tInfo(run.top).icon : '–';
    html += `<tr><td>${run.end === 'over' ? '💀' : '🚪'} ${d}</td><td>${(DIFFS[run.diff] || { label: run.diff }).label}</td>`
      + `<td>${run.wave}</td><td>${run.kills}</td><td>${fmtCount(run.dmg)}</td><td>${icon}</td></tr>`;
  }
  html += '</table></div><p class="stats-note">💀 Game Over · 🚪 aufgegeben · Top = Turmart mit dem meisten Schaden. '
    + 'Die letzten ' + Math.min(history.length, 15) + ' von max. 50 Partien – eingeloggt wandert die Historie mit in die Datenbank.</p>';
  return html;
}
function renderStats() {
  const body = document.getElementById('stats-body');
  const types = Object.keys(stats.types).filter((k) => TOWERS[k]);
  if (!types.length) {
    body.innerHTML = '<p class="stats-note">Noch keine Daten – erst mal ballern! Kills und Schaden werden pro Turmart gesammelt (auch von inzwischen verkauften Türmen).</p>' + historyHtml();
    return;
  }
  types.sort((a, b) => (stats.types[b].dmg - stats.types[a].dmg) || (stats.types[b].kills - stats.types[a].kills));
  let totalKills = 0, totalDmg = 0;
  let html = '<div class="stats-h">Turmarten im Vergleich</div>'
    + '<p class="stats-note">Zählt alles seit Spielstart, auch verkaufte Türme. Einzelne Türme zeigen ihre Werte im Upgrade-Panel.</p>'
    + '<div class="stats-wrap"><table class="stats-table"><tr><th>Turmart</th><th>aktiv</th><th>💀 Kills</th><th>💥 Schaden</th></tr>';
  for (const k of types) {
    const st = stats.types[k];
    totalKills += st.kills; totalDmg += st.dmg;
    const active = towers.filter((t) => t.type === k).length;
    html += `<tr><td>${tInfo(k).icon} ${tInfo(k).name}</td><td>${active}×</td><td>${st.kills}</td><td>${fmtCount(st.dmg)}</td></tr>`;
  }
  html += `<tr class="total"><td>Gesamt</td><td>${towers.length}×</td><td>${totalKills}</td><td>${fmtCount(totalDmg)}</td></tr></table></div>`;

  // Matrix: welche Turmart hat welche Monsterart erledigt?
  const killers = types.filter((k) => stats.vs[k] && Object.keys(stats.vs[k]).length);
  const monsters = Object.keys(EINFO).filter((m) => killers.some((k) => stats.vs[k][m]));
  if (killers.length && monsters.length) {
    html += '<div class="stats-h">Wer erlegt welche Monster?</div>'
      + '<div class="stats-wrap"><table class="stats-table"><tr><th></th>'
      + monsters.map((m) => `<th title="${EINFO[m][1]}">${EINFO[m][0]}</th>`).join('') + '</tr>';
    for (const k of killers) {
      html += `<tr><td>${tInfo(k).icon} ${tInfo(k).name}</td>`
        + monsters.map((m) => `<td>${stats.vs[k][m] || '–'}</td>`).join('') + '</tr>';
    }
    const legend = monsters.map((m) => `${EINFO[m][0]} ${EINFO[m][1]}`).join(' · ');
    html += `</table></div><p class="stats-note">${legend}</p>`;
  }
  html += historyHtml();
  body.innerHTML = html;
}
document.getElementById('btn-stats').addEventListener('click', () => {
  menuEl.classList.add('hidden');
  renderStats();
  statsEl.classList.remove('hidden');
});
document.getElementById('btn-stats-close').addEventListener('click', () => statsEl.classList.add('hidden'));
statsEl.addEventListener('click', (e) => { if (e.target === statsEl) statsEl.classList.add('hidden'); });

// ---- Hilfe-Menü: Dropdowns je Turm- und Gegnerart --------------------------
const TIPS = {
  mg: 'Früh billig; mit ⚙️ Auto-Lader daneben wird es eine Kreissäge. 🔩 Wolframkern knackt Panzer.',
  cannon: 'Lange Reichweite – wirkt über mehrere Pfadschleifen. Erste Wahl gegen Panzerung.',
  grenade: 'An Kurven und Doppelpfaden stellen, wo Gruppen dicht laufen. Prallt an Panzerung ab.',
  laser: 'An lange Geraden bauen – trifft alles auf der Linie und schält nebenbei Panzerung.',
  flame: 'Der Kegel schwenkt zum nächsten Gegner; Brand wirkt nach. Gegen 🔥 Glutläufer nutzlos.',
  rocket: 'Zielsuchend, verfehlt nie. Mit ☢️ Taktischer Nuke die Endgame-Flächenwaffe.',
  ice: 'Macht keinen Schaden, ist aber Gold wert: an Kurven bremsen, dahinter draufhauen.',
  tesla: 'Stark gegen Pulks – der Blitz springt weiter. ⚡ Geerdete lachen nur darüber.',
  ray: 'Verstrahlung bleibt für immer und ignoriert Panzerung – vorne markieren, hinten sterben lassen.',
  loader: 'Passiv! Direkt neben MG, Kanone oder Railgun stellen – nur der beste Lader daneben zählt.',
  improb: 'Glücksspiel: verwandelt Panzer in Blobs – oder in Renner. Am besten auf dicke Brocken.',
  railgun: 'Der Boss-Killer: trifft Bosse immer, 3× Schaden, durch jede Panzerung. Kleine verfehlt sie oft.',
  hypno: 'Hypnotisierte stehen still und beißen Nachbarn – je fetter das Opfer, desto härter der Biss.',
  tv: 'Hält die Vordersten vor der Kill-Zone fest, während die Türme dahinter arbeiten. Niemand hängt ewig: nach dem Programm ist jeder kurz immun.',
  gift: 'Pfützen liegen auf dem Weg und ätzen jeden, der durchläuft. Länge vor Fläche an Engstellen.',
  wind: 'Verzögert den Vordersten (¾-Regel: niemand hängt ewig fest). Gut vor der Kill-Zone.',
  gold: 'Früh gebaut zahlt sie sich über die Wellen aus. In eine ruhige Ecke stellen.',
  command: 'Schaltet ☢️ Nuke und 🛰️ Orbital-Laser frei (je 1× pro Welle, gegen Bosse 3× und durch jede Panzerung). Endlos ausbaubar – jede weitere Stufe kostet ein Vermögen.',
};
const MAINSTAT = {
  mg: ['dmg', 'Schaden'], cannon: ['dmg', 'Schaden'], grenade: ['dmg', 'Schaden'],
  rocket: ['dmg', 'Schaden'], tesla: ['dmg', 'Schaden'], railgun: ['dmg', 'Schaden'],
  laser: ['dps', 'Schaden/s'], flame: ['dps', 'Schaden/s'], gift: ['dps', 'Gift/s'],
  ice: ['slow', 'Tempo-Malus', (v) => Math.round(v * 100) + '%'],
  wind: ['rate', 'Stöße/s'], improb: ['rate', 'Würfe/s'],
  ray: ['charge', 'Verstrahlung/s'], gold: ['gold', 'Gold'],
  loader: ['boost', 'Feuerrate', (v) => '×' + v],
  hypno: ['factor', 'Biss', (v) => Math.round(v * 100) + '% MaxHP/s'],
  tv: ['dur', 'Ablenkung', (v) => v + ' s'],
  command: ['nuke', '☢️-Schaden'],
};
const EHELP = {
  blob: { wave: 1, desc: 'Das Standardmonster: mittleres Tempo, keine Extras.', tip: 'Futter für alles – gut zum Gold sammeln.' },
  runner: { wave: 2, desc: 'Flitzt mit fast doppeltem Tempo, hat dafür wenig HP.', tip: '❄️ Vereiser und 🌪️ Wind bremsen; schnelle Türme wie das MG fangen ihn ab.' },
  tank: { wave: 4, desc: 'Zäher Brocken mit grauer Rüstung, die Feuer, Blitz, Explosion und Gift fast komplett schluckt.', tip: 'Kinetik (MG/Kanone), Laser, 🧲 Railgun oder ☣️ Verstrahlung – oder per 🎲 verwandeln.' },
  regen: { wave: 7, desc: 'Heilt sich stetig selbst.', tip: 'Fokus-Schaden statt Dauer-Gekleckere – oder permanente ☣️ Verstrahlung, die heilt er nicht weg.' },
  ember: { wave: 10, desc: 'Feuerresistent: nimmt nur 10 % Feuerschaden, auch vom Brand.', tip: 'Flammenwerfer sparen – alles andere wirkt normal.' },
  prisma: { wave: 12, desc: 'Laserresistent: Laserstrahlen wirken fast gar nicht.', tip: 'Kinetik, Explosion oder Blitz nehmen – der 📡 Laser darf Pause machen.' },
  blitzer: { wave: 14, desc: 'Geerdet: Blitzschaden verpufft (10 %), und flott ist er auch noch.', tip: 'Der ⚡ Blitzturm überspringt ihn gefühlt – MG, Kanone oder Flächenschaden nutzen.' },
  boss: { wave: 8, desc: 'Alle 8 Wellen, riesig, kostet 5 ❤️, ab Welle 16 im Rudel und meist dick gepanzert. Immun gegen Hypnose und Verwandlung, Fernsehen findet er nur kurz spannend.', tip: '🧲 Railgun (3–6× Schaden, immer Treffer) plus ☢️/🛰️ Superwaffen bereithalten.' },
};
function renderHelp() {
  // Kommandozentrale: Ende offen – die Stufenketten enden mit "…"
  const chain = (k, def) => {
    const m = MAINSTAT[k];
    if (!m || def.levels[0][m[0]] === undefined) return '';
    const fmt = m[2] || ((v) => v);
    const label = (kidsMode && KIDS_MAINLBL[k]) || m[1];
    return ' · ' + label + ': ' + def.levels.map((l) => fmt(l[m[0]])).join(' → ') + (k === 'command' ? ' → …' : '');
  };
  let html = '';
  for (const k of Object.keys(TOWERS)) {
    const def = tInfo(k);
    const costs = def.levels.map((l) => l.cost).join(' → ') + (k === 'command' ? ' → …' : '');
    const specs = (SPECS[k] || [])
      .map((sp0) => { const sp = sInfo(k, sp0); return `${sp.icon} <b>${sp.name}</b> (${sp.cost} 💰): ${sp.desc}`; }).join('<br>');
    html += `<details class="hd"><summary>${def.icon} ${def.name}</summary><div class="hd-body">`
      + `<p>${def.desc}.</p>`
      + `<p>💡 ${(kidsMode && KIDS_TIPS[k]) || TIPS[k] || ''}</p>`
      + `<p>⬆ Stufen: ${costs} 💰${chain(k, def)}</p>`
      + (specs ? `<p>🎛 Spezialisierung (einmalig, entweder/oder):<br>${specs}</p>` : '')
      + '</div></details>';
  }
  document.getElementById('help-towers').innerHTML = html;
  let eh = '';
  for (const [k, info] of Object.entries(EHELP)) {
    eh += `<details class="hd"><summary>${EINFO[k][0]} ${EINFO[k][1]} · ab Welle ${info.wave}</summary>`
      + `<div class="hd-body"><p>${info.desc}</p><p>💡 ${info.tip}</p></div></details>`;
  }
  document.getElementById('help-enemies').innerHTML = eh;
}
renderHelp();

// Manuell speichern: sichert sofort (Banner als Bestätigung)
document.getElementById('btn-save').addEventListener('click', () => {
  menuEl.classList.add('hidden');
  if (game.state === 'over' || (game.wave === 0 && !towers.length)) {
    game.banner = 'Nichts zu speichern – erst bauen oder spielen!';
    game.bannerT = 1.8;
    return;
  }
  saveState();
  const online = authHeaders() ? ' – auch online' : '';
  game.banner = game.state === 'wave'
    ? '💾 Gespeichert! Weiter geht es ab Start von Welle ' + game.wave + online
    : '💾 Spielstand gespeichert' + online;
  game.bannerT = 2.2;
});

const killsBtn = document.getElementById('btn-kills');
function updateKillsBtn() { killsBtn.textContent = '💀 Abschuss-Zähler: ' + (showKills ? 'an' : 'aus'); }
killsBtn.addEventListener('click', () => {
  showKills = !showKills;
  try { localStorage.setItem('td_kills', showKills ? '1' : '0'); } catch { /* egal */ }
  updateKillsBtn();
});
updateKillsBtn();

// Kids-Modus umschalten: nur die Anzeige wechselt, das Spiel läuft weiter
const kidsBtn = document.getElementById('btn-kids');
function updateKidsBtn() { kidsBtn.textContent = '🧸 Kids-Modus: ' + (kidsMode ? 'an' : 'aus'); }
function setKidsMode(on) {
  kidsMode = !!on;
  try { localStorage.setItem('td_kids', kidsMode ? '1' : '0'); } catch { /* egal */ }
  updateKidsBtn();
  updateSupers();
  renderHelp();
  if (!buildbar.classList.contains('hidden')) showBuildbar();
  if (!upgpanel.classList.contains('hidden')) {
    const t = game.sel && towerAt[game.sel.x + ',' + game.sel.y];
    if (t) showUpgpanel(t); else hidePanels();
  }
  if (!statsEl.classList.contains('hidden')) renderStats();
}
kidsBtn.addEventListener('click', () => setKidsMode(!kidsMode));
updateKidsBtn();

// ---- Schleife --------------------------------------------------------------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  for (let i = 0; i < game.speed; i++) update(dt);
  draw(now / 1000);
  requestAnimationFrame(frame);
}

window.__td = { game, get towers() { return towers; }, get enemies() { return enemies; },
  get geom() { return { T, OX, OY, ROT }; },
  get stats() { return stats; },
  get history() { return history; },
  TOWERS, SPECS, KIDS, PATH, isPath, startWave, newGame, update, effStats, fireNuke, fireSlaser,
  saveState, applySave, tryRestore, tInfo, setKidsMode,
  get kidsMode() { return kidsMode; },
  get shots() { return shots; },
  place(type, x, y) {
    const k = x + ',' + y;
    if (towerAt[k] || isPath(x, y) || isPond(x, y)) return null;
    const cost = TOWERS[type].levels[0].cost;
    if (game.money < cost) return null;
    game.money -= cost;
    const t = { type, lvl: 0, x, y, cd: 0, angle: 0, born: 0, kills: 0 };
    towers.push(t); towerAt[k] = t;
    buildDust(t);
    updateSupers();
    return t;
  },
  upgrade(t) {
    const next = levelStats(t.type, t.lvl + 1);
    if (!next || game.money < next.cost) return false;
    game.money -= next.cost; t.lvl++;
    return true;
  } };

loadBest();
resize();
newGame(true);       // Spielstand nicht anfassen – gleich prüfen wir, ob einer da ist
tryRestore();
loadHistory();
requestAnimationFrame(frame);
