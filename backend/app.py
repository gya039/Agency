"""Agency backend — Flask app + routes.

The brain + job queue. Owns all agent/world/job state, token accounting, and
(later) the Hermes credentials. The dashboard only ever talks to this; it never
touches the engine and never holds secrets.

Engine concerns live exclusively in hermes_adapter.py — nothing about inference
is allowed to leak into the routing below.
"""

import os

from dotenv import load_dotenv
load_dotenv()  # load .env before anything reads HERMES_MODE / PORT / autopilot

from flask import Flask, jsonify, request
from flask_cors import CORS

import state
import worker

app = Flask(__name__)
CORS(app)  # allow the Vite dev server (localhost:5173) to call us


@app.get("/")
def health():
    return jsonify({"service": "Agency backend", "status": "ok"})


@app.get("/state")
def get_state():
    """Full snapshot: worlds, agents, jobs, totals (the data contract)."""
    return jsonify(state.snapshot_state())


@app.get("/usage")
def get_usage():
    """Token meter: session tokens, throughput, per-agent, cost (null for now)."""
    return jsonify(state.snapshot_usage())


@app.get("/log")
def get_log():
    """Recent mission-log events (append-only), newest first."""
    return jsonify(state.snapshot_log())


@app.post("/enqueue")
def post_enqueue():
    data = request.get_json(force=True, silent=True) or {}
    try:
        job = state.enqueue(
            data.get("title"),
            data.get("world"),
            data.get("agents_required", 1),
        )
    except (ValueError, TypeError) as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify({"ok": True, "job": job}), 201


@app.get("/agents/<agent_id>")
def get_agent(agent_id):
    """Agent detail: live fields + job history + top collaborators (additive)."""
    detail = state.agent_detail(agent_id)
    if detail is None:
        return jsonify({"error": "agent not found"}), 404
    return jsonify(detail)


@app.get("/queue")
def get_queue():
    """Current job queue (queued + running) in order (additive)."""
    return jsonify(state.snapshot_queue())


@app.post("/agents")
def post_agents():
    data = request.get_json(force=True, silent=True) or {}
    agent = state.add_agent(data.get("name"), data.get("world"))
    return jsonify({"ok": True, "agent": agent}), 201


@app.delete("/agents/<agent_id>")
def delete_agent(agent_id):
    if state.remove_agent(agent_id):
        return jsonify({"ok": True})
    return jsonify({"error": "agent not found"}), 404


if __name__ == "__main__":
    state.init()
    worker.start()
    port = int(os.getenv("PORT", "5003"))  # :5003 — clear of Octagon IQ on 5002
    # use_reloader=False so the background worker isn't started twice.
    app.run(host="127.0.0.1", port=port, threaded=True, use_reloader=False)
