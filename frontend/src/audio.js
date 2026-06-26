// Synth SFX + ambience via Tone.js — NO audio files. Everything is generated in
// code. Armed silently until the first user gesture (browser autoplay rule),
// then unlocked. Every public method is a no-op that never throws if audio is
// blocked or fails to init, so the app always runs (silently) without errors.
//
// Seam: the app calls audio.play('jobComplete'); the SOUND_MAP below decides
// what that sounds like. Tune a sound (or later swap it for a sample) in one
// place without touching the rest of the app.

import * as Tone from 'tone'

const PREFS_KEY = 'agency.audio.v1'
const DEFAULTS = { master: 0.5, ambience: 0.35, muted: false, ambienceOn: true }

const GESTURES = ['pointerdown', 'mousedown', 'click', 'touchstart', 'keydown']

let prefs = loadPrefs()
let inited = false
let unlocked = false
let failed = false
let nodes = null                  // Tone graph, built on unlock
let unlockCbs = []
const lastAt = {}                 // wall-clock throttle timestamps per event

// event -> { min: throttle seconds, play(time) }. Distinct short chiptune blips.
// jobComplete + levelUp are unthrottled and a touch louder so they're never
// drowned out; agentArrive/collabForming are throttled (they fire in bursts).
function soundMap(n) {
  return {
    deploy:        { min: 0.04, play: (t) => n.square.triggerAttackRelease('C5', '16n', t, 0.5) },
    jobComplete:   { min: 0.0,  play: (t) => { n.tri.triggerAttackRelease('C6', '16n', t, 0.65); n.tri.triggerAttackRelease('G6', '8n', t + 0.07, 0.6) } },
    levelUp:       { min: 0.0,  play: (t) => ['C5', 'E5', 'G5', 'C6', 'E6'].forEach((nt, i) => n.square.triggerAttackRelease(nt, '16n', t + i * 0.075, 0.62)) },
    agentArrive:   { min: 0.14, play: (t) => n.tick.triggerAttackRelease('16n', t, 0.5) },
    collabForming: { min: 0.5,  play: (t) => n.tri.triggerAttackRelease(['C4', 'G4', 'C5'], '8n', t, 0.28) },
    newPairing:    { min: 1.2,  play: (t) => ['G5', 'C6', 'E6', 'G6'].forEach((nt, i) => n.square.triggerAttackRelease(nt, '32n', t + i * 0.05, 0.42)) },
    reconnect:     { min: 2.0,  play: (t) => n.low.triggerAttackRelease('A1', '4n', t, 0.5) },
  }
}

// --- prefs -----------------------------------------------------------------
function loadPrefs() {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')) } }
  catch (e) { return { ...DEFAULTS } }
}
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch (e) { /* ignore */ }
}

// --- volume helpers --------------------------------------------------------
function dbFor(v) { return v <= 0.0001 ? -Infinity : Tone.gainToDb(v) }
function setVol(node, v, ramp = 0.05) {
  if (!node) return
  if (v <= 0.0001) node.volume.value = -Infinity
  else node.volume.rampTo(dbFor(v), ramp)
}

// --- build the Tone graph (after the context is running) -------------------
function build() {
  const master = new Tone.Volume(dbFor(prefs.master)).toDestination()
  master.mute = prefs.muted
  const sfxBus = new Tone.Volume(0).connect(master)
  const ambBus = new Tone.Volume(dbFor(prefs.ambience)).connect(master)

  const square = new Tone.PolySynth(Tone.Synth, {
    maxPolyphony: 16,
    oscillator: { type: 'square' },
    envelope: { attack: 0.004, decay: 0.09, sustain: 0.0, release: 0.06 },
    volume: -7,
  }).connect(sfxBus)
  const tri = new Tone.PolySynth(Tone.Synth, {
    maxPolyphony: 16,
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.004, decay: 0.13, sustain: 0.0, release: 0.1 },
    volume: -4,
  }).connect(sfxBus)
  const tick = new Tone.NoiseSynth({
    noise: { type: 'pink' },
    envelope: { attack: 0.001, decay: 0.045, sustain: 0 },
    volume: -18,
  }).connect(sfxBus)
  const low = new Tone.Synth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.02, decay: 0.25, sustain: 0.15, release: 0.35 },
    volume: -8,
  }).connect(sfxBus)

  nodes = { master, sfxBus, ambBus, square, tri, tick, low, amb: null, activity: 0 }
  nodes.map = soundMap(nodes)
  if (prefs.ambienceOn) startAmbience()
}

// --- ambience bed: soft low hum + occasional faint distant blips -----------
function startAmbience() {
  if (!nodes || nodes.amb) return
  const filter = new Tone.Filter(420, 'lowpass').connect(nodes.ambBus)
  const hum1 = new Tone.Oscillator(55, 'sine').connect(filter)
  const hum2 = new Tone.Oscillator(82.5, 'triangle').connect(filter)
  hum1.volume.value = -16
  hum2.volume.value = -24
  const breathe = new Tone.LFO({ frequency: 0.05, min: 320, max: 560 }).connect(filter.frequency)
  const blip = new Tone.Synth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.01, decay: 0.3, sustain: 0, release: 0.2 },
    volume: -24,
  }).connect(filter)
  const notes = ['C6', 'E6', 'G6', 'A5', 'D6', 'B5']
  const loop = new Tone.Loop((time) => {
    const chance = 0.32 + 0.45 * (nodes.activity || 0) // busier floor -> more distant blips
    if (Math.random() < chance) {
      blip.triggerAttackRelease(notes[(Math.random() * notes.length) | 0], '16n', time, 0.3)
    }
  }, '2n').start(0)
  hum1.start(); hum2.start(); breathe.start()
  Tone.Transport.start()
  nodes.amb = { filter, hum1, hum2, breathe, blip, loop }
}

function stopAmbience() {
  if (!nodes || !nodes.amb) return
  const a = nodes.amb
  try {
    a.loop.stop(); a.loop.dispose()
    a.breathe.stop(); a.breathe.dispose()
    a.hum1.stop(); a.hum1.dispose()
    a.hum2.stop(); a.hum2.dispose()
    a.blip.dispose(); a.filter.dispose()
  } catch (e) { /* ignore */ }
  nodes.amb = null
}

// --- unlock (first user gesture) -------------------------------------------
async function unlock() {
  if (unlocked || failed) return
  try {
    await Tone.start()
    build()
    unlocked = true
    unlockCbs.forEach((cb) => { try { cb() } catch (e) { /* ignore */ } })
    unlockCbs = []
    GESTURES.forEach((g) => window.removeEventListener(g, unlock))
  } catch (e) {
    failed = true // run silently; never block the app
  }
}

export const audio = {
  init() {
    if (inited || typeof window === 'undefined') return
    inited = true
    // Armed but silent until the first gesture; keep listening until it works.
    GESTURES.forEach((g) => window.addEventListener(g, unlock))
  },

  play(name) {
    if (failed || !unlocked || !nodes || prefs.muted) return
    const def = nodes.map[name]
    if (!def) return
    const now = performance.now() / 1000
    if (def.min && now - (lastAt[name] || 0) < def.min) return
    lastAt[name] = now
    try { def.play(Tone.now() + 0.02) } catch (e) { /* never throw */ }
  },

  // Optional gentle ambience reactivity (0..1).
  setActivity(level) {
    if (nodes) nodes.activity = Math.max(0, Math.min(1, level || 0))
  },

  setMaster(v) { prefs.master = clamp01(v); savePrefs(); setVol(nodes && nodes.master, prefs.master) },
  setAmbience(v) { prefs.ambience = clamp01(v); savePrefs(); setVol(nodes && nodes.ambBus, prefs.ambience, 0.1) },
  setMuted(b) { prefs.muted = !!b; savePrefs(); if (nodes) nodes.master.mute = prefs.muted },
  setAmbienceOn(b) {
    prefs.ambienceOn = !!b; savePrefs()
    if (nodes) { if (b) startAmbience(); else stopAmbience() }
  },

  getPrefs() { return { ...prefs } },
  isUnlocked() { return unlocked },
  onUnlock(cb) { if (unlocked) cb(); else unlockCbs.push(cb) },
}

function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)) }
