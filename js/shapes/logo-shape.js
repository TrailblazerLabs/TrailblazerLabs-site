import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';

/* ═══════════════════════════════════════════════════════════════════════════
   LOGO SHAPE — extruded 3D Trailblazer Labs logo, swappable into the hero scene
   Loads images/trailblazer-labs-logo.svg and extrudes its filled paths as
   stacked relief: the flask BODY (the big navy silhouette) sits at the BACK as
   a HOLLOW outline, and the interior artwork — sky panel, mountains, bushes,
   accents — is layered in FRONT of it, exactly like the flat mark reads. Each
   role gets its own z with a real gap so overlapping mountains don't z-fight.

   Hollow regions (the flask outline, etc.) are carved generically by
   shapesFromPath() using even-odd subpath containment — the same rule SVG fill
   uses — so you can edit or replace the SVG and any hole renders correctly with
   no code changes. The only requirement is that a hole's boundary be a distinct
   subpath, which is how design tools export nested holes.

   Conforms to the shape-module contract consumed by compass-hero.js:
     createShape() -> Promise<{ object, frame(camera), applyAspect(camera),
                                update(ctx) }>
   ═══════════════════════════════════════════════════════════════════════════ */

const SVG_URL = '../../images/trailblazer-labs-logo.svg';

const CAM_DIST = 14.0;
const TARGET_HEIGHT = 4.6;  // world units tall — smaller than the compass
const TARGET_FRAC = 0.70;   // on-canvas horizontal centre (0=left, 1=right)

// Per-role extrusion depth + stacking z. Front faces increase with z; gaps are
// ≥0.3u so overlapping layers never share a plane (kills the mountain flicker).
// Colours from the SVG: navy #032D60, sky #8CD3F8, purples #A372B5/#741B89,
// greens #009A44/#046A38, white #FFFFFF.
const ROLE = {
  '#8cd3f8': { role: 'sky',      depth: 0.1, z: 0.1, metalness: 0.1,  roughness: 0.7 },
  '#032d60': { role: 'navyMtn',  depth: 3.0, z: 0.1, metalness: 0.3,  roughness: 0.5 },
  '#a372b5': { role: 'mtnLight', depth: 3.0, z: 3.1, metalness: 0.25, roughness: 0.5 },
  '#741b89': { role: 'mtnDark',  depth: 3.0, z: 6.1, metalness: 0.25, roughness: 0.5 },
  '#009a44': { role: 'grass',    depth: 3.0, z: 0.1, metalness: 0.2,  roughness: 0.55 },
  '#046a38': { role: 'bush',     depth: 6.0, z: 3.1, metalness: 0.2,  roughness: 0.55 },
  '#ffffff': { role: 'accent',   depth: 12.0, z: 0.0, metalness: 0.5,  roughness: 0.3 },
};
const DEFAULT_ROLE = { role: 'other', depth: 0.8, z: 0.9, metalness: 0.3, roughness: 0.5 };

// The flask body: hollow navy outline at the back.
const FLASK = { depth: 12.0, z: 0.0, metalness: 0.35, roughness: 0.45 };

function normalizeHex(color) {
  if (!color || color === 'none') return null;
  return `#${new THREE.Color(color).getHexString()}`;
}

// Signed-area magnitude of a closed 2D polyline (shoelace).
function polyArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i += 1) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

// Point-in-polygon (ray cast). Used to compute containment between contours.
function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    const intersect = (a.y > pt.y) !== (b.y > pt.y) &&
      pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Turn ANY filled path into one or more THREE.Shapes with correct holes, using
// even-odd containment across its subpaths — the same rule SVG fill uses. For
// each ring we count how many other rings enclose it: even nesting depth = a
// solid outer boundary, odd depth = a hole of its immediate parent. This makes
// any hollow region in any SVG render correctly, with no per-shape special-
// casing. (Requires the hole's boundary to be a distinct subpath — which is how
// design tools export nested holes.)
function shapesFromPath(path) {
  const rings = path.subPaths
    .map((sp) => sp.getPoints())
    .filter((pts) => pts.length >= 3)
    .map((pts) => ({ pts, area: polyArea(pts) }))
    .sort((a, b) => b.area - a.area); // outers before the holes they contain

  const shapes = [];
  for (const ring of rings) {
    const probe = ring.pts[0];
    // Nesting depth = number of larger rings that contain this ring.
    let depth = 0;
    let parent = null;
    for (const other of rings) {
      if (other === ring || other.area <= ring.area) continue;
      if (pointInPoly(probe, other.pts)) {
        depth += 1;
        // Immediate parent = the smallest enclosing ring seen so far.
        if (!parent || other.area < parent.area) parent = other;
      }
    }
    if (depth % 2 === 0) {
      ring.shape = new THREE.Shape(ring.pts); // solid boundary
      shapes.push(ring.shape);
    } else if (parent && parent.shape) {
      parent.shape.holes.push(new THREE.Path(ring.pts)); // hole of its parent
    }
  }
  return shapes;
}

export async function createShape() {
  const root = new THREE.Group();   // sized + placed by the harness; mouse tilts this
  root.name = 'logo-shape';
  const flip = new THREE.Group();   // SVG is y-down; flip so the badge is upright
  flip.scale.y = -1;
  root.add(flip);

  const text = await fetch(SVG_URL).then((r) => {
    if (!r.ok) throw new Error(`logo SVG fetch failed: ${r.status}`);
    return r.text();
  });
  const parsed = new SVGLoader().parse(text);

  // Build each path's shapes ONCE so we can both detect the flask and reuse the
  // result when meshing (no double work, no drift between the two passes).
  const built = parsed.paths.map((path) => {
    const shapes = shapesFromPath(path);
    // A path is "hollow" if any of its shapes carries a hole. The flask border
    // is the only hollow silhouette in the mark — the sky panel and mountains
    // are all solid — so this identifies it regardless of colour or path order.
    const hollow = shapes.some((s) => s.holes.length > 0);
    let area = 0;
    for (const sp of path.subPaths) area = Math.max(area, polyArea(sp.getPoints()));
    return { path, shapes, hollow, area };
  });

  // The flask body is the largest HOLLOW path. Falls back to largest-area if the
  // SVG has no hollow shape (so behaviour degrades gracefully after an edit).
  const hollowPaths = built.filter((b) => b.hollow);
  const pool = hollowPaths.length ? hollowPaths : built;
  let flaskEntry = null;
  for (const b of pool) if (!flaskEntry || b.area > flaskEntry.area) flaskEntry = b;
  const flaskPath = flaskEntry ? flaskEntry.path : null;

  const bevel = {
    bevelEnabled: true,
    bevelThickness: 0.6,
    bevelSize: 0.4,
    bevelSegments: 2,
    curveSegments: 12,
  };

  function addMesh(shape, cfg, hex) {
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: cfg.depth, ...bevel });
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: hex ? new THREE.Color(hex) : new THREE.Color('#8899aa'),
        metalness: cfg.metalness,
        roughness: cfg.roughness,
        side: THREE.DoubleSide,
        // Insurance against coplanar z-fighting between stacked layers.
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      })
    );
    mesh.position.z = cfg.z;
    mesh.userData.role = cfg.role;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    flip.add(mesh);
  }

  for (const { path, shapes } of built) {
    const hex = normalizeHex(path.color?.getStyle?.());
    // The flask body reads as a hollow outline at the back; everything else is
    // interior artwork layered in front. Hole-carving is handled generically by
    // shapesFromPath, so both just differ by role config.
    const cfg = path === flaskPath ? FLASK : ((hex && ROLE[hex]) || DEFAULT_ROLE);
    for (const shape of shapes) addMesh(shape, cfg, hex || (path === flaskPath ? '#032d60' : null));
  }

  // Centre the assembly on the origin (so mouse-tilt pivots around the middle),
  // then scale the whole thing to TARGET_HEIGHT.
  let box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  flip.position.x -= center.x;
  flip.position.y -= center.y;
  flip.position.z -= center.z;

  box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  root.scale.setScalar(TARGET_HEIGHT / (size.y || 1));

  function frame(camera) {
    camera.position.set(0, 0, CAM_DIST);
    camera.lookAt(0, 0, 0);
    return new THREE.Vector3(0, 0, 0);
  }

  function applyAspect(camera) {
    // Move the logo (not the camera) into the right half — same trick the
    // compass uses so the ambient FX stays centred.
    const visibleHeight = 2 * CAM_DIST * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const visibleWidth = visibleHeight * camera.aspect;
    root.position.x = (TARGET_FRAC - 0.5) * visibleWidth;
  }

  function update() { /* idle motion handled by the harness's mouse tilt */ }

  return { object: root, frame, applyAspect, update, camDist: CAM_DIST };
}
