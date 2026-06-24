"""Background worker loop.

Pulls queued jobs, moves the required agents into the job's world (status
'moving' -> 'working'), runs them through the Hermes seam, then scores XP +
tokens and frees the agents. Optional autopilot keeps a gentle trickle of
jobs flowing so the HUD stays alive with no user input.

The adapter call (which blocks/sleeps) runs in a per-job thread so the tick
loop stays responsive and several jobs can run concurrently. The shared
state lock is only held for quick mutations, never across the adapter call.
"""

import os
import time
import random
import threading

import mock
import state
import scoring
import hermes_adapter

TICK = 1.0                       # seconds between worker ticks
AUTO_ENQUEUE_EVERY = (8.0, 16.0)  # random seconds between autopilot jobs
MAX_ACTIVE_JOBS = 3              # autopilot won't pile past this many open jobs

AUTOPILOT = os.getenv("AGENCY_AUTOPILOT", "1") != "0"

_thread = None


def start():
    global _thread
    if _thread is None:
        _thread = threading.Thread(target=_loop, daemon=True, name="agency-worker")
        _thread.start()


def _loop():
    next_auto = time.time() + random.uniform(*AUTO_ENQUEUE_EVERY)
    while True:
        try:
            tick()
            if AUTOPILOT and time.time() >= next_auto:
                _maybe_autopilot()
                next_auto = time.time() + random.uniform(*AUTO_ENQUEUE_EVERY)
        except Exception as exc:  # never let the loop die
            print("[worker] error:", exc)
        time.sleep(TICK)


def _pick_staff(world_id, n):
    """Pick n idle, unassigned agents to staff a job in `world_id` without
    breaking the co-location cap. Prefers agents already in the world (no
    occupancy change). Returns a list of agent dicts, or None if not possible.
    Call inside state.lock.
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
                job["agent_ids"] = [a["id"] for a in staff]
                job["status"] = "running"
                job["_started"] = False
                names = ", ".join(a["name"] for a in staff)
                state.log_event(
                    "start",
                    f'Deploying {names} -> {state.world_name(job["world"])} '
                    f'for "{job["title"]}"',
                )
            elif job["status"] == "running" and not job.get("_started"):
                # Agents moved in last tick; promote them to working and launch.
                for aid in job["agent_ids"]:
                    a = state.agents.get(aid)
                    if a:
                        a["status"] = "working"
                job["_started"] = True
                to_launch.append(job)
                state.log_event(
                    "working",
                    f'"{job["title"]}" running in {state.world_name(job["world"])}',
                )

    # Launch adapter calls OUTSIDE the lock — they block.
    for job in to_launch:
        threading.Thread(target=_process, args=(job,), daemon=True).start()


def _process(job):
    with state.lock:
        staffed = [state.agents[aid] for aid in job["agent_ids"]
                   if aid in state.agents]
        public_job = {
            "title": job["title"], "world": job["world"],
            "agents_required": job["agents_required"],
        }

    # === The seam. Blocks (mock: sleeps; live: HTTP). No lock held here. ===
    result = hermes_adapter.process_job(public_job, staffed)
    total = int(result["prompt_tokens"]) + int(result["completion_tokens"])

    with state.lock:
        now = time.time()
        job["tokens"] = total
        job["status"] = "done"
        job["finished_at"] = now
        state.session["session_tokens"] += total
        state.token_events.append((now, total))

        xp = scoring.job_xp(job["agents_required"], total)
        share = total // max(1, len(job["agent_ids"]))
        for aid in job["agent_ids"]:
            a = state.agents.get(aid)
            if not a:
                continue  # agent was removed mid-job
            a["xp"] += xp
            a["tokens_used"] += share
            a["status"] = "idle"
            a["current_job"] = None
        state.log_event(
            "done",
            f'"{job["title"]}" complete  ·  +{xp} XP each  ·  {total:,} tokens',
        )


def _maybe_autopilot():
    """Occasionally enqueue a mock job so the HUD keeps moving on its own."""
    with state.lock:
        active = sum(1 for j in state.jobs if j["status"] in ("queued", "running"))
        idle = [a for a in state.agents.values() if a["status"] == "idle"]
        if active >= MAX_ACTIVE_JOBS or len(idle) < 1:
            return
        world = random.choice(state.WORLD_IDS)
        required = random.randint(1, min(3, len(idle)))
        title = mock.random_job_title()
    state.enqueue(title, world, required)
