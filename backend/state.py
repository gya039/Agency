"""In-memory store: worlds, agents, jobs, mission log, token accounting.

Thread-safe via a single re-entrant lock — the worker thread and Flask request
threads both go through it. This module owns the source of truth; the frontend
holds none of its own.
"""

import time
import random
import threading
import itertools

import db
import mock
import scoring

lock = threading.RLock()

# --- Worlds: 6, fixed. Ids are stable keys; display names are the original
# arcade universe (mirrors frontend/src/universe.config.js so mission-log text
# carries no third-party names). ------------------------------------------
WORLDS = [
    {"id": "sugar",     "name": "Sugar Circuit",    "accent": "pink"},
    {"id": "hero",      "name": "Iron Vanguard",    "accent": "teal"},
    {"id": "felix",     "name": "Mendwright Tower", "accent": "purple"},
    {"id": "turbo",     "name": "Redline",          "accent": "coral"},
    {"id": "tron",      "name": "Voltgrid",         "accent": "blue"},
    {"id": "roadblast", "name": "Dustbreak",        "accent": "amber"},
]
WORLD_IDS = [w["id"] for w in WORLDS]
MAX_PER_WORLD = 5   # co-location cap (NOT ownership) — max agents in a world

# --- Mutable state ---------------------------------------------------------
agents = {}          # id -> agent dict
jobs = []            # append-only ledger of job dicts
mission_log = []     # append-only event list — never mutate past events
token_events = []    # (ts, tokens) tuples, pruned, for rolling throughput
session = {"start": time.time(), "session_tokens": 0}

_agent_seq = itertools.count(100)   # new agents -> a100, a101, ... (seeds use a1..a8)
_job_seq = itertools.count(100)
_log_seq = itertools.count(1)


def next_agent_id():
    return f"a{next(_agent_seq)}"


def next_job_id():
    return f"j{next(_job_seq)}"


def world_name(wid):
    for w in WORLDS:
        if w["id"] == wid:
            return w["name"]
    return wid


def world_roster(world_id):
    """All agent ids currently located in this world (any status)."""
    return [a["id"] for a in agents.values() if a["current_world"] == world_id]


def log_event(kind, text):
    """Append-only. Mirrored to the DB ledger. Never mutate a past event."""
    ev = {"id": next(_log_seq), "ts": time.time(), "kind": kind, "text": text}
    mission_log.append(ev)
    db.append_event(ev["ts"], kind, text)


def record_award(agent_id, job_id, kind, xp_delta, tokens_delta):
    """Append an immutable XP/token award to the ledger (reconstructable history)."""
    db.append_agent_event(time.time(), agent_id, job_id, kind, xp_delta, tokens_delta)


def record_collab(agent_ids):
    """Bump the pair-collaboration count for every pair among participants."""
    ids = list(agent_ids)
    for i in range(len(ids)):
        for k in range(i + 1, len(ids)):
            db.bump_collab(ids[i], ids[k])


def _resync_id_counters():
    """Continue id sequences past anything already persisted."""
    global _agent_seq, _job_seq

    def _max_suffix(ids, prefix):
        nums = [int(i[len(prefix):]) for i in ids
                if i.startswith(prefix) and i[len(prefix):].isdigit()]
        return max(nums) if nums else 99

    _agent_seq = itertools.count(_max_suffix(list(agents.keys()), "a") + 1)
    _job_seq = itertools.count(_max_suffix([j["id"] for j in jobs], "j") + 1)


def init():
    """Load persisted state if present; otherwise seed from mock and persist it."""
    db.init_db()
    with lock:
        if db.is_empty():
            _seed_and_persist()
        else:
            _load_from_db()
        log_event("system", "The Nexus online.")


def _seed_and_persist():
    for a in mock.seed_agents():
        agents[a["id"]] = a
        db.upsert_agent(a)
    for j in mock.seed_jobs():
        j["id"] = next_job_id()
        j.setdefault("kind", "job")
        jobs.append(j)
        db.upsert_job(j)


def _load_from_db():
    """Rebuild the in-memory store from the DB, normalizing in-flight state."""
    data = db.load_all()
    for a in data["agents"]:
        # No work survives a restart: park everyone idle where they were.
        a["status"] = "idle"
        a["current_job"] = None
        a.setdefault("home_world", a["current_world"])
        agents[a["id"]] = a
    for j in data["jobs"]:
        if j["status"] == "running":
            j["status"] = "done"
            if not j.get("finished_at"):
                j["finished_at"] = time.time()
            db.upsert_job(j)
        j.setdefault("kind", "job")
        jobs.append(j)
    for ev in data["events"]:
        mission_log.append({"id": next(_log_seq), "ts": ev["ts"],
                            "kind": ev["kind"], "text": ev["text"]})
    _resync_id_counters()


# --- Snapshots (read paths for the routes) ---------------------------------

def snapshot_state():
    with lock:
        total_xp = sum(a["xp"] for a in agents.values())
        worlds_out = []
        active_worlds = 0
        for w in WORLDS:
            roster = sorted(world_roster(w["id"]))
            if roster:
                active_worlds += 1
            worlds_out.append({**w, "agent_ids": roster})

        agents_out = [
            {
                "id": a["id"], "name": a["name"], "status": a["status"],
                "current_world": a["current_world"], "current_job": a["current_job"],
                "xp": a["xp"], "tokens_used": a["tokens_used"],
            }
            for a in sorted(agents.values(), key=lambda x: x["id"])
        ]

        # Newest jobs first, capped — the contract shape, not the whole ledger.
        recent_jobs = sorted(jobs, key=lambda j: j["created_at"], reverse=True)[:25]
        jobs_out = [
            {
                "id": j["id"], "title": j["title"], "world": j["world"],
                "agents_required": j["agents_required"], "status": j["status"],
                "tokens": j["tokens"],
            }
            for j in recent_jobs
        ]

        n_agents = len(agents)
        return {
            "level": scoring.level_from_xp(total_xp),
            "total_xp": total_xp,
            "xp_into_level": scoring.xp_into_level(total_xp),
            "xp_per_level": scoring.XP_PER_LEVEL,
            "worlds": worlds_out,
            "agents": agents_out,
            "jobs": jobs_out,
            "totals": {
                "agents": n_agents,
                "active_worlds": active_worlds,
                "open_slots": len(WORLDS) * MAX_PER_WORLD - n_agents,
            },
        }


def snapshot_usage():
    global token_events
    with lock:
        now = time.time()
        token_events = [(ts, t) for ts, t in token_events if ts >= now - 60]
        return {
            "session_tokens": session["session_tokens"],
            "tokens_per_sec": scoring.tokens_per_sec(token_events, now),
            "cost_usd": None,  # populated by a hosted API later; null for now
            "per_agent": {a["id"]: a["tokens_used"] for a in agents.values()},
        }


def snapshot_log(limit=60):
    with lock:
        return list(reversed(mission_log[-limit:]))  # newest first


# --- Mutations (write paths) -----------------------------------------------

def enqueue(title, world, agents_required):
    with lock:
        if world not in WORLD_IDS:
            raise ValueError(f"unknown world: {world!r}")
        agents_required = max(1, min(3, int(agents_required)))
        job = {
            "id": next_job_id(),
            "kind": "job",
            "title": (title or "").strip() or "Untitled job",
            "world": world,
            "agents_required": agents_required,
            "status": "queued",
            "tokens": 0,
            "created_at": time.time(),
            "finished_at": None,
            "agent_ids": [],
        }
        jobs.append(job)
        db.upsert_job(job)
        plural = "s" if agents_required > 1 else ""
        log_event("deploy", f'Job queued — "{job["title"]}" -> '
                            f'{world_name(world)} ({agents_required} agent{plural})')
        return {k: job[k] for k in
                ("id", "title", "world", "agents_required", "status", "tokens")}


def enqueue_ambient(world, agents_required, title):
    """Queue an ambient co-work session (agents choosing to collaborate).
    Same job pipeline as real jobs, but flagged 'ambient' with gentler rewards."""
    with lock:
        job = {
            "id": next_job_id(),
            "kind": "ambient",
            "title": title,
            "world": world,
            "agents_required": agents_required,
            "status": "queued",
            "tokens": 0,
            "created_at": time.time(),
            "finished_at": None,
            "agent_ids": [],
        }
        jobs.append(job)
        db.upsert_job(job)
        log_event("collab", f'{title} forming in {world_name(world)} '
                            f'({agents_required} agents)')
        return job


def add_agent(name=None, world=None):
    with lock:
        # Place into the requested world if it has room, else any world with room.
        if world not in WORLD_IDS or len(world_roster(world)) >= MAX_PER_WORLD:
            candidates = [w for w in WORLD_IDS if len(world_roster(w)) < MAX_PER_WORLD]
            world = random.choice(candidates) if candidates else random.choice(WORLD_IDS)
        agent = {
            "id": next_agent_id(),
            "name": name or mock.random_name(taken=[a["name"] for a in agents.values()]),
            "status": "idle",
            "home_world": world,
            "current_world": world,
            "current_job": None,
            "xp": 0,
            "tokens_used": 0,
        }
        agents[agent["id"]] = agent
        db.upsert_agent(agent)
        log_event("agent_add", f'{agent["name"]} joined {world_name(world)}.')
        return {k: agent[k] for k in
                ("id", "name", "status", "current_world", "current_job", "xp", "tokens_used")}


def remove_agent(agent_id):
    with lock:
        agent = agents.pop(agent_id, None)
        if agent:
            db.delete_agent(agent_id)
            log_event("agent_remove", f'{agent["name"]} left the arcade.')
        return agent is not None


# --- Part B read helpers ---------------------------------------------------

def agent_detail(agent_id):
    """Live agent fields + persisted job history + top collaborators."""
    with lock:
        a = agents.get(agent_id)
        live = dict(a) if a else None
    if live is None:
        return None
    collaborators = db.get_collaborators(agent_id)
    name_of = {x["id"]: x["name"] for x in agents.values()}
    for c in collaborators:
        c["name"] = name_of.get(c["id"], c["id"])
    return {
        "id": live["id"], "name": live["name"], "home_world": live.get("home_world"),
        "status": live["status"], "current_world": live["current_world"],
        "current_job": live.get("current_job"), "xp": live["xp"],
        "tokens_used": live["tokens_used"],
        "history": db.get_agent_jobs(agent_id),
        "collaborators": collaborators,
    }


def snapshot_queue():
    """Active jobs (queued + running) in queue order."""
    with lock:
        active = [j for j in jobs if j["status"] in ("queued", "running")]
        active.sort(key=lambda j: j["created_at"])
        return [
            {"id": j["id"], "kind": j.get("kind", "job"), "title": j["title"],
             "world": j["world"], "agents_required": j["agents_required"],
             "status": j["status"], "agent_ids": j.get("agent_ids", [])}
            for j in active
        ]
