import * as THREE from 'three';

const ATTACKS = ['box_01', 'box_02', 'box_03', 'kick'];
const IN_PLACE = ['walk', 'run', 'dance', 'flip', 'idle'];
// Some clips have long idle lead-ins/tails: play only the interesting part [start, end] (seconds).
const TRIM = { greet: [3.3, 7.2] };
const LIMBS = { lh: 'LeftHand', rh: 'RightHand', lf: 'LeftFoot', rf: 'RightFoot' };

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _m = new THREE.Matrix4();

function boneKey(name) { return name.replace(/[^A-Za-z]/g, ''); }

export class Player {
  constructor(gltf, scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.model = gltf.scene;
    this.root.add(this.model);
    scene.add(this.root);

    const box = new THREE.Box3().setFromObject(this.model);
    this.scale = 1.8 / (box.max.y - box.min.y);
    this.model.scale.setScalar(this.scale);

    this.bones = {};
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
        if (o.material) {
          o.material.envMapIntensity = 0.8;
          o.material.side = THREE.FrontSide;
        }
      }
      if (o.isBone || o.type === 'Bone' || o.name.startsWith('mixamorig')) this.bones[boneKey(o.name)] = o;
    });
    this.limb = {};
    for (const [k, n] of Object.entries(LIMBS)) this.limb[k] = this.bones['mixamorig' + n];
    this.hips = this.bones.mixamorigHips;
    this.toes = [this.bones.mixamorigLeftToeBase, this.bones.mixamorigRightToeBase];

    // ---- clips
    this.mixer = new THREE.AnimationMixer(this.model);
    this.clips = {};
    for (const c of gltf.animations) {
      let key = c.name.replace(/\.\d+$/, '');
      if (key === 'front_kick_02') key = 'kick';
      if (key === 'greet_03') key = 'greet';
      if (key === 'dance_02') key = 'dance';
      this.clips[key] = c;
    }
    this.rootMotion = {};
    for (const key of IN_PLACE) this._makeInPlace(key);

    this.actions = {};
    for (const [k, c] of Object.entries(this.clips)) {
      const a = this.mixer.clipAction(c);
      if (!['idle', 'walk', 'run', 'dance'].includes(k)) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      this.actions[k] = a;
    }

    this.analysis = this._analyse();

    // ---- state
    this.heading = 0;
    this.vel = new THREE.Vector2();
    this.speed = 0;
    this.state = 'loco';      // loco | action | dance
    this.current = null;      // current one-shot key
    this.queued = null;
    this.windowsDone = new Set();
    this.freeze = 0;
    this.assist = null;
    this.prevLimb = {};
    for (const k of Object.keys(LIMBS)) this.prevLimb[k] = new THREE.Vector3();
    this.footDown = [true, true];
    this.events = [];

    for (const k of ['idle', 'walk', 'run']) {
      this.actions[k].play();
      this.actions[k].setEffectiveWeight(k === 'idle' ? 1 : 0);
    }
    this.mixer.addEventListener('finished', (e) => this._onFinished(e.action));
    this.mixer.update(0);
    this.model.updateMatrixWorld(true);
    this.toeFloor = Math.min(...this.toes.map((t) => t.getWorldPosition(_a).y));
  }

  // Remove horizontal hip travel so the clip plays on the spot; keep the curve for root motion.
  _makeInPlace(key) {
    const clip = this.clips[key];
    if (!clip) return;
    const track = clip.tracks.find((t) => t.name.endsWith('.position') && t.name.includes('Hips'));
    if (!track) return;
    const v = track.values;
    const times = track.times.slice();
    const zs = [], xs = [];
    for (let i = 0; i < times.length; i++) { xs.push(v[i * 3]); zs.push(v[i * 3 + 2]); }
    this.rootMotion[key] = { times, xs, zs };
    const x0 = v[0], z0 = v[2];
    for (let i = 0; i < times.length; i++) { v[i * 3] = x0; v[i * 3 + 2] = z0; }
  }

  _sampleRoot(key, t) {
    const rm = this.rootMotion[key];
    if (!rm) return null;
    const { times, xs, zs } = rm;
    if (t <= times[0]) return [xs[0] - xs[0], zs[0] - zs[0]];
    let i = 1;
    while (i < times.length && times[i] < t) i++;
    if (i >= times.length) return [xs[xs.length - 1] - xs[0], zs[zs.length - 1] - zs[0]];
    const k = (t - times[i - 1]) / (times[i] - times[i - 1]);
    return [(xs[i - 1] + (xs[i] - xs[i - 1]) * k) - xs[0], (zs[i - 1] + (zs[i] - zs[i - 1]) * k) - zs[0]];
  }

  // Scan each attack clip for "strike windows": stretches where a hand/foot moves fast in front of the body.
  _analyse() {
    const res = {};
    const inv = new THREE.Matrix4();
    this.root.updateMatrixWorld(true);
    inv.copy(this.root.matrixWorld).invert();
    for (const key of ATTACKS) {
      const clip = this.clips[key];
      if (!clip) continue;
      this.mixer.stopAllAction();
      const a = this.mixer.clipAction(clip);
      a.reset().play();
      const dt = 1 / 60;
      const samples = [];
      for (let t = 0; t <= clip.duration + 1e-6; t += dt) {
        a.time = t;
        this.mixer.update(0);
        this.model.updateMatrixWorld(true);
        const s = { t };
        for (const k of Object.keys(LIMBS)) s[k] = this.limb[k].getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
        samples.push(s);
      }
      a.stop();
      const windows = [];
      const limbs = key === 'kick' ? ['lf', 'rf'] : ['lh', 'rh'];
      for (const k of limbs) {
        let open = null;
        for (let i = 1; i < samples.length; i++) {
          const p = samples[i][k], q = samples[i - 1][k];
          const sp = p.distanceTo(q) / dt;
          const fwd = p.z;
          const strikeZone = fwd > 0.28 && p.y > (key === 'kick' ? 0.4 : 0.9);
          const fast = sp > (key === 'kick' ? 2.2 : 2.0);
          if (fast && strikeZone) {
            if (!open) open = { limb: k, t0: samples[i - 1].t, t1: samples[i].t, peak: p.clone(), peakSpeed: sp };
            open.t1 = samples[i].t;
            if (p.z > open.peak.z) open.peak.copy(p);
            open.peakSpeed = Math.max(open.peakSpeed, sp);
          } else if (open && samples[i].t - open.t1 > 0.06) {
            windows.push(open);
            open = null;
          }
        }
        if (open) windows.push(open);
      }
      windows.sort((x, y) => x.t0 - y.t0);
      // where should the bag be (in player space) for this move to land?
      const aim = new THREE.Vector3();
      windows.forEach((w) => aim.add(w.peak));
      if (windows.length) aim.divideScalar(windows.length);
      res[key] = { windows, aim, duration: clip.duration,
        lastHit: windows.length ? windows[windows.length - 1].t1 : clip.duration * 0.6 };
    }
    return res;
  }

  get busy() { return this.state === 'action'; }

  // ---------------------------------------------------------------- actions
  trigger(name, ctx) {
    if (name === 'dance') {
      if (this.state === 'dance') { this.stopDance(); return; }
      if (this.state === 'action') return;
      this._play('dance', 0.35);
      this.state = 'dance';
      this.events.push({ type: 'dance', on: true });
      return;
    }
    if (this.state === 'action') {
      // chain attacks: remember one follow-up
      if (ATTACKS.includes(name) && ATTACKS.includes(this.current)) this.queued = name;
      return;
    }
    if (this.state === 'dance') this.stopDance(true);
    this._start(name, ctx);
  }

  _start(name, ctx) {
    if (!this.actions[name]) return;
    this.state = 'action';
    this.current = name;
    this.windowsDone.clear();
    this.missWhoosh = new Set();
    this._tPrev = null;
    this.actionTime0 = 0;
    this.assist = null;
    if (ATTACKS.includes(name) && ctx) this.assist = this._assistFor(name, ctx.bags);
    const fade = ATTACKS.includes(name) ? 0.12 : 0.22;
    this._play(name, fade);
    if (TRIM[name]) this.actions[name].time = TRIM[name][0];
    if (name === 'flip') { this.actions.flip.timeScale = 0.95; this.prevRoot = [0, 0]; }
    if (name === 'jump') this.prevRoot = null;
    this.events.push({ type: 'start', name });
  }

  _play(name, fade) {
    const a = this.actions[name];
    a.reset();
    a.setEffectiveTimeScale(1);
    a.setEffectiveWeight(1);
    a.play();
    for (const [k, other] of Object.entries(this.actions)) {
      if (k !== name && other.isRunning() && other.getEffectiveWeight() > 0) other.fadeOut(fade);
    }
    a.fadeIn(fade);
  }

  // Abort the current one-shot (used when the intro cuts the wave short).
  cancelAction() {
    if (this.state !== 'action') return;
    const from = this.current;
    this.state = 'loco';
    this.current = null;
    this.queued = null;
    this._toLoco(0.45, from);
  }

  stopDance(silent) {
    if (this.state !== 'dance') return;
    this.state = 'loco';
    this._toLoco(0.35, 'dance');
    this.events.push({ type: 'dance', on: false, silent });
  }

  _toLoco(fade, from) {
    for (const k of ['idle', 'walk', 'run']) {
      const a = this.actions[k];
      if (!a.isRunning()) a.play();
      a.enabled = true;
    }
    const cur = from && this.actions[from];
    if (cur) cur.fadeOut(fade);
    this._locoFade = { t: 0, dur: fade };
  }

  _onFinished(action) {
    if (this.state !== 'action' || action !== this.actions[this.current]) return;
    const done = this.current;
    this.events.push({ type: 'end', name: done });
    if (this.queued) {
      const q = this.queued;
      this.queued = null;
      this._start(q, this._ctx);
      return;
    }
    this.state = 'loco';
    this.current = null;
    this._toLoco(0.25, done);
  }

  _assistFor(name, bags) {
    const an = this.analysis[name];
    if (!an || !an.windows.length) return null;
    let best = null, bestD = 2.6;
    const p = this.root.position;
    for (const b of bags) {
      if (b.state !== 'hanging') continue;
      const c = b.center(_a);
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      const ang = Math.abs(THREE.MathUtils.euclideanModulo(Math.atan2(c.x - p.x, c.z - p.z) - this.heading + Math.PI, Math.PI * 2) - Math.PI);
      const score = d + ang * 0.35;
      if (score < bestD) { bestD = score; best = b; }
    }
    if (!best) return null;
    // bag centre should sit just behind the average strike point
    // wrist peak + bag radius puts the glove right on the leather
    const aim = an.aim;
    const reach = Math.hypot(aim.x, aim.z + best.radius - 0.02);
    const side = Math.atan2(aim.x, aim.z + best.radius - 0.02);
    return { bag: best, reach, side, t: 0 };
  }

  // ---------------------------------------------------------------- update
  update(dt, move, camYaw, world) {
    this._ctx = { bags: world.bags };
    if (this.freeze > 0) { this.freeze -= dt; dt *= 0.05; }

    // --- locomotion input
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    let dx = fx * move.y + rx * move.x, dz = fz * move.y + rz * move.x;
    const mag = Math.min(1, Math.hypot(dx, dz));
    if (mag > 0.15 && (this.state === 'dance' || (this.state === 'action' && ['greet'].includes(this.current)))) {
      if (this.state === 'dance') this.stopDance();
      else { const c = this.current; this.state = 'loco'; this.current = null; this._toLoco(0.25, c); }
    }
    const canMove = this.state === 'loco';
    let targetSpeed = 0;
    if (canMove && mag > 0.08) {
      const l = Math.hypot(dx, dz); dx /= l; dz /= l;
      targetSpeed = move.run ? 4.2 : 0.6 + mag * 1.6;
      const want = Math.atan2(dx, dz);
      this.heading = this._turn(this.heading, want, dt * 10);
    }
    this.speed += (targetSpeed - this.speed) * Math.min(1, dt * (targetSpeed > this.speed ? 6 : 9));
    if (this.speed < 0.02) this.speed = 0;
    const p = this.root.position;
    if (canMove || this.speed > 0) {
      const s = canMove ? this.speed : this.speed * 0.9;
      if (!canMove) this.speed *= Math.max(0, 1 - dt * 10);
      p.x += Math.sin(this.heading) * s * dt;
      p.z += Math.cos(this.heading) * s * dt;
    }

    // --- loco blend weights
    if (this.state === 'loco') {
      const sp = this.speed;
      const wWalk = sp < 1.3 ? THREE.MathUtils.smoothstep(sp, 0.05, 0.9) : 1 - THREE.MathUtils.smoothstep(sp, 1.6, 3.4);
      const wRun = THREE.MathUtils.smoothstep(sp, 1.6, 3.4);
      const wIdle = Math.max(0, 1 - wWalk - wRun);
      let k = 1;
      if (this._locoFade) {
        this._locoFade.t += dt;
        k = Math.min(1, this._locoFade.t / this._locoFade.dur);
        if (k >= 1) this._locoFade = null;
      }
      this.actions.idle.setEffectiveWeight(wIdle * k);
      this.actions.walk.setEffectiveWeight(wWalk * k);
      this.actions.run.setEffectiveWeight(wRun * k);
      this.actions.walk.setEffectiveTimeScale(THREE.MathUtils.clamp(sp / 1.16, 0.6, 1.5));
      this.actions.run.setEffectiveTimeScale(THREE.MathUtils.clamp(sp / 4.1, 0.7, 1.25));
    }

    // --- attack assist: glide/turn to the ideal striking spot at the start of a move
    if (this.state === 'action' && this.assist) {
      const as = this.assist;
      as.t += dt;
      if (as.t < 0.35) {
        const c = as.bag.center(_a);
        const toBag = Math.atan2(c.x - p.x, c.z - p.z);
        this.heading = this._turn(this.heading, toBag - as.side, dt * 14);
        const d = Math.hypot(c.x - p.x, c.z - p.z);
        const err = d - as.reach;
        const step = THREE.MathUtils.clamp(err, -3.5 * dt, 3.5 * dt);
        p.x += Math.sin(toBag) * step;
        p.z += Math.cos(toBag) * step;
      }
    }

    // --- root motion (flip travels forward)
    if (this.state === 'action' && this.current === 'flip') {
      const r = this._sampleRoot('flip', this.actions.flip.time);
      if (r && this.prevRoot) {
        const ddx = (r[0] - this.prevRoot[0]) * this.scale, ddz = (r[1] - this.prevRoot[1]) * this.scale;
        const s = Math.sin(this.heading), c = Math.cos(this.heading);
        p.x += ddx * c + ddz * s;
        p.z += -ddx * s + ddz * c;
      }
      this.prevRoot = r;
    }

    if (this.state === 'action' && TRIM[this.current] && this.actions[this.current].time >= TRIM[this.current][1]) {
      this._onFinished(this.actions[this.current]);
    }

    world.resolve(p, 0.32);
    this.root.rotation.y = this.heading;
    this.mixer.update(dt);
    this.root.updateMatrixWorld(true);

    this._strikes(dt, world);
    this._footsteps(dt);
    const out = this.events;
    this.events = [];
    return out;
  }

  _turn(a, b, k) {
    const d = THREE.MathUtils.euclideanModulo(b - a + Math.PI, Math.PI * 2) - Math.PI;
    return a + d * Math.min(1, k);
  }

  _strikes(dt, world) {
    const cur = {};
    for (const k of Object.keys(LIMBS)) {
      cur[k] = this.limb[k].getWorldPosition(new THREE.Vector3());
    }
    if (this.state === 'action' && ATTACKS.includes(this.current)) {
      const an = this.analysis[this.current];
      const t = this.actions[this.current].time;
      const tp = this._tPrev != null && this._tPrev <= t ? this._tPrev : t;
      this._tPrev = t;
      an.windows.forEach((w, i) => {
        if (this.windowsDone.has(i)) return;
        // the frame interval [tp, t] must overlap the strike window
        if (t < w.t0 - 0.03 || tp > w.t1 + 0.05) {
          if (t > w.t1 + 0.05 && !this.missWhoosh.has(i)) {
            this.missWhoosh.add(i);
            this.events.push({ type: 'miss', power: w.peakSpeed / 6 });
          }
          return;
        }
        // test the whole path travelled since last frame, so low FPS can't skip a punch
        const prev = this.prevLimb[w.limb];
        let pos = null, hitBag = null;
        for (let s = 1; s <= 4 && !hitBag; s++) {
          const q = _b.copy(prev).lerp(cur[w.limb], s / 4);
          for (const bag of world.bags) {
            if (bag.contains(q, w.limb[1] === 'f' ? 0.15 : 0.13)) { hitBag = bag; pos = q.clone(); break; }
          }
        }
        if (hitBag) {
          const bag = hitBag;
          this.windowsDone.add(i);
          this.missWhoosh.add(i);
          const v = _b.copy(cur[w.limb]).sub(prev).divideScalar(Math.max(dt, 1e-3));
          const limbSpeed = v.length();
          const power = THREE.MathUtils.clamp(Math.max(limbSpeed, w.peakSpeed * 0.7) / 6, 0.45, 1.6);
          this.events.push({ type: 'hit', bag, pos, vel: v.clone(), power,
            kick: this.current === 'kick', limb: w.limb, move: this.current });
        }
      });
    }
    for (const k of Object.keys(LIMBS)) this.prevLimb[k].copy(cur[k]);
  }

  _footsteps() {
    this.toes.forEach((t, i) => {
      const y = t.getWorldPosition(_a).y - this.toeFloor;
      if (this.footDown[i] && y > 0.07) this.footDown[i] = false;
      else if (!this.footDown[i] && y < 0.03) {
        this.footDown[i] = true;
        this.events.push({ type: 'step', pos: _a.clone(), heavy: this.state === 'action' });
      }
    });
  }
}
