"""Background worker loop.

Two drivers keep the floor alive:
  1. Jobs (user + autopilot): when a job needs N agents they converge on its
     room, co-work through the Hermes seam, earn XP/tokens, then free up.
  2. Ambient life: between jobs, idle agents wander between worlds (drifting
     toward home) and occasionally cluster for a short ambient co-work session
     (a smaller, agent-initiated collaboration that still earns a little XP).

Every co-work (job OR ambient) records pair-collaboration counts. All state
mutations write through to the SQLite ledger (db.py via state.py) so the world
survives restarts.

Adapter/co-work processing runs in a per-session thread so the tick loop stays
responsive; the shared state lock is only held for quick mutations.
"""

import os
import time
import random
import threading

import db
import mock
import state
import scoring
import hermes_adapter

TICK = 1.0                        # seconds between worker ticks
AUTO_ENQUEUE_EVERY = (8.0, 16.0)  # random seconds between autopilot jobs
MAX_ACTIVE_JOBS = 3               # autopilot won't pile past this many open jobs

AUTOPILOT = os.getenv("AGENCY_AUTOPILOT", "1") != "0"

# --- Ambient world simulation tuning -------------------------------------
# Dial the floor's busyness here. Visual travel SPEED (the tween duration) lives
# in frontend/src/game/Agent.js; these govern backend frequency + timing.
SIM = {
    "roam_chance": 0.10,         # per idle agent per tick: chance to wander off
    "home_drift_bias": 0.45,     # of wanders, fraction heading toward home_world
    "move_time": (1.0, 1.8),     # seconds an agent spends 'moving' before arrival
    "collab_every": (7.0, 15.0), # seconds between ambient collab attempts
    "collab_size": (2, 3),       # agents per ambient session
    "collab_duration": (4.0, 8.0),  # seconds an ambient session lasts
    "ambient_tokens": (60, 240), # token usage for an ambient session
    "persist_every": 6.0,        # seconds between full agent-position snapshots
}

_thread = None


def start():
    global _thread
    if _thread is None:
        _thread = threading.Thread(target=_loop, daemon=True, name="agency-worker")
        _thread.start()


def _loop():
    now = time.time()
    next_auto = now + random.uniform(*AUTO_ENQUEUE_EVERY)
    next_collab = now + random.uniform(*SIM["collab_every"])
    next_persist = now + SIM["persist_every"]
    while True:
        try:
            now = time.time()
            tick()
            with state.lock:
                _ambient_movement(now)
            if AUTOPILOT and now >= next_auto:
                _maybe_autopilot()
                next_auto = now + random.uniform(*AUTO_ENQUEUE_EVERY)
            if now >= next_collab:
                _maybe_ambient_collab()
                next_collab = now + random.uniform(*SIM["collab_every"])
            if now >= next_persist:
                _persist_positions()
                next_persist = now + SIM["persist_every"]
        except Exception as exc:  # never let the loop die
            print("[worker] error:", exc)
        time.sleep(TICK)


def _pick_staff(world_id, n):
    """Pick n idle, unassigned agents to staff a session in `world_id` without
    breaking the co-location cap. Prefers agents already there. Returns a list
    of agent dicts, or None if not possible. Call inside state.lock.
    """
    occupancy = len(state.world_roster(world_id))
    idle_here = [a for a in state.agents.values()
                 if a["current_world"] == world_id and a["status"] == "idle"
                 and a["current_job"] is None]
    idle_elsewhere = [a for a in state.agents.values()
                      if a["current_world"] != world_id and a["status"] == "idle"
                      and a["current_job"] is None]

    chosen = []
    for a in idle_here:
        if len(chosen) >= n:
            break
        chosen.append(a)

    incoming = 0
    for a in idle_elsewhere:
        if len(chosen) >= n:
            break
        if occupancy + incoming + 1 > state.MAX_PER_WORLD:
            break  # would overflow the world
        chosen.append(a)
        incoming += 1

    return chosen if len(chosen) >= n else None


def tick():
    to_launch = []
    with state.lock:
        for job in state.jobs:
            if job["status"] == "queued":
                staff = _pick_staff(job["world"], job["agents_required"])
                if not staff:
                    continue  # not enough free agents / no room — wait
                for a in staff:
                    a["status"] = "moving"
                    a["current_world"] = job["world"]
                    a["current_job"] = job["id"]
                    a["_arrive_at"] = None  # job movement is promoted by the tick, not the timer
                job["agent_ids"] = [a["id"] for a in staff]
                job["status"] = "running"
                job["_started"] = False
                db.upsert_job(job)
                verb = "Gathering" if job.get("kind") == "ambient" else "Deploying"
                names = ", ".join(a["name"] for a in staff)
                state.log_event(
                    "start",
                    f'{verb} {names} -> {state.world_name(job["world"])} '
                    f'for "{job["title"]}"',
                )
            elif job["status"] == "running" and not job.get("_started"):
                for aid in job["agent_ids"]:
                    a = state.agents.get(aid)
                    if a:
                        a["status"] = "working"
                job["_started"] = True
                to_launch.append(job)
                kind_word = "co-working" if job.get("kind") == "ambient" else "running"
                state.log_event(
                    "working",
                    f'"{job["title"]}" {kind_word} in {state.world_name(job["world"])}',
                )

    # Process sessions OUTSIDE the lock — they block (sleep / HTTP).
    for job in to_launch:
        threading.Thread(target=_process, args=(job,), daemon=True).start()


def _process(job):
    ambient = job.get("kind") == "ambient"
    with state.lock:
        staffed = [state.agents[aid] for aid in job["agent_ids"]
                   if aid in state.agents]
        public_job = {"title": job["title"], "world": job["world"],
                      "agents_required": job["agents_required"]}

    if ambient:
        # Agents just hanging out — no inference, gentle reward.
        time.sleep(random.uniform(*SIM["collab_duration"]))
        total = random.randint(*SIM["ambient_tokens"])
        xp = scoring.ambient_xp(total)
    else:
        # === The Hermes seam. Blocks. No lock held here. ===
        result = hermes_adapter.process_job(public_job, staffed)
        total = int(result["prompt_tokens"]) + int(result["completion_tokens"])
        xp = scoring.job_xp(job["agents_required"], total)

    with state.lock:
        now = time.time()
        job["tokens"] = total
        job["status"] = "done"
        job["finished_at"] = now
        state.session["session_tokens"] += total
        state.token_events.append((now, total))

        share = total // max(1, len(job["agent_ids"]))
        for aid in job["agent_ids"]:
            a = state.agents.get(aid)
            if not a:
                continue  # agent was removed mid-session
            a["xp"] += xp
            a["tokens_used"] += share
            a["status"] = "idle"
            a["current_job"] = None
            db.upsert_agent(a)
            state.record_award(aid, job["id"], job.get("kind", "job"), xp, share)

        state.record_collab(job["agent_ids"])  # every co-work counts as collaboration
        db.upsert_job(job)

        if ambient:
            state.log_event("done", f'"{job["title"]}" wrapped  ·  +{xp} XP each')
        else:
            state.log_event("done", f'"{job["title"]}" complete  ·  +{xp} XP each  ·  {total:,} tokens')


def _maybe_autopilot():
    """Occasionally enqueue a mock job so the world keeps moving on its own."""
    with state.lock:
        active = sum(1 for j in state.jobs if j["status"] in ("queued", "running"))
        idle = [a for a in state.agents.values() if a["status"] == "idle"]
        if active >= MAX_ACTIVE_JOBS or len(idle) < 1:
            return
        world = random.choice(state.WORLD_IDS)
        required = random.randint(1, min(3, len(idle)))
        title = mock.random_job_title()
    state.enqueue(title, world, required)


# --- Part C: ambient roaming + collaboration --------------------------------

def _capacity(world_id):
    return state.MAX_PER_WORLD - len(state.world_roster(world_id))


def _ambient_movement(now):
    """Promote arrived roamers to idle, then let idle agents wander. Lock held."""
    moved = []
    for a in state.agents.values():
        # Arrival: a roaming agent reaches its destination and settles.
        if (a["status"] == "moving" and a["current_job"] is None
                and a.get("_arrive_at") and now >= a["_arrive_at"]):
            a["status"] = "idle"
            a["_arrive_at"] = None
            moved.append(a)
            continue
        # Wander: an idle, unassigned agent occasionally drifts to another world.
        if a["status"] == "idle" and a["current_job"] is None and random.random() < SIM["roam_chance"]:
            target = _wander_target(a)
            if target and target != a["current_world"]:
                a["status"] = "moving"
                a["current_world"] = target
                a["_arrive_at"] = now + random.uniform(*SIM["move_time"])
    for a in moved:
        db.upsert_agent(a)  # persist settled position


def _wander_target(agent):
    """Pick a world to drift to: often home, otherwise a random world with room."""
    home = agent.get("home_world")
    if (home and home != agent["current_world"]
            and random.random() < SIM["home_drift_bias"] and _capacity(home) > 0):
        return home
    options = [w for w in state.WORLD_IDS
               if w != agent["current_world"] and _capacity(w) > 0]
    return random.choice(options) if options else None


def _maybe_ambient_collab():
    """A few idle agents decide to cluster for a short ambient co-work session."""
    with state.lock:
        idle = [a for a in state.agents.values()
                if a["status"] == "idle" and a["current_job"] is None]
        if len(idle) < SIM["collab_size"][0]:
            return
        size = random.randint(SIM["collab_size"][0], min(SIM["collab_size"][1], len(idle)))
        # Choose a host world that can hold the cluster (prefer where idlers already are).
        worlds = [w for w in state.WORLD_IDS if _capacity(w) >= 1]
        if not worlds:
            return
        world = random.choice(worlds)
        title = mock.random_ambient_title()
    # enqueue_ambient takes its own lock; the tick will staff + run it.
    state.enqueue_ambient(world, size, title)


def _persist_positions():
    """Periodic snapshot of agent positions/state so roaming survives restart."""
    with state.lock:
        snapshot = list(state.agents.values())
    for a in snapshot:
        db.upsert_agent(a)
