# Trailblazer Labs — Site

The Trailblazer Labs community agent-publishing masthead: a static, no-build page
(plain HTML/CSS/vanilla JS) with a Three.js 3D compass hero loaded from a CDN via
an importmap. There is no bundler.

## Run locally

```bash
npm start          # serves the repo root at http://localhost:5173
# or, without npm:
python3 -m http.server 5173
```

Open <http://localhost:5173/>. Hero variants: append `?shape=compass` (default),
`?shape=logo`, or `?shape=tron` (glowing wireframe). Ambient FX: `?fx=constellation|starfield|contours|none`.

## Structure

- `index.html` — the page. Design tokens + icon set load from the Salesforce CDN;
  Three.js loads from jsDelivr via the importmap.
- `css/styles.css` — nav, hero, blades, cards, footer.
- `js/compass-hero.js` — shape-agnostic Three.js scene harness (renderer, camera,
  lights, mouse-tilt, fps/visibility gating). Ambient FX in `js/hero-effects.js`.
- `js/shapes/*.js` — swappable hero shapes (`compass`, `logo`, `tron`), each
  exporting `createShape(...)`; selected via `?shape=` → `data-shape` → `compass`.
- `src/createCompassWireframe.js` — the reusable compass builder the shapes build on.
- `data/*.json` — card content for the asset grid and builders.
- `images/` — referenced art only.

## Deploy (GitHub Pages)

The repo root is directly serveable — no build step. Either enable Pages from the
`main` branch (root) in the repo settings, or:

```bash
npm run deploy     # publishes the root to the gh-pages branch
```
