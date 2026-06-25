# Agency — gamified AI ops command center

A game-HUD dashboard for running AI agents as a fleet. Themed after *Wreck-It
Ralph*: a central hub (**Game Central Station**), six game-world "cartridges,"
agents that **float between worlds** to co-work jobs, XP earned by completing
work, and a live token/resource meter.

Everything runs **now on mock data**. The real LLM engine (Hermes / Nous) is on
hold — it's isolated behind a single stub module (`hermes_adapter.py`) so it can
be wired in later **without touching the UI**.

```
[ React dashboard ]  --fetch-->  [ Flask backend ]  --(later)-->  [ Hermes engine ]
   window only                    brain + job queue                  worker (stubbed now)
```

The dashboard never talks to the engine directly and never holds secrets — it
only calls the Flask backend. The backend owns all agent/world/job state, the
job queue, the worker loop, the (future) Hermes credentials, and all token
accounting.

## Run it

**Backend** (serves on `:5003` — clear of Octagon IQ on 5002):

```bash
cd backend
pip install -r requirements.txt
python app.py
```

> **Interpreter note:** on this machine the shell's default `python` resolves to
> a `hermes-agent` venv that has no Flask. Launch the backend with the pythoncore
> interpreter explicitly:
> `"C:\Users\yanka\AppData\Local\Python\pythoncore-3.14-64\python.exe" app.py`

**Frontend** (Vite dev server on `:5174`):

```bash
cd frontend
npm install
npm run dev
```

Open the Vite URL it prints (http://localhost:5174). The Phaser world loads with
the six-strong cast in their home rooms around **The Nexus** hub, and a couple of
jobs already running. A gentle **autopilot** keeps a trickle of jobs flowing so
the world stays alive on its own; deploy your own jobs and watch agents walk into
a room, work, earn XP, and burn tokens.

## Configuration (`backend/.env`)

| var | default | meaning |
|-----|---------|---------|
| `HERMES_MODE` | `mock` | `mock` (fake completions) or `live` (real engine) |
| `PORT` | `5003` | backend port |
| `AGENCY_AUTOPILOT` | `1` | `1` = auto-trickle jobs; `0` = only manual jobs |

`HERMES_ENDPOINT` / `HERMES_API_KEY` are documented as commented-out
placeholders in `.env` for the live swap.

## The Hermes seam (the one thing to swap later)

`backend/hermes_adapter.py` exposes a single function:

```python
process_job(job, agents) -> {"text": str, "prompt_tokens": int, "completion_tokens": int}
```

Right now it sleeps briefly and returns fake completions + fake token counts.
To go live, set `HERMES_MODE=live` and fill in the LIVE branch with a real
OpenAI-compatible call, reading `usage.*` off the response. **The signature and
return shape stay identical**, so nothing upstream — not `app.py`, not the
frontend — changes. All XP/token math lives in `scoring.py` (single source of
truth); the data contract (`/state`, `/usage`) is frozen.

## API (the data contract)

| method | path | purpose |
|--------|------|---------|
| `GET` | `/state` | full snapshot: worlds, agents, jobs, totals |
| `GET` | `/usage` | session tokens, tokens/sec, `cost_usd` (null), per-agent |
| `GET` | `/log` | recent mission-log events (append-only, newest first) |
| `POST` | `/enqueue` | `{title, world, agents_required}` → queue a job |
| `POST` | `/agents` | `{name?, world?}` → add an agent |
| `DELETE` | `/agents/<id>` | remove an agent |

## Layout

```
backend/
  app.py            Flask app + routes (no engine concerns here)
  state.py          in-memory store: worlds, agents, jobs, mission log
  worker.py         background loop: pulls jobs, moves agents, scores
  hermes_adapter.py THE SEAM — swap mock -> live here, nowhere else
  scoring.py        xp + level + throughput math (single source of truth)
  mock.py           names, job titles, the opening tableau
frontend/
  src/
    api.js          fetch wrappers + usePolling hook
    App.jsx         polls backend, holds only UI state
    components/     GameCentralStation, TokenMeter, WorldGrid, WorldCard,
                    AgentCard, MissionLog, EnqueueDialog
    theme.js        accent ramps per world, status colors
```
