// Board geometry in DESIGN coordinates. The whole board fits one screen.
//
//   [ sugar ] [ iron ] [ mend ]
//   [      THE  NEXUS       ]    <- larger centered hub; six worlds around it
//   [ redline] [ volt ] [ dust ]
//
// The Nexus cell is ~1.4x the linear size of a world cell and conduits run from
// each world's center into the Nexus core (its center) — "everything plugs in".

export const DESIGN_W = 1280
export const DESIGN_H = 720

const TOP_IDS = ['sugar', 'iron', 'mend']
const BOT_IDS = ['redline', 'volt', 'dust']

function rect(x, y, w, h) {
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2, slots: [] }
}

// Up to 5 non-overlapping station slots along the lower interior of a room.
function addSlots(r) {
  const n = 5
  const padX = Math.min(34, r.w * 0.12)
  const usable = r.w - padX * 2
  const y = r.y + r.h - 40
  for (let i = 0; i < n; i++) {
    r.slots.push({ x: r.x + padX + (usable * (i + 0.5)) / n, y })
  }
}

export function computeLayout() {
  const margin = 20
  const boardX = margin
  const boardY = margin
  const boardW = DESIGN_W - margin * 2
  const boardH = DESIGN_H - margin * 2

  const gap = 16
  const colW = (boardW - gap * 2) / 3 // ~402.7

  const worldH = 170
  const nexusH = 296 // ~1.74x a world cell's height
  const vGap = 16
  const usedH = worldH + vGap + nexusH + vGap + worldH
  const offY = boardY + (boardH - usedH) / 2

  const topY = offY
  const nexusY = topY + worldH + vGap
  const botY = nexusY + nexusH + vGap
  const colX = (i) => boardX + i * (colW + gap)

  const rooms = {}
  TOP_IDS.forEach((id, i) => { rooms[id] = rect(colX(i), topY, colW, worldH) })
  BOT_IDS.forEach((id, i) => { rooms[id] = rect(colX(i), botY, colW, worldH) })
  Object.values(rooms).forEach(addSlots)

  // Nexus: larger than a world cell, centered horizontally on the board.
  const nexusW = 440 // ~1.09x a world cell's width; cell is ~1.9x the area
  const nexusX = boardX + (boardW - nexusW) / 2
  const nexus = rect(nexusX, nexusY, nexusW, nexusH)

  // Conduits: from each world's center into the Nexus core (its center).
  const conduits = []
  for (const id of [...TOP_IDS, ...BOT_IDS]) {
    conduits.push([rooms[id].cx, rooms[id].cy, nexus.cx, nexus.cy])
  }

  return { rooms, nexus, conduits, topIds: TOP_IDS, botIds: BOT_IDS }
}
