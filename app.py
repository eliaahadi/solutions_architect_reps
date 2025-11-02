import copy, json, os, sqlite3, secrets, datetime, random
from flask import Flask, request, Response, make_response, render_template, jsonify, redirect, url_for
import datetime as _dt
app = Flask(__name__)

# --- PATCH START --- add streak helpers + updated index + favicon ---

def _get_completed_days(profile_code):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT DISTINCT session_date FROM sessions WHERE profile_code=? AND completed=1", (profile_code,))
    rows = [r[0] for r in cur.fetchall()]
    days = set()
    for s in rows:
        try:
            days.add(_dt.date.fromisoformat(s))
        except Exception:
            pass
    return days

def compute_streaks(profile_code):
    """Return (current_streak, best_streak) based on completed sessions."""
    days = sorted(list(_get_completed_days(profile_code)))
    dayset = set(days)
    # current streak: count back from today
    cur = 0
    d = _dt.date.today()
    while d in dayset:
        cur += 1
        d = d - _dt.timedelta(days=1)
    # best streak: scan ascending
    best = 0
    run = 0
    prev = None
    for d in days:
        if prev is None or d == prev + _dt.timedelta(days=1):
            run += 1
        else:
            best = max(best, run)
            run = 1
        prev = d
    best = max(best, run)
    return cur, best

@app.route("/favicon.ico")
def favicon():
    # tiny 1x1 transparent gif to quiet 404s
    data = b'GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x01\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;'
    return Response(data, mimetype="image/gif")


# --- PATCH END ---

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(APP_DIR, "sa_reps.sqlite3")
SEED_PATH = os.path.join(APP_DIR, "seed_content.json")


def get_db():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""CREATE TABLE IF NOT EXISTS users (
        profile_code TEXT PRIMARY KEY,
        created_at TEXT
    )""")
    cur.execute("""CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_code TEXT,
        session_date TEXT,
        items_json TEXT,
        score INTEGER DEFAULT 0,
        completed INTEGER DEFAULT 0,
        UNIQUE(profile_code, session_date)
    )""")
    cur.execute("""CREATE TABLE IF NOT EXISTS attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER,
        item_id TEXT,
        item_type TEXT,
        correct INTEGER,
        response TEXT,
        created_at TEXT
    )""")
    conn.commit()

def load_seed():
    with open(SEED_PATH, "r") as f:
        return json.load(f)

SEED = load_seed()
init_db()

def today_str():
    return datetime.date.today().isoformat()

def get_or_create_user(profile_code=None):
    conn = get_db()
    cur = conn.cursor()
    if profile_code:
        # normalize
        profile_code = profile_code.strip().upper()
        cur.execute("SELECT profile_code FROM users WHERE profile_code=?", (profile_code,))
        row = cur.fetchone()
        if row is None:
            cur.execute("INSERT INTO users(profile_code, created_at) VALUES (?, ?)", (profile_code, datetime.datetime.utcnow().isoformat()))
            conn.commit()
        return profile_code
    # generate new
    code = secrets.token_hex(3).upper()
    cur.execute("INSERT INTO users(profile_code, created_at) VALUES (?, ?)", (code, datetime.datetime.utcnow().isoformat()))
    conn.commit()
    return code

def ensure_profile(resp=None):
    code = request.cookies.get("profile_code")
    if not code:
        code = get_or_create_user()
        resp = resp or make_response()
        resp.set_cookie("profile_code", code, max_age=60*60*24*365*5)  # 5 years
    return code, resp

def sample_daily_items():
    """Sample the 10 daily prompts, recycling items if the seed list is short."""
    used_ids = set()

    def _clone(item, label, force_new=False):
        clone = copy.deepcopy(item)
        base_id = (clone.get("id") or f"{label}-item").split("#")[0]
        new_id = base_id
        if force_new or new_id in used_ids:
            while True:
                new_id = f"{base_id}#{secrets.token_hex(2).upper()}"
                if new_id not in used_ids:
                    break
        clone["id"] = new_id
        clone["type"] = label
        used_ids.add(new_id)
        return clone

    def _take(key, count, label):
        pool = list(SEED.get(key) or [])
        picked = []
        if pool:
            take = min(count, len(pool))
            for item in random.sample(pool, k=take):
                picked.append(_clone(item, label))
            while len(picked) < count:
                picked.append(_clone(random.choice(pool), label, force_new=True))
        return picked

    items = []
    items.extend(_take("flashcards", 5, "flash"))
    items.extend(_take("tradeoffs", 3, "tradeoff"))
    items.extend(_take("whiteboard", 1, "whiteboard"))
    items.extend(_take("behavioral", 1, "behavioral"))

    if items:
        while len(items) < 10:
            source = random.choice(items)
            items.append(_clone(source, source["type"], force_new=True))
        return items

    # Fallback if the seed file is empty
    placeholder_seed = {
        "id": "fallback",
        "front": "Review an AWS architecture you know cold and explain it aloud.",
        "back": "Outline the goal, core services, data flow, scaling, and failure handling.",
    }
    return [_clone(placeholder_seed, "flash", force_new=True) for _ in range(10)]

def ensure_session(profile_code):
    conn = get_db()
    cur = conn.cursor()
    d = today_str()
    cur.execute("SELECT id, items_json, score, completed FROM sessions WHERE profile_code=? AND session_date=?", (profile_code, d))
    row = cur.fetchone()
    if row:
        data = dict(row)
        try:
            items = json.loads(data.get("items_json") or "[]")
        except Exception:
            items = []
        if not items:
            refreshed = sample_daily_items()
            data["items_json"] = json.dumps(refreshed)
            data["completed"] = 0
            data["score"] = 0
            cur.execute("UPDATE sessions SET items_json=?, completed=0, score=0 WHERE id=?", (data["items_json"], data["id"]))
            conn.commit()
        return dict(id=data["id"], items_json=data["items_json"], score=data["score"], completed=data["completed"])
    items = sample_daily_items()
    items_json = json.dumps(items)
    cur.execute("INSERT INTO sessions(profile_code, session_date, items_json, score, completed) VALUES (?, ?, ?, 0, 0)",
                (profile_code, d, items_json))
    conn.commit()
    cur.execute("SELECT id, items_json, score, completed FROM sessions WHERE profile_code=? AND session_date=?", (profile_code, d))
    row = cur.fetchone()
    return dict(id=row["id"], items_json=row["items_json"], score=row["score"], completed=row["completed"])

@app.route("/")
def index():
    resp = make_response(render_template("index.html"))
    code, resp = ensure_profile(resp)
    # Create response so we can attach the cookie if needed, then render with streaks
    # resp = make_response()
    # code, resp = ensure_profile(resp)
    cur_streak, best_streak = compute_streaks(code)
    html = render_template("index.html", streak_current=cur_streak, streak_best=best_streak)
    resp.set_data(html)
    return resp

@app.route("/settings", methods=["GET", "POST"])
def settings():
    if request.method == "POST":
        new_code = request.form.get("profile_code", "").strip().upper()
        if new_code:
            get_or_create_user(new_code)
            resp = make_response(redirect(url_for("index")))
            resp.set_cookie("profile_code", new_code, max_age=60*60*24*365*5)
            return resp
    current = request.cookies.get("profile_code", "")
    return render_template("settings.html", current=current)

@app.route("/daily")
def daily():
    resp = make_response()
    code, resp = ensure_profile(resp)
    session = ensure_session(code)
    items = json.loads(session["items_json"])
    return make_response(render_template("daily.html", items=json.dumps(items), session_id=session["id"], profile_code=code))

@app.route("/api/daily10")
def api_daily10():
    code, _ = ensure_profile()
    session = ensure_session(code)
    return jsonify(dict(session_id=session["id"], items=json.loads(session["items_json"]), score=session["score"], completed=bool(session["completed"])))

@app.route("/submit", methods=["POST"])
def submit():
    data = request.json or {}
    session_id = data.get("session_id")
    item_id = data.get("item_id")
    item_type = data.get("item_type")
    correct = int(data.get("correct") or 0)
    response_text = data.get("response") or ""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("INSERT INTO attempts(session_id, item_id, item_type, correct, response, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (session_id, item_id, item_type, correct, response_text, datetime.datetime.utcnow().isoformat()))
    # update score
    cur.execute("UPDATE sessions SET score = score + ? WHERE id=?", (correct, session_id))
    conn.commit()
    return jsonify({"ok": True})

@app.route("/complete", methods=["POST"])
def complete():
    data = request.json or {}
    session_id = data.get("session_id")
    conn = get_db()
    cur = conn.cursor()
    cur.execute("UPDATE sessions SET completed=1 WHERE id=?", (session_id,))
    conn.commit()
    return jsonify({"ok": True})

@app.route("/health")
def health():
    return jsonify({"ok": True})

# PWA files
@app.route("/manifest.webmanifest")
def manifest():
    return app.send_static_file("manifest.webmanifest")

@app.route("/service-worker.js")
def sw():
    resp = make_response(app.send_static_file("service-worker.js"))
    # Proper MIME for SW
    resp.headers["Content-Type"] = "application/javascript"
    return resp

@app.after_request
def add_headers(resp):
    # PWA + mobile friendly caching headers
    resp.headers["Cache-Control"] = "no-store"
    return resp

if __name__ == "__main__":
    # Allow external access on LAN for iPhone testing
    app.run(host="0.0.0.0", port=5000, debug=True)
