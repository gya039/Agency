"""In-memory store: worlds, agents, jobs, mission log, token accounting.

Thread-safe via a single re-entrant lock — the worker thread and Flask request
threads both go through it. This module owns the source of truth; the frontend
holds none of its own.
"""

import time
import random
import threading
import itertools

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
    """Append-only. Never mutate a past event."""
    mission_log.append({
        "id": next(_log_seq),
        "ts": time.time(),
        "kind": kind,
        "text": text,
    })


def init():
    """Seed the store so the HUD looks alive on first load."""
    with lock:
        for a in mock.seed_agents():
            agents[a["id"]] = a
        for j in mock.seed_jobs():
            j["id"] = next_job_id()
            jobs.append(j)
        log_event("system", "The Nexus online.")


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
        plural = "s" if agents_required > 1 else ""
        log_event("deploy", f'Job queued — "{job["title"]}" -> '
                            f'{world_name(world)} ({agents_required} agent{plural})')
        return {k: job[k] for k in
                ("id", "title", "world", "agents_required", "status", "tokens")}


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
            "current_world": world,
            "current_job": None,
            "xp": 0,
            "tokens_used": 0,
        }
        agents[agent["id"]] = agent
        log_event("agent_add", f'{agent["name"]} joined {world_name(world)}.')
        return {k: agent[k] for k in
                ("id", "name", "status", "current_world", "current_job", "xp", "tokens_used")}


def remove_agent(agent_id):
    with lock:
        agent = agents.pop(agent_id, None)
        if agent:
            log_event("agent_remove", f'{agent["name"]} left the arcade.')
        return agent is not None
