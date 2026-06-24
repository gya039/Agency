// A room cell (one world, or the wider Nexus). Owns its background, accent
// border, label, co-location pips, a flash overlay, and an incoming-job
// landing marker. Texture is referenced by logical key only ('room-<id>').

import Phaser from 'phaser'

const DEPTH = { nexusBg: 2, roomBg: 3, border: 4, flash: 5, marker: 5, label: 6, hit: 7 }

export default class Room {
  constructor(scene, world, rect, isNexus = false) {
    this.scene = scene
    this.world = world
    this.rect = rect
    this.isNexus = isNexus
    this._empty = undefined
    this._incoming = false
    const { x, y, w, h, cx, cy } = rect

    this.bg = scene.add
      .image(cx, cy, 'room-' + world.id)
      .setDisplaySize(w, h)
      .setDepth(isNexus ? DEPTH.nexusBg : DEPTH.roomBg)

    this.border = scene.add.graphics().setDepth(DEPTH.border)
    this._drawBorder(0.5)

    this.flash = scene.add.rectangle(cx, cy, w, h, world.accent, 0).setDepth(DEPTH.flash)

    this.label = scene.add
      .text(x + 16, y + 12, world.name.toUpperCase(), {
        fontFamily: 'monospace',
        fontSize: isNexus ? '17px' : '14px',
        color: '#eef2fb',
        fontStyle: 'bold',
      })
      .setDepth(DEPTH.label)

    this.dot = scene.add.circle(x + w - 18, y + 20, 5, world.accent).setDepth(DEPTH.label)

    this.pips = []
    if (!isNexus) {
      const py = y + 36
      for (let i = 0; i < 5; i++) {
        const p = scene.add
          .rectangle(x + 18 + i * 13, py, 10, 6, 0x2a3040)
          .setOrigin(0, 0.5)
          .setDepth(DEPTH.label)
        this.pips.push(p)
      }
    }

    // Incoming-job landing marker (hidden until a job targets this room and its
    // agents haven't arrived yet).
    this.marker = scene.add.container(cx, y + h * 0.46).setDepth(DEPTH.marker).setVisible(false)
    const ring = scene.add.circle(0, 0, 17, 0x000000, 0).setStrokeStyle(2, world.accent, 0.9)
    const dot = scene.add.circle(0, 0, 3, world.accent, 0.95)
    this.marker.add([ring, dot])
    this._markerTw = null

    this.hit = scene.add
      .rectangle(cx, cy, w, h, 0xffffff, 0.001)
      .setDepth(DEPTH.hit)
      .setInteractive({ useHandCursor: true })
    this.hit.on('pointerover', () => this._drawBorder(this._empty ? 0.5 : 0.95))
    this.hit.on('pointerout', () => this._drawBorder(this._empty ? 0.22 : 0.5))
    this.hit.on('pointerdown', () => scene.onRoomClick && scene.onRoomClick(world.id))
  }

  _drawBorder(alpha) {
    const { x, y, w, h } = this.rect
    this.border.clear()
    this.border.lineStyle(2, this.world.accent, alpha)
    this.border.strokeRoundedRect(x + 1, y + 1, w - 2, h - 2, 16)
  }

  setPips(n) {
    this.pips.forEach((p, i) => { p.fillColor = i < n ? this.world.accent : 0x2a3040 })
    const empty = n === 0
    if (empty !== this._empty) {
      this._empty = empty
      this.scene.tweens.add({ targets: this.bg, alpha: empty ? 0.6 : 1, duration: 350 })
      this._drawBorder(empty ? 0.22 : 0.5)
      this.label.setAlpha(empty ? 0.7 : 1)
    }
  }

  setIncoming(on) {
    if (on === this._incoming) return
    this._incoming = on
    if (on) {
      this.marker.setVisible(true)
      this._markerTw = this.scene.tweens.add({
        targets: this.marker, scale: { from: 0.7, to: 1.25 }, alpha: { from: 1, to: 0.4 },
        yoyo: true, repeat: -1, duration: 700, ease: 'Sine.inOut',
      })
    } else {
      if (this._markerTw) { this._markerTw.stop(); this._markerTw = null }
      this.marker.setVisible(false).setScale(1).setAlpha(1)
    }
  }

  flashOnce() {
    this.scene.tweens.add({ targets: this.flash, alpha: { from: 0.5, to: 0 }, duration: 700, ease: 'Quad.out' })
  }

  slot(i) {
    const slots = this.rect.slots
    return slots[Math.min(i, slots.length - 1)]
  }
}
