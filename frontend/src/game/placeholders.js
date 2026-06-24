// Generated placeholder textures so the world is fully playable with ZERO art.
// Rooms -> flat colored rounded cell with light interior detail.
// Agents -> 32x32 colored block with initials.

import Phaser from 'phaser'

export function makeRoomTexture(scene, key, colorHex, w, h) {
  const c = Phaser.Display.Color.HexStringToColor(colorHex).color
  const g = scene.make.graphics({ x: 0, y: 0, add: false })
  const r = 16

  g.fillStyle(0x0d1019, 1)
  g.fillRoundedRect(0, 0, w, h, r)
  g.fillStyle(c, 0.18)
  g.fillRoundedRect(4, 4, w - 8, h - 8, r - 2)

  // floor inset
  g.fillStyle(0x000000, 0.22)
  g.fillRoundedRect(16, h * 0.46, w - 32, h * 0.5, 10)

  // station blocks along the floor
  g.fillStyle(c, 0.5)
  const cols = 3
  const sw = (w - 56) / cols
  for (let i = 0; i < cols; i++) {
    g.fillRoundedRect(28 + i * (sw + 4), h * 0.5, sw - 10, 14, 4)
  }

  // faint scanlines
  g.lineStyle(1, c, 0.07)
  for (let y = 10; y < h; y += 11) g.lineBetween(8, y, w - 8, y)

  g.generateTexture(key, Math.round(w), Math.round(h))
  g.destroy()
}

export function makeAgentTexture(scene, key, colorHex, initials) {
  const size = 32
  const c = Phaser.Display.Color.HexStringToColor(colorHex).color

  const g = scene.make.graphics({ x: 0, y: 0, add: false })
  g.fillStyle(0x0b0d13, 1)
  g.fillRoundedRect(0, 0, size, size, 8)
  g.fillStyle(c, 1)
  g.fillRoundedRect(3, 3, size - 6, size - 6, 6)
  g.lineStyle(2, 0xffffff, 0.28)
  g.strokeRoundedRect(3, 3, size - 6, size - 6, 6)

  const rt = scene.make.renderTexture({ x: 0, y: 0, width: size, height: size, add: false })
  rt.draw(g, 0, 0)
  const txt = scene.make.text({
    x: size / 2, y: size / 2, text: initials,
    style: { fontFamily: 'monospace', fontSize: '13px', color: '#0b0d13', fontStyle: 'bold' },
    add: false,
  }).setOrigin(0.5)
  rt.draw(txt, size / 2, size / 2)
  rt.saveTexture(key)

  g.destroy()
  txt.destroy()
  rt.destroy()
}
