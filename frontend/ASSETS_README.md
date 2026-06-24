# Adding real art to the Agency world

The world runs fully on **placeholders** (flat colored rooms; 32×32 colored
blocks with initials). Real art is dropped in later with **zero scene-code
changes** — only [`src/assets/manifest.js`](src/assets/manifest.js) and the PNG
files change. If a file is missing, the loader falls back to that entry's
`placeholder` color.

Scene code never references a file path — only logical texture keys
(`room-<id>`, `agent-<castKey>`). The manifest is the single seam.

## Where files go

```
public/assets/
  rooms/    nexus.png, sugar.png, iron.png, mend.png, redline.png, volt.png, dust.png
  agents/   pixie.png, vale.png, bricks.png, nitro.png, cypher.png, rasa.png
```

`public/` is served at the site root, so `public/assets/rooms/sugar.png` is
referenced in the manifest as `/assets/rooms/sugar.png`.

## Adding a ROOM image

1. Generate a room interior in Higgsfield (one image per world). A landscape
   ratio around **400×210** (or any multiple, e.g. 800×420) matches the cell;
   it's scaled to fit, so exact size isn't critical.
2. Save it as `public/assets/rooms/<universe-id>.png` (ids: `sugar`, `iron`,
   `mend`, `redline`, `volt`, `dust`, plus `nexus`).
3. That's it — the manifest already points at that path. Reload.

The room ids are the **universe** ids, not the backend ids. The backend→universe
mapping lives in [`src/universe.config.js`](src/universe.config.js)
(`WORLD_FROM_BACKEND`).

## Adding an AGENT sprite sheet

1. Generate a character, then **slice** it into an even grid of frames (e.g. a
   tool like TexturePacker, Aseprite export, or an online sheet slicer). All
   frames must be the **same size** and laid out left→right, top→bottom.
2. Save as `public/assets/agents/<castKey>.png` (cast keys: `pixie`, `vale`,
   `bricks`, `nitro`, `cypher`, `rasa`).
3. In `manifest.js`, set that agent's `frameW` / `frameH` to your frame size and
   map states to frame **indices** (row-major, 0-based):

   ```js
   pixie: {
     sheet: '/assets/agents/pixie.png',
     frameW: 32, frameH: 32,
     anims: { idle: [0, 1], walk: [2, 3, 4, 5], work: [6, 7] },
     placeholder: '#FF5FA2',
   },
   ```

   - `idle` — played when the agent is parked at rest.
   - `walk` — played while traveling between rooms.
   - `work` — played while working a job.

   If a real sheet loads, the scene builds these animations automatically and
   the agent uses them. If it's missing, the placeholder block animates with a
   simple tween (waddle / pulse) instead — same behavior, no art required.

## Generate-then-slice (Higgsfield) quick path

1. Prompt Higgsfield for a small **sprite sheet** (e.g. "32×32 pixel character,
   4-frame walk cycle, side view, transparent background, sprite sheet grid").
2. Export the PNG, confirm frames are an even grid, note the per-frame pixel
   size.
3. Drop it in `public/assets/agents/`, set `frameW`/`frameH` to that size, and
   fill `anims` with the frame indices. Reload — no other changes.

## Adding a brand-new agent or world

- New cast member: add it to `CAST` (and the `agents` block in the manifest) in
  the universe config, plus an `AGENT_FROM_BACKEND` binding if it maps to a
  specific seeded backend id.
- The six worlds are fixed by the backend's world ids; renaming is just editing
  `WORLDS` in `universe.config.js`. Adding/removing worlds would require a
  backend change (say so first).
