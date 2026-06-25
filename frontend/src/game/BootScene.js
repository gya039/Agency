// Loads whatever real art exists, then generates placeholders for everything
// missing. After this scene, the rest of the game references logical texture
// keys only ('room-<id>', 'agent-<castKey>') and never a file path.

import Phaser from 'phaser'
import { ASSETS } from '../assets/manifest.js'
import { CAST } from '../universe.config.js'
import { initials } from '../identity.js'
import { computeLayout } from './layout.js'
import { makeRoomTexture, makeAgentTexture } from './placeholders.js'

export default class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene')
    this.failed = new Set()
  }

  preload() {
    // A failed load (missing file) just means we'll draw a placeholder.
    this.load.on('loaderror', (file) => this.failed.add(file.key))

    for (const [id, room] of Object.entries(ASSETS.rooms)) {
      if (room.img) this.load.image('room-' + id, room.img)
    }
    for (const [key, a] of Object.entries(ASSETS.agents)) {
      if (a.sheet) {
        this.load.spritesheet('agent-' + key, a.sheet, { frameWidth: a.frameW, frameHeight: a.frameH })
      }
    }
  }

  create() {
    const { rooms, nexus } = computeLayout()

    // Rooms: keep real image if it loaded, else generate a placeholder cell.
    for (const [id, room] of Object.entries(ASSETS.rooms)) {
      const texKey = 'room-' + id
      if (!this.textures.exists(texKey) || this.failed.has(texKey)) {
        const size = id === 'nexus' ? nexus : rooms[id] || { w: 400, h: 208 }
        makeRoomTexture(this, texKey, room.placeholder, size.w, size.h)
      }
    }

    // Agents: build anims from a real sheet, else a placeholder block.
    for (const [key, a] of Object.entries(ASSETS.agents)) {
      const texKey = 'agent-' + key
      const loaded = this.textures.exists(texKey) && !this.failed.has(texKey)
      if (loaded) {
        this._createAnims(key, a)
      } else {
        const name = CAST[key] ? CAST[key].name : key
        makeAgentTexture(this, texKey, a.placeholder, initials(name))
      }
    }

    // Hand off after create() fully returns (escape Phaser's call stack so the
    // scene-manager transition isn't started mid-create — that can stall it).
    window.setTimeout(() => { const m = this.scene.manager; m.stop('BootScene'); m.start('WorldScene') }, 30)
  }

  _createAnims(key, a) {
    for (const [state, frames] of Object.entries(a.anims || {})) {
      const animKey = `anim-${key}-${state}`
      if (this.anims.exists(animKey)) continue
      this.anims.create({
        key: animKey,
        frames: this.anims.generateFrameNumbers('agent-' + key, { frames }),
        frameRate: state === 'walk' ? 8 : 3,
        repeat: -1,
      })
    }
  }
}
