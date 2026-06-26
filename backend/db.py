"""SQLite ledger for Agency. ALL SQL lives here; state.py calls into it.

Tables
  agents         current-state row per agent (upserted; deleted on remove)
  jobs           one row per job (real OR ambient), upserted through its
                 lifecycle and kept forever -> full job history
  events         append-only mission-log
  agent_events   append-only XP/token award ledger (history is reconstructable)
  collaborations pair-collaboration counts, canonical a_id < b_id (upserted)
  meta           tiny key/value scratch

Append-only in spirit: events + agent_events are never updated; jobs rows are
never deleted (status field advances queued->running->done); agent mutable
fields are upserted to the current-state row while every earned XP/token also
appends an immutable agent_events row.
"""

import os
import json
import sqlite3
import threading

DB_PATH = os.path.join(os.path.dirname(__file__), "agency.db")

_conn = None
_lock = threading.Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS agents (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  home_world    TEXT,
  status        TEXT,
  current_world TEXT,
  current_job   TEXT,
  xp            INTEGER DEFAULT 0,
  tokens_used   INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS jobs (
  id              TEXT PRIMARY KEY,
  kind            TEXT DEFAULT 'job',
  title           TEXT,
  world           TEXT,
  agents_required INTEGER,
  status          TEXT,
  tokens          INTEGER DEFAULT 0,
  created_at      REAL,
  finished_at     REAL,
  agent_ids       TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  ts   REAL,
  kind TEXT,
  text TEXT
);
CREATE TABLE IF NOT EXISTS agent_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           REAL,
  agent_id     TEXT,
  job_id       TEXT,
  kind         TEXT,
  xp_delta     INTEGER,
  tokens_delta INTEGER
);
CREATE TABLE IF NOT EXISTS collaborations (
  a_id  TEXT,
  b_id  TEXT,
  count INTEGER DEFAULT 0,
  PRIMARY KEY (a_id, b_id)
);
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_agent_events_agent ON agent_events(agent_id);
"""


def init_db():
    global _conn
    with _lock:
        if _conn is None:
            _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
            _conn.row_factory = sqlite3.Row
            _conn.execute("PRAGMA journal_mode=WAL")
            _conn.execute("PRAGMA synchronous=NORMAL")
        _conn.executescript(SCHEMA)
        _conn.commit()


def is_empty():
    with _lock:
        return _conn.execute("SELECT COUNT(*) FROM agents").fetchone()[0] == 0


# --- writes ----------------------------------------------------------------

def upsert_agent(a):
    with _lock:
        _conn.execute(
            """INSERT INTO agents (id,name,home_world,status,current_world,current_job,xp,tokens_used)
               VALUES (:id,:name,:home_world,:status,:current_world,:current_job,:xp,:tokens_used)
               ON CONFLICT(id) DO UPDATE SET
                 name=excluded.name, home_world=excluded.home_world, status=excluded.status,
                 current_world=excluded.current_world, current_job=excluded.current_job,
                 xp=excluded.xp, tokens_used=excluded.tokens_used""",
            {
                "id": a["id"], "name": a["name"], "home_world": a.get("home_world"),
                "status": a["status"], "current_world": a["current_world"],
                "current_job": a.get("current_job"), "xp": a["xp"], "tokens_used": a["tokens_used"],
            },
        )
        _conn.commit()


def delete_agent(agent_id):
    with _lock:
        _conn.execute("DELETE FROM agents WHERE id=?", (agent_id,))
        _conn.commit()


def upsert_job(j):
    with _lock:
        _conn.execute(
            """INSERT INTO jobs (id,kind,title,world,agents_required,status,tokens,created_at,finished_at,agent_ids)
               VALUES (:id,:kind,:title,:world,:agents_required,:status,:tokens,:created_at,:finished_at,:agent_ids)
               ON CONFLICT(id) DO UPDATE SET
                 status=excluded.status, tokens=excluded.tokens, finished_at=excluded.finished_at,
                 agent_ids=excluded.agent_ids""",
            {
                "id": j["id"], "kind": j.get("kind", "job"), "title": j["title"],
                "world": j["world"], "agents_required": j["agents_required"],
                "status": j["status"], "tokens": j["tokens"],
                "created_at": j["created_at"], "finished_at": j.get("finished_at"),
                "agent_ids": json.dumps(j.get("agent_ids", [])),
            },
        )
        _conn.commit()


def append_event(ts, kind, text):
    with _lock:
        _conn.execute("INSERT INTO events (ts,kind,text) VALUES (?,?,?)", (ts, kind, text))
        _conn.commit()


def append_agent_event(ts, agent_id, job_id, kind, xp_delta, tokens_delta):
    with _lock:
        _conn.execute(
            "INSERT INTO agent_events (ts,agent_id,job_id,kind,xp_delta,tokens_delta) VALUES (?,?,?,?,?,?)",
            (ts, agent_id, job_id, kind, xp_delta, tokens_delta),
        )
        _conn.commit()


def bump_collab(a_id, b_id):
    """Increment the collaboration count for an unordered pair."""
    if a_id == b_id:
        return
    lo, hi = sorted((a_id, b_id))
    with _lock:
        _conn.execute(
            """INSERT INTO collaborations (a_id,b_id,count) VALUES (?,?,1)
               ON CONFLICT(a_id,b_id) DO UPDATE SET count=count+1""",
            (lo, hi),
        )
        _conn.commit()


# --- reads -----------------------------------------------------------------

def load_all():
    """Return everything needed to rebuild the in-memory store."""
    with _lock:
        agents = [dict(r) for r in _conn.execute("SELECT * FROM agents").fetchall()]
        jobs = [dict(r) for r in _conn.execute("SELECT * FROM jobs").fetchall()]
        events = [dict(r) for r in _conn.execute(
            "SELECT * FROM events ORDER BY id DESC LIMIT 200").fetchall()]
    for j in jobs:
        j["agent_ids"] = json.loads(j["agent_ids"] or "[]")
    events.reverse()  # back to chronological
    return {"agents": agents, "jobs": jobs, "events": events}


def get_agent(agent_id):
    with _lock:
        row = _conn.execute("SELECT * FROM agents WHERE id=?", (agent_id,)).fetchone()
        return dict(row) if row else None


def get_agent_jobs(agent_id, limit=12):
    """Jobs this agent participated in, most recent first."""
    with _lock:
        rows = _conn.execute(
            "SELECT * FROM jobs ORDER BY created_at DESC").fetchall()
    out = []
    for r in rows:
        ids = json.loads(r["agent_ids"] or "[]")
        if agent_id in ids:
            out.append({
                "id": r["id"], "kind": r["kind"], "title": r["title"], "world": r["world"],
                "status": r["status"], "tokens": r["tokens"],
                "agents_required": r["agents_required"], "finished_at": r["finished_at"],
            })
        if len(out) >= limit:
            break
    return out


def get_collaborators(agent_id, limit=8):
    """Top collaborators for an agent, as [{id, count}], most-collaborated first."""
    with _lock:
        rows = _conn.execute(
            """SELECT CASE WHEN a_id=? THEN b_id ELSE a_id END AS other, count
               FROM collaborations WHERE a_id=? OR b_id=?
               ORDER BY count DESC LIMIT ?""",
            (agent_id, agent_id, agent_id, limit),
        ).fetchall()
    return [{"id": r["other"], "count": r["count"]} for r in rows]
