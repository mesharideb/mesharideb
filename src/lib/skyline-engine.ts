import {
  barHeight, camera, dayMs, easeInOutCubic, ELEV_3D, ELEV_RANGE,
  lerp, luminance, mixRGB, project, resolvePalette, riseAt, smoothstep, YAW_3D, YAW_RANGE,
  type Cam, type Cell, type ContributionDay, type PaletteInput, type RGB,
} from "./contributions"

export type ChartTheme = { dark: boolean; swatches: string[]; accent: string }
export type ChartModel = { cells: Cell[]; weeks: number; max: number; months: { week: number; label: string }[] }
export type EngineConfig = {
  model: ChartModel; duration: number; heightScale: number; orbit: boolean; palette: PaletteInput
  legendLevel: number; target: number; locale: string
  setActive: (index: number) => void; setWidth: (width: number) => void
  setTheme: (theme: ChartTheme) => void; setAnnounce: (text: string) => void
  describe: (index: number) => string; onCellClick?: (day: ContributionDay) => void
}

const rgb = (c: RGB) => `rgb(${c.map(Math.round).join(",")})`
const rgba = (c: RGB, alpha: number) => `rgba(${c.map(Math.round).join(",")},${alpha})`

function pointInQuad(p: Float32Array, o: number, x: number, y: number) {
  let sign = 0
  for (let k = 0; k < 4; k++) {
    const a = o + k * 2, b = o + ((k + 1) % 4) * 2
    const cross = (p[b] - p[a]) * (y - p[a + 1]) - (p[b + 1] - p[a + 1]) * (x - p[a])
    if (Math.abs(cross) < 1e-9) continue
    const s = cross > 0 ? 1 : -1
    if (sign && sign !== s) return false
    sign = s
  }
  return sign !== 0
}

function quad(ctx: CanvasRenderingContext2D, p: Float32Array, o: number, radius = 0) {
  ctx.beginPath()
  ctx.moveTo((p[o + 6] + p[o]) / 2, (p[o + 7] + p[o + 1]) / 2)
  for (let k = 0; k < 4; k++) {
    const a = o + k * 2, b = o + ((k + 1) % 4) * 2
    if (radius > 0.3) ctx.arcTo(p[a], p[a + 1], p[b], p[b + 1], radius)
    else ctx.lineTo(p[a], p[a + 1])
  }
  ctx.closePath()
}

/** One canvas, one camera, and one set of cells throughout the 2D ↔ 3D morph. */
export function createSkylineEngine(
  root: HTMLElement, stage: HTMLElement, canvas: HTMLCanvasElement, tip: HTMLElement,
  config: () => EngineConfig,
) {
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  const probe = document.createElement("canvas")
  probe.width = probe.height = 1
  const probeCtx = probe.getContext("2d", { willReadFrequently: true })
  const toRGB = (color: string, fallback: RGB): RGB => {
    if (!probeCtx) return fallback
    probeCtx.clearRect(0, 0, 1, 1)
    probeCtx.fillStyle = "transparent"
    probeCtx.fillStyle = color
    probeCtx.fillRect(0, 0, 1, 1)
    const d = probeCtx.getImageData(0, 0, 1, 1).data
    return d[3] < 8 ? fallback : [d[0], d[1], d[2]]
  }
  const reduceMq = matchMedia("(prefers-reduced-motion: reduce)")
  const darkMq = matchMedia("(prefers-color-scheme: dark)")
  let reduced = reduceMq.matches, entered = false, destroyed = false
  let t = 0, target = 0, yaw = 0, elev = 0, yawGoal = 0, elevGoal = 0
  let W = 0, H2 = 0, H3 = 0, Hmax = 0, lastH = -1, dpr = 1, gutter = 30, labelW = 30
  let font = "10px sans-serif", fg: RGB = [23, 23, 23], bg: RGB = [255, 255, 255]
  let colors: RGB[] = [], colorGoals: RGB[] = []
  let cells: Cell[] = [], weeks = 0, heights: number[] = [], months: ChartModel["months"] = []
  let weekdayRows: { day: number; label: string }[] = []
  let zs = new Float32Array(0), hover = new Float32Array(0), dim = new Float32Array(0), polys = new Float32Array(0)
  let faces = new Uint8Array(0), order: number[] = []
  let hovered = -1, pinned = -1, active = -1, tipW = 0, raf = 0, last = 0
  let drag: { id: number; x: number; y: number; yaw: number; elev: number; moved: boolean; orbit: boolean; mouse: boolean } | null = null

  function kick() {
    if (raf || destroyed) return
    canvas.dataset.settled = "false"
    last = performance.now()
    raf = requestAnimationFrame(tick)
  }
  function refreshActive() {
    const next = hovered >= 0 ? hovered : pinned
    if (next === active) return
    active = next
    config().setActive(active)
    kick()
  }
  function load() {
    const cfg = config(), model = cfg.model
    cells = model.cells; weeks = model.weeks; months = model.months
    heights = cells.map(c => barHeight(c.count, model.max, cfg.heightScale))
    zs = new Float32Array(cells.length); hover = new Float32Array(cells.length); dim = new Float32Array(cells.length)
    polys = new Float32Array(cells.length * 24); faces = new Uint8Array(cells.length)
    order = cells.map((_, i) => i)
    const fmt = new Intl.DateTimeFormat(cfg.locale, { weekday: "short", timeZone: "UTC" })
    weekdayRows = cells.slice(0, 7).filter(c => [1, 3, 5].includes(new Date(dayMs(c.date)).getUTCDay())).map(c => ({ day: c.day, label: fmt.format(dayMs(c.date)) }))
    hovered = pinned = -1
    refreshActive()
  }
  function retheme() {
    const css = getComputedStyle(root)
    fg = toRGB(css.color, [23, 23, 23])
    bg = toRGB(css.backgroundColor, luminance(fg) > 0.5 ? [13, 17, 23] : [255, 255, 255])
    const dark = luminance(bg) < 0.45
    font = `400 10px ${css.fontFamily || "sans-serif"}`
    colorGoals = [mixRGB(bg, fg, dark ? 0.11 : 0.075), ...resolvePalette(config().palette, dark).map(c => toRGB(c, fg))]
    if (!colors.length || reduced) colors = colorGoals.map(c => [...c])
    ctx!.font = font
    labelW = Math.ceil(Math.max(20, ...weekdayRows.map(r => ctx!.measureText(r.label).width))) + 8
    const swatches = colorGoals.map(rgb)
    config().setTheme({ dark, swatches, accent: swatches[4] })
    kick()
  }
  function extent(cam: Cam, e: number, full: boolean) {
    const w = lerp(0.78, 0.9, e), off = (1 - w) / 2
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity
    const add = (x: number, y: number, z: number) => {
      const [px, py] = project(cam, x, y, z)
      minx = Math.min(minx, px); maxx = Math.max(maxx, px)
      miny = Math.min(miny, py); maxy = Math.max(maxy, py)
    }
    cells.forEach((c, i) => {
      const x = c.week + off, y = c.day + off, z = full ? heights[i] * e : zs[i]
      for (const [dx, dy] of [[0, 0], [w, 0], [0, w], [w, w]]) { add(x + dx, y + dy, z); add(x + dx, y + dy, 0) }
    })
    add(0, 7 + 1.5 * e, 0); add(weeks, 7 + 1.5 * e, 0)
    return { minx, maxx, miny, maxy }
  }
  function relayout() {
    const width = Math.round(stage.clientWidth)
    if (!width || !cells.length) return
    W = width; gutter = W < 520 ? 0 : labelW; dpr = Math.min(2, devicePixelRatio || 1)
    const b2 = extent(camera(0), 0, true), b3 = extent(camera(1), 1, true)
    H2 = 24 + (b2.maxy - b2.miny) / (b2.maxx - b2.minx) * (W - gutter - 4)
    const natural = (b3.maxy - b3.miny) / (b3.maxx - b3.minx) * (W - 40) + 40
    H3 = Math.max(Math.min(natural, W * 0.72, 620), Math.min(natural, 240))
    Hmax = Math.ceil(Math.max(H2, H3))
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(Hmax * dpr)
    canvas.style.width = W + "px"; canvas.style.height = Hmax + "px"
    lastH = -1
    config().setWidth(W)
    draw(); kick()
  }
  function draw() {
    if (!ctx || !W || !cells.length) return
    const e = easeInOutCubic(t), cam = camera(e, yaw, elev), H = lerp(H2, H3, e)
    if (Math.abs(H - lastH) > 0.2) { stage.style.height = H.toFixed(1) + "px"; lastH = H }
    cells.forEach((c, i) => { zs[i] = riseAt(t, c.week, weeks, c.day) * heights[i] })
    const b = extent(cam, e, false), pad = lerp(2, 20, e), left = pad + gutter * (1 - e), top = pad + 20 * (1 - e)
    const aw = W - left - pad, ah = H - top - pad, bw = Math.max(1e-6, b.maxx - b.minx), bh = Math.max(1e-6, b.maxy - b.miny)
    const s = Math.min(aw / bw, ah / bh), ox = left + (aw - bw * s) / 2 - b.minx * s, oy = top + (ah - bh * s) / 2 - b.miny * s
    const { cs, sn, se, ce } = cam
    const px = (x: number, y: number) => ox + (x * cs - y * sn) * s
    const py = (x: number, y: number, z: number) => oy + ((x * sn + y * cs) * se - z * ce) * s
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, Hmax)
    order.sort((a, b) => (cells[a].week - cells[b].week) * sn + (cells[a].day - cells[b].day) * cs)
    const w = lerp(0.78, 0.9, e), off = (1 - w) / 2, radius = lerp(0.17, 0.03, e) * s
    for (const i of order) {
      const c = cells[i], x0 = c.week + off, y0 = c.day + off, x1 = x0 + w, y1 = y0 + w, z = zs[i] + hover[i] * 0.7 * e, o = i * 24
      polys.set([px(x0, y0), py(x0, y0, z), px(x1, y0), py(x1, y0, z), px(x1, y1), py(x1, y1, z), px(x0, y1), py(x0, y1, z),
        px(x0, y1), py(x0, y1, 0), px(x1, y1), py(x1, y1, 0), px(x1, y1), py(x1, y1, z), px(x0, y1), py(x0, y1, z),
        px(x1, y0), py(x1, y0, 0), px(x1, y1), py(x1, y1, 0), px(x1, y1), py(x1, y1, z), px(x1, y0), py(x1, y0, z)], o)
      faces[i] = (z * ce * s > 0.35 && w * cs * s > 0.35 ? 1 : 0) | (z * ce * s > 0.35 && w * sn * s > 0.35 ? 2 : 0)
      let color = mixRGB(colors[c.level], colors[0], 0.72 * dim[i])
      color = mixRGB(color, fg, 0.16 * hover[i])
      if (faces[i] & 1) { quad(ctx, polys, o + 8); ctx.fillStyle = rgb(color.map(ch => ch * 0.84) as RGB); ctx.fill() }
      if (faces[i] & 2) { quad(ctx, polys, o + 16); ctx.fillStyle = rgb(color.map(ch => ch * 0.68) as RGB); ctx.fill() }
      quad(ctx, polys, o, radius); ctx.fillStyle = rgb(color); ctx.fill()
      if (e < 0.94) { ctx.strokeStyle = rgba(fg, (1 - e) * 0.07); ctx.lineWidth = 1; ctx.stroke() }
      if (hover[i] > 0.02) { ctx.strokeStyle = rgba(fg, 0.85 * hover[i]); ctx.lineWidth = 1.5; ctx.stroke() }
    }
    const muted = mixRGB(bg, fg, 0.55), a2 = 1 - smoothstep(0, 0.4, e), a3 = smoothstep(0.62, 1, e)
    ctx.font = font
    if (a2 > 0.004) {
      ctx.fillStyle = rgba(muted, a2); ctx.textAlign = "left"; ctx.textBaseline = "bottom"
      let edge = -Infinity
      for (const m of months) {
        const x = px(m.week + off, -0.3), width = ctx.measureText(m.label).width
        if (x < edge || x + width > W) continue
        ctx.fillText(m.label, x, py(m.week + off, -0.3, 0) - 3); edge = x + width + 6
      }
      ctx.textAlign = "right"; ctx.textBaseline = "middle"
      if (gutter) for (const r of weekdayRows) ctx.fillText(r.label, px(0, r.day + 0.5) - 6, py(0, r.day + 0.5, 0))
    }
    if (a3 > 0.004) {
      ctx.fillStyle = rgba(muted, a3); ctx.textAlign = "left"; ctx.textBaseline = "top"
      let edge = -Infinity
      for (const m of months) {
        const x = px(m.week + 0.5, 7.3), width = ctx.measureText(m.label).width
        if (x < edge || x + width > W) continue
        ctx.fillText(m.label, x, py(m.week + 0.5, 7.3, 0) + 2); edge = x + width + 10
      }
    }
    if (active >= 0 && active < cells.length) {
      const c = cells[active], z = zs[active] + hover[active] * 0.7 * e
      const tx = px(c.week + 0.5, c.day + 0.5), ty = py(c.week + off, c.day + off, z)
      const half = tipW / 2, cx = Math.min(W - half - 2, Math.max(half + 2, tx))
      tip.style.transform = `translate(${(cx - half).toFixed(1)}px,${(ty - 8).toFixed(1)}px) translateY(-100%)`
      tip.style.setProperty("--arrow", (tx - cx + half).toFixed(1) + "px")
    }
    canvas.dataset.ready = "true"
    canvas.dataset.progress = t.toFixed(3)
  }
  function tick(now: number) {
    raf = 0
    const cfg = config(), dt = Math.min(0.05, Math.max(0, (now - last) / 1000))
    last = now
    let moving = false
    if (t !== target) {
      const step = reduced ? 1 : dt * 1000 / Math.max(1, cfg.duration)
      t = target > t ? Math.min(target, t + step) : Math.max(target, t - step); moving = true
    }
    const approach = (v: number, goal: number, speed: number, epsilon: number) => {
      if (reduced || Math.abs(goal - v) <= epsilon) return goal
      moving = true
      return v + (goal - v) * (1 - Math.exp(-dt * speed))
    }
    yaw = approach(yaw, yawGoal, 12, 0.0001); elev = approach(elev, elevGoal, 12, 0.0001)
    colors = colors.map((color, i) => color.map((ch, j) => approach(ch, colorGoals[i][j], 7, 0.4)) as RGB)
    cells.forEach((c, i) => {
      hover[i] = approach(hover[i], i === active ? 1 : 0, 16, 0.003)
      dim[i] = approach(dim[i], cfg.legendLevel >= 0 && c.level !== cfg.legendLevel ? 1 : 0, 10, 0.003)
    })
    draw()
    if (moving) raf = requestAnimationFrame(tick)
    else canvas.dataset.settled = "true"
  }
  function setTarget() {
    if (!entered) return
    const goal = config().target
    if (goal !== target) {
      target = goal
      if (!goal) yawGoal = elevGoal = 0
    }
    canvas.style.cursor = config().orbit && target === 1 ? "grab" : "default"
    kick()
  }
  const local = (ev: PointerEvent) => { const r = canvas.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top] }
  function hit(x: number, y: number) {
    for (let k = order.length - 1; k >= 0; k--) {
      const i = order[k], o = i * 24
      if (pointInQuad(polys, o, x, y) || ((faces[i] & 1) && pointInQuad(polys, o + 8, x, y)) || ((faces[i] & 2) && pointInQuad(polys, o + 16, x, y))) return i
    }
    return -1
  }
  function onDown(ev: PointerEvent) {
    if (ev.button !== 0 || !ev.isPrimary) return
    const orbit = config().orbit && target === 1
    drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, yaw: yawGoal, elev: elevGoal, moved: false, orbit, mouse: ev.pointerType === "mouse" }
    canvas.setPointerCapture(ev.pointerId)
  }
  function onMove(ev: PointerEvent) {
    if (drag && ev.pointerId === drag.id) {
      const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y
      if (drag.moved || Math.hypot(dx, dy) > 4) {
        drag.moved = true
        if (drag.orbit) {
          yawGoal = Math.min(YAW_RANGE[1] - YAW_3D, Math.max(YAW_RANGE[0] - YAW_3D, drag.yaw + dx * 0.006))
          if (drag.mouse) elevGoal = Math.min(ELEV_RANGE[1] - ELEV_3D, Math.max(ELEV_RANGE[0] - ELEV_3D, drag.elev + dy * 0.004))
          canvas.style.cursor = "grabbing"; hovered = -1; refreshActive(); kick()
        }
        return
      }
    }
    if (ev.pointerType !== "mouse") return
    const [x, y] = local(ev); hovered = hit(x, y); refreshActive()
  }
  function cancelDrag() {
    const id = drag?.id
    drag = null
    if (id !== undefined && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id)
    canvas.style.cursor = config().orbit && target === 1 ? "grab" : "default"
  }
  function onUp(ev: PointerEvent) {
    if (!drag || drag.id !== ev.pointerId) return
    const moved = drag.moved
    cancelDrag()
    if (moved) return
    const [x, y] = local(ev), i = hit(x, y)
    pinned = i === pinned ? -1 : i
    if (ev.pointerType !== "mouse") hovered = -1
    refreshActive()
    if (i >= 0) { config().setAnnounce(config().describe(i)); config().onCellClick?.({ date: cells[i].date, count: cells[i].count }) }
  }
  const onLeave = () => { if (!drag) { hovered = -1; refreshActive() } }
  const reset = () => { yawGoal = elevGoal = 0; kick() }
  function onKey(ev: KeyboardEvent) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Escape", "Enter", " "].includes(ev.key)) return
    ev.preventDefault()
    if (ev.key === "Escape") { pinned = hovered = -1; refreshActive(); config().setAnnounce(""); return }
    let i = pinned >= 0 ? pinned : active >= 0 ? active : cells.length - 1
    if (ev.key === "Home") i = 0
    else if (ev.key === "End") i = cells.length - 1
    else if (ev.key === "ArrowLeft") i -= 7
    else if (ev.key === "ArrowRight") i += 7
    else if (ev.key === "ArrowUp") i--
    else if (ev.key === "ArrowDown") i++
    i = Math.max(0, Math.min(cells.length - 1, i))
    pinned = i; hovered = -1; refreshActive(); config().setAnnounce(config().describe(i))
    if (ev.key === "Enter" || ev.key === " ") config().onCellClick?.({ date: cells[i].date, count: cells[i].count })
  }
  const onBlur = () => { pinned = -1; refreshActive() }
  const onReduce = () => { reduced = reduceMq.matches; kick() }
  const enter = () => { if (entered) return; entered = true; setTarget() }
  load(); retheme(); relayout()
  const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { enter(); io.disconnect() } }, { threshold: 0.15 })
  io.observe(stage)
  const ro = new ResizeObserver(() => { if (Math.round(stage.clientWidth) !== W) relayout() })
  ro.observe(stage)
  const mo = new MutationObserver(retheme)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] })
  reduceMq.addEventListener("change", onReduce); darkMq.addEventListener("change", retheme)
  canvas.addEventListener("pointerdown", onDown); canvas.addEventListener("pointermove", onMove)
  canvas.addEventListener("pointerup", onUp); canvas.addEventListener("pointercancel", cancelDrag)
  canvas.addEventListener("lostpointercapture", cancelDrag); canvas.addEventListener("pointerleave", onLeave)
  canvas.addEventListener("dblclick", reset); canvas.addEventListener("keydown", onKey); canvas.addEventListener("blur", onBlur)
  return {
    kick: setTarget, reset, retheme,
    load: () => { load(); retheme(); relayout() },
    tipWidth: (width: number) => { tipW = width; draw() },
    destroy: () => {
      destroyed = true; cancelAnimationFrame(raf); io.disconnect(); ro.disconnect(); mo.disconnect(); cancelDrag()
      reduceMq.removeEventListener("change", onReduce); darkMq.removeEventListener("change", retheme)
      canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointermove", onMove)
      canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointercancel", cancelDrag)
      canvas.removeEventListener("lostpointercapture", cancelDrag); canvas.removeEventListener("pointerleave", onLeave)
      canvas.removeEventListener("dblclick", reset); canvas.removeEventListener("keydown", onKey); canvas.removeEventListener("blur", onBlur)
    },
  }
}
