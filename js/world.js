import * as THREE from 'three';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

// A hanging heavy bag: 2D pendulum (swing) + twist, can be torn off and respawned.
export class Bag {
  constructor(pivot, body, index) {
    this.pivot = pivot;
    this.body = body;
    this.index = index;
    this.home = pivot.position.clone();
    this.bodyHome = body.position.clone();
    this.length = -body.position.y;        // pivot -> bag centre
    this.radius = 0.2;
    const box = new THREE.Box3().setFromObject(body);
    this.halfH = (box.max.y - box.min.y) / 2;
    this.a = new THREE.Vector2();          // swing angle (x, z)
    this.w = new THREE.Vector2();          // angular velocity
    this.twist = 0; this.twistV = 0;
    this.maxHp = 1000;
    this.hp = this.maxHp;
    this.state = 'hanging';                // hanging | falling | down | lowering
    this.timer = 0;
    this.fall = { v: new THREE.Vector3(), spin: new THREE.Vector3() };
  }

  // world position of the bag centre
  center(out = new THREE.Vector3()) {
    return this.body.getWorldPosition(out);
  }

  // horizontal velocity of the bag centre (m/s)
  velocity(out = new THREE.Vector2()) {
    return out.set(this.w.x * this.length, this.w.y * this.length);
  }

  // Is world point p inside the bag (with margin)? Returns penetration info or null.
  contains(p, margin = 0.1) {
    if (this.state !== 'hanging') return null;
    const local = this.body.worldToLocal(_v.copy(p));
    const r = Math.hypot(local.x, local.z);
    if (r < this.radius + margin && Math.abs(local.y) < this.halfH + 0.05) return { r, y: local.y };
    return null;
  }

  hit(dirX, dirZ, impulse, twist = 0) {
    // angular velocity kick: v = J / (m L)
    this.w.x += dirX * impulse / this.length;
    this.w.y += dirZ * impulse / this.length;
    this.twistV += twist;
  }

  update(dt) {
    if (this.state === 'hanging' || this.state === 'lowering') {
      const g = 9.81 / this.length;
      const damp = 0.55;
      // semi-implicit Euler, sub-stepped for stability
      const n = 3, h = dt / n;
      for (let i = 0; i < n; i++) {
        this.w.x += (-g * Math.sin(this.a.x) - damp * this.w.x) * h;
        this.w.y += (-g * Math.sin(this.a.y) - damp * this.w.y) * h;
        this.a.x += this.w.x * h;
        this.a.y += this.w.y * h;
      }
      const lim = 0.9;
      this.a.x = THREE.MathUtils.clamp(this.a.x, -lim, lim);
      this.a.y = THREE.MathUtils.clamp(this.a.y, -lim, lim);
      this.twistV += (-6 * this.twist - 1.2 * this.twistV) * dt;
      this.twist += this.twistV * dt;
      this.pivot.rotation.set(-this.a.y, this.twist, this.a.x, 'XZY');
      // rotation about Z moves the bottom along +x, about X moves it along -z
      this.pivot.rotation.z = this.a.x;
      this.pivot.rotation.x = -this.a.y;
    }
    if (this.state === 'lowering') {
      this.timer += dt;
      const k = Math.min(1, this.timer / 2.2);
      const e = 1 - Math.pow(1 - k, 3);
      this.body.position.copy(this.bodyHome);
      this.body.position.y += (1 - e) * 2.6;
      this.body.scale.setScalar(0.4 + 0.6 * e);
      if (k >= 1) { this.state = 'hanging'; this.hp = this.maxHp; }
    }
    if (this.state === 'falling') {
      const f = this.fall;
      f.v.y -= 9.81 * dt;
      this.body.position.addScaledVector(f.v, dt);
      this.body.rotation.x += f.spin.x * dt;
      this.body.rotation.z += f.spin.z * dt;
      const floorY = this.radius + 0.02;
      if (this.body.position.y < floorY) {
        this.body.position.y = floorY;
        // settle lying on its side
        this.body.rotation.x = THREE.MathUtils.lerp(this.body.rotation.x, Math.PI / 2 * Math.sign(this.body.rotation.x || 1), 0.5);
        this.body.rotation.z *= 0.5;
        f.v.set(0, 0, 0);
        this.state = 'down';
        this.timer = 0;
        return 'landed';
      }
    }
    if (this.state === 'down') {
      this.timer += dt;
      if (this.timer > 3.5) {
        // reattach to the chain and lower a fresh bag
        this.pivot.attach(this.body);
        this.body.rotation.set(0, 0, 0);
        this.body.position.copy(this.bodyHome);
        this.state = 'lowering';
        this.timer = 0;
        return 'respawn';
      }
    }
    return null;
  }

  tearOff(scene, dirX, dirZ) {
    this.state = 'falling';
    scene.attach(this.body);
    this.fall.v.set(dirX * 1.6, 1.2, dirZ * 1.6);
    this.fall.spin.set(dirZ * 3, 0, -dirX * 3);
  }
}

export class World {
  constructor(scene, gltf, quality) {
    this.scene = scene;
    this.root = gltf.scene;
    scene.add(this.root);
    this.bags = [];
    this.colliders = [];   // {min:Vector2, max:Vector2}
    this.circles = [];     // {x, z, r, bag}
    this.lampPos = [];
    this.bounds = null;
    this.spawn = new THREE.Vector3(0, 0, 1.6);
    this.discoT = 0;       // 0..1 disco blend
    this.time = 0;

    const pivots = {}, bodies = {};
    this.root.traverse((o) => {
      if (o.isMesh) {
        o.receiveShadow = true;
        o.castShadow = /Bag|Ring|Rack|Bench|Tire|Lockers|Lamps|Disco/.test(o.name) || /Bag/.test(o.parent?.name || '');
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          if (m.map) m.map.anisotropy = quality === 'high' ? 8 : 4;
          if (m.name === 'Mirror') { m.envMapIntensity = 1.6; }
          if (m.name === 'Chrome' || m.name === 'Gold' || m.name === 'Disco') m.envMapIntensity = 1.4;
        });
      }
      const n = o.name;
      if (n.startsWith('BagPivot_')) pivots[n.slice(9)] = o;
      else if (n.startsWith('BagBody_')) bodies[n.slice(8)] = o;
      else if (n.startsWith('LAMP_')) this.lampPos.push(o.getWorldPosition(new THREE.Vector3()));
      else if (n === 'Spawn') o.getWorldPosition(this.spawn);
      else if (n === 'DiscoBall') this.disco = o;
      else if (n === 'Neon') this.neon = o;
      else if (n === 'NeonFrame') this.neonFrame = o;
    });
    this.root.updateMatrixWorld(true);
    this.root.traverse((o) => {
      if (!o.name.startsWith('COL_')) return;
      const p = o.getWorldPosition(new THREE.Vector3());
      const s = o.getWorldScale(new THREE.Vector3());
      if (o.name === 'COL_bounds') {
        this.bounds = { minX: p.x - s.x + 0.3, maxX: p.x + s.x - 0.3, minZ: p.z - s.z + 0.3, maxZ: p.z + s.z - 0.3 };
      } else if (!o.name.startsWith('COL_bag')) {
        this.colliders.push({ minX: p.x - s.x, maxX: p.x + s.x, minZ: p.z - s.z, maxZ: p.z + s.z });
      }
    });
    Object.keys(pivots).sort().forEach((k) => {
      const bag = new Bag(pivots[k], bodies[k], Number(k));
      this.bags.push(bag);
      this.circles.push({ x: bag.home.x, z: bag.home.z, r: 0.42, bag });
    });

    if (this.disco) {
      this.discoHome = this.disco.position.clone();
    }
    this.neonMats = [];
    [this.neon, this.neonFrame].forEach((o) => o && o.traverse((m) => {
      if (m.isMesh) {
        m.material = m.material.clone();
        m.material.userData.base = m.material.emissiveIntensity;
        this.neonMats.push(m.material);
        m.castShadow = false;
      }
    }));

    this._setupLights(quality);
    this._setupDiscoDots();
  }

  _setupLights(quality) {
    const s = this.scene;
    this.hemi = new THREE.HemisphereLight(0xffe2c4, 0x1a1c28, 0.55);
    s.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0x404858, 0.35);
    s.add(this.ambient);

    // key spotlight over the training area — the only shadow caster
    const key = new THREE.SpotLight(0xffd7a8, 60, 14, Math.PI / 3.2, 0.55, 1.6);
    key.position.set(1.0, 4.3, 1.8);
    key.target.position.set(1.5, 0, -1.5);
    key.castShadow = quality !== 'low';
    key.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 12;
    s.add(key, key.target);
    this.key = key;

    // warm practical lights under the pendant lamps (no shadows, cheap)
    this.lampLights = [];
    const use = quality === 'low' ? [0, 3] : [0, 2, 3, 4, 6];
    use.forEach((i) => {
      const p = this.lampPos[i];
      if (!p) return;
      const l = new THREE.PointLight(0xffc890, i === 3 ? 14 : 9, 7.5, 1.8);
      l.position.copy(p);
      s.add(l);
      this.lampLights.push(l);
    });

    // neon glow spill on the back wall
    this.neonLight = new THREE.PointLight(0xff2030, 10, 7, 1.8);
    this.neonLight.position.set(0, 3.2, -7.2);
    s.add(this.neonLight);

    // moonlight through the windows
    const moon = new THREE.DirectionalLight(0x7f9cff, 0.35);
    moon.position.set(-10, 6, 2);
    s.add(moon);

    // disco spots (off until dancing)
    this.discoSpots = [0xff2a6d, 0x2af5ff, 0xffe23a, 0x8a5bff].map((c, i) => {
      const l = new THREE.SpotLight(c, 0, 16, 0.32, 0.4, 1.2);
      l.position.set(0, 4.2, 1.5);
      l.target.position.set(Math.cos(i) * 3, 0, Math.sin(i) * 3);
      s.add(l, l.target);
      return l;
    });
  }

  _setupDiscoDots() {
    const N = 220;
    this.dotDirs = [];
    for (let i = 0; i < N; i++) {
      const v = new THREE.Vector3().randomDirection();
      if (v.y > 0.6) v.y *= -1;
      this.dotDirs.push(v.normalize());
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const colors = new Float32Array(N * 3);
    const pal = [[1, 1, 1], [1, 0.4, 0.7], [0.4, 0.9, 1], [1, 0.9, 0.4]];
    for (let i = 0; i < N; i++) colors.set(pal[i % pal.length], i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.3, 'rgba(255,255,255,0.6)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    const mat = new THREE.PointsMaterial({ size: 0.22, map: new THREE.CanvasTexture(c), vertexColors: true,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    this.dots = new THREE.Points(geo, mat);
    this.dots.frustumCulled = false;
    this.dots.visible = false;
    this.scene.add(this.dots);
  }

  setDisco(on) { this.discoOn = on; }

  update(dt) {
    this.time += dt;
    const events = [];
    this.bags.forEach((b) => {
      const ev = b.update(dt);
      if (ev) events.push({ type: ev, bag: b });
    });

    // neon flicker: mostly steady, occasional stutter
    if (this.neonMats.length) {
      if (!this._flick || this.time > this._flickEnd + 4 + Math.random() * 6) {
        this._flick = true;
        this._flickEnd = this.time + 0.4;
      }
      let k = 1;
      if (this.time < this._flickEnd) {
        k = Math.random() > 0.5 ? 1 : 0.15;
        if (k < 1 && Math.random() < 0.3) events.push({ type: 'crackle' });
      }
      const base = 1 - this.discoT * 0.3;
      this.neonMats.forEach((m) => { m.emissiveIntensity = m.userData.base * k * base; });
      this.neonLight.intensity = 10 * k * base;
    }

    // disco blend
    const target = this.discoOn ? 1 : 0;
    this.discoT += (target - this.discoT) * Math.min(1, dt * 2.2);
    const d = this.discoT;
    if (this.disco) {
      this.disco.position.y = this.discoHome.y - d * 0.75;
      this.disco.rotation.y += dt * (0.4 + d * 1.2);
    }
    this.hemi.intensity = 0.55 * (1 - d * 0.75);
    this.ambient.intensity = 0.35 * (1 - d * 0.6);
    this.key.intensity = 60 * (1 - d * 0.8);
    this.lampLights.forEach((l) => { l.intensity = (l.userData.base ??= l.intensity) * (1 - d * 0.85); });
    this.discoSpots.forEach((l, i) => {
      l.intensity = d * 90;
      const a = this.time * (0.7 + i * 0.23) + i * 1.7;
      l.target.position.set(Math.cos(a) * (2.5 + i), 0, 1.5 + Math.sin(a * 1.3) * (2.5 + i * 0.5));
      if (this.disco) l.position.copy(this.disco.getWorldPosition(_v));
    });

    this.dots.visible = d > 0.02;
    if (this.dots.visible && this.disco && this.bounds) {
      this.dots.material.opacity = d;
      const c = this.disco.getWorldPosition(new THREE.Vector3());
      const pos = this.dots.geometry.attributes.position;
      _q.setFromAxisAngle(_v.set(0, 1, 0), this.disco.rotation.y);
      const B = { minX: this.bounds.minX - 0.28, maxX: this.bounds.maxX + 0.28, minZ: this.bounds.minZ - 0.28, maxZ: this.bounds.maxZ + 0.28 };
      const dir = new THREE.Vector3();
      for (let i = 0; i < this.dotDirs.length; i++) {
        dir.copy(this.dotDirs[i]).applyQuaternion(_q);
        // ray vs room box (floor at 0, ceiling 4.55)
        let t = Infinity;
        if (dir.x > 0) t = Math.min(t, (B.maxX - c.x) / dir.x); else if (dir.x < 0) t = Math.min(t, (B.minX - c.x) / dir.x);
        if (dir.z > 0) t = Math.min(t, (B.maxZ - c.z) / dir.z); else if (dir.z < 0) t = Math.min(t, (B.minZ - c.z) / dir.z);
        if (dir.y < 0) t = Math.min(t, (0.02 - c.y) / dir.y); else if (dir.y > 0) t = Math.min(t, (4.5 - c.y) / dir.y);
        pos.setXYZ(i, c.x + dir.x * t * 0.995, c.y + dir.y * t * 0.995, c.z + dir.z * t * 0.995);
      }
      pos.needsUpdate = true;
    }
    return events;
  }

  // Push a circle (player) out of all colliders.
  resolve(p, r) {
    const b = this.bounds;
    if (b) {
      p.x = THREE.MathUtils.clamp(p.x, b.minX + r, b.maxX - r);
      p.z = THREE.MathUtils.clamp(p.z, b.minZ + r, b.maxZ - r);
    }
    for (const c of this.colliders) {
      const cx = THREE.MathUtils.clamp(p.x, c.minX, c.maxX);
      const cz = THREE.MathUtils.clamp(p.z, c.minZ, c.maxZ);
      const dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          p.x = cx + dx / d * r; p.z = cz + dz / d * r;
        } else {
          // centre inside the box: push out along the shallowest axis
          const pen = [p.x - c.minX, c.maxX - p.x, p.z - c.minZ, c.maxZ - p.z];
          const m = Math.min(...pen);
          if (m === pen[0]) p.x = c.minX - r; else if (m === pen[1]) p.x = c.maxX + r;
          else if (m === pen[2]) p.z = c.minZ - r; else p.z = c.maxZ + r;
        }
      }
    }
    for (const c of this.circles) {
      if (c.bag.state !== 'hanging' && c.bag.state !== 'lowering') continue;
      const dx = p.x - c.x, dz = p.z - c.z;
      const d = Math.hypot(dx, dz), m = c.r + r * 0.5;
      if (d < m && d > 1e-6) { p.x = c.x + dx / d * m; p.z = c.z + dz / d * m; }
    }
  }
}
