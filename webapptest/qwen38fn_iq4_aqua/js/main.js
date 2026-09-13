import * as THREE from 'three';
import { buildEnvironment } from './environment.js';
import { spawnCreatures } from './behaviors.js';
import { Controls } from './controls.js';

// ---- レンダラ / シーン / カメラ ----
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
document.body.appendChild(renderer.domElement);

function fitRenderer() {
  const w = window.visualViewport?.width || innerWidth;
  const h = window.visualViewport?.height || innerHeight;
  renderer.setSize(w, h);
  renderer.setViewport(0, 0, w, h);
  if (typeof renderer.resetState === 'function') renderer.resetState();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

const scene = new THREE.Scene();
const FOG = new THREE.Color(0x0c3c5c);
scene.background = FOG;
scene.fog = new THREE.FogExp2(FOG.getHex(), 0.0075);

const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 900);
camera.position.set(0, 14, 52);
scene.add(camera);

// ---- 環境 & 生物 ----
const env = buildEnvironment(scene);
env.setRenderer(renderer);            // 影の品質を自動判定（high/low）→ 初回描画前に確定
const creatures = spawnCreatures(scene, env);

// ---- 操作 ----
const controls = new Controls(camera, renderer.domElement);
window.aqualium = { controls, camera, scene, renderer, creatures, env }; // デバッグ用

// ---- HUD ----
const hud = document.getElementById('hud');
let fpsAcc = 0, fpsN = 0, hudT = 0, fpsShown = 0;

// ---- ループ ----
const clock = new THREE.Clock();
let t = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  t += dt;

  controls.update(dt);
  env.update(t, dt);
  creatures.update(dt, t);

  renderer.render(scene, camera);

  fpsAcc += dt; fpsN++;
  hudT += dt;
  if (hudT > 0.5) {
    fpsShown = Math.round(fpsN / Math.max(fpsAcc, 1e-4));
    fpsAcc = 0; fpsN = 0; hudT = 0;
    hud.innerHTML =
      `<b>AQUARIUM</b> ジンベエザメ×2 / マンタ×4 / クロマグロ×30<br>` +
      `${fpsShown} fps ・ ${Math.round(camera.position.x)}, ${Math.round(camera.position.y)}, ${Math.round(camera.position.z)} m`;
  }
});

addEventListener('resize', fitRenderer);
addEventListener('orientationchange', () => setTimeout(fitRenderer, 120));
