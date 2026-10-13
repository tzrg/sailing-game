// 🧮 Rechen-Rallye – Lernspiel zum Kopfrechnen auf dem Stand der 2. Klasse.
//
// Der Aufgaben-Generator kennt rund zwanzig Aufgabenarten (Plus/Minus im
// Zahlenraum bis 100, Verdoppeln/Halbieren, das kleine Einmaleins, Teilen,
// Platzhalter, Rechenketten und kleine Sachaufgaben). Jede Stufe schaltet eine
// neue Art frei; gerechnet wird überwiegend mit dem Neuesten, der alte Stoff
// kommt zur Wiederholung dazwischen. Für jede gelöste Aufgabe gibt es Punkte
// (mehr auf höheren Stufen, extra für Serien und schnelles Rechnen).

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ------------------------------------------------------- Aufgaben-Fabrik -- */

// Zufall: eigener Generator, damit Tests mit fester Saat reproduzierbar sind
let rngState = (Math.random() * 1e9) | 0;
function rng() {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 4294967296;
}
const ri = (a, b) => a + Math.floor(rng() * (b - a + 1));   // ganze Zahl a..b
const pick = (arr) => arr[Math.floor(rng() * arr.length)];

// Sachaufgaben-Vorlagen (Zahlen werden eingesetzt)
const STORIES = [
  { op: '+', t: (a, b) => `🍎 Lina pflückt ${a} Äpfel und findet noch ${b}. Wie viele hat sie?` },
  { op: '+', t: (a, b) => `🚗 Auf dem Parkplatz stehen ${a} Autos, ${b} kommen dazu. Wie viele sind es?` },
  { op: '+', t: (a, b) => `⭐ Tim sammelt ${a} Sticker, Mia schenkt ihm ${b}. Wie viele hat er dann?` },
  { op: '-', t: (a, b) => `🐑 Auf der Wiese stehen ${a} Schafe, ${b} laufen weg. Wie viele bleiben?` },
  { op: '-', t: (a, b) => `🍪 Im Glas sind ${a} Kekse, ${b} werden gegessen. Wie viele bleiben übrig?` },
  { op: '-', t: (a, b) => `📚 Ein Regal hat ${a} Bücher, ${b} werden ausgeliehen. Wie viele stehen noch da?` },
  { op: '*', t: (a, b) => `🧁 ${a} Kinder bekommen je ${b} Muffins. Wie viele Muffins sind das?` },
  { op: '*', t: (a, b) => `🚲 ${a} Fahrräder haben je ${b} Räder. Wie viele Räder sind das?` },
  { op: ':', t: (a, b) => `🎈 ${a} Luftballons werden gerecht an ${b} Kinder verteilt. Wie viele bekommt jedes Kind?` },
  { op: ':', t: (a, b) => `🍓 ${a} Erdbeeren kommen gleichmäßig auf ${b} Teller. Wie viele liegen auf einem Teller?` },
];

// Jede Aufgabenart: ab welcher Stufe sie vorkommt, ein Name fürs Menü und die
// Bauanleitung. lvl ist die aktuelle Stufe (für größere Zahlen auf hohen Stufen).
const TYPES = [
  {
    key: 'add10', from: 1, name: 'Plus und Minus bis 10',
    make: () => { const a = ri(1, 9), b = ri(1, 10 - a); return { q: `${a} + ${b}`, a: a + b }; },
  },
  {
    key: 'sub10', from: 1, name: 'Plus und Minus bis 10',
    make: () => { const a = ri(3, 10), b = ri(1, a); return { q: `${a} − ${b}`, a: a - b }; },
  },
  {
    key: 'add20', from: 2, name: 'Plus und Minus bis 20',
    make: () => { const a = ri(10, 17), b = ri(1, 9 - (a % 10)); return { q: `${a} + ${b}`, a: a + b }; },
  },
  {
    key: 'sub20', from: 2, name: 'Plus und Minus bis 20',
    make: () => { const a = ri(12, 19), b = ri(1, a % 10); return { q: `${a} − ${b}`, a: a - b }; },
  },
  {
    key: 'add20c', from: 3, name: 'Zehnerübergang',
    make: () => { const a = ri(4, 9), b = ri(11 - a, 9); return { q: `${a} + ${b}`, a: a + b }; },
  },
  {
    key: 'sub20c', from: 3, name: 'Zehnerübergang',
    make: () => { const a = ri(11, 18), b = ri((a % 10) + 1, 9); return { q: `${a} − ${b}`, a: a - b }; },
  },
  {
    key: 'double', from: 4, name: 'Verdoppeln und Halbieren',
    make: () => {
      if (rng() < 0.5) { const a = ri(6, 25); return { q: `Verdopple ${a}`, a: a * 2, hint: `${a} + ${a}` }; }
      const h = ri(4, 25); return { q: `Halbiere ${h * 2}`, a: h, hint: `${h * 2} : 2` };
    },
  },
  {
    key: 'tens', from: 4, name: 'Zehnerzahlen',
    make: () => {
      const a = ri(2, 8) * 10;
      if (rng() < 0.5) { const b = ri(1, 9 - a / 10) * 10; return { q: `${a} + ${b}`, a: a + b }; }
      const b = ri(1, a / 10) * 10; return { q: `${a} − ${b}`, a: a - b };
    },
  },
  {
    key: 'add100', from: 5, name: 'Plus und Minus bis 100',
    make: () => {
      const az = ri(1, 7), ae = ri(1, 8);
      const bz = ri(1, 9 - az), be = ri(1, 9 - ae);
      const a = az * 10 + ae, b = bz * 10 + be;
      return { q: `${a} + ${b}`, a: a + b };
    },
  },
  {
    key: 'sub100', from: 5, name: 'Plus und Minus bis 100',
    make: () => {
      const az = ri(3, 9), ae = ri(2, 9);
      const bz = ri(1, az - 1), be = ri(1, ae);
      const a = az * 10 + ae, b = bz * 10 + be;
      return { q: `${a} − ${b}`, a: a - b };
    },
  },
  {
    key: 'mal2', from: 6, name: 'Einmaleins mit 2, 5 und 10',
    make: () => { const a = pick([2, 5, 10]), b = ri(2, 10); return { q: `${a} · ${b}`, a: a * b, hint: `${b}-mal die ${a}` }; },
  },
  {
    key: 'word', from: 6, name: 'Sachaufgaben',
    make: (lvl) => {
      const s = pick(STORIES);
      if (s.op === '+') { const a = ri(8, 40 + lvl * 2), b = ri(3, 30); return { q: s.t(a, b), a: a + b, story: true }; }
      if (s.op === '-') { const a = ri(14, 50 + lvl * 2), b = ri(3, 13); return { q: s.t(a, b), a: a - b, story: true }; }
      if (s.op === '*') { const a = ri(2, 10), b = pick([2, 3, 4, 5, 10]); return { q: s.t(a, b), a: a * b, story: true }; }
      const b = pick([2, 3, 4, 5]), e = ri(2, 10); return { q: s.t(b * e, b), a: e, story: true };
    },
  },
  {
    key: 'add100c', from: 7, name: 'Plus mit Übergang bis 100',
    make: () => {
      const a = ri(14, 79), b = ri(10 - (a % 10) + 1, 29);
      return { q: `${a} + ${b}`, a: a + b };
    },
  },
  {
    key: 'sub100c', from: 8, name: 'Minus mit Übergang bis 100',
    make: () => {
      const a = ri(22, 95), b = ri((a % 10) + 1, Math.min(a - 1, (a % 10) + 19));
      return { q: `${a} − ${b}`, a: a - b };
    },
  },
  {
    key: 'mal3', from: 9, name: 'Einmaleins mit 3 und 4',
    make: () => { const a = pick([3, 4]), b = ri(2, 10); return { q: `${a} · ${b}`, a: a * b }; },
  },
  {
    key: 'div2', from: 10, name: 'Teilen durch 2, 5 und 10',
    make: () => { const b = pick([2, 5, 10]), e = ri(2, 10); return { q: `${b * e} : ${b}`, a: e, hint: `Wie oft passt die ${b} hinein?` }; },
  },
  {
    key: 'mal6', from: 11, name: 'Großes Einmaleins',
    make: () => { const a = pick([6, 7, 8, 9]), b = ri(2, 10); return { q: `${a} · ${b}`, a: a * b }; },
  },
  {
    key: 'gap', from: 11, name: 'Platzhalter-Aufgaben',
    make: (lvl) => {
      const r = rng();
      if (r < 0.4) { const a = ri(3, 40 + lvl), b = ri(2, 30); return { q: `${a} + ☐ = ${a + b}`, a: b, gap: true }; }
      if (r < 0.7) { const b = ri(2, 20), a = b + ri(2, 40); return { q: `${a} − ☐ = ${a - b}`, a: b, gap: true }; }
      const m = ri(2, 10), n = ri(2, 10); return { q: `☐ · ${m} = ${m * n}`, a: n, gap: true };
    },
  },
  {
    key: 'div', from: 12, name: 'Teilen im Einmaleins',
    make: () => { const b = ri(2, 9), e = ri(2, 10); return { q: `${b * e} : ${b}`, a: e }; },
  },
  {
    key: 'chain', from: 13, name: 'Rechenketten',
    make: (lvl) => {
      if (rng() < 0.5) {
        const a = ri(10, 40 + lvl), b = ri(5, 30), c = ri(2, 20);
        return { q: `${a} + ${b} + ${c}`, a: a + b + c };
      }
      const c = ri(2, 15), b = ri(2, 20), a = b + c + ri(5, 40);
      return { q: `${a} − ${b} − ${c}`, a: a - b - c };
    },
  },
];

const MAX_LEVEL = 14;
const PER_LEVEL = 5;            // so viele richtige Aufgaben je Stufe
const unlocked = (lvl) => TYPES.filter((t) => t.from <= lvl);
// Name der Stufe = die Aufgabenart, die sie neu dazubringt
function levelName(lvl) {
  const fresh = TYPES.filter((t) => t.from === Math.min(lvl, MAX_LEVEL));
  if (fresh.length) return fresh[0].name;
  return 'Alles gemischt';
}

// Eine Aufgabe bauen: meist aus dem frisch Gelernten, dazwischen Wiederholung
function makeTask(lvl) {
  const all = unlocked(lvl);
  const fresh = all.filter((t) => t.from > lvl - 3);
  const pool = (fresh.length && rng() < 0.65) ? fresh : all;
  const type = pick(pool);
  const t = type.make(lvl);
  return { key: type.key, q: t.q, a: t.a, hint: t.hint || '', story: !!t.story, gap: !!t.gap };
}

/* --------------------------------------------------------- Spielzustand --- */

const LIMIT = 20;               // Sekunden für den vollen Zeitbonus
const game = {
  mode: 'rallye',               // rallye | ueben
  startLevel: 1,
  timerOn: true,
  state: 'play',                // play | over
  level: 1, points: 0, streak: 0, bestStreak: 0,
  solved: 0, wrong: 0, inLevel: 0, hearts: 3,
  task: null, input: '', t: 0, taskT: 0,
  lastWrong: null,
  best: 0,
};

function loadSettings() {
  try {
    const m = localStorage.getItem('rechnen_mode');
    if (m === 'rallye' || m === 'ueben') game.mode = m;
    const s = parseInt(localStorage.getItem('rechnen_start'), 10);
    if ([1, 4, 8].includes(s)) game.startLevel = s;
    game.timerOn = localStorage.getItem('rechnen_timer') !== '0';
    game.best = parseFloat(localStorage.getItem('rechnen_best')) || 0;
  } catch { /* egal */ }
}
function saveBest() {
  try {
    if (game.points > (parseFloat(localStorage.getItem('rechnen_best')) || 0)) {
      localStorage.setItem('rechnen_best', String(game.points));
    }
    const lv = parseInt(localStorage.getItem('rechnen_maxlevel'), 10) || 0;
    if (game.level > lv) localStorage.setItem('rechnen_maxlevel', String(game.level));
  } catch { /* egal */ }
}

function newRound(seed) {
  if (seed !== undefined) rngState = (seed >>> 0) || 1;
  game.state = 'play';
  game.level = game.startLevel;
  game.points = 0; game.streak = 0; game.bestStreak = 0;
  game.solved = 0; game.wrong = 0; game.inLevel = 0;
  game.hearts = game.mode === 'ueben' ? Infinity : 3;
  game.input = ''; game.lastWrong = null; game.t = 0;
  nextTask();
  render();
}

function nextTask() {
  game.task = makeTask(game.level);
  game.input = '';
  game.taskT = 0;
}

// Punkte: Grundwert nach Stufe + Serien- und Zeitbonus
function scoreFor() {
  const base = 10 + game.level * 2;
  const streakBonus = Math.min(game.streak, 10) * 2;
  const timeBonus = game.timerOn ? Math.round(clamp(1 - game.taskT / LIMIT, 0, 1) * 10) : 0;
  return { base, streakBonus, timeBonus, total: base + streakBonus + timeBonus };
}

// Antwort prüfen. Liefert { ok, answer, gained }
function submit() {
  if (game.state !== 'play' || !game.task || game.input === '') return null;
  const given = parseInt(game.input, 10);
  const ok = given === game.task.a;
  const res = { ok, answer: game.task.a, given, gained: 0 };
  if (ok) {
    const sc = scoreFor();
    game.points += sc.total;
    res.gained = sc.total;
    game.streak++;
    game.bestStreak = Math.max(game.bestStreak, game.streak);
    game.solved++;
    game.inLevel++;
    game.lastWrong = null;
    if (game.inLevel >= PER_LEVEL && game.level < MAX_LEVEL) {
      game.level++; game.inLevel = 0; res.levelUp = true;
    } else if (game.inLevel >= PER_LEVEL) {
      game.inLevel = 0;
    }
    showFeedback(true, res);
    nextTask();
  } else {
    game.wrong++;
    game.streak = 0;
    game.lastWrong = { q: game.task.q, a: game.task.a };
    if (game.mode === 'rallye') game.hearts--;
    showFeedback(false, res);
    if (game.mode === 'rallye' && game.hearts <= 0) gameOver();
    else nextTask();
  }
  render();
  return res;
}
function gameOver() {
  game.state = 'over';
  game.input = '';
  saveBest();
  showOver();
}

/* ------------------------------------------------------------- Anzeige ---- */

const $ = (id) => document.getElementById(id);
const elTask = $('task'), elAnswer = $('answer-text'), elFeed = $('feedback');
const elPoints = $('h-points'), elLevel = $('h-level'), elStreak = $('h-streak'), elHearts = $('h-hearts');
const elFill = $('levelfill'), elLevelName = $('levelname'), elCard = $('card');
const elTimer = $('timerfill'), elHeartsBox = $('h-hearts-box');
const overEl = $('over'), menuEl = $('menu'), helpEl = $('help');

function render() {
  elPoints.textContent = String(game.points);
  elLevel.textContent = String(game.level);
  elStreak.textContent = String(game.streak);
  elHearts.textContent = game.mode === 'ueben' ? '∞' : '❤️'.repeat(Math.max(0, game.hearts)) || '–';
  elHeartsBox.classList.toggle('empty', game.mode === 'rallye' && game.hearts <= 1);
  elFill.style.width = Math.round((game.inLevel / PER_LEVEL) * 100) + '%';
  elLevelName.textContent = `Stufe ${game.level}: ${levelName(game.level)}`;
  if (game.task) {
    elTask.textContent = game.task.story || game.task.gap ? game.task.q : game.task.q + ' = ?';
    elTask.classList.toggle('story', !!game.task.story);
  }
  elAnswer.textContent = game.input;
  elTimer.style.width = game.timerOn && game.state === 'play'
    ? Math.round(clamp(1 - game.taskT / LIMIT, 0, 1) * 100) + '%' : '0%';
}

let feedT = null;
function showFeedback(ok, res) {
  if (feedT) clearTimeout(feedT);
  if (ok) {
    const praise = ['Super!', 'Klasse!', 'Richtig!', 'Prima!', 'Stark!', 'Weiter so!'];
    elFeed.className = 'good';
    elFeed.textContent = `${pick(praise)}  +${res.gained}`;
    elCard.classList.remove('bad'); elCard.classList.add('good');
    confetti(res.levelUp ? 60 : 18);
    Sfx.play(res.levelUp ? 'level' : 'right');
    if (res.levelUp) {
      elFeed.textContent = `🎉 Stufe ${game.level}: ${levelName(game.level)}`;
    }
  } else {
    elFeed.className = 'bad';
    elFeed.textContent = `Richtig wäre ${res.answer}`;
    elCard.classList.remove('good'); elCard.classList.add('bad');
    Sfx.play('wrong');
  }
  feedT = setTimeout(() => {
    elFeed.textContent = '';
    elCard.classList.remove('good', 'bad');
  }, ok ? 1100 : 2000);
}

function showOver() {
  const best = Math.max(game.points, parseFloat(localStorage.getItem('rechnen_best')) || 0);
  $('over-title').textContent = game.points >= best && game.points > 0 ? '🏆 Neue Bestleistung!' : '🎉 Gut gerechnet!';
  $('over-stats').innerHTML = `
    <div class="ov-row"><span>🏆 Punkte</span><b>${game.points}</b></div>
    <div class="ov-row"><span>✅ Richtig</span><b>${game.solved}</b></div>
    <div class="ov-row"><span>🎯 Stufe</span><b>${game.level}</b></div>
    <div class="ov-row"><span>🔥 Beste Serie</span><b>${game.bestStreak}</b></div>
    <div class="ov-row"><span>⭐ Rekord</span><b>${Math.round(best)}</b></div>`;
  $('over-note').textContent = game.solved >= 20 ? 'Du bist ein echter Rechenprofi!'
    : game.solved >= 10 ? 'Schon richtig gut – noch eine Runde?' : 'Übung macht den Meister!';
  overEl.classList.remove('hidden');
  Sfx.play('fanfare');
}

/* ------------------------------------------------------------- Konfetti --- */

const fx = $('fx'), fxc = fx.getContext('2d');
let parts = [];
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  fx.width = Math.round(window.innerWidth * dpr);
  fx.height = Math.round(window.innerHeight * dpr);
  fx.style.width = window.innerWidth + 'px';
  fx.style.height = window.innerHeight + 'px';
  fxc.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);

const COLORS = ['#ffd166', '#8ee07a', '#6fd0ff', '#ff8d2e', '#ff7a9c', '#c9a3ff'];
function confetti(n) {
  const r = elCard.getBoundingClientRect();
  for (let i = 0; i < n; i++) {
    parts.push({
      // vom unteren Kartenrand nach oben – so bleibt die Aufgabe lesbar
      x: r.left + r.width * rng(), y: r.bottom - 10,
      vx: (rng() - 0.5) * 220, vy: -320 - rng() * 260,
      t: 0, life: 1 + rng(), color: pick(COLORS), size: 5 + rng() * 6, rot: rng() * 6,
    });
  }
}
function drawFx(dt) {
  fxc.clearRect(0, 0, window.innerWidth, window.innerHeight);
  for (const p of parts) {
    p.t += dt; p.vy += 520 * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.rot += dt * 6;
    const a = clamp(1 - p.t / p.life, 0, 1);
    fxc.save();
    fxc.globalAlpha = a;
    fxc.translate(p.x, p.y); fxc.rotate(p.rot);
    fxc.fillStyle = p.color;
    fxc.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
    fxc.restore();
  }
  parts = parts.filter((p) => p.t < p.life);
}

/* ------------------------------------------------------------------ Ton --- */
// Kleine Web-Audio-Werkstatt: freundliche Klänge, nichts Schrilles.
const Sfx = {
  ctx: null, master: null, on: true,
  load() { try { this.on = localStorage.getItem('rechnen_sound') !== '0'; } catch { /* egal */ } return this; },
  save() { try { localStorage.setItem('rechnen_sound', this.on ? '1' : '0'); } catch { /* egal */ } },
  init() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    return true;
  },
  unlock() { if (this.on && this.init() && this.ctx.state === 'suspended') this.ctx.resume(); },
  toggle(v) { this.on = v === undefined ? !this.on : !!v; this.save(); if (this.on) this.unlock(); },
  tone(t, f, dur, type, peak, bend) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (bend) o.frequency.exponentialRampToValueAtTime(Math.max(40, f * bend), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  },
  play(name) {
    if (!this.on || !this.init() || this.ctx.state === 'suspended') return;
    const t = this.ctx.currentTime + 0.001;
    switch (name) {
      case 'key': this.tone(t, 620, 0.05, 'triangle', 0.08); break;
      case 'right': this.tone(t, 660, 0.1, 'triangle', 0.16); this.tone(t + 0.09, 990, 0.16, 'triangle', 0.14); break;
      case 'wrong': this.tone(t, 300, 0.18, 'sine', 0.13, 0.6); break;
      case 'level': [523, 659, 784, 1046].forEach((f, i) => this.tone(t + i * 0.08, f, 0.22, 'triangle', 0.15)); break;
      case 'fanfare': [392, 523, 659, 784, 1046].forEach((f, i) => this.tone(t + i * 0.12, f, 0.3, 'triangle', 0.16)); break;
      default: break;
    }
  },
};

/* ---------------------------------------------------------- Bedienung ----- */

function typeKey(k) {
  if (game.state !== 'play') return;
  Sfx.unlock();
  if (k === 'del') { game.input = game.input.slice(0, -1); Sfx.play('key'); }
  else if (k === 'ok') { submit(); return; }
  else if (/^[0-9]$/.test(k)) {
    if (game.input.length < 4) { game.input += k; Sfx.play('key'); }
  }
  render();
}

$('pad').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) typeKey(b.dataset.k);
});
window.addEventListener('keydown', (e) => {
  if (!helpEl.classList.contains('hidden') || !menuEl.classList.contains('hidden')) return;
  if (/^[0-9]$/.test(e.key)) { typeKey(e.key); e.preventDefault(); }
  else if (e.key === 'Backspace') { typeKey('del'); e.preventDefault(); }
  else if (e.key === 'Enter') { typeKey('ok'); e.preventDefault(); }
});

$('btn-menu').addEventListener('click', () => { menuEl.classList.remove('hidden'); refreshMenu(); });
$('btn-menu-close').addEventListener('click', () => menuEl.classList.add('hidden'));
menuEl.addEventListener('click', (e) => { if (e.target === menuEl) menuEl.classList.add('hidden'); });
$('btn-help').addEventListener('click', () => { menuEl.classList.add('hidden'); helpEl.classList.remove('hidden'); });
$('btn-start').addEventListener('click', () => { helpEl.classList.add('hidden'); Sfx.unlock(); });
$('btn-restart').addEventListener('click', () => { menuEl.classList.add('hidden'); overEl.classList.add('hidden'); newRound(); });
$('btn-again').addEventListener('click', () => { overEl.classList.add('hidden'); newRound(); });
const soundBtn = $('btn-sound');
soundBtn.addEventListener('click', () => {
  Sfx.toggle();
  if (Sfx.on) Sfx.play('key');
  refreshSound();
});
function refreshSound() {
  soundBtn.textContent = Sfx.on ? '🔊' : '🔇';
  soundBtn.classList.toggle('off', !Sfx.on);
}

function bindOpts(id, get, set) {
  const row = $(id);
  const refresh = () => { for (const b of row.children) b.classList.toggle('sel', b.dataset.v === String(get())); };
  row.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    set(b.dataset.v);
    refresh();
  });
  refresh();
  return refresh;
}
const refreshers = [
  bindOpts('opt-mode', () => game.mode, (v) => {
    game.mode = v === 'ueben' ? 'ueben' : 'rallye';
    try { localStorage.setItem('rechnen_mode', game.mode); } catch { /* egal */ }
    overEl.classList.add('hidden');
    newRound();
  }),
  bindOpts('opt-start', () => game.startLevel, (v) => {
    game.startLevel = parseInt(v, 10) || 1;
    try { localStorage.setItem('rechnen_start', String(game.startLevel)); } catch { /* egal */ }
    overEl.classList.add('hidden');
    newRound();
  }),
  bindOpts('opt-timer', () => (game.timerOn ? 1 : 0), (v) => {
    game.timerOn = v === '1';
    try { localStorage.setItem('rechnen_timer', game.timerOn ? '1' : '0'); } catch { /* egal */ }
  }),
];
function refreshMenu() { for (const r of refreshers) r(); refreshSound(); }

/* ------------------------------------------------------------- Schleife --- */

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (game.state === 'play') {
    game.t += dt;
    game.taskT += dt;
    if (game.timerOn) elTimer.style.width = Math.round(clamp(1 - game.taskT / LIMIT, 0, 1) * 100) + '%';
  }
  drawFx(dt);
  requestAnimationFrame(frame);
}

loadSettings();
Sfx.load();
refreshSound();
resize();
newRound();
refreshMenu();
requestAnimationFrame(frame);

// Test-Hook (Muster wie window.__kart / window.__clonk)
window.__rechnen = {
  game, TYPES, STORIES, MAX_LEVEL, PER_LEVEL, LIMIT,
  makeTask, unlocked, levelName, submit, nextTask, newRound, typeKey, scoreFor,
  render, confetti, Sfx, gameOver,
  setSeed: (s) => { rngState = (s >>> 0) || 1; },
  parts: () => parts,
};
