import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dateRange, makeSnapshot } from './fetch-contributions.mjs'

const range = { from: '2026-11-06T00:00:00.000Z', to: '2026-11-08T12:00:00.000Z' }
const fixture = () => ({ data: { user: { login: 'mesharideb', contributionsCollection: { contributionCalendar: { totalContributions: 3, weeks: [{ contributionDays: [
  { date: '2026-11-06', contributionCount: 1, contributionLevel: 'FIRST_QUARTILE' },
  { date: '2026-11-07', contributionCount: 2, contributionLevel: 'SECOND_QUARTILE' },
  { date: '2026-11-08', contributionCount: 0, contributionLevel: 'NONE' },
] }] } } } } })
test('range covers 365 UTC calendar days including today', () => {
  const range = dateRange(new Date('2024-03-01T12:34:00Z'))
  assert.equal(range.from, '2023-03-03T00:00:00.000Z')
  assert.equal(range.to, '2024-03-01T12:34:00.000Z')
})
test('only publishable counts, levels and dates survive into the snapshot', () => {
  const result = makeSnapshot(fixture(), 'mesharideb', range)
  assert.equal(result.totalContributions, 3)
  assert.deepEqual(result.days[1], { date: '2026-11-07', count: 2, level: 2 })
  assert.equal(result.to, '2026-11-08')
})
test('partial responses, GraphQL errors and inconsistent totals fail closed', () => {
  assert.throws(() => makeSnapshot({ errors: [{ message: 'private diagnostic' }] }, 'mesharideb', range), /GraphQL error/)
  const partial = fixture(); partial.data.user.contributionsCollection.contributionCalendar.weeks[0].contributionDays.pop()
  assert.throws(() => makeSnapshot(partial, 'mesharideb', range), /Incomplete/)
  const mismatch = fixture(); mismatch.data.user.contributionsCollection.contributionCalendar.totalContributions++
  assert.throws(() => makeSnapshot(mismatch, 'mesharideb', range), /total/)
  assert.throws(() => makeSnapshot(fixture(), 'another-user', range), /invalid/)
})
test('invalid dates, duplicate days and negative counts cannot be published', () => {
  for (const mutate of [
    days => { days[0].date = '2026-02-30' },
    days => { days[1].date = days[0].date },
    days => { days[0].contributionCount = -2 },
  ]) {
    const data = fixture(); mutate(data.data.user.contributionsCollection.contributionCalendar.weeks[0].contributionDays)
    assert.throws(() => makeSnapshot(data, 'mesharideb', range))
  }
})
