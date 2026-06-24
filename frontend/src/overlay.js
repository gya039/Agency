// HTML HUD overlay around the Phaser canvas: top bar (level, XP bar, token
// meter) above the board, and a RESERVED RIGHT GUTTER (#side) holding the
// mission-log drawer + the room/agent info panel — so neither ever covers a
// room cell. Numbers animate client-side toward the latest backend snapshot
// (the truth is always the snapshot — we only interpolate).

import { WORLD_BY_ID, WORLD_FROM_BACKEND, CAST, AGENT_FROM_BACKEND } from './universe.config.js'

let cb = {}
let els = {}
let openWorld = null // world currently shown in the deploy dialog (or null)

// animated display values
const av = { xp: 0, xpT: 0, total: 0, totalT: 0, tok: 0, tokT: 0, tps: 0, tpsT: 0 }
let xpPer = 1000

const fmt = (n) => Math.round(Number.isFinite(n) ? n : 0).toLocaleString('en-US')

const KIND_COLOR = {
  system: '#7c8597', deploy: '#3b9dff', start: '#ffb020', working: '#9b7bff',
  done: '#36d399', agent_add: '#1fd0c3', agent_remove: '#ff5fa2',
}

export function initOverlay(callbacks) {
  cb = callbacks
  buildTopBar()
  buildSide()
  buildDialog()
  requestAnimationFrame(tick)
}

// ---- top bar ---------------------------------------------------------------
function buildTopBar() {
  const bar = document.getElementById('hud-top')
  bar.innerHTML = `
    <div class="hb-brand">
      <div class="hb-badge"><span>LVL</span><b id="hb-level">1</b></div>
      <div class="hb-title">THE NEXUS<small>Agency · AI ops</small></div>
    </div>
    <div class="hb-xp">
      <div class="hb-xp-head"><span class="k">XP</span><span class="mono" id="hb-xp-num">0 / 1000</span></div>
      <div class="bar"><div class="bar-fill" id="hb-xp-fill"></div></div>
      <div class="hb-xp-foot mono" id="hb-xp-total">0 total XP</div>
    </div>
    <div class="hb-meter">
      <div class="hb-meter-head"><span class="k">TOKEN FUEL</span><span class="mono dim" id="hb-cost"></span></div>
      <div class="hb-meter-big mono" id="hb-tokens">0</div>
      <div class="tank"><div class="tank-fill" id="hb-tank"></div></div>
      <div class="hb-meter-foot"><b class="mono" id="hb-tps">0</b> tok/sec</div>
    </div>
    <div class="hb-status" id="hb-status"></div>`
  els.level = q('#hb-level'); els.xpNum = q('#hb-xp-num'); els.xpFill = q('#hb-xp-fill')
  els.xpTotal = q('#hb-xp-total'); els.tokens = q('#hb-tokens'); els.tank = q('#hb-tank')
  els.tps = q('#hb-tps'); els.cost = q('#hb-cost'); els.status = q('#hb-status')
}

export function updateHud(state, usage) {
  els.level.textContent = state.level
  xpPer = state.xp_per_level || 1000
  av.xpT = state.xp_into_level
  av.totalT = state.total_xp
  if (usage) {
    av.tokT = usage.session_tokens
    av.tpsT = usage.tokens_per_sec
    els.cost.textContent = usage.cost_usd != null ? '$' + usage.cost_usd.toFixed(2) : ''
  }
}

export function setOffline(off) {
  els.status.textContent = off ? '⟳ reconnecting…' : ''
  els.status.classList.toggle('off', off)
}

// ---- right gutter: collapse toggle + info panel + mission log --------------
function buildSide() {
  const side = document.getElementById('side')
  side.innerHTML = `
    <div class="side-head">
      <button id="side-toggle" title="Collapse log">⟩</button>
      <span class="side-title">MISSION LOG <span class="dim">append-only</span></span>
    </div>
    <div class="panel hidden" id="panel"></div>
    <div class="mlog"><div class="mlog-feed" id="mlog-feed"></div></div>`
  els.side = side
  els.panel = q('#panel')
  els.logFeed = q('#mlog-feed')
  els.toggle = q('#side-toggle')
  els.toggle.onclick = () => setCollapsed(!side.classList.contains('collapsed'))
}

function setCollapsed(collapsed) {
  els.side.classList.toggle('collapsed', collapsed)
  els.toggle.textContent = collapsed ? '⟨' : '⟩'
  els.toggle.title = collapsed ? 'Expand log' : 'Collapse log'
  // Let the flex board reclaim/yield space, then re-fit the Phaser canvas.
  requestAnimationFrame(() => {
    if (cb.onResize) cb.onResize()
    window.dispatchEvent(new Event('resize'))
  })
}

export function setLog(events) {
  els.logFeed.innerHTML = events.slice(0, 30).map((e) => `
    <div class="mlog-row">
      <span class="mlog-dot" style="background:${KIND_COLOR[e.kind] || '#7c8597'}"></span>
      <span class="mlog-text">${esc(e.text)}</span>
      <span class="mlog-time mono dim">${ago(e.ts)}</span>
    </div>`).join('')
}

// ---- room / agent panel (inside the gutter, never over the board) ----------
export function showRoomPanel(worldId) {
  const state = cb.getState && cb.getState()
  if (!state) return
  const world = WORLD_BY_ID[worldId]
  if (!world) return // e.g. the Nexus hub is not one of the six worlds
  if (els.side.classList.contains('collapsed')) setCollapsed(false)
  const roster = state.agents.filter((a) => WORLD_FROM_BACKEND[a.current_world] === worldId)
  const jobs = state.jobs.filter((j) => WORLD_FROM_BACKEND[j.world] === worldId)
  const active = jobs.filter((j) => j.status !== 'done')
  els.panel.innerHTML = `
    <div class="panel-head" style="--accent:${world.accentCss}">
      <span class="pdot"></span><b>${world.name}</b>
      <button class="x" id="panel-x">×</button>
    </div>
    <div class="panel-sub dim">${esc(world.vibe)}</div>
    <div class="panel-section">${roster.length} agent${roster.length === 1 ? '' : 's'} here</div>
    ${roster.map((a) => agentRow(a)).join('') || '<div class="dim small">— empty —</div>'}
    <div class="panel-section">${active.length} active job(s)</div>
    ${active.map((j) => `<div class="prow"><span>${esc(j.title)}</span><span class="mono dim">${j.status}</span></div>`).join('') || '<div class="dim small">— none —</div>'}
    <div class="panel-actions">
      <button class="btn primary" id="panel-deploy" style="--accent:${world.accentCss}">Deploy job</button>
      <button class="btn ghost" id="panel-add">+ agent</button>
    </div>`
  q('#panel-x').onclick = hidePanel
  q('#panel-deploy').onclick = () => openDialog(worldId)
  q('#panel-add').onclick = async () => { await cb.onAddAgent(worldId) }
  els.panel.querySelectorAll('[data-rm]').forEach((b) => {
    b.onclick = async () => { await cb.onRemoveAgent(b.getAttribute('data-rm')) }
  })
  els.panel.classList.remove('hidden')
}

export function showAgentPanel(agentId) {
  const state = cb.getState && cb.getState()
  if (!state) return
  if (els.side.classList.contains('collapsed')) setCollapsed(false)
  const a = state.agents.find((x) => x.id === agentId)
  if (!a) return
  const castKey = AGENT_FROM_BACKEND[a.id]
  const trait = castKey ? CAST[castKey].trait : 'runtime unit'
  const world = WORLD_BY_ID[WORLD_FROM_BACKEND[a.current_world]]
  els.panel.innerHTML = `
    <div class="panel-head" style="--accent:${world?.accentCss || '#6ea8ff'}">
      <span class="pdot"></span><b>${esc(a.name)}</b>
      <button class="x" id="panel-x">×</button>
    </div>
    <div class="panel-sub dim">${esc(trait)}</div>
    <div class="prow"><span>Status</span><span class="mono">${a.status}</span></div>
    <div class="prow"><span>World</span><span class="mono">${world ? esc(world.name) : a.current_world}</span></div>
    <div class="prow"><span>XP</span><span class="mono">${fmt(a.xp)}</span></div>
    <div class="prow"><span>Tokens used</span><span class="mono">${fmt(a.tokens_used)}</span></div>
    <div class="panel-actions">
      <button class="btn ghost" id="panel-rm">Remove agent</button>
    </div>`
  q('#panel-x').onclick = hidePanel
  q('#panel-rm').onclick = async () => { await cb.onRemoveAgent(a.id); hidePanel() }
  els.panel.classList.remove('hidden')
}

function agentRow(a) {
  return `<div class="prow">
    <span>${esc(a.name)}</span>
    <span class="mono dim">${a.status}</span>
    <button class="mini" data-rm="${a.id}" title="remove">×</button>
  </div>`
}

function hidePanel() { els.panel.classList.add('hidden') }

// ---- deploy dialog (modal over the whole stage) ----------------------------
function buildDialog() {
  const stage = document.getElementById('stage')
  const d = document.createElement('div')
  d.className = 'scrim hidden'
  d.id = 'scrim'
  d.innerHTML = `
    <form class="dialog" id="dialog">
      <div class="dialog-head"><b>Deploy a job</b><button type="button" class="x" id="dlg-x">×</button></div>
      <label class="f"><span>Title</span><input id="dlg-title" value="Summarize logs" /></label>
      <div class="suggests" id="dlg-suggests"></div>
      <div class="f-row">
        <label class="f"><span>World</span><select id="dlg-world"></select></label>
        <label class="f"><span>Agents</span><div class="seg" id="dlg-seg"></div></label>
      </div>
      <div class="dialog-foot">
        <button type="button" class="btn ghost" id="dlg-cancel">Cancel</button>
        <button type="submit" class="btn primary" id="dlg-go">Deploy</button>
      </div>
    </form>`
  stage.appendChild(d)
  els.scrim = d
  els.dlgTitle = q('#dlg-title'); els.dlgWorld = q('#dlg-world')
  els.dlgWorld.innerHTML = cb.worlds.map((w) => `<option value="${w.id}">${w.name}</option>`).join('')
  q('#dlg-suggests').innerHTML = ['Summarize logs', 'Triage incidents', 'Refactor module', 'Generate test cases', 'Review pull request']
    .map((s) => `<button type="button" class="sug">${s}</button>`).join('')
  q('#dlg-suggests').querySelectorAll('.sug').forEach((b) => { b.onclick = () => { els.dlgTitle.value = b.textContent } })
  els.seg = 2
  const seg = q('#dlg-seg')
  seg.innerHTML = [1, 2, 3].map((n) => `<button type="button" class="seg-b${n === 2 ? ' on' : ''}" data-n="${n}">${n}</button>`).join('')
  seg.querySelectorAll('.seg-b').forEach((b) => {
    b.onclick = () => { els.seg = +b.getAttribute('data-n'); seg.querySelectorAll('.seg-b').forEach((x) => x.classList.toggle('on', x === b)) }
  })
  q('#dlg-x').onclick = closeDialog
  q('#dlg-cancel').onclick = closeDialog
  d.onmousedown = (e) => { if (e.target === d) closeDialog() }
  q('#dialog').onsubmit = async (e) => {
    e.preventDefault()
    const world = openWorld || els.dlgWorld.value
    await cb.onEnqueue(world, els.dlgTitle.value.trim() || 'Untitled job', els.seg)
    closeDialog()
  }
  q('#dialog').style.setProperty('--accent', '#6ea8ff')
}

function openDialog(worldId) {
  openWorld = worldId
  const w = WORLD_BY_ID[worldId]
  els.dlgWorld.value = worldId
  q('#dialog').style.setProperty('--accent', w.accentCss)
  els.scrim.classList.remove('hidden')
}
function closeDialog() { openWorld = null; els.scrim.classList.add('hidden') }

// ---- number animation loop -------------------------------------------------
function tick() {
  av.xp += (av.xpT - av.xp) * 0.15
  av.total += (av.totalT - av.total) * 0.15
  av.tok += (av.tokT - av.tok) * 0.12
  av.tps += (av.tpsT - av.tps) * 0.2
  if (els.xpNum) {
    els.xpNum.textContent = `${fmt(av.xp)} / ${fmt(xpPer)}`
    els.xpFill.style.width = Math.max(0, Math.min(100, (av.xp / xpPer) * 100)) + '%'
    els.xpTotal.textContent = `${fmt(av.total)} total XP`
    els.tokens.textContent = fmt(av.tok)
    els.tank.style.width = Math.max(3, Math.min(100, (av.tpsT / 600) * 100)) + '%'
    els.tps.textContent = fmt(av.tps)
    els.tps.classList.toggle('live', av.tpsT > 0)
  }
  requestAnimationFrame(tick)
}

// ---- helpers ---------------------------------------------------------------
function q(sel) { return document.querySelector(sel) }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }
function ago(ts) {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts))
  if (s < 60) return s + 's'
  const m = Math.floor(s / 60)
  return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h'
}
