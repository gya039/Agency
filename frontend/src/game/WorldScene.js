// The living arcade. Builds the hub + six rooms, polls the backend every 1.5s,
// diffs each snapshot, and drives sprite behavior. It owns NO source-of-truth
// state — the backend snapshot is always the truth; we only interpolate toward it.

import Phaser from 'phaser'
import { api } from '../api.js'
import {
  WORLDS, WORLD_BY_ID, NEXUS, WORLD_FROM_BACKEND, BACKEND_FROM_WORLD,
} from '../universe.config.js'
import { identityFor, initials } from '../identity.js'
import { computeLayout } from './layout.js'
import { makeAgentTexture } from './placeholders.js'
import Room from './Room.js'
import Agent from './Agent.js'
import {
  initOverlay, updateHud, setLog, showRoomPanel, showAgentPanel, setOffline,
} from '../overlay.js'

const POLL_MS = 1500

export default class WorldScene extends Phaser.Scene {
  constructor() {
    super('WorldScene')
    this.agents = new Map()        // backend id -> Agent
    this.rooms = {}                // universe id -> Room
    this.lastXp = new Map()
    this.lastJobStatus = new Map()
    this.lastState = null
  }

  create() {
    this.layout = computeLayout()
    this._drawConduits()

    // Nexus first (lowest of the cells), then the six worlds.
    this.nexusRoom = new Room(this, NEXUS, this.layout.nexus, true)
    this._drawNexusCore()
    for (const w of WORLDS) {
      this.rooms[w.id] = new Room(this, w, this.layout.rooms[w.id], false)
    }

    // Bind interaction handlers used by Room/Agent.
    this.onRoomClick = (worldId) => showRoomPanel(worldId)
    this.onAgentClick = (id) => showAgentPanel(id)

    initOverlay({
      getState: () => this.lastState,
      worlds: WORLDS,
      onResize: () => this.scale.refresh(), // gutter collapse/expand -> re-fit board
      onEnqueue: async (worldId, title, n) => {
        await api.enqueue({ title, world: BACKEND_FROM_WORLD[worldId], agents_required: n })
        this.poll()
      },
      onAddAgent: async (worldId) => {
        await api.addAgent({ world: BACKEND_FROM_WORLD[worldId] })
        this.poll()
      },
      onRemoveAgent: async (id) => {
        await api.removeAgent(id)
        this.poll()
      },
    })

    // Optional camera zoom (default fits all). Wheel to zoom the world only.
    this.input.on('wheel', (_p, _go, _dx, dy) => {
      const cam = this.cameras.main
      cam.setZoom(Phaser.Math.Clamp(cam.zoom - dy * 0.0012, 0.7, 1.8))
    })

    // TODO: remove debug handle before production.
    // Harmless console hook, e.g. window.__AGENCY__.scene.onRoomClick('redline').
    window.__AGENCY__ = { game: this.game, scene: this }

    this._fails = 0
    this.traffic = 0
    this.coreBoost = 0
    this.events.once('shutdown', () => clearTimeout(this._pollTimer))
    this._scheduleNext(0)
  }

  update(time) {
    for (const [, ag] of this.agents) ag.update(time)
    this._updateNexusCore(time)
  }

  _scheduleNext(delay) {
    // Self-scheduling poll so failures back off (less console noise) and polls
    // never overlap. Uses window.setTimeout (NOT the scene clock) so data
    // polling is decoupled from the render loop and keeps running/recovering
    // even if rendering throttles. Resumes normal cadence once backend returns.
    clearTimeout(this._pollTimer)
    this._pollTimer = window.setTimeout(() => this.poll(), delay)
  }

  async poll() {
    try {
      const [state, usage, log] = await Promise.all([api.state(), api.usage(), api.log()])
      this._fails = 0
      setOffline(false)
      this.lastState = state
      this.applyState(state)
      updateHud(state, usage)
      setLog(log)
    } catch (e) {
      // Keep rendering the last good snapshot; just flag reconnecting.
      this._fails += 1
      setOffline(true)
    } finally {
      this._scheduleNext(this._fails > 0 ? 3000 : POLL_MS)
    }
  }

  _ensureAgentTexture(identity) {
    if (this.textures.exists(identity.texKey)) return
    const hex = '#' + identity.color.toString(16).padStart(6, '0')
    makeAgentTexture(this, identity.texKey, hex, initials(identity.name))
  }

  applyState(state) {
    const seen = new Set()

    // Pass 1: reconcile existence, detect moves, fire XP pops.
    for (const a of state.agents) {
      seen.add(a.id)
      const roomId = WORLD_FROM_BACKEND[a.current_world] || WORLDS[0].id
      const identity = identityFor(a)
      this._ensureAgentTexture(identity)

      let ag = this.agents.get(a.id)
      if (!ag) {
        ag = new Agent(this, identity)
        ag.roomId = roomId
        ag._spawned = true
        this.agents.set(a.id, ag)
      } else if (ag.roomId !== roomId) {
        ag.roomId = roomId
        ag._moved = true
      }
      ag.data = a

      const prev = this.lastXp.has(a.id) ? this.lastXp.get(a.id) : a.xp
      if (a.xp > prev) ag.popXp(a.xp - prev)
      this.lastXp.set(a.id, a.xp)
    }

    // Despawn agents that left.
    for (const [id, ag] of this.agents) {
      if (!seen.has(id)) { ag.destroy(); this.agents.delete(id); this.lastXp.delete(id) }
    }

    // Pass 2: group by room, assign stable slots, place / travel / settle.
    const byRoom = {}
    for (const [, ag] of this.agents) (byRoom[ag.roomId] ||= []).push(ag)

    let traffic = 0
    for (const w of WORLDS) {
      const room = this.rooms[w.id]
      const list = (byRoom[w.id] || []).sort((a, b) => (a.id < b.id ? -1 : 1))
      list.forEach((ag, i) => {
        const slot = room.slot(i)
        const accent = w.accent
        const status = ag.data.status
        if (ag._spawned) {
          ag.park(slot.x, slot.y)
          ag.setStatus(status, accent)
          ag._spawned = false
        } else if (ag._moved) {
          ag._moved = false
          ag.travelTo(this.layout.nexus, slot) // re-route safe if already traveling
          ag.setStatus(status, accent)         // deferred until arrival
        } else if (ag.traveling) {
          ag.retarget(slot)                    // same dest, slot index shifted
          ag.setStatus(status, accent)
        } else {
          ag.park(slot.x, slot.y)              // settle: update() eases to slot
          ag.setStatus(status, accent)
        }
      })

      // Incoming marker: a job targets this room but its agents aren't here yet
      // (someone's traveling in, or a job is queued waiting for a free agent).
      const inboundTraveler = (byRoom[w.id] || []).some((ag) => ag.traveling)
      const queuedHere = state.jobs.some((j) => j.status === 'queued' && WORLD_FROM_BACKEND[j.world] === w.id)
      room.setIncoming(inboundTraveler || queuedHere)
      room.setPips(Math.min(list.length, 5))
    }

    for (const [, ag] of this.agents) if (ag.traveling) traffic += 1
    this.traffic = traffic

    // Job completed -> flash its room.
    for (const j of state.jobs) {
      const prev = this.lastJobStatus.get(j.id)
      if (prev && prev !== 'done' && j.status === 'done') {
        const roomId = WORLD_FROM_BACKEND[j.world]
        if (this.rooms[roomId]) this.rooms[roomId].flashOnce()
      }
      this.lastJobStatus.set(j.id, j.status)
    }
  }

  _drawConduits() {
    const g = this.add.graphics().setDepth(1)
    for (const [x1, y1, x2, y2] of this.layout.conduits) {
      g.lineStyle(8, 0x1a2030, 1)
      g.lineBetween(x1, y1, x2, y2)
      g.lineStyle(2, 0x6ea8ff, 0.25)
      g.lineBetween(x1, y1, x2, y2)
      g.fillStyle(0x6ea8ff, 0.3)
      g.fillCircle(x2, y2, 4)
    }
  }

  _drawNexusCore() {
    const { cx, cy } = this.layout.nexus
    this._coreXY = { x: cx, y: cy + 22 }
    // Outer glow intensifies with traffic; inner core has a steady gentle pulse.
    this.coreGlow = this.add.circle(cx, cy + 22, 40, 0x6ea8ff, 0.05).setDepth(4)
    const core = this.add.circle(cx, cy + 22, 26, 0x6ea8ff, 0.16).setDepth(5)
    const ring = this.add.circle(cx, cy + 22, 26, 0x000000, 0).setStrokeStyle(2, 0x6ea8ff, 0.7).setDepth(5)
    this.tweens.add({ targets: [core, ring], scale: { from: 0.9, to: 1.12 }, alpha: { from: 0.9, to: 0.5 }, yoyo: true, repeat: -1, duration: 1400, ease: 'Sine.inOut' })
  }

  _updateNexusCore(time) {
    if (!this.coreGlow) return
    const target = this.traffic > 0 ? 1 : 0
    this.coreBoost += (target - this.coreBoost) * 0.06 // ease toward traffic level
    const pulse = 0.5 + 0.5 * Math.sin(time * 0.005)
    this.coreGlow.setAlpha(0.05 + this.coreBoost * (0.18 + 0.12 * pulse))
    this.coreGlow.setScale(0.9 + this.coreBoost * (0.5 + 0.18 * pulse))
  }
}
