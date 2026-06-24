# === HERMES SEAM ===
# Right now: returns a fake completion + fake token counts after a short delay.
# LATER: replace the body of the LIVE branch in process_job() with a real HTTP
# call to the inference server (Ollama / vLLM / LM Studio / hosted API). Read the
# endpoint + API key from environment (.env), NEVER hardcode. The function
# signature and return shape MUST stay identical so nothing upstream changes.
#
# This is the ONLY place engine concerns are allowed to live. Do not let any
# of this leak into app.py routing or into the frontend.

import os
import time
import random


def process_job(job, agents):
    """Process one job with the given agents.

    Returns: {'text': str, 'prompt_tokens': int, 'completion_tokens': int}

    `job` is a plain dict (at least {'title', 'world', 'agents_required'}).
    `agents` is a list of agent dicts. The mock path ignores them; the live
    path may use them to shape the prompt (e.g. multi-agent collaboration).
    """
    mode = os.getenv("HERMES_MODE", "mock")  # 'mock' | 'live'

    if mode == "mock":
        # Simulate inference latency so jobs complete on a staggered timeline.
        time.sleep(random.uniform(1.5, 4.0))
        prompt_tokens = random.randint(200, 900)
        completion_tokens = random.randint(150, 1200)
        return {
            "text": f"[mock result for: {job['title']}]",
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
        }

    # --- LIVE path (fill in later) ----------------------------------------
    # endpoint = os.environ["HERMES_ENDPOINT"]
    # key = os.environ.get("HERMES_API_KEY")
    # Build an OpenAI-compatible chat request from `job` (+ optionally `agents`),
    # POST it to {endpoint}/v1/chat/completions, then read usage.prompt_tokens
    # and usage.completion_tokens straight off the response. Return the SAME
    # three keys as the mock path above — nothing upstream changes.
    raise NotImplementedError("Hermes live mode not wired yet")
