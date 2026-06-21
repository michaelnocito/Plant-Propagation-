# Rootwork

Photo → propagation steps + resale rating. FastAPI + PWA. Personal use.

## Deploy (recommended — works on any phone, anywhere)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/michaelnocito/Plant-Propagation-)

1. Click the button (or render.com → **New** → **Blueprint** → pick this repo). Render reads `render.yaml` automatically.
2. When prompted, paste the two secret values:
   - `ANTHROPIC_API_KEY` (console.anthropic.com)
   - `PLANTNET_API_KEY` (my.plantnet.org → free signup → API key; 500 IDs/day free)
3. Deploy → you get a public URL like `https://rootwork.onrender.com`.
4. **On each iPhone:** open that URL in Safari → **Share** → **Add to Home Screen**. Launches fullscreen like a native app.

> Render's free plan sleeps after ~15 min idle, so the first photo after a quiet spell takes ~30–60s to wake. Snappy after that. A paid instance ($7/mo) stays always-on.

## Run locally (once)

1. Install [uv](https://docs.astral.sh/uv/) if you don't have it.
2. Set your keys:
   - `ANTHROPIC_API_KEY` (console.anthropic.com)
   - `PLANTNET_API_KEY` (my.plantnet.org → free signup → API key; 500 IDs/day free)
   - Windows PowerShell: `setx ANTHROPIC_API_KEY "..."` and `setx PLANTNET_API_KEY "..."`, then reopen the terminal
3. From this folder:

```
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## Use on your phone

- Same Wi-Fi as the PC.
- Find the PC's local IP (PowerShell: `ipconfig` → IPv4, e.g. 192.168.1.42).
- On the phone browser go to `http://192.168.1.42:8000`
- Share menu → **Add to Home Screen**. Launches like an app.

PC must be running the command above while you use it.
