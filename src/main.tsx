import * as React from "react"
import { createRoot } from "react-dom/client"
import ContributionSkyline from "./components/contribution-skyline"
import { DAY_MS, PALETTES, type PaletteName } from "./lib/contributions"
import snapshot from "../data/contributions.json"
import "./styles.css"

const params = new URLSearchParams(location.search)
const profile = params.get("profile") === "1"
const initialTheme = params.get("theme")
const user = snapshot.login
const profileUrl = `https://github.com/${user}`

function App() {
  const [palette, setPalette] = React.useState<PaletteName>("github")
  const [dark, setDark] = React.useState(initialTheme ? initialTheme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches)
  React.useLayoutEffect(() => { document.documentElement.dataset.theme = dark ? "dark" : "light" }, [dark])
  React.useLayoutEffect(() => { if (profile) document.documentElement.dataset.profile = "1" }, [])
  const updated = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(snapshot.fetchedAt))
  const stale = Date.now() - Date.parse(snapshot.fetchedAt) > 2 * DAY_MS
  const chart = <ContributionSkyline data={snapshot.days} endDate={snapshot.to} palette={palette} showToggle={!profile} orbit={!profile} showDetailStats={!profile} footer={profile ? <span>@{user} · Updated {updated} UTC</span> : undefined} />
  if (profile) return <main className="profile-render" data-testid="profile-render">{chart}</main>
  return <div className="page-shell">
    <nav className="topbar" aria-label="Main navigation"><a className="wordmark" href={profileUrl}><span className="brand-square" />{user}<span className="wordmark-slash">/</span><span className="wordmark-sub">skyline</span></a><a className="github-link" href={profileUrl}>View GitHub <span aria-hidden="true">↗</span></a></nav>
    <main>
      <div className="intro"><p className="eyebrow"><span />365 days of building</p><h1>A year, built<br className="mobile-break" /> day by day<span>.</span></h1><p className="intro-copy">Every contribution leaves a mark. Explore a year of my GitHub activity, from a familiar grid to a skyline of work.</p></div>
      <div className="chart-toolbar"><div className="snapshot-label"><span className={stale ? "status-dot stale" : "status-dot"} />{stale ? "Saved" : "Latest"} GitHub snapshot <span className="toolbar-date">· {updated}</span></div><div className="appearance-controls"><label className="sr-only" htmlFor="palette">Color palette</label><select id="palette" value={palette} onChange={e => setPalette(e.target.value as PaletteName)}>{Object.keys(PALETTES).map(p => <option key={p} value={p}>{p === "github" ? "GitHub green" : p[0].toUpperCase() + p.slice(1)}</option>)}</select><button type="button" className="theme-toggle" aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} onClick={() => setDark(v => !v)}>{dark ? "☀" : "☾"}</button></div></div>
      {chart}
      <div className="chart-caption"><span>One box per day. Height shows contribution count.</span><span>Refreshed daily · Dates in UTC</span></div>
      {stale && <p className="stale-note" role="status">This snapshot was last refreshed on {updated}. Counts and streaks are shown through {snapshot.to}.</p>}
      <details className="data-details"><summary>View daily contributions as a table</summary><div className="table-scroll" tabIndex={0} role="region" aria-label="Daily contribution counts"><table><caption>GitHub activity from {snapshot.from} through {snapshot.to}</caption><thead><tr><th scope="col">Date (UTC)</th><th scope="col">Contributions</th></tr></thead><tbody>{snapshot.days.slice().reverse().map(d => <tr key={d.date}><th scope="row">{d.date}</th><td>{d.count}</td></tr>)}</tbody></table></div></details>
    </main>
    <footer className="page-footer"><span>Small steps. A visible history.</span><a href={`${profileUrl}/${user}`}>Source on GitHub <span aria-hidden="true">↗</span></a></footer>
  </div>
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>)
