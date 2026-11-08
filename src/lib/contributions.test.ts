import { test } from "node:test"
import assert from "node:assert/strict"
import { buildGrid, camera, computeStats, dayMs, project, resolvePalette, riseAt } from "./contributions.ts"

test("calendar dates are timezone-independent and reject impossible dates", () => {
  assert.equal(dayMs("2024-02-29"), Date.UTC(2024, 1, 29))
  for (const value of ["2025-02-29", "2026-13-01", "not-a-date", "2026-11-08T00:00:00Z"]) assert.ok(Number.isNaN(dayMs(value)))
})
test("a leap-year window contains exactly 365 dates with correct weekday positions", () => {
  const { cells } = buildGrid([], dayMs("2024-03-01"), 1)
  assert.equal(cells.length, 365)
  assert.equal(cells[0].date, "2023-03-03")
  assert.equal(cells.at(-1)?.date, "2024-03-01")
  assert.equal(cells.at(-1)?.day, 4)
  assert.ok(cells.some(c => c.date === "2024-02-29"))
})
test("real levels are preserved, duplicate dates add up, invalid counts are ignored", () => {
  const { cells } = buildGrid([
    { date: "2026-11-07", count: 8, level: 4 },
    { date: "2026-11-08", count: 2 }, { date: "2026-11-08", count: 3 },
    { date: "2026-11-08", count: -1 }, { date: "2026-11-08", count: Infinity },
    { date: "2026-11-09", count: 999 }, { date: "2025-11-08", count: 999 },
  ], dayMs("2026-11-08"))
  assert.equal(computeStats(cells).total, 13)
  assert.equal(cells.at(-2)?.level, 4)
  assert.equal(cells.at(-1)?.count, 5)
})
test("current streak includes yesterday but not a gap of two empty days", () => {
  const data = [6, 7].map(n => ({ date: `2026-11-0${n}`, count: 1 }))
  const first = computeStats(buildGrid(data, dayMs("2026-11-08")).cells)
  assert.deepEqual(first.current, { days: 2, start: "2026-11-06", end: "2026-11-07" })
  assert.equal(first.longest.days, 2)
  assert.equal(computeStats(buildGrid(data, dayMs("2026-11-09")).cells).current.days, 0)
})
test("empty data never generates activity", () => {
  const stats = computeStats(buildGrid([], dayMs("2026-11-08")).cells)
  assert.equal(stats.total, 0); assert.equal(stats.busiest.date, null); assert.equal(stats.current.days, 0)
})
test("morph endpoints flatten or raise every cell, including the final weekday", () => {
  for (let w = 0; w < 53; w++) for (let d = 0; d < 7; d++) {
    assert.equal(riseAt(0, w, 53, d), 0)
    assert.ok(Math.abs(riseAt(1, w, 53, d) - 1) < 1e-12)
  }
  const [x, y] = project(camera(0, 0.4, 0.2), 12, 3, 7)
  assert.equal(x, 12); assert.ok(Math.abs(y - 3) < 1e-10)
  assert.equal(resolvePalette(undefined).length, 4)
  assert.equal(resolvePalette([]).length, 4)
})
