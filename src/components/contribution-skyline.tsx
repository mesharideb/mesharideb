"use client"

import * as React from "react"
import { buildGrid, computeStats, dayMs, monthLabels, resolvePalette, type ContributionDay, type PaletteInput, type View } from "../lib/contributions"
import { createSkylineEngine, type ChartTheme, type EngineConfig } from "../lib/skyline-engine"

export type { ContributionDay, PaletteInput, View }
export interface ContributionSkylineProps {
  /** Real daily data is required; an empty array renders an honest empty year. */
  data: ContributionDay[]
  endDate?: string | Date
  view?: View
  defaultView?: View
  onViewChange?: (view: View) => void
  palette?: PaletteInput
  title?: React.ReactNode
  unit?: string
  unitPlural?: string
  heightScale?: number
  duration?: number
  weekStart?: 0 | 1
  orbit?: boolean
  showStats?: boolean
  /** Per-day peaks and streaks misrepresent work done in private repos; the profile render shows the total alone. */
  showDetailStats?: boolean
  showLegend?: boolean
  showToggle?: boolean
  footer?: React.ReactNode
  locale?: string
  onCellClick?: (day: ContributionDay) => void
  className?: string
}

function ViewIcon({ cube }: { cube: boolean }) {
  return <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
    {cube ? <><path d="M8 1.2 14.2 4.6v6.8L8 14.8 1.8 11.4V4.6Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /><path d="M1.8 4.6 8 8l6.2-3.4M8 8v6.8" fill="none" stroke="currentColor" strokeWidth="1.4" /></> : <>{[1.5, 9].flatMap(x => [1.5, 9].map(y => <rect key={`${x}-${y}`} x={x} y={y} width="5.5" height="5.5" rx="1" fill="currentColor" />))}</>}
  </svg>
}

type StatData = { label: string; value: string; unit: string; sub: string }
function Stat({ label, value, unit, sub, accent, size = 28 }: StatData & { accent: string; size?: number }) {
  return <div className="skyline-stat">
    <div className="stat-label">{label}</div>
    <div className="stat-value"><strong style={{ color: accent, fontSize: size }}>{value}</strong><span>{unit}</span></div>
    <div className="stat-sub">{sub}</div>
  </div>
}

export default function ContributionSkyline({
  data, endDate, view: controlledView, defaultView = "3d", onViewChange, palette = "github", title,
  unit = "contribution", unitPlural, heightScale = 1, duration = 1300, weekStart = 0, orbit = true,
  showStats = true, showDetailStats = true, showLegend = true, showToggle = true, footer, locale = "en-US", onCellClick, className = "",
}: ContributionSkylineProps) {
  const latest = data.reduce((end, day) => Math.max(end, Number.isFinite(dayMs(day.date)) ? dayMs(day.date) : -Infinity), -Infinity)
  const end = endDate == null ? Number.isFinite(latest) ? latest : dayMs(new Date()) : dayMs(endDate)
  const model = React.useMemo(() => {
    const grid = buildGrid(data, end, weekStart)
    return { ...grid, stats: computeStats(grid.cells), months: monthLabels(grid.cells, locale) }
  }, [data, end, weekStart, locale])
  const [innerView, setInnerView] = React.useState<View>(defaultView)
  const view = controlledView ?? innerView, is3d = view === "3d"
  const setView = (next: View) => { if (controlledView === undefined) setInnerView(next); onViewChange?.(next) }
  const [theme, setTheme] = React.useState<ChartTheme>(() => {
    const pal = resolvePalette(palette)
    return { dark: false, swatches: ["#ebedf0", ...pal], accent: pal[3] }
  })
  const [width, setWidth] = React.useState(0), [active, setActive] = React.useState(-1)
  const [hoverLevel, setHoverLevel] = React.useState(-1), [selectedLevel, setSelectedLevel] = React.useState(-1)
  const [announce, setAnnounce] = React.useState("")
  const legendLevel = hoverLevel >= 0 ? hoverLevel : selectedLevel
  const rootRef = React.useRef<HTMLElement>(null), stageRef = React.useRef<HTMLDivElement>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null), tipRef = React.useRef<HTMLDivElement>(null)
  const engine = React.useRef<ReturnType<typeof createSkylineEngine>>(null)
  const nf = React.useMemo(() => new Intl.NumberFormat(locale), [locale])
  const df = React.useMemo(() => new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" }), [locale])
  const dfy = React.useMemo(() => new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }), [locale])
  const plural = unitPlural ?? unit + "s", noun = (n: number) => n === 1 ? unit : plural
  const describe = (i: number) => { const c = model.cells[i]; return c ? `${nf.format(c.count)} ${noun(c.count)} on ${dfy.format(dayMs(c.date))}` : "" }
  const cfg = React.useRef<EngineConfig>(null!)
  cfg.current = { model, duration, heightScale, orbit, palette, legendLevel, target: is3d ? 1 : 0, locale, setActive, setWidth, setTheme, setAnnounce, describe, onCellClick }
  React.useEffect(() => {
    if (!rootRef.current || !stageRef.current || !canvasRef.current || !tipRef.current) return
    engine.current = createSkylineEngine(rootRef.current, stageRef.current, canvasRef.current, tipRef.current, () => cfg.current)
    return () => { engine.current?.destroy(); engine.current = null }
  }, [])
  React.useEffect(() => { engine.current?.kick() }, [view, legendLevel, orbit])
  React.useEffect(() => { engine.current?.load() }, [model, heightScale])
  React.useEffect(() => { engine.current?.retheme() }, [palette])
  React.useLayoutEffect(() => { if (tipRef.current && active >= 0) engine.current?.tipWidth(tipRef.current.offsetWidth) }, [active, model, width, locale, unit, unitPlural])
  const { stats } = model
  const range = (a: string | null, b: string | null, year = false) => a && b ? `${(year ? dfy : df).format(dayMs(a))} to ${(year ? dfy : df).format(dayMs(b))}` : "None yet"
  const statBlocks: StatData[] = [
    { label: "1 year total", value: nf.format(stats.total), unit: noun(stats.total), sub: range(stats.first, stats.last, true) },
    ...showDetailStats ? [
      { label: "Busiest day", value: nf.format(stats.busiest.count), unit: noun(stats.busiest.count), sub: stats.busiest.date ? df.format(dayMs(stats.busiest.date)) : "None yet" },
      { label: "Longest streak", value: nf.format(stats.longest.days), unit: stats.longest.days === 1 ? "day" : "days", sub: range(stats.longest.start, stats.longest.end) },
      { label: "Current streak", value: nf.format(stats.current.days), unit: stats.current.days === 1 ? "day" : "days", sub: range(stats.current.start, stats.current.end) },
    ] : [],
  ]
  const corners = showStats && width >= 700, showRow = showStats && !(corners && is3d)
  const bigSize = Math.round(Math.max(30, Math.min(54, width * 0.055)))
  const levels = [`No ${plural}`, "Light", "Moderate", "Heavy", "Heaviest"]
  return <section ref={rootRef} className={`skyline ${className}`} data-testid="skyline" aria-label="Contribution skyline">
    <header className="skyline-header">
      <h2>{title ?? <><strong className="tabular-nums">{nf.format(stats.total)}</strong> {noun(stats.total)} in the last year</>}</h2>
      {showToggle && <div className="view-toggle" role="group" aria-label="Chart view">
        <span aria-hidden="true" className="view-indicator" style={{ transform: is3d ? "translateX(100%)" : "translateX(0)" }} />
        {(["2d", "3d"] as const).map(v => <button key={v} type="button" aria-pressed={view === v} aria-label={v === "2d" ? "Flat heat map" : "3D skyline"} title={v === "2d" ? "Flat heat map" : "3D skyline"} onClick={() => setView(v)}><ViewIcon cube={v === "3d"} /></button>)}
      </div>}
    </header>
    <div className="skyline-frame">
      <div className="skyline-stage-wrap">
        <div ref={stageRef} className="skyline-stage" style={{ height: 150 }}>
          <canvas ref={canvasRef} tabIndex={0} role="img" aria-label={`${nf.format(stats.total)} ${plural}, ${range(stats.first, stats.last, true)}, shown as a ${is3d ? "3D skyline" : "heat map"}. Use arrow keys to explore days, Home and End to jump, and Escape to dismiss.`} style={{ touchAction: is3d && orbit ? "pan-y" : "auto" }} />
          {corners && <>
            <div className="corner-stats top" aria-hidden={!is3d} style={{ opacity: is3d ? 1 : 0, transform: `translateY(${is3d ? 0 : -10}px)`, transitionDelay: is3d ? `${duration * 0.55}ms` : "0ms" }}>
              {statBlocks.slice(0, 2).map(s => <Stat key={s.label} {...s} accent={theme.accent} size={bigSize} />)}
            </div>
            {statBlocks.length > 2 && <div className="corner-stats bottom" aria-hidden={!is3d} style={{ opacity: is3d ? 1 : 0, transform: `translateY(${is3d ? 0 : 10}px)`, transitionDelay: is3d ? `${duration * 0.65}ms` : "0ms" }}>
              {statBlocks.slice(2).map(s => <Stat key={s.label} {...s} accent={theme.accent} size={bigSize} />)}
            </div>}
          </>}
        </div>
        <div ref={tipRef} role="tooltip" aria-hidden={active < 0} className="skyline-tooltip" style={{ opacity: active >= 0 ? 1 : 0 }}>
          {active >= 0 ? describe(active) : "\u00a0"}<span aria-hidden="true" />
        </div>
      </div>
      {showStats && <div className="stat-collapse" aria-hidden={!showRow} style={{ gridTemplateRows: showRow ? "1fr" : "0fr", opacity: showRow ? 1 : 0, transitionDuration: `${duration}ms` }}><div><div className="stat-row">{statBlocks.map(s => <Stat key={s.label} {...s} accent={theme.accent} />)}</div></div></div>}
      <footer className="skyline-footer">
        {footer === undefined ? <span>{is3d && orbit ? <>Drag to orbit · <button className="text-button" onClick={() => engine.current?.reset()}>Reset view</button></> : "Hover a day · arrow keys to explore"}</span> : footer}
        {showLegend && <div className="legend" role="group" aria-label="Contribution intensity" onMouseLeave={() => setHoverLevel(-1)}>
          <span>Less</span>{theme.swatches.map((color, i) => <button key={i} type="button" aria-label={`Highlight ${levels[i].toLowerCase()} days`} aria-pressed={selectedLevel === i} title={levels[i]} onMouseEnter={() => setHoverLevel(i)} onFocus={() => setHoverLevel(i)} onBlur={() => setHoverLevel(-1)} onClick={() => setSelectedLevel(prev => prev === i ? -1 : i)} style={{ background: color }} />)}<span>More</span>
        </div>}
      </footer>
    </div>
    <p aria-live="polite" aria-atomic="true" className="sr-only">{announce}</p>
  </section>
}
