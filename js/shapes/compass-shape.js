import * as THREE from 'three';
import { createCompassWireframe, frameCompassCamera } from '../../src/createCompassWireframe.js';

/* ═══════════════════════════════════════════════════════════════════════════
   COMPASS SHAPE — swappable hero object for the scene harness (compass-hero.js)
   Wraps the shared compass builder and owns the compass-specific behaviours the
   harness used to hard-code: framing at CAM_DIST, the horizontal placement, and
   the "needle always points north" rig. Conforms to the shape module contract:

     createShape({ THREE, scene, camera }) -> {
       object,                 // THREE.Object3D the harness tilts with the mouse
       frame(camera),          // position the camera; return the world centre
       applyAspect(camera),    // re-run on resize (aspect-dependent placement)
       update(ctx),            // per-frame; ctx = { elapsed, dt, pointer }
     }
   ═══════════════════════════════════════════════════════════════════════════ */

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
// Cubic-bézier easing matching the CSS hero-*-rise curves
// (cubic-bezier(0.592, 0.162, 0.34, 1)). x1/x2 are the control-point X's; we
// solve for the parametric t where the curve's X equals the input, then read Y.
function makeCubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    let t = x;
    for (let i = 0; i < 8; i += 1) {
      const dx = sampleX(t) - x;
      if (Math.abs(dx) < 1e-5) break;
      const d = slopeX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= dx / d;
    }
    return sampleY(t);
  };
}
const easeHero = makeCubicBezier(0.592, 0.162, 0.34, 1);

export function createShape() {
  const CAM_DIST = 14.0;
  const TARGET_FRAC = 0.67; // desired on-canvas horizontal centre (0=left, 1=right)

  // --- Entrance intro: a one-shot, cinematic "Star Wars opening" reveal on
  // first mount. Frame one looks up into the starfield (compass below frame);
  // the camera then slowly pans DOWN, tilting the compass and its blue glow up
  // into view. The rose glow powers on as it enters frame. Timeline keys off
  // the shared wall clock (elapsed) so the fps cap / visibility gating never
  // distort it, and it fires exactly once (never replays on scroll-back).
  const INTRO_DURATION = 3.6;   // seconds — slow, deliberate pan
  const PAN_RISE = 9.0;         // how far above the settled look-at we start (world units)
  const CAM_RISE = 6.0;         // camera also descends a touch for parallax
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let introT0 = null;               // captured lazily on first update()
  let introDone = prefersReducedMotion; // reduced motion → skip straight to settled

  const compass = createCompassWireframe({
    wireframe: false,
    radialSegments: 64,
    tubularSegments: 16,
  });

  let compassCenter = new THREE.Vector3();
  let compassBaseX = 0;
  // Settled camera pose, captured in frame() so the pan can ease toward it.
  let cameraRef = null;
  let settledCamY = 0;
  let lookAtZ = 0;

  function frame(camera) {
    compassCenter = frameCompassCamera(camera, compass, CAM_DIST);
    compassBaseX = compass.position.x;
    camera.position.x = 0;
    camera.lookAt(0, camera.position.y, compassCenter.z);
    cameraRef = camera;
    settledCamY = camera.position.y;
    lookAtZ = compassCenter.z;
    // Start the camera already pitched up into the stars so frame one hides the
    // compass below the viewport (unless reduced motion, which stays settled).
    if (!prefersReducedMotion) {
      camera.position.set(0, settledCamY + CAM_RISE, CAM_DIST);
      camera.lookAt(0, settledCamY + PAN_RISE, lookAtZ);
    }
    return compassCenter;
  }

  function applyAspect(camera) {
    // Keep the camera centred on the origin and slide the COMPASS in world X so
    // it lands at TARGET_FRAC — panning the camera would drag the ambient FX off
    // to one side and disturb the needle maths.
    const visibleHeight = 2 * CAM_DIST * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const visibleWidth = visibleHeight * camera.aspect;
    const wantCenterX = (TARGET_FRAC - 0.5) * visibleWidth;
    compass.position.x = compassBaseX + (wantCenterX - compassCenter.x);
  }

  // --- Needle-stays-north rig (moved out of the harness) ---
  const needle = compass.getObjectByName('compass-needle');
  const NORTH_SCREEN = new THREE.Vector2(1, 1);
  const worldX = new THREE.Vector3();
  const worldY = new THREE.Vector3();
  const needleDir = new THREE.Vector3();
  function northAngle() {
    worldX.set(1, 0, 0).applyQuaternion(compass.quaternion);
    worldY.set(0, 1, 0).applyQuaternion(compass.quaternion);
    const tx = NORTH_SCREEN.x, ty = NORTH_SCREEN.y;
    let theta = Math.atan2(
      worldY.x * ty - worldY.y * tx,
      worldX.x * ty - worldX.y * tx
    );
    needleDir.set(-Math.sin(theta), Math.cos(theta), 0).applyQuaternion(compass.quaternion);
    if (needleDir.x * tx + needleDir.y * ty < 0) theta += Math.PI;
    return theta;
  }
  function orientNeedleNorth() {
    if (!needle) return;
    needle.rotation.z = northAngle();
  }

  // --- Entrance rig: the blue rose glow powers on as it swings into frame -----
  const glow = compass.getObjectByName('rose-glow');
  const glowTarget = glow ? glow.material.opacity : 1; // authored settle opacity
  if (glow && !prefersReducedMotion) glow.material.opacity = 0; // start dark

  function update(ctx) {
    // The needle holds north every frame regardless of the camera move.
    orientNeedleNorth();

    if (introDone) return;
    const elapsed = ctx && typeof ctx.elapsed === 'number' ? ctx.elapsed : null;
    if (elapsed === null || !cameraRef) return;
    if (introT0 === null) introT0 = elapsed;
    const p = clamp01((elapsed - introT0) / INTRO_DURATION);
    const e = easeHero(p);

    // Downward pan: the look-at target descends from high in the stars to the
    // settled compass height; the camera eases down a touch alongside it.
    const lookY = settledCamY + PAN_RISE * (1 - e);
    const camY = settledCamY + CAM_RISE * (1 - e);
    cameraRef.position.set(0, camY, CAM_DIST);
    cameraRef.lookAt(0, lookY, lookAtZ);

    // Glow powers on as the compass climbs into frame (back half of the pan).
    if (glow) glow.material.opacity = glowTarget * clamp01((p - 0.45) / 0.55);

    if (p >= 1) {
      introDone = true;
      cameraRef.position.set(0, settledCamY, CAM_DIST);
      cameraRef.lookAt(0, settledCamY, lookAtZ);
      if (glow) glow.material.opacity = glowTarget;
    }
  }

  return { object: compass, frame, applyAspect, update, camDist: CAM_DIST };
}
