// Offline cache: the whole game is static, so cache-first with a versioned cache.
const VERSION = 'yaboec-v1';
const CORE = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest',
  'js/main.js', 'js/audio.js', 'js/input.js', 'js/world.js', 'js/player.js', 'js/fx.js', 'js/game.js',
  'vendor/three/three.module.min.js',
  'vendor/three/addons/loaders/GLTFLoader.js', 'vendor/three/addons/utils/BufferGeometryUtils.js',
  'vendor/three/addons/libs/meshopt_decoder.module.js', 'vendor/three/addons/environments/RoomEnvironment.js',
  'vendor/three/addons/postprocessing/EffectComposer.js', 'vendor/three/addons/postprocessing/RenderPass.js',
  'vendor/three/addons/postprocessing/UnrealBloomPass.js', 'vendor/three/addons/postprocessing/OutputPass.js',
  'vendor/three/addons/postprocessing/Pass.js', 'vendor/three/addons/postprocessing/ShaderPass.js',
  'vendor/three/addons/postprocessing/MaskPass.js', 'vendor/three/addons/shaders/CopyShader.js',
  'vendor/three/addons/shaders/LuminosityHighPassShader.js', 'vendor/three/addons/shaders/OutputShader.js',
  'assets/gym.glb', 'assets/hero.glb', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok && (new URL(e.request.url).origin === location.origin || e.request.url.includes('fonts.g'))) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => hit)),
  );
});
