from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import sqlite3
from datetime import datetime, timedelta

app = FastAPI()

def _db_path():
    return "data.db"

def _connect():
    # allow usage across FastAPI worker threads
    conn = sqlite3.connect(_db_path(), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

class SessionCompletePayload(BaseModel):
    profile_code: str
    correct: int
    total: int
    duration_sec: int
    tz_offset_min: int = 0

@app.post("/api/session/complete")
async def api_session_complete(payload: SessionCompletePayload):
    code = (payload.profile_code or "").strip()
    correct = int(payload.correct)
    total = int(payload.total)
    duration = int(payload.duration_sec)
    tz_off = int(payload.tz_offset_min or 0)

    if not code:
        return JSONResponse({"error": "Missing profile_code"}, status_code=400)
    if total <= 0 or correct < 0 or correct > total:
        return JSONResponse({"error": "Bad result payload"}, status_code=400)

    utc_now = datetime.utcnow()
    local_now = utc_now - timedelta(minutes=tz_off)
    local_date = local_now.date().isoformat()

    pid = _get_or_create_profile(code)
    conn = _connect()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO session(profile_id, local_date, correct, total, duration_sec, created_at) VALUES(?,?,?,?,?,?)",
        (pid, local_date, correct, total, duration, utc_now.isoformat() + "Z")
    )
    conn.commit()
    conn.close()

    body = {"ok": True, "saved_local_date": local_date, **_stats(pid, local_now.date())}
    return JSONResponse(body, status_code=200)

@app.get("/api/stats")
async def api_stats(profile_code: str, tz_offset_min: int = 0):
    code = (profile_code or "").strip()
    if not code:
        return JSONResponse({"error": "Missing profile_code"}, status_code=400)
    tz_off = int(tz_offset_min or 0)
    utc_now = datetime.utcnow()
    local_now = utc_now - timedelta(minutes=tz_off)
    pid = _get_or_create_profile(code)
    body = _stats(pid, local_now.date())
    return JSONResponse(body, status_code=200)
