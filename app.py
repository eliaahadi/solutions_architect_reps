import json, os, sqlite3, secrets, datetime, random
from flask import Flask, request, make_response, render_template, jsonify, redirect, url_for

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(APP_DIR, "sa_reps.sqlite3")
SEED_PATH = os.path.join(APP_DIR, "seed_content.json")

app = Flask(__name__)

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
    # 5 flashcards, 3 tradeoffs, 1 whiteboard, 1 behavioral
    f = random.sample(SEED["flashcards"], k=min(5, len(SEED["flashcards"])))
    t = random.sample(SEED["tradeoffs"], k=min(3, len(SEED["tradeoffs"])))
    w = random.sample(SEED["whiteboard"], k=1)
    b = random.sample(SEED["behavioral"], k=1)
    # annotate type for rendering
    for x in f: x["type"] = "flash"
    for x in t: x["type"] = "tradeoff"
    for x in w: x["type"] = "whiteboard"
    for x in b: x["type"] = "behavioral"
    return f + t + w + b

def ensure_session(profile_code):
    conn = get_db()
    cur = conn.cursor()
    d = today_str()
    cur.execute("SELECT id, items_json, score, completed FROM sessions WHERE profile_code=? AND session_date=?", (profile_code, d))
    row = cur.fetchone()
    if row:
        return dict(id=row["id"], items_json=row["items_json"], score=row["score"], completed=row["completed"])
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
