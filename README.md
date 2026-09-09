# Trailblazer Labs

**Built by Trailblazers. Shared with everyone.**

Trailblazer Labs is a Salesforce community program and public showcase for
open-source solutions built by the community, for the community — business
frameworks, code, Slack skills, and more that anyone can explore and adopt.

## The program

- **Discover Solutions** — Browse open-source assets published by the community.
  Every asset lives in a transparent GitHub repository under the
  [TrailblazerLabs org](https://github.com/TrailblazerLabs) and links out to its source.
- **Builders in Residence** — Inspired by "Artist in Residence" programs, our
  Builders in Residence are community leaders creating open-source blueprints,
  components, and frameworks. Each cohort is featured on the site.
- **Champion Ideas** — The community posts pitches and upvotes them. Upvotes signal
  demand and, alongside an internal rubric, help shape who joins the next cohort.
- **Pitch Your Idea** — Anyone can submit an idea to build. Selected pitches join an
  upcoming Builder in Residence cohort.
- **Community Hub** — Announcements, ideas, questions, and show-and-tell across the
  ecosystem, powered by GitHub Discussions.

This site is the front door to that program. Asset and builder cards are generated
from the TrailblazerLabs org's repositories (see `scripts/build-assets.mjs` and
`data/community-assets-config.yml`).

## Legal

All projects, code, and documentation hosted or featured on this site are provided
under the Apache License, Version 2.0 unless explicitly stated otherwise. All
software and materials are provided strictly on an "AS IS" basis. Salesforce, Inc.
makes no warranties, representations, or conditions of any kind, express or implied,
including but not limited to warranties of title, non-infringement, merchantability,
or fitness for a particular purpose. You are solely responsible for determining the
appropriateness of using or redistributing these projects and assume any and all
risks associated with doing so. The hosting, listing, or public display of
third-party open-source projects here does not constitute an endorsement,
recommendation, sponsorship, audit, or security verification by Salesforce, Inc.

Contributors sign a Contributor License Agreement (CLA) before their work is
accepted; see the `cla/` directory.

## For developers

A static, no-build site: plain HTML/CSS/vanilla JS with a Three.js 3D compass hero
loaded from a CDN via an importmap. There is no bundler.

### Run locally

```bash
npm start          # serves the repo root at http://localhost:5173
# or, without npm:
python3 -m http.server 5173
```

Open <http://localhost:5173/>. Hero variants: append `?shape=compass` (default),
`?shape=logo`, or `?shape=tron` (glowing wireframe). Ambient FX:
`?fx=constellation|starfield|contours|none`.

### Structure

- `index.html` — "Coming Soon" holding page. `index2.html` — the full site (home).
- `assets.html` — Discover Solutions (filterable asset list).
- `involved.html` — Meet the Builders, Champion Ideas, and Community Hub (tabbed).
- `pitch.html` — Pitch Your Idea form and "How It Works".
- `partials/` — shared header and footer, injected by `js/partials.js`.
- `css/styles.css` — nav, hero, blades, cards, footer. Design tokens + icon set load
  from the Salesforce CDN; Three.js loads from jsDelivr via the importmap.
- `js/compass-hero.js` — shape-agnostic Three.js scene harness (renderer, camera,
  lights, mouse-tilt, fps/visibility gating). Ambient FX in `js/hero-effects.js`.
- `js/shapes/*.js` — swappable hero shapes (`compass`, `logo`, `tron`), each
  exporting `createShape(...)`; selected via `?shape=` → `data-shape` → `compass`.
- `src/createCompassWireframe.js` — the reusable compass builder the shapes build on.
- `data/*.json` — card content for the asset grid, builders, and pitches.
- `scripts/build-assets.mjs` — regenerates `data/community-assets.json` and
  `data/builders.json` from the TrailblazerLabs org via the GitHub API.
- `images/` — referenced art only.

### Deploy (GitHub Pages)

The repo root is directly serveable — no build step. Either enable Pages from the
`main` branch (root) in the repo settings, or:

```bash
npm run deploy     # publishes the root to the gh-pages branch
```
