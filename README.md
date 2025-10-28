# Solutions Architect Reps — Daily 10 (Flask)

A lightweight Python webapp that gives you a 7-minute daily drill for Solutions Architect interviews:
- 5 flash cards
- 3 tradeoff picks
- 1 whiteboard prompt
- 1 behavioral prompt

It stores your daily session & attempts in SQLite and works great on iPhone (installable as a PWA).

## Quick start

```bash
# 1) Create venv (Python 3.10+ recommended)
python3 -m venv .venv && source .venv/bin/activate

# 2) Install deps
pip install -r requirements.txt

# 3) Run the app (0.0.0.0 so you can open it from your iPhone on same Wi-Fi)
export FLASK_APP=app.py
export FLASK_ENV=development
python app.py  # or: flask run --host=0.0.0.0 --port=5000
```

Visit:
- MacBook: http://localhost:5000
- iPhone (same network): http://<your-computer-LAN-ip>:5000

> Tip: find your LAN IP with `ipconfig getifaddr en0` (Mac Wi-Fi) or `ifconfig | grep inet`

## PWA on iPhone
Open the site in Safari → Share → Add to Home Screen. Works offline for reviewing and capturing answers; sync needs network.

## Profile code (multi-device)
The app auto-creates a short **profile code** (shown on the Daily page). On your iPhone, tap **Settings** and enter that same code to sync progress between devices (no login).

## Project structure
```
sa_reps/
  app.py
  requirements.txt
  seed_content.json
  templates/
    base.html
    index.html
    daily.html
    settings.html
  static/
    app.js
    styles.css
    manifest.webmanifest
    service-worker.js
    icons/
      icon-192.png
      icon-512.png
```

## Notes
- Spaced repetition can be added later. For MVP, daily items are sampled and locked per day.
- Data is local to your machine (SQLite). No external services.
