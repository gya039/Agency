import Phaser from 'phaser'
import './style.css'
import BootScene from './game/BootScene.js'
import WorldScene from './game/WorldScene.js'
import { DESIGN_W, DESIGN_H } from './game/layout.js'
import { audio } from './audio.js'

// Arm the audio layer (silent until the first user gesture; never blocks).
audio.init()

// Silence EXPECTED missing-art loader errors (placeholder fallback by design)
// so they don't bury real errors. Drop this filter the day real art lands.
const _consoleError = console.error.bind(console)
console.error = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('Failed to process file')) return
  _consoleError(...args)
}

// Phaser mounts into #game; the HTML HUD overlay (overlay.js) floats on top.
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0b0d13',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: DESIGN_W,
    height: DESIGN_H,
  },
  render: { pixelArt: true, antialias: false },
  scene: [BootScene, WorldScene],
})

// Re-fit whenever the board container changes size (initial layout, gutter
// collapse, window resize) — FIT alone can latch onto a 0-size first measure.
const gameEl = document.getElementById('game')
if (window.ResizeObserver && gameEl) {
  new ResizeObserver(() => game.scale.refresh()).observe(gameEl)
}
