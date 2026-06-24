"""Fake data generator: original arcade cast, job titles, fake completions.

Seeds the in-memory store so the world looks fully alive on first load.
Real token counts come from hermes_adapter; this module only supplies the
flavor + the opening tableau.

The cast below is the ORIGINAL arcade universe (no third-party IP). Each cast
member is seeded into the backend world that the frontend maps onto their home
world (see frontend/src/universe.config.js WORLD_FROM_BACKEND):

    backend world id  ->  universe room
    sugar             ->  Sugar Circuit   (Pixie)
    hero              ->  Iron Vanguard   (Sergeant Vale)
    felix             ->  Mendwright Tower(Bricks)
    turbo             ->  Redline         (Nitro)
    tron              ->  Voltgrid        (Cypher)
    roadblast         ->  Dustbreak       (Rasa)
"""

import time
import random

# Original arcade names for any agents added at runtime (no third-party IP).
AGENT_NAMES = [
    "Sprocket", "Vector", "Pixel", "Bolt", "Dash", "Circuit", "Rom", "Byte",
    "Chip", "Neon", "Quartz", "Static", "Flux", "Pulse", "Ember", "Glitch",
]

JOB_TITLES = [
    "Summarize logs", "Triage incidents", "Draft release notes",
    "Classify tickets", "Refactor module", "Scan dependencies",
    "Generate test cases", "Compile metrics", "Review pull request",
    "Index documents", "Translate copy", "Audit permissions",
    "Cluster feedback", "Rank candidates", "Backfill captions",
]


def random_name(taken=()):
    """An original name not already in `taken`, falling back to a numbered one."""
    pool = [n for n in AGENT_NAMES if n not in taken]
    if pool:
        return random.choice(pool)
    return f"Unit-{random.randint(10, 99)}"


def random_job_title():
    return random.choice(JOB_TITLES)


def seed_agents():
    """The 6 original cast members, one per world — each in the backend world
    that the frontend maps onto their home room. All 6 worlds start populated."""
    seeds = [
        # id   name             backend world   xp     tokens_used
        ("a1", "Pixie",          "sugar",         540,  9800),
        ("a2", "Sergeant Vale",  "hero",          990, 16700),
        ("a3", "Bricks",         "felix",        1340, 21100),
        ("a4", "Nitro",          "turbo",         760, 12300),
        ("a5", "Cypher",         "tron",         1180, 18900),
        ("a6", "Rasa",           "roadblast",     610,  8800),
    ]
    return [
        {
            "id": aid, "name": name, "status": "idle",
            "current_world": world, "current_job": None,
            "xp": xp, "tokens_used": tokens,
        }
        for (aid, name, world, xp, tokens) in seeds
    ]


def seed_jobs():
    """A couple of jobs already queued so the worker pulls agents up
    immediately on first load — agents travel + flip to working right away."""
    now = time.time()
    return [
        {
            "title": "Triage incidents", "world": "hero", "agents_required": 2,
            "status": "queued", "tokens": 0,
            "created_at": now, "finished_at": None, "agent_ids": [],
        },
        {
            "title": "Scan dependencies", "world": "felix", "agents_required": 1,
            "status": "queued", "tokens": 0,
            "created_at": now, "finished_at": None, "agent_ids": [],
        },
    ]
