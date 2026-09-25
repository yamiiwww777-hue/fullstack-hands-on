"""
Flappy Bird backend API.

Responsibilities (maps to the user stories in the repo's game design doc):
- US-18 High Score:           GET  /api/highscore
- US-19 New High Score:       POST /api/scores  -> tells the client if it's a new record
- US-50 Leaderboard:          GET  /api/scores
- US-45 Reset High Score:     DELETE /api/scores

Scores are persisted to a small JSON file on disk (mounted as a docker
volume in docker-compose.yml) so the high score survives container restarts.
"""

import json
import os
import threading
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

DATA_FILE = os.environ.get("DATA_FILE", "/app/data/scores.json")
MAX_LEADERBOARD_SIZE = 50
_lock = threading.Lock()

app = FastAPI(title="Flappy Bird API", version="1.0.0")

# Allow the frontend (served from a different origin/port) to call this API.
origins = os.environ.get("CORS_ORIGINS", "*")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if origins == "*" else origins.split(","),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ScoreIn(BaseModel):
    name: str = Field(default="Player", max_length=20)
    score: int = Field(ge=0)
    difficulty: str = Field(default="medium")


class ScoreOut(BaseModel):
    name: str
    score: int
    difficulty: str
    created_at: str


def _ensure_data_file() -> None:
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    if not os.path.exists(DATA_FILE):
        with open(DATA_FILE, "w") as f:
            json.dump({"scores": []}, f)


def _read_scores() -> List[dict]:
    _ensure_data_file()
    try:
        with open(DATA_FILE, "r") as f:
            data = json.load(f)
            return data.get("scores", [])
    except (json.JSONDecodeError, FileNotFoundError):
        return []


def _write_scores(scores: List[dict]) -> None:
    _ensure_data_file()
    with open(DATA_FILE, "w") as f:
        json.dump({"scores": scores}, f)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/highscore")
def get_highscore():
    scores = _read_scores()
    top = max((s["score"] for s in scores), default=0)
    return {"high_score": top}


@app.get("/api/scores", response_model=List[ScoreOut])
def get_leaderboard(limit: int = 10):
    scores = _read_scores()
    ranked = sorted(scores, key=lambda s: s["score"], reverse=True)
    return ranked[: max(1, min(limit, MAX_LEADERBOARD_SIZE))]


@app.post("/api/scores")
def submit_score(payload: ScoreIn):
    with _lock:
        scores = _read_scores()
        previous_high = max((s["score"] for s in scores), default=0)
        is_new_high_score = payload.score > previous_high

        entry = {
            "name": (payload.name or "Player").strip()[:20] or "Player",
            "score": payload.score,
            "difficulty": payload.difficulty,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        scores.append(entry)
        # keep the file small: only retain the best MAX_LEADERBOARD_SIZE entries
        scores = sorted(scores, key=lambda s: s["score"], reverse=True)[:MAX_LEADERBOARD_SIZE]
        _write_scores(scores)

    return {
        "accepted": entry,
        "is_new_high_score": is_new_high_score,
        "high_score": max(previous_high, payload.score),
        "leaderboard": scores[:10],
    }


@app.delete("/api/scores")
def reset_scores():
    """US-45: let a player wipe the saved high score / leaderboard."""
    with _lock:
        _write_scores([])
    return {"high_score": 0, "leaderboard": []}
