import * as THREE from 'three';

/* ═══════════════════════════════════════════════════════════════════════════
   HERO SCENE HARNESS — renderer, camera, env, lights, mouse-tilt, fps/visibility
   gating. Shape-agnostic: the actual 3D object is loaded from a swappable shape
   module so the compass can be hot-swapped for the extruded logo (or anything
   else) without touching this file.

   Shape selection precedence:
     ?shape= query param (live tuning) → mount's data-shape attribute
     (per-page default) → 'compass'.

   A shape module exports `createShape({ THREE, scene, camera })` returning (or
   resolving to) { object, frame(camera)->center, applyAspect(camera),
   update({ elapsed, dt, pointer }) }. See site/shapes/*.js.

   Ambient FX (constellation/starfield/contours) still live here and are gated
   by ?fx= / data-fx as before.
   ═══════════════════════════════════════════════════════════════════════════ */

import { createConstellation, createStarfield } from './hero-effects.js';

const SHAPE_LOADERS = {
  compass: () => import('./shapes/compass-shape.js'),
  logo: () => import('./shapes/logo-shape.js'),
  tron: () => import('./shapes/tron-shape.js'),
};

const container = document.querySelector('#compass-mount');
if (container) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100%;display:block;';
  container.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.LinearToneMapping;
  renderer.toneMappingExposure = 1.0;
  // Soft shadow maps so the overhead spotlight casts real relief shadows.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();

  // High-contrast procedural studio env → crisp chrome highlights on the bevels
  // while the real HDRI decodes. No external file required.
  function makeStudioEnvironment() {
    const width = 1024, height = 512; // 2:1 equirectangular
    const cv = document.createElement('canvas');
    cv.width = width; cv.height = height;
    const ctx = cv.getContext('2d');
    const base = ctx.createLinearGradient(0, 0, 0, height);
    base.addColorStop(0.0, '#0a0a12');
    base.addColorStop(0.42, '#3a4a66');
    base.addColorStop(0.5, '#ffffff');
    base.addColorStop(0.58, '#22303f');
    base.addColorStop(1.0, '#020205');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, width, height);
    const softbox = (x, y, w, h, glow) => {
      ctx.save();
      ctx.shadowColor = glow; ctx.shadowBlur = 60;
      ctx.fillStyle = glow; ctx.fillRect(x, y, w, h);
      ctx.restore();
    };
    softbox(width * 0.10, 50, 150, 80, '#ffffff');
    softbox(width * 0.60, 40, 190, 60, '#eaf6ff');
    softbox(width * 0.38, 90, 110, 50, '#bfe4ff');
    const texture = new THREE.CanvasTexture(cv);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envTexture = makeStudioEnvironment();
  scene.environment = pmrem.fromEquirectangular(envTexture).texture;
  scene.environmentIntensity = 0.45;
  envTexture.dispose();

  // Swap in the real Sequoia panorama once it loads.
  new THREE.TextureLoader().load(
    './images/Salesforce_Sequoia_Day_3_70A1267_Wip_3_Left_side.jpg',
    (tex) => {
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      scene.environment = pmrem.fromEquirectangular(tex).texture;
      scene.environmentIntensity = 0.45;
      tex.dispose();
    }
  );

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1000);

  // --- Lighting -------------------------------------------------------------
  // Dramatic key-from-above setup: the four soft fill lights are dialled way
  // down so the scene reads dark, then a single overhead spotlight rakes down
  // the relief to throw crisp shadows into the recesses.
  scene.add(new THREE.AmbientLight(0x9bcfff, 0.18));
  const key = new THREE.DirectionalLight(0xffffff, 0.6);
  key.position.set(3, 4, 5);
  scene.add(key);
  const rim = new THREE.PointLight(0x2457ff, 1.0, 9);
  rim.position.set(-3, -2, 2);
  scene.add(rim);

  // Overhead spotlight — the star of the show. Sits high and slightly forward,
  // aimed straight down at the object so extruded layers cast shadows on the
  // ones behind them.
  const spot = new THREE.SpotLight(0xffffff, 60, 40, Math.PI / 7, 0.4, 1.2);
  spot.position.set(0, 12, 6);
  spot.castShadow = true;
  spot.shadow.mapSize.set(2048, 2048);
  spot.shadow.camera.near = 1;
  spot.shadow.camera.far = 40;
  spot.shadow.bias = -0.0005;
  spot.shadow.radius = 6;
  scene.add(spot);
  scene.add(spot.target); // aims at origin (0,0,0) where the object is framed

  // --- Ambient "world" effects ---------------------------------------------
  // Switchable via ?fx= (constellation | starfield | contours | all | none),
  // then the mount's data-fx, then the constellation default.
  const FX_PARAM = new URLSearchParams(window.location.search).get('fx');
  const FX_MODE = FX_PARAM || container.dataset.fx || 'constellation';
  const wantFx = (name) => FX_MODE === name || FX_MODE === 'all';

  const effects = [];
  if (FX_MODE !== 'none') {
    // A tall, sparse starfield backs the composition so the intro camera can
    // pitch up into a full field of stars before panning down to the compass.
    // Enabled for the constellation default too (not just ?fx=starfield).
    if (wantFx('starfield') || FX_MODE === 'constellation') {
      effects.push(createStarfield(scene, { spreadY: 16 }));
    }
    if (wantFx('contours')) effects.push(createContours(scene));
    if (wantFx('constellation')) effects.push(createConstellation(scene));
  }
  const clock = new THREE.Clock();

  // --- Mouse-follow rig — normalised against the container, not the window ---
  const pointer = new THREE.Vector2(0, 0);
  window.addEventListener('pointermove', (e) => {
    const r = container.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = ((e.clientY - r.top) / r.height) * 2 - 1;
  });
  const MAX_TILT_Y = 0.9, MAX_TILT_X = 0.6;
  function updateMouseFollow(target) {
    if (!target) return;
    const targetY = pointer.x * MAX_TILT_Y;
    const targetX = pointer.y * MAX_TILT_X;
    target.rotation.y += (targetY - target.rotation.y) * 0.08;
    target.rotation.x += (targetX - target.rotation.x) * 0.08;
    target.rotation.z = 0;
  }

  // --- Load the swappable shape ---------------------------------------------
  const SHAPE_PARAM = new URLSearchParams(window.location.search).get('shape');
  const REQUESTED_SHAPE = SHAPE_PARAM || container.dataset.shape || 'compass';
  // Narrow to a known key so the loader lookup + logging can't be driven by
  // arbitrary URL input (unknown values fall back to the default shape).
  const SHAPE_MODE = Object.hasOwn(SHAPE_LOADERS, REQUESTED_SHAPE) ? REQUESTED_SHAPE : 'compass';
  const loadShape = SHAPE_LOADERS[SHAPE_MODE];
  // When set, the shape still loads (so its camera framing + intro animation and
  // any ambient FX choreography run), but the 3D object itself is hidden. Lets
  // the hero keep the starfield/constellation intro pan without the compass.
  const HIDE_SHAPE = container.dataset.hideShape != null;

  let shape = null; // { object, frame, applyAspect, update }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (shape) shape.applyAspect(camera);
  }
  new ResizeObserver(resize).observe(container);

  loadShape()
    .then((mod) => Promise.resolve(mod.createShape({ THREE, scene, camera })))
    .then((s) => {
      shape = s;
      scene.add(shape.object);
      // Keep the shape's camera framing + intro animation driving the scene, but
      // hide the object itself when requested (data-hide-shape on the mount).
      if (HIDE_SHAPE) shape.object.visible = false;
      shape.frame(camera);
      resize();
      sync();
    })
    .catch((err) => {
      console.error('[hero] failed to load shape "%s":', SHAPE_MODE, err);
    });

  // --- fps cap + visibility gating ------------------------------------------
  const FRAME_INTERVAL = 1 / 45;
  let acc = 0;
  let onScreen = true;
  let running = false;
  let rafId = 0;

  function frame() {
    rafId = requestAnimationFrame(frame);
    const dt = clock.getDelta();
    acc += dt;
    if (acc < FRAME_INTERVAL) return;
    acc = acc % FRAME_INTERVAL;
    const elapsed = clock.getElapsedTime();
    if (shape) {
      updateMouseFollow(shape.object);
      shape.update({ elapsed, dt, pointer });
    }
    for (let i = 0; i < effects.length; i += 1) {
      effects[i].update(elapsed, pointer, shape ? shape.object : null, dt);
    }
    renderer.render(scene, camera);
  }

  function start() {
    if (running || !shape) return;
    running = true;
    clock.getDelta(); // discard the gap accumulated while paused
    rafId = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }
  function sync() {
    if (onScreen && !document.hidden) start();
    else stop();
  }

  new IntersectionObserver((entries) => {
    onScreen = entries[0].isIntersecting;
    sync();
  }).observe(container);
  document.addEventListener('visibilitychange', sync);
  resize();
}
