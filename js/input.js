// Touch joystick, action buttons, camera drag/pinch and keyboard — one place for all input.

export class Input {
  constructor(root) {
    this.move = { x: 0, y: 0 };      // joystick, y = forward
    this.run = false;
    this.camDelta = { x: 0, y: 0 };  // accumulated drag, consumed each frame
    this.zoomDelta = 0;
    this.actions = [];               // queued action names
    this.keys = new Set();
    this.enabled = true;
    this._joy = null;
    this._cam = new Map();           // pointerId -> {x,y}
    this._pinch = 0;

    this.joyBase = root.querySelector('#joy');
    this.joyKnob = root.querySelector('#joy-knob');
    this.zone = root.querySelector('#touch-zone');

    this.zone.addEventListener('pointerdown', (e) => this._down(e));
    window.addEventListener('pointermove', (e) => this._moveEv(e), { passive: false });
    window.addEventListener('pointerup', (e) => this._up(e));
    window.addEventListener('pointercancel', (e) => this._up(e));
    this.zone.addEventListener('wheel', (e) => { this.zoomDelta += Math.sign(e.deltaY) * 0.4; e.preventDefault(); }, { passive: false });

    root.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.classList.add('pressed');
        if (this.enabled) this.actions.push(btn.dataset.act);
        if (navigator.vibrate) try { navigator.vibrate(8); } catch (_) { /* ignore */ }
      });
      const rel = () => btn.classList.remove('pressed');
      btn.addEventListener('pointerup', rel);
      btn.addEventListener('pointerleave', rel);
      btn.addEventListener('pointercancel', rel);
    });

    const KEYMAP = { KeyJ: 'box_01', KeyK: 'box_02', KeyL: 'box_03', KeyU: 'kick', Space: 'jump',
      KeyG: 'greet', KeyH: 'dance', KeyF: 'flip' };
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (KEYMAP[e.code] && this.enabled) { this.actions.push(KEYMAP[e.code]); e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this._releaseJoy(); });
  }

  _down(e) {
    e.preventDefault();
    const w = window.innerWidth;
    // left 45% of the screen: floating joystick; elsewhere: camera
    if (!this._joy && e.clientX < w * 0.45 && e.pointerType !== 'mouse') {
      this._joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
      this.joyBase.style.left = e.clientX + 'px';
      this.joyBase.style.top = e.clientY + 'px';
      this.joyBase.classList.add('active');
      this.joyKnob.style.transform = 'translate(-50%,-50%)';
    } else {
      this._cam.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._cam.size === 2) this._pinch = this._pinchDist();
    }
  }

  _pinchDist() {
    const [a, b] = [...this._cam.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  _moveEv(e) {
    if (this._joy && e.pointerId === this._joy.id) {
      e.preventDefault();
      const R = 56;
      let dx = e.clientX - this._joy.ox, dy = e.clientY - this._joy.oy;
      const len = Math.hypot(dx, dy);
      if (len > R) { dx *= R / len; dy *= R / len; }
      this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      this.move.x = dx / R;
      this.move.y = -dy / R;
      this.run = len > R * 0.8;
      return;
    }
    const p = this._cam.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    if (this._cam.size === 2) {
      p.x = e.clientX; p.y = e.clientY;
      const d = this._pinchDist();
      this.zoomDelta -= (d - this._pinch) * 0.012;
      this._pinch = d;
      return;
    }
    this.camDelta.x += e.clientX - p.x;
    this.camDelta.y += e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
  }

  _up(e) {
    if (this._joy && e.pointerId === this._joy.id) this._releaseJoy();
    this._cam.delete(e.pointerId);
  }

  _releaseJoy() {
    this._joy = null;
    this.move.x = this.move.y = 0;
    this.run = false;
    this.joyBase.classList.remove('active');
  }

  // Combined movement vector (touch + keyboard). Returns {x, y, run}.
  getMove() {
    let x = this.move.x, y = this.move.y, run = this.run;
    const k = this.keys;
    const kx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const ky = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    if (kx || ky) {
      const l = Math.hypot(kx, ky);
      const sp = k.has('ShiftLeft') || k.has('ShiftRight') ? 1 : 0.55;
      x = kx / l * sp; y = ky / l * sp; run = sp > 0.9;
    }
    if (!this.enabled) return { x: 0, y: 0, run: false };
    return { x, y, run };
  }

  takeActions() {
    const a = this.actions;
    this.actions = [];
    return this.enabled ? a : [];
  }

  takeCam() {
    const d = { x: this.camDelta.x, y: this.camDelta.y, z: this.zoomDelta };
    this.camDelta.x = this.camDelta.y = 0;
    this.zoomDelta = 0;
    return d;
  }
}
