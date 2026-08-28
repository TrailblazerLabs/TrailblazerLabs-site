import * as THREE from 'three';

// ═══════════════════════════════════════════════════════════════════════════
// Ambient "world" effects for the hero compass.
//
// Each factory takes (scene, opts) and returns:
//   { object, update(elapsed, pointer, compass), dispose() }
//
// All effects use additive blending with depthWrite:false so nothing ever
// occludes the compass — they read as light, not solid geometry. Densities and
// opacities are deliberately low: the brief is "subtle & premium", so motion is
// slow and glow does the work rather than sheer particle count.
//
// The scene is transparent and composites over the deep-blue masthead, and the
// camera frames the compass at ~14 units back (see frameCompassCamera), so the
// spatial extents below are sized to fill that frustum without spilling past it.
// ═══════════════════════════════════════════════════════════════════════════

// Electric-blue brand range, deep → electric → cyan highlight.
const PALETTE = {
  deep: new THREE.Color(0x0a1f6b),
  electric: new THREE.Color(0x1a56ff),
  cyan: new THREE.Color(0x66c8ff)
};

// A tiny seeded PRNG (mulberry32). Browser Math.random would work, but seeding
// keeps the layout stable across reloads so the composition can be tuned.
function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Soft round sprite (radial-gradient alpha) so THREE.Points read as glowing
// motes rather than hard squares. Cached — every effect can share one texture.
let _softTexture = null;
function softPointTexture() {
  if (_softTexture) return _softTexture;
  const size = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  _softTexture = new THREE.CanvasTexture(cv);
  _softTexture.colorSpace = THREE.SRGBColorSpace;
  return _softTexture;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Constellation network — community graph / navigate-by-stars.
//    Drifting glowing nodes connected by faint lines that form and dissolve as
//    they move; nodes near the cursor brighten. The lines are rebuilt each
//    frame into a preallocated buffer (draw range trimmed to what's used).
// ─────────────────────────────────────────────────────────────────────────────
export function createConstellation(scene, opts = {}) {
  const group = new THREE.Group();
  group.name = 'fx-constellation';
  // No group Z offset: each node carries its own real depth (Z_NEAR..Z_FAR,
  // both behind the compass), and the compass writes depth, so the depth test
  // occludes any node/line that would fall behind the case. Nodes fly toward the
  // camera and recycle before they can reach the compass plane.
  group.position.z = 0;

  const COUNT = opts.count ?? 170;
  const SPREAD_X = opts.spreadX ?? 11; // half-width of the node slab
  const SPREAD_Y = opts.spreadY ?? 7;
  const SPREAD_Z = opts.spreadZ ?? 5;
  const LINK_DIST = opts.linkDist ?? 2.6; // max node spacing that draws a line
  const MAX_LINKS = opts.maxLinks ?? 550; // hard cap on segments per frame
  const CURSOR_RADIUS = opts.cursorRadius ?? 8.0; // brighten radius (world units)
  const PUSH_RADIUS = opts.pushRadius ?? 6.4;  // how close before a node is shoved
  const PUSH_STRENGTH = opts.pushStrength ?? 2.4; // max displacement at the cursor

  // Fly-through-space depth: nodes drift from Z_FAR toward the camera (+Z) and
  // recycle to the back once they pass Z_NEAR. Both bounds stay behind the
  // compass front face so the depth test always occludes them against the case.
  const Z_NEAR = opts.zNear ?? -1.5;  // nearest a node gets before recycling
  const Z_FAR = opts.zFar ?? -22;     // where a recycled node reappears
  const FLY_SPEED = opts.flySpeed ?? 0.35; // world units/sec toward camera (subtle)
  const Z_RANGE = Z_NEAR - Z_FAR;     // positive span
  // Spring-damper that pulls each node's cursor-offset back toward its target.
  // STIFFNESS is the restoring pull toward the goal, DAMPING bleeds off velocity.
  // Low damping → the node overshoots and slides into place with momentum
  // instead of easing straight there.
  const SPRING_STIFFNESS = opts.springStiffness ?? 90;
  const SPRING_DAMPING = opts.springDamping ?? 9;

  const rng = makeRng(opts.seed ?? 1337);

  // Per-node home X/Y and a slow Lissajous wander (amp/phase) so the graph
  // breathes laterally, while Z is a live, evolving depth that flies toward the
  // camera. baseColor is the node's own hue; the per-frame color attribute is
  // that hue scaled by a depth-based brightness (near = bright, far = dim).
  const home = new Float32Array(COUNT * 2);   // X, Y home only
  const amp = new Float32Array(COUNT * 2);
  const phase = new Float32Array(COUNT * 2);
  const nodeZ = new Float32Array(COUNT);      // live depth per node
  const baseColor = new Float32Array(COUNT * 3);
  const positions = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3);
  // Extra displacement pushed onto each node by the cursor, plus its velocity.
  // A spring-damper integrates push toward its target every frame, so nodes
  // carry momentum — they slide past and settle rather than snapping. X/Y only.
  const push = new Float32Array(COUNT * 2);
  const pushVel = new Float32Array(COUNT * 2);

  // Reseed a node's lateral home + hue (called at init and on recycle).
  const white = new THREE.Color(0xffffff);
  function seedNode(i) {
    home[i * 2] = (rng() * 2 - 1) * SPREAD_X;
    home[i * 2 + 1] = (rng() * 2 - 1) * SPREAD_Y;
    amp[i * 2] = 0.3 + rng() * 0.7;
    amp[i * 2 + 1] = 0.3 + rng() * 0.7;
    phase[i * 2] = rng() * Math.PI * 2;
    phase[i * 2 + 1] = rng() * Math.PI * 2;
    // Brighter base hue: bias toward the cyan highlight and lift toward white.
    const base = PALETTE.electric.clone()
      .lerp(PALETTE.cyan, 0.4 + rng() * 0.6)
      .lerp(white, 0.25);
    baseColor[i * 3] = base.r;
    baseColor[i * 3 + 1] = base.g;
    baseColor[i * 3 + 2] = base.b;
  }

  for (let i = 0; i < COUNT; i += 1) {
    seedNode(i);
    // Spread initial depths evenly across the tunnel so nodes arrive staggered.
    nodeZ[i] = Z_FAR + rng() * Z_RANGE;
  }

  const nodeGeo = new THREE.BufferGeometry();
  nodeGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  nodeGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const nodeMat = new THREE.PointsMaterial({
    size: opts.nodeSize ?? 0.2,
    map: softPointTexture(),
    vertexColors: true,
    transparent: true,
    opacity: opts.nodeOpacity ?? 1.0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true // perspective already shrinks far points; depth-based
                          // brightness (below) adds the dimming cue on top.
  });
  const nodes = new THREE.Points(nodeGeo, nodeMat);
  group.add(nodes);

  // Line buffer: preallocate for MAX_LINKS segments (2 verts each). Per frame we
  // fill only the segments we need and set drawRange so the rest isn't drawn.
  const linePositions = new Float32Array(MAX_LINKS * 2 * 3);
  const lineColors = new Float32Array(MAX_LINKS * 2 * 3);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
  lineGeo.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));
  const lineMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: opts.lineOpacity ?? 0.65,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const lines = new THREE.LineSegments(lineGeo, lineMat);
  group.add(lines);

  scene.add(group);

  const cursorWorld = new THREE.Vector3();
  const linkColor = PALETTE.cyan;

  function update(elapsed, pointer, compass, dt) {
    // Clamp dt so a tab-switch stall or first frame can't blow up the spring
    // integration with a huge step.
    const step = Math.min(dt ?? 0.016, 0.05);

    // Approximate cursor position in the node slab's plane. pointer is -1..1;
    // map it across the slab so nearby nodes light up and get shoved away.
    cursorWorld.set(pointer.x * SPREAD_X, -pointer.y * SPREAD_Y, 0);

    const pushRadiusSq = PUSH_RADIUS * PUSH_RADIUS;
    for (let i = 0; i < COUNT; i += 1) {
      const ix = i * 3;
      const px = i * 2;
      const py = i * 2 + 1;

      // Fly toward the camera; recycle to the back once past the near plane so
      // the tunnel is endless. Reseed lateral home + hue on recycle for variety.
      nodeZ[i] += FLY_SPEED * step;
      if (nodeZ[i] > Z_NEAR) {
        nodeZ[i] -= Z_RANGE; // wrap to the far plane
        seedNode(i);
      }

      // Lateral wander around home (before any cursor shove).
      const wx = home[px] + Math.sin(elapsed * 0.15 + phase[px]) * amp[px];
      const wy = home[py] + Math.sin(elapsed * 0.12 + phase[py]) * amp[py];

      // Target push: radially away from the cursor, strongest at the centre of
      // PUSH_RADIUS and falling to 0 at its edge.
      const dx = wx - cursorWorld.x;
      const dy = wy - cursorWorld.y;
      const dSq = dx * dx + dy * dy;
      let tx = 0;
      let ty = 0;
      if (dSq < pushRadiusSq && dSq > 1e-4) {
        const dist = Math.sqrt(dSq);
        const falloff = 1 - dist / PUSH_RADIUS; // 1 at cursor → 0 at edge
        const mag = falloff * falloff * PUSH_STRENGTH; // ease-in for a soft shove
        tx = (dx / dist) * mag;
        ty = (dy / dist) * mag;
      }

      // Damped-spring integration toward the target offset. Acceleration =
      // stiffness·(target − current) − damping·velocity. Semi-implicit Euler
      // (update velocity first, then position) stays stable and gives the nodes
      // real momentum, so they glide out and slide back into place.
      const ax = SPRING_STIFFNESS * (tx - push[px]) - SPRING_DAMPING * pushVel[px];
      const ay = SPRING_STIFFNESS * (ty - push[py]) - SPRING_DAMPING * pushVel[py];
      pushVel[px] += ax * step;
      pushVel[py] += ay * step;
      push[px] += pushVel[px] * step;
      push[py] += pushVel[py] * step;

      positions[ix] = wx + push[px];
      positions[ix + 1] = wy + push[py];
      positions[ix + 2] = nodeZ[i];

      // Depth brightness: near nodes bright, far nodes dim. depthT is 0 at the
      // far plane → 1 at the near plane. Fade the newly-recycled far nodes in
      // from black so they don't pop, and scale each node's hue by it.
      const depthT = (nodeZ[i] - Z_FAR) / Z_RANGE; // 0..1
      const bright = 0.25 + depthT * 0.75;         // never fully black mid-field
      colors[ix] = baseColor[ix] * bright;
      colors[ix + 1] = baseColor[ix + 1] * bright;
      colors[ix + 2] = baseColor[ix + 2] * bright;
    }
    nodeGeo.attributes.position.needsUpdate = true;
    nodeGeo.attributes.color.needsUpdate = true;

    // Rebuild links: connect near pairs, alpha ∝ closeness, extra glow near
    // the cursor. Cap total segments to MAX_LINKS to bound cost.
    let seg = 0;
    const linkDistSq = LINK_DIST * LINK_DIST;
    for (let i = 0; i < COUNT && seg < MAX_LINKS; i += 1) {
      const ax = positions[i * 3];
      const ay = positions[i * 3 + 1];
      const az = positions[i * 3 + 2];
      for (let j = i + 1; j < COUNT && seg < MAX_LINKS; j += 1) {
        const dx = ax - positions[j * 3];
        const dy = ay - positions[j * 3 + 1];
        const dz = az - positions[j * 3 + 2];
        const dSq = dx * dx + dy * dy + dz * dz;
        if (dSq > linkDistSq) continue;

        const closeness = 1 - Math.sqrt(dSq) / LINK_DIST; // 0..1
        // Cursor proximity of the segment midpoint → brighten.
        const mx = (ax + positions[j * 3]) * 0.5;
        const my = (ay + positions[j * 3 + 1]) * 0.5;
        const cd = Math.hypot(mx - cursorWorld.x, my - cursorWorld.y);
        const cursorBoost = Math.max(0, 1 - cd / CURSOR_RADIUS);
        // Depth dimming: use the nearer endpoint's depth so links fade with the
        // field as it recedes, matching the node brightness ramp.
        const mz = Math.max(az, positions[j * 3 + 2]);
        const depthBright = 0.25 + ((mz - Z_FAR) / Z_RANGE) * 0.75;
        const intensity = Math.min(1, closeness * (0.6 + cursorBoost) * depthBright);

        const o = seg * 6;
        linePositions[o] = ax; linePositions[o + 1] = ay; linePositions[o + 2] = az;
        linePositions[o + 3] = positions[j * 3];
        linePositions[o + 4] = positions[j * 3 + 1];
        linePositions[o + 5] = positions[j * 3 + 2];
        const r = linkColor.r * intensity;
        const g = linkColor.g * intensity;
        const b = linkColor.b * intensity;
        lineColors[o] = r; lineColors[o + 1] = g; lineColors[o + 2] = b;
        lineColors[o + 3] = r; lineColors[o + 4] = g; lineColors[o + 5] = b;
        seg += 1;
      }
    }
    lineGeo.setDrawRange(0, seg * 2);
    lineGeo.attributes.position.needsUpdate = true;
    lineGeo.attributes.color.needsUpdate = true;
  }

  function dispose() {
    scene.remove(group);
    nodeGeo.dispose();
    nodeMat.dispose();
    lineGeo.dispose();
    lineMat.dispose();
  }

  return { object: group, update, dispose };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Star / dust field — parallax depth. Three point layers at different Z,
//    slow opposing drift, gentle parallax offset from the cursor. Cheapest.
// ─────────────────────────────────────────────────────────────────────────────
export function createStarfield(scene, opts = {}) {
  const group = new THREE.Group();
  group.name = 'fx-starfield';

  const LAYERS = [
    { count: 120, z: -8, size: 0.09, opacity: 0.35, drift: 0.02, parallax: 0.5 },
    { count: 90, z: -4, size: 0.13, opacity: 0.5, drift: -0.035, parallax: 1.0 },
    { count: 50, z: 0, size: 0.18, opacity: 0.7, drift: 0.05, parallax: 1.8 }
  ];
  const SPREAD_X = opts.spreadX ?? 16;
  const SPREAD_Y = opts.spreadY ?? 11;
  const rng = makeRng(opts.seed ?? 90210);

  const layers = LAYERS.map((L, li) => {
    const positions = new Float32Array(L.count * 3);
    const colors = new Float32Array(L.count * 3);
    for (let i = 0; i < L.count; i += 1) {
      positions[i * 3] = (rng() * 2 - 1) * SPREAD_X;
      positions[i * 3 + 1] = (rng() * 2 - 1) * SPREAD_Y;
      positions[i * 3 + 2] = L.z + (rng() * 2 - 1) * 0.8;
      const c = PALETTE.cyan.clone().lerp(new THREE.Color(0xffffff), rng() * 0.5);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: L.size,
      map: softPointTexture(),
      vertexColors: true,
      transparent: true,
      opacity: L.opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    });
    const pts = new THREE.Points(geo, mat);
    pts.userData = { drift: L.drift, parallax: L.parallax, baseX: 0 };
    group.add(pts);
    return { pts, geo, mat, def: L, li };
  });

  scene.add(group);

  function update(elapsed, pointer /*, compass */) {
    layers.forEach(({ pts, def }) => {
      // Slow horizontal drift + gentle vertical bob, plus cursor parallax so
      // deeper layers move less than near ones (depth cue).
      pts.position.x = elapsed * def.drift + pointer.x * def.parallax * -0.4;
      pts.position.y = Math.sin(elapsed * 0.08 + def.z) * 0.2 + pointer.y * def.parallax * 0.25;
    });
  }

  function dispose() {
    scene.remove(group);
    layers.forEach(({ geo, mat }) => { geo.dispose(); mat.dispose(); });
  }

  return { object: group, update, dispose };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Topographic contours — radar/elevation rings rippling outward from the
//    compass center (national-parks map motif). Rings expand and fade, then
//    recycle inward. Coplanar-ish with the face, additive, faint.
// ─────────────────────────────────────────────────────────────────────────────
export function createContours(scene, opts = {}) {
  const group = new THREE.Group();
  group.name = 'fx-contours';
  // Sit just behind the compass face so the rings read as emanating from it.
  group.position.z = opts.z ?? -0.5;

  const RING_COUNT = opts.ringCount ?? 6;
  const MIN_R = opts.minRadius ?? 2.6; // start just outside the case
  const MAX_R = opts.maxRadius ?? 11;
  const SPEED = opts.speed ?? 0.35; // radius units/sec
  const THICKNESS = opts.thickness ?? 0.05;

  const span = MAX_R - MIN_R;
  const rings = [];
  for (let i = 0; i < RING_COUNT; i += 1) {
    const geo = new THREE.RingGeometry(1, 1 + THICKNESS, 128);
    const mat = new THREE.MeshBasicMaterial({
      color: PALETTE.cyan,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geo, mat);
    // Stagger each ring's phase so they emanate at even intervals.
    mesh.userData = { offset: i / RING_COUNT };
    group.add(mesh);
    rings.push({ mesh, mat });
  }

  scene.add(group);

  function update(elapsed /*, pointer, compass */) {
    rings.forEach(({ mesh, mat }) => {
      // Normalised expansion phase 0..1, looping, staggered per ring.
      let t = (elapsed * SPEED / span + mesh.userData.offset) % 1;
      if (t < 0) t += 1;
      const radius = MIN_R + t * span;
      mesh.scale.set(radius, radius, 1);
      // Fade in from the center, fade out at the rim — a soft pulse.
      const fade = Math.sin(t * Math.PI); // 0 → 1 → 0
      mat.opacity = fade * (opts.opacity ?? 0.28);
    });
  }

  function dispose() {
    scene.remove(group);
    rings.forEach(({ mesh, mat }) => { mesh.geometry.dispose(); mat.dispose(); });
  }

  return { object: group, update, dispose };
}
