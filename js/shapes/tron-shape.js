import * as THREE from 'three';
import { createCompassWireframe, frameCompassCamera } from '../../src/createCompassWireframe.js';

/* ═══════════════════════════════════════════════════════════════════════════
   TRON SHAPE — the compass reduced to a glowing neon wire model. Same silhouette
   and placement as the compass shape, but every solid surface is stripped back
   to a crisp outline drawn as bright, additive neon lines, so the whole object
   reads as light-on-dark "circuitry" against the dark hero blade.

   Edge sourcing is per-part, because a blanket EdgesGeometry pass mangles the
   compass: the rose and needle are ROUNDED-bevel extrudes, so edge-detection on
   the solid picks up a tangle of concentric ridge facets instead of the clean
   shape. Those two parts (and the pivot dome) are instead drawn from their true
   2D source outline — exposed by the builder via mesh.userData.outlineShape — as
   a single closed loop. The simpler parts (case ring, ticks, hanger loop) are
   revolves/boxes whose EdgesGeometry silhouette is already clean.

   No post-processing / bloom (the harness renders straight to screen): the glow
   is faked with additive blending + a dim, fatter "halo" line behind each crisp
   core line, plus a slow energy pulse in update().
   ═══════════════════════════════════════════════════════════════════════════ */

// Neon palette — a bright cyan core with a cooler electric-blue halo. The rose
// + needle (the "hot" heart of the dial) run a touch brighter and whiter.
const CORE = 0x3fe0ff;
const HALO = 0x0aa2ff;
const HOT_CORE = 0xd6f6ff;
const HOT_HALO = 0x2fb6ff;

const HALO_OPACITY = 0.4;
const CORE_OPACITY = 0.95;

// Which named parts read as the "hot" accent rather than the structural cyan.
const HOT_PARTS = ['extruded-compass-rose', 'needle-lightning-bolt', 'needle-pivot'];

// Parts whose solid geometry edge-detects into noise — draw these from their 2D
// source outline instead. The pivot is a sphere with no 2D shape, so it gets a
// procedural circle (see buildPartLines).
const OUTLINE_PARTS = ['extruded-compass-rose', 'needle-lightning-bolt'];

// Parts that belong to the solid "filled dial" look and add nothing but clutter
// as wire — drop them entirely.
const HIDE_PARTS = ['opaque-teal-recessed-face', 'rose-glow', 'cardinal-labels'];

function isHot(node) {
  let n = node;
  while (n) {
    if (n.name && HOT_PARTS.includes(n.name)) return true;
    n = n.parent;
  }
  return false;
}

function makeLineMat(color, opacity) {
  return new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false, // additive + no depth write → order-independent x-ray glow
    toneMapped: false, // keep the neon at full intensity, unclamped by tone mapping
  });
}

// A flat closed loop of 3D points in the z=0 plane from 2D shape points.
function loopGeometry(points2D) {
  return new THREE.BufferGeometry().setFromPoints(
    points2D.map((p) => new THREE.Vector3(p.x, p.y, 0))
  );
}

function circlePoints(radius, segments = 48) {
  const pts = [];
  for (let i = 0; i < segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector2(Math.cos(a) * radius, Math.sin(a) * radius));
  }
  return pts;
}

export function createShape() {
  const CAM_DIST = 14.0;
  const TARGET_FRAC = 0.67; // desired on-canvas horizontal centre (0=left, 1=right)

  // Build the compass SOLID (wireframe:false) so we can derive silhouettes; the
  // builder's own wireframe mode adds noisy triangulated diagonals we don't want.
  const compass = createCompassWireframe({
    wireframe: false,
    radialSegments: 96,   // smooth revolved case/loop circles
    tubularSegments: 24,
  });

  // Hide the parts that don't read as wire (kept in the tree; just invisible).
  for (const name of HIDE_PARTS) {
    const obj = compass.getObjectByName(name);
    if (obj) obj.visible = false;
  }

  // Collect the meshes first — we mutate the tree (add line children as we go),
  // so we can't add during traversal. Skip anything under a hidden part.
  const meshes = [];
  compass.traverse((obj) => {
    if (!obj.isMesh) return;
    let n = obj;
    while (n) { if (!n.visible) return; n = n.parent; }
    meshes.push(obj);
  });

  // Every glow material is tracked so update() can pulse them together.
  const cores = [];
  const halos = [];

  // Choose the cleanest line geometry for a given part.
  function buildPartLines(mesh) {
    if (mesh.userData.outlineShape && OUTLINE_PARTS.includes(mesh.name)) {
      // Crisp single-loop silhouette from the true 2D source shape.
      const pts = mesh.userData.outlineShape.getPoints(96);
      return { geometry: loopGeometry(pts), loop: true };
    }
    if (mesh.name === 'needle-pivot') {
      // Sphere cap → just a small ring at its rim (dome radius is 0.06).
      return { geometry: loopGeometry(circlePoints(0.06, 32)), loop: true };
    }
    // Simple revolves / boxes: feature-edge detection is clean here. 30° keeps
    // silhouettes + sharp creases and drops co-planar tessellation.
    return { geometry: new THREE.EdgesGeometry(mesh.geometry, 30), loop: false };
  }

  for (const mesh of meshes) {
    const hot = isHot(mesh);
    const { geometry, loop } = buildPartLines(mesh);
    const Line = loop ? THREE.LineLoop : THREE.LineSegments;

    // Halo: dim, fat-feeling additive underlay (drawn first, slightly behind).
    const halo = new Line(geometry, makeLineMat(hot ? HOT_HALO : HALO, HALO_OPACITY));
    halo.name = `${mesh.name || 'part'}-glow-halo`;
    // Core: crisp bright line on top.
    const core = new Line(geometry, makeLineMat(hot ? HOT_CORE : CORE, CORE_OPACITY));
    core.name = `${mesh.name || 'part'}-glow-core`;
    core.renderOrder = 1;

    // Parent both to the mesh so they inherit its full world transform at
    // identity local (same trick the builder's addEdges uses).
    mesh.add(halo);
    mesh.add(core);

    // Hide the solid surface itself — but keep the mesh visible so its line
    // children still render. A fully-transparent, non-writing material draws
    // nothing yet leaves the mesh in the scene graph.
    mesh.material.dispose?.();
    mesh.material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });

    cores.push(core.material);
    halos.push(halo.material);
  }

  // --- Framing / placement (mirrors compass-shape so the harness lays it out
  // identically) --------------------------------------------------------------
  let compassCenter = new THREE.Vector3();
  let compassBaseX = 0;

  function frame(camera) {
    compassCenter = frameCompassCamera(camera, compass, CAM_DIST);
    compassBaseX = compass.position.x;
    camera.position.x = 0;
    camera.lookAt(0, camera.position.y, compassCenter.z);
    return compassCenter;
  }

  function applyAspect(camera) {
    const visibleHeight = 2 * CAM_DIST * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const visibleWidth = visibleHeight * camera.aspect;
    const wantCenterX = (TARGET_FRAC - 0.5) * visibleWidth;
    compass.position.x = compassBaseX + (wantCenterX - compassCenter.x);
  }

  // --- Energy pulse: a slow breathing brightness plus a faster, subtler flicker
  // so the wires feel "powered" rather than static. Base opacities are captured
  // so the pulse scales them proportionally.
  const coreBase = cores.map((m) => m.opacity);
  const haloBase = halos.map((m) => m.opacity);

  function update(ctx) {
    const t = ctx && typeof ctx.elapsed === 'number' ? ctx.elapsed : 0;
    const breathe = 0.85 + 0.15 * Math.sin(t * 1.2);          // 0.70 → 1.00
    const flicker = 1 + 0.04 * Math.sin(t * 7.3 + 1.7);       // ±4% shimmer
    const k = breathe * flicker;
    for (let i = 0; i < cores.length; i += 1) cores[i].opacity = coreBase[i] * k;
    for (let i = 0; i < halos.length; i += 1) halos[i].opacity = haloBase[i] * k;
  }

  return { object: compass, frame, applyAspect, update, camDist: CAM_DIST };
}
