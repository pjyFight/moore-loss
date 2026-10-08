import assert from 'node:assert/strict'
import test from 'node:test'
import { buildComparison, buildComparisons, COMPARISON_MODES, formatErrorFixed } from './compare.js'

const runs = [
  { name: 'A', color: '#6d5dfc', points: [
    { step: 0, loss: 2, gradNorm: 4 },
    { step: 100, loss: 4, gradNorm: 5 },
    { step: 200, loss: 6, gradNorm: 8 },
  ] },
  { name: 'B', color: '#17b992', points: [
    { step: 0, loss: 1, gradNorm: 2 },
    { step: 100, loss: 2, gradNorm: 3 },
    { step: 200, loss: 3, gradNorm: 4 },
  ] },
]

const multiRuns = [
  { id: 'run-a', name: 'A', color: '#6d5dfc', points: [
    { step: 0, loss: 10, gradNorm: 4 },
    { step: 100, loss: 8, gradNorm: 5 },
  ] },
  { id: 'run-b', name: 'B', color: '#17b992', points: [
    { step: 0, loss: 9, gradNorm: 3 },
    { step: 100, loss: 6, gradNorm: 4 },
  ] },
  { id: 'run-c', name: 'C', color: '#e76f51', points: [
    { step: 0, loss: 8, gradNorm: 2 },
    { step: 100, loss: 4, gradNorm: 3 },
  ] },
  { id: 'run-d', name: 'D', color: '#f2a93b', points: [
    { step: 0, loss: 7, gradNorm: 1 },
    { step: 100, loss: 2, gradNorm: 2 },
  ] },
]

test('modes follow the requested TrainingLogParser order', () => {
  assert.deepEqual(Object.keys(COMPARISON_MODES), ['absolute', 'relative_abs', 'normal', 'relative_normal'])
})

test('all modes return an empty result before two files are uploaded', () => {
  for (const mode of Object.keys(COMPARISON_MODES)) {
    for (const selected of [[], [runs[0]]]) {
      const result = buildComparison(selected, 'loss', mode)
      assert.deepEqual(result.rawSeries, [])
      assert.deepEqual(result.errorSeries, [])
      assert.deepEqual(result.labels, [])
      assert.equal(result.errorStats.mean, null)
    }
  }
})

test('absolute comparison exposes raw traces and absolute per-step differences', () => {
  const result = buildComparison(runs, 'loss', 'absolute')
  assert.deepEqual(result.rawSeries.map((series) => series.points.map((point) => point.value)), [[2, 4, 6], [1, 2, 3]])
  assert.deepEqual(result.errorSeries[0].points.map((point) => point.value), [1, 2, 3])
  assert.equal(result.errorStats.mean, 2)
  assert.equal(result.errorStats.meanSquare, 14 / 3)
})

test('relative absolute and relative normal use A as denominator', () => {
  const relativeAbs = buildComparison(runs, 'loss', 'relative_abs')
  const relativeNormal = buildComparison(runs, 'loss', 'relative_normal')
  assert.deepEqual(relativeAbs.errorSeries[0].points.map((point) => point.value), [0.5, 0.5, 0.5])
  assert.deepEqual(relativeNormal.errorSeries[0].points.map((point) => point.value), [0.5, 0.5, 0.5])
})

test('normal comparison preserves the sign of A minus B', () => {
  const result = buildComparison([
    { name: 'A', points: [{ step: 0, loss: 1 }, { step: 100, loss: 2 }] },
    { name: 'B', points: [{ step: 0, loss: 2 }, { step: 100, loss: 1 }] },
  ], 'loss', 'normal')
  assert.deepEqual(result.errorSeries[0].points.map((point) => point.value), [-1, 1])
  assert.equal(result.errorStats.min, -1)
})

test('run names containing baseline are still treated as ordinary traces', () => {
  const result = buildComparison([
    { name: 'baseline.log', color: '#6d5dfc', points: [{ step: 0, loss: 2 }] },
    { name: 'moore.log', color: '#17b992', points: [{ step: 0, loss: 1 }] },
  ], 'loss', 'absolute')
  assert.equal(result.rawSeries[0].baseline, undefined)
  assert.equal(result.rawSeries[1].baseline, undefined)
})

test('summary error formatting preserves eight decimal places', () => {
  assert.equal(formatErrorFixed(0.0712345, 'absolute'), '0.07123450')
  assert.equal(formatErrorFixed(-0.0000001, 'normal'), '-0.00000010')
  assert.equal(formatErrorFixed(0.123456789, 'relative_abs'), '12.34567890%')
})

test('aligns by shared steps, not array indices', () => {
  const uneven = [
    { name: 'A', points: [{ step: 0, loss: 10 }, { step: 100, loss: 3 }, { step: 200, loss: 5 }] },
    { name: 'B', points: [{ step: 100, loss: 1 }, { step: 200, loss: 1 }] },
  ]
  const result = buildComparison(uneven, 'loss', 'absolute')
  assert.deepEqual(result.labels, [100, 200])
  assert.deepEqual(result.errorSeries[0].points.map((point) => point.value), [2, 4])
})

test('does not invent a comparison when steps do not overlap', () => {
  const disjoint = [runs[0], { name: 'B', points: [{ step: 50, loss: 1 }] }]
  const result = buildComparison(disjoint, 'loss', 'absolute')
  assert.deepEqual(result.errorSeries, [])
  assert.deepEqual(result.rawSeries, [])
})

test('builds one comparison from the baseline to every other uploaded run', () => {
  const results = buildComparisons(multiRuns, 'loss', 'absolute', 'run-a')

  assert.equal(results.length, 3)
  assert.deepEqual(results.map(({ baseline, candidate }) => [baseline.id, candidate.id]), [
    ['run-a', 'run-b'],
    ['run-a', 'run-c'],
    ['run-a', 'run-d'],
  ])
  assert.deepEqual(results.map(({ comparison }) => comparison.rawSeries.map((series) => series.label)), [
    ['A', 'B'],
    ['A', 'C'],
    ['A', 'D'],
  ])
  assert.deepEqual(results.map(({ comparison }) => comparison.errorSeries[0].points.map((point) => point.value)), [
    [1, 2],
    [2, 4],
    [3, 6],
  ])
})

test('supports selecting a non-first baseline by id or zero-based index', () => {
  const byId = buildComparisons(multiRuns, 'loss', 'normal', 'run-c')
  const byIndex = buildComparisons(multiRuns, 'loss', 'normal', 2)

  for (const results of [byId, byIndex]) {
    assert.deepEqual(results.map(({ baseline, candidate }) => [baseline.id, candidate.id]), [
      ['run-c', 'run-a'],
      ['run-c', 'run-b'],
      ['run-c', 'run-d'],
    ])
    assert.deepEqual(results.map(({ comparison }) => comparison.errorSeries[0].points.map((point) => point.value)), [
      [-2, -4],
      [-1, -2],
      [1, 2],
    ])
  }
})

test('selected baseline is the denominator for every relative comparison', () => {
  const results = buildComparisons(multiRuns, 'loss', 'relative_normal', 'run-c')
  assert.deepEqual(results.map(({ comparison }) => comparison.errorSeries[0].points.map((point) => point.value)), [
    [-0.25, -1],
    [-0.125, -0.5],
    [0.125, 0.5],
  ])
})

test('multi-file comparison respects the selected metric', () => {
  const results = buildComparisons(multiRuns, 'gradNorm', 'absolute', 'run-a')
  assert.deepEqual(results.map(({ comparison }) => comparison.errorSeries[0].points.map((point) => point.value)), [
    [1, 1],
    [2, 2],
    [3, 3],
  ])
})

test('each baseline pair uses its own shared finite steps', () => {
  const unevenRuns = [
    { id: 'base', name: 'Baseline', points: [
      { step: 0, loss: 8 }, { step: 100, loss: 6 }, { step: 200, loss: 4 },
    ] },
    { id: 'left', name: 'Left', points: [{ step: 0, loss: 7 }, { step: 100, loss: Number.NaN }] },
    { id: 'right', name: 'Right', points: [{ step: 100, loss: 4 }, { step: 200, loss: 1 }] },
    { id: 'disjoint', name: 'Disjoint', points: [{ step: 50, loss: 2 }] },
  ]
  const results = buildComparisons(unevenRuns, 'loss', 'absolute', 'base')

  assert.equal(results.length, 3)
  assert.deepEqual(results.map(({ comparison }) => comparison.labels), [[0], [100, 200], []])
  assert.deepEqual(results[0].comparison.errorSeries[0].points, [{ step: 0, value: 1 }])
  assert.deepEqual(results[1].comparison.errorSeries[0].points, [{ step: 100, value: 2 }, { step: 200, value: 3 }])
  assert.deepEqual(results[2].comparison.errorSeries, [])
})

test('removed baseline falls back to the first remaining run and single files have no pairs', () => {
  const remaining = multiRuns.slice(1)
  const results = buildComparisons(remaining, 'loss', 'absolute', 'run-a')
  assert.deepEqual(results.map(({ baseline, candidate }) => [baseline.id, candidate.id]), [
    ['run-b', 'run-c'],
    ['run-b', 'run-d'],
  ])
  assert.deepEqual(buildComparisons([], 'loss', 'absolute'), [])
  assert.deepEqual(buildComparisons([multiRuns[0]], 'loss', 'absolute', 'run-a'), [])
})
