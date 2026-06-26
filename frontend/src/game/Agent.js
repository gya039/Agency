// A pixel character. Motion is frame-driven (via the scene update loop) so it
// reads on placeholder blocks with no art: idle agents fidget, working agents
// pulse a ring, travelers ease old room -> Nexus -> new room and re-route
// cleanly if reassigned mid-walk. Travel legs own the sprite position; idle/
// working positions are eased toward the slot anchor in update().

import Phaser from 'phaser'

const MOVING_TINT = 0xffb020
const BASE_SCALE = 1.7

export default class Agent {
  constructor(scene, identity) {
    this.scene = scene
    this.id = identity.id
    this.identity = identity
    this.hasAnims = identity.castKey && scene.anims.exists(`anim-${identity.castKey}-walk`)

    this.sprite = scene.add.sprite(0, 0, identity.texKey).setDepth(12).setScale(BASE_SCALE)
    this.sprite.setInteractive({ useHandCursor: true })
    this.sprite.on('pointerdown', () => scene.onAgentClick && scene.onAgentClick(this.id))

    this.ring = scene.add.circle(0, 0, 16, 0x000000, 0).setDepth(11).setVisible(false)
    this.tag = scene.add
      .text(0, 0, identity.name, { fontFamily: 'monospace', fontSize: '11px', color: '#cdd5e4' })
      .setOrigin(0.5)
      .setDepth(13)

    this.status = 'idle'
    this.roomId = null
    this.traveling = false
    this.leg = 0
    this.anchor = { x: 0, y: 0 }
    this.fidget = { x: 0, y: 0 }
    this.rx = 0
    this.ry = 0
    this.phase = Math.random() * Math.PI * 2
    this._placed = false
    this._tw = null
    this._ringTw = null
    this._fidgetTimer = null
    this._pending = null
    this.data = null
  }

  // Park (re-slot). Instant the first time; afterward update() eases there.
  park(x, y) {
    this.anchor = { x, y }
    if (!this._placed) {
      this.rx = x; this.ry = y
      this.sprite.setPosition(x, y)
      this._placed = true
    }
  }

  syncTag() {
    this.tag.setPosition(this.sprite.x, this.sprite.y + 20)
    this.ring.setPosition(this.sprite.x, this.sprite.y)
  }

  // Per-frame motion. `t` is scene time in ms.
  update(t) {
    if (this.traveling) {
      if (!this.hasAnims) this.sprite.setAngle(Math.sin(t * 0.02 + this.phase) * 6)
      this.syncTag()
      return
    }
    const tx = this.anchor.x + this.fidget.x
    const ty = this.anchor.y + this.fidget.y
    this.rx += (tx - this.rx) * 0.12
    this.ry += (ty - this.ry) * 0.12

    let ox = 0, oy = 0, scale = BASE_SCALE
    if (this.status === 'working') {
      oy = Math.sin(t * 0.006 + this.phase) * 1.4
      scale = BASE_SCALE + Math.sin(t * 0.006 + this.phase) * 0.06
    } else if (this.status === 'moving') {
      oy = Math.sin(t * 0.012 + this.phase) * 2
    } else {
      // idle: gentle bob + sway
      oy = Math.sin(t * 0.0026 + this.phase) * 2.6
      ox = Math.sin(t * 0.0012 + this.phase) * 1.6
    }
    this.sprite.setAngle(0).setScale(scale).setPosition(this.rx + ox, this.ry + oy)
    this.syncTag()
  }

  _face(targetX) {
    this.sprite.setFlipX(targetX < this.sprite.x)
  }

  setStatus(status, accentColor) {
    // Don't fight the travel animation; remember the desired end state.
    if (this.traveling && status !== 'moving') {
      this._pending = { status, accentColor }
      return
    }
    this._applyVisual(status, accentColor)
  }

  _applyVisual(status, accentColor) {
    this.status = status
    if (this.hasAnims) this.sprite.anims.stop()

    if (status === 'moving') {
      this.sprite.setTint(MOVING_TINT)
      this._setRing(false)
      this._setFidget(false)
      if (this.hasAnims) this.sprite.play(`anim-${this.identity.castKey}-walk`, true)
    } else if (status === 'working') {
      this.sprite.setTint(accentColor ?? 0xffffff)
      this._setRing(true, accentColor ?? 0x6ea8ff)
      this._setFidget(false)
      if (this.hasAnims) this.sprite.play(`anim-${this.identity.castKey}-work`, true)
    } else {
      this.sprite.clearTint().setAlpha(0.92)
      this._setRing(false)
      this._setFidget(true)
      if (this.hasAnims) this.sprite.play(`anim-${this.identity.castKey}-idle`, true)
    }
  }

  _setRing(on, color) {
    if (on) {
      this.ring.setStrokeStyle(2, color, 0.85).setVisible(true)
      if (!this._ringTw) {
        this.ring.setScale(0.5).setAlpha(0.55)
        this._ringTw = this.scene.tweens.add({
          targets: this.ring, scale: { from: 0.5, to: 1.6 }, alpha: { from: 0.55, to: 0 },
          duration: 1100, repeat: -1, ease: 'Quad.out',
        })
      }
    } else {
      if (this._ringTw) { this._ringTw.stop(); this._ringTw = null }
      this.ring.setVisible(false)
    }
  }

  _setFidget(on) {
    if (on && !this._fidgetTimer) {
      this._fidgetTimer = this.scene.time.addEvent({
        delay: 3400, loop: true,
        callback: () => {
          this.fidget.x = Phaser.Math.Between(-12, 12)
          this.fidget.y = Phaser.Math.Between(-5, 5)
        },
      })
    } else if (!on && this._fidgetTimer) {
      this._fidgetTimer.remove(); this._fidgetTimer = null
      this.fidget.x = 0; this.fidget.y = 0
    }
  }

  // --- travel: two eased legs via the Nexus, reroute-aware ---
  travelTo(nexus, slot) {
    this.nexus = nexus
    this.travelTarget = slot
    if (this.traveling) {
      // Re-route. On leg 2 (room-bound) divert back via the Nexus; on leg 1
      // (Nexus-bound) just let it finish — leg 2 picks up the new target.
      if (this.leg === 2) this._startLeg(1)
      return
    }
    this.traveling = true
    this._applyVisual('moving')
    this._startLeg(1)
  }

  retarget(slot) {
    this.travelTarget = slot
    if (this.leg === 2) this._startLeg(2) // redirect room-bound leg to the new slot
  }

  _startLeg(leg) {
    this.leg = leg
    if (this._tw) { this._tw.stop(); this._tw = null }
    const dest = leg === 1 ? { x: this.nexus.cx, y: this.nexus.cy } : this.travelTarget
    this._face(dest.x)
    this._tw = this.scene.tweens.add({
      targets: this.sprite,
      x: dest.x, y: dest.y,
      duration: leg === 1 ? 560 : 600,
      ease: leg === 1 ? 'Sine.in' : 'Sine.out', // accelerate to the Nexus, decelerate into the room
      onComplete: () => {
        this._tw = null
        if (this.leg === 1) this._startLeg(2)
        else this._arrive()
      },
    })
  }

  _arrive() {
    this.traveling = false
    this.leg = 0
    this.anchor = { x: this.travelTarget.x, y: this.travelTarget.y }
    this.rx = this.sprite.x; this.ry = this.sprite.y
    this._placed = true
    const p = this._pending
    this._pending = null
    this._applyVisual(p ? p.status : 'idle', p ? p.accentColor : undefined)
    if (this.scene.onAgentArrive) this.scene.onAgentArrive() // soft footstep (throttled)
  }

  popXp(amount) {
    const t = this.scene.add
      .text(this.sprite.x, this.sprite.y - 26, `+${Math.round(amount)} XP`, {
        fontFamily: 'monospace', fontSize: '13px', color: '#36d399', fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(25)
    this.scene.tweens.add({ targets: t, y: t.y - 28, alpha: { from: 1, to: 0 }, duration: 1100, ease: 'Quad.out', onComplete: () => t.destroy() })
  }

  destroy() {
    if (this._tw) this._tw.stop()
    if (this._ringTw) this._ringTw.stop()
    if (this._fidgetTimer) this._fidgetTimer.remove()
    this.sprite.destroy()
    this.tag.destroy()
    this.ring.destroy()
  }
}
