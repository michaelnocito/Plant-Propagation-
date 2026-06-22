# Rootwork — Design Handoff

A brief for a focused **visual/UX design pass**. The app is feature-complete and works well;
this handoff is an invitation to elevate it from "clean and functional" to "delightful, premium,
and calm." Engineering, data, and flows are settled — **this is about look, feel, hierarchy,
motion, and polish**, not new features.

## What Rootwork is
A personal plant companion for **two people (Mike + Kelly), both on iPhone**, installed as a PWA
("Add to Home Screen"). You photograph a plant and get: an AI **health check-up**, full **care**
(with light/temperature *thriving ranges*), **propagation** steps, and **two resale ratings**
(cuttings + whole plant). Plants are saved into **per-person + shared "Family"** collections, can
be **listed on a family Marketplace** (ranked by a "sell score" = value × ease), tracked for
**propagations in progress**, and have a **photo gallery** with ZIP export/backup.

It is a *calm hobby + side-hustle* tool, not a clinical utility. Tone: botanical, warm, unhurried,
a little crafted. Think field journal / herbarium plate, not SaaS dashboard.

## Who & context
- **Devices:** iPhone Safari, standalone PWA, ~375–430px wide. Dark environment-friendly.
- **Users:** a couple who love plants and sell a few. Low cognitive load is a core value — the
  plant detail **opens on a Summary** by default; Detail is opt-in.
- **Frequency:** quick check-ins (identify, water, list), plus occasional "what should we sell" sessions.

## Current design system (as built)
- **Palette (CSS vars in `index.html`):** `--ink:#0f1c14` / `--ink2:#16271b` (deep greens, bg),
  `--parch:#efe7d4` / `--parch2:#e3d8bf` (parchment card surfaces), `--sage:#7fa07a` (accent/active),
  `--copper:#c0703a` (primary actions, prices, resale), `--line:#2c4231`, `--muted:#9fb39c`.
- **Type:** Headings in a serif stack (`"Iowan Old Style","Palatino Linotype",Georgia,serif`);
  body in the system sans stack. The serif gives the botanical-journal feel.
- **Components:** rounded cards (parchment on ink), pill chips/tags, bottom tab bar (4 tabs),
  segmented toggles (Summary/Detail, Private/Family), a circular resale "seal", **range bars**
  (light zones + a temperature gradient with a green thriving band), summary tiles, plant grid
  cards, marketplace rows with a "sell score", a photo gallery + lightbox, an avatar identity chip.
- **Motion:** minimal (a single card rise-in). Respects `prefers-reduced-motion`.

## Screens to design for
1. **Identify** — camera/upload dropzone → result card.
2. **Plant detail** — Summary (resale value banner, Sun/Soil/Water/Temp/Humidity tiles, light & temp
   range bars) ⇄ Detail (check-up, full care, propagation w/ inline SVG diagram, resale, photos,
   manage controls). Toggle top-right.
3. **My Plants / Family** — filterable grids of plant cards (thumbnail, name, owner avatar, badges).
4. **Marketplace** — running-total header (potential value / for sale / props rooting), sortable
   rows, sell score, sold styling.
5. **Photo gallery + lightbox**, **identity picker** ("Who's gardening?"), **manage submenu**
   (propagation stepper, mark sold, list/unlist).
6. **Empty states** (no plants, nothing listed, no photos) — currently plain text; ripe for charm.

## Design goals / opportunities (the brief)
- **Cohesion & rhythm:** unify spacing scale, card radii, type sizes, and section headers into a
  tighter system. Establish a clear type ramp and vertical rhythm.
- **Hero the value:** the resale value + sell score are the app's "magic" — make them feel earned
  and premium (the resale "seal", the marketplace cockpit, the sell score).
- **The range bars** (light/temp) are a signature element — push them to be genuinely beautiful and
  instantly legible.
- **Plant cards & gallery:** make the collection feel like a cherished, browsable garden — imagery
  forward, lovely empty/placeholder states, a real "growth over time" feel for photos.
- **Iconography:** currently a mix of inline SVG + emoji (☀️🪴💧🌡️🌱✂️). Decide: refine into a
  cohesive custom icon set, or commit to emoji intentionally. Right now it's in-between.
- **Motion & delight:** tasteful transitions (tab changes, card open, save confirmation, marking
  sold, a small celebratory beat when a propagation is logged). Keep it calm.
- **Empty/first-run & onboarding:** the picker and first identify could feel more crafted.
- **Light mode?** Currently dark-only. Consider whether a light/parchment mode fits the journal feel
  (optional — propose, don't assume).

## Hard constraints (please honor)
- **No build step, vanilla only.** Everything lives in `app/static/index.html` (markup + `<style>`),
  `app/static/app.js` (render functions), `app/static/sw.js`. No frameworks, bundlers, or npm.
  Keep it a single static bundle the FastAPI app serves.
- **PWA / offline:** the service worker caches the shell — keep total weight modest, prefer CSS/SVG
  over heavy assets; if you add fonts/images, account for caching (`sw.js` `SHELL` list + cache bump).
- **iOS standalone:** respect `env(safe-area-inset-*)` (notch + home indicator); the bottom tab bar
  and modals already do — don't regress this.
- **Accessibility:** maintain contrast (parchment-on-ink is good; verify any new combos), tap targets
  ≥ ~40px, and `prefers-reduced-motion`.
- **Data shape is fixed** — design around the existing fields (see `app/models.py`); don't require
  new backend data. (New *nice-to-have* fields can be proposed separately.)
- **Keep the calm.** Low cognitive load and an unhurried, botanical warmth are the brand. Avoid
  dashboard-y density or loud gamification.

## How to work in the code
- Visual changes = the `<style>` block in `index.html` + the HTML structure + the `render*` functions
  in `app.js` (they build innerHTML). Colors are CSS variables — evolving the palette is a few edits.
- Verify by running the app and using the in-app flows (identify → save → list → gallery). A local
  run needs `uv`/venv + the two API keys; the live app is at https://rootwork.onrender.com.
- Bump `sw.js` cache version when static assets change so phones pull the update.

## Suggested deliverable from the design pass
1. A short **visual direction** (mood, refined palette/type ramp, spacing scale, motion principles).
2. A **restyled component pass** applied in-code (cards, tabs, toggles, range bars, marketplace rows,
   gallery, empty states) — shipped as edits to `index.html`/`app.js`, verified on a ~390px viewport.
3. Notes on anything that needs a product decision (e.g., light mode, custom icon set).

Start with the **plant detail (Summary)** and the **Marketplace** — they carry the brand.
