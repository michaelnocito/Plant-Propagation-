# Rootwork

Photo → propagation steps + resale rating. FastAPI + PWA. Personal use.

## Run (once)

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
