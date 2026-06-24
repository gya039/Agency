// ============================================================================
// ASSET MANIFEST — the art seam. Logical name -> file path + frame data.
//
// Art is PLUGGABLE. The whole world runs NOW on placeholders (flat colored
// rooms; 32x32 colored blocks with initials for agents). Drop real PNGs into
// /public/assets/... and fill in frameW/frameH/anims here — NO scene code
// changes. If a file is missing, the loader fails for that key and the scene
// falls back to the `placeholder` color. See ASSETS_README.md.
//
// Room images are referenced by UNIVERSE id; the backend ids never appear here.
// ============================================================================

export const ASSETS = {
  rooms: {
    nexus:   { img: '/assets/rooms/nexus.png',   placeholder: '#27324A' },
    sugar:   { img: '/assets/rooms/sugar.png',   placeholder: '#F4C0D1' },
    iron:    { img: '/assets/rooms/iron.png',    placeholder: '#9FE1CB' },
    mend:    { img: '/assets/rooms/mend.png',    placeholder: '#C9BBFF' },
    redline: { img: '/assets/rooms/redline.png', placeholder: '#FFC2B0' },
    volt:    { img: '/assets/rooms/volt.png',    placeholder: '#AFD4FF' },
    dust:    { img: '/assets/rooms/dust.png',    placeholder: '#F4D9A0' },
  },

  // anims map a logical state -> frame indices in the sheet (row-major).
  agents: {
    pixie:  { sheet: '/assets/agents/pixie.png',  frameW: 32, frameH: 32, anims: { idle: [0, 1], walk: [2, 3, 4, 5], work: [6, 7] }, placeholder: '#FF5FA2' },
    vale:   { sheet: '/assets/agents/vale.png',   frameW: 32, frameH: 32, anims: { idle: [0, 1], walk: [2, 3, 4, 5], work: [6, 7] }, placeholder: '#1FD0C3' },
    bricks: { sheet: '/assets/agents/bricks.png', frameW: 32, frameH: 32, anims: { idle: [0, 1], walk: [2, 3, 4, 5], work: [6, 7] }, placeholder: '#9B7BFF' },
    nitro:  { sheet: '/assets/agents/nitro.png',  frameW: 32, frameH: 32, anims: { idle: [0, 1], walk: [2, 3, 4, 5], work: [6, 7] }, placeholder: '#FF7A59' },
    cypher: { sheet: '/assets/agents/cypher.png', frameW: 32, frameH: 32, anims: { idle: [0, 1], walk: [2, 3, 4, 5], work: [6, 7] }, placeholder: '#3B9DFF' },
    rasa:   { sheet: '/assets/agents/rasa.png',   frameW: 32, frameH: 32, anims: { idle: [0, 1], walk: [2, 3, 4, 5], work: [6, 7] }, placeholder: '#FFB020' },
  },
}
