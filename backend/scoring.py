"""Single source of truth for ALL xp / level / token math.

Tune the constants here. Nothing else in the codebase should compute
levels, XP awards, or throughput on its own — import from this module.
"""

BASE_XP = 50            # XP awarded to EACH participating agent, per job
XP_TOKEN_BONUS = 15     # extra XP per full 1k tokens processed (per agent)
XP_PER_LEVEL = 1000     # XP needed to advance one level

AMBIENT_BASE_XP = 12    # small shared XP per ambient co-work session (vs BASE_XP)
AMBIENT_TOKEN_BONUS = 3  # extra ambient XP per full 1k tokens

THROUGHPUT_WINDOW = 5.0  # seconds — rolling window used for tokens/sec


def job_xp(agents_required, tokens):
    """XP granted to each participating agent when a job completes.

    base_xp * agents_required, plus a small bonus per 1k tokens processed.
    """
    return BASE_XP * agents_required + (tokens // 1000) * XP_TOKEN_BONUS


def ambient_xp(tokens):
    """XP granted to each agent for a (smaller) ambient co-work session."""
    return AMBIENT_BASE_XP + (tokens // 1000) * AMBIENT_TOKEN_BONUS


def level_from_xp(total_xp):
    """Level is derived from total XP across all agents."""
    return total_xp // XP_PER_LEVEL + 1


def xp_into_level(total_xp):
    """How far into the current level (0 .. XP_PER_LEVEL - 1)."""
    return total_xp % XP_PER_LEVEL


def tokens_per_sec(token_events, now):
    """Rolling throughput.

    token_events: list of (timestamp, tokens) tuples.
    Returns a rounded tokens/second over the last THROUGHPUT_WINDOW seconds.
    """
    window_start = now - THROUGHPUT_WINDOW
    recent = sum(t for ts, t in token_events if ts >= window_start)
    return round(recent / THROUGHPUT_WINDOW)
