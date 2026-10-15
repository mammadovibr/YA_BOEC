import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Sound } from './audio.js';
import { Input } from './input.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Particles, Shockwaves } from './fx.js';
import { Game, ACHIEVEMENTS } from './game.js';

const $ = (s) => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem('yaboec:' + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem('yaboec:' + k, JSON.stringify(v)); } catch (_) { /* ignore */ } },
};

// ------------------------------------------------------------------ quality
function autoQuality() {
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && innerWidth < 1100);
  const cores = navigator.hardwareConcurrency || 4;
  if (!mobile) return 'high';
  return cores >= 6 ? 'medium' : 'low';
}
let qualityPref = store.get('quality', 'auto');
let quality = qualityPref === 'auto' ? autoQuality() : qualityPref;
const PIXEL_RATIO = { high: 2, medium: 1.5, low: 1 };

// ------------------------------------------------------------------ renderer
const renderer = new THREE.WebGLRenderer({ antialias: quality !== 'low', powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, PIXEL_RATIO[quality]));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = quality !== 'low';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('#app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0b10);
scene.fog = new THREE.Fog(0x0b0b10, 14, 30);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.28;

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 60);

let composer, bloom;
function setupComposer() {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.55, 0.45, 0.82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
}
if (quality !== 'low') setupComposer();

// ------------------------------------------------------------------ UI helpers
const ui = {
  setScore(v) { $('#score').textContent = v; },
  setCombo(n, m) {
    const el = $('#combo');
    el.classList.toggle('on', n >= 2);
    $('#combo-n').textContent = n;
    $('#combo-m').textContent = '×' + m;
    el.classList.remove('bump'); void el.offsetWidth; if (n >= 2) el.classList.add('bump');
    clearTimeout(ui._cb); ui._cb = setTimeout(() => el.classList.remove('bump'), 120);
  },
  setTimer(t) {
    const el = $('#timer');
    if (t == null) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.textContent = Math.ceil(t);
    el.classList.toggle('low', t <= 10 && t > 0);
  },
  coach(text) {
    const el = $('#coach');
    el.textContent = text;
    el.classList.add('on');
    clearTimeout(ui._ct); ui._ct = setTimeout(() => el.classList.remove('on'), 2200);
  },
  popup(text, worldPos, cls = '') {
    const v = worldPos.clone().project(camera);
    if (v.z > 1) return;
    const el = document.createElement('div');
    el.className = 'pop ' + cls;
    el.textContent = text;
    el.style.left = ((v.x + 1) / 2 * innerWidth + (Math.random() - 0.5) * 40) + 'px';
    el.style.top = ((1 - v.y) / 2 * innerHeight) + 'px';
    $('#popups').appendChild(el);
    setTimeout(() => el.remove(), 1000);
  },
  popupCenter(text, cls = '') {
    const el = document.createElement('div');
    el.className = 'pop center ' + cls;
    el.textContent = text;
    $('#popups').appendChild(el);
    setTimeout(() => el.remove(), 1700);
  },
  bigText(t) {
    const el = $('#big-text');
    el.textContent = t;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  },
  toast(icon, title) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<b>${icon}</b><div><small>Достижение</small>${title}</div>`;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 3300);
    renderAchievements();
  },
  results(r) {
    $('#res-title').textContent = r.newBest ? '🏆 Новый рекорд!' : 'Раунд окончен';
    $('#res-rank').textContent = r.rank;
    $('#res-score').textContent = r.score;
    $('#res-hits').textContent = r.hits;
    $('#res-combo').textContent = r.maxCombo;
    $('#res-best').textContent = r.best;
    show('results');
  },
  bagHp(frac) {
    const el = $('#bag-hp');
    el.classList.toggle('hidden', frac == null);
    if (frac != null) el.firstElementChild.style.width = (frac * 100).toFixed(1) + '%';
  },
};

// iOS: play Web Audio even when the ring/silent switch is on (Safari 16.4+)
try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (_) { /* older iOS */ }

const sound = new Sound();
sound.enabled = store.get('sound', true);
sound.musicOn = store.get('music', true);
const game = new Game(ui, sound);
const input = new Input(document.body);

function renderAchievements() {
  $('#ach-list').innerHTML = Object.entries(ACHIEVEMENTS).map(([id, [icon, title, desc]]) =>
    `<div class="ach ${game.unlocked.has(id) ? 'on' : ''}" title="${title} — ${desc}">${icon}</div>`).join('');
}

function show(name) {
  for (const s of ['loading', 'menu', 'results']) $('#' + s).classList.toggle('hidden', s !== name);
  const playing = name === null;
  $('#hud').classList.toggle('hidden', !playing);
  input.enabled = playing;
  if (name === 'menu') {
    $('#best').textContent = game.best;
    renderAchievements();
  }
}

// ------------------------------------------------------------------ loading
const manager = new THREE.LoadingManager();
const loader = new GLTFLoader(manager);
loader.setMeshoptDecoder(MeshoptDecoder);
const progress = { gym: 0, hero: 0 };
const SIZES = { gym: 0.7, hero: 2.5 };
function onProg(key) {
  return (e) => {
    progress[key] = e.total ? e.loaded / e.total : Math.min(0.95, e.loaded / (SIZES[key] * 1e6));
    const p = (progress.gym * SIZES.gym + progress.hero * SIZES.hero) / (SIZES.gym + SIZES.hero);
    $('#load-bar').style.width = (p * 100).toFixed(0) + '%';
    $('#load-text').textContent = `Загрузка зала… ${(p * 100).toFixed(0)}%`;
  };
}
const load = (url, key) => new Promise((res, rej) => loader.load(url, res, onProg(key), rej));

let world, player, particles, shock;
const camState = {
  yaw: 0, pitch: 0.3, dist: 3.4, target: new THREE.Vector3(), shake: 0, greetYaw: null, auto: 0,
  mode: 'menu',   // menu: portrait shot of the hero | intro: fly-around | game: third person
  cur: { yaw: Math.PI, pitch: 0.03, dist: 1.3, ty: 1.42, side: 0, lift: 0 },
  intro: null,
};
let introActive = false, introDone = null;

async function init() {
  const [gym, hero] = await Promise.all([load('assets/gym.glb', 'gym'), load('assets/hero.glb', 'hero')]);
  world = new World(scene, gym, quality);
  player = new Player(hero, scene);
  player.root.position.copy(world.spawn);
  player.heading = Math.PI;
  particles = new Particles(scene);
  particles.setScale(innerHeight * renderer.getPixelRatio());
  shock = new Shockwaves(scene);
  camState.target.copy(player.root.position).add(new THREE.Vector3(0, 1.25, 0));
  Object.assign(camState.cur, menuParams(0));
  updateCamera(0.016, true);
  // warm up shaders so the first punch does not stutter
  renderer.compile(scene, camera);
  $('#load-text').textContent = 'Готово!';
  show('menu');
  setTimeout(() => {
    if (innerHeight > innerWidth && /Android|iPhone/i.test(navigator.userAgent)) $('#rotate-hint').classList.remove('hidden');
  }, 600);
  last = performance.now();
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------ menu wiring
function startMode(mode) {
  sound.unlock();
  sound.ui();
  if (introActive) return;
  if (mode === 'menu') { game.mode = 'menu'; camState.mode = 'menu'; show('menu'); $('[data-menu="resume"]').classList.add('hidden'); return; }
  $('[data-menu="resume"]').classList.add('hidden');
  if (mode === 'resume') {
    playIntro(false, () => { show(null); paused = false; });
  } else {
    sound.setMusic('gym');
    playIntro(true, () => {
      show(null);
      paused = false;
      if (mode === 'free') game.startFree(); else game.startRound();
      if (!store.get('camHint', false)) {
        store.set('camHint', true);
        setTimeout(() => ui.popupCenter('👆 Свайп справа — повернуть камеру', ''), 600);
      }
    });
  }
  try {
    if (/Android|iPhone|iPad/i.test(navigator.userAgent) && !document.fullscreenElement && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
    }
  } catch (_) { /* optional */ }
}
document.querySelectorAll('[data-menu]').forEach((b) => b.addEventListener('click', () => startMode(b.dataset.menu)));

let paused = false;
$('#btn-menu').addEventListener('click', () => {
  sound.ui();
  paused = game.mode === 'round';
  camState.mode = 'menu';
  show('menu');
  if (game.mode === 'free' || game.mode === 'round') $('[data-menu="resume"]').classList.remove('hidden');
});
function syncChips() {
  $('#set-sound').classList.toggle('off', !sound.enabled);
  $('#set-music').classList.toggle('off', !sound.musicOn);
  $('#set-voice').classList.toggle('off', !game.voice);
  $('#btn-sound').textContent = sound.enabled ? '🔊' : '🔇';
  const names = { auto: 'авто', high: 'высокая', medium: 'средняя', low: 'низкая' };
  $('#set-quality').textContent = '✨ Графика: ' + names[qualityPref];
}
const toggleSound = () => { sound.unlock(); sound.setEnabled(!sound.enabled); store.set('sound', sound.enabled); syncChips(); };
$('#set-sound').addEventListener('click', toggleSound);
$('#btn-sound').addEventListener('click', toggleSound);
$('#set-music').addEventListener('click', () => { sound.unlock(); sound.setMusicOn(!sound.musicOn); store.set('music', sound.musicOn); syncChips(); });
$('#set-voice').addEventListener('click', () => { game.setVoice(!game.voice); syncChips(); if (game.voice) game.say('Я твой тренер!', true); });
$('#set-quality').addEventListener('click', () => {
  const order = ['auto', 'high', 'medium', 'low'];
  qualityPref = order[(order.indexOf(qualityPref) + 1) % order.length];
  store.set('quality', qualityPref);
  syncChips();
  // simplest reliable way to rebuild lights/shadows/composer
  setTimeout(() => location.reload(), 250);
});
$('#btn-full').addEventListener('click', () => {
  try {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  } catch (_) { /* iOS Safari has no fullscreen API for pages */ }
});
syncChips();
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (game.mode === 'round' || game.mode === 'free') && !$('#hud').classList.contains('hidden')) {
    $('#btn-menu').click();
  }
});

// ------------------------------------------------------------------ camera
const _t = new THREE.Vector3();
const _look = new THREE.Vector3();
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const lerpAngle = (a, b, k) => a + (THREE.MathUtils.euclideanModulo(b - a + Math.PI, Math.PI * 2) - Math.PI) * k;

// Menu shot: hero facing the camera, framed from the waist up, pushed aside so the menu fits.
function menuParams(time) {
  const portrait = innerHeight > innerWidth;
  return {
    yaw: (player ? player.heading : Math.PI) + Math.sin(time * 0.25) * 0.1,
    pitch: 0.03,
    dist: portrait ? 2.0 : 1.3,
    ty: 1.4,
    side: portrait ? 0 : Math.min(0.55, 0.32 * innerWidth / innerHeight),
    lift: portrait ? 0.62 : 0,
  };
}

function gameParams(dt, d) {
  camState.yaw -= d.x * 0.0065;
  camState.pitch = THREE.MathUtils.clamp(camState.pitch + d.y * 0.004, -0.05, 1.1);
  const portrait = innerHeight > innerWidth;
  camState.dist = THREE.MathUtils.clamp(camState.dist + d.z, portrait ? 2.6 : 1.8, 7);
  if (Math.abs(d.x) + Math.abs(d.y) > 0) camState.greetYaw = null;
  // cinematic helpers
  if (player.state === 'action' && player.current === 'greet' && camState.greetYaw == null) camState.greetYaw = player.heading;
  if (camState.greetYaw != null) {
    if (player.current !== 'greet') camState.greetYaw = null;
    else camState.yaw = lerpAngle(camState.yaw, camState.greetYaw, Math.min(1, dt * 2.5));
  }
  if (player.state === 'dance') camState.yaw += dt * 0.35;
  const extra = (player.current === 'flip' ? 1.2 : 0) + (player.state === 'dance' ? 0.8 : 0) + (portrait ? 1.2 : 0);
  camState.auto += (extra - camState.auto) * Math.min(1, dt * 2);
  return { yaw: camState.yaw, pitch: camState.pitch, dist: camState.dist + camState.auto,
    ty: player.current === 'flip' ? 1.0 : 1.25, side: 0, lift: 0 };
}

// Play pressed: push in on the hero (he waves), then orbit 180° to behind his back.
function playIntro(wave, done) {
  introActive = true;
  introDone = done;
  input.enabled = false;
  $('#menu').classList.add('hidden');
  $('#results').classList.add('hidden');
  const start = { ...camState.cur };
  const portrait = innerHeight > innerWidth;
  camState.yaw = player.heading + Math.PI;   // directly behind
  camState.pitch = 0.3;
  camState.dist = 3.4;
  camState.auto = portrait ? 1.2 : 0;
  const push = { ...start, dist: start.dist * 0.72, side: 0, lift: 0, ty: 1.45, pitch: 0.06 };
  camState.intro = { t: 0, start, push, A: wave ? 1.5 : 0.6, B: 2.6 };
  camState.mode = 'intro';
  if (wave) {
    player.trigger('greet');
    sound.whoosh(0.25);
  }
}

function finishIntro() {
  camState.mode = 'game';
  camState.intro = null;
  introActive = false;
  if (player.current === 'greet') player.cancelAction();
  const cb = introDone;
  introDone = null;
  if (cb) cb();
}

function updateCamera(dt, snap = false) {
  const d = input.takeCam();
  const c = camState.cur;
  let p;
  if (camState.mode === 'game') {
    p = gameParams(dt, d);
    Object.assign(c, p);
  } else if (camState.mode === 'menu') {
    p = menuParams(performance.now() / 1000);
    const k = snap ? 1 : Math.min(1, dt * 2.2);
    c.yaw = lerpAngle(c.yaw, p.yaw, k);
    for (const key of ['pitch', 'dist', 'ty', 'side', 'lift']) c[key] += (p[key] - c[key]) * k;
  } else {
    const it = camState.intro;
    it.t += dt;
    if (it.t < it.A) {
      const k = ease(it.t / it.A);
      for (const key of ['pitch', 'dist', 'ty', 'side', 'lift']) c[key] = it.start[key] + (it.push[key] - it.start[key]) * k;
      c.yaw = lerpAngle(it.start.yaw, it.push.yaw, k);
    } else {
      const k = ease(Math.min(1, (it.t - it.A) / it.B));
      const end = { yaw: camState.yaw, pitch: camState.pitch, dist: camState.dist + camState.auto, ty: 1.25, side: 0, lift: 0 };
      // a full half-turn around the hero, whichever side is shorter is ignored on purpose
      let dy = THREE.MathUtils.euclideanModulo(end.yaw - it.push.yaw, Math.PI * 2);
      if (dy < 0.5) dy += Math.PI * 2;
      c.yaw = it.push.yaw + dy * k;
      for (const key of ['pitch', 'dist', 'ty', 'side', 'lift']) c[key] = it.push[key] + (end[key] - it.push[key]) * k;
      if (k >= 1) { camState.yaw = c.yaw; finishIntro(); }
    }
  }

  _t.copy(player.root.position);
  _t.y += c.ty;
  if (snap || camState.mode !== 'game') camState.target.copy(_t); else camState.target.lerp(_t, Math.min(1, dt * 8));

  // pan (not rotate) so the hero sits off-centre in the menu shot
  const rx = Math.cos(c.yaw), rz = -Math.sin(c.yaw);
  _look.copy(camState.target);
  _look.x -= rx * c.side; _look.z -= rz * c.side; _look.y -= c.lift;
  const cp = Math.cos(c.pitch);
  camera.position.set(
    _look.x + Math.sin(c.yaw) * cp * c.dist,
    _look.y + Math.sin(c.pitch) * c.dist,
    _look.z + Math.cos(c.yaw) * cp * c.dist,
  );
  // keep the camera inside the room
  if (world?.bounds) {
    const b = world.bounds;
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, b.minX - 0.1, b.maxX + 0.1);
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, b.minZ - 0.1, b.maxZ + 0.1);
  }
  camera.position.y = THREE.MathUtils.clamp(camera.position.y, 0.35, 4.1);
  camera.lookAt(_look);
  if (camState.shake > 0.0005) {
    camera.position.x += (Math.random() - 0.5) * camState.shake;
    camera.position.y += (Math.random() - 0.5) * camState.shake;
    camState.shake *= Math.pow(0.001, dt);
  }
}

// tap during the fly-around skips it
$('#touch-zone').addEventListener('pointerdown', () => {
  if (camState.mode === 'intro' && camState.intro && camState.intro.t > 0.4) {
    camState.yaw = player.heading + Math.PI;
    camState.cur.yaw = camState.yaw;
    finishIntro();
  }
});

// ------------------------------------------------------------------ events -> sound/fx/score
const _dir = new THREE.Vector3();
let lastBag = null, hpShowT = 0, sandT = 0;
function handlePlayerEvents(events) {
  for (const e of events) {
    if (e.type === 'hit') {
      const bag = e.bag;
      const c = bag.center(new THREE.Vector3());
      const p = player.root.position;
      _dir.set(c.x - p.x, 0, c.z - p.z).normalize();
      const lv = new THREE.Vector3(e.vel.x, 0, e.vel.z);
      if (lv.lengthSq() > 0.01) _dir.multiplyScalar(0.7).addScaledVector(lv.normalize(), 0.3).normalize();
      // counter: the bag was swinging towards the player
      const bv = bag.velocity(new THREE.Vector2());
      const toward = -(bv.x * _dir.x + bv.y * _dir.z);
      const counter = toward > 0.35;
      const dv = (e.kick ? 0.75 : 0.42) * e.power;
      const local = bag.body.worldToLocal(e.pos.clone());
      bag.hit(_dir.x, _dir.z, dv, THREE.MathUtils.clamp(local.x * e.power * 6, -3, 3));
      const dmg = (e.kick ? 26 : 16) * e.power * (counter ? 1.5 : 1);
      bag.hp -= dmg;
      sound.punch(e.power, e.kick);
      particles.impact(e.pos, { x: -_dir.x, y: 0.3, z: -_dir.z }, e.power, e.kick);
      shock.spawn(e.pos, camera, e.power);
      camState.shake = Math.max(camState.shake, (e.kick ? 0.09 : 0.045) * e.power);
      if (e.power > 1 || e.kick) player.freeze = e.kick ? 0.075 : 0.045;
      if (navigator.vibrate) try { navigator.vibrate(e.kick ? 28 : 14); } catch (_) { /* ignore */ }
      const r = game.onHit({ power: e.power, kick: e.kick, counter, bag });
      if (r) {
        const top = e.pos.clone(); top.y += 0.35;
        if (counter) ui.popup('КОНТРА! +' + r.pts, top, 'counter');
        else ui.popup('+' + r.pts, top, r.mult >= 2 ? 'gold' : '');
      }
      lastBag = bag; hpShowT = 4;
      if (bag.hp <= 0) {
        bag.tearOff(scene, _dir.x, _dir.z);
        sound.tear();
        particles.sand(c, 120);
        camState.shake = 0.18;
        game.onBreak();
      }
    } else if (e.type === 'miss') {
      sound.whoosh(Math.min(1, e.power));
    } else if (e.type === 'step') {
      sound.step(e.heavy ? 0.35 : player.speed > 2.5 ? 0.32 : 0.2);
      if (player.speed > 2.5 || e.heavy) particles.dust(e.pos, 2);
    } else if (e.type === 'start') {
      if (e.name === 'jump') sound.whoosh(0.5);
      if (e.name === 'flip') { sound.whoosh(1); setTimeout(() => sound.whoosh(0.8), 450); }
      if (e.name === 'greet' && !introActive) { game.onGreet(); setTimeout(() => sound.applause(1.2, 0.25), 300); }
    } else if (e.type === 'end') {
      if (e.name === 'flip') {
        sound.land(0.9);
        sound.cheer(1.8, 0.45);
        particles.confetti(player.root.position.clone().add(new THREE.Vector3(0, 1.6, 0)));
        game.onFlip();
      }
    } else if (e.type === 'dance') {
      world.setDisco(e.on);
      sound.setMusic(e.on ? 'disco' : 'gym');
      document.querySelector('[data-act="dance"]').classList.toggle('active', e.on);
      game.onDance(e.on);
    }
  }
}

function handleWorldEvents(events) {
  for (const e of events) {
    if (e.type === 'landed') { sound.thud(1); particles.sand(e.bag.body.position.clone(), 60); camState.shake = 0.08; }
    else if (e.type === 'respawn') { sound.chain(1.2); game.say('Новая груша!'); }
    else if (e.type === 'crackle') sound.crackle();
  }
}

// ------------------------------------------------------------------ main loop
let last = 0, fpsAcc = 0, fpsN = 0, fpsChecked = false, hintGone = false;
function loop(now) {
  requestAnimationFrame(loop);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  frame(dt);
}

function frame(dt) {
  // a paused round freezes the game, but the menu camera keeps breathing
  const gdt = paused ? 0 : dt;
  const move = input.getMove();
  if (!hintGone && (Math.abs(move.x) + Math.abs(move.y) > 0.2)) { hintGone = true; $('#joy-hint').classList.add('gone'); }
  for (const a of input.takeActions()) {
    player.trigger(a, { bags: world.bags });
    sound.unlock();
  }
  const pev = player.update(gdt, move, camState.yaw, world);
  handlePlayerEvents(pev);
  handleWorldEvents(world.update(gdt));
  game.update(gdt, player.state === 'dance');
  particles.update(gdt);
  shock.update(gdt);
  sound.update();

  // leaking sand from a badly beaten bag
  sandT -= gdt;
  for (const b of world.bags) {
    if (b.state === 'hanging' && b.hp < b.maxHp * 0.3 && sandT <= 0) {
      const c = b.center(new THREE.Vector3()); c.y -= b.halfH;
      particles.emit(c, { speed: 0.2, up: 0, size: 0.03, life: 1.2, color: [0.65, 0.55, 0.38], gravity: 5, drag: 0.5 });
    }
  }
  if (sandT <= 0) sandT = 0.04;
  hpShowT -= gdt;
  ui.bagHp(lastBag && hpShowT > 0 && lastBag.state === 'hanging' ? Math.max(0, lastBag.hp / lastBag.maxHp) : null);

  updateCamera(dt);
  if (composer) composer.render(); else renderer.render(scene, camera);

  // adaptive quality: if the first seconds are slow on "auto", step down once
  if (!fpsChecked && qualityPref === 'auto' && dt > 0) {
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 4) {
      fpsChecked = true;
      const fps = fpsN / fpsAcc;
      if (fps < 32 && quality !== 'low') {
        quality = quality === 'high' ? 'medium' : 'low';
        renderer.setPixelRatio(Math.min(devicePixelRatio, PIXEL_RATIO[quality]));
        renderer.setSize(innerWidth, innerHeight);
        if (composer) composer.setSize(innerWidth, innerHeight);
        if (quality === 'low') { composer = null; }
      }
    }
  }
}

function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.fov = innerHeight > innerWidth ? 68 : 55;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (composer) composer.setSize(innerWidth, innerHeight);
  if (bloom) bloom.resolution.set(innerWidth / 2, innerHeight / 2);
  if (particles) particles.setScale(innerHeight * renderer.getPixelRatio());
}
addEventListener('resize', onResize);
onResize();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

init().catch((err) => {
  console.error(err);
  $('#load-text').textContent = 'Ошибка загрузки: ' + err.message;
});

// handy for debugging from the console
window.__game = { get player() { return player; }, get world() { return world; }, game, sound, renderer, scene, camera, input, frame, camState };
