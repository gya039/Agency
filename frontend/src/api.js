// Framework-agnostic fetch layer. The world is a window onto the backend:
// it reads /state, /usage, /log and posts /enqueue + /agents. It owns no
// source-of-truth state of its own.

const BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:5003'

async function jget(path) {
  const r = await fetch(BASE + path)
  if (!r.ok) throw new Error(`${path} -> ${r.status}`)
  return r.json()
}

async function jsend(path, method, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return r.json()
}

export const api = {
  state: () => jget('/state'),
  usage: () => jget('/usage'),
  log: () => jget('/log'),
  enqueue: (body) => jsend('/enqueue', 'POST', body),
  addAgent: (body) => jsend('/agents', 'POST', body || {}),
  removeAgent: (id) => jsend('/agents/' + id, 'DELETE'),
}
