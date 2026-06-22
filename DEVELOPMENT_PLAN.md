# Rootwork — Development Plan & Roadmap

Living plan. Top section = what to do next; lower = backlog + the content-freshness plan.

## 🔴 Blocking — durable data (owner action required)
Render's free tier wipes the SQLite DB on every deploy. `render.yaml` already declares a 1 GB
persistent disk at `/var/data` + the always-on `starter` plan — it just needs to be **applied once**:
1. Render dashboard → the **Plant Propagation** Blueprint (or the `rootwork` service) → there's a
   pending sync to **Starter ($7/mo) + a disk**. **Review → Apply.** (Or service → Settings →
   Instance Type → Starter, then Settings → Disks → Add Disk `/var/data`, 1 GB.)
2. This also makes the app **always-on** (no cold-start sleep) — which fixes most analyze timeouts.
- **Until then:** use **Family tab → Data backup → Back up everything** before a deploy, and
  **Restore from a backup** after. (Free alternative to the disk: a Neon Postgres `DATABASE_URL` —
  also a one-time account + env var; say the word and I'll switch the app to it.)

## ✅ Recently shipped
Backup/restore · dancing-plant analyze loader + timeout-retry · soil profit calculator ·
Soil Lab (recipes + batches) · edible rating · earthy theme · network-first SW (no more stale UI).

## 🟡 Next up (build queue)
1. **Daily recipe sync (AI agent)** — see design below.
2. **Seed tagger** — track seeds like plants (photo + market options + salability). Likely a `Seed`
   entity mirroring `SoilPack`/`Plant`: photo, variety, source, market value (text appraisal), list/sold.
3. **Unify soil + seeds into the Marketplace tab** (one running-total cockpit across plants/soil/seeds).
4. **Speed, deeper** — if timeouts persist after always-on: trim the enrich prompt / stream results /
   split ID-then-enrich so the card paints progressively.

---

## 🤖 Daily recipe sync — design (to build)
**Goal:** Kelly taps "Sync recipes" (and/or it runs daily) → an AI agent web-searches for updated
soil-mix recipes & best practices and proposes additions/edits to the recipe library.

**Why it's a real subsystem (not a quick add):** the app server can't safely run open-web AI agents
on a schedule, and AI-sourced horticulture content must be **reviewed before it ships** (bad soil/edible
advice has real consequences). Proposed shape:
- **Where it runs:** a scheduled Claude Code routine / cron job (outside the FastAPI app), OR a small
  backend job that calls Claude with web-search. Daily.
- **What it does:** for each recipe (and topic), search reputable sources (extension, RHS, specialist),
  diff against our current `RECIPES`/static content, and emit a **proposals JSON** (add/change/flag) with
  citations + a confidence + a short rationale.
- **Human gate:** proposals land in a **review queue** (a `/proposals` screen or a PR), Kelly/Mike
  approve → approved items update the library. Never auto-publish unreviewed changes to recipes or edible info.
- **In-app surface:** a "Sync" button + a "What's new / pending review" badge in the Soil Lab.
- **MVP cut:** on-demand "Refresh this recipe" button → one agent call → shows a proposed update for
  approval. Grow to daily + full library later.

---

## 🗓️ Content-freshness plan (the "is our static text still right?" cadence)
We hard-code a lot of guidance. Schedule a periodic re-check of each against current best practice.
Mike sets the external reminders; this defines **what** to check and **how often**.

| Content (where) | Cadence | How to verify |
|---|---|---|
| **Edible / forage info** (`claude.py` prompt) | **Quarterly** + on any safety report | Re-check toxicity/lookalike guidance vs extension/poison-control; safety-critical — bias conservative |
| **Soil recipes & ratios** (`RECIPES` in app.js) | **Quarterly** | Cross-check vs extension/RHS/specialist; feed the daily-sync agent once built |
| **Bulk-buying & pricing** (`GUIDES`, soil appraisal) | **Twice a year** | Prices drift — re-survey marketplaces; update the appraisal prompt's price bands |
| **Care / light / temp ranges** (`claude.py`) | **Yearly** (it's AI-generated per plant, so low risk) | Spot-check a few species against extension guides |
| **Marketplace heuristics** (sell-score, ease weights) | **Yearly / as needed** | Sanity-check against what's actually selling |
| **Component glossary / storage tips** | **Yearly** | Stable; quick pass |

**Process when a check is due:** run a focused research pass (or the sync agent) → diff vs current →
apply reviewed updates → bump the SW cache → note the date here.
_Last full content review: 2026-06-22 (initial build)._

---

## 📋 Backlog (not yet scheduled)
- Propagation tracking v2 — stages (cutting→rooting→rooted→potted) + **expected-ready dates** for "sellable in N weeks"
- Dated **photo timeline** (multiple progress photos over time; today it's a gallery)
- **Editable species** — correct a wrong AI ID without losing history
- Simple **watering log** ("last watered N days ago")
- **Dark mode** toggle (earthy light is default; v9 dark palette can pair)
- Glasshouse concept extras — grow-line range bar, hero sell-score (`/design-concept.html`)
- Locations/rooms grouping
