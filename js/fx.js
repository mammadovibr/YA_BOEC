import * as THREE from 'three';

// GPU-light particle pool: one Points draw call, per-particle size/alpha/colour.
export class Particles {
  constructor(scene, max = 600) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grow = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { scale: { value: 600 } },
      vertexShader: `
        attribute float size; attribute float alpha; attribute vec3 color;
        varying float vA; varying vec3 vC; uniform float scale;
        void main(){
          vA = alpha; vC = color;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = size * scale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vA; varying vec3 vC;
        void main(){
          vec2 d = gl_PointCoord - 0.5;
          float r = dot(d,d)*4.0;
          if (r > 1.0) discard;
          float a = (1.0 - r); a *= a;
          gl_FragColor = vec4(vC * a * vA, a * vA);
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  setScale(h) { this.points.material.uniforms.scale.value = h * 0.9; }

  emit(p, o = {}) {
    if (this.n >= this.max) return;
    const i = this.n++;
    const sp = o.speed ?? 2, dir = o.dir;
    let vx = (Math.random() - 0.5) * 2, vy = Math.random() * (o.up ?? 1), vz = (Math.random() - 0.5) * 2;
    if (dir) { vx = vx * (o.spread ?? 0.6) + dir.x; vy = vy * (o.spread ?? 0.6) + dir.y; vz = vz * (o.spread ?? 0.6) + dir.z; }
    const l = Math.hypot(vx, vy, vz) || 1;
    const s = sp * (0.4 + Math.random() * 0.6);
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([vx / l * s, vy / l * s, vz / l * s], i * 3);
    const c = o.color ?? [1, 0.8, 0.5];
    this.col.set(c, i * 3);
    this.size[i] = o.size ?? 0.05;
    this.maxLife[i] = this.life[i] = (o.life ?? 0.5) * (0.6 + Math.random() * 0.5);
    this.grav[i] = o.gravity ?? 6;
    this.drag[i] = o.drag ?? 2;
    this.grow[i] = o.grow ?? 0;
    this.alpha[i] = o.alpha ?? 1;
  }

  impact(p, dir, power, kick) {
    const n = Math.floor(10 + power * 18);
    for (let i = 0; i < n; i++) {
      this.emit(p, { dir, speed: 2 + power * 3.5, spread: 1.4, size: 0.035 + Math.random() * 0.03, life: 0.35,
        color: kick ? [1, 0.55, 0.25] : [1, 0.85, 0.55], gravity: 7, drag: 3 });
    }
    // dusty puff off the leather
    for (let i = 0; i < 6 + power * 6; i++) {
      this.emit(p, { dir: { x: dir.x * 0.3, y: 0.2, z: dir.z * 0.3 }, speed: 0.6, spread: 2, size: 0.18, life: 0.9,
        color: [0.25, 0.22, 0.2], gravity: -0.4, drag: 2.5, grow: 0.35, alpha: 0.7 });
    }
  }

  sand(p, n = 80) {
    for (let i = 0; i < n; i++) {
      this.emit(p, { speed: 2.5, up: 1.5, size: 0.06 + Math.random() * 0.12, life: 1.4, color: [0.65, 0.55, 0.38],
        gravity: 3, drag: 1.5, grow: 0.25, alpha: 0.8 });
    }
  }

  dust(p, n = 4) {
    for (let i = 0; i < n; i++) {
      this.emit(p, { speed: 0.4, up: 0.4, size: 0.12, life: 0.7, color: [0.18, 0.16, 0.14], gravity: -0.2, drag: 3, grow: 0.3, alpha: 0.6 });
    }
  }

  confetti(p, n = 60) {
    const pal = [[1, 0.2, 0.3], [1, 0.85, 0.2], [0.3, 0.8, 1], [0.6, 1, 0.4]];
    for (let i = 0; i < n; i++) {
      this.emit(p, { speed: 4, up: 3, size: 0.06, life: 1.6, color: pal[i % 4], gravity: 4, drag: 1.2 });
    }
  }

  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap-remove
        const last = --this.n;
        if (i !== last) {
          this.pos.copyWithin(i * 3, last * 3, last * 3 + 3);
          this.vel.copyWithin(i * 3, last * 3, last * 3 + 3);
          this.col.copyWithin(i * 3, last * 3, last * 3 + 3);
          for (const a of [this.size, this.alpha, this.life, this.maxLife, this.grav, this.drag, this.grow]) a[i] = a[last];
        }
        continue;
      }
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.01) { this.pos[i * 3 + 1] = 0.01; this.vel[i * 3 + 1] *= -0.3; }
      this.size[i] += this.grow[i] * dt;
      const lf = this.life[i] / this.maxLife[i];
      this.alpha[i] = Math.min(this.alpha[i], lf * 1.5);
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    for (const k of ['position', 'color', 'size', 'alpha']) this.geo.attributes[k].needsUpdate = true;
  }
}

// Expanding ring flash at the impact point.
export class Shockwaves {
  constructor(scene) {
    this.pool = [];
    const geo = new THREE.RingGeometry(0.6, 1, 40);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffe0b0, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.visible = false;
      m.userData.t = 1;
      scene.add(m);
      this.pool.push(m);
    }
  }

  spawn(p, camera, power) {
    const m = this.pool.find((x) => !x.visible) || this.pool[0];
    m.position.copy(p);
    m.quaternion.copy(camera.quaternion);
    m.userData.t = 0;
    m.userData.s = 0.12 + power * 0.2;
    m.visible = true;
  }

  update(dt) {
    for (const m of this.pool) {
      if (!m.visible) continue;
      m.userData.t += dt * 4;
      const t = m.userData.t;
      if (t >= 1) { m.visible = false; continue; }
      m.scale.setScalar(m.userData.s * (0.3 + t * 1.4));
      m.material.opacity = (1 - t) * 0.9;
    }
  }
}
