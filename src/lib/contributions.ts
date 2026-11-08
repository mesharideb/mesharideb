export type ContributionDay = { date: string; count: number; level?: number }
export type Cell = ContributionDay & { level: number; week: number; day: number }
export type Streak = { days: number; start: string | null; end: string | null }
export type RGB = [number, number, number]
export type View = "2d" | "3d"
export type PaletteName = "github" | "halloween" | "ocean" | "ember" | "grape" | "mono"
export type PaletteInput = PaletteName | string[] | { light: string[]; dark: string[] }
export const DAY_MS = 86400000
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const easeInOutCubic = (x: number) => {
  const t = clamp01(x)
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2
}
export const easeOutCubic = (x: number) => 1 - (1 - clamp01(x)) ** 3
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
export const toKey = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Date-only strings are literal UTC calendar days; impossible dates are rejected. */
export function dayMs(value: string | number | Date): number {
  if (typeof value === "number") return Math.floor(value / DAY_MS) * DAY_MS
  if (value instanceof Date) {
    return dayMs(`${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN
  const ms = Date.parse(value + "T00:00:00.000Z")
  return Number.isFinite(ms) && toKey(ms) === value ? ms : NaN
}

export const levelOf = (count: number, busy: number) => count <= 0 ? 0 : busy <= 0 ? 4 : 1 + Math.min(3, Math.floor(count / busy * 4))

/** Exactly 365 dates. Leading/trailing week positions remain empty, not invented days. */
export function buildGrid(data: ContributionDay[], endMs: number, weekStart = 0) {
  if (!Number.isFinite(endMs)) throw new Error("The chart requires a valid end date.")
  const end = dayMs(endMs)
  const start = end - 364 * DAY_MS
  const offset = (new Date(start).getUTCDay() - weekStart + 7) % 7
  const counts = new Map<string, { count: number; level?: number }>()
  for (const entry of data) {
    if (!entry || typeof entry.date !== "string") continue
    const ms = dayMs(entry.date)
    if (!Number.isFinite(ms) || ms < start || ms > end || !Number.isSafeInteger(entry.count) || entry.count < 0) continue
    const prev = counts.get(entry.date)
    const count = (prev?.count ?? 0) + entry.count
    if (!Number.isSafeInteger(count)) continue
    counts.set(entry.date, { count, level: prev ? undefined : entry.level })
  }
  const cells: Cell[] = Array.from({ length: 365 }, (_, i) => {
    const date = toKey(start + i * DAY_MS)
    return { date, count: counts.get(date)?.count ?? 0, level: 0, week: Math.floor((i + offset) / 7), day: (i + offset) % 7 }
  })
  const nonzero = cells.map(c => c.count).filter(c => c > 0).sort((a, b) => a - b)
  const busy = nonzero[Math.floor(0.95 * (nonzero.length - 1))] ?? 0
  for (const c of cells) {
    const supplied = counts.get(c.date)?.level
    c.level = c.count === 0 ? 0 : supplied != null && Number.isInteger(supplied) && supplied >= 1 && supplied <= 4 ? supplied : levelOf(c.count, busy)
  }
  return { cells, weeks: cells.at(-1)!.week + 1, max: nonzero.at(-1) ?? 0 }
}

export function computeStats(cells: Cell[]) {
  let total = 0, run = 0
  let runStart: string | null = null
  let busiest: { count: number; date: string | null } = { count: 0, date: null }
  let longest: Streak = { days: 0, start: null, end: null }
  for (const c of cells) {
    total += c.count
    if (c.count > busiest.count) busiest = { count: c.count, date: c.date }
    if (c.count > 0) {
      if (!run) runStart = c.date
      run++
      if (run > longest.days) longest = { days: run, start: runStart, end: c.date }
    } else run = 0
  }
  let j = cells.length - 1
  if (j >= 0 && cells[j].count === 0) j--
  const end = j
  while (j >= 0 && cells[j].count > 0) j--
  const days = end - j
  const current: Streak = days > 0 ? { days, start: cells[j + 1].date, end: cells[end].date } : { days: 0, start: null, end: null }
  return { total, first: cells[0]?.date ?? null, last: cells.at(-1)?.date ?? null, busiest, longest, current }
}

export function monthLabels(cells: Cell[], locale = "en-US") {
  const fmt = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" })
  const out: { week: number; label: string }[] = []
  let prev = "", prevWeek = -1
  for (const c of cells) {
    if (c.week === prevWeek) continue
    prevWeek = c.week
    const month = c.date.slice(0, 7)
    if (month !== prev) out.push({ week: c.week, label: fmt.format(dayMs(c.date)) })
    prev = month
  }
  if (out.length > 1 && out[1].week - out[0].week < 3) out.shift()
  return out
}

export const barHeight = (count: number, max: number, scale = 1) => count > 0 && max > 0 ? 0.4 + (count / max) ** 0.85 * 7.2 * Math.max(0, scale) : 0.2
export const WAVE = 0.42
export const riseAt = (t: number, week: number, weeks: number, day: number) => easeOutCubic((t - (weeks > 1 ? week / (weeks - 1) : 0) * 0.36 - day / 6 * 0.06) / (1 - WAVE))
export const YAW_3D = Math.PI / 4
export const ELEV_3D = 34 * Math.PI / 180
export const YAW_RANGE = [8 * Math.PI / 180, 82 * Math.PI / 180] as const
export const ELEV_RANGE = [18 * Math.PI / 180, 62 * Math.PI / 180] as const
export type Cam = { cs: number; sn: number; se: number; ce: number }
export function camera(e: number, dYaw = 0, dElev = 0): Cam {
  const yaw = lerp(0, Math.min(YAW_RANGE[1], Math.max(YAW_RANGE[0], YAW_3D + dYaw)), e)
  const elev = lerp(Math.PI / 2, Math.min(ELEV_RANGE[1], Math.max(ELEV_RANGE[0], ELEV_3D + dElev)), e)
  return { cs: Math.cos(yaw), sn: Math.sin(yaw), se: Math.sin(elev), ce: Math.cos(elev) }
}
export const project = (c: Cam, x: number, y: number, z: number): [number, number] => [x * c.cs - y * c.sn, (x * c.sn + y * c.cs) * c.se - z * c.ce]
export const mixRGB = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
export const luminance = (c: RGB) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255
export const PALETTES: Record<PaletteName, { light: string[]; dark: string[] }> = {
  github: { light: ["#c6e48b", "#7bc96f", "#239a3b", "#196127"], dark: ["#0e4429", "#006d32", "#26a641", "#39d353"] },
  halloween: { light: ["#ffee4a", "#ffc501", "#fe9600", "#b33c00"], dark: ["#631c03", "#bd561d", "#fa7a18", "#fddf68"] },
  ocean: { light: ["#b8e3f5", "#6ec3eb", "#2a8fd1", "#0b4f8a"], dark: ["#0c2d4a", "#12508a", "#2a88d8", "#7cc7ff"] },
  ember: { light: ["#fde2c4", "#fbad6e", "#f06b3a", "#b3261e"], dark: ["#4a1a10", "#8f2f16", "#e0572a", "#ffa46b"] },
  grape: { light: ["#e4d4fb", "#b794f4", "#805ad5", "#44337a"], dark: ["#2d1f4f", "#553c9a", "#8b5cf6", "#c4b5fd"] },
  mono: { light: ["#d4d4d4", "#a3a3a3", "#525252", "#171717"], dark: ["#333333", "#5c5c5c", "#a3a3a3", "#fafafa"] },
}
export function resolvePalette(p: PaletteInput = "github", dark = false) {
  const base = PALETTES.github[dark ? "dark" : "light"]
  const pick = Array.isArray(p) ? p : typeof p === "object" ? p[dark ? "dark" : "light"] : (PALETTES[p] ?? PALETTES.github)[dark ? "dark" : "light"]
  return [0, 1, 2, 3].map(i => pick[i] ?? pick.at(-1) ?? base[i])
}
