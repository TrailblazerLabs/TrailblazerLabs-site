import * as THREE from 'three';

const DEFAULTS = {
  radius: 2.0,
  depth: 0.8,
  radialSegments: 128,
  tubularSegments: 64,
  tickCount: 20,
  wireframe: false,
  showGlass: true,
  colors: {
    cyan: 0x05c8ff,
    blue: 0x0738ff,
    deepBlue: 0x05006b,
    violet: 0x5c22ff,
    white: 0xf3fbff,
    metal: 0xd9f6ff,
    shadow: 0x080018
  },
};

function material(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.0,
    metalness: options.metalness ?? 1.0,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
    side: THREE.DoubleSide,
    wireframe: options.wireframe ?? false
  });
}

function lineMaterial(color, opacity = 1) {
  return new THREE.LineBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity
  });
}

function addEdges(mesh, color, opacity = 0.95) {
  const edges = new THREE.EdgesGeometry(mesh.geometry, 18);
  const lines = new THREE.LineSegments(edges, lineMaterial(color, opacity));
  // `lines` is parented to `mesh`, so it already inherits the mesh transform.
  // Keep its local transform at identity — copying the mesh's position/rotation
  // here would apply the transform twice and fling the edges off into space.
  mesh.add(lines);
  return lines;
}

function makeTorus(name, radius, tube, color, opts, edge = {}) {
  const geometry = new THREE.TorusGeometry(
    radius,
    tube,
    edge.tubularSegments ?? opts.tubularSegments,
    opts.radialSegments
  );
  const mesh = new THREE.Mesh(
    geometry,
    material(color, opts)
  );
  mesh.name = name;
  if (opts.wireframe && edge.show !== false) {
    addEdges(mesh, color, edge.opacity ?? 0.72);
  }
  return mesh;
}

function makeCylinder(name, radius, depth, color, opts) {
  const geometry = new THREE.CylinderGeometry(
    radius,
    radius,
    depth,
    opts.radialSegments,
    1,
    false
  );
  geometry.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(
    geometry,
    material(color, {
      transparent: opts.transparent ?? false,
      opacity: opts.opacity ?? 1,
      metalness: opts.metalness ?? 1.0,
      roughness: opts.roughness ?? 0.1,
      wireframe: opts.wireframe
    })
  );
  mesh.name = name;
  if (opts.wireframe) {
    addEdges(mesh, opts.colors.cyan, 0.5);
  }
  mesh.position.z = opts.z ?? 0;
  return mesh;
}

function makeExtrudedRing(name, outerRadius, innerRadius, depth, color, opts) {
  // A ring case is a cross-section revolved 360°. LatheGeometry does exactly
  // that and welds the wrap-around automatically with continuous normals, so —
  // unlike ExtrudeGeometry — there is no start/end seam and no shading crease.
  const centerRadius = (outerRadius + innerRadius) / 2;
  const radialHalf = Math.abs(outerRadius - innerRadius) / 2; // wall thickness / 2
  const depthHalf = depth / 2;                                // thickness along Z

  // Stadium ("capsule") cross-section: FLAT vertical inner and outer walls
  // joined by rounded lips front and back — so the revolve reads as a cylinder
  // with rounded edges, not a fully-round ring. x = distance from the spin
  // axis, y = depth. The corner radius can't exceed either half-extent.
  const r = Math.min(radialHalf, depthHalf); // lip radius
  const wallHalf = depthHalf - r;            // half-height of the flat wall run
  const arcSteps = opts.tubularSegments;
  const points = [];

  // Outer flat wall (bottom → top).
  points.push(new THREE.Vector2(centerRadius + radialHalf, -wallHalf));
  points.push(new THREE.Vector2(centerRadius + radialHalf, wallHalf));
  // Front lip: arc from outer wall over the top to the inner wall.
  for (let i = 0; i <= arcSteps; i += 1) {
    const a = (i / arcSteps) * Math.PI; // 0 → π, bulging toward +y
    points.push(new THREE.Vector2(
      centerRadius + r * Math.cos(a),
      wallHalf + r * Math.sin(a)
    ));
  }
  // Inner flat wall (top → bottom).
  points.push(new THREE.Vector2(centerRadius - radialHalf, wallHalf));
  points.push(new THREE.Vector2(centerRadius - radialHalf, -wallHalf));
  // Back lip: arc from inner wall under the bottom back to the outer wall.
  for (let i = 0; i <= arcSteps; i += 1) {
    const a = Math.PI + (i / arcSteps) * Math.PI; // π → 2π, bulging toward -y
    points.push(new THREE.Vector2(
      centerRadius + r * Math.cos(a),
      -wallHalf + r * Math.sin(a)
    ));
  }

  const geometry = new THREE.LatheGeometry(points, opts.radialSegments);
  // Lathe revolves around the Y axis; rotate so the ring lies in the XY plane
  // with its axis pointing along Z (toward the camera), like the old ring.
  geometry.rotateX(Math.PI / 2);

  const mesh = new THREE.Mesh(
    geometry,
    material(color, {
      metalness: 0.9,
      roughness: 0.05,
      wireframe: opts.wireframe
    })
  );
  mesh.name = name;
  if (opts.wireframe) {
    addEdges(mesh, color, 0.72);
  }
  return mesh;
}

function buildLightningBoltShape(opts) {
  // The exact 2D outline of the lightning bolt path — shared by the solid
  // extrude and by wireframe/neon consumers that want a clean single-line
  // silhouette instead of the beveled 3D result's crease facets.
  const lightningPath = new THREE.Shape();
  const boltSize = opts.radius * 0.618;

  // Start at the sharp top tip
  lightningPath.moveTo(0.0, boltSize * 1.0);

  // Trace the right side downward
  lightningPath.lineTo(boltSize * -0.25, boltSize * -0.1);   // Top right outer corner
  lightningPath.lineTo(boltSize * 0.0125, boltSize * -0.125);   // Tightening inward right neck

  // Reach the sharp bottom tip
  lightningPath.lineTo(0.0, boltSize * -1.0);

  // Trace up the left side back to the top
  lightningPath.lineTo(boltSize * 0.25, boltSize * 0.1); // Middle left outer bulge
  lightningPath.lineTo(boltSize * -0.0125, boltSize * 0.125);  // Upper left neck

  // Close the path automatically back to (0.0, 1.0)
  lightningPath.closePath();

  return { shape: lightningPath, boltSize };
}

function buildLightningBoltGeometry(opts) {
  // 1. Draw the exact 2D outline of the lightning bolt path
  const { shape: lightningPath } = buildLightningBoltShape(opts);

  // 2. Configure extrusion to create the 3D chiseled/creased look
  const extrudeSettings = {
      depth: 0.01,            // Overall thickness of the needle body
      bevelEnabled: true,
      bevelSegments: 1,       // 1 segment keeps the bevel flat and faceted (like a crease!)
      bevelSize: 0.2,        // Controls how wide the chiseled ridge edge is
      bevelThickness: 0.1,    // Controls how tall/raised the center crease looks
      bevelOffset: -0.1,
  };

  // 3. Generate geometry and apply metallic material
  const geometry = new THREE.ExtrudeGeometry(lightningPath, extrudeSettings);
 
  return geometry;
}

function makeNeedle(opts) {
  const group = new THREE.Group();
  group.name = 'compass-needle';
  group.rotation.z = -Math.PI / 4.7;
  group.position.z = 0.0;//opts.depth * 0.1;

  const boltGeometry = buildLightningBoltGeometry(opts);

  const boltMaterial = new THREE.MeshStandardMaterial({
    color: opts.colors.metal,
    metalness: 0.9,
    roughness: 0.1,
    flatShading: true,
    side: THREE.DoubleSide,
    wireframe: opts.wireframe
  });

  const bolt = new THREE.Mesh(boltGeometry, boltMaterial);
  bolt.name = 'needle-lightning-bolt';
  // Stash the clean 2D silhouette so wireframe/neon renderers can draw a single
  // crisp outline loop instead of edge-detecting the beveled crease facets.
  bolt.userData.outlineShape = buildLightningBoltShape(opts).shape;
  // Needle is the caster — throws a shadow onto the rose face behind it when a
  // shadow-casting light and shadow-enabled renderer are present (see the hero
  // harness). Harmless no-op otherwise.
  bolt.castShadow = true;
  group.add(bolt);

  // --- Pivot dome: only the upper hemisphere pokes up through the bolt ---
  const domeRadius = 0.06;
  const domeGeometry = new THREE.SphereGeometry(
    domeRadius,
    28,
    14,
    0,
    Math.PI * 2,
    0,
    Math.PI / 2
  );
  // Sphere's theta=0 cap defaults to the +Y pole; rotate it to face +Z so
  // the dome's flat equator disc lies in the needle's XY plane and the
  // rounded cap points outward, above the bolt.
  domeGeometry.rotateX(Math.PI / 2);

  const pivot = new THREE.Mesh(
    domeGeometry,
    material(opts.colors.white, {
      metalness: 0.35,
      roughness: 0.08,
      wireframe: opts.wireframe
    })
  );
  pivot.name = 'needle-pivot';
  pivot.castShadow = true;
  // Equator sits right at the bolt's own z (0), so nothing but the dome
  // cap is visible above the needle; the "lower half" simply doesn't exist.
  pivot.position.z = 0.1;
  group.add(pivot);

  return group;
}

function makeTickRectMesh(name, length, width, depth, color, opts, materialOpts = {}) {
  const shape = new THREE.Shape();
  const hw = width / 2;
  const hl = length / 2;
  shape.moveTo(-hw, -hl);
  shape.lineTo(hw, -hl);
  shape.lineTo(hw, hl);
  shape.lineTo(-hw, hl);
  shape.lineTo(-hw, -hl);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 1,
    steps: 1
  });
  geometry.center();

  const mesh = new THREE.Mesh(
    geometry,
    material(color, {
      metalness: materialOpts.metalness ?? 0.7,
      roughness: materialOpts.roughness ?? 0.2,
      wireframe: opts.wireframe
    })
  );
  mesh.name = name;
  return mesh;
}

function makeTicks(opts) {
  const group = new THREE.Group();
  group.name = 'dial-ticks';
  const z = opts.depth * -0.2;

  for (let i = 0; i < opts.tickCount; i += 1) {
    const angle = (i / opts.tickCount) * Math.PI * 2;
    const cardinal = i % 5 === 0;

    if (cardinal) {
      const inner = opts.radius * 0.74;
      const outer = opts.radius * 0.84;
      const length = outer - inner;
      const midRadius = (inner + outer) / 2;
      const width = opts.radius * 0.025;
      const depth = opts.depth * 0.18;

      const mesh = makeTickRectMesh(
        'cardinal-tick',
        length,
        width,
        depth,
        opts.colors.white,
        opts,
        { metalness: 0.9, roughness: 0.1 }
      );
      // Position at the midpoint of the tick's radial span, then rotate about Z
      // so the rectangle's long (local Y) axis points outward along the angle.
      mesh.position.set(Math.sin(angle) * midRadius, Math.cos(angle) * midRadius, z);
      mesh.rotation.z = -angle;
      // group.add(mesh);

      if (opts.wireframe) {
        addEdges(mesh, opts.colors.white, 0.85);
      }
    } else {
      const inner = opts.radius * 0.76;
      const outer = opts.radius * 0.84;
      const length = outer - inner;
      const midRadius = (inner + outer) / 2;
      const width = opts.radius * 0.02;
      const depth = opts.depth * 0.08;

      const mesh = makeTickRectMesh(
        'minor-tick',
        length,
        width,
        depth,
        opts.colors.metal,
        opts,
        { metalness: 0.9, roughness: 0.1 }
      );
      // Same radial orientation as cardinals, but flat/subtle so it reads as
      // an engraved graduation lying on the face rather than a raised marker.
      mesh.position.set(Math.sin(angle) * midRadius, Math.cos(angle) * midRadius, z);
      mesh.rotation.z = -angle;
      group.add(mesh);

      if (opts.wireframe) {
        addEdges(mesh, opts.colors.metal, 0.6);
      }
    }
  }

  return group;
}

function makeLabelSprite(text, opts) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = '400 96px Arial, Helvetica, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 0;
  ctx.strokeStyle = '#' + opts.colors.blue.toString(16).padStart(6, '0');
  ctx.fillStyle = '#' + opts.colors.metal.toString(16).padStart(6, '0');
  ctx.strokeText(text, 64, 68);
  ctx.fillText(text, 64, 68);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  // A flat plane (not a Sprite) so the glyph lies in the face plane and tilts
  // with the compass instead of billboarding to always face the camera.
  const size = opts.radius * 0.14;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    // alphaTest (not transparent) so the plane stays an OPAQUE object: the
    // transmission/refraction pass of the glass lens only samples opaque
    // meshes, so a `transparent: true` label would disappear behind the lens.
    // alphaTest discards the empty texture pixels while keeping the glyph solid.
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: false,
      alphaTest: 0.5,
      side: THREE.DoubleSide
    })
  );
  mesh.name = `label-${text}`;
  return mesh;
}

function makeLabels(opts) {
  const group = new THREE.Group();
  group.name = 'cardinal-labels';
  const labels = [
    ['N', 0, 1],
    ['E', 1, 0],
    ['S', 0, -1],
    ['W', -1, 0]
  ];
  const labelRadius = opts.radius * 0.8;
  // Just above the face's front surface so the glyphs sit flat on the dial.
  const z = opts.depth * -0.22;

  labels.forEach(([text, x, y]) => {
    const label = makeLabelSprite(text, opts);
    label.position.set(x * labelRadius, y * labelRadius, z);
    group.add(label);
  });

  return group;
}

function buildRoseStarShape(opts) {
  // A four-pointed star ("sparkle"): sharp tips at N/E/S/W with edges that curve
  // CONCAVELY inward toward the centre between them. A cos(4t) polar curve can
  // only bulge convexly (flower petals), so instead we place the four tips and
  // the four valleys explicitly, then join each tip→valley with a quadratic
  // whose control point is pulled toward the centre to hollow the edge inward.

  const tip = opts.radius * .608;//1.12;      // outer point radius
  const valley = 0.24;   // inner notch radius between points
  const concavity = -1.1; // how far the control point is pulled toward centre
  const shape = new THREE.Shape();

  // 8 alternating anchor angles, starting at N (+Y) and going clockwise.
  const anchor = (r, ang) => new THREE.Vector2(Math.sin(ang) * r, Math.cos(ang) * r);
  const tips = [0, 1, 2, 3].map((k) => anchor(tip, (k * Math.PI) / 2));
  const valleys = [0, 1, 2, 3].map((k) => anchor(valley, (k * Math.PI) / 2 + Math.PI / 4));

  shape.moveTo(tips[0].x, tips[0].y);
  for (let k = 0; k < 4; k += 1) {
    const v = valleys[k];
    const nextTip = tips[(k + 1) % 4];
    // Control point sits near the valley but nudged toward the origin so the
    // edge bows inward (concave) rather than running straight to the notch.
    const cx = v.x * (1 - concavity);
    const cy = v.y * (1 - concavity);
    shape.quadraticCurveTo(cx, cy, nextTip.x, nextTip.y);
  }
  return { shape, tip };
}

function makeCompassRose(opts) {

  const { shape } = buildRoseStarShape(opts);

  // Shorter, more rounded extrusion with a small bevel — a large bevelSize
  // erodes the freshly-sharpened points, so keep it tight.
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: opts.depth * 0.0,
    bevelEnabled: true,
    bevelSize: opts.depth * 0.1,      // how stees the bevel slope. you need to adjust the rose size if this gets big
    bevelThickness: opts.depth * 0.1, //how raised is the rose
    bevelOffset: opts.depth * -0.0,
    bevelSegments: opts.radialSegments,
    curveSegments: opts.tubularSegments,
    steps: 1
  });
  geometry.center();
  // ExtrudeGeometry leaves hard per-face normals on the bevel, which is what
  // reads as visible facets. Recomputing vertex normals blends them so the
  // dome shades smoothly like the case.
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(
    geometry,
    material(opts.colors.cyan, {
      metalness: 0.3,
      roughness: 0.4,
      wireframe: opts.wireframe
    })
  );
  mesh.name = 'extruded-compass-rose';
  // Stash the clean 2D star silhouette for wireframe/neon consumers (see above).
  // The extrude below is .center()ed, but this star is symmetric about the
  // origin so the raw outline still aligns with the centered mesh.
  mesh.userData.outlineShape = shape;
  mesh.position.z = opts.depth * -0.2;
  // Rose is the receiver — the needle's shadow lands here. castShadow too so the
  // extruded relief self-shadows into its own recesses under the overhead spot.
  mesh.receiveShadow = true;
  mesh.castShadow = true;

  if (opts.wireframe) {
    addEdges(mesh, opts.colors.white, 0.86);
  }

  return mesh;
}

function makeTopLoop(opts) {
  const group = new THREE.Group();
  group.name = 'top-hanger-loop';
  const topOfCase = opts.radius * 1.2;

  // Stem/boss: a small vertical cylinder protruding from the top of the case,
  // built directly with THREE.CylinderGeometry (default Y-axis) so it points
  // straight up (+Y) rather than using makeCylinder's Z-axis orientation.
  // It sits between the case rim and the ring, visually bridging the two.
  const stemHeight = opts.radius * 0.16;
  const stem = makeExtrudedRing('stem-boss', 0.16, 0.06, stemHeight, opts.colors.metal, {...opts});
  group.add(stem);
  stem.position.y = topOfCase + .12;
  stem.rotation.y = 1.6;

  // Single silver carrying ring, standing vertically in the screen plane.
  const loop = makeTorus('vertical-loop-ring', opts.radius * 0.22, 0.05, opts.colors.metal, opts);
  loop.position.set(0, topOfCase + .16 + opts.radius * 0.18, opts.depth * 0.0);
  loop.rotation.z = -0.12;
  group.add(loop);

  return group;
}

function makeLens(opts) {
  const group = new THREE.Group();
  group.name = opts.name;

  // Transparent crystal lens. transmission (not opacity) makes it read as real
  // glass: light passes through and bends. ior + thickness drive the amount of
  // refraction, so the rose/needle warp slightly when seen through the dome.
  const lensGeometry = new THREE.CylinderGeometry(
    opts.radius * 0.94,
    opts.radius * 0.94,
    opts.depth * 0.1,
    opts.radialSegments,
    1,
    false
  );
  lensGeometry.rotateX(Math.PI / 2);
  const lens = new THREE.Mesh(
    lensGeometry,
    new THREE.MeshPhysicalMaterial({
      color: opts.colors.white,
      metalness: 0,
      roughness: 0.0,
      transmission: 1,       // fully light-transmitting → see-through glass
      thickness: opts.depth * 0.1, // refraction depth (needs ior to bend)
      ior: 1.5,              // ~crown glass
      transparent: true,
      // clearcoat: 1,
      // clearcoatRoughness: 0.01,
      side: THREE.DoubleSide
    })
  );
  lens.name = 'transparent-crystal-lens';
  lens.position.z = opts.depth * 0.4;
  group.add(lens);

  return group;
}

function makeRoseGlow(opts) {
  // Glow that sits directly behind the rose: the SAME star silhouette, drawn to
  // a canvas, blurred, and recoloured. Painting the shape's own outline (rather
  // than a radial gradient) keeps the four points, so the halo reads as the
  // star's own aura instead of a generic disc.
  const { shape, tip } = buildRoseStarShape(opts);
  const pts = shape.getPoints(96); // polyline approximation of the star outline

  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Map shape units (~ -tip..+tip) into canvas pixels, leaving margin for blur.
  // Canvas y is flipped vs. our +Y-up shape space.
  const pad = 0.55;
  const scale = (size / 2) / (tip * (1 + pad));
  const toX = (x) => size / 2 + x * scale;
  const toY = (y) => size / 2 - y * scale;

  const glow = new THREE.Color(opts.colors.cyan);
  const rgb = `${Math.round(glow.r * 255)},${Math.round(glow.g * 255)},${Math.round(glow.b * 255)}`;

  // Two blurred passes — a wide soft bloom and a tighter brighter core.
  const drawStar = (blurPx, alpha) => {
    ctx.save();
    ctx.filter = `blur(${blurPx}px)`;
    ctx.fillStyle = `rgba(${rgb},${alpha})`;
    ctx.beginPath();
    ctx.moveTo(toX(pts[0].x), toY(pts[0].y));
    for (let i = 1; i < pts.length; i += 1) {
      ctx.lineTo(toX(pts[i].x), toY(pts[i].y));
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };
  drawStar(size * 0.09, 0.55); // outer bloom
  drawStar(size * 0.035, 0.9); // inner core

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  // Plane sized to the padded canvas, placed just behind the rose so the blur
  // bleeds out past the star's points. Additive so it glows over the face.
  const planeSize = tip * (1 + pad) * 2;
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(planeSize, planeSize),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
  plane.name = 'rose-glow';
  return plane;
}

export function createCompassWireframe(options = {}) {
  const opts = {
    ...DEFAULTS,
    ...options,
    colors: { ...DEFAULTS.colors, ...(options.colors ?? {}) }
  };

  const compass = new THREE.Group();
  compass.name = 'compass-wireframe';

  const outerCase = makeExtrudedRing('outer-case', opts.radius * 1.2, opts.radius, opts.depth, opts.colors.metal, {...opts});
  outerCase.position.z = opts.depth * 0.0;
  compass.add(outerCase);

  const face = makeCylinder('opaque-teal-recessed-face', opts.radius * 1.05, opts.depth * 0.1, opts.colors.cyan, {
    ...opts,
    metalness: 0.0,
    roughness: 0.55,
    z: opts.depth * -0.3,
  });
  // face.position.z = opts.depth * -0.3;
  compass.add(face);

  // Glow sits just behind the rose (rose is at depth*0.6), in front of the face.
  const roseGlow = makeRoseGlow(opts);
  roseGlow.position.z = opts.depth * -0.22;
  compass.add(roseGlow);

  compass.add(makeCompassRose(opts));
  compass.add(makeTicks(opts));
  compass.add(makeLabels(opts));
  compass.add(makeNeedle(opts));
  compass.add(makeTopLoop(opts));

  // const lens = makeLens({...opts,name:'transparent-lens'});
  // compass.add(lens);

  compass.rotation.x = -0.25;
  compass.rotation.y = 0.25;
  compass.rotation.z = 0.25;

  return compass;
}

export function frameCompassCamera(camera, compass, distance = 16.4) {
  const box = new THREE.Box3().setFromObject(compass);
  const center = box.getCenter(new THREE.Vector3());
  camera.position.set(center.x, center.y - 0.05, distance);
  camera.lookAt(center);
  return center;
}
