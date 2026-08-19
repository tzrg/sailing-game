// Kleine Sound-Werkstatt für die Spielesammlung.
//
// Alle Geräusche und die Musik werden im Browser synthetisiert (Web Audio) –
// keine Audiodateien, kein Ladebalken, kein Traffic. Browser erlauben Ton erst
// nach einer Nutzer-Aktion: darum weckt unlock() die Audio-Engine beim ersten
// Tippen/Tastendruck. Einstellungen (Musik/Geräusche) landen in localStorage.

const KEY_SFX = 'sfx_on';
const KEY_MUS = 'sfx_music';

export const Sfx = {
  ctx: null,
  master: null, sfxBus: null, musBus: null,
  on: true, musicOn: true,
  ready: false, musicPlaying: false,
  loops: {},            // laufende Dauergeräusche (Bohrer, Grollen, Regen)
  _last: {},            // Zeitstempel je Geräusch (gegen Dauerfeuer)
  _next: 0, _step: 0, _timer: null,
  intensity: 0,         // 0 = ruhig, 1 = Katastrophe (mehr Perkussion)

  load() {
    try {
      this.on = localStorage.getItem(KEY_SFX) !== '0';
      this.musicOn = localStorage.getItem(KEY_MUS) !== '0';
    } catch { /* egal */ }
    return this;
  },
  save() {
    try {
      localStorage.setItem(KEY_SFX, this.on ? '1' : '0');
      localStorage.setItem(KEY_MUS, this.musicOn ? '1' : '0');
    } catch { /* egal */ }
  },

  // Audio-Engine aufbauen (erst beim ersten Ton, sonst blockt der Browser)
  init() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 0.85;
    this.sfxBus.connect(this.master);
    this.musBus = this.ctx.createGain();
    this.musBus.gain.value = 0.32;
    this.musBus.connect(this.master);
    // Rauschpuffer einmal erzeugen (für Explosionen, Graben, Regen …)
    const n = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;          // braunes Rauschen: weicher
      d[i] = white * 0.6 + last * 3.2;
    }
    this.ready = true;
    return true;
  },
  // beim ersten Tippen/Tastendruck aufwecken
  unlock() {
    if (!this.init()) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (this.on && this.musicOn && !this.musicPlaying) this.startMusic();
  },
  // 🔊 ist der Hauptschalter: aus heißt aus, auch für die Musik
  setSfx(v) {
    this.on = !!v; this.save();
    if (!this.on) { this.stopAllLoops(); this.stopMusic(); }
    else if (this.musicOn) { this.init(); this.startMusic(); }
  },
  setMusic(v) {
    this.musicOn = !!v; this.save();
    if (this.musicOn && this.on) { this.init(); this.startMusic(); } else this.stopMusic();
  },

  /* ------------------------------------------------------------ Bausteine -- */

  _env(gain, t, a, d, peak) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + a);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  },
  _tone(t, freq, dur, type = 'triangle', peak = 0.3, bend = 0, bus = null) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (bend) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * bend), t + dur);
    this._env(g, t, Math.min(0.02, dur * 0.2), dur, peak);
    o.connect(g); g.connect(bus || this.sfxBus);
    o.start(t); o.stop(t + dur + 0.05);
    return o;
  },
  _noise(t, dur, { peak = 0.3, type = 'lowpass', f0 = 900, f1 = 200, q = 1 } = {}) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const bp = this.ctx.createBiquadFilter();
    bp.type = type; bp.Q.value = q;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = this.ctx.createGain();
    this._env(g, t, Math.min(0.01, dur * 0.2), dur, peak);
    s.connect(bp); bp.connect(g); g.connect(this.sfxBus);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
    return s;
  },

  /* --------------------------------------------------------- Effektsounds -- */
  // vol skaliert mit der Entfernung zur Kamera (0 = still)
  play(name, vol = 1) {
    if (!this.on || vol <= 0.02) return;
    if (!this.init()) return;
    if (this.ctx.state === 'suspended') return;      // noch nicht freigegeben
    const t = this.ctx.currentTime + 0.001;
    const v = Math.min(1, vol);
    // Dauerfeuer bremsen (z. B. Grabgeräusch)
    const gap = { dig: 0.1, clink: 0.13, step: 0.22, gold: 0.06, splash: 0.15, pick: 0.05, rail: 0.12 }[name];
    if (gap) {
      if ((this._last[name] || 0) > t - gap) return;
      this._last[name] = t;
    }
    switch (name) {
      case 'dig':                                    // Schaufel in der Erde
        this._noise(t, 0.13, { peak: 0.17 * v, f0: 1100, f1: 260, q: 0.8 });
        this._tone(t, 90 + Math.random() * 30, 0.07, 'sine', 0.07 * v, 0.6);
        break;
      case 'clink':                                  // Schaufel am Fels
        this._noise(t, 0.09, { peak: 0.12 * v, type: 'bandpass', f0: 3200, f1: 2200, q: 6 });
        break;
      case 'boom': {                                 // Explosion
        this._noise(t, 0.55, { peak: 0.5 * v, f0: 1800, f1: 60, q: 0.7 });
        this._tone(t, 130, 0.5, 'sine', 0.42 * v, 0.18);
        this._tone(t + 0.01, 70, 0.7, 'triangle', 0.3 * v, 0.35);
        break;
      }
      case 'gold':                                   // Klumpen einsammeln
        this._tone(t, 1050, 0.08, 'triangle', 0.16 * v);
        this._tone(t + 0.06, 1560, 0.12, 'triangle', 0.14 * v);
        break;
      case 'pick':                                   // sonstiges Aufsammeln
        this._tone(t, 620, 0.07, 'square', 0.09 * v);
        break;
      case 'throw':                                  // Wurf
        this._noise(t, 0.2, { peak: 0.14 * v, type: 'bandpass', f0: 400, f1: 1800, q: 1.2 });
        break;
      case 'splash':                                 // ins Wasser
        this._noise(t, 0.3, { peak: 0.2 * v, type: 'bandpass', f0: 1600, f1: 400, q: 1 });
        break;
      case 'hurt':
        this._tone(t, 320, 0.16, 'sawtooth', 0.18 * v, 0.4);
        break;
      case 'ko':
        [520, 400, 300, 200].forEach((f, i) => this._tone(t + i * 0.09, f, 0.16, 'triangle', 0.18 * v, 0.85));
        break;
      case 'buy':                                    // Kasse / Produktion
        this._tone(t, 700, 0.08, 'square', 0.12 * v);
        this._tone(t + 0.07, 1050, 0.14, 'square', 0.11 * v);
        break;
      case 'craft':
        this._noise(t, 0.18, { peak: 0.14 * v, type: 'bandpass', f0: 900, f1: 1600, q: 2 });
        this._tone(t + 0.05, 300, 0.16, 'sawtooth', 0.1 * v, 1.6);
        break;
      case 'lore':                                   // Lore rumpelt an
        this._noise(t, 0.25, { peak: 0.12 * v, f0: 500, f1: 180, q: 1 });
        break;
      case 'rail':
        this._noise(t, 0.1, { peak: 0.1 * v, type: 'bandpass', f0: 2600, f1: 1800, q: 5 });
        break;
      case 'volcano':                                // Ausbruch-Anblasen
        this._noise(t, 1.6, { peak: 0.4 * v, f0: 400, f1: 60, q: 0.6 });
        this._tone(t, 60, 1.8, 'sine', 0.3 * v, 0.7);
        break;
      case 'quake':
        this._noise(t, 1.2, { peak: 0.3 * v, f0: 200, f1: 50, q: 0.6 });
        break;
      case 'meteor':
        this._noise(t, 1.0, { peak: 0.25 * v, type: 'bandpass', f0: 300, f1: 1400, q: 0.8 });
        break;
      case 'fanfare':
        [523, 659, 784, 1046].forEach((f, i) => this._tone(t + i * 0.12, f, 0.3, 'triangle', 0.22 * v));
        break;
      case 'lift':
        this._tone(t, 120, 0.12, 'square', 0.08 * v);
        break;
      default: break;
    }
  },

  /* ---------------------------------------------- Dauergeräusche (Loops) -- */
  loop(name, on, vol = 0.2) {
    if (!this.on) { if (this.loops[name]) this.stopLoop(name); return; }
    if (!on) { this.stopLoop(name); return; }
    if (!this.init() || this.ctx.state === 'suspended') return;
    let L = this.loops[name];
    if (!L) {
      const s = this.ctx.createBufferSource();
      s.buffer = this.noise; s.loop = true;
      const f = this.ctx.createBiquadFilter();
      const g = this.ctx.createGain();
      g.gain.value = 0.0001;
      if (name === 'drill') { f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 1.4; s.playbackRate.value = 0.5; }
      else if (name === 'rumble') { f.type = 'lowpass'; f.frequency.value = 120; s.playbackRate.value = 0.35; }
      else { f.type = 'highpass'; f.frequency.value = 1800; }   // Regen
      s.connect(f); f.connect(g); g.connect(this.sfxBus);
      s.start(this.ctx.currentTime, Math.random());
      L = this.loops[name] = { s, g };
    }
    L.g.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.08);
  },
  stopLoop(name) {
    const L = this.loops[name];
    if (!L) return;
    try {
      L.g.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.06);
      const s = L.s;
      setTimeout(() => { try { s.stop(); } catch { /* egal */ } }, 300);
    } catch { /* egal */ }
    delete this.loops[name];
  },
  stopAllLoops() { for (const k of Object.keys(this.loops)) this.stopLoop(k); },

  /* ------------------------------------------------------------- Musik ---- */
  // Ruhige Bergbau-Melodie: Basslinie + gezupfte Arpeggien + Flötenmelodie,
  // in vier Akkorden im Kreis. Bei Katastrophen kommt Perkussion dazu.
  startMusic() {
    if (!this.musicOn || !this.on) return;
    if (!this.init() || this.musicPlaying) return;
    this.musicPlaying = true;
    this._step = 0;
    this._next = this.ctx.currentTime + 0.1;
    if (this._timer) clearInterval(this._timer);
    this._timer = setInterval(() => this._schedule(), 90);
  },
  stopMusic() {
    this.musicPlaying = false;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  },
  _schedule() {
    if (!this.musicPlaying || !this.ctx) return;
    if (this.ctx.state === 'suspended') return;
    const spb = 60 / 92 / 2;                       // Achtelschritt bei 92 bpm
    while (this._next < this.ctx.currentTime + 0.35) {
      this._note(this._next, this._step);
      this._next += spb;
      this._step++;
    }
  },
  _note(t, step) {
    // Akkordfolge (a-Moll · F · C · G), je 8 Achtel
    const CHORDS = [
      { root: 220.00, scale: [0, 3, 5, 7, 10] },   // A
      { root: 174.61, scale: [0, 4, 5, 7, 9] },    // F
      { root: 261.63, scale: [0, 2, 4, 7, 9] },    // C
      { root: 196.00, scale: [0, 2, 4, 7, 9] },    // G
    ];
    const bar = (step >> 3) % 4;
    const ch = CHORDS[bar];
    const beat = step & 7;
    const semi = (n) => Math.pow(2, n / 12);
    const g = this.musBus;
    // Bass auf 1 und 5
    if (beat === 0 || beat === 4) {
      this._tone(t, ch.root / 2, 0.5, 'triangle', 0.5, 1, g);
    }
    // gezupftes Arpeggio auf jedem Achtel
    const arp = ch.scale[[0, 2, 1, 3, 2, 4, 1, 2][beat]];
    this._tone(t, ch.root * semi(arp) * 2, 0.22, 'triangle', 0.14, 1, g);
    // Melodie: sparsam, jede zweite Zählzeit, mit kleiner Variation
    if (beat === 0 || beat === 3 || beat === 6) {
      const pick = ch.scale[(step * 7 + bar * 3) % ch.scale.length];
      const o = this.ctx.createOscillator(), gg = this.ctx.createGain(), lfo = this.ctx.createOscillator(), la = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.value = ch.root * semi(pick) * 4;
      lfo.frequency.value = 5.2; la.gain.value = 3.4;      // sanftes Vibrato
      lfo.connect(la); la.connect(o.frequency);
      this._env(gg, t, 0.05, 0.42, 0.1);
      o.connect(gg); gg.connect(g);
      o.start(t); lfo.start(t);
      o.stop(t + 0.5); lfo.stop(t + 0.5);
    }
    // Perkussion nur bei Katastrophen
    if (this.intensity > 0.5 && (beat === 2 || beat === 6)) {
      this._noise(t, 0.12, { peak: 0.1, type: 'bandpass', f0: 2400, f1: 1200, q: 3 });
    }
  },
};

export default Sfx;
