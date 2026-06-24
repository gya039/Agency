// ============================================================================
// THE ORIGINAL ARCADE UNIVERSE — one place for all world + cast identity.
// No third-party IP. Rename anything here freely; nothing else hardcodes names.
//
// The Flask backend keeps its own fixed world ids (sugar/hero/felix/turbo/tron/
// roadblast) and seeds the cast into them. This file is the ONLY translation
// between the backend and the universe the player sees.
// ============================================================================

// Hub at the center — the power strip all worlds plug into.
export const NEXUS = {
  id: 'nexus',
  name: 'The Nexus',
  accent: 0x6ea8ff,
  accentCss: '#6ea8ff',
}

// Six worlds, fixed. Order matters: top row then bottom row (see layout).
export const WORLDS = [
  { id: 'sugar',   name: 'Sugar Circuit',     accent: 0xff5fa2, accentCss: '#ff5fa2', vibe: 'candy-kart racing; bright neon-pink track room' },
  { id: 'iron',    name: 'Iron Vanguard',     accent: 0x1fd0c3, accentCss: '#1fd0c3', vibe: 'co-op shooter; gunmetal bunker, teal alert light' },
  { id: 'mend',    name: 'Mendwright Tower',  accent: 0x9b7bff, accentCss: '#9b7bff', vibe: 'fix-and-build; warm workshop, gold light' },
  { id: 'redline', name: 'Redline',           accent: 0xff7a59, accentCss: '#ff7a59', vibe: 'street racer; garage bay, coral undercar glow' },
  { id: 'volt',    name: 'Voltgrid',          accent: 0x3b9dff, accentCss: '#3b9dff', vibe: 'neon arena; blue circuit-floor, light trails' },
  { id: 'dust',    name: 'Dustbreak',         accent: 0xffb020, accentCss: '#ffb020', vibe: 'off-road rally; sandy ochre depot, amber dusk' },
]

export const WORLD_BY_ID = Object.fromEntries(WORLDS.map((w) => [w.id, w]))

// Six original pixel characters. `home` is flavor (where they start); agents
// roam between worlds whenever the backend says so.
export const CAST = {
  pixie:  { name: 'Pixie',         home: 'sugar',   color: 0xff5fa2, trait: 'racer kid; fast, low patience' },
  vale:   { name: 'Sergeant Vale', home: 'iron',    color: 0x1fd0c3, trait: 'soldier; takes heavy jobs' },
  bricks: { name: 'Bricks',        home: 'mend',    color: 0x9b7bff, trait: 'heavy wrecker; slow, thorough' },
  nitro:  { name: 'Nitro',         home: 'redline', color: 0xff7a59, trait: 'speedster mechanic; restless' },
  cypher: { name: 'Cypher',        home: 'volt',    color: 0x3b9dff, trait: 'neon hacker; token-heavy jobs' },
  rasa:   { name: 'Rasa',          home: 'dust',    color: 0xffb020, trait: 'dust scout; roams most worlds' },
}

// --- THE MAPPING SEAM: backend ids -> universe ids --------------------------

// Backend world id -> universe world id (1:1, canonical order).
export const WORLD_FROM_BACKEND = {
  sugar: 'sugar',
  hero: 'iron',
  felix: 'mend',
  turbo: 'redline',
  tron: 'volt',
  roadblast: 'dust',
}

// Inverse, for posting jobs back to the backend's world id.
export const BACKEND_FROM_WORLD = Object.fromEntries(
  Object.entries(WORLD_FROM_BACKEND).map(([b, u]) => [u, b]),
)

// Backend agent id -> cast key (the reseeded mock agents a1..a6). Agents added
// at runtime (a100+) fall back to a procedural identity — see identity.js.
export const AGENT_FROM_BACKEND = {
  a1: 'pixie',
  a2: 'vale',
  a3: 'bricks',
  a4: 'nitro',
  a5: 'cypher',
  a6: 'rasa',
}

// Palette used to give runtime-added agents a stable color from their id.
export const FALLBACK_COLORS = [
  0xff5fa2, 0x1fd0c3, 0x9b7bff, 0xff7a59, 0x3b9dff, 0xffb020, 0x36d399, 0xff8fb0,
]
