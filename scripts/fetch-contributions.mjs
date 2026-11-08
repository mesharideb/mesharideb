import { mkdir, writeFile, rename } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const DAY_MS = 86400000
const levels = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 }
const root = fileURLToPath(new URL('../', import.meta.url))

export function dateRange(now = new Date()) {
  const day = Date.parse(now.toISOString().slice(0, 10) + 'T00:00:00Z')
  return { from: new Date(day - 364 * DAY_MS).toISOString(), to: now.toISOString() }
}

/** Validate the entire response before replacing the last successful snapshot. */
export function makeSnapshot(response, login, range, fetchedAt = new Date().toISOString()) {
  if (response.errors?.length) throw new Error('GitHub returned a GraphQL error. Previous data was preserved.')
  const user = response.data?.user
  const calendar = user?.contributionsCollection?.contributionCalendar
  if (user?.login?.toLowerCase() !== login.toLowerCase() || !Array.isArray(calendar?.weeks)) throw new Error('GitHub returned an invalid contribution calendar.')
  const first = range.from.slice(0, 10), last = range.to.slice(0, 10)
  const byDate = new Map()
  for (const week of calendar.weeks) {
    if (!Array.isArray(week.contributionDays)) throw new Error('Missing contribution days.')
    for (const day of week.contributionDays) {
      const date = day.date
      const ms = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(date + 'T00:00:00Z') : NaN
      if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== date) throw new Error('Invalid contribution date.')
      if (date < first || date > last) continue
      const count = day.contributionCount, level = levels[day.contributionLevel]
      if (!Number.isSafeInteger(count) || count < 0 || level === undefined || (count === 0) !== (level === 0) || byDate.has(date)) throw new Error('Invalid or duplicate contribution day.')
      byDate.set(date, { date, count, level })
    }
  }
  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  const expected = (Date.parse(last) - Date.parse(first)) / DAY_MS + 1
  if (days.length !== expected || days[0]?.date !== first || days.at(-1)?.date !== last) throw new Error('Incomplete contribution calendar. Previous data was preserved.')
  const total = days.reduce((sum, day) => sum + day.count, 0)
  if (!Number.isSafeInteger(calendar.totalContributions) || total !== calendar.totalContributions) throw new Error('Contribution total does not match the daily counts.')
  return { schemaVersion: 1, login: user.login, from: first, to: last, fetchedAt, totalContributions: total, days }
}

async function main() {
  const login = process.env.SKYLINE_USERNAME || 'mesharideb'
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(login)) throw new Error('Invalid GitHub username.')
  const range = dateRange()
  const query = `query($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) { login contributionsCollection(from: $from, to: $to) {
      contributionCalendar { totalContributions weeks { contributionDays { date contributionCount contributionLevel } } }
    } }
  }`
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  if (!token) throw new Error('Set GH_TOKEN to a token with read:user scope. Previous data was preserved.')
  let response
  try {
    const reply = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'user-agent': 'contribution-skyline' },
      body: JSON.stringify({ query, variables: { login, ...range } }),
      signal: AbortSignal.timeout(60000),
    })
    if (!reply.ok) throw new Error(String(reply.status))
    response = await reply.json()
  } catch {
    throw new Error('Could not read GitHub contributions. Check GH_TOKEN. Previous data was preserved.')
  }
  const snapshot = makeSnapshot(response, login, range)
  await mkdir(resolve(root, 'data'), { recursive: true })
  const path = resolve(root, 'data/contributions.json')
  await writeFile(path + '.tmp', JSON.stringify(snapshot, null, 2) + '\n')
  await rename(path + '.tmp', path)
  console.log(`Saved ${snapshot.days.length} days for ${snapshot.login}: ${snapshot.totalContributions} contributions through ${snapshot.to}.`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
