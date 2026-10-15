// Every sound in the game is synthesised with the Web Audio API — no audio files.

export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.musicOn = true;
    this.musicMode = 'gym'; // 'gym' | 'disco' | 'off'
    this._nextNote = 0;
    this._step = 0;
  }

  // Must be called from a user gesture (mobile browsers keep audio locked until then).
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const c = this.ctx;
      this.comp = c.createDynamicsCompressor();
      this.comp.threshold.value = -14;
      this.comp.ratio.value = 4;
      this.master = c.createGain();
      this.master.gain.value = this.enabled ? 0.9 : 0;
      this.master.connect(this.comp).connect(c.destination);
      this.sfx = c.createGain();
      this.sfx.connect(this.master);
      this.music = c.createGain();
      this.music.gain.value = 0.32;
      this.music.connect(this.master);
      // short room reverb shared by everything
      this.verb = c.createConvolver();
      this.verb.buffer = this._impulse(1.6, 2.5);
      const vg = c.createGain();
      vg.gain.value = 0.22;
      this.verbIn = c.createGain();
      this.verbIn.connect(this.verb).connect(vg).connect(this.master);
      this.sfx.connect(this.verbIn);
      this.noiseBuf = this._noise(2);
      this._nextNote = c.currentTime + 0.1;
      this._ambience();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.05);
  }

  get t() { return this.ctx ? this.ctx.currentTime : 0; }

  _noise(sec) {
    const c = this.ctx, b = c.createBuffer(1, c.sampleRate * sec, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  _impulse(sec, decay) {
    const c = this.ctx, len = c.sampleRate * sec, b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }

  _env(g, t, a, peak, d, end = 0.0001) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(end, t + a + d);
  }

  _noiseSrc(t, dur, type, freq, q = 1, dest = this.sfx) {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random() * 1.5, dur + 0.05);
    return { s, f, g };
  }

  _osc(t, type, f0, f1, dur, dest = this.sfx) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
    return { o, g };
  }

  // ------------------------------------------------------------- effects
  punch(power = 1, heavy = false) {
    if (!this.ctx) return;
    const t = this.t, p = Math.min(1.6, power);
    const pitch = (heavy ? 70 : 95) * (0.9 + Math.random() * 0.2);
    const body = this._osc(t, 'sine', pitch * 2.2, pitch * 0.6, 0.18);
    this._env(body.g, t, 0.004, 0.9 * p, 0.2);
    const thud = this._noiseSrc(t, 0.12, 'lowpass', heavy ? 700 : 1100, 0.8);
    this._env(thud.g, t, 0.002, 0.8 * p, 0.11);
    const slap = this._noiseSrc(t, 0.04, 'highpass', 2500, 0.7);
    this._env(slap.g, t, 0.001, 0.35 * p, 0.04);
    this.chain(0.25 + p * 0.35, 0.05);
  }

  chain(intensity = 0.5, delay = 0) {
    if (!this.ctx || intensity < 0.05) return;
    const n = 2 + Math.floor(intensity * 5);
    for (let i = 0; i < n; i++) {
      const t = this.t + delay + Math.random() * 0.35 * intensity + i * 0.02;
      const f = 2800 + Math.random() * 3500;
      const c = this._noiseSrc(t, 0.05, 'bandpass', f, 18);
      this._env(c.g, t, 0.001, 0.5 * intensity, 0.05 + Math.random() * 0.05);
      const ring = this._osc(t, 'triangle', f * 0.6, f * 0.6, 0.12);
      this._env(ring.g, t, 0.001, 0.025 * intensity, 0.1);
    }
  }

  whoosh(power = 1) {
    if (!this.ctx) return;
    const t = this.t;
    const w = this._noiseSrc(t, 0.3, 'bandpass', 400, 1.2);
    w.f.frequency.exponentialRampToValueAtTime(1800, t + 0.12);
    w.f.frequency.exponentialRampToValueAtTime(600, t + 0.28);
    this._env(w.g, t, 0.05, 0.35 * power, 0.22);
  }

  step(vol = 0.25) {
    if (!this.ctx) return;
    const t = this.t;
    const s = this._noiseSrc(t, 0.07, 'lowpass', 500 + Math.random() * 200, 1);
    this._env(s.g, t, 0.003, vol, 0.07);
    const sq = this._noiseSrc(t, 0.03, 'bandpass', 3000, 3);
    this._env(sq.g, t, 0.002, vol * 0.08, 0.03);
  }

  land(vol = 0.8) {
    if (!this.ctx) return;
    const t = this.t;
    const b = this._osc(t, 'sine', 110, 40, 0.25);
    this._env(b.g, t, 0.004, vol, 0.25);
    const s = this._noiseSrc(t, 0.15, 'lowpass', 600, 1);
    this._env(s.g, t, 0.003, vol * 0.6, 0.15);
  }

  bell(times = 1) {
    if (!this.ctx) return;
    for (let k = 0; k < times; k++) {
      const t = this.t + k * 0.28;
      const f = 820;
      [[1, 0.5, 2.6], [2.76, 0.25, 1.6], [5.4, 0.12, 0.9], [8.93, 0.06, 0.5]].forEach(([m, v, d]) => {
        const o = this._osc(t, 'sine', f * m, f * m, d);
        this._env(o.g, t, 0.002, v, d);
      });
      const hit = this._noiseSrc(t, 0.02, 'highpass', 4000, 1);
      this._env(hit.g, t, 0.001, 0.3, 0.02);
    }
  }

  whistle() {
    if (!this.ctx) return;
    const t = this.t;
    const o = this._osc(t, 'sine', 2900, 2900, 0.5);
    const lfo = this.ctx.createOscillator();
    const lg = this.ctx.createGain();
    lfo.frequency.value = 38; lg.gain.value = 120;
    lfo.connect(lg).connect(o.o.frequency);
    lfo.start(t); lfo.stop(t + 0.55);
    this._env(o.g, t, 0.01, 0.18, 0.45);
  }

  cheer(sec = 2.2, vol = 0.5) {
    if (!this.ctx) return;
    const t = this.t;
    // crowd "aaah": several formant-filtered noise voices
    for (let i = 0; i < 6; i++) {
      const v = this._noiseSrc(t, sec, 'bandpass', 500 + Math.random() * 900, 4);
      v.f.frequency.linearRampToValueAtTime(700 + Math.random() * 900, t + sec);
      v.g.gain.setValueAtTime(0.0001, t);
      v.g.gain.linearRampToValueAtTime(vol * 0.5, t + 0.25);
      v.g.gain.linearRampToValueAtTime(vol * 0.35, t + sec * 0.6);
      v.g.gain.linearRampToValueAtTime(0.0001, t + sec);
    }
    this.applause(sec, vol * 0.8);
  }

  applause(sec = 2, vol = 0.4) {
    if (!this.ctx) return;
    const claps = Math.floor(sec * 28);
    for (let i = 0; i < claps; i++) {
      const t = this.t + Math.random() * sec;
      const fade = 1 - (t - this.t) / sec;
      const c = this._noiseSrc(t, 0.03, 'bandpass', 1200 + Math.random() * 1500, 1.5);
      this._env(c.g, t, 0.001, vol * (0.3 + Math.random() * 0.7) * fade, 0.03);
    }
  }

  tear() {
    if (!this.ctx) return;
    const t = this.t;
    const r = this._noiseSrc(t, 0.4, 'bandpass', 1800, 0.6);
    r.f.frequency.exponentialRampToValueAtTime(300, t + 0.4);
    this._env(r.g, t, 0.005, 0.9, 0.4);
    const boom = this._osc(t, 'sine', 90, 30, 0.6);
    this._env(boom.g, t, 0.005, 1.0, 0.6);
    const sand = this._noiseSrc(t + 0.05, 1.6, 'lowpass', 2500, 0.5);
    this._env(sand.g, t + 0.05, 0.05, 0.25, 1.5);
    this.chain(1.2, 0);
  }

  thud(vol = 1) {
    if (!this.ctx) return;
    const t = this.t;
    const b = this._osc(t, 'sine', 70, 28, 0.5);
    this._env(b.g, t, 0.003, vol, 0.5);
    const s = this._noiseSrc(t, 0.25, 'lowpass', 400, 1);
    this._env(s.g, t, 0.003, vol * 0.7, 0.25);
  }

  ui() {
    if (!this.ctx) return;
    const t = this.t;
    const o = this._osc(t, 'triangle', 880, 1320, 0.06);
    this._env(o.g, t, 0.002, 0.12, 0.06);
  }

  achievement() {
    if (!this.ctx) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const t = this.t + i * 0.08;
      const o = this._osc(t, 'triangle', f, f, 0.3);
      this._env(o.g, t, 0.005, 0.16, 0.3);
    });
  }

  crackle() {
    if (!this.ctx) return;
    const t = this.t;
    const z = this._osc(t, 'sawtooth', 100, 100, 0.12);
    this._env(z.g, t, 0.002, 0.04, 0.1);
    const s = this._noiseSrc(t, 0.05, 'highpass', 5000, 1);
    this._env(s.g, t, 0.001, 0.05, 0.05);
  }

  _ambience() {
    // faint ventilation hum + neon buzz, keeps the room alive
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf; s.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220;
    const g = c.createGain(); g.gain.value = 0.05;
    s.connect(f).connect(g).connect(this.master);
    s.start();
    const hum = c.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 100;
    const hf = c.createBiquadFilter(); hf.type = 'bandpass'; hf.frequency.value = 200; hf.Q.value = 6;
    const hg = c.createGain(); hg.gain.value = 0.006;
    hum.connect(hf).connect(hg).connect(this.master);
    hum.start();
  }

  // ------------------------------------------------------------- music sequencer
  setMusic(mode) {
    this.musicMode = mode;
    if (!this.music) return;
    const target = !this.musicOn || mode === 'off' ? 0 : mode === 'disco' ? 0.5 : 0.22;
    this.music.gain.setTargetAtTime(target, this.ctx.currentTime, 0.3);
  }

  setMusicOn(on) {
    this.musicOn = on;
    this.setMusic(this.musicMode);
  }

  update() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const disco = this.musicMode === 'disco';
    const bpm = disco ? 124 : 92;
    const stepDur = 60 / bpm / 4;
    const ahead = this.ctx.currentTime + 0.15;
    if (this._nextNote < this.ctx.currentTime - 0.5) this._nextNote = this.ctx.currentTime + 0.05;
    while (this._nextNote < ahead) {
      if (this.musicOn && this.musicMode !== 'off') this._playStep(this._step, this._nextNote, disco, stepDur);
      this._nextNote += stepDur;
      this._step = (this._step + 1) % 64;
    }
  }

  _playStep(step, t, disco, sd) {
    const m = this.music, s16 = step % 16, bar = Math.floor(step / 16);
    const kick = (v) => {
      const o = this._osc(t, 'sine', 150, 42, 0.22, m);
      this._env(o.g, t, 0.002, v, 0.22);
    };
    const hat = (v, open = false) => {
      const h = this._noiseSrc(t, open ? 0.12 : 0.04, 'highpass', 7000, 1, m);
      this._env(h.g, t, 0.001, v, open ? 0.12 : 0.035);
    };
    const snare = (v) => {
      const n = this._noiseSrc(t, 0.16, 'bandpass', 1800, 0.7, m);
      this._env(n.g, t, 0.002, v, 0.16);
      const o = this._osc(t, 'triangle', 220, 160, 0.08, m);
      this._env(o.g, t, 0.002, v * 0.4, 0.08);
    };
    const bassNote = (f, v, dur) => {
      const o = this._osc(t, 'sawtooth', f, f, dur, m);
      const flt = this.ctx.createBiquadFilter();
      flt.type = 'lowpass'; flt.frequency.setValueAtTime(disco ? 900 : 500, t);
      flt.frequency.exponentialRampToValueAtTime(150, t + dur);
      o.o.disconnect(); o.o.connect(flt).connect(o.g);
      this._env(o.g, t, 0.005, v, dur);
    };
    // A minor -> F -> C -> G
    const roots = [55, 43.65, 65.41, 49];
    const root = roots[bar % 4];
    if (disco) {
      if (s16 % 4 === 0) kick(0.9);
      if (s16 % 4 === 2) hat(0.18, true);
      else hat(0.06);
      if (s16 === 4 || s16 === 12) snare(0.35);
      const bp = [0, 0, 12, 0, 0, 12, 0, 7, 0, 0, 12, 0, 0, 12, 10, 7];
      if ([0, 2, 3, 5, 6, 8, 10, 11, 13, 14].includes(s16)) bassNote(root * Math.pow(2, bp[s16] / 12) * 2, 0.32, sd * 1.6);
      if (s16 === 0 || s16 === 6 || s16 === 10) this._chord(t, root * 4, sd * 3, 0.06);
      if (s16 === 14 && bar % 2 === 1) this._arp(t, root * 8, sd);
    } else {
      // laid-back boom-bap for training
      if (s16 === 0 || s16 === 7 || s16 === 10) kick(0.75);
      if (s16 === 4 || s16 === 12) snare(0.4);
      if (s16 % 2 === 0) hat(s16 % 4 === 0 ? 0.07 : 0.045);
      if (s16 === 0) bassNote(root, 0.35, sd * 6);
      if (s16 === 10) bassNote(root * 1.5, 0.25, sd * 3);
      if (s16 === 0 && bar % 2 === 0) this._chord(t, root * 4, sd * 14, 0.035, 'triangle');
    }
  }

  _chord(t, f, dur, v, type = 'sawtooth') {
    [1, 1.189, 1.498].forEach((r) => {
      [-6, 6].forEach((det) => {
        const o = this._osc(t, type, f * r, f * r, dur, this.music);
        o.o.detune.value = det;
        const flt = this.ctx.createBiquadFilter();
        flt.type = 'lowpass'; flt.frequency.value = 1800;
        o.o.disconnect(); o.o.connect(flt).connect(o.g);
        o.g.gain.setValueAtTime(0.0001, t);
        o.g.gain.exponentialRampToValueAtTime(v, t + 0.02);
        o.g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      });
    });
  }

  _arp(t, f, sd) {
    [0, 3, 7, 12].forEach((s, i) => {
      const tt = t + i * sd * 0.5;
      const o = this._osc(tt, 'square', f * Math.pow(2, s / 12), f * Math.pow(2, s / 12), sd, this.music);
      this._env(o.g, tt, 0.002, 0.04, sd * 0.9);
    });
  }
}
