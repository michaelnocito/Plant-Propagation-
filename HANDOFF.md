# Rootwork — Handoff

A handoff for continuing this project in **Claude Code running on your own
machine** (desktop app, terminal, or IDE extension), where Claude can run the
app live with you, deploy interactively, and iterate on features.

## What this is

A small personal app: photograph a plant → get propagation steps + a resale
rating. **FastAPI** backend + **PWA** frontend. Two users (you + girlfriend),
both on **iPhone**, installing via Safari "Add to Home Screen".

- **Plant ID:** Pl@ntNet API (`PLANTNET_API_KEY`, free 500 IDs/day)
- **Propagation + resale write-up:** Anthropic API, model `claude-sonnet-4-6` (`ANTHROPIC_API_KEY`)
- **Python 3.13**, managed with `uv`. Deploy target: **Render** (free tier), config in `render.yaml`.

## Current status

- Repo: https://github.com/michaelnocito/Plant-Propagation-
- Code is on **`main`** (initial build merged via PR #1).
- Latest polish lives on branch **`claude/rootwork-app-setup-aya7rv`** (iOS install
  meta tags + PNG app icons + Deploy-to-Render button). **Merge that branch to
  `main` before deploying** so the icons and tags ship.
- Verified working: deps install, server boots, all routes serve 200, `/propagate`
  validates input and reaches Pl@ntNet correctly. Only thing untested end-to-end is a
  real ID, which needs live API keys.

## The one remaining step (only you can do it)

Deploy to Render — it needs your accounts + secret keys, which an agent can't hold:

1. Merge `claude/rootwork-app-setup-aya7rv` → `main`.
2. render.com → **New → Blueprint** → pick `Plant-Propagation-` (or use the button in `README.md`).
3. Paste `ANTHROPIC_API_KEY` and `PLANTNET_API_KEY` when prompted (they're `sync: false`).
4. Deploy → public URL → open in Safari on each iPhone → **Share → Add to Home Screen**.

## Run it locally (for development)

```bash
# from the repo root, with uv installed (https://docs.astral.sh/uv/)
export ANTHROPIC_API_KEY=...        # Windows PowerShell: setx ANTHROPIC_API_KEY "..."
export PLANTNET_API_KEY=...         # setx PLANTNET_API_KEY "..."  (reopen terminal after setx)
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Open `http://localhost:8000` on the PC, or `http://<PC-LAN-IP>:8000` from a phone on
the same Wi-Fi. (Find the IP with `ipconfig` on Windows.)

## Layout

```
app/
  main.py        FastAPI app: POST /propagate (id→enrich), serves the PWA
  plantid.py     Pl@ntNet call → (scientific_name, common_name, confidence)
  claude.py      Anthropic call → PropResult JSON (steps, SVG diagram, marketability)
  models.py      Pydantic models (PropResult, Marketability)
  static/        index.html, app.js, sw.js, manifest.json, *.png icons
pyproject.toml   deps + ruff config
render.yaml      Render web service (free), secrets as sync:false env vars
```

## Good next steps / "more options" to explore in local Claude Code

These are bigger than a quick agent edit and benefit from running the app live:

- **Save history.** Right now every result is ephemeral. Add a tiny SQLite (or
  localStorage) "my plants" list so you can revisit past IDs and resale scores.
- **Keep it always-on.** Free Render sleeps; upgrade to the $7/mo instance, or move to
  Fly.io, for instant loads.
- **A real store app.** A PWA installs to the home screen but isn't in the App Store.
  If you ever want a true native iOS app, wrap the PWA with Capacitor — but that needs
  an Apple Developer account ($99/yr) and is only worth it beyond personal use.
- **Tune the resale rating.** The scoring prompt is in `app/claude.py` (`PROMPT`).
  Adjust weighting, add your local marketplace, or pin a price model.
- **Offline-friendlier.** The service worker caches the shell; could cache last result.
- **Auth / sharing.** If it grows past two people, add a simple login.

## Notes for whoever picks this up

- Keep the two secrets out of git — they belong in Render env vars / local shell only.
- `claude.py` expects the model to return strict JSON; it strips ```` ```json ```` fences
  before parsing. If Anthropic responses ever fail to parse, that's the place to look.
- Icons are generated PNGs (`app/static/icon-*.png`, `apple-touch-icon.png`). Regenerate
  if you rebrand; iOS needs the PNG `apple-touch-icon` (it ignores SVG icons).
