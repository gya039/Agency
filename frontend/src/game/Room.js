// A room cell (one world, or the larger Nexus hub). Owns its background art
// (CONTAIN-fit: preserve aspect, letterbox into the cell, never stretch),
// accent border, label, co-location pips, a flash overlay, and an incoming-job
// marker. The Nexus also gets a soft glow + heavier frame so it reads as the
// hub. Texture is referenced by logical key only ('room-<id>').

import Phaser from 'phaser'

const DEPTH = {
  glow: 1.6, fill: 1.8, nexusBg: 2.0, worldFill: 2.8, worldBg: 3.0,
  border: 4, flash: 5, marker: 5, label: 6, hit: 7,
}
const RADIUS = 14

export default class Room {
  constructor(scene, world, rect, isNexus = false) {
    this.scene = scene
    this.world = world
    this.rect = rect
    this.isNexus = isNexus
    this._empty = undefined
    this._incoming = false
    this._borderW = isNexus ? 3 : 2
    this._borderA = isNexus ? 0.9 : 0.5
    const { x, y, w, h, cx, cy } = rect

    // Nexus emphasis: soft outward glow halo (drawn first, behind everything).
    if (isNexus) {
      this.glow = scene.add.graphics().setDepth(DEPTH.glow)
      for (const L of [{ o: 22, a: 0.05 }, { o: 14, a: 0.07 }, { o: 7, a: 0.10 }]) {
        this.glow.fillStyle(world.accent, L.a)
        this.glow.fillRoundedRect(x - L.o, y - L.o, w + 2 * L.o, h + 2 * L.o, RADIUS + 6)
      }
    }

    // Dark cell fill behind the art (shows through letterbox gaps).
    this.fill = scene.add.graphics().setDepth(isNexus ? DEPTH.fill : DEPTH.worldFill)
    this.fill.fillStyle(0x0b0d13, 1)
    this.fill.fillRoundedRect(x, y, w, h, RADIUS)

    // Background art, CONTAIN-fit (preserve aspect, center, no distortion).
    this.bg = scene.add.image(cx, cy, 'room-' + world.id).setDepth(isNexus ? DEPTH.nexusBg : DEPTH.worldBg)
    this._fitContain()

    // Clip art to the cell's rounded rect so letterboxed corners stay clean.
    this._maskG = scene.make.graphics()
    this._maskG.fillStyle(0xffffff)
    this._maskG.fillRoundedRect(x, y, w, h, RADIUS)
    this.bg.setMask(this._maskG.createGeometryMask())

    this.border = scene.add.graphics().setDepth(DEPTH.border)
    this._drawBorder(this._borderA)

    this.flash = scene.add.rectangle(cx, cy, w, h, world.accent, 0).setDepth(DEPTH.flash)

    this.label = scene.add
      .text(x + 16, y + 12, world.name.toUpperCase(), {
        fontFamily: 'monospace',
        fontSize: isNexus ? '19px' : '14px',
        color: '#eef2fb',
        fontStyle: 'bold',
      })
      .setDepth(DEPTH.label)

    this.dot = scene.add.circle(x + w - 18, y + 20, isNexus ? 6 : 5, world.accent).setDepth(DEPTH.label)

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

    // Incoming-job landing marker (worlds only).
    this.marker = scene.add.container(cx, y + h * 0.46).setDepth(DEPTH.marker).setVisible(false)
    const ring = scene.add.circle(0, 0, 17, 0x000000, 0).setStrokeStyle(2, world.accent, 0.9)
    const dot = scene.add.circle(0, 0, 3, world.accent, 0.95)
    this.marker.add([ring, dot])
    this._markerTw = null

    this.hit = scene.add
      .rectangle(cx, cy, w, h, 0xffffff, 0.001)
      .setDepth(DEPTH.hit)
      .setInteractive({ useHandCursor: true })
    this.hit.on('pointerover', () => this._drawBorder(Math.min(1, this._borderA + 0.4)))
    this.hit.on('pointerout', () => this._drawBorder(this._empty ? 0.22 : this._borderA))
    this.hit.on('pointerdown', () => scene.onRoomClick && scene.onRoomClick(world.id))
  }

  // Fit the art inside the cell preserving aspect ratio (contain). Generic:
  // works for any source dimensions, so the remaining art drops in unchanged.
  _fitContain() {
    const { w, h } = this.rect
    const src = this.scene.textures.get('room-' + this.world.id).getSourceImage()
    const iw = (src && src.width) || w
    const ih = (src && src.height) || h
    const scale = Math.min(w / iw, h / ih)
    this.bg.setDisplaySize(iw * scale, ih * scale)
  }

  _drawBorder(alpha) {
    const { x, y, w, h } = this.rect
    this.border.clear()
    this.border.lineStyle(this._borderW, this.world.accent, alpha)
    this.border.strokeRoundedRect(x + 1, y + 1, w - 2, h - 2, RADIUS + 2)
  }

  setPips(n) {
    this.pips.forEach((p, i) => { p.fillColor = i < n ? this.world.accent : 0x2a3040 })
    const empty = n === 0
    if (empty !== this._empty) {
      this._empty = empty
      this.scene.tweens.add({ targets: this.bg, alpha: empty ? 0.55 : 1, duration: 350 })
      this.scene.tweens.add({ targets: this.fill, alpha: empty ? 0.7 : 1, duration: 350 })
      this._drawBorder(empty ? 0.22 : this._borderA)
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
