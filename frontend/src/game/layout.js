// Board geometry in DESIGN coordinates. The whole board fits one screen.
//
//   [ sugar ] [ iron ] [ mend ]
//   [        THE NEXUS        ]   <- hub spans the middle band, full width
//   [ redline] [ volt ] [ dust ]

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
  const padX = 34
  const usable = r.w - padX * 2
  const y = r.y + r.h - 42
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
  const colW = (boardW - gap * 2) / 3

  const topH = 208
  const nexusH = 150
  const botH = 208
  const usedH = topH + nexusH + botH + gap * 2
  const offY = boardY + (boardH - usedH) / 2

  const topY = offY
  const nexusY = topY + topH + gap
  const botY = nexusY + nexusH + gap
  const colX = (i) => boardX + i * (colW + gap)

  const rooms = {}
  TOP_IDS.forEach((id, i) => { rooms[id] = rect(colX(i), topY, colW, topH) })
  BOT_IDS.forEach((id, i) => { rooms[id] = rect(colX(i), botY, colW, botH) })
  const nexus = rect(boardX, nexusY, boardW, nexusH)

  Object.values(rooms).forEach(addSlots)

  // Conduits: a line from each room to the nexus edge (where agents travel).
  const conduits = []
  TOP_IDS.forEach((id) => conduits.push([rooms[id].cx, rooms[id].y + rooms[id].h, rooms[id].cx, nexus.y]))
  BOT_IDS.forEach((id) => conduits.push([rooms[id].cx, rooms[id].y, rooms[id].cx, nexus.y + nexus.h]))

  return { rooms, nexus, conduits, topIds: TOP_IDS, botIds: BOT_IDS }
}
