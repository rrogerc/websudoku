// Ambient background — a generative lo-fi "driving past the city" parallax
// scene on a fixed canvas behind the game (never the menu). Zero assets, so it
// works offline by construction and ships nothing (same ethos as sound.js and
// scripts/make-icons.mjs). Colors are derived from the current theme's CSS
// variables, so every theme gets its own mood: dark themes render a night
// drive (lit windows, stars, passing headlight streaks), light themes a soft
// day drive (clouds, unlit panes).
//
// If a video exists at /ambient.mp4 (drop one in public/), it's auto-detected
// and used instead of the canvas. The service worker runtime-caches it; the
// full fetch below primes that cache, because the <video> element itself only
// issues range requests, which aren't cacheable.
//
// A YouTube link (Options) outranks both when online: a muted, cropped,
// pointer-transparent embed. Known tradeoffs, accepted: YouTube can inject
// ads, branding flashes briefly at load, and it's network-only — offline (or
// with reduced motion) it falls back to the mp4/canvas automatically.
//
// Perf/politeness: ~30fps cap, stops entirely when hidden or on the menu,
// honors prefers-reduced-motion (single static frame / paused video).

let wrap = null
let canvas = null
let ctx = null
let active = false // setting on AND the game (not the menu) is showing
let rafId = 0
let last = 0
let W = 0
let H = 0
let pal = null
let layers = []
let stars = []
let clouds = []
let streaks = []
let dashOffset = 0
let videoEl = null
let videoState = 'untried' // 'untried' | 'trying' | 'ok' | 'none'
let ytId = '' // 11-char YouTube id; wins over mp4/canvas while online
let ytFrame = null

const reduced = matchMedia('(prefers-reduced-motion: reduce)')

// Own PRNG: Math.random is off-limits here because generator.js swaps it for
// its seeded PRNG while grading puzzles (sound.js makes the same choice).
let rngState = 0x2f6e2b1
function rand() {
  let t = (rngState += 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/* ---------- palette from the current theme ---------- */

function hexRgb(s) {
  s = s.trim().replace('#', '')
  if (s.length === 3) s = [...s].map((c) => c + c).join('')
  const n = parseInt(s, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t))
const rgba = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`
const lum = (c) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255

function buildPalette() {
  const css = getComputedStyle(document.documentElement)
  const v = (name) => hexRgb(css.getPropertyValue(name))
  const bg = v('--page-bg')
  const ink = v('--box-border')
  const accent = v('--glint')
  const night = lum(bg) < 0.5
  pal = {
    night,
    skyTop: bg,
    skyHorizon: mix(bg, accent, night ? 0.16 : 0.1),
    layers: [mix(bg, ink, 0.2), mix(bg, ink, 0.4), mix(bg, ink, 0.65)],
    road: mix(bg, ink, 0.5),
    lane: mix(mix(bg, ink, 0.5), [255, 255, 255], 0.3),
    // warm-lit windows at night; faint unlit panes by day
    window: night ? mix(accent, [255, 214, 140], 0.55) : mix(bg, ink, 0.55),
    cloud: mix(bg, [255, 255, 255], 0.5),
    star: mix(accent, [255, 255, 255], 0.6),
    streak: accent,
  }
}

/* ---------- scene ---------- */

const LAYER_SPECS = [
  { speed: 7, hMin: 0.16, hMax: 0.32, windows: false },
  { speed: 16, hMin: 0.22, hMax: 0.44, windows: true, winW: 2, winH: 3, colGap: 7, rowGap: 10 },
  { speed: 34, hMin: 0.32, hMax: 0.56, windows: true, winW: 3, winH: 4, colGap: 10, rowGap: 14 },
]
const HORIZON = 0.8 // fraction of viewport height; road below

function makeBuilding(spec, x) {
  const w = 40 + rand() * 90
  const h = (spec.hMin + rand() * (spec.hMax - spec.hMin)) * H
  const wins = []
  if (spec.windows) {
    const cols = Math.floor((w - 8) / spec.colGap)
    const rows = Math.floor((h - 10) / spec.rowGap)
    for (let cx = 0; cx < cols; cx++)
      for (let ry = 0; ry < rows; ry++) if (rand() < 0.28) wins.push([4 + cx * spec.colGap, 6 + ry * spec.rowGap])
  }
  return { x, w, h, wins }
}

function size() {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  W = window.innerWidth
  H = window.innerHeight
  canvas.width = Math.round(W * dpr)
  canvas.height = Math.round(H * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function rebuild() {
  size()
  layers = LAYER_SPECS.map((spec) => {
    const buildings = []
    let x = -40
    while (x < W + 60) {
      const b = makeBuilding(spec, x)
      buildings.push(b)
      x += b.w + 6 + rand() * 26
    }
    return buildings
  })
  stars = Array.from({ length: 90 }, () => ({
    x: rand() * W,
    y: rand() * H * 0.55,
    r: rand() < 0.15 ? 2 : 1,
    tw: 0.5 + rand() * 1.5,
    phase: rand() * 6.28,
  }))
  clouds = Array.from({ length: 5 }, () => ({
    x: rand() * W,
    y: H * (0.08 + rand() * 0.3),
    w: 90 + rand() * 140,
    speed: 3 + rand() * 5,
  }))
  streaks = []
}

function step(dt) {
  for (let li = 0; li < layers.length; li++) {
    const spec = LAYER_SPECS[li]
    const buildings = layers[li]
    for (const b of buildings) b.x -= spec.speed * dt
    while (buildings.length && buildings[0].x + buildings[0].w < -10) buildings.shift()
    let right = buildings.length ? buildings.at(-1).x + buildings.at(-1).w : 0
    while (right < W + 60) {
      const b = makeBuilding(spec, right + 6 + rand() * 26)
      buildings.push(b)
      right = b.x + b.w
    }
  }
  for (const c of clouds) {
    c.x += c.speed * dt
    if (c.x - c.w > W) c.x = -c.w * 2
  }
  // oncoming traffic: occasional fast headlight streak along the road (night)
  if (pal.night && rand() < dt * 0.5) {
    const horizon = H * HORIZON
    streaks.push({ x: W + 60, y: horizon + 8 + rand() * (H - horizon - 20), vx: -(250 + rand() * 150), len: 60 })
  }
  for (const s of streaks) s.x += s.vx * dt
  streaks = streaks.filter((s) => s.x + s.len > -10)
  dashOffset = (dashOffset + 120 * dt) % 64
}

function drawFrame(t) {
  if (!pal) return
  const horizon = H * HORIZON
  const sky = ctx.createLinearGradient(0, 0, 0, horizon)
  sky.addColorStop(0, rgba(pal.skyTop))
  sky.addColorStop(1, rgba(pal.skyHorizon))
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, W, horizon)
  ctx.fillStyle = rgba(pal.road)
  ctx.fillRect(0, horizon, W, H - horizon)

  if (pal.night) {
    for (const s of stars) {
      ctx.fillStyle = rgba(pal.star, 0.25 + 0.25 * Math.sin((t / 1000) * s.tw + s.phase))
      ctx.fillRect(s.x, s.y, s.r, s.r)
    }
  } else {
    ctx.fillStyle = rgba(pal.cloud, 0.55)
    for (const c of clouds) {
      ctx.beginPath()
      ctx.ellipse(c.x, c.y, c.w / 2, c.w / 7, 0, 0, 6.29)
      ctx.ellipse(c.x - c.w / 4, c.y + c.w / 16, c.w / 3.2, c.w / 9, 0, 0, 6.29)
      ctx.ellipse(c.x + c.w / 4, c.y + c.w / 18, c.w / 3.5, c.w / 10, 0, 0, 6.29)
      ctx.fill()
    }
  }

  for (let li = 0; li < layers.length; li++) {
    const spec = LAYER_SPECS[li]
    ctx.fillStyle = rgba(pal.layers[li])
    for (const b of layers[li]) ctx.fillRect(b.x, horizon - b.h, b.w, b.h)
    if (spec.windows) {
      ctx.fillStyle = rgba(pal.window, pal.night ? 0.75 : 0.35)
      for (const b of layers[li]) {
        const top = horizon - b.h
        for (const [wx, wy] of b.wins) ctx.fillRect(b.x + wx, top + wy, spec.winW, spec.winH)
      }
    }
  }

  ctx.fillStyle = rgba(pal.lane, 0.6)
  const laneY = horizon + (H - horizon) * 0.55
  for (let x = -dashOffset; x < W; x += 64) ctx.fillRect(x, laneY, 26, 3)

  for (const s of streaks) {
    const g = ctx.createLinearGradient(s.x, s.y, s.x + s.len, s.y)
    g.addColorStop(0, rgba(pal.streak, 0))
    g.addColorStop(1, rgba(pal.streak, 0.55))
    ctx.fillStyle = g
    ctx.fillRect(s.x, s.y, s.len, 2)
  }
}

/* ---------- run state ---------- */

function tick(t) {
  rafId = requestAnimationFrame(tick)
  if (last && t - last < 33) return // ~30fps is plenty for ambience
  const dt = last ? Math.min(0.1, (t - last) / 1000) : 0
  last = t
  step(dt)
  drawFrame(t)
}

function startLoop() {
  if (rafId) return
  last = 0
  rafId = requestAnimationFrame(tick)
}
function stopLoop() {
  cancelAnimationFrame(rafId)
  rafId = 0
}

function resume() {
  if (!active || document.hidden) return
  const useYt = !!ytId && navigator.onLine && !reduced.matches
  if (!useYt && ytFrame) {
    ytFrame.remove()
    ytFrame = null
  }
  if (useYt) {
    stopLoop()
    if (videoEl) videoEl.pause()
    canvas.style.display = 'none'
    ensureYtFrame()
    ytCommand('playVideo') // resumes an existing player; a fresh one autoplays
    return
  }
  if (videoState === 'ok') {
    canvas.style.display = 'none'
    if (!reduced.matches) videoEl.play().catch(() => {})
    else videoEl.pause() // reduced motion: hold the current frame
    return
  }
  canvas.style.display = ''
  if (reduced.matches) {
    drawFrame(performance.now()) // a still skyline, no motion
    stopLoop()
    return
  }
  startLoop()
}

function halt() {
  stopLoop()
  if (videoEl) videoEl.pause()
  ytCommand('pauseVideo')
}

/* ---------- YouTube embed ---------- */

// enablejsapi lets us postMessage play/pause without loading the IFrame API
// script; loop needs the playlist param; nocookie host skips tracking cookies
function ensureYtFrame() {
  if (ytFrame) return
  const f = document.createElement('iframe')
  f.src =
    `https://www.youtube-nocookie.com/embed/${ytId}` +
    `?autoplay=1&mute=1&controls=0&loop=1&playlist=${ytId}` +
    '&playsinline=1&rel=0&iv_load_policy=3&modestbranding=1&enablejsapi=1'
  f.allow = 'autoplay; encrypted-media'
  f.setAttribute('aria-hidden', 'true')
  f.tabIndex = -1
  wrap.insertBefore(f, canvas)
  ytFrame = f
}

function ytCommand(func) {
  if (!ytFrame || !ytFrame.contentWindow) return
  ytFrame.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args: [] }), '*')
}

// Accepts a full YouTube URL (watch/youtu.be/live/shorts/embed) or a bare
// 11-char id; returns the id, or '' when it can't find one.
export function parseYouTubeId(text) {
  text = text.trim()
  if (!text) return ''
  if (/^[\w-]{11}$/.test(text)) return text
  try {
    const u = new URL(text)
    const idOk = (s) => (/^[\w-]{11}$/.test(s) ? s : '')
    if (u.hostname.endsWith('youtu.be')) return idOk(u.pathname.slice(1).split('/')[0])
    if (u.hostname.endsWith('youtube.com') || u.hostname.endsWith('youtube-nocookie.com')) {
      const v = u.searchParams.get('v')
      if (v) return idOk(v)
      const m = u.pathname.match(/\/(?:embed|live|shorts|v)\/([\w-]{11})/)
      if (m) return m[1]
    }
  } catch {
    /* not a URL */
  }
  return ''
}

// The stored id from settings; safe to call before the layer ever activates
export function setSource(youtubeId) {
  if (youtubeId === ytId) return
  ytId = youtubeId
  if (ytFrame) {
    ytFrame.remove()
    ytFrame = null
  }
  if (active) resume()
}

function tryVideo() {
  videoState = 'trying'
  const v = document.createElement('video')
  v.muted = true
  v.loop = true
  v.playsInline = true
  v.setAttribute('playsinline', '') // older iOS reads the attribute
  v.preload = 'auto'
  v.src = '/ambient.mp4'
  v.addEventListener(
    'canplay',
    () => {
      if (videoState !== 'trying') return
      videoState = 'ok'
      videoEl = v
      wrap.insertBefore(v, canvas)
      fetch(v.src).catch(() => {}) // prime the SW cache with a full 200 (see header)
      resume() // takes over display/loop bookkeeping
    },
    { once: true }
  )
  v.addEventListener(
    'error',
    () => {
      if (videoState === 'trying') videoState = 'none' // no file — canvas it is
    },
    { once: true }
  )
}

function initDom() {
  wrap = document.getElementById('ambient')
  canvas = document.getElementById('ambient-canvas')
  ctx = canvas.getContext('2d')
  document.addEventListener('visibilitychange', () => (document.hidden ? halt() : resume()))
  // losing the network drops a YouTube background to the mp4/canvas; regaining
  // it brings YouTube back — resume() re-evaluates the source pecking order
  window.addEventListener('online', () => {
    if (active) resume()
  })
  window.addEventListener('offline', () => {
    if (active) resume()
  })
  reduced.addEventListener('change', () => {
    halt()
    resume()
  })
  window.addEventListener('resize', () => {
    if (!layers.length) return
    rebuild()
    if (active && !rafId && videoState !== 'ok') drawFrame(performance.now())
  })
}

// The one entry point: main.js calls this whenever the setting or the
// menu/game state changes. Re-reads the theme palette every time, so a theme
// switch retints the scene for free.
export function setActive(on) {
  active = on
  if (!wrap) {
    if (!on) return // never activated; keep everything lazy
    initDom()
  }
  if (on) {
    buildPalette()
    if (!layers.length) rebuild()
    if (videoState === 'untried') tryVideo()
    resume()
  } else {
    halt()
  }
}
