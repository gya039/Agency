// Resolve a backend agent into a visual identity (texture key, display name,
// color). Cast members get their fixed identity; runtime-added agents get a
// stable procedural one derived from their id.

import { CAST, AGENT_FROM_BACKEND, FALLBACK_COLORS } from './universe.config.js'

export function initials(name) {
  const p = (name || '?').trim().split(/\s+/)
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase()
  return (p[0][0] + p[p.length - 1][0]).toUpperCase()
}

function hashId(id) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h
}

export function identityFor(agent) {
  const castKey = AGENT_FROM_BACKEND[agent.id]
  if (castKey) {
    const c = CAST[castKey]
    return { id: agent.id, castKey, texKey: 'agent-' + castKey, name: c.name, color: c.color }
  }
  // Runtime-added agent: procedural identity using the backend's (original) name.
  const color = FALLBACK_COLORS[hashId(agent.id) % FALLBACK_COLORS.length]
  return { id: agent.id, castKey: null, texKey: 'agent-x-' + agent.id, name: agent.name, color }
}
