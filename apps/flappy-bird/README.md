# Flappy Byte

A Flappy Bird style browser game built to match the repo's `app-template` layout:
a Python/FastAPI **backend** (high scores + leaderboard) and a JS **frontend**
(the playable game), linked together and orchestrated with `docker-compose.yml`.

```
flappy-bird/
├── docker-compose.yml   # runs backend + frontend together
├── backend/             # FastAPI API (Python)
│   ├── Dockerfile
│   ├── requirements.txt
│   └── src/
│       ├── __init__.py
│       └── main.py
└── frontend/             # Static game served by a tiny Express server (Node)
    ├── Dockerfile
    ├── package.json
    ├── server.js
    └── src/
        ├── index.html
        ├── style.css
        └── game.js
```

## Run it

```bash
docker compose up --build
```

Then open **http://localhost:3000** in your browser and play. Tap the canvas
(or press <kbd>Space</kbd>) to flap.

The backend API is exposed on **http://localhost:8000** (e.g.
`GET /api/highscore`, `GET /api/scores`, `POST /api/scores`, `DELETE /api/scores`).

## How frontend and backend are linked

- `docker-compose.yml` sets `API_BASE_URL=http://localhost:8000` as an env var
  on the `frontend` service.
- `frontend/server.js` serves a small `/config.js` file that writes that URL
  into `window.API_BASE_URL` for the browser.
- `frontend/src/game.js` reads `window.API_BASE_URL` and calls the backend
  directly from the browser to fetch/save high scores and the leaderboard.
- If the backend is unreachable, the game still plays fine and falls back to
  a high score stored in `localStorage`, so it never blocks gameplay.

Because the browser (not the frontend container) talks to the backend, the
URL must be one your browser can reach — `localhost:8000` works for local
`docker compose up`. If you deploy this remotely, change `API_BASE_URL` to
the backend's public address.

## User stories implemented

Almost all 50 stories in the design doc are covered:

- **Player & Game Start** — one-tap start, restart, main menu, pause/resume.
- **Bird Controls** — tap-to-flap, gravity, smooth movement, animated wing, tilt/rotation.
- **Obstacles** — continuously spawning pipes, random gap height, gap to fly through,
  pipes move left, speed ramps up the longer a run lasts.
- **Scoring** — point per pipe cleared, live score display, persisted high score,
  "new high score" banner, score resets each run.
- **Collision & Game Over** — pipe/ground collision ends the run, Game Over screen,
  final score display, instant Retry.
- **Background & Environment** — scrolling gradient sky, drifting clouds, day/night
  toggle, scrolling ground, synthesized sound effects (flap/score/crash — no external
  audio files needed, so the game works fully offline in the container).
- **Difficulty** — Easy / Medium / Hard modes, endless play, gradual speed increase.
- **Settings** — sound toggle, music toggle, vibration toggle, reset high score.
  (Language selection was left as a stub — see "Not implemented" below.)
- **Accessibility & UI** — first-run tutorial screen, 3‑2‑1 countdown, responsive
  canvas that fits any screen size, share-score button, leaderboard (top 5, backed
  by the API).

### Not implemented (out of scope for this pass)

Coins, unlockable bird skins/backgrounds, daily rewards, achievement badges, and
multi-language UI (US‑31–35, US‑43) are gameplay-economy features that need real
art assets and a bigger data model than a game-jam-sized backend. The current
backend/leaderboard design (`ScoreIn`/`ScoreOut` in `backend/src/main.py`) can be
extended with a `players` table if you want to build these next.

## Notes

- Scores persist to a JSON file on a docker volume (`backend_data`), so your
  high score survives `docker compose down` / restarts — only `docker compose
  down -v` wipes it.
- All game art is drawn with the Canvas API (no image/audio assets to fetch),
  so the container works without any external network access at runtime.
